import * as THREE from 'three';
import { BUILDING_STYLE_COLORS, PALETTE } from '@nmap/map-config';

/**
 * Illustrated look: MeshToonMaterial with a 3-step gradient ramp, flat colours,
 * no PBR. All materials are cached and shared – never create materials per render.
 */
let gradient: THREE.DataTexture | null = null;
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
export function toonMaterial(color: string | THREE.Color, opts: { key?: string; map?: THREE.Texture; side?: THREE.Side; transparent?: boolean; opacity?: number } = {}) {
  const hex = typeof color === 'string' ? color : `#${color.getHexString()}`;
  const key = `${hex}|${opts.key ?? ''}|${opts.map?.uuid ?? ''}|${opts.side ?? 0}|${opts.opacity ?? 1}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color: hex,
      gradientMap: toonGradient(),
      map: opts.map ?? null,
      side: opts.side ?? THREE.FrontSide,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    });
    toonCache.set(key, m);
  }
  return m;
}

const flatCache = new Map<string, THREE.MeshLambertMaterial>();
/** Simple diffuse material for flat ground layers (roads, markings). */
export function flatMaterial(color: string, polygonOffset = 0) {
  const key = `${color}|${polygonOffset}`;
  let m = flatCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, polygonOffset: polygonOffset !== 0, polygonOffsetFactor: polygonOffset, polygonOffsetUnits: polygonOffset });
    flatCache.set(key, m);
  }
  return m;
}

let outline: THREE.LineBasicMaterial | null = null;
export function outlineMaterial() {
  outline ??= new THREE.LineBasicMaterial({ color: PALETTE.outline, transparent: true, opacity: 0.85 });
  return outline;
}

/** Repeating façade texture: one cell = 3 m wide x 3.5 m (one floor) tall. */
let facade: THREE.CanvasTexture | null = null;
export const FACADE_CELL_W = 3;
export const FACADE_CELL_H = 3.5;
export function facadeTexture(): THREE.Texture | null {
  if (facade) return facade;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 112;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  // floor slab line
  g.fillStyle = '#e9ddd2';
  g.fillRect(0, c.height - 8, c.width, 8);
  // window with frame and sill (multiplied by the wall colour)
  g.fillStyle = '#5d4a40';
  g.fillRect(22, 24, 52, 52);
  g.fillStyle = '#a9d3e3';
  g.fillRect(26, 28, 44, 44);
  g.fillStyle = '#d7eef5';
  g.fillRect(26, 28, 44, 12);
  g.fillStyle = '#5d4a40';
  g.fillRect(46, 28, 4, 44);
  g.fillStyle = '#fff7ec';
  g.fillRect(18, 76, 60, 6);
  facade = new THREE.CanvasTexture(c);
  facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
  facade.repeat.set(1 / FACADE_CELL_W, 1 / FACADE_CELL_H);
  facade.offset.set(0, 0);
  facade.colorSpace = THREE.SRGBColorSpace;
  facade.anisotropy = 4;
  return facade;
}

export function buildingMaterials(styleKey: string | null | undefined, state: 'normal' | 'hover' | 'selected' = 'normal') {
  const style = BUILDING_STYLE_COLORS[styleKey ?? ''] ?? BUILDING_STYLE_COLORS['residential-cream'];
  const wall = state === 'normal' ? style.wall : state === 'hover' ? PALETTE.highlight : PALETTE.selected;
  return [
    toonMaterial(style.roof, { key: 'roof' }),
    toonMaterial(wall, { key: 'wall', map: facadeTexture() ?? undefined }),
  ];
}

/** Replace PBR materials of a loaded GLB with cached toon materials of the same colour. */
export function toonifyObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const convert = (m: THREE.Material) => {
      const std = m as THREE.MeshStandardMaterial;
      if ((m as THREE.MeshToonMaterial).isMeshToonMaterial) return m;
      return toonMaterial(std.color ?? new THREE.Color('#cccccc'), { key: 'asset', side: m.side, map: std.map ?? undefined });
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
}
