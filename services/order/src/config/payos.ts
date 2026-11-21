// Chép từ be/src/config/payos.ts. Đổi (NT.PAYMENT Component_Class_Design §2): bắt buộc timeout PAYOS_TIMEOUT_MS
// và maxRetries 0 — SDK @payos/node 2.0.5 mặc định chờ 60 giây và tự thử lại (typings: maxRetries=3), phá ngân
// sách thời gian và có thể tạo link trùng. Không truyền baseURL: SDK đọc PAYOS_BASE_URL (compose mặc định
// payos-mock, NT.PAYMENT API_Spec §5 v2.7). Khoá lấy từ payosConfig (có mặc định dev).
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayOS } from '@payos/node';
import type { PayosConfig } from './configuration';

export const PAYOS_CLIENT = 'PAYOS_CLIENT';

export const PayosProvider: Provider = {
  provide: PAYOS_CLIENT,
  useFactory: (config: ConfigService) => {
    const c = config.getOrThrow<PayosConfig>('payos');
    return new PayOS({
      clientId: c.clientId,
      apiKey: c.apiKey,
      checksumKey: c.checksumKey,
      timeout: c.timeoutMs,
      maxRetries: 0,
    });
  },
  inject: [ConfigService],
};
