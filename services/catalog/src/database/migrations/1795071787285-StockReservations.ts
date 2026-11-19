// Sinh bằng `npm run migration:generate` trên Postgres thật (T2.4). Đối chiếu NT.CATALOG API_Spec §6:
// stock_reservations (PK order_id), stock_reservation_items (PK order_id + product_id, quantity > 0,
// FK order_id ON DELETE CASCADE, không FK product_id).
import { MigrationInterface, QueryRunner } from 'typeorm';

export class StockReservations1795071787285 implements MigrationInterface {
  name = 'StockReservations1795071787285';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "stock_reservations" ("order_id" uuid NOT NULL, "status" character varying(20) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "released_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d904f70cd085fa7af754778fcb2" PRIMARY KEY ("order_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_reservation_items" ("order_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" integer NOT NULL, CONSTRAINT "CHK_stock_reservation_items_quantity" CHECK ("quantity" > 0), CONSTRAINT "PK_dc69e391e6adb678653606bcc2a" PRIMARY KEY ("order_id", "product_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_reservation_items" ADD CONSTRAINT "FK_a9a235faed767c6c903b9c78c61" FOREIGN KEY ("order_id") REFERENCES "stock_reservations"("order_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stock_reservation_items" DROP CONSTRAINT "FK_a9a235faed767c6c903b9c78c61"`,
    );
    await queryRunner.query(`DROP TABLE "stock_reservation_items"`);
    await queryRunner.query(`DROP TABLE "stock_reservations"`);
  }
}
