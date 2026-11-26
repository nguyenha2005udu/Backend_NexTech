// Chép nguyên từ source cũ admin/conversation/conversation.admin.dto.ts. limit tối đa 100 chặn ở service.
import {
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
} from 'class-validator';

// GET /api/admin/conversations
export class QueryConversationsAdminDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsIn(['chat', 'voice'])
  channel?: 'chat' | 'voice';

  // Lọc theo khoảng thời gian started_at
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
