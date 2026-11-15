import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { CurrentUser, GatewayUserGuard } from '@nextech/service-kit';
import type { GatewayUser } from '@nextech/service-kit';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  VerifyOtpDto,
  SendOtpDto,
  ForgotPasswordDto,
  VerifyResetOtpDto,
  ResetPasswordDto,
  OAuthExchangeDto,
} from './auth.dto';
import {
  GoogleAuthGuard,
  FacebookAuthGuard,
  JwtRefreshGuard,
} from './auth.guard';
import { clearAuthCookies, setAuthCookies } from './auth.cookies';

// Chép từ be/src/users/auth/auth.controller.ts. Đổi: `/auth/me` dùng GatewayUserGuard thay JwtAccessGuard
// (gateway đã xác thực và refresh hộ); `CurrentUser` từ service-kit (NT.IDENTITY Component_Class_Design §2).
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    setAuthCookies(res, this.config, accessToken, refreshToken);
  }

  @Post('send-otp')
  @HttpCode(200)
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @Post('verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('verify-reset-otp')
  @HttpCode(200)
  verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.authService.verifyResetOtp(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateLocalUser(dto);
    const { accessToken, refreshToken } =
      await this.authService.issueTokens(user);
    this.setAuthCookies(res, accessToken, refreshToken);
    return {
      message: 'Đăng nhập thành công',
      user: { id: user.id, email: user.email, full_name: user.full_name },
    };
  }

  // Lấy thông tin user hiện tại. Gateway đã xác thực access token (refresh hộ nếu hết hạn)
  // và gắn X-User-*. Trả 401 nếu phiên không hợp lệ.
  @UseGuards(GatewayUserGuard)
  @Get('me')
  me(@CurrentUser() user: GatewayUser) {
    return this.authService.getMe(user.sub);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Route không gắn guard nên req.user luôn rỗng — phải đọc refresh_token để
    // biết thu hồi phiên của ai (trước đây refresh token không bao giờ bị xoá).
    await this.authService.logoutByRefreshToken(
      (req.cookies as Record<string, string> | undefined)?.refresh_token,
    );
    clearAuthCookies(res, this.config);
    return { message: 'Đã đăng xuất' };
  }

  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @CurrentUser() user: { sub: string; refreshToken: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.refreshTokens(
      user.sub,
      user.refreshToken,
    );
    this.setAuthCookies(res, accessToken, refreshToken);
    return { message: 'Đã làm mới token' };
  }

  // Kết thúc OAuth (chung cho Google/Facebook). Hai luồng:
  // - Web: đặt cookie rồi redirect về frontendUrl như cũ.
  // - Mobile (state=mobile, do guard chuyển từ ?platform=mobile): cookie không đi
  //   qua được chuỗi redirect của trình duyệt về app, nên phát mã một lần rồi đưa
  //   về deep link nextech://oauth?code=... — app đổi mã qua POST /auth/oauth/exchange.
  private async finishOAuth(req: Request, res: Response) {
    const profile = req.user as Parameters<AuthService['validateOAuthUser']>[0];
    const user = await this.authService.validateOAuthUser(profile);

    if (req.query.state === 'mobile') {
      const code = await this.authService.createOAuthCode(user.id);
      return res.redirect(`nextech://oauth?code=${code}`);
    }

    const { accessToken, refreshToken } =
      await this.authService.issueTokens(user);
    this.setAuthCookies(res, accessToken, refreshToken);
    return res.redirect(this.config.get<string>('frontendUrl') as string);
  }

  // Google
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  googleAuth() {}

  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  googleCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req, res);
  }

  // Facebook
  @UseGuards(FacebookAuthGuard)
  @Get('facebook')
  facebookAuth() {}

  @UseGuards(FacebookAuthGuard)
  @Get('facebook/callback')
  facebookCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req, res);
  }

  // App mobile đổi mã một lần (nhận từ deep link) lấy cookie phiên — cùng dạng
  // trả về với POST /auth/login.
  @Post('oauth/exchange')
  @HttpCode(200)
  async oauthExchange(
    @Body() dto: OAuthExchangeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.exchangeOAuthCode(dto.code);
    const { accessToken, refreshToken } =
      await this.authService.issueTokens(user);
    this.setAuthCookies(res, accessToken, refreshToken);
    return {
      message: 'Đăng nhập thành công',
      user: { id: user.id, email: user.email, full_name: user.full_name },
    };
  }
}
