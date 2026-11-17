// Chép nguyên từ be/src/users/industry/industry.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { IndustryService } from './industry.service';
import { IndustryQueryDto } from './industry.dto';

@Controller('industries')
export class IndustryController {
  constructor(private readonly industryService: IndustryService) {}

  // GET /api/industries
  @Get()
  findAll() {
    return this.industryService.findAll();
  }

  // GET /api/industries/:id
  @Get(':id')
  findOne(@Param('id') id: string, @Query() query: IndustryQueryDto) {
    return this.industryService.findOne(id, query);
  }
}
