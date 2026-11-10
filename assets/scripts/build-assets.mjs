#!/usr/bin/env node
/**
 * Procedural stylized low-poly asset generator.
 *
 * Produces illustrated, flat-coloured GLB models that follow the asset contract
 * documented in docs/asset-guidelines.md:
 *   - units: meters
 *   - origin: base centre (bbox centred on X/Z, min Y = 0)
 *   - forward: +Z (shop fronts, awnings, signs, vehicle noses face +Z)
 *
 * These models are placeholders with the same contract as Blender exports and
 * can be replaced one-by-one by hand-made GLBs without code changes.
 *
 * Usage: node assets/scripts/build-assets.mjs [--no-compress]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../models');
const COMPRESS = !process.argv.includes('--no-compress');

// ---------------------------------------------------------------------------
// Palette (illustrated art direction: coral, beige, green, pastel)
// ---------------------------------------------------------------------------
const PALETTE = {
  coral: '#f08a6c',
  coralDark: '#c9604a',
  beige: '#f6e3c3',
  cream: '#fff4e0',
  mint: '#b9dfc8',
  mintDark: '#6fa98a',
  peach: '#f9c59d',
  terracotta: '#b45f3f',
  sand: '#e8d6a8',
  white: '#fdfaf3',
  wood: '#a86b45',
  woodDark: '#7a4a2e',
  woodLight: '#d2a477',
  steel: '#9aa3ad',
  steelDark: '#5f6871',
  glass: '#6f9fb4',
  glassDark: '#4e7487',
  outline: '#3b2a20',
  yellow: '#f2b544',
  red: '#e2574c',
  blue: '#5b8bd6',
  blueLight: '#a9c8ef',
  green: '#7fb069',
  leaf: '#7cb860',
  leafDark: '#5c9a48',
  leafLight: '#a3d07e',
  trunk: '#8b5a3c',
  orange: '#f39a3b',
  tank: '#7fa7c9',
  concrete: '#cfc6b8',
  tire: '#3a3a40',
  lamp: '#fff2b3',
  plasticRed: '#e0504a',
  plasticBlue: '#4f86d1',
};

// ---------------------------------------------------------------------------
// Geometry helpers. `y` is always the BASE of the part.
// ---------------------------------------------------------------------------
function strip(g) {
  g.deleteAttribute('uv');
  return g.index ? g : g;
}
function place(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return strip(g);
}
/** Box with its base at y. */
const box = (w, h, d, x = 0, y = 0, z = 0, rot = {}) =>
  place(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), { x, y, z, ...rot });
/** Cylinder with its base at y. */
const cyl = (rTop, rBottom, h, x = 0, y = 0, z = 0, seg = 10, rot = {}) =>
  place(new THREE.CylinderGeometry(rTop, rBottom, h, seg).translate(0, h / 2, 0), { x, y, z, ...rot });
const cone = (r, h, x = 0, y = 0, z = 0, seg = 10, rot = {}) =>
  place(new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), { x, y, z, ...rot });
/** Sphere centred at (x, y, z). */
const sphere = (r, x = 0, y = 0, z = 0, w = 8, h = 6) =>
  place(new THREE.SphereGeometry(r, w, h), { x, y, z });
/** Low-poly blob (icosahedron) centred at (x, y, z). */
const blob = (r, x = 0, y = 0, z = 0, sy = 1, detail = 1) => {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(1, sy, 1);
  return place(g, { x, y, z });
};
/** Wheel: cylinder lying along X, centre at (x, y, z). */
const wheel = (r, w, x, y, z, seg = 12) =>
  place(new THREE.CylinderGeometry(r, r, w, seg), { x, y, z, rz: Math.PI / 2 });

// ---------------------------------------------------------------------------
// Model builder
// ---------------------------------------------------------------------------
class Model {
  constructor(key, name, category) {
    this.key = key;
    this.name = name;
    this.category = category;
    /** @type {Map<string, Map<string, THREE.BufferGeometry[]>>} node -> material -> geoms */
    this.nodes = new Map();
  }
  add(node, material, ...geoms) {
    if (!PALETTE[material]) throw new Error(`Unknown material ${material}`);
    if (!this.nodes.has(node)) this.nodes.set(node, new Map());
    const mats = this.nodes.get(node);
    if (!mats.has(material)) mats.set(material, []);
    mats.get(material).push(...geoms.flat());
    return this;
  }
}

