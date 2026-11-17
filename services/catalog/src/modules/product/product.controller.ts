// Chép từ be/src/users/product/product.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard
// (gateway đã xác thực JWT); `req.user.sub` → `@CurrentUser() user.sub` (cùng shape).
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, GatewayUserGuard } from '@nextech/service-kit';
import type { GatewayUser } from '@nextech/service-kit';
import { ProductService } from './product.service';
import {
  CreateProductReviewDto,
  QueryProductDto,
  QueryProductReviewDto,
} from './product.dto';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // GET /api/products - tìm kiếm/lọc sản phẩm (category, brand, giá, tag...)
  @Get()
  findAll(@Query() query: QueryProductDto) {
    return this.productService.findAll(query);
  }

  // GET /api/products/brands - danh sách hãng đang có sản phẩm (phục vụ filter UI)
  @Get('brands')
  findAllBrands() {
    return this.productService.findAllBrands();
  }

  // GET /api/products/:id - chi tiết sản phẩm
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  // GET /api/products/:id/specs - thông số kỹ thuật
  @Get(':id/specs')
  findSpecs(@Param('id') id: string) {
    return this.productService.findSpecs(id);
  }

  // GET /api/products/:id/reviews - danh sách đánh giá (phân trang)
  @Get(':id/reviews')
  findReviews(@Param('id') id: string, @Query() query: QueryProductReviewDto) {
    return this.productService.findReviews(id, query);
  }

  // POST /api/products/:id/reviews - viết đánh giá (yêu cầu đăng nhập + đã mua hàng)
  @Post(':id/reviews')
  @UseGuards(GatewayUserGuard)
  createReview(
    @Param('id') id: string,
    @Body() dto: CreateProductReviewDto,
    @CurrentUser() user: GatewayUser,
  ) {
    return this.productService.createReview(id, user.sub, dto);
  }
}
