import { create } from 'zustand';

export interface HoverInfo {
  id: string;
  kind: 'place' | 'object' | 'building';
  label: string;
  sublabel?: string;
  position: [number, number, number];
}

export type CameraCommand =
  | { type: 'fly'; target: [number, number]; zoom?: number; nonce: number }
  | { type: 'reset'; nonce: number }
  | { type: 'zoom'; factor: number; nonce: number }
  | { type: 'rotate'; angle: number; nonce: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CameraCommandInput = DistributiveOmit<CameraCommand, 'nonce'>;

interface MapState {
  selectedPlaceId: string | null;
  selectedBuildingId: string | null;
  selectedBuildingInfo: { name: string | null; levels: number | null; height: number; source?: string } | null;
  hover: HoverInfo | null;
  /** Category slugs currently hidden (empty = show all). */
  hiddenCategories: string[];
  cameraCommand: CameraCommand | null;
  selectPlace: (id: string | null, opts?: { fly?: boolean }) => void;
  selectBuilding: (id: string | null, info?: MapState['selectedBuildingInfo']) => void;
  setHover: (h: HoverInfo | null) => void;
  toggleCategory: (slug: string) => void;
  showOnlyCategory: (slug: string | null) => void;
  command: (c: CameraCommandInput) => void;
  pendingFly: boolean;
  consumeFly: () => void;
}

let nonce = 0;
export const useMapStore = create<MapState>((set) => ({
  selectedPlaceId: null,
  selectedBuildingId: null,
  selectedBuildingInfo: null,
  hover: null,
  hiddenCategories: [],
  cameraCommand: null,
  pendingFly: false,
  selectPlace: (id, opts) => set({ selectedPlaceId: id, selectedBuildingId: null, selectedBuildingInfo: null, pendingFly: !!(id && opts?.fly) }),
  selectBuilding: (id, info) => set({ selectedBuildingId: id, selectedBuildingInfo: id ? info ?? null : null }),
  setHover: (hover) => set((s) => (s.hover?.id === hover?.id ? s : { hover })),
  toggleCategory: (slug) =>
    set((s) => ({
      hiddenCategories: s.hiddenCategories.includes(slug)
        ? s.hiddenCategories.filter((c) => c !== slug)
        : [...s.hiddenCategories, slug],
    })),
  showOnlyCategory: (slug) => set(() => ({ hiddenCategories: slug ? ['__only__', slug] : [] })),
  command: (c) => set({ cameraCommand: { ...c, nonce: ++nonce } as CameraCommand }),
  consumeFly: () => set({ pendingFly: false }),
}));

/** Whether a category is visible under the current filter. */
export function isCategoryVisible(hidden: string[], slug: string | null | undefined): boolean {
  if (hidden[0] === '__only__') return slug === hidden[1];
  return !hidden.includes(slug ?? 'other');
}
