import type { Repository } from 'typeorm';
import type { OrderItem } from '../database/entities/order-item.entity';
import { PurchasesInternalService } from './purchases.internal.service';

// GET /internal/purchases/check (NT.ORDER API_Spec §2, BR-11). Hành vi với dữ liệu thật:
// purchases.internal.service.int-spec.ts.
describe('PurchasesInternalService.hasPurchased', () => {
  const qb = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getExists: jest.fn(),
  };
  const itemRepo = { createQueryBuilder: jest.fn(() => qb) };
  const service = new PurchasesInternalService(
    itemRepo as unknown as Repository<OrderItem>,
  );

  beforeEach(() => jest.clearAllMocks());

  it('một truy vấn EXISTS: đúng người, đúng sản phẩm, đơn paid hoặc shipped', async () => {
    qb.getExists.mockResolvedValue(true);

    await expect(service.hasPurchased('u1', 'p1')).resolves.toEqual({
      purchased: true,
    });
    expect(qb.where).toHaveBeenCalledWith('item.product_id = :productId', {
      productId: 'p1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('o.user_id = :userId', {
      userId: 'u1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('o.status IN (:...statuses)', {
      statuses: ['paid', 'shipped'],
    });
    expect(qb.getExists).toHaveBeenCalledTimes(1);
  });

  it('không có → { purchased: false }', async () => {
    qb.getExists.mockResolvedValue(false);
    await expect(service.hasPurchased('u1', 'p1')).resolves.toEqual({
      purchased: false,
    });
  });
});
