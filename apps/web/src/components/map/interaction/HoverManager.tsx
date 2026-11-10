'use client';
import { Html } from '@react-three/drei';
import { useMapStore } from '@/features/map/store';

/** Small tooltip with the hovered object's name. */
export function HoverManager() {
  const hover = useMapStore((s) => s.hover);
  if (!hover) return null;
  return (
    <Html position={hover.position} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className="map-tooltip">
        <strong>{hover.label}</strong>
        {hover.sublabel && <span>{hover.sublabel}</span>}
      </div>
    </Html>
  );
}
