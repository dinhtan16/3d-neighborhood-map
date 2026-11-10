'use client';
import { useEffect, useMemo } from 'react';
import type { Projector } from '@nmap/geo-core';
import type { MapFeature } from '@nmap/map-contracts';
import { PALETTE } from '@nmap/map-config';
import { buildFlatPolygons, LAYER_Y } from '@/lib/three/geometries';
import { flatMaterial } from '@/lib/three/materials';

export function PublicSpaceLayer({ spaces, water, projector }: { spaces: MapFeature[]; water: MapFeature[]; projector: Projector }) {
  const { green, plaza, wet } = useMemo(() => {
    const greenKinds = new Set(['park', 'garden', 'grass', 'recreation_ground', 'pitch', 'playground']);
    const greens = spaces.filter((f) => f.properties.featureType === 'park' || greenKinds.has(f.properties.kind ?? ''));
    const plazas = spaces.filter((f) => !greens.includes(f));
    return {
      green: buildFlatPolygons(greens, projector, LAYER_Y.publicSpace),
      plaza: buildFlatPolygons(plazas, projector, LAYER_Y.publicSpace),
      wet: buildFlatPolygons(water, projector, LAYER_Y.publicSpace),
    };
  }, [spaces, water, projector]);
  useEffect(() => () => { green?.dispose(); plaza?.dispose(); wet?.dispose(); }, [green, plaza, wet]);
  return (
    <group>
      {green && <mesh geometry={green} material={flatMaterial(PALETTE.grass)} receiveShadow />}
      {plaza && <mesh geometry={plaza} material={flatMaterial('#eadbbf')} receiveShadow />}
      {wet && <mesh geometry={wet} material={flatMaterial(PALETTE.water)} />}
    </group>
  );
}
