import type { ResilientHttpClient } from '@nextech/service-kit';
import type { CallOptions } from './catalog.client';

/** `GET /internal/users/:id` (NT.IDENTITY API_Spec §2) */
export interface IdentityUser {
  id: string;
  email: string;
  full_name: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  is_active: boolean;
}

/** `GET /internal/users/:userId/addresses/:addressId` (NT.IDENTITY API_Spec §2) */
export interface IdentityAddress {
  id: string;
  user_id: string;
  full_address: string;
  recipient_name: string | null;
  phone_number: string | null;
  is_default: boolean;
}

// Client tới identity-service (NT.ORDER Component_Class_Design §5): snapshot người mua, địa chỉ
// khi đặt hàng (T3.3), số người dùng cho thống kê (T3.7). Thay cho JOIN users, addresses của be/.
// Lỗi truyền nguyên; 404 NT-IDN-1004 được saga đổi thành NT-ORD-1002.
export class IdentityClient {
  constructor(private readonly http: Pick<ResilientHttpClient, 'request'>) {}

  getUser(id: string, opts: CallOptions = {}): Promise<IdentityUser> {
    return this.http.request({
      method: 'GET',
      path: `/internal/users/${encodeURIComponent(id)}`,
      deadline: opts.deadline,
    });
  }

  getAddress(
    userId: string,
    addressId: string,
    opts: CallOptions = {},
  ): Promise<IdentityAddress> {
    return this.http.request({
      method: 'GET',
      path: `/internal/users/${encodeURIComponent(userId)}/addresses/${encodeURIComponent(addressId)}`,
      deadline: opts.deadline,
    });
  }

  stats(): Promise<{ total_users: number }> {
    return this.http.request({ method: 'GET', path: '/internal/stats/users' });
  }
}
