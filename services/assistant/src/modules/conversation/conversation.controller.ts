// Chép từ source cũ users/conversation/conversation.controller.ts. Đổi guard: JwtAccessGuard →
// GatewayUserGuard; OptionalJwtAccessGuard → OptionalGatewayUserGuard. Cookie tách sang guest-cookie.ts.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  GatewayUserGuard,
  OptionalGatewayUserGuard,
  type GatewayUser,
} from '@nextech/service-kit';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  CreateConversationDto,
  QueryMessagesDto,
  SendMessageDto,
} from './conversation.dto';
import { ConversationService } from './conversation.service';
import {
  clearGuestCookie,
  issueGuestCookie,
  readGuestId,
} from './guest-cookie';

@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  // POST /api/conversations — khách được tạo phiên; chưa có cookie guest_id thì cấp
  @UseGuards(OptionalGatewayUserGuard)
  @Post()
  create(
    @CurrentUser() user: GatewayUser | undefined,
    @Body() dto: CreateConversationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = user?.sub ?? null;
    let guestId: string | null = null;
    if (!userId) {
      guestId = readGuestId(req) ?? randomUUID();
      issueGuestCookie(res, guestId);
    }
    return this.conversationService.create(userId, guestId, dto);
  }

  // GET /api/conversations — "của tôi", bắt buộc đăng nhập
  @UseGuards(GatewayUserGuard)
  @Get()
  findMine(@CurrentUser() user: GatewayUser) {
    return this.conversationService.findMine(user.sub);
  }

  // POST /api/conversations/claim — gán phiên khách của thiết bị này cho tài khoản, rồi xoá cookie (BR-15)
  @UseGuards(GatewayUserGuard)
  @Post('claim')
  @HttpCode(200)
  async claim(
    @CurrentUser() user: GatewayUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.conversationService.claim(
      user.sub,
      readGuestId(req),
    );
    clearGuestCookie(res);
    return result;
  }

  // GET /api/conversations/:id
  @UseGuards(OptionalGatewayUserGuard)
  @Get(':id')
  findOne(
    @CurrentUser() user: GatewayUser | undefined,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.conversationService.findOne(
      id,
      user?.sub ?? null,
      readGuestId(req),
    );
  }

  // POST /api/conversations/:id/messages — trả tin nhắn của trợ lý, 201
  @UseGuards(OptionalGatewayUserGuard)
  @Post(':id/messages')
  sendMessage(
    @CurrentUser() user: GatewayUser | undefined,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.conversationService.sendMessage(
      id,
      user?.sub ?? null,
      readGuestId(req),
      dto,
    );
  }

  // GET /api/conversations/:id/messages
  @UseGuards(OptionalGatewayUserGuard)
  @Get(':id/messages')
  getMessages(
    @CurrentUser() user: GatewayUser | undefined,
    @Param('id') id: string,
    @Query() query: QueryMessagesDto,
    @Req() req: Request,
  ) {
    return this.conversationService.getMessages(
      id,
      user?.sub ?? null,
      readGuestId(req),
      query,
    );
  }
}
