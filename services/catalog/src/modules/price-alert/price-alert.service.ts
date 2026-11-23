// Chép từ be/src/users/pricealert/pricealert.service.ts. Đổi do tách service (Component_Class_Design §2):
// - Mã lỗi: 404 sản phẩm → productNotFound() NT-CAT-1005; trùng → NT-CAT-1008; không thấy → NT-CAT-1009.
//   Câu chữ giữ be/.
// - create: hai request đồng thời vượt bước kiểm tra đọc → unique index ux_alerts_user_product_active
//   chặn ở DB, trả NT-CAT-1008 (quyết định B1).
// - Cron: bỏ MailService và JOIN alert.user (users ở identity). T2.5 chỉ đổi trạng thái theo lô;
//   T4.4 thêm outbox price.alert.triggered cùng transaction (Processing_Flow §4).
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { BusinessException, OutboxWriter } from '@nextech/service-kit';
import { In, Repository } from 'typeorm';
import { servicesConfig } from '../../config/configuration';
import { PriceAlert } from '../../database/entities/price-alert.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { isUniqueViolation } from '../../database/unique-violation';
import { CAT_ERROR, productNotFound } from '../../errors';
import { CreatePriceAlertDto } from './price-alert.dto';

// Số alert mỗi lô cron: một câu UPDATE mỗi lô, không phụ thuộc tổng số alert (non-functional §1)
const ALERT_BATCH = 100;

// Sự kiện price.alert.triggered (NT.MESSAGING API_Spec §3, T4.4)
const priceAlertEvents = new OutboxWriter('catalog');

interface TriggeredRow {
  id: string;
  user_id: string;
  product_id: string;
  product_name: string;
  current_price: string;
  target_price: string;
  notify_channel: string;
}

const alertExists = () =>
  new BusinessException(
    HttpStatus.CONFLICT,
    CAT_ERROR.ALERT_EXISTS,
    'Bạn đang theo dõi giá sản phẩm này rồi',
  );

@Injectable()
export class PriceAlertService {
  private readonly logger = new Logger(PriceAlertService.name);

