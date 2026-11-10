'use client';
import { useMapStore } from '@/features/map/store';

export function MapToolbar() {
  const command = useMapStore((s) => s.command);
  return (
    <div className="toolbar" role="toolbar" aria-label="Map controls">
      <button title="Zoom in" onClick={() => command({ type: 'zoom', factor: 1.5 })}>+</button>
      <button title="Zoom out" onClick={() => command({ type: 'zoom', factor: 1 / 1.5 })}>−</button>
      <button title="Rotate left" onClick={() => command({ type: 'rotate', angle: Math.PI / 4 })}>⟲</button>
      <button title="Rotate right" onClick={() => command({ type: 'rotate', angle: -Math.PI / 4 })}>⟳</button>
      <button title="Reset view" onClick={() => command({ type: 'reset' })}>⌂</button>
    </div>
  );
}