/** Striped awning: stripes along X, sloping down and out along +Z. */
function addAwning(m, node, { width, depth, attachY, frontZ, x = 0, angle = 0.38, stripes = 6, colors = ['coral', 'cream'] }) {
  const sw = width / stripes;
  for (let i = 0; i < stripes; i++) {
    const g = new THREE.BoxGeometry(sw, 0.05, depth).translate(0, 0, depth / 2);
    g.rotateX(angle);
    g.translate(x - width / 2 + sw * (i + 0.5), attachY, frontZ);
    m.add(node, colors[i % colors.length], strip(g));
  }
  // Scalloped valance along the front edge.
  const endY = attachY - Math.sin(angle) * depth;
  const endZ = frontZ + Math.cos(angle) * depth;
  for (let i = 0; i < stripes; i++) {
    m.add(node, colors[i % colors.length], box(sw, 0.22, 0.04, x - width / 2 + sw * (i + 0.5), endY - 0.22, endZ));
  }
  return { endY, endZ };
}

/** Plastic stools + low table typical of Vietnamese street eateries. */
function addTableSet(m, node, cx, cz, { tableColor = 'woodLight', stoolColors = ['plasticRed', 'plasticBlue'] } = {}) {
  m.add(node, tableColor, cyl(0.42, 0.42, 0.05, cx, 0.62, cz, 14));
  m.add(node, 'steelDark', cyl(0.04, 0.04, 0.62, cx, 0, cz, 6), cyl(0.22, 0.25, 0.03, cx, 0, cz, 10));
  const offs = [[0.65, 0], [-0.65, 0], [0, 0.65], [0, -0.65]];
  offs.forEach(([dx, dz], i) => {
    m.add(node, stoolColors[i % stoolColors.length], cyl(0.15, 0.18, 0.42, cx + dx, 0, cz + dz, 10));
  });
}

