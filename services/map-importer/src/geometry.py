"""Assemble OSM elements into GeoJSON geometries (EPSG:4326) and validate them.

Final topological repair (self-intersections etc.) is done in PostGIS with
ST_MakeValid; this module only rejects structurally broken input.
"""
from __future__ import annotations

Coord = tuple[float, float]  # (lng, lat)
Ring = list[Coord]


class ElementIndex:
    """Lookup of nodes and ways by id, supporting OSM API and Overpass `out geom` payloads."""

    def __init__(self, elements: list[dict]):
        self.nodes: dict[int, dict] = {}
        self.ways: dict[int, dict] = {}
        self.relations: dict[int, dict] = {}
        for el in elements:
            t = el.get("type")
            if t == "node":
                self.nodes[el["id"]] = el
            elif t == "way":
                self.ways[el["id"]] = el
            elif t == "relation":
                self.relations[el["id"]] = el

    def way_coords(self, way: dict) -> list[Coord] | None:
        if way.get("geometry"):
            coords = [(p["lon"], p["lat"]) for p in way["geometry"] if p]
        else:
            coords = []
            for ref in way.get("nodes", []):
                node = self.nodes.get(ref)
                if node is None:
                    return None  # incomplete way (node outside the downloaded bbox)
                coords.append((node["lon"], node["lat"]))
        return coords or None

    def member_coords(self, member: dict) -> list[Coord] | None:
        if member.get("geometry"):
            return [(p["lon"], p["lat"]) for p in member["geometry"] if p]
        way = self.ways.get(member.get("ref"))
        return self.way_coords(way) if way else None


def valid_coord(c: Coord) -> bool:
    lng, lat = c
    return -180 <= lng <= 180 and -90 <= lat <= 90


def dedupe(coords: list[Coord]) -> list[Coord]:
    out: list[Coord] = []
    for c in coords:
        if not out or (abs(c[0] - out[-1][0]) > 1e-10 or abs(c[1] - out[-1][1]) > 1e-10):
            out.append(c)
    return out


def is_closed(coords: list[Coord]) -> bool:
    return len(coords) >= 4 and coords[0] == coords[-1]


def ring_area(ring: Ring) -> float:
    """Planar shoelace area in degrees² (sign = orientation, CCW positive)."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        s += x1 * y2 - x2 * y1
    return s / 2


def valid_ring(ring: Ring) -> bool:
    if not is_closed(ring) or not all(valid_coord(c) for c in ring):
        return False
    distinct = {c for c in ring}
    return len(distinct) >= 3 and abs(ring_area(ring)) > 1e-14


def oriented(ring: Ring, ccw: bool) -> Ring:
    """GeoJSON (RFC 7946): exterior rings CCW, holes CW."""
    return ring if (ring_area(ring) > 0) == ccw else list(reversed(ring))


def stitch_rings(segments: list[list[Coord]]) -> tuple[list[Ring], int]:
    """Join open way segments end-to-end into closed rings. Returns (rings, unclosed_count)."""
    pending = [list(s) for s in segments if len(s) >= 2]
    rings: list[Ring] = []
    unclosed = 0
    while pending:
        current = pending.pop(0)
        changed = True
        while not is_closed(current) and changed:
            changed = False
            for i, seg in enumerate(pending):
                if seg[0] == current[-1]:
                    current += seg[1:]
                elif seg[-1] == current[-1]:
                    current += list(reversed(seg))[1:]
                elif seg[-1] == current[0]:
                    current = seg[:-1] + current
                elif seg[0] == current[0]:
                    current = list(reversed(seg))[:-1] + current
                else:
                    continue
                pending.pop(i)
                changed = True
                break
        if is_closed(current):
            rings.append(current)
        else:
            unclosed += 1
    return rings, unclosed


def point_in_ring(pt: Coord, ring: Ring) -> bool:
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-18) + x1:
            inside = not inside
    return inside


def way_geometry(index: ElementIndex, way: dict, as_area: bool) -> dict | None:
    coords = index.way_coords(way)
    if not coords:
        return None
    coords = dedupe(coords)
    if not all(valid_coord(c) for c in coords):
        return None
    if as_area:
        if not valid_ring(coords):
            return None
        return {"type": "Polygon", "coordinates": [oriented(coords, True)]}
    if len(coords) < 2:
        return None
    return {"type": "LineString", "coordinates": coords}


def relation_geometry(index: ElementIndex, rel: dict) -> tuple[dict | None, str | None]:
    """Build a (Multi)Polygon from a multipolygon relation. Returns (geometry, error)."""
    outers: list[list[Coord]] = []
    inners: list[list[Coord]] = []
    for m in rel.get("members", []):
        if m.get("type") != "way":
            continue
        coords = index.member_coords(m)
        if coords is None:
            return None, "incomplete-member"
        (inners if m.get("role") == "inner" else outers).append(dedupe(coords))
    outer_rings, open_outer = stitch_rings(outers)
    inner_rings, _ = stitch_rings(inners)
    outer_rings = [r for r in outer_rings if valid_ring(r)]
    inner_rings = [r for r in inner_rings if valid_ring(r)]
    if not outer_rings:
        return None, "unclosed-outer" if open_outer else "no-outer"
    polygons: list[list[Ring]] = [[oriented(r, True)] for r in outer_rings]
    for inner in inner_rings:
        for poly in polygons:
            if point_in_ring(inner[0], poly[0]):
                poly.append(oriented(inner, False))
                break
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}, None
    return {"type": "MultiPolygon", "coordinates": polygons}, None


def polygon_centroid(geom: dict) -> Coord | None:
    ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
    a = ring_area(ring)
    if abs(a) < 1e-18:
        xs, ys = zip(*ring)
        return sum(xs) / len(xs), sum(ys) / len(ys)
    cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return cx / (6 * a), cy / (6 * a)
