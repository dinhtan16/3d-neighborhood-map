import { describe, expect, it } from 'vitest';
import type { MapFeature } from '@nmap/map-contracts';
import { createProjector } from '@nmap/geo-core';
import { buildRoadGeometries, buildBuildingGeometry, planStreetDecoration } from '@/lib/three/geometries';

const projector = createProjector('EPSG:32648', { lat: 11.422, lng: 106.606 });
const props = { source: 'osm', sourceId: 'way/1', height: 7, levels: 2, styleKey: null } as const;

describe('scene geometry', () => {
  it('builds road, sidewalk and marking meshes for a primary road', () => {
    const f = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[106.605, 11.422], [106.607, 11.422]] }, properties: { ...props, id: 'r', featureType: 'road', highway: 'primary' } } as MapFeature;
    const g = buildRoadGeometries([f], projector);
    expect(g.road).not.toBeNull();
    expect(g.sidewalk).not.toBeNull();
    expect(g.marking).not.toBeNull();
    expect(g.centerlines[0].halfWidth).toBeCloseTo(5.5);
  });

  it('extrudes a building footprint to its height with walls facing outward', () => {
    const d = 0.0001;
    const ring = [[106.606, 11.422], [106.606 + d, 11.422], [106.606 + d, 11.422 + d], [106.606, 11.422 + d], [106.606, 11.422]];
    const f = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { ...props, id: 'b', featureType: 'building' } } as MapFeature;
    const b = buildBuildingGeometry(f, projector)!;
    expect(b.height).toBe(7);
    const box = b.geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(7);
    // ~11 m footprint, positioned at the local origin (x >= 0, north => negative z)
    expect(box.max.x - box.min.x).toBeGreaterThan(10);
    expect(box.max.z).toBeLessThanOrEqual(0.01);
  });

  it('keeps decoration off the carriageway', () => {
    const line = [[0, 0], [200, 0]] as [number, number][];
    const { trees, lamps } = planStreetDecoration([{ points: line, halfWidth: 5.5, highway: 'primary' }], [], [], { minX: -50, maxX: 250, minZ: -50, maxZ: 50 });
    expect(trees.length).toBeGreaterThan(5);
    expect(lamps.length).toBeGreaterThan(5);
    for (const t of trees) expect(Math.abs(t.z)).toBeGreaterThan(5.5 + 3);
  });
});
