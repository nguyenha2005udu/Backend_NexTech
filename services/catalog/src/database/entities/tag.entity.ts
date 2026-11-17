// Chép nguyên từ be/src/database/tag.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToMany } from 'typeorm';
import { Product } from './product.entity';

@Entity('tags')
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // sinh viên, lập trình, pin tốt, mỏng nhẹ
  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  // Product là owning side (có @JoinTable), nên bên Tag KHÔNG khai báo @JoinTable
  @ManyToMany(() => Product, (product) => product.tags)
  products: Product[];
}
