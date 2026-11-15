import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { assertRequiredEnv } from '../config/configuration';
import { dataSourceOptions } from './typeorm-options';

// Chỉ dùng cho CLI TypeORM (chạy trên dist/):
//   npm run migration:generate -w services/identity -- src/database/migrations/<Tên>
// CLI chỉ cần biến DB, không cần Redis, JWT
assertRequiredEnv(process.env, ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME']);
export default new DataSource(dataSourceOptions());
