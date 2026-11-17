// Chép từ be/src/database/product.entity.ts. Đổi do tách service (Component_Class_Design §4):
// bỏ @OneToMany tới CartItem, OrderItem (thuộc order-service).
// Thêm index category_id, created_at (lọc và sắp xếp mặc định của GET /api/products — non-functional-standards §1).
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  ManyToMany,
  JoinTable,
  Index,
} from 'typeorm';
import { Category } from './category.entity';
import { ProductSpec } from './product-spec.entity';
import { Tag } from './tag.entity';
import { ProductImage } from './product-image.entity';
import { ProductReview } from './product-review.entity';
import { PriceAlert } from './price-alert.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index('IDX_products_category_id')
  @Column({ type: 'uuid', nullable: true })
  category_id: string | null;

  @ManyToOne(() => Category, (category) => category.products, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string | null;

  @Column({ type: 'bigint' })
  price: number;

  @Column({ type: 'decimal', precision: 2, scale: 1, nullable: true })
  rating: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 0 })
  stock_quantity: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Index('IDX_products_created_at')
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @OneToMany(() => ProductSpec, (spec) => spec.product)
  specs: ProductSpec[];

  @ManyToMany(() => Tag, (tag) => tag.products)
  @JoinTable({
    name: 'product_tag_map',
    joinColumn: { name: 'product_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags: Tag[];

  @OneToMany(() => ProductImage, (image) => image.product)
  images: ProductImage[];

  @OneToMany(() => ProductReview, (review) => review.product)
  reviews: ProductReview[];

  @OneToMany(() => PriceAlert, (alert) => alert.product)
  price_alerts: PriceAlert[];
}
