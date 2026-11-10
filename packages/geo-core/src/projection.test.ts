import { describe, expect, it } from 'vitest';
import { createProjector, projDefinitionFor, suggestUtmCrs } from './projection';

// Reference values computed with PostGIS: ST_Transform(point, 32648).
const ORIGIN = { lat: 10.7626, lng: 106.6602 };
const ORIGIN_UTM: [number, number] = [681534.0003354505, 1190221.447576911];
const P2 = { lat: 10.7636, lng: 106.6612 };
const P2_UTM: [number, number] = [681642.7746064476, 1190332.6520420925];

describe('projection', () => {
  it('suggests UTM 48N for Ho Chi Minh City', () => {
    expect(suggestUtmCrs(106.66, 10.76)).toBe('EPSG:32648');
    expect(suggestUtmCrs(-58.4, -34.6)).toBe('EPSG:32721');
  });

  it('rejects unsupported CRS codes', () => {
    expect(() => projDefinitionFor('EPSG:9999')).toThrow();
  });

  it('matches PostGIS UTM output to the millimetre', () => {
    const p = createProjector('EPSG:32648', ORIGIN);
    const [e, n] = p.toProjected(P2.lng, P2.lat);
    expect(e).toBeCloseTo(P2_UTM[0], 2);
    expect(n).toBeCloseTo(P2_UTM[1], 2);
    expect(p.originProjected[0]).toBeCloseTo(ORIGIN_UTM[0], 2);
  });

  it('places the origin at local (0, 0)', () => {
    const p = createProjector('EPSG:32648', ORIGIN);
    const [x, z] = p.toLocal(ORIGIN.lng, ORIGIN.lat);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('maps east to +X and north to -Z with metric offsets', () => {
    const p = createProjector('EPSG:32648', ORIGIN);
    const [x, z] = p.toLocal(P2.lng, P2.lat);
    expect(x).toBeCloseTo(P2_UTM[0] - ORIGIN_UTM[0], 2); // ~108.77 m east
    expect(z).toBeCloseTo(-(P2_UTM[1] - ORIGIN_UTM[1]), 2); // ~111.2 m north => negative z
    // Planar distance should be close to the geodesic distance (155.56 m from PostGIS).
    expect(Math.hypot(x, z)).toBeGreaterThan(155);
    expect(Math.hypot(x, z)).toBeLessThan(156.5);
  });

  it('round-trips local -> geo -> local', () => {
    const p = createProjector('EPSG:32648', ORIGIN);
    const [x, z] = p.toLocal(106.66311, 10.76012);
    const back = p.toGeo(x, z);
    expect(back.lng).toBeCloseTo(106.66311, 9);
    expect(back.lat).toBeCloseTo(10.76012, 9);
  });

  it('is deterministic for the same area origin', () => {
    const a = createProjector('EPSG:32648', ORIGIN).toLocal(106.6595, 10.7631);
    const b = createProjector('EPSG:32648', { ...ORIGIN }).toLocal(106.6595, 10.7631);
    expect(a).toEqual(b);
  });
});
