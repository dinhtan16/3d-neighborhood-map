import { describe, expect, it } from 'vitest';
import { validateBounds } from './bounds';
import { createProjector } from './projection';
import { objectTransform } from './transform';

describe('bounds validation', () => {
  it('accepts a valid small bbox', () => {
    expect(validateBounds({ minLng: 106.65, minLat: 10.76, maxLng: 106.66, maxLat: 10.77 })).toEqual([]);
  });
  it('rejects reversed ordering', () => {
    expect(validateBounds({ minLng: 106.66, minLat: 10.76, maxLng: 106.65, maxLat: 10.77 })).toContain('minLng must be less than maxLng');
  });
  it('rejects out-of-range coordinates', () => {
    expect(validateBounds({ minLng: -200, minLat: 10, maxLng: 0, maxLat: 11 })[0]).toMatch(/Longitude/);
  });
  it('rejects oversized areas', () => {
    expect(validateBounds({ minLng: 106, minLat: 10, maxLng: 107, maxLat: 11 })[0]).toMatch(/too large/);
  });
});

describe('asset transform', () => {
  it('converts geographic placement to world transform', () => {
    const p = createProjector('EPSG:32648', { lat: 10.7626, lng: 106.6602 });
    const t = objectTransform(p, { lat: 10.7626, lng: 106.6602 }, 0.5, -Math.PI / 2, { x: 2, y: 1, z: 1 });
    expect(t.position[0]).toBeCloseTo(0);
    expect(t.position[1]).toBe(0.5);
    expect(t.rotationY).toBeCloseTo((3 * Math.PI) / 2);
    expect(t.scale).toEqual([2, 1, 1]);
  });
});
