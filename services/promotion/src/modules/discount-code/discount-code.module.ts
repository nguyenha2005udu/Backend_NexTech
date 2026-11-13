import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import { DiscountCodeService } from './discount-code.service';
import { DiscountCodeController } from './discount-code.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DiscountCode])],
  controllers: [DiscountCodeController],
  providers: [DiscountCodeService],
})
export class DiscountCodeModule {}
