import type { Geometry, Position } from 'geojson';
import type { LocalPoint } from '@nmap/shared-types';
import type { Projector } from '@nmap/geo-core';
import type { MapAreaDto } from '@nmap/map-contracts';

export const toLocal = (p: Projector, pos: Position): LocalPoint => p.toLocal(pos[0], pos[1]);

/** Polygons (outer + holes) of a Polygon/MultiPolygon in local coordinates. */
export function polygonsToLocal(p: Projector, g: Geometry): LocalPoint[][][] {
  if (g.type === 'Polygon') return [g.coordinates.map((r) => r.map((c) => toLocal(p, c)))];
  if (g.type === 'MultiPolygon') return g.coordinates.map((poly) => poly.map((r) => r.map((c) => toLocal(p, c))));
  return [];
}

/** Lines of a LineString/MultiLineString in local coordinates. */
export function linesToLocal(p: Projector, g: Geometry): LocalPoint[][] {
  if (g.type === 'LineString') return [g.coordinates.map((c) => toLocal(p, c))];
  if (g.type === 'MultiLineString') return g.coordinates.map((l) => l.map((c) => toLocal(p, c)));
  return [];
}

export function areaLocalBounds(p: Projector, area: MapAreaDto) {
  const a = p.toLocal(area.bounds.minLng, area.bounds.maxLat); // north-west
  const b = p.toLocal(area.bounds.maxLng, area.bounds.minLat); // south-east
  return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[1], b[1]), maxZ: Math.max(a[1], b[1]) };
}
