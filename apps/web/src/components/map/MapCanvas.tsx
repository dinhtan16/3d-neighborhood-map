'use client';
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { CAMERA_CONFIG, PALETTE } from '@nmap/map-config';
import type { MapAreaDto, MapSceneDto } from '@nmap/map-contracts';
import { projectorForArea } from '@/lib/geo/projection';
import { areaLocalBounds } from '@/lib/geo/coordinates';
import { useMapStore } from '@/features/map/store';
import { MapScene, type MapSceneProps } from './MapScene';
import { MapCamera } from './MapCamera';
import { HoverManager } from './interaction/HoverManager';
import { ObjectPicker } from './interaction/ObjectPicker';

export interface MapCanvasProps extends Omit<MapSceneProps, 'area' | 'scene'> {
  area: MapAreaDto;
  scene: MapSceneDto;
  controlsEnabled?: boolean;
}

function Lighting({ bounds }: { bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }) {
  const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + 50;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(cx, 0, cz); return o; }, [cx, cz]);
  return (
    <>
      <ambientLight intensity={1.15} color="#fff4e6" />
      <hemisphereLight args={['#fff6e8', '#b9c99a', 0.55]} />
      <primitive object={target} />
      <directionalLight
        position={[cx - 260, 420, cz + 180]}
        target={target}
        intensity={1.9}
        color="#fff1dc"
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.4}
        shadow-radius={4}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={10}
        shadow-camera-far={1600}
      />
    </>
  );
}

/** WebGL map canvas. Must be loaded client-side only (dynamic import, ssr: false). */
export default function MapCanvas({ area, scene, controlsEnabled = true, ...rest }: MapCanvasProps) {
  const projector = useMemo(() => projectorForArea(area), [area]);
  const bounds = useMemo(() => areaLocalBounds(projector, area), [projector, area]);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const selectBuilding = useMapStore((s) => s.selectBuilding);

  // Start over the densest cluster of places (or the area centre).
  const home = useMemo<[number, number]>(() => {
    if (!scene.places.length) return [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];
    const pts = scene.places.map((p) => projector.toLocal(p.location.lng, p.location.lat));
    const best = pts
      .map((p) => ({ p, n: pts.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 150).length }))
      .sort((a, b) => b.n - a.n)[0].p;
    return best;
  }, [scene.places, projector, bounds]);

  return (
    <Canvas
      shadows={{ type: THREE.PCFSoftShadowMap }}
      orthographic
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: CAMERA_CONFIG.position, zoom: CAMERA_CONFIG.zoom, near: -2000, far: 4000 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => { if (!rest.onGroundClick) { selectPlace(null); selectBuilding(null); } }}
      style={{ background: PALETTE.background, touchAction: 'none' }}
    >
      <color attach="background" args={[PALETTE.background]} />
      <Lighting bounds={bounds} />
      <MapCamera bounds={bounds} home={home} enabled={controlsEnabled} />
      <Suspense fallback={null}>
        <MapScene area={area} scene={scene} {...rest} />
      </Suspense>
      <HoverManager />
      <ObjectPicker />
    </Canvas>
  );
}
