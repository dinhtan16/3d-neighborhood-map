import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type {
  DataSource, FeatureType, GeoBounds, ImportJobStatus, LatLng, MapObjectStatus,
  PlaceStatus, Scale3, Uuid,
} from '@nmap/shared-types';

// ---------- Envelopes ----------
export interface ApiResponse<T, M = Record<string, unknown>> {
  data: T;
  meta: M & { timestamp: string };
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error: string;
}

// ---------- Map ----------
export interface MapAreaDto {
  id: Uuid;
  name: string;
  slug: string;
  crs: string;
  origin: LatLng;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  boundary: Geometry;
}

export interface MapFeatureProperties {
  id: Uuid;
  featureType: FeatureType;
  source: DataSource;
  sourceId: string | null;
  height: number | null;
  levels: number | null;
  styleKey: string | null;
  /** Normalized subset of OSM tags useful for rendering. */
  name?: string | null;
  highway?: string | null;
  widthM?: number | null;
  surface?: string | null;
  roofShape?: string | null;
  kind?: string | null;
  layer?: number | null;
}

export type MapFeature = Feature<Geometry, MapFeatureProperties>;
export type MapFeatureCollection = FeatureCollection<Geometry, MapFeatureProperties>;

export interface MapAssetDto {
  id: Uuid;
  assetKey: string;
  name: string;
  category: string;
  modelUrl: string;
  thumbnailUrl: string | null;
  format: string;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    origin: 'base-center';
    forward: '+Z';
    units: 'meters';
  } | null;
  metadata: Record<string, unknown>;
  version: number;
}

export interface MapObjectDto {
  id: Uuid;
  areaId: Uuid;
  assetId: Uuid;
  assetKey: string;
  modelUrl: string;
  placeId: Uuid | null;
  featureId: Uuid | null;
  position: LatLng;
  elevationM: number;
  rotation: number;
  scale: Scale3;
  status: MapObjectStatus;
  metadata: Record<string, unknown>;
}

export interface PlaceCategoryDto {
  id: Uuid;
  name: string;
  slug: string;
  icon: string | null;
  color?: string;
  sortOrder: number;
}

export interface PlaceSummaryDto {
  id: Uuid;
  name: string;
  slug: string;
  category: { id: Uuid; name: string; slug: string } | null;
  location: LatLng;
  address: string | null;
  status: PlaceStatus;
}

export interface PlaceImageDto {
  id: Uuid;
  imageUrl: string;
  altText: string | null;
  sortOrder: number;
}

export interface PlaceDetailDto extends PlaceSummaryDto {
  description: string | null;
  phone: string | null;
  openingHours: Record<string, unknown> | null;
  images: PlaceImageDto[];
  source: DataSource;
  objectIds: Uuid[];
}

export interface MapSceneDto {
  features: MapFeatureCollection;
  objects: MapObjectDto[];
  places: PlaceSummaryDto[];
}

export interface MapSceneMeta {
  areaId: Uuid;
  lod: number;
  featureCount: number;
  objectCount: number;
  placeCount: number;
}

export interface MapSceneQuery extends GeoBounds {
  areaId: Uuid;
  lod?: number;
  includeDrafts?: boolean;
}

// ---------- Places ----------
export interface PlaceSearchQuery {
  q?: string;
  categoryId?: Uuid;
  areaId?: Uuid;
  status?: PlaceStatus;
  limit?: number;
  cursor?: string;
}

export interface CreatePlaceRequest {
  name: string;
  categoryId: Uuid;
  latitude: number;
  longitude: number;
  address?: string;
  description?: string;
  phone?: string;
  status?: PlaceStatus;
  openingHours?: Record<string, unknown>;
}
export type UpdatePlaceRequest = Partial<CreatePlaceRequest>;

export interface CreatePlaceImageRequest {
  imageUrl: string;
  altText?: string;
  sortOrder?: number;
}

// ---------- Admin map objects ----------
export interface CreateMapObjectRequest {
  areaId: Uuid;
  assetId: Uuid;
  placeId?: Uuid | null;
  latitude: number;
  longitude: number;
  elevationM?: number;
  rotation?: number;
  scale?: Scale3;
  status?: MapObjectStatus;
  metadata?: Record<string, unknown>;
}
export type UpdateMapObjectRequest = Partial<Omit<CreateMapObjectRequest, 'areaId'>>;

// ---------- Import ----------
export interface StartOsmImportRequest {
  areaId: Uuid;
  bounds: GeoBounds;
}

export interface ImportJobDto {
  jobId: Uuid;
  status: ImportJobStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
  statistics?: Record<string, unknown> | null;
}

// ---------- Auth ----------
export interface LoginRequest { email: string; password: string }
export interface LoginResponse { accessToken: string; expiresIn: number; user: { email: string; role: 'admin' } }

export type { LatLng, GeoBounds, Scale3, Uuid } from '@nmap/shared-types';
