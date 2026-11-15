// Chép từ be/src/users/address/address.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard (gateway đã xác thực JWT)
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AddressService } from './address.service';
import { CreateAddressDto, UpdateAddressDto } from './address.dto';
import { CurrentUser, GatewayUserGuard } from '@nextech/service-kit';
import type { GatewayUser } from '@nextech/service-kit';

@UseGuards(GatewayUserGuard)
@Controller('users/me/addresses')
export class AddressController {
  constructor(private addressService: AddressService) {}

  @Get()
  getMyAddresses(@CurrentUser() user: GatewayUser) {
    return this.addressService.getMyAddresses(user.sub);
  }

  @Get(':id')
  getMyAddressById(@CurrentUser() user: GatewayUser, @Param('id') id: string) {
    return this.addressService.getMyAddressById(user.sub, id);
  }

  @Post()
  createAddress(
    @CurrentUser() user: GatewayUser,
    @Body() dto: CreateAddressDto,
  ) {
    return this.addressService.createAddress(user.sub, dto);
  }

  @Put(':id')
  updateAddress(
    @CurrentUser() user: GatewayUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressService.updateAddress(user.sub, id, dto);
  }

  @Put(':id/default')
  setDefaultAddress(@CurrentUser() user: GatewayUser, @Param('id') id: string) {
    return this.addressService.setDefaultAddress(user.sub, id);
  }

  @Delete(':id')
  deleteAddress(@CurrentUser() user: GatewayUser, @Param('id') id: string) {
    return this.addressService.deleteAddress(user.sub, id);
  }
}
