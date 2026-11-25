import { PoisonMessageError, type EventEnvelope } from '@nextech/service-kit';
import type {
  NotificationChannel,
  NotificationType,
} from '../../database/entities/notification.entity';

// Sự kiện → thông báo (NT.NOTIFICATION API_Spec §2, §3). Hàm thuần, không I/O.
// Câu order.created giữ đúng order.service.ts của source cũ.

export interface NotificationDraft {
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channel: NotificationChannel;
}

export interface Template {
  notification: NotificationDraft;
  /** Có giá trị: gửi thêm email theo dõi giá */
  email?: { productName: string; currentPrice: number; targetPrice: number };
  /** Kênh sms: chưa hỗ trợ, chỉ ghi log */
  smsUnsupported?: boolean;
}

/** 1350000 → "1.350.000" như toLocaleString('vi-VN') của source cũ, không phụ thuộc ICU của máy */
export function formatVnd(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 8 ký tự đầu của id đơn, in hoa: #A1B2C3D4 */
export const orderCode = (orderId: string) => orderId.slice(0, 8).toUpperCase();

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  if (typeof v !== 'string' || !v) {
    throw new PoisonMessageError(`Thiếu trường ${key}`);
  }
  return v;
}

function num(data: Record<string, unknown>, key: string): number {
  const v = Number(data[key]);
  if (data[key] === undefined || data[key] === null || !Number.isFinite(v)) {
    throw new PoisonMessageError(`Thiếu trường ${key}`);
  }
  return v;
}

function orderUpdate(
  data: Record<string, unknown>,
  title: string,
  body: (code: string) => string,
): Template {
  const orderId = str(data, 'order_id');
  return {
    notification: {
      user_id: str(data, 'user_id'),
      type: 'order_update',
      title,
      body: body(orderCode(orderId)),
      data: { order_id: orderId },
      channel: 'app',
    },
  };
}

/** Sự kiện không biết hoặc thiếu trường: PoisonMessageError (vào DLQ, không thử lại) */
export function buildTemplate(event: EventEnvelope): Template {
  const d = event.data;
  switch (event.type) {
    case 'order.created': {
      const total = num(d, 'total');
      return orderUpdate(
        d,
        'Đặt hàng thành công',
        (c) =>
          `Đơn hàng #${c} (${formatVnd(total)}đ) đã được tạo và đang chờ xử lý.`,
      );
    }
    case 'order.paid':
      return orderUpdate(
        d,
        'Thanh toán thành công',
        (c) => `Đơn hàng #${c} đã được thanh toán.`,
      );
    case 'order.cancelled':
      return orderUpdate(
        d,
        'Đơn hàng đã huỷ',
        (c) => `Đơn hàng #${c} đã được huỷ.`,
      );
    case 'order.failed': {
      const reason =
        typeof d.reason === 'string' && d.reason
          ? d.reason
          : 'Đặt hàng không thành công';
      return orderUpdate(
        d,
        'Đặt hàng không thành công',
        (c) => `Đơn hàng #${c} không thể hoàn tất: ${reason}`,
      );
    }
    case 'price.alert.triggered': {
      const productName = str(d, 'product_name');
      const currentPrice = num(d, 'current_price');
      const channel = typeof d.channel === 'string' ? d.channel : 'app';
      const productId = str(d, 'product_id');
      const alertId = str(d, 'alert_id');
      return {
        notification: {
          user_id: str(d, 'user_id'),
          type: 'price_alert',
          title: 'Giá đã giảm',
          body: `${productName} hiện còn ${formatVnd(currentPrice)}đ, đã chạm mức bạn theo dõi.`,
          data: { product_id: productId, alert_id: alertId },
          channel: channel === 'email' || channel === 'sms' ? channel : 'app',
        },
        ...(channel === 'email'
          ? {
              email: {
                productName,
                currentPrice,
                targetPrice: num(d, 'target_price'),
              },
            }
          : {}),
        ...(channel === 'sms' ? { smsUnsupported: true } : {}),
      };
    }
    default:
      throw new PoisonMessageError(`Sự kiện không hỗ trợ: ${event.type}`);
  }
}
