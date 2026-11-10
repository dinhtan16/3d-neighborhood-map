import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural toy-style characters & vehicles (original designs).
 * Every part is a small geometry rendered as an InstancedMesh; agents are
 * animated by recomputing instance matrices each frame. Origin of each
 * character is at ground level, forward = +Z, units = metres.
 */

const merge = (gs: THREE.BufferGeometry[]) => {
  const flat = gs.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n.getAttribute('uv')) n.deleteAttribute('uv'); return n; });
  return mergeGeometries(flat, false)!;
};
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export const PART_GEOMETRY = {
  // ---- person (walking) : pivots handled in the animator ----
  leg: box(0.15, 0.5, 0.17, 0, -0.25, 0),
  shoe: box(0.16, 0.08, 0.25, 0, -0.52, 0.04),
  torso: merge([box(0.42, 0.46, 0.26, 0, 0.83, 0), box(0.36, 0.06, 0.22, 0, 1.08, 0)]),
  arm: box(0.11, 0.44, 0.12, 0, -0.2, 0),
  hand: new THREE.SphereGeometry(0.065, 8, 6).translate(0, -0.45, 0),
  head: new THREE.SphereGeometry(0.235, 16, 12).translate(0, 1.37, 0),
  eyes: merge([box(0.045, 0.07, 0.03, -0.08, 1.39, 0.222), box(0.045, 0.07, 0.03, 0.08, 1.39, 0.222)]),
  hair: new THREE.SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, 1.39, -0.025),
  // nón lá (conical hat)
  nonLa: new THREE.ConeGeometry(0.43, 0.24, 18).translate(0, 1.66, 0),
  cap: merge([new THREE.SphereGeometry(0.252, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45).translate(0, 1.4, 0), box(0.3, 0.03, 0.2, 0, 1.5, 0.2)]),
  helmet: new THREE.SphereGeometry(0.29, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6).translate(0, 1.37, 0),
  bag: box(0.3, 0.34, 0.14, 0, 0.88, -0.2),

  // ---- scooter (+Z forward) ----
  scooterBody: merge([box(0.34, 0.3, 1.05, 0, 0.42, -0.05), box(0.4, 0.62, 0.14, 0, 0.72, 0.5), box(0.36, 0.2, 0.42, 0, 0.36, 0.62)]),
  scooterSeat: box(0.32, 0.12, 0.62, 0, 0.66, -0.22),
  wheel: new THREE.CylinderGeometry(0.24, 0.24, 0.12, 14).rotateZ(Math.PI / 2),
  handlebar: merge([box(0.62, 0.05, 0.05, 0, 1.05, 0.5), box(0.06, 0.32, 0.06, 0, 0.9, 0.52)]),
  headlight: box(0.16, 0.1, 0.04, 0, 0.92, 0.585),

  // ---- car (+Z forward, 3.8 m) ----
  carBody: merge([box(1.66, 0.55, 3.8, 0, 0.55, 0), box(1.6, 0.2, 0.5, 0, 0.45, 1.8)]),
  carCabin: box(1.48, 0.55, 2.0, 0, 1.08, -0.25),
  carGlass: merge([box(1.5, 0.36, 1.7, 0, 1.1, -0.25), box(1.3, 0.36, 2.04, 0, 1.1, -0.25)]),
  carWheel: new THREE.CylinderGeometry(0.33, 0.33, 0.22, 16).rotateZ(Math.PI / 2),
  taxiSign: box(0.5, 0.18, 0.26, 0, 1.46, -0.25),
  lights: merge([box(0.3, 0.12, 0.04, -0.55, 0.65, 1.9), box(0.3, 0.12, 0.04, 0.55, 0.65, 1.9)]),
  // pickup: short cab + bed + cardboard boxes
  pickupCab: box(1.5, 0.6, 1.3, 0, 1.1, 0.75),
  pickupBed: merge([box(1.66, 0.35, 0.08, 0, 1.0, -1.85), box(0.08, 0.35, 2.2, -0.79, 1.0, -0.8), box(0.08, 0.35, 2.2, 0.79, 1.0, -0.8)]),
  cargo: merge([box(0.55, 0.45, 0.55, -0.4, 1.05, -0.5), box(0.55, 0.45, 0.55, 0.3, 1.05, -0.4), box(0.55, 0.45, 0.55, -0.1, 1.05, -1.2), box(0.5, 0.42, 0.5, -0.2, 1.5, -0.8)]),

  // ---- dog ----
  dogBody: box(0.24, 0.24, 0.55, 0, 0.36, 0),
  dogHead: merge([box(0.24, 0.22, 0.24, 0, 0.53, 0.33), box(0.14, 0.1, 0.12, 0, 0.48, 0.48), box(0.06, 0.1, 0.04, -0.08, 0.68, 0.3), box(0.06, 0.1, 0.04, 0.08, 0.68, 0.3)]),
  dogLeg: box(0.07, 0.26, 0.07, 0, -0.13, 0),
  dogTail: box(0.05, 0.05, 0.22, 0, 0, -0.11).rotateX(-0.6),
} as const;

export type PartKey = keyof typeof PART_GEOMETRY;

export const SKIN = ['#f3c9a6', '#e7b48f', '#d49a72', '#b97b55'];
export const HAIR = ['#2b1f2e', '#3d2a22', '#5a3a28', '#1d1a24', '#7a4b2c'];
export const SHIRT = ['#e4513f', '#49b35a', '#2f8f9d', '#f2a341', '#5b6ee1', '#ef8fb0', '#f4d35e', '#ffffff', '#8b5fbf', '#3aa3d9'];
export const PANTS = ['#2f3a5a', '#3d4a6b', '#5b4636', '#2b2b33', '#6a8caf', '#c9b48a'];
export const SHOES = ['#2b1f2e', '#ffffff', '#e4513f', '#3d3550'];
export const VEHICLE = ['#e4513f', '#3aa3d9', '#f2a341', '#49b35a', '#f7f2ea', '#8b5fbf', '#2f8f9d', '#ef8fb0'];
export const CAR = ['#3e8de0', '#e4513f', '#f7f2ea', '#2fb39a', '#7c6b8a', '#f2a341'];
export const DOG = ['#e2a24c', '#8a5a3c', '#f2e1c4', '#3d3530'];
