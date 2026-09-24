import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import type { FacadeStyle } from './layout';
import { rng } from './geom';

/** Shared uniforms driven by time of day. */
export const worldUniforms = {
  uNight: { value: 0 }, // 0 day … 1 full night (window lights, lamps)
  uTime: { value: 0 },
  uWind: { value: 1 },
};

export interface PBRSet { map: THREE.Texture | null; normalMap: THREE.Texture | null; arm: THREE.Texture | null }

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
  glass: THREE.Color;
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
  glassRough: number;
  glassMetal: number;
  litChance: number; // fraction of windows lit at night
  dirt: number; // 0 = clean new cladding … 1 = weathered
}

const C = (hex: string) => new THREE.Color(hex);

const BASE: FacadeParams = {
  wall: C('#ffffff'), band: C('#dcd6ca'), frame: C('#3a3f45'), glass: C('#26323d'),
  bayW: 3.2, winW: 0.5, sill: 0.9, winH: 1.5, bandH: 0.3, mullions: 1, curtain: 0, topBand: 0.8, topColor: C('#e6e1d8'),
  brick: 0, groundGlass: 0, jali: 0, ribbon: 0, mullSp: 1.5, panel: [0, 0], baseH: 0, baseMode: 0, baseColor: C('#2f3a44'),
  fasciaEvery: 0, fasciaH: 0.8, fasciaColor: C('#44484e'), pilaster: 0, pilasterW: 0.5, balcony: 0, recess: 0, louvre: 0,
  topGlass: 0, glassRough: 0.06, glassMetal: 0.85, litChance: 0.42, dirt: 1,
};
const S = (o: Partial<FacadeParams>): FacadeParams => ({ ...BASE, ...o });

