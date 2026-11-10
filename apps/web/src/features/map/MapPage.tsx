'use client';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { categoryColor, DEFAULT_AREA_SLUG, TOWNS } from '@nmap/map-config';
import type { MapAreaDto, PlaceCategoryDto, PlaceSummaryDto } from '@nmap/map-contracts';
import { fetchArea, fetchCategories, IS_STATIC } from '@/lib/api/client';
import { projectorForArea } from '@/lib/geo/projection';
import { foldText } from '@/lib/text';
import { isCategoryVisible, useMapStore } from '@/features/map/store';
import { useLoadedPlaces } from '@/features/map/world-index';
import { useWorldStatus } from '@/features/map/world-status';
import { MapSearch } from '@/components/map/overlays/MapSearch';
import { CategoryFilter } from '@/components/map/overlays/CategoryFilter';
import { PlaceDetails } from '@/components/map/overlays/PlaceDetails';
import { MapToolbar } from '@/components/map/overlays/MapToolbar';
import { FpsHud } from '@/components/map/overlays/FpsHud';
import { MapLoading } from '@/components/map/MapLoading';
import { worldFocus } from '@/components/map/ChunkedWorld';
import type { MapCanvasProps } from '@/components/map/MapCanvas';

interface Props {
  areaSlug?: string;
  Canvas: ComponentType<MapCanvasProps>;
  adminHref?: string | null;
}

export function MapPage({ areaSlug = DEFAULT_AREA_SLUG, Canvas, adminHref = '/admin' }: Props) {
  const [area, setArea] = useState<MapAreaDto | null>(null);
  const [categories, setCategories] = useState<PlaceCategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'iso' | 'fps'>('iso');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [listFilter, setListFilter] = useState('');
  const [tick, setTick] = useState(0);
  const hidden = useMapStore((s) => s.hiddenCategories);
  const selectedPlaceId = useMapStore((s) => s.selectedPlaceId);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const command = useMapStore((s) => s.command);
  const byChunk = useLoadedPlaces((s) => s.byChunk);
  const status = useWorldStatus();
  const [outlines, setOutlines] = useState(true);
  const [agents, setAgents] = useState(true);
  useEffect(() => { setOutlines(new URLSearchParams(window.location.search).get('outline') !== '0'); }, []);

  useEffect(() => {
    fetchArea(areaSlug).then(setArea).catch((e) => setError(e.message));
    fetchCategories().then(setCategories).catch(() => undefined);
  }, [areaSlug]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1500); return () => clearInterval(id); }, []);

  const projector = useMemo(() => (area ? projectorForArea(area) : null), [area]);

  const flyTo = (lat: number, lng: number) => {
    if (!projector) return;
    command({ type: 'fly', target: projector.toLocal(lng, lat) });
  };
  const goToPlace = (p: PlaceSummaryDto) => {
    selectPlace(p.id);
    flyTo(p.location.lat, p.location.lng);
  };

  // nearby places = places in loaded chunks, nearest to the focus first
  const nearby = useMemo(() => {
    const f = foldText(listFilter.trim());
    return Object.values(byChunk).flat()
      .filter(({ place }) => isCategoryVisible(hidden, place.category?.slug))
      .filter(({ place }) => !f || foldText(place.name).includes(f))
      .map((p) => ({ ...p, d: Math.hypot(p.x - worldFocus.x, p.z - worldFocus.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byChunk, hidden, listFilter, tick]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { place } of Object.values(byChunk).flat()) c[place.category?.slug ?? 'other'] = (c[place.category?.slug ?? 'other'] ?? 0) + 1;
    return c;
  }, [byChunk]);

  return (
    <div className={`app ${sidebarOpen && mode === 'iso' ? '' : 'sidebar-collapsed'} mode-${mode}`}>
      <header className="header">
        <button className="icon-btn" aria-label="Toggle sidebar" onClick={() => setSidebarOpen((o) => !o)}>☰</button>
        <div className="brand">
          <span className="logo">◆</span>
          <div>
            <strong>Bản đồ 3D Chơn Thành – Bình Long</strong>
            <span className="muted small">Chơn Thành · Minh Hưng · Bình Long</span>
          </div>
        </div>
        {area && <MapSearch areaId={area.id} onPick={goToPlace} />}
        <div className="header-right">
          <div className="towns" role="group" aria-label="Đi tới">
            {TOWNS.map((t) => <button key={t.slug} className="chip" onClick={() => flyTo(t.lat, t.lng)}>{t.name}</button>)}
          </div>
          <button className={`btn ${agents ? '' : 'ghost'}`} title="Hiện / ẩn nhân vật" aria-pressed={agents} onClick={() => setAgents((v) => !v)}>👥</button>
          <button className={`btn ${mode === 'fps' ? '' : 'ghost'}`} onClick={() => setMode((m) => (m === 'iso' ? 'fps' : 'iso'))}>
            {mode === 'iso' ? '🚶 Đi bộ' : '🗺️ Bản đồ'}
          </button>
          {IS_STATIC && <span className="badge">Demo</span>}
          {adminHref && !IS_STATIC && <a className="btn ghost" href={adminHref}>Admin</a>}
        </div>
      </header>

      <aside className="sidebar">
        {categories.length > 0 && <CategoryFilter categories={categories} counts={counts} />}
        <div className="list-head">
          <h3>Gần đây <span className="muted">({nearby.length})</span></h3>
          <input type="search" placeholder="Lọc danh sách…" value={listFilter} onChange={(e) => setListFilter(e.target.value)} aria-label="Lọc danh sách" />
        </div>
        <ul className="place-list">
          {nearby.map(({ place: p, d }) => (
            <li key={p.id}>
              <button className={p.id === selectedPlaceId ? 'active' : ''} onClick={() => goToPlace(p)}>
                <span className="dot" style={{ background: categoryColor(p.category?.slug) }} />
                <span className="grow">
                  <span className="name">{p.name}</span>
                  <span className="muted small">{p.category?.name} · {d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`}</span>
                </span>
              </button>
            </li>
          ))}
          {nearby.length === 0 && <li className="muted pad">Di chuyển bản đồ để xem địa điểm quanh đây.</li>}
        </ul>
      </aside>

      <main className="map-area">
        {area ? <Canvas area={area} mode={mode} outlines={outlines} agents={agents} /> : <MapLoading error={error} />}
        {mode === 'iso' && <MapToolbar />}
        {mode === 'iso' && (
          <div className="map-hint">Kéo chuột: di chuyển · Chuột phải hoặc <kbd>Ctrl</kbd> + kéo: xoay góc nhìn · Lăn chuột: phóng to</div>
        )}
        {mode === 'fps' && <FpsHud />}
        <PlaceDetails />
        <div className="attribution">
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · Building footprints © Microsoft (ODbL)
        </div>
        <div className="legend muted small">
          {status.pending > 0 || status.loaded < status.wanted ? `Đang tải ô bản đồ ${status.loaded}/${status.wanted}…` : `${status.loaded} ô bản đồ`}
          {status.error ? ` · lỗi: ${status.error}` : ''}
        </div>
      </main>
    </div>
  );
}
