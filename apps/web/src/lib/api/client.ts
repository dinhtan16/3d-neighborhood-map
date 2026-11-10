import type { GeoBounds } from '@nmap/shared-types';
import type {
  ApiResponse, CreateMapObjectRequest, CreatePlaceImageRequest, CreatePlaceRequest, ImportJobDto,
  LoginResponse, MapAreaDto, MapAssetDto, MapObjectDto, MapSceneDto, MapSceneMeta,
  PlaceCategoryDto, PlaceDetailDto, PlaceImageDto, PlaceSummaryDto, UpdateMapObjectRequest, UpdatePlaceRequest,
} from '@nmap/map-contracts';
import type { StaticDemoBundle } from '@/types/map';
import { foldText } from '@/lib/text';

export const DATA_MODE: 'api' | 'static' =
  process.env.NEXT_PUBLIC_DATA_MODE === 'static' ? 'static' : 'api';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
export const IS_STATIC = DATA_MODE === 'static';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------- auth token ----------------
const TOKEN_KEY = 'nmap.adminToken';
export function getToken(): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token && init.auth !== false) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? message;
    } catch { /* not json */ }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return { data: undefined as T, meta: { timestamp: new Date().toISOString() } };
  return res.json();
}

const qs = (params: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  return s.toString();
};

// ---------------- static demo bundle ----------------
let bundlePromise: Promise<StaticDemoBundle> | null = null;
function loadBundle(slug = 'chon-thanh'): Promise<StaticDemoBundle> {
  bundlePromise ??= fetch(`demo-data/${slug}.json`).then(async (r) => {
    if (!r.ok) throw new ApiError(r.status, 'Demo data not found');
    const b = (await r.json()) as StaticDemoBundle;
    // Model paths in the bundle are relative to the demo-data folder.
    // NEXT_PUBLIC_EMBED_MODELS=1 => models come base64-packed in demo-data/models.json
    // (for hosts that cannot serve .glb files).
    const embed = process.env.NEXT_PUBLIC_EMBED_MODELS === '1';
    const fix = (u: string) =>
      /^(https?:|data:|\/)/.test(u) ? u
        : embed ? `embedded:${u.split('/').pop()!.replace(/\.glb$/, '')}`
        : `demo-data/${u}`;
    b.assets = b.assets.map((a) => ({ ...a, modelUrl: fix(a.modelUrl), thumbnailUrl: null }));
    b.scene.objects = b.scene.objects.map((o) => ({ ...o, modelUrl: fix(o.modelUrl) }));
    return b;
  });
  return bundlePromise;
}

// ---------------- public API ----------------
export async function fetchArea(slug: string): Promise<MapAreaDto> {
  if (IS_STATIC) return (await loadBundle(slug)).area;
  return (await request<MapAreaDto>(`/map/areas/${encodeURIComponent(slug)}`)).data;
}

export async function fetchAreas(): Promise<MapAreaDto[]> {
  if (IS_STATIC) return [(await loadBundle()).area];
  return (await request<MapAreaDto[]>('/map/areas')).data;
}

export async function fetchScene(
  areaId: string, bounds: GeoBounds, lod = 2, includeDrafts = false,
): Promise<{ data: MapSceneDto; meta: MapSceneMeta }> {
  if (IS_STATIC) {
    const b = await loadBundle();
    return {
      data: b.scene,
      meta: { areaId, lod, featureCount: b.scene.features.features.length, objectCount: b.scene.objects.length, placeCount: b.scene.places.length },
    };
  }
  const res = await request<MapSceneDto>(`/map/scene?${qs({ areaId, ...bounds, lod, includeDrafts: includeDrafts || undefined })}`);
  return { data: res.data, meta: res.meta as unknown as MapSceneMeta };
}

export async function fetchCategories(): Promise<PlaceCategoryDto[]> {
  if (IS_STATIC) return (await loadBundle()).categories;
  return (await request<PlaceCategoryDto[]>('/categories')).data;
}

