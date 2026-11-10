'use client';
import { useEffect, useState } from 'react';
import type { PlaceDetailDto } from '@nmap/map-contracts';
import { categoryColor } from '@nmap/map-config';
import { fetchPlace } from '@/lib/api/client';
import { useMapStore } from '@/features/map/store';

/** Plain React HTML panel (not WebGL UI). */
export function PlaceDetails() {
  const placeId = useMapStore((s) => s.selectedPlaceId);
  const buildingId = useMapStore((s) => s.selectedBuildingId);
  const buildingInfo = useMapStore((s) => s.selectedBuildingInfo);
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

  const building = buildingId && buildingInfo ? buildingInfo : null;
  if (!placeId && !building) return null;

  const close = () => { selectPlace(null); selectBuilding(null); };

  if (building) {
    return (
      <aside className="details" aria-label="Building details">
        <button className="close" onClick={close} aria-label="Đóng">×</button>
        <p className="eyebrow">Công trình</p>
        <h2>{building.name || 'Nhà chưa có tên'}</h2>
        <dl>
          <dt>Chiều cao</dt><dd>~{building.height.toFixed(0)} m</dd>
          {building.levels && (<><dt>Số tầng</dt><dd>{building.levels} (ước tính)</dd></>)}
          <dt>Nguồn</dt><dd>OpenStreetMap / Microsoft Building Footprints</dd>
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
            <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${place.location.lat}&mlon=${place.location.lng}#map=19/${place.location.lat}/${place.location.lng}`}>OSM ↗</a>
            <button className="btn ghost" onClick={() => command({ type: 'reset' })}>Reset view</button>
          </div>
        </>
      )}
    </aside>
  );
}
