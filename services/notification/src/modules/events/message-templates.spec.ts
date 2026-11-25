import { PoisonMessageError, type EventEnvelope } from '@nextech/service-kit';
import { buildTemplate, formatVnd } from './message-templates';

// NT.NOTIFICATION API_Spec §2, §3; Component_Class_Design §5 "Mỗi loại sự kiện", "Sự kiện không biết".

const ORDER = 'a1b2c3d4-0000-4000-8000-000000000001';
const USER = '11111111-2222-4333-8444-555555555555';

const ev = (type: string, data: Record<string, unknown>): EventEnvelope => ({
  event_id: '0a6c8f1e-7a58-4a1b-9e3a-6a4ad4b0a4c1',
  type,
  version: 1,
  occurred_at: '2026-11-04T10:00:00.000Z',
  source: 'order',
  request_id: null,
  data,
});

describe('buildTemplate', () => {
  it('order.created: đúng câu của source cũ, tiền định dạng vi-VN', () => {
    const t = buildTemplate(
      ev('order.created', { order_id: ORDER, user_id: USER, total: 1350000 }),
    );
    expect(t.notification).toEqual({
      user_id: USER,
      type: 'order_update',
      title: 'Đặt hàng thành công',
      body: 'Đơn hàng #A1B2C3D4 (1.350.000đ) đã được tạo và đang chờ xử lý.',
      data: { order_id: ORDER },
      channel: 'app',
    });
    expect(t.email).toBeUndefined();
  });

  it.each([
    [
      'order.paid',
      'Thanh toán thành công',
      'Đơn hàng #A1B2C3D4 đã được thanh toán.',
    ],
    ['order.cancelled', 'Đơn hàng đã huỷ', 'Đơn hàng #A1B2C3D4 đã được huỷ.'],
  ])('%s', (type, title, body) => {
    const t = buildTemplate(
      ev(type, {
        order_id: ORDER,
        user_id: USER,
        total: 1,
        cancelled_by: 'user',
      }),
    );
    expect(t.notification).toMatchObject({ type: 'order_update', title, body });
  });

  it('order.failed: nội dung kèm lý do', () => {
    const t = buildTemplate(
      ev('order.failed', {
        order_id: ORDER,
        user_id: USER,
        reason: 'Hết hàng',
      }),
    );
    expect(t.notification).toMatchObject({
      title: 'Đặt hàng không thành công',
      body: 'Đơn hàng #A1B2C3D4 không thể hoàn tất: Hết hàng',
    });
  });

  const alert = (channel: string) =>
    ev('price.alert.triggered', {
      alert_id: 'al1',
      user_id: USER,
      product_id: 'p1',
      product_name: 'Tai nghe X',
      current_price: 990000,
      target_price: 1000000,
      channel,
    });

  it('price.alert.triggered kênh app: chỉ thông báo', () => {
    const t = buildTemplate(alert('app'));
    expect(t.notification).toMatchObject({
      type: 'price_alert',
      title: 'Giá đã giảm',
      body: 'Tai nghe X hiện còn 990.000đ, đã chạm mức bạn theo dõi.',
      data: { product_id: 'p1', alert_id: 'al1' },
    });
    expect(t.email).toBeUndefined();
  });

  it('kênh email: kèm email; kênh sms: đánh dấu chưa hỗ trợ', () => {
    expect(buildTemplate(alert('email')).email).toEqual({
      productName: 'Tai nghe X',
      currentPrice: 990000,
      targetPrice: 1000000,
    });
    expect(buildTemplate(alert('sms')).smsUnsupported).toBe(true);
  });

  it('sự kiện không biết hoặc thiếu trường: PoisonMessageError', () => {
    expect(() => buildTemplate(ev('order.shipped', {}))).toThrow(
      PoisonMessageError,
    );
    expect(() =>
      buildTemplate(ev('order.created', { order_id: ORDER, user_id: USER })),
    ).toThrow(PoisonMessageError);
  });
});

describe('formatVnd', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1.000'],
    [1350000, '1.350.000'],
  ])('%d → %s', (n, s) => expect(formatVnd(n)).toBe(s));
});
