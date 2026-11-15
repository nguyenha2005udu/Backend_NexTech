import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '@nextech/service-kit';
import * as nodemailer from 'nodemailer';
import { IDN_ERROR } from '../errors';

// SMTP chết thì trả lỗi trong khoảng 5 giây, không treo request (NT.IDENTITY Component_Class_Design §2)
const SMTP_TIMEOUT_MS = 5000;

// Chép từ be/src/config/mail.ts. Bỏ mẫu mail theo dõi giá (chuyển sang notification-service).
// Đổi: requireTLS đọc từ env, thêm timeout, lỗi gửi → 503 NT-IDN-1012 (trước đây thành 500).
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('mail.host'),
      port: Number(this.config.get('mail.port')),
      secure: false,
      requireTLS: this.config.get<boolean>('mail.requireTLS'),
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
      auth: {
        user: this.config.get('mail.user'),
        pass: this.config.get('mail.pass'),
      },
    });
  }

  async sendOtp(to: string, otp: string) {
    try {
      await this.transporter.sendMail({
        from: `"ShopAI" <${this.config.get('mail.user')}>`,
        to,
        subject: 'Mã xác thực tài khoản',
        html: `
        <p>Mã OTP của bạn là:</p>
        <h2>${otp}</h2>
        <p>Mã có hiệu lực trong 5 phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
      `,
      });
    } catch (err) {
      // Không log OTP, địa chỉ người nhận (security-policy §5)
      const e = err as { code?: string; message?: string };
      this.logger.error(`Gửi mail lỗi: ${e.code ?? ''} ${e.message ?? ''}`);
      throw new BusinessException(
        HttpStatus.SERVICE_UNAVAILABLE,
        IDN_ERROR.MAIL_FAILED,
        'Không gửi được email, vui lòng thử lại',
      );
    }
  }
}
