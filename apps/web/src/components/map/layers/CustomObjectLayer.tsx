'use client';
import { memo } from 'react';
import type { MapObjectDto } from '@nmap/map-contracts';
import type { ObjectTransform } from '@nmap/geo-core';
import { AssetInstance } from '../objects/AssetInstance';
import { SelectionRing } from '../interaction/SelectionManager';
import { useMapStore } from '@/features/map/store';

export interface PlacedObject { object: MapObjectDto; transform: ObjectTransform; label?: string }

/** Custom GLB objects (shops, stalls, furniture) positioned from geographic coordinates. */
export const CustomObjectLayer = memo(function CustomObjectLayer({ objects }: { objects: PlacedObject[] }) {
  const selectedId = useMapStore((s) => s.selectedPlaceId);
  const hoverId = useMapStore((s) => s.hover?.id);
  const setHover = useMapStore((s) => s.setHover);
  const selectPlace = useMapStore((s) => s.selectPlace);

  return (
    <group>
      {objects.map(({ object, transform, label }) => {
        const placeId = object.placeId;
        const pos = transform.position;
        const selected = !!placeId && placeId === selectedId;
        const hovered = !!placeId && placeId === hoverId;
        return (
          <group key={object.id}>
            <AssetInstance
              url={object.modelUrl}
              position={pos}
              rotationY={transform.rotationY}
              scale={transform.scale}
              onPointerOver={placeId ? (e) => {
                e.stopPropagation();
                setHover({ id: placeId, kind: 'object', label: label ?? object.assetKey, position: [pos[0], pos[1] + 10, pos[2]] });
              } : undefined}
              onPointerOut={placeId ? () => setHover(null) : undefined}
              onClick={placeId ? (e) => {
                if (e.delta > 4) return;
                e.stopPropagation();
                selectPlace(placeId);
              } : undefined}
            />
            {(selected || hovered) && <SelectionRing position={[pos[0], pos[2]]} kind={selected ? 'selected' : 'hover'} radius={1.1} />}
          </group>
        );
      })}
    </group>
  );
});
