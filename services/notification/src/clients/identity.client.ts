import type { ResilientHttpClient } from '@nextech/service-kit';

/** `GET /internal/users/:id` (NT.IDENTITY API_Spec §2) — chỉ các trường notification dùng */
export interface IdentityUser {
  id: string;
  email: string;
  full_name: string | null;
}

// Client tới identity-service: lấy email người nhận theo dõi giá kênh email (NT.NOTIFICATION API_Spec §3).
// GET có retry; 404 là UpstreamBusinessError, không retry — bên gọi coi như không còn người nhận.
export class IdentityClient {
  constructor(private readonly http: Pick<ResilientHttpClient, 'request'>) {}

  getUser(id: string): Promise<IdentityUser> {
    return this.http.request({
      method: 'GET',
      path: `/internal/users/${encodeURIComponent(id)}`,
    });
  }
}
