#!/usr/bin/env python3
"""OSM import pipeline for the 3D neighborhood map.

    OSM data -> extraction -> normalization -> geometry validation -> PostGIS upsert
             -> place extraction -> generated map objects

Runs as a standalone process (spawned by the API for POST /admin/map/import/osm,
or by hand). Re-running with the same data is idempotent.

Examples:
  python3 services/map-importer/src/main.py --area-slug chon-thanh --source file \
      --file services/map-importer/fixtures/chon-thanh-center.osm.json
  python3 services/map-importer/src/main.py --job-id <uuid>             # used by the API
  python3 services/map-importer/src/main.py --area-slug chon-thanh --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db  # noqa: E402
from config import database_url  # noqa: E402
from extract import extract  # noqa: E402
from fetch import fetch  # noqa: E402

MAX_BBOX_DEG2 = 0.25  # OSM API limit


class DryRun(Exception):
    pass


def parse_bounds(text: str) -> dict:
    parts = [float(v) for v in text.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bounds must be minLng,minLat,maxLng,maxLat")
    b = dict(zip(("minLng", "minLat", "maxLng", "maxLat"), parts))
    validate_bounds(b)
    return b


def validate_bounds(b: dict) -> None:
    if not (-180 <= b["minLng"] < b["maxLng"] <= 180 and -90 <= b["minLat"] < b["maxLat"] <= 90):
        raise SystemExit(f"Invalid bounds {b}")
    if (b["maxLng"] - b["minLng"]) * (b["maxLat"] - b["minLat"]) > MAX_BBOX_DEG2:
        raise SystemExit("Bounds too large for a neighborhood import")


def run_import(conn, area: dict, bounds: dict, source: str, file: str | None, dry_run: bool) -> dict:
    t0 = time.monotonic()
    stats: Counter = Counter()
    bbox = (bounds["minLng"], bounds["minLat"], bounds["maxLng"], bounds["maxLat"])
    elements = fetch(source, bbox, file)
    extraction = extract(elements)
    stats.update(extraction.stats)
    try:
        with conn.transaction():
            kept_features = db.upsert_features(conn, area["id"], extraction.features, stats)
            stats["features_stale_deleted"] = db.delete_stale_features(conn, area["id"], bounds, kept_features)
            live = db.upsert_places(conn, area["id"], extraction.places, stats)
            stats["places_deactivated"] = db.deactivate_stale_places(
                conn, area["id"], bounds, {p.source_id for p in extraction.places})
            kept_objects = db.upsert_place_objects(conn, area, live, stats)
            stats["objects_stale_deleted"] = db.soft_delete_stale_objects(conn, area["id"], bounds, kept_objects)
            if dry_run:
                raise DryRun()
    except DryRun:
        stats["dry_run"] = 1
    totals = conn.execute(
        """SELECT (SELECT count(*) FROM map_features WHERE area_id=%(a)s) AS features,
                  (SELECT count(*) FROM places WHERE area_id=%(a)s AND deleted_at IS NULL) AS places,
                  (SELECT count(*) FROM map_objects WHERE area_id=%(a)s AND deleted_at IS NULL) AS objects""",
        {"a": area["id"]},
    ).fetchone()
    result = {"source": source, "bounds": bounds, **dict(sorted(stats.items())),
              "totals": dict(totals), "durationMs": round((time.monotonic() - t0) * 1000)}
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = ap.add_mutually_exclusive_group(required=True)
    target.add_argument("--job-id", help="Existing import_jobs row (created by the API)")
    target.add_argument("--area-slug", help="Import into this map area, creating a job row")
    ap.add_argument("--bounds", type=parse_bounds, help="minLng,minLat,maxLng,maxLat (default: area bbox)")
    ap.add_argument("--source", choices=["osm-api", "overpass", "file"],
                    default=os.environ.get("OSM_IMPORT_SOURCE", "osm-api"),
                    help="Data source (default: $OSM_IMPORT_SOURCE or osm-api)")
    ap.add_argument("--file", default=os.environ.get("OSM_IMPORT_FILE"),
                    help="OSM JSON file for --source file (default: $OSM_IMPORT_FILE)")
    ap.add_argument("--dry-run", action="store_true", help="Run everything inside a rolled-back transaction")
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["--"]:  # `pnpm import:osm -- --area-slug ...` forwards a literal "--"
        argv = argv[1:]
    args = ap.parse_args(argv)

    conn = db.connect(database_url())
    job_id: str | None = None
    try:
        if args.job_id:
            job = db.get_job(conn, args.job_id)
            job_id = job["id"]
            area = db.get_area(conn, area_id=job["area_id"])
            bounds = job["bounds"] or None
        else:
            area = db.get_area(conn, slug=args.area_slug)
            bounds = args.bounds
        bounds = bounds or {"minLng": area["min_lng"], "minLat": area["min_lat"],
                            "maxLng": area["max_lng"], "maxLat": area["max_lat"]}
        validate_bounds(bounds)
        if job_id is None and not args.dry_run:
            job_id = db.create_job(conn, area["id"], bounds)
        if job_id:
            db.mark_job(conn, job_id, "running")
        stats = run_import(conn, area, bounds, args.source, args.file, args.dry_run)
        if job_id:
            stats["jobId"] = job_id
            db.mark_job(conn, job_id, "succeeded", stats=stats)
        print(json.dumps(stats, ensure_ascii=False, indent=2, default=str))
        return 0
    except BaseException as exc:  # noqa: BLE001 – record every failure on the job row
        conn.rollback()
        message = str(exc) or exc.__class__.__name__
        if job_id:
            db.mark_job(conn, job_id, "failed", error=message[:2000])
        if isinstance(exc, SystemExit):
            print(f"error: {message}", file=sys.stderr)
            return 2
        traceback.print_exc()
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
