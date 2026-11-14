// Chép nguyên từ be/src/users/profile/profile.dto.ts
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsArray,
  IsObject,
  IsNumber,
  Min,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';

// ---------- PUT /users/me ----------
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  full_name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+ ]{8,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone_number?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}

// ---------- PUT /users/me/profile ----------
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  user_segment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  age_range?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];
}

// ---------- PUT /users/me/preferences ----------
class BudgetRangeDto {
  @IsNumber()
  @Min(0)
  min: number;

  @IsNumber()
  @Min(0)
  max: number;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferred_categories?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetRangeDto)
  budget_range?: BudgetRangeDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferred_brands?: string[];

  @IsOptional()
  @IsObject()
  preferred_attributes?: Record<string, any>;

  // last_intent_summary cố ý KHÔNG có ở đây: field này do AI ghi tự động,
  // user không được sửa trực tiếp qua API.
}
