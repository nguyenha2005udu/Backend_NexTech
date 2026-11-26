import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Conversation } from '../../database/entities/conversation.entity';
import { Message } from '../../database/entities/message.entity';
import { conversationForbidden, conversationNotFound } from '../../errors';
import type { ChatMessageDto } from '../chat/chat.dto';
import { ChatService } from '../chat/chat.service';
import type {
  CreateConversationDto,
  QueryMessagesDto,
  SendMessageDto,
} from './conversation.dto';

// Số tin nhắn cũ gửi kèm cho AI làm ngữ cảnh
export const HISTORY_LIMIT = 20;
// GET /api/conversations không phân trang (app đọc mảng), chặn trên (API_Spec §4)
export const MINE_LIMIT = 100;

// Chuyển từ source cũ users/conversation/conversation.service.ts (Component_Class_Design §1, §3). Đổi:
// - sendMessage gọi AI trước, lưu câu hỏi + câu trả lời + cập nhật phiên trong một transaction (BR-16)
// - findMine chặn 100 phiên; id không phải UUID coi như không tồn tại (404 thay vì lỗi truy vấn)
@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly chat: ChatService,
  ) {}

  // BR-14. Phiên có chủ: đúng chủ đó. Phiên khách: đúng thiết bị giữ cookie guest_id, kể cả đã đăng nhập.
  private assertCanAccess(
    conversation: Conversation,
    requesterId: string | null,
    guestId: string | null,
  ): void {
    const allowed =
      conversation.user_id !== null
        ? conversation.user_id === requesterId
        : conversation.guest_id !== null && conversation.guest_id === guestId;
    if (!allowed) throw conversationForbidden();
  }

  private async findAccessible(
    id: string,
    requesterId: string | null,
    guestId: string | null,
  ): Promise<Conversation> {
    const conversation = isUUID(id)
      ? await this.conversationRepo.findOne({ where: { id } })
      : null;
    if (!conversation) throw conversationNotFound();
    this.assertCanAccess(conversation, requesterId, guestId);
    return conversation;
  }

  // POST /api/conversations. guestId chỉ dùng khi chưa đăng nhập
  async create(
    userId: string | null,
    guestId: string | null,
    dto: CreateConversationDto,
  ) {
    const conversation = await this.conversationRepo.save(
      this.conversationRepo.create({
        user_id: userId,
        guest_id: userId ? null : guestId,
        channel: dto.channel ?? 'chat',
        current_step: 'search',
      }),
    );
    return {
      id: conversation.id,
      channel: conversation.channel,
      current_step: conversation.current_step,
      started_at: conversation.started_at,
    };
  }

  // GET /api/conversations
  findMine(userId: string) {
    return this.conversationRepo.find({
      where: { user_id: userId },
      order: { started_at: 'DESC' },
      select: {
        id: true,
        title: true,
        channel: true,
        current_step: true,
        started_at: true,
        ended_at: true,
      },
      take: MINE_LIMIT,
    });
  }

  // GET /api/conversations/:id
  async findOne(
    id: string,
    requesterId: string | null,
    guestId: string | null,
  ) {
    const c = await this.findAccessible(id, requesterId, guestId);
    return {
      id: c.id,
      title: c.title,
      current_step: c.current_step,
      context: c.context,
      started_at: c.started_at,
      ended_at: c.ended_at,
    };
  }

  // POST /api/conversations/:id/messages (Component_Class_Design §3)
  async sendMessage(
    id: string,
    requesterId: string | null,
    guestId: string | null,
    dto: SendMessageDto,
  ) {
    const conversation = await this.findAccessible(id, requesterId, guestId);

    // Lấy lịch sử TRƯỚC: câu hỏi hiện tại đi riêng qua `message`, gửi kèm trong history sẽ thành hỏi hai lần
    const history = await this.buildHistory(conversation.id);
    const askedAt = new Date();

    // Không mở transaction trong lúc gọi AI, vì có thể mất hàng chục giây. AI lỗi: không lưu gì (BR-16)
    const { reply, products } = await this.chat.chat({
      message: dto.content,
      history,
    });
    const hasProducts = products.length > 0;

    return this.dataSource.transaction(async (m) => {
      await m.insert(Message, {
        conversation_id: conversation.id,
        sender: 'user',
        content: dto.content,
        message_type: 'text',
        created_at: askedAt,
      });
      // Giờ tường minh, sau askedAt: hai dòng cùng transaction mà dùng now() sẽ trùng giờ
      const repliedAt = new Date(Math.max(Date.now(), askedAt.getTime() + 1));
      const agent = await m.save(
        m.create(Message, {
          conversation_id: conversation.id,
          sender: 'agent',
          content: reply,
          message_type: hasProducts ? 'product_card' : 'text',
          // Lưu nguyên sản phẩm đã gợi ý: mở lại phiên cũ vẫn thấy đúng, không tra lại
          metadata: hasProducts ? { products } : null,
          created_at: repliedAt,
        }),
      );
      await m.update(Conversation, conversation.id, {
        title: conversation.title ?? dto.content.slice(0, 100),
        current_step: hasProducts ? 'recommend' : conversation.current_step,
      });
      return {
        id: agent.id,
        sender: agent.sender,
        content: agent.content,
        message_type: agent.message_type,
        metadata: agent.metadata,
        created_at: agent.created_at,
      };
    });
  }

  // GET /api/conversations/:id/messages
  async getMessages(
    id: string,
    requesterId: string | null,
    guestId: string | null,
    query: QueryMessagesDto,
  ) {
    await this.findAccessible(id, requesterId, guestId);

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const [data, total] = await this.messageRepo.findAndCount({
      where: { conversation_id: id },
      order: { created_at: 'ASC' },
      select: {
        id: true,
        sender: true,
        content: true,
        message_type: true,
        metadata: true,
        created_at: true,
      },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  // POST /api/conversations/claim (BR-15). UPDATE có điều kiện: hai lệnh đồng thời không gán trùng.
  // Xoá guest_id để cookie cũ không kéo theo được phiên nào cho người đăng nhập sau trên cùng máy.
  async claim(userId: string, guestId: string | null) {
    if (!guestId) return { claimed: 0 };
    const result = await this.conversationRepo.update(
      { user_id: IsNull(), guest_id: guestId },
      { user_id: userId, guest_id: null },
    );
    return { claimed: result.affected ?? 0 };
  }

  // Lịch sử cho AI: HISTORY_LIMIT tin gần nhất (DESC rồi đảo lại) để đúng thứ tự thời gian
  private async buildHistory(
    conversationId: string,
  ): Promise<ChatMessageDto[]> {
    const recent = await this.messageRepo.find({
      where: { conversation_id: conversationId },
      order: { created_at: 'DESC' },
      take: HISTORY_LIMIT,
    });
    return recent.reverse().map((msg) => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      text: msg.content,
    }));
  }
}
