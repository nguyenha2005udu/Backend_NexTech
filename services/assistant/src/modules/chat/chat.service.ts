import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpstreamBusinessError } from '@nextech/service-kit';
import {
  CatalogClient,
  type Facets,
  type ProductItem,
  type SearchParams,
} from '../../clients/catalog.client';
import {
  FptAiClient,
  type AiMessage,
  type AiToolCall,
} from '../../clients/fpt-ai.client';
import {
  aiNotConfigured,
  aiTimeout,
  aiUnavailable,
  catalogUnavailable,
} from '../../errors';
import { CatalogContextCache } from './catalog-context.cache';
import type { ChatDto } from './chat.dto';
import { buildSystemInstruction } from './system-prompt';

/** Tối đa 3 lượt công cụ, tức tối đa 4 lần gọi AI (NT.ASSISTANT_CHAT Processing_Flow §1) */
export const MAX_TOOL_ROUNDS = 3;
/** Số phần tử lịch sử gửi cho AI (API_Spec §2) */
export const HISTORY_LIMIT = 20;

export interface ChatResult {
  reply: string;
  products: ProductItem[];
}

interface ToolResult {
  products?: ProductItem[];
  error?: string;
}

// Chuyển từ source cũ users/chat/chat.service.ts (Component_Class_Design §1, §3). Đổi:
// - ProductService → CatalogClient (API nội bộ), hãng/danh mục giữ AI_CONTEXT_TTL_MS
// - Ngân sách AI_BUDGET_MS cho cả câu; lượt cuối không gửi tools để buộc trả lời bằng chữ
// - reply rỗng → 503; tham số công cụ sai → báo lại cho AI; không trả chi tiết lỗi về client
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly apiKey: string;
  private readonly budgetMs: number;

  constructor(
    private readonly ai: FptAiClient,
    private readonly catalog: CatalogClient,
    private readonly context: CatalogContextCache,
    config: ConfigService,
  ) {
    this.apiKey = config.get<string>('ai.key') ?? '';
    this.budgetMs = config.get<number>('ai.budgetMs') ?? 75000;
  }

  async chat(dto: ChatDto): Promise<ChatResult> {
    if (!this.apiKey) throw aiNotConfigured();

    const deadline = Date.now() + this.budgetMs;
    const facets = await this.context.get(); // lỗi: NT-AST-1006, chưa gọi AI
    const messages = buildMessages(facets, dto);
    let products: ProductItem[] = [];

    let completion = await this.ai.complete(messages, true, deadline);
    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      const message = completion.choices?.[0]?.message;
      const calls = message?.tool_calls;
      if (!calls?.length) break;

      // Phải gửi lại đúng tin assistant chứa tool_calls trước các kết quả tool
      messages.push({
        role: 'assistant',
        content: message?.content ?? '',
        tool_calls: calls,
      });
      for (const call of calls) {
        const result = await this.runTool(call, facets.categories, deadline);
        if (result.products) products = result.products;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      // Lượt cuối không cho gọi công cụ nữa, buộc AI trả lời bằng chữ
      completion = await this.ai.complete(
        messages,
        round < MAX_TOOL_ROUNDS,
        deadline,
      );
    }

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      this.logger.error('FPT AI trả nội dung rỗng');
      throw aiUnavailable();
    }
    return { reply, products };
  }

  private async runTool(
    call: AiToolCall,
    categories: Facets['categories'],
    deadline: number,
  ): Promise<ToolResult> {
    if (call.function?.name !== 'search_products') {
      return { error: 'Công cụ không hỗ trợ' };
    }
    const args = parseArgs(call.function.arguments);
    if (!args) return { error: 'Tham số không hợp lệ' };
    if (Date.now() >= deadline) throw aiTimeout(); // hết ngân sách: không gọi thêm

    try {
      const found = await this.catalog.search(
        toSearchParams(args, categories),
        {
          deadline,
        },
      );
      return { products: found };
    } catch (err) {
      // 4xx (giá âm...): lỗi của tham số AI đưa ra, để AI tự xử lý
      if (err instanceof UpstreamBusinessError) {
        return { error: 'Tham số không hợp lệ' };
      }
      this.logger.warn(`Tra sản phẩm lỗi: ${(err as Error)?.message}`);
      throw catalogUnavailable();
    }
  }
}

/** history: bỏ phần tử sai, chỉ lấy HISTORY_LIMIT phần tử cuối, đổi vai `model` → `assistant` */
export function buildMessages(facets: Facets, dto: ChatDto): AiMessage[] {
  const history = (Array.isArray(dto.history) ? dto.history : [])
    .filter(
      (h) =>
        h &&
        (h.role === 'user' || h.role === 'model') &&
        typeof h.text === 'string' &&
        h.text,
    )
    .slice(-HISTORY_LIMIT)
    .map((h): AiMessage => ({
      role: h.role === 'model' ? 'assistant' : 'user',
      content: h.text,
    }));
  return [
    { role: 'system', content: buildSystemInstruction(facets) },
    ...history,
    { role: 'user', content: dto.message },
  ];
}

interface ToolArgs {
  query?: unknown;
  category?: unknown;
  brand?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
}

function parseArgs(raw: string | undefined): ToolArgs | null {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

// Model truyền TÊN danh mục — đổi sang id. Tên không khớp danh mục nào thì bỏ bộ lọc (như source cũ).
function toSearchParams(
  args: ToolArgs,
  categories: Facets['categories'],
): SearchParams {
  const category = str(args.category)?.toLowerCase();
  return {
    search: str(args.query),
    categoryId: category
      ? categories.find((c) => c.name.toLowerCase() === category)?.id
      : undefined,
    brand: str(args.brand),
    minPrice: num(args.minPrice),
    maxPrice: num(args.maxPrice),
  };
}