  constructor(
    @InjectRepository(PriceAlert)
    private readonly alertRepo: Repository<PriceAlert>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductImage)
    private readonly imageRepo: Repository<ProductImage>,
  ) {}

  /**
   * GET /api/price-alerts — như be/: mọi theo dõi của người dùng, không phân trang (B20 giữ như be).
   * Số truy vấn 2 (alert JOIN sản phẩm, ảnh chính); không có alert thì 1.
   */
  async findMine(userId: string) {
    const alerts = await this.alertRepo.find({
      where: { user_id: userId },
      relations: { product: true },
      order: { created_at: 'DESC' },
    });

    const productIds = alerts.map((a) => a.product_id);
    const primaryImages = productIds.length
      ? await this.imageRepo.find({
          where: { product_id: In(productIds), is_primary: true },
        })
      : [];
    const imageMap = new Map(
      primaryImages.map((img) => [img.product_id, img.image_url]),
    );

    return alerts.map((a) => ({
      id: a.id,
      product: {
        id: a.product?.id,
        name: a.product?.name,
        price: a.product?.price,
        image: imageMap.get(a.product_id) ?? null,
      },
      target_price: a.target_price,
      status: a.status,
      notify_channel: a.notify_channel,
      created_at: a.created_at,
    }));
  }

  /** POST /api/price-alerts (BR-12). Số truy vấn 3 (sản phẩm, đang theo dõi, chèn). */
  async create(userId: string, dto: CreatePriceAlertDto) {
    const product = await this.productRepo.findOne({
      where: { id: dto.product_id },
    });
    if (!product) throw productNotFound();

    // Mỗi user chỉ theo dõi 1 sản phẩm 1 lần, tránh nhận nhiều thông báo trùng
    const existing = await this.alertRepo.findOne({
      where: { user_id: userId, product_id: dto.product_id, status: 'active' },
    });
    if (existing) throw alertExists();

    const alert = this.alertRepo.create({
      user_id: userId,
      product_id: dto.product_id,
      target_price: dto.target_price,
      notify_channel: dto.notify_channel ?? 'app',
      status: 'active',
    });
    let saved: PriceAlert;
    try {
      saved = await this.alertRepo.save(alert);
    } catch (err) {
      if (isUniqueViolation(err, 'ux_alerts_user_product_active')) {
        throw alertExists();
      }
      throw err;
    }

    return {
      id: saved.id,
      product_id: saved.product_id,
      target_price: saved.target_price,
      status: saved.status,
      notify_channel: saved.notify_channel,
    };
  }

  /** DELETE /api/price-alerts/:id — chỉ alert của chính người gọi. Số truy vấn ≤ 3. */
  async remove(userId: string, id: string) {
    const alert = await this.alertRepo.findOne({
      where: { id, user_id: userId },
    });
    if (!alert) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        CAT_ERROR.ALERT_NOT_FOUND,
        'Không tìm thấy theo dõi giá',
      );
    }

    alert.status = 'cancelled';
    await this.alertRepo.save(alert);

    return { message: 'Đã huỷ theo dõi giá' };
  }

  // Lịch đọc từ PRICE_ALERT_CRON lúc nạp module (mặc định mỗi 10 phút như be/). waitForCompletion:
  // lượt trước chưa xong thì bỏ lượt mới trong cùng tiến trình; nhiều bản catalog vẫn an toàn nhờ SQL.
  @Cron(servicesConfig().priceAlertCron, {
    name: 'price-alert-check',
    waitForCompletion: true,
  })
  async scheduledCheck(): Promise<void> {
    try {
      const n = await this.checkAndTriggerAlerts();
      if (n) this.logger.log(`Theo dõi giá: ${n} alert chạm ngưỡng`);
    } catch (err) {
      // Lỗi một lượt không làm dừng lịch; lượt sau chạy lại từ trạng thái trong DB
      this.logger.error(`Cron theo dõi giá lỗi: ${(err as Error)?.message}`);
    }
  }

  /**
   * Đổi alert active đã chạm giá sang triggered theo lô (Processing_Flow §4, bước T2.5). be/ đọc hết
   * rồi save từng alert (1 + n truy vấn); nay 1 truy vấn mỗi lô 100, không phụ thuộc số alert.
   * Không đổi trùng: chỉ dòng `UPDATE ... AND status='active'` thật sự đổi được mới được tính;
   * `SKIP LOCKED` để hai lượt chạy chồng (hoặc hai bản catalog) lấy lô khác nhau thay vì chờ nhau.
   * T4.4: chèn outbox price.alert.triggered cho đúng các dòng RETURNING, cùng transaction (một INSERT mỗi
   * lô). Một lần chạm ngưỡng chỉ một sự kiện: dòng đã triggered không khớp `status = 'active'` lần sau.
   * @returns số alert vừa chuyển triggered
   */
  async checkAndTriggerAlerts(): Promise<number> {
    let total = 0;
    for (;;) {
      const count = await this.alertRepo.manager.transaction(async (m) => {
        // Truy vấn thô: QueryBuilder không dựng được UPDATE với câu con JOIN + LIMIT + FOR UPDATE SKIP LOCKED.
        // Tham số hoá, không nối chuỗi. FROM products: lấy tên, giá hiện tại cho sự kiện.
        const [rows, n] = await m.query<[TriggeredRow[], number]>(
          `UPDATE price_alerts a SET status = 'triggered', triggered_at = now()
           FROM products p
           WHERE p.id = a.product_id AND a.status = 'active' AND a.id IN (
             SELECT x.id FROM price_alerts x
             JOIN products px ON px.id = x.product_id
             WHERE x.status = 'active' AND px.price <= x.target_price
             LIMIT $1
             FOR UPDATE OF x SKIP LOCKED
           )
           RETURNING a.id, a.user_id, a.product_id, p.name AS product_name,
                     p.price AS current_price, a.target_price, a.notify_channel`,
          [ALERT_BATCH],
        );
        await priceAlertEvents.enqueueMany(
          m,
          'price.alert.triggered',
          rows.map((r) => ({
            alert_id: r.id,
            user_id: r.user_id,
            product_id: r.product_id,
            product_name: r.product_name,
            current_price: Number(r.current_price),
            target_price: Number(r.target_price),
            channel: r.notify_channel,
          })),
        );
        return n;
      });
      total += count;
      if (count < ALERT_BATCH) return total;
    }
  }
}
