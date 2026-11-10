import { Injectable, NotFoundException } from '@nestjs/common';
import { LIMITS } from '@nmap/map-config';
import type { MapAreaDto, MapFeature, MapSceneDto, MapSceneMeta } from '@nmap/map-contracts';
import type { GeoBounds } from '@nmap/shared-types';
import { MapRepository } from './map.repository';
import { toAreaDto, toFeature } from './serializers/map.serializer';
import { MapObjectsService } from '../map-objects/map-objects.service';
import { PlacesService } from '../places/places.service';
import { assertValidBounds } from '../../common/utils/bounds';

/** Simplification tolerance in degrees per level of detail. */
export function toleranceForLod(lod: number): number {
  if (lod >= 2) return 0;
  if (lod === 1) return 0.000005;
  return 0.00002;
}

@Injectable()
export class MapService {
  constructor(
    private readonly repo: MapRepository,
    private readonly objects: MapObjectsService,
    private readonly places: PlacesService,
  ) {}

  async listAreas(): Promise<MapAreaDto[]> {
    return (await this.repo.listAreas()).map(toAreaDto);
  }

  async getArea(idOrSlug: string): Promise<MapAreaDto> {
    const row = await this.repo.findArea(idOrSlug);
    if (!row) throw new NotFoundException('Map area not found');
    return toAreaDto(row);
  }

  async getScene(
    areaId: string,
    bounds: GeoBounds,
    lod = 2,
    includeDrafts = false,
  ): Promise<{ data: MapSceneDto; meta: MapSceneMeta }> {
    assertValidBounds(bounds);
    await this.getArea(areaId);
    const [featureRows, objects, places] = await Promise.all([
      this.repo.findFeatures(areaId, bounds, toleranceForLod(lod), LIMITS.maxSceneFeatures),
      this.objects.findInBounds(areaId, bounds, includeDrafts, LIMITS.maxSceneObjects),
      this.places.findInBounds(areaId, bounds, LIMITS.maxScenePlaces),
    ]);
    const features = featureRows.map(toFeature);
    return {
      data: { features: { type: 'FeatureCollection', features }, objects, places },
      meta: { areaId, lod, featureCount: features.length, objectCount: objects.length, placeCount: places.length },
    };
  }

  async getFeature(id: string): Promise<MapFeature & { areaId: string }> {
    const row = await this.repo.findFeature(id);
    if (!row) throw new NotFoundException('Feature not found');
    return { ...toFeature(row), areaId: row.area_id };
  }
}
