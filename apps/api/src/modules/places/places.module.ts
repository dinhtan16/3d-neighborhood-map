import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';
import { PlacesRepository } from './places.repository';

@Module({ controllers: [PlacesController], providers: [PlacesService, PlacesRepository], exports: [PlacesService] })
export class PlacesModule {}
