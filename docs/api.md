# API

Base URL: `/api/v1` (NestJS, `apps/api`). Shared TypeScript types: `packages/map-contracts`.

Success envelope:

```json
{ "data": {}, "meta": { "timestamp": "2026-11-10T00:00:00Z" } }
```

Error envelope (NestJS default):

```json
{ "statusCode": 400, "message": "Invalid geographic bounds", "error": "Bad Request" }
```

**Auth:** admin routes (`/admin/**` and write routes on `/places`) require
`Authorization: Bearer <token>` from `POST /auth/login` with role `admin`.
**Rate limiting:** public search endpoints and login are throttled.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ accessToken, expiresIn, user: { email, role } }`. Credentials from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. |
| GET | `/auth/me` | Current admin (requires token). |

## Map

| Method | Path | Notes |
|---|---|---|
| GET | `/map/areas` | Active areas with `bounds`, `crs`, `origin`, `boundary`. |
| GET | `/map/areas/:idOrSlug` | One area by UUID or slug (e.g. `chon-thanh-binh-long`). |
| GET | `/map/areas/:idOrSlug/chunks/:cx/:cz` | **Streaming chunk** (500 m square, see below). Optional `lod`. `Cache-Control: public, max-age=300`; throttled at 900 req/min. |
| GET | `/map/scene` | **Main rendering endpoint.** Query: `areaId` (UUID), `minLng`, `minLat`, `maxLng`, `maxLat`, optional `lod` (0–3), `includeDrafts` (admin only). Returns `{ features: FeatureCollection, objects: MapObject[], places: PlaceSummary[] }` and `meta { areaId, lod, featureCount, objectCount, placeCount }`. Geometry is GeoJSON EPSG:4326; lower LOD = simplified geometry. Bbox ordering, ranges and max area are validated. |
| GET | `/map/features/:id` | One feature (GeoJSON Feature). |
| GET | `/map/objects` | Objects by `areaId` + bounds. |
| GET | `/map/assets` | Active 3D assets with absolute `modelUrl` and `boundingBox`. |

Example:

```http
GET /api/v1/map/scene?areaId=<uuid>&minLng=106.599&minLat=11.416&maxLng=106.613&maxLat=11.428&lod=2
```

### Chunks

The area is divided into `CHUNK_SIZE_M = 500` m squares in its local metric frame
(projected CRS minus the area origin; x = east, z = −north). Chunk `(cx, cz)` covers
`x ∈ [cx·500, (cx+1)·500)` and `z ∈ [cz·500, (cz+1)·500)`.

```http
GET /api/v1/map/areas/chon-thanh-binh-long/chunks/-4/-27
```

```json
{
  "data": {
    "chunk": { "cx": -4, "cz": -27, "sizeM": 500,
               "bounds": { "minLng": 106.6048, "minLat": 11.6526, "maxLng": 106.6094, "maxLat": 11.6571 } },
    "features": { "type": "FeatureCollection", "features": [] },
    "objects": [],
    "places": []
  },
  "meta": { "areaId": "uuid", "cx": -4, "cz": -27, "lod": 2, "featureCount": 475, "objectCount": 3, "placeCount": 2, "timestamp": "…" }
}
```

- Buildings, places and objects belong to exactly one chunk: the one containing their
  centroid / point (half-open intervals, so nothing is duplicated).
- Roads, landuse, water and parks are returned by every chunk they intersect
  (unclipped). Clients should de-duplicate by `properties.id` if they merge chunks.
- Only published objects and active places are included.
- Out-of-range indices → `400` with the valid range in the message; unknown area → `404`.
- Up to 25 000 features per chunk. Coordinates have 6 decimals (~0.1 m). Responses are
  gzip-compressed (a dense Bình Long chunk is ~270 KB of JSON, ~40 KB on the wire).

Feature properties (normalized for rendering):

```json
{ "id": "uuid", "featureType": "road", "source": "osm", "sourceId": "way/910658549",
  "height": null, "levels": null, "styleKey": null,
  "name": "Đường Nguyễn Huệ", "highway": "residential", "widthM": 6 }
```

Microsoft ML footprints have `"source": "microsoft"`, `"sourceId": "ms:<16 hex>"`,
estimated `height` / `levels`, `kind` (`house`, `industrial` or absent) and `"estimated": true`.
Other feature types: `building`, `road`, `park`, `public_space`, `landuse`
(kind = landuse / natural value), `water` (areas, or lines for rivers / streams / canals), `tree`.

## Categories

| Method | Path | Notes |
|---|---|---|
| GET | `/categories` | Ordered active categories (`id, name, slug, icon, color, sortOrder`). |

## Places

| Method | Path | Notes |
|---|---|---|
| GET | `/places` | Query: `q` (diacritic-insensitive: `tap hoa` matches `Tạp hóa`), `categoryId`, `areaId`, `status`, `limit` (≤ 50), `cursor`. |
| GET | `/places/nearby` | `lat`, `lng`, `radius` (meters, ≤ 5000). Sorted by distance. |
| GET | `/places/:id` | Detail: category, location, address, description, phone, opening hours, images, linked `objectIds`. |
| POST | `/places` | Admin. `{ name, categoryId, latitude, longitude, address?, description?, phone?, status?, openingHours? }`. |
| PATCH | `/places/:id` | Admin. Partial update. |
| DELETE | `/places/:id` | Admin. Soft delete. |
| POST | `/places/:id/images` | Admin. `{ imageUrl, altText?, sortOrder? }`. |
| DELETE | `/places/:id/images/:imageId` | Admin. |

## Admin – map objects

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/map/objects/:id` | One object (drafts included). |
| POST | `/admin/map/objects` | `{ areaId, assetId, placeId?, latitude, longitude, elevationM?, rotation?, scale?, status? }`. Position must lie inside the area boundary; asset must be active; place must exist. New objects are `draft`. |
| PATCH | `/admin/map/objects/:id` | Move / rotate / scale / change asset or place. Same validation. |
| DELETE | `/admin/map/objects/:id` | Soft delete. |
| POST | `/admin/map/objects/:id/publish` | Publish one draft. |
| POST | `/admin/map/publish` | `{ areaId }` – publish every draft object of the area. |

`rotation` is radians about +Y (Three.js `rotation.y`); `0` means the model's front (+Z) faces south.

## Admin – uploads

| Method | Path | Notes |
|---|---|---|
| POST | `/admin/uploads/image` | `multipart/form-data` field `file`; JPEG/PNG/WebP only, size-limited. Returns the public URL to attach with `POST /places/:id/images`. Local disk in development; swap the storage driver for S3 signed uploads in production. |

## Admin – OSM import

| Method | Path | Notes |
|---|---|---|
| POST | `/admin/map/import/osm` | `{ areaId, bounds: { minLng, minLat, maxLng, maxLat } }` → `{ jobId, status: "queued" }`. Spawns `services/map-importer` asynchronously. |
| GET | `/admin/map/import/jobs/:id` | `{ jobId, status, startedAt, finishedAt, errorMessage, statistics }`. |

Importer source defaults to the OSM API; set `OSM_IMPORT_SOURCE=file` and
`OSM_IMPORT_FILE=<path>` on the API process for offline imports (e.g. CI).

## Health

`GET /health` → database connectivity check.

## Validation summary

UUIDs (`ParseUUIDPipe` / `@IsUUID`), latitude ∈ [-90, 90], longitude ∈ [-180, 180],
`min < max` for bbox, bbox area and result-size limits from `rules.json → limits`,
asset IDs must reference active assets, objects must be inside the area, admin routes
guarded by JWT + role, throttled public search.
