import { create } from 'zustand';

interface WorldStatus {
  loaded: number;
  wanted: number;
  pending: number;
  error: string | null;
  mode: 'iso' | 'fps';
  location: { town: string | null; road: string | null; lat: number; lng: number } | null;
  set: (p: Partial<Omit<WorldStatus, 'set'>>) => void;
}

export const useWorldStatus = create<WorldStatus>((set) => ({
  loaded: 0, wanted: 0, pending: 0, error: null, mode: 'iso', location: null,
  set: (p) => set((s) => {
    for (const k of Object.keys(p) as (keyof typeof p)[]) if (s[k] !== p[k]) return p;
    return s;
  }),
}));
