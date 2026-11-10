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
  minZoom: 1.2,
  maxZoom: 16,
  minPolarAngle: 0.45,
  maxPolarAngle: 1.05,
  flyToZoom: 7,
};

// ---------------------------------------------------------------------------
// Region + chunk streaming (v2): Chơn Thành – Minh Hưng – Bình Long corridor.
// ---------------------------------------------------------------------------

/** Default area loaded by the web app. */
export const DEFAULT_AREA_SLUG = 'chon-thanh-binh-long';

/**
 * Chunk grid: square cells of CHUNK_SIZE_M metres in the area's local metric
 * frame (projected CRS minus area origin). Chunk (cx, cz) covers
 *   x ∈ [cx·S, (cx+1)·S)   (east)
 *   z ∈ [cz·S, (cz+1)·S)   (z = −north)
 * Buildings / places / objects belong to the chunk containing their
 * centroid / point (no duplicates); roads and areas are returned by every
 * chunk they intersect.
 */
export const CHUNK_SIZE_M = 500;
/** Static demo bundles chunks into packs of PACK_SPAN × PACK_SPAN chunks. */
export const PACK_SPAN = 4;

export const CHUNK_LOAD = {
  /** Iso view: radius (m) around the camera target, scaled by 1/zoom. */
  isoBaseRadiusM: 700,
  /** First-person: load radius around the player (m). */
  fpsRadiusM: 650,
  /** Unload chunks farther than radius × this factor. */
  unloadFactor: 1.6,
  maxConcurrentRequests: 4,
  maxCachedChunks: 64,
};

export interface TownDefinition { slug: string; name: string; lat: number; lng: number }
/** Teleport destinations (town centres). */
export const TOWNS: readonly TownDefinition[] = [
  { slug: 'chon-thanh', name: 'Chơn Thành', lat: 11.4225, lng: 106.6090 },
  { slug: 'minh-hung', name: 'Minh Hưng', lat: 11.4880, lng: 106.6145 },
  { slug: 'binh-long', name: 'Bình Long (An Lộc)', lat: 11.6533, lng: 106.6064 },
];

/** First-person controller tuning. */
export const FPS_CONFIG = {
  eyeHeightM: 1.65,
  walkSpeed: 4.5,
  runSpeed: 14,
  /** "Scooter" speed (hold Shift+Ctrl / double-tap run) – ~60 km/h. */
  rideSpeed: 17,
  fov: 70,
  playerRadiusM: 0.35,
};

/**
 * Illustrated v2 palette – thick dark outlines, flat saturated colours,
 * mauve roads, grey-violet tiled sidewalks, pink brick plazas, terracotta houses.
 */
export const STYLE_V2 = {
  outline: '#2b1f2e',
  sky: '#f6e7d2',
  grass: '#86c766',
  grassDark: '#5fa64e',
  ground: '#d9c9b5',
  road: '#c27ea4',
  roadService: '#cf98b5',
  roadLine: '#fbf3f6',
  sidewalk: '#ab9ba6',
  sidewalkLine: '#8f7f8b',
  brick: '#e98aa3',
  brickLine: '#c96b85',
  curb: '#8c7b89',
  footway: '#e3b8a6',
  water: '#79bfd9',
  window: '#8cc4e0',
  windowFrame: '#f7e3c8',
  wallColors: ['#e2634a', '#ef7b5b', '#f4d2a6', '#f2b84b', '#ef9aa0', '#5fae9c', '#e9876a', '#f3c79a'],
  roofColors: ['#c24f42', '#a8473f', '#d9a35a', '#7c6b8a', '#b65b4b'],
  awningColors: ['#49b35a', '#f2a341', '#e4513f', '#2f8f9d', '#f4c542'],
  highlight: '#ffd166',
  selected: '#ff6f59',
} as const;
