'use client';
import { useEffect, useState } from 'react';
import type { PlaceSummaryDto } from '@nmap/map-contracts';
import { searchPlaces } from '@/lib/api/client';

export function usePlaceSearch(params: { q?: string; areaId?: string; categoryId?: string; status?: string; limit?: number }, deps: unknown[] = []) {
  const [results, setResults] = useState<PlaceSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchPlaces(params)
        .then((r) => !cancelled && setResults(r))
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q, params.areaId, params.categoryId, params.status, params.limit, ...deps]);
  return { results, loading, error };
}
