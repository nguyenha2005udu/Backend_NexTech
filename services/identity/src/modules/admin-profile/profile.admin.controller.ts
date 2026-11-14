// Chép từ be/src/admin/profile/profile.admin.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard; RolesGuard, Roles từ service-kit
import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ProfileAdminService } from './profile.admin.service';
import { QueryUsersDto, AdminUpdateUserDto } from './profile.admin.dto';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';

// Bắt buộc đăng nhập VÀ role admin. Thứ tự guard quan trọng: GatewayUserGuard
// chạy trước để gắn request.user, RolesGuard chạy sau để đọc user.role.
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
@Controller('admin/users')
export class ProfileAdminController {
  constructor(private profileAdminService: ProfileAdminService) {}

  @Get()
  findAll(@Query() query: QueryUsersDto) {
    return this.profileAdminService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.profileAdminService.findOneDetail(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.profileAdminService.updateStatusOrRole(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.profileAdminService.remove(id);
  }
}
