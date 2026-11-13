import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';
import { AdminDiscountCodeService } from './discount-code.admin.service';
import {
  CreateDiscountCodeDto,
  QueryDiscountCodeDto,
  UpdateDiscountCodeDto,
} from './discount-code.admin.dto';

// Chép từ be/src/admin/discountcode/discountcode.admin.controller.ts.
// Đổi guard: JwtAccessGuard → GatewayUserGuard (tin X-User-* từ gateway, source-of-truth §2).
// Gateway đã chặn role ở dòng 13; RolesGuard giữ lại theo security-policy §4.
@Controller('admin/discount-codes')
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
export class AdminDiscountCodeController {
  constructor(
    private readonly adminDiscountCodeService: AdminDiscountCodeService,
  ) {}

  @Get()
  findAll(@Query() query: QueryDiscountCodeDto) {
    return this.adminDiscountCodeService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateDiscountCodeDto) {
    return this.adminDiscountCodeService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDiscountCodeDto) {
    return this.adminDiscountCodeService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adminDiscountCodeService.remove(id);
  }
}
