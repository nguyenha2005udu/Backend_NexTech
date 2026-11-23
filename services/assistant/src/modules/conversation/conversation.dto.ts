// Chép từ source cũ users/conversation/conversation.dto.ts. Đổi: content thêm @MaxLength(2000)
// (bằng POST /api/chat, chặn chi phí AI — NT.ASSISTANT_CONVERSATION API_Spec §4).
import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// POST /api/conversations
export class CreateConversationDto {
  @IsOptional()
  @IsIn(['chat', 'voice'])
  channel?: 'chat' | 'voice';
}

// POST /api/conversations/:id/messages
export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'Nội dung tin nhắn không được để trống' })
  @MaxLength(2000)
  content: string;
}

// GET /api/conversations/:id/messages
export class QueryMessagesDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}
