#!/usr/bin/env node
/**
 * Render PNG previews (assets/previews/<key>.png) of every model in
 * assets/models/manifest.json using headless Chromium + three.js.
 * Camera looks at the model's front (+Z) from the front-right, isometric-style.
 *
 * Usage: node assets/scripts/render-previews.mjs
 */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, '..');
const require = createRequire(path.join(ASSETS, 'package.json'));
const THREE_DIR = path.dirname(path.dirname(require.resolve('three')));
const { chromium } = require('playwright');

const MIME = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.html': 'text/html' };

const PAGE = `<!doctype html><html><head><style>html,body{margin:0;background:#f4e9d8}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(512, 512);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
window.renderModel = async (url) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f4e9d8');
  scene.add(new THREE.HemisphereLight('#fff8ee', '#c9b08a', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(6, 10, 8);
  sun.castShadow = true;
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const gltf = await loader.loadAsync(url);
  const obj = gltf.scene;
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.75;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(r * 1.6, 48), new THREE.MeshStandardMaterial({ color: '#e9dcc6' }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -r * 2;
  sun.shadow.camera.right = sun.shadow.camera.top = r * 2;
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.1, 500);
  const target = new THREE.Vector3(0, size.y / 2, 0);
  cam.position.set(target.x + r * 2, target.y + r * 1.7, target.z + r * 2.6);
  cam.lookAt(target);
  renderer.render(scene, cam);
  return true;
};
window.ready = true;
</script></body></html>`;

async function main() {
  const manifest = JSON.parse(await readFile(path.join(ASSETS, 'models/manifest.json'), 'utf8'));
  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(PAGE);
      }
      const file = url.startsWith('/three/') ? path.join(THREE_DIR, url.slice('/three/'.length)) : path.join(ASSETS, url);
      if (!file.startsWith(THREE_DIR) && !file.startsWith(ASSETS)) throw new Error('forbidden');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await mkdir(path.join(ASSETS, 'previews'), { recursive: true });

  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready === true);
  for (const asset of manifest) {
    await page.evaluate((u) => window.renderModel(u), `/${asset.file}`);
    const out = path.join(ASSETS, 'previews', `${asset.assetKey}.png`);
    await page.locator('canvas').screenshot({ path: out });
    console.log('preview', path.relative(process.cwd(), out));
  }
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
