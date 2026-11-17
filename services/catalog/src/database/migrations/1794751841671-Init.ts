// Sinh bằng `npm run migration:generate` trên Postgres thật (T2.3). Đối chiếu NT.CATALOG API_Spec §6:
// 9 bảng cũ, snapshot user_name/user_avatar_url, không khoá ngoại user_id, ux_reviews_user_product,
// ux_alerts_user_product_active (partial), index cột lọc/sắp xếp danh sách. Bảng giữ kho ở T2.4, outbox ở T4.1.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1794751841671 implements MigrationInterface {
  name = 'Init1794751841671';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "product_specs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "spec_key" character varying(100) NOT NULL, "spec_value" character varying(255) NOT NULL, "spec_unit" character varying(20), CONSTRAINT "PK_d0cb5ab51b09cdbb6d3e6ce50f5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_product_specs_product_id" ON "product_specs"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tags" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, CONSTRAINT "UQ_d90243459a697eadb8ad56e9092" UNIQUE ("name"), CONSTRAINT "PK_e7dc17249a1148a1970748eda99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "product_images" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "image_url" text NOT NULL, "public_id" character varying(500), "is_primary" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_1974264ea7265989af8392f63a1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_product_images_product_id" ON "product_images"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "product_reviews" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "user_id" uuid, "user_name" character varying(255), "user_avatar_url" text, "rating" numeric(2,1) NOT NULL, "title" character varying(255), "content" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_67c1501aea1b0633ec441b00bd5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_reviews_user_product" ON "product_reviews"  ("product_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "price_alerts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "product_id" uuid NOT NULL, "target_price" bigint NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'active', "notify_channel" character varying(30) NOT NULL DEFAULT 'app', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "triggered_at" TIMESTAMP, CONSTRAINT "PK_125caf0cfa6219ed3ea03646608" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_price_alerts_product_id" ON "price_alerts"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_alerts_user_product_active" ON "price_alerts"  ("user_id", "product_id") WHERE "status" = 'active'`,
    );
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "category_id" uuid, "brand" character varying(100), "price" bigint NOT NULL, "rating" numeric(2,1), "description" text, "stock_quantity" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_products_category_id" ON "products"  ("category_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_products_created_at" ON "products"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "industries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "icon" character varying(50), "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f1626dcb2d58142d7dfcca7b8d1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "icon" character varying, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "industry_id" uuid, CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_categories_industry_id" ON "categories"  ("industry_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "product_tag_map" ("product_id" uuid NOT NULL, "tag_id" uuid NOT NULL, CONSTRAINT "PK_d37e90fadd5935ee3cc075c5570" PRIMARY KEY ("product_id", "tag_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6120fec7382b0d32d02588522a" ON "product_tag_map"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_26238c8b4af792b4dfc9835f3a" ON "product_tag_map"  ("tag_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "product_specs" ADD CONSTRAINT "FK_7ade97675e64f0a2abd6c5be81d" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_images" ADD CONSTRAINT "FK_4f166bb8c2bfcef2498d97b4068" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" ADD CONSTRAINT "FK_1d3fbb451c2b63d0a763f3ff5b1" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_alerts" ADD CONSTRAINT "FK_dd7a63b6bd5211ed115841ddb89" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_9a5f6868c96e0069e699f33e124" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_9bc6adad43db979425757825f8c" FOREIGN KEY ("industry_id") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_tag_map" ADD CONSTRAINT "FK_6120fec7382b0d32d02588522af" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_tag_map" ADD CONSTRAINT "FK_26238c8b4af792b4dfc9835f3a4" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_tag_map" DROP CONSTRAINT "FK_26238c8b4af792b4dfc9835f3a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_tag_map" DROP CONSTRAINT "FK_6120fec7382b0d32d02588522af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "FK_9bc6adad43db979425757825f8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_9a5f6868c96e0069e699f33e124"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_alerts" DROP CONSTRAINT "FK_dd7a63b6bd5211ed115841ddb89"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_reviews" DROP CONSTRAINT "FK_1d3fbb451c2b63d0a763f3ff5b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_images" DROP CONSTRAINT "FK_4f166bb8c2bfcef2498d97b4068"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_specs" DROP CONSTRAINT "FK_7ade97675e64f0a2abd6c5be81d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_26238c8b4af792b4dfc9835f3a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6120fec7382b0d32d02588522a"`,
    );
    await queryRunner.query(`DROP TABLE "product_tag_map"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_categories_industry_id"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP TABLE "industries"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_products_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_products_category_id"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(
      `DROP INDEX "public"."ux_alerts_user_product_active"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_price_alerts_product_id"`,
    );
    await queryRunner.query(`DROP TABLE "price_alerts"`);
    await queryRunner.query(`DROP INDEX "public"."ux_reviews_user_product"`);
    await queryRunner.query(`DROP TABLE "product_reviews"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_product_images_product_id"`,
    );
    await queryRunner.query(`DROP TABLE "product_images"`);
    await queryRunner.query(`DROP TABLE "tags"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_product_specs_product_id"`,
    );
    await queryRunner.query(`DROP TABLE "product_specs"`);
  }
}
