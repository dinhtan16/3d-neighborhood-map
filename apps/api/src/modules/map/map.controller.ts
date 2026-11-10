import { Controller, ForbiddenException, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MapService } from './map.service';
import { ChunkQueryDto, ObjectsQueryDto, SceneQueryDto } from './dto/scene-query.dto';
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

  /**
   * Streaming chunk (CHUNK_SIZE_M square in the area's local metric frame).
   * Buildings / objects / places are assigned to exactly one chunk; roads and
   * areas appear in every chunk they intersect. Cacheable for 5 minutes.
   */
  @Get('areas/:areaId/chunks/:cx/:cz')
  @Header('Cache-Control', 'public, max-age=300')
  @Throttle({ default: { limit: 900, ttl: 60_000 } })
  chunk(
    @Param('areaId') areaId: string,
    @Param('cx', ParseIntPipe) cx: number,
    @Param('cz', ParseIntPipe) cz: number,
    @Query() q: ChunkQueryDto,
  ) {
    return this.map.getChunk(areaId.slice(0, 255), cx, cz, q.lod ?? 2);
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
