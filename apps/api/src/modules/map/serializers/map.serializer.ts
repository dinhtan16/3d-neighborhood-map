import type { MapAreaDto, MapFeature } from '@nmap/map-contracts';

export function toAreaDto(r: any): MapAreaDto {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    crs: r.crs,
    origin: { lat: r.origin_lat, lng: r.origin_lng },
    bounds: { minLat: r.min_lat, maxLat: r.max_lat, minLng: r.min_lng, maxLng: r.max_lng },
    boundary: r.boundary,
  };
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function toFeature(r: any): MapFeature {
  const n = r.normalized ?? {};
  const tags = r.tags ?? {};
  return {
    type: 'Feature',
    id: r.id,
    geometry: r.geom,
    properties: {
      id: r.id,
      featureType: r.feature_type,
      source: r.source,
      sourceId: r.source_id,
      height: num(r.height_m),
      levels: num(r.levels),
      styleKey: r.style_key,
      name: n.name ?? tags.name ?? null,
      highway: n.highway ?? tags.highway ?? null,
      widthM: num(n.widthM),
      surface: n.surface ?? tags.surface ?? null,
      roofShape: n.roofShape ?? tags['roof:shape'] ?? null,
      kind: n.kind ?? null,
      layer: num(n.layer ?? tags.layer),
    },
  };
}
