import { UpstreamBusinessError } from '@nextech/service-kit';
import { PromotionClient } from './promotion.client';

// NT.ORDER Component_Class_Design §5, NT.PROMOTION API_Spec `POST/DELETE /internal/redemptions`
describe('PromotionClient', () => {
  const request = jest.fn();
  const client = new PromotionClient({ request });
  beforeEach(() => request.mockReset());

  it('redeem: POST /internal/redemptions, retry (idempotent theo order_id)', async () => {
    const dto = {
      order_id: 'o1',
      subtotal: 1500000,
      shipping_fee: 30000,
      discount_code: 'SALE10',
    };
    const result = {
      order_id: 'o1',
      status: 'redeemed',
      discount_code_id: 'd1',
      freeship_code_id: null,
      discount_amount: 150000,
      shipping_discount_amount: 0,
    };
    request.mockResolvedValue(result);

    await expect(client.redeem(dto)).resolves.toEqual(result);
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/internal/redemptions',
      body: dto,
      retry: true,
    });
  });

  it('lỗi nghiệp vụ của promotion truyền nguyên', async () => {
    const err = new UpstreamBusinessError(
      'promotion',
      400,
      'NT-PRM-1001',
      'Mã không tồn tại',
    );
    request.mockRejectedValue(err);
    await expect(
      client.redeem({ order_id: 'o1', subtotal: 1, shipping_fee: 0 }),
    ).rejects.toBe(err);
  });

  it('release: DELETE /internal/redemptions/:orderId, retry (idempotent)', async () => {
    request.mockResolvedValue({ status: 'released', restored: false });

    await expect(client.release('o1')).resolves.toEqual({
      status: 'released',
      restored: false,
    });
    expect(request).toHaveBeenCalledWith({
      method: 'DELETE',
      path: '/internal/redemptions/o1',
      retry: true,
    });
  });

  it('redeem chuyển deadline xuống request', async () => {
    request.mockResolvedValue({});
    await client.redeem(
      { order_id: 'o1', subtotal: 1, shipping_fee: 0 },
      { deadline: 9 },
    );
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ deadline: 9 }),
    );
  });
});
