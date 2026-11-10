import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { CATEGORIES } from '@nmap/map-config';
import { readConfig, REPO_ROOT } from '../../config/env';

interface AreaSeed {
  slug: string;
  name: string;
  bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  crs: string;
  origin: { lat: number; lng: number };
  isActive: boolean;
}

/** v2 region: the QL13 corridor Chơn Thành – Minh Hưng – Bình Long (one origin => seamless streaming). */
export const DEFAULT_AREA: AreaSeed = {
  slug: 'chon-thanh-binh-long',
  name: 'Chơn Thành – Minh Hưng – Bình Long',
  bounds: { minLng: 106.555, minLat: 11.37, maxLng: 106.69, maxLat: 11.7 },
  crs: 'EPSG:32648',
  origin: { lat: 11.535, lng: 106.6225 },
  isActive: true,
};

/** v1 neighbourhood, kept for history but no longer served. */
export const LEGACY_AREA: AreaSeed = {
  slug: 'chon-thanh',
  name: 'Chơn Thành – Trung tâm',
  bounds: { minLng: 106.599, minLat: 11.416, maxLng: 106.613, maxLat: 11.428 },
  crs: 'EPSG:32648',
  origin: { lat: 11.422, lng: 106.606 },
  isActive: false,
};

export const AREAS: AreaSeed[] = [DEFAULT_AREA, LEGACY_AREA];

interface ManifestEntry {
  assetKey: string;
  name: string;
  category: string;
  file: string;
  boundingBox?: unknown;
  metadata?: Record<string, unknown>;
  version?: number;
  thumbnail?: string;
}

export const MANIFEST_PATH = path.join(REPO_ROOT, 'assets', 'models', 'manifest.json');

/** Idempotent seed: categories, the default area and the asset library. */
export async function runSeed(databaseUrl: string, log: (m: string) => void = console.log) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const c of CATEGORIES) {
      await client.query(
        `INSERT INTO place_categories(name, slug, icon, color, sort_order, is_active)
         VALUES ($1,$2,$3,$4,$5,TRUE)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, icon=EXCLUDED.icon, color=EXCLUDED.color, sort_order=EXCLUDED.sort_order`,
        [c.name, c.slug, c.icon, c.color, c.sortOrder],
      );
    }
    log(`Seeded ${CATEGORIES.length} categories`);

    for (const a of AREAS) {
      await client.query(
        `INSERT INTO map_areas(name, slug, boundary, crs, origin_lat, origin_lng, is_active)
         VALUES ($1,$2, ST_Multi(ST_MakeEnvelope($3,$4,$5,$6,4326)), $7, $8, $9, $10)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, boundary=EXCLUDED.boundary, crs=EXCLUDED.crs,
           origin_lat=EXCLUDED.origin_lat, origin_lng=EXCLUDED.origin_lng, is_active=EXCLUDED.is_active`,
        [a.name, a.slug, a.bounds.minLng, a.bounds.minLat, a.bounds.maxLng, a.bounds.maxLat, a.crs, a.origin.lat, a.origin.lng, a.isActive],
      );
      log(`Seeded area "${a.slug}"${a.isActive ? '' : ' (inactive)'}`);
    }

    if (fs.existsSync(MANIFEST_PATH)) {
      const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      for (const m of manifest) {
        await client.query(
          `INSERT INTO map_assets(asset_key, name, category, model_url, thumbnail_url, format, bounding_box, metadata, version, is_active)
           VALUES ($1,$2,$3,$4,$5,'glb',$6,$7,$8,TRUE)
           ON CONFLICT (asset_key) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, model_url=EXCLUDED.model_url,
             thumbnail_url=EXCLUDED.thumbnail_url, bounding_box=EXCLUDED.bounding_box, metadata=EXCLUDED.metadata, version=EXCLUDED.version`,
          [
            m.assetKey, m.name, m.category, `models/${path.basename(m.file)}`, m.thumbnail
              ? `previews/${path.basename(m.thumbnail)}`
              : fs.existsSync(path.join(REPO_ROOT, 'assets', 'previews', `${m.assetKey}.png`)) ? `previews/${m.assetKey}.png` : null,
            JSON.stringify(m.boundingBox ?? null), JSON.stringify(m.metadata ?? {}), m.version ?? 1,
          ],
        );
      }
      log(`Seeded ${manifest.length} assets`);
    } else {
      log(`WARNING: ${MANIFEST_PATH} not found – skipping asset seed (run "pnpm assets:build" first)`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runSeed(readConfig().databaseUrl)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
