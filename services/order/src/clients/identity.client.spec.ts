import { UpstreamBusinessError } from '@nextech/service-kit';
import { IdentityClient } from './identity.client';

// NT.ORDER Component_Class_Design §5, NT.IDENTITY API_Spec §2
describe('IdentityClient', () => {
  const request = jest.fn();
  const client = new IdentityClient({ request });
  beforeEach(() => request.mockReset());

  it('getUser: GET /internal/users/:id', async () => {
    const user = { id: 'u1', email: 'a@b.c', full_name: 'A' };
    request.mockResolvedValue(user);

    await expect(client.getUser('u1')).resolves.toEqual(user);
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/internal/users/u1',
    });
  });

  it('getAddress: GET /internal/users/:userId/addresses/:addressId', async () => {
    const addr = { id: 'a1', user_id: 'u1', full_address: 'HN' };
    request.mockResolvedValue(addr);

    await expect(client.getAddress('u1', 'a1')).resolves.toEqual(addr);
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/internal/users/u1/addresses/a1',
    });
  });

  it('mã hoá tham số đường dẫn', async () => {
    request.mockResolvedValue({});
    await client.getAddress('u/1', 'a?1');
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/internal/users/u%2F1/addresses/a%3F1',
    });
  });

  it('404 của identity truyền nguyên (saga diễn giải ở T3.3)', async () => {
    const notFound = new UpstreamBusinessError(
      'identity',
      404,
      'NT-IDN-1004',
      'Không tìm thấy địa chỉ',
    );
    request.mockRejectedValue(notFound);
    await expect(client.getAddress('u1', 'a1')).rejects.toBe(notFound);
  });

  it('stats: GET /internal/stats/users', async () => {
    request.mockResolvedValue({ total_users: 5 });
    await expect(client.stats()).resolves.toEqual({ total_users: 5 });
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/internal/stats/users',
    });
  });

  it('getUser, getAddress chuyển deadline xuống request', async () => {
    request.mockResolvedValue({});
    await client.getUser('u1', { deadline: 1 });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ deadline: 1 }),
    );
    await client.getAddress('u1', 'a1', { deadline: 2 });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ deadline: 2 }),
    );
  });
});
