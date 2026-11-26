import type { ResilientHttpClient } from '@nextech/service-kit';

/** Item của `POST /internal/users/batch` (NT.IDENTITY API_Spec §2) */
export interface IdentityUserSummary {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
}

// Client tới identity-service (NT.ASSISTANT_ADMIN API_Spec §4): tên người dùng cho màn quản trị.
// Chỉ đọc nên retry dù là POST. Lỗi truyền nguyên, bên gọi quyết định degraded.
export class IdentityClient {
  constructor(private readonly http: Pick<ResilientHttpClient, 'request'>) {}

  getUsers(ids: string[]): Promise<{ items: IdentityUserSummary[] }> {
    return this.http.request({
      method: 'POST',
      path: '/internal/users/batch',
      body: { ids },
      retry: true,
    });
  }
}
