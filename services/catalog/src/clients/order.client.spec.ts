import { UpstreamBusinessError, UpstreamError } from '@nextech/service-kit';
import { OrderClient } from './order.client';

// NT.CATALOG API_Spec §3 (v1.6), NT.ORDER API_Spec §2 `GET /internal/purchases/check`
describe('OrderClient.hasPurchased', () => {
  const request = jest.fn();
  const client = new OrderClient({ request });
  beforeEach(() => request.mockReset());

  it('gọi GET /internal/purchases/check với user_id, product_id, retry mặc định của GET', async () => {
    request.mockResolvedValue({ purchased: true });

    await expect(client.hasPurchased('u1', 'p1')).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/internal/purchases/check',
      query: { user_id: 'u1', product_id: 'p1' },
    });
  });

  it('{ purchased: false } → false', async () => {
    request.mockResolvedValue({ purchased: false });
    await expect(client.hasPurchased('u1', 'p1')).resolves.toBe(false);
  });

  it('order trả 4xx (vd chưa có route tới T3.2) → 503 NT-GEN-0503, không chuyển 4xx về client', async () => {
    request.mockRejectedValue(
      new UpstreamBusinessError('order', 404, 'NT-GEN-0004', 'Cannot GET'),
    );

    const err = await client.hasPurchased('u1', 'p1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).getStatus()).toBe(503);
    expect((err as UpstreamError).code).toBe('NT-GEN-0503');
    expect((err as UpstreamError).target).toBe('order');
  });

  it('order chết (UpstreamError 503) → giữ nguyên', async () => {
    const down = new UpstreamError('order', 'ECONNREFUSED', 'not_executed');
    request.mockRejectedValue(down);
    await expect(client.hasPurchased('u1', 'p1')).rejects.toBe(down);
  });

  it('quá giờ (UpstreamError 504) → giữ nguyên 504 (reliability-standard §4)', async () => {
    const timeout = new UpstreamError('order', 'timeout', 'unknown', 504);
    request.mockRejectedValue(timeout);
    await expect(client.hasPurchased('u1', 'p1')).rejects.toBe(timeout);
  });
});
