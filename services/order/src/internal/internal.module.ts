import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderItem } from '../database/entities/order-item.entity';
import { PurchasesInternalController } from './purchases.internal.controller';
import { PurchasesInternalService } from './purchases.internal.service';

// Mọi /internal/* của order (NT.ORDER API_Spec §2). Hiện chỉ purchases/check (T3.2).
@Module({
  imports: [TypeOrmModule.forFeature([OrderItem])],
  controllers: [PurchasesInternalController],
  providers: [PurchasesInternalService],
})
export class InternalModule {}