export const FACADE_STYLES: Record<FacadeStyle | 'house', FacadeParams> = {
  // GJBC exterior: cream stone panels, dark ribbon windows, charcoal fascia every 2nd slab, dark glazed 9 m base
  gjbc: S({ wall: C('#ebe5d8'), band: C('#e3dccd'), frame: C('#3a4048'), glass: C('#34414c'), bayW: 1.5, ribbon: 1, mullSp: 1.5, sill: 1.15, winH: 2.15, bandH: 0, mullions: 0, topBand: 1.3, topColor: C('#ece6d9'), panel: [1.2, 0.6], baseH: 9, baseMode: 1, baseColor: C('#27313a'), fasciaEvery: 0, litChance: 0.5, dirt: 0.12 }),
  // GJBC courtyard faces: cream plaster, blue-grey ribbon glass, glass band at the top
  gjbcQuad: S({ wall: C('#ede6d6'), band: C('#e4dccb'), frame: C('#4a5560'), glass: C('#56646e'), glassRough: 0.14, glassMetal: 0.6, bayW: 1.2, ribbon: 1, mullSp: 1.2, sill: 1.0, winH: 1.9, bandH: 0, topBand: 4.0, topGlass: 1, topColor: C('#ebe4d4'), baseH: 9, baseMode: 1, baseColor: C('#2a3139'), litChance: 0.5, dirt: 0.15 }),
  // GJBC dark glass curtain wall (south-east; fins are geometry)
  gjbcCurtain: S({ wall: C('#e6e0d3'), band: C('#3c444c'), frame: C('#2b3138'), glass: C('#2c3843'), bayW: 1.5, curtain: 1, bandH: 0.28, mullions: 0, topBand: 1.0, topColor: C('#e9e3d6'), baseH: 0, litChance: 0.55, dirt: 0.1 }),
  // GJBC NW library tower: white plaster, punched strip windows, granite plinth
  library: S({ wall: C('#f0eee8'), band: C('#e8e5de'), frame: C('#2f3a44'), glass: C('#2f3b46'), bayW: 4.2, winW: 0.82, sill: 1.0, winH: 1.55, bandH: 0, mullions: 3, curtain: 0.14, topBand: 1.2, topColor: C('#eeece6'), panel: [1.4, 4.2], baseH: 4.2, baseMode: 2, baseColor: C('#9c9c9a'), dirt: 0.25 }),
  // MRD refurb: buff sandstone blocks + frosted glass curtain groups + navy cornice
  mrd: S({ wall: C('#cdbfa6'), band: C('#c2b398'), frame: C('#4f6d8c'), glass: C('#d6e1e6'), bayW: 3.0, winW: 0.5, sill: 1.0, winH: 1.6, bandH: 0, mullions: 1, curtain: 0.5, topBand: 1.6, topColor: C('#1f2b45'), panel: [1.0, 0.5], baseH: 0, baseMode: 0, glassRough: 0.32, glassMetal: 0.2, litChance: 0.35, dirt: 0.45 }),
  // B-Block: beige plaster, pilaster strips, near-square windows, louvre vents, pink-grey stone base (2 floors)
  bblock: S({ wall: C('#e0cfb6'), band: C('#d4c4ad'), frame: C('#2f3a40'), glass: C('#7f93a0'), bayW: 3.5, winW: 0.37, sill: 1.0, winH: 1.4, bandH: 0, mullions: 1, topBand: 1.0, topColor: C('#d8c9b3'), pilaster: 1, pilasterW: 0.55, louvre: 0.28, baseH: 7.0, baseMode: 2, baseColor: C('#a89484'), glassRough: 0.1, glassMetal: 0.7, dirt: 0.2 }),
  // B-Block crest tower: buff stone, tiny square windows
  bblockTower: S({ wall: C('#c4b095'), band: C('#bba88c'), frame: C('#3a3a36'), glass: C('#3a434a'), bayW: 3.0, winW: 0.27, sill: 1.3, winH: 0.8, bandH: 0, mullions: 0, topBand: 0.9, topColor: C('#b8a386'), panel: [1.2, 0.6], litChance: 0.25 }),
  // F-Block tower: terracotta render, deep windows paired with beige vertical panels, heavy cornice
  fTower: S({ wall: C('#b45a45'), band: C('#e3d2b0'), frame: C('#3b2f2a'), glass: C('#2c2a2a'), bayW: 2.4, recess: 1, bandH: 0, topBand: 1.5, topColor: C('#a24c3a'), litChance: 0.35 }),
  // F-Block wings: cream with continuous open-corridor balcony bands
  fWing: S({ wall: C('#e8dabf'), band: C('#3b3531'), frame: C('#4a3f38'), glass: C('#2c3440'), bayW: 3.4, balcony: 1, bandH: 0, topBand: 1.0, topColor: C('#b8604a'), litChance: 0.35 }),
  // F-Block podium: terracotta with small punched windows
  fPodium: S({ wall: C('#b45a45'), band: C('#a95442'), frame: C('#2a2624'), glass: C('#22262a'), bayW: 2.4, winW: 0.42, sill: 1.2, winH: 1.0, bandH: 0, mullions: 0, topBand: 0.9, topColor: C('#a24c3a') }),
  // white plaster (gate / mural building, cabins)
  admin: S({ wall: C('#f4f4f1'), band: C('#ecebe6'), frame: C('#2d3440'), glass: C('#2a3c4f'), bayW: 5.0, winW: 0.3, sill: 1.2, winH: 1.3, bandH: 0, topBand: 0.6, topColor: C('#f2f1ee') }),
  oldCream: S({ wall: C('#efe7d6'), band: C('#e2d9c6'), frame: C('#394249'), glass: C('#2c3440'), bayW: 3.2, winW: 0.45, sill: 0.9, winH: 1.4, bandH: 0.3, topBand: 0.7, topColor: C('#e6dcc8') }),
  hostel: S({ wall: C('#e9d8b8'), band: C('#c0673f'), frame: C('#4a3f38'), glass: C('#2c3440'), bayW: 3.2, winW: 0.55, sill: 0.9, winH: 1.4, bandH: 0.9, topBand: 0.8, topColor: C('#c0673f') }),
  service: S({ wall: C('#f1f1ee'), band: C('#e4e4e0'), frame: C('#3a3a3a'), glass: C('#2b3036'), bayW: 3.6, winW: 0.55, sill: 1.0, winH: 1.3, bandH: 0, topBand: 0.7, topColor: C('#9a9c9e') }),
  glass: S({ wall: C('#cdbfa6'), band: C('#c9bea9'), frame: C('#4f6d8c'), glass: C('#cfdce3'), bayW: 1.8, winW: 0.9, sill: 0.3, winH: 3.2, bandH: 0.4, curtain: 0.85, topBand: 1.4, topColor: C('#1f2b45'), glassRough: 0.3, glassMetal: 0.25 }),
  house: S({ wall: C('#ffffff'), band: C('#e8e2d6'), frame: C('#51473f'), glass: C('#2a2f36'), bayW: 2.9, winW: 0.45, sill: 1.0, winH: 1.25, bandH: 0.25, topBand: 0.35, topColor: C('#ffffff') }),
};

/**
 * Facade material: walls are UV-mapped in metres (u along perimeter, v height above the prism base).
 * Vertex attribute `aFacade` = (floorH, topY, seed, baseY) and optional vertex colour (house tint).
 * Windows, stone joints, bands, curtain glass, fascia, pilasters, balconies and night lights are generated
 * in the fragment shader; world height y = v + baseY so stacked prisms line up.
 */
