import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { databaseConfig, dbLockConfig } from '../config/configuration';

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

// Chỉ kết nối của ứng dụng (app.module.ts): lock_timeout, idle_in_transaction_session_timeout (BR-20,
// NT.ORDER_HOLD v1.3 Component_Class_Design §9). CLI migration (data-source.ts) và test-helpers không đặt.
// Tham số kết nối, không tốn truy vấn mỗi request. Migration lúc khởi động (migrationsRun) cũng chịu — chấp nhận (v1.3).
export function appConnectionExtra(env: NodeJS.ProcessEnv = process.env): {
  options: string;
} {
  const { lockTimeoutMs, idleTxTimeoutMs } = dbLockConfig(env);
  return {
    options: `-c lock_timeout=${lockTimeoutMs} -c idle_in_transaction_session_timeout=${idleTxTimeoutMs}`,
  };
}
