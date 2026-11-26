import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UpstreamError } from '@nextech/service-kit';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { IdentityClient } from '../../clients/identity.client';
import { Conversation } from '../../database/entities/conversation.entity';
import { Message } from '../../database/entities/message.entity';
import { conversationNotFound } from '../../errors';
import type { QueryConversationsAdminDto } from './conversation.admin.dto';

export const GUEST_NAME = 'Khách';
export const DELETED_USER_NAME = 'Người dùng đã xoá';

// Chuyển từ source cũ admin/conversation/conversation.admin.service.ts (NT.ASSISTANT_ADMIN Component_Class_Design §2).
// Bỏ leftJoin('c.user') (users ở identity): tên lấy qua POST /internal/users/batch, một lời gọi mỗi trang.
// Identity lỗi: vẫn 200, user_name null + user_names_unavailable (API_Spec §2).
@Injectable()
export class ConversationAdminService {
  private readonly logger = new Logger(ConversationAdminService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly identity: IdentityClient,
  ) {}

  // GET /api/admin/conversations — 2 truy vấn DB (dữ liệu, đếm), tối đa 1 lời gọi identity
  async findAll(query: QueryConversationsAdminDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .select([
        'c.id',
        'c.user_id',
        'c.title',
        'c.channel',
        'c.current_step',
        'c.started_at',
        'c.ended_at',
      ]);
    if (query.channel) {
      qb.andWhere('c.channel = :channel', { channel: query.channel });
    }
    if (query.from) qb.andWhere('c.started_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('c.started_at <= :to', { to: query.to });
    qb.orderBy('c.started_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    const ids = [
      ...new Set(rows.map((c) => c.user_id).filter((v): v is string => !!v)),
    ];
    let names = new Map<string, string | null>();
    let unavailable = false;
    if (ids.length) {
      try {
        const { items } = await this.identity.getUsers(ids);
        names = new Map(items.map((u) => [u.id, u.full_name]));
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
        this.logger.warn(`Không lấy được tên người dùng: ${err.reason}`);
        unavailable = true;
      }
    }

    const nameOf = (userId: string | null): string | null => {
      if (!userId) return GUEST_NAME;
      if (unavailable) return null;
      return names.has(userId) ? names.get(userId)! : DELETED_USER_NAME;
    };

    return {
      data: rows.map((c) => ({
        id: c.id,
        user_name: nameOf(c.user_id),
        title: c.title,
        channel: c.channel,
        current_step: c.current_step,
        started_at: c.started_at,
        ended_at: c.ended_at,
      })),
      total,
      page,
      limit,
      ...(unavailable ? { user_names_unavailable: true } : {}),
    };
  }

  // GET /api/admin/conversations/:id — không gọi service khác
  async findOneDetail(id: string) {
    const conversation = isUUID(id)
      ? await this.conversationRepo.findOne({ where: { id } })
      : null;
    if (!conversation) throw conversationNotFound();

    const messages = await this.messageRepo.find({
      where: { conversation_id: id },
      order: { created_at: 'ASC' },
      select: {
        sender: true,
        content: true,
        message_type: true,
        metadata: true,
        created_at: true,
      },
    });
    return { id: conversation.id, context: conversation.context, messages };
  }
}
