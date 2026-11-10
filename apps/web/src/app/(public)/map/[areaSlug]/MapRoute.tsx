'use client';
import dynamic from 'next/dynamic';
import { MapPage } from '@/features/map/MapPage';
import { MapLoading } from '@/components/map/MapLoading';

// Three.js needs a browser environment.
const MapCanvas = dynamic(() => import('@/components/map/MapCanvas'), { ssr: false, loading: () => <MapLoading /> });

export function MapRoute({ areaSlug }: { areaSlug: string }) {
  return <MapPage areaSlug={areaSlug} Canvas={MapCanvas} />;
}
