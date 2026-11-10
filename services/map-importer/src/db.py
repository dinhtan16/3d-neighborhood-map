"""PostGIS persistence. All writes are idempotent upserts keyed on (source, source_id)."""
from __future__ import annotations

import json
import math
import time
from collections import Counter

import psycopg
from psycopg.rows import dict_row

from extract import FeatureRecord, PlaceRecord

ASSET_BY_CATEGORY = {
    "food-beverage": "cafe-01",
    "grocery": "shophouse-01",
    "market-stalls": "fruit-stall-01",
    "retail": "shophouse-02",
    "services": "shophouse-02",
    "other": "shophouse-01",
}
# Roads that a shop front would plausibly face.
FRONTAGE_EXCLUDE = ("footway", "path", "steps", "cycleway", "construction", "track")
FRONT_CLEARANCE_M = 0.5
MAX_FRONTAGE_SEARCH_M = 80


def connect(url: str) -> psycopg.Connection:
    return psycopg.connect(url, row_factory=dict_row)


def srid_of(crs: str) -> int:
    if not crs.upper().startswith("EPSG:"):
        raise ValueError(f"Unsupported CRS {crs}")
    return int(crs.split(":", 1)[1])


# ---------------------------------------------------------------------------
# Areas / jobs
# ---------------------------------------------------------------------------
def get_area(conn, *, area_id: str | None = None, slug: str | None = None) -> dict:
    row = conn.execute(
        """SELECT id::text, name, slug, crs, origin_lat, origin_lng,
                  ST_XMin(boundary) AS min_lng, ST_YMin(boundary) AS min_lat,
                  ST_XMax(boundary) AS max_lng, ST_YMax(boundary) AS max_lat
           FROM map_areas WHERE (%s::uuid IS NULL OR id = %s::uuid) AND (%s::text IS NULL OR slug = %s)""",
        (area_id, area_id, slug, slug),
    ).fetchone()
    if not row:
        raise SystemExit(f"Map area not found ({area_id or slug}). Run `pnpm db:seed` first.")
    return row


def get_job(conn, job_id: str) -> dict:
    row = conn.execute("SELECT id::text, area_id::text, source, status, bounds FROM import_jobs WHERE id = %s", (job_id,)).fetchone()
    if not row:
        raise SystemExit(f"Import job {job_id} not found")
    return row


def create_job(conn, area_id: str, bounds: dict, source: str = "osm") -> str:
    row = conn.execute(
        "INSERT INTO import_jobs (area_id, source, status, bounds) VALUES (%s, %s, 'queued', %s) RETURNING id::text",
        (area_id, source, json.dumps(bounds)),
    ).fetchone()
    conn.commit()
    return row["id"]


