import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BusinessException } from '@nextech/service-kit';
import * as bcrypt from 'bcrypt';
import type { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import type { MailService } from '../../mail/mail.service';
import type { RedisService } from '../../redis/redis.module';
import { AuthService } from './auth.service';

// Test bắt buộc NT.IDENTITY Component_Class_Design §7 (phần auth). Hành vi giữ nguyên be/src/users/auth/auth.service.ts,
// chỉ thêm mã NT-IDN-* và verifyAndRefresh.

/**
 * Redis giả trong bộ nhớ. Mỗi lệnh nhường một nhịp (await) trước khi chạy, như một lần gọi mạng —
 * nhờ vậy code "GET rồi DEL" bị lộ khi gọi đồng thời, còn GETDEL (một lệnh) thì không.
 */
class FakeRedis {
  store = new Map<string, string>();
  private tick = () => new Promise<void>((r) => setImmediate(r));

  client = {
    set: async (k: string, v: string, ...args: (string | number)[]) => {
      await this.tick();
      if (args.includes('NX') && this.store.has(k)) return null;
      this.store.set(k, v);
      return 'OK';
    },
    get: async (k: string) => {
      await this.tick();
      return this.store.get(k) ?? null;
    },
    getdel: async (k: string) => {
      await this.tick();
      const v = this.store.get(k) ?? null;
      this.store.delete(k);
      return v;
    },
    del: async (...keys: string[]) => {
      await this.tick();
      keys.forEach((k) => this.store.delete(k));
      return keys.length;
    },
    incr: async (k: string) => {
      await this.tick();
      const n = Number(this.store.get(k) ?? 0) + 1;
      this.store.set(k, String(n));
      return n;
    },
    expire: async () => {
      await this.tick();
      return 1;
    },
  };

  set = async (k: string, v: string) => {
    await this.client.set(k, v);
  };
  get = (k: string) => this.client.get(k);
  del = async (k: string) => {
    await this.client.del(k);
  };
}

const config = new ConfigService({
  jwt: {
    accessSecret: 'test-access',
    accessExpiresIn: '15m',
    refreshSecret: 'test-refresh',
    refreshExpiresIn: '7d',
  },
});

function user(over: Partial<User> = {}): User {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    email: 'buyer@nextech.local',
    full_name: 'Người mua',
    password_hash: null,
    phone_number: null,
    avatar_url: null,
    auth_provider: 'local',
    role: 'user',
    is_active: true,
    is_verified: true,
    provider_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  } as User;
}

async function errorOf(p: Promise<unknown>): Promise<BusinessException> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(BusinessException);
  return e as BusinessException;
}

function expectError(
  e: BusinessException,
  status: number,
  code: string,
  message?: string,
) {
  expect(e.getStatus()).toBe(status);
  expect(e.code).toBe(code);
  if (message) expect(e.getResponse()).toMatchObject({ message });
}

