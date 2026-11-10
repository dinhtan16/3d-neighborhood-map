'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { CAMERA_CONFIG } from '@nmap/map-config';
import { useMapStore } from '@/features/map/store';
import { CHUNK_LOAD } from '@nmap/map-config';
import { worldFocus } from './ChunkedWorld';

/** Chunk load radius for the iso view: wider when zoomed out. */
function isoRadius(zoom: number) {
  return THREE.MathUtils.clamp(CHUNK_LOAD.isoBaseRadiusM * (4.5 / zoom), 450, 1700);
}

interface Props {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  home: [number, number];
  homeZoom?: number;
  enabled?: boolean;
}

const OFFSET = new THREE.Vector3(...CAMERA_CONFIG.position);

/**
 * Orthographic isometric-style camera + pan/zoom/rotate controls.
 * - left drag: pan, right drag: rotate, wheel / pinch: zoom
 * - target is clamped to the neighbourhood bounds, zoom to [minZoom, maxZoom]
 * - fly-to / reset animations driven by store commands (frameloop="demand" aware)
 */
export function MapCamera({ bounds, home, homeZoom = CAMERA_CONFIG.zoom, enabled = true }: Props) {
  const controls = useRef<MapControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef<null | {
    t: number; dur: number;
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
    fromOffset: THREE.Vector3; toOffset: THREE.Vector3;
    fromZoom: number; toZoom: number;
  }>(null);
  const command = useMapStore((s) => s.cameraCommand);

  // Initial placement.
  useEffect(() => {
    const target = new THREE.Vector3(home[0], 0, home[1]);
    camera.position.copy(target).add(OFFSET);
    camera.zoom = homeZoom;
    camera.updateProjectionMatrix();
    controls.current?.target.copy(target);
    controls.current?.update();
    invalidate();
    // Re-run when drei swaps in the default camera (first render may see the previous one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useEffect(() => {
    const c = controls.current;
    if (!command || !c) return;
    const fromTarget = c.target.clone();
    const fromOffset = camera.position.clone().sub(c.target);
    let toTarget = fromTarget.clone();
    let toOffset = fromOffset.clone();
    let toZoom = camera.zoom;
    if (command.type === 'fly') {
      toTarget = new THREE.Vector3(command.target[0], 0, command.target[1]);
      toZoom = Math.max(camera.zoom, command.zoom ?? CAMERA_CONFIG.flyToZoom);
    } else if (command.type === 'reset') {
      toTarget = new THREE.Vector3(home[0], 0, home[1]);
      toOffset = OFFSET.clone();
      toZoom = homeZoom;
    } else if (command.type === 'zoom') {
      toZoom = THREE.MathUtils.clamp(camera.zoom * command.factor, CAMERA_CONFIG.minZoom, CAMERA_CONFIG.maxZoom);
    } else if (command.type === 'rotate') {
      toOffset = fromOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), command.angle);
    }
    anim.current = { t: 0, dur: 0.7, fromTarget, toTarget, fromOffset, toOffset, fromZoom: camera.zoom, toZoom };
    invalidate();
  }, [command, camera, home, homeZoom, invalidate]);

  useFrame((_, dt) => {
    const c0 = controls.current;
    if (c0) { worldFocus.x = c0.target.x; worldFocus.z = c0.target.z; worldFocus.radius = isoRadius(camera.zoom); }
    const a = anim.current;
    const c = controls.current;
    if (!a || !c) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    const k = 1 - Math.pow(1 - a.t, 3); // easeOutCubic
    c.target.lerpVectors(a.fromTarget, a.toTarget, k);
    // Interpolate offset direction on the horizontal circle to keep a stable height.
    const offset = new THREE.Vector3().lerpVectors(a.fromOffset, a.toOffset, k).setLength(
      THREE.MathUtils.lerp(a.fromOffset.length(), a.toOffset.length(), k),
    );
    camera.position.copy(c.target).add(offset);
    camera.zoom = THREE.MathUtils.lerp(a.fromZoom, a.toZoom, k);
    camera.updateProjectionMatrix();
    c.update();
    if (a.t >= 1) anim.current = null;
    invalidate();
  });

  const clamp = () => {
    const c = controls.current;
    if (!c) return;
    const t = c.target;
    const x = THREE.MathUtils.clamp(t.x, bounds.minX, bounds.maxX);
    const z = THREE.MathUtils.clamp(t.z, bounds.minZ, bounds.maxZ);
    if (x !== t.x || z !== t.z || t.y !== 0) {
      const dx = x - t.x, dz = z - t.z, dy = -t.y;
      t.set(x, 0, z);
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
    }
  };

  return (
    <MapControls
      ref={controls}
      makeDefault
      enabled={enabled}
      enableDamping={false}
      screenSpacePanning={false}
      minZoom={CAMERA_CONFIG.minZoom}
      maxZoom={CAMERA_CONFIG.maxZoom}
      minPolarAngle={CAMERA_CONFIG.minPolarAngle}
      maxPolarAngle={CAMERA_CONFIG.maxPolarAngle}
      zoomToCursor
      onChange={clamp}
    />
  );
}
