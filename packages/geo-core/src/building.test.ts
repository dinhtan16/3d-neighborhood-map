import { describe, expect, it } from 'vitest';
import { defaultStyleKey, fnv1a, parseLengthM, resolveBuildingHeight } from './building';

describe('building height policy', () => {
  it('uses actual height first', () => {
    expect(resolveBuildingHeight({ height: '12.5 m', levels: 2 })).toEqual({ heightM: 12.5, levels: 2, estimated: false });
  });
  it('derives height from levels at 3.5 m per floor', () => {
    expect(resolveBuildingHeight({ levels: '1' }).heightM).toBe(3.5);
    expect(resolveBuildingHeight({ levels: 2 }).heightM).toBe(7);
    expect(resolveBuildingHeight({ levels: 3 }).heightM).toBe(10.5);
  });
  it('falls back to the 6 m default', () => {
    expect(resolveBuildingHeight({})).toEqual({ heightM: 6, levels: null, estimated: true });
    expect(resolveBuildingHeight({ height: 'tall', levels: 'many' }).heightM).toBe(6);
  });
  it('parses feet', () => {
    expect(parseLengthM("10'")).toBeCloseTo(3.048);
  });
  it('hash is stable (matches Python implementation)', () => {
    expect(fnv1a('way/123')).toBe(fnv1a('way/123'));
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(defaultStyleKey('x', 'school')).toBe('civic-sand');
  });
});
