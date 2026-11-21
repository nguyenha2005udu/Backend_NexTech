// Sinh bằng `npm run migration:generate` trên Postgres thật (T3.6). Migration mới, không sửa Init (đã chạy ở dev và
// Render từ T3.1). Đối chiếu NT.PAYMENT API_Spec §6 v2.5: bảng payment_transactions, dedup_key UNIQUE, FK payment_id
// (cùng service), 2 index partial (ix_payment_transactions_payment, ix_payment_transactions_review).
import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentTransactions1795270183704 implements MigrationInterface {
  name = 'PaymentTransactions1795270183704';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "payment_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" character varying(20) NOT NULL DEFAULT 'payos', "dedup_key" character varying(255) NOT NULL, "reference" character varying(100), "payment_id" uuid, "order_code" character varying(255) NOT NULL, "amount" bigint NOT NULL, "currency" character varying(10) NOT NULL DEFAULT 'VND', "account_number" character varying(50), "counter_account_bank_id" character varying(50), "counter_account_bank_name" character varying(255), "counter_account_name" character varying(255), "counter_account_number" character varying(50), "description" character varying(255), "transaction_date_time" character varying(30), "outcome" character varying(30) NOT NULL DEFAULT 'received', "raw_payload" jsonb NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_70f7c1320be6c786d61f33b1884" UNIQUE ("dedup_key"), CONSTRAINT "PK_d32b3c6b0d2c1d22604cbcc8c49" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_payment_transactions_review" ON "payment_transactions"  ("received_at") WHERE "outcome" <> 'applied'`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_payment_transactions_payment" ON "payment_transactions"  ("payment_id", "received_at") WHERE "payment_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_transactions" ADD CONSTRAINT "FK_1f4dd90aece142a3a591cf4334b" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_transactions" DROP CONSTRAINT "FK_1f4dd90aece142a3a591cf4334b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ix_payment_transactions_payment"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ix_payment_transactions_review"`,
    );
    await queryRunner.query(`DROP TABLE "payment_transactions"`);
  }
}