def mark_job(conn, job_id: str, status: str, *, error: str | None = None, stats: dict | None = None) -> None:
    if status == "running":
        conn.execute("UPDATE import_jobs SET status='running', started_at=now(), error_message=NULL WHERE id=%s", (job_id,))
    else:
        conn.execute(
            "UPDATE import_jobs SET status=%s, finished_at=now(), error_message=%s, statistics=%s WHERE id=%s",
            (status, error, json.dumps(stats) if stats is not None else None, job_id),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------
_EXTRACT_TYPE = {"Polygon": 3, "MultiPolygon": 3, "LineString": 2, "MultiLineString": 2, "Point": 1}

STAGE_FEATURES = """
CREATE TEMP TABLE IF NOT EXISTS stage_features (
  source_id text PRIMARY KEY, feature_type text, geom text, extract int,
  props jsonb, height double precision, levels int, style text
) ON COMMIT DROP
"""

# One set-based statement per import: validate/repair geometry, keep only
# features touching the area, upsert on the external identity.
UPSERT_STAGED = """
WITH g AS (
  SELECT s.*, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(s.geom), 4326)), s.extract)) AS mg
  FROM stage_features s
), c AS (
  SELECT g.*, CASE WHEN ST_NumGeometries(mg) = 1 THEN ST_GeometryN(mg, 1) ELSE mg END AS gg FROM g
), a AS (SELECT boundary FROM map_areas WHERE id = %(area_id)s)
INSERT INTO map_features (area_id, feature_type, source, source_id, geometry, properties, height_m, levels, style_key)
SELECT %(area_id)s, c.feature_type, %(source)s, c.source_id, c.gg, c.props, c.height, c.levels, c.style
FROM c, a
WHERE c.gg IS NOT NULL AND NOT ST_IsEmpty(c.gg) AND ST_Intersects(a.boundary, c.gg)
ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
  area_id = EXCLUDED.area_id,
  feature_type = EXCLUDED.feature_type,
  geometry = EXCLUDED.geometry,
  properties = EXCLUDED.properties,
  height_m = EXCLUDED.height_m,
  levels = EXCLUDED.levels,
  style_key = EXCLUDED.style_key
RETURNING source_id, feature_type, (xmax = 0) AS inserted
"""

# Drop staged Microsoft footprints that overlap an OSM building by > 30 % of their area.
DROP_OVERLAPPING_OSM = """
WITH x AS MATERIALIZED (
  SELECT source_id, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geom), 4326)) AS g FROM stage_features
), hit AS (
  SELECT DISTINCT x.source_id
  FROM x JOIN map_features f
    ON f.area_id = %(area_id)s AND f.source = 'osm' AND f.feature_type = 'building' AND f.geometry && x.g
  WHERE ST_Intersects(f.geometry, x.g)
    AND ST_Area(ST_Intersection(ST_MakeValid(f.geometry), x.g)) > 0.3 * ST_Area(x.g)
)
DELETE FROM stage_features s USING hit WHERE s.source_id = hit.source_id
"""


def upsert_features(conn, area_id: str, features: list[FeatureRecord], stats: Counter, *,
                    source: str = "osm", skip_overlapping_osm_buildings: bool = False) -> set[str]:
    """Bulk upsert via COPY into a temp staging table (tens of thousands of rows per second)."""
    unique: dict[str, FeatureRecord] = {}
    for f in features:
        unique[f.source_id] = f
    conn.execute(STAGE_FEATURES)
    conn.execute("TRUNCATE stage_features")
    with conn.cursor() as cur:
        with cur.copy("COPY stage_features (source_id, feature_type, geom, extract, props, height, levels, style) FROM STDIN") as cp:
            for f in unique.values():
                cp.write_row((
                    f.source_id, f.feature_type, json.dumps(f.geometry), _EXTRACT_TYPE[f.geometry["type"]],
                    json.dumps(f.properties, ensure_ascii=False), f.height_m, f.levels, f.style_key,
                ))
    if skip_overlapping_osm_buildings:
        t = time.monotonic()
        stats["features_skipped_overlapping_osm"] = conn.execute(DROP_OVERLAPPING_OSM, {"area_id": area_id}).rowcount
        stats["timing_overlap_ms"] = round((time.monotonic() - t) * 1000)
    staged = conn.execute("SELECT count(*) AS n FROM stage_features").fetchone()["n"]
    t = time.monotonic()
    rows = conn.execute(UPSERT_STAGED, {"area_id": area_id, "source": source}).fetchall()
    stats["timing_upsert_ms"] = round((time.monotonic() - t) * 1000)
    kept: set[str] = set()
    for row in rows:
        kept.add(row["source_id"])
        stats[f"features_{row['feature_type']}"] += 1
        stats["features_inserted" if row["inserted"] else "features_updated"] += 1
    stats["features_outside_area_or_empty"] += staged - len(rows)
    return kept


def delete_stale_features(conn, area_id: str, bounds: dict, kept: set[str], source: str = "osm") -> int:
    """Remove features of this source inside the fetched bbox that no longer exist upstream."""
    # OSM: only features entirely inside the fetched bbox (others may extend into
    # unfetched space). Microsoft: footprints are assigned to a bbox by centroid,
    # the same rule the loader uses.
    spatial = ("ST_Intersects(centroid, ST_MakeEnvelope(%s, %s, %s, %s, 4326))" if source == "microsoft"
               else "ST_CoveredBy(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))")
    rows = conn.execute(
        f"""DELETE FROM map_features
           WHERE area_id = %s AND source = %s
             AND {spatial}
             AND NOT (source_id = ANY(%s))
           RETURNING id""",
        (area_id, source, bounds["minLng"], bounds["minLat"], bounds["maxLng"], bounds["maxLat"], list(kept)),
    ).fetchall()
    return len(rows)


# ---------------------------------------------------------------------------
# Places
# ---------------------------------------------------------------------------
UPSERT_PLACE = """
INSERT INTO places (area_id, category_id, name, slug, description, location, address, phone, opening_hours,
                    status, source, source_id)
SELECT %(area_id)s, c.id, %(name)s, %(slug)s, %(description)s,
       ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography, %(address)s, %(phone)s, %(hours)s,
       'active', 'osm', %(source_id)s
FROM map_areas a
LEFT JOIN place_categories c ON c.slug = %(category)s
WHERE a.id = %(area_id)s AND ST_Covers(a.boundary, ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326))
ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
  area_id = EXCLUDED.area_id,
  category_id = EXCLUDED.category_id,
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  location = EXCLUDED.location,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  opening_hours = EXCLUDED.opening_hours
WHERE places.source = 'osm'          -- manual places are never overwritten
RETURNING id::text, (xmax = 0) AS inserted, deleted_at IS NOT NULL AS deleted
"""


def upsert_places(conn, area_id: str, places: list[PlaceRecord], stats: Counter) -> dict[str, dict]:
    """Returns {source_id: {id, category, place}} for live (not soft-deleted) places."""
    missing = conn.execute("SELECT count(*) AS n FROM place_categories").fetchone()["n"] == 0
    if missing:
        raise SystemExit("place_categories is empty. Run `pnpm db:seed` first.")
    live: dict[str, dict] = {}
    with conn.cursor() as cur:
        for p in places:
            cur.execute(
                UPSERT_PLACE,
                {
                    "area_id": area_id, "name": p.name, "slug": p.slug, "description": p.description,
                    "lng": p.lng, "lat": p.lat, "address": p.address, "phone": p.phone,
                    "hours": json.dumps(p.opening_hours) if p.opening_hours else None,
                    "category": p.category_slug, "source_id": p.source_id,
                },
            )
            row = cur.fetchone()
            if row is None:
                stats["places_outside_area"] += 1
                continue
            stats["places_inserted" if row["inserted"] else "places_updated"] += 1
            if row["deleted"]:
                stats["places_kept_deleted"] += 1
                continue
            live[p.source_id] = {"id": row["id"], "category": p.category_slug, "place": p}
    return live


def deactivate_stale_places(conn, area_id: str, bounds: dict, kept: set[str]) -> int:
    rows = conn.execute(
        """UPDATE places SET status = 'inactive'
           WHERE area_id = %s AND source = 'osm' AND status = 'active' AND deleted_at IS NULL
             AND ST_Covers(ST_MakeEnvelope(%s, %s, %s, %s, 4326), location::geometry)
             AND NOT (source_id = ANY(%s))
           RETURNING id""",
        (area_id, bounds["minLng"], bounds["minLat"], bounds["maxLng"], bounds["maxLat"], list(kept)),
    ).fetchall()
    return len(rows)


# ---------------------------------------------------------------------------
# Map objects generated for OSM places
# ---------------------------------------------------------------------------
NEAREST_ROAD = """
WITH p AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326), %(srid)s) AS g)
SELECT f.source_id,
       COALESCE((f.properties->'normalized'->>'widthM')::float, 4) AS width_m,
       COALESCE((f.properties->'normalized'->>'sidewalkM')::float, 0) AS sidewalk_m,
       ST_X(p.g) AS px, ST_Y(p.g) AS py,
       ST_X(ST_ClosestPoint(ST_Transform(f.geometry, %(srid)s), p.g)) AS cx,
       ST_Y(ST_ClosestPoint(ST_Transform(f.geometry, %(srid)s), p.g)) AS cy,
       ST_Distance(ST_Transform(f.geometry, %(srid)s), p.g) AS dist
FROM map_features f, p
WHERE f.area_id = %(area_id)s AND f.feature_type = 'road'
  AND f.geometry && ST_Expand(ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326), 0.0012)
  AND NOT (COALESCE(f.properties->'normalized'->>'highway', '') = ANY(%(exclude)s))
  AND ST_DWithin(ST_Transform(f.geometry, %(srid)s), p.g, %(radius)s)
ORDER BY dist ASC
LIMIT 1
"""

UPSERT_OBJECT = """
INSERT INTO map_objects (area_id, feature_id, asset_id, place_id, position, elevation_m, rotation, scale,
                         metadata, status, source, source_id)
VALUES (%(area_id)s, %(feature_id)s, %(asset_id)s, %(place_id)s,
        ST_Transform(ST_SetSRID(ST_MakePoint(%(x)s, %(y)s), %(srid)s), 4326)::geography,
        0, %(rotation)s, '{"x":1,"y":1,"z":1}'::jsonb, %(metadata)s, 'published', 'osm', %(source_id)s)
ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
  area_id = EXCLUDED.area_id,
  feature_id = EXCLUDED.feature_id,
  asset_id = EXCLUDED.asset_id,
  place_id = EXCLUDED.place_id,
  position = EXCLUDED.position,
  rotation = EXCLUDED.rotation,
  metadata = EXCLUDED.metadata
WHERE NOT COALESCE((map_objects.metadata->>'manualOverride')::boolean, false)
RETURNING (xmax = 0) AS inserted
"""


def _assets(conn) -> dict[str, dict]:
    rows = conn.execute("SELECT id::text, asset_key, bounding_box FROM map_assets WHERE is_active").fetchall()
    return {r["asset_key"]: r for r in rows}


def upsert_place_objects(conn, area: dict, live_places: dict[str, dict], stats: Counter) -> set[str]:
    """One published object per OSM place, its front (+Z) turned toward the nearest road.

    Objects are pushed out of the carriageway (road half-width + sidewalk + half model depth)
    and shifted along the road to avoid overlapping neighbours, giving a row of shophouses.
    """
    srid = srid_of(area["crs"])
    assets = _assets(conn)
    placed: list[tuple[float, float, float]] = []  # (x, y, radius)
    kept: set[str] = set()
    overrides = {
        r["source_id"]
        for r in conn.execute(
            "SELECT source_id FROM map_objects WHERE source='osm' AND (metadata->>'manualOverride')::boolean", ()
        ).fetchall()
    }

    for source_id in sorted(live_places):
        info = live_places[source_id]
        p: PlaceRecord = info["place"]
        obj_source_id = f"place:{source_id}"
        if obj_source_id in overrides:
            kept.add(obj_source_id)
            stats["objects_skipped_manual_override"] += 1
            continue
        asset_key = ASSET_BY_CATEGORY.get(info["category"], "shophouse-01")
        asset = assets.get(asset_key)
        if asset is None:
            stats["objects_skipped_missing_asset"] += 1
            continue
        inside = conn.execute(
            """SELECT id::text FROM map_features WHERE area_id = %s AND feature_type = 'building'
               AND ST_Covers(geometry, ST_SetSRID(ST_MakePoint(%s, %s), 4326)) LIMIT 1""",
            (area["id"], p.lng, p.lat),
        ).fetchone()
        if inside:
            # The extruded OSM building already represents this place.
            stats["objects_skipped_inside_building"] += 1
            continue

        size = (asset["bounding_box"] or {}).get("size", [4.5, 7, 12])
        width, depth = float(size[0]), float(size[2])
        radius = width / 2 + 0.15
        road = conn.execute(
            NEAREST_ROAD,
            {"lng": p.lng, "lat": p.lat, "srid": srid, "area_id": area["id"],
             "exclude": list(FRONTAGE_EXCLUDE), "radius": MAX_FRONTAGE_SEARCH_M},
        ).fetchone()
        proj = conn.execute(
            "SELECT ST_X(g) AS x, ST_Y(g) AS y FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s) g) s",
            (p.lng, p.lat, srid),
        ).fetchone()
        x, y = proj["x"], proj["y"]
        rotation = 0.0
        metadata = {"generatedBy": "map-importer", "category": info["category"], "assetKey": asset_key}
        if road and road["dist"] > 1e-6:
            # Unit vector from road to place (projected metres: x = east, y = north).
            ux, uy = (road["px"] - road["cx"]) / road["dist"], (road["py"] - road["cy"]) / road["dist"]
            target = road["width_m"] / 2 + road["sidewalk_m"] + depth / 2 + FRONT_CLEARANCE_M
            dist = max(road["dist"], target)
            x, y = road["cx"] + ux * dist, road["cy"] + uy * dist
            # World facing vector (X = east, Z = -north) points from object to road: (-ux, +uy).
            rotation = math.atan2(-ux, uy) % (2 * math.pi)
            tx, ty = -uy, ux  # tangent along the road
            metadata.update(nearestRoad=road["source_id"], frontageDistanceM=round(dist, 2))
            # Greedy de-overlap: slide along the frontage until clear of neighbours.
            for step in [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]:
                cx, cy = x + tx * step * (width + 0.3), y + ty * step * (width + 0.3)
                if all(math.hypot(cx - ox, cy - oy) >= radius + orad for ox, oy, orad in placed):
                    x, y = cx, cy
                    break
        else:
            stats["objects_without_frontage"] += 1
        placed.append((x, y, radius))

        row = conn.execute(
            UPSERT_OBJECT,
            {"area_id": area["id"], "feature_id": None, "asset_id": asset["id"], "place_id": info["id"],
             "x": x, "y": y, "srid": srid, "rotation": rotation,
             "metadata": json.dumps(metadata), "source_id": obj_source_id},
        ).fetchone()
        kept.add(obj_source_id)
        if row is None:
            stats["objects_skipped_manual_override"] += 1
        else:
            stats["objects_inserted" if row["inserted"] else "objects_updated"] += 1
    return kept


def soft_delete_stale_objects(conn, area_id: str, bounds: dict, kept: set[str]) -> int:
    # Objects are nudged up to ~20 m from their place, so test the place location instead.
    rows = conn.execute(
        """UPDATE map_objects o SET deleted_at = now()
           FROM places p
           WHERE o.place_id = p.id AND o.area_id = %s AND o.source = 'osm' AND o.source_id LIKE 'place:%%'
             AND o.deleted_at IS NULL
             AND ST_Covers(ST_MakeEnvelope(%s, %s, %s, %s, 4326), p.location::geometry)
             AND NOT (o.source_id = ANY(%s))
             AND NOT COALESCE((o.metadata->>'manualOverride')::boolean, false)
           RETURNING o.id""",
        (area_id, bounds["minLng"], bounds["minLat"], bounds["maxLng"], bounds["maxLat"], list(kept)),
    ).fetchall()
    return len(rows)
