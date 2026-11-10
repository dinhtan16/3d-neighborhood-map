import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LocalPoint } from '@nmap/shared-types';
import type { Projector } from '@nmap/geo-core';
import {
  buildRibbon, cleanRing, dashSegments, emptyStrip, ensureOrientation, isRenderableRing,
  samplesAlong, type StripGeometry,
} from '@nmap/geo-core';
import { ROADS_WITH_CENTER_LINE, roadWidthFor, sidewalkWidthFor } from '@nmap/map-config';
import type { MapFeature } from '@nmap/map-contracts';
import { linesToLocal, polygonsToLocal } from '@/lib/geo/coordinates';

// Vertical stacking of flat ground layers (meters). Orthographic depth is linear,
// so a few centimetres are enough to avoid z-fighting.
export const LAYER_Y = {
  ground: 0,
  publicSpace: 0.03,
  footway: 0.06,
  sidewalk: 0.1,
  curb: 0.11,
  serviceRoad: 0.12,
  road: 0.13,
  marking: 0.15,
} as const;

export function stripToGeometry(strip: StripGeometry): THREE.BufferGeometry | null {
  if (!strip.indices.length) return null;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(strip.positions);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setIndex(strip.indices);
  g.computeBoundingSphere();
  return g;
}

const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway']);
const SERVICE = new Set(['service', 'track']);

export interface RoadGeometrySet {
  road: THREE.BufferGeometry | null;
  service: THREE.BufferGeometry | null;
  foot: THREE.BufferGeometry | null;
  sidewalk: THREE.BufferGeometry | null;
  curb: THREE.BufferGeometry | null;
  marking: THREE.BufferGeometry | null;
  /** Centre lines with half-widths, used for decoration placement / collision. */
  centerlines: { points: LocalPoint[]; halfWidth: number; highway: string }[];
}

export function buildRoadGeometries(features: MapFeature[], projector: Projector): RoadGeometrySet {
  const road = emptyStrip(), service = emptyStrip(), foot = emptyStrip();
  const sidewalk = emptyStrip(), curb = emptyStrip(), marking = emptyStrip();
  const centerlines: RoadGeometrySet['centerlines'] = [];

  for (const f of features) {
    const hw = f.properties.highway ?? 'unclassified';
    const width = f.properties.widthM ?? roadWidthFor(hw);
    for (const line of linesToLocal(projector, f.geometry)) {
      if (line.length < 2) continue;
      centerlines.push({ points: line, halfWidth: width / 2, highway: hw });
      if (FOOT.has(hw)) {
        buildRibbon(line, width, LAYER_Y.footway, { roundCaps: true, capSegments: 6 }, foot);
        continue;
      }
      if (SERVICE.has(hw)) {
        buildRibbon(line, width, LAYER_Y.serviceRoad, { roundCaps: true, capSegments: 8 }, service);
        continue;
      }
      const sw = sidewalkWidthFor(hw);
      if (sw > 0) {
        buildRibbon(line, width + sw * 2, LAYER_Y.sidewalk, { roundCaps: true, capSegments: 10 }, sidewalk);
        buildRibbon(line, width + 0.6, LAYER_Y.curb, { roundCaps: true, capSegments: 10 }, curb);
      }
      buildRibbon(line, width, LAYER_Y.road, { roundCaps: true, capSegments: 10 }, road);
      if (ROADS_WITH_CENTER_LINE.includes(hw)) {
        for (const dash of dashSegments(line, 3, 3)) buildRibbon(dash, 0.25, LAYER_Y.marking, {}, marking);
      }
    }
  }
  return {
    road: stripToGeometry(road),
    service: stripToGeometry(service),
    foot: stripToGeometry(foot),
    sidewalk: stripToGeometry(sidewalk),
    curb: stripToGeometry(curb),
    marking: stripToGeometry(marking),
    centerlines,
  };
}

/** THREE.Shape in the XY plane; geometry is later rotated so depth points up (+Y). */
function shapeFromRings(rings: LocalPoint[][]): THREE.Shape | null {
  const outer = cleanRing(rings[0] ?? []);
  if (!isRenderableRing(outer)) return null;
  // Shape coords are (x, -z) so that rotateX(-90°) maps them back to world (x, z).
  const toV2 = (r: LocalPoint[]) => r.map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(toV2(ensureOrientation(outer, false)));
  for (const hole of rings.slice(1)) {
    const h = cleanRing(hole);
    if (h.length >= 3) shape.holes.push(new THREE.Path(toV2(ensureOrientation(h, true))));
  }
  return shape;
}

export interface BuildingGeometry {
  geometry: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  center: THREE.Vector3;
  height: number;
}

/**
 * Extrude a footprint to its height. Groups: 0 = roof/caps, 1 = walls.
 * Wall UVs are in world meters (ExtrudeGeometry's default UV generator), so the
 * façade texture repeats per 3 m x 3.5 m floor cell.
 */
