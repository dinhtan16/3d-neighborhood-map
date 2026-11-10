'use client';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { FPS_CONFIG, TOWNS } from '@nmap/map-config';
import type { MapAreaDto } from '@nmap/map-contracts';
import { projectorForArea } from '@/lib/geo/projection';
import { areaLocalBounds } from '@/lib/geo/coordinates';
import { fogUniforms, setFog } from '@/lib/three/style-materials';
import { isBlocked, nearestRoadName, useLoadedPlaces } from '@/features/map/world-index';
import { useMapStore } from '@/features/map/store';
import { useWorldStatus } from '@/features/map/world-status';
import type { ChunkBuild } from '@/lib/three/chunk-builder';
import { worldFocus } from './ChunkedWorld';
import { PlayerAvatar, playerState } from './PlayerAvatar';
import { STYLE_V2 } from '@nmap/map-config';

const SKY = '#bfe2ef';

/** Shared input (keyboard, on-screen joystick, HUD buttons). */
export const fpsInput = {
  joyX: 0, joyY: 0, lookDX: 0, lookDY: 0, run: false, ride: false,
  /** 'third' = camera behind your character, 'first' = eye view. */
  view: 'third' as 'third' | 'first',
  locked: false,
};

const keys = new Set<string>();

function findPick(o: THREE.Object3D | null): string | null {
  while (o) { if (o.userData?.placeId) return o.userData.placeId as string; o = o.parent; }
  return null;
}

/**
 * Walk / ride controller.
 *  - drag with the mouse (any button) or one finger: look around (no pointer lock needed)
 *  - wheel: camera distance (third person)
 *  - W A S D / arrows: move relative to the camera; Shift: run; R: scooter; V: 1st / 3rd person
 *  - click (without dragging) on a shop: open its details
 */
