// Chép từ be/src/users/cart/cart.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard
// (gateway đã xác thực JWT, service tin X-User-* kèm X-Internal-Token — security-policy §2).
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  GatewayUserGuard,
  type GatewayUser,
} from '@nextech/service-kit';
import { AddCartItemDto, UpdateCartItemDto } from './cart.dto';
import { CartService } from './cart.service';

@Controller('cart')
@UseGuards(GatewayUserGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  // GET /api/cart
  @Get()
  getMyCart(@CurrentUser() user: GatewayUser) {
    return this.cartService.getMyCart(user.sub);
  }

  // POST /api/cart/items
  @Post('items')
  addItem(@CurrentUser() user: GatewayUser, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.sub, dto);
  }

  // PUT /api/cart/items/:id
  @Put('items/:id')
  updateItem(
    @CurrentUser() user: GatewayUser,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user.sub, id, dto);
  }

  // DELETE /api/cart/items/:id
  @Delete('items/:id')
  removeItem(@CurrentUser() user: GatewayUser, @Param('id') id: string) {
    return this.cartService.removeItem(user.sub, id);
  }
}
