import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  HttpStatus,
} from '@nestjs/common';
import { randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '@nextech/service-kit';
import * as bcrypt from 'bcrypt';
import { User } from '../../database/entities/user.entity';
import { RedisService } from '../../redis/redis.module';
import { MailService } from '../../mail/mail.service';
import { IDN_ERROR } from '../../errors';
import { tokenTtls } from './auth.cookies';
import {
  RegisterDto,
  LoginDto,
  VerifyOtpDto,
  SendOtpDto,
  ForgotPasswordDto,
  VerifyResetOtpDto,
  ResetPasswordDto,
} from './auth.dto';

// Chép từ be/src/users/auth/auth.service.ts. Đổi so với be/ (NT.IDENTITY v1.4):
// - Exception có trong catalog API_Spec §3 → BusinessException kèm mã NT-IDN-*, giữ nguyên câu chữ.
//   Exception không có mã trong catalog giữ nguyên (filter gắn NT-GEN-* theo status).
// - exchangeOAuthCode đọc và xoá mã bằng một lệnh GETDEL (quyết định B8).
// - Thêm verifyAndRefresh cho POST /internal/auth/refresh (Component_Class_Design §5).

const OTP_TTL_SECONDS = 300; // OTP có hiệu lực 5 phút
const OTP_MAX_ATTEMPTS = 5; // Sai quá số lần này thì huỷ OTP
const OTP_RESEND_SECONDS = 60; // Khoảng cách tối thiểu giữa 2 lần gửi OTP

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
    private config: ConfigService,
    private redis: RedisService,
    private mail: MailService,
  ) {}

  // ---------- OTP ----------
  // Math.random() không an toàn về mật mã -> dùng CSPRNG
  private generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  // Chống spam gửi mail: mỗi email chỉ được yêu cầu OTP 1 lần / OTP_RESEND_SECONDS
  private async assertCanSendOtp(otpKey: string) {
    const ok = await this.redis.client.set(
      `${otpKey}:cooldown`,
      '1',
      'EX',
      OTP_RESEND_SECONDS,
      'NX',
    );
    if (!ok) {
      throw new BusinessException(
        HttpStatus.TOO_MANY_REQUESTS,
        IDN_ERROR.OTP_TOO_SOON,
        `Vui lòng đợi ${OTP_RESEND_SECONDS} giây trước khi yêu cầu mã mới`,
      );
    }
  }

  private async saveOtp(otpKey: string, otp: string) {
    await this.redis.set(otpKey, otp, OTP_TTL_SECONDS);
    await this.redis.del(`${otpKey}:attempts`);
  }

  private otpInvalid(message = 'OTP không đúng hoặc đã hết hạn') {
    return new BusinessException(
      HttpStatus.BAD_REQUEST,
      IDN_ERROR.OTP_INVALID,
      message,
    );
  }

  // OTP 6 số chỉ có 900k khả năng -> phải giới hạn số lần nhập sai, nếu không
  // có thể brute-force trong 5 phút. Sai quá OTP_MAX_ATTEMPTS lần thì huỷ OTP.
  private async consumeOtp(otpKey: string, otp: string) {
    const savedOtp = await this.redis.get(otpKey);
    if (!savedOtp) throw this.otpInvalid();

    const saved = Buffer.from(savedOtp);
    const input = Buffer.from(otp);
    if (saved.length !== input.length || !timingSafeEqual(saved, input)) {
      const attemptsKey = `${otpKey}:attempts`;
      const attempts = await this.redis.client.incr(attemptsKey);
      if (attempts === 1)
        await this.redis.client.expire(attemptsKey, OTP_TTL_SECONDS);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.redis.client.del(otpKey, attemptsKey);
        throw this.otpInvalid(
          'Nhập sai quá nhiều lần, vui lòng yêu cầu mã OTP mới',
        );
      }
      throw this.otpInvalid();
    }

    await this.redis.client.del(otpKey, `${otpKey}:attempts`);
  }

  private assertActive(user: User) {
    if (!user.is_active) throw this.accountLocked();
  }

  private accountLocked() {
    return new BusinessException(
      HttpStatus.FORBIDDEN,
      IDN_ERROR.ACCOUNT_LOCKED,
      'Tài khoản đã bị khoá',
    );
  }

  private refreshInvalid() {
    return new BusinessException(
      HttpStatus.UNAUTHORIZED,
      IDN_ERROR.REFRESH_INVALID,
      'Refresh token không hợp lệ',
    );
  }

  private otpKey(email: string) {
    return `otp:${email}`;
  }

  private verifiedKey(email: string) {
    return `email_verified:${email}`;
  }

  // ---------- Reset password (namespace riêng, tránh đụng OTP đăng ký) ----------
  private resetOtpKey(email: string) {
    return `reset_otp:${email}`;
  }

  private resetVerifiedKey(email: string) {
    return `reset_verified:${email}`;
  }

  async sendOtp(dto: SendOtpDto) {
    const existed = await this.userRepo.findOne({
      where: { email: dto.email },
    });
    if (existed)
      throw new BusinessException(
        HttpStatus.CONFLICT,
        IDN_ERROR.EMAIL_IN_USE,
        'Email đã được đăng ký',
      );

    await this.assertCanSendOtp(this.otpKey(dto.email));
    const otp = this.generateOtp();
    await this.saveOtp(this.otpKey(dto.email), otp);
    await this.mail.sendOtp(dto.email, otp);
    return { message: 'Đã gửi OTP, vui lòng kiểm tra email' };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    await this.consumeOtp(this.otpKey(dto.email), dto.otp);
    // Đánh dấu email đã verify, cho phép đăng ký trong 10 phút tới
    await this.redis.set(this.verifiedKey(dto.email), '1', 600);
    return { message: 'Xác thực email thành công, vui lòng đặt mật khẩu' };
  }

  // ---------- Đăng ký (chỉ cho phép sau khi email đã verify) ----------
  async register(dto: RegisterDto) {
    const isVerified = await this.redis.get(this.verifiedKey(dto.email));
    if (!isVerified) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        IDN_ERROR.OTP_NOT_VERIFIED,
        'Email chưa xác thực OTP hoặc đã hết hạn, vui lòng xác thực lại',
      );
    }

    const existed = await this.userRepo.findOne({
      where: { email: dto.email },
    });
    if (existed)
      throw new BusinessException(
        HttpStatus.CONFLICT,
        IDN_ERROR.EMAIL_IN_USE,
        'Email đã được sử dụng',
      );

    const password_hash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email,
      password_hash,
      full_name: dto.full_name,
      auth_provider: 'local',
      is_verified: true, // đã verify OTP ở bước trước
    });
    await this.userRepo.save(user);
    await this.redis.del(this.verifiedKey(dto.email));

    return { message: 'Đăng ký thành công, có thể đăng nhập ngay' };
  }

  // Trả thông tin user hiện tại cho FE (thay cho việc FE tự đọc cookie httpOnly).
  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Phiên không hợp lệ');
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      avatar_url: user.avatar_url,
    };
  }

  async validateLocalUser(dto: LoginDto) {
    const wrong = () =>
      new BusinessException(
        HttpStatus.UNAUTHORIZED,
        IDN_ERROR.WRONG_CREDENTIALS,
        'Sai email hoặc mật khẩu',
      );
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !user.password_hash) throw wrong();

    const match = await bcrypt.compare(dto.password, user.password_hash);
    if (!match) throw wrong();
    this.assertActive(user);

    return user;
  }

  // ---------- Quên mật khẩu ----------
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    // Không tiết lộ email có tồn tại hay không để tránh lộ thông tin tài khoản
    if (!user) {
      return { message: 'Nếu email tồn tại, mã OTP đã được gửi' };
    }
    if (user.auth_provider !== 'local') {
      // Tài khoản đăng nhập bằng Google/Facebook thì không có mật khẩu để reset
      return { message: 'Nếu email tồn tại, mã OTP đã được gửi' };
    }

    await this.assertCanSendOtp(this.resetOtpKey(dto.email));
    const otp = this.generateOtp();
    await this.saveOtp(this.resetOtpKey(dto.email), otp);
    await this.mail.sendOtp(dto.email, otp);
    return { message: 'Nếu email tồn tại, mã OTP đã được gửi' };
  }

  async verifyResetOtp(dto: VerifyResetOtpDto) {
    await this.consumeOtp(this.resetOtpKey(dto.email), dto.otp);
    // Cho phép đặt mật khẩu mới trong 10 phút tới
    await this.redis.set(this.resetVerifiedKey(dto.email), '1', 600);
    return { message: 'Xác thực OTP thành công, vui lòng đặt mật khẩu mới' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const isVerified = await this.redis.get(this.resetVerifiedKey(dto.email));
    if (!isVerified) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        IDN_ERROR.OTP_NOT_VERIFIED,
        'Bạn chưa xác thực OTP hoặc đã hết hạn, vui lòng thực hiện lại',
      );
    }

    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new BadRequestException('Tài khoản không tồn tại');

    user.password_hash = await bcrypt.hash(dto.new_password, 10);
    await this.userRepo.save(user);
    await this.redis.del(this.resetVerifiedKey(dto.email));

    // Đăng xuất khỏi mọi thiết bị: huỷ refresh token hiện tại
    await this.redis.del(`refresh:${user.id}`);

    return { message: 'Đặt lại mật khẩu thành công, vui lòng đăng nhập lại' };
  }

  // ---------- OAuth ----------
  async validateOAuthUser(profile: {
    provider: 'google' | 'facebook';
    provider_id: string;
    email: string;
    full_name: string;
    avatar_url?: string;
  }) {
    // QUAN TRỌNG: Facebook cho phép tài khoản không có email (đăng ký bằng SĐT, hoặc
    // user bỏ quyền email). Khi đó profile.email = undefined và TypeORM BỎ QUA điều
    // kiện `where: { email: undefined }` -> trả về user ĐẦU TIÊN trong bảng
    // => đăng nhập vào tài khoản người khác. Bắt buộc phải có email.
    if (!profile.email) {
      throw new BusinessException(
        HttpStatus.UNAUTHORIZED,
        IDN_ERROR.OAUTH_NO_EMAIL,
        'Không lấy được email từ tài khoản mạng xã hội, vui lòng cấp quyền email hoặc đăng ký bằng email',
      );
    }
    const email = profile.email.trim().toLowerCase();

    let user = await this.userRepo.findOne({ where: { email } });

    if (user) {
      this.assertActive(user);
    } else {
      user = this.userRepo.create({
        email,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url || null,
        auth_provider: profile.provider,
        provider_id: profile.provider_id,
        is_verified: true,
      });
      await this.userRepo.save(user);
    }

    return user;
  }

  // Mã một lần cho OAuth trên mobile: cookie không đi qua được chuỗi redirect của
  // trình duyệt về app, nên callback phát mã ngắn hạn, app đổi mã lấy cookie qua
  // POST /auth/oauth/exchange.
  async createOAuthCode(userId: string) {
    const code = randomBytes(32).toString('hex');
    await this.redis.set(`oauth_code:${code}`, userId, 60); // TTL 60 giây, dùng 1 lần
    return code;
  }

  async exchangeOAuthCode(code: string) {
    // GETDEL: đọc và xoá trong một lệnh, gọi đồng thời thì chỉ một lần lấy được mã (be/ dùng GET rồi DEL)
    const userId = await this.redis.client.getdel(`oauth_code:${code}`);
    if (!userId)
      throw new BusinessException(
        HttpStatus.UNAUTHORIZED,
        IDN_ERROR.OAUTH_CODE_INVALID,
        'Mã đăng nhập không hợp lệ hoặc đã hết hạn',
      );

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Phiên không hợp lệ');
    this.assertActive(user);
    return user;
  }

  // ---------- Token ----------
  async issueTokens(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email as string,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.accessSecret') as string,
      expiresIn: this.config.get<string>('jwt.accessExpiresIn') as never,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwt.refreshSecret') as string,
      expiresIn: this.config.get<string>('jwt.refreshExpiresIn') as never,
    });

    // Cùng TTL với cookie refresh_token (trước đây fallback 1 giờ, cookie lại 7 ngày)
    const { refreshTtl } = tokenTtls(this.config);
    await this.redis.set(`refresh:${user.id}`, refreshToken, refreshTtl);

    return { accessToken, refreshToken };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const saved = await this.redis.get(`refresh:${userId}`);
    if (!saved || saved !== refreshToken) {
      throw this.refreshInvalid();
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!user.is_active) {
      await this.logout(userId);
      throw this.accountLocked();
    }
    const tokens = await this.issueTokens(user);
    return { ...tokens, user };
  }

  // Gateway refresh hộ client (POST /internal/auth/refresh, NT.GATEWAY Processing_Flow §2).
  // Không idempotent: token cũ hết hiệu lực ngay khi token mới được ghi vào Redis.
  async verifyAndRefresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify<{ sub: string }>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret') as string,
      });
    } catch {
      throw this.refreshInvalid();
    }
    const {
      accessToken,
      refreshToken: newRefresh,
      user,
    } = await this.refreshTokens(payload.sub, refreshToken);
    const { accessTtl, refreshTtl } = tokenTtls(this.config);
    return {
      access_token: accessToken,
      refresh_token: newRefresh,
      access_ttl_s: accessTtl,
      refresh_ttl_s: refreshTtl,
      user: { sub: user.id, email: user.email as string, role: user.role },
    };
  }

  // Thu hồi phiên: xoá refresh token trong Redis. Dùng khi logout, và khi admin
  // khoá tài khoản / đổi role / xoá (role nằm trong JWT nên phải buộc cấp token mới).
  async logout(userId: string) {
    await this.redis.del(`refresh:${userId}`);
  }

  // Logout không gắn guard (access_token hết hạn vẫn phải logout được) nên không
  // có req.user — tự xác thực refresh_token để biết phải thu hồi phiên của ai.
  async logoutByRefreshToken(refreshToken: string | undefined) {
    if (!refreshToken) return;
    try {
      const payload = this.jwtService.verify<{ sub: string }>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret') as string,
      });
      // Chỉ xoá nếu đúng là token đang lưu, tránh token cũ đá phiên mới
      const saved = await this.redis.get(`refresh:${payload.sub}`);
      if (saved === refreshToken) await this.logout(payload.sub);
    } catch {
      // Token sai / hết hạn -> không còn phiên nào để thu hồi
    }
  }
}
