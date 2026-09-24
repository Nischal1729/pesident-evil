import * as THREE from 'three';
import { GRID } from './textures';

/**
 * Instanced surface decals (bullet holes, blood splats, pools, scorch marks): ONE draw call.
 * Each decal is a quad oriented to the surface normal, built in the vertex shader from a compact per-instance
 * record (pos, normal, rotation, size, tile, timing, tint, roughness). Growth (splats landing, pools spreading)
 * and fade-out are animated on the GPU; the CPU only writes a record on spawn. Lit by the standard PBR path
 * (sun, hemi, env map, the muzzle-flash light, shadows) via a patched MeshStandardMaterial.
 * FIFO recycling when full.
 */

/** Mutable decal description; reuse one instance. */
export class DSpec {
  px = 0; py = 0; pz = 0;
  nx = 0; ny = 1; nz = 0;
  rot = 0;
  size = 0.1;
  tile = 0;
  life = 30;
  r = 1; g = 1; b = 1;
  rough = 0.9;
  delay = 0;
  /** seconds to reach full size */
  grow = 0.05;
  /** initial scale fraction (0..1) */
  start = 0.5;
  /** fade-out duration at end of life */
  fade = 3;
  opacity = 1;

  reset(): this {
    this.px = this.py = this.pz = 0; this.nx = 0; this.ny = 1; this.nz = 0;
    this.rot = 0; this.size = 0.1; this.tile = 0; this.life = 30;
    this.r = this.g = this.b = 1; this.rough = 0.9; this.delay = 0; this.grow = 0.05; this.start = 0.5; this.fade = 3; this.opacity = 1;
    return this;
  }
}

const STRIDE = 20;

export class DecalLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  readonly capacity: number;
  private data: Float32Array;
  private buffer: THREE.InstancedInterleavedBuffer;
  private head = 0;
  private highWater = 0;
  private dirtyStart = 0;
  private dirtyCount = 0;
  private maxEnd = -1;
  private fullUpload = false;
  // preallocated update-range records pushed straight into buffer.updateRanges (three clears the array after upload)
  private r0 = { start: 0, count: 0 };
  private r1 = { start: 0, count: 0 };
  readonly uTime: { value: number };

  constructor(capacity: number, map: THREE.Texture, uTime: { value: number }) {
    this.capacity = capacity;
    this.uTime = uTime;
    this.data = new Float32Array(capacity * STRIDE);
    for (let i = 0; i < capacity; i++) { this.data[i * STRIDE + 3] = 1e9; this.data[i * STRIDE + 11] = 1; }
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const names = ['dA', 'dB', 'dC', 'dD', 'dE'];
    for (let i = 0; i < names.length; i++) geo.setAttribute(names[i], new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4));
    geo.instanceCount = 0;

    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness: 1,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      envMapIntensity: 0.8,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFxTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 dA; // pos, t0
