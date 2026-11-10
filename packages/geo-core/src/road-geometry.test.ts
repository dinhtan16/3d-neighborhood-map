import { describe, expect, it } from 'vitest';
import { buildRibbon, dashSegments, polylineLength, samplesAlong } from './road-geometry';

function triangleNormalsY(positions: number[], indices: number[]): number[] {
  const ys: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map((k) => [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    ys.push(u[2] * v[0] - u[0] * v[2]); // y component of u x v
  }
  return ys;
}

describe('road geometry', () => {
  it('builds a straight ribbon of the requested width', () => {
    const g = buildRibbon([[0, 0], [100, 0]], 8, 0.05);
    expect(g.positions).toHaveLength(4 * 3);
    expect(g.indices).toHaveLength(6);
    const zs = [g.positions[2], g.positions[5]];
    expect(Math.abs(zs[0] - zs[1])).toBeCloseTo(8);
    expect(g.positions[1]).toBeCloseTo(0.05);
  });

  it('produces upward-facing triangles', () => {
    const g = buildRibbon([[0, 0], [50, 0], [50, 50], [80, 90]], 6, 0, { roundCaps: true });
    for (const ny of triangleNormalsY(g.positions, g.indices)) expect(ny).toBeGreaterThan(0);
  });

  it('limits miter length on sharp turns', () => {
    const g = buildRibbon([[0, 0], [50, 0], [0, 1]], 4, 0, { miterLimit: 2 });
    for (let i = 0; i < g.positions.length; i += 3) {
      expect(Math.abs(g.positions[i])).toBeLessThan(60);
    }
  });

  it('ignores degenerate input', () => {
    expect(buildRibbon([[1, 1], [1, 1]], 5).positions).toHaveLength(0);
  });

  it('splits lines into dashes', () => {
    const dashes = dashSegments([[0, 0], [20, 0]], 3, 2);
    expect(dashes.length).toBe(4);
    expect(polylineLength(dashes[0])).toBeCloseTo(3);
  });

  it('samples points along a line with side offset', () => {
    const s = samplesAlong([[0, 0], [100, 0]], 25, 5);
    expect(s).toHaveLength(4);
    expect(s[0].point[0]).toBeCloseTo(12.5);
    expect(Math.abs(s[0].point[1])).toBeCloseTo(5);
  });
});
