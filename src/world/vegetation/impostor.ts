import * as THREE from 'three';
import { injectWorldLighting } from '../materials';
import type { TreeLOD } from './treeGen';

/**
 * Far-LOD impostors, baked at runtime from the lod0 meshes so silhouettes and colours match exactly.
 *
 * Every tree variant is rendered from FRAMES azimuths into one 2048² atlas (128 px frames, 16×16 grid), as
 * albedo (sRGB, crown AO included) and object-space normals (alpha = leaf mask for translucency). The whole
 * atlas is rendered in one pass per target: each (variant, azimuth) is an instance rotated by −azimuth and
 * scaled into its grid cell under a single orthographic camera.
 *
 * At runtime the impostor is a camera-facing (Y-axis) quad that blends the two nearest azimuth frames and is lit
 * by the regular MeshStandardMaterial pipeline with the baked normals, so day/dusk/night lighting still applies.
 */
export const FRAMES = 8;
export const GRID = 16;
const ATLAS = 2048;
const PAD = 0.03;

export interface ImpostorVariant { lod: TreeLOD }
export interface ImpostorQuad { w: number; h: number; y0: number }

const bakeVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vCol;
void main() {
  vUv = uv; vN = normal; vCol = color;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const bakeFrag = /* glsl */ `
uniform sampler2D map; uniform float uMode; uniform float uBark;
varying vec2 vUv; varying vec3 vN; varying vec3 vCol;
void main() {
  vec4 c;
  if (uBark > 0.5) {
    float col = floor(vUv.x / 16.0);
    vec2 buv = vec2(vUv.x - col * 16.0, vUv.y);
    vec2 auv = vec2((col + fract(buv.x)) * 0.25, buv.y);
    c = textureGrad(map, auv, dFdx(buv) * vec2(0.25, 1.0), dFdy(buv) * vec2(0.25, 1.0));
    c.a = 1.0;
  } else {
    c = texture2D(map, vUv);
    vec2 dx = dFdx(vUv * 2048.0), dy = dFdy(vUv * 2048.0);
    float lod = 0.5 * log2(max(dot(dx, dx), dot(dy, dy)));
    c.a *= 1.0 + max(lod, 0.0) * 0.3;
    if (c.a < 0.5) discard;
  }
  if (uMode < 0.5) gl_FragColor = vec4(c.rgb * vCol, 1.0);
  else gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, uBark > 0.5 ? 0.0 : 1.0);
}`;

export interface BakedImpostors {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  quads: ImpostorQuad[];
  dispose(): void;
}

/** Quad size per variant (metres at scale 1) from the lod0 bounds. */
export function impostorQuads(variants: ImpostorVariant[]): ImpostorQuad[] {
  return variants.map((v) => {
    let r = 0.3, top = 1;
    for (const g of [v.lod.bark, v.lod.leaves]) {
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
        top = Math.max(top, p.getY(i));
      }
    }
    const halfW = r * 1.03, h = top * 1.02;
    const w = (2 * halfW) / (1 - 2 * PAD), qh = h / (1 - 2 * PAD);
    return { w, h: qh, y0: -PAD * qh };
  });
}

