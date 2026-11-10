'use client';
import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { categoryColor, PALETTE } from '@nmap/map-config';
import type { PlaceSummaryDto } from '@nmap/map-contracts';
import { toonMaterial } from '@/lib/three/materials';
import { useMapStore } from '@/features/map/store';

const headGeo = new THREE.SphereGeometry(1.5, 16, 12);
const tipGeo = new THREE.ConeGeometry(1.05, 2.6, 12).rotateX(Math.PI).translate(0, -1.9, 0);
const dotGeo = new THREE.SphereGeometry(0.6, 10, 8);
const PIN_HEIGHT = 15;

export interface PlacePin { place: PlaceSummaryDto; x: number; z: number }

/** Floating category-coloured pins; their on-screen size stays roughly constant across zoom levels. */
export function PlaceLayer({ pins }: { pins: PlacePin[] }) {
  const group = useRef<THREE.Group>(null);
  const selectedId = useMapStore((s) => s.selectedPlaceId);
  const hoverId = useMapStore((s) => (s.hover?.kind === 'place' || s.hover?.kind === 'object' ? s.hover.id : null));
  const setHover = useMapStore((s) => s.setHover);
  const selectPlace = useMapStore((s) => s.selectPlace);

  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const s = THREE.MathUtils.clamp(7 / (camera as THREE.OrthographicCamera).zoom, 0.9, 5);
    for (const child of g.children) {
      const base = (child.userData.boost as number) ?? 1;
      child.scale.setScalar(s * base);
    }
  });

  return (
    <group ref={group}>
      {pins.map(({ place, x, z }) => {
        const selected = place.id === selectedId;
        const hovered = place.id === hoverId;
        const color = selected ? PALETTE.selected : categoryColor(place.category?.slug);
        return (
          <group
            key={place.id}
            position={[x, PIN_HEIGHT + (selected ? 2 : 0), z]}
            userData={{ boost: selected ? 1.35 : hovered ? 1.15 : 1, placeId: place.id }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover({ id: place.id, kind: 'place', label: place.name, sublabel: place.category?.name, position: [x, PIN_HEIGHT + 5, z] });
            }}
            onPointerOut={() => setHover(null)}
            onClick={(e) => {
              if (e.delta > 4) return;
              e.stopPropagation();
              selectPlace(place.id);
            }}
          >
            <mesh geometry={headGeo} material={toonMaterial(color, { key: 'pin' })} castShadow />
            <mesh geometry={tipGeo} material={toonMaterial(color, { key: 'pin' })} />
            <mesh geometry={dotGeo} position={[0, 0.2, 1.1]} material={toonMaterial('#fffaf0', { key: 'pin-dot' })} />
          </group>
        );
      })}
    </group>
  );
}
