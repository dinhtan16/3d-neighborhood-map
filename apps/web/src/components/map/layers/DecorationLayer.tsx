'use client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { DecorationInstance } from '@/lib/three/geometries';
import { toonMaterial } from '@/lib/three/materials';

/**
 * Repeated street decoration (trees, street lights) rendered with InstancedMesh:
 * one draw call per part regardless of instance count.
 */
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0);
const roundCanopyGeo = new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.4, 0);
const tallCanopyGeo = new THREE.ConeGeometry(1.6, 4.2, 7).translate(0, 4.1, 0);
const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.5, 6).translate(0, 2.75, 0);
const armGeo = new THREE.BoxGeometry(0.1, 0.1, 1.2).translate(0, 5.45, 0.55);
const lampGeo = new THREE.BoxGeometry(0.35, 0.18, 0.6).translate(0, 5.35, 1.1);

function Instanced({ items, geometry, material, castShadow = true }: {
  items: DecorationInstance[]; geometry: THREE.BufferGeometry; material: THREE.Material; castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rotation);
      m.compose(new THREE.Vector3(it.x, 0, it.z), q, new THREE.Vector3(it.scale, it.scale, it.scale));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} receiveShadow raycast={() => null} />;
}

export function DecorationLayer({ trees, lamps }: { trees: DecorationInstance[]; lamps: DecorationInstance[] }) {
  const round = useMemo(() => trees.filter((t) => t.variant === 0), [trees]);
  const tall = useMemo(() => trees.filter((t) => t.variant === 1), [trees]);
  return (
    <group>
      <Instanced items={trees} geometry={trunkGeo} material={toonMaterial('#8a5a3c', { key: 'trunk' })} />
      <Instanced items={round} geometry={roundCanopyGeo} material={toonMaterial('#7dbb63', { key: 'canopy' })} />
      <Instanced items={tall} geometry={tallCanopyGeo} material={toonMaterial('#5f9e57', { key: 'canopy2' })} />
      <Instanced items={lamps} geometry={poleGeo} material={toonMaterial('#4d4a52', { key: 'pole' })} />
      <Instanced items={lamps} geometry={armGeo} material={toonMaterial('#4d4a52', { key: 'pole' })} castShadow={false} />
      <Instanced items={lamps} geometry={lampGeo} material={toonMaterial('#ffe9a8', { key: 'lamp' })} castShadow={false} />
    </group>
  );
}
