'use client';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import type { MapAssetDto, MapObjectDto, PlaceSummaryDto } from '@nmap/map-contracts';
import { normalizeAngle } from '@nmap/geo-core';
import { useMapScene } from '@/hooks/useMapScene';
import { projectorForArea } from '@/lib/geo/projection';
import {
  createMapObject, deleteMapObject, fetchAssets, publishArea, searchPlaces, updateMapObject,
} from '@/lib/api/client';
import type { MapCanvasProps } from '@/components/map/MapCanvas';
import { MapLoading } from '@/components/map/MapLoading';
import { MapToolbar } from '@/components/map/overlays/MapToolbar';
import { EditableObjects, type GizmoMode } from './EditableObjects';

const deg = (r: number) => Math.round((normalizeAngle(r) * 180) / Math.PI * 10) / 10;
const rad = (d: number) => (d * Math.PI) / 180;

export function MapEditor({ Canvas, areaSlug = 'chon-thanh', initialPlaceId }: { Canvas: ComponentType<MapCanvasProps>; areaSlug?: string; initialPlaceId?: string | null }) {
  const { area, scene, error } = useMapScene(areaSlug, { includeDrafts: true });
  const [assets, setAssets] = useState<MapAssetDto[]>([]);
  const [places, setPlaces] = useState<PlaceSummaryDto[]>([]);
  const [objects, setObjects] = useState<MapObjectDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placingAsset, setPlacingAsset] = useState<string | null>(null);
  const [linkPlaceId, setLinkPlaceId] = useState<string | null>(initialPlaceId ?? null);
  const [mode, setMode] = useState<GizmoMode>('translate');
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { fetchAssets().then(setAssets).catch((e) => setMsg({ kind: 'err', text: e.message })); }, []);
  useEffect(() => { if (scene) setObjects(scene.objects); }, [scene]);
  useEffect(() => { if (area) searchPlaces({ areaId: area.id, limit: 50 }).then(setPlaces); }, [area]);

  const projector = useMemo(() => (area ? projectorForArea(area) : null), [area]);
  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const drafts = objects.filter((o) => o.status === 'draft').length;
  const sceneForCanvas = useMemo(() => (scene ? { ...scene, objects: [] } : null), [scene]);

  const replace = (o: MapObjectDto) => setObjects((list) => list.map((x) => (x.id === o.id ? o : x)));
  const fail = (e: unknown) => setMsg({ kind: 'err', text: (e as Error).message });

  const save = async (id: string, patch: Parameters<typeof updateMapObject>[1]) => {
    try {
      const updated = await updateMapObject(id, { ...patch, status: 'draft' });
      replace(updated);
      setMsg({ kind: 'ok', text: 'Saved as draft.' });
    } catch (e) { fail(e); }
  };

  const placeAt = async ([x, z]: [number, number]) => {
    if (!placingAsset || !area || !projector || preview) { setSelectedId(null); return; }
    const { lat, lng } = projector.toGeo(x, z);
    try {
      const created = await createMapObject({
        areaId: area.id, assetId: placingAsset, placeId: linkPlaceId, latitude: lat, longitude: lng,
        elevationM: 0, rotation: 0, scale: { x: 1, y: 1, z: 1 }, status: 'draft',
      });
      setObjects((l) => [...l, created]);
      setSelectedId(created.id);
      setPlacingAsset(null);
      setMsg({ kind: 'ok', text: 'Object placed (draft).' });
    } catch (e) { fail(e); }
  };

  if (!area || !sceneForCanvas) return <div style={{ position: 'relative', height: '60vh' }}><MapLoading error={error} /></div>;

  return (
    <div className="editor">
      <aside>
        <h3 style={{ marginTop: 0 }}>Asset library</h3>
        <p className="muted small">Select an asset, then click on the map to place it.</p>
        <label className="form" style={{ marginBottom: 10 }}>
          <span className="small"><strong>Link to place (optional)</strong></span>
          <select value={linkPlaceId ?? ''} onChange={(e) => setLinkPlaceId(e.target.value || null)}>
            <option value="">— none —</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="asset-grid">
          {assets.map((a) => (
            <button key={a.id} className={`asset-card ${placingAsset === a.id ? 'on' : ''}`} onClick={() => setPlacingAsset(placingAsset === a.id ? null : a.id)}>
              {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" /> : <div style={{ aspectRatio: 1, display: 'grid', placeItems: 'center' }}>🧱</div>}
              {a.name}
            </button>
          ))}
        </div>
      </aside>

      <div style={{ position: 'relative', minHeight: 0 }}>
        <Canvas area={area} scene={sceneForCanvas} hideObjects showPins={preview} onGroundClick={placeAt}>
          <EditableObjects
            area={area}
            objects={objects}
            selectedId={selectedId}
            mode={mode}
            preview={preview}
            onSelect={(id) => setSelectedId(id)}
            onTransformEnd={(id, t) => {
              if (!projector) return;
              const { lat, lng } = projector.toGeo(t.x, t.z);
              save(id, { latitude: lat, longitude: lng, elevationM: Math.round(t.y * 100) / 100, rotation: normalizeAngle(t.rotationY), scale: { x: t.scale.x, y: t.scale.y, z: t.scale.z } });
            }}
          />
        </Canvas>
        <MapToolbar />
        <div className="details" style={{ width: 'auto', padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['translate', 'rotate', 'scale'] as GizmoMode[]).map((m) => (
            <button key={m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{m === 'translate' ? 'Move' : m === 'rotate' ? 'Rotate' : 'Scale'}</button>
          ))}
          <button className={`chip ${preview ? 'on' : ''}`} onClick={() => { setPreview((p) => !p); setSelectedId(null); }}>{preview ? 'Exit preview' : 'Preview'}</button>
          {placingAsset && <span className="badge">Click map to place</span>}
        </div>
      </div>

      <aside>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Object</h3>
          <button className="btn" disabled={!drafts} onClick={async () => {
            try { const r = await publishArea(area.id); setObjects((l) => l.map((o) => ({ ...o, status: 'published' }))); setMsg({ kind: 'ok', text: `Published ${r.published} object(s).` }); } catch (e) { fail(e); }
          }}>Publish ({drafts})</button>
        </div>
        {msg && <p className={msg.kind === 'err' ? 'error' : 'muted'}>{msg.text}</p>}
        {!selected && <p className="muted">Select an object on the map to edit it.<br />{objects.length} objects in this area.</p>}
        {selected && <ObjectForm key={selected.id + selected.rotation + selected.position.lat} object={selected} assets={assets} places={places}
          onSave={(patch) => save(selected.id, patch)}
          onDelete={async () => {
            if (!confirm('Delete this object?')) return;
            try { await deleteMapObject(selected.id); setObjects((l) => l.filter((o) => o.id !== selected.id)); setSelectedId(null); } catch (e) { fail(e); }
          }} />}
      </aside>
    </div>
  );
}

function ObjectForm({ object, assets, places, onSave, onDelete }: {
  object: MapObjectDto; assets: MapAssetDto[]; places: PlaceSummaryDto[];
  onSave: (patch: Parameters<typeof updateMapObject>[1]) => void; onDelete: () => void;
}) {
  const [f, setF] = useState({
    assetId: object.assetId, placeId: object.placeId ?? '', lat: String(object.position.lat), lng: String(object.position.lng),
    elevation: String(object.elevationM), rotation: String(deg(object.rotation)),
    sx: String(object.scale.x), sy: String(object.scale.y), sz: String(object.scale.z),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const num = (v: string) => Number(v);
  const invalid =
    !(num(f.lat) >= -90 && num(f.lat) <= 90) || !(num(f.lng) >= -180 && num(f.lng) <= 180) ||
    [f.sx, f.sy, f.sz].some((v) => !(num(v) > 0 && num(v) <= 20)) || !Number.isFinite(num(f.rotation));
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      if (invalid) return;
      onSave({
        assetId: f.assetId, placeId: f.placeId || null, latitude: num(f.lat), longitude: num(f.lng),
        elevationM: num(f.elevation) || 0, rotation: normalizeAngle(rad(num(f.rotation))), scale: { x: num(f.sx), y: num(f.sy), z: num(f.sz) },
      });
    }}>
      <p className="small muted">Status: <strong>{object.status}</strong></p>
      <label>Asset<select value={f.assetId} onChange={set('assetId')}>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Place<select value={f.placeId} onChange={set('placeId')}><option value="">— none —</option>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="two">
        <label>Latitude<input value={f.lat} onChange={set('lat')} inputMode="decimal" /></label>
        <label>Longitude<input value={f.lng} onChange={set('lng')} inputMode="decimal" /></label>
      </div>
      <div className="two">
        <label>Elevation (m)<input value={f.elevation} onChange={set('elevation')} inputMode="decimal" /></label>
        <label>Rotation (°)<input value={f.rotation} onChange={set('rotation')} inputMode="decimal" /></label>
      </div>
      <div className="three">
        <label>Scale X<input value={f.sx} onChange={set('sx')} inputMode="decimal" /></label>
        <label>Scale Y<input value={f.sy} onChange={set('sy')} inputMode="decimal" /></label>
        <label>Scale Z<input value={f.sz} onChange={set('sz')} inputMode="decimal" /></label>
      </div>
      {invalid && <span className="error small">Check coordinates (lat ±90, lng ±180) and scale (0–20).</span>}
      <div className="row">
        <button className="btn" type="submit" disabled={invalid}>Save draft</button>
        <button className="btn danger" type="button" onClick={onDelete}>Delete</button>
      </div>
    </form>
  );
}
