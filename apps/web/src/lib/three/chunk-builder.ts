import type * as THREE from 'three';
import type { LocalPoint } from '@nmap/shared-types';
import type { Projector } from '@nmap/geo-core';
import { objectTransform, pointInRing, type ObjectTransform } from '@nmap/geo-core';
import type { MapChunkDto, MapFeature, MapObjectDto, PlaceSummaryDto } from '@nmap/map-contracts';
import { CHUNK_SIZE_M, roadWidthFor } from '@nmap/map-config';
import { linesToLocal, polygonsToLocal } from '@/lib/geo/coordinates';
import { buildFlatPolygons, buildRoadGeometries, planStreetDecoration, type DecorationInstance, type RoadGeometrySet } from './geometries';
import { buildBuildings, type BuildingMeta, type PropInstance } from './building-mesh';

export interface ChunkBuild {
  key: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: RoadGeometrySet;
  landuse: Record<'residential' | 'commercial' | 'industrial' | 'farmland' | 'forest' | 'park' | 'water' | 'plaza', THREE.BufferGeometry | null>;
  buildings: THREE.BufferGeometry | null;
  buildingMetas: BuildingMeta[];
  awnings: PropInstance[];
  tanks: PropInstance[];
  trees: DecorationInstance[];
  lamps: DecorationInstance[];
  objects: { object: MapObjectDto; transform: ObjectTransform; label?: string }[];
  pins: { place: PlaceSummaryDto; x: number; z: number }[];
  collisionRings: LocalPoint[][];
  namedRoads: { points: LocalPoint[]; name: string | null }[];
  /** Road centre lines for traffic / pedestrians (deduped across chunks by id). */
  roadLines: { id: string; points: LocalPoint[]; highway: string; halfWidth: number }[];
  stats: { buildings: number; roads: number; trees: number; ms: number };
}

const LANDUSE_GROUP: Record<string, keyof ChunkBuild['landuse']> = {
  residential: 'residential', commercial: 'commercial', retail: 'commercial', industrial: 'industrial',
  farmland: 'farmland', orchard: 'farmland', meadow: 'farmland', grass: 'park', recreation_ground: 'park',
  forest: 'forest', wood: 'forest', scrub: 'forest', park: 'park', garden: 'park', playground: 'park', pitch: 'park',
  cemetery: 'park', religious: 'plaza', marketplace: 'plaza', square: 'plaza', school: 'plaza', parking: 'plaza',
  water: 'water', river: 'water', basin: 'water', reservoir: 'water',
};

export function chunkLocalBounds(cx: number, cz: number, size = CHUNK_SIZE_M) {
  return { minX: cx * size, maxX: (cx + 1) * size, minZ: cz * size, maxZ: (cz + 1) * size };
}

/** Deterministic random */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

