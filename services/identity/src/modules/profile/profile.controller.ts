// Chép từ be/src/users/profile/profile.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard (gateway đã xác thực JWT)
import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ProfileService } from './profile.service';
import {
  UpdateMeDto,
  UpdateProfileDto,
  UpdatePreferencesDto,
} from './profile.dto';
import { CurrentUser, GatewayUserGuard } from '@nextech/service-kit';
import type { GatewayUser } from '@nextech/service-kit';

@UseGuards(GatewayUserGuard)
@Controller('users/me')
export class ProfileController {
  constructor(private profileService: ProfileService) {}

  @Get()
  getMe(@CurrentUser() user: GatewayUser) {
    return this.profileService.getMe(user.sub);
  }

  @Put()
  updateMe(@CurrentUser() user: GatewayUser, @Body() dto: UpdateMeDto) {
    return this.profileService.updateMe(user.sub, dto);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: GatewayUser) {
    return this.profileService.getMyProfile(user.sub);
  }

  @Put('profile')
  updateProfile(
    @CurrentUser() user: GatewayUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateMyProfile(user.sub, dto);
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: GatewayUser) {
    return this.profileService.getMyPreferences(user.sub);
  }

  @Put('preferences')
  updatePreferences(
    @CurrentUser() user: GatewayUser,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.profileService.updateMyPreferences(user.sub, dto);
  }
}
