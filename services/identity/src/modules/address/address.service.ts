// Chép từ be/src/users/address/address.service.ts. Đổi: NotFoundException → BusinessException NT-IDN-1004 (giữ câu chữ)
import { HttpStatus, Injectable } from '@nestjs/common';
import { BusinessException } from '@nextech/service-kit';
import { IDN_ERROR } from '../../errors';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from '../../database/entities/address.entity';
import { CreateAddressDto, UpdateAddressDto } from './address.dto';

export function addressNotFound() {
  return new BusinessException(
    HttpStatus.NOT_FOUND,
    IDN_ERROR.ADDRESS_NOT_FOUND,
    'Không tìm thấy địa chỉ',
  );
}

@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(Address) private addressRepo: Repository<Address>,
  ) {}

  // ---------- GET /users/me/addresses ----------
  async getMyAddresses(userId: string) {
    return this.addressRepo.find({
      where: { user_id: userId },
      order: { is_default: 'DESC', created_at: 'DESC' },
    });
  }

  // ---------- GET /users/me/addresses/:id ----------
  async getMyAddressById(userId: string, id: string) {
    const address = await this.addressRepo.findOne({
      where: { id, user_id: userId },
    });
    if (!address) throw addressNotFound();
    return address;
  }

  // ---------- POST /users/me/addresses ----------
  async createAddress(userId: string, dto: CreateAddressDto) {
    // Nếu đây là địa chỉ mặc định mới, bỏ mặc định các địa chỉ cũ
    if (dto.is_default) {
      await this.addressRepo.update({ user_id: userId }, { is_default: false });
    }

    const address = this.addressRepo.create({
      user_id: userId,
      full_address: dto.full_address,
      recipient_name: dto.recipient_name,
      phone_number: dto.phone_number,
      is_default: dto.is_default ?? false,
    });

    return this.addressRepo.save(address);
  }

  // ---------- PUT /users/me/addresses/:id ----------
  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    const address = await this.addressRepo.findOne({
      where: { id, user_id: userId },
    });
    if (!address) throw addressNotFound();

    if (dto.full_address !== undefined) address.full_address = dto.full_address;
    if (dto.recipient_name !== undefined)
      address.recipient_name = dto.recipient_name;
    if (dto.phone_number !== undefined) address.phone_number = dto.phone_number;

    if (dto.is_default === true) {
      await this.addressRepo.update({ user_id: userId }, { is_default: false });
      address.is_default = true;
    } else if (dto.is_default === false) {
      address.is_default = false;
    }

    return this.addressRepo.save(address);
  }

  // ---------- DELETE /users/me/addresses/:id ----------
  async deleteAddress(userId: string, id: string) {
    const address = await this.addressRepo.findOne({
      where: { id, user_id: userId },
    });
    if (!address) throw addressNotFound();

    await this.addressRepo.remove(address);
    return { message: 'Đã xoá địa chỉ' };
  }

  // ---------- PUT /users/me/addresses/:id/default ----------
  async setDefaultAddress(userId: string, id: string) {
    const address = await this.addressRepo.findOne({
      where: { id, user_id: userId },
    });
    if (!address) throw addressNotFound();

    await this.addressRepo.update({ user_id: userId }, { is_default: false });
    address.is_default = true;

    return this.addressRepo.save(address);
  }
}