export function bakeImpostors(renderer: THREE.WebGLRenderer, variants: ImpostorVariant[], leafTex: THREE.Texture, barkTex: THREE.Texture): BakedImpostors {
  const quads = impostorQuads(variants);
  const scene = new THREE.Scene();
  const mk = (map: THREE.Texture, bark: boolean) => new THREE.ShaderMaterial({
    vertexShader: bakeVert, fragmentShader: bakeFrag, vertexColors: true, side: bark ? THREE.FrontSide : THREE.DoubleSide,
    uniforms: { map: { value: map }, uMode: { value: 0 }, uBark: { value: bark ? 1 : 0 } },
  });
  const barkMat = mk(barkTex, true), leafMat = mk(leafTex, false);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
  variants.forEach((v, vi) => {
    const quad = quads[vi];
    const halfW = (quad.w * (1 - 2 * PAD)) / 2, h = quad.h * (1 - 2 * PAD);
    for (const [geo, mat] of [[v.lod.bark, barkMat], [v.lod.leaves, leafMat]] as [THREE.BufferGeometry, THREE.ShaderMaterial][]) {
      if (!geo.attributes.position.count) continue;
      const im = new THREE.InstancedMesh(geo, mat, FRAMES);
      for (let k = 0; k < FRAMES; k++) {
        const idx = vi * FRAMES + k;
        const col = idx % GRID, row = Math.floor(idx / GRID);
        const phi = (k / FRAMES) * Math.PI * 2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -phi);
        s.set((1 - 2 * PAD) / (2 * halfW), (1 - 2 * PAD) / h, (1 - 2 * PAD) / (2 * halfW));
        pos.set(col + 0.5, row + PAD, 0);
        m.compose(pos, q, s);
        im.setMatrixAt(k, m);
      }
      im.frustumCulled = false;
      scene.add(im);
    }
  });
  const cam = new THREE.OrthographicCamera(0, GRID, GRID, 0, 0.1, 100);
  cam.position.set(0, 0, 50);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const opts = { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, type: THREE.UnsignedByteType } as const;
  const rtA = new THREE.WebGLRenderTarget(ATLAS, ATLAS, { ...opts, colorSpace: THREE.SRGBColorSpace });
  const rtN = new THREE.WebGLRenderTarget(ATLAS, ATLAS, { ...opts });
  rtA.texture.anisotropy = 4;
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.autoClear = false;
  renderer.shadowMap.autoUpdate = false;
  for (const [rt, mode, clear] of [[rtA, 0, new THREE.Color(0.075, 0.1, 0.045)], [rtN, 1, new THREE.Color(0.5, 0.75, 0.5)]] as [THREE.WebGLRenderTarget, number, THREE.Color][]) {
    barkMat.uniforms.uMode.value = mode;
    leafMat.uniforms.uMode.value = mode;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(clear, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  renderer.shadowMap.autoUpdate = prevShadow;
  scene.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
  barkMat.dispose();
  leafMat.dispose();
  return {
    albedo: rtA.texture, normal: rtN.texture, quads,
    dispose: () => { rtA.dispose(); rtN.dispose(); },
  };
}

/** Impostor material: MeshStandardMaterial with a billboard vertex stage and two-frame atlas sampling. */
export function impostorMaterial(albedo: THREE.Texture, normal: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: albedo, alphaTest: 0.5, roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    injectWorldLighting(shader);
    shader.uniforms.uImpNormal = { value: normal };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aImp; attribute float aFade;
varying vec2 vImpUv0; varying vec2 vImpUv1; varying float vImpBlend; varying float vFadeI; varying vec2 vImpRot;`)
      .replace('#include <begin_vertex>', /* glsl */ `
vec3 ip = instanceMatrix[3].xyz;
vec3 c0 = instanceMatrix[0].xyz;
float isx = length(c0), isy = length(instanceMatrix[1].xyz);
float cr = c0.x / isx, sr = -c0.z / isx;
vec3 toCam = cameraPosition - ip;
vec2 dw = normalize(toCam.xz + vec2(1e-4, 0.0));
vec2 dl = vec2(dw.x * cr - dw.y * sr, dw.x * sr + dw.y * cr);
float phi = atan(dl.x, dl.y);
if (phi < 0.0) phi += 6.2831853;
float fr = phi / 6.2831853 * ${FRAMES.toFixed(1)};
float f0 = floor(fr);
vImpBlend = fr - f0;
float f1 = mod(f0 + 1.0, ${FRAMES.toFixed(1)});
f0 = mod(f0, ${FRAMES.toFixed(1)});
float fb = aImp.w * ${FRAMES.toFixed(1)};
vec2 qd = vec2(position.x + 0.5, position.y);
float i0 = fb + f0, i1 = fb + f1;
vImpUv0 = (vec2(mod(i0, ${GRID.toFixed(1)}), floor(i0 / ${GRID.toFixed(1)})) + qd) / ${GRID.toFixed(1)};
vImpUv1 = (vec2(mod(i1, ${GRID.toFixed(1)}), floor(i1 / ${GRID.toFixed(1)})) + qd) / ${GRID.toFixed(1)};
vec3 right = vec3(dw.y, 0.0, -dw.x);
vec3 transformed = ip + right * (position.x * aImp.x * isx) + vec3(0.0, (aImp.z + position.y * aImp.y) * isy, 0.0);
vFadeI = aFade;
vImpRot = vec2(cr, sr);`)
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4( transformed, 1.0 );\ngl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4( transformed, 1.0 );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uImpNormal;
varying vec2 vImpUv0; varying vec2 vImpUv1; varying float vImpBlend; varying float vFadeI; varying vec2 vImpRot;
float impIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`)
      .replace('#include <map_fragment>', /* glsl */ `
vec4 sampledDiffuseColor = mix( texture2D( map, vImpUv0 ), texture2D( map, vImpUv1 ), vImpBlend );
{ vec2 dx = dFdx( vImpUv0 * ${ATLAS.toFixed(1)} ), dy = dFdy( vImpUv0 * ${ATLAS.toFixed(1)} );
  float lod = 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) );
  sampledDiffuseColor.a *= 1.0 + max( lod, 0.0 ) * 0.25; }
diffuseColor *= sampledDiffuseColor;`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
{ float n = impIgn(gl_FragCoord.xy);
  if (vFadeI >= 0.0) { if (n >= vFadeI) discard; } else { if (n < -1.0 - vFadeI) discard; } }`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
{ vec4 nS = mix( texture2D( uImpNormal, vImpUv0 ), texture2D( uImpNormal, vImpUv1 ), vImpBlend );
  vec3 nL = normalize( nS.xyz * 2.0 - 1.0 );
  vec3 nW = vec3( vImpRot.x * nL.x + vImpRot.y * nL.z, nL.y, - vImpRot.y * nL.x + vImpRot.x * nL.z );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
  vegTransMask = nS.a; }`);
  };
  mat.customProgramCacheKey = () => 'veg_impostor';
  return mat;
}
