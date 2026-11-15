import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Address } from './entities/address.entity';
import { User } from './entities/user.entity';

// Tài khoản demo — guides/NT_Docker_Local_Guide.md §5. Id cố định để service khác, Postman, thí nghiệm dùng chung.
export const SEED_ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
export const SEED_BUYER_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
export const SEED_BUYER_ADDRESS_ID = 'aaaaaaaa-0000-4000-8000-000000000101';

/**
 * Idempotent: INSERT ... ON CONFLICT DO NOTHING cho user rồi địa chỉ, trong một transaction.
 * Chạy lại không đổi tài khoản đã có (kể cả mật khẩu đã đổi). Trả số user vừa thêm.
 */
export async function seedDemo(ds: DataSource): Promise<number> {
  // bcrypt cost 10 như AuthService.register
  const [adminHash, buyerHash] = await Promise.all([
    bcrypt.hash('Admin@123', 10),
    bcrypt.hash('Buyer@123', 10),
  ]);

  return ds.transaction(async (m) => {
    const users = await m
      .createQueryBuilder()
      .insert()
      .into(User)
      .values([
        {
          id: SEED_ADMIN_ID,
          email: 'admin@nextech.local',
          full_name: 'Quản trị NexTech',
          password_hash: adminHash,
          auth_provider: 'local',
          role: 'admin',
          is_verified: true,
        },
        {
          id: SEED_BUYER_ID,
          email: 'buyer@nextech.local',
          full_name: 'Người mua Demo',
          password_hash: buyerHash,
          auth_provider: 'local',
          role: 'user',
          is_verified: true,
        },
      ])
      .orIgnore()
      .returning('id')
      .execute();

    await m
      .createQueryBuilder()
      .insert()
      .into(Address)
      .values({
        id: SEED_BUYER_ADDRESS_ID,
        user_id: SEED_BUYER_ID,
        full_address:
          '1 Đại Cồ Việt, Phường Bách Khoa, Quận Hai Bà Trưng, Hà Nội',
        recipient_name: 'Người mua Demo',
        phone_number: '0900000002',
        is_default: true,
      })
      .orIgnore()
      .execute();

    return (users.raw as unknown[]).length;
  });
}
