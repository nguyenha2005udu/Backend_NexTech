// Viết tay theo DDL design/ASSISTANT/README.md §5 (T8.5): conversations, messages, 3 index.
// Không FK sang dữ liệu service khác (user_id không FK). uuid_generate_v4() do extension uuid-ossp
// (infra/postgres/init-databases.sh; DB cloud: CREATE EXTENSION ở dưới, IF NOT EXISTS).
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1795446000000 implements MigrationInterface {
  name = 'Init1795446000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "guest_id" uuid, "title" character varying(255), "channel" character varying(20) NOT NULL DEFAULT 'chat', "current_step" character varying(30) NOT NULL DEFAULT 'search', "context" json, "started_at" TIMESTAMP NOT NULL DEFAULT now(), "ended_at" TIMESTAMP, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_conversations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_conversations_user" ON "conversations" ("user_id", "started_at" DESC) WHERE "user_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_conversations_guest" ON "conversations" ("guest_id") WHERE "guest_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "sender" character varying(10) NOT NULL, "content" text NOT NULL, "message_type" character varying(20) NOT NULL DEFAULT 'text', "metadata" json, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_messages" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_messages_conversation" ON "messages" ("conversation_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_conversation"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_messages_conversation"`);
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP INDEX "public"."ix_conversations_guest"`);
    await queryRunner.query(`DROP INDEX "public"."ix_conversations_user"`);
    await queryRunner.query(`DROP TABLE "conversations"`);
  }
}
