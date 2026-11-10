"""Shared configuration: rules come from packages/map-config/rules.json (single source of truth)."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
RULES_PATH = REPO_ROOT / "packages" / "map-config" / "rules.json"

USER_AGENT = "nmap-3d-neighborhood-importer/1.0 (+https://www.openstreetmap.org/copyright)"
OSM_API_URL = "https://api.openstreetmap.org/api/0.6/map.json"
OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")


@lru_cache(maxsize=1)
def rules() -> dict:
    with open(RULES_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _load_dotenv() -> None:
    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def database_url() -> str:
    _load_dotenv()
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (see .env.example)")
    return url


# ---------------------------------------------------------------------------
# Region classification extras (v2). Kept here rather than in
# packages/map-config/rules.json because only the importer needs them; the
# frontend styles these by feature_type + kind.
# ---------------------------------------------------------------------------
#: landuse=* values imported as feature_type 'landuse' (kind = value)
LANDUSE_KINDS = frozenset({
    "residential", "commercial", "retail", "industrial", "farmland", "orchard",
    "forest", "grass", "meadow", "cemetery", "religious", "plantation",
})
#: natural=* area values imported as feature_type 'landuse'
NATURAL_AREA_KINDS = frozenset({"wood", "scrub"})
#: waterway=* line values imported as feature_type 'water' (LineString)
WATERWAY_LINE_KINDS = frozenset({"river", "stream", "canal"})
