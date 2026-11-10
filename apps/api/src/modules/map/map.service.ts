import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LIMITS } from '@nmap/map-config';
import type { MapAreaDto, MapFeature, MapSceneDto, MapSceneMeta } from '@nmap/map-contracts';
import type { GeoBounds } from '@nmap/shared-types';
import { MapRepository } from './map.repository';
import { toAreaDto, toFeature } from './serializers/map.serializer';
import { MapObjectsService } from '../map-objects/map-objects.service';
import { PlacesService } from '../places/places.service';
import { assertValidBounds } from '../../common/utils/bounds';
import {
  CHUNK_FEATURE_LIMIT, CHUNK_OBJECT_LIMIT, CHUNK_PLACE_LIMIT, ChunkEnvelope, ChunkRange, chunkSize, sridOf,
} from './chunk';

export interface MapChunkData {
  chunk: { cx: number; cz: number; sizeM: number; bounds: GeoBounds };
  features: { type: 'FeatureCollection'; features: MapFeature[] };
  objects: MapSceneDto['objects'];
  places: MapSceneDto['places'];
}

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

  private readonly ranges = new Map<string, ChunkRange>();

  /** Chunk index range of an area (cached; area extents rarely change). */
  async getChunkRange(area: MapAreaDto): Promise<ChunkRange> {
    const key = `${area.id}|${area.crs}|${area.origin.lat}|${area.origin.lng}|${JSON.stringify(area.bounds)}`;
    let r = this.ranges.get(key);
    if (!r) {
      r = (await this.repo.chunkRange(area.id, sridOf(area.crs), chunkSize()))!;
      this.ranges.set(key, r);
    }
    return r;
  }

  async chunkEnvelope(area: MapAreaDto, cx: number, cz: number): Promise<ChunkEnvelope> {
    const range = await this.getChunkRange(area);
    if (cx < range.minCx || cx > range.maxCx || cz < range.minCz || cz > range.maxCz) {
      throw new BadRequestException(
        `Chunk (${cx}, ${cz}) is outside the area (cx ${range.minCx}..${range.maxCx}, cz ${range.minCz}..${range.maxCz})`,
      );
    }
    const env = await this.repo.chunkEnvelope(area.id, sridOf(area.crs), cx, cz, chunkSize());
    if (!env) throw new NotFoundException('Map area not found');
    return env;
  }

  /** One streaming chunk: features (buildings by centroid), published objects and active places. */
  async getChunk(areaIdOrSlug: string, cx: number, cz: number, lod = 2) {
    const area = await this.getArea(areaIdOrSlug);
    const env = await this.chunkEnvelope(area, cx, cz);
    const [featureRows, objects, places] = await Promise.all([
      this.repo.findChunkFeatures(area.id, env, toleranceForLod(lod), CHUNK_FEATURE_LIMIT),
      this.objects.findInChunk(area.id, env, CHUNK_OBJECT_LIMIT),
      this.places.findInChunk(area.id, env, CHUNK_PLACE_LIMIT),
    ]);
    const features = featureRows.map(toFeature);
    const data: MapChunkData = {
      chunk: { cx, cz, sizeM: env.sizeM, bounds: env.bounds },
      features: { type: 'FeatureCollection', features },
      objects,
      places,
    };
    return {
      data,
      meta: { areaId: area.id, cx, cz, lod, featureCount: features.length, objectCount: objects.length, placeCount: places.length },
    };
  }
}
