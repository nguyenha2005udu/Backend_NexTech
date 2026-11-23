// Chép từ services/catalog/src/test-helpers.ts (T2.4), đổi env sang order_*. Trùng 3 service: ứng viên đưa vào service-kit (tech-debt T2.4).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource, DataSourceOptions } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { dataSourceOptions } from './database/typeorm-options';
import type { HoldScheduleService } from './modules/order-hold/hold-schedule.service';
import type { OrderLockService } from './redis/order-lock.service';

// Dựng Postgres thật cho *.int-spec.ts (tdd-guide §5: test đồng thời không dùng mock).
// Cần `docker compose up -d postgres` (cổng 5433 trên máy). Mỗi lần chạy một schema riêng qua
// search_path, chạy migration thật, xoá schema khi xong — không đụng dữ liệu dev trong order_db.
// Không nằm trong build (tsconfig.build.json loại **/test-helpers.ts).

const TEST_ENV: NodeJS.ProcessEnv = {
  DB_HOST: process.env.DB_HOST ?? 'localhost',
  DB_PORT: process.env.DB_PORT ?? '5433',
  DB_USER: process.env.DB_USER ?? 'order_user',
  DB_PASS: process.env.DB_PASS ?? 'order_pass',
  DB_NAME: process.env.DB_NAME ?? 'order_db',
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

/** `pgOptions`: tham số kết nối thêm (vd. lock_timeout của appConnectionExtra) cho test khoá */
export async function createTestDb(
  opts: { pgOptions?: string } = {},
): Promise<TestDb> {
  const base = dataSourceOptions(TEST_ENV);
  const schema = `test_${process.pid}_${Date.now()}`;
  await withAdmin(base, (a) => a.query(`CREATE SCHEMA "${schema}"`));

  const ds = await new DataSource({
    ...base,
    // public để thấy uuid_generate_v4() của extension uuid-ossp (infra/postgres/init-databases.sh)
    extra: {
      options: `-c search_path=${schema},public ${opts.pgOptions ?? ''}`.trim(),
      max: 20,
    },
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

// Đếm câu SQL thật gửi Postgres trong một đoạn code (non-functional §1: đo thật), bỏ lệnh điều khiển
// transaction. Dùng trong jest: q = countQueries(); …; expect(q.count).toBe(n); q.restore().
export function countQueries() {
  const spy = jest.spyOn(PostgresQueryRunner.prototype, 'query');
  return {
    get count() {
      return spy.mock.calls.filter(
        ([sql]) =>
          !/^(START TRANSACTION|COMMIT|ROLLBACK|SELECT version\(\))/i.test(
            String(sql),
          ),
      ).length;
    },
    restore: () => spy.mockRestore(),
  };
}

export interface SeedLine {
  product_id?: string;
  product_name?: string;
  product_image?: string | null;
  quantity?: number;
  unit_price?: number;
}

// Chèn một đơn kèm dòng đơn (chưa có saga tới T3.3). Trả id đơn.
export async function seedOrder(
  ds: DataSource,
  o: {
    user_id: string;
    status: string;
    customer_name?: string | null;
    created_at?: Date;
    payment_expires_at?: Date | null;
    lines?: SeedLine[];
  },
): Promise<string> {
  const [{ id }] = await ds.query<Array<{ id: string }>>(
    `INSERT INTO orders (user_id, customer_name, customer_email, customer_phone, shipping_full_address,
       subtotal, shipping_fee, total, status, created_at, payment_expires_at)
     VALUES ($1, $2, 'a@b.c', '0900000000', '1 Lê Lợi', 200000, 30000, 230000, $3,
       COALESCE($4, now()), $5)
     RETURNING id`,
    [
      o.user_id,
      o.customer_name ?? 'Nguyễn A',
      o.status,
      o.created_at ?? null,
      o.payment_expires_at ?? null,
    ],
  );
  for (const l of o.lines ?? []) {
    await ds.query(
      `INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        l.product_id ?? randomUUID(),
        l.product_name ?? 'Tai nghe X',
        l.product_image ?? null,
        l.quantity ?? 1,
        l.unit_price ?? 100000,
      ],
    );
  }
  return id;
}

// Khoá đơn chạy thẳng fn (không Redis) cho int-spec không kiểm khoá; khoá thật ở redis/order-lock.service.int-spec.ts
export const noLock = {
  withOrderLock: <T>(_orderId: string, fn: () => Promise<T>) => fn(),
} as unknown as OrderLockService;

// Hẹn hạn giữ hàng không làm gì (không Redis) cho spec không kiểm hẹn; hạn vẫn tính như thật (15 phút).
// Spec cần kiểm thì jest.spyOn(noHold, 'schedule' | 'unschedule'). Hẹn thật: hold-expiry.service.int-spec.ts
export const noHold = {
  deadlineFrom: (now = new Date()) => new Date(now.getTime() + 15 * 60_000),
  schedule: () => Promise.resolve(),
  unschedule: () => Promise.resolve(),
  defer: () => Promise.resolve(),
  due: () => Promise.resolve([] as string[]),
} as unknown as HoldScheduleService;
