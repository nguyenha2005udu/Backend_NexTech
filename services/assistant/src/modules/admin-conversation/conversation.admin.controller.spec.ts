import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionsFilter } from '@nextech/service-kit';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ConversationAdminController } from './conversation.admin.controller';
import { ConversationAdminService } from './conversation.admin.service';

// NT.ASSISTANT_ADMIN Component_Class_Design §3: người dùng thường gọi thẳng service cũng bị 403.

const TOKEN = 'dev-internal-token';

describe('ConversationAdminController', () => {
  let app: INestApplication<App>;
  const service = {
    findAll: jest.fn().mockResolvedValue({ data: [] }),
    findOneDetail: jest.fn(),
  };
  const saved = process.env.INTERNAL_API_TOKEN;

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    const mod = await Test.createTestingModule({
      controllers: [ConversationAdminController],
      providers: [{ provide: ConversationAdminService, useValue: service }],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });
  afterAll(async () => {
    process.env.INTERNAL_API_TOKEN = saved;
    await app.close();
  });

  const as = (role: string) =>
    request(app.getHttpServer())
      .get('/admin/conversations')
      .set('X-Internal-Token', TOKEN)
      .set('X-User-Id', '66666666-6666-4666-8666-666666666666')
      .set('X-User-Email', 'a@b.c')
      .set('X-User-Role', role);

  it('admin: 200', async () => {
    await as('admin').expect(200);
  });

  it('người dùng thường: 403', async () => {
    await as('user').expect(403);
  });
});
