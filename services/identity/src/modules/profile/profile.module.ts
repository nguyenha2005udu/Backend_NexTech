import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { UserProfile } from '../../database/entities/user-profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserProfile, UserPreference])],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
