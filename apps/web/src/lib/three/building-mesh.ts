import * as THREE from 'three';
import type { LocalPoint } from '@nmap/shared-types';
import { cleanRing, ensureOrientation, fnv1a, polygonArea, ringCentroid } from '@nmap/geo-core';
import { STYLE_V2 } from '@nmap/map-config';

export interface BuildingInput {
  id: string;
  /** Outer ring + holes, local metres. */
  rings: LocalPoint[][];
  height: number;
  levels: number | null;
  kind?: string | null;
  name?: string | null;
  placeId?: string | null;
}

export interface BuildingMeta {
  id: string;
  index: number;
  centroid: LocalPoint;
  height: number;
  ring: LocalPoint[];
  name: string | null;
  levels: number | null;
  placeId: string | null;
}

export interface PropInstance { x: number; y: number; z: number; rotation: number; sx: number; sy: number; sz: number; color: number }

export interface BuiltBuildings {
  geometry: THREE.BufferGeometry | null;
  metas: BuildingMeta[];
  awnings: PropInstance[];
  tanks: PropInstance[];
}

type RoadProbe = (p: LocalPoint) => number; // distance to the nearest carriageway edge (m), Infinity if none

const ROOF_FLAT = ['#e7cfc3', '#dcc6cc', '#d3c0ae', '#e9d9c6'];
const INDUSTRIAL_WALL = '#ece3d6';
const INDUSTRIAL_ROOF = '#b9c7d3';

const hash01 = (s: string, salt = 0) => (fnv1a(`${s}:${salt}`) % 100000) / 100000;

/** Oriented minimum-area bounding rectangle (rotating edges of the ring). */
function obb(ring: LocalPoint[]) {
  let best: { area: number; angle: number; minU: number; maxU: number; minV: number; maxV: number } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * c + z * s, v = -x * s + z * c;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, angle: ang, minU, maxU, minV, maxV };
  }
  return best!;
}

