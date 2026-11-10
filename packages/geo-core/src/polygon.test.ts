import { describe, expect, it } from 'vitest';
import type { LocalPoint } from '@nmap/shared-types';
import { cleanRing, ensureOrientation, isRenderableRing, pointInRing, polygonArea, ringCentroid, signedArea } from './polygon';

const square: LocalPoint[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe('polygon utils', () => {
  it('removes closing and duplicate vertices', () => {
    expect(cleanRing([[0, 0], [0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])).toHaveLength(4);
  });
  it('computes area and centroid', () => {
    const r = cleanRing(square);
    expect(polygonArea(r)).toBeCloseTo(100);
    expect(ringCentroid(r)).toEqual([5, 5]);
  });
  it('enforces orientation', () => {
    const r = cleanRing(square);
    expect(signedArea(ensureOrientation(r, true))).toBeGreaterThan(0);
    expect(signedArea(ensureOrientation(r, false))).toBeLessThan(0);
  });
  it('point in ring', () => {
    const r = cleanRing(square);
    expect(pointInRing([5, 5], r)).toBe(true);
    expect(pointInRing([15, 5], r)).toBe(false);
  });
  it('rejects degenerate rings', () => {
    expect(isRenderableRing([[0, 0], [1, 0]])).toBe(false);
    expect(isRenderableRing([[0, 0], [1, 0], [2, 0]])).toBe(false);
    expect(isRenderableRing(cleanRing(square))).toBe(true);
  });
});
