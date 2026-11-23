import type { ConfigService } from '@nestjs/config';
import {
  BusinessException,
  ResilientHttpClient,
  UpstreamBusinessError,
  UpstreamError,
} from '@nextech/service-kit';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CatalogClient, Facets } from '../../clients/catalog.client';
import { FptAiClient } from '../../clients/fpt-ai.client';
import { CatalogContextCache } from './catalog-context.cache';
import type { ChatMessageDto } from './chat.dto';
import { ChatService } from './chat.service';
import { SEARCH_PRODUCTS_TOOL } from './system-prompt';

// NT.ASSISTANT_CHAT Component_Class_Design §7: HTTP server giả cho FPT (đi qua ResilientHttpClient
// chế độ external thật), mock CatalogClient.

interface Captured {
  headers: http.IncomingHttpHeaders;
  body: {
    model: string;
    messages: { role: string; content: string; tool_call_id?: string }[];
    tools?: unknown[];
  };
}
type Reply = { status?: number; body?: unknown; delayMs?: number };

const CAT_ID = '22222222-2222-4222-8222-222222222222';
const FACETS: Facets = {
  brands: ['Sony', 'Apple'],
  categories: [{ id: CAT_ID, name: 'Tai nghe' }],
};
const PRODUCT = {
  id: 'p1',
  name: 'Sony WH-1000XM5',
  brand: 'Sony',
  price: '900000',
  rating: '4.5',
  primary_image: null,
  category_name: 'Tai nghe',
  tags: [],
};

const text = (content: string): Reply => ({
  body: { choices: [{ message: { content } }] },
});
const toolCall = (args: string, name = 'search_products'): Reply => ({
  body: {
    choices: [
      {
        message: {
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name, arguments: args },
            },
          ],
        },
      },
    ],
  },
});

