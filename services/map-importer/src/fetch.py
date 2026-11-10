"""OSM data acquisition: OSM API map call, Overpass API, or a local OSM JSON file.

Every source returns a list of OSM JSON elements (nodes, ways, relations).
Overpass `out geom` ways carry inline `geometry`; OSM API ways carry node refs.
The geometry module handles both shapes.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from config import OSM_API_URL, OVERPASS_URL, USER_AGENT

Bounds = tuple[float, float, float, float]  # minLng, minLat, maxLng, maxLat


def _request(req: urllib.request.Request, timeout: int, retries: int = 3) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:  # network / 5xx
            last = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code < 500 and exc.code != 429:
                break
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"OSM request failed: {last}")


def fetch_osm_api(bounds: Bounds, timeout: int = 120) -> list[dict]:
    """OSM editing API `map` call. Limited to 0.25 deg² / 50k nodes – fine for one neighborhood."""
    bbox = ",".join(f"{v:.7f}" for v in bounds)
    url = f"{OSM_API_URL}?bbox={bbox}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    return json.loads(_request(req, timeout))["elements"]


def overpass_query(bounds: Bounds) -> str:
    min_lng, min_lat, max_lng, max_lat = bounds
    bb = f"({min_lat},{min_lng},{max_lat},{max_lng})"
    return f"""[out:json][timeout:90];
(
  way["building"]{bb}; relation["building"]{bb};
  way["highway"]{bb};
  way["leisure"]{bb}; relation["leisure"]{bb};
  way["landuse"]{bb}; relation["landuse"]{bb};
  way["natural"="water"]{bb}; relation["natural"="water"]{bb};
  nwr["amenity"]{bb}; nwr["shop"]{bb}; nwr["tourism"]{bb};
  way["place"="square"]{bb};
  node["natural"="tree"]{bb};
);
out geom tags;"""


def fetch_overpass(bounds: Bounds, timeout: int = 180) -> list[dict]:
    data = urllib.parse.urlencode({"data": overpass_query(bounds)}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": USER_AGENT})
    return json.loads(_request(req, timeout))["elements"]


def load_file(path: str | Path) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    if isinstance(payload, dict) and "elements" in payload:
        return payload["elements"]
    raise ValueError(f"{path} is not an OSM JSON document (missing 'elements')")


def fetch(source: str, bounds: Bounds, file: str | None = None) -> list[dict]:
    if source == "osm-api":
        return fetch_osm_api(bounds)
    if source == "overpass":
        return fetch_overpass(bounds)
    if source == "file":
        if not file:
            raise SystemExit("--file is required with --source file")
        return load_file(file)
    raise SystemExit(f"Unknown source {source}")
