# Data coverage – Chơn Thành

Area: **Chơn Thành – trung tâm** (QL13 corridor around Ấp 1 Minh Long / Khu phố 8),
formerly Thị xã Chơn Thành, Bình Phước. OSM now places it in Phường Chơn Thành,
Thành phố Đồng Nai after the 2025 administrative merger.

| Item | Value |
|---|---|
| Bounding box | `106.5990, 11.4160, 106.6130, 11.4280` (≈ 1.5 km × 1.3 km) |
| CRS | EPSG:32648 (WGS 84 / UTM zone 48N) |
| Local origin | 11.4220 N, 106.6060 E |
| Fixture | `services/map-importer/fixtures/chon-thanh-center.osm.json` (OSM API `map` call, 1 937 elements) |

## What OSM contains here (import of 2026-11-10)

| Feature | Count | Notes |
|---|---|---|
| Road ways | 244 | 156 service, 43 footway, 41 residential, 2 secondary (ĐT751), 1 tertiary, 1 unclassified; named: Đường tỉnh 751, Đường huyện 239, Đường Nguyễn Huệ |
| Building footprints | **0** | No buildings have been traced in this part of OSM |
| Public spaces / water | 0 | One untagged-for-rendering landuse polygon |
| Named POIs | 20 | Grocery (tạp hóa), eateries, guesthouses, internet cafés, a café, schools |

POI names use a local mapper convention: `PREFIX-Name-Address`, e.g.
`TH-Hà Thu-Tổ 4- Ấp 1 Minh Long- TT Chơn Thành- Bình Phước`. The importer turns this into
name **Tạp hóa Hà Thu**, address **Tổ 4, Ấp 1 Minh Long, TT Chơn Thành, Bình Phước**, and
uses the prefix to pick the category (`TH` grocery, `QA`/`CF` food & beverage,
`NN`/`KA`/`Net` services). The prefix wins over obviously wrong tags
(e.g. a restaurant tagged `amenity=pharmacy`).

## Consequences for the map

* Roads render accurately from OSM.
* Because there are no footprints, each POI gets a generated shophouse / café model
  (`map_objects`, `source = 'osm'`) facing its nearest road and placed clear of
  the carriageway. These are illustrations positioned at real GPS points, **not** surveyed buildings.
* Blocks without POIs look empty until buildings are added.

## How to improve coverage

1. **Trace buildings in OpenStreetMap** with the iD editor
   (https://www.openstreetmap.org/edit, Bing/Esri imagery), adding `building=*` and
   `building:levels=*` where known. Re-run the import (admin "Import OSM" or
   `pnpm import:osm -- --area-slug chon-thanh`); new footprints appear as extruded buildings,
   and generated objects inside a building footprint are skipped automatically.
2. **Add places manually** in the admin (`/admin/places`). Manual places are never
   overwritten by imports.
3. **Adjust generated objects** in the admin map editor. To protect an edit from later
   imports, the object must carry `metadata.manualOverride = true`; the importer never
   moves, rotates or deletes such objects.
4. Fix POI tags upstream in OSM (e.g. `shop=convenience` for tạp hóa, `tourism=guest_house` for nhà nghỉ).

## Licensing

Map data © OpenStreetMap contributors, available under the
[Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
The attribution "© OpenStreetMap contributors" is shown on the map. If the derived
database (PostGIS contents) is distributed publicly, it must be offered under ODbL.
The committed fixture is an unmodified OSM extract and is ODbL-licensed.
