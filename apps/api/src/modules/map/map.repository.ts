import { Injectable } from '@nestjs/common';
import type { GeoBounds } from '@nmap/shared-types';
import { DatabaseService } from '../../database/database.service';
import { ChunkEnvelope, ChunkRange, chunkEnvCte, pointInChunkSql } from './chunk';

const AREA_COLUMNS = `id, name, slug, crs, origin_lat, origin_lng,
  ST_XMin(boundary) AS min_lng, ST_YMin(boundary) AS min_lat, ST_XMax(boundary) AS max_lng, ST_YMax(boundary) AS max_lat,
  ST_AsGeoJSON(boundary, 7)::json AS boundary`;

/** GeoJSON at 6 decimals (~0.1 m) keeps payloads small without visible error. */
const FEATURE_COLUMNS = (geomExpr: string) => `id, feature_type, source, source_id, height_m, levels, style_key,
  properties->'normalized' AS normalized, properties->'tags' AS tags, ST_AsGeoJSON(${geomExpr}, 6)::json AS geom`;

@Injectable()
export class MapRepository {
  constructor(private readonly db: DatabaseService) {}

  listAreas() {
    return this.db.query(`SELECT ${AREA_COLUMNS} FROM map_areas WHERE is_active ORDER BY name`);
  }

  findArea(idOrSlug: string) {
    return this.db.one(`SELECT ${AREA_COLUMNS} FROM map_areas WHERE is_active AND (id::text = $1 OR slug = $1)`, [idOrSlug]);
  }

  /** Features intersecting the bbox, simplified for low LODs (tolerance in degrees; 0 = original geometry). */
  findFeatures(areaId: string, b: GeoBounds, tolerance: number, limit: number) {
    return this.db.query(
      `WITH env AS (SELECT ST_MakeEnvelope($2, $3, $4, $5, 4326) AS g)
       SELECT ${FEATURE_COLUMNS(`CASE WHEN $6::float8 > 0 THEN ST_SimplifyPreserveTopology(f.geometry, $6::float8) ELSE f.geometry END`)}
       FROM map_features f, env
       WHERE f.area_id = $1 AND f.geometry && env.g AND ST_Intersects(f.geometry, env.g)
       ORDER BY f.feature_type, f.id
       LIMIT $7`,
      [areaId, b.minLng, b.minLat, b.maxLng, b.maxLat, tolerance, limit],
    );
  }

  findFeature(id: string) {
    return this.db.one(`SELECT ${FEATURE_COLUMNS('geometry')}, area_id FROM map_features WHERE id = $1`, [id]);
  }

  /** Chunk index range covering the area's bounding box. */
  async chunkRange(areaId: string, srid: number, size: number): Promise<ChunkRange | null> {
    const r = await this.db.one<{ ox: number; oy: number; xmin: number; xmax: number; ymin: number; ymax: number }>(
      `WITH a AS (
         SELECT ST_Transform(ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326), $2::int) AS o,
                ST_Transform(ST_Envelope(boundary), $2::int) AS b
         FROM map_areas WHERE id = $1)
       SELECT ST_X(o) AS ox, ST_Y(o) AS oy, ST_XMin(b) AS xmin, ST_XMax(b) AS xmax, ST_YMin(b) AS ymin, ST_YMax(b) AS ymax FROM a`,
      [areaId, srid],
    );
    if (!r) return null;
    return {
      minCx: Math.floor((r.xmin - r.ox) / size),
      maxCx: Math.floor((r.xmax - r.ox) / size),
      minCz: Math.floor(-(r.ymax - r.oy) / size),
      maxCz: Math.floor(-(r.ymin - r.oy) / size),
    };
  }

  /** Projected + geographic envelope of one chunk. */
  async chunkEnvelope(areaId: string, srid: number, cx: number, cz: number, size: number): Promise<ChunkEnvelope | null> {
    const r = await this.db.one<any>(
      `WITH a AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326), $2::int) AS o FROM map_areas WHERE id = $1),
       b AS (SELECT ST_X(o) + $3::float8 * $5::float8 AS x0, ST_X(o) + ($3::float8 + 1) * $5::float8 AS x1,
                    ST_Y(o) - $4::float8 * $5::float8 AS nmax, ST_Y(o) - ($4::float8 + 1) * $5::float8 AS nmin FROM a),
       e AS (SELECT b.*, ST_Transform(ST_MakeEnvelope(x0, nmin, x1, nmax, $2::int), 4326) AS g FROM b)
       SELECT x0, x1, nmin, nmax, ST_XMin(g) AS min_lng, ST_YMin(g) AS min_lat, ST_XMax(g) AS max_lng, ST_YMax(g) AS max_lat FROM e`,
      [areaId, srid, cx, cz, size],
    );
    if (!r) return null;
    return {
      cx, cz, sizeM: size, srid, x0: r.x0, x1: r.x1, nMin: r.nmin, nMax: r.nmax,
      bounds: { minLng: r.min_lng, minLat: r.min_lat, maxLng: r.max_lng, maxLat: r.max_lat },
    };
  }

  /**
   * Features of one chunk. Buildings are assigned by centroid (no duplicates across
   * chunks); roads / landuse / water are returned by every chunk they intersect.
   */
  findChunkFeatures(areaId: string, env: ChunkEnvelope, tolerance: number, limit: number) {
    return this.db.query(
      `WITH ${chunkEnvCte({ x0: 2, x1: 3, nMin: 4, nMax: 5, srid: 6 })}
       SELECT ${FEATURE_COLUMNS(`CASE WHEN $7::float8 > 0 THEN ST_SimplifyPreserveTopology(f.geometry, $7::float8) ELSE f.geometry END`)}
       FROM map_features f, e
       WHERE f.area_id = $1 AND f.geometry && e.g
         AND CASE WHEN f.feature_type = 'building'
                  THEN f.centroid && e.g AND ${pointInChunkSql('ST_Transform(f.centroid, $6::int)', { x0: 2, x1: 3, nMin: 4, nMax: 5 })}
                  ELSE ST_Intersects(f.geometry, e.g) END
       ORDER BY f.feature_type, f.id
       LIMIT $8`,
      [areaId, env.x0, env.x1, env.nMin, env.nMax, env.srid, tolerance, limit],
    );
  }
}
