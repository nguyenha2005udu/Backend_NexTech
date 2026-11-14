// Chép từ be/src/users/profile/profile.service.ts. Đổi: NotFoundException → BusinessException NT-IDN-1003 (giữ câu chữ)
import { HttpStatus, Injectable } from '@nestjs/common';
import { BusinessException } from '@nextech/service-kit';
import { IDN_ERROR } from '../../errors';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { UserProfile } from '../../database/entities/user-profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import {
  UpdateMeDto,
  UpdateProfileDto,
  UpdatePreferencesDto,
} from './profile.dto';

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

export function userNotFound() {
  return new BusinessException(
    HttpStatus.NOT_FOUND,
    IDN_ERROR.USER_NOT_FOUND,
    'Không tìm thấy người dùng',
  );
}

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(UserProfile) private profileRepo: Repository<UserProfile>,
    @InjectRepository(UserPreference)
    private prefRepo: Repository<UserPreference>,
  ) {}

  // ---------- GET /users/me ----------
  async getMe(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) throw userNotFound();
    return user;
  }

  // ---------- PUT /users/me ----------
  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw userNotFound();

    if (dto.full_name !== undefined) user.full_name = dto.full_name;
    if (dto.phone_number !== undefined) user.phone_number = dto.phone_number;
    if (dto.avatar_url !== undefined) user.avatar_url = dto.avatar_url;

    await this.userRepo.save(user);

    return {
      id: user.id,
      full_name: user.full_name,
      phone_number: user.phone_number,
      avatar_url: user.avatar_url,
      updated_at: user.updated_at,
    };
  }

  // ---------- GET /users/me/profile ----------
  async getMyProfile(userId: string) {
    const profile = await this.profileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      return {
        user_segment: null,
        occupation: null,
        age_range: null,
        interests: [],
      };
    }
    return {
      user_segment: profile.user_segment,
      occupation: profile.occupation,
      age_range: profile.age_range,
      interests: profile.interests ?? [],
    };
  }

  // ---------- PUT /users/me/profile ----------
  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    let profile = await this.profileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      profile = this.profileRepo.create({ user_id: userId });
    }
    if (dto.user_segment !== undefined) profile.user_segment = dto.user_segment;
    if (dto.occupation !== undefined) profile.occupation = dto.occupation;
    if (dto.age_range !== undefined) profile.age_range = dto.age_range;
    if (dto.interests !== undefined) profile.interests = dto.interests;

    await this.profileRepo.save(profile);

    return {
      user_segment: profile.user_segment,
      occupation: profile.occupation,
      age_range: profile.age_range,
      interests: profile.interests ?? [],
      updated_at: profile.updated_at,
    };
  }

  // ---------- GET /users/me/preferences ----------
  async getMyPreferences(userId: string) {
    const pref = await this.prefRepo.findOne({ where: { user_id: userId } });
    if (!pref) {
      return {
        preferred_categories: [],
        budget_range: null,
        preferred_brands: [],
        preferred_attributes: {},
        last_intent_summary: null,
      };
    }
    return {
      preferred_categories: pref.preferred_categories ?? [],
      budget_range: pref.budget_range,
      preferred_brands: pref.preferred_brands ?? [],
      preferred_attributes: pref.preferred_attributes ?? {},
      last_intent_summary: pref.last_intent_summary,
    };
  }

  // ---------- PUT /users/me/preferences ----------
  async updateMyPreferences(userId: string, dto: UpdatePreferencesDto) {
    let pref = await this.prefRepo.findOne({ where: { user_id: userId } });
    if (!pref) {
      pref = this.prefRepo.create({ user_id: userId });
    }
    if (dto.preferred_categories !== undefined)
      pref.preferred_categories = dto.preferred_categories;
    if (dto.budget_range !== undefined) pref.budget_range = dto.budget_range;
    if (dto.preferred_brands !== undefined)
      pref.preferred_brands = dto.preferred_brands;
    if (dto.preferred_attributes !== undefined)
      pref.preferred_attributes = dto.preferred_attributes;
    // last_intent_summary: không đụng tới, dành riêng cho pipeline AI ghi vào

    await this.prefRepo.save(pref);

    return {
      preferred_categories: pref.preferred_categories ?? [],
      budget_range: pref.budget_range,
      preferred_brands: pref.preferred_brands ?? [],
      preferred_attributes: pref.preferred_attributes ?? {},
    };
  }
}
