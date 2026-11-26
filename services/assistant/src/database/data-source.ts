import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DB_REQUIRED, assertRequiredEnv } from '../config/configuration';
import { dataSourceOptions } from './typeorm-options';

// Chỉ dùng cho CLI TypeORM (chạy trên dist/):
//   npm run migration:generate -w services/assistant -- src/database/migrations/<Tên>
assertRequiredEnv(process.env, DB_REQUIRED);
export default new DataSource(dataSourceOptions());
