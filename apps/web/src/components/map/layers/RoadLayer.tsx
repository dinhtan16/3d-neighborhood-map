'use client';
import { useEffect } from 'react';
import { PALETTE } from '@nmap/map-config';
import type { RoadGeometrySet } from '@/lib/three/geometries';
import { flatMaterial } from '@/lib/three/materials';
import { disposeGeometries } from '@/lib/three/scene-utils';

/** All roads of a class are merged into one draw call. */
export function RoadLayer({ roads }: { roads: RoadGeometrySet }) {
  useEffect(() => () => disposeGeometries([roads.road, roads.service, roads.foot, roads.sidewalk, roads.curb, roads.marking]), [roads]);
  const layers: [keyof RoadGeometrySet, string][] = [
    ['foot', PALETTE.footway],
    ['sidewalk', PALETTE.sidewalk],
    ['curb', PALETTE.curb],
    ['service', PALETTE.roadService],
    ['road', PALETTE.road],
    ['marking', PALETTE.marking],
  ];
  return (
    <group>
      {layers.map(([key, color]) => {
        const g = roads[key] as THREE.BufferGeometry | null;
        return g ? <mesh key={key} geometry={g} material={flatMaterial(color)} receiveShadow /> : null;
      })}
    </group>
  );
}

import type * as THREE from 'three';
