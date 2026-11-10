"""v2 region sources: tile merging, gzip fixtures, landuse/waterway classes, Microsoft footprints."""
import gzip
import json

import fetch
import msbuildings as ms
import normalize as norm


def test_merge_elements_dedupes_and_prefers_newer_version():
    a = [{"type": "node", "id": 1, "version": 1, "lat": 1, "lon": 1}, {"type": "way", "id": 5, "nodes": [1, 2]}]
    b = [{"type": "node", "id": 1, "version": 2, "lat": 1.5, "lon": 1}, {"type": "node", "id": 2, "lat": 2, "lon": 2}]
    merged = fetch.merge_elements([a, b])
    by = {(e["type"], e["id"]): e for e in merged}
    assert len(merged) == 3
    assert by[("node", 1)]["lat"] == 1.5


def test_load_tiles_and_gz(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps({"elements": [{"type": "node", "id": 1, "lat": 0, "lon": 0}]}))
    with gzip.open(tmp_path / "b.json.gz", "wt") as fh:
        json.dump({"elements": [{"type": "node", "id": 1, "lat": 0, "lon": 0}, {"type": "node", "id": 2, "lat": 0, "lon": 0}]}, fh)
    assert len(fetch.load_tiles(tmp_path)) == 2
    assert len(fetch.load_file(tmp_path / "b.json.gz")) == 2


def test_classify_landuse_natural_and_waterways():
    assert norm.classify({"landuse": "residential"}, "way", True) == ("landuse", "residential")
    assert norm.classify({"landuse": "farmland"}, "relation", True) == ("landuse", "farmland")
    assert norm.classify({"natural": "wood"}, "way", True) == ("landuse", "wood")
    assert norm.classify({"landuse": "residential"}, "way", False) is None  # open way is not an area
    assert norm.classify({"waterway": "stream"}, "way", False) == ("water", "stream")
    assert norm.classify({"landuse": "grass"}, "way", True) == ("park", "grass")  # rules.json still wins


SQUARE = [[106.6, 11.6], [106.60009, 11.6], [106.60009, 11.60009], [106.6, 11.60009], [106.6, 11.6]]  # ~10 x 10 m
TUBE = [[106.6, 11.6], [106.60004, 11.6], [106.60004, 11.60018], [106.6, 11.60018], [106.6, 11.6]]  # ~4.4 x 20 m


def test_source_id_is_stable_and_rounding_invariant():
    a = ms.to_record(SQUARE)
    b = ms.to_record([[x + 1e-8, y - 1e-8] for x, y in SQUARE])
    assert a.source_id == b.source_id
    assert a.source_id.startswith("ms:") and len(a.source_id) == 19


def test_area_and_aspect():
    pts = ms.local_metres(ms.round_ring(TUBE)[:-1])
    assert 80 < ms.area_m2(pts) < 95
    assert 4 < ms.aspect_ratio(pts) < 5


def test_level_estimates_follow_size_rules():
    assert ms.estimate_levels("ms:x", 30, 1.0) == (1, None)
    assert ms.estimate_levels("ms:x", 1200, 1.2) == (1, "industrial")
    tube = [ms.estimate_levels(f"ms:{i}", 90, 3)[0] for i in range(2000)]
    share = {k: tube.count(k) / len(tube) for k in (1, 2, 3, 4)}
    assert set(tube) <= {1, 2, 3, 4}
    assert 0.38 < share[2] < 0.52 and 0.28 < share[3] < 0.42 and 0.1 < share[4] < 0.2
    mid = {ms.estimate_levels(f"ms:{i}", 500, 1.3)[0] for i in range(500)}
    assert mid == {1, 2, 3}


def test_record_height_and_properties():
    r = ms.to_record(TUBE)
    assert r.feature_type == "building" and r.style_key is None
    assert abs(r.height_m - r.levels * 3.5) <= 0.3 + 1e-9
    assert r.properties["normalized"]["estimated"] is True
    assert r.properties["tags"] == {"source": "microsoft-ml"}


def test_in_bounds_is_half_open():
    ring = ms.round_ring(SQUARE)
    cx = sum(p[0] for p in ring) / len(ring)
    assert ms.in_bounds(ring, (cx - 1, 0, cx + 1, 90))
    assert not ms.in_bounds(ring, (cx - 1, 0, cx, 90))
