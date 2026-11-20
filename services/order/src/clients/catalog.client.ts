import type { ResilientHttpClient } from '@nextech/service-kit';

/** Một sản phẩm từ `POST /internal/products/batch` (NT.CATALOG API_Spec §2). `price` đã là số. */
export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
  is_active: boolean;
  image: string | null;
}

export interface ReserveItem {
  product_id: string;
  quantity: number;
}

export interface ReleaseResult {
  status: 'released';
  restored: boolean;
}

// Giới hạn id mỗi lần gọi batch (NT.CATALOG API_Spec §2)
const BATCH_LIMIT = 100;

// Client tới catalog-service (NT.ORDER Component_Class_Design §5). Thay cho productRepo, imageRepo
// của be/. Lỗi (UpstreamError, UpstreamBusinessError) truyền nguyên: bên gọi quyết định degraded,
// 503, hay hoàn tác saga.
export class CatalogClient {
  constructor(private readonly http: Pick<ResilientHttpClient, 'request'>) {}

  /** Sản phẩm không tồn tại thì không có trong kết quả. Chỉ đọc nên retry dù là POST. */
  async getProducts(ids: string[]): Promise<CatalogProduct[]> {
    const unique = [...new Set(ids)];
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += BATCH_LIMIT) {
      batches.push(unique.slice(i, i + BATCH_LIMIT));
    }
    const results = await Promise.all(
      batches.map((batch) =>
        this.http.request<{ items: CatalogProduct[] }>({
          method: 'POST',
          path: '/internal/products/batch',
          body: { ids: batch },
          retry: true,
        }),
      ),
    );
    return results.flatMap((r) => r?.items ?? []);
  }

  /** Giữ kho cho một đơn, idempotent theo `order_id` nên được retry. */
  reserve(
    orderId: string,
    items: ReserveItem[],
  ): Promise<{ order_id: string; status: 'reserved' }> {
    return this.http.request({
      method: 'POST',
      path: '/internal/stock-reservations',
      body: { order_id: orderId, items },
      retry: true,
    });
  }

  /** Nhả kho, idempotent, luôn 200 (tạo tombstone nếu chưa giữ). */
  release(orderId: string): Promise<ReleaseResult> {
    return this.http.request({
      method: 'DELETE',
      path: `/internal/stock-reservations/${encodeURIComponent(orderId)}`,
      retry: true,
    });
  }

  stats(): Promise<{ total_products: number; active_products: number }> {
    return this.http.request({
      method: 'GET',
      path: '/internal/stats/products',
    });
  }
}
