// Chép từ be/src/users/cart/cart.service.ts. Đổi do tách service (NT.ORDER Component_Class_Design §2):
// - Bỏ productRepo, imageRepo: sản phẩm, tồn kho, ảnh lấy qua CatalogClient.getProducts (1 lời gọi lô).
// - GET khi catalog lỗi: 200 degraded (API_Spec §1); thêm/sửa khi catalog lỗi: UpstreamError → 503.
// - findOrCreateCart chịu được 2 request đồng thời nhờ UNIQUE(user_id) + ON CONFLICT DO NOTHING.
// - Lỗi thêm mã NT-ORD-* (ADR-0009), câu chữ giữ nguyên be/.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UpstreamError } from '@nextech/service-kit';
import { Repository } from 'typeorm';
import { CatalogClient, CatalogProduct } from '../../clients/catalog.client';
import { Cart } from '../../database/entities/cart.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { cartItemNotFound, outOfStock, productNotFound } from '../../errors';
import { AddCartItemDto, UpdateCartItemDto } from './cart.dto';

interface CartLine {
  id: string;
  product: {
    id: string;
    name: string | null;
    // be/ trả chuỗi: cột bigint, pg không ép int8 sang số
    price: string | null;
    image: string | null;
  };
  quantity: number;
  /** Chỉ có khi sản phẩm không còn ở catalog */
  unavailable?: true;
}

export interface CartView {
  id: string;
  items: CartLine[];
  subtotal: number | null;
  /** Chỉ có khi catalog lỗi */
  degraded?: true;
}

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepo: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepo: Repository<CartItem>,
    private readonly catalog: CatalogClient,
  ) {}

  // Mỗi user chỉ có 1 giỏ hàng, tự tạo nếu chưa có.
  // Thường 1 truy vấn; lần đầu 2; thua đua với request khác (ON CONFLICT bỏ qua) thì đọc lại: 3.
  private async findOrCreateCart(userId: string): Promise<Cart> {
    const cart = await this.cartRepo.findOne({ where: { user_id: userId } });
    if (cart) return cart;

    const inserted = await this.cartRepo
      .createQueryBuilder()
      .insert()
      .into(Cart)
      .values({ user_id: userId })
      .orIgnore()
      .returning('*')
      .execute();
    const row = inserted.raw as Cart[];
    if (row.length) return row[0];

    return this.cartRepo.findOneOrFail({ where: { user_id: userId } });
  }

  // GET /api/cart
  async getMyCart(userId: string): Promise<CartView> {
    const cart = await this.findOrCreateCart(userId);

    const items = await this.cartItemRepo.find({
      where: { cart_id: cart.id },
      order: { added_at: 'ASC' },
    });

    // Giỏ trống thì không gọi catalog (Processing_Flow §1)
    if (!items.length) return { id: cart.id, items: [], subtotal: 0 };

    let products: Map<string, CatalogProduct>;
    try {
      const list = await this.catalog.getProducts(
        items.map((i) => i.product_id),
      );
      products = new Map(list.map((p) => [p.id, p]));
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      return {
        id: cart.id,
        items: items.map((item) => ({
          id: item.id,
          product: {
            id: item.product_id,
            name: null,
            price: null,
            image: null,
          },
          quantity: item.quantity,
        })),
        subtotal: null,
        degraded: true,
      };
    }

    let subtotal = 0;
    const mappedItems = items.map((item): CartLine => {
      const product = products.get(item.product_id);
      if (!product) {
        // Sản phẩm đã bị xoá ở catalog (be/ không gặp: FK cascade xoá dòng giỏ theo)
        return {
          id: item.id,
          product: {
            id: item.product_id,
            name: null,
            price: null,
            image: null,
          },
          quantity: item.quantity,
          unavailable: true,
        };
      }
      const price = Number(product.price);
      subtotal += price * item.quantity;

      return {
        id: item.id,
        product: {
          id: product.id,
          name: product.name,
          price: String(product.price),
          image: product.image ?? null,
        },
        quantity: item.quantity,
      };
    });

    return { id: cart.id, items: mappedItems, subtotal };
  }

  private assertInStock(product: CatalogProduct, quantity: number) {
    if (quantity > product.stock_quantity) {
      throw outOfStock(product.name, product.stock_quantity);
    }
  }

  // Lấy một sản phẩm qua catalog. Catalog lỗi: UpstreamError truyền lên (503/504).
  private async getProduct(id: string): Promise<CatalogProduct | undefined> {
    const [product] = await this.catalog.getProducts([id]);
    return product;
  }

  // POST /api/cart/items
  async addItem(userId: string, dto: AddCartItemDto) {
    const cart = await this.findOrCreateCart(userId);

    const product = await this.getProduct(dto.product_id);
    if (!product || !product.is_active) throw productNotFound();

    const quantity = dto.quantity ?? 1;

    let item = await this.cartItemRepo.findOne({
      where: { cart_id: cart.id, product_id: dto.product_id },
    });

    // Chỉ là kiểm tra sớm cho UX; giữ kho thật sự ở checkout (BR-01, catalog)
    this.assertInStock(product, (item?.quantity ?? 0) + quantity);

    if (item) {
      // Sản phẩm đã có trong giỏ -> cộng dồn số lượng
      item.quantity += quantity;
      item = await this.cartItemRepo.save(item);
    } else {
      item = this.cartItemRepo.create({
        cart_id: cart.id,
        product_id: dto.product_id,
        quantity,
      });
      item = await this.cartItemRepo.save(item);
    }

    return {
      id: item.id,
      product_id: item.product_id,
      quantity: item.quantity,
      added_at: item.added_at,
    };
  }

  // PUT /api/cart/items/:id
  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const cart = await this.findOrCreateCart(userId);

    const item = await this.cartItemRepo.findOne({
      where: { id: itemId, cart_id: cart.id },
    });
    if (!item) throw cartItemNotFound();

    // be/ dùng item.product (JOIN). Sản phẩm đã bị xoá ở catalog → 404 (sổ A8)
    const product = await this.getProduct(item.product_id);
    if (!product) throw productNotFound();

    this.assertInStock(product, dto.quantity);
    item.quantity = dto.quantity;
    const saved = await this.cartItemRepo.save(item);

    return {
      id: saved.id,
      quantity: saved.quantity,
      updated_at: saved.updated_at,
    };
  }

  // DELETE /api/cart/items/:id
  async removeItem(userId: string, itemId: string) {
    const cart = await this.findOrCreateCart(userId);

    const item = await this.cartItemRepo.findOne({
      where: { id: itemId, cart_id: cart.id },
    });
    if (!item) throw cartItemNotFound();

    await this.cartItemRepo.remove(item);
    return { message: 'Đã xoá sản phẩm khỏi giỏ hàng' };
  }
}
