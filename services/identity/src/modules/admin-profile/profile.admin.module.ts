import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { UserProfile } from '../../database/entities/user-profile.entity';
import { ProfileAdminController } from './profile.admin.controller';
import { ProfileAdminService } from './profile.admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserProfile])],
  controllers: [ProfileAdminController],
  providers: [ProfileAdminService],
})
export class ProfileAdminModule {}
