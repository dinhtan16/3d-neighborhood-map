import pytest

import normalize as n

# Reference values produced by packages/geo-core (TypeScript) – the two must agree.
JS_VECTORS = [
    ("a", 3826002220, "residential-coral"),
    ("way/123", 3327974463, "residential-peach"),
    ("way/987654321", 2355448960, "residential-coral"),
    ("node/7249011885", 196478949, "shophouse-terracotta"),
    ("Chơn Thành", 1015010467, "residential-mint"),
]


@pytest.mark.parametrize("text,expected_hash,expected_style", JS_VECTORS)
def test_fnv1a_and_style_match_typescript(text, expected_hash, expected_style):
    assert n.fnv1a(text) == expected_hash
    assert n.default_style_key(text, "yes") == expected_style


def test_fnv1a_known_values():
    assert n.fnv1a("") == 0x811C9DC5
    assert n.fnv1a("a") == 0xE40C292C


def test_style_for_building_types():
    assert n.default_style_key("x", "school") == "civic-sand"
    assert n.default_style_key("x", "retail") == "shophouse-terracotta"


class TestHeightPolicy:
    def test_actual_height_wins(self):
        assert n.resolve_building_height("12.5 m", 2) == (12.5, 2, False)

    @pytest.mark.parametrize("levels,height", [(1, 3.5), ("2", 7.0), (3, 10.5)])
    def test_levels(self, levels, height):
        assert n.resolve_building_height(None, levels)[0] == height

    def test_default(self):
        assert n.resolve_building_height() == (6.0, None, True)
        assert n.resolve_building_height("tall", "many") == (6.0, None, True)

    def test_feet_and_clamp(self):
        assert n.parse_length_m("10'") == pytest.approx(3.048)
        assert n.resolve_building_height("1", None)[0] == 2.5  # min clamp


def test_road_width():
    assert n.road_width_m({"highway": "primary"}) == 11
    assert n.road_width_m({"highway": "residential", "width": "8"}) == 8
    assert n.road_width_m({"highway": "service", "lanes": "2"}) == 6
    assert n.road_width_m({"highway": "unknown_class"}) == 4


@pytest.mark.parametrize(
    "tags,etype,closed,expected",
    [
        ({"building": "yes"}, "way", True, ("building", "yes")),
        ({"building": "yes"}, "way", False, None),
        ({"highway": "residential"}, "way", False, ("road", "residential")),
        ({"highway": "pedestrian", "area": "yes"}, "way", True, ("public_space", "pedestrian")),
        ({"leisure": "park"}, "way", True, ("park", "park")),
        ({"amenity": "marketplace"}, "way", True, ("public_space", "marketplace")),
        ({"natural": "water"}, "relation", True, ("water", "water")),
        ({"natural": "tree"}, "node", False, ("tree", "tree")),
        ({"highway": "proposed"}, "way", False, None),
        ({"shop": "convenience"}, "node", False, None),
    ],
)
def test_classify(tags, etype, closed, expected):
    assert n.classify(tags, etype, closed) == expected


class TestVietnameseNames:
    def test_grocery_prefix(self):
        r = n.parse_vn_name("TH-Hà Thu-Tổ 4- Ấp 1 Minh Long- TT Chơn Thành- Bình Phước")
        assert r["name"] == "Tạp hóa Hà Thu"
        assert r["address"] == "Tổ 4, Ấp 1 Minh Long, TT Chơn Thành, Bình Phước"
        assert r["kind"] == "Tạp hóa"
        assert r["category"] == "grocery"

    def test_restaurant_prefix_overrides_wrong_tag(self):
        r = n.parse_vn_name("QA-Bê Thui Út Bò-Tổ 6-khu phố 8- chơn thành-Bình Phước")
        assert r["name"] == "Quán ăn Bê Thui Út Bò"
        assert n.category_for({"amenity": "pharmacy"}, r["category"]) == "food-beverage"

    def test_label_already_in_name(self):
        r = n.parse_vn_name("THọc-Tiểu Học Lương Thế Vinh-Tổ 4- Ấp 1 Minh Long")
        assert r["name"] == "Trường Tiểu Học Lương Thế Vinh"

    def test_lowercase_remainder_after_label(self):
        assert n.parse_vn_name("TH-gần nhà nghỉ 567-Tổ 6")["name"] == "Tạp hóa gần nhà nghỉ 567"

    def test_unknown_prefix_kept(self):
        r = n.parse_vn_name("SB-Phương Nam-Tổ 4")
        assert r["name"] == "Phương Nam" and r["category"] is None

    def test_plain_names_untouched(self):
        assert n.parse_vn_name("The Coffee House")["name"] == "The Coffee House"
        assert n.parse_vn_name("Trà sữa Gong-Cha")["name"] == "Trà sữa Gong-Cha"
        assert n.parse_vn_name("Cát Đằng")["address"] is None


@pytest.mark.parametrize(
    "tags,expected",
    [
        ({"amenity": "cafe"}, "food-beverage"),
        ({"shop": "convenience"}, "grocery"),
        ({"shop": "clothes"}, "retail"),
        ({"amenity": "atm"}, "services"),
        ({"tourism": "guest_house"}, "services"),
        ({"amenity": "marketplace"}, "market-stalls"),
        ({"amenity": "bench"}, "other"),
    ],
)
def test_category_mapping(tags, expected):
    assert n.category_for(tags) == expected


def test_slugify_vietnamese():
    assert n.slugify("Tạp hóa Hà Thu") == "tap-hoa-ha-thu"
    assert n.slugify("Đường Nguyễn Huệ") == "duong-nguyen-hue"


def test_compose_address():
    assert n.compose_address({"addr:housenumber": "134", "addr:street": "Lý Nam Đế"}) == "134 Lý Nam Đế"
    assert n.compose_address({}) is None
