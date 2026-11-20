// Sinh bằng `npm run migration:generate` trên Postgres thật (T3.1), thêm tay 2 index TypeORM không khai được
// (ix_orders_user_created DESC, ix_payments_prev_codes GIN; entity đặt synchronize: false). Đối chiếu
// NT.ORDER API_Spec §5 + NT.PAYMENT API_Spec §6: 6 bảng, không FK sang dữ liệu service khác, mọi index
// partial theo DDL, orders.payment_expires_at (NT.ORDER_HOLD). Bảng outbox ở T4.1.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1795140424599 implements MigrationInterface {
  name = 'Init1795140424599';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "carts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2ec1c94a977b940d85a4f498aea" UNIQUE ("user_id"), CONSTRAINT "PK_b5f695a59f5ebb50af3c8160816" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "cart_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "cart_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" integer NOT NULL DEFAULT '1', "added_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_dba960dbfd8636893d3c7acb18d" UNIQUE ("cart_id", "product_id"), CONSTRAINT "PK_6fccf5ec03c172d27a28a82928b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "method" character varying(30) NOT NULL, "transaction_id" character varying(255), "previous_transaction_ids" text array NOT NULL DEFAULT '{}', "amount" bigint NOT NULL, "currency" character varying(10) NOT NULL DEFAULT 'VND', "status" character varying(20) NOT NULL DEFAULT 'pending', "gateway_response" json, "refunded_amount" bigint, "paid_at" TIMESTAMP, "needs_refund" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_3c324ca49dabde7ffc0ef64675d" UNIQUE ("transaction_id"), CONSTRAINT "REL_b2f7b823a21562eeca20e72b00" UNIQUE ("order_id"), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_payments_paid_at" ON "payments"  ("paid_at") WHERE "status" = 'success'`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_payments_prev_codes" ON "payments" USING gin ("previous_transaction_ids")`,
    );
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "cart_id" uuid, "address_id" uuid, "customer_name" character varying(255), "customer_email" character varying(255), "customer_phone" character varying(20), "shipping_full_address" character varying(255) NOT NULL, "shipping_recipient_name" character varying(150), "shipping_phone_number" character varying(20), "discount_code" character varying(50), "freeship_code" character varying(50), "discount_code_id" uuid, "freeship_code_id" uuid, "subtotal" bigint NOT NULL, "shipping_fee" bigint NOT NULL DEFAULT '0', "discount_amount" bigint NOT NULL DEFAULT '0', "shipping_discount_amount" bigint NOT NULL DEFAULT '0', "total" bigint NOT NULL, "status" character varying(30) NOT NULL DEFAULT 'processing', "note" text, "saga_step" character varying(30) NOT NULL DEFAULT 'started', "saga_deadline" TIMESTAMP WITH TIME ZONE, "selected_cart_item_ids" jsonb, "failure_code" character varying(30), "failure_message" text, "failure_status" smallint, "notify_on_finish" boolean NOT NULL DEFAULT false, "idempotency_key" character varying(100), "payment_expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_orders_hold_due" ON "orders"  ("payment_expires_at") WHERE "status" = 'pending' AND "payment_expires_at" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_orders_processing" ON "orders"  ("updated_at") WHERE "status" = 'processing'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_orders_cart_processing" ON "orders"  ("cart_id") WHERE "status" = 'processing' AND "saga_step" <> 'compensating'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_orders_idempotency" ON "orders"  ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_orders_user_created" ON "orders" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "product_id" uuid NOT NULL, "product_name" character varying(255) NOT NULL, "product_image" text, "quantity" integer NOT NULL, "unit_price" bigint NOT NULL, CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_order_items_product" ON "order_items"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "saga_tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "type" character varying(30) NOT NULL, "seq" integer NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "done_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e49b2f3168fe4f02e2b44c979af" UNIQUE ("order_id", "type"), CONSTRAINT "PK_839e5d4acd0416fcd84aeb9e2d2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_saga_tasks_pending" ON "saga_tasks"  ("order_id", "seq") WHERE "status" = 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" ADD CONSTRAINT "FK_6385a745d9e12a89b859bb25623" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_b2f7b823a21562eeca20e72b006" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "saga_tasks" ADD CONSTRAINT "FK_cb24f60ec757846c0215eae7196" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "saga_tasks" DROP CONSTRAINT "FK_cb24f60ec757846c0215eae7196"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_b2f7b823a21562eeca20e72b006"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_items" DROP CONSTRAINT "FK_6385a745d9e12a89b859bb25623"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_saga_tasks_pending"`);
    await queryRunner.query(`DROP TABLE "saga_tasks"`);
    await queryRunner.query(`DROP INDEX "public"."ix_order_items_product"`);
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP INDEX "public"."ix_orders_user_created"`);
    await queryRunner.query(`DROP INDEX "public"."ux_orders_idempotency"`);
    await queryRunner.query(`DROP INDEX "public"."ux_orders_cart_processing"`);
    await queryRunner.query(`DROP INDEX "public"."ix_orders_processing"`);
    await queryRunner.query(`DROP INDEX "public"."ix_orders_hold_due"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP INDEX "public"."ix_payments_prev_codes"`);
    await queryRunner.query(`DROP INDEX "public"."ix_payments_paid_at"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TABLE "cart_items"`);
    await queryRunner.query(`DROP TABLE "carts"`);
  }
}
