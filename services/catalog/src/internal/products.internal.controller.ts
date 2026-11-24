import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InternalTokenGuard } from '@nextech/service-kit';
import { ProductService } from '../modules/product/product.service';
import {
  ProductsBatchDto,
  SEARCH_MAX_LIMIT,
  SearchProductsInternalDto,
} from './products.internal.dto';
import { ProductsInternalService } from './products.internal.service';

// API nội bộ, không qua gateway, bắt buộc X-Internal-Token (security-policy §3).
@Controller('internal/products')
@UseGuards(InternalTokenGuard)
export class ProductsInternalController {
  constructor(
    private readonly products: ProductsInternalService,
    private readonly productService: ProductService,
  ) {}

  // Trợ lý AI tìm sản phẩm (T8.4). Dùng lại ProductService.findAll: chỉ sản phẩm đang bán,
  // item cùng shape GET /api/products vì app đọc lại trong metadata.products.
  @Get('search')
  async search(@Query() q: SearchProductsInternalDto) {
    const { items } = await this.productService.findAll({
      search: q.search,
      categoryId: q.categoryId,
      brand: q.brand,
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
      page: 1,
      limit: Math.min(q.limit ?? SEARCH_MAX_LIMIT, SEARCH_MAX_LIMIT),
    });
    return { items };
  }

  // Hãng và danh mục đang có sản phẩm, đưa vào hướng dẫn hệ thống của AI (T8.4)
  @Get('facets')
  async facets() {
    const [brands, categories] = await Promise.all([
      this.productService.findAllBrands(),
      this.productService.findAllCategories(),
    ]);
    return { brands, categories };
  }

  // Đọc, không tạo gì → 200
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  batch(@Body() dto: ProductsBatchDto) {
    return this.products.findBatch(dto.ids);
  }
}
