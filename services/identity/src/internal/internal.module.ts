import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Address } from '../database/entities/address.entity';
import { User } from '../database/entities/user.entity';
import { AuthInternalController } from './auth.internal.controller';
import { UsersInternalController } from './users.internal.controller';
import { UsersInternalService } from './users.internal.service';

// AuthService đến từ AuthModule (@Global)
@Module({
  imports: [TypeOrmModule.forFeature([User, Address])],
  controllers: [AuthInternalController, UsersInternalController],
  providers: [UsersInternalService],
})
export class InternalModule {}
