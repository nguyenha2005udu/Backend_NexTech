import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProductService } from '../modules/product/product.service';
import { ProductsInternalController } from './products.internal.controller';
import { ProductsInternalService } from './products.internal.service';

// T8.4: GET /internal/products/search, /internal/products/facets (NT.CATALOG API_Spec §2, CHANGELOG v1.1).
// Chỉ kiểm lớp HTTP: DTO, chặn limit, guard nội bộ. Truy vấn thật nằm ở ProductService (đã có test).

const TOKEN = 'dev-internal-token';
const CAT = '11111111-1111-4111-8111-111111111111';

describe('ProductsInternalController (search, facets)', () => {
  let app: INestApplication;
  let productService: {
    findAll: jest.Mock;
    findAllBrands: jest.Mock;
    findAllCategories: jest.Mock;
  };
  const saved = process.env.INTERNAL_API_TOKEN;

  beforeAll(() => (process.env.INTERNAL_API_TOKEN = TOKEN));
  afterAll(() => (process.env.INTERNAL_API_TOKEN = saved));

  beforeEach(async () => {
    productService = {
      findAll: jest.fn().mockResolvedValue({
        items: [{ id: 'p1', name: 'Tai nghe A', price: '900000' }],
        total: 1,
        page: 1,
        limit: 6,
        totalPages: 1,
      }),
      findAllBrands: jest.fn().mockResolvedValue(['Apple', 'Sony']),
      findAllCategories: jest
        .fn()
        .mockResolvedValue([{ id: CAT, name: 'Tai nghe' }]),
    };
    const mod = await Test.createTestingModule({
      controllers: [ProductsInternalController],
      providers: [
        { provide: ProductService, useValue: productService },
        { provide: ProductsInternalService, useValue: {} },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(() => app.close());

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('X-Internal-Token', TOKEN);

  it('search: chuyển đủ bộ lọc, mặc định limit 6, trả { items }', async () => {
    const res = await get(
      `/internal/products/search?search=tai%20nghe&categoryId=${CAT}&brand=Sony&minPrice=0&maxPrice=1000000`,
    ).expect(200);

    expect(res.body).toEqual({
      items: [{ id: 'p1', name: 'Tai nghe A', price: '900000' }],
    });
    expect(productService.findAll).toHaveBeenCalledWith({
      search: 'tai nghe',
      categoryId: CAT,
      brand: 'Sony',
      minPrice: 0,
      maxPrice: 1000000,
      page: 1,
      limit: 6,
    });
  });

  it('search: limit lớn hơn 6 bị chặn còn 6, nhỏ hơn thì giữ', async () => {
    await get('/internal/products/search?limit=50').expect(200);
    expect(productService.findAll).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 6 }),
    );

    await get('/internal/products/search?limit=2').expect(200);
    expect(productService.findAll).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 2 }),
    );
  });

  it('search: tham số sai thì 400 (giá âm, categoryId không phải uuid)', async () => {
    await get('/internal/products/search?minPrice=-1').expect(400);
    await get('/internal/products/search?categoryId=abc').expect(400);
    expect(productService.findAll).not.toHaveBeenCalled();
  });

  it('facets: trả hãng và danh mục', async () => {
    const res = await get('/internal/products/facets').expect(200);
    expect(res.body).toEqual({
      brands: ['Apple', 'Sony'],
      categories: [{ id: CAT, name: 'Tai nghe' }],
    });
  });

  it('không có X-Internal-Token: 401', async () => {
    await request(app.getHttpServer())
      .get('/internal/products/search')
      .expect(401);
    await request(app.getHttpServer())
      .get('/internal/products/facets')
      .expect(401);
  });
});
