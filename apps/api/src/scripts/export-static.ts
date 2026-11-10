/**
 * Export a self-contained, read-only snapshot of one area for the static web demo (v2, chunked):
 *
 *   apps/web/public/demo-data/<areaSlug>/area.json
 *     { generatedAt, attribution, area, categories, assets, places, chunkSizeM, packSpan, chunkRange, packs }
 *   apps/web/public/demo-data/<areaSlug>/packs/p_<px>_<pz>.json
 *     { chunks: { "<cx>_<cz>": MapChunkDto }, placeDetails: Record<placeId, PlaceDetailDto> }
 *   apps/web/public/demo-data/models/*.glb   (shared by all areas)
 *
 * Pack (px, pz) holds chunks cx ∈ [px·PACK_SPAN, (px+1)·PACK_SPAN), cz likewise; empty chunks and
 * empty packs are omitted. Chunk payloads come from the same MapService.getChunk the live API serves.
 *
 * Usage: pnpm --filter api export:static [areaSlug]   (default: DEFAULT_AREA_SLUG)
 *        EXPORT_OUT_DIR=/tmp/out pnpm --filter api export:static
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { CHUNK_SIZE_M, DEFAULT_AREA_SLUG, PACK_SPAN } from '@nmap/map-config';
import { AppModule } from '../app.module';
import { REPO_ROOT } from '../config/env';
import { MapService } from '../modules/map/map.service';
import { CategoriesService } from '../modules/categories/categories.service';
import { AssetsService } from '../modules/assets/assets.service';
import { PlacesService } from '../modules/places/places.service';

const relModel = (url: string) => `models/${path.basename(new URL(url, 'http://x').pathname)}`;

/** Drop null / undefined values (recursively for plain objects) to keep the JSON small. */
function compact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(compact) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      out[k] = compact(val);
    }
    return out as T;
  }
  return v;
}

async function main() {
  const slug = process.argv[2] ?? DEFAULT_AREA_SLUG;
  const baseDir = process.env.EXPORT_OUT_DIR
    ? path.resolve(process.env.EXPORT_OUT_DIR)
    : path.join(REPO_ROOT, 'apps', 'web', 'public', 'demo-data');
  const areaDir = path.join(baseDir, slug);
  const packDir = path.join(areaDir, 'packs');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const t0 = Date.now();
  try {
    const mapService = app.get(MapService);
    const placesService = app.get(PlacesService);
    const area = await mapService.getArea(slug);
    const range = await mapService.getChunkRange(area);
    const [categories, assets, places] = await Promise.all([
      app.get(CategoriesService).list(),
      app.get(AssetsService).list(),
      placesService.findAllActive(area.id),
    ]);

    fs.rmSync(packDir, { recursive: true, force: true });
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'models'), { recursive: true });

    const packs = new Map<string, { chunks: Record<string, unknown>; placeDetails: Record<string, unknown> }>();
    let chunkCount = 0;
    let featureCount = 0;
    for (let cz = range.minCz; cz <= range.maxCz; cz++) {
      for (let cx = range.minCx; cx <= range.maxCx; cx++) {
        const { data, meta } = await mapService.getChunk(area.id, cx, cz, 2);
        if (!meta.featureCount && !meta.objectCount && !meta.placeCount) continue;
        data.objects = data.objects.map((o) => ({ ...o, modelUrl: relModel(o.modelUrl) }));
        const key = `${Math.floor(cx / PACK_SPAN)}_${Math.floor(cz / PACK_SPAN)}`;
        let pack = packs.get(key);
        if (!pack) packs.set(key, (pack = { chunks: {}, placeDetails: {} }));
        // Feature.id duplicates properties.id – drop it to save ~3 MB over the region.
        const slim = { ...data, features: { ...data.features, features: data.features.features.map(({ id: _id, ...f }) => f) } };
        pack.chunks[`${cx}_${cz}`] = compact(slim);
        for (const p of data.places) pack.placeDetails[p.id] = compact(await placesService.findDetail(p.id));
        chunkCount++;
        featureCount += meta.featureCount;
      }
    }

    let packBytes = 0;
    for (const [key, pack] of packs) {
      const file = path.join(packDir, `p_${key}.json`);
      fs.writeFileSync(file, JSON.stringify(pack));
      packBytes += fs.statSync(file).size;
    }

    const areaFile = path.join(areaDir, 'area.json');
    fs.writeFileSync(
      areaFile,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        attribution: '© OpenStreetMap contributors (ODbL) · Building footprints © Microsoft (ODbL)',
        area,
        categories,
        assets: assets.map((a) => ({ ...a, modelUrl: relModel(a.modelUrl), thumbnailUrl: null })),
        places: compact(places),
        chunkSizeM: CHUNK_SIZE_M,
        packSpan: PACK_SPAN,
        chunkRange: range,
        packs: [...packs.keys()].sort(),
      }),
    );

    const modelsSrc = path.join(REPO_ROOT, 'assets', 'models');
    let copied = 0;
    if (fs.existsSync(modelsSrc)) {
      for (const f of fs.readdirSync(modelsSrc).filter((f) => f.endsWith('.glb'))) {
        fs.copyFileSync(path.join(modelsSrc, f), path.join(baseDir, 'models', f));
        copied++;
      }
    }
    const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
    console.log(
      `Exported "${slug}" in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${path.relative(REPO_ROOT, areaDir)}\n` +
        `  area.json ${kb(fs.statSync(areaFile).size)} (${places.length} places)\n` +
        `  ${packs.size} packs, ${chunkCount} non-empty chunks, ${featureCount} feature rows, ${kb(packBytes)} total\n` +
        `  ${copied} models copied to ${path.relative(REPO_ROOT, path.join(baseDir, 'models'))}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