describe('ChatService', () => {
  let server: http.Server;
  let baseUrl: string;
  let queue: Reply[];
  let captured: Captured[];
  let catalog: { facets: jest.Mock; search: jest.Mock };
  const savedToken = process.env.INTERNAL_API_TOKEN;

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = 'dev-internal-token';
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        captured.push({
          headers: req.headers,
          body: JSON.parse(raw) as Captured['body'],
        });
        const reply = queue.shift() ?? text('mặc định');
        setTimeout(() => {
          if (res.destroyed) return;
          res.writeHead(reply.status ?? 200, {
            'Content-Type': 'application/json',
          });
          res.end(JSON.stringify(reply.body ?? {}));
        }, reply.delayMs ?? 0).unref();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env.INTERNAL_API_TOKEN = savedToken;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    queue = [];
    captured = [];
    catalog = {
      facets: jest.fn().mockResolvedValue(FACETS),
      search: jest.fn().mockResolvedValue([PRODUCT]),
    };
  });

  function makeService(
    opts: { key?: string; callTimeoutMs?: number; budgetMs?: number } = {},
  ) {
    const values: Record<string, unknown> = {
      'ai.key': opts.key ?? 'test-key',
      'ai.budgetMs': opts.budgetMs ?? 5000,
      'ai.contextTtlMs': 300000,
    };
    const config = {
      get: (k: string) => values[k],
    } as unknown as ConfigService;
    const ai = new FptAiClient(
      new ResilientHttpClient({
        target: 'fpt-ai',
        baseUrl,
        external: true,
        headers: { Authorization: `Bearer ${opts.key ?? 'test-key'}` },
      }),
      {
        model: 'DeepSeek-V4-Flash',
        callTimeoutMs: opts.callTimeoutMs ?? 2000,
        tools: [SEARCH_PRODUCTS_TOOL],
      },
    );
    const cat = catalog as unknown as CatalogClient;
    const cache = new CatalogContextCache(cat, config);
    return new ChatService(ai, cat, cache, config);
  }

  async function expectError(
    call: Promise<unknown>,
    status: number,
    code: string,
  ) {
    const err = (await call.catch((e: unknown) => e)) as BusinessException;
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.getStatus()).toBe(status);
    expect(err.code).toBe(code);
    return err;
  }

  it('không cần công cụ: trả lời, products rỗng, có gửi tools ở lượt đầu', async () => {
    queue = [text('  Chào bạn  ')];
    const res = await makeService().chat({ message: 'xin chào' });

    expect(res).toEqual({ reply: 'Chào bạn', products: [] });
    expect(captured).toHaveLength(1);
    expect(captured[0].body.tools).toHaveLength(1);
    expect(captured[0].body.messages[0].role).toBe('system');
    expect(captured[0].body.messages[0].content).toContain('NexTech');
    expect(captured[0].body.messages[0].content).toContain('Sony, Apple');
    expect(captured[0].body.messages.at(-1)).toEqual({
      role: 'user',
      content: 'xin chào',
    });
  });

  it('một lượt công cụ: products lấy từ catalog (BR-13), AI nhận kết quả công cụ', async () => {
    queue = [
      toolCall(JSON.stringify({ category: 'tai nghe', maxPrice: 1000000 })),
      text('Có Sony WH-1000XM5'),
    ];
    const res = await makeService().chat({ message: 'tư vấn tai nghe' });

    expect(res.products).toEqual([PRODUCT]);
    expect(catalog.search).toHaveBeenCalledWith(
      {
        search: undefined,
        categoryId: CAT_ID, // tên danh mục khớp không phân biệt hoa thường → id
        brand: undefined,
        minPrice: undefined,
        maxPrice: 1000000,
      },
      expect.objectContaining({ deadline: expect.any(Number) as number }),
    );
    const second = captured[1].body.messages;
    expect(second.at(-2)?.role).toBe('assistant');
    expect(second.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
    });
    expect(JSON.parse(second.at(-1)!.content)).toEqual({ products: [PRODUCT] });
  });

  it('3 lượt công cụ liên tục: tổng 4 lần gọi, lượt cuối không gửi tools', async () => {
    queue = [
      toolCall('{"query":"a"}'),
      toolCall('{"query":"b"}'),
      toolCall('{"query":"c"}'),
      text('Xong'),
    ];
    const res = await makeService().chat({ message: 'laptop' });

    expect(res.reply).toBe('Xong');
    expect(captured).toHaveLength(4);
    expect(captured.slice(0, 3).every((c) => c.body.tools)).toBe(true);
    expect(captured[3].body.tools).toBeUndefined();
  });

  it('arguments sai JSON hoặc công cụ lạ: AI nhận error, câu vẫn trả lời được', async () => {
    queue = [toolCall('{không phải json'), text('Bạn nói rõ hơn nhé')];
    const res = await makeService().chat({ message: 'giá' });
    expect(res).toEqual({ reply: 'Bạn nói rõ hơn nhé', products: [] });
    expect(JSON.parse(captured[1].body.messages.at(-1)!.content)).toEqual({
      error: 'Tham số không hợp lệ',
    });
    expect(catalog.search).not.toHaveBeenCalled();

    captured = [];
    queue = [toolCall('{}', 'add_to_cart'), text('Mình chỉ tư vấn thôi')];
    await makeService().chat({ message: 'thêm giỏ' });
    expect(JSON.parse(captured[1].body.messages.at(-1)!.content)).toEqual({
      error: 'Công cụ không hỗ trợ',
    });
  });

  it('danh mục không khớp: bỏ bộ lọc danh mục, giữ query', async () => {
    queue = [toolCall('{"query":"AirPods","category":"Không có"}'), text('ok')];
    await makeService().chat({ message: 'airpods' });
    expect(catalog.search).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'AirPods', categoryId: undefined }),
      expect.anything(),
    );
  });

  it('catalog trả 4xx (tham số sai): báo lại cho AI, không dừng câu', async () => {
    catalog.search.mockRejectedValueOnce(
      new UpstreamBusinessError('catalog', 400, undefined, 'minPrice'),
    );
    queue = [toolCall('{"minPrice":-1}'), text('Giá không hợp lệ')];
    const res = await makeService().chat({ message: 'giá' });
    expect(res.reply).toBe('Giá không hợp lệ');
    expect(JSON.parse(captured[1].body.messages.at(-1)!.content)).toEqual({
      error: 'Tham số không hợp lệ',
    });
  });

  it.each([500, 401, 429])(
    'FPT trả %i: 503 NT-AST-1004, gọi đúng 1 lần, body không lộ chi tiết',
    async (status) => {
      queue = [
        { status, body: { error: 'FPT_KEY sai, model DeepSeek-V4-Flash' } },
      ];
      const err = await expectError(
        makeService().chat({ message: 'laptop' }),
        503,
        'NT-AST-1004',
      );
      expect(captured).toHaveLength(1);
      const body = JSON.stringify(err.getResponse());
      expect(body).not.toMatch(/FPT|DeepSeek|model|Chi tiết/i);
    },
  );

  it('FPT treo: 504 NT-AST-1005 trong khoảng AI_CALL_TIMEOUT_MS', async () => {
    queue = [{ ...text('muộn'), delayMs: 1500 }];
    const started = Date.now();
    await expectError(
      makeService({ callTimeoutMs: 200 }).chat({ message: 'laptop' }),
      504,
      'NT-AST-1005',
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('hết ngân sách giữa các lượt: 504, không gọi thêm', async () => {
    queue = [{ ...toolCall('{"query":"a"}'), delayMs: 400 }, text('không tới')];
    await expectError(
      makeService({ budgetMs: 300, callTimeoutMs: 2000 }).chat({
        message: 'laptop',
      }),
      504,
      'NT-AST-1005',
    );
    // Lần đầu bị cắt ở 300ms (ngân sách), không có lần gọi AI thứ hai, không tra catalog
    expect(captured).toHaveLength(1);
    expect(catalog.search).not.toHaveBeenCalled();
  });

  it('content rỗng: 503 NT-AST-1004', async () => {
    queue = [text('   ')];
    await expectError(
      makeService().chat({ message: 'hi' }),
      503,
      'NT-AST-1004',
    );
  });

  it('catalog lỗi hạ tầng khi tra: 503 NT-AST-1006 (BR-13)', async () => {
    catalog.search.mockRejectedValueOnce(
      new UpstreamError('catalog', 'timeout', 'unknown', 504),
    );
    queue = [toolCall('{"query":"a"}'), text('không tới')];
    await expectError(
      makeService().chat({ message: 'laptop' }),
      503,
      'NT-AST-1006',
    );
    expect(captured).toHaveLength(1);
  });

  it('facets lỗi, chưa có bản cũ: 503 NT-AST-1006, không gọi AI', async () => {
    catalog.facets.mockRejectedValueOnce(
      new UpstreamError('catalog', 'ECONNREFUSED', 'not_executed', 503),
    );
    await expectError(
      makeService().chat({ message: 'hi' }),
      503,
      'NT-AST-1006',
    );
    expect(captured).toHaveLength(0);
  });

  it('FPT_KEY rỗng: 503 NT-AST-1003, không gọi FPT, không gọi catalog', async () => {
    await expectError(
      makeService({ key: '' }).chat({ message: 'hi' }),
      503,
      'NT-AST-1003',
    );
    expect(captured).toHaveLength(0);
    expect(catalog.facets).not.toHaveBeenCalled();
  });

  it('history 50 phần tử: chỉ gửi 20 cuối, bỏ phần tử sai, đổi model → assistant', async () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 ? 'model' : 'user',
      text: `tin ${i}`,
    }));
    // Dữ liệu từ client không qua validate từng phần tử: ép kiểu để giả lập phần tử sai
    const dirty = [
      ...history.slice(0, 49),
      { role: 'hacker', text: 'x' },
      { role: 'user', text: '' },
      history[49],
    ] as unknown as ChatMessageDto[];
    queue = [text('ok')];
    await makeService().chat({ message: 'câu mới', history: dirty });

    const msgs = captured[0].body.messages;
    expect(msgs).toHaveLength(1 + 20 + 1);
    expect(msgs[1]).toEqual({ role: 'user', content: 'tin 30' });
    expect(msgs[20]).toEqual({ role: 'assistant', content: 'tin 49' });
  });

  it('server FPT giả không nhận X-Internal-Token, có Authorization Bearer', async () => {
    queue = [text('ok')];
    await makeService({ key: 'k-123' }).chat({ message: 'hi' });
    expect(captured[0].headers['x-internal-token']).toBeUndefined();
    expect(captured[0].headers['x-request-id']).toBeUndefined();
    expect(captured[0].headers.authorization).toBe('Bearer k-123');
    expect(captured[0].body.model).toBe('DeepSeek-V4-Flash');
  });
});

describe('CatalogContextCache', () => {
  const config = { get: () => 1000 } as unknown as ConfigService;

  it('giữ trong TTL: chỉ gọi catalog 1 lần', async () => {
    const catalog = { facets: jest.fn().mockResolvedValue(FACETS) };
    const cache = new CatalogContextCache(
      catalog as unknown as CatalogClient,
      config,
    );
    await cache.get();
    await cache.get();
    expect(catalog.facets).toHaveBeenCalledTimes(1);
  });

  it('hết hạn, catalog lỗi, có bản cũ: dùng bản cũ', async () => {
    const catalog = {
      facets: jest
        .fn()
        .mockResolvedValueOnce(FACETS)
        .mockRejectedValueOnce(new Error('down')),
    };
    const cache = new CatalogContextCache(
      catalog as unknown as CatalogClient,
      { get: () => 0 } as unknown as ConfigService,
    );
    await cache.get();
    await expect(cache.get()).resolves.toEqual(FACETS);
    expect(catalog.facets).toHaveBeenCalledTimes(2);
  });
});
