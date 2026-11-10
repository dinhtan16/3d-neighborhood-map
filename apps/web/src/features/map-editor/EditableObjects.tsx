'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import type { MapAreaDto, MapObjectDto } from '@nmap/map-contracts';
import { objectTransform } from '@nmap/geo-core';
import { projectorForArea } from '@/lib/geo/projection';
import { AssetInstance } from '@/components/map/objects/AssetInstance';
import { SelectionRing } from '@/components/map/interaction/SelectionManager';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

interface Props {
  area: MapAreaDto;
  objects: MapObjectDto[];
  selectedId: string | null;
  mode: GizmoMode;
  preview: boolean;
  onSelect: (id: string) => void;
  /** Called when a gizmo drag ends with the new world transform. */
  onTransformEnd: (id: string, t: { x: number; y: number; z: number; rotationY: number; scale: THREE.Vector3 }) => void;
}

export function EditableObjects({ area, objects, selectedId, mode, preview, onSelect, onTransformEnd }: Props) {
  const projector = projectorForArea(area);
  const [target, setTarget] = useState<THREE.Group | null>(null);
  const refs = useRef(new Map<string, THREE.Group>());

  useEffect(() => { setTarget(selectedId ? refs.current.get(selectedId) ?? null : null); }, [selectedId, objects]);

  const visible = preview ? objects.filter((o) => o.status === 'published') : objects;

  return (
    <group>
      {visible.map((o) => {
        const t = objectTransform(projector, o.position, o.elevationM, o.rotation, o.scale);
        return (
          <group key={`${o.id}:${o.position.lat}:${o.position.lng}:${o.rotation}:${o.elevationM}:${o.scale.x}:${o.scale.y}:${o.scale.z}`}>
            <AssetInstance
              ref={(g) => { if (g) refs.current.set(o.id, g); else refs.current.delete(o.id); }}
              url={o.modelUrl}
              position={t.position}
              rotationY={t.rotationY}
              scale={t.scale}
              onClick={(e) => { if (preview || e.delta > 4) return; e.stopPropagation(); onSelect(o.id); }}
            />
            {!preview && o.status === 'draft' && <SelectionRing position={[t.position[0], t.position[2]]} kind="hover" radius={0.9} />}
            {!preview && o.id === selectedId && <SelectionRing position={[t.position[0], t.position[2]]} radius={1.1} />}
          </group>
        );
      })}
      {!preview && target && selectedId && (
        <TransformControls
          object={target}
          mode={mode}
          showY={mode !== 'translate'}
          showX={mode !== 'rotate'}
          showZ={mode !== 'rotate'}
          size={0.9}
          onMouseUp={() => {
            const g = target;
            onTransformEnd(selectedId, { x: g.position.x, y: g.position.y, z: g.position.z, rotationY: g.rotation.y, scale: g.scale.clone() });
          }}
        />
      )}
    </group>
  );
}
