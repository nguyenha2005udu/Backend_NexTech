import { BusinessException } from '@nextech/service-kit';
import { In, type Repository } from 'typeorm';
import { Address } from '../database/entities/address.entity';
import { User } from '../database/entities/user.entity';
import { UsersInternalService } from './users.internal.service';

// API nội bộ NT.IDENTITY API_Spec §2 + test bắt buộc Component_Class_Design §7.

async function errorOf(p: Promise<unknown>) {
  return (await p.catch((e: unknown) => e)) as BusinessException;
}

describe('UsersInternalService', () => {
  let users: { findOne: jest.Mock; find: jest.Mock; count: jest.Mock };
  let addresses: { findOne: jest.Mock };
  let service: UsersInternalService;

  beforeEach(() => {
    users = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    addresses = { findOne: jest.fn().mockResolvedValue(null) };
    service = new UsersInternalService(
      users as unknown as Repository<User>,
      addresses as unknown as Repository<Address>,
    );
  });

  describe('getUser', () => {
    it('chỉ chọn trường công khai, không có password_hash', async () => {
      users.findOne.mockResolvedValue({ id: 'u1' });
      await service.getUser('u1');
      const { select } = (users.findOne.mock.calls as unknown[][])[0][0] as {
        select: Record<string, boolean>;
      };
      expect(Object.keys(select).sort()).toEqual([
        'avatar_url',
        'email',
        'full_name',
        'id',
        'is_active',
        'phone_number',
      ]);
    });

    it('không có → 404 NT-IDN-1003', async () => {
      const err = await errorOf(service.getUser('x'));
      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('NT-IDN-1003');
    });
  });

  describe('getAddress', () => {
    it('địa chỉ của người khác → 404 NT-IDN-1004 (lọc theo cả user_id)', async () => {
      const err = await errorOf(service.getAddress('u1', 'a-of-u2'));
      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('NT-IDN-1004');
      expect(addresses.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a-of-u2', user_id: 'u1' } }),
      );
    });

    it('trả đúng các trường của hợp đồng', async () => {
      const row = {
        id: 'a1',
        user_id: 'u1',
        full_address: 'x',
        recipient_name: 'A',
        phone_number: '09',
        is_default: true,
      };
      addresses.findOne.mockResolvedValue(row);
      await expect(service.getAddress('u1', 'a1')).resolves.toEqual(row);
      const { select } = (
        addresses.findOne.mock.calls as unknown[][]
      )[0][0] as {
        select: Record<string, boolean>;
      };
      expect(Object.keys(select).sort()).toEqual(Object.keys(row).sort());
    });
  });

  describe('getUsers (batch)', () => {
    it('id không tồn tại → chỉ trả id có thật; một truy vấn; không có password_hash', async () => {
      users.find.mockResolvedValue([
        { id: 'u1', full_name: 'A', email: 'a@b.c', avatar_url: null },
      ]);
      await expect(service.getUsers(['u1', 'khong-co'])).resolves.toEqual({
        items: [{ id: 'u1', full_name: 'A', email: 'a@b.c', avatar_url: null }],
      });
      expect(users.find).toHaveBeenCalledTimes(1);
      expect(users.find).toHaveBeenCalledWith({
        where: { id: In(['u1', 'khong-co']) },
        select: { id: true, full_name: true, email: true, avatar_url: true },
      });
    });

    it('danh sách rỗng → không truy vấn', async () => {
      await expect(service.getUsers([])).resolves.toEqual({ items: [] });
      expect(users.find).not.toHaveBeenCalled();
    });
  });

  it('stats: tổng số người dùng (như be/src/admin/statistics: userRepo.count())', async () => {
    users.count.mockResolvedValue(120);
    await expect(service.countUsers()).resolves.toEqual({ total_users: 120 });
    expect(users.count).toHaveBeenCalledWith();
  });
});
