import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import type { FacadeStyle } from './layout';
import { rng } from './geom';

const blackTex = new THREE.DataTexture(new Uint8Array([0, 128, 128, 255]), 1, 1);
blackTex.needsUpdate = true;

/** Shared uniforms driven by time of day (Sky sets uNight) and by the street-lamp light map. */
export const worldUniforms = {
  uNight: { value: 0 }, // 0 day … 1 full night (window lights, lamps)
  uTime: { value: 0 },
  uWind: { value: 1 },
  /** Street-lamp light map (R = sqrt irradiance, GB = direction to the lamps); see setLampLights(). */
  uLampMap: { value: blackTex as THREE.Texture },
  /** minX, minZ, 1/sizeX, 1/sizeZ of the lamp map in world metres. */
  uLampBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
  /** Overall street-lamp strength (the night ramp is applied in the shader from uNight). */
  uLampI: { value: 1 },
  uLampColor: { value: new THREE.Color(1.0, 0.83, 0.62) },
  /** 0 = dry (default, sunny) … 1 = soaked monsoon look (darker, glossy ground, puddles). */
  uWet: { value: 0 },
  /** Cloud shadows (set by Sky): the sky's cloud noise, cumulus coverage, direction to the light, on/off. */
  uCloudTex: { value: blackTex as THREE.Texture },
  uCloudCov: { value: 0 },
  uCloudDir: { value: new THREE.Vector3(0, 1, 0) },
  uCloudOn: { value: 0 },
};

export interface PBRSet { map: THREE.Texture | null; normalMap: THREE.Texture | null; arm: THREE.Texture | null }

/** World material detail level (QualityProfile.materialDetail): 0 low, 1 medium, 2 high. Set by Engine. */
let materialDetail = 2;
export function setMaterialDetail(level: number): void { materialDetail = Math.max(0, Math.min(2, Math.round(level))); }

// optional monsoon look for testing / screenshots: ?wet=1 (or 0..1)
try {
  const wet = new URLSearchParams(location.search).get('wet');
  if (wet !== null) worldUniforms.uWet.value = Math.max(0, Math.min(1, wet === '' ? 0.8 : Number(wet) || 0.8));
} catch { /* no location (workers / tests) */ }

// -------------------------------------------------------------------------------------------------
// World lighting: street-lamp light map + optional wet ground, injected into every lit world material
// -------------------------------------------------------------------------------------------------

const WL_PARS = /* glsl */ `
uniform sampler2D uLampMap; uniform vec4 uLampBounds; uniform float uLampI; uniform vec3 uLampColor;
uniform float uWet; uniform float uWlNight;
uniform sampler2D uCloudTex; uniform float uCloudCov; uniform vec3 uCloudDir; uniform float uCloudOn; uniform float uWlTime;
// shadow of the sky's cumulus layer (same field as Sky.ts coverageAt(): km coordinates, wind drift, coverage threshold)
float wlCloudShadow(vec3 p) {
  if (uCloudOn < 0.5 || uCloudDir.y < 0.06) return 1.0;
  float t = (2200.0 - p.y) / uCloudDir.y;
  vec2 q = (p.xz + uCloudDir.xz * t) * 0.001 + vec2(0.016, 0.006) * uWlTime;
  float shape = texture2D(uCloudTex, q * 0.055).r * 0.6 + texture2D(uCloudTex, q * 0.15 + 0.37).g * 0.4;
  float thr = mix(0.78, 0.36, uCloudCov);
  float d = clamp((shape - thr) / (1.0 - thr) * 1.6, 0.0, 1.0);
  float ero = texture2D(uCloudTex, q * 0.42).b * 0.26;   // the clouds' eroded edges → dappled shadow borders
  d = clamp((d - ero) / (1.0 - ero), 0.0, 1.0);
  return 1.0 - smoothstep(0.02, 0.4, d) * 0.7;
}
float wlHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wlNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wlHash(i), wlHash(i + vec2(1, 0)), f.x), mix(wlHash(i + vec2(0, 1)), wlHash(i + vec2(1, 1)), f.x), f.y); }
vec3 wlWorldPos() { return ((vec4(-vViewPosition, 1.0) - viewMatrix[3]) * viewMatrix).xyz; }
// irradiance from the street lamps (pre-baked 2D light map; walls use the stored lamp direction)
vec3 wlLamp(vec3 p, vec3 n) {
  float ramp = smoothstep(0.3, 0.75, uWlNight) * uLampI;
  if (ramp <= 0.0) return vec3(0.0);
  vec4 s = texture2D(uLampMap, (p.xz - uLampBounds.xy) * uLampBounds.zw);
  float e = s.r * s.r * 2.0;
  vec2 dir = s.gb * 2.0 - 1.0;
  float side = 1.0 - abs(n.y);
  float facing = max(n.y, 0.0) + side * (0.15 + 0.6 * max(dot(n.xz, dir), 0.0));
  float hf = 1.0 - smoothstep(2.5, 10.0, p.y);
  return uLampColor * (ramp * 5.2 * e * facing * hf);
}`;

const WL_WET = /* glsl */ `
if (uWet > 0.001) {
  vec3 wlP = wlWorldPos();
  vec3 wlN = transformNormalByInverseViewMatrix(normal, viewMatrix);
  float wlFlat = smoothstep(0.6, 0.92, wlN.y) * (1.0 - smoothstep(0.35, 1.5, wlP.y));
  float wlNz = wlNoise(wlP.xz * 0.33) * 0.65 + wlNoise(wlP.xz * 1.37) * 0.35;
  float wlPud = smoothstep(0.6, 0.68, wlNz) * wlFlat * smoothstep(0.35, 0.85, uWet);
  float wlDamp = uWet * (0.8 * wlFlat + 0.3 * (1.0 - wlFlat));
  diffuseColor.rgb *= mix(1.0, 0.6, wlDamp) * mix(1.0, 0.85, wlPud);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, wlDamp * wlFlat);
  roughnessFactor = mix(roughnessFactor, 0.02, wlPud);
  normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, wlPud));
}
`;

const WL_LAMP = /* glsl */ `
#if defined( RE_IndirectDiffuse )
  irradiance += wlLamp(wlWorldPos(), transformNormalByInverseViewMatrix(geometryNormal, viewMatrix));
#endif
`;

/**
 * Adds street-lamp lighting (and the optional wet look) to a MeshStandard/Physical shader inside an
 * onBeforeCompile hook. Safe to call on shaders whose chunks were already edited: missing anchors are skipped.
 * Other modules with their own onBeforeCompile can call this at the end of their hook to get lamp light.
 */
export function injectWorldLighting(shader: THREE.WebGLProgramParametersWithUniforms): void {
  if (shader.fragmentShader.includes('wlLamp(')) return;
  if (!shader.fragmentShader.includes('#include <lights_fragment_end>')) return;
  Object.assign(shader.uniforms, {
    uLampMap: worldUniforms.uLampMap, uLampBounds: worldUniforms.uLampBounds, uLampI: worldUniforms.uLampI,
    uLampColor: worldUniforms.uLampColor, uWet: worldUniforms.uWet, uWlNight: worldUniforms.uNight,
    uCloudTex: worldUniforms.uCloudTex, uCloudCov: worldUniforms.uCloudCov, uCloudDir: worldUniforms.uCloudDir,
    uCloudOn: worldUniforms.uCloudOn, uWlTime: worldUniforms.uTime,
  });
  let fs = shader.fragmentShader;
  // cloud shadows dim the sun (directional light) only
  if (fs.includes('#include <lights_fragment_begin>')) {
    fs = fs.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= wlCloudShadow( wlWorldPos() );'));
  }
  fs = fs.replace('#include <common>', `#include <common>\n${WL_PARS}`);
  if (fs.includes('float roughnessFactor') && fs.includes('#include <emissivemap_fragment>')) fs = fs.replace('#include <emissivemap_fragment>', `${WL_WET}\n#include <emissivemap_fragment>`);
  fs = fs.replace('#include <lights_fragment_end>', `${WL_LAMP}\n#include <lights_fragment_end>`);
  shader.fragmentShader = fs;
}

let worldLightingInstalled = false;
/**
 * Installs injectWorldLighting as the default onBeforeCompile of every MeshStandardMaterial (and Physical),
 * so props, characters, trees without their own hook, etc. are lit by the street lamps at night.
 * Materials with their own hook replace it; the world builders in this file call injectWorldLighting themselves.
 */
export function installWorldLighting(): void {
  if (worldLightingInstalled) return;
  worldLightingInstalled = true;
  const proto = THREE.MeshStandardMaterial.prototype as THREE.MeshStandardMaterial;
  // (the default customProgramCacheKey is onBeforeCompile.toString(), so programs stay distinct per hook)
  proto.onBeforeCompile = function (shader: THREE.WebGLProgramParametersWithUniforms) { injectWorldLighting(shader); };
}
installWorldLighting();

/**
 * Street lamps → light map texture (0.5 m texels). `points` are the lamp heads (x, y = height, z).
 * Irradiance follows the cosine / inverse-square law of a point source at the head height, with a soft cutoff.
 */
