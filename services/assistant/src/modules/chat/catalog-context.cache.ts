import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogClient, type Facets } from '../../clients/catalog.client';
import { catalogUnavailable } from '../../errors';

// Giữ danh sách hãng và danh mục AI_CONTEXT_TTL_MS (NT.ASSISTANT_CHAT Component_Class_Design §5).
// Source cũ tra 2 truy vấn mỗi câu hỏi. Catalog lỗi: dùng bản cũ còn hơn lỗi; chưa có bản nào thì 503.
@Injectable()
export class CatalogContextCache {
  private readonly logger = new Logger(CatalogContextCache.name);
  private value: Facets | undefined;
  private expiresAt = 0;
  private readonly ttlMs: number;

  constructor(
    private readonly catalog: CatalogClient,
    config: ConfigService,
  ) {
    this.ttlMs = config.get<number>('ai.contextTtlMs') ?? 300000;
  }

  async get(): Promise<Facets> {
    if (this.value && Date.now() < this.expiresAt) return this.value;
    try {
      this.value = await this.catalog.facets();
      this.expiresAt = Date.now() + this.ttlMs;
      return this.value;
    } catch (err) {
      this.logger.warn(`Lấy hãng, danh mục lỗi: ${(err as Error)?.message}`);
      if (this.value) return this.value;
      throw catalogUnavailable();
    }
  }
}
