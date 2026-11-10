'use client';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { STYLE_V2 } from '@nmap/map-config';

/**
 * Screen-space ink outlines (the hand-drawn look of the reference art):
 *   1. render the scene's normals + depth into a render target
 *   2. render the colour image into a second target
 *   3. composite: Sobel edges on normals and linearised depth → dark ink lines
 * Takes over rendering (useFrame priority 1), so it works with frameloop="demand".
 */
export function OutlinePass({ enabled = true, thickness = 1.25 }: { enabled?: boolean; thickness?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const { colorRT, normalRT, normalMat, quadScene, quadCam, quadMat } = useMemo(() => {
    const opts = { type: THREE.HalfFloatType, samples: 0 } as const;
    // Linear HDR target: every material writes linear colour here, the composite
    // converts to sRGB exactly once (no double conversion = no washed-out colours).
    const colorRT = new THREE.WebGLRenderTarget(1, 1, { ...opts, samples: 4 });
    colorRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const normalRT = new THREE.WebGLRenderTarget(1, 1, opts);
    normalRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    const normalMat = new THREE.MeshNormalMaterial();
    const quadMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: colorRT.texture },
        tNormal: { value: normalRT.texture },
        tDepth: { value: normalRT.depthTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uThickness: { value: thickness },
        uOutline: { value: new THREE.Color(STYLE_V2.outline) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uOrtho: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tNormal;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uThickness;
        uniform vec3 uOutline;
        uniform float uNear;
        uniform float uFar;
        uniform float uOrtho;
        varying vec2 vUv;
        float linDepth(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
          float z = d * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        }
        void main() {
          vec2 px = uThickness / uResolution;
          vec3 n0 = texture2D(tNormal, vUv).xyz;
          float d0 = linDepth(vUv);
          float nEdge = 0.0;
          vec2 offs[4];
          offs[0] = vec2(px.x, 0.0); offs[1] = vec2(-px.x, 0.0); offs[2] = vec2(0.0, px.y); offs[3] = vec2(0.0, -px.y);
          for (int i = 0; i < 4; i++) nEdge += length(texture2D(tNormal, vUv + offs[i]).xyz - n0);
          // Depth discontinuities: Laplacian of 1/depth (perspective) or depth (ortho).
          // Both are affine in screen space for any plane, so flat ground at grazing
          // angles produces no false edges.
          float f0, fl, fr, fu, fd;
          if (uOrtho > 0.5) {
            f0 = d0; fl = linDepth(vUv + offs[1]); fr = linDepth(vUv + offs[0]); fu = linDepth(vUv + offs[2]); fd = linDepth(vUv + offs[3]);
          } else {
            f0 = 1.0 / d0; fl = 1.0 / linDepth(vUv + offs[1]); fr = 1.0 / linDepth(vUv + offs[0]); fu = 1.0 / linDepth(vUv + offs[2]); fd = 1.0 / linDepth(vUv + offs[3]);
          }
          float lap = (abs(fl + fr - 2.0 * f0) + abs(fu + fd - 2.0 * f0)) / max(abs(f0), 1e-6);
          float dEdge = uOrtho > 0.5 ? smoothstep(0.0015, 0.004, lap * 0.02) : smoothstep(0.03, 0.08, lap);
          float edge = max(smoothstep(0.35, 0.8, nEdge), dEdge);
          // fade outlines in the far distance (perspective)
          if (uOrtho < 0.5) edge *= 1.0 - smoothstep(220.0, 480.0, d0);
          vec4 c = texture2D(tColor, vUv);
          gl_FragColor = vec4(mix(c.rgb, uOutline, edge * 0.92), 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quadScene = new THREE.Scene();
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { colorRT, normalRT, normalMat, quadScene, quadCam, quadMat };
  }, [thickness]);

  useEffect(() => {
    const w = Math.max(1, Math.floor(size.width * dpr));
    const h = Math.max(1, Math.floor(size.height * dpr));
    colorRT.setSize(w, h);
    normalRT.setSize(w, h);
    quadMat.uniforms.uResolution.value.set(w, h);
    quadMat.uniforms.uThickness.value = thickness * Math.max(1, dpr * 0.85);
  }, [size, dpr, colorRT, normalRT, quadMat, thickness]);

  useEffect(() => () => { colorRT.dispose(); normalRT.dispose(); normalMat.dispose(); quadMat.dispose(); }, [colorRT, normalRT, normalMat, quadMat]);

  useFrame(() => {
    if (!enabled) {
      gl.setRenderTarget(null);
      gl.render(scene, camera);
      return;
    }
    const cam = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    quadMat.uniforms.uNear.value = cam.near;
    quadMat.uniforms.uFar.value = cam.far;
    quadMat.uniforms.uOrtho.value = cam.isOrthographicCamera ? 1 : 0;

    const bg = scene.background;
    // 1) normals + depth (no background, no helpers)
    scene.overrideMaterial = normalMat;
    scene.background = null;
    gl.setRenderTarget(normalRT);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = bg;
    // 2) colour
    gl.setRenderTarget(colorRT);
    gl.render(scene, camera);
    // 3) composite to screen
    gl.setRenderTarget(null);
    gl.render(quadScene, quadCam);
  }, 1);

  return null;
}