function addUmbrella(m, node, cx, cz, { h = 2.4, r = 1.3, colors = ['coral', 'cream'] } = {}) {
  m.add(node, 'steel', cyl(0.035, 0.035, h, cx, 0, cz, 6));
  const seg = 8;
  for (let i = 0; i < seg; i++) {
    const g = new THREE.ConeGeometry(r, 0.55, seg, 1, true, (i / seg) * Math.PI * 2, (Math.PI * 2) / seg);
    g.translate(cx, h + 0.27 - 0.25, cz);
    m.add(node, colors[i % colors.length], strip(g));
  }
  m.add(node, 'white', sphere(0.06, cx, h + 0.32, cz, 6, 4));
}

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------
function shophouse(key, name, o) {
  const m = new Model(key, name, 'building');
  const W = 4.5, D = 12, floorH = 3.4, groundH = 3.6, base = 0.2;
  const front = D / 2;
  const totalH = base + groundH + floorH * (o.floors - 1);

  m.add('Base', 'concrete', box(W + 0.2, base, D + 0.2, 0, 0, 0));
  // Ground floor shell (front opening handled by the door panel).
  m.add('GroundFloor', o.groundWall, box(W, groundH, D, 0, base, 0));
  // Upper floors are slightly recessed at the front to make room for balconies.
  for (let f = 1; f < o.floors; f++) {
    const y = base + groundH + floorH * (f - 1);
    m.add(`Floor${f + 1}`, o.upperWall, box(W, floorH, D - 0.6, 0, y, -0.3));
    m.add(`Floor${f + 1}`, o.trim, box(W + 0.08, 0.14, D - 0.5, 0, y, -0.3)); // floor band
    // Balcony slab, railing and posts.
    m.add(`Balcony${f + 1}`, o.trim, box(W, 0.14, 1.1, 0, y, front - 0.05));
    m.add(`Balcony${f + 1}`, o.rail, box(W, 0.08, 0.06, 0, y + 1.0, front + 0.45));
    for (let i = 0; i <= 6; i++) {
      m.add(`Balcony${f + 1}`, o.rail, box(0.05, 1.0, 0.05, -W / 2 + 0.05 + (i * (W - 0.1)) / 6, y + 0.14, front + 0.45));
    }
    // Balcony door + flanking window, with frames.
    m.add(`Windows${f + 1}`, o.trim, box(1.9, 2.5, 0.06, -0.6, y + 0.15, front - 0.6));
    m.add(`Windows${f + 1}`, 'glass', box(1.6, 2.25, 0.08, -0.6, y + 0.2, front - 0.6));
    m.add(`Windows${f + 1}`, o.trim, box(1.2, 1.4, 0.06, 1.45, y + 1.0, front - 0.6));
    m.add(`Windows${f + 1}`, 'glassDark', box(0.95, 1.15, 0.08, 1.45, y + 1.1, front - 0.6));
    // Plant pots on the balcony.
    m.add(`Balcony${f + 1}`, 'terracotta', cyl(0.18, 0.13, 0.3, 1.6, y + 0.14, front + 0.15, 8));
    m.add(`Balcony${f + 1}`, 'leaf', blob(0.28, 1.6, y + 0.6, front + 0.15, 0.9, 0));
    // Side windows along the long walls.
    for (let s = 0; s < 3; s++) {
      const z = -front + 2.5 + s * 3.2;
      m.add(`Windows${f + 1}`, 'glassDark', box(0.06, 1.0, 0.9, W / 2 + 0.01, y + 1.2, z), box(0.06, 1.0, 0.9, -W / 2 - 0.01, y + 1.2, z));
    }
  }

  // Roof parapet + rooftop water tank (a ubiquitous Vietnamese roof detail).
  m.add('Roof', o.roof, box(W + 0.12, 0.45, D - 0.45, 0, totalH, -0.3));
  m.add('Roof', o.roofTop, box(W - 0.4, 0.06, D - 0.95, 0, totalH + 0.47, -0.3));
  m.add('RoofTank', 'steel', cyl(0.08, 0.08, 0.5, -1.4, totalH + 0.5, -3.5, 6), cyl(0.08, 0.08, 0.5, -0.4, totalH + 0.5, -3.5, 6));
  m.add('RoofTank', 'tank', place(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 14), { x: -0.9, y: totalH + 1.5, z: -3.5, rz: Math.PI / 2 }));

  // Shop front: roll-up shutter (partially open) and a glass counter behind.
  m.add('Shopfront', o.trim, box(W - 0.3, 0.3, 0.1, 0, base + 2.45, front + 0.02));
  m.add('Shopfront', 'steel', box(3.9, 0.7, 0.07, 0, base + 1.8, front + 0.02));
  for (let i = 0; i < 4; i++) m.add('Shopfront', 'steelDark', box(3.9, 0.025, 0.08, 0, base + 1.85 + i * 0.16, front + 0.03));
  m.add('Shopfront', 'outline', box(3.9, 1.8, 0.05, 0, base, front - 0.1));
  m.add('Shopfront', 'glass', box(2.6, 0.9, 0.5, 0, base, front - 0.6));
  m.add('Shopfront', o.trim, box(2.7, 0.08, 0.6, 0, base + 0.9, front - 0.6));
  // Sign board above the shutter.
  m.add('Sign', o.sign, box(W - 0.2, 0.75, 0.14, 0, base + 2.85, front + 0.08));
  m.add('Sign', o.signBand, box(W - 0.6, 0.18, 0.16, 0, base + 3.12, front + 0.08));
  m.add('Sign', 'white', box(0.5, 0.12, 0.16, -1.4, base + 2.95, front + 0.08), box(0.8, 0.12, 0.16, 0.9, base + 2.95, front + 0.08));
  // Striped awning sloping over the pavement.
  addAwning(m, 'Awning', { width: W - 0.1, depth: 1.4, attachY: base + 2.8, frontZ: front + 0.1, colors: o.awning });
  // A few goods outside the shop.
  m.add('Goods', 'woodLight', box(0.6, 0.45, 0.45, -1.6, 0, front + 0.5), box(0.6, 0.45, 0.45, 1.6, 0, front + 0.5));
  m.add('Goods', o.goods, box(0.5, 0.18, 0.35, -1.6, 0.45, front + 0.5), box(0.5, 0.18, 0.35, 1.6, 0.45, front + 0.5));
  return m;
}

