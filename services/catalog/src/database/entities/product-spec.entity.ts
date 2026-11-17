// Chép từ be/src/database/product-spec.entity.ts, thêm index product_id (nạp thông số theo sản phẩm — non-functional-standards §1)
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';

@Entity('product_specs')
export class ProductSpec {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_product_specs_product_id')
  @Column({ type: 'uuid' })
  product_id: string;

  @ManyToOne(() => Product, (product) => product.specs, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  // cpu / ram / battery_life_hours / weight_kg...
  @Column({ type: 'varchar', length: 100 })
  spec_key: string;

  // giá trị thông số
  @Column({ type: 'varchar', length: 255 })
  spec_value: string;

  // đơn vị: GB, hours, kg
  @Column({ type: 'varchar', length: 20, nullable: true })
  spec_unit: string | null;
}
