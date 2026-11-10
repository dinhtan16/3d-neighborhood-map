import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { readConfig } from '../src/config/env';
import { runSeed } from '../src/database/seeds/seed';
import { runMigrations } from '../src/database/migrate';
import { TEST_DB_URL } from './test-env';
import { createProjector } from '@nmap/geo-core';
import { CHUNK_SIZE_M } from '@nmap/map-config';

const BBOX = { minLng: 106.599, minLat: 11.416, maxLng: 106.613, maxLat: 11.428 };
const qs = (o: Record<string, unknown>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

describe('3D Neighborhood Map API (e2e)', () => {
  let app: NestExpressApplication;
  let db: Client;
  let http: ReturnType<typeof request>;
  let token: string;
  let areaId: string;
  let categoryId: string;
  let assetId: string;
  let fixturePlaceId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    db = new Client({ connectionString: TEST_DB_URL });
    await db.connect();
    areaId = (await db.query(`SELECT id FROM map_areas WHERE slug = 'chon-thanh-binh-long'`)).rows[0].id;
    categoryId = (await db.query(`SELECT id FROM place_categories WHERE slug = 'market-stalls'`)).rows[0].id;
    // Make sure at least one asset exists even if the GLB manifest has not been generated.
    assetId = (
      await db.query(
        `INSERT INTO map_assets (asset_key, name, category, model_url) VALUES ('test-stall', 'Test stall', 'stall', 'models/test.glb')
         ON CONFLICT (asset_key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      )
    ).rows[0].id;
    // Fixture features: one building, one road, inside the area.
    await db.query(
      `INSERT INTO map_features (area_id, feature_type, source, source_id, geometry, properties, height_m, levels, style_key) VALUES
       ($1, 'building', 'osm', 'way/test-1',
        ST_GeomFromText('POLYGON((106.6050 11.4210,106.6052 11.4210,106.6052 11.4212,106.6050 11.4212,106.6050 11.4210))', 4326),
        '{"tags":{"building":"yes","building:levels":"2"},"normalized":{"name":null,"kind":"yes"}}', 7, 2, 'residential-coral'),
       ($1, 'road', 'osm', 'way/test-2',
        ST_GeomFromText('LINESTRING(106.6000 11.4200,106.6050 11.42101,106.6100 11.4220)', 4326),
        '{"tags":{"highway":"secondary","name":"Đường tỉnh 751"},"normalized":{"name":"Đường tỉnh 751","highway":"secondary","widthM":9}}', NULL, NULL, NULL)`,
      [areaId],
    );
    fixturePlaceId = (
      await db.query(
        `INSERT INTO places (area_id, category_id, name, slug, location, address, status, source, source_id)
         VALUES ($1, $2, 'Chợ Chơn Thành', 'cho-chon-thanh', ST_SetSRID(ST_MakePoint(106.6061, 11.4221), 4326)::geography,
                 'Đường Nguyễn Huệ', 'active', 'osm', 'node/test-1') RETURNING id`,
        [areaId, categoryId],
      )
    ).rows[0].id;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, readConfig());
    await app.init();
    http = request(app.getHttpServer());

    const login = await http.post('/api/v1/auth/login').send({ email: 'admin@test.local', password: 'test-password' }).expect(200);
    token = login.body.data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  describe('auth', () => {
    it('rejects wrong credentials', async () => {
      const res = await http.post('/api/v1/auth/login').send({ email: 'admin@test.local', password: 'nope' }).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    });
    it('returns the current admin', async () => {
      const res = await http.get('/api/v1/auth/me').set(auth()).expect(200);
      expect(res.body.data).toEqual({ email: 'admin@test.local', role: 'admin' });
    });
  });

  describe('map chunks', () => {
    const projector = createProjector('EPSG:32648', { lat: 11.535, lng: 106.6225 });
    const chunkOf = (lng: number, lat: number) => {
      const [x, z] = projector.toLocal(lng, lat);
      return [Math.floor(x / CHUNK_SIZE_M), Math.floor(z / CHUNK_SIZE_M)] as const;
    };
    const [bcx, bcz] = chunkOf(106.6051, 11.4211); // fixture building centroid

    it('returns the chunk containing the fixture building, cacheable', async () => {
      const res = await http.get(`/api/v1/map/areas/${areaId}/chunks/${bcx}/${bcz}`).expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.body.meta).toMatchObject({ areaId, cx: bcx, cz: bcz });
      expect(res.body.data.chunk).toMatchObject({ cx: bcx, cz: bcz, sizeM: CHUNK_SIZE_M });
      const b = res.body.data.chunk.bounds;
      expect(b.minLng).toBeLessThan(106.6051);
      expect(b.maxLng).toBeGreaterThan(106.6051);
      const ids = res.body.data.features.features.map((f: any) => f.properties.sourceId);
      expect(ids).toContain('way/test-1');
    });

    it('assigns each building to exactly one chunk; roads appear in every chunk they cross', async () => {
      let buildingHits = 0;
      let roadHits = 0;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const res = await http.get(`/api/v1/map/areas/chon-thanh-binh-long/chunks/${bcx + dx}/${bcz + dz}`).expect(200);
          const ids = res.body.data.features.features.map((f: any) => f.properties.sourceId);
          buildingHits += ids.filter((i: string) => i === 'way/test-1').length;
          roadHits += ids.filter((i: string) => i === 'way/test-2').length;
        }
      }
      expect(buildingHits).toBe(1);
      expect(roadHits).toBeGreaterThan(1); // the ~1.1 km fixture road spans several 500 m chunks
    });

    it('places are assigned by point to a single chunk', async () => {
      const [pcx, pcz] = chunkOf(106.6061, 11.4221);
      let hits = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const res = await http.get(`/api/v1/map/areas/${areaId}/chunks/${pcx + dx}/${pcz + dz}`).expect(200);
          hits += res.body.data.places.filter((p: any) => p.id === fixturePlaceId).length;
        }
      }
      expect(hits).toBe(1);
    });

    it('rejects chunks outside the area and non-integer indices', async () => {
      const res = await http.get(`/api/v1/map/areas/${areaId}/chunks/999/0`).expect(400);
      expect(res.body.message).toMatch(/outside the area/);
      await http.get(`/api/v1/map/areas/${areaId}/chunks/abc/0`).expect(400);
      await http.get(`/api/v1/map/areas/no-such-area/chunks/0/0`).expect(404);
    });
  });

  describe('map', () => {
    it('lists areas with bounds and envelope meta', async () => {
      const res = await http.get('/api/v1/map/areas').expect(200);
      expect(res.body.meta.timestamp).toBeDefined();
      const area = res.body.data.find((a: any) => a.slug === 'chon-thanh-binh-long');
      expect(area).toMatchObject({ crs: 'EPSG:32648', origin: { lat: 11.535, lng: 106.6225 } });
      expect(area.bounds.minLng).toBeCloseTo(106.555);
      // The v1 neighbourhood is kept but no longer served.
      expect(res.body.data.find((a: any) => a.slug === 'chon-thanh')).toBeUndefined();
    });

    it('returns the scene with normalized feature properties', async () => {
      const res = await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX, lod: 2 })}`).expect(200);
      expect(res.body.meta).toMatchObject({ areaId, lod: 2, featureCount: 2, placeCount: 1 });
      expect(res.body.data.features.type).toBe('FeatureCollection');
      const building = res.body.data.features.features.find((f: any) => f.properties.featureType === 'building');
      expect(building.geometry.type).toBe('Polygon');
      expect(building.properties).toMatchObject({ height: 7, levels: 2, styleKey: 'residential-coral', source: 'osm', sourceId: 'way/test-1' });
      const road = res.body.data.features.features.find((f: any) => f.properties.featureType === 'road');
      expect(road.properties).toMatchObject({ highway: 'secondary', widthM: 9, name: 'Đường tỉnh 751' });
      expect(res.body.data.places[0]).toMatchObject({ name: 'Chợ Chơn Thành', location: { lat: 11.4221, lng: 106.6061 } });
    });

    it('simplifies geometry at low LOD', async () => {
      const full = await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX, lod: 2 })}`).expect(200);
      expect(full.body.data.features.features.find((f: any) => f.properties.featureType === 'road').geometry.coordinates.length).toBe(3);
      const res = await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX, lod: 0 })}`).expect(200);
      const road = res.body.data.features.features.find((f: any) => f.properties.featureType === 'road');
      expect(road.geometry.coordinates.length).toBe(2);
    });

    it.each([
      [{ ...BBOX, minLng: 106.62 }, /minLng must be less than maxLng/],
      [{ ...BBOX, minLat: 11.5 }, /minLat must be less than maxLat/],
      [{ minLng: 106, minLat: 11, maxLng: 107, maxLat: 12 }, /too large/],
    ])('rejects invalid bounds %#', async (bounds, msg) => {
      const res = await http.get(`/api/v1/map/scene?${qs({ areaId, ...bounds })}`).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(String(res.body.message)).toMatch(msg);
    });

    it('validates coordinate ranges and UUIDs', async () => {
      await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX, maxLat: 95 })}`).expect(400);
      await http.get(`/api/v1/map/scene?${qs({ areaId: 'not-a-uuid', ...BBOX })}`).expect(400);
      await http.get('/api/v1/map/features/not-a-uuid').expect(400);
    });

    it('404s for an unknown area', async () => {
      await http.get(`/api/v1/map/scene?${qs({ areaId: '00000000-0000-4000-8000-000000000000', ...BBOX })}`).expect(404);
    });

    it('forbids includeDrafts without an admin token', async () => {
      await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX, includeDrafts: true })}`).expect(403);
    });
  });

  describe('places', () => {
    let createdId: string;

    it('requires auth for mutations', async () => {
      await http.post('/api/v1/places').send({}).expect(401);
      await http.patch(`/api/v1/places/${fixturePlaceId}`).send({ name: 'x' }).expect(401);
      await http.delete(`/api/v1/places/${fixturePlaceId}`).expect(401);
    });

    it('validates the create payload', async () => {
      const res = await http.post('/api/v1/places').set(auth()).send({ name: 'X', categoryId, latitude: 120, longitude: 106.6 }).expect(400);
      expect(String(res.body.message)).toMatch(/latitude/);
      await http.post('/api/v1/places').set(auth()).send({ name: 'X', categoryId, latitude: 11.42, longitude: 106.6, hack: 1 }).expect(400);
    });

    it('rejects places outside every area', async () => {
      const res = await http.post('/api/v1/places').set(auth()).send({ name: 'Far away', categoryId, latitude: 10.76, longitude: 106.66 }).expect(400);
      expect(res.body.message).toBe('Place is outside all active map areas');
    });

    it('creates, reads, updates a place and sanitizes text', async () => {
      const created = await http
        .post('/api/v1/places')
        .set(auth())
        .send({ name: 'Tiệm Trái Cây <b>Cô Ba</b>', categoryId, latitude: 11.4225, longitude: 106.6065, description: '<script>alert(1)</script>Trái cây tươi' })
        .expect(201);
      createdId = created.body.data.id;
      expect(created.body.data).toMatchObject({ name: 'Tiệm Trái Cây Cô Ba', slug: 'tiem-trai-cay-co-ba', description: 'Trái cây tươi', source: 'manual' });

      const dup = await http.post('/api/v1/places').set(auth()).send({ name: 'Tiệm Trái Cây Cô Ba', categoryId, latitude: 11.4225, longitude: 106.6065 }).expect(201);
      expect(dup.body.data.slug).toMatch(/^tiem-trai-cay-co-ba-[0-9a-f]{6}$/);

      const patched = await http.patch(`/api/v1/places/${createdId}`).set(auth()).send({ address: '12 Nguyễn Huệ', latitude: 11.423, longitude: 106.607 }).expect(200);
      expect(patched.body.data).toMatchObject({ address: '12 Nguyễn Huệ', location: { lat: 11.423, lng: 106.607 } });

      const detail = await http.get(`/api/v1/places/${createdId}`).expect(200);
      expect(detail.body.data).toMatchObject({ id: createdId, images: [], objectIds: [], category: { slug: 'market-stalls' } });
    });

    it('requires both coordinates on update', async () => {
      await http.patch(`/api/v1/places/${createdId}`).set(auth()).send({ latitude: 11.42 }).expect(400);
    });

    it('adds and removes images', async () => {
      await http.post(`/api/v1/places/${createdId}/images`).set(auth()).send({ imageUrl: 'javascript:alert(1)' }).expect(400);
      const img = await http.post(`/api/v1/places/${createdId}/images`).set(auth()).send({ imageUrl: 'images/abc.jpg', altText: 'Front' }).expect(201);
      expect(img.body.data.imageUrl).toMatch(/\/static\/images\/abc\.jpg$/);
      await http.delete(`/api/v1/places/${createdId}/images/${img.body.data.id}`).set(auth()).expect(200);
    });

    it('searches diacritic-insensitively', async () => {
      const res = await http.get('/api/v1/places?q=cho').expect(200);
      expect(res.body.data.map((p: any) => p.name)).toContain('Chợ Chơn Thành');
      const res2 = await http.get(`/api/v1/places?${qs({ q: 'trai cay' })}`).expect(200);
      expect(res2.body.data.length).toBeGreaterThanOrEqual(2);
      const res3 = await http.get(`/api/v1/places?${qs({ q: 'chon thanh', categoryId })}`).expect(200);
      expect(res3.body.data[0].name).toBe('Chợ Chơn Thành');
    });

    it('paginates with a keyset cursor', async () => {
      const first = await http.get('/api/v1/places?limit=1').expect(200);
      expect(first.body.data).toHaveLength(1);
      expect(first.body.meta.nextCursor).toBeTruthy();
      const second = await http.get(`/api/v1/places?limit=1&cursor=${first.body.meta.nextCursor}`).expect(200);
      expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
      await http.get('/api/v1/places?cursor=garbage').expect(400);
    });

    it('finds nearby places ordered by distance', async () => {
      const res = await http.get(`/api/v1/places/nearby?${qs({ lat: 11.4221, lng: 106.6061, radius: 300 })}`).expect(200);
      expect(res.body.data[0]).toMatchObject({ name: 'Chợ Chơn Thành', distanceM: 0 });
      const ds = res.body.data.map((p: any) => p.distanceM);
      expect([...ds].sort((a, b) => a - b)).toEqual(ds);
      await http.get(`/api/v1/places/nearby?${qs({ lat: 11.42, lng: 106.6, radius: 99999 })}`).expect(400);
    });

    it('soft-deletes places', async () => {
      await http.delete(`/api/v1/places/${createdId}`).set(auth()).expect(200);
      await http.get(`/api/v1/places/${createdId}`).expect(404);
      const row = await db.query('SELECT deleted_at FROM places WHERE id = $1', [createdId]);
      expect(row.rows[0].deleted_at).not.toBeNull();
      await http.delete(`/api/v1/places/${createdId}`).set(auth()).expect(404);
    });
  });

  describe('admin map objects', () => {
    let objectId: string;
    const base = () => ({ areaId, assetId, placeId: fixturePlaceId, latitude: 11.4221, longitude: 106.6062, rotation: 1.57, scale: { x: 1, y: 1, z: 1 } });

    it('requires auth', async () => {
      await http.post('/api/v1/admin/map/objects').send(base()).expect(401);
    });

    it('rejects objects outside the area boundary', async () => {
      const res = await http.post('/api/v1/admin/map/objects').set(auth()).send({ ...base(), latitude: 11.8 }).expect(400); // north of the region
      expect(res.body.message).toBe('Object is outside the area boundary');
    });

    it('rejects unknown assets and invalid scale', async () => {
      const r1 = await http.post('/api/v1/admin/map/objects').set(auth()).send({ ...base(), assetId: '00000000-0000-4000-8000-000000000000' }).expect(400);
      expect(r1.body.message).toBe('Unknown or inactive asset');
      await http.post('/api/v1/admin/map/objects').set(auth()).send({ ...base(), scale: { x: 0, y: 1, z: 1 } }).expect(400);
    });

    it('creates a draft that is hidden from the public scene until published', async () => {
      const res = await http.post('/api/v1/admin/map/objects').set(auth()).send(base()).expect(201);
      objectId = res.body.data.id;
      expect(res.body.data).toMatchObject({ status: 'draft', placeId: fixturePlaceId, rotation: 1.57, assetKey: 'test-stall' });
      expect(res.body.data.modelUrl).toMatch(/^https?:\/\/.+\/static\/models\/test\.glb$/);

      let scene = await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX })}`).expect(200);
      expect(scene.body.data.objects.find((o: any) => o.id === objectId)).toBeUndefined();
      scene = await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX, includeDrafts: true })}`).set(auth()).expect(200);
      expect(scene.body.data.objects.find((o: any) => o.id === objectId)).toBeDefined();

      await http.post(`/api/v1/admin/map/objects/${objectId}/publish`).set(auth()).expect(200);
      scene = await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX })}`).expect(200);
      expect(scene.body.data.objects.find((o: any) => o.id === objectId)).toMatchObject({ status: 'published' });

      const detail = await http.get(`/api/v1/places/${fixturePlaceId}`).expect(200);
      expect(detail.body.data.objectIds).toContain(objectId);
    });

    it('updates position, rotation and scale (persisted)', async () => {
      const res = await http.patch(`/api/v1/admin/map/objects/${objectId}`).set(auth()).send({ latitude: 11.4222, longitude: 106.6063, rotation: 3.14, scale: { x: 2, y: 2, z: 2 } }).expect(200);
      expect(res.body.data).toMatchObject({ position: { lat: 11.4222, lng: 106.6063 }, rotation: 3.14, scale: { x: 2, y: 2, z: 2 } });
      await http.patch(`/api/v1/admin/map/objects/${objectId}`).set(auth()).send({ latitude: 12, longitude: 106.6 }).expect(400);
      const objs = await http.get(`/api/v1/map/objects?${qs({ areaId, ...BBOX })}`).expect(200);
      expect(objs.body.data.find((o: any) => o.id === objectId).position).toEqual({ lat: 11.4222, lng: 106.6063 });
    });

    it('publishes all drafts in an area', async () => {
      await http.post('/api/v1/admin/map/objects').set(auth()).send({ ...base(), placeId: null }).expect(201);
      const res = await http.post('/api/v1/admin/map/publish').set(auth()).send({ areaId }).expect(200);
      expect(res.body.data.published).toBe(1);
    });

    it('soft-deletes objects', async () => {
      await http.delete(`/api/v1/admin/map/objects/${objectId}`).set(auth()).expect(200);
      const scene = await http.get(`/api/v1/map/scene?${qs({ areaId, ...BBOX })}`).expect(200);
      expect(scene.body.data.objects.find((o: any) => o.id === objectId)).toBeUndefined();
      const row = await db.query('SELECT deleted_at FROM map_objects WHERE id = $1', [objectId]);
      expect(row.rows[0].deleted_at).not.toBeNull();
    });
  });

  describe('import jobs', () => {
    it('queues an import job and returns a job id', async () => {
      const res = await http.post('/api/v1/admin/map/import/osm').set(auth()).send({ areaId, bounds: BBOX }).expect(202);
      expect(res.body.data).toMatchObject({ status: 'queued' });
      const job = await http.get(`/api/v1/admin/map/import/jobs/${res.body.data.jobId}`).set(auth()).expect(200);
      expect(job.body.data.jobId).toBe(res.body.data.jobId);
      // Stop a real importer (if installed) from touching the test DB further.
      await db.query(`UPDATE import_jobs SET status = 'failed', error_message = 'cancelled by test' WHERE id = $1 AND status = 'queued'`, [res.body.data.jobId]);
    });

    it('validates import bounds', async () => {
      await http.post('/api/v1/admin/map/import/osm').set(auth()).send({ areaId, bounds: { ...BBOX, minLng: 107 } }).expect(400);
    });
  });

  describe('uploads', () => {
    it('rejects non-image uploads', async () => {
      await http.post('/api/v1/admin/uploads/image').set(auth()).attach('file', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' }).expect(400);
    });
    it('rejects spoofed image content', async () => {
      await http.post('/api/v1/admin/uploads/image').set(auth()).attach('file', Buffer.from('not a png'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
    });
    it('stores a real PNG', async () => {
      const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
      const res = await http.post('/api/v1/admin/uploads/image').set(auth()).attach('file', png, { filename: 'x.png', contentType: 'image/png' }).expect(201);
      expect(res.body.data.path).toMatch(/^images\/[0-9a-f-]+\.png$/);
    });
  });

  describe('migrations & seed', () => {
    it('are idempotent', async () => {
      const before = (await db.query(`SELECT (SELECT count(*) FROM place_categories) c, (SELECT count(*) FROM map_areas) a, (SELECT count(*) FROM map_assets) s`)).rows[0];
      await runMigrations(TEST_DB_URL, () => undefined);
      await runSeed(TEST_DB_URL, () => undefined);
      await runSeed(TEST_DB_URL, () => undefined);
      const after = (await db.query(`SELECT (SELECT count(*) FROM place_categories) c, (SELECT count(*) FROM map_areas) a, (SELECT count(*) FROM map_assets) s`)).rows[0];
      expect(after).toEqual(before);
    });
  });
});
