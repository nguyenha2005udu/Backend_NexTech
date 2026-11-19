import {
  UpstreamBusinessError,
  UpstreamError,
  type ResilientHttpClient,
} from '@nextech/service-kit';

// Hỏi order "người này đã mua sản phẩm này chưa" (BR-11) — NT.ORDER API_Spec §2 `GET /internal/purchases/check`.
// Thay cho JOIN order_items của be/ (users/product/product.service.ts createReview).
export class OrderClient {
  constructor(private readonly http: Pick<ResilientHttpClient, 'request'>) {}

  /**
   * Lỗi theo NT.CATALOG API_Spec §3 (v1.6): kết nối, mạch, 5xx → 503 và quá giờ → 504 giữ nguyên từ
   * ResilientHttpClient; 4xx của order (bất thường, vd chưa có route tới T3.2) cũng đổi thành 503 —
   * order không có lỗi nghiệp vụ nào cho câu hỏi này, chuyển nguyên 4xx về client là sai nghĩa.
   */
  async hasPurchased(userId: string, productId: string): Promise<boolean> {
    try {
      const res = await this.http.request<{ purchased?: boolean }>({
        method: 'GET',
        path: '/internal/purchases/check',
        query: { user_id: userId, product_id: productId },
      });
      return res?.purchased === true;
    } catch (err) {
      if (err instanceof UpstreamBusinessError) {
        throw new UpstreamError(
          'order',
          `purchases/check trả ${err.getStatus()} ${err.upstreamCode ?? ''}`.trim(),
          'unknown',
        );
      }
      throw err;
    }
  }
}
