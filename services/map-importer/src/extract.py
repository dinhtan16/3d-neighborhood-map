"""Turn raw OSM elements into normalized feature and place records (no DB access)."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import geometry as geo
import normalize as norm
from config import WATERWAY_LINE_KINDS


@dataclass
class FeatureRecord:
    source_id: str
    feature_type: str
    geometry: dict
    properties: dict
    height_m: float | None = None
    levels: int | None = None
    style_key: str | None = None


@dataclass
class PlaceRecord:
    source_id: str
    name: str
    slug: str
    category_slug: str
    lng: float
    lat: float
    address: str | None
    description: str | None
    phone: str | None
    opening_hours: dict | None
    tags: dict


@dataclass
class Extraction:
    features: list[FeatureRecord] = field(default_factory=list)
    places: list[PlaceRecord] = field(default_factory=list)
    stats: Counter = field(default_factory=Counter)


def _feature(source_id: str, ftype: str, kind: str | None, tags: dict, geom: dict) -> FeatureRecord:
    rec = FeatureRecord(
        source_id=source_id,
        feature_type=ftype,
        geometry=geom,
        properties={"tags": tags, "normalized": norm.normalized_properties(tags, ftype, kind)},
    )
    if ftype == "building":
        h, lv, estimated = norm.resolve_building_height(tags.get("height"), tags.get("building:levels"))
        rec.height_m, rec.levels = h, lv
        rec.properties["normalized"]["heightEstimated"] = estimated
        rec.style_key = norm.default_style_key(source_id, tags.get("building"))
    return rec


def _place(source_id: str, tags: dict, lng: float, lat: float) -> PlaceRecord:
    parsed = norm.parse_vn_name(tags["name"])
    address = norm.compose_address(tags) or parsed["address"]
    category = norm.category_for(tags, parsed["category"])
    description = tags.get("description") or parsed["kind"]
    phone = (tags.get("phone") or tags.get("contact:phone") or "")[:30] or None
    hours = {"osm": tags["opening_hours"]} if tags.get("opening_hours") else None
    slug = f"{norm.slugify(parsed['name'])}-{norm.fnv1a(source_id):08x}"[:255]
    return PlaceRecord(
        source_id=source_id,
        name=parsed["name"][:255],
        slug=slug,
        category_slug=category,
        lng=lng,
        lat=lat,
        address=address,
        description=description,
        phone=phone,
        opening_hours=hours,
        tags=tags,
    )


def extract(elements: list[dict]) -> Extraction:
    index = geo.ElementIndex(elements)
    out = Extraction()
    s = out.stats
    s["elements"] = len(elements)

    for node in index.nodes.values():
        tags = node.get("tags") or {}
        if not tags:
            continue
        cls = norm.classify(tags, "node", False)
        if cls:
            ftype, kind = cls
            out.features.append(_feature(f"node/{node['id']}", ftype, kind, tags,
                                         {"type": "Point", "coordinates": [node["lon"], node["lat"]]}))
        if norm.is_poi(tags):
            if not tags.get("name"):
                s["places_skipped_unnamed"] += 1
                continue
            out.places.append(_place(f"node/{node['id']}", tags, node["lon"], node["lat"]))

    for way in index.ways.values():
        tags = way.get("tags") or {}
        if not tags:
            continue
        coords = index.way_coords(way)
        closed = bool(coords) and geo.is_closed(geo.dedupe(coords))
        cls = norm.classify(tags, "way", closed)
        geom = None
        if cls:
            ftype, kind = cls
            as_area = ftype not in ("road",) and not (ftype == "water" and tags.get("waterway") in WATERWAY_LINE_KINDS)
            geom = geo.way_geometry(index, way, as_area=as_area)
            if geom is None:
                s["skipped_invalid_geometry"] += 1
            else:
                out.features.append(_feature(f"way/{way['id']}", ftype, kind, tags, geom))
        if norm.is_poi(tags) and tags.get("name"):
            area_geom = geom if geom and geom["type"] == "Polygon" else (
                geo.way_geometry(index, way, as_area=True) if closed else None)
            centre = geo.polygon_centroid(area_geom) if area_geom else None
            if centre:
                out.places.append(_place(f"way/{way['id']}", tags, centre[0], centre[1]))

    for rel in index.relations.values():
        tags = rel.get("tags") or {}
        if tags.get("type") not in ("multipolygon", "building"):
            continue
        cls = norm.classify(tags, "relation", True)
        if not cls:
            continue
        geom, err = geo.relation_geometry(index, rel)
        if geom is None:
            s[f"skipped_relation_{err}"] += 1
            continue
        ftype, kind = cls
        out.features.append(_feature(f"relation/{rel['id']}", ftype, kind, tags, geom))

    s["features_extracted"] = len(out.features)
    s["places_extracted"] = len(out.places)
    return out
