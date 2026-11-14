import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { databaseConfig } from '../config/configuration';

// Cấu hình TypeORM dùng chung cho app (app.module.ts), CLI migration (data-source.ts) và test Postgres thật.
export function dataSourceOptions(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  const db = databaseConfig(env);
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.name,
    ssl: db.ssl ? { rejectUnauthorized: false } : false,
    entities: [join(__dirname, 'entities', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    // Bật để đếm số truy vấn mỗi endpoint (non-functional-standards §1)
    logging: env.DB_LOGGING === 'true' ? ['query'] : false,
  };
}
