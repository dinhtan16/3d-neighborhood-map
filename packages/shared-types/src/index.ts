export type Uuid = string;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface Scale3 {
  x: number;
  y: number;
  z: number;
}

/** Three.js local world coordinate (meters). X = east, Y = up, Z = south. */
export type LocalPoint = [x: number, z: number];
export type Vec3 = [x: number, y: number, z: number];

export type PlaceStatus = 'active' | 'inactive' | 'pending';
export type MapObjectStatus = 'draft' | 'published';
export type ImportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type FeatureType = 'building' | 'road' | 'park' | 'public_space' | 'water' | 'tree';
export type DataSource = 'osm' | 'manual';
