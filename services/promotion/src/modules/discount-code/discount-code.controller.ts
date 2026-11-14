import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { DiscountCodeService } from './discount-code.service';
import {
  ListDiscountCodeDto,
  ValidateDiscountCodeDto,
} from './discount-code.dto';

// Chép nguyên từ be/src/users/discountcode/discountcode.controller.ts. Route public (gateway dòng 12).
@Controller('discount-codes')
export class DiscountCodeController {
  constructor(private readonly discountCodeService: DiscountCodeService) {}

  // GET /api/discount-codes
  @Get()
  listDiscountCodes(@Query() query: ListDiscountCodeDto) {
    return this.discountCodeService.listDiscountCodes(query);
  }

  // GET /api/discount-codes/freeship
  @Get('freeship')
  listFreeshipCodes(@Query() query: ListDiscountCodeDto) {
    return this.discountCodeService.listFreeshipCodes(query);
  }

  // POST /api/discount-codes/validate
  @Post('validate')
  @HttpCode(200)
  validate(@Body() dto: ValidateDiscountCodeDto) {
    return this.discountCodeService.validate(dto);
  }
}
