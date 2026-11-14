import { Module } from '@nestjs/common';
import { RedemptionsInternalController } from '../../internal/redemptions.internal.controller';
import { RedemptionService } from './redemption.service';

@Module({
  controllers: [RedemptionsInternalController],
  providers: [RedemptionService],
})
export class RedemptionModule {}