function cafe() {
  const m = new Model('cafe-01', 'Street Café', 'shop');
  const W = 5, D = 7, H = 3.8, front = D / 2 - 1.5; // building front at z = 2; terrace in front
  const cz = -1.5;
  m.add('Base', 'concrete', box(W + 0.3, 0.15, D + 0.3, 0, 0, 0));
  m.add('Building', 'beige', box(W, H, D - 3, 0, 0.15, cz));
  m.add('Roof', 'mintDark', box(W + 0.3, 0.35, D - 2.7, 0, H + 0.15, cz));
  m.add('Roof', 'mint', box(W - 0.2, 0.05, D - 3.2, 0, H + 0.52, cz));
  // Large glazed front with wooden frame.
  m.add('Shopfront', 'woodDark', box(W - 0.4, 2.7, 0.08, 0, 0.15, front + 0.01));
  m.add('Shopfront', 'glass', box(1.9, 2.4, 0.1, -1.1, 0.3, front + 0.02), box(1.9, 2.4, 0.1, 1.1, 0.3, front + 0.02));
  m.add('Shopfront', 'woodLight', box(0.9, 2.3, 0.12, 0, 0.15, front + 0.03));
  m.add('Sign', 'woodDark', box(3.4, 0.6, 0.14, 0, 3.05, front + 0.08));
  m.add('Sign', 'cream', box(2.6, 0.2, 0.16, 0, 3.25, front + 0.08));
  m.add('Sign', 'coral', cyl(0.18, 0.14, 0.25, 1.4, 3.15, front + 0.18, 10)); // coffee cup emblem
  addAwning(m, 'Awning', { width: W - 0.2, depth: 1.2, attachY: 2.95, frontZ: front + 0.1, stripes: 7, colors: ['mintDark', 'cream'] });
  // Terrace: two table sets, an umbrella and planters.
  addTableSet(m, 'Terrace', -1.2, front + 2.0);
  addTableSet(m, 'Terrace', 1.3, front + 2.3, { stoolColors: ['plasticBlue', 'plasticRed'] });
  addUmbrella(m, 'Umbrella', 1.3, front + 2.3, { colors: ['coral', 'cream'] });
  m.add('Planters', 'terracotta', box(0.5, 0.45, 0.5, -2.2, 0.15, front + 0.5), box(0.5, 0.45, 0.5, 2.2, 0.15, front + 0.5));
  m.add('Planters', 'leaf', blob(0.38, -2.2, 0.95, front + 0.5, 1, 0), blob(0.38, 2.2, 0.95, front + 0.5, 1, 0));
  // Chalkboard menu.
  m.add('Menu', 'woodDark', box(0.6, 0.9, 0.06, -0.2, 0.15, front + 3.4, { rx: -0.25 }));
  m.add('Menu', 'outline', box(0.5, 0.7, 0.07, -0.2, 0.25, front + 3.42, { rx: -0.25 }));
  return m;
}

