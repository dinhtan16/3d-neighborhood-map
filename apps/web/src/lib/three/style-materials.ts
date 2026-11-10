import * as THREE from 'three';
import { STYLE_V2 } from '@nmap/map-config';

/**
 * Illustrated v2 materials (reference: hand-drawn isometric city art).
 * - flat colours with a two-step toon ramp, no PBR
 * - patterns (façades, paving) are computed procedurally in world metres
 * - outlines come from the screen-space OutlinePass, not from geometry
 * - shared fog uniforms so every custom shader fades into the sky colour
 */

export const fogUniforms = {
  uFogColor: { value: new THREE.Color(STYLE_V2.sky) },
  uFogNear: { value: 1e6 },
  uFogFar: { value: 2e6 },
};

/** Called by the camera rigs: perspective mode fades distant chunks out. */
export function setFog(near: number, far: number) {
  fogUniforms.uFogNear.value = near;
  fogUniforms.uFogFar.value = far;
}

const LIGHT_DIR = new THREE.Vector3(-0.45, 0.85, 0.35).normalize();

const commonVert = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
`;
// Fog distance is computed per fragment from the (affinely interpolated) world
// position: per-vertex distances break on huge triangles such as the ground plane.
const fogFrag = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  vec3 applyFog(vec3 c) {
    float f = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
    return mix(c, uFogColor, f);
  }
`;
const toonFrag = /* glsl */ `
  uniform vec3 uLightDir;
  float toon(vec3 n) {
    float d = dot(normalize(n), uLightDir);
    // 3-band cel ramp with soft (anti-aliased) band edges
    float aa = 0.04;
    return mix(0.72, mix(0.86, 1.04, smoothstep(0.35 - aa, 0.35 + aa, d)), smoothstep(-0.2 - aa, -0.2 + aa, d));
  }
`;

let buildingMat: THREE.ShaderMaterial | null = null;
/**
 * Merged-building material. Geometry attributes:
 *   position, normal, color (wall colour; roof faces carry roof colour),
 *   uv = (metres along the wall perimeter, metres above ground), aRoof (0/1),
 *   aSeed (per-building random 0..1 for shutter colour variation).
 */
export function buildingMaterial(): THREE.ShaderMaterial {
  if (buildingMat) return buildingMat;
  buildingMat = new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      uLightDir: { value: LIGHT_DIR },
      uGlass: { value: new THREE.Color(STYLE_V2.window) },
      uFrame: { value: new THREE.Color(STYLE_V2.windowFrame) },
      uFloorH: { value: 3.5 },
      uCellW: { value: 3.4 },
      uHighlight: { value: -1 },
      ...fogUniforms,
    },
    vertexShader: /* glsl */ `
      ${commonVert}
      attribute float aRoof;
      attribute float aSeed;
      attribute float aBid;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vRoof;
      varying float vSeed;
      varying float vBid;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        vColor = color;
        vRoof = aRoof;
        vSeed = aSeed;
        vBid = aBid;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uGlass;
      uniform vec3 uFrame;
      uniform float uFloorH;
      uniform float uCellW;
      uniform float uHighlight;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vRoof;
      varying float vSeed;
      varying float vBid;
      ${fogFrag}
      ${toonFrag}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      // anti-aliased filled rectangle in cell space
      float box(vec2 p, vec2 lo, vec2 hi) {
        vec2 aa = fwidth(p) * 0.75;
        vec2 a = smoothstep(lo - aa, lo + aa, p) * (1.0 - smoothstep(hi - aa, hi + aa, p));
        return a.x * a.y;
      }
      vec3 pick(float s, vec3 a, vec3 b, vec3 c, vec3 d) { return s < 0.25 ? a : s < 0.5 ? b : s < 0.75 ? c : d; }
      void main() {
        // vSeed is constant per building, but interpolation adds ~1e-7 jitter that the
        // hash amplifies into per-pixel noise: quantise it first.
        float sd = floor(vSeed * 1000.0 + 0.5) / 1000.0;
        vec3 base = vColor;
        vec3 col = base;
        if (vRoof < 0.5) {
          float floorIdx = floor(vUv.y / uFloorH);
          float cellIdx = floor(vUv.x / uCellW);
          vec2 p = vec2(fract(vUv.x / uCellW), fract(vUv.y / uFloorH));
          vec3 trim = mix(base, vec3(1.0, 0.96, 0.9), 0.55);
          if (floorIdx < 0.5) {
            // ground floor: roll-up shutter or glass shopfront + coloured sign band
            vec3 shutter = pick(sd, vec3(0.45, 0.58, 0.70), vec3(0.36, 0.66, 0.58), vec3(0.86, 0.50, 0.40), vec3(0.62, 0.58, 0.68));
            vec3 sign = pick(fract(sd * 7.3), vec3(0.94, 0.30, 0.25), vec3(0.18, 0.55, 0.85), vec3(0.98, 0.78, 0.22), vec3(0.20, 0.62, 0.42));
            float open = step(0.5, hash(vec2(cellIdx, sd * 31.0)));
            float opening = box(p, vec2(0.07, 0.0), vec2(0.93, 0.70));
            vec3 inside = open > 0.5 ? mix(vec3(0.32, 0.26, 0.30), uGlass, step(0.35, p.y) * 0.6) : shutter * (0.9 + 0.1 * step(0.5, fract(p.y * 9.0)));
            col = mix(col, trim, box(p, vec2(0.04, 0.0), vec2(0.96, 0.73)));
            col = mix(col, inside, opening);
            col = mix(col, sign, box(p, vec2(0.0, 0.77), vec2(1.0, 0.95)));
            col = mix(col, vec3(1.0, 0.97, 0.9), box(p, vec2(0.2, 0.83), vec2(0.8, 0.89)) * 0.85); // sign lettering band
          } else {
            float skip = step(hash(vec2(cellIdx, floorIdx) + sd * 17.0), 0.15);
            float frame = box(p, vec2(0.22, 0.24), vec2(0.78, 0.80));
            float glass = box(p, vec2(0.27, 0.29), vec2(0.73, 0.75));
            float mull = box(p, vec2(0.485, 0.29), vec2(0.515, 0.75));
            vec3 g = uGlass * (0.92 + 0.25 * smoothstep(0.55, 0.75, p.y));
            g = mix(g, vec3(0.95, 0.98, 1.0), box(vec2(p.x + p.y * 0.6, p.y), vec2(0.62, 0.3), vec2(0.70, 0.75)) * 0.55); // glint
            vec3 w = mix(uFrame, g, glass);
            w = mix(w, uFrame, mull);
            col = mix(col, w, frame * (1.0 - skip));
            col = mix(col, trim, box(p, vec2(0.18, 0.18), vec2(0.82, 0.235)) * (1.0 - skip)); // sill
            // balcony rail on some buildings
            if (sd > 0.55) {
              float rail = box(p, vec2(0.12, 0.0), vec2(0.88, 0.035)) + box(p, vec2(0.12, 0.15), vec2(0.88, 0.18));
              float bars = box(vec2(fract(p.x * 8.0), p.y), vec2(0.42, 0.0), vec2(0.58, 0.17)) * box(p, vec2(0.12, 0.0), vec2(0.88, 0.17));
              col = mix(col, vec3(0.24, 0.19, 0.25), clamp(rail + bars, 0.0, 1.0));
            }
          }
          // floor slab lines + soft contact shadow near the ground
          col *= 1.0 - 0.18 * box(vec2(0.5, p.y), vec2(0.0, 0.0), vec2(1.0, 0.025)) * step(0.5, floorIdx);
          col *= mix(0.78, 1.0, smoothstep(0.0, 0.9, vUv.y));
        }
        float t = toon(vNormalW);
        col *= t;
        if (vRoof > 0.5 && vRoof < 1.5) col *= 1.0 + 0.06 * hash(floor(vWorld.xz * 0.5)); // subtle roof texture
        if (abs(vBid - uHighlight) < 0.5) col = mix(col, vec3(1.0, 0.82, 0.4), 0.45);
        gl_FragColor = vec4(applyFog(col), 1.0);
      }
    `,
  });
  return buildingMat;
}

