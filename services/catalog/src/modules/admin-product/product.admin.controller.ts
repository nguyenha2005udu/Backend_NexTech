// Chép từ be/src/admin/product/product.admin.controller.ts. Đổi guard: JwtAccessGuard → GatewayUserGuard;
// RolesGuard, @Roles từ service-kit. Gateway đã chặn thô /api/admin/* (security-policy §4), service vẫn giữ RolesGuard.
import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminProductService } from './product.admin.service';
import {
  CreateProductDto,
  CreateProductImageDto,
  CreateProductSpecDto,
  CreateProductTagDto,
  QueryAdminProductDto,
  UpdateProductDto,
  UpdateProductImageDto,
  UpdateProductSpecDto,
} from './product.admin.dto';
import { GatewayUserGuard, Roles, RolesGuard } from '@nextech/service-kit';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

@Controller('admin/products')
@UseGuards(GatewayUserGuard, RolesGuard)
@Roles('admin')
export class AdminProductController {
  constructor(private readonly adminProductService: AdminProductService) {}

  @Get()
  findAll(@Query() query: QueryAdminProductDto) {
    return this.adminProductService.findAll(query);
  }

  // GET /api/admin/products/brands
  @Get('brands')
  findAllBrands() {
    return this.adminProductService.findAllBrands();
  }

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.adminProductService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.adminProductService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adminProductService.remove(id);
  }

  // POST /api/admin/products/:id/images
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file'))
  addImage(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE }),
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp|gif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File | undefined,
    @Body() dto: CreateProductImageDto,
  ) {
    return this.adminProductService.addImage(id, file, dto);
  }

  // PUT /api/admin/products/:id/images/:image_id
  @Put(':id/images/:image_id')
  @UseInterceptors(FileInterceptor('file'))
  updateImage(
    @Param('id') id: string,
    @Param('image_id') imageId: string,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE }),
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp|gif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File | undefined,
    @Body() dto: UpdateProductImageDto,
  ) {
    return this.adminProductService.updateImage(id, imageId, file, dto);
  }

  @Delete(':id/images/:image_id')
  removeImage(@Param('id') id: string, @Param('image_id') imageId: string) {
    return this.adminProductService.removeImage(id, imageId);
  }

  @Post(':id/specs')
  addSpec(@Param('id') id: string, @Body() dto: CreateProductSpecDto) {
    return this.adminProductService.addSpec(id, dto);
  }

  @Put(':id/specs/:spec_id')
  updateSpec(
    @Param('id') id: string,
    @Param('spec_id') specId: string,
    @Body() dto: UpdateProductSpecDto,
  ) {
    return this.adminProductService.updateSpec(id, specId, dto);
  }

  @Delete(':id/specs/:spec_id')
  removeSpec(@Param('id') id: string, @Param('spec_id') specId: string) {
    return this.adminProductService.removeSpec(id, specId);
  }

  @Post(':id/tags')
  addTag(@Param('id') id: string, @Body() dto: CreateProductTagDto) {
    return this.adminProductService.addTag(id, dto);
  }

  @Delete(':id/tags/:tag_id')
  removeTag(@Param('id') id: string, @Param('tag_id') tagId: string) {
    return this.adminProductService.removeTag(id, tagId);
  }
}
