import type { LatLng, Scale3, Vec3 } from '@nmap/shared-types';
import type { Projector } from './projection';

/**
 * Asset convention (see docs/asset-guidelines.md):
 *  - model origin at base-centre, units in meters, forward = +Z.
 *  - `rotation` is radians about +Y (Three.js rotation.y). 0 => forward faces world +Z (south).
 */
export interface ObjectTransform {
  position: Vec3;
  rotationY: number;
  scale: Vec3;
}

export function objectTransform(
  projector: Projector,
  position: LatLng,
  elevationM = 0,
  rotation = 0,
  scale: Scale3 = { x: 1, y: 1, z: 1 },
): ObjectTransform {
  const [x, z] = projector.toLocal(position.lng, position.lat);
  return {
    position: [x, elevationM, z],
    rotationY: normalizeAngle(rotation),
    scale: [scale.x, scale.y, scale.z],
  };
}

export function normalizeAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  let r = rad % twoPi;
  if (r < 0) r += twoPi;
  return r;
}

/** Convert a world-space edit back into the persisted geographic representation. */
export function worldToObjectPosition(projector: Projector, x: number, z: number): LatLng {
  return projector.toGeo(x, z);
}
