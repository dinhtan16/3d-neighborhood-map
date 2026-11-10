# 3D Neighborhood Map

An interactive 3D map of real towns in an illustrated isometric cartoon style.
The area is the QL13 corridor **Chơn Thành – Minh Hưng – Bình Long** (formerly Bình Phước
province, ≈ 15 × 37 km), streamed in 500 m chunks. Streets, landuse and places come from
OpenStreetMap; 55 000 building footprints come from Microsoft's ML building dataset (with
estimated floors); shops are GLB models placed at their real GPS positions; an admin can
manage places and 3D objects.

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
  map-importer/        Python OSM + Microsoft footprints → PostGIS import pipeline (+ tests, region fixtures)
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
migrates and seeds the database, and imports the region from the committed fixtures
(`services/map-importer/fixtures/region/*.gz`: OSM + Microsoft footprints, 2.9 MB), so it works offline. Then start the apps:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Open http://localhost:3000/map/chon-thanh-binh-long. The admin is at http://localhost:3000/admin
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
pnpm import:osm -- --area-slug chon-thanh-binh-long --source file --file services/map-importer/fixtures/region/osm-region.json.gz
pnpm import:osm -- --area-slug chon-thanh-binh-long --source msbuildings --file services/map-importer/fixtures/region/ms-buildings-region.geojsonl.gz
pnpm import:osm -- --area-slug chon-thanh-binh-long --source file --file services/map-importer/fixtures/region/osm-region.json.gz
```

The second OSM run is idempotent and drops generated shop models for places that now sit
inside a building footprint. To refresh from live data instead, download OSM API tiles into a
folder and use `--source tiles --dir <folder>`, and fetch the Microsoft quadkey file listed in
[docs/data-coverage.md](docs/data-coverage.md).

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
| `pnpm import:osm -- --area-slug chon-thanh-binh-long [--source osm-api\|overpass\|file\|tiles\|msbuildings]` | Run the importer (`--file`, `--dir`, `--save-fixture`, `--dry-run`) |
| `pnpm --filter api export:static` | Export chunk packs for the static demo (`apps/web/public/demo-data/<area>/`) |
| `pnpm --filter web build:demo` | Build the backend-free demo into `apps/web/dist-demo` |
| `pnpm test` | All JS/TS tests (geo-core, api, web) |
| `python3 -m pytest services/map-importer/tests` | Importer tests |

## Static demo

The demo runs without a backend. `export:static` writes `demo-data/<area>/area.json`
(area, categories, assets, every active place for search, chunk range, pack list) and
`demo-data/<area>/packs/p_<px>_<pz>.json` (4 × 4 chunks each, with place details), about
35 MB in 159 packs for the region, plus the GLB models in `demo-data/models/`. `build:demo`
bundles everything into `apps/web/dist-demo`.

The packs are not committed: `.github/workflows/demo-pages.yml` rebuilds them on every push to
`main` from the committed fixtures (PostGIS service → migrate → seed → import → export) and
deploys to GitHub Pages (enable it under Settings → Pages → Source: GitHub Actions).

## Data

See [docs/data-coverage.md](docs/data-coverage.md). Imported for the region: 9 662 OSM road
ways, 659 OSM buildings plus 55 009 Microsoft ML footprints (floors estimated from size and
shape), 44 landuse areas, 22 water features and 206 named places. Places that are not inside a
building footprint get a generated shophouse or café model facing the nearest road.

## Docs

* [Architecture](docs/architecture.md)
* [Database](docs/database.md)
* [API](docs/api.md)
* [3D asset guidelines](docs/asset-guidelines.md)
* [Data coverage](docs/data-coverage.md)

## Attribution & licensing

Map data © OpenStreetMap contributors, licensed under the
[ODbL](https://www.openstreetmap.org/copyright). Building footprints © Microsoft
([Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints), ODbL).
Both attributions are shown on the map.
Generated 3D models in `assets/models` are CC0 (produced by `assets/scripts/build-assets.mjs`).