let lampList: { x: number; y: number; z: number }[] = [];
/** Replace the street-lamp set (lamp heads: x, y = height, z) and rebuild the light map. */
export function setLampLights(points: { x: number; y: number; z: number }[]): void {
  lampList = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  buildLampMap(lampList);
}
/** Add more light sources (e.g. prop lamps, wall lights) to the light map. */
export function addLampLights(points: { x: number; y: number; z: number }[]): void {
  lampList = lampList.concat(points.map((p) => ({ x: p.x, y: p.y, z: p.z })));
  buildLampMap(lampList);
}

function buildLampMap(points: { x: number; y: number; z: number }[], bounds = { minX: -140, minZ: -310, maxX: 280, maxZ: 170 }, texel = 0.5): void {
  const w = Math.ceil((bounds.maxX - bounds.minX) / texel), h = Math.ceil((bounds.maxZ - bounds.minZ) / texel);
  const E = new Float32Array(w * h), DX = new Float32Array(w * h), DZ = new Float32Array(w * h);
  const R = 16;
  for (const p of points) {
    const hh = Math.max(2.5, p.y);
    const s = hh * hh; // every lamp peaks at 1 under its head (a low wall light is as bright there as a pole light)
    const i0 = Math.max(0, Math.floor((p.x - R - bounds.minX) / texel)), i1 = Math.min(w - 1, Math.ceil((p.x + R - bounds.minX) / texel));
    const j0 = Math.max(0, Math.floor((p.z - R - bounds.minZ) / texel)), j1 = Math.min(h - 1, Math.ceil((p.z + R - bounds.minZ) / texel));
    for (let j = j0; j <= j1; j++) {
      const cz = bounds.minZ + (j + 0.5) * texel;
      for (let i = i0; i <= i1; i++) {
        const cx = bounds.minX + (i + 0.5) * texel;
        const dx = p.x - cx, dz = p.z - cz;
        const r2 = dx * dx + dz * dz;
        if (r2 > R * R) continue;
        const r = Math.sqrt(r2);
        const cut = 1 - THREE.MathUtils.smoothstep(r, R * 0.55, R);
        const e = Math.pow(s / (s + r2), 2.6) * cut; // ~cos^5 falloff (point source + cut-off optics), 1 at the foot
        const k = j * w + i;
        E[k] += e;
        DX[k] += (dx / (r + 0.3)) * e;
        DZ[k] += (dz / (r + 0.3)) * e;
      }
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const e = Math.min(1, E[k] * 0.5); // stores up to 2 overlapping lamps (decoded as r² * 2 in the shader)
    const l = Math.hypot(DX[k], DZ[k]) || 1;
    data[k * 4] = Math.round(Math.sqrt(e) * 255);
    data[k * 4 + 1] = Math.round((DX[k] / l * 0.5 + 0.5) * 255);
    data[k * 4 + 2] = Math.round((DZ[k] / l * 0.5 + 0.5) * 255);
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  const old = worldUniforms.uLampMap.value;
  worldUniforms.uLampMap.value = tex;
  if (old !== blackTex) old.dispose();
  worldUniforms.uLampBounds.value.set(bounds.minX, bounds.minZ, 1 / (w * texel), 1 / (h * texel));
}

/** Mean linear RGB of a (loaded) sRGB colour texture, cached on userData. Used to normalise albedo. */
export function textureMeanRGB(tex: THREE.Texture | null, fallback = 0.45): [number, number, number] {
  if (!tex) return [fallback, fallback, fallback];
  if (Array.isArray(tex.userData.meanRGB)) return tex.userData.meanRGB as [number, number, number];
  let m: [number, number, number] = [fallback, fallback, fallback];
  try {
    const img = tex.image as CanvasImageSource & { width: number; height: number };
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const acc = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { acc[0] += lin(d[i]); acc[1] += lin(d[i + 1]); acc[2] += lin(d[i + 2]); }
    const n = d.length / 4;
    m = [acc[0] / n, acc[1] / n, acc[2] / n];
  } catch { /* image not readable: keep fallback */ }
  tex.userData.meanRGB = m;
  return m;
}

/** Mean linear luminance of a (loaded) sRGB colour texture. */
export function textureMean(tex: THREE.Texture | null, fallback = 0.45): number {
  const [r, g, b] = textureMeanRGB(tex, fallback);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Textured detail material for vertex-coloured kit geometry: the texture is normalised per channel so the vertex
 * colour is the real albedo and the texture only adds grain, plus a subtle world-space tone variation and lamp light.
 */
export function detailMaterial(set: PBRSet, o: { roughness: number; normalScale?: number; metalness?: number; macro?: number; roughVar?: number; key: string }): THREE.MeshStandardMaterial {
  const [r, g, b] = textureMeanRGB(set.map, 0.45);
  const m = new THREE.MeshStandardMaterial({
    map: set.map, normalMap: set.normalMap, vertexColors: true,
    color: new THREE.Color(1 / Math.max(r, 0.02), 1 / Math.max(g, 0.02), 1 / Math.max(b, 0.02)),
    roughness: o.roughness, metalness: o.metalness ?? 0,
  });
  if (set.normalMap) m.normalScale.setScalar(o.normalScale ?? 0.5);
  const macro = o.macro ?? 0.08, roughVar = o.roughVar ?? 0.15;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDetMacro = { value: macro };
    shader.uniforms.uDetRough = { value: roughVar };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDetMacro; uniform float uDetRough; float detN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{ vec3 dp = wlWorldPos();
  detN = wlNoise(dp.xz * 0.37 + dp.y * 0.21) * 0.6 + wlNoise(dp.xz * 1.9 - dp.y * 1.3) * 0.4;
  diffuseColor.rgb *= 1.0 + (detN - 0.5) * 2.0 * uDetMacro; }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor * (1.0 + (detN - 0.5) * 2.0 * uDetRough), 0.02, 1.0);`);
    injectWorldLighting(shader);
  };
  m.customProgramCacheKey = () => `detail_${o.key}`;
  return m;
}

/**
 * Injects world-space macro variation to break texture tiling on large surfaces.
 */
function addMacroVariation(mat: THREE.MeshStandardMaterial, strength: number, scale: number, tintB?: THREE.Color): void {
  const tint = tintB ?? new THREE.Color(0.82, 0.78, 0.72);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMacroStrength = { value: strength };
    shader.uniforms.uMacroScale = { value: scale };
    shader.uniforms.uMacroTint = { value: tint };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosM;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPosM = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPosM;
uniform float uMacroStrength; uniform float uMacroScale; uniform vec3 uMacroTint;
float mhash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float mnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mhash(i),mhash(i+vec2(1,0)),f.x), mix(mhash(i+vec2(0,1)),mhash(i+vec2(1,1)),f.x), f.y); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{ vec2 wp = vWorldPosM.xz * uMacroScale;
  float n = mnoise(wp) * 0.6 + mnoise(wp * 3.7) * 0.3 + mnoise(wp * 11.0) * 0.1;
  diffuseColor.rgb *= mix(vec3(1.0), uMacroTint, smoothstep(0.35, 0.8, n) * uMacroStrength);
  diffuseColor.rgb *= 1.0 - (mnoise(wp * 23.0) - 0.5) * 0.12 * uMacroStrength; }`,
      );
    injectWorldLighting(shader);
  };
  mat.customProgramCacheKey = () => `macro_${strength}_${scale}_${mat.vertexColors ? 1 : 0}`;
}

export function pbrMaterial(set: PBRSet, opts: { color?: THREE.ColorRepresentation; roughness?: number; normalScale?: number; macro?: number; macroScale?: number; macroTint?: THREE.Color; metalness?: number; vertexColors?: boolean; map?: THREE.Texture | null } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: opts.map !== undefined ? opts.map : set.map,
    normalMap: set.normalMap,
    roughnessMap: set.arm,
    metalnessMap: null,
    aoMap: set.arm,
    aoMapIntensity: 0.8,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
    vertexColors: !!opts.vertexColors,
  });
  if (set.normalMap) m.normalScale.setScalar(opts.normalScale ?? 1);
  if (opts.macro) addMacroVariation(m, opts.macro, opts.macroScale ?? 0.05, opts.macroTint);
  return m;
}

// -------------------------------------------------------------------------------------------------
// Procedural facade material
// -------------------------------------------------------------------------------------------------

interface FacadeParams {
  wall: THREE.Color;
  band: THREE.Color; // slab spandrel / balcony recess / beige window panel
  frame: THREE.Color;
  glass: THREE.Color; // glass tint (dark = tinted / low transmission, light = clear or frosted)
  bayW: number;
  winW: number; // fraction of bay
  sill: number; // m above floor
  winH: number; // m
  bandH: number; // m band at floor slab (spandrel)
  mullions: number; // vertical mullions per window
  curtain: number; // 0..1: fraction of 3-bay groups that are full-height glass curtain
  topBand: number; // fascia height at the top (m)
  topColor: THREE.Color;
  brick: number; // 1 = use brick texture for walls
  groundGlass: number; // 1 = ground floor mostly glass
  jali: number; // blue jali panels
  ribbon: number; // 1 = continuous ribbon windows (mullions every mullSp)
  mullSp: number;
  panel: [number, number]; // stone panel joints (w, h) m, 0 = none
  baseH: number; // world height of the base zone
  baseMode: number; // 0 none, 1 dark glazing, 2 stone with punched windows
  baseColor: THREE.Color;
  fasciaEvery: number; // dark fascia band at every Nth floor slab (0 = none)
  fasciaH: number;
  fasciaColor: THREE.Color;
  pilaster: number; // pilaster every N bays (0 none)
  pilasterW: number;
  balcony: number; // 1 = open-corridor balcony bands (F-Block wings)
  recess: number; // 1 = deep recessed windows + beige panel (F-Block tower)
  louvre: number; // fraction of wall bays with small louvre vents
  topGlass: number; // 1 = top band is a glass curtain
  glassRough: number; // < 0.15 clear glass (see-through rooms), > 0.3 frosted / milky
  glassMetal: number; // reflection strength of the glazing coating (0 plain float glass … 1 reflective)
  litChance: number; // fraction of windows lit at night
  dirt: number; // 0 = clean new cladding … 1 = weathered
  reveal: number; // depth (m) the glass of punched windows is set back from the wall face
  roomW: number; // width (m) of the rooms seen behind ribbon / curtain glazing
}

