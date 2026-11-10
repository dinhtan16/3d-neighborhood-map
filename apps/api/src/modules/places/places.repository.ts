import { Injectable } from '@nestjs/common';
import type { GeoBounds } from '@nmap/shared-types';
import { DatabaseService, Queryable } from '../../database/database.service';
import { ChunkEnvelope, chunkEnvCte, pointInChunkSql } from '../map/chunk';

export const PLACE_SUMMARY_COLUMNS = `p.id, p.name, p.slug, p.address, p.status, p.area_id,
  ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
  c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug`;

const FROM = `FROM places p LEFT JOIN place_categories c ON c.id = p.category_id`;

export interface SearchParams {
  q: string | null;
  categoryId: string | null;
  areaId: string | null;
  status: string;
  limit: number;
  after: { s: number; n: string; i: string } | null;
}

@Injectable()
export class PlacesRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Active places whose point lies in the half-open chunk (projected coordinates). */
  findInChunk(areaId: string, env: ChunkEnvelope, limit: number) {
    return this.db.query(
      `WITH ${chunkEnvCte({ x0: 2, x1: 3, nMin: 4, nMax: 5, srid: 6 })}
       SELECT ${PLACE_SUMMARY_COLUMNS} ${FROM}, e
       WHERE p.deleted_at IS NULL AND p.status = 'active' AND p.area_id = $1
         AND p.location::geometry && e.g
         AND ${pointInChunkSql('ST_Transform(p.location::geometry, $6::int)', { x0: 2, x1: 3, nMin: 4, nMax: 5 })}
       ORDER BY p.name, p.id LIMIT $7`,
      [areaId, env.x0, env.x1, env.nMin, env.nMax, env.srid, limit],
    );
  }

  /** Every active place of an area (static demo: region-wide search index). */
  findAllActive(areaId: string) {
    return this.db.query(
      `SELECT ${PLACE_SUMMARY_COLUMNS} ${FROM}
       WHERE p.deleted_at IS NULL AND p.status = 'active' AND p.area_id = $1
       ORDER BY p.name, p.id`,
      [areaId],
    );
  }

  findInBounds(areaId: string, b: GeoBounds, limit: number) {
    return this.db.query(
      `SELECT ${PLACE_SUMMARY_COLUMNS} ${FROM}
       WHERE p.deleted_at IS NULL AND p.status = 'active' AND (p.area_id = $1 OR p.area_id IS NULL)
         AND p.location::geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326)
       ORDER BY p.name, p.id LIMIT $6`,
      [areaId, b.minLng, b.minLat, b.maxLng, b.maxLat, limit],
    );
  }

  /**
   * Diacritic-insensitive search ("cho" matches "Chợ"). Substring match OR trigram similarity,
   * ordered by similarity then name. Keyset pagination over (score DESC, name ASC, id ASC).
   */
  search(p: SearchParams) {
    return this.db.query(
      `WITH base AS (
         SELECT ${PLACE_SUMMARY_COLUMNS},
           CASE WHEN $1::text IS NULL THEN 0
                ELSE round(similarity(f_unaccent(lower(p.name)), f_unaccent(lower($1::text)))::numeric, 4)::float8 END AS score
         ${FROM}
         WHERE p.deleted_at IS NULL AND p.status = $4
           AND ($2::uuid IS NULL OR p.category_id = $2)
           AND ($3::uuid IS NULL OR p.area_id = $3)
           AND ($1::text IS NULL
                OR f_unaccent(lower(p.name)) LIKE '%' || f_unaccent(lower($5::text)) || '%' ESCAPE '\\'
                OR f_unaccent(lower(coalesce(p.address, ''))) LIKE '%' || f_unaccent(lower($5::text)) || '%' ESCAPE '\\'
                OR f_unaccent(lower(p.name)) % f_unaccent(lower($1::text)))
       )
       SELECT * FROM base
       WHERE $6::float8 IS NULL OR score < $6 OR (score = $6 AND (name > $7 OR (name = $7 AND id > $8::uuid)))
       ORDER BY score DESC, name ASC, id ASC
       LIMIT $9`,
      [
        p.q, p.categoryId, p.areaId, p.status, p.q === null ? null : p.q.replace(/[\\%_]/g, (c) => `\\${c}`),
        p.after?.s ?? null, p.after?.n ?? null, p.after?.i ?? null, p.limit + 1,
      ],
    );
  }

  nearby(lat: number, lng: number, radius: number, categoryId: string | null, limit: number) {
    return this.db.query(
      `SELECT ${PLACE_SUMMARY_COLUMNS},
         ST_Distance(p.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
       ${FROM}
       WHERE p.deleted_at IS NULL AND p.status = 'active'
         AND ($4::uuid IS NULL OR p.category_id = $4)
         AND ST_DWithin(p.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
       ORDER BY distance_m, p.id
       LIMIT $5`,
      [lat, lng, radius, categoryId, limit],
    );
  }

  findById(id: string, client?: Queryable) {
    return this.db.one(
      `SELECT ${PLACE_SUMMARY_COLUMNS}, p.description, p.phone, p.opening_hours, p.source, p.category_id
       ${FROM} WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
      client,
    );
  }

  images(placeId: string) {
    return this.db.query(
      `SELECT id, image_url, alt_text, sort_order FROM place_images WHERE place_id = $1 ORDER BY sort_order, created_at`,
      [placeId],
    );
  }

  objectIds(placeId: string) {
    return this.db.query<{ id: string }>(
      `SELECT id FROM map_objects WHERE place_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [placeId],
    );
  }

  areaContaining(lat: number, lng: number, client?: Queryable) {
    return this.db.one<{ id: string }>(
      `SELECT id FROM map_areas WHERE is_active AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint($2, $1), 4326))
       ORDER BY ST_Area(boundary) ASC LIMIT 1`,
      [lat, lng],
      client,
    );
  }

  categoryExists(id: string, client?: Queryable) {
    return this.db.one(`SELECT id FROM place_categories WHERE id = $1 AND is_active`, [id], client);
  }

  slugTaken(slug: string, client?: Queryable) {
    return this.db.one(`SELECT 1 FROM places WHERE slug = $1 AND deleted_at IS NULL`, [slug], client);
  }

  insert(v: Record<string, unknown>, client: Queryable) {
    return this.db.one<{ id: string }>(
      `INSERT INTO places (area_id, category_id, name, slug, description, location, address, phone, opening_hours, status, source)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $8, $9, $10, $11, 'manual')
       RETURNING id`,
      [v.areaId, v.categoryId, v.name, v.slug, v.description ?? null, v.latitude, v.longitude, v.address ?? null,
        v.phone ?? null, v.openingHours ? JSON.stringify(v.openingHours) : null, v.status ?? 'active'],
      client,
    );
  }

  update(id: string, v: Record<string, unknown>, client: Queryable) {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (v.name !== undefined) add('name', v.name);
    if (v.categoryId !== undefined) add('category_id', v.categoryId);
    if (v.description !== undefined) add('description', v.description);
    if (v.address !== undefined) add('address', v.address);
    if (v.phone !== undefined) add('phone', v.phone);
    if (v.status !== undefined) add('status', v.status);
    if (v.openingHours !== undefined) add('opening_hours', JSON.stringify(v.openingHours));
    if (v.areaId !== undefined) add('area_id', v.areaId);
    if (v.latitude !== undefined && v.longitude !== undefined) {
      params.push(v.longitude, v.latitude);
      sets.push(`location = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography`);
    }
    if (!sets.length) return Promise.resolve(null);
    return this.db.one(`UPDATE places SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING id`, params, client);
  }

  softDelete(id: string) {
    return this.db.one(`UPDATE places SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id]);
  }

  insertImage(placeId: string, imageUrl: string, altText: string | null, sortOrder: number | null) {
    return this.db.one(
      `INSERT INTO place_images (place_id, image_url, alt_text, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM place_images WHERE place_id = $1)))
       RETURNING id, image_url, alt_text, sort_order`,
      [placeId, imageUrl, altText, sortOrder],
    );
  }

  deleteImage(placeId: string, imageId: string) {
    return this.db.one(`DELETE FROM place_images WHERE id = $1 AND place_id = $2 RETURNING id`, [imageId, placeId]);
  }
}
