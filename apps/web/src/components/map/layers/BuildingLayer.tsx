'use client';
import { memo, useEffect, useMemo } from 'react';
import type { Projector } from '@nmap/geo-core';
import type { MapFeature, PlaceSummaryDto } from '@nmap/map-contracts';
import { defaultStyleKey, pointInRing } from '@nmap/geo-core';
import { buildBuildingGeometry, mergeLineGeometries } from '@/lib/three/geometries';
import { buildingMaterials, outlineMaterial } from '@/lib/three/materials';
import { polygonsToLocal } from '@/lib/geo/coordinates';
import { useMapStore } from '@/features/map/store';

interface Props {
  buildings: MapFeature[];
  places: PlaceSummaryDto[];
  projector: Projector;
  interactive?: boolean;
}

/**
 * Procedural buildings: one extruded mesh per footprint (pickable), all outlines
 * merged into a single LineSegments draw call.
 */
export const BuildingLayer = memo(function BuildingLayer({ buildings, places, projector, interactive = true }: Props) {
  const built = useMemo(() => {
    return buildings.flatMap((f) => {
      const b = buildBuildingGeometry(f, projector);
      if (!b) return [];
      // Associate places whose point lies inside this footprint.
      const rings = polygonsToLocal(projector, f.geometry);
      const placeId = places.find((p) => {
        const pt = projector.toLocal(p.location.lng, p.location.lat);
        return rings.some((r) => r[0] && pointInRing(pt, r[0]));
      })?.id ?? null;
      return [{ feature: f, ...b, placeId, style: f.properties.styleKey ?? defaultStyleKey(f.properties.sourceId ?? f.properties.id, f.properties.kind) }];
    });
  }, [buildings, places, projector]);

  const edges = useMemo(() => mergeLineGeometries(built.map((b) => b.edges)), [built]);

  useEffect(() => () => {
    for (const b of built) { b.geometry.dispose(); b.edges.dispose(); }
    edges?.dispose();
  }, [built, edges]);

  const hoverId = useMapStore((s) => (s.hover?.kind === 'building' ? s.hover.id : null));
  const selectedBuildingId = useMapStore((s) => s.selectedBuildingId);
  const selectedPlaceId = useMapStore((s) => s.selectedPlaceId);
  const setHover = useMapStore((s) => s.setHover);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const selectBuilding = useMapStore((s) => s.selectBuilding);

  return (
    <group>
      {built.map((b) => {
        const id = b.feature.properties.id;
        const state = selectedBuildingId === id || (b.placeId && b.placeId === selectedPlaceId) ? 'selected' : hoverId === id ? 'hover' : 'normal';
        return (
          <mesh
            key={id}
            geometry={b.geometry}
            material={buildingMaterials(b.style, state)}
            castShadow
            receiveShadow
            onPointerOver={interactive ? (e) => {
              e.stopPropagation();
              const levels = b.feature.properties.levels;
              setHover({
                id, kind: 'building',
                label: b.feature.properties.name || 'Building',
                sublabel: `${levels ? `${levels} floors · ` : ''}${b.height.toFixed(1)} m`,
                position: [b.center.x, b.height + 2, b.center.z],
              });
            } : undefined}
            onPointerOut={interactive ? () => setHover(null) : undefined}
            onClick={interactive ? (e) => {
              if (e.delta > 4) return;
              e.stopPropagation();
              if (b.placeId) selectPlace(b.placeId);
              else { selectPlace(null); selectBuilding(id); }
            } : undefined}
          />
        );
      })}
      {edges && <lineSegments geometry={edges} material={outlineMaterial()} raycast={() => null} />}
    </group>
  );
});
