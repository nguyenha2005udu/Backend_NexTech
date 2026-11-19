import { Logger } from '@nestjs/common';
import type { ResilientHttpClient } from '@nextech/service-kit';

export interface UserSnapshot {
  full_name: string | null;
  avatar_url: string | null;
}

// Lấy tên, ảnh người viết đánh giá để lưu snapshot — NT.IDENTITY API_Spec §2 `GET /internal/users/:id`.
// be/ JOIN users khi đọc; nay lưu kèm đánh giá lúc tạo (architecture §9: snapshot).
export class IdentityClient {
  private readonly logger = new Logger(IdentityClient.name);

  constructor(private readonly http: Pick<ResilientHttpClient, 'request'>) {}

  /**
   * Snapshot không bắt buộc (NT.CATALOG API_Spec §3, v1.6): mọi lỗi, kể cả 404 NT-IDN-1003, trả null
   * để vẫn tạo đánh giá. Không retry: giữ tổng thời gian tạo đánh giá dưới timeout của gateway.
   */
  async getUserSnapshot(id: string): Promise<UserSnapshot | null> {
    try {
      const user = await this.http.request<Partial<UserSnapshot>>({
        method: 'GET',
        path: `/internal/users/${encodeURIComponent(id)}`,
        retry: false,
      });
      return {
        full_name: user?.full_name ?? null,
        avatar_url: user?.avatar_url ?? null,
      };
    } catch (err) {
      // Chỉ ghi id và lý do, không ghi dữ liệu người dùng (security-policy §5)
      this.logger.warn(
        `Không lấy được snapshot người dùng ${id} từ identity: ${(err as Error)?.message ?? err}`,
      );
      return null;
    }
  }
}
