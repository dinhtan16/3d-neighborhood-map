import rules from '../rules.json';

export type HighwayClass = keyof typeof rules.roadWidthsM;

export interface CategoryDefinition {
  slug: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
}

export const MAP_RULES = rules;

export const BUILDING_HEIGHT = rules.buildingHeight;
export const ROAD_WIDTHS_M: Record<string, number> = rules.roadWidthsM;
export const SIDEWALK_WIDTHS_M: Record<string, number> = rules.sidewalkWidthM;
export const ROADS_WITH_CENTER_LINE: readonly string[] = rules.roadsWithCenterLine;
export const RENDERED_HIGHWAYS: readonly string[] = rules.renderedHighways;
export const CATEGORIES: readonly CategoryDefinition[] = rules.categories;
export const BUILDING_STYLES: readonly string[] = rules.buildingStyles;
export const LIMITS = rules.limits;

export function roadWidthFor(highway: string | undefined): number {
  return (highway && ROAD_WIDTHS_M[highway]) || ROAD_WIDTHS_M.default;
}

export function sidewalkWidthFor(highway: string | undefined): number {
  if (!highway) return SIDEWALK_WIDTHS_M.default;
  return SIDEWALK_WIDTHS_M[highway] ?? SIDEWALK_WIDTHS_M.default;
}

export function categoryColor(slug: string | undefined | null): string {
  return CATEGORIES.find((c) => c.slug === slug)?.color ?? '#8a7f72';
}

/** Illustrated art direction palette (coral, beige, green, pastel). */
export const PALETTE = {
  background: '#f4e9d8',
  ground: '#efe2cc',
  grass: '#a8cf8e',
  grassDark: '#86b56d',
  road: '#8c8a93',
  roadService: '#a7a4ab',
  footway: '#e0cfb4',
  sidewalk: '#e9dcc6',
  curb: '#cdbca0',
  marking: '#fbf6ea',
  outline: '#3b2a20',
  water: '#8ec9de',
  highlight: '#ffd166',
  selected: '#ff8a5b',
} as const;

export const BUILDING_STYLE_COLORS: Record<string, { wall: string; roof: string; trim: string }> = {
  'residential-coral': { wall: '#f08a6c', roof: '#c9604a', trim: '#fde7d4' },
  'residential-cream': { wall: '#f6e3c3', roof: '#d9a86c', trim: '#fff6e6' },
  'residential-mint': { wall: '#b9dfc8', roof: '#6fa98a', trim: '#f2fbf5' },
  'residential-peach': { wall: '#f9c59d', roof: '#e08e5c', trim: '#fff1e3' },
  'shophouse-terracotta': { wall: '#e9a07a', roof: '#b45f3f', trim: '#fbe3cf' },
  'civic-sand': { wall: '#e8d6a8', roof: '#b9a06c', trim: '#fffaf0' },
};

/** Default orthographic camera settings – calibrate against neighborhood size. */
export const CAMERA_CONFIG = {
  type: 'orthographic' as const,
  position: [150, 180, 150] as [number, number, number],
  zoom: 4.5,
  minZoom: 0.8,
  maxZoom: 8,
  minPolarAngle: 0.45,
  maxPolarAngle: 1.05,
  flyToZoom: 7,
};