export function buildBuildingGeometry(f: MapFeature, projector: Projector): BuildingGeometry | null {
  const height = Math.max(2.5, f.properties.height ?? 6);
  const parts: THREE.BufferGeometry[] = [];
  for (const rings of polygonsToLocal(projector, f.geometry)) {
    const shape = shapeFromRings(rings);
    if (!shape) continue;
    const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
    g.rotateX(-Math.PI / 2);
    parts.push(g);
  }
  if (!parts.length) return null;
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, true) ?? parts[0];
  // Roof parapet effect: thin darker cap is provided by the roof material; outline edges:
  const edges = new THREE.EdgesGeometry(geometry, 28);
  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox!.getCenter(center);
  return { geometry, edges, center, height };
}

/** Merge many LineSegments geometries into one draw call. */
export function mergeLineGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  let total = 0;
  for (const g of list) total += g.getAttribute('position').count * 3;
  const out = new Float32Array(total);
  let offset = 0;
  for (const g of list) {
    const arr = g.getAttribute('position').array as Float32Array;
    out.set(arr, offset);
    offset += arr.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(out, 3));
  merged.computeBoundingSphere();
  return merged;
}

export function buildFlatPolygons(features: MapFeature[], projector: Projector, y: number): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const f of features) {
    for (const rings of polygonsToLocal(projector, f.geometry)) {
      const shape = shapeFromRings(rings);
      if (!shape) continue;
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, 0);
      parts.push(g.toNonIndexed());
    }
  }
  if (!parts.length) return null;
  return mergeGeometries(parts, false);
}

// ---------------- procedural street decoration ----------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform grid of road segments for fast "is this point on a road?" checks. */
class SegmentIndex {
  private cells = new Map<string, { a: LocalPoint; b: LocalPoint; r: number }[]>();
  constructor(private size = 20) {}
  private key(cx: number, cz: number) { return `${cx},${cz}`; }
  add(a: LocalPoint, b: LocalPoint, r: number) {
    const s = this.size;
    const x0 = Math.floor((Math.min(a[0], b[0]) - r) / s), x1 = Math.floor((Math.max(a[0], b[0]) + r) / s);
    const z0 = Math.floor((Math.min(a[1], b[1]) - r) / s), z1 = Math.floor((Math.max(a[1], b[1]) + r) / s);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = this.key(x, z);
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push({ a, b, r });
    }
  }
  clear(p: LocalPoint, margin: number): boolean {
    const c = this.cells.get(this.key(Math.floor(p[0] / this.size), Math.floor(p[1] / this.size)));
    if (!c) return true;
    for (const { a, b, r } of c) if (distToSegment(p, a, b) < r + margin) return false;
    return true;
  }
}

function distToSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

export interface DecorationInstance { x: number; z: number; rotation: number; scale: number; variant: number }

export function planStreetDecoration(
  centerlines: RoadGeometrySet['centerlines'],
  avoid: { x: number; z: number; r: number }[],
  extraTrees: LocalPoint[],
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  maxTrees = 1600,
) {
  const index = new SegmentIndex();
  for (const c of centerlines) {
    for (let i = 1; i < c.points.length; i++) index.add(c.points[i - 1], c.points[i], c.halfWidth + sidewalkWidthFor(c.highway));
  }
  const rand = mulberry32(1337);
  const inside = (p: LocalPoint) => p[0] > bounds.minX && p[0] < bounds.maxX && p[1] > bounds.minZ && p[1] < bounds.maxZ;
  const free = (p: LocalPoint, margin: number) =>
    inside(p) && index.clear(p, margin) && avoid.every((o) => Math.hypot(o.x - p[0], o.z - p[1]) > o.r);

  const trees: DecorationInstance[] = [];
  const lamps: DecorationInstance[] = [];
  const seen = new Set<string>();
  const push = (list: DecorationInstance[], p: LocalPoint, rotation: number, variant: number) => {
    const k = `${Math.round(p[0] / 4)},${Math.round(p[1] / 4)}`;
    if (seen.has(k)) return;
    seen.add(k);
    list.push({ x: p[0], z: p[1], rotation, scale: 0.8 + rand() * 0.5, variant });
  };

  for (const p of extraTrees) if (inside(p)) push(trees, p, rand() * Math.PI * 2, 0);

  for (const c of centerlines) {
    const sw = sidewalkWidthFor(c.highway);
    const major = ['primary', 'secondary', 'tertiary', 'trunk'].includes(c.highway);
    if (major) {
      for (const side of [1, -1]) {
        for (const s of samplesAlong(c.points, 32, side * (c.halfWidth + 0.6), side > 0 ? 8 : 24)) {
          lamps.push({ x: s.point[0], z: s.point[1], rotation: s.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2), scale: 1, variant: 0 });
        }
      }
    }
    if (['footway', 'path', 'steps', 'construction'].includes(c.highway)) continue;
    const spacing = major ? 14 : c.highway === 'service' ? 26 : 18;
    for (const side of [1, -1]) {
      const offset = side * (c.halfWidth + sw + 2.2);
      for (const s of samplesAlong(c.points, spacing, offset, rand() * spacing)) {
        if (trees.length >= maxTrees) break;
        if (rand() < 0.25) continue; // organic gaps
        const jitter: LocalPoint = [s.point[0] + (rand() - 0.5) * 1.5, s.point[1] + (rand() - 0.5) * 1.5];
        if (free(jitter, 1.6)) push(trees, jitter, rand() * Math.PI * 2, rand() < 0.3 ? 1 : 0);
      }
    }
  }
  return { trees, lamps };
}
