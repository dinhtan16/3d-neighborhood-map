import type { GeoBounds } from '@nmap/shared-types';
import { LIMITS } from '@nmap/map-config';

export function isValidLatitude(v: number): boolean {
  return Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isValidLongitude(v: number): boolean {
  return Number.isFinite(v) && v >= -180 && v <= 180;
}

export function boundsAreaDeg2(b: GeoBounds): number {
  return (b.maxLng - b.minLng) * (b.maxLat - b.minLat);
}

/** Returns a list of human-readable validation errors (empty = valid). */
export function validateBounds(b: GeoBounds, maxAreaDeg2: number = LIMITS.maxBboxAreaDeg2): string[] {
  const errors: string[] = [];
  if (!isValidLongitude(b.minLng) || !isValidLongitude(b.maxLng)) errors.push('Longitude must be between -180 and 180');
  if (!isValidLatitude(b.minLat) || !isValidLatitude(b.maxLat)) errors.push('Latitude must be between -90 and 90');
  if (errors.length) return errors;
  if (b.minLng >= b.maxLng) errors.push('minLng must be less than maxLng');
  if (b.minLat >= b.maxLat) errors.push('minLat must be less than maxLat');
  if (!errors.length && boundsAreaDeg2(b) > maxAreaDeg2) {
    errors.push(`Bounding box too large (max ${maxAreaDeg2} square degrees)`);
  }
  return errors;
}

export function expandBounds(b: GeoBounds, marginDeg: number): GeoBounds {
  return {
    minLng: b.minLng - marginDeg,
    minLat: b.minLat - marginDeg,
    maxLng: b.maxLng + marginDeg,
    maxLat: b.maxLat + marginDeg,
  };
}