describe('AuthService', () => {
  let redis: FakeRedis;
  let repo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let mail: { sendOtp: jest.Mock };
  let jwt: JwtService;
  let service: AuthService;

  beforeEach(() => {
    redis = new FakeRedis();
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: Partial<User>) => x),
      save: jest.fn((x: Partial<User>) => Promise.resolve(x)),
    };
    mail = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    jwt = new JwtService({});
    service = new AuthService(
      repo as unknown as Repository<User>,
      jwt,
      config,
      redis as unknown as RedisService,
      mail as unknown as MailService,
    );
  });

  afterEach(() => jest.useRealTimers());

  const sentOtp = () =>
    (mail.sendOtp.mock.calls as unknown[][]).at(-1)?.[1] as string;

  describe('OTP', () => {
    it('gửi OTP: email đã đăng ký → 409 NT-IDN-1006 (câu của be/)', async () => {
      repo.findOne.mockResolvedValue(user());
      expectError(
        await errorOf(service.sendOtp({ email: 'buyer@nextech.local' })),
        409,
        'NT-IDN-1006',
        'Email đã được đăng ký',
      );
    });

    it('gửi lại trong 60 giây → 429 NT-IDN-1008', async () => {
      await service.sendOtp({ email: 'a@b.c' });
      expectError(
        await errorOf(service.sendOtp({ email: 'a@b.c' })),
        429,
        'NT-IDN-1008',
        'Vui lòng đợi 60 giây trước khi yêu cầu mã mới',
      );
      expect(mail.sendOtp).toHaveBeenCalledTimes(1);
    });

    it('sai 5 lần → huỷ OTP, mã đúng cũng không dùng được nữa', async () => {
      await service.sendOtp({ email: 'a@b.c' });
      const otp = sentOtp();
      const wrong = otp === '000000' ? '111111' : '000000';

      for (let i = 0; i < 4; i++) {
        expectError(
          await errorOf(service.verifyOtp({ email: 'a@b.c', otp: wrong })),
          400,
          'NT-IDN-1007',
          'OTP không đúng hoặc đã hết hạn',
        );
      }
      expectError(
        await errorOf(service.verifyOtp({ email: 'a@b.c', otp: wrong })),
        400,
        'NT-IDN-1007',
        'Nhập sai quá nhiều lần, vui lòng yêu cầu mã OTP mới',
      );
      expectError(
        await errorOf(service.verifyOtp({ email: 'a@b.c', otp })),
        400,
        'NT-IDN-1007',
        'OTP không đúng hoặc đã hết hạn',
      );
    });

    it('OTP đúng → cho phép đăng ký trong 10 phút', async () => {
      await service.sendOtp({ email: 'a@b.c' });
      await expect(
        service.verifyOtp({ email: 'a@b.c', otp: sentOtp() }),
      ).resolves.toEqual({
        message: 'Xác thực email thành công, vui lòng đặt mật khẩu',
      });
      expect(redis.store.get('email_verified:a@b.c')).toBe('1');
    });

    it('SMTP lỗi → lỗi 503 của MailService đi thẳng ra (không thành 500)', async () => {
      mail.sendOtp.mockRejectedValue(
        new BusinessException(
          503,
          'NT-IDN-1012',
          'Không gửi được email, vui lòng thử lại',
        ),
      );
      expectError(
        await errorOf(service.sendOtp({ email: 'a@b.c' })),
        503,
        'NT-IDN-1012',
      );
    });
  });

  describe('register', () => {
    it('chưa xác thực OTP → 400 NT-IDN-1009', async () => {
      expectError(
        await errorOf(
          service.register({
            email: 'a@b.c',
            password: 'Abcdef12',
            full_name: 'A',
          }),
        ),
        400,
        'NT-IDN-1009',
        'Email chưa xác thực OTP hoặc đã hết hạn, vui lòng xác thực lại',
      );
    });

    it('email đã có → 409 NT-IDN-1006', async () => {
      redis.store.set('email_verified:a@b.c', '1');
      repo.findOne.mockResolvedValue(user({ email: 'a@b.c' }));
      expectError(
        await errorOf(
          service.register({
            email: 'a@b.c',
            password: 'Abcdef12',
            full_name: 'A',
          }),
        ),
        409,
        'NT-IDN-1006',
        'Email đã được sử dụng',
      );
    });

    it('thành công → lưu bcrypt hash, xoá cờ xác thực', async () => {
      redis.store.set('email_verified:a@b.c', '1');
      await expect(
        service.register({
          email: 'a@b.c',
          password: 'Abcdef12',
          full_name: 'A',
        }),
      ).resolves.toEqual({
        message: 'Đăng ký thành công, có thể đăng nhập ngay',
      });
      const saved = (repo.save.mock.calls as unknown[][])[0][0] as User;
      expect(await bcrypt.compare('Abcdef12', saved.password_hash!)).toBe(true);
      expect(redis.store.has('email_verified:a@b.c')).toBe(false);
    });
  });

  describe('validateLocalUser', () => {
    it('sai mật khẩu → 401 NT-IDN-1005', async () => {
      repo.findOne.mockResolvedValue(
        user({ password_hash: await bcrypt.hash('Buyer@123', 4) }),
      );
      expectError(
        await errorOf(
          service.validateLocalUser({
            email: 'buyer@nextech.local',
            password: 'x',
          }),
        ),
        401,
        'NT-IDN-1005',
        'Sai email hoặc mật khẩu',
      );
    });

    it('tài khoản khoá → 403 NT-IDN-1002', async () => {
      repo.findOne.mockResolvedValue(
        user({
          is_active: false,
          password_hash: await bcrypt.hash('Buyer@123', 4),
        }),
      );
      expectError(
        await errorOf(
          service.validateLocalUser({
            email: 'buyer@nextech.local',
            password: 'Buyer@123',
          }),
        ),
        403,
        'NT-IDN-1002',
        'Tài khoản đã bị khoá',
      );
    });
  });

  describe('verifyAndRefresh (/internal/auth/refresh)', () => {
    it('token đúng → token mới + TTL + user; token cũ không dùng lại được', async () => {
      jest.useFakeTimers({
        now: new Date('2026-11-14T10:00:00Z'),
        doNotFake: ['setImmediate'],
      });
      const u = user();
      repo.findOne.mockResolvedValue(u);
      const first = await service.issueTokens(u);

      // JWT tính iat theo giây: lùi 1 giây để token mới khác token cũ
      jest.setSystemTime(new Date('2026-11-14T10:00:01Z'));
      const out = await service.verifyAndRefresh(first.refreshToken);

      expect(out).toEqual({
        access_token: expect.any(String) as string,
        refresh_token: expect.any(String) as string,
        access_ttl_s: 900,
        refresh_ttl_s: 604800,
        user: { sub: u.id, email: u.email, role: 'user' },
      });
      expect(out.refresh_token).not.toBe(first.refreshToken);
      expect(redis.store.get(`refresh:${u.id}`)).toBe(out.refresh_token);

      expectError(
        await errorOf(service.verifyAndRefresh(first.refreshToken)),
        401,
        'NT-IDN-1001',
        'Refresh token không hợp lệ',
      );
    });

    it('sai chữ ký → 401 NT-IDN-1001', async () => {
      const forged = jwt.sign(
        { sub: 'x', email: 'e', role: 'admin' },
        { secret: 'khac' },
      );
      expectError(
        await errorOf(service.verifyAndRefresh(forged)),
        401,
        'NT-IDN-1001',
        'Refresh token không hợp lệ',
      );
    });

    it('tài khoản khoá → 403 NT-IDN-1002, thu hồi phiên', async () => {
      const u = user();
      const { refreshToken } = await service.issueTokens(u);
      repo.findOne.mockResolvedValue(user({ is_active: false }));
      expectError(
        await errorOf(service.verifyAndRefresh(refreshToken)),
        403,
        'NT-IDN-1002',
        'Tài khoản đã bị khoá',
      );
      expect(redis.store.has(`refresh:${u.id}`)).toBe(false);
    });
  });

  describe('oauth/exchange', () => {
    it('gọi hai lần đồng thời cùng mã → một thành công, một 401 NT-IDN-1011', async () => {
      const u = user();
      repo.findOne.mockResolvedValue(u);
      const code = await service.createOAuthCode(u.id);

      const results = await Promise.allSettled([
        service.exchangeOAuthCode(code),
        service.exchangeOAuthCode(code),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expectError(
        rejected!.reason as BusinessException,
        401,
        'NT-IDN-1011',
        'Mã đăng nhập không hợp lệ hoặc đã hết hạn',
      );
    });
  });
});
