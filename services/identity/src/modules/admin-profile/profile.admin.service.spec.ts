import { BusinessException } from '@nextech/service-kit';
import type { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { UserProfile } from '../../database/entities/user-profile.entity';
import type { AuthService } from '../auth/auth.service';
import { ProfileAdminService } from './profile.admin.service';

// Giữ nguyên be/src/admin/profile/profile.admin.service.ts; thêm mã NT-IDN-1003 và thu hồi phiên khi xoá (quyết định A6).

function user(over: Partial<User> = {}): User {
  return { id: 'u1', role: 'user', is_active: true, ...over } as User;
}

describe('ProfileAdminService', () => {
  let userRepo: { findOne: jest.Mock; save: jest.Mock; remove: jest.Mock };
  let auth: { logout: jest.Mock };
  let service: ProfileAdminService;

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn().mockResolvedValue(user()),
      save: jest.fn((u: User) => Promise.resolve(u)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    auth = { logout: jest.fn().mockResolvedValue(undefined) };
    service = new ProfileAdminService(
      userRepo as unknown as Repository<User>,
      {} as Repository<UserProfile>,
      auth as unknown as AuthService,
    );
  });

  describe('updateStatusOrRole', () => {
    it('khoá tài khoản → thu hồi refresh token', async () => {
      await service.updateStatusOrRole('u1', { is_active: false });
      expect(auth.logout).toHaveBeenCalledWith('u1');
    });

    it('đổi vai trò → thu hồi refresh token', async () => {
      await service.updateStatusOrRole('u1', { role: 'admin' });
      expect(auth.logout).toHaveBeenCalledWith('u1');
    });

    it('không đổi vai trò, không khoá → không thu hồi', async () => {
      await service.updateStatusOrRole('u1', { role: 'user', is_active: true });
      expect(auth.logout).not.toHaveBeenCalled();
    });

    it('không có user → 404 NT-IDN-1003', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const err = (await service
        .updateStatusOrRole('x', {})
        .catch((e: unknown) => e)) as BusinessException;
      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('NT-IDN-1003');
    });
  });

  describe('remove', () => {
    it('xoá user → thu hồi refresh token (A6), giữ câu trả lời của be/', async () => {
      await expect(service.remove('u1')).resolves.toEqual({
        message: 'Đã xoá tài khoản người dùng',
      });
      expect(userRepo.remove).toHaveBeenCalled();
      expect(auth.logout).toHaveBeenCalledWith('u1');
    });

    it('không có user → 404 NT-IDN-1003, không thu hồi gì', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const err = (await service
        .remove('x')
        .catch((e: unknown) => e)) as BusinessException;
      expect(err.code).toBe('NT-IDN-1003');
      expect(auth.logout).not.toHaveBeenCalled();
    });
  });
});
