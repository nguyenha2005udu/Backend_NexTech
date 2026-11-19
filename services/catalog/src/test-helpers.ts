// Chép từ services/promotion/src/test-helpers.ts (T2.1), đổi env sang catalog_*. Trùng 2 service: ứng viên đưa vào service-kit (tech-debt T2.4).
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { dataSourceOptions } from './database/typeorm-options';

// Dựng Postgres thật cho *.int-spec.ts (tdd-guide §5: test đồng thời không dùng mock).
// Cần `docker compose up -d postgres` (cổng 5433 trên máy). Mỗi lần chạy một schema riêng qua
// search_path, chạy migration thật, xoá schema khi xong — không đụng dữ liệu dev trong catalog_db.
// Không nằm trong build (tsconfig.build.json loại **/test-helpers.ts).

const TEST_ENV: NodeJS.ProcessEnv = {
  DB_HOST: process.env.DB_HOST ?? 'localhost',
  DB_PORT: process.env.DB_PORT ?? '5433',
  DB_USER: process.env.DB_USER ?? 'catalog_user',
  DB_PASS: process.env.DB_PASS ?? 'catalog_pass',
  DB_NAME: process.env.DB_NAME ?? 'catalog_db',
  DB_SSL: process.env.DB_SSL ?? 'false',
  DB_LOGGING: process.env.DB_LOGGING,
};

export interface TestDb {
  ds: DataSource;
  schema: string;
  cleanup(): Promise<void>;
}

async function withAdmin<T>(
  base: DataSourceOptions,
  fn: (ds: DataSource) => Promise<T>,
): Promise<T> {
  const admin = await new DataSource({
    ...base,
    entities: [],
    migrations: [],
  }).initialize();
  try {
    return await fn(admin);
  } finally {
    await admin.destroy();
  }
}

export async function createTestDb(): Promise<TestDb> {
  const base = dataSourceOptions(TEST_ENV);
  const schema = `test_${process.pid}_${Date.now()}`;
  await withAdmin(base, (a) => a.query(`CREATE SCHEMA "${schema}"`));

  const ds = await new DataSource({
    ...base,
    // public để thấy uuid_generate_v4() của extension uuid-ossp (infra/postgres/init-databases.sh)
    extra: { options: `-c search_path=${schema},public`, max: 20 },
    migrationsRun: true,
  }).initialize();

  return {
    ds,
    schema,
    async cleanup() {
      await ds.destroy();
      await withAdmin(base, (a) =>
        a.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`),
      );
    },
  };
}
