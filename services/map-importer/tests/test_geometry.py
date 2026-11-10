import geometry as g
from extract import extract

SQUARE = [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]


def nodes(*coords, start=1):
    return [{"type": "node", "id": start + i, "lon": x, "lat": y} for i, (x, y) in enumerate(coords)]


def test_ring_validation():
    assert g.valid_ring(SQUARE)
    assert not g.valid_ring([(0, 0), (1, 0), (0, 0)])
    assert not g.valid_ring([(0, 0), (1, 0), (2, 0), (0, 0)])  # zero area
    assert not g.valid_ring([(0, 0), (1, 0), (1, 1), (0, 1)])  # not closed
    assert not g.valid_ring([(0, 0), (200, 0), (1, 1), (0, 0)])  # out of range


def test_orientation_rfc7946():
    cw = list(reversed(SQUARE))
    assert g.ring_area(g.oriented(cw, True)) > 0
    assert g.ring_area(g.oriented(SQUARE, False)) < 0


def test_stitch_open_segments():
    segs = [[(0, 0), (1, 0)], [(1, 1), (1, 0)], [(1, 1), (0, 1), (0, 0)]]
    rings, unclosed = g.stitch_rings(segs)
    assert unclosed == 0 and len(rings) == 1
    assert g.valid_ring(rings[0])


def test_way_polygon_and_line():
    els = nodes((0, 0), (0.001, 0), (0.001, 0.001), (0, 0.001))
    idx = g.ElementIndex(els)
    poly = g.way_geometry(idx, {"nodes": [1, 2, 3, 4, 1]}, as_area=True)
    assert poly["type"] == "Polygon" and g.ring_area(poly["coordinates"][0]) > 0
    line = g.way_geometry(idx, {"nodes": [1, 2, 2, 3]}, as_area=False)
    assert line == {"type": "LineString", "coordinates": [(0, 0), (0.001, 0), (0.001, 0.001)]}
    assert g.way_geometry(idx, {"nodes": [1, 99]}, as_area=False) is None  # incomplete


def test_overpass_inline_geometry():
    idx = g.ElementIndex([])
    way = {"geometry": [{"lon": 0, "lat": 0}, {"lon": 1, "lat": 0}]}
    assert g.way_geometry(idx, way, as_area=False)["coordinates"] == [(0, 0), (1, 0)]


def test_multipolygon_with_hole_and_split_outer():
    els = nodes((0, 0), (4, 0), (4, 4), (0, 4), (1, 1), (2, 1), (2, 2), (1, 2))
    els += [
        {"type": "way", "id": 10, "nodes": [1, 2, 3]},
        {"type": "way", "id": 11, "nodes": [3, 4, 1]},
        {"type": "way", "id": 12, "nodes": [5, 6, 7, 8, 5]},
        {
            "type": "relation", "id": 100,
            "tags": {"type": "multipolygon", "building": "yes"},
            "members": [
                {"type": "way", "ref": 10, "role": "outer"},
                {"type": "way", "ref": 11, "role": "outer"},
                {"type": "way", "ref": 12, "role": "inner"},
            ],
        },
    ]
    geom, err = g.relation_geometry(g.ElementIndex(els), els[-1])
    assert err is None and geom["type"] == "Polygon" and len(geom["coordinates"]) == 2
    assert g.ring_area(geom["coordinates"][1]) < 0  # hole is clockwise
    ex = extract(els)
    assert [f.source_id for f in ex.features] == ["relation/100"]
    assert ex.features[0].height_m == 6.0


def test_extract_places_and_trees():
    els = nodes((106.6, 11.42), (106.601, 11.42), start=1)
    els[0]["tags"] = {"shop": "convenience", "name": "TH-Hà Thu-Tổ 4- Ấp 1"}
    els[1]["tags"] = {"natural": "tree"}
    els.append({"type": "node", "id": 3, "lon": 106.6, "lat": 11.4, "tags": {"shop": "clothes"}})
    ex = extract(els)
    assert [p.name for p in ex.places] == ["Tạp hóa Hà Thu"]
    assert ex.places[0].category_slug == "grocery"
    assert ex.places[0].slug.startswith("tap-hoa-ha-thu-")
    assert ex.stats["places_skipped_unnamed"] == 1
    assert [f.feature_type for f in ex.features] == ["tree"]


def test_fixture_extraction():
    from pathlib import Path
    from fetch import load_file
    fixture = Path(__file__).resolve().parents[1] / "fixtures" / "chon-thanh-center.osm.json"
    ex = extract(load_file(fixture))
    assert ex.stats["features_extracted"] >= 200
    assert len(ex.places) >= 15
    assert all(f.geometry["type"] == "LineString" for f in ex.features if f.feature_type == "road")
