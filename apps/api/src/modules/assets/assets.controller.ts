import { Controller, Get, Query } from '@nestjs/common';
import { AssetsService } from './assets.service';

@Controller('map/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list(@Query('category') category?: string) {
    return this.assets.list(category?.slice(0, 50));
  }
}
