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
| GET | `/map/areas/:idOrSlug` | One area by UUID or slug (e.g. `chon-thanh`). |
| GET | `/map/scene` | **Main rendering endpoint.** Query: `areaId` (UUID), `minLng`, `minLat`, `maxLng`, `maxLat`, optional `lod` (0–3), `includeDrafts` (admin only). Returns `{ features: FeatureCollection, objects: MapObject[], places: PlaceSummary[] }` and `meta { areaId, lod, featureCount, objectCount, placeCount }`. Geometry is GeoJSON EPSG:4326; lower LOD = simplified geometry. Bbox ordering, ranges and max area are validated. |
| GET | `/map/features/:id` | One feature (GeoJSON Feature). |
| GET | `/map/objects` | Objects by `areaId` + bounds. |
| GET | `/map/assets` | Active 3D assets with absolute `modelUrl` and `boundingBox`. |

Example:

```http
GET /api/v1/map/scene?areaId=<uuid>&minLng=106.599&minLat=11.416&maxLng=106.613&maxLat=11.428&lod=2
```

Feature properties (normalized for rendering):

```json
{ "id": "uuid", "featureType": "road", "source": "osm", "sourceId": "way/910658549",
  "height": null, "levels": null, "styleKey": null,
  "name": "Đường Nguyễn Huệ", "highway": "residential", "widthM": 6 }
```

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
