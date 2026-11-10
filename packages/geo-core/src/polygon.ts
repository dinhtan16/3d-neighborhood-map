import type { LocalPoint } from '@nmap/shared-types';

const EPS = 1e-9;

/** Remove the GeoJSON closing vertex and consecutive duplicates. */
export function cleanRing(ring: LocalPoint[], tolerance = 1e-3): LocalPoint[] {
  const out: LocalPoint[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > tolerance) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance) out.pop();
  }
  return out;
}

/** Shoelace signed area in the (x, z) plane. Positive = counter-clockwise in (x, z). */
export function signedArea(ring: LocalPoint[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % n];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

export function polygonArea(ring: LocalPoint[]): number {
  return Math.abs(signedArea(ring));
}

export function ensureOrientation(ring: LocalPoint[], ccw: boolean): LocalPoint[] {
  const isCcw = signedArea(ring) > 0;
  return isCcw === ccw ? ring : [...ring].reverse();
}

export function ringCentroid(ring: LocalPoint[]): LocalPoint {
  const a = signedArea(ring);
  if (Math.abs(a) < EPS) {
    const sx = ring.reduce((s, p) => s + p[0], 0);
    const sz = ring.reduce((s, p) => s + p[1], 0);
    return [sx / ring.length, sz / ring.length];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % n];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function pointInRing(p: LocalPoint, ring: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi + EPS) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function ringBounds(ring: LocalPoint[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** A polygon is renderable when its outer ring has >= 3 distinct vertices and non-trivial area. */
export function isRenderableRing(ring: LocalPoint[], minAreaM2 = 1): boolean {
  return ring.length >= 3 && polygonArea(ring) >= minAreaM2;
}
