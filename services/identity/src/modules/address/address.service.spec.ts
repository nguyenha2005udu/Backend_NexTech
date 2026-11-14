import { BusinessException } from '@nextech/service-kit';
import type { Repository } from 'typeorm';
import { Address } from '../../database/entities/address.entity';
import { AddressService } from './address.service';

// Hành vi giữ nguyên be/src/users/address/address.service.ts; chỉ thêm mã NT-IDN-1004 (API_Spec §3).

describe('AddressService', () => {
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let service: AddressService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((x: Partial<Address>) => x),
      save: jest.fn((x: Partial<Address>) => Promise.resolve(x)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    service = new AddressService(repo as unknown as Repository<Address>);
  });

  it.each([
    ['getMyAddressById', (s: AddressService) => s.getMyAddressById('u1', 'a1')],
    ['updateAddress', (s: AddressService) => s.updateAddress('u1', 'a1', {})],
    ['deleteAddress', (s: AddressService) => s.deleteAddress('u1', 'a1')],
    [
      'setDefaultAddress',
      (s: AddressService) => s.setDefaultAddress('u1', 'a1'),
    ],
  ])(
    '%s: địa chỉ không thuộc người dùng → 404 NT-IDN-1004',
    async (_, call) => {
      const err = (await call(service).catch(
        (e: unknown) => e,
      )) as BusinessException;
      expect(err).toBeInstanceOf(BusinessException);
      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('NT-IDN-1004');
      expect(err.getResponse()).toMatchObject({
        message: 'Không tìm thấy địa chỉ',
      });
      // Luôn lọc theo cả id và user_id
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'a1', user_id: 'u1' },
      });
    },
  );

  it('danh sách: mặc định trước, mới trước', async () => {
    await service.getMyAddresses('u1');
    expect(repo.find).toHaveBeenCalledWith({
      where: { user_id: 'u1' },
      order: { is_default: 'DESC', created_at: 'DESC' },
    });
  });

  it('tạo địa chỉ mặc định → bỏ mặc định các địa chỉ cũ', async () => {
    await service.createAddress('u1', { full_address: 'x', is_default: true });
    expect(repo.update).toHaveBeenCalledWith(
      { user_id: 'u1' },
      { is_default: false },
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', is_default: true }),
    );
  });
});
