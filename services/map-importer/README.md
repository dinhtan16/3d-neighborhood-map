# map-importer

Standalone Python process that imports OpenStreetMap data into PostGIS.
Runs outside the NestJS request lifecycle; the API spawns it for
`POST /api/v1/admin/map/import/osm` with `--job-id`.

```bash
pip install -r services/map-importer/requirements.txt          # psycopg 3
python3 services/map-importer/src/main.py --area-slug chon-thanh \
  --source file --file services/map-importer/fixtures/chon-thanh-center.osm.json
python3 services/map-importer/src/main.py --area-slug chon-thanh            # live OSM API
python3 services/map-importer/src/main.py --area-slug chon-thanh --source overpass
python3 services/map-importer/src/main.py --job-id <uuid>                   # API mode
python3 services/map-importer/src/main.py --area-slug chon-thanh --dry-run  # rolled back
```

| Option | Default | |
|---|---|---|
| `--source` | `$OSM_IMPORT_SOURCE` or `osm-api` | `osm-api` (OSM API `map` call), `overpass`, `file` |
| `--file` | `$OSM_IMPORT_FILE` | OSM JSON (`{"elements": [...]}`) |
| `--bounds` | area bbox / job bounds | `minLng,minLat,maxLng,maxLat` |
| `--dry-run` | off | Everything runs in a transaction that is rolled back |

`DATABASE_URL` comes from the environment or the repo `.env`.

## Modules

| File | Role |
|---|---|
| `src/fetch.py` | OSM API / Overpass / file acquisition (urllib, retries, descriptive User-Agent) |
| `src/geometry.py` | Way → LineString/Polygon, multipolygon relations with ring stitching and holes, structural validation, RFC 7946 orientation |
| `src/normalize.py` | Rules from `packages/map-config/rules.json`: classification, building height policy, road widths, FNV-1a style keys (identical to `geo-core`), categories, Vietnamese name prefixes |
| `src/extract.py` | Elements → feature records + place records |
| `src/db.py` | Idempotent upserts on `(source, source_id)`, `ST_MakeValid`, stale cleanup, generated place objects (front faces nearest road, de-overlapped along the frontage) |
| `src/main.py` | CLI, job lifecycle (`queued → running → succeeded/failed` + statistics) |

## Tests

```bash
pip install -r services/map-importer/requirements-dev.txt
python3 -m pytest services/map-importer/tests -q
```

Unit tests cover normalization (including cross-language hash vectors from TypeScript),
geometry assembly and fixture extraction. The integration test imports the fixture
twice into a throwaway area inside a rolled-back transaction and checks idempotency
and `manualOverride` protection. It is skipped when the database is unreachable.
