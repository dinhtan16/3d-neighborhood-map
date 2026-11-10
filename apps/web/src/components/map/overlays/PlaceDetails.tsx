'use client';
import { useEffect, useState } from 'react';
import type { MapFeature, PlaceDetailDto } from '@nmap/map-contracts';
import { categoryColor } from '@nmap/map-config';
import { fetchPlace } from '@/lib/api/client';
import { useMapStore } from '@/features/map/store';

/** Plain React HTML panel (not WebGL UI). */
export function PlaceDetails({ buildings }: { buildings: MapFeature[] }) {
  const placeId = useMapStore((s) => s.selectedPlaceId);
  const buildingId = useMapStore((s) => s.selectedBuildingId);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const selectBuilding = useMapStore((s) => s.selectBuilding);
  const command = useMapStore((s) => s.command);
  const [place, setPlace] = useState<PlaceDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!placeId) { setPlace(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPlace(placeId)
      .then((p) => !cancelled && setPlace(p))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [placeId]);

  const building = buildingId ? buildings.find((b) => b.properties.id === buildingId) : null;
  if (!placeId && !building) return null;

  const close = () => { selectPlace(null); selectBuilding(null); };

  if (building) {
    const p = building.properties;
    return (
      <aside className="details" aria-label="Building details">
        <button className="close" onClick={close} aria-label="Close">×</button>
        <p className="eyebrow">Building</p>
        <h2>{p.name || 'Unnamed building'}</h2>
        <dl>
          <dt>Height</dt><dd>{p.height?.toFixed(1)} m</dd>
          {p.levels && (<><dt>Floors</dt><dd>{p.levels}</dd></>)}
          <dt>Source</dt><dd>{p.source === 'osm' ? `OpenStreetMap ${p.sourceId ?? ''}` : 'Manual'}</dd>
        </dl>
      </aside>
    );
  }

  return (
    <aside className="details" aria-label="Place details" aria-busy={loading}>
      <button className="close" onClick={close} aria-label="Close">×</button>
      {error && <p className="error">{error}</p>}
      {!place && !error && <p className="muted">Đang tải…</p>}
      {place && (
        <>
          {place.images[0] ? (
            <div className="gallery">
              {place.images.map((img) => <img key={img.id} src={img.imageUrl} alt={img.altText ?? place.name} loading="lazy" />)}
            </div>
          ) : (
            <div className="gallery placeholder" style={{ background: categoryColor(place.category?.slug) }}>
              <span>{place.name.slice(0, 1)}</span>
            </div>
          )}
          <p className="eyebrow" style={{ color: categoryColor(place.category?.slug) }}>{place.category?.name ?? 'Place'}</p>
          <h2>{place.name}</h2>
          {place.description && <p>{place.description}</p>}
          <dl>
            {place.address && (<><dt>Địa chỉ</dt><dd>{place.address}</dd></>)}
            {place.phone && (<><dt>Điện thoại</dt><dd><a href={`tel:${place.phone}`}>{place.phone}</a></dd></>)}
            <dt>GPS</dt><dd className="mono">{place.location.lat.toFixed(6)}, {place.location.lng.toFixed(6)}</dd>
            <dt>Nguồn</dt><dd>{place.source === 'osm' ? 'OpenStreetMap' : 'Admin'}</dd>
          </dl>
          <div className="row">
            <button className="btn" onClick={() => selectPlace(place.id, { fly: true })}>Zoom tới</button>
            <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${place.location.lat}&mlon=${place.location.lng}#map=19/${place.location.lat}/${place.location.lng}`}>OSM ↗</a>
            <button className="btn ghost" onClick={() => command({ type: 'reset' })}>Reset view</button>
          </div>
        </>
      )}
    </aside>
  );
}
