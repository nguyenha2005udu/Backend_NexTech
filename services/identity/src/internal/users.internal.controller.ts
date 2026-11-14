import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalTokenGuard } from '@nextech/service-kit';
import { UsersBatchDto } from './internal.dto';
import { UsersInternalService } from './users.internal.service';

// API nội bộ cho order, catalog, notification, assistant (NT.IDENTITY API_Spec §2).
// Không qua gateway, bắt buộc X-Internal-Token.
@Controller('internal')
@UseGuards(InternalTokenGuard)
export class UsersInternalController {
  constructor(private readonly users: UsersInternalService) {}

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getUser(id);
  }

  @Get('users/:userId/addresses/:addressId')
  getAddress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return this.users.getAddress(userId, addressId);
  }

  // Chỉ đọc: bên gọi được retry dù là POST
  @Post('users/batch')
  @HttpCode(200)
  getUsers(@Body() dto: UsersBatchDto) {
    return this.users.getUsers(dto.ids);
  }

  @Get('stats/users')
  stats() {
    return this.users.countUsers();
  }
}
