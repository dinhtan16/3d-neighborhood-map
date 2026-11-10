import type { MapFeature, MapSceneDto } from '@nmap/map-contracts';

export function splitFeatures(scene: MapSceneDto) {
  const buildings: MapFeature[] = [];
  const roads: MapFeature[] = [];
  const spaces: MapFeature[] = [];
  const water: MapFeature[] = [];
  const trees: MapFeature[] = [];
  for (const f of scene.features.features) {
    switch (f.properties.featureType) {
      case 'building': buildings.push(f); break;
      case 'road': roads.push(f); break;
      case 'park': case 'public_space': spaces.push(f); break;
      case 'water': water.push(f); break;
      case 'tree': trees.push(f); break;
    }
  }
  return { buildings, roads, spaces, water, trees };
}

export function disposeGeometries(list: (THREE.BufferGeometry | null | undefined)[]) {
  for (const g of list) g?.dispose();
}

import type * as THREE from 'three';