function fruitStall() {
  const m = new Model('fruit-stall-01', 'Fruit Market Stall', 'stall');
  const W = 3, D = 2;
  // Table.
  m.add('Table', 'wood', box(W, 0.08, D, 0, 0.8, 0));
  m.add('Table', 'woodDark', box(W - 0.1, 0.7, 0.05, 0, 0.1, D / 2 - 0.05), box(W - 0.1, 0.7, 0.05, 0, 0.1, -D / 2 + 0.05));
  for (const [x, z] of [[-1.45, -0.95], [1.45, -0.95], [-1.45, 0.95], [1.45, 0.95]]) {
    m.add('Posts', 'woodDark', box(0.08, 2.4, 0.08, x, 0, z));
  }
  // Gabled striped canopy.
  const stripes = 8;
  const sw = W / stripes;
  for (const side of [-1, 1]) {
    for (let i = 0; i < stripes; i++) {
      const g = new THREE.BoxGeometry(sw, 0.04, 1.35).translate(0, 0, 0.675 * side);
      g.rotateX(side * 0.42);
      g.translate(-W / 2 + sw * (i + 0.5), 2.85, 0);
      m.add('Canopy', i % 2 ? 'cream' : 'red', strip(g));
    }
  }
  m.add('Canopy', 'woodDark', box(W + 0.1, 0.08, 0.08, 0, 2.82, 0));
  // Crates of colourful fruit (front faces +Z).
  const fruits = [
    ['orange', 0.09], ['red', 0.08], ['yellow', 0.1], ['green', 0.11], ['orange', 0.09], ['red', 0.08],
  ];
  fruits.forEach(([color, r], i) => {
    const cx = -1.1 + (i % 3) * 1.1;
    const cz = i < 3 ? 0.45 : -0.35;
    const y = 0.88 + (i < 3 ? 0 : 0.12);
    m.add('Crates', 'woodLight', box(0.85, 0.22, 0.65, cx, y, cz));
    for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
      m.add('Fruit', color, sphere(r * 1.15, cx - 0.25 + a * 0.25, y + 0.25 + r * 0.5, cz - 0.13 + b * 0.26, 7, 5));
    }
    m.add('Fruit', color, sphere(r * 1.15, cx, y + 0.42 + r * 0.5, cz, 7, 5));
  });
  // Hanging banana bunch + baskets under the table.
  m.add('Fruit', 'yellow', blob(0.16, 1.2, 2.3, 0.9, 1.5, 0), blob(0.14, -1.2, 2.3, 0.9, 1.5, 0));
  m.add('Baskets', 'woodLight', cyl(0.3, 0.22, 0.32, 0.9, 0, 1.4, 10), cyl(0.3, 0.22, 0.32, -0.9, 0, 1.45, 10));
  m.add('Fruit', 'green', blob(0.22, 0.9, 0.4, 1.4, 0.7, 1), blob(0.22, -0.9, 0.4, 1.45, 0.7, 1));
  return m;
}

function foodCart() {
  const m = new Model('food-cart-01', 'Street Food Cart', 'stall');
  m.add('Body', 'cream', box(1.6, 0.75, 0.8, 0, 0.35, 0));
  m.add('Body', 'coral', box(1.62, 0.15, 0.82, 0, 0.95, 0));
  m.add('Body', 'steel', box(1.6, 0.04, 0.8, 0, 1.1, 0));
  m.add('GlassCase', 'glass', box(1.2, 0.55, 0.55, -0.1, 1.14, -0.05));
  m.add('GlassCase', 'steel', box(1.24, 0.04, 0.6, -0.1, 1.69, -0.05));
  m.add('Pot', 'steelDark', cyl(0.18, 0.18, 0.3, 0.6, 1.14, 0, 12));
  m.add('Wheels', 'tire', wheel(0.3, 0.08, -0.84, 0.3, 0), wheel(0.3, 0.08, 0.84, 0.3, 0));
  m.add('Wheels', 'steelDark', box(0.06, 0.35, 0.06, -0.7, 0, 0.3), box(0.06, 0.35, 0.06, -0.7, 0, -0.3));
  m.add('Handle', 'steelDark', box(0.04, 0.04, 0.5, 0.95, 0.9, 0, { rz: 0.2 }));
  m.add('Sign', 'yellow', box(1.0, 0.25, 0.04, 0, 0.55, 0.42));
  addUmbrella(m, 'Umbrella', 0.55, -0.3, { h: 2.3, r: 1.0, colors: ['yellow', 'coral'] });
  return m;
}

function awning() {
  const m = new Model('awning-01', 'Striped Awning', 'decoration');
  m.add('Frame', 'steelDark', box(3.1, 0.1, 0.1, 0, 2.6, -0.05));
  m.add('Frame', 'steelDark', box(0.06, 2.55, 0.06, -1.5, 0, 1.25), box(0.06, 2.55, 0.06, 1.5, 0, 1.25));
  addAwning(m, 'Canvas', { width: 3, depth: 1.4, attachY: 2.65, frontZ: 0, angle: 0.3, stripes: 6, colors: ['coral', 'cream'] });
  return m;
}

function tableSet() {
  const m = new Model('table-set-01', 'Table & Stools', 'furniture');
  addTableSet(m, 'TableSet', 0, 0);
  return m;
}

function tree() {
  const m = new Model('tree-01', 'Tropical Tree', 'vegetation');
  m.add('Trunk', 'trunk', cyl(0.16, 0.24, 2.6, 0, 0, 0, 8));
  m.add('Trunk', 'trunk', cyl(0.07, 0.1, 1.0, 0.25, 2.0, 0, 6, { rz: -0.6 }));
  m.add('Canopy', 'leaf', blob(1.5, 0, 3.6, 0, 0.8, 1));
  m.add('Canopy', 'leafDark', blob(1.05, 0.9, 3.1, 0.4, 0.8, 1), blob(1.0, -0.8, 3.2, -0.5, 0.8, 1));
  m.add('Canopy', 'leafLight', blob(0.8, -0.2, 4.4, 0.4, 0.8, 1));
  return m;
}

