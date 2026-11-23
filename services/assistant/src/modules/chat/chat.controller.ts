// Chép từ source cũ users/chat/chat.controller.ts. Public ở gateway (dòng 23, rate limit AI),
// service vẫn bắt buộc X-Internal-Token qua OptionalGatewayUserGuard. Không lưu gì.
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { OptionalGatewayUserGuard } from '@nextech/service-kit';
import { ChatDto } from './chat.dto';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(OptionalGatewayUserGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // POST /api/chat — 201 là mặc định của @Post() ở source cũ
  @Post()
  chat(@Body() dto: ChatDto) {
    return this.chatService.chat(dto);
  }
}