const C = (hex: string) => new THREE.Color(hex);

const BASE: FacadeParams = {
  wall: C('#ffffff'), band: C('#dcd6ca'), frame: C('#3a3f45'), glass: C('#26323d'),
  bayW: 3.2, winW: 0.5, sill: 0.9, winH: 1.5, bandH: 0.3, mullions: 1, curtain: 0, topBand: 0.8, topColor: C('#e6e1d8'),
  brick: 0, groundGlass: 0, jali: 0, ribbon: 0, mullSp: 1.5, panel: [0, 0], baseH: 0, baseMode: 0, baseColor: C('#2f3a44'),
  fasciaEvery: 0, fasciaH: 0.8, fasciaColor: C('#44484e'), pilaster: 0, pilasterW: 0.5, balcony: 0, recess: 0, louvre: 0,
  topGlass: 0, glassRough: 0.05, glassMetal: 0.6, litChance: 0.42, dirt: 1, reveal: 0.16, roomW: 3.0,
};
const S = (o: Partial<FacadeParams>): FacadeParams => ({ ...BASE, ...o });

export const FACADE_STYLES: Record<FacadeStyle | 'house', FacadeParams> = {
  // GJBC exterior: cream stone panels, dark ribbon windows, charcoal fascia every 2nd slab, dark glazed 9 m base
  gjbc: S({ wall: C('#ebe5d8'), band: C('#e3dccd'), frame: C('#3a4048'), glass: C('#34414c'), bayW: 1.5, ribbon: 1, mullSp: 1.5, sill: 1.15, winH: 2.15, bandH: 0, mullions: 0, topBand: 1.3, topColor: C('#ece6d9'), panel: [1.2, 0.6], baseH: 9, baseMode: 1, baseColor: C('#27313a'), fasciaEvery: 0, litChance: 0.5, dirt: 0.12, glassRough: 0.04, glassMetal: 0.85, roomW: 4.5 }),
  // GJBC courtyard faces: cream plaster, blue-grey ribbon glass, glass band at the top
  gjbcQuad: S({ wall: C('#ede6d6'), band: C('#e4dccb'), frame: C('#4a5560'), glass: C('#56646e'), glassRough: 0.07, glassMetal: 0.6, bayW: 1.2, ribbon: 1, mullSp: 1.2, sill: 1.0, winH: 1.9, bandH: 0, topBand: 4.0, topGlass: 1, topColor: C('#ebe4d4'), baseH: 9, baseMode: 1, baseColor: C('#2a3139'), litChance: 0.5, dirt: 0.15, roomW: 3.6 }),
  // GJBC dark glass curtain wall (south-east; fins are geometry)
  gjbcCurtain: S({ wall: C('#e6e0d3'), band: C('#3c444c'), frame: C('#2b3138'), glass: C('#2c3843'), bayW: 1.5, curtain: 1, bandH: 0.28, mullions: 0, topBand: 1.0, topColor: C('#e9e3d6'), baseH: 0, litChance: 0.55, dirt: 0.1, glassRough: 0.04, glassMetal: 0.9 }),
  // GJBC NW library tower: white plaster, punched strip windows, granite plinth
  library: S({ wall: C('#f0eee8'), band: C('#e8e5de'), frame: C('#2f3a44'), glass: C('#2f3b46'), bayW: 4.2, winW: 0.82, sill: 1.0, winH: 1.55, bandH: 0, mullions: 3, curtain: 0.14, topBand: 1.2, topColor: C('#eeece6'), panel: [1.4, 4.2], baseH: 4.2, baseMode: 2, baseColor: C('#9c9c9a'), dirt: 0.25, reveal: 0.2 }),
  // MRD refurb stone wings (SE tower, NE block): mostly blank buff sandstone blocks with sparse black-framed openings, navy
  // cornice (tour 2026 key frames 0230 / 0316 / 0332: no glass curtain groups on the stone towers)
  mrd: S({ wall: C('#c8b89e'), band: C('#bdae94'), frame: C('#23272b'), glass: C('#34414b'), bayW: 4.2, winW: 0.3, sill: 0.9, winH: 1.6, bandH: 0, mullions: 1, curtain: 0, topBand: 1.6, topColor: C('#1f2b45'), panel: [1.0, 0.5], baseH: 0, baseMode: 0, glassRough: 0.06, glassMetal: 0.55, litChance: 0.35, dirt: 0.4, reveal: 0.22 }),
  // B-Block: beige plaster, pilaster strips, near-square windows, louvre vents, pink-grey stone base (2 floors)
  bblock: S({ wall: C('#e0cfb6'), band: C('#d4c4ad'), frame: C('#2f3a40'), glass: C('#7f93a0'), bayW: 3.5, winW: 0.37, sill: 1.0, winH: 1.4, bandH: 0, mullions: 1, topBand: 1.0, topColor: C('#d8c9b3'), pilaster: 1, pilasterW: 0.55, louvre: 0.28, baseH: 7.0, baseMode: 2, baseColor: C('#a89484'), glassRough: 0.05, glassMetal: 0.7, dirt: 0.2, reveal: 0.22 }),
  // B-Block crest tower: buff stone, tiny square windows
  bblockTower: S({ wall: C('#c4b095'), band: C('#bba88c'), frame: C('#3a3a36'), glass: C('#3a434a'), bayW: 3.0, winW: 0.27, sill: 1.3, winH: 0.8, bandH: 0, mullions: 0, topBand: 0.9, topColor: C('#b8a386'), panel: [1.2, 0.6], litChance: 0.25, reveal: 0.3 }),
  // F-Block tower: terracotta render, deep windows paired with beige vertical panels, heavy cornice
  fTower: S({ wall: C('#b45a45'), band: C('#e3d2b0'), frame: C('#3b2f2a'), glass: C('#2c2a2a'), bayW: 2.4, recess: 1, bandH: 0, topBand: 1.5, topColor: C('#a24c3a'), litChance: 0.35 }),
  // F-Block wings: cream with continuous open-corridor balcony bands
  fWing: S({ wall: C('#e8dabf'), band: C('#3b3531'), frame: C('#4a3f38'), glass: C('#2c3440'), bayW: 3.4, balcony: 1, bandH: 0, topBand: 1.0, topColor: C('#b8604a'), litChance: 0.35 }),
  // F-Block podium: terracotta with small punched windows
  fPodium: S({ wall: C('#b45a45'), band: C('#a95442'), frame: C('#2a2624'), glass: C('#22262a'), bayW: 2.4, winW: 0.42, sill: 1.2, winH: 1.0, bandH: 0, mullions: 0, topBand: 0.9, topColor: C('#a24c3a'), reveal: 0.2 }),
  // white plaster (gate / mural building, cabins)
  admin: S({ wall: C('#f4f4f1'), band: C('#ecebe6'), frame: C('#2d3440'), glass: C('#2a3c4f'), bayW: 5.0, winW: 0.3, sill: 1.2, winH: 1.3, bandH: 0, topBand: 0.6, topColor: C('#f2f1ee'), reveal: 0.15 }),
  oldCream: S({ wall: C('#efe7d6'), band: C('#e2d9c6'), frame: C('#394249'), glass: C('#2c3440'), bayW: 3.2, winW: 0.45, sill: 0.9, winH: 1.4, bandH: 0.3, topBand: 0.7, topColor: C('#e6dcc8'), reveal: 0.18 }),
  hostel: S({ wall: C('#e9d8b8'), band: C('#c0673f'), frame: C('#4a3f38'), glass: C('#2c3440'), bayW: 3.2, winW: 0.55, sill: 0.9, winH: 1.4, bandH: 0.9, topBand: 0.8, topColor: C('#c0673f'), reveal: 0.18 }),
  service: S({ wall: C('#f1f1ee'), band: C('#e4e4e0'), frame: C('#3a3a3a'), glass: C('#2b3036'), bayW: 3.6, winW: 0.55, sill: 1.0, winH: 1.3, bandH: 0, topBand: 0.7, topColor: C('#9a9c9e'), reveal: 0.12 }),
  // MRD entrance block: frosted white glass curtain wall on a light grey grid, navy top cornice (key frames 0316 / 0332)
  glass: S({ wall: C('#d9dfe2'), band: C('#c4cacd'), frame: C('#b4bbbf'), glass: C('#e2eaed'), bayW: 1.5, winW: 1.0, sill: 0.1, winH: 3.7, bandH: 0.16, mullions: 0, curtain: 1, topBand: 1.4, topColor: C('#1f2b45'), glassRough: 0.42, glassMetal: 0.18, litChance: 0.3, dirt: 0.15, reveal: 0.05 }),
  house: S({ wall: C('#ffffff'), band: C('#e8e2d6'), frame: C('#51473f'), glass: C('#2a2f36'), bayW: 2.9, winW: 0.45, sill: 1.0, winH: 1.25, bandH: 0.25, topBand: 0.35, topColor: C('#ffffff'), reveal: 0.12, litChance: 0.5 }),
};

