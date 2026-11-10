import { CHUNK_SIZE_M } from '@nmap/map-config';
import type { MapChunkDto } from '@nmap/map-contracts';

export const chunkKey = (cx: number, cz: number) => `${cx}_${cz}`;
export const chunkOf = (x: number, z: number, size = CHUNK_SIZE_M): [number, number] => [Math.floor(x / size), Math.floor(z / size)];

export interface ChunkRange { minCx: number; maxCx: number; minCz: number; maxCz: number }

export function rangeFromLocalBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }, size = CHUNK_SIZE_M): ChunkRange {
  return { minCx: Math.floor(b.minX / size), maxCx: Math.floor((b.maxX - 1e-6) / size), minCz: Math.floor(b.minZ / size), maxCz: Math.floor((b.maxZ - 1e-6) / size) };
}

/** Chunk keys within `radius` metres of (x, z), nearest first, clipped to the area's range. */
export function chunksAround(x: number, z: number, radius: number, range: ChunkRange, size = CHUNK_SIZE_M): { key: string; cx: number; cz: number; d: number }[] {
  const out: { key: string; cx: number; cz: number; d: number }[] = [];
  const [c0x, c0z] = chunkOf(x - radius, z - radius, size);
  const [c1x, c1z] = chunkOf(x + radius, z + radius, size);
  for (let cx = Math.max(c0x, range.minCx); cx <= Math.min(c1x, range.maxCx); cx++) {
    for (let cz = Math.max(c0z, range.minCz); cz <= Math.min(c1z, range.maxCz); cz++) {
      // distance from point to chunk rectangle
      const dx = Math.max(cx * size - x, 0, x - (cx + 1) * size);
      const dz = Math.max(cz * size - z, 0, z - (cz + 1) * size);
      const d = Math.hypot(dx, dz);
      if (d <= radius) out.push({ key: chunkKey(cx, cz), cx, cz, d });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Small LRU cache + request de-duplication + concurrency limit. */
export class ChunkCache {
  private data = new Map<string, MapChunkDto>();
  private inflight = new Map<string, Promise<MapChunkDto>>();
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private fetcher: (cx: number, cz: number) => Promise<MapChunkDto>, private max = 96, private concurrency = 4) {}

  peek(key: string) {
    const v = this.data.get(key);
    if (v) { this.data.delete(key); this.data.set(key, v); }
    return v;
  }

  load(cx: number, cz: number): Promise<MapChunkDto> {
    const key = chunkKey(cx, cz);
    const hit = this.peek(key);
    if (hit) return Promise.resolve(hit);
    let p = this.inflight.get(key);
    if (p) return p;
    p = new Promise<MapChunkDto>((resolve, reject) => {
      const run = () => {
        this.active++;
        this.fetcher(cx, cz)
          .then((c) => {
            this.data.set(key, c);
            while (this.data.size > this.max) this.data.delete(this.data.keys().next().value!);
            resolve(c);
          })
          .catch(reject)
          .finally(() => {
            this.active--;
            this.inflight.delete(key);
            this.queue.shift()?.();
          });
      };
      if (this.active < this.concurrency) run(); else this.queue.push(run);
    });
    this.inflight.set(key, p);
    return p;
  }
}
