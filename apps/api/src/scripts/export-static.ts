/**
 * Export a self-contained, read-only snapshot of one area for the static web demo:
 *   apps/web/public/demo-data/chon-thanh.json  (+ models/*.glb)
 * Reuses the Nest services so the JSON is byte-for-byte the same shape as the live API.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { REPO_ROOT } from '../config/env';
import { MapService } from '../modules/map/map.service';
import { CategoriesService } from '../modules/categories/categories.service';
import { AssetsService } from '../modules/assets/assets.service';
import { PlacesService } from '../modules/places/places.service';

const relModel = (url: string) => `models/${path.basename(new URL(url, 'http://x').pathname)}`;

async function main() {
  const slug = process.argv[2] ?? 'chon-thanh';
  const outDir = process.env.EXPORT_OUT_DIR ? path.resolve(process.env.EXPORT_OUT_DIR) : path.join(REPO_ROOT, 'apps', 'web', 'public', 'demo-data');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const mapService = app.get(MapService);
    const area = await mapService.getArea(slug);
    const b = area.bounds;
    const [categories, assets, sceneRes, placeIds] = await Promise.all([
      app.get(CategoriesService).list(),
      app.get(AssetsService).list(),
      mapService.getScene(area.id, { minLng: b.minLng, minLat: b.minLat, maxLng: b.maxLng, maxLat: b.maxLat }, 2, false),
      app.get(PlacesService).listActiveIds(area.id),
    ]);
    const places = app.get(PlacesService);
    const placeDetails: Record<string, unknown> = {};
    for (const id of placeIds) placeDetails[id] = await places.findDetail(id);

    const scene = sceneRes.data;
    scene.objects = scene.objects.map((o) => ({ ...o, modelUrl: relModel(o.modelUrl) }));
    const out = {
      generatedAt: new Date().toISOString(),
      attribution: '© OpenStreetMap contributors (ODbL)',
      area,
      categories,
      assets: assets.map((a) => ({ ...a, modelUrl: relModel(a.modelUrl), thumbnailUrl: null })),
      scene,
      sceneMeta: sceneRes.meta,
      placeDetails,
    };
    fs.mkdirSync(path.join(outDir, 'models'), { recursive: true });
    const file = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(file, JSON.stringify(out));

    const modelsSrc = path.join(REPO_ROOT, 'assets', 'models');
    let copied = 0;
    if (fs.existsSync(modelsSrc)) {
      for (const f of fs.readdirSync(modelsSrc).filter((f) => f.endsWith('.glb'))) {
        fs.copyFileSync(path.join(modelsSrc, f), path.join(outDir, 'models', f));
        copied++;
      }
    }
    console.log(
      `Wrote ${path.relative(REPO_ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB): ` +
        `${sceneRes.meta.featureCount} features, ${sceneRes.meta.objectCount} objects, ${sceneRes.meta.placeCount} places; ${copied} models copied`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
