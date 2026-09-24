import * as THREE from 'three';
import { worldUniforms, type PBRSet } from '../materials';
import { foliageTextures } from './atlas';

/**
 * Lawn material: ambientCG Grass005 (mown Bermuda-style turf, CC0) with
 *   - anti-tiling: a second, rotated and scaled sample blended in by world-space noise,
 *   - macro variation: lusher / drier patches and fine mottling,
 *   - faint mowing stripes.
 * Starts on the supplied fallback set (already loaded) and switches to the turf texture when it arrives.
 */
const LAWN_NOISE = /* glsl */ `
float lawnH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lawnN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lawnH(i), lawnH(i + vec2(1, 0)), f.x), mix(lawnH(i + vec2(0, 1)), lawnH(i + vec2(1, 1)), f.x), f.y); }
float lawnF(vec2 p) { return lawnN(p) * 0.55 + lawnN(p * 2.3 + 7.1) * 0.3 + lawnN(p * 5.1 + 3.3) * 0.15; }`;
const FALLBACK_TINT = new THREE.Color(0xb3c48f);
const LAWN_TINT = new THREE.Color(0.93, 0.95, 0.9);

export function lawnMaterial(fallback: PBRSet): THREE.MeshStandardMaterial {
  const tex = foliageTextures();
  const useLawn = tex.lawnLoaded || !fallback.map;
  const m = new THREE.MeshStandardMaterial({
    map: useLawn ? tex.lawn : fallback.map,
    normalMap: useLawn ? tex.lawnN : fallback.normalMap,
    color: useLawn ? LAWN_TINT : FALLBACK_TINT,
    roughness: 0.96,
    metalness: 0,
  });
  m.normalScale.set(0.75, 0.75);
  if (!useLawn) tex.lawnReady.then(() => { m.map = tex.lawn; m.normalMap = tex.lawnN; m.color.copy(LAWN_TINT); m.needsUpdate = true; });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer); // world lighting (street lamps / wet) from materials.ts
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLawnW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLawnW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
varying vec3 vLawnW;
${LAWN_NOISE}`)
      .replace('#include <map_fragment>', /* glsl */ `
