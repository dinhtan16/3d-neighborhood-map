'use client';
import { useEffect, useMemo, useState } from 'react';
import type { MapAreaDto, PlaceCategoryDto, PlaceDetailDto, PlaceSummaryDto } from '@nmap/map-contracts';
import {
  addPlaceImage, createPlace, deletePlace, deletePlaceImage, fetchAreas, fetchCategories, fetchPlace,
  searchPlaces, updatePlace, uploadImage,
} from '@/lib/api/client';

interface FormState {
  name: string; categoryId: string; latitude: string; longitude: string;
  address: string; description: string; phone: string; status: 'active' | 'inactive' | 'pending';
}
const EMPTY: FormState = { name: '', categoryId: '', latitude: '', longitude: '', address: '', description: '', phone: '', status: 'active' };

export function PlacesAdmin() {
  const [areas, setAreas] = useState<MapAreaDto[]>([]);
  const [categories, setCategories] = useState<PlaceCategoryDto[]>([]);
  const [places, setPlaces] = useState<PlaceSummaryDto[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState<PlaceDetailDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => { fetchAreas().then(setAreas); fetchCategories().then(setCategories); }, []);
  const areaId = areas[0]?.id;
  useEffect(() => {
    if (!areaId) return;
    const t = setTimeout(() => searchPlaces({ q, areaId, status, limit: 50 }).then(setPlaces).catch((e) => setMsg({ kind: 'err', text: e.message })), 200);
    return () => clearTimeout(t);
  }, [q, areaId, status, reload]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const startEdit = async (id: string) => {
    const p = await fetchPlace(id);
    setEditing(p);
    setForm({
      name: p.name, categoryId: p.category?.id ?? '', latitude: String(p.location.lat), longitude: String(p.location.lng),
      address: p.address ?? '', description: p.description ?? '', phone: p.phone ?? '', status: p.status,
    });
  };
  const startNew = () => {
    setEditing(null);
    const a = areas[0];
    setForm({ ...EMPTY, categoryId: categories[0]?.id ?? '', latitude: a ? String(a.origin.lat) : '', longitude: a ? String(a.origin.lng) : '' });
  };

  const latLngError = useMemo(() => {
    const lat = Number(form.latitude), lng = Number(form.longitude);
    if (form.latitude === '' || form.longitude === '') return 'GPS coordinates are required';
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90';
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Longitude must be between -180 and 180';
    return null;
  }, [form.latitude, form.longitude]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (latLngError) return setMsg({ kind: 'err', text: latLngError });
    const body = {
      name: form.name.trim(), categoryId: form.categoryId, latitude: Number(form.latitude), longitude: Number(form.longitude),
      address: form.address || undefined, description: form.description || undefined, phone: form.phone || undefined, status: form.status,
    };
    try {
      const saved = editing ? await updatePlace(editing.id, body) : await createPlace(body);
      setMsg({ kind: 'ok', text: editing ? 'Saved.' : 'Place created.' });
      setReload((r) => r + 1);
      await startEdit(saved.id);
    } catch (err) { setMsg({ kind: 'err', text: (err as Error).message }); }
  };

  const remove = async () => {
    if (!editing || !confirm(`Delete "${editing.name}"? (soft delete)`)) return;
    try { await deletePlace(editing.id); setEditing(null); setForm(EMPTY); setReload((r) => r + 1); setMsg({ kind: 'ok', text: 'Deleted.' }); }
    catch (err) { setMsg({ kind: 'err', text: (err as Error).message }); }
  };

  const addImage = async (url: string) => {
    if (!editing) return;
    try { await addPlaceImage(editing.id, { imageUrl: url, altText: editing.name, sortOrder: editing.images.length }); setImageUrl(''); await startEdit(editing.id); }
    catch (err) { setMsg({ kind: 'err', text: (err as Error).message }); }
  };

  return (
    <main className="admin-main">
      <div className="grid-2">
        <section className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="grow" type="search" placeholder="Search places…" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: 8, borderRadius: 10, border: '2px solid var(--line)' }} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 8, borderRadius: 10 }}>
              <option value="active">Active</option><option value="pending">Pending</option><option value="inactive">Inactive</option>
            </select>
            <button className="btn" onClick={startNew}>+ New place</button>
          </div>
          <table className="table">
            <thead><tr><th>Name</th><th>Category</th><th>GPS</th></tr></thead>
            <tbody>
              {places.map((p) => (
                <tr key={p.id} onClick={() => startEdit(p.id)} style={{ cursor: 'pointer', background: editing?.id === p.id ? 'var(--panel-2)' : undefined }}>
                  <td><strong>{p.name}</strong><div className="muted small">{p.address}</div></td>
                  <td>{p.category?.name}</td>
                  <td className="mono">{p.location.lat.toFixed(5)}, {p.location.lng.toFixed(5)}</td>
                </tr>
              ))}
              {places.length === 0 && <tr><td colSpan={3} className="muted">No places.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="card">
          <form className="form" onSubmit={save}>
            <h3 style={{ margin: 0 }}>{editing ? `Edit: ${editing.name}` : 'New place'}</h3>
            <label>Name<input required maxLength={255} value={form.name} onChange={set('name')} /></label>
            <label>Category
              <select required value={form.categoryId} onChange={set('categoryId')}>
                <option value="" disabled>Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="two">
              <label>Latitude<input inputMode="decimal" value={form.latitude} onChange={set('latitude')} /></label>
              <label>Longitude<input inputMode="decimal" value={form.longitude} onChange={set('longitude')} /></label>
            </div>
            {latLngError && form.name && <span className="error small">{latLngError}</span>}
            <label>Address<input value={form.address} onChange={set('address')} /></label>
            <label>Phone<input value={form.phone} onChange={set('phone')} maxLength={30} /></label>
            <label>Description<textarea rows={3} value={form.description} onChange={set('description')} /></label>
            <label>Status
              <select value={form.status} onChange={set('status')}>
                <option value="active">Active</option><option value="pending">Pending</option><option value="inactive">Inactive</option>
              </select>
            </label>
            {msg && <p className={msg.kind === 'err' ? 'error' : 'muted'}>{msg.text}</p>}
            <div className="row">
              <button className="btn" type="submit">{editing ? 'Save' : 'Create'}</button>
              {editing && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
              {editing && <a className="btn ghost" href={`/admin/map-editor?place=${editing.id}`}>Attach 3D object</a>}
            </div>
          </form>

          {editing && (
            <div style={{ marginTop: 16 }}>
              <h4>Images</h4>
              <div className="gallery">
                {editing.images.map((img) => (
                  <figure key={img.id} style={{ margin: 0, position: 'relative' }}>
                    <img src={img.imageUrl} alt={img.altText ?? ''} />
                    <button className="btn danger" style={{ position: 'absolute', top: 4, right: 4, padding: '2px 8px' }}
                      onClick={async () => { await deletePlaceImage(editing.id, img.id); await startEdit(editing.id); }}>×</button>
                  </figure>
                ))}
              </div>
              <div className="row">
                <input className="grow" placeholder="https://… image URL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={{ padding: 8, borderRadius: 10, border: '2px solid var(--line)' }} />
                <button className="btn ghost" disabled={!imageUrl} onClick={() => addImage(imageUrl)}>Add URL</button>
              </div>
              <label className="btn ghost" style={{ marginTop: 8 }}>
                Upload image (jpeg/png/webp, ≤5MB)
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 5 * 1024 * 1024) return setMsg({ kind: 'err', text: 'File too large (max 5MB)' });
                  try { const { url } = await uploadImage(f); await addImage(url); } catch (err) { setMsg({ kind: 'err', text: (err as Error).message }); }
                }} />
              </label>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
