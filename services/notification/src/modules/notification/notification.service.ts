import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { Notification } from '../../database/entities/notification.entity';
import { notificationNotFound } from '../../errors';
import { QueryNotificationDto } from './notification.dto';

// Chép từ users/notification/notification.service.ts của source cũ. Đổi: NotFoundException → NT-NTF-1001.
@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  // GET /api/notifications
  async findMine(userId: string, query: QueryNotificationDto) {
    const { type, unread, page = 1, limit = 20 } = query;

    const [items, total] = await this.notificationRepo.findAndCount({
      where: {
        user_id: userId,
        ...(type ? { type } : {}),
        ...(unread === 'true' ? { is_read: false } : {}),
      },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        is_read: n.is_read,
        created_at: n.created_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // GET /api/notifications/unread-count — cho chấm đỏ trên nút chuông
  async unreadCount(userId: string) {
    const count = await this.notificationRepo.count({
      where: { user_id: userId, is_read: false },
    });
    return { count };
  }

  // PUT /api/notifications/:id/read
  async markRead(userId: string, id: string) {
    // id không phải UUID: không thể tồn tại, trả 404 thay vì để Postgres báo lỗi kiểu dữ liệu (500)
    if (!isUUID(id)) throw notificationNotFound();
    const notification = await this.notificationRepo.findOne({
      where: { id, user_id: userId },
    });
    if (!notification) throw notificationNotFound();

    if (!notification.is_read) {
      notification.is_read = true;
      await this.notificationRepo.save(notification);
    }
    return { id: notification.id, is_read: notification.is_read };
  }

  // PUT /api/notifications/read-all
  async markAllRead(userId: string) {
    const result = await this.notificationRepo.update(
      { user_id: userId, is_read: false },
      { is_read: true },
    );
    return { updated: result.affected ?? 0 };
  }
}
