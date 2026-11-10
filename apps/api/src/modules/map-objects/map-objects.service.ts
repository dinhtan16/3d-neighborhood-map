import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MapObjectDto } from '@nmap/map-contracts';
import type { GeoBounds } from '@nmap/shared-types';
import { DatabaseService, Queryable } from '../../database/database.service';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { resolvePublicUrl } from '../../common/utils/url';
import { AssetsService } from '../assets/assets.service';
import { CreateMapObjectDto, UpdateMapObjectDto } from './dto/map-object.dto';
import { ChunkEnvelope, chunkEnvCte, pointInChunkSql } from '../map/chunk';

const OBJECT_SELECT = `SELECT o.id, o.area_id, o.asset_id, a.asset_key, a.model_url, p.id AS place_id, o.feature_id,
    ST_Y(o.position::geometry) AS lat, ST_X(o.position::geometry) AS lng,
    o.elevation_m, o.rotation, o.scale, o.status, o.metadata
  FROM map_objects o
  JOIN map_assets a ON a.id = o.asset_id
  LEFT JOIN places p ON p.id = o.place_id AND p.deleted_at IS NULL`;

@Injectable()
export class MapObjectsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly assets: AssetsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private toDto(r: any): MapObjectDto {
    return {
      id: r.id,
      areaId: r.area_id,
      assetId: r.asset_id,
      assetKey: r.asset_key,
      modelUrl: resolvePublicUrl(r.model_url, this.config.storagePublicBaseUrl)!,
      placeId: r.place_id,
      featureId: r.feature_id,
      position: { lat: r.lat, lng: r.lng },
      elevationM: r.elevation_m,
      rotation: r.rotation,
      scale: r.scale,
      status: r.status,
      metadata: r.metadata ?? {},
    };
  }

  /** Published objects whose position lies in the half-open chunk. */
  async findInChunk(areaId: string, env: ChunkEnvelope, limit: number): Promise<MapObjectDto[]> {
    const rows = await this.db.query(
      `WITH ${chunkEnvCte({ x0: 2, x1: 3, nMin: 4, nMax: 5, srid: 6 })}
       ${OBJECT_SELECT}, e
       WHERE o.area_id = $1 AND o.deleted_at IS NULL AND o.status = 'published'
         AND o.position::geometry && e.g
         AND ${pointInChunkSql('ST_Transform(o.position::geometry, $6::int)', { x0: 2, x1: 3, nMin: 4, nMax: 5 })}
       ORDER BY o.created_at, o.id LIMIT $7`,
      [areaId, env.x0, env.x1, env.nMin, env.nMax, env.srid, limit],
    );
    return rows.map((r) => this.toDto(r));
  }

  async findInBounds(areaId: string, b: GeoBounds, includeDrafts: boolean, limit: number): Promise<MapObjectDto[]> {
    const rows = await this.db.query(
      `${OBJECT_SELECT}
       WHERE o.area_id = $1 AND o.deleted_at IS NULL AND ($6::boolean OR o.status = 'published')
         AND o.position::geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
       ORDER BY o.created_at, o.id LIMIT $7`,
      [areaId, b.minLng, b.minLat, b.maxLng, b.maxLat, includeDrafts, limit],
    );
    return rows.map((r) => this.toDto(r));
  }

  async findOne(id: string, client?: Queryable): Promise<MapObjectDto> {
    const r = await this.db.one(`${OBJECT_SELECT} WHERE o.id = $1 AND o.deleted_at IS NULL`, [id], client);
    if (!r) throw new NotFoundException('Map object not found');
    return this.toDto(r);
  }

  async create(dto: CreateMapObjectDto): Promise<MapObjectDto> {
    const id = await this.db.transaction(async (c) => {
      await this.validatePlacement(c, dto.areaId, dto.assetId, dto.placeId ?? null, dto.featureId ?? null, dto.latitude, dto.longitude);
      const row = await this.db.one<{ id: string }>(
        `INSERT INTO map_objects (area_id, asset_id, place_id, feature_id, position, elevation_m, rotation, scale, metadata, status, source)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8, $9, $10, $11, 'manual')
         RETURNING id`,
        [
          dto.areaId, dto.assetId, dto.placeId ?? null, dto.featureId ?? null, dto.latitude, dto.longitude,
          dto.elevationM ?? 0, dto.rotation ?? 0, JSON.stringify(dto.scale ?? { x: 1, y: 1, z: 1 }),
          JSON.stringify(dto.metadata ?? {}), dto.status ?? 'draft',
        ],
        c,
      );
      return row!.id;
    });
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateMapObjectDto): Promise<MapObjectDto> {
    await this.db.transaction(async (c) => {
      const cur = await this.findOne(id, c);
      const next = {
        assetId: dto.assetId ?? cur.assetId,
        placeId: dto.placeId === undefined ? cur.placeId : dto.placeId,
        featureId: dto.featureId === undefined ? cur.featureId : dto.featureId,
        lat: dto.latitude ?? cur.position.lat,
        lng: dto.longitude ?? cur.position.lng,
      };
      await this.validatePlacement(c, cur.areaId, next.assetId, next.placeId, next.featureId, next.lat, next.lng);
      await this.db.query(
        `UPDATE map_objects SET asset_id = $2, place_id = $3, feature_id = $4,
           position = ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,
           elevation_m = $7, rotation = $8, scale = $9, metadata = $10, status = $11
         WHERE id = $1`,
        [
          id, next.assetId, next.placeId, next.featureId, next.lat, next.lng,
          dto.elevationM ?? cur.elevationM, dto.rotation ?? cur.rotation, JSON.stringify(dto.scale ?? cur.scale),
          // Any admin edit pins the object so later OSM imports never overwrite it.
          JSON.stringify({ ...(dto.metadata ?? cur.metadata), manualOverride: true }), dto.status ?? cur.status,
        ],
        c,
      );
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    const r = await this.db.one(`UPDATE map_objects SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id]);
    if (!r) throw new NotFoundException('Map object not found');
    return { id, deleted: true };
  }

  async publish(id: string): Promise<MapObjectDto> {
    const r = await this.db.one(
      `UPDATE map_objects SET status = 'published' WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id],
    );
    if (!r) throw new NotFoundException('Map object not found');
    return this.findOne(id);
  }

  async publishArea(areaId: string) {
    const rows = await this.db.query(
      `UPDATE map_objects SET status = 'published' WHERE area_id = $1 AND status = 'draft' AND deleted_at IS NULL RETURNING id`,
      [areaId],
    );
    return { areaId, published: rows.length };
  }

  /** Placement rules: area exists, asset is active, place/feature exist, point lies inside the area boundary. */
  private async validatePlacement(
    c: Queryable, areaId: string, assetId: string, placeId: string | null, featureId: string | null, lat: number, lng: number,
  ) {
    const area = await this.db.one(
      `SELECT ST_Covers(boundary, ST_SetSRID(ST_MakePoint($3, $2), 4326)) AS inside FROM map_areas WHERE id = $1 AND is_active`,
      [areaId, lat, lng],
      c,
    );
    if (!area) throw new BadRequestException('Unknown map area');
    if (!(await this.assets.findActive(assetId, c))) throw new BadRequestException('Unknown or inactive asset');
    if (placeId && !(await this.db.one(`SELECT 1 FROM places WHERE id = $1 AND deleted_at IS NULL`, [placeId], c))) {
      throw new BadRequestException('Unknown place');
    }
    if (featureId && !(await this.db.one(`SELECT 1 FROM map_features WHERE id = $1 AND area_id = $2`, [featureId, areaId], c))) {
      throw new BadRequestException('Unknown feature for this area');
    }
    if (!area.inside) throw new BadRequestException('Object is outside the area boundary');
  }
}
