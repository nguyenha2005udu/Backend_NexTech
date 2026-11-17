// Chép từ be/src/users/industry/industry.dto.ts. Chỉ khai kiểu `value: string` cho parseInt (lint), hành vi không đổi
import { IsOptional, IsBoolean, IsInt, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class IndustryQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_products?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  limit?: number = 20;
}
