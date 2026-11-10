'use client';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { FPS_CONFIG, STYLE_V2, TOWNS } from '@nmap/map-config';
import type { MapAreaDto } from '@nmap/map-contracts';
import { projectorForArea } from '@/lib/geo/projection';
import { areaLocalBounds } from '@/lib/geo/coordinates';
import { fogUniforms, setFog } from '@/lib/three/style-materials';

const FPS_SKY = '#bfe2ef';
import { isBlocked, nearestRoadName, useLoadedPlaces } from '@/features/map/world-index';
import type { ChunkBuild } from '@/lib/three/chunk-builder';
import { useMapStore } from '@/features/map/store';
import { useWorldStatus } from '@/features/map/world-status';
import { worldFocus } from './ChunkedWorld';

/** Shared input written by keyboard handlers and the on-screen joystick (mobile). */
export const fpsInput = { joyX: 0, joyY: 0, lookDX: 0, lookDY: 0, run: false, ride: false, locked: false };

const keys = new Set<string>();

function findPick(o: THREE.Object3D | null): { placeId?: string } | null {
  while (o) {
    if (o.userData?.placeId) return { placeId: o.userData.placeId as string };
    o = o.parent;
  }
  return null;
}

export function FirstPersonController({ area }: { area: MapAreaDto }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const getState = useThree((s) => s.get);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const projector = useMemo(() => projectorForArea(area), [area]);
  const bounds = useMemo(() => areaLocalBounds(projector, area), [projector, area]);
  const pos = useRef(new THREE.Vector3(worldFocus.x, FPS_CONFIG.eyeHeightM, worldFocus.z));
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const bob = useRef(0);
  const lastHud = useRef(0);
  const lastPick = useRef(0);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const command = useMapStore((s) => s.cameraCommand);
  const setHover = useMapStore((s) => s.setHover);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const setStatus = useWorldStatus((s) => s.set);

  // spawn: nudge out of buildings
  const spawn = (x: number, z: number) => {
    for (let r = 0; r < 40; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!isBlocked(px, pz, FPS_CONFIG.playerRadiusM + 0.3)) { pos.current.set(px, FPS_CONFIG.eyeHeightM, pz); return; }
        if (r === 0) break;
      }
    }
    pos.current.set(x, FPS_CONFIG.eyeHeightM, z);
  };

  useEffect(() => {
    setFrameloop('always');
    setFog(160, 620);
    const prevBg = scene.background;
    scene.background = new THREE.Color(FPS_SKY);
    fogUniforms.uFogColor.value.set(FPS_SKY);
    scene.fog = new THREE.Fog(FPS_SKY, 160, 620);
    spawn(worldFocus.x, worldFocus.z);
    const cam = getState().camera;
    cam.position.copy(pos.current);
    euler.current.set(0, Math.PI * 0.75, 0);
    cam.quaternion.setFromEuler(euler.current);
    worldFocus.radius = 650;
    setStatus({ mode: 'fps' });
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      keys.add(e.code);
      if (e.code === 'KeyR') fpsInput.ride = !fpsInput.ride;
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keys.clear();
      setFrameloop('demand');
      setFog(1e6, 2e6);
      fogUniforms.uFogColor.value.set(STYLE_V2.sky);
      scene.background = prevBg;
      scene.fog = null;
      setStatus({ mode: 'iso' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // teleport / fly commands (search results, town buttons)
  useEffect(() => {
    if (command?.type === 'fly') spawn(command.target[0], command.target[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  // click while pointer-locked: interact with what the crosshair points at
  useEffect(() => {
    const onDown = () => {
      if (!fpsInput.locked) return;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), getState().camera);
      raycaster.far = 60;
      const hit = raycaster.intersectObjects(scene.children, true)[0];
      if (!hit) return;
      const pick = findPick(hit.object);
      if (pick?.placeId) { selectPlace(pick.placeId); return; }
      if (hit.object.userData?.kind === 'buildings' && hit.face) {
        const build = hit.object.userData.build as ChunkBuild;
        const bid = (build.buildings!.getAttribute('aBid').array as Float32Array)[hit.face.a];
        const meta = build.buildingMetas[bid];
        if (meta?.placeId) selectPlace(meta.placeId);
        else if (meta) useMapStore.getState().selectBuilding(meta.id, { name: meta.name, levels: meta.levels, height: meta.height });
      }
    };
    gl.domElement.addEventListener('mousedown', onDown);
    return () => gl.domElement.removeEventListener('mousedown', onDown);
  }, [gl, getState, scene, raycaster, selectPlace]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const camera = state.camera as THREE.PerspectiveCamera;
    // look (touch / joystick drag)
    if (fpsInput.lookDX || fpsInput.lookDY) {
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= fpsInput.lookDX * 0.004;
      euler.current.x = THREE.MathUtils.clamp(euler.current.x - fpsInput.lookDY * 0.004, -1.3, 1.3);
      camera.quaternion.setFromEuler(euler.current);
      fpsInput.lookDX = fpsInput.lookDY = 0;
    }
    // movement
    let f = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    f += -fpsInput.joyY;
    s += fpsInput.joyX;
    const len = Math.hypot(f, s);
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || fpsInput.run;
    const speed = fpsInput.ride ? FPS_CONFIG.rideSpeed * (running ? 2 : 1) : running ? FPS_CONFIG.runSpeed : FPS_CONFIG.walkSpeed;
    if (len > 0.01) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      dir.y = 0;
      dir.normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      const step = (speed * dt) / Math.max(1, len);
      const mx = (dir.x * f + right.x * s) * step;
      const mz = (dir.z * f + right.z * s) * step;
      const r = FPS_CONFIG.playerRadiusM;
      const p = pos.current;
      // axis-separated collision => slide along walls
      if (!isBlocked(p.x + mx, p.z, r)) p.x += mx;
      if (!isBlocked(p.x, p.z + mz, r)) p.z += mz;
      p.x = THREE.MathUtils.clamp(p.x, bounds.minX, bounds.maxX);
      p.z = THREE.MathUtils.clamp(p.z, bounds.minZ, bounds.maxZ);
      bob.current += dt * speed * (fpsInput.ride ? 0.3 : 1.6);
    }
    const eye = FPS_CONFIG.eyeHeightM + (fpsInput.ride ? -0.35 : Math.sin(bob.current) * 0.05);
    camera.position.set(pos.current.x, eye, pos.current.z);
    worldFocus.x = pos.current.x;
    worldFocus.z = pos.current.z;

    const t = state.clock.elapsedTime;
    // hover what the crosshair points at
    if (fpsInput.locked && t - lastPick.current > 0.15) {
      lastPick.current = t;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      raycaster.far = 60;
      const hit = raycaster.intersectObjects(scene.children, true)[0];
      const pick = hit ? findPick(hit.object) : null;
      if (hit && pick?.placeId) {
        const place = Object.values(useLoadedPlaces.getState().byChunk).flat().find((p) => p.place.id === pick.placeId)?.place;
        setHover({ id: pick.placeId, kind: 'place', label: place?.name ?? 'Địa điểm', sublabel: 'Bấm để xem', position: [hit.point.x, hit.point.y + 0.8, hit.point.z] });
      } else if (hit && hit.object.userData?.kind === 'buildings' && hit.face) {
        const build = hit.object.userData.build as ChunkBuild;
        const meta = build.buildingMetas[(build.buildings!.getAttribute('aBid').array as Float32Array)[hit.face.a]];
        const place = meta?.placeId ? build.pins.find((p) => p.place.id === meta.placeId)?.place : undefined;
        if (meta) setHover({ id: meta.id, kind: 'building', label: place?.name ?? meta.name ?? 'Nhà', sublabel: place ? 'Bấm để xem' : `${meta.levels ?? '?'} tầng`, position: [hit.point.x, hit.point.y + 0.6, hit.point.z] });
        else setHover(null);
      } else setHover(null);
    }
    // HUD location (2 Hz)
    if (t - lastHud.current > 0.5) {
      lastHud.current = t;
      const geo = projector.toGeo(pos.current.x, pos.current.z);
      let town: string | null = null, best = Infinity;
      for (const tw of TOWNS) {
        const [tx, tz] = projector.toLocal(tw.lng, tw.lat);
        const d = Math.hypot(tx - pos.current.x, tz - pos.current.z);
        if (d < best) { best = d; town = tw.name; }
      }
      setStatus({ location: { town: best < 6000 ? town : null, road: nearestRoadName(pos.current.x, pos.current.z), lat: geo.lat, lng: geo.lng } });
    }
  });

  return (
    <PointerLockControls
      selector="#fps-lock"
      onLock={() => { fpsInput.locked = true; }}
      onUnlock={() => { fpsInput.locked = false; setHover(null); }}
    />
  );
}
