'use client';
import { useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { MapAreaDto, MapSceneDto } from '@nmap/map-contracts';
import { objectTransform } from '@nmap/geo-core';
import { projectorForArea } from '@/lib/geo/projection';
import { areaLocalBounds } from '@/lib/geo/coordinates';
import { buildRoadGeometries, planStreetDecoration } from '@/lib/three/geometries';
import { splitFeatures } from '@/lib/three/scene-utils';
import { isCategoryVisible, useMapStore } from '@/features/map/store';
import { GroundLayer } from './layers/GroundLayer';
import { RoadLayer } from './layers/RoadLayer';
import { BuildingLayer } from './layers/BuildingLayer';
import { PublicSpaceLayer } from './layers/PublicSpaceLayer';
import { DecorationLayer } from './layers/DecorationLayer';
import { PlaceLayer, type PlacePin } from './layers/PlaceLayer';
import { CustomObjectLayer, type PlacedObject } from './layers/CustomObjectLayer';
import { SelectionRing } from './interaction/SelectionManager';

export interface MapSceneProps {
  area: MapAreaDto;
  scene: MapSceneDto;
  /** Hide the read-only object layer (the map editor renders its own editable objects). */
  hideObjects?: boolean;
  showPins?: boolean;
  onGroundClick?: (point: [number, number], e: ThreeEvent<MouseEvent>) => void;
  children?: React.ReactNode;
}

/**
 * Scene hierarchy (spec §4.4):
 *   Lighting (in MapCanvas) / Ground / Roads / Buildings / PublicSpaces /
 *   Decoration / Places / CustomObjects
 * Geometry is built once per scene payload (useMemo) – never per render.
 */
export function MapScene({ area, scene, hideObjects, showPins = true, onGroundClick, children }: MapSceneProps) {
  const projector = useMemo(() => projectorForArea(area), [area]);
  const bounds = useMemo(() => areaLocalBounds(projector, area), [projector, area]);
  const parts = useMemo(() => splitFeatures(scene), [scene]);
  const roads = useMemo(() => buildRoadGeometries(parts.roads, projector), [parts.roads, projector]);
  const hidden = useMapStore((s) => s.hiddenCategories);
  const selectedPlaceId = useMapStore((s) => s.selectedPlaceId);
  const pendingFly = useMapStore((s) => s.pendingFly);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const selectBuilding = useMapStore((s) => s.selectBuilding);

  const placeById = useMemo(() => new Map(scene.places.map((p) => [p.id, p])), [scene.places]);

  const placed: PlacedObject[] = useMemo(
    () => scene.objects.map((o) => ({
      object: o,
      transform: objectTransform(projector, o.position, o.elevationM, o.rotation, o.scale),
      label: o.placeId ? placeById.get(o.placeId)?.name : undefined,
    })),
    [scene.objects, projector, placeById],
  );

  const decoration = useMemo(() => {
    const avoid = placed.map((p) => ({ x: p.transform.position[0], z: p.transform.position[2], r: 9 }));
    const treePoints = parts.trees.flatMap((t) => (t.geometry.type === 'Point' ? [projector.toLocal(t.geometry.coordinates[0], t.geometry.coordinates[1])] : []));
    return planStreetDecoration(roads.centerlines, avoid, treePoints, bounds);
  }, [placed, parts.trees, projector, roads.centerlines, bounds]);

  const visiblePlaceIds = useMemo(
    () => new Set(scene.places.filter((p) => isCategoryVisible(hidden, p.category?.slug)).map((p) => p.id)),
    [scene.places, hidden],
  );

  const pins: PlacePin[] = useMemo(() => {
    const objByPlace = new Map(placed.filter((p) => p.object.placeId).map((p) => [p.object.placeId!, p]));
    return scene.places.filter((p) => visiblePlaceIds.has(p.id)).map((place) => {
      const o = objByPlace.get(place.id);
      if (o) return { place, x: o.transform.position[0], z: o.transform.position[2] };
      const [x, z] = projector.toLocal(place.location.lng, place.location.lat);
      return { place, x, z };
    });
  }, [scene.places, visiblePlaceIds, placed, projector]);

  const visibleObjects = useMemo(
    () => placed.filter((p) => !p.object.placeId || visiblePlaceIds.has(p.object.placeId)),
    [placed, visiblePlaceIds],
  );

  // Fly to a place selected from search / list.
  const command = useMapStore((s) => s.command);
  const consumeFly = useMapStore((s) => s.consumeFly);
  useEffect(() => {
    if (!pendingFly || !selectedPlaceId) return;
    const pin = pins.find((p) => p.place.id === selectedPlaceId);
    const place = placeById.get(selectedPlaceId);
    if (pin) command({ type: 'fly', target: [pin.x, pin.z] });
    else if (place) command({ type: 'fly', target: projector.toLocal(place.location.lng, place.location.lat) });
    consumeFly();
  }, [pendingFly, selectedPlaceId, pins, placeById, projector, command, consumeFly]);

  const selectedPin = pins.find((p) => p.place.id === selectedPlaceId);
  const selectedHasObject = selectedPlaceId && placed.some((p) => p.object.placeId === selectedPlaceId);

  return (
    <group>
      <GroundLayer bounds={bounds} onGroundClick={onGroundClick ?? (() => { selectPlace(null); selectBuilding(null); })} />
      <PublicSpaceLayer spaces={parts.spaces} water={parts.water} projector={projector} />
      <RoadLayer roads={roads} />
      <BuildingLayer buildings={parts.buildings} places={scene.places} projector={projector} interactive={!onGroundClick} />
      <DecorationLayer trees={decoration.trees} lamps={decoration.lamps} />
      {!hideObjects && <CustomObjectLayer objects={visibleObjects} />}
      {showPins && <PlaceLayer pins={pins} />}
      {selectedPin && !selectedHasObject && <SelectionRing position={[selectedPin.x, selectedPin.z]} radius={0.6} />}
      {children}
    </group>
  );
}
