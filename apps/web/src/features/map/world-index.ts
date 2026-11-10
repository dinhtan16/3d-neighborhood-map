import type { LocalPoint } from '@nmap/shared-types';
import type { PlaceSummaryDto } from '@nmap/map-contracts';
import { pointInRing } from '@nmap/geo-core';
import { create } from 'zustand';

/**
 * Registry of what is currently loaded across all chunks:
 *  - building footprints (first-person collision, hover)
 *  - named road segments ("you are on …" HUD)
 *  - places (sidebar "nearby" list)
 * Chunks register on mount and unregister on unmount.
 */
interface Ring { ring: LocalPoint[]; minX: number; maxX: number; minZ: number; maxZ: number }
interface Road { a: LocalPoint; b: LocalPoint; name: string }

const CELL = 25;
const buildingCells = new Map<string, Ring[]>();
const roadCells = new Map<string, Road[]>();
const chunkBuildings = new Map<string, { key: string; ring: Ring }[]>();
const chunkRoads = new Map<string, { key: string; road: Road }[]>();
const k = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

export function registerChunk(chunk: string, rings: LocalPoint[][], roads: { points: LocalPoint[]; name: string | null }[]) {
  unregisterChunk(chunk);
  const bl: { key: string; ring: Ring }[] = [];
  for (const ring of rings) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const r: Ring = { ring, minX, maxX, minZ, maxZ };
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        let list = buildingCells.get(key);
        if (!list) buildingCells.set(key, (list = []));
        list.push(r);
        bl.push({ key, ring: r });
      }
    }
  }
  chunkBuildings.set(chunk, bl);
  const rl: { key: string; road: Road }[] = [];
  for (const rd of roads) {
    if (!rd.name) continue;
    for (let i = 1; i < rd.points.length; i++) {
      const road: Road = { a: rd.points[i - 1], b: rd.points[i], name: rd.name };
      const keys = new Set([k(road.a[0], road.a[1]), k(road.b[0], road.b[1]), k((road.a[0] + road.b[0]) / 2, (road.a[1] + road.b[1]) / 2)]);
      for (const key of keys) {
        let list = roadCells.get(key);
        if (!list) roadCells.set(key, (list = []));
        list.push(road);
        rl.push({ key, road });
      }
    }
  }
  chunkRoads.set(chunk, rl);
}

export function unregisterChunk(chunk: string) {
  for (const { key, ring } of chunkBuildings.get(chunk) ?? []) {
    const list = buildingCells.get(key);
    if (list) { const i = list.indexOf(ring); if (i >= 0) list.splice(i, 1); if (!list.length) buildingCells.delete(key); }
  }
  chunkBuildings.delete(chunk);
  for (const { key, road } of chunkRoads.get(chunk) ?? []) {
    const list = roadCells.get(key);
    if (list) { const i = list.indexOf(road); if (i >= 0) list.splice(i, 1); if (!list.length) roadCells.delete(key); }
  }
  chunkRoads.delete(chunk);
}

/** True when a circle of radius r at (x, z) overlaps a building footprint. */
export function isBlocked(x: number, z: number, r = 0.35): boolean {
  const list = buildingCells.get(k(x, z));
  if (!list) return false;
  for (const b of list) {
    if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) continue;
    if (pointInRing([x, z], b.ring)) return true;
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (pointInRing([x + ox, z + oz], b.ring)) return true;
  }
  return false;
}

export function nearestRoadName(x: number, z: number, maxDist = 30): string | null {
  let best: { d: number; name: string } | null = null;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (const r of roadCells.get(`${Math.floor(x / CELL) + dx},${Math.floor(z / CELL) + dz}`) ?? []) {
      const d = distSeg([x, z], r.a, r.b);
      if (d < maxDist && (!best || d < best.d)) best = { d, name: r.name };
    }
  }
  return best?.name ?? null;
}

function distSeg(p: LocalPoint, a: LocalPoint, b: LocalPoint) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

// ---------------- loaded places (reactive, for the sidebar) ----------------
interface LoadedPlacesState {
  byChunk: Record<string, { place: PlaceSummaryDto; x: number; z: number }[]>;
  setChunk: (chunk: string, list: { place: PlaceSummaryDto; x: number; z: number }[] | null) => void;
}
export const useLoadedPlaces = create<LoadedPlacesState>((set) => ({
  byChunk: {},
  setChunk: (chunk, list) => set((s) => {
    const next = { ...s.byChunk };
    if (list && list.length) next[chunk] = list; else delete next[chunk];
    return { byChunk: next };
  }),
}));

// ---------------- road lines for agents (ref-counted across chunks) ----------------
export interface RoadLine { id: string; points: LocalPoint[]; highway: string; halfWidth: number; length: number; cx: number; cz: number }
const roadLines = new Map<string, { line: RoadLine; refs: number }>();
const chunkRoadIds = new Map<string, string[]>();

export function registerRoadLines(chunk: string, lines: { id: string; points: LocalPoint[]; highway: string; halfWidth: number }[]) {
  unregisterRoadLines(chunk);
  const ids: string[] = [];
  for (const l of lines) {
    if (l.points.length < 2) continue;
    const e = roadLines.get(l.id);
    if (e) e.refs++;
    else {
      let length = 0, sx = 0, sz = 0;
      for (let i = 1; i < l.points.length; i++) length += Math.hypot(l.points[i][0] - l.points[i - 1][0], l.points[i][1] - l.points[i - 1][1]);
      for (const p of l.points) { sx += p[0]; sz += p[1]; }
      roadLines.set(l.id, { line: { ...l, length, cx: sx / l.points.length, cz: sz / l.points.length }, refs: 1 });
    }
    ids.push(l.id);
  }
  chunkRoadIds.set(chunk, ids);
}

export function unregisterRoadLines(chunk: string) {
  for (const id of chunkRoadIds.get(chunk) ?? []) {
    const e = roadLines.get(id);
    if (e && --e.refs <= 0) roadLines.delete(id);
  }
  chunkRoadIds.delete(chunk);
}

/** Road lines whose midpoint lies within r metres of (x, z). */
export function roadLinesNear(x: number, z: number, r: number, filter?: (l: RoadLine) => boolean): RoadLine[] {
  const out: RoadLine[] = [];
  for (const { line } of roadLines.values()) {
    if (Math.hypot(line.cx - x, line.cz - z) > r + line.length / 2) continue;
    if (filter && !filter(line)) continue;
    out.push(line);
  }
  return out;
}
