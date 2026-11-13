import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1794539734363 implements MigrationInterface {
  name = 'Init1794539734363';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "discount_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(50) NOT NULL, "description" character varying(255), "category" character varying(20) NOT NULL DEFAULT 'order', "discount_type" character varying(20) NOT NULL DEFAULT 'percent', "discount_value" bigint NOT NULL, "min_order_value" bigint, "max_discount" bigint, "usage_limit" integer, "used_count" integer NOT NULL DEFAULT '0', "valid_from" TIMESTAMP, "valid_until" TIMESTAMP, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_b967edd0d46547d4a92b4a1c6b3" UNIQUE ("code"), CONSTRAINT "PK_c0170a28d937472e9ce50fdce17" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discount_codes_created_at" ON "discount_codes"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "redemptions" ("order_id" uuid NOT NULL, "status" character varying(20) NOT NULL, "discount_code_id" uuid, "freeship_code_id" uuid, "discount_amount" bigint NOT NULL DEFAULT '0', "shipping_discount_amount" bigint NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "released_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5b1dee701fd4fea031ba393b509" PRIMARY KEY ("order_id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "redemptions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_discount_codes_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "discount_codes"`);
  }
}
