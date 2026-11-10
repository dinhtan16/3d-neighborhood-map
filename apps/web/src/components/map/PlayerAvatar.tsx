'use client';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { PART_GEOMETRY } from '@/lib/three/characters';
import { propMaterial } from '@/lib/three/style-materials';

/** Shared player state written by the walk controller, read by the avatar. */
export const playerState = { x: 0, z: 0, heading: 0, speed: 0, phase: 0, riding: false, visible: true };

const C = {
  skin: '#f1c39c', hair: '#2b1f2e', shirt: '#ef6a4c', pants: '#2f3a5a', shoes: '#ffffff', cap: '#2f8f9d',
  eyes: '#2b1f2e', scooter: '#3aa3d9', seat: '#2f2a33', wheel: '#2f2a33', light: '#fff2b0', helmet: '#f4c542', bag: '#f4c542',
};

function Part({ g, color, position, rotation }: { g: THREE.BufferGeometry; color: string; position?: [number, number, number]; rotation?: [number, number, number] }) {
  return <mesh geometry={g} material={propMaterial(color)} position={position} rotation={rotation} castShadow raycast={() => null} />;
}

/** The player's own toy-style character (and scooter when riding). */
export function PlayerAvatar() {
  const root = useRef<THREE.Group>(null);
  const walker = useRef<THREE.Group>(null);
  const rider = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const wheelF = useRef<THREE.Group>(null), wheelB = useRef<THREE.Group>(null);
  const G = PART_GEOMETRY;
  const bodyParts = useMemo(() => (
    <>
      <Part g={G.torso} color={C.shirt} />
      <Part g={G.head} color={C.skin} />
      <Part g={G.eyes} color={C.eyes} />
      <Part g={G.hair} color={C.hair} />
    </>
  ), [G]);

  useFrame(() => {
    const r = root.current;
    if (!r) return;
    r.visible = playerState.visible;
    r.position.set(playerState.x, 0, playerState.z);
    r.rotation.y = playerState.heading;
    const sw = Math.sin(playerState.phase) * Math.min(1, playerState.speed / 2) * 0.7;
    if (walker.current) walker.current.visible = !playerState.riding;
    if (rider.current) rider.current.visible = playerState.riding;
    if (!playerState.riding) {
      legL.current!.rotation.x = sw; legR.current!.rotation.x = -sw;
      armL.current!.rotation.x = -sw * 0.8; armR.current!.rotation.x = sw * 0.8;
      walker.current!.position.y = Math.abs(Math.sin(playerState.phase)) * 0.04 * Math.min(1, playerState.speed);
    } else {
      const spin = -playerState.phase * 2;
      wheelF.current!.rotation.x = spin; wheelB.current!.rotation.x = spin;
    }
  });

  return (
    <group ref={root}>
      {/* walking */}
      <group ref={walker}>
        <group ref={legL} position={[-0.1, 0.55, 0]}><Part g={G.leg} color={C.pants} /><Part g={G.shoe} color={C.shoes} /></group>
        <group ref={legR} position={[0.1, 0.55, 0]}><Part g={G.leg} color={C.pants} /><Part g={G.shoe} color={C.shoes} /></group>
        <group ref={armL} position={[-0.27, 1.03, 0]}><Part g={G.arm} color={C.shirt} /><Part g={G.hand} color={C.skin} /></group>
        <group ref={armR} position={[0.27, 1.03, 0]}><Part g={G.arm} color={C.shirt} /><Part g={G.hand} color={C.skin} /></group>
        {bodyParts}
        <Part g={G.cap} color={C.cap} />
        <Part g={G.bag} color={C.bag} />
      </group>
      {/* riding a scooter */}
      <group ref={rider}>
        <Part g={G.scooterBody} color={C.scooter} />
        <Part g={G.scooterSeat} color={C.seat} />
        <Part g={G.handlebar} color={C.wheel} />
        <Part g={G.headlight} color={C.light} />
        <group ref={wheelF} position={[0, 0.24, 0.62]}><Part g={G.wheel} color={C.wheel} /></group>
        <group ref={wheelB} position={[0, 0.24, -0.55]}><Part g={G.wheel} color={C.wheel} /></group>
        <group position={[0, 0.12, -0.25]}>
          <group position={[-0.1, 0.72, 0]} rotation={[-1.35, 0, 0]}><Part g={G.leg} color={C.pants} /><Part g={G.shoe} color={C.shoes} /></group>
          <group position={[0.1, 0.72, 0]} rotation={[-1.35, 0, 0]}><Part g={G.leg} color={C.pants} /><Part g={G.shoe} color={C.shoes} /></group>
          <group position={[-0.27, 1.03, 0]} rotation={[-1.1, 0, 0]}><Part g={G.arm} color={C.shirt} /><Part g={G.hand} color={C.skin} /></group>
          <group position={[0.27, 1.03, 0]} rotation={[-1.1, 0, 0]}><Part g={G.arm} color={C.shirt} /><Part g={G.hand} color={C.skin} /></group>
          {bodyParts}
          <Part g={G.helmet} color={C.helmet} />
        </group>
      </group>
    </group>
  );
}
