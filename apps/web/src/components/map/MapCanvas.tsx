'use client';
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { CAMERA_CONFIG, FPS_CONFIG, STYLE_V2, TOWNS } from '@nmap/map-config';
import type { MapAreaDto } from '@nmap/map-contracts';
import { projectorForArea } from '@/lib/geo/projection';
import { areaLocalBounds } from '@/lib/geo/coordinates';
import { useMapStore } from '@/features/map/store';
import { ChunkedWorld, worldFocus } from './ChunkedWorld';
import { MapCamera } from './MapCamera';
import { FirstPersonController } from './FirstPersonController';
import { OutlinePass } from './OutlinePass';
import { AgentsLayer } from './AgentsLayer';
import { HoverManager } from './interaction/HoverManager';
import { ObjectPicker } from './interaction/ObjectPicker';

export interface MapCanvasProps {
  area: MapAreaDto;
  mode?: 'iso' | 'fps';
  showObjects?: boolean;
  showPins?: boolean;
  outlines?: boolean;
  /** Animated pedestrians, scooters, cars and dogs. */
  agents?: boolean;
  onGroundClick?: (point: [number, number]) => void;
  children?: React.ReactNode;
}

/** WebGL map canvas (client-only). Streams chunks around the active camera rig. */
export default function MapCanvas({ area, mode = 'iso', showObjects = true, showPins = true, outlines = true, agents = true, onGroundClick, children }: MapCanvasProps) {
  const projector = useMemo(() => projectorForArea(area), [area]);
  const bounds = useMemo(() => areaLocalBounds(projector, area), [projector, area]);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const selectBuilding = useMapStore((s) => s.selectBuilding);

  // First mount: start in Chơn Thành centre.
  const home = useMemo<[number, number]>(() => {
    if (worldFocus.x === 0 && worldFocus.z === 0) {
      const t = TOWNS[0];
      const [x, z] = projector.toLocal(t.lng, t.lat);
      worldFocus.x = x; worldFocus.z = z;
    }
    return [worldFocus.x, worldFocus.z];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projector, mode]);

  return (
    <Canvas
      frameloop="demand"
      flat
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      onPointerMissed={() => { if (!onGroundClick) { selectPlace(null); selectBuilding(null); } }}
      style={{ background: STYLE_V2.sky, touchAction: 'none' }}
    >
      <color attach="background" args={[STYLE_V2.sky]} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-200, 400, 150]} intensity={1.2} />
      {mode === 'iso' ? (
        <>
          <OrthographicCamera makeDefault position={[home[0] + CAMERA_CONFIG.position[0], CAMERA_CONFIG.position[1], home[1] + CAMERA_CONFIG.position[2]]} zoom={CAMERA_CONFIG.zoom} near={-3000} far={6000} />
          <MapCamera bounds={bounds} home={home} />
        </>
      ) : (
        <>
          <PerspectiveCamera makeDefault fov={FPS_CONFIG.fov} near={0.3} far={900} position={[home[0], FPS_CONFIG.eyeHeightM, home[1]]} />
          <FirstPersonController area={area} />
        </>
      )}
      <Suspense fallback={null}>
        <ChunkedWorld area={area} showObjects={showObjects} showPins={showPins && mode === 'iso'} interactive={mode === 'iso'} onGroundClick={onGroundClick ?? (() => { selectPlace(null); selectBuilding(null); })} />
        {agents && <AgentsLayer scale={mode === 'iso' ? 2.3 : 1} density={mode === 'iso' ? 1 : 0.8} />}
        {children}
      </Suspense>
      <OutlinePass enabled={outlines} />
      <HoverManager />
      {mode === 'iso' && <ObjectPicker />}
    </Canvas>
  );
}

export { THREE };
