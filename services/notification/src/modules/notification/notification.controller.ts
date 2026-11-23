import { Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  GatewayUserGuard,
  type GatewayUser,
} from '@nextech/service-kit';
import { QueryNotificationDto } from './notification.dto';
import { NotificationService } from './notification.service';

// Chép từ users/notification/notification.controller.ts của source cũ. Đổi guard: JwtAccessGuard → GatewayUserGuard.
@Controller('notifications')
@UseGuards(GatewayUserGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  // GET /api/notifications
  @Get()
  findMine(
    @CurrentUser() user: GatewayUser,
    @Query() query: QueryNotificationDto,
  ) {
    return this.notificationService.findMine(user.sub, query);
  }

  // GET /api/notifications/unread-count
  // Đặt TRƯỚC các tuyến có tham số để 'unread-count' không bị nuốt thành :id.
  @Get('unread-count')
  unreadCount(@CurrentUser() user: GatewayUser) {
    return this.notificationService.unreadCount(user.sub);
  }

  // PUT /api/notifications/read-all
  @Put('read-all')
  markAllRead(@CurrentUser() user: GatewayUser) {
    return this.notificationService.markAllRead(user.sub);
  }

  // PUT /api/notifications/:id/read
  @Put(':id/read')
  markRead(@CurrentUser() user: GatewayUser, @Param('id') id: string) {
    return this.notificationService.markRead(user.sub, id);
  }
}
