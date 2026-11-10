import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { MeshoptDecoder } from 'three-stdlib';

/**
 * Static-demo fallback for hosts that cannot serve .glb files: models are
 * shipped base64-encoded in demo-data/models.json and parsed in memory with
 * GLTFLoader.parse (no network request per model).
 * URLs of the form "embedded:<assetKey>" resolve through this cache.
 */
export const EMBEDDED_PREFIX = 'embedded:';

let manifest: Promise<Record<string, string>> | null = null;
const cache = new Map<string, Promise<THREE.Group>>();

function loadManifest() {
  manifest ??= fetch('demo-data/models.json').then((r) => {
    if (!r.ok) throw new Error(`models.json: HTTP ${r.status}`);
    return r.json();
  });
  return manifest;
}

function decode(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function loadEmbeddedModel(url: string): Promise<THREE.Group> {
  const key = url.slice(EMBEDDED_PREFIX.length);
  let p = cache.get(key);
  if (!p) {
    p = loadManifest().then((m) => {
      const b64 = m[key];
      if (!b64) throw new Error(`Embedded model "${key}" not found`);
      const loader = new GLTFLoader();
      // three-stdlib exports a factory; three's own export is the decoder object.
      const decoder = typeof MeshoptDecoder === 'function' ? (MeshoptDecoder as () => unknown)() : MeshoptDecoder;
      loader.setMeshoptDecoder(decoder as Parameters<GLTFLoader['setMeshoptDecoder']>[0]);
      return new Promise<THREE.Group>((resolve, reject) =>
        loader.parse(decode(b64), '', (gltf) => resolve(gltf.scene), reject),
      );
    });
    cache.set(key, p);
  }
  return p;
}
