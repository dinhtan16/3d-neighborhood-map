"""Integration test: file-source import against a real PostGIS database.

Uses a throwaway area (slug 'pytest-import') so it never touches real data.
Skipped automatically when DATABASE_URL is unreachable or the schema is missing.
"""
import json
from pathlib import Path

import pytest

import db
from config import database_url
from main import run_import

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "chon-thanh-center.osm.json"
SLUG = "pytest-import"
BOUNDS = {"minLng": 106.599, "minLat": 11.416, "maxLng": 106.613, "maxLat": 11.428}


@pytest.fixture()
def conn():
    try:
        c = db.connect(database_url())
        c.execute("SELECT 1 FROM map_areas LIMIT 1")
        c.rollback()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"database unavailable: {exc}")
    # Isolate: temporarily rename source ids by running inside a transaction we roll back.
    yield c
    c.rollback()
    c.close()


def _setup_area(conn) -> dict:
    conn.execute(
        """INSERT INTO map_areas (name, slug, boundary, crs, origin_lat, origin_lng)
           VALUES ('pytest', %s, ST_Multi(ST_MakeEnvelope(%s, %s, %s, %s, 4326)), 'EPSG:32648', 11.422, 106.606)
           ON CONFLICT (slug) DO NOTHING""",
        (SLUG, BOUNDS["minLng"], BOUNDS["minLat"], BOUNDS["maxLng"], BOUNDS["maxLat"]),
    )
    for slug in ("food-beverage", "grocery", "retail", "services", "market-stalls", "other"):
        conn.execute(
            "INSERT INTO place_categories (name, slug) SELECT %s, %s WHERE NOT EXISTS (SELECT 1 FROM place_categories WHERE slug=%s)",
            (slug, slug, slug),
        )
    for key in ("cafe-01", "shophouse-01", "shophouse-02", "fruit-stall-01"):
        conn.execute(
            """INSERT INTO map_assets (asset_key, name, category, model_url, bounding_box)
               VALUES (%s, %s, 'building', %s, %s) ON CONFLICT (asset_key) DO NOTHING""",
            (key, key, f"models/{key}.glb", json.dumps({"size": [4.7, 8, 13.5]})),
        )
    return db.get_area(conn, slug=SLUG)


def _counts(conn, area_id):
    return conn.execute(
        """SELECT (SELECT count(*) FROM map_features WHERE area_id=%(a)s) f,
                  (SELECT count(*) FROM places WHERE area_id=%(a)s) p,
                  (SELECT count(*) FROM map_objects WHERE area_id=%(a)s AND deleted_at IS NULL) o""",
        {"a": area_id},
    ).fetchone()


def test_file_import_is_idempotent(conn):
    # Everything runs in one outer transaction that the fixture rolls back, so the
    # real 'chon-thanh' rows sharing the same OSM source ids are restored afterwards.
    conn.autocommit = False
    area = _setup_area(conn)
    first = run_import(conn, area, BOUNDS, "file", str(FIXTURE), dry_run=False)
    c1 = _counts(conn, area["id"])
    second = run_import(conn, area, BOUNDS, "file", str(FIXTURE), dry_run=False)
    c2 = _counts(conn, area["id"])

    assert c1 == c2
    assert c1["f"] >= 200 and c1["p"] >= 15 and c1["o"] >= 15
    assert second.get("features_inserted", 0) == 0
    assert second.get("places_inserted", 0) == 0
    assert second.get("objects_inserted", 0) == 0
    assert second["features_updated"] == first["features_road"]

    # Objects face their road: rotation stored in [0, 2π) and every object is published.
    rows = conn.execute(
        "SELECT rotation, status FROM map_objects WHERE area_id=%s AND deleted_at IS NULL", (area["id"],)
    ).fetchall()
    assert all(0 <= r["rotation"] < 6.2832 and r["status"] == "published" for r in rows)


def test_manual_override_is_respected(conn):
    conn.autocommit = False
    area = _setup_area(conn)
    run_import(conn, area, BOUNDS, "file", str(FIXTURE), dry_run=False)
    obj = conn.execute(
        "SELECT id, rotation FROM map_objects WHERE area_id=%s AND source='osm' LIMIT 1", (area["id"],)
    ).fetchone()
    conn.execute(
        "UPDATE map_objects SET rotation = 1.234, metadata = metadata || '{\"manualOverride\": true}' WHERE id=%s",
        (obj["id"],),
    )
    stats = run_import(conn, area, BOUNDS, "file", str(FIXTURE), dry_run=False)
    after = conn.execute("SELECT rotation FROM map_objects WHERE id=%s", (obj["id"],)).fetchone()
    assert after["rotation"] == pytest.approx(1.234)
    assert stats["objects_skipped_manual_override"] == 1