export function facadeMaterial(style: FacadeStyle | 'house', plaster: PBRSet, brick: PBRSet, envIntensity = 1): THREE.MeshStandardMaterial {
  const P = FACADE_STYLES[style];
  const useBrick = P.brick > 0.5 && brick.map;
  const tex = useBrick ? brick : plaster;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
    map: tex.map,
    normalMap: tex.normalMap,
    vertexColors: style === 'house',
    envMapIntensity: envIntensity,
  });
  mat.normalScale.setScalar(useBrick ? 1.0 : 0.45);
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
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aFacade;
varying vec4 vFacade;
varying vec2 vFUV;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
vFacade = aFacade;
vFUV = uv;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight; uniform vec3 uWall; uniform vec3 uBand; uniform vec3 uFrame; uniform vec3 uGlass; uniform vec3 uTop;
uniform vec3 uBaseCol; uniform vec3 uFasciaCol;
uniform vec4 uBay; uniform float uBandH; uniform float uMull; uniform float uCurtain; uniform float uTopBand; uniform float uBrick; uniform float uGroundGlass; uniform float uJali;
uniform vec2 uRibbon; uniform vec2 uPanel; uniform vec2 uBase; uniform vec2 uFascia; uniform vec2 uPil; uniform vec4 uModes; uniform vec3 uGlassRM; uniform float uDirt;
varying vec4 vFacade; varying vec2 vFUV;
float fh2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float fGlass; float fEmit; vec3 fEmitCol; float fFrame;
`)
      .replace('#include <map_fragment>', `
vec2 texUV = vFUV / (uBrick > 0.5 ? vec2(2.4, 1.2) : vec2(3.0, 3.0));
vec4 texel = texture2D(map, texUV);
float floorH = vFacade.x; float topY = vFacade.y; float seed = vFacade.z; float baseY = vFacade.w;
float x = vFUV.x; float y = vFUV.y + baseY;
float fl = floor(y / floorH);
float fy = y - fl * floorH;
float bay = floor(x / uBay.x);
float fx = fract(x / uBay.x);
float tl = dot(texel.rgb, vec3(0.333));
vec3 wallCol = uWall;
#ifdef USE_COLOR
  wallCol *= vColor.rgb;
