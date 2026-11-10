import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { use, useMemo } from 'react';
import { toonifyObject } from './materials';
import { EMBEDDED_PREFIX, loadEmbeddedModel } from './embedded-models';

const prepared = new WeakSet<THREE.Object3D>();

function prepare(scene: THREE.Object3D) {
  if (!prepared.has(scene)) {
    toonifyObject(scene);
    prepared.add(scene);
  }
  return scene;
}

function useUrlModel(url: string): THREE.Object3D {
  const gltf = useGLTF(url); // Meshopt + Draco handled by drei
  return gltf.scene;
}

function useEmbeddedModel(url: string): THREE.Object3D {
  return use(loadEmbeddedModel(url));
}

/**
 * Load a GLB and return a cheap clone that shares geometry and (toon)
 * materials with every other instance of the same asset.
 */
export function useAssetModel(url: string): THREE.Object3D {
  // The branch is stable per URL, so hook order never changes for a given component.
  const scene = url.startsWith(EMBEDDED_PREFIX) ? useEmbeddedModel(url) : useUrlModel(url);
  return useMemo(() => prepare(scene).clone(true), [scene]);
}

export function preloadAssets(urls: string[]) {
  for (const u of new Set(urls)) if (!u.startsWith(EMBEDDED_PREFIX)) useGLTF.preload(u);
}
