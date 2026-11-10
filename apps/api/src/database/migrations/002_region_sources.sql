-- 002_region_sources: region expansion (Chơn Thành – Minh Hưng – Bình Long).
-- * allow Microsoft ML building footprints as a feature source
-- * stored centroid (point on surface) for chunk assignment without duplicates

ALTER TABLE map_features DROP CONSTRAINT IF EXISTS map_features_source_check;
ALTER TABLE map_features ADD CONSTRAINT map_features_source_check
  CHECK (source IN ('osm', 'manual', 'microsoft'));

ALTER TABLE map_features
  ADD COLUMN centroid GEOMETRY(Point, 4326)
  GENERATED ALWAYS AS (ST_PointOnSurface(geometry)) STORED;

CREATE INDEX idx_map_features_centroid ON map_features USING GIST(centroid);
CREATE INDEX IF NOT EXISTS idx_map_features_area_type ON map_features(area_id, feature_type);
CREATE INDEX IF NOT EXISTS idx_map_features_source ON map_features(area_id, source);
