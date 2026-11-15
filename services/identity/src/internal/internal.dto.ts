import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';

// Body API nội bộ (NT.IDENTITY API_Spec §2)

export class RefreshInternalDto {
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}

// Tối đa 100 id (non-functional-standards §1: chặn trên ngay từ thiết kế)
export class UsersBatchDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids: string[];
}
