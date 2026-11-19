import { Logger } from '@nestjs/common';
import { UpstreamBusinessError, UpstreamError } from '@nextech/service-kit';
import { IdentityClient } from './identity.client';

// NT.CATALOG API_Spec §3 (v1.6): identity lỗi thì vẫn tạo đánh giá, tên để rỗng; không retry
describe('IdentityClient.getUserSnapshot', () => {
  const request = jest.fn();
  const client = new IdentityClient({ request });
  let warn: jest.SpyInstance;
  beforeEach(() => {
    request.mockReset();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('gọi GET /internal/users/:id với retry: false, chỉ lấy full_name, avatar_url', async () => {
    request.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      full_name: 'Nguyễn A',
      phone_number: '09',
      avatar_url: 'https://img/a.jpg',
      is_active: true,
    });

    await expect(client.getUserSnapshot('u1')).resolves.toEqual({
      full_name: 'Nguyễn A',
      avatar_url: 'https://img/a.jpg',
    });
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/internal/users/u1',
      retry: false,
    });
  });

  it('thiếu trường → null từng trường', async () => {
    request.mockResolvedValue({ id: 'u1' });
    await expect(client.getUserSnapshot('u1')).resolves.toEqual({
      full_name: null,
      avatar_url: null,
    });
  });

  it.each([
    [
      'identity chết',
      new UpstreamError('identity', 'ECONNREFUSED', 'not_executed'),
    ],
    ['quá giờ', new UpstreamError('identity', 'timeout', 'unknown', 504)],
    [
      '404 NT-IDN-1003',
      new UpstreamBusinessError(
        'identity',
        404,
        'NT-IDN-1003',
        'Không tìm thấy',
      ),
    ],
  ])('%s → null, có log cảnh báo', async (_name, err) => {
    request.mockRejectedValue(err);
    await expect(client.getUserSnapshot('u1')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
