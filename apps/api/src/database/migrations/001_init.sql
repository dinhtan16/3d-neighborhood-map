-- 001_init: core schema for the 3D neighborhood map.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy place search
CREATE EXTENSION IF NOT EXISTS unaccent;   -- Vietnamese diacritic-insensitive search

-- unaccent() is STABLE; wrap it so it can be used in an index expression.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, replace(replace($1, 'đ', 'd'), 'Đ', 'D')) $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ---------- map_areas ----------
CREATE TABLE map_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(255) NOT NULL UNIQUE,
  boundary    GEOMETRY(MultiPolygon, 4326) NOT NULL,
  crs         VARCHAR(30)  NOT NULL,
  origin_lat  DOUBLE PRECISION NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lng  DOUBLE PRECISION NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT map_areas_boundary_valid CHECK (ST_IsValid(boundary))
);
CREATE INDEX idx_map_areas_boundary ON map_areas USING GIST(boundary);

-- ---------- map_features ----------
CREATE TABLE map_features (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id      UUID NOT NULL REFERENCES map_areas(id) ON DELETE CASCADE,
  feature_type VARCHAR(50) NOT NULL,
  source       VARCHAR(30) NOT NULL CHECK (source IN ('osm', 'manual')),
  source_id    VARCHAR(100),
  geometry     GEOMETRY(Geometry, 4326) NOT NULL,
  properties   JSONB NOT NULL DEFAULT '{}'::jsonb,
  height_m     DOUBLE PRECISION,
  levels       INTEGER,
  style_key    VARCHAR(100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- External identity for idempotent imports (NULL source_id allowed for manual features).
CREATE UNIQUE INDEX uq_map_features_source ON map_features(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_map_features_area ON map_features(area_id);
CREATE INDEX idx_map_features_type ON map_features(area_id, feature_type);
CREATE INDEX idx_map_features_geometry ON map_features USING GIST(geometry);

-- ---------- place_categories ----------
CREATE TABLE place_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  slug       VARCHAR(100) NOT NULL UNIQUE,
  icon       VARCHAR(100),
  color      VARCHAR(20),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- places ----------
CREATE TABLE places (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id       UUID REFERENCES map_areas(id) ON DELETE SET NULL,
  category_id   UUID REFERENCES place_categories(id) ON DELETE SET NULL,
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) NOT NULL,
  description   TEXT,
  location      GEOGRAPHY(POINT, 4326) NOT NULL,
  address       TEXT,
  phone         VARCHAR(30),
  opening_hours JSONB,
  status        VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  source        VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source IN ('osm', 'manual')),
  source_id     VARCHAR(100),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_places_source ON places(source, source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX uq_places_slug ON places(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_places_location ON places USING GIST(location);
CREATE INDEX idx_places_category ON places(category_id);
CREATE INDEX idx_places_area ON places(area_id);
CREATE INDEX idx_places_name_trgm ON places USING GIN (f_unaccent(lower(name)) gin_trgm_ops);

-- ---------- place_images ----------
CREATE TABLE place_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id   UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  image_url  TEXT NOT NULL,
  alt_text   VARCHAR(255),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_place_images_place ON place_images(place_id, sort_order);

-- ---------- map_assets ----------
CREATE TABLE map_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_key     VARCHAR(100) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  category      VARCHAR(50)  NOT NULL,
  model_url     TEXT NOT NULL,
  thumbnail_url TEXT,
  format        VARCHAR(20) NOT NULL DEFAULT 'glb',
  bounding_box  JSONB,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- map_objects ----------
CREATE TABLE map_objects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id     UUID NOT NULL REFERENCES map_areas(id) ON DELETE CASCADE,
  feature_id  UUID REFERENCES map_features(id) ON DELETE SET NULL,
  asset_id    UUID NOT NULL REFERENCES map_assets(id),
  place_id    UUID REFERENCES places(id) ON DELETE SET NULL,
  position    GEOGRAPHY(POINT, 4326) NOT NULL,
  elevation_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  rotation    DOUBLE PRECISION NOT NULL DEFAULT 0,
  scale       JSONB NOT NULL DEFAULT '{"x":1,"y":1,"z":1}'::jsonb,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  source      VARCHAR(30) NOT NULL DEFAULT 'manual',
  source_id   VARCHAR(100),
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_map_objects_source ON map_objects(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_map_objects_position ON map_objects USING GIST(position);
CREATE INDEX idx_map_objects_area ON map_objects(area_id);
CREATE INDEX idx_map_objects_place ON map_objects(place_id);

-- ---------- import_jobs ----------
CREATE TABLE import_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id       UUID NOT NULL REFERENCES map_areas(id) ON DELETE CASCADE,
  source        VARCHAR(30) NOT NULL DEFAULT 'osm',
  status        VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  bounds        JSONB,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  error_message TEXT,
  statistics    JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_import_jobs_area ON import_jobs(area_id, created_at DESC);

CREATE TRIGGER trg_map_areas_updated BEFORE UPDATE ON map_areas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_map_features_updated BEFORE UPDATE ON map_features FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_places_updated BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_map_objects_updated BEFORE UPDATE ON map_objects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
