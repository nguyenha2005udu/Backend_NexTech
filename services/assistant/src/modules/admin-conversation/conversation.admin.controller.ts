// Chép từ source cũ admin/conversation/conversation.admin.controller.ts. Đổi guard: JwtAccessGuard →
// GatewayUserGuard; RolesGuard, @Roles từ service-kit. Gateway đã chặn /api/admin/*, service vẫn giữ.
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';
import { QueryConversationsAdminDto } from './conversation.admin.dto';
import { ConversationAdminService } from './conversation.admin.service';

@Controller('admin/conversations')
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
export class ConversationAdminController {
  constructor(private readonly service: ConversationAdminService) {}

  // GET /api/admin/conversations
  @Get()
  findAll(@Query() query: QueryConversationsAdminDto) {
    return this.service.findAll(query);
  }

  // GET /api/admin/conversations/:id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOneDetail(id);
  }
}
