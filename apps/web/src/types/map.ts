export type {
  MapAreaDto, MapAssetDto, MapFeature, MapFeatureCollection, MapFeatureProperties,
  MapObjectDto, MapSceneDto, MapSceneMeta,
} from '@nmap/map-contracts';

/** Shape of public/demo-data/<slug>.json produced by `pnpm --filter api export:static`. */
export interface StaticDemoBundle {
  generatedAt: string;
  area: import('@nmap/map-contracts').MapAreaDto;
  categories: import('@nmap/map-contracts').PlaceCategoryDto[];
  assets: import('@nmap/map-contracts').MapAssetDto[];
  scene: import('@nmap/map-contracts').MapSceneDto;
  placeDetails: Record<string, import('@nmap/map-contracts').PlaceDetailDto>;
}
