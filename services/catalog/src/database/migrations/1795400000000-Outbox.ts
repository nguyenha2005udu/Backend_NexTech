// T4.1, T4.4: bảng outbox theo NT.MESSAGING API_Spec §4 (entity OutboxEvent của service-kit). Migration mới, không sửa
// migration đã chạy ở dev và Render.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Outbox1795400000000 implements MigrationInterface {
  name = 'Outbox1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outbox" ("id" uuid NOT NULL, "routing_key" character varying(100) NOT NULL, "payload" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_outbox" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_outbox_unpublished" ON "outbox" ("created_at") WHERE published_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."ix_outbox_unpublished"`);
    await queryRunner.query(`DROP TABLE "outbox"`);
  }
}
