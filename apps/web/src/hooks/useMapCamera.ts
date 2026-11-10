'use client';
import { useMapStore } from '@/features/map/store';
export function useMapCamera() {
  const command = useMapStore((s) => s.command);
  return {
    flyTo: (target: [number, number], zoom?: number) => command({ type: 'fly', target, zoom }),
    reset: () => command({ type: 'reset' }),
    zoomBy: (factor: number) => command({ type: 'zoom', factor }),
    rotate: (angle: number) => command({ type: 'rotate', angle }),
  };
}
