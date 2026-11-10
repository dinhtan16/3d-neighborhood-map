'use client';
import { useMemo, useState, type ComponentType } from 'react';
import { categoryColor } from '@nmap/map-config';
import type { MapFeature } from '@nmap/map-contracts';
import { useMapScene } from '@/hooks/useMapScene';
import { isCategoryVisible, useMapStore } from '@/features/map/store';
import { foldText } from '@/lib/text';
import { IS_STATIC } from '@/lib/api/client';
import { MapSearch } from '@/components/map/overlays/MapSearch';
import { CategoryFilter } from '@/components/map/overlays/CategoryFilter';
import { PlaceDetails } from '@/components/map/overlays/PlaceDetails';
import { MapToolbar } from '@/components/map/overlays/MapToolbar';
import { MapLoading } from '@/components/map/MapLoading';
import type { MapCanvasProps } from '@/components/map/MapCanvas';

interface Props {
  areaSlug: string;
  /** Injected so Next.js can use next/dynamic (ssr: false) and the static demo a direct import. */
  Canvas: ComponentType<MapCanvasProps>;
  adminHref?: string | null;
}

export function MapPage({ areaSlug, Canvas, adminHref = '/admin' }: Props) {
  const { area, scene, categories, error } = useMapScene(areaSlug);
  const hidden = useMapStore((s) => s.hiddenCategories);
  const selectedPlaceId = useMapStore((s) => s.selectedPlaceId);
  const selectPlace = useMapStore((s) => s.selectPlace);
  const [listFilter, setListFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of scene?.places ?? []) c[p.category?.slug ?? 'other'] = (c[p.category?.slug ?? 'other'] ?? 0) + 1;
    return c;
  }, [scene]);

  const list = useMemo(() => {
    const f = foldText(listFilter.trim());
    return (scene?.places ?? [])
      .filter((p) => isCategoryVisible(hidden, p.category?.slug))
      .filter((p) => !f || foldText(p.name).includes(f))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [scene, hidden, listFilter]);

  const buildings = useMemo<MapFeature[]>(() => scene?.features.features.filter((f) => f.properties.featureType === 'building') ?? [], [scene]);

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <header className="header">
        <button className="icon-btn" aria-label="Toggle sidebar" onClick={() => setSidebarOpen((o) => !o)}>☰</button>
        <div className="brand">
          <span className="logo">◆</span>
          <div>
            <strong>{area?.name ?? 'Bản đồ khu phố 3D'}</strong>
            <span className="muted small">Chơn Thành · Bình Phước</span>
          </div>
        </div>
        {area && <MapSearch areaId={area.id} />}
        <div className="header-right">
          {IS_STATIC && <span className="badge">Demo</span>}
          {adminHref && !IS_STATIC && <a className="btn ghost" href={adminHref}>Admin</a>}
        </div>
      </header>

      <aside className="sidebar">
        {categories.length > 0 && <CategoryFilter categories={categories} counts={counts} />}
        <div className="list-head">
          <h3>Địa điểm <span className="muted">({list.length})</span></h3>
          <input type="search" placeholder="Lọc danh sách…" value={listFilter} onChange={(e) => setListFilter(e.target.value)} aria-label="Filter list" />
        </div>
        <ul className="place-list">
          {list.map((p) => (
            <li key={p.id}>
              <button className={p.id === selectedPlaceId ? 'active' : ''} onClick={() => selectPlace(p.id, { fly: true })}>
                <span className="dot" style={{ background: categoryColor(p.category?.slug) }} />
                <span className="grow">
                  <span className="name">{p.name}</span>
                  <span className="muted small">{p.category?.name}{p.address ? ` · ${p.address}` : ''}</span>
                </span>
              </button>
            </li>
          ))}
          {scene && list.length === 0 && <li className="muted pad">Không có địa điểm.</li>}
        </ul>
      </aside>

      <main className="map-area">
        {area && scene ? <Canvas area={area} scene={scene} /> : <MapLoading error={error} />}
        <MapToolbar />
        <PlaceDetails buildings={buildings} />
        <div className="attribution">
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>
        </div>
        {scene && (
          <div className="legend muted small">
            {scene.features.features.length} features · {scene.objects.length} objects · {scene.places.length} places
          </div>
        )}
      </main>
    </div>
  );
}
