'use client';
import { useMapStore } from '@/features/map/store';
export function useSelectedPlace() {
  const id = useMapStore((s) => s.selectedPlaceId);
  const select = useMapStore((s) => s.selectPlace);
  return { selectedPlaceId: id, selectPlace: select };
}