function palm() {
  const m = new Model('palm-01', 'Palm Tree', 'vegetation');
  let x = 0;
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const r = 0.2 - i * 0.012;
    m.add('Trunk', i % 2 ? 'trunk' : 'woodDark', cyl(r - 0.01, r, 0.75, x, i * 0.72, 0, 8));
    x += 0.06 * i * 0.3;
  }
  const topY = segs * 0.72;
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.5, 0.04, 2.4).translate(0, 0, 1.2);
    g.rotateX(0.5 + (i % 2) * 0.25);
    g.rotateY(a);
    g.translate(x, topY + 0.1, 0);
    m.add('Fronds', i % 2 ? 'leafDark' : 'leaf', strip(g));
  }
  m.add('Coconuts', 'woodDark', sphere(0.14, x + 0.15, topY - 0.05, 0.1, 6, 4), sphere(0.14, x - 0.1, topY - 0.05, -0.15, 6, 4));
  return m;
}

function streetLight() {
  const m = new Model('street-light-01', 'Street Light', 'street-furniture');
  m.add('Pole', 'steelDark', cyl(0.18, 0.22, 0.4, 0, 0, 0, 8));
  m.add('Pole', 'steel', cyl(0.06, 0.09, 6.0, 0, 0.4, 0, 8));
  m.add('Arm', 'steel', box(0.08, 0.08, 1.4, 0, 6.2, 0.65, { rx: 0 }));
  m.add('Arm', 'steel', cyl(0.06, 0.06, 0.25, 0, 6.2, 0, 6));
  m.add('Lamp', 'steelDark', box(0.32, 0.14, 0.6, 0, 6.08, 1.3));
  m.add('Lamp', 'lamp', box(0.26, 0.04, 0.5, 0, 6.05, 1.3));
  return m;
}

function bench() {
  const m = new Model('bench-01', 'Park Bench', 'street-furniture');
  for (let i = 0; i < 3; i++) m.add('Seat', 'woodLight', box(1.6, 0.05, 0.13, 0, 0.45, -0.18 + i * 0.16));
  for (let i = 0; i < 2; i++) m.add('Back', 'woodLight', box(1.6, 0.13, 0.04, 0, 0.62 + i * 0.18, -0.28, { rx: -0.15 }));
  for (const x of [-0.7, 0.7]) {
    m.add('Legs', 'steelDark', box(0.06, 0.45, 0.06, x, 0, 0.15), box(0.06, 0.95, 0.06, x, 0, -0.27), box(0.06, 0.05, 0.5, x, 0.4, -0.05));
  }
  return m;
}

function scooter() {
  const m = new Model('scooter-01', 'Scooter', 'vehicle');
  // Forward = +Z.
  m.add('Wheels', 'tire', wheel(0.27, 0.12, 0, 0.27, 0.62), wheel(0.27, 0.12, 0, 0.27, -0.6));
  m.add('Wheels', 'steel', wheel(0.13, 0.13, 0, 0.27, 0.62, 8), wheel(0.13, 0.13, 0, 0.27, -0.6, 8));
  m.add('Body', 'coral', box(0.36, 0.42, 0.75, 0, 0.32, -0.38));
  m.add('Body', 'coral', box(0.34, 0.8, 0.18, 0, 0.32, 0.48, { rx: -0.25 }));
  m.add('Body', 'cream', box(0.3, 0.06, 0.55, 0, 0.32, 0.1)); // floorboard
  m.add('Body', 'cream', box(0.3, 0.12, 0.25, 0, 0.32, 0.72)); // front fender
  m.add('Seat', 'outline', box(0.32, 0.12, 0.62, 0, 0.74, -0.35));
  m.add('Handlebar', 'steelDark', cyl(0.025, 0.025, 0.4, 0, 0.75, 0.52, 6, { rx: -0.25 }));
  m.add('Handlebar', 'steelDark', box(0.62, 0.04, 0.04, 0, 1.12, 0.45));
  m.add('Handlebar', 'cream', box(0.2, 0.12, 0.1, 0, 1.0, 0.56));
  m.add('Lights', 'lamp', box(0.12, 0.08, 0.04, 0, 1.02, 0.62));
  m.add('Lights', 'red', box(0.14, 0.06, 0.04, 0, 0.62, -0.76));
  return m;
}