#ifdef USE_MAP
{
  vec4 cA = texture2D( map, vMapUv );
  vec2 uvB = mat2( 0.8, -0.6, 0.6, 0.8 ) * vMapUv * 0.47 + vec2( 0.37, 0.61 );
  vec4 cB = texture2D( map, uvB );
  vec2 w = vLawnW.xz;
  vec4 s = mix( cA, cB, smoothstep( 0.3, 0.7, lawnF( w * 0.09 ) ) );
  float n1 = lawnF( w * 0.035 + 11.0 );
  vec3 lush = vec3( 0.8, 0.94, 0.78 ), dry = vec3( 1.16, 1.05, 0.7 );
  s.rgb *= mix( lush, dry, smoothstep( 0.3, 0.85, n1 ) );
  s.rgb *= 0.86 + 0.28 * lawnF( w * 0.012 + 3.0 );
  s.rgb *= 0.9 + 0.2 * lawnN( w * 0.6 );
  s.rgb = mix( vec3( dot( s.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), s.rgb, 0.8 );
  float stripe = step( 0.5, fract( dot( w, vec2( 0.8, 0.6 ) ) / 3.4 ) );
  s.rgb *= 1.0 + ( stripe - 0.5 ) * 0.07;
  diffuseColor *= s;
}
#endif`);
  };
  const pk = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${pk()}|lawn`;
  return m;
}

/**
 * Short instanced grass tufts that follow the camera (high / ultra only): a fixed field of crossed cards in a T×T
 * tile is wrapped around the camera in the vertex shader, masked to the lawn polygons with a coverage texture and
 * faded out by distance, so it costs one draw call and no per-frame CPU work.
 */
export function lawnBlades(lawnPolys: [number, number][][], opts: { radius?: number; count?: number; paths?: { pts: [number, number][]; width: number }[] } = {}): THREE.InstancedMesh | null {
  if (!lawnPolys.length) return null;
  const R = opts.radius ?? 15;
  const T = R * 2;
  const N = opts.count ?? 5000;
  // lawn coverage mask
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of lawnPolys) for (const [x, z] of p) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
  minX -= 2; minZ -= 2; maxX += 2; maxZ += 2;
  const res = 0.5;
  const W = Math.min(2048, Math.ceil((maxX - minX) / res)), H = Math.min(2048, Math.ceil((maxZ - minZ) / res));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  for (const p of lawnPolys) {
    g.beginPath();
    p.forEach(([x, z], i) => { const px = ((x - minX) / (maxX - minX)) * W, py = ((z - minZ) / (maxZ - minZ)) * H; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath(); g.fill();
  }
  // keep paths that cross the lawns clear
  g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const p of opts.paths ?? []) {
    g.lineWidth = ((p.width + 0.5) / (maxX - minX)) * W;
    g.beginPath();
    p.pts.forEach(([x, z], i) => { const px = ((x - minX) / (maxX - minX)) * W, py = ((z - minZ) / (maxZ - minZ)) * H; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.stroke();
  }
  const mask = new THREE.CanvasTexture(c);
  mask.flipY = false;
  mask.colorSpace = THREE.NoColorSpace;
  mask.generateMipmaps = false;
  mask.minFilter = THREE.LinearFilter;
  // one clump = several thin single-triangle blades (opaque, vertex-coloured to match the turf)
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], wnd: number[] = [], idx: number[] = [];
  let sd = 777;
  const rr = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const base = [0.1, 0.16, 0.032], tip = [0.25, 0.33, 0.085];
  for (let k = 0; k < 7; k++) {
    const a = rr() * Math.PI * 2, rad = Math.sqrt(rr()) * 0.2;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const ba = rr() * Math.PI, bw = 0.012 + rr() * 0.01, h = 0.06 + rr() * 0.07;
    const lx = (rr() - 0.5) * 0.06, lz = (rr() - 0.5) * 0.06;
    const dx = Math.cos(ba) * bw, dz = Math.sin(ba) * bw;
    const o = pos.length / 3;
    pos.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + lx, h, z + lz);
    const n = [lx * 3, 1, lz * 3];
    const l = Math.hypot(n[0], n[1], n[2]);
    for (let i = 0; i < 3; i++) nrm.push(n[0] / l, n[1] / l, n[2] / l);
    const j = 0.85 + rr() * 0.3;
    col.push(base[0] * j, base[1] * j, base[2] * j, base[0] * j, base[1] * j, base[2] * j, tip[0] * j, tip[1] * j, tip[2] * j);
    wnd.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, rr());
    idx.push(o, o + 1, o + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('wind', new THREE.Float32BufferAttribute(wnd, 4));
  geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.88, metalness: 0 });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, {
      uMask: { value: mask }, uMaskMin: { value: new THREE.Vector2(minX, minZ) }, uMaskSize: { value: new THREE.Vector2(maxX - minX, maxZ - minZ) },
      uTile: { value: T }, uR: { value: R }, uTime: worldUniforms.uTime, uWind: worldUniforms.uWind,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 wind;
uniform sampler2D uMask; uniform vec2 uMaskMin; uniform vec2 uMaskSize; uniform float uTile; uniform float uR; uniform float uTime; uniform float uWind;
varying float vBladeFade;`)
      .replace('#include <begin_vertex>', /* glsl */ `
vec3 bIp = instanceMatrix[3].xyz;
vec2 bCam = cameraPosition.xz;
vec2 bWp = bCam + mod(bIp.xz - bCam + 0.5 * uTile, uTile) - 0.5 * uTile;
float bD = length(bWp - bCam);
float bM = texture2D(uMask, (bWp - uMaskMin) / uMaskSize).r;
float bS = (1.0 - smoothstep(uR * 0.55, uR, bD)) * smoothstep(0.45, 0.75, bM);
vBladeFade = bS;
mat3 bRot = mat3(instanceMatrix);
vec3 transformed = bRot * position * vec3(mix(0.6, 1.0, bS), bS, mix(0.6, 1.0, bS)) * step(0.01, bS);
float bF = sin(uTime * 3.1 + bWp.x * 1.7 + bWp.y * 2.3 + wind.w * 6.0) * wind.z * 0.015 * uWind;
transformed.x += bF; transformed.z += bF * 0.6;
transformed += vec3(bWp.x, 0.03, bWp.y);`)
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4( transformed, 1.0 );\ngl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4( transformed, 1.0 );');
    shader.vertexShader = shader.vertexShader
      .replace('varying float vBladeFade;', 'varying float vBladeFade; varying vec2 vBladeW;')
      .replace('vBladeFade = bS;', 'vBladeFade = bS; vBladeW = bWp;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vBladeFade; varying vec2 vBladeW;\n${LAWN_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ vec2 w = vBladeW;
  float n1 = lawnF( w * 0.035 + 11.0 );
  diffuseColor.rgb *= mix( vec3( 0.8, 0.94, 0.78 ), vec3( 1.16, 1.05, 0.7 ), smoothstep( 0.3, 0.85, n1 ) );
  diffuseColor.rgb *= 0.86 + 0.28 * lawnF( w * 0.012 + 3.0 ); }`);
  };
  const pk = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${pk()}|lawnBlades`;
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const side = Math.ceil(Math.sqrt(N));
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < N; i++) {
    const gx = (i % side + rnd()) / side * T, gz = (Math.floor(i / side) + rnd()) / side * T;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    const sc = 0.8 + rnd() * 0.5;
    s.set(sc, 0.75 + rnd() * 0.5, sc);
    m.compose(new THREE.Vector3(gx, 0, gz), q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'lawn:blades';
  return mesh;
}