/** Wall render texture for facades (white_stucco), set by loadWorldTextures. */
let facadeRender: PBRSet | null = null;

/** GLSL: helpers + interior-mapped rooms behind the glazing. */
const FACADE_PARS = /* glsl */ `
uniform float uNight; uniform vec3 uWall; uniform vec3 uBand; uniform vec3 uFrame; uniform vec3 uGlass; uniform vec3 uTop;
uniform vec3 uBaseCol; uniform vec3 uFasciaCol;
uniform vec4 uBay; uniform float uBandH; uniform float uMull; uniform float uCurtain; uniform float uTopBand; uniform float uBrick; uniform float uGroundGlass; uniform float uJali;
uniform vec2 uRibbon; uniform vec2 uPanel; uniform vec2 uBase; uniform vec2 uFascia; uniform vec2 uPil; uniform vec4 uModes; uniform vec3 uGlassRM; uniform float uDirt;
uniform vec3 uFac2; // reveal depth, room width, texture tile (m)
uniform float uTexMean;
varying vec4 vFacade; varying vec2 vFUV; varying vec3 vFWorld; varying vec3 vFNormalW;
float fh2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float fn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh2(i), fh2(i + vec2(1.0, 0.0)), f.x), mix(fh2(i + vec2(0.0, 1.0)), fh2(i + vec2(1.0, 1.0)), f.x), f.y); }
float fGlass; float fEmit; vec3 fEmitCol; float fFrame; float fPane; vec3 fInterior;
// Interior mapping: ray from the glass point p (room cell coords: x across [0,W], y up [0,H]) along d (tangent
// space, d.z < 0 = into the building) against a box room of depth D; a mid-room cut-out plane adds desks/chairs.
vec3 fRoom(vec2 p, vec3 d, vec2 sz, float rid, float depthMul, float art, vec3 lc, float dayL0) {
  float W = sz.x, H = sz.y;
  float r1 = fract(rid * 3.71), r2 = fract(rid * 5.33), r3 = fract(rid * 11.9);
  float D = mix(3.5, 7.5, fract(rid * 7.13)) * depthMul;
  p = clamp(p, vec2(0.02), sz - 0.02);
  vec3 dd = d;
  dd.x = abs(dd.x) < 1e-4 ? 1e-4 : dd.x;
  dd.y = abs(dd.y) < 1e-4 ? 1e-4 : dd.y;
  float tx = ((dd.x > 0.0 ? W : 0.0) - p.x) / dd.x;
  float ty = ((dd.y > 0.0 ? H : 0.0) - p.y) / dd.y;
  float tz = D / -dd.z;
  float t = min(min(tx, ty), tz);
  vec3 h = vec3(p, 0.0) + dd * t;
  float dep = -h.z;
  vec3 wallA = r1 < 0.55 ? vec3(0.8, 0.78, 0.72) : (r1 < 0.8 ? vec3(0.7, 0.76, 0.8) : vec3(0.84, 0.74, 0.54));
  vec3 alb = wallA;
  float ceilF = 0.0;
  if (t == tz) {
    alb = wallA * 0.92;
    if (h.y < 0.95) alb = mix(vec3(0.2, 0.18, 0.16), vec3(0.42, 0.4, 0.37), r2); // cabinets / desks along the back
    float wb = step(abs(h.x - W * 0.5), W * 0.3) * step(abs(h.y - 1.6), 0.5) * step(0.45, r3);
    alb = mix(alb, vec3(0.9, 0.92, 0.93), wb); // whiteboard / notice board
  } else if (t == ty) {
    if (dd.y > 0.0) { alb = vec3(0.86, 0.86, 0.84); ceilF = 1.0; }
    else alb = mix(vec3(0.28, 0.26, 0.24), vec3(0.5, 0.47, 0.42), r2);
  }
#if FACADE_DETAIL > 1
  float dm = D * (0.3 + 0.25 * r3);
  float tm = dm / -dd.z;
  if (tm < t) {
    vec3 hm = vec3(p, 0.0) + dd * tm;
    float top = 0.76 + 0.34 * step(0.62, fract(hm.x * 0.9 + r1 * 3.0));
    if (hm.y < top) { alb = vec3(0.15, 0.14, 0.13) + 0.1 * step(0.5, fract(hm.x * 2.3 + r2)); h = hm; dep = dm; ceilF = 0.0; }
  }
#endif
  float dayL = dayL0 * (0.2 + 0.8 * exp(-dep * 0.4));
  float tube = ceilF * step(abs(fract(h.z * 0.42 + r1) - 0.5), 0.07) * step(abs(fract(h.x / W * 2.0) - 0.5), 0.3);
  float artL = art * (ceilF > 0.5 ? 0.8 + 3.0 * tube : 0.4 + 0.45 * smoothstep(0.0, H, h.y)) * (0.7 + 0.3 * exp(-dep * 0.15));
  return alb * (vec3(0.95, 0.98, 1.04) * dayL + lc * artL);
}
`;

