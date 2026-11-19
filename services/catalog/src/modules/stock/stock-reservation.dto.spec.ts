import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReserveStockDto } from './stock-reservation.dto';

// Ràng buộc body POST /internal/stock-reservations (NT.CATALOG API_Spec §2, bước 0 → 400 NT-GEN-0001).
// Cùng tuỳ chọn với ValidationPipe của bootstrapService (whitelist, forbidNonWhitelisted).
async function errorsOf(body: unknown): Promise<string[]> {
  const dto = plainToInstance(ReserveStockDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

const item = (over: Record<string, unknown> = {}) => ({
  product_id: randomUUID(),
  quantity: 1,
  ...over,
});

describe('ReserveStockDto', () => {
  it('body hợp lệ → không lỗi', async () => {
    expect(
      await errorsOf({ order_id: randomUUID(), items: [item(), item()] }),
    ).toEqual([]);
  });

  it('tối đa 100 dòng → không lỗi', async () => {
    const items = Array.from({ length: 100 }, () => item());
    expect(await errorsOf({ order_id: randomUUID(), items })).toEqual([]);
  });

  it.each([
    [
      'order_id không phải uuid',
      { order_id: 'abc', items: [item()] },
      'order_id',
    ],
    ['thiếu items', { order_id: randomUUID() }, 'items'],
    ['items rỗng', { order_id: randomUUID(), items: [] }, 'items'],
    [
      'quá 100 dòng',
      {
        order_id: randomUUID(),
        items: Array.from({ length: 101 }, () => item()),
      },
      'items',
    ],
    [
      'quantity 0',
      { order_id: randomUUID(), items: [item({ quantity: 0 })] },
      'items',
    ],
    [
      'quantity lẻ',
      { order_id: randomUUID(), items: [item({ quantity: 1.5 })] },
      'items',
    ],
    [
      'product_id không phải uuid',
      { order_id: randomUUID(), items: [item({ product_id: 'x' })] },
      'items',
    ],
    [
      'trường lạ trong dòng',
      { order_id: randomUUID(), items: [item({ price: 1 })] },
      'items',
    ],
  ])('%s → lỗi ở %s', async (_name, body, property) => {
    expect(await errorsOf(body)).toContain(property);
  });

  it('product_id trùng → lỗi ở items', async () => {
    const id = randomUUID();
    expect(
      await errorsOf({
        order_id: randomUUID(),
        items: [
          item({ product_id: id }),
          item({ product_id: id, quantity: 2 }),
        ],
      }),
    ).toEqual(['items']);
  });

  // Postgres so uuid không phân biệt hoa/thường; DTO phải chuẩn hoá để chặn trùng và giữ thứ tự khoá (review T2.4)
  it('product_id trùng khác hoa/thường → lỗi ở items', async () => {
    const id = randomUUID();
    expect(
      await errorsOf({
        order_id: randomUUID(),
        items: [
          item({ product_id: id }),
          item({ product_id: id.toUpperCase() }),
        ],
      }),
    ).toEqual(['items']);
  });

  it('product_id viết hoa → đổi về chữ thường', () => {
    const id = randomUUID();
    const dto = plainToInstance(ReserveStockDto, {
      order_id: randomUUID(),
      items: [item({ product_id: id.toUpperCase() })],
    });
    expect(dto.items[0].product_id).toBe(id);
  });
});
