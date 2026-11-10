'use client';
import { useMemo } from 'react';
import * as THREE from 'three';
import { PALETTE } from '@nmap/map-config';

const ringGeo = new THREE.RingGeometry(5.2, 6.4, 40).rotateX(-Math.PI / 2);
const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.selected, transparent: true, opacity: 0.9, depthWrite: false });
const hoverMat = new THREE.MeshBasicMaterial({ color: PALETTE.highlight, transparent: true, opacity: 0.85, depthWrite: false });

/** Ground ring under the selected / hovered object. */
export function SelectionRing({ position, kind = 'selected', radius = 1 }: { position: [number, number]; kind?: 'selected' | 'hover'; radius?: number }) {
  const scale = useMemo(() => [radius, 1, radius] as [number, number, number], [radius]);
  return (
    <mesh geometry={ringGeo} material={kind === 'selected' ? ringMat : hoverMat} position={[position[0], 0.2, position[1]]} scale={scale} renderOrder={2} raycast={() => null} />
  );
}
