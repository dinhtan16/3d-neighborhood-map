import { CHUNK_SIZE_M } from '@nmap/map-config';

/**
 * Chunk grid (see packages/map-config CHUNK_SIZE_M):
 *   chunk (cx, cz) covers local x ∈ [cx·S, (cx+1)·S), z ∈ [cz·S, (cz+1)·S)
 *   where x = easting − originE and z = −(northing − originN) in the area CRS.
 * In projected coordinates that is
 *   easting  ∈ [x0, x1)        x0 = originE + cx·S
 *   northing ∈ (nMin, nMax]    nMax = originN − cz·S, nMin = nMax − S
 */
export interface ChunkEnvelope {
  cx: number;
  cz: number;
  sizeM: number;
  srid: number;
  x0: number;
  x1: number;
  nMin: number;
  nMax: number;
  bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number };
}

export interface ChunkRange { minCx: number; maxCx: number; minCz: number; maxCz: number }

export const CHUNK_FEATURE_LIMIT = 25000;
export const CHUNK_OBJECT_LIMIT = 5000;
export const CHUNK_PLACE_LIMIT = 5000;

export function sridOf(crs: string): number {
  const m = /^EPSG:(\d+)$/i.exec(crs.trim());
  if (!m) throw new Error(`Unsupported CRS ${crs}`);
  return Number(m[1]);
}

export const chunkSize = () => CHUNK_SIZE_M;

/** SQL predicate: projected point expression `p` lies inside the half-open chunk ($x0,$x1,$nMin,$nMax). */
export const pointInChunkSql = (p: string, i: { x0: number; x1: number; nMin: number; nMax: number }) =>
  `(ST_X(${p}) >= $${i.x0} AND ST_X(${p}) < $${i.x1} AND ST_Y(${p}) > $${i.nMin} AND ST_Y(${p}) <= $${i.nMax})`;

/** Envelope (4326) CTE for a chunk; params: $x0,$x1,$nMin,$nMax,$srid at the given positions. */
export const chunkEnvCte = (i: { x0: number; x1: number; nMin: number; nMax: number; srid: number }) =>
  `e AS (SELECT ST_Transform(ST_MakeEnvelope($${i.x0}, $${i.nMin}, $${i.x1}, $${i.nMax}, $${i.srid}::int), 4326) AS g)`;