/** GLSL: the facade layout (replaces map_fragment). Produces diffuse `col`, glass / frame masks and fInterior. */
const FACADE_MAIN = /* glsl */ `
vec2 texUV = vFUV / (uBrick > 0.5 ? vec2(2.4, 1.2) : vec2(uFac2.z));
vec4 texel = texture2D(map, texUV);
float floorH = vFacade.x; float topY = vFacade.y; float seed = vFacade.z; float baseY = vFacade.w;
float x = vFUV.x; float y = vFUV.y + baseY;
float fl = floor(y / floorH);
float fy = y - fl * floorH;
float bay = floor(x / uBay.x);
float fx = fract(x / uBay.x);
float tl = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722)) / uTexMean; // ~1 on average
// tangent-space view ray (x along the wall = +u, y up, z out of the wall)
vec3 fN = normalize(vFNormalW);
vec3 fT = normalize(vec3(fN.z, 0.0, -fN.x) + vec3(1e-5, 0.0, 0.0));
vec3 fV = normalize(vFWorld - cameraPosition);
vec3 vt = vec3(dot(fV, fT), fV.y, min(dot(fV, fN), -0.03));
vec3 wallCol = uWall;
#ifdef USE_COLOR
  wallCol *= vColor.rgb;
#endif
float macro = fn2(vec2(x, y) * 0.21 + seed) * 0.6 + fn2(vec2(x, y) * 0.83 + seed * 1.7) * 0.4;
vec3 col = uBrick > 0.5 ? texel.rgb * 1.05 : wallCol * (1.0 + (tl - 1.0) * (0.25 + 0.35 * uDirt)) * (0.965 + 0.07 * macro);
fGlass = 0.0; fEmit = 0.0; fEmitCol = vec3(0.0); fFrame = 0.0; fPane = 0.0; fInterior = vec3(0.0);
bool parapet = y > topY - 0.02;
bool inTop = !parapet && y > topY - uTopBand;
bool inBase = y < uBase.x;
bool isGround = fl < 0.5;
float lit = step(1.0 - uGlassRM.z, fh2(vec2(bay * 3.1 + fl * 17.0, seed)));
vec3 warm = mix(vec3(1.0, 0.74, 0.46), vec3(0.84, 0.92, 1.0), step(0.55, fh2(vec2(fl, bay + seed * 3.0))));
// glass bookkeeping for the interior pass
vec2 gP = vec2(0.5); vec2 gRoom = vec2(3.0, 3.0); float gRid = 0.0; vec2 gW = vec2(0.5); vec2 gL = vec2(0.5);
float gDepth = 1.0; float gBlind = 1.0; float gShade = 1.0;
// stone panel joints (running bond) + per-panel tone + a catch-light on the lower lip of each joint
if (uPanel.x > 0.0 && !parapet) {
  float row = floor(y / uPanel.y);
  vec2 pj = vec2(x / uPanel.x + mod(row, 2.0) * 0.5, y / uPanel.y);
  vec2 f = fract(pj);
  float j = max(step(f.x, 0.014 / uPanel.x), step(f.y, 0.018 / uPanel.y));
  float lip = step(f.y, 0.034 / uPanel.y) * (1.0 - j);
  col *= (0.972 + 0.05 * fh2(floor(pj) + seed)) * (1.0 - 0.12 * j) * (1.0 + 0.035 * lip);
}
// slab spandrel band
if (!parapet && fy < uBandH && fl > 0.5 && !inBase) col = mix(col, uBand * mix(0.94, 1.04, tl), 0.92);
// pilaster strips at bay boundaries
if (uPil.x > 0.0 && !inTop && !parapet) {
  float grp = uBay.x * uPil.x;
  float gx = fract(x / grp) * grp;
  if (gx < uPil.y) col = wallCol * mix(0.98, 1.06, tl) * 1.05;
  else if (gx < uPil.y + 0.07) col *= 0.72;
}
// dark fascia bands at every Nth slab
bool fascia = uFascia.x > 0.0 && !parapet && !inBase && fl > 0.5 && mod(fl, uFascia.x) < 0.5 && fy < uFascia.y;
if (fascia) { col = uFasciaCol * mix(0.94, 1.04, tl); fFrame = 0.7; }
// parapet + top band
if (parapet) col = uTop * mix(0.94, 1.03, tl);
else if (inTop && uModes.w < 0.5) col = uTop * mix(0.92, 1.03, tl);
// ---- window layout ----
float x0 = 0.5 - uBay.y * 0.5; float x1 = 0.5 + uBay.y * 0.5;
float sill = uBay.z; float wh = uBay.w;
bool curtainBay = fh2(vec2(floor(x / (uBay.x * 3.0)), seed * 1.7)) < uCurtain;
bool ribbon = uRibbon.x > 0.5;
if (ribbon) { x0 = -0.01; x1 = 1.01; }
if (curtainBay) { sill = uBandH + 0.05; wh = floorH - uBandH - 0.1; x0 = -0.01; x1 = 1.01; }
if (isGround && uGroundGlass > 0.5) { sill = 0.35; wh = floorH - 0.8; x0 = 0.04; x1 = 0.96; }
bool punched = !ribbon && !curtainBay && uModes.x < 0.5 && uModes.y < 0.5;
bool inWin = fx > x0 && fx < x1 && fy > sill && fy < sill + wh && !inTop && !parapet && !fascia;
float Wm = (x1 - x0) * uBay.x;
float lx = (fx - x0) * uBay.x;
float ly = fy - sill;
// reveal: the glass sits uFac2.x behind the wall face; oblique views see the jambs, head and sill
#if FACADE_DETAIL > 0
if (inWin && punched && uFac2.x > 0.0) {
  vec2 g = vec2(lx, ly) + vt.xy * (uFac2.x / -vt.z);
  if (g.x < 0.0 || g.x > Wm || g.y < 0.0 || g.y > wh) {
    inWin = false;
    float sh = g.y > wh ? 0.52 : (g.y < 0.0 ? 1.04 : 0.76);
    col = wallCol * mix(0.97, 1.03, tl) * sh;
  } else { lx = g.x; ly = g.y; }
}
#endif
float wx = lx / max(Wm, 1e-3);
float wy = ly / max(wh, 1e-3);
bool frame = false;
// base zone: 1 = dark full-height glazing (colonnade behind columns), 2 = stone base with punched windows
if (inBase && uBase.y > 0.5) {
  if (uBase.y < 1.5) {
    inWin = false;
    float mx = fract(x / 1.5);
    bool mullion = mx < 0.05 || abs(y - 4.5) < 0.06 || y < 0.25;
    if (mullion) { col = uFrame * 0.9; fFrame = 1.0; }
    else {
      fGlass = 1.0;
      float rx = floor(x / 6.0);
      gRoom = vec2(6.0, uBase.x - 0.3); gP = vec2(x - rx * 6.0, y); gRid = fh2(vec2(rx, seed * 2.3));
      gDepth = 1.8; gBlind = 0.0; fPane = fh2(vec2(floor(x / 1.5), floor(y / 4.5) + seed));
      lit = step(0.35, fh2(vec2(floor(x / 6.0), seed)));
      warm = vec3(1.0, 0.86, 0.66);
    }
  } else {
    col = uBaseCol * mix(0.9, 1.06, tl);
    vec2 pj = vec2(x / 1.2 + mod(floor(y / 0.6), 2.0) * 0.5, y / 0.6);
    vec2 f = fract(pj);
    col *= (0.96 + 0.07 * fh2(floor(pj) + seed)) * (1.0 - 0.18 * max(step(f.x, 0.012), step(f.y, 0.02)));
  }
}
// top glass band (curtain) — GJBC courtyard faces
if (inTop && uModes.w > 0.5) {
  float mx = fract(x / 1.2);
  bool mullion = mx < 0.04 || abs(fy - floorH * 0.5) < 0.04 || (topY - y) < 0.3;
  inWin = false;
  if (mullion) { col = uFrame; fFrame = 1.0; }
  else {
    fGlass = 1.0;
    float rx = floor(x / 3.6);
    gRoom = vec2(3.6, floorH - 0.35); gP = vec2(x - rx * 3.6, fy); gRid = fh2(vec2(rx + 0.5, fl + seed * 7.0));
    fPane = fh2(vec2(floor(x / 1.2), fl + seed)); gW = vec2(mx, fy / floorH); gL = vec2(mx * 1.2, fy);
  }
}
// F-Block wings: continuous balcony bands (solid parapet + dark recessed corridor)
if (uModes.x > 0.5 && !inTop && !parapet) {
  inWin = false;
  if (fy < 1.1) { col = wallCol * mix(0.94, 1.04, tl) * (fy < 0.12 ? 0.8 : 1.0); }
  else if (fy > floorH - 0.28) { col = wallCol * 0.82; }
  else {
    // shaded back wall of the open corridor (render in shadow) with dark doors and small windows
    float door = step(0.6, fract(x / 3.4)) * step(fy, 3.0);
    float cwin = step(abs(fract(x / 3.4) - 0.3), 0.12) * step(abs(fy - 2.0), 0.45);
    col = mix(wallCol * 0.4, uBand * 1.1, max(door, cwin * 0.8)) * (0.9 + 0.2 * fh2(vec2(floor(x / 3.4), fl + seed)));
    fEmit = lit * max(door * 0.5, cwin) * uNight * 0.8; fEmitCol = warm;
    col *= mix(0.55, 1.0, smoothstep(floorH - 0.28, floorH - 1.0, fy));
  }
}
// F-Block tower: deep recessed window + beige vertical panel per bay
if (uModes.y > 0.5 && !inTop && !parapet && !inBase) {
  inWin = false;
  bool win = fx > 0.1 && fx < 0.46 && fy > 0.9 && fy < 2.5;
  bool pan = fx > 0.54 && fx < 0.9 && fy > 0.35 && fy < 3.15;
  if (win) {
    float edge = min(min(fx - 0.1, 0.46 - fx) * uBay.x, min(fy - 0.9, 2.5 - fy));
    gShade = mix(0.6, 1.0, smoothstep(0.0, 0.18, edge)) * ((fx - 0.1) * uBay.x < 0.16 || (2.5 - fy) < 0.16 ? 0.55 : 1.0);
    fGlass = 1.0;
    gRoom = vec2(uBay.x, floorH - 0.35); gP = vec2(fx * uBay.x, fy); gRid = fh2(vec2(bay, fl + seed * 7.0));
    gW = vec2((fx - 0.1) / 0.36, (fy - 0.9) / 1.6); gL = vec2((fx - 0.1) * uBay.x, fy - 0.9);
    fPane = gRid;
  } else if (pan) {
    col = uBand * mix(0.94, 1.04, tl);
    if ((fx - 0.54) * uBay.x < 0.08 || (3.15 - fy) < 0.08) col *= 0.7;
  } else if ((fx > 0.46 && fx < 0.5 && fy > 0.9 && fy < 2.5) || (fy > 2.5 && fy < 2.6 && fx > 0.1 && fx < 0.46)) col *= 0.6;
}
// B-Block louvre vents in the wall between windows
if (uModes.z > 0.0 && !inWin && !inTop && !parapet && !inBase && fh2(vec2(bay * 1.7, fl * 3.3 + seed)) < uModes.z) {
  float ly2 = fy - 1.55;
  if (abs(fx - 0.5) < 0.13 && ly2 > 0.0 && ly2 < 0.28) { col = mix(uWall * 0.5, uWall * 0.86, step(0.5, fract(ly2 * 21.0))); inWin = false; }
}
if (uJali > 0.5 && mod(bay, 4.0) == 1.0 && !isGround && !inTop) {
  vec2 jp = fract(vec2(x, y) * 2.5);
  float hole = step(0.25, length(jp - 0.5));
  col = mix(vec3(0.12, 0.28, 0.62), vec3(0.05, 0.08, 0.14), 1.0 - hole);
  inWin = false;
}
if (inWin) {
  if (ribbon && !curtainBay) {
    float mx = fract(x / uRibbon.y);
    frame = mx < 0.07 / uRibbon.y || wy < 0.04 || wy > 0.96;
    fPane = fh2(vec2(floor(x / uRibbon.y), fl + seed));
  } else {
    float mcount = uMull + 1.0;
    float mull = abs(fract(wx * mcount) - 0.5) * 2.0;
    float frameW = 0.045;
    frame = wx < frameW * 0.5 || wx > 1.0 - frameW * 0.5 || wy < frameW || wy > 1.0 - frameW || mull > 1.0 - frameW * mcount;
    if (abs(wy - 0.78) < 0.02 && !curtainBay) frame = true;
    fPane = fh2(vec2(bay + floor(wx * mcount) * 0.37, fl + seed));
  }
  if (frame) { col = uFrame * mix(0.95, 1.05, fh2(vec2(bay, fl))); fFrame = 1.0; }
  else {
    fGlass = 1.0;
    if (ribbon || curtainBay) {
      float rw = curtainBay ? uBay.x * 3.0 : uFac2.y;
      float rx = floor(x / rw);
      gRoom = vec2(rw, floorH - 0.35); gP = vec2(x - rx * rw, fy); gRid = fh2(vec2(rx, fl + seed * 7.0));
      lit = step(1.0 - uGlassRM.z, fh2(vec2(rx * 3.1 + fl * 17.0, seed)));
      gW = vec2(fract(x / rw), wy); gL = vec2(x - rx * rw, ly);
    } else {
      gRoom = vec2(uBay.x, floorH - 0.35); gP = vec2(x0 * uBay.x + lx, sill + ly); gRid = fh2(vec2(bay, fl + seed * 7.0));
      gW = vec2(wx, wy); gL = vec2(lx, ly);
    }
  }
}
// ---- glazing: tinted dielectric + interior-mapped room (emissive) ----
if (fGlass > 0.5) {
  float frost = smoothstep(0.14, 0.3, uGlassRM.x);
  float gLum = dot(uGlass, vec3(0.2126, 0.7152, 0.0722));
  vec3 tint = mix(vec3(1.0), uGlass / max(gLum, 1e-3), 0.3);
  float trans = clamp(gLum * 2.2 + 0.1, 0.16, 0.8);
  vec3 lightCol = warm * (0.8 + 0.45 * fh2(vec2(gRid, 3.1)));
  float day = clamp(1.0 - uNight * 1.25, 0.0, 1.0);
  float art = lit * max(smoothstep(0.15, 0.6, uNight), 0.3 * step(0.72, fract(gRid * 5.7)));
#if FACADE_DETAIL > 0
  vec3 room = fRoom(gP, vt, gRoom, gRid, gDepth, art, lightCol, day * 0.3);
#else
  vec3 room = mix(vec3(0.3, 0.29, 0.27), vec3(0.75, 0.74, 0.7), clamp(gP.y / gRoom.y, 0.0, 1.0)) * (day * 0.12 + art * 0.9 * lightCol);
#endif
  if (gBlind > 0.5) {
    float bsel = fract(gRid * 17.31);
    float cover = bsel < 0.42 ? 0.0 : (bsel < 0.84 ? 0.12 + 0.7 * fract(gRid * 29.7) : 1.02);
    if (gW.y > 1.0 - cover) {
      float slat = 0.84 + 0.16 * step(0.35, fract(gL.y * 12.5));
      vec3 bc = mix(vec3(0.8, 0.78, 0.72), vec3(0.62, 0.66, 0.7), step(0.6, fract(gRid * 7.9)));
      room = bc * slat * (day * 0.26 + art * 1.1 * lightCol);
    }
    float csel = fract(gRid * 41.7);
    if (csel < 0.22) {
      float cw = 0.16 + 0.16 * fract(gRid * 13.1);
      if (gW.x < cw || gW.x > 1.0 - cw) {
        vec3 cc = csel < 0.07 ? vec3(0.45, 0.09, 0.08) : (csel < 0.14 ? vec3(0.12, 0.18, 0.36) : vec3(0.72, 0.62, 0.46));
        room = cc * (0.78 + 0.22 * sin(gL.x * 38.0)) * (day * 0.24 + art * 0.8 * lightCol);
      }
    }
  }
  fInterior = (room * tint * trans * (1.0 - frost) + frost * uGlass * (day * 0.1 + art * 0.9 * lightCol)) * gShade;
  col = mix(uGlass * 0.05, uGlass * 0.45, frost) * gShade;
}
if (fEmit > 0.0) fInterior += fEmitCol * fEmit * 2.0;
// ---- weathering on opaque wall surfaces ----
if (fGlass < 0.5 && fFrame < 0.5) {
  float sN = fn2(vec2(x * 5.3, y * 0.26 + seed)) * 0.7 + fn2(vec2(x * 13.0, y * 0.6 - seed)) * 0.3;
  float streak = smoothstep(0.42, 0.85, sN);
  if (punched && !inTop && !parapet && !inBase) {
    float below = sill - fy;
    bool under = fx > x0 - 0.02 && fx < x1 + 0.02;
    if (below > 0.0 && under) col *= 1.0 - uDirt * 0.26 * streak * exp(-below * 1.0);
    if (under && below > -0.001 && below < 0.05) col *= 1.1; // projecting stone sill
    else if (under && below >= 0.05 && below < 0.09) col *= 0.78; // its shadow line
    float above = fy - (sill + wh);
    if (under && above > 0.0 && above < 0.12) col *= 0.8; // lintel drip shadow
  }
  float fromTop = max(topY - y, 0.0);
  col *= 1.0 - uDirt * 0.18 * streak * exp(-fromTop * 0.45); // run-off below the coping
  col *= 1.0 - uDirt * 0.26 * (1.0 - smoothstep(0.05, 0.65, y)) * (0.55 + 0.45 * sN); // splash-back grime
}
col *= mix(0.68, 1.0, smoothstep(0.0, 1.4, y)); // ground-contact occlusion
diffuseColor.rgb = col;
`;

