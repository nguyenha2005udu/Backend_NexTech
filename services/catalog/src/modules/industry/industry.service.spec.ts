import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Industry } from '../../database/entities/industry.entity';
import { Product } from '../../database/entities/product.entity';
import { IndustryService } from './industry.service';

// Chép từ be/src/users/industry/industry.service.ts. Đổi: findAll đếm sản phẩm bằng một truy vấn GROUP BY
// thay vì count trong vòng lặp (quyết định B12, Processing_Flow §5); findOne lấy ngành + danh mục bằng một
// QueryBuilder không take (quyết định B17). Response phải giữ nguyên như be/.

/** QueryBuilder giả: mọi hàm nối chuỗi trả chính nó, getRawMany trả `rows` */
function fakeQb(rows: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue(rows);
  return qb;
}

const cat = (id: string, sortOrder: number, isActive = true) => ({
  id,
  name: `Danh mục ${id}`,
  icon: null,
  sortOrder,
  isActive,
});

/** QueryBuilder giả cho ngành: getOne trả `row` */
function fakeIndustryQb(row: unknown) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['leftJoinAndSelect', 'where', 'andWhere']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getOne = jest.fn().mockResolvedValue(row);
  return qb;
}

/** QueryBuilder giả cho sản phẩm của findOne: getCount, getMany */
function fakeProductQb(total: number, rows: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getCount = jest.fn().mockResolvedValue(total);
  qb.getMany = jest.fn().mockResolvedValue(rows);
  return qb;
}

