import { ConfigService } from '@nestjs/config';
import { BusinessException } from '@nextech/service-kit';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const createTransport = nodemailer.createTransport as unknown as jest.Mock;

function config(mail: Record<string, unknown>): ConfigService {
  return new ConfigService({
    mail: { host: 'mailpit', port: 1025, user: 'u@x', pass: 'p', ...mail },
  });
}

describe('MailService', () => {
  let sendMail: jest.Mock;

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue({});
    createTransport.mockReset().mockReturnValue({ sendMail });
  });

  it('transporter có timeout 5 giây và requireTLS theo cấu hình', () => {
    new MailService(config({ requireTLS: false }));
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'mailpit',
        port: 1025,
        secure: false,
        requireTLS: false,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
      }),
    );
  });

  it('requireTLS true khi cấu hình bật (như be/)', () => {
    new MailService(config({ requireTLS: true }));
    expect((createTransport.mock.calls as unknown[][])[0][0]).toMatchObject({
      requireTLS: true,
    });
  });

  it('gửi OTP: đúng người nhận, nội dung có mã', async () => {
    const mail = new MailService(config({}));
    await mail.sendOtp('a@b.c', '123456');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@b.c',
        subject: 'Mã xác thực tài khoản',
        html: expect.stringContaining('123456') as string,
      }),
    );
  });

  it('SMTP lỗi → 503 NT-IDN-1012', async () => {
    sendMail.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ESOCKET' }),
    );
    const mail = new MailService(config({}));
    const err = (await mail
      .sendOtp('a@b.c', '123456')
      .catch((e: unknown) => e)) as BusinessException | undefined;
    expect(err).toBeInstanceOf(BusinessException);
    expect(err?.getStatus()).toBe(503);
    expect(err?.code).toBe('NT-IDN-1012');
    expect(err?.getResponse()).toMatchObject({
      message: 'Không gửi được email, vui lòng thử lại',
    });
  });
});
