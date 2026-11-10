'use client';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { STYLE_V2 } from '@nmap/map-config';
import type { ChunkBuild } from '@/lib/three/chunk-builder';
import type { DecorationInstance } from '@/lib/three/geometries';
import type { PropInstance } from '@/lib/three/building-mesh';
import { buildingMaterial, pavingMaterial, propMaterial } from '@/lib/three/style-materials';
import { registerChunk, registerRoadLines, unregisterChunk, unregisterRoadLines, useLoadedPlaces } from '@/features/map/world-index';
import { isCategoryVisible, useMapStore } from '@/features/map/store';
import { PlaceLayer } from './layers/PlaceLayer';
import { CustomObjectLayer } from './layers/CustomObjectLayer';

// ---------- shared prop geometry ----------
const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2.4, 6).translate(0, 1.2, 0);
const canopyRound = new THREE.IcosahedronGeometry(2.1, 1).translate(0, 3.8, 0);
const canopyRubber = new THREE.SphereGeometry(1.7, 8, 6).scale(1, 1.35, 1).translate(0, 4.6, 0);
const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 6, 6).translate(0, 3, 0);
const lampHead = new THREE.BoxGeometry(0.3, 0.2, 1.3).translate(0, 5.95, 0.6);
// awning: sloped canvas (+Z forward), 1 m wide in X (scaled by instance), 1.3 m deep
const awningBase = new THREE.BoxGeometry(1, 0.08, 1.35).rotateX(0.38).translate(0, 0, 0.62);
const awningStripes = (() => {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) parts.push(new THREE.BoxGeometry(0.1, 0.1, 1.37).rotateX(0.38).translate(-0.4 + i * 0.2, 0.012, 0.62));
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let off = 0;
  for (const p of parts) {
    const g = p.toNonIndexed();
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    for (let i = 0; i < g.getAttribute('position').count; i++) idx.push(off + i);
    off += g.getAttribute('position').count;
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setIndex(idx);
  return merged;
})();
const tankGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.6, 12).rotateZ(Math.PI / 2).translate(0, 0.95, 0);
const tankLegs = new THREE.BoxGeometry(1.2, 0.4, 0.8).translate(0, 0.2, 0);

const AWNING_COLORS = STYLE_V2.awningColors.map((c) => new THREE.Color(c));
const TANK_COLORS = [new THREE.Color('#5c9ad6'), new THREE.Color('#d9dde3')];

function Instances({ items, geometry, material, colors }: {
  items: (DecorationInstance | PropInstance)[]; geometry: THREE.BufferGeometry; material: THREE.Material; colors?: THREE.Color[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3(), s = new THREE.Vector3();
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rotation);
      if ('sx' in it) { p.set(it.x, it.y, it.z); s.set(it.sx, it.sy, it.sz); }
      else { p.set(it.x, 0, it.z); s.setScalar(it.scale); }
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (colors) mesh.setColorAt(i, colors[('color' in it ? it.color : it.variant) % colors.length]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, colors]);
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} frustumCulled raycast={() => null} />;
}

interface Props { build: ChunkBuild; interactive?: boolean; showObjects?: boolean; showPins?: boolean }

