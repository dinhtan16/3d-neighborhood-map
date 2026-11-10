'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { MapAreaDto } from '@nmap/map-contracts';
import { CHUNK_LOAD, CHUNK_SIZE_M, STYLE_V2 } from '@nmap/map-config';
import { projectorForArea } from '@/lib/geo/projection';
import { areaLocalBounds } from '@/lib/geo/coordinates';
import { buildChunk, type ChunkBuild } from '@/lib/three/chunk-builder';
import { pavingMaterial } from '@/lib/three/style-materials';
import { ChunkCache, chunksAround, rangeFromLocalBounds } from '@/features/map/chunks';
import { fetchChunk } from '@/lib/api/client';
import { useWorldStatus } from '@/features/map/world-status';
import { ChunkView } from './ChunkView';

/** Shared mutable focus (written by the camera rigs every frame, read here). */
export const worldFocus = { x: 0, z: 0, radius: CHUNK_LOAD.isoBaseRadiusM };

interface Props {
  area: MapAreaDto;
  interactive?: boolean;
  showObjects?: boolean;
  showPins?: boolean;
  onGroundClick?: (p: [number, number]) => void;
}

/**
 * Streams 500 m chunks around the focus point:
 *  - fetches (deduped, LRU-cached, max 4 concurrent requests)
 *  - builds at most one chunk per frame to avoid frame spikes
 *  - unmounts + disposes chunks beyond radius × unloadFactor
 */
export function ChunkedWorld({ area, interactive = true, showObjects = true, showPins = true, onGroundClick }: Props) {
  const projector = useMemo(() => projectorForArea(area), [area]);
  const bounds = useMemo(() => areaLocalBounds(projector, area), [projector, area]);
  const range = useMemo(() => rangeFromLocalBounds(bounds), [bounds]);
  const cache = useMemo(() => new ChunkCache((cx, cz) => fetchChunk(area, cx, cz), CHUNK_LOAD.maxCachedChunks * 2, CHUNK_LOAD.maxConcurrentRequests), [area]);
  const [builds, setBuilds] = useState<Map<string, ChunkBuild>>(new Map());
  const ready = useRef(new Map<string, import('@nmap/map-contracts').MapChunkDto>());
  const wanted = useRef(new Set<string>());
  const lastCheck = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const setStatus = useWorldStatus((s) => s.set);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (now - lastCheck.current > 0.25) {
      lastCheck.current = now;
      const list = chunksAround(worldFocus.x, worldFocus.z, worldFocus.radius, range);
      wanted.current = new Set(list.map((c) => c.key));
      for (const c of list) {
        if (ready.current.has(c.key) || builds.has(c.key)) continue;
        cache.load(c.cx, c.cz).then((d) => { if (wanted.current.has(c.key)) { ready.current.set(c.key, d); invalidate(); } }).catch((e) => setStatus({ error: String(e.message ?? e) }));
      }
      // unload far chunks
      const keep = new Set(chunksAround(worldFocus.x, worldFocus.z, worldFocus.radius * CHUNK_LOAD.unloadFactor, range).map((c) => c.key));
      let changed = false;
      const next = new Map(builds);
      for (const k of next.keys()) if (!keep.has(k)) { next.delete(k); changed = true; }
      for (const k of ready.current.keys()) if (!keep.has(k)) ready.current.delete(k);
      if (changed) setBuilds(next);
      setStatus({ loaded: builds.size, wanted: list.length, pending: ready.current.size });
    }
    // build one ready chunk per frame (nearest first)
    if (ready.current.size) {
      let bestKey: string | null = null, bestD = Infinity;
      for (const k of ready.current.keys()) {
        const [cx, cz] = k.split('_').map(Number);
        const d = Math.hypot((cx + 0.5) * CHUNK_SIZE_M - worldFocus.x, (cz + 0.5) * CHUNK_SIZE_M - worldFocus.z);
        if (d < bestD) { bestD = d; bestKey = k; }
      }
      if (bestKey) {
        const data = ready.current.get(bestKey)!;
        ready.current.delete(bestKey);
        const b = buildChunk(data, projector);
        setBuilds((prev) => new Map(prev).set(bestKey!, b));
        invalidate();
      }
    }
  });

  useEffect(() => { setBuilds(new Map()); ready.current.clear(); }, [area]);

  const w = bounds.maxX - bounds.minX, d = bounds.maxZ - bounds.minZ;
  return (
    <group>
      {/* region ground (grass) */}
      <mesh
        rotation-x={-Math.PI / 2}
        // 8 cm below every ground layer and subdivided: a single km-sized triangle loses
        // depth precision after clipping and flickers through the paving above it.
        position={[(bounds.minX + bounds.maxX) / 2, -0.08, (bounds.minZ + bounds.maxZ) / 2]}
        material={pavingMaterial(STYLE_V2.grass, STYLE_V2.grassDark, 3)}
        onClick={(e) => {
          if (e.delta > 4) return;
          onGroundClick?.([e.point.x, e.point.z]);
        }}
      >
        <planeGeometry args={[w + 2000, d + 2000, Math.ceil((w + 2000) / 250), Math.ceil((d + 2000) / 250)]} />
      </mesh>
      {[...builds.values()].map((b) => (
        <ChunkView key={b.key} build={b} interactive={interactive} showObjects={showObjects} showPins={showPins} />
      ))}
    </group>
  );
}
