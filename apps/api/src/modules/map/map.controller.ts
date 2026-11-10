import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { MapService } from './map.service';
import { ObjectsQueryDto, SceneQueryDto } from './dto/scene-query.dto';
import { MapObjectsService } from '../map-objects/map-objects.service';
import { OptionalJwtService } from '../../common/guards/jwt-auth.guard';
import { assertValidBounds } from '../../common/utils/bounds';
import { LIMITS } from '@nmap/map-config';

@Controller('map')
export class MapController {
  constructor(
    private readonly map: MapService,
    private readonly objects: MapObjectsService,
    private readonly optionalJwt: OptionalJwtService,
  ) {}

  @Get('areas')
  listAreas() {
    return this.map.listAreas();
  }

  @Get('areas/:idOrSlug')
  getArea(@Param('idOrSlug') idOrSlug: string) {
    return this.map.getArea(idOrSlug.slice(0, 255));
  }

  @Get('scene')
  async scene(@Query() q: SceneQueryDto, @Req() req: any) {
    const includeDrafts = await this.draftsAllowed(q.includeDrafts, req);
    return this.map.getScene(q.areaId, q, q.lod ?? 2, includeDrafts);
  }

  @Get('features/:id')
  feature(@Param('id', ParseUUIDPipe) id: string) {
    return this.map.getFeature(id);
  }

  @Get('objects')
  async objectsInBounds(@Query() q: ObjectsQueryDto, @Req() req: any) {
    assertValidBounds(q);
    const includeDrafts = await this.draftsAllowed(q.includeDrafts, req);
    await this.map.getArea(q.areaId);
    const data = await this.objects.findInBounds(q.areaId, q, includeDrafts, LIMITS.maxSceneObjects);
    return { data, meta: { count: data.length } };
  }

  /** Drafts are only visible to admins (the map editor). */
  private async draftsAllowed(requested: boolean | undefined, req: any): Promise<boolean> {
    if (!requested) return false;
    const user = await this.optionalJwt.userFrom(req);
    if (user?.role !== 'admin') throw new ForbiddenException('includeDrafts requires an admin token');
    return true;
  }
}
