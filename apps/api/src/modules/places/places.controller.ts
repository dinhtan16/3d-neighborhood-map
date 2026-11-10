import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlacesService } from './places.service';
import { CreatePlaceDto, CreatePlaceImageDto, NearbyPlacesDto, SearchPlacesDto, UpdatePlaceDto } from './dto/place.dto';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { readConfig } from '../../config/env';

const SEARCH_LIMIT = readConfig().searchRateLimitPerMin;

@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  @Throttle({ default: { limit: SEARCH_LIMIT, ttl: 60_000 } })
  search(@Query() q: SearchPlacesDto) {
    return this.places.search(q);
  }

  @Get('nearby')
  @Throttle({ default: { limit: SEARCH_LIMIT, ttl: 60_000 } })
  nearby(@Query() q: NearbyPlacesDto) {
    return this.places.nearby(q);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.places.findDetail(id);
  }

  @Post()
  @AdminOnly()
  create(@Body() dto: CreatePlaceDto) {
    return this.places.create(dto);
  }

  @Patch(':id')
  @AdminOnly()
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlaceDto) {
    return this.places.update(id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.places.remove(id);
  }

  @Post(':id/images')
  @AdminOnly()
  addImage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePlaceImageDto) {
    return this.places.addImage(id, dto);
  }

  @Delete(':id/images/:imageId')
  @AdminOnly()
  removeImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.places.removeImage(id, imageId);
  }
}
