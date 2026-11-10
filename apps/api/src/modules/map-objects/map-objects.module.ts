import { Module } from '@nestjs/common';
import { MapObjectsController } from './map-objects.controller';
import { MapObjectsService } from './map-objects.service';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [AssetsModule],
  controllers: [MapObjectsController],
  providers: [MapObjectsService],
  exports: [MapObjectsService],
})
export class MapObjectsModule {}