/**
 * Facade material: walls are UV-mapped in metres (u along perimeter, v height above the prism base).
 * Vertex attribute `aFacade` = (floorH, topY, seed, baseY) and optional vertex colour (house tint).
 * Windows (with reveals, frames, blinds / curtains and interior-mapped rooms behind the glass), stone joints,
 * bands, curtain glass, fascia, pilasters, balconies, weathering and night lights are generated in the fragment
 * shader; world height y = v + baseY so stacked prisms line up. Glass is a dielectric that reflects the PMREM
 * environment with Fresnel; the room behind it is emissive (daylight by day, room lights at night).
 */
export function facadeMaterial(style: FacadeStyle | 'house', plaster: PBRSet, brick: PBRSet, envIntensity = 1): THREE.MeshStandardMaterial {
  const P = FACADE_STYLES[style];
  const useBrick = P.brick > 0.5 && brick.map;
  // the fine stucco set (registered by loadWorldTextures) replaces the passed plaster when available
  const tex = useBrick ? brick : (facadeRender?.map ? facadeRender : plaster);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    map: tex.map,
    normalMap: tex.normalMap,
    vertexColors: style === 'house',
    envMapIntensity: envIntensity,
  });
  mat.normalScale.setScalar(useBrick ? 1.0 : 0.55);
  mat.defines = { ...mat.defines, FACADE_DETAIL: materialDetail };
  const texMean = textureMean(tex.map, 0.45);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uNight: worldUniforms.uNight,
      uWall: { value: P.wall }, uBand: { value: P.band }, uFrame: { value: P.frame }, uGlass: { value: P.glass },
      uTop: { value: P.topColor }, uBaseCol: { value: P.baseColor }, uFasciaCol: { value: P.fasciaColor },
      uBay: { value: new THREE.Vector4(P.bayW, P.winW, P.sill, P.winH) },
      uBandH: { value: P.bandH }, uMull: { value: P.mullions }, uCurtain: { value: P.curtain },
      uTopBand: { value: P.topBand }, uBrick: { value: P.brick }, uGroundGlass: { value: P.groundGlass }, uJali: { value: P.jali },
      uRibbon: { value: new THREE.Vector2(P.ribbon, P.mullSp) },
      uPanel: { value: new THREE.Vector2(P.panel[0], P.panel[1]) },
      uBase: { value: new THREE.Vector2(P.baseH, P.baseMode) },
      uFascia: { value: new THREE.Vector2(P.fasciaEvery, P.fasciaH) },
      uPil: { value: new THREE.Vector2(P.pilaster, P.pilasterW) },
      uModes: { value: new THREE.Vector4(P.balcony, P.recess, P.louvre, P.topGlass) },
      uGlassRM: { value: new THREE.Vector3(P.glassRough, P.glassMetal, P.litChance) },
      uDirt: { value: P.dirt },
      uFac2: { value: new THREE.Vector3(P.reveal, P.roomW, 2.0) },
      uTexMean: { value: texMean },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aFacade;
varying vec4 vFacade;
varying vec2 vFUV;
varying vec3 vFWorld;
varying vec3 vFNormalW;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
vFacade = aFacade;
vFUV = uv;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vFWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFNormalW = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_PARS}`)
      .replace('#include <map_fragment>', FACADE_MAIN)
      // the facade applies the vertex colour (house tint) to the walls only
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * mix(0.92, 1.06, tl);
roughnessFactor = mix(roughnessFactor, uGlassRM.x * (0.7 + 0.6 * fPane), fGlass);
roughnessFactor = mix(roughnessFactor, 0.42, fFrame);`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = metalness;
metalnessFactor = mix(metalnessFactor, 0.55, fFrame * (1.0 - fGlass));`)
      .replace('#include <normal_fragment_maps>', `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, texUV ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale * (1.0 - fGlass) * (1.0 - 0.7 * fFrame);
  // panes are never perfectly flat: a small per-pane tilt breaks up the reflections
  mapN.xy += (vec2(fh2(vec2(fPane, 1.7)), fh2(vec2(fPane, 8.3))) - 0.5) * 0.045 * fGlass;
  normal = normalize( tbn * mapN );
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += fInterior;`)
      .replace('#include <lights_fragment_end>', `#if defined( RE_IndirectSpecular )
  radiance *= 1.0 + fGlass * (0.4 + 1.4 * uGlassRM.y);
#endif
#include <lights_fragment_end>`);
    injectWorldLighting(shader);
  };
  mat.customProgramCacheKey = () => `facade4_${style}_${materialDetail}`;
  return mat;
}