function bus() {
  const m = new Model('bus-01', 'City Bus', 'vehicle');
  const L = 10, W = 2.5, H = 3.0, base = 0.45;
  m.add('Body', 'green', box(W, 1.3, L, 0, base, 0));
  m.add('Body', 'cream', box(W, 1.2, L, 0, base + 1.3, 0));
  m.add('Roof', 'white', box(W - 0.05, 0.12, L - 0.1, 0, base + 2.5, 0));
  m.add('Roof', 'steel', box(1.2, 0.3, 2.0, 0, base + 2.62, -2));
  // Window band on both sides + windscreen (front = +Z).
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) m.add('Windows', 'glassDark', box(0.05, 0.85, 1.3, sx * (W / 2 + 0.01), base + 1.45, -3.9 + i * 1.5));
  }
  m.add('Windows', 'glass', box(W - 0.3, 1.1, 0.06, 0, base + 1.3, L / 2 + 0.01));
  m.add('Windows', 'glassDark', box(W - 0.3, 0.9, 0.06, 0, base + 1.4, -L / 2 - 0.01));
  m.add('Door', 'glassDark', box(0.06, 1.9, 1.1, W / 2 + 0.02, base + 0.2, 3.3));
  m.add('Stripe', 'yellow', box(W + 0.02, 0.14, L + 0.02, 0, base + 1.2, 0));
  m.add('Lights', 'lamp', box(0.35, 0.18, 0.05, -0.85, base + 0.4, L / 2 + 0.02), box(0.35, 0.18, 0.05, 0.85, base + 0.4, L / 2 + 0.02));
  m.add('Lights', 'red', box(0.3, 0.18, 0.05, -0.9, base + 0.4, -L / 2 - 0.02), box(0.3, 0.18, 0.05, 0.9, base + 0.4, -L / 2 - 0.02));
  m.add('Sign', 'outline', box(1.6, 0.3, 0.05, 0, base + 2.15, L / 2 + 0.02));
  for (const z of [3.3, -3.0]) for (const sx of [-1, 1]) m.add('Wheels', 'tire', wheel(0.48, 0.32, sx * (W / 2 - 0.18), 0.48, z, 14));
  return m;
}

function sign() {
  const m = new Model('sign-01', 'Street Sign', 'street-furniture');
  m.add('Post', 'steel', cyl(0.05, 0.05, 2.6, 0, 0, 0, 8));
  m.add('Board', 'blue', box(1.2, 0.45, 0.06, 0, 2.15, 0.06));
  m.add('Board', 'white', box(1.0, 0.08, 0.07, 0, 2.33, 0.06), box(0.7, 0.08, 0.07, -0.1, 2.21, 0.06));
  m.add('Board', 'white', box(1.24, 0.03, 0.065, 0, 2.15, 0.06), box(1.24, 0.03, 0.065, 0, 2.57, 0.06));
  return m;
}

const MODELS = [
  shophouse('shophouse-01', 'Shophouse (2 floors)', {
    floors: 2, groundWall: 'beige', upperWall: 'coral', trim: 'cream', rail: 'white', roof: 'terracotta', roofTop: 'concrete',
    sign: 'yellow', signBand: 'coralDark', awning: ['coral', 'cream'], goods: 'orange',
  }),
  shophouse('shophouse-02', 'Shophouse (3 floors)', {
    floors: 3, groundWall: 'sand', upperWall: 'mint', trim: 'white', rail: 'steelDark', roof: 'mintDark', roofTop: 'concrete',
    sign: 'blue', signBand: 'white', awning: ['blue', 'white'], goods: 'red',
  }),
  cafe(),
  fruitStall(),
  foodCart(),
  awning(),
  tableSet(),
  tree(),
  palm(),
  streetLight(),
  bench(),
  scooter(),
  bus(),
  sign(),
];

