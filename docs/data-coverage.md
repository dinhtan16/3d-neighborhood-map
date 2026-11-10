# Data coverage – Chơn Thành · Minh Hưng · Bình Long

The map area `chon-thanh-binh-long` covers the QL13 corridor from central Chơn Thành
through Minh Hưng to Bình Long (An Lộc):

| | |
|---|---|
| Bounding box | W 106.555 · S 11.370 · E 106.690 · N 11.700 (≈ 14.7 km × 36.5 km) |
| CRS / origin | EPSG:32648 (UTM 48N), origin 11.535 N 106.6225 E |
| Chunk grid | 500 m chunks, cx −15…14, cz −37…36 (2 118 non-empty) |
| Old v1 area | `chon-thanh` (1.5 km box) is kept in the DB with `is_active = false` |

## Sources

1. **OpenStreetMap** – 119 OSM API `map` tiles of 0.02° (the API's per-request limits
   make tiling necessary; Geofabrik and Overpass were unreachable from the build
   environment). Tiles overlap, so the importer merges them and de-duplicates by
   `(type, id)` before assembling geometry (`--source tiles --dir …`).
2. **Microsoft Global ML Building Footprints** – quadkey `132212333` from
   `minedbuildings.z5.web.core.windows.net` (release 2026-02-03). Footprints are
   machine-traced from satellite imagery; Vietnam has no height values, so floors are
   estimated (see below).

Both are reproducible offline from the compressed fixtures in
`services/map-importer/fixtures/region/`:

| File | Size | Content |
|---|---|---|
| `osm-region.json.gz` | 1.0 MB | 78 094 OSM elements (only ways/relations with highway, building, landuse, leisure, natural, waterway, amenity, shop, tourism or place tags, their nodes, and tagged POI nodes) |
| `ms-buildings-region.geojsonl.gz` | 1.8 MB | 55 509 footprints whose (rounded) vertex centroid is inside the bbox |

## What was imported (2026-11-10)

| Feature | Count |
|---|---|
| Buildings – Microsoft | 55 009 (500 skipped: overlap > 30 % with an OSM building) |
| Buildings – OSM | 659 |
| Roads | 9 662 (service 4 874, residential 2 334, footway 1 994, unclassified 103, trunk 100, tertiary 100, secondary 42, …) |
| Landuse / natural areas | 44 (forest 27, industrial 5, wood 4, orchard 3, …) |
| Water | 22 (streams, rivers, canals as lines; reservoirs as areas) |
| Parks / public spaces | 13 / 14 |
| Places (named POIs) | 206 (food & beverage 80, grocery 70, services 27, other 21, retail 7, market stalls 1) |
| Generated shop objects | 179 (places inside a building footprint have none – the building represents them) |

Estimated floors of the Microsoft footprints: 1 floor 20 310 · 2 floors 20 261 ·
3 floors 11 746 · 4 floors 2 692.

### Floor estimation (Microsoft footprints)

Deterministic (FNV-1a of `source_id`), so re-imports give identical heights:

| Footprint | Floors |
|---|---|
| < 40 m² | 1 |
| 40–250 m², aspect ≥ 1.8 (tube house / nhà ống) | 1 : 5 % · 2 : 45 % · 3 : 35 % · 4 : 15 % |
| 40–250 m², aspect < 1.8 | 1 : 35 % · 2 : 45 % · 3 : 20 % |
| 250–800 m² | 1 : 40 % · 2 : 40 % · 3 : 20 % |
| > 800 m² | 1, `kind = industrial` (factories / warehouses) |

`height_m = floors × 3.5 ± 0.3 m`, `properties.normalized.estimated = true`, and the API
exposes `estimated: true` on those features. The frontend chooses colours (`style_key` is null).

## Import order

```bash
python3 services/map-importer/src/main.py --area-slug chon-thanh-binh-long --source tiles --dir <tiles>   # or --source file --file fixtures/region/osm-region.json.gz
python3 services/map-importer/src/main.py --area-slug chon-thanh-binh-long --source msbuildings --file fixtures/region/ms-buildings-region.geojsonl.gz
python3 services/map-importer/src/main.py --area-slug chon-thanh-binh-long --source file --file fixtures/region/osm-region.json.gz
```

OSM goes first so overlapping Microsoft footprints are skipped in favour of the OSM
building. The final OSM re-run (idempotent, ~2 s) removes generated shop models for
places that now sit inside a footprint. Timings on the dev machine: OSM ≈ 2–5 s,
Microsoft ≈ 10 s (COPY into a staging table + one set-based upsert).

## Known gaps

- ML footprints are not perfect: merged row houses, missing small structures, and
  occasional footprints on trees or shadows.
- Heights are estimates, not measurements.
- POI coverage is thin outside the town centres; many shops have no OSM node yet.

## How to improve coverage

- Add or correct buildings and shops in OpenStreetMap (iD editor), then re-import.
  OSM buildings replace overlapping Microsoft footprints automatically.
- Add places and 3D objects manually in the admin; manual places and objects with
  `metadata.manualOverride = true` are never overwritten by imports.

## Licensing and attribution

- © OpenStreetMap contributors – ODbL 1.0 (https://www.openstreetmap.org/copyright)
- Building footprints © Microsoft – ODbL 1.0 (https://github.com/microsoft/GlobalMLBuildingFootprints)

Both credits must stay visible in the map UI and in any distributed derived database.
