// Chép từ be/src/database/product-image.entity.ts, thêm index product_id (nạp ảnh theo sản phẩm — non-functional-standards §1)
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('product_images')
export class ProductImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_product_images_product_id')
  @Column({ type: 'uuid' })
  product_id: string;

  @ManyToOne(() => Product, (product) => product.images, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'text' })
  image_url: string;

  // public_id trên Cloudinary (vd: "products/<productId>/abc123") - cần để xoá/thay ảnh đúng file
  @Column({ type: 'varchar', length: 500, nullable: true })
  public_id: string | null;

  @Column({ type: 'boolean', default: false })
  is_primary: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;
}
