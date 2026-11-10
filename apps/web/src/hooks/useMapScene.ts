'use client';
import { useCallback, useEffect, useState } from 'react';
import type { MapAreaDto, MapSceneDto, PlaceCategoryDto } from '@nmap/map-contracts';
import { fetchArea, fetchCategories, fetchScene } from '@/lib/api/client';

/** Loads area metadata, then the scene for the area's bounds (MVP: one small neighbourhood). */
export function useMapScene(areaSlug: string, opts: { includeDrafts?: boolean } = {}) {
  const [area, setArea] = useState<MapAreaDto | null>(null);
  const [scene, setScene] = useState<MapSceneDto | null>(null);
  const [categories, setCategories] = useState<PlaceCategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const a = await fetchArea(areaSlug);
        if (cancelled) return;
        setArea(a);
        const [s, c] = await Promise.all([
          fetchScene(a.id, { minLng: a.bounds.minLng, minLat: a.bounds.minLat, maxLng: a.bounds.maxLng, maxLat: a.bounds.maxLat }, 2, opts.includeDrafts),
          fetchCategories(),
        ]);
        if (cancelled) return;
        setScene(s.data);
        setCategories(c);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [areaSlug, opts.includeDrafts, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { area, scene, categories, error, reload };
}