// -------------------------------------------------------------------------------------------------
// Asphalt: world-space two-scale sampling (no visible tiling) + 30 m macro map, kerb-side dust, wheel tracks,
// oil drip lines and sealed repair patches. Strips built with along-road UVs (u = s / width, v = 0..1 across)
// get lane-aware wear; anything else (aprons, uv outside 0..1) gets the isotropic look.
// -------------------------------------------------------------------------------------------------

export function asphaltMaterial(fine: PBRSet, macro: THREE.Texture | null, opts: { color?: THREE.ColorRepresentation; lanes?: number; roughness?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: opts.color ?? new THREE.Color(0.14, 0.136, 0.13),
    map: fine.map,
    normalMap: fine.normalMap,
    roughness: opts.roughness ?? 0.92,
    metalness: 0,
  });
  m.normalScale.setScalar(0.9);
  m.defines = { ...m.defines, AS_DETAIL: materialDetail };
  const mean = textureMean(fine.map, 0.2);
  const macroMean = textureMean(macro, 0.2);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uAsMacro: { value: macro ?? fine.map }, uAsMean: { value: mean }, uAsMacroMean: { value: macroMean }, uAsLanes: { value: opts.lanes ?? 2 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAsW; varying vec2 vAsUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAsUv = uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAsW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vAsW; varying vec2 vAsUv;
uniform sampler2D uAsMacro; uniform float uAsMean; uniform float uAsMacroMean; uniform float uAsLanes;
float asHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float asNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(asHash(i), asHash(i + vec2(1, 0)), f.x), mix(asHash(i + vec2(0, 1)), asHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
vec2 asP = vec2(vAsW.x, -vAsW.z);
vec2 asUvA = asP / 4.0;
vec2 asUvB = vec2(0.8 * asP.x - 0.6 * asP.y, 0.6 * asP.x + 0.8 * asP.y) / 6.7 + vec2(0.37, 0.11);
#if AS_DETAIL > 0
float asBl = smoothstep(0.3, 0.7, asNoise(asP * 0.09));
vec3 asAlb = mix(texture2D(map, asUvA).rgb, texture2D(map, asUvB).rgb, asBl) / uAsMean;
#else
float asBl = 0.0;
vec3 asAlb = texture2D(map, asUvA).rgb / uAsMean;
#endif
float asM = dot(texture2D(uAsMacro, asP / 31.0 + 0.5).rgb, vec3(0.333)) / uAsMacroMean;
bool asLanes = vAsUv.y >= 0.0 && vAsUv.y <= 1.0;
float across = asLanes ? vAsUv.y : 0.5;
float asEdge = min(across, 1.0 - across);
float asN1 = asNoise(asP * 0.35), asN2 = asNoise(asP * 1.7);
vec3 asC = diffuse * mix(vec3(1.0), asAlb, 0.75) * mix(1.0, asM, 0.85);
// large darker / lighter blotches (fresh overlay vs sun-bleached and dusty areas)
asC *= 0.82 + 0.36 * smoothstep(0.25, 0.75, asNoise(asP * 0.035 + 1.7) * 0.7 + asNoise(asP * 0.11) * 0.3);
float asDust = (asLanes ? (1.0 - smoothstep(0.015, 0.14, asEdge)) * (0.55 + 0.45 * asN2) : 0.0)
  + smoothstep(0.6, 0.82, asNoise(asP * 0.055 + 3.1)) * 0.5 * asN1;
asC = mix(asC, vec3(0.34, 0.325, 0.3), clamp(asDust, 0.0, 1.0) * 0.55);
float asLane = fract(across * uAsLanes);
float asTrack = asLanes ? exp(-pow((asLane - 0.28) / 0.07, 2.0)) + exp(-pow((asLane - 0.74) / 0.07, 2.0)) : 0.0;
asC *= 1.0 - 0.14 * asTrack * (0.6 + 0.4 * asN2);
asC *= 1.0 - (asLanes ? 0.1 * exp(-pow((asLane - 0.51) / 0.045, 2.0)) * asN1 : 0.0);
asC *= 1.0 - 0.18 * smoothstep(0.72, 0.9, asNoise(asP * 0.6 + 9.0)) * asN2; // oil stains
vec2 asCell = floor(asP / vec2(3.3, 2.4));
vec2 asPf = fract(asP / vec2(3.3, 2.4)) + (vec2(asNoise(asP * 2.3), asNoise(asP * 2.3 + 5.0)) - 0.5) * 0.06;
float asPatch = step(0.94, asHash(asCell + 7.7)) * step(0.12, asPf.x) * step(asPf.x, 0.88) * step(0.15, asPf.y) * step(asPf.y, 0.85);
float asPd = min(min(asPf.x - 0.12, 0.88 - asPf.x) * 3.3, min(asPf.y - 0.15, 0.85 - asPf.y) * 2.4);
asC = mix(asC, asC * 0.78, asPatch);
asC *= 1.0 - 0.22 * asPatch * (1.0 - smoothstep(0.02, 0.07, asPd));
diffuseColor.rgb = asC;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * (1.0 - 0.12 * asTrack - 0.1 * asPatch) * mix(0.94, 1.04, asN2);`)
      .replace('#include <normal_fragment_maps>', `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 asNA = texture2D(normalMap, asUvA).xyz * 2.0 - 1.0;
#if AS_DETAIL > 0
  vec3 asNB = texture2D(normalMap, asUvB).xyz * 2.0 - 1.0;
  asNB.xy = asNB.x * vec2(0.8, -0.6) + asNB.y * vec2(0.6, 0.8);
  vec3 asMapN = mix(asNA, asNB, asBl);
#else
  vec3 asMapN = asNA;
#endif
  asMapN.xy *= normalScale * (1.0 - 0.6 * asPatch);
  // tangent frame of the world-space projection: +X, -Z (texture v), up
  vec3 asT = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
  vec3 asB = (viewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz;
  normal = normalize(mat3(asT, asB, normal) * asMapN);
#endif`);
    injectWorldLighting(shader);
  };
  m.customProgramCacheKey = () => `asphalt2_${materialDetail}`;
  return m;
}

// -------------------------------------------------------------------------------------------------
// Canvas textures
// -------------------------------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function toTex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  return t;
}

export function signTexture(text: string, sub: string | undefined, color: string, width = 1024): THREE.CanvasTexture {
  const h = sub ? 256 : 160;
  const [c, g] = canvas(width, h);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = sub ? 110 : 120;
  g.font = `800 ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  while (g.measureText(text).width > width * 0.95 && size > 20) { size -= 4; g.font = `800 ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`; }
  g.fillText(text, width / 2, sub ? h * 0.36 : h / 2);
  if (sub) {
    let s2 = 58;
    g.font = `600 ${s2}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    while (g.measureText(sub).width > width * 0.95 && s2 > 16) { s2 -= 2; g.font = `600 ${s2}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`; }
    g.fillText(sub, width / 2, h * 0.78);
  }
  return toTex(c, { repeat: false });
}

/** Striped "barcode" pavers (600 x 300 mm, buff/grey, random charcoal runs). u runs along the path, v across. 6 m tile. */
export function barcodePaverTexture(): THREE.CanvasTexture {
  const S = 512, courses = 20, per = 10; // 20 courses of 0.3 m along u, 10 pavers of 0.6 m across v
  const [c, g] = canvas(S, S);
  const r = rng(515);
  const cw = S / courses, ph = S / per;
  const cols = ['#d9c4a4', '#d3bd9c', '#cdc9c1', '#c6c2ba', '#dcd0bc', '#a4a19c', '#b7b3ab'];
  g.fillStyle = '#8b877f'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < courses; i++) {
    const off = (i % 2) * ph * 0.5;
    const dark = r() < 0.22; // charcoal run a few pavers long
    const d0 = Math.floor(r() * per), dl = 2 + Math.floor(r() * 5);
    for (let k = -1; k < per; k++) {
      const y0 = k * ph + off;
      let col = cols[Math.floor(r() * cols.length)];
      const kk = (k + per) % per;
      if (dark && ((kk - d0 + per) % per) < dl) col = r() < 0.5 ? '#6e6e6c' : '#77756f';
      g.fillStyle = col;
      g.fillRect(i * cw + 1, y0 + 1, cw - 2, ph - 2);
      // subtle speckle
      for (let s = 0; s < 14; s++) { g.fillStyle = `rgba(0,0,0,${r() * 0.07})`; g.fillRect(i * cw + r() * cw, y0 + r() * ph, 2, 2); }
    }
  }
  return toTex(c);
}

/** Grey two-tone rectangular concrete pavers (300 x 150) with a darker border band. 6 m tile, laid along the path. */
export function greyPaverTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(616);
  g.fillStyle = '#8a8883'; g.fillRect(0, 0, S, S);
  const rows = 40, cols = 20; // 0.15 x 0.3 m over 6 m
  const rh = S / rows, cw = S / cols;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * cw * 0.5;
    for (let i = -1; i < cols; i++) {
      const band = j === 19 || j === 20;
      const v = band ? 150 + r() * 10 : (r() < 0.5 ? 178 : 188) + r() * 10;
      g.fillStyle = `rgb(${v},${v - 1},${v - 4})`;
      g.fillRect(i * cw + off + 0.8, j * rh + 0.8, cw - 1.6, rh - 1.6);
    }
  }
  return toTex(c);
}