attribute vec4 dB; // normal, rotation
attribute vec4 dC; // size, grow, tile, life
attribute vec4 dD; // tint rgb, roughness
attribute vec4 dE; // start scale, fade dur, opacity, -
uniform float uFxTime;
varying vec3 vDTint;
varying float vDRough;
varying float vDFade;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
float dAge = uFxTime - dA.w;
float dAlive = step(0.0, dAge) * step(dAge, dC.w);
float dG = clamp(dAge / max(dC.y, 1e-3), 0.0, 1.0);
dG = 1.0 - (1.0 - dG) * (1.0 - dG) * (1.0 - dG);
float dScale = dC.x * mix(dE.x, 1.0, dG) * dAlive;
vec3 dN = normalize(dB.xyz);
vec3 dUp = abs(dN.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
vec3 dT = normalize(cross(dUp, dN));
vec3 dBt = cross(dN, dT);
float dCo = cos(dB.w), dSi = sin(dB.w);
vec3 dX = dT * dCo + dBt * dSi;
vec3 dY = -dT * dSi + dBt * dCo;
float dTile = dC.z;
vec2 dCell = vec2(mod(dTile, ${GRID.toFixed(1)}), floor(dTile / ${GRID.toFixed(1)}));
#ifdef USE_MAP
vMapUv = (dCell + uv) / ${GRID.toFixed(1)};
#endif
vDTint = dD.rgb;
vDRough = dD.w;
vDFade = (1.0 - smoothstep(dC.w - dE.y, dC.w, dAge)) * dE.z;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = dN;')
        .replace('#include <begin_vertex>', 'vec3 transformed = dA.xyz + (dX * position.x + dY * position.y) * dScale + dN * 0.005;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vDTint;
varying float vDRough;
varying float vDFade;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb *= vDTint;
diffuseColor.a *= vDFade;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vDRough;');
    };
    mat.customProgramCacheKey = () => 'fx-decal-v1';

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'fx-decals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    this.mesh.userData.treatAsOpaque = true;
  }

  emit(s: DSpec): void {
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    if (i + 1 > this.highWater) this.highWater = i + 1;
    if (this.dirtyCount === 0) this.dirtyStart = i;
    if (this.dirtyCount < this.capacity) this.dirtyCount++;
    const d = this.data;
    const o = i * STRIDE;
    d[o] = s.px; d[o + 1] = s.py; d[o + 2] = s.pz; d[o + 3] = s.delay;
    d[o + 4] = s.nx; d[o + 5] = s.ny; d[o + 6] = s.nz; d[o + 7] = s.rot;
    d[o + 8] = s.size; d[o + 9] = s.grow; d[o + 10] = s.tile; d[o + 11] = s.life;
    d[o + 12] = s.r; d[o + 13] = s.g; d[o + 14] = s.b; d[o + 15] = s.rough;
    d[o + 16] = s.start; d[o + 17] = Math.min(s.fade, s.life); d[o + 18] = s.opacity; d[o + 19] = 0;
  }

  flush(time: number): void {
    const n = this.dirtyCount;
    if (n > 0) {
      const d = this.data;
      const cap = this.capacity;
      let idx = this.dirtyStart;
      for (let c = 0; c < n; c++) {
        const o = idx * STRIDE;
        d[o + 3] += time;
        const end = d[o + 3] + d[o + 11];
        if (end > this.maxEnd) this.maxEnd = end;
        idx = idx + 1 === cap ? 0 : idx + 1;
      }
      const start = this.dirtyStart;
      const ranges = this.buffer.updateRanges;
      // ranges still pending means no render consumed last frame's upload: send the whole buffer instead
      if (this.fullUpload || ranges.length > 0) this.buffer.clearUpdateRanges();
      else if (start + n <= cap) {
        this.r0.start = start * STRIDE; this.r0.count = n * STRIDE;
        ranges.push(this.r0);
      } else {
        this.r0.start = start * STRIDE; this.r0.count = (cap - start) * STRIDE;
        this.r1.start = 0; this.r1.count = (start + n - cap) * STRIDE;
        ranges.push(this.r0, this.r1);
      }
      this.buffer.needsUpdate = true;
      this.dirtyCount = 0;
      this.mesh.geometry.instanceCount = this.highWater;
    } else if (this.fullUpload) {
      this.buffer.clearUpdateRanges();
      this.buffer.needsUpdate = true;
    }
    this.fullUpload = false;
    this.mesh.visible = time < this.maxEnd;
  }

  countLive(time: number): number {
    let n = 0;
    const d = this.data;
    for (let i = 0; i < this.highWater; i++) {
      const o = i * STRIDE;
      const age = time - d[o + 3];
      if (age >= -1e-4 && age < d[o + 11]) n++; // epsilon: spawn times are stored as float32
    }
    return n;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.data[i * STRIDE + 3] = 1e9;
    this.fullUpload = true;
    this.dirtyCount = 0;
    this.maxEnd = -1;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