describe('IndustryService', () => {
  let industryRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let industryQb: Record<string, jest.Mock>;
  let productRepo: { count: jest.Mock; createQueryBuilder: jest.Mock };
  let service: IndustryService;

  beforeEach(() => {
    industryQb = fakeIndustryQb(null);
    industryRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => industryQb),
    };
    productRepo = { count: jest.fn(), createQueryBuilder: jest.fn() };
    service = new IndustryService(
      industryRepo as unknown as Repository<Industry>,
      productRepo as unknown as Repository<Product>,
    );
  });

  describe('findAll', () => {
    it('đếm sản phẩm một lần cho mọi danh mục (không count trong vòng lặp), response như be/', async () => {
      industryRepo.find.mockResolvedValue([
        {
          id: 'i1',
          name: 'Điện tử',
          icon: '💻',
          sort_order: 1,
          categories: [cat('c2', 2), cat('c1', 1), cat('c3', 3, false)],
        },
        {
          id: 'i2',
          name: 'Gia dụng',
          icon: null,
          sort_order: 2,
          categories: [cat('c4', 1)],
        },
      ]);
      const qb = fakeQb([
        { category_id: 'c1', count: '5' },
        { category_id: 'c4', count: '2' },
      ]);
      productRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.findAll();

      expect(industryRepo.find).toHaveBeenCalledWith({
        where: { is_active: true },
        relations: { categories: true },
        order: { sort_order: 'ASC' },
      });
      expect(productRepo.count).not.toHaveBeenCalled();
      expect(productRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      // Chỉ đếm danh mục đang bật, chỉ sản phẩm đang bán
      expect(qb.where).toHaveBeenCalledWith(
        'product.category_id IN (:...ids)',
        {
          ids: ['c1', 'c2', 'c4'],
        },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('product.is_active = true');
      expect(qb.groupBy).toHaveBeenCalledWith('product.category_id');

      expect(res).toEqual({
        items: [
          {
            id: 'i1',
            name: 'Điện tử',
            icon: '💻',
            sort_order: 1,
            categories: [
              {
                id: 'c1',
                name: 'Danh mục c1',
                icon: null,
                sort_order: 1,
                product_count: 5,
              },
              {
                id: 'c2',
                name: 'Danh mục c2',
                icon: null,
                sort_order: 2,
                product_count: 0,
              },
            ],
          },
          {
            id: 'i2',
            name: 'Gia dụng',
            icon: null,
            sort_order: 2,
            categories: [
              {
                id: 'c4',
                name: 'Danh mục c4',
                icon: null,
                sort_order: 1,
                product_count: 2,
              },
            ],
          },
        ],
        total: 2,
      });
    });

    it('không có danh mục nào đang bật → không truy vấn đếm', async () => {
      industryRepo.find.mockResolvedValue([
        {
          id: 'i1',
          name: 'Điện tử',
          icon: null,
          sort_order: 1,
          categories: [cat('c1', 1, false)],
        },
      ]);

      const res = await service.findAll();

      expect(productRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(res.items[0].categories).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('không có → 404 "Không tìm thấy ngành học"', async () => {
      const err = (await service
        .findOne('i1', {})
        .catch((e: unknown) => e)) as NotFoundException;
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Không tìm thấy ngành học');
    });

    it('không kèm sản phẩm → danh mục đang bật, theo sort_order, không truy vấn sản phẩm', async () => {
      industryQb.getOne.mockResolvedValue({
        id: 'i1',
        name: 'Điện tử',
        icon: null,
        categories: [cat('c2', 2), cat('c1', 1), cat('c3', 3, false)],
      });

      await expect(service.findOne('i1', {})).resolves.toEqual({
        id: 'i1',
        name: 'Điện tử',
        icon: null,
        categories: [
          { id: 'c1', name: 'Danh mục c1', icon: null, sort_order: 1 },
          { id: 'c2', name: 'Danh mục c2', icon: null, sort_order: 2 },
        ],
      });
      expect(productRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('B17: lấy ngành + danh mục bằng một QueryBuilder, không dùng findOne kèm relations', async () => {
      industryQb.getOne.mockResolvedValue({
        id: 'i1',
        name: 'Điện tử',
        icon: null,
        categories: [],
      });

      await service.findOne('i1', {});

      expect(industryRepo.findOne).not.toHaveBeenCalled();
      expect(industryRepo.createQueryBuilder).toHaveBeenCalledWith('industry');
      expect(industryQb.leftJoinAndSelect).toHaveBeenCalledWith(
        'industry.categories',
        'category',
      );
      expect(industryQb.where).toHaveBeenCalledWith('industry.id = :id', {
        id: 'i1',
      });
      expect(industryQb.andWhere).toHaveBeenCalledWith(
        'industry.is_active = true',
      );
      expect(industryQb.getOne).toHaveBeenCalledTimes(1);
    });

    it('kèm sản phẩm → nhóm theo danh mục, có phân trang, response như be/', async () => {
      industryQb.getOne.mockResolvedValue({
        id: 'i1',
        name: 'Điện tử',
        icon: null,
        categories: [cat('c2', 2), cat('c1', 1), cat('c3', 3, false)],
      });
      const pqb = fakeProductQb(3, [
        {
          id: 'p1',
          category_id: 'c1',
          name: 'SP1',
          brand: 'B',
          price: '10',
          rating: null,
          images: [{ image_url: 'u1' }],
        },
        {
          id: 'p2',
          category_id: 'c2',
          name: 'SP2',
          brand: null,
          price: '20',
          rating: 4,
          images: [],
        },
      ]);
      productRepo.createQueryBuilder.mockReturnValue(pqb);

      const res = await service.findOne('i1', {
        include_products: true,
        page: 1,
        limit: 2,
      });

      expect(pqb.where).toHaveBeenCalledWith(
        'product.category_id IN (:...categoryIds)',
        { categoryIds: ['c1', 'c2'] },
      );
      expect(pqb.skip).toHaveBeenCalledWith(0);
      expect(pqb.take).toHaveBeenCalledWith(2);
      expect(res).toEqual({
        id: 'i1',
        name: 'Điện tử',
        icon: null,
        categories: [
          {
            id: 'c1',
            name: 'Danh mục c1',
            icon: null,
            sort_order: 1,
            products: [
              {
                id: 'p1',
                name: 'SP1',
                brand: 'B',
                price: '10',
                rating: null,
                primary_image: 'u1',
              },
            ],
          },
          {
            id: 'c2',
            name: 'Danh mục c2',
            icon: null,
            sort_order: 2,
            products: [
              {
                id: 'p2',
                name: 'SP2',
                brand: null,
                price: '20',
                rating: 4,
                primary_image: null,
              },
            ],
          },
        ],
        pagination: { total: 3, page: 1, limit: 2, totalPages: 2 },
      });
    });
  });
});
