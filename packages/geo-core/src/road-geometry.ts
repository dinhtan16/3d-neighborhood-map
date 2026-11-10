import type { LocalPoint } from '@nmap/shared-types';

export interface StripGeometry {
  /** Flat [x, y, z, ...] positions. */
  positions: number[];
  indices: number[];
}

export function emptyStrip(): StripGeometry {
  return { positions: [], indices: [] };
}

export function polylineLength(points: LocalPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return len;
}

function dedupe(points: LocalPoint[]): LocalPoint[] {
  const out: LocalPoint[] = [];
  for (const p of points) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-3) out.push(p);
  }
  return out;
}

/**
 * Buffer a polyline into a flat ribbon mesh (triangle list) at elevation `y`.
 * Uses mitred joins with a miter limit, plus optional round caps so that
 * road ends overlap cleanly at junctions without a polygon union step.
 * Triangles are wound counter-clockwise when viewed from +Y (normals face up).
 */
export function buildRibbon(
  input: LocalPoint[],
  width: number,
  y = 0,
  opts: { roundCaps?: boolean; capSegments?: number; miterLimit?: number } = {},
  target: StripGeometry = emptyStrip(),
): StripGeometry {
  const points = dedupe(input);
  if (points.length < 2 || width <= 0) return target;
  const half = width / 2;
  const miterLimit = opts.miterLimit ?? 2.5;
  const { positions, indices } = target;
  const base = positions.length / 3;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    // Direction vectors of adjacent segments.
    let dx: number, dz: number;
    let scale = 1;
    if (!prev) {
      [dx, dz] = norm(next[0] - p[0], next[1] - p[1]);
    } else if (!next) {
      [dx, dz] = norm(p[0] - prev[0], p[1] - prev[1]);
    } else {
      const [ax, az] = norm(p[0] - prev[0], p[1] - prev[1]);
      const [bx, bz] = norm(next[0] - p[0], next[1] - p[1]);
      [dx, dz] = norm(ax + bx, az + bz);
      if (dx === 0 && dz === 0) [dx, dz] = [ax, az];
      const cos = dx * ax + dz * az; // cos of half the turn angle
      scale = Math.min(1 / Math.max(cos, 1e-6), miterLimit);
    }
    // Left normal in the x/z plane (z grows southwards).
    const nx = dz;
    const nz = -dx;
    positions.push(p[0] + nx * half * scale, y, p[1] + nz * half * scale);
    positions.push(p[0] - nx * half * scale, y, p[1] - nz * half * scale);
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = base + i * 2; // left
    const b = a + 1; // right
    const c = a + 2; // next left
    const d = a + 3; // next right
    indices.push(a, b, c, b, d, c);
  }

  if (opts.roundCaps) {
    const seg = opts.capSegments ?? 8;
    addDisc(points[0], half, y, seg, target);
    addDisc(points[points.length - 1], half, y, seg, target);
  }
  return target;
}

/** Filled disc (triangle fan) – used for round caps / junction patches. */
export function addDisc(c: LocalPoint, r: number, y: number, segments: number, target: StripGeometry) {
  const { positions, indices } = target;
  const centre = positions.length / 3;
  positions.push(c[0], y, c[1]);
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    positions.push(c[0] + Math.cos(t) * r, y, c[1] + Math.sin(t) * r);
  }
  for (let i = 0; i < segments; i++) {
    const a = centre + 1 + i;
    const b = centre + 1 + ((i + 1) % segments);
    indices.push(centre, b, a);
  }
  return target;
}

/** Split a polyline into dash segments (for lane markings). */
export function dashSegments(input: LocalPoint[], dash: number, gap: number): LocalPoint[][] {
  const points = dedupe(input);
  const out: LocalPoint[][] = [];
  let drawing = true;
  let remaining = dash;
  let current: LocalPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    let segLen = Math.hypot(bx - ax, bz - az);
    const [ux, uz] = norm(bx - ax, bz - az);
    while (segLen > 0) {
      const step = Math.min(segLen, remaining);
      ax += ux * step;
      az += uz * step;
      segLen -= step;
      remaining -= step;
      if (drawing) current.push([ax, az]);
      if (remaining <= 1e-9) {
        if (drawing && current.length > 1) out.push(current);
        drawing = !drawing;
        remaining = drawing ? dash : gap;
        current = [[ax, az]];
      }
    }
  }
  if (drawing && current.length > 1 && polylineLength(current) > dash * 0.3) out.push(current);
  return out;
}

/** Evenly spaced points (with heading) along a line, offset sideways. Used for street furniture. */
export function samplesAlong(
  input: LocalPoint[],
  spacing: number,
  sideOffset: number,
  startOffset = spacing / 2,
): { point: LocalPoint; heading: number }[] {
  const points = dedupe(input);
  const out: { point: LocalPoint; heading: number }[] = [];
  let next = startOffset;
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    const [ux, uz] = norm(bx - ax, bz - az);
    while (next <= travelled + len) {
      const t = next - travelled;
      out.push({
        point: [ax + ux * t + uz * sideOffset, az + uz * t - ux * sideOffset],
        heading: Math.atan2(ux, uz),
      });
      next += spacing;
    }
    travelled += len;
  }
  return out;
}

function norm(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z);
  return l < 1e-12 ? [0, 0] : [x / l, z / l];
}
