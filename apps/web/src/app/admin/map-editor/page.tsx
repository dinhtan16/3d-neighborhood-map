'use client';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AdminShell } from '@/features/places/AdminShell';
import { MapEditor } from '@/features/map-editor/MapEditor';
import { MapLoading } from '@/components/map/MapLoading';

const MapCanvas = dynamic(() => import('@/components/map/MapCanvas'), { ssr: false, loading: () => <MapLoading /> });

function Editor() {
  const params = useSearchParams();
  return <MapEditor Canvas={MapCanvas} initialPlaceId={params.get('place')} />;
}

export default function Page() {
  return (
    <AdminShell active="/admin/map-editor">
      <Suspense fallback={<MapLoading />}><Editor /></Suspense>
    </AdminShell>
  );
}
