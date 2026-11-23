import type { ResilientHttpClient } from '@nextech/service-kit';

/** Item của `GET /internal/products/search`, cùng shape `GET /api/products` (NT.CATALOG API_Spec §2) */
export interface ProductItem {
  id: string;
  name: string;
  brand: string | null;
  price: string;
  rating: string | null;
  primary_image: string | null;
  category_name: string | null;
  tags: unknown[];
  [key: string]: unknown;
}

/** `GET /internal/products/facets` */
export interface Facets {
  brands: string[];
  categories: { id: string; name: string }[];
}

export interface SearchParams {
  search?: string;
  categoryId?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
}

// Client tới catalog-service (NT.ASSISTANT_CHAT API_Spec §5): timeout 2 giây, retry vì chỉ đọc.
// Thay ProductService gọi trong cùng tiến trình ở source cũ. Lỗi truyền nguyên, ChatService phân loại.
export class CatalogClient {
  constructor(private readonly http: Pick<ResilientHttpClient, 'request'>) {}

  facets(): Promise<Facets> {
    return this.http.request({
      method: 'GET',
      path: '/internal/products/facets',
    });
  }

  async search(
    params: SearchParams,
    opts: { deadline?: number } = {},
  ): Promise<ProductItem[]> {
    const res = await this.http.request<{ items: ProductItem[] }>({
      method: 'GET',
      path: '/internal/products/search',
      query: { ...params, limit: 6 },
      deadline: opts.deadline,
    });
    return res.items ?? [];
  }
}
