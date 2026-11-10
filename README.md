# 3D Neighborhood Map

An interactive 3D map of a real neighborhood in an illustrated isometric cartoon style.
The first area is **Chơn Thành** (the QL13 centre, formerly Bình Phước province). Streets come from
OpenStreetMap, buildings are generated from footprints, shops are GLB models placed at
their real GPS positions, and an admin can manage places and 3D objects.

**Live demo (read-only, no backend):** https://claude.ai/artifact/E9U2UugXQQqv213NAZ3TXF

**Stack:** Next.js + React Three Fiber (web) · NestJS (API) · PostgreSQL 16 + PostGIS 3.4 ·
Python OSM importer · procedural GLB assets (three.js + glTF-Transform, meshopt-compressed).

> Geospatial data defines **where** an object belongs. Procedural geometry and GLB assets
> define **what** it looks like. The frontend defines **how** the user interacts with it.

## Monorepo layout

```text
apps/
  web/                 Next.js app: public map (/map/[areaSlug]), admin (/admin/*), static demo (demo/)
  api/                 NestJS REST API (/api/v1), SQL migrations + seeds, static export script
packages/
  shared-types/        primitive shared types
  map-contracts/       API request/response DTOs
  geo-core/            projection, polygons, road meshes, height policy, bbox validation (+ tests)
  map-config/          rules.json (single source of geometry rules), palette, camera config
services/
  map-importer/        Python OSM → PostGIS import pipeline (+ tests, Chơn Thành fixture)
assets/
  scripts/             build-assets.mjs (GLB generator), render-previews.mjs
  models/              *.glb + manifest.json
  previews/            PNG previews
infrastructure/
  docker/              docker-compose (PostGIS, optional MinIO)
  scripts/             bootstrap.sh
docs/                  architecture, database, api, asset guidelines, data coverage
```

## Quick start

Prerequisites: Node 20+ with pnpm 10, Python 3.11+, and PostgreSQL 16 with PostGIS 3.4
(Docker, or a local install).

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

```bash
./infrastructure/scripts/bootstrap.sh
```

`bootstrap.sh` installs dependencies, builds the shared packages, generates the GLB assets,
migrates and seeds the database, and imports Chơn Thành from the committed OSM fixture,
so it works offline. Then start the apps:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Open http://localhost:3000/map/chon-thanh. The admin is at http://localhost:3000/admin
(credentials `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`).

### Manual steps

```bash
cp .env.example .env
pnpm install
pip install -r services/map-importer/requirements.txt
pnpm build:packages
pnpm assets:build
pnpm db:migrate
pnpm db:seed
pnpm import:osm -- --area-slug chon-thanh --source file --file services/map-importer/fixtures/chon-thanh-center.osm.json
```

## Environment

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/neighborhood_map` | PostGIS database |
| `API_PORT` | `4000` | |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | – | MVP single-admin login |
| `JWT_SECRET` | – | Signs admin tokens |
| `STORAGE_PUBLIC_BASE_URL` | `http://localhost:4000/static` | Base URL for models and images; point at S3/CDN in production |
| `STORAGE_LOCAL_DIR` | `./storage` | Local uploads |
| `IMPORTER_PYTHON` | `python3` | Interpreter the API uses to spawn the importer |
| `OSM_IMPORT_SOURCE` / `OSM_IMPORT_FILE` | `osm-api` / – | Importer source when spawned by the API (`file` for offline) |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api/v1` | Web → API |

## Commands

| Command | |
|---|---|
| `pnpm build:packages` | Build shared TS packages (needed before api/web) |
| `pnpm dev:api` / `pnpm dev:web` | Run API (:4000) / web (:3000) |
| `pnpm db:migrate` / `pnpm db:seed` | Apply SQL migrations / seed area, categories, assets |
| `pnpm assets:build` | Regenerate GLB models + manifest |
| `pnpm --filter @nmap/assets previews` | Render PNG previews of the models |
| `pnpm import:osm -- --area-slug chon-thanh [--source osm-api\|overpass\|file]` | Run the OSM importer |
| `pnpm --filter api export:static` | Export the published scene for the static demo |
| `pnpm --filter web build:demo` | Build the backend-free demo into `apps/web/dist-demo` |
| `pnpm test` | All JS/TS tests (geo-core, api, web) |
| `python3 -m pytest services/map-importer/tests` | Importer tests |

## Static demo

The demo runs without a backend. `export:static` writes the area, categories, scene and
place details plus the GLB models to `apps/web/public/demo-data`; `build:demo` bundles them
into `apps/web/dist-demo`. `.github/workflows/demo-pages.yml` deploys it to GitHub Pages on
every push to `main` (enable it under Settings → Pages → Source: GitHub Actions).

## Data

See [docs/data-coverage.md](docs/data-coverage.md). In the Chơn Thành bbox OSM has 244 road
ways and 20 named POIs, but **no building footprints yet**. Each POI therefore gets a
generated shophouse or café model that faces its nearest road. Tracing buildings in OSM and
re-importing adds real extruded buildings automatically.

## Docs

* [Architecture](docs/architecture.md)
* [Database](docs/database.md)
* [API](docs/api.md)
* [3D asset guidelines](docs/asset-guidelines.md)
* [Data coverage](docs/data-coverage.md)

## Attribution & licensing

Map data © OpenStreetMap contributors, licensed under the
[ODbL](https://www.openstreetmap.org/copyright). The attribution is shown on the map.
Generated 3D models in `assets/models` are CC0 (produced by `assets/scripts/build-assets.mjs`).
