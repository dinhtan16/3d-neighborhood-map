import { Module } from '@nestjs/common';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { MapRepository } from './map.repository';
import { MapObjectsModule } from '../map-objects/map-objects.module';
import { PlacesModule } from '../places/places.module';

@Module({
  imports: [MapObjectsModule, PlacesModule],
  controllers: [MapController],
  providers: [MapService, MapRepository],
  exports: [MapService],
})
export class MapModule {}
