// Chép từ be/src/database/category.entity.ts, thêm index industry_id (lọc danh mục theo ngành — non-functional-standards §1)
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';
import { Industry } from './industry.entity';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tên hiển thị: Laptop, Điện thoại...
  @Column({ type: 'varchar', length: 100 })
  name: string;

  // Icon class hoặc emoji
  @Column({ type: 'varchar', nullable: true })
  icon: string | null;

  // property camelCase (dùng trong code) <-> cột snake_case (dùng trong DB)
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  // Foreign key đến Industry
  @Index('IDX_categories_industry_id')
  @Column({ name: 'industry_id', type: 'uuid', nullable: true })
  industry_id: string | null;

  @ManyToOne(() => Industry, (industry) => industry.categories, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'industry_id' })
  industry: Industry | null;

  @OneToMany(() => Product, (product) => product.category)
  products: Product[];
}
