// Chép từ source cũ users/chat/chat.dto.ts. Phần tử sai trong history bị bỏ qua ở ChatService,
// không báo 400 (NT.ASSISTANT_CHAT API_Spec §2), nên không validate từng phần tử.
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChatMessageDto {
  role: 'user' | 'model';
  text: string;
}

// POST /api/chat
export class ChatDto {
  @IsString()
  @MaxLength(2000)
  message: string;

  // Lịch sử hội thoại (chỉ text). role: 'user' | 'model'. Chỉ dùng 20 phần tử cuối.
  @IsOptional()
  @IsArray()
  history?: ChatMessageDto[];
}
