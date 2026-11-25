import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { formatVnd } from '../modules/events/message-templates';

// SMTP chết thì lỗi trong khoảng 5 giây, consumer thử lại (NT.MESSAGING Processing_Flow §2)
const SMTP_TIMEOUT_MS = 5000;

// Chép mẫu sendPriceAlertTriggered từ config/mail.ts của source cũ (như identity/src/mail). Đổi: requireTLS đọc từ
// env, thêm timeout, tên người gửi NexTech. Lỗi gửi ném nguyên để consumer rollback và thử lại.
@Injectable()
export class MailService {
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

  async sendPriceAlertTriggered(
    to: string,
    productName: string,
    currentPrice: number,
    targetPrice: number,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: `"NexTech" <${this.config.get('mail.user')}>`,
      to,
      subject: `Giá đã giảm: ${productName}`,
      html: `
        <p>Sản phẩm bạn đang theo dõi đã giảm đến mức giá mong muốn:</p>
        <h3>${escapeHtml(productName)}</h3>
        <p>Giá hiện tại: <strong>${formatVnd(currentPrice)}đ</strong></p>
        <p>Giá mong muốn của bạn: ${formatVnd(targetPrice)}đ</p>
        <p>Nhanh tay đặt hàng trước khi giá thay đổi!</p>
      `,
    });
  }
}

// Tên sản phẩm do admin nhập: không để chèn HTML vào email
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
