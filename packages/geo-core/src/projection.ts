import proj4 from 'proj4';
import type { LatLng, LocalPoint } from '@nmap/shared-types';

/**
 * Coordinate pipeline:
 *   WGS84 (EPSG:4326)  ->  projected metric CRS (e.g. UTM 48N / EPSG:32648)
 *                      ->  subtract a stable local origin
 *                      ->  Three.js local coords: X = east (m), Z = -north (m), Y = elevation.
 *
 * Raw UTM coordinates (~10^5..10^6 m) are never used as world coordinates; the
 * origin is subtracted in double precision before values reach Float32 buffers.
 */

const WGS84 = 'EPSG:4326';

export function projDefinitionFor(crs: string): string {
  const m = /^EPSG:(32[67])(\d{2})$/i.exec(crs.trim());
  if (m) {
    const zone = Number(m[2]);
    if (zone < 1 || zone > 60) throw new Error(`Invalid UTM zone in ${crs}`);
    const south = m[1] === '327' ? ' +south' : '';
    return `+proj=utm +zone=${zone}${south} +datum=WGS84 +units=m +no_defs`;
  }
  if (/^EPSG:3857$/i.test(crs)) {
    return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs';
  }
  throw new Error(`Unsupported CRS "${crs}". Use a UTM EPSG code (326xx / 327xx).`);
}

/** Suggest a UTM CRS for a location (e.g. Ho Chi Minh City -> EPSG:32648). */
export function suggestUtmCrs(lng: number, lat: number): string {
  const zone = Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));
  return `EPSG:${lat >= 0 ? 326 : 327}${String(zone).padStart(2, '0')}`;
}

export interface Projector {
  readonly crs: string;
  readonly origin: LatLng;
  /** Projected (metric) coordinates of the origin. */
  readonly originProjected: [number, number];
  toProjected(lng: number, lat: number): [number, number];
  toLocal(lng: number, lat: number): LocalPoint;
  toGeo(x: number, z: number): LatLng;
  ringToLocal(ring: number[][]): LocalPoint[];
}

export function createProjector(crs: string, origin: LatLng): Projector {
  const converter = proj4(WGS84, projDefinitionFor(crs));
  const [oe, on] = converter.forward([origin.lng, origin.lat]) as [number, number];

  const toProjected = (lng: number, lat: number): [number, number] =>
    converter.forward([lng, lat]) as [number, number];

  const toLocal = (lng: number, lat: number): LocalPoint => {
    const [e, n] = toProjected(lng, lat);
    return [e - oe, -(n - on)];
  };

  const toGeo = (x: number, z: number): LatLng => {
    const [lng, lat] = converter.inverse([x + oe, -z + on]) as [number, number];
    return { lat, lng };
  };

  return {
    crs,
    origin,
    originProjected: [oe, on],
    toProjected,
    toLocal,
    toGeo,
    ringToLocal: (ring) => ring.map(([lng, lat]) => toLocal(lng, lat)),
  };
}
