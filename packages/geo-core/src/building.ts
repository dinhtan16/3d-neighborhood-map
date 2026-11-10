import { BUILDING_HEIGHT, BUILDING_STYLES } from '@nmap/map-config';

/** Parse OSM length values such as "12", "12.5 m", "40'" (feet). Returns meters or null. */
export function parseLengthM(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const s = String(value).trim().toLowerCase().replace(',', '.');
  const feet = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)$/.exec(s);
  if (feet) return Number(feet[1]) * 0.3048;
  const m = /^(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?$/.exec(s);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

export function parseLevels(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Math.round(Number(String(value).replace(',', '.')));
  return Number.isFinite(n) && n > 0 && n < 200 ? n : null;
}

/**
 * Height policy:
 *  1. Actual `height` tag wins.
 *  2. Else `building:levels` * floor height (3.5 m per floor).
 *  3. Else configurable default (6 m).
 */
export function resolveBuildingHeight(input: { height?: unknown; levels?: unknown }): {
  heightM: number;
  levels: number | null;
  estimated: boolean;
} {
  const { floorHeightM, unknownDefaultM, minHeightM, maxHeightM } = BUILDING_HEIGHT;
  const levels = parseLevels(input.levels);
  const actual = parseLengthM(input.height);
  const clamp = (h: number) => Math.min(maxHeightM, Math.max(minHeightM, h));
  if (actual !== null) return { heightM: clamp(actual), levels, estimated: false };
  if (levels !== null) return { heightM: clamp(levels * floorHeightM), levels, estimated: true };
  return { heightM: unknownDefaultM, levels: null, estimated: true };
}

/** FNV-1a 32-bit – deterministic across TS and Python (see map-importer/normalize.py). */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function defaultStyleKey(seed: string, buildingType?: string | null): string {
  if (buildingType && ['school', 'public', 'civic', 'government', 'hospital', 'university'].includes(buildingType)) {
    return 'civic-sand';
  }
  if (buildingType && ['commercial', 'retail', 'shop'].includes(buildingType)) return 'shophouse-terracotta';
  const residential = BUILDING_STYLES.filter((s) => s.startsWith('residential') || s.startsWith('shophouse'));
  return residential[fnv1a(seed) % residential.length];
}
