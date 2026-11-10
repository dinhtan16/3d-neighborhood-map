# Database

PostgreSQL 16 + PostGIS 3.4. Schema: `apps/api/src/database/migrations/*.sql`
(applied in order by `pnpm db:migrate`, tracked in `schema_migrations`). Seeds:
`pnpm db:seed` (area, categories, assets from `assets/models/manifest.json`).

Extensions: `postgis`, `pgcrypto` (UUIDs), `pg_trgm` + `unaccent` (diacritic-insensitive
Vietnamese search through the immutable wrapper `f_unaccent()`, e.g. `Chơn Thành` → `chon thanh`).

## Tables

| Table | Purpose | Key columns |
|---|---|---|
| `map_areas` | Neighborhood boundary and local projection | `boundary GEOMETRY(MultiPolygon,4326)`, `crs`, `origin_lat/lng`, `slug` (unique) |
| `map_features` | Imported geography (building, road, park, public_space, water, tree) | `geometry GEOMETRY(Geometry,4326)`, `properties JSONB {tags, normalized}`, `height_m`, `levels`, `style_key`, unique `(source, source_id)` |
| `place_categories` | Food & Beverage, Grocery, Retail, Services, Market Stalls, Other | `slug` unique, `icon`, `color`, `sort_order` |
| `places` | Businesses / POIs | `location GEOGRAPHY(Point,4326)`, `status` (active/inactive/pending), `source` (osm/manual), `deleted_at` (soft delete) |
| `place_images` | Ordered images per place | `image_url`, `alt_text`, `sort_order` |
| `map_assets` | Reusable GLB models | `asset_key` unique, `model_url`, `bounding_box JSONB`, `metadata JSONB`, `version` |
| `map_objects` | Positioned asset instances | `position GEOGRAPHY(Point,4326)`, `elevation_m`, `rotation` (rad about +Y), `scale JSONB`, `status` (draft/published), `deleted_at` |
| `import_jobs` | Async OSM import tracking | `status` (queued/running/succeeded/failed), `bounds`, `statistics JSONB`, `error_message` |

### `map_features.properties`

```json
{
  "tags": { "highway": "residential", "name": "Đường Nguyễn Huệ" },
  "normalized": {
    "name": "Đường Nguyễn Huệ",
    "highway": "residential",
    "widthM": 6,
    "sidewalkM": 1.2,
    "kind": "residential",
    "layer": null
  }
}
```

Buildings additionally get `normalized.heightEstimated`. Original OSM tags are always kept.

### `map_assets.bounding_box`

```json
{ "min": [-2.35, 0, -6.76], "max": [2.35, 9.24, 6.76], "size": [4.7, 9.24, 13.52],
  "origin": "base-center", "forward": "+Z", "units": "meters" }
```

## Indexes

GiST on every geographic column (`map_areas.boundary`, `map_features.geometry`,
`places.location`, `map_objects.position`), B-tree on foreign keys and
`(area_id, feature_type)`, partial unique indexes on `(source, source_id) WHERE source_id IS NOT NULL`
for idempotent imports, `uq_places_slug WHERE deleted_at IS NULL`, and a trigram GIN index on
`f_unaccent(lower(places.name))`.

## Rules

1. Original OSM tags live in JSONB; frequently used fields (height, levels, style) are normalized columns.
2. Geography (`map_features`) is separate from rendering instances (`map_objects`) and businesses (`places`).
3. Places and manually created objects are soft-deleted (`deleted_at`).
4. All schema changes go through numbered SQL migrations.
5. Coordinates are validated before saving (CHECK constraints + API validation + `ST_IsValid` on boundaries).
6. Importer never overwrites `source = 'manual'` places nor objects with `metadata.manualOverride = true`;
   soft-deleted OSM places stay deleted on re-import.

## Useful queries

```sql
-- Features in a bbox (what /map/scene does, simplified)
SELECT id, feature_type, ST_AsGeoJSON(geometry) FROM map_features
WHERE area_id = $1 AND geometry && ST_MakeEnvelope($2, $3, $4, $5, 4326);

-- Places within 500 m
SELECT name FROM places
WHERE deleted_at IS NULL AND ST_DWithin(location, ST_MakePoint(106.606, 11.422)::geography, 500);

-- Diacritic-insensitive search
SELECT name FROM places WHERE f_unaccent(lower(name)) LIKE '%' || f_unaccent(lower('tap hoa')) || '%';
```

## Migration 002 – region sources

- `map_features.source` now also accepts `'microsoft'` (Microsoft Global ML Building Footprints).
- `map_features.centroid GEOMETRY(Point, 4326)` – generated, stored `ST_PointOnSurface(geometry)` with a
  GIST index. The chunk endpoint assigns buildings to exactly one 500 m chunk by this point.
- Extra indexes: `(area_id, feature_type)`, `(area_id, source)`.
- New feature types written by the importer: `landuse` (kind = landuse / natural value) and
  `water` lines for rivers, streams and canals.
