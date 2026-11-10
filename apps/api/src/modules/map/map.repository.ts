import { Injectable } from '@nestjs/common';
import type { GeoBounds } from '@nmap/shared-types';
import { DatabaseService } from '../../database/database.service';

const AREA_COLUMNS = `id, name, slug, crs, origin_lat, origin_lng,
  ST_XMin(boundary) AS min_lng, ST_YMin(boundary) AS min_lat, ST_XMax(boundary) AS max_lng, ST_YMax(boundary) AS max_lat,
  ST_AsGeoJSON(boundary, 7)::json AS boundary`;

const FEATURE_COLUMNS = (geomExpr: string) => `id, feature_type, source, source_id, height_m, levels, style_key,
  properties->'normalized' AS normalized, properties->'tags' AS tags, ST_AsGeoJSON(${geomExpr}, 7)::json AS geom`;

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
}
