import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Address } from '../database/entities/address.entity';
import { User } from '../database/entities/user.entity';
import { addressNotFound } from '../modules/address/address.service';
import { userNotFound } from '../modules/profile/profile.service';

// Dữ liệu người dùng cho service khác (NT.IDENTITY API_Spec §2). Mới do tách service:
// trước đây order/catalog/notification JOIN thẳng bảng users, addresses.
// Mỗi hàm một truy vấn, chỉ `select` trường của hợp đồng — không bao giờ có password_hash.
@Injectable()
export class UsersInternalService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
  ) {}

  // GET /internal/users/:id — bên gọi: order, catalog, notification
  async getUser(id: string) {
    const user = await this.users.findOne({
      where: { id },
      select: {
        id: true,
        email: true,
        full_name: true,
        phone_number: true,
        avatar_url: true,
        is_active: true,
      },
    });
    if (!user) throw userNotFound();
    return user;
  }

  // GET /internal/users/:userId/addresses/:addressId — bên gọi: order. Không thuộc userId thì 404 như không có.
  async getAddress(userId: string, addressId: string) {
    const address = await this.addresses.findOne({
      where: { id: addressId, user_id: userId },
      select: {
        id: true,
        user_id: true,
        full_address: true,
        recipient_name: true,
        phone_number: true,
        is_default: true,
      },
    });
    if (!address) throw addressNotFound();
    return address;
  }

  // POST /internal/users/batch — bên gọi: assistant. Tối đa 100 id (DTO chặn), id không có thì bỏ qua.
  async getUsers(ids: string[]) {
    if (ids.length === 0) return { items: [] };
    const items = await this.users.find({
      where: { id: In(ids) },
      select: { id: true, full_name: true, email: true, avatar_url: true },
    });
    return { items };
  }

  // GET /internal/stats/users — bên gọi: order (thống kê tổng quan). Như be/src/admin/statistics.
  async countUsers() {
    return { total_users: await this.users.count() };
  }
}
