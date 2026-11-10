"""Microsoft Global ML Building Footprints -> building feature records.

Input: the per-quadkey `*.csv.gz` files from
https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv
(one GeoJSON Feature per line, Polygon geometry, no height in Vietnam).

Footprints carry no stable id, so the identity is derived from the geometry:
    source_id = "ms:" + sha1(WKT rounded to 6 dp)[:16]
Levels are estimated deterministically from footprint size/shape (FNV-1a of
source_id) so re-imports produce identical heights.
License: ODbL – "Building footprints © Microsoft".
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from typing import Iterator

from extract import FeatureRecord
from normalize import fnv1a

FLOOR_HEIGHT_M = 3.5
Bounds = tuple[float, float, float, float]


def iter_footprints(path: str | Path) -> Iterator[dict]:
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def ring_of(feature: dict) -> list[list[float]] | None:
    g = feature.get("geometry") or {}
    if g.get("type") != "Polygon" or not g.get("coordinates"):
        return None
    return g["coordinates"][0]


def in_bounds(ring: list[list[float]], b: Bounds) -> bool:
    """Footprint belongs to the bbox when its vertex centroid is inside (half-open)."""
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    return b[0] <= cx < b[2] and b[1] <= cy < b[3]


def round_ring(ring: list[list[float]]) -> list[list[float]]:
    out = [[round(x, 6), round(y, 6)] for x, y in ring]
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def source_id_for(ring: list[list[float]]) -> str:
    wkt = "POLYGON((" + ",".join(f"{x:.6f} {y:.6f}" for x, y in ring) + "))"
    return "ms:" + hashlib.sha1(wkt.encode()).hexdigest()[:16]


def local_metres(ring: list[list[float]]) -> list[tuple[float, float]]:
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    kx, ky = 111_320 * math.cos(lat0), 110_574
    x0, y0 = ring[0]
    return [((x - x0) * kx, (y - y0) * ky) for x, y in ring]


def area_m2(pts: list[tuple[float, float]]) -> float:
    s = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def aspect_ratio(pts: list[tuple[float, float]]) -> float:
    """Long/short side of the minimum-area rectangle aligned to one of the polygon edges."""
    best: tuple[float, float] | None = None
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        L = math.hypot(x2 - x1, y2 - y1)
        if L < 1e-6:
            continue
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        us = [x * ux + y * uy for x, y in pts]
        vs = [-x * uy + y * ux for x, y in pts]
        w, h = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * h < best[0] * best[1]:
            best = (w, h)
    if not best or min(best) < 1e-6:
        return 1.0
    return max(best) / min(best)


def _pick(r: int, table: list[tuple[int, int]]) -> int:
    """table = [(levels, cumulative_percent), ...]"""
    for levels, cum in table:
        if r < cum:
            return levels
    return table[-1][0]


def estimate_levels(source_id: str, area: float, aspect: float) -> tuple[int, str | None]:
    """Deterministic floor estimate. Returns (levels, kind)."""
    r = fnv1a(source_id) % 100
    if area < 40:
        return 1, None
    if area <= 250:
        if aspect >= 1.8:  # Vietnamese tube house (nhà ống)
            return _pick(r, [(1, 5), (2, 50), (3, 85), (4, 100)]), "house"
        return _pick(r, [(1, 35), (2, 80), (3, 100)]), "house"
    if area <= 800:
        return _pick(r, [(1, 40), (2, 80), (3, 100)]), None
    return 1, "industrial"


def to_record(ring: list[list[float]]) -> FeatureRecord | None:
    if len(ring) < 4:
        return None
    rr = round_ring(ring)
    if len({tuple(p) for p in rr}) < 3:
        return None
    sid = source_id_for(rr)
    pts = local_metres(rr[:-1])
    area = area_m2(pts)
    if area < 4:  # noise
        return None
    aspect = aspect_ratio(pts)
    levels, kind = estimate_levels(sid, area, aspect)
    jitter = ((fnv1a(sid + "#h") % 7) - 3) / 10  # -0.3 .. +0.3 m
    height = round(levels * FLOOR_HEIGHT_M + jitter, 2)
    normalized = {"kind": kind, "estimated": True, "heightEstimated": True,
                  "areaM2": round(area, 1), "aspect": round(aspect, 2)}
    return FeatureRecord(
        source_id=sid,
        feature_type="building",
        geometry={"type": "Polygon", "coordinates": [rr]},
        properties={"tags": {"source": "microsoft-ml"}, "normalized": {k: v for k, v in normalized.items() if v is not None}},
        height_m=height,
        levels=levels,
        style_key=None,
    )


def load_records(path: str | Path, bounds: Bounds, stats: Counter, fixture_out: str | Path | None = None) -> list[FeatureRecord]:
    records: list[FeatureRecord] = []
    out = gzip.open(fixture_out, "wt", encoding="utf-8") if fixture_out else None
    try:
        for feat in iter_footprints(path):
            stats["ms_footprints_read"] += 1
            ring = ring_of(feat)
            if not ring or len(ring) < 4:
                continue
            ring = round_ring(ring)  # bounds test on the rounded ring => file and fixture agree
            if not in_bounds(ring, bounds):
                continue
            stats["ms_footprints_in_bounds"] += 1
            if out:
                out.write(json.dumps({"type": "Feature", "properties": {},
                                      "geometry": {"type": "Polygon", "coordinates": [round_ring(ring)]}},
                                     separators=(",", ":")) + "\n")
            rec = to_record(ring)
            if rec is None:
                stats["ms_footprints_invalid"] += 1
                continue
            records.append(rec)
    finally:
        if out:
            out.close()
    return records
