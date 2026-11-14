import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscountCode } from '../../database/entities/discount-code.entity';
import { AdminDiscountCodeService } from './discount-code.admin.service';
import { AdminDiscountCodeController } from './discount-code.admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DiscountCode])],
  controllers: [AdminDiscountCodeController],
  providers: [AdminDiscountCodeService],
})
export class AdminDiscountCodeModule {}