/** Polished speckled granite (light grey, black + white specks), 2 m tile. Used with vertex colours for bands. */
export function speckleTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(717);
  g.fillStyle = '#c9cac7'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const v = r();
    g.fillStyle = v < 0.45 ? `rgba(40,40,42,${0.35 + r() * 0.5})` : v < 0.8 ? `rgba(245,245,242,${0.4 + r() * 0.5})` : `rgba(150,140,130,${0.4 + r() * 0.4})`;
    const s = 1 + r() * 2.2;
    g.fillRect(r() * S, r() * S, s, s);
  }
  // slab joints (1 m)
  g.fillStyle = 'rgba(60,60,60,0.35)';
  for (let k = 0; k < 2; k++) { g.fillRect(k * S / 2, 0, 1.5, S); g.fillRect(0, k * S / 2, S, 1.5); }
  return toTex(c);
}

/** Alternating black & white kerb paint (0.5 m blocks): u = metres along kerb * 1 → one period per metre. */
export function kerbTexture(): THREE.CanvasTexture {
  // 1 m period along u (0.5 m black + 0.5 m white). v: 0 = foot of the road side, 0.5 = top face, 1 = foot of the far side
  const W = 256, H = 64;
  const [c, g] = canvas(W, H);
  const r = rng(929);
  g.fillStyle = '#1d1d1c'; g.fillRect(0, 0, W / 2, H);
  g.fillStyle = '#e9e7e0'; g.fillRect(W / 2, 0, W / 2, H);
  // paint wear, tyre scuffs and splashes
  for (let i = 0; i < 700; i++) {
    const x = r() * W, y = r() * H, white = x >= W / 2;
    g.fillStyle = white ? `rgba(70,64,56,${r() * 0.12})` : `rgba(150,146,140,${r() * 0.1})`;
    g.fillRect(x, y, 1 + r() * 5, 1 + r() * 2);
  }
  // grime creeping up from the road / soil at both feet, a little on the worn top face
  for (const [y0, dir] of [[0, 1], [H, -1]] as [number, number][]) {
    const grd = g.createLinearGradient(0, y0, 0, y0 + dir * H * 0.3);
    grd.addColorStop(0, 'rgba(58,50,42,0.55)'); grd.addColorStop(1, 'rgba(58,50,42,0)');
    g.fillStyle = grd; g.fillRect(0, dir > 0 ? 0 : H * 0.7, W, H * 0.3);
  }
  g.fillStyle = 'rgba(90,84,76,0.12)'; g.fillRect(0, H * 0.45, W, H * 0.1);
  // block joints
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(W / 2 - 1, 0, 2, H); g.fillRect(W - 1, 0, 1, H); g.fillRect(0, 0, 1, H);
  return toTex(c, { aniso: 8 });
}

/** Corten panels (3 m) alternating with dark-green mesh panels with creepers. 6 m x 3.2 m tile (u, v in metres/6, /3.2). */
export function cortenTexture(): THREE.CanvasTexture {
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(818);
  // corten panel
  const rust = g.createLinearGradient(0, 0, 0, H);
  rust.addColorStop(0, '#83432a'); rust.addColorStop(1, '#6d3420');
  g.fillStyle = rust; g.fillRect(0, 0, W / 2, H);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '40,18,10' : '160,90,50'},${r() * 0.12})`; g.fillRect(r() * W / 2, r() * H, 1 + r() * 3, 1 + r() * 6); }
  // leaf-shaped perforations
  g.fillStyle = '#231a14';
  for (let k = 0; k < 7; k++) {
    const cx = W / 4, cy = 40 + k * 28;
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 10, cy, 14, 4, s * 0.5, 0, Math.PI * 2); g.fill(); }
  }
  g.fillRect(W / 4 - 1, 30, 2, 200);
  // green mesh panel + creepers
  g.fillStyle = '#26382a'; g.fillRect(W / 2, 0, W / 2, H);
  g.strokeStyle = 'rgba(90,110,90,0.5)'; g.lineWidth = 1;
  for (let x = W / 2; x < W; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 6) { g.beginPath(); g.moveTo(W / 2, y); g.lineTo(W, y); g.stroke(); }
  for (let i = 0; i < 900; i++) {
    const x = W / 2 + r() * W / 2, y = H * (0.25 + 0.75 * Math.sqrt(r()));
    g.fillStyle = ['#2f5a28', '#3f7030', '#4f8036', '#26461f'][Math.floor(r() * 4)];
    g.beginPath(); g.ellipse(x, y, 3 + r() * 4, 2 + r() * 2, r() * 3, 0, Math.PI * 2); g.fill();
  }
  // frame lines
  g.fillStyle = '#2a211b'; g.fillRect(0, 0, 3, H); g.fillRect(W / 2 - 2, 0, 4, H); g.fillRect(0, 0, W, 3);
  return toTex(c);
}

/** Green scaffold safety net (semi-transparent mesh). */
export function netTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(46,112,70,0.62)'; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + 2, y + 2, 5, 5); }
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(28,80,48,0.9)';
  for (let y = 0; y < S; y += 32) g.fillRect(0, y, S, 2);
  return toTex(c, { aniso: 4 });
}

/** Ornamental fountain-grass tuft card (alpha). */
export function grassTuftTexture(): THREE.CanvasTexture {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(919);
  g.clearRect(0, 0, W, H);
  g.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const bx = W / 2 + (r() - 0.5) * 60;
    const ang = (r() - 0.5) * 1.5;
    const len = H * (0.55 + r() * 0.42);
    const tx = bx + Math.sin(ang) * len, ty = H - Math.cos(ang) * len;
    g.strokeStyle = ['#8f9a45', '#a7b25a', '#b6bd6c', '#7d8a3c', '#c2c07a'][Math.floor(r() * 5)];
    g.lineWidth = 2 + r() * 2;
    g.beginPath(); g.moveTo(bx, H); g.quadraticCurveTo(bx + Math.sin(ang) * len * 0.3, H - len * 0.6, tx, ty); g.stroke();
  }
  // feathery plumes
  for (let i = 0; i < 26; i++) {
    const x = W / 2 + (r() - 0.5) * 170, y = H * (0.05 + r() * 0.3);
    g.strokeStyle = `rgba(${200 + r() * 30},${190 + r() * 30},${150 + r() * 30},0.9)`;
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 16, y + 30 + r() * 20); g.stroke();
  }
  return toTex(c, { repeat: false, aniso: 4 });
}

/** Dense leafy hedge / shrub texture (tiling). Variant: 'green' | 'lime' | 'white' (murraya flowers). */
export function hedgeTexture(kind: 'green' | 'lime' | 'white' = 'green'): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(kind === 'lime' ? 131 : kind === 'white' ? 141 : 121);
  const pal = kind === 'lime' ? ['#8fb12e', '#a6c33c', '#b9cf4a', '#6f8f22', '#c8d86a'] : ['#2f5a26', '#3c6c2e', '#4a7d36', '#244a1f', '#5a8c40'];
  g.fillStyle = kind === 'lime' ? '#5f7a1f' : '#223f1c'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = pal[Math.floor(r() * pal.length)];
    g.beginPath(); g.ellipse(r() * S, r() * S, 3 + r() * 5, 1.5 + r() * 2.5, r() * 3, 0, Math.PI * 2); g.fill();
  }
  if (kind === 'white') for (let i = 0; i < 260; i++) { g.fillStyle = r() < 0.8 ? '#f4f3ea' : '#e8e2b0'; g.beginPath(); g.arc(r() * S, r() * S, 1.5 + r() * 1.5, 0, Math.PI * 2); g.fill(); }
  return toTex(c, { aniso: 4 });
}

export function radialTexture(inner: string, outer: string, size = 128): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return toTex(c, { repeat: false });
}

export async function loadWorldTextures(assets: Assets) {
  const base = `${import.meta.env.BASE_URL}textures/`;
  // asphalt_02 and brick_wall_02 are no longer loaded (roads use asphalt_04, no facade style uses brick); their keys
  // stay in WorldTextures for compatibility.
  const [pavers, grass, soil, stone, plaster, concrete, bark, stucco, granite, wood, concreteWall, asphaltFine, asphaltMacro] = await Promise.all([
    assets.pbr('patterned_concrete_pavers'),
    assets.pbr('leafy_grass'),
    assets.pbr('red_dirt_mud_01'),
    assets.pbr('stone_wall_04'),
    assets.pbr('painted_plaster_wall'),
    assets.pbr('concrete_floor_02'),
    assets.pbr('bark_brown_02'),
    assets.pbr('white_stucco'), // fine painted render: facades, plaster / stone detail
    assets.pbr('granite_tile_03'), // speckled grey granite tiles: polished floors, honed steps / cladding
    assets.pbr('fine_grained_wood'), // soffits, column cladding, benches
    assets.pbr('concrete_wall_008'), // exposed concrete (metro piers, service structures)
    assets.pbr('asphalt_04'), // weathered pale asphalt (roads)
    assets.texture(base + 'aerial_asphalt_01/diff.jpg', { srgb: true }), // 30 m macro variation for roads
  ]);
  facadeRender = stucco;
  const asphalt: PBRSet = asphaltFine;
  const brick: PBRSet = { map: null, normalMap: null, arm: null };
  return { asphalt, pavers, grass, soil, stone, plaster, concrete, bark, brick, stucco, granite, wood, concreteWall, asphaltFine, asphaltMacro };
}
export type WorldTextures = Awaited<ReturnType<typeof loadWorldTextures>>;
