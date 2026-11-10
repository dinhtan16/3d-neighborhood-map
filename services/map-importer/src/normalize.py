"""Tag normalization – mirrors packages/geo-core (building.ts) using rules.json."""
from __future__ import annotations

import re
import unicodedata

from config import rules

CIVIC_TYPES = {"school", "public", "civic", "government", "hospital", "university"}
COMMERCIAL_TYPES = {"commercial", "retail", "shop"}


# ---------------------------------------------------------------------------
# Hashing / styles (must match geo-core fnv1a + defaultStyleKey exactly)
# ---------------------------------------------------------------------------
def fnv1a(text: str) -> int:
    """FNV-1a 32-bit over UTF-16 code units (same as JS charCodeAt)."""
    h = 0x811C9DC5
    data = text.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def default_style_key(seed: str, building_type: str | None) -> str:
    if building_type in CIVIC_TYPES:
        return "civic-sand"
    if building_type in COMMERCIAL_TYPES:
        return "shophouse-terracotta"
    styles = [s for s in rules()["buildingStyles"] if s.startswith("residential") or s.startswith("shophouse")]
    return styles[fnv1a(seed) % len(styles)]


# ---------------------------------------------------------------------------
# Lengths / heights
# ---------------------------------------------------------------------------
_FEET = re.compile(r"^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)$")
_METERS = re.compile(r"^(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?$")


