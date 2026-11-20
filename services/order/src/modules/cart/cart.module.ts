// Chép từ be/src/users/cart/cart.module.ts. Bỏ Product, ProductImage (dữ liệu catalog),
// thêm ClientsModule để dùng CatalogClient.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../../clients/clients.module';
import { Cart } from '../../database/entities/cart.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cart, CartItem]), ClientsModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
