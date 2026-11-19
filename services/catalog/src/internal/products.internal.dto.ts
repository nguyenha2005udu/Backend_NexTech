import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

// Body POST /internal/products/batch (NT.CATALOG API_Spec §2).
// Tối đa 100 id (non-functional-standards §1: chặn trên ngay từ thiết kế). Mẫu: identity UsersBatchDto.
export class ProductsBatchDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids: string[];
}