export async function fetchAssets(): Promise<MapAssetDto[]> {
  if (IS_STATIC) return (await loadBundle()).assets;
  return (await request<MapAssetDto[]>('/map/assets')).data;
}

export async function searchPlaces(params: { q?: string; categoryId?: string; areaId?: string; limit?: number; status?: string }): Promise<PlaceSummaryDto[]> {
  if (IS_STATIC) {
    const b = await loadBundle();
    const q = params.q ? foldText(params.q.trim()) : '';
    return b.scene.places
      .filter((p) => (!params.categoryId || p.category?.id === params.categoryId))
      .filter((p) => !q || foldText(`${p.name} ${p.address ?? ''}`).includes(q))
      .slice(0, params.limit ?? 50);
  }
  return (await request<PlaceSummaryDto[]>(`/places?${qs(params)}`)).data;
}

export async function fetchPlace(id: string): Promise<PlaceDetailDto> {
  if (IS_STATIC) {
    const p = (await loadBundle()).placeDetails[id];
    if (!p) throw new ApiError(404, 'Place not found');
    return p;
  }
  return (await request<PlaceDetailDto>(`/places/${id}`)).data;
}

// ---------------- admin API ----------------
function assertWritable() {
  if (IS_STATIC) throw new ApiError(403, 'The static demo is read-only. Run the API to edit data.');
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  assertWritable();
  const res = await request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }), auth: false });
  setToken(res.data.accessToken);
  return res.data;
}

export async function fetchMe(): Promise<{ email: string; role: string } | null> {
  if (IS_STATIC || !getToken()) return null;
  try { return (await request<{ email: string; role: string }>('/auth/me')).data; } catch { return null; }
}

export async function createPlace(body: CreatePlaceRequest) {
  assertWritable();
  return (await request<PlaceDetailDto>('/places', { method: 'POST', body: JSON.stringify(body) })).data;
}
export async function updatePlace(id: string, body: UpdatePlaceRequest) {
  assertWritable();
  return (await request<PlaceDetailDto>(`/places/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).data;
}
export async function deletePlace(id: string) {
  assertWritable();
  await request<unknown>(`/places/${id}`, { method: 'DELETE' });
}
export async function addPlaceImage(placeId: string, body: CreatePlaceImageRequest) {
  assertWritable();
  return (await request<PlaceImageDto>(`/places/${placeId}/images`, { method: 'POST', body: JSON.stringify(body) })).data;
}
export async function deletePlaceImage(placeId: string, imageId: string) {
  assertWritable();
  await request<unknown>(`/places/${placeId}/images/${imageId}`, { method: 'DELETE' });
}
export async function uploadImage(file: File): Promise<{ url: string }> {
  assertWritable();
  const form = new FormData();
  form.append('file', file);
  return (await request<{ url: string }>('/admin/uploads/image', { method: 'POST', body: form })).data;
}

export async function createMapObject(body: CreateMapObjectRequest) {
  assertWritable();
  return (await request<MapObjectDto>('/admin/map/objects', { method: 'POST', body: JSON.stringify(body) })).data;
}
export async function updateMapObject(id: string, body: UpdateMapObjectRequest) {
  assertWritable();
  return (await request<MapObjectDto>(`/admin/map/objects/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).data;
}
export async function deleteMapObject(id: string) {
  assertWritable();
  await request<unknown>(`/admin/map/objects/${id}`, { method: 'DELETE' });
}
export async function publishArea(areaId: string) {
  assertWritable();
  return (await request<{ published: number }>('/admin/map/publish', { method: 'POST', body: JSON.stringify({ areaId }) })).data;
}
export async function startOsmImport(areaId: string, bounds: GeoBounds) {
  assertWritable();
  return (await request<ImportJobDto>('/admin/map/import/osm', { method: 'POST', body: JSON.stringify({ areaId, bounds }) })).data;
}
export async function fetchImportJob(jobId: string) {
  return (await request<ImportJobDto>(`/admin/map/import/jobs/${jobId}`)).data;
}