class GeoWriter {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = [];
  roof: number[] = []; seed: number[] = []; bid: number[] = []; idx: number[] = [];
  vert(x: number, y: number, z: number, n: [number, number, number], c: THREE.Color, u: number, v: number, roof: number, seed: number, bid: number) {
    this.pos.push(x, y, z); this.nor.push(...n); this.col.push(c.r, c.g, c.b); this.uv.push(u, v);
    this.roof.push(roof); this.seed.push(seed); this.bid.push(bid);
    return this.pos.length / 3 - 1;
  }
  /** Wall quad a→b (outward normal on the right-hand side for positive-area rings). */
  wall(a: LocalPoint, b: LocalPoint, y0: number, y1: number, u0: number, c: THREE.Color, kind: number, seed: number, bid: number) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return u0;
    const n: [number, number, number] = [dz / len, 0, -dx / len];
    const u1 = u0 + len;
    const i0 = this.vert(a[0], y0, a[1], n, c, u0, y0, kind, seed, bid);
    const i1 = this.vert(b[0], y0, b[1], n, c, u1, y0, kind, seed, bid);
    const i2 = this.vert(b[0], y1, b[1], n, c, u1, y1, kind, seed, bid);
    const i3 = this.vert(a[0], y1, a[1], n, c, u0, y1, kind, seed, bid);
    this.idx.push(i0, i2, i1, i0, i3, i2);
    return u1;
  }
  /** Triangle with automatic upward/outward winding given the intended normal. */
  tri(p: [number, number, number][], n: [number, number, number], c: THREE.Color, kind: number, seed: number, bid: number) {
    const ids = p.map((q) => this.vert(q[0], q[1], q[2], n, c, 0, q[1], kind, seed, bid));
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const cx = u[1] * v[2] - u[2] * v[1], cy = u[2] * v[0] - u[0] * v[2], cz = u[0] * v[1] - u[1] * v[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(ids[0], ids[1], ids[2]);
    else this.idx.push(ids[0], ids[2], ids[1]);
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aRoof', new THREE.Float32BufferAttribute(this.roof, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.seed, 1));
    g.setAttribute('aBid', new THREE.Float32BufferAttribute(this.bid, 1));
    g.setIndex(this.idx.length > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Build all buildings of a chunk into ONE geometry (one draw call).
 * aRoof: 0 = façade with windows, 1 = roof, 2 = plain wall (gables, industrial).
 */
export function buildBuildings(inputs: BuildingInput[], roadProbe: RoadProbe): BuiltBuildings {
  const w = new GeoWriter();
  const metas: BuildingMeta[] = [];
  const awnings: PropInstance[] = [];
  const tanks: PropInstance[] = [];
  const tmp = new THREE.Color();
  const roofC = new THREE.Color();

  inputs.forEach((b) => {
    const outer0 = cleanRing(b.rings[0] ?? []);
    if (outer0.length < 3) return;
    const area = polygonArea(outer0);
    if (area < 6) return;
    const bid = metas.length;
    const seed = hash01(b.id);
    const industrial = b.kind === 'industrial' || area > 900;
    const height = Math.max(2.8, b.height || 6);
    tmp.set(industrial ? INDUSTRIAL_WALL : STYLE_V2.wallColors[fnv1a(b.id) % STYLE_V2.wallColors.length]);

    let outer = ensureOrientation(outer0, true);
    // Gable roof for small, near-rectangular low-rise houses (common in rural Bình Phước).
    const box = obb(outer);
    const lenU = box.maxU - box.minU, lenV = box.maxV - box.minV;
    const rectish = outer.length <= 7 && area / box.area > 0.82;
    const gable = !industrial && rectish && (b.levels ?? Math.round(height / 3.5)) <= 2 && Math.min(lenU, lenV) <= 12 && seed < 0.6;
    if (gable) {
      const c = Math.cos(box.angle), s = Math.sin(box.angle);
      const toXZ = (u: number, v: number): LocalPoint => [u * c - v * s, u * s + v * c];
      outer = ensureOrientation([toXZ(box.minU, box.minV), toXZ(box.maxU, box.minV), toXZ(box.maxU, box.maxV), toXZ(box.minU, box.maxV)], true);
    }

    const wallKind = industrial ? 2 : 0;
    const wallH = gable ? Math.min(height, 3.6 * Math.max(1, b.levels ?? 1)) : height;
    // walls (outer + holes)
    let u = 0;
    for (let i = 0; i < outer.length; i++) u = w.wall(outer[i], outer[(i + 1) % outer.length], 0, wallH, u, tmp, wallKind, seed, bid);
    const holes = gable ? [] : b.rings.slice(1).map((h) => ensureOrientation(cleanRing(h), false)).filter((h) => h.length >= 3);
    for (const h of holes) { let uh = 0; for (let i = 0; i < h.length; i++) uh = w.wall(h[i], h[(i + 1) % h.length], 0, wallH, uh, tmp, wallKind, seed, bid); }

    if (gable) {
      roofC.set(STYLE_V2.roofColors[fnv1a(`${b.id}r`) % STYLE_V2.roofColors.length]);
      const c = Math.cos(box.angle), s = Math.sin(box.angle);
      const toXZ = (uu: number, vv: number): LocalPoint => [uu * c - vv * s, uu * s + vv * c];
      const alongU = lenU >= lenV; // ridge along the long axis
      const ridgeH = wallH + Math.min(lenU, lenV) * 0.3;
      const ov = 0.35; // eave overhang
      const [u0, u1, v0, v1] = [box.minU - ov, box.maxU + ov, box.minV - ov, box.maxV + ov];
      const P = (uu: number, vv: number, y: number): [number, number, number] => { const [x, z] = toXZ(uu, vv); return [x, y, z]; };
      if (alongU) {
        const vm = (box.minV + box.maxV) / 2;
        const r0 = P(u0, vm, ridgeH), r1 = P(u1, vm, ridgeH);
        const nA = toXZ(0, -1), nB = toXZ(0, 1);
        const slope = (ridgeH - wallH) / (vm - v0);
        const nlA: [number, number, number] = [nA[0], 1 / Math.max(slope, 0.2), nA[1]], nlB: [number, number, number] = [nB[0], 1 / Math.max(slope, 0.2), nB[1]];
        w.tri([P(u0, v0, wallH), P(u1, v0, wallH), r1], nlA, roofC, 1, seed, bid); w.tri([P(u0, v0, wallH), r1, r0], nlA, roofC, 1, seed, bid);
        w.tri([P(u0, v1, wallH), r1, P(u1, v1, wallH)], nlB, roofC, 1, seed, bid); w.tri([P(u0, v1, wallH), r0, r1], nlB, roofC, 1, seed, bid);
        const gu0 = toXZ(-1, 0), gu1 = toXZ(1, 0);
        w.tri([P(box.minU, box.minV, wallH), P(box.minU, box.maxV, wallH), P(box.minU, vm, ridgeH)], [gu0[0], 0, gu0[1]], tmp, 2, seed, bid);
        w.tri([P(box.maxU, box.minV, wallH), P(box.maxU, box.maxV, wallH), P(box.maxU, vm, ridgeH)], [gu1[0], 0, gu1[1]], tmp, 2, seed, bid);
      } else {
        const um = (box.minU + box.maxU) / 2;
        const r0 = P(um, v0, ridgeH), r1 = P(um, v1, ridgeH);
        const nA = toXZ(-1, 0), nB = toXZ(1, 0);
        const slope = (ridgeH - wallH) / (um - u0);
        const nlA: [number, number, number] = [nA[0], 1 / Math.max(slope, 0.2), nA[1]], nlB: [number, number, number] = [nB[0], 1 / Math.max(slope, 0.2), nB[1]];
        w.tri([P(u0, v0, wallH), P(u0, v1, wallH), r1], nlA, roofC, 1, seed, bid); w.tri([P(u0, v0, wallH), r1, r0], nlA, roofC, 1, seed, bid);
        w.tri([P(u1, v0, wallH), r1, P(u1, v1, wallH)], nlB, roofC, 1, seed, bid); w.tri([P(u1, v0, wallH), r0, r1], nlB, roofC, 1, seed, bid);
        const gv0 = toXZ(0, -1), gv1 = toXZ(0, 1);
        w.tri([P(box.minU, box.minV, wallH), P(box.maxU, box.minV, wallH), P(um, box.minV, ridgeH)], [gv0[0], 0, gv0[1]], tmp, 2, seed, bid);
        w.tri([P(box.minU, box.maxV, wallH), P(box.maxU, box.maxV, wallH), P(um, box.maxV, ridgeH)], [gv1[0], 0, gv1[1]], tmp, 2, seed, bid);
      }
    } else {
      // flat roof (earcut triangulation)
      roofC.set(industrial ? INDUSTRIAL_ROOF : ROOF_FLAT[fnv1a(`${b.id}f`) % ROOF_FLAT.length]);
      const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
      const holeV = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
      const faces = THREE.ShapeUtils.triangulateShape(contour, holeV);
      const all = [...outer, ...holes.flat()];
      for (const f of faces) {
        w.tri(f.map((k) => [all[k][0], height, all[k][1]] as [number, number, number]), [0, 1, 0], roofC, 1, seed, bid);
      }
      // rooftop water tank (very Vietnamese)
      if (!industrial && area > 25 && hash01(b.id, 3) < 0.4) {
        const [cx, cz] = ringCentroid(outer);
        tanks.push({ x: cx + (hash01(b.id, 4) - 0.5) * 2, y: height, z: cz + (hash01(b.id, 5) - 0.5) * 2, rotation: hash01(b.id, 6) * Math.PI, sx: 1, sy: 1, sz: 1, color: hash01(b.id, 7) < 0.5 ? 0 : 1 });
      }
    }

    // Awning over the road-facing shopfront.
    if (!industrial && height >= 5.5 && hash01(b.id, 1) < 0.75) {
      let best: { m: LocalPoint; n: LocalPoint; len: number; d: number } | null = null;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i], c = outer[(i + 1) % outer.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 2.5 || len > 14) continue;
        const n: LocalPoint = [(c[1] - a[1]) / len, -(c[0] - a[0]) / len];
        const m: LocalPoint = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        const d = roadProbe([m[0] + n[0] * 2.5, m[1] + n[1] * 2.5]);
        if (d < 13 && (!best || d < best.d)) best = { m, n, len, d };
      }
      if (best) {
        awnings.push({
          x: best.m[0] + best.n[0] * 0.05, y: Math.min(3.2, wallH - 0.4), z: best.m[1] + best.n[1] * 0.05,
          rotation: Math.atan2(best.n[0], best.n[1]), sx: best.len * 0.86, sy: 1, sz: 1,
          color: fnv1a(`${b.id}a`) % STYLE_V2.awningColors.length,
        });
      }
    }

    metas.push({ id: b.id, index: bid, centroid: ringCentroid(outer0), height, ring: outer0, name: b.name ?? null, levels: b.levels, placeId: b.placeId ?? null });
  });

  return { geometry: w.build(), metas, awnings, tanks };
}
