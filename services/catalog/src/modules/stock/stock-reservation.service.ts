import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { BusinessException } from '@nextech/service-kit';
import { Product } from '../../database/entities/product.entity';
import {
  StockReservation,
  StockReservationStatus,
} from '../../database/entities/stock-reservation.entity';
import { StockReservationItem } from '../../database/entities/stock-reservation-item.entity';
import { CAT_ERROR } from '../../errors';

export interface ReserveItem {
  product_id: string;
  quantity: number;
}

export interface ReservationResponse {
  order_id: string;
  status: StockReservationStatus;
}

export interface ReserveResult {
  /** true: vừa giữ (201). false: đã giữ từ trước, không trừ thêm (200) */
  created: boolean;
  reservation: ReservationResponse;
}

// Sắp theo product_id: hai đơn có chung sản phẩm luôn khoá dòng cùng thứ tự, tránh deadlock
const byProductId = (a: ReserveItem, b: ReserveItem) =>
  a.product_id < b.product_id ? -1 : a.product_id > b.product_id ? 1 : 0;

// Giữ kho / nhả kho cho một đơn (NT.CATALOG Component_Class_Design §5, Processing_Flow §1–2).
// Trừ kho nguyên tử chép từ be/src/users/order/order-inventory.util.ts#reserveStock;
// đổi do tách service: lỗi 409 có mã NT-CAT-1001/1002 thay BadRequestException, thêm điều kiện is_active.
@Injectable()
export class StockReservationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Idempotent theo order_id, tất cả sản phẩm cùng thành công hoặc không sản phẩm nào.
   * Số truy vấn (ngoại lệ ngưỡng ghi, Processing_Flow §1): mới 2 + N, thiếu hàng +1; gọi lại 2.
   */
  async reserve(orderId: string, items: ReserveItem[]): Promise<ReserveResult> {
    return this.dataSource.transaction(async (m) => {
      // Khoá chính chặn hai lệnh cùng order_id: lệnh sau chờ lệnh trước commit/rollback
      const inserted = await m
        .createQueryBuilder()
        .insert()
        .into(StockReservation)
        .values({ order_id: orderId, status: 'reserved' })
        .orIgnore()
        .returning('order_id')
        .execute();

      if (!(inserted.raw as unknown[]).length) {
        const existing = await m.findOneByOrFail(StockReservation, {
          order_id: orderId,
        });
        if (existing.status === 'released') {
          throw new BusinessException(
            HttpStatus.CONFLICT,
            CAT_ERROR.RESERVATION_RELEASED,
            'Phiếu giữ kho của đơn này đã bị huỷ',
          );
        }
        return {
          created: false,
          reservation: { order_id: orderId, status: 'reserved' },
        };
      }

      const sorted = [...items].sort(byProductId);
      for (const item of sorted) {
        await this.takeStock(m, item);
      }
      // Một lệnh cho mọi dòng phiếu
      await m.insert(
        StockReservationItem,
        sorted.map((i) => ({
          order_id: orderId,
          product_id: i.product_id,
          quantity: i.quantity,
        })),
      );
      return {
        created: true,
        reservation: { order_id: orderId, status: 'reserved' },
      };
    });
  }

  /** Số truy vấn: 1 */
  async get(orderId: string): Promise<ReservationResponse> {
    const r = await this.dataSource.getRepository(StockReservation).findOne({
      select: { order_id: true, status: true },
      where: { order_id: orderId },
    });
    if (!r) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        CAT_ERROR.RESERVATION_NOT_FOUND,
        'Không tìm thấy phiếu giữ kho',
      );
    }
    return { order_id: r.order_id, status: r.status };
  }

  /**
   * Idempotent, luôn thành công. Chưa có phiếu thì tạo tombstone `released` để chặn lệnh giữ đến muộn.
   * Số truy vấn (ngoại lệ ngưỡng ghi, Processing_Flow §2): có phiếu reserved 4 + N; còn lại 2.
   */
  async release(
    orderId: string,
  ): Promise<{ status: 'released'; restored: boolean }> {
    return this.dataSource.transaction(async (m) => {
      // Truy vấn thô: cần ON CONFLICT (order_id) DO NOTHING trước khi khoá — dòng chưa có thì
      // FOR UPDATE không khoá được gì, còn INSERT thường gặp reserve chưa commit sẽ lỗi 23505.
      // Postgres chờ reserve đang chạy commit/rollback trên khoá chính rồi mới quyết định.
      await m.query(
        `INSERT INTO stock_reservations (order_id, status, released_at) VALUES ($1, 'released', now())
         ON CONFLICT (order_id) DO NOTHING`,
        [orderId],
      );
      const r = await m.findOneOrFail(StockReservation, {
        where: { order_id: orderId },
        lock: { mode: 'pessimistic_write' },
      });

      // Tombstone vừa chèn, hoặc đã nhả từ trước
      if (r.status === 'released')
        return { status: 'released', restored: false };

      const items = await m.find(StockReservationItem, {
        select: { product_id: true, quantity: true },
        where: { order_id: orderId },
        order: { product_id: 'ASC' },
      });
      // Cộng từng dòng theo thứ tự id — cùng thứ tự khoá với reserve, không khoá chéo.
      // Sản phẩm đã bị xoá: UPDATE không ảnh hưởng dòng nào, bỏ qua (be/ releaseOrderResources).
      for (const item of items) {
        await m
          .createQueryBuilder()
          .update(Product)
          .set({ stock_quantity: () => 'stock_quantity + :qty' })
          .where('id = :id')
          .setParameters({ id: item.product_id, qty: item.quantity })
          .execute();
      }
      await m.update(
        StockReservation,
        { order_id: orderId },
        { status: 'released', released_at: () => 'now()' },
      );
      return { status: 'released', restored: true };
    });
  }

  // Lỗi ném ra rollback cả transaction, kể cả dòng phiếu vừa thêm
  private async takeStock(m: EntityManager, item: ReserveItem): Promise<void> {
    const result = await m
      .createQueryBuilder()
      .update(Product)
      .set({ stock_quantity: () => 'stock_quantity - :qty' })
      .where('id = :id AND is_active = true AND stock_quantity >= :qty')
      .setParameters({ id: item.product_id, qty: item.quantity })
      .execute();
    if (result.affected) return;

    // Chỉ đọc khi thất bại, để biết nên báo mã nào
    const p = await m.findOne(Product, {
      select: { id: true, name: true, is_active: true },
      where: { id: item.product_id },
    });
    if (p?.is_active) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        CAT_ERROR.OUT_OF_STOCK,
        `Sản phẩm "${p.name}" không đủ hàng trong kho`,
      );
    }
    throw new BusinessException(
      HttpStatus.CONFLICT,
      CAT_ERROR.PRODUCT_UNAVAILABLE,
      `Sản phẩm "${p?.name ?? item.product_id}" hiện không khả dụng`,
    );
  }
}
