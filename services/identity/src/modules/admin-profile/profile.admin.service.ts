// Chép từ be/src/admin/profile/profile.admin.service.ts. Đổi: NotFoundException → NT-IDN-1003 (giữ câu chữ);
// xoá user thì thu hồi refresh token (quyết định A6, NT.IDENTITY API_Spec §6).
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, type UserRole } from '../../database/entities/user.entity';
import { UserProfile } from '../../database/entities/user-profile.entity';
import { QueryUsersDto, AdminUpdateUserDto } from './profile.admin.dto';
import { userNotFound } from '../profile/profile.service';
import { AuthService } from '../auth/auth.service';

// Dùng cho QueryBuilder.select() (nhận string[] dạng "alias.field")
const PUBLIC_USER_FIELDS = [
  'id',
  'full_name',
  'email',
  'phone_number',
  'avatar_url',
  'role',
  'is_active',
  'created_at',
] as const;

// Dùng cho repo.findOne({ select }) — TypeORM yêu cầu dạng object, không nhận mảng
const PUBLIC_USER_SELECT = {
  id: true,
  full_name: true,
  email: true,
  phone_number: true,
  avatar_url: true,
  role: true,
  is_active: true,
  created_at: true,
} as const;

@Injectable()
export class ProfileAdminService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(UserProfile) private profileRepo: Repository<UserProfile>,
    private authService: AuthService,
  ) {}

  // ---------- GET /admin/users ----------
  async findAll(query: QueryUsersDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const qb = this.userRepo
      .createQueryBuilder('u')
      .select(PUBLIC_USER_FIELDS.map((f) => `u.${f}`));

    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.is_active !== undefined) {
      qb.andWhere('u.is_active = :isActive', {
        isActive: query.is_active === 'true',
      });
    }
    if (query.search) {
      const kw = `%${query.search.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(u.full_name) LIKE :kw OR LOWER(u.email) LIKE :kw OR u.phone_number LIKE :kw)',
        { kw },
      );
    }

    qb.orderBy('u.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  // ---------- GET /admin/users/:id ----------
  async findOneDetail(id: string) {
    const user = await this.userRepo.findOne({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) throw userNotFound();

    const profile = await this.profileRepo.findOne({ where: { user_id: id } });

    return {
      ...user,
      profile: profile
        ? {
            user_segment: profile.user_segment,
            occupation: profile.occupation,
            age_range: profile.age_range,
            interests: profile.interests ?? [],
          }
        : null,
    };
  }

  // ---------- PUT /admin/users/:id ----------
  async updateStatusOrRole(id: string, dto: AdminUpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw userNotFound();

    const roleChanged = dto.role !== undefined && dto.role !== user.role;
    const locked = dto.is_active === false && user.is_active;

    if (dto.role !== undefined) user.role = dto.role as UserRole;
    if (dto.is_active !== undefined) user.is_active = dto.is_active;

    await this.userRepo.save(user);

    // Role nằm trong JWT -> khoá tài khoản / đổi role phải thu hồi refresh token,
    // buộc user nhận token mới (hoặc bị chặn nếu đã khoá) ở lần refresh kế tiếp.
    if (roleChanged || locked) await this.authService.logout(user.id);

    return {
      id: user.id,
      role: user.role,
      is_active: user.is_active,
      updated_at: user.updated_at,
    };
  }

  // ---------- DELETE /admin/users/:id ----------
  async remove(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw userNotFound();

    await this.userRepo.remove(user);
    // Dọn phiên như khi khoá: refresh sau đó trả 401 NT-IDN-1001 (A6)
    await this.authService.logout(id);
    return { message: 'Đã xoá tài khoản người dùng' };
  }
}
