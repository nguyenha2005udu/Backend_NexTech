// Chép nguyên từ be/src/users/address/address.dto.ts
import {
  IsString,
  IsOptional,
  IsBoolean,
  MaxLength,
  Matches,
} from 'class-validator';

// ---------- POST /users/me/addresses ----------
export class CreateAddressDto {
  @IsString()
  @MaxLength(255)
  full_address: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  recipient_name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+ ]{8,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone_number?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

// ---------- PUT /users/me/addresses/:id ----------
export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  recipient_name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+ ]{8,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone_number?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
