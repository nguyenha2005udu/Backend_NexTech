// Chép nguyên từ be/src/admin/profile/profile.admin.dto.ts
import {
  IsOptional,
  IsIn,
  IsString,
  IsBooleanString,
  IsNumberString,
  IsBoolean,
} from 'class-validator';

// ---------- GET /admin/users (query) ----------
export class QueryUsersDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  // Tìm theo full_name / email / phone_number
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: string;

  @IsOptional()
  @IsBooleanString()
  is_active?: string;
}

// ---------- PUT /admin/users/:id ----------
export class AdminUpdateUserDto {
  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