export function FirstPersonController({ area }: { area: MapAreaDto }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const getState = useThree((s) => s.get);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const projector = useMemo(() => projectorForArea(area), [area]);
  const bounds = useMemo(() => areaLocalBounds(projector, area), [projector, area]);
  const yaw = useRef(Math.PI * 0.75);
  const pitch = useRef(0.32);
  const dist = useRef(6.5);
  const camPos = useRef(new THREE.Vector3());
  const lastHud = useRef(0);
  const lastHover = useRef(0);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const command = useMapStore((s) => s.cameraCommand);
  const setHover = useMapStore((s) => s.setHover);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const setStatus = useWorldStatus((s) => s.set);

  const spawn = (x: number, z: number) => {
    for (let r = 0; r < 60; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!isBlocked(px, pz, FPS_CONFIG.playerRadiusM + 0.4)) { playerState.x = px; playerState.z = pz; return; }
        if (r === 0) break;
      }
    }
    playerState.x = x; playerState.z = z;
  };

  useEffect(() => {
    setFrameloop('always');
    setFog(170, 640);
    const prevBg = scene.background;
    scene.background = new THREE.Color(SKY);
    fogUniforms.uFogColor.value.set(SKY);
    spawn(worldFocus.x, worldFocus.z);
    camPos.current.set(playerState.x, 4, playerState.z + 6);
    worldFocus.radius = 650;
    setStatus({ mode: 'fps' });

    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      keys.add(e.code);
      if (e.code === 'KeyR') fpsInput.ride = !fpsInput.ride;
      if (e.code === 'KeyV') fpsInput.view = fpsInput.view === 'third' ? 'first' : 'third';
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    // mouse drag look (no pointer lock)
    const el = gl.domElement;
    let drag: { x: number; y: number; sx: number; sy: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, id: e.pointerId }; el.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mouse.current = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
      if (!drag || drag.id !== e.pointerId) return;
      fpsInput.lookDX += e.clientX - drag.x;
      fpsInput.lookDY += e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) pickAt(e);
      drag = null;
    };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); dist.current = THREE.MathUtils.clamp(dist.current * (e.deltaY > 0 ? 1.12 : 0.89), 2.5, 28); };
    const onLeave = () => { mouse.current = null; setHover(null); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.style.cursor = 'grab';

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      keys.clear();
      setFrameloop('demand');
      setFog(1e6, 2e6);
      fogUniforms.uFogColor.value.set(STYLE_V2.sky);
      scene.background = prevBg;
      worldFocus.x = playerState.x; worldFocus.z = playerState.z;
      setStatus({ mode: 'iso' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (command?.type === 'fly') spawn(command.target[0], command.target[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  /** Raycast at a screen point → place / building under the cursor. */
  function hitAt(ndc: { x: number; y: number }) {
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), getState().camera);
    raycaster.far = 120;
    for (const hit of raycaster.intersectObjects(scene.children, true)) {
      const placeId = findPick(hit.object);
      if (placeId) return { hit, placeId, meta: null as ChunkBuild['buildingMetas'][number] | null, build: null as ChunkBuild | null };
      if (hit.object.userData?.kind === 'buildings' && hit.face) {
        const build = hit.object.userData.build as ChunkBuild;
        const meta = build.buildingMetas[(build.buildings!.getAttribute('aBid').array as Float32Array)[hit.face.a]];
        return { hit, placeId: meta?.placeId ?? null, meta, build };
      }
      if ((hit.object as THREE.Mesh).isMesh && !(hit.object as THREE.InstancedMesh).isInstancedMesh) return null; // ground etc.
    }
    return null;
  }

  function pickAt(e: PointerEvent) {
    const r = gl.domElement.getBoundingClientRect();
    const res = hitAt({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 });
    if (!res) return;
    if (res.placeId) selectPlace(res.placeId);
    else if (res.meta) useMapStore.getState().selectBuilding(res.meta.id, { name: res.meta.name, levels: res.meta.levels, height: res.meta.height });
  }

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const camera = state.camera as THREE.PerspectiveCamera;
    const first = fpsInput.view === 'first';

    // look
    if (fpsInput.lookDX || fpsInput.lookDY) {
      yaw.current -= fpsInput.lookDX * 0.005;
      pitch.current = THREE.MathUtils.clamp(pitch.current + fpsInput.lookDY * 0.004 * (first ? -1 : 1), first ? -1.2 : -0.15, first ? 1.2 : 1.35);
      fpsInput.lookDX = fpsInput.lookDY = 0;
    }

    // move relative to camera yaw
    let f = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    f += -fpsInput.joyY; s += fpsInput.joyX;
    const len = Math.hypot(f, s);
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || fpsInput.run;
    const speed = fpsInput.ride ? FPS_CONFIG.rideSpeed * (running ? 1.6 : 1) : running ? FPS_CONFIG.runSpeed * 0.6 : FPS_CONFIG.walkSpeed;
    // forward = direction the camera looks (camera sits "behind" at yaw)
    const fx = -Math.sin(yaw.current), fz = -Math.cos(yaw.current);
    const rx = -fz, rz = fx;
    let moving = 0;
    if (len > 0.05) {
      const k = 1 / Math.max(1, len);
      const dx = (fx * f + rx * s) * k, dz = (fz * f + rz * s) * k;
      const step = speed * dt;
      const r = fpsInput.ride ? 0.6 : FPS_CONFIG.playerRadiusM;
      if (!isBlocked(playerState.x + dx * step, playerState.z, r)) playerState.x += dx * step;
      if (!isBlocked(playerState.x, playerState.z + dz * step, r)) playerState.z += dz * step;
      playerState.x = THREE.MathUtils.clamp(playerState.x, bounds.minX, bounds.maxX);
      playerState.z = THREE.MathUtils.clamp(playerState.z, bounds.minZ, bounds.maxZ);
      // turn the character smoothly towards the movement direction
      const target = Math.atan2(dx, dz);
      let d = target - playerState.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      playerState.heading += d * Math.min(1, dt * (fpsInput.ride ? 5 : 10));
      moving = speed;
    }
    playerState.speed = THREE.MathUtils.lerp(playerState.speed, moving, Math.min(1, dt * 8));
    playerState.phase += dt * playerState.speed * (fpsInput.ride ? 3 : 2.6);
    playerState.riding = fpsInput.ride;
    playerState.visible = !first;
    worldFocus.x = playerState.x; worldFocus.z = playerState.z;

    // camera
    const head = new THREE.Vector3(playerState.x, fpsInput.ride ? 1.7 : 1.55, playerState.z);
    if (first) {
      camera.position.set(playerState.x, fpsInput.ride ? 1.75 : FPS_CONFIG.eyeHeightM, playerState.z);
      camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    } else {
      const d = dist.current * (fpsInput.ride ? 1.25 : 1);
      const want = new THREE.Vector3(
        head.x + Math.sin(yaw.current) * Math.cos(pitch.current) * d,
        head.y + Math.sin(pitch.current) * d,
        head.z + Math.cos(yaw.current) * Math.cos(pitch.current) * d,
      );
      // keep the camera out of buildings: pull it in along the boom
      for (let t = 1; t > 0.15; t -= 0.1) {
        const px = head.x + (want.x - head.x) * t, pz = head.z + (want.z - head.z) * t;
        if (!isBlocked(px, pz, 0.3) || want.y > 14) { want.set(px, head.y + (want.y - head.y) * t, pz); break; }
      }
      want.y = Math.max(0.6, want.y);
      camPos.current.lerp(want, Math.min(1, dt * 10));
      camera.position.copy(camPos.current);
      camera.lookAt(head);
    }

    const t = state.clock.elapsedTime;
    // hover tooltip under the mouse cursor
    if (mouse.current && t - lastHover.current > 0.12) {
      lastHover.current = t;
      const res = hitAt(mouse.current);
      if (res?.placeId) {
        const place = res.build?.pins.find((p) => p.place.id === res.placeId)?.place
          ?? Object.values(useLoadedPlaces.getState().byChunk).flat().find((p) => p.place.id === res.placeId)?.place;
        setHover({ id: res.placeId, kind: 'place', label: place?.name ?? 'Địa điểm', sublabel: 'Bấm để xem', position: [res.hit.point.x, res.hit.point.y + 0.8, res.hit.point.z] });
        gl.domElement.style.cursor = 'pointer';
      } else if (res?.meta) {
        setHover({ id: res.meta.id, kind: 'building', label: res.meta.name ?? 'Nhà', sublabel: `${res.meta.levels ?? '?'} tầng`, position: [res.hit.point.x, res.hit.point.y + 0.6, res.hit.point.z] });
        gl.domElement.style.cursor = 'pointer';
      } else { setHover(null); gl.domElement.style.cursor = 'grab'; }
    }

    // HUD location (2 Hz)
    if (t - lastHud.current > 0.5) {
      lastHud.current = t;
      const geo = projector.toGeo(playerState.x, playerState.z);
      let town: string | null = null, best = Infinity;
      for (const tw of TOWNS) {
        const [tx, tz] = projector.toLocal(tw.lng, tw.lat);
        const d = Math.hypot(tx - playerState.x, tz - playerState.z);
        if (d < best) { best = d; town = tw.name; }
      }
      setStatus({ location: { town: best < 6000 ? town : null, road: nearestRoadName(playerState.x, playerState.z), lat: geo.lat, lng: geo.lng } });
    }
  });

  return <PlayerAvatar />;
}
