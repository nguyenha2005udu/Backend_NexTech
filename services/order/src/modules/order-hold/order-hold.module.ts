// Module lá (NT.ORDER_HOLD §1, §4): client Redis lấy từ RedisModule (@Global), không import module nghiệp vụ nào
import { Module } from '@nestjs/common';
import { HoldScheduleService } from './hold-schedule.service';

@Module({
  providers: [HoldScheduleService],
  exports: [HoldScheduleService],
})
export class OrderHoldModule {}
