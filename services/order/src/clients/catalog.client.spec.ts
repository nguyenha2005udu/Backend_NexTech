import { UpstreamError } from '@nextech/service-kit';
import { CatalogClient } from './catalog.client';

// NT.ORDER Component_Class_Design §5, NT.CATALOG API_Spec §2
describe('CatalogClient', () => {
  const request = jest.fn();
  const client = new CatalogClient({ request });
  beforeEach(() => request.mockReset());

  describe('getProducts', () => {
    it('gọi POST /internal/products/batch, retry vì chỉ đọc, trả items', async () => {
      const items = [
        {
          id: 'p1',
          name: 'Tai nghe',
          price: 1500000,
          stock_quantity: 3,
          is_active: true,
          image: null,
        },
      ];
      request.mockResolvedValue({ items });

      await expect(client.getProducts(['p1'])).resolves.toEqual(items);
      expect(request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/internal/products/batch',
        body: { ids: ['p1'] },
        retry: true,
      });
    });

    it('ids rỗng → [] và không gọi catalog', async () => {
      await expect(client.getProducts([])).resolves.toEqual([]);
      expect(request).not.toHaveBeenCalled();
    });

    it('bỏ id trùng trước khi gọi', async () => {
      request.mockResolvedValue({ items: [] });
      await client.getProducts(['p1', 'p1', 'p2']);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ body: { ids: ['p1', 'p2'] } }),
      );
    });

    it('quá 100 id → chia lô 100 (giới hạn của batch), gộp kết quả', async () => {
      const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);
      request.mockImplementation(({ body }: { body: { ids: string[] } }) =>
        Promise.resolve({ items: body.ids.map((id) => ({ id })) }),
      );

      const res = await client.getProducts(ids);

      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ body: { ids: ids.slice(0, 100) } }),
      );
      expect(request).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ body: { ids: ids.slice(100) } }),
      );
      expect(res).toHaveLength(150);
    });

    it('lỗi truyền nguyên (bên gọi quyết định degraded hay 503)', async () => {
      const down = new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed');
      request.mockRejectedValue(down);
      await expect(client.getProducts(['p1'])).rejects.toBe(down);
    });
  });

  it('reserve: POST /internal/stock-reservations, retry (idempotent theo order_id)', async () => {
    request.mockResolvedValue({ order_id: 'o1', status: 'reserved' });
    const items = [{ product_id: 'p1', quantity: 2 }];

    await expect(client.reserve('o1', items)).resolves.toEqual({
      order_id: 'o1',
      status: 'reserved',
    });
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/internal/stock-reservations',
      body: { order_id: 'o1', items },
      retry: true,
    });
  });

  it('release: DELETE /internal/stock-reservations/:orderId, retry (idempotent)', async () => {
    request.mockResolvedValue({ status: 'released', restored: true });

    await expect(client.release('o1')).resolves.toEqual({
      status: 'released',
      restored: true,
    });
    expect(request).toHaveBeenCalledWith({
      method: 'DELETE',
      path: '/internal/stock-reservations/o1',
      retry: true,
    });
  });

  it('stats: GET /internal/stats/products', async () => {
    request.mockResolvedValue({ total_products: 10, active_products: 8 });

    await expect(client.stats()).resolves.toEqual({
      total_products: 10,
      active_products: 8,
    });
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/internal/stats/products',
    });
  });

  // Saga truyền ngân sách (NT.CHECKOUT_SAGA Component_Class_Design §4) xuống ResilientHttpClient
  describe('deadline', () => {
    it('getProducts, reserve chuyển deadline xuống request', async () => {
      request.mockResolvedValue({ items: [] });
      await client.getProducts(['p1'], { deadline: 123 });
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({ deadline: 123 }),
      );
      request.mockResolvedValue({ order_id: 'o1', status: 'reserved' });
      await client.reserve('o1', [{ product_id: 'p1', quantity: 1 }], {
        deadline: 456,
      });
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({ deadline: 456 }),
      );
    });
  });

  it('release chuyển deadline xuống request (hoàn tác trong request, NT.CHECKOUT_SAGA v1.6)', async () => {
    request.mockResolvedValue({ status: 'released', restored: true });
    await client.release('o1', { deadline: 77 });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ deadline: 77 }),
    );
  });
});
