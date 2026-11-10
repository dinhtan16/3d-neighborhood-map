export { createProjector, suggestUtmCrs, type Projector } from '@nmap/geo-core';
import { createProjector, type Projector } from '@nmap/geo-core';
import type { MapAreaDto } from '@nmap/map-contracts';

const cache = new Map<string, Projector>();
/** One stable projector per area (same origin => same world positions). */
export function projectorForArea(area: Pick<MapAreaDto, 'id' | 'crs' | 'origin'>): Projector {
  const key = `${area.id}|${area.crs}|${area.origin.lat}|${area.origin.lng}`;
  let p = cache.get(key);
  if (!p) {
    p = createProjector(area.crs, area.origin);
    cache.set(key, p);
  }
  return p;
}
