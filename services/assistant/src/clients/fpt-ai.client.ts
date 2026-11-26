import { Logger } from '@nestjs/common';
import { UpstreamError, type ResilientHttpClient } from '@nextech/service-kit';
import { aiTimeout, aiUnavailable } from '../errors';

/** Một tin trong chuẩn OpenAI Chat Completions */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: AiToolCall[];
  tool_call_id?: string;
}

export interface AiToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

/** Phần tối thiểu của response /chat/completions mà service cần đọc */
export interface FptCompletion {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: AiToolCall[];
    };
  }[];
}

export interface FptAiOptions {
  model: string;
  callTimeoutMs: number;
  tools: unknown[];
}

// Client tới FPT AI (NT.ASSISTANT_CHAT Component_Class_Design §4, ADR-0013). http phải là
// ResilientHttpClient chế độ `external`: không gửi X-Internal-Token, 4xx của FPT tính là lỗi hạ tầng.
// Không retry: tốn tiền, đã chậm thì thử lại càng chậm. Chi tiết lỗi chỉ ghi log, client nhận mã NT-AST.
export class FptAiClient {
  private readonly logger = new Logger(FptAiClient.name);

  constructor(
    private readonly http: Pick<ResilientHttpClient, 'request'>,
    private readonly opts: FptAiOptions,
  ) {}

  async complete(
    messages: AiMessage[],
    useTools: boolean,
    deadline: number,
  ): Promise<FptCompletion> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw aiTimeout();
    try {
      return await this.http.request<FptCompletion>({
        method: 'POST',
        path: '/chat/completions',
        retry: false,
        timeoutMs: Math.min(this.opts.callTimeoutMs, remaining),
        body: {
          model: this.opts.model,
          messages,
          ...(useTools ? { tools: this.opts.tools } : {}),
          stream: false,
        },
      });
    } catch (err) {
      this.logger.error(`FPT AI lỗi: ${describe(err)}`);
      if (err instanceof UpstreamError && err.getStatus() === 504) {
        throw aiTimeout();
      }
      throw aiUnavailable();
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof UpstreamError) return `${err.reason} (${err.outcome})`;
  return (err as Error)?.message ?? String(err);
}
