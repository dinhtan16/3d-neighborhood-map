import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MapFeature } from '@nmap/map-contracts';
import { createProjector } from '@nmap/geo-core';
import { buildRoadGeometries, planStreetDecoration } from '@/lib/three/geometries';
import { buildBuildings } from '@/lib/three/building-mesh';
import { chunksAround, chunkOf, rangeFromLocalBounds } from '@/features/map/chunks';

const projector = createProjector('EPSG:32648', { lat: 11.535, lng: 106.6225 });
const props = { source: 'osm', sourceId: 'way/1', height: 7, levels: 2, styleKey: null } as const;

/** Every triangle's geometric normal should agree with its stored vertex normal (front faces point outward/up). */
function windingOk(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), idx = g.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
    const geo = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (geo.lengthSq() < 1e-10) continue;
    n.fromBufferAttribute(nor, idx.getX(i));
    if (geo.dot(n) <= 0) return false;
  }
  return true;
}

describe('scene geometry', () => {
  it('builds road, sidewalk and marking meshes for a primary road', () => {
    const f = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[106.62, 11.535], [106.625, 11.535]] }, properties: { ...props, id: 'r', featureType: 'road', highway: 'primary' } } as MapFeature;
    const g = buildRoadGeometries([f], projector);
    expect(g.road).not.toBeNull();
    expect(g.sidewalk).not.toBeNull();
    expect(g.marking).not.toBeNull();
    expect(g.centerlines[0].halfWidth).toBeCloseTo(5.5);
  });

  it('merges buildings into one geometry with outward-facing walls and upward roofs', () => {
    const flat = { id: 'a', rings: [[[0, 0], [20, 0], [20, 12], [0, 12]]] as [number, number][][], height: 10.5, levels: 3 };
    const tube = { id: 'b', rings: [[[40, 0], [45, 0], [45, 18], [40, 18]]] as [number, number][][], height: 7, levels: 2 };
    const r = buildBuildings([flat, tube], () => Infinity);
    expect(r.metas).toHaveLength(2);
    expect(r.geometry).not.toBeNull();
    expect(windingOk(r.geometry!)).toBe(true);
    const bid = r.geometry!.getAttribute('aBid');
    expect(new Set(Array.from(bid.array as Float32Array))).toEqual(new Set([0, 1]));
    expect(r.geometry!.boundingBox!.max.y).toBeGreaterThanOrEqual(10.5);
  });

  it('puts an awning on the road-facing side of a shophouse', () => {
    // road along z = 22 (south of the building); front edge is the one at z = 18
    const house = { id: 'shop-1', rings: [[[0, 0], [5, 0], [5, 18], [0, 18]]] as [number, number][][], height: 10.5, levels: 3 };
    const probe = (p: [number, number]) => Math.abs(p[1] - 22) - 4;
    const found = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => buildBuildings([{ ...house, id: `shop-${i}` }], probe).awnings).flat();
    expect(found.length).toBeGreaterThan(0);
    for (const a of found) {
      expect(a.z).toBeGreaterThan(17.5);
      // +Z forward rotated by `rotation` must point towards the road (+z)
      expect(Math.cos(a.rotation)).toBeGreaterThan(0.9);
    }
  });

  it('keeps decoration off the carriageway', () => {
    const line = [[0, 0], [200, 0]] as [number, number][];
    const { trees, lamps } = planStreetDecoration([{ points: line, halfWidth: 5.5, highway: 'primary' }], [], [], { minX: -50, maxX: 250, minZ: -50, maxZ: 50 });
    expect(trees.length).toBeGreaterThan(5);
    expect(lamps.length).toBeGreaterThan(5);
    for (const t of trees) expect(Math.abs(t.z)).toBeGreaterThan(5.5 + 3);
  });
});

describe('chunk math', () => {
  it('maps local metres to 500 m chunks (z = -north)', () => {
    expect(chunkOf(0, 0)).toEqual([0, 0]);
    expect(chunkOf(-1, 499.9)).toEqual([-1, 0]);
    expect(chunkOf(1250, -10)).toEqual([2, -1]);
  });
  it('lists nearby chunks nearest-first and clipped to the area', () => {
    const range = rangeFromLocalBounds({ minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 });
    const list = chunksAround(10, 10, 600, range);
    expect(list[0].key).toBe('0_0');
    expect(list.every((c) => c.cx >= -2 && c.cx <= 1)).toBe(true);
    expect(chunksAround(5000, 5000, 600, range)).toHaveLength(0);
  });
});
