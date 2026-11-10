'use client';
import type { ThreeEvent } from '@react-three/fiber';
import { PALETTE } from '@nmap/map-config';
import { toonMaterial } from '@/lib/three/materials';

interface Props {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  onGroundClick?: (point: [number, number], e: ThreeEvent<MouseEvent>) => void;
}

export function GroundLayer({ bounds, onGroundClick }: Props) {
  const margin = 400;
  const w = bounds.maxX - bounds.minX + margin * 2;
  const d = bounds.maxZ - bounds.minZ + margin * 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const iw = bounds.maxX - bounds.minX;
  const id = bounds.maxZ - bounds.minZ;
  return (
    <group>
      {/* outer land (outside the area) */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.05, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <primitive object={toonMaterial(PALETTE.grassDark, { key: 'outer' })} attach="material" />
      </mesh>
      {/* neighbourhood ground */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[cx, 0, cz]}
        receiveShadow
        onClick={(e) => {
          if (e.delta > 4) return; // ignore drags
          onGroundClick?.([e.point.x, e.point.z], e);
        }}
      >
        <planeGeometry args={[iw, id]} />
        <primitive object={toonMaterial(PALETTE.ground, { key: 'ground' })} attach="material" />
      </mesh>
    </group>
  );
}