// ---------------------------------------------------------------------------
// glTF export
// ---------------------------------------------------------------------------
function hexToLinear(hex) {
  const c = new THREE.Color(hex); // sRGB input, converted to linear working space
  return [c.r, c.g, c.b, 1];
}

function mergeNodeGeometry(geoms) {
  const prepared = geoms.map((g) => {
    const ng = g.index ? g : g;
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    // Ensure consistent attribute sets.
    for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal') ng.deleteAttribute(name);
    return ng.index ? ng : ng;
  });
  const allIndexed = prepared.every((g) => g.index);
  const list = allIndexed ? prepared : prepared.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(list, false);
  if (!merged) throw new Error('merge failed');
  if (!merged.index) {
    const idx = new Uint32Array(merged.getAttribute('position').count).map((_, i) => i);
    merged.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return merged;
}

async function buildDocument(model) {
  // Normalise placement: centre X/Z, min Y at 0 (origin = base centre).
  const all = [];
  for (const mats of model.nodes.values()) for (const geoms of mats.values()) all.push(...geoms);
  const bb = new THREE.Box3();
  for (const g of all) {
    g.computeBoundingBox();
    bb.union(g.boundingBox);
  }
  const shift = new THREE.Vector3(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  for (const g of all) g.translate(shift.x, shift.y, shift.z);
  bb.translate(shift);

  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  doc.createBuffer();
  const scene = doc.createScene(model.key);
  const root = doc.createNode(model.key);
  scene.addChild(root);
  const materials = new Map();
  const material = (key) => {
    if (!materials.has(key)) {
      const mat = doc
        .createMaterial(key)
        .setBaseColorFactor(hexToLinear(PALETTE[key]))
        .setRoughnessFactor(1)
        .setMetallicFactor(0);
      if (key === 'lamp') mat.setEmissiveFactor(hexToLinear(PALETTE.lamp).slice(0, 3));
      materials.set(key, mat);
    }
    return materials.get(key);
  };

  let triangles = 0;
  for (const [nodeName, mats] of model.nodes) {
    const mesh = doc.createMesh(nodeName);
    for (const [matKey, geoms] of mats) {
      const g = mergeNodeGeometry(geoms);
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      const index = g.index.array;
      triangles += index.length / 3;
      const prim = doc
        .createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos.array)))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor.array)))
        .setIndices(
          doc.createAccessor().setType('SCALAR').setArray(pos.count > 65535 ? new Uint32Array(index) : new Uint16Array(index)),
        )
        .setMaterial(material(matKey));
      mesh.addPrimitive(prim);
    }
    root.addChild(doc.createNode(nodeName).setMesh(mesh));
  }
  doc.getRoot().getAsset().generator = 'nmap procedural asset generator';
  doc.getRoot().setDefaultScene(scene);

  const round = (v) => Math.round(v * 1000) / 1000;
  const size = bb.getSize(new THREE.Vector3());
  const boundingBox = {
    min: bb.min.toArray().map(round),
    max: bb.max.toArray().map(round),
    size: size.toArray().map(round),
    origin: 'base-center',
    forward: '+Z',
    units: 'meters',
  };
  return { doc, boundingBox, triangles };
}

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  await mkdir(OUT_DIR, { recursive: true });
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  const manifest = [];
  for (const model of MODELS) {
    const { doc, boundingBox, triangles } = await buildDocument(model);
    await doc.transform(dedup(), weld());
    if (COMPRESS) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const glb = await io.writeBinary(doc);
    const file = `${model.key}.glb`;
    await writeFile(path.join(OUT_DIR, file), glb);
    manifest.push({
      assetKey: model.key,
      name: model.name,
      category: model.category,
      file: `models/${file}`,
      boundingBox,
      metadata: {
        compressed: COMPRESS ? 'EXT_meshopt_compression' : false,
        triangles,
        bytes: glb.byteLength,
        nodes: [...model.nodes.keys()],
        license: 'CC0 – generated in-repo',
        author: 'procedural generator (assets/scripts/build-assets.mjs)',
      },
    });
    console.log(`${file.padEnd(22)} ${String(triangles).padStart(6)} tris  ${(glb.byteLength / 1024).toFixed(1).padStart(6)} KB  size ${boundingBox.size.join(' x ')} m`);
  }
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${manifest.length} models + manifest.json to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