def parse_length_m(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    s = str(value).strip().lower().replace(",", ".")
    m = _FEET.match(s)
    if m:
        return float(m.group(1)) * 0.3048
    m = _METERS.match(s)
    if m and float(m.group(1)) > 0:
        return float(m.group(1))
    return None


def parse_levels(value) -> int | None:
    if value is None:
        return None
    try:
        n = round(float(str(value).replace(",", ".")))
    except ValueError:
        return None
    return n if 0 < n < 200 else None


def resolve_building_height(height=None, levels=None) -> tuple[float, int | None, bool]:
    """(height_m, levels, estimated). Actual height > levels * 3.5 m > 6 m default."""
    policy = rules()["buildingHeight"]
    lv = parse_levels(levels)
    actual = parse_length_m(height)

    def clamp(h: float) -> float:
        return min(policy["maxHeightM"], max(policy["minHeightM"], h))

    if actual is not None:
        return clamp(actual), lv, False
    if lv is not None:
        return clamp(lv * policy["floorHeightM"]), lv, True
    return float(policy["unknownDefaultM"]), None, True


def road_width_m(tags: dict) -> float:
    width = parse_length_m(tags.get("width"))
    if width:
        return width
    widths = rules()["roadWidthsM"]
    base = widths.get(tags.get("highway", ""), widths["default"])
    lanes = parse_levels(tags.get("lanes"))
    if lanes and tags.get("highway") not in ("footway", "path", "steps", "cycleway"):
        return max(base, lanes * 3.0)
    return float(base)


def sidewalk_width_m(highway: str | None) -> float:
    widths = rules()["sidewalkWidthM"]
    return float(widths.get(highway or "", widths["default"]))


def parse_layer(value) -> int | None:
    try:
        return int(str(value).strip()) if value is not None else None
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------
def classify(tags: dict, element_type: str, closed: bool) -> tuple[str, str | None] | None:
    """Return (feature_type, kind) or None if the element is not rendered as a feature."""
    r = rules()
    if not tags:
        return None
    if element_type == "node":
        if tags.get("natural") == "tree":
            return "tree", "tree"
        return None
    is_area = closed or element_type == "relation"
    building = tags.get("building")
    if building and building != "no" and is_area:
        return "building", building
    if is_area:
        if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in ("reservoir", "basin"):
            return "water", tags.get("water") or "water"
        for key, values in r["publicSpaceTags"].items():
            value = tags.get(key)
            if value in values:
                if key == "highway" and tags.get("area") != "yes":
                    continue
                if key == "leisure" and value in ("park", "garden"):
                    return "park", value
                if key == "landuse" and value in ("grass", "recreation_ground"):
                    return "park", value
                return "public_space", value
    highway = tags.get("highway")
    if highway in r["renderedHighways"] and element_type == "way" and tags.get("area") != "yes":
        return "road", highway
    return None


def normalized_properties(tags: dict, feature_type: str, kind: str | None) -> dict:
    props = {
        "name": tags.get("name"),
        "highway": tags.get("highway") if feature_type == "road" else None,
        "widthM": road_width_m(tags) if feature_type == "road" else None,
        "sidewalkM": sidewalk_width_m(tags.get("highway")) if feature_type == "road" else None,
        "surface": tags.get("surface"),
        "roofShape": tags.get("roof:shape"),
        "kind": kind,
        "layer": parse_layer(tags.get("layer")),
        "bridge": tags.get("bridge") == "yes" or None,
        "tunnel": tags.get("tunnel") in ("yes", "building_passage") or None,
        "oneway": tags.get("oneway") == "yes" or None,
    }
    return {k: v for k, v in props.items() if v is not None}


# ---------------------------------------------------------------------------
# Places / categories
# ---------------------------------------------------------------------------
# Prefix codes used by local mappers in Chơn Thành, e.g. "TH-Hà Thu-Tổ 4- Ấp 1 ...".
VN_PREFIXES: dict[str, tuple[str | None, str | None]] = {
    # code: (Vietnamese kind label, category slug override)
    "TH": ("Tạp hóa", "grocery"),
    "QA": ("Quán ăn", "food-beverage"),
    "NN": ("Nhà nghỉ", "services"),
    "CF": ("Cà phê", "food-beverage"),
    "KA": ("Karaoke", "services"),
    "NET": ("Tiệm net", "services"),
    "SB": (None, None),
    "CT": ("Cơ quan / trường", None),
    "THỌC": ("Trường Tiểu học", "other"),
}
_PREFIX_RE = re.compile(r"^\s*([A-Za-zÀ-ỹ]{1,5})\s*-\s*(.+)$")


def unaccent(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", unaccent(text).lower()).strip("-")
    return s[:80] or "place"


def _cap_first(s: str) -> str:
    return s[:1].upper() + s[1:] if s and s[:1].islower() else s


def parse_vn_name(raw: str) -> dict:
    """Split mapper-prefixed names: 'TH-Hà Thu-Tổ 4- Ấp 1 Minh Long- TT Chơn Thành- Bình Phước'."""
    result = {"name": raw.strip(), "address": None, "prefix": None, "kind": None, "category": None}
    m = _PREFIX_RE.match(raw)
    if not m:
        return result
    code = m.group(1)
    parts = [p.strip() for p in m.group(2).split("-") if p.strip()]
    if not parts:
        return result
    label, category = VN_PREFIXES.get(code.upper(), (None, None))
    known = code.upper() in VN_PREFIXES
    if not known and not code.isupper():
        return result  # Probably a hyphenated real name, leave untouched.
    raw_rest = parts[0]
    rest = _cap_first(raw_rest)
    name = rest
    if label and code.upper() not in ("CT",):
        u_rest, u_label = unaccent(rest).lower(), unaccent(label).lower()
        label_tail = u_label.split(" ", 1)[1] if " " in u_label else None
        if u_rest.startswith(u_label):
            name = rest
        elif label_tail and u_rest.startswith(label_tail):
            name = f"{label.split(' ', 1)[0]} {rest}"
        else:
            name = f"{label} {raw_rest}"
    result.update(
        name=name,
        address=", ".join(parts[1:]) or None,
        prefix=code,
        kind=label if known else code,
        category=category,
    )
    return result


def category_for(tags: dict, prefix_category: str | None = None) -> str:
    if prefix_category:
        return prefix_category
    mapping = rules()["osmCategoryMapping"]
    amenity, shop, tourism = tags.get("amenity"), tags.get("shop"), tags.get("tourism")
    if amenity and amenity in mapping["amenity"]:
        return mapping["amenity"][amenity]
    if shop and shop not in ("no", "vacant"):
        return mapping["shop"].get(shop, mapping["shopFallback"])
    if tourism and tourism in mapping.get("tourism", {}):
        return mapping["tourism"][tourism]
    return "other"


def is_poi(tags: dict) -> bool:
    r = rules()
    shop = tags.get("shop")
    if shop and shop not in ("no", "vacant"):
        return True
    if tags.get("amenity") in r["poiAmenities"]:
        return True
    return tags.get("tourism") in r["osmCategoryMapping"].get("tourism", {})


def compose_address(tags: dict) -> str | None:
    if tags.get("addr:full"):
        return tags["addr:full"]
    street = " ".join(p for p in (tags.get("addr:housenumber"), tags.get("addr:street")) if p)
    parts = [street] + [tags.get(k) for k in ("addr:subdistrict", "addr:district", "addr:city", "addr:province")]
    parts = [p for p in parts if p]
    return ", ".join(parts) or None
