'use client';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { sidewalkWidthFor } from '@nmap/map-config';
import { isBlocked, roadLinesNear, type RoadLine } from '@/features/map/world-index';
import { propMaterial } from '@/lib/three/style-materials';
import { CAR, DOG, HAIR, PANTS, PART_GEOMETRY, SHIRT, SHOES, SKIN, VEHICLE, type PartKey } from '@/lib/three/characters';
import { worldFocus } from './ChunkedWorld';

type Kind = 'ped' | 'scooter' | 'car' | 'taxi' | 'pickup' | 'dog';

interface Agent {
  kind: Kind;
  line: RoadLine;
  cum: number[];
  s: number;
  dir: 1 | -1;
  speed: number;
  lateral: number;
  phase: number;
  pause: number;
  hat: 0 | 1 | 2 | 3; // none, nón lá, cap, bag
  c: THREE.Color[];
  x: number; z: number; heading: number;
}

const FOOT = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway']);
const pickC = (arr: readonly string[]) => new THREE.Color(arr[Math.floor(Math.random() * arr.length)]);

function cumulative(points: [number, number][]) {
  const c = [0];
  for (let i = 1; i < points.length; i++) c.push(c[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return c;
}

/** Position + tangent at arc length s. */
function sample(a: Agent, out: { x: number; z: number; tx: number; tz: number }) {
  const p = a.line.points, c = a.cum;
  let i = 1;
  while (i < c.length - 1 && c[i] < a.s) i++;
  const t = (a.s - c[i - 1]) / Math.max(1e-6, c[i] - c[i - 1]);
  const dx = p[i][0] - p[i - 1][0], dz = p[i][1] - p[i - 1][1];
  const l = Math.hypot(dx, dz) || 1;
  out.x = p[i - 1][0] + dx * t; out.z = p[i - 1][1] + dz * t; out.tx = dx / l; out.tz = dz / l;
}

const PARTS: PartKey[] = Object.keys(PART_GEOMETRY) as PartKey[];
const CAPACITY: Partial<Record<PartKey, number>> = { leg: 400, shoe: 400, arm: 400, hand: 400, wheel: 200, carWheel: 160, dogLeg: 80 };

/**
 * Pedestrians, scooters, cars and dogs moving along the loaded roads around the
 * focus point. Fully instanced: one draw call per part type.
 */
export function AgentsLayer({ density = 1, scale = 1 }: { density?: number; scale?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const agents = useRef<Agent[]>([]);
  const meshes = useRef<Partial<Record<PartKey, THREE.InstancedMesh>>>({});
  const lastSpawn = useRef(0);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), b: new THREE.Matrix4(), p: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), x: new THREE.Vector3(1, 0, 0), smp: { x: 0, z: 0, tx: 0, tz: 1 } }), []);
  const white = useMemo(() => new THREE.Color('#ffffff'), []);
  const colors = useMemo(() => ({
    eyes: new THREE.Color('#2b1f2e'), wheel: new THREE.Color('#2f2a33'), glass: new THREE.Color('#9fd3ea'), straw: new THREE.Color('#ead39a'),
    seat: new THREE.Color('#2f2a33'), cardboard: new THREE.Color('#d7a96b'), light: new THREE.Color('#fff2b0'), taxi: new THREE.Color('#f4c542'), bed: new THREE.Color('#5d5866'),
  }), []);

  useEffect(() => () => { agents.current = []; }, []);

  const targets = { ped: Math.round(70 * density), scooter: Math.round(45 * density), car: Math.round(10 * density), taxi: Math.round(3 * density), pickup: Math.round(4 * density), dog: Math.round(6 * density) };

  function spawn(kind: Kind, near: RoadLine[]): Agent | null {
    const pool = near.filter((l) => (kind === 'ped' || kind === 'dog') ? l.highway !== 'trunk' && l.highway !== 'motorway'
      : kind === 'scooter' ? !FOOT.has(l.highway)
      : !FOOT.has(l.highway) && l.halfWidth >= 2.4 && l.length > 40);
    if (!pool.length) return null;
    const line = pool[Math.floor(Math.random() * pool.length)];
    const cum = cumulative(line.points as [number, number][]);
    const foot = FOOT.has(line.highway);
    const sw = sidewalkWidthFor(line.highway);
    const side = Math.random() < 0.5 ? -1 : 1;
    let lateral = 0, speed = 1.3;
    if (kind === 'ped' || kind === 'dog') {
      lateral = foot ? (Math.random() - 0.5) * line.halfWidth : side * (line.halfWidth + Math.max(0.6, sw * 0.5) + Math.random() * 0.4);
      speed = kind === 'dog' ? 1.6 + Math.random() : 1.0 + Math.random() * 0.6;
    } else if (kind === 'scooter') { lateral = line.halfWidth * (0.35 + Math.random() * 0.45); speed = 7 + Math.random() * 6; }
    else { lateral = Math.max(1, line.halfWidth * 0.45); speed = 9 + Math.random() * 5; }
    const c: THREE.Color[] = kind === 'ped'
      ? [pickC(SKIN), pickC(HAIR), pickC(SHIRT), pickC(PANTS), pickC(SHOES), pickC(SHIRT)]
      : kind === 'scooter' ? [pickC(VEHICLE), pickC(SKIN), pickC(SHIRT), pickC(PANTS), pickC(VEHICLE), pickC(SHOES)]
      : kind === 'dog' ? [pickC(DOG)]
      : [kind === 'taxi' ? new THREE.Color('#f4c542') : pickC(CAR)];
    const r = Math.random();
    return {
      kind, line, cum, s: Math.random() * cum[cum.length - 1], dir: Math.random() < 0.5 ? 1 : -1, speed, lateral,
      phase: Math.random() * 6.28, pause: 0, hat: kind === 'ped' ? (r < 0.25 ? 1 : r < 0.45 ? 2 : r < 0.6 ? 3 : 0) : 0, c, x: 0, z: 0, heading: 0,
    };
  }

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const R = Math.min(worldFocus.radius * 0.32, 230);
    const list = agents.current;

    // despawn far agents / agents whose road was unloaded
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (Math.hypot(a.x - worldFocus.x, a.z - worldFocus.z) > R * 1.4 && a.x !== 0) list.splice(i, 1);
    }
    // spawn up to targets (a few per tick)
    if (t - lastSpawn.current > 0.3) {
      lastSpawn.current = t;
      const near = roadLinesNear(worldFocus.x, worldFocus.z, R);
      if (near.length) {
        for (const kind of Object.keys(targets) as Kind[]) {
          let n = list.filter((a) => a.kind === kind).length;
          for (let k = 0; k < 6 && n < targets[kind]; k++, n++) { const a = spawn(kind, near); if (a) list.push(a); }
        }
      }
    }

    // move
    for (let i = list.length - 1; i >= 0; i--) if (list[i].s === -1) list.splice(i, 1);
    for (const a of list) {
      const len = a.cum[a.cum.length - 1];
      if (a.pause > 0) a.pause -= dt;
      else a.s += a.dir * a.speed * dt;
      if (a.s < 0 || a.s > len) { a.s = Math.max(0, Math.min(len, a.s)); a.dir = (a.dir * -1) as 1 | -1; if (a.kind === 'ped') a.pause = Math.random() * 1.5; }
      sample(a, tmp.smp);
      const tx = tmp.smp.tx * a.dir, tz = tmp.smp.tz * a.dir;
      // right-hand traffic: vehicles keep to the right of their travel direction
      const rx = -tz, rz = tx;
      const lat = a.kind === 'ped' || a.kind === 'dog' ? a.lateral * a.dir : a.lateral;
      const nx = tmp.smp.x + rx * lat, nz = tmp.smp.z + rz * lat;
      // footprints can overlap OSM road edges: never walk/drive through a building
      if (isBlocked(nx, nz, a.kind === 'ped' || a.kind === 'dog' ? 0.3 : 0.9)) {
        if (a.x === 0 && a.z === 0) { a.s = -1; continue; } // spawned inside: discard below
        a.s -= a.dir * a.speed * dt; a.dir = (a.dir * -1) as 1 | -1; a.pause = 0.4;
        continue;
      }
      a.x = nx;
      a.z = nz;
      a.heading = Math.atan2(tx, tz);
      if (a.pause <= 0) a.phase += dt * a.speed * (a.kind === 'dog' ? 9 : 5.2);
    }

    // emit instances
    const counts: Partial<Record<PartKey, number>> = {};
    const { m, b, p, q, v, s, up, x: xAxis } = tmp;
    const emit = (key: PartKey, color: THREE.Color, pivot?: [number, number, number], rotX = 0, extra?: THREE.Matrix4) => {
      const mesh = meshes.current[key];
      if (!mesh) return;
      const i = counts[key] ?? 0;
      if (i >= mesh.instanceMatrix.count) return;
      if (pivot) {
        q.setFromAxisAngle(xAxis, rotX);
        p.compose(v.set(...pivot), q, s.set(1, 1, 1));
        m.multiplyMatrices(extra ?? b, p);
      } else m.copy(extra ?? b);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color);
      counts[key] = i + 1;
    };

    for (const a of list) {
      if (a.s === -1 || (a.x === 0 && a.z === 0)) continue;
      q.setFromAxisAngle(up, a.heading);
      const bob = a.kind === 'ped' ? Math.abs(Math.sin(a.phase)) * 0.035 : 0;
      b.compose(v.set(a.x, bob, a.z), q, s.set(scale, scale, scale));
      const sw = Math.sin(a.phase) * (a.pause > 0 ? 0 : 0.6);
      if (a.kind === 'ped') {
        const [skin, hair, shirt, pants, shoes, acc] = a.c;
        emit('leg', pants, [-0.1, 0.55, 0], sw); emit('shoe', shoes, [-0.1, 0.55, 0], sw);
        emit('leg', pants, [0.1, 0.55, 0], -sw); emit('shoe', shoes, [0.1, 0.55, 0], -sw);
        emit('torso', shirt);
        emit('arm', shirt, [-0.27, 1.03, 0], -sw * 0.8); emit('hand', skin, [-0.27, 1.03, 0], -sw * 0.8);
        emit('arm', shirt, [0.27, 1.03, 0], sw * 0.8); emit('hand', skin, [0.27, 1.03, 0], sw * 0.8);
        emit('head', skin); emit('eyes', colors.eyes); emit('hair', hair);
        if (a.hat === 1) emit('nonLa', colors.straw);
        if (a.hat === 2) emit('cap', acc);
        if (a.hat === 3) emit('bag', acc);
      } else if (a.kind === 'scooter') {
        const [body, skin, shirt, pants, helmet, shoes] = a.c;
        emit('scooterBody', body); emit('scooterSeat', colors.seat); emit('handlebar', colors.wheel); emit('headlight', colors.light);
        const spin = -a.s * 4;
        emit('wheel', colors.wheel, [0, 0.24, 0.62], spin); emit('wheel', colors.wheel, [0, 0.24, -0.55], spin);
        // seated rider: raise torso/head onto the seat
        const rider = new THREE.Matrix4().multiplyMatrices(b, new THREE.Matrix4().makeTranslation(0, 0.12, -0.25));
        emit('leg', pants, [-0.1, 0.72, 0], -1.35, rider); emit('leg', pants, [0.1, 0.72, 0], -1.35, rider);
        emit('shoe', shoes, [-0.1, 0.72, 0], -1.35, rider); emit('shoe', shoes, [0.1, 0.72, 0], -1.35, rider);
        emit('torso', shirt, undefined, 0, rider);
        emit('arm', shirt, [-0.27, 1.03, 0], -1.1, rider); emit('arm', shirt, [0.27, 1.03, 0], -1.1, rider);
        emit('hand', skin, [-0.27, 1.03, 0], -1.1, rider); emit('hand', skin, [0.27, 1.03, 0], -1.1, rider);
        emit('head', skin, undefined, 0, rider); emit('eyes', colors.eyes, undefined, 0, rider); emit('helmet', helmet, undefined, 0, rider);
      } else if (a.kind === 'dog') {
        const [fur] = a.c;
        emit('dogBody', fur); emit('dogHead', fur); emit('dogTail', fur, [0, 0.45, -0.27], Math.sin(a.phase * 1.5) * 0.4);
        for (const [lx, lz, ph] of [[-0.08, 0.2, 1], [0.08, 0.2, -1], [-0.08, -0.2, -1], [0.08, -0.2, 1]] as const) emit('dogLeg', fur, [lx, 0.26, lz], sw * ph);
      } else {
        const [paint] = a.c;
        const spin = -a.s * 3;
        emit('carBody', paint); emit('lights', colors.light);
        if (a.kind === 'pickup') { emit('pickupCab', paint); emit('carGlass', colors.glass, [0, 0, 0.9], 0); emit('pickupBed', colors.bed); emit('cargo', colors.cardboard); }
        else { emit('carCabin', paint); emit('carGlass', colors.glass); }
        if (a.kind === 'taxi') emit('taxiSign', white);
        for (const [wx, wz] of [[-0.8, 1.25], [0.8, 1.25], [-0.8, -1.25], [0.8, -1.25]] as const) emit('carWheel', colors.wheel, [wx, 0.33, wz], spin);
      }
    }
    for (const key of PARTS) {
      const mesh = meshes.current[key];
      if (!mesh) continue;
      mesh.count = counts[key] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (list.length) invalidate();
  });

  return (
    <group>
      {PARTS.map((key) => (
        <instancedMesh
          key={key}
          ref={(m) => {
            if (!m) return;
            meshes.current[key] = m;
            m.count = 0;
            if (!m.instanceColor) m.setColorAt(0, white);
          }}
          args={[PART_GEOMETRY[key], propMaterial('#ffffff', { instanceColor: true }), CAPACITY[key] ?? 120]}
          frustumCulled={false}
          raycast={() => null}
        />
      ))}
    </group>
  );
}
