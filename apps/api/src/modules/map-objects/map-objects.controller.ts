import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { MapObjectsService } from './map-objects.service';
import { CreateMapObjectDto, PublishAreaDto, UpdateMapObjectDto } from './dto/map-object.dto';
import { AdminOnly } from '../../common/decorators/roles.decorator';

@Controller('admin/map')
@AdminOnly()
export class MapObjectsController {
  constructor(private readonly objects: MapObjectsService) {}

  @Get('objects/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.objects.findOne(id);
  }

  @Post('objects')
  create(@Body() dto: CreateMapObjectDto) {
    return this.objects.create(dto);
  }

  @Patch('objects/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMapObjectDto) {
    return this.objects.update(id, dto);
  }

  @Delete('objects/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.objects.remove(id);
  }

  @Post('objects/:id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.objects.publish(id);
  }

  @Post('publish')
  @HttpCode(200)
  publishArea(@Body() dto: PublishAreaDto) {
    return this.objects.publishArea(dto.areaId);
  }
}