#endif
vec3 col = uBrick > 0.5 ? texel.rgb * 1.05 : wallCol * (1.0 + (tl - 0.5) * (0.08 + 0.3 * uDirt));
fGlass = 0.0; fEmit = 0.0; fEmitCol = vec3(0.0); fFrame = 0.0;
bool parapet = y > topY - 0.02;
bool inTop = !parapet && y > topY - uTopBand;
bool inBase = y < uBase.x;
bool isGround = fl < 0.5;
float lit = step(1.0 - uGlassRM.z, fh2(vec2(bay * 3.1 + fl * 17.0, seed)));
vec3 warm = mix(vec3(1.0, 0.78, 0.48), vec3(0.85, 0.92, 1.0), step(0.6, fh2(vec2(fl, bay + seed * 3.0))));
// stone panel joints (running bond) + per-panel tone
if (uPanel.x > 0.0 && !parapet) {
  float row = floor(y / uPanel.y);
  vec2 pj = vec2(x / uPanel.x + mod(row, 2.0) * 0.5, y / uPanel.y);
  vec2 f = fract(pj);
  float j = max(step(f.x, 0.014 / uPanel.x), step(f.y, 0.018 / uPanel.y));
  col *= (0.975 + 0.045 * fh2(floor(pj) + seed)) * (1.0 - 0.09 * j);
}
// slab spandrel band
if (!parapet && fy < uBandH && fl > 0.5 && !inBase) col = mix(col, uBand * mix(0.9, 1.05, texel.g), 0.92);
// pilaster strips at bay boundaries
if (uPil.x > 0.0 && !inTop && !parapet) {
  float grp = uBay.x * uPil.x;
  float gx = fract(x / grp) * grp;
  if (gx < uPil.y) col = wallCol * mix(0.97, 1.1, tl) * 1.05;
  else if (gx < uPil.y + 0.07) col *= 0.72;
}
// dark fascia bands at every Nth slab
bool fascia = uFascia.x > 0.0 && !parapet && !inBase && fl > 0.5 && mod(fl, uFascia.x) < 0.5 && fy < uFascia.y;
if (fascia) { col = uFasciaCol * mix(0.9, 1.06, tl); fFrame = 0.7; }
// parapet + top band
if (parapet) col = uTop * mix(0.9, 1.04, texel.g);
else if (inTop && uModes.w < 0.5) col = uTop * mix(0.88, 1.04, texel.g);
// ---- window layout ----
float x0 = 0.5 - uBay.y * 0.5; float x1 = 0.5 + uBay.y * 0.5;
float sill = uBay.z; float wh = uBay.w;
bool curtainBay = fh2(vec2(floor(x / (uBay.x * 3.0)), seed * 1.7)) < uCurtain;
if (uRibbon.x > 0.5) { x0 = -0.01; x1 = 1.01; }
if (curtainBay) { sill = uBandH + 0.05; wh = floorH - uBandH - 0.1; x0 = -0.01; x1 = 1.01; }
if (isGround && uGroundGlass > 0.5) { sill = 0.35; wh = floorH - 0.8; x0 = 0.04; x1 = 0.96; }
bool inWin = fx > x0 && fx < x1 && fy > sill && fy < sill + wh && !inTop && !parapet && !fascia;
float wx = (fx - x0) / max(x1 - x0, 1e-3);
float wy = (fy - sill) / max(wh, 1e-3);
bool frame = false;
// base zone: 1 = dark full-height glazing (colonnade behind columns), 2 = stone base with punched windows
if (inBase && uBase.y > 0.5) {
  if (uBase.y < 1.5) {
    inWin = false;
    float mx = fract(x / 1.5);
    bool mullion = mx < 0.05 || abs(y - 4.5) < 0.06 || y < 0.25;
    col = mullion ? uFrame * 0.9 : uBaseCol * mix(0.8, 1.15, fh2(vec2(floor(x / 1.5), seed)));
    if (!mullion) { fGlass = 1.0; fEmit = step(0.35, fh2(vec2(floor(x / 6.0), seed))) * uNight * 0.8; fEmitCol = vec3(1.0, 0.86, 0.66); }
    else fFrame = 1.0;
  } else {
    col = uBaseCol * mix(0.86, 1.08, tl);
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
  else { col = uGlass * mix(0.8, 1.1, fh2(vec2(floor(x / 1.2), seed))); fGlass = 1.0; fEmit = lit * uNight * 0.7; fEmitCol = warm; }
}
// F-Block wings: continuous balcony bands (solid parapet + dark recessed corridor)
if (uModes.x > 0.5 && !inTop && !parapet) {
  inWin = false;
  if (!isGround || true) {
    if (fy < 1.1) { col = wallCol * mix(0.9, 1.05, tl) * (fy < 0.12 ? 0.8 : 1.0); }
    else if (fy > floorH - 0.28) { col = wallCol * 0.82; }
    else {
      float door = step(0.6, fract(x / 3.4)) * step(fy, 3.0);
      col = uBand * (0.85 + 0.25 * door) * (0.9 + 0.2 * fh2(vec2(floor(x / 3.4), fl + seed)));
      fEmit = lit * door * uNight * 0.8; fEmitCol = warm;
      col *= mix(0.6, 1.0, smoothstep(floorH - 0.28, floorH - 1.0, fy));
    }
  }
}
// F-Block tower: deep recessed window + beige vertical panel per bay
if (uModes.y > 0.5 && !inTop && !parapet && !inBase) {
  inWin = false;
  bool win = fx > 0.1 && fx < 0.46 && fy > 0.9 && fy < 2.5;
  bool pan = fx > 0.54 && fx < 0.9 && fy > 0.35 && fy < 3.15;
  if (win) {
    float edge = min(min(fx - 0.1, 0.46 - fx) * uBay.x, min(fy - 0.9, 2.5 - fy));
    col = mix(uGlass * 0.6, uGlass, smoothstep(0.0, 0.18, edge));
    col *= (fx - 0.1) * uBay.x < 0.16 || (2.5 - fy) < 0.16 ? 0.55 : 1.0;
    fGlass = 0.6; fEmit = lit * uNight; fEmitCol = warm;
  } else if (pan) {
    col = uBand * mix(0.9, 1.05, tl);
    if ((fx - 0.54) * uBay.x < 0.08 || (3.15 - fy) < 0.08) col *= 0.7;
  } else if ((fx > 0.46 && fx < 0.5 && fy > 0.9 && fy < 2.5) || (fy > 2.5 && fy < 2.6 && fx > 0.1 && fx < 0.46)) col *= 0.6;
}
// B-Block louvre vents in the wall between windows
if (uModes.z > 0.0 && !inWin && !inTop && !parapet && !inBase && fh2(vec2(bay * 1.7, fl * 3.3 + seed)) < uModes.z) {
  float lx = fx; float ly = fy - 1.55;
  if (abs(lx - 0.5) < 0.13 && ly > 0.0 && ly < 0.28) { col = mix(uWall * 0.55, uWall * 0.85, step(0.5, fract(ly * 21.0))); inWin = false; }
}
if (uJali > 0.5 && mod(bay, 4.0) == 1.0 && !isGround && !inTop) {
  vec2 jp = fract(vec2(x, y) * 2.5);
  float hole = step(0.25, length(jp - 0.5));
  col = mix(vec3(0.12, 0.28, 0.62), vec3(0.05, 0.08, 0.14), 1.0 - hole);
  inWin = false;
}
if (inBase && uBase.y > 1.5 && inWin && isGround) { inWin = inWin; }
if (inWin) {
  if (uRibbon.x > 0.5 && !curtainBay) {
    float mx = fract(x / uRibbon.y);
    frame = mx < 0.07 / uRibbon.y || wy < 0.04 || wy > 0.96;
  } else {
    float mcount = uMull + 1.0;
    float mull = abs(fract(wx * mcount) - 0.5) * 2.0;
    float frameW = 0.045;
    frame = wx < frameW * 0.5 || wx > 1.0 - frameW * 0.5 || wy < frameW || wy > 1.0 - frameW || mull > 1.0 - frameW * mcount;
    if (abs(wy - 0.78) < 0.02 && !curtainBay) frame = true;
  }
  if (frame) { col = uFrame; fFrame = 1.0; }
  else {
    float shade = fh2(vec2(bay + seed, fl * 5.3));
    vec3 g = uGlass * mix(0.78, 1.14, shade);
    float blinds = step(0.5, fract(wy * 14.0)) * step(0.76, shade) * 0.22;
    col = g * (1.0 - blinds);
    col *= mix(0.62, 1.0, smoothstep(0.0, 0.16, 1.0 - wy));
    fGlass = 1.0;
    fEmit = lit * uNight * (0.65 + 0.35 * sin(clamp(wx, 0.0, 1.0) * 3.14159));
    fEmitCol = warm * (0.8 + 0.4 * shade);
  }
} else if (!inTop && !parapet && !inBase && uModes.x < 0.5 && uModes.y < 0.5 && uRibbon.x < 0.5) {
  float above = fy - (uBay.z + uBay.w);
  if (fx > x0 - 0.04 && fx < x1 + 0.04 && above > 0.0 && above < 0.12) col *= 0.74;
}
// ground grime + rain streaks
col *= mix(1.0 - 0.2 * uDirt, 1.0, smoothstep(0.0, 0.7, y));
col *= 1.0 - 0.09 * uDirt * smoothstep(0.6, 1.0, fh2(vec2(floor(x * 1.3), seed))) * smoothstep(topY, 0.0, y) * (1.0 - fGlass);
diffuseColor.rgb = col;
`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
roughnessFactor = mix(roughnessFactor, uGlassRM.x, fGlass);
roughnessFactor = mix(roughnessFactor, 0.45, fFrame);`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = metalness;
metalnessFactor = mix(metalnessFactor, uGlassRM.y, fGlass);
metalnessFactor = mix(metalnessFactor, 0.4, fFrame);`)
      .replace('#include <normal_fragment_maps>', `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, texUV ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale * (1.0 - fGlass);
  normal = normalize( tbn * mapN );
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += fEmitCol * fEmit * 2.2;`);
  };
  mat.customProgramCacheKey = () => `facade3_${style}`;
  return mat;
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
  const [c, g] = canvas(64, 16);
  g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, 32, 16);
  g.fillStyle = '#ecebe6'; g.fillRect(32, 0, 32, 16);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(31, 0, 2, 16); g.fillRect(63, 0, 1, 16);
  const t = toTex(c, { aniso: 4 });
  t.magFilter = THREE.NearestFilter;
  return t;
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
  const [asphalt, pavers, grass, soil, stone, plaster, concrete, bark, brick] = await Promise.all([
    assets.pbr('asphalt_02'),
    assets.pbr('patterned_concrete_pavers'),
    assets.pbr('leafy_grass'),
    assets.pbr('red_dirt_mud_01'),
    assets.pbr('stone_wall_04'),
    assets.pbr('painted_plaster_wall'),
    assets.pbr('concrete_floor_02'),
    assets.pbr('bark_brown_02'),
    assets.pbr('brick_wall_02'),
  ]);
  return { asphalt, pavers, grass, soil, stone, plaster, concrete, bark, brick };
}
export type WorldTextures = Awaited<ReturnType<typeof loadWorldTextures>>;