/**
 * Ground paving in world space.
 * pattern: 0 = plain, 1 = square tiles (sidewalk), 2 = running-bond brick (plaza / footway),
 *          3 = grass speckle.
 */
export function pavingMaterial(color: string, lineColor: string, pattern: 0 | 1 | 2 | 3, tile = 1.2, layer = 0): THREE.ShaderMaterial {
  const key = `${color}|${lineColor}|${pattern}|${tile}|${layer}`;
  let m = pavingCache.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uLine: { value: new THREE.Color(lineColor) },
      uTile: { value: tile },
      uPattern: { value: pattern },
      uLightDir: { value: LIGHT_DIR },
      ...fogUniforms,
    },
    // Flat ground layers are centimetres apart: polygon offset keeps them from z-fighting.
    polygonOffset: layer > 0,
    polygonOffsetFactor: -layer,
    polygonOffsetUnits: -layer * 4,
    vertexShader: /* glsl */ `
      ${commonVert}
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uLine;
      uniform float uTile;
      uniform int uPattern;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      ${fogFrag}
      ${toonFrag}
      float lineMask(vec2 p, float w) {
        vec2 f = abs(fract(p) - 0.5);
        vec2 aa = fwidth(p) * 1.2;
        vec2 l = smoothstep(vec2(0.5 - w) - aa, vec2(0.5 - w), f);
        return max(l.x, l.y);
      }
      void main() {
        vec3 col = uColor;
        vec2 p = vWorld.xz / uTile;
        if (uPattern == 1) {
          col = mix(uColor, uLine, lineMask(p, uTile > 2.0 ? 0.018 : 0.045));
        } else if (uPattern == 2) {
          vec2 q = vec2(p.x * 0.5, p.y);
          q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
          col = mix(uColor, uLine, lineMask(q, 0.06));
        } else if (uPattern == 3) {
          float n = fract(sin(dot(floor(vWorld.xz * 0.7), vec2(12.9898, 78.233))) * 43758.5453);
          col = uColor * (n > 0.85 ? 0.92 : 1.0);
        }
        col *= toon(vNormalW);
        gl_FragColor = vec4(applyFog(col), 1.0);
      }
    `,
  });
  pavingCache.set(key, m);
  return m;
}
const pavingCache = new Map<string, THREE.ShaderMaterial>();

/** Flat toon material with fog for props / instanced decoration (uses scene-independent fog). */
const propCache = new Map<string, THREE.ShaderMaterial>();
export function propMaterial(color: string, opts: { instanced?: boolean; instanceColor?: boolean } = {}): THREE.ShaderMaterial {
  const key = `${color}|${opts.instanceColor ? 1 : 0}`;
  let m = propCache.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uLightDir: { value: LIGHT_DIR }, ...fogUniforms },
    vertexShader: /* glsl */ `
      ${commonVert}
      varying vec3 vTint;
      void main() {
        vec4 lp = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          n = mat3(instanceMatrix) * n;
        #endif
        vTint = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        vec4 wp = modelMatrix * lp;
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vTint;
      ${fogFrag}
      ${toonFrag}
      void main() {
        vec3 col = uColor * vTint * toon(vNormalW);
        gl_FragColor = vec4(applyFog(col), 1.0);
      }
    `,
  });
  propCache.set(key, m);
  return m;
}
