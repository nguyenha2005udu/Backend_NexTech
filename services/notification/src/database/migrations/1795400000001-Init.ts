// T4.2: bảng notifications, processed_events theo NT.NOTIFICATION API_Spec §6. uuid_generate_v4() từ extension
// uuid-ossp (infra/postgres/init-databases.sh).
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1795400000001 implements MigrationInterface {
  name = 'Init1795400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" character varying(30) NOT NULL, "title" character varying(255) NOT NULL, "body" text, "data" json, "is_read" boolean NOT NULL DEFAULT false, "channel" character varying(20) NOT NULL DEFAULT 'app', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_notifications" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_notifications_user" ON "notifications" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE TABLE "processed_events" ("event_id" uuid NOT NULL, "event_type" character varying(100) NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_processed_events" PRIMARY KEY ("event_id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_events"`);
    await queryRunner.query(`DROP INDEX "public"."ix_notifications_user"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