export function buildChunk(data: MapChunkDto, projector: Projector): ChunkBuild {
  const t0 = performance.now();
  const { cx, cz } = data.chunk;
  const key = `${cx}_${cz}`;
  const bounds = chunkLocalBounds(cx, cz, data.chunk.sizeM || CHUNK_SIZE_M);
  const feats = data.features.features;

  const roadsF: MapFeature[] = [];
  const buildingsF: MapFeature[] = [];
  const treesF: MapFeature[] = [];
  const landGroups: Record<string, MapFeature[]> = {};
  for (const f of feats) {
    const t = f.properties.featureType;
    if (t === 'road') {
      if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') roadsF.push(f);
      else (landGroups.plaza ??= []).push(f); // pedestrian areas
    } else if (t === 'building') buildingsF.push(f);
    else if (t === 'tree') treesF.push(f);
    else if (t === 'water' && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) {
      // rivers / streams drawn as wide ribbons in the water group via a fake road class
      roadsF.push({ ...f, properties: { ...f.properties, highway: '__water', widthM: f.properties.widthM ?? 6 } });
    } else {
      const g = t === 'park' ? 'park' : t === 'water' ? 'water' : LANDUSE_GROUP[f.properties.kind ?? ''] ?? (t === 'public_space' ? 'plaza' : null);
      if (g) (landGroups[g] ??= []).push(f);
    }
  }

  const waterLines = roadsF.filter((f) => f.properties.highway === '__water');
  const realRoads = roadsF.filter((f) => f.properties.highway !== '__water');
  const roads = buildRoadGeometries(realRoads, projector);

  // Places / objects (by point – the API assigns them to exactly one chunk)
  const placeById = new Map(data.places.map((p) => [p.id, p]));
  const objects = data.objects.map((o) => ({
    object: o,
    transform: objectTransform(projector, o.position, o.elevationM, o.rotation, o.scale),
    label: o.placeId ? placeById.get(o.placeId)?.name : undefined,
  }));

  // Buildings
  const buildingRings: LocalPoint[][] = [];
  const inputs = buildingsF.flatMap((f) => polygonsToLocal(projector, f.geometry).map((rings, i) => {
    if (rings[0]) buildingRings.push(rings[0]);
    return {
      id: i ? `${f.properties.id}#${i}` : f.properties.id,
      rings,
      height: f.properties.height ?? 6,
      levels: f.properties.levels,
      kind: f.properties.kind,
      name: f.properties.name ?? null,
      placeId: null as string | null,
    };
  }));
  // Places that sit inside a footprint make that building pickable as the place.
  for (const p of data.places) {
    const pt = projector.toLocal(p.location.lng, p.location.lat);
    const hit = inputs.find((b) => b.rings[0] && pointInRing(pt, b.rings[0]));
    if (hit) hit.placeId = p.id;
  }

  // Road proximity for awnings / decoration
  const deco0 = planStreetDecoration(roads.centerlines, [], [], bounds, 0);
  const roadProbe = (p: LocalPoint) => deco0.index.edgeDistance(p);
  const built = buildBuildings(inputs, roadProbe);

  // Building blocker grid for tree placement
  const blocked = makeBlocker(buildingRings);
  const avoid = objects.map((o) => ({ x: o.transform.position[0], z: o.transform.position[2], r: 8 }));
  const treePoints = treesF.flatMap((t) => (t.geometry.type === 'Point' ? [projector.toLocal(t.geometry.coordinates[0], t.geometry.coordinates[1])] : []));
  const deco = planStreetDecoration(roads.centerlines, avoid, treePoints, bounds, 1400, blocked);

  // Forest / orchard fill (rubber plantations are everywhere around Chơn Thành)
  const rand = rng((cx * 73856093) ^ (cz * 19349663));
  const forestTrees: DecorationInstance[] = [];
  for (const f of [...(landGroups.forest ?? []), ...((landGroups.farmland ?? []).filter((f) => f.properties.kind === 'orchard'))]) {
    for (const rings of polygonsToLocal(projector, f.geometry)) {
      const outer = rings[0];
      if (!outer) continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of outer) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      minX = Math.max(minX, bounds.minX); maxX = Math.min(maxX, bounds.maxX); minZ = Math.max(minZ, bounds.minZ); maxZ = Math.min(maxZ, bounds.maxZ);
      const step = 9;
      for (let x = minX + step / 2; x < maxX && forestTrees.length < 1800; x += step) {
        for (let z = minZ + step / 2; z < maxZ && forestTrees.length < 1800; z += step) {
          const p: LocalPoint = [x + (rand() - 0.5) * 4, z + (rand() - 0.5) * 4];
          if (!pointInRing(p, outer) || rings.slice(1).some((h) => pointInRing(p, h))) continue;
          if (deco0.index.edgeDistance(p) < 2 || blocked(p)) continue;
          forestTrees.push({ x: p[0], z: p[1], rotation: rand() * 6.28, scale: 0.9 + rand() * 0.6, variant: rand() < 0.65 ? 1 : 0 });
        }
      }
    }
  }

  const flat = (g: string, y: number) => buildFlatPolygons(landGroups[g] ?? [], projector, y);
  const waterGeo = flat('water', 0.012);
  const water = waterLines.length ? mergeWater(waterGeo, waterLines, projector) : waterGeo;

  return {
    key,
    bounds,
    roads,
    landuse: {
      residential: flat('residential', 0.004),
      commercial: flat('commercial', 0.005),
      industrial: flat('industrial', 0.005),
      farmland: flat('farmland', 0.006),
      forest: flat('forest', 0.007),
      park: flat('park', 0.008),
      plaza: flat('plaza', 0.01),
      water,
    },
    buildings: built.geometry,
    buildingMetas: built.metas,
    awnings: built.awnings,
    tanks: built.tanks,
    trees: [...deco.trees, ...forestTrees],
    lamps: deco.lamps,
    objects,
    pins: data.places.map((place) => {
      const o = objects.find((x) => x.object.placeId === place.id);
      if (o) return { place, x: o.transform.position[0], z: o.transform.position[2] };
      const [x, z] = projector.toLocal(place.location.lng, place.location.lat);
      return { place, x, z };
    }),
    collisionRings: buildingRings,
    roadLines: realRoads.flatMap((f) => linesToLocal(projector, f.geometry).map((points, i) => ({
      id: `${f.properties.id}#${i}`, points, highway: f.properties.highway ?? 'unclassified',
      halfWidth: (f.properties.widthM ?? roadWidthFor(f.properties.highway ?? undefined)) / 2,
    }))),
    namedRoads: realRoads.flatMap((f) => linesToLocal(projector, f.geometry).map((points) => ({ points, name: f.properties.name ?? null }))),
    stats: { buildings: built.metas.length, roads: realRoads.length, trees: deco.trees.length + forestTrees.length, ms: Math.round(performance.now() - t0) },
  };
}

function makeBlocker(rings: LocalPoint[][]) {
  const CELL = 20;
  const grid = new Map<string, LocalPoint[][]>();
  for (const r of rings) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    for (let x = Math.floor((minX - 2) / CELL); x <= Math.floor((maxX + 2) / CELL); x++)
      for (let z = Math.floor((minZ - 2) / CELL); z <= Math.floor((maxZ + 2) / CELL); z++) {
        const k = `${x},${z}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(r);
      }
  }
  return (p: LocalPoint) => {
    const l = grid.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`);
    if (!l) return false;
    for (const r of l) {
      if (pointInRing(p, r)) return true;
      for (const [ox, oz] of [[1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8]]) if (pointInRing([p[0] + ox, p[1] + oz], r)) return true;
    }
    return false;
  };
}

import { buildRibbon, emptyStrip } from '@nmap/geo-core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stripToGeometry } from './geometries';
function mergeWater(poly: THREE.BufferGeometry | null, lines: MapFeature[], projector: Projector) {
  const strip = emptyStrip();
  for (const f of lines) for (const l of linesToLocal(projector, f.geometry)) buildRibbon(l, f.properties.widthM ?? 6, 0.012, { roundCaps: true }, strip);
  const g = stripToGeometry(strip);
  if (!g) return poly;
  if (!poly) return g;
  const a = poly.index ? poly.toNonIndexed() : poly;
  if (a.getAttribute('uv')) a.deleteAttribute('uv');
  const b = g.toNonIndexed();
  return mergeGeometries([a, b], false) ?? poly;
}