/** Renders one 500 m chunk. All heavy geometry was built once in buildChunk(). */
export const ChunkView = memo(function ChunkView({ build, interactive = true, showObjects = true, showPins = true }: Props) {
  const hidden = useMapStore((s) => s.hiddenCategories);
  const selectedPlaceId = useMapStore((s) => s.selectedPlaceId);
  const selectedBuildingId = useMapStore((s) => s.selectedBuildingId);
  const hover = useMapStore((s) => s.hover);
  const setHover = useMapStore((s) => s.setHover);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const selectBuilding = useMapStore((s) => s.selectBuilding);
  const setLoadedPlaces = useLoadedPlaces((s) => s.setChunk);

  // per-chunk building material (own highlight uniform; shares program + fog uniforms)
  const bMat = useMemo(() => {
    const base = buildingMaterial();
    const m = new THREE.ShaderMaterial({ vertexShader: base.vertexShader, fragmentShader: base.fragmentShader, vertexColors: true, uniforms: { ...base.uniforms, uHighlight: { value: -1 } } });
    return m;
  }, []);

  useEffect(() => {
    registerChunk(build.key, build.collisionRings, build.namedRoads);
    registerRoadLines(build.key, build.roadLines);
    setLoadedPlaces(build.key, build.pins);
    return () => {
      unregisterChunk(build.key);
      unregisterRoadLines(build.key);
      setLoadedPlaces(build.key, null);
    };
  }, [build, setLoadedPlaces]);

  useEffect(() => () => {
    const r = build.roads;
    for (const g of [r.road, r.service, r.foot, r.sidewalk, r.curb, r.marking, build.buildings, ...Object.values(build.landuse)]) g?.dispose();
    bMat.dispose();
  }, [build, bMat]);

  // building highlight: hovered or selected building in this chunk
  useEffect(() => {
    const sel = build.buildingMetas.find((b) => b.id === selectedBuildingId || (b.placeId && b.placeId === selectedPlaceId));
    const hov = hover?.kind === 'building' ? build.buildingMetas.find((b) => b.id === hover.id) : undefined;
    bMat.uniforms.uHighlight.value = sel?.index ?? hov?.index ?? -1;
  }, [selectedBuildingId, selectedPlaceId, hover, build, bMat]);

  const pins = useMemo(() => build.pins.filter((p) => isCategoryVisible(hidden, p.place.category?.slug)), [build.pins, hidden]);
  const visiblePlaceIds = useMemo(() => new Set(pins.map((p) => p.place.id)), [pins]);
  const objects = useMemo(() => build.objects.filter((o) => !o.object.placeId || visiblePlaceIds.has(o.object.placeId)), [build.objects, visiblePlaceIds]);

  const metaOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const a = e.face ? (build.buildings!.getAttribute('aBid').array as Float32Array)[e.face.a] : -1;
    return build.buildingMetas[a];
  };

  const L = build.landuse;
  const R = build.roads;
  const trunks = build.trees;
  const round = useMemo(() => build.trees.filter((t) => t.variant === 0), [build.trees]);
  const rubber = useMemo(() => build.trees.filter((t) => t.variant === 1), [build.trees]);

  return (
    <group>
      {L.farmland && <mesh geometry={L.farmland} material={pavingMaterial('#a9d27c', '#97c26a', 3, 1.2, 1)} />}
      {L.forest && <mesh geometry={L.forest} material={pavingMaterial(STYLE_V2.grassDark, '#4f9443', 3, 1.2, 1)} />}
      {L.residential && <mesh geometry={L.residential} material={pavingMaterial('#ecd3c2', '#e4c6b3', 1, 3.2, 1)} />}
      {L.commercial && <mesh geometry={L.commercial} material={pavingMaterial('#f0c4c4', '#dda4a8', 2, 0.9, 2)} />}
      {L.industrial && <mesh geometry={L.industrial} material={pavingMaterial('#d6d2dc', '#c4bfcc', 1, 4, 2)} />}
      {L.park && <mesh geometry={L.park} material={pavingMaterial('#8fd06d', '#7cbf5c', 3, 1.2, 3)} />}
      {L.plaza && <mesh geometry={L.plaza} material={pavingMaterial(STYLE_V2.brick, STYLE_V2.brickLine, 2, 0.45, 4)} />}
      {L.water && <mesh geometry={L.water} material={pavingMaterial(STYLE_V2.water, '#5aa9c9', 0, 1.2, 3)} />}

      {R.foot && <mesh geometry={R.foot} material={pavingMaterial(STYLE_V2.brick, STYLE_V2.brickLine, 2, 0.4, 4)} />}
      {R.sidewalk && <mesh geometry={R.sidewalk} material={pavingMaterial(STYLE_V2.sidewalk, STYLE_V2.sidewalkLine, 1, 1.4, 5)} />}
      {R.curb && <mesh geometry={R.curb} material={pavingMaterial(STYLE_V2.curb, STYLE_V2.curb, 0, 1.2, 6)} />}
      {R.service && <mesh geometry={R.service} material={pavingMaterial(STYLE_V2.roadService, STYLE_V2.roadService, 0, 1.2, 7)} />}
      {R.road && <mesh geometry={R.road} material={pavingMaterial(STYLE_V2.road, STYLE_V2.road, 0, 1.2, 8)} />}
      {R.marking && <mesh geometry={R.marking} material={pavingMaterial(STYLE_V2.roadLine, STYLE_V2.roadLine, 0, 1.2, 9)} />}

      {build.buildings && (
        <mesh
          geometry={build.buildings}
          material={bMat}
          userData={{ kind: 'buildings', build }}
          onPointerMove={interactive ? (e) => {
            e.stopPropagation();
            const m = metaOf(e);
            if (!m) return;
            setHover({ id: m.id, kind: 'building', label: m.name || (m.placeId ? build.pins.find((p) => p.place.id === m.placeId)?.place.name ?? 'Nhà' : 'Nhà'), sublabel: `${m.levels ? `${m.levels} tầng · ` : ''}${m.height.toFixed(0)} m`, position: [m.centroid[0], m.height + 3, m.centroid[1]] });
          } : undefined}
          onPointerOut={interactive ? () => setHover(null) : undefined}
          onClick={interactive ? (e) => {
            if (e.delta > 4) return;
            e.stopPropagation();
            const m = metaOf(e);
            if (!m) return;
            if (m.placeId) selectPlace(m.placeId);
            else { selectPlace(null); selectBuilding(m.id, { name: m.name, levels: m.levels, height: m.height }); }
          } : undefined}
        />
      )}

      <Instances items={build.awnings} geometry={awningBase} material={propMaterial('#ffffff', { instanceColor: true })} colors={AWNING_COLORS} />
      <Instances items={build.awnings} geometry={awningStripes} material={propMaterial('#fff6e8')} />
      <Instances items={build.tanks} geometry={tankGeo} material={propMaterial('#ffffff', { instanceColor: true })} colors={TANK_COLORS} />
      <Instances items={build.tanks} geometry={tankLegs} material={propMaterial('#7d7480')} />
      <Instances items={trunks} geometry={trunkGeo} material={propMaterial('#8a5a3c')} />
      <Instances items={round} geometry={canopyRound} material={propMaterial('#79c25a')} />
      <Instances items={rubber} geometry={canopyRubber} material={propMaterial('#4f9e4f')} />
      <Instances items={build.lamps} geometry={poleGeo} material={propMaterial('#3e4a5c')} />
      <Instances items={build.lamps} geometry={lampHead} material={propMaterial('#3e4a5c')} />

      {showObjects && objects.length > 0 && <CustomObjectLayer objects={objects} />}
      {showPins && pins.length > 0 && <PlaceLayer pins={pins} />}
    </group>
  );
});
