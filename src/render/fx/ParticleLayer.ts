import * as THREE from 'three';

/**
 * GPU-animated particle layer: one instanced camera-facing quad per particle, ONE draw call per layer.
 * Motion (drag + gravity, analytic), size/alpha/colour over life, rotation and the floor clamp are all evaluated
 * in the vertex shader from the spawn state, so the CPU only uploads the handful of slots written this frame
 * (ring buffer, FIFO overwrite when full). No per-frame work proportional to the particle count.
 */

/** Particle render modes (packed into aE.z together with the atlas tile). */
export const PMode = {
  /** camera-facing sprite, rotating */
  BILLBOARD: 0,
  /** ribbon from p - v*stretch to p (sparks, droplets) */
  STRETCH: 1,
  /** travelling streak along aB (tracers) */
  TRACER: 2,
  /** static axial ribbon from p to p + aB (muzzle flame tongues) */
  AXIAL: 3,
} as const;

/** Mutable spawn description; reuse one instance (zero allocations per spawn). */
export class PSpec {
  px = 0; py = 0; pz = 0;
  vx = 0; vy = 0; vz = 0;
  life = 1;
  size0 = 0.1; size1 = 0.1;
  rot = 0; spin = 0;
  r = 1; g = 1; b = 1; a = 1;
  gravity = 0; drag = 0;
  tile = 0; mode: number = PMode.BILLBOARD;
  /** STRETCH: seconds of motion blur; TRACER: streak length (m) */
  stretch = 0;
  fadeIn = 0; fadeOut = 0.6;
  /** 0..1: colour cools toward deep orange/red over life (sparks, fire) */
  heat = 0;
  /** TRACER: path length (m) */
  extra = 0;
  /** seconds before the particle appears */
  delay = 0;
  /** floor under this particle (world y) for the floor clamp and ground fade: the higher of this and the layer's
   * ground. Lets effects on a raised plateau or an upper storey rest on it instead of the campus ground (not TRACER) */
  floor = 0;

  reset(): this {
    this.px = this.py = this.pz = 0;
    this.vx = this.vy = this.vz = 0;
    this.life = 1; this.size0 = this.size1 = 0.1; this.rot = this.spin = 0;
    this.r = this.g = this.b = this.a = 1;
    this.gravity = this.drag = 0; this.tile = 0; this.mode = PMode.BILLBOARD; this.stretch = 0;
    this.fadeIn = 0; this.fadeOut = 0.6; this.heat = 0; this.extra = 0; this.delay = 0; this.floor = 0;
    return this;
  }
}

const STRIDE = 24;

const vert = /* glsl */ `
attribute vec4 aA; // spawn pos xyz, spawn time
attribute vec4 aB; // velocity xyz (axis for AXIAL), life
attribute vec4 aC; // size0, size1, rot0, spin
attribute vec4 aD; // rgb (HDR), alpha
attribute vec4 aE; // gravity, drag, tile + 16*mode, stretch
attribute vec4 aF; // fadeIn, fadeOut, heat, extra (TRACER) / floor (other modes)
uniform float uTime;
uniform float uGround;
uniform float uPixel;
uniform float uGrid;
#ifdef ADDITIVE
uniform float uBoost;
#else
uniform vec3 uAmbient;
uniform vec3 uFlashPos;
uniform vec3 uFlashCol;
#endif
varying vec2 vUv;
varying vec2 vQ;
varying vec4 vCol;
varying float vStreak;
varying vec2 vGround; // world y of this vertex, fade height (cheap 'soft particle' against the ground plane)
#include <fog_pars_vertex>

void main() {
  float age = uTime - aA.w;
  float life = aB.w;
  float t = age / life;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float mode = floor(aE.z / 16.0 + 0.001);
  float tile = aE.z - mode * 16.0;
  float k = aE.y;
  vec3 g = vec3(0.0, -aE.x, 0.0);
  float e = exp(-k * age);
  float dragInt = k > 1e-4 ? (1.0 - e) / k : age;
  vec3 p; vec3 v;
  if (k > 1e-4) {
    vec3 vt = g / k;
    p = aA.xyz + (aB.xyz - vt) * dragInt + vt * age;
    v = (aB.xyz - vt) * e + vt;
  } else {
    p = aA.xyz + aB.xyz * age + 0.5 * g * age * age;
    v = aB.xyz + g * age;
  }
  float te = 1.0 - (1.0 - t) * (1.0 - t);
  float size = mix(aC.x, aC.y, te);
  // this particle's floor (aF.w holds the tracer length in TRACER mode)
  float gy = (mode > 1.5 && mode < 2.5) ? uGround : max(uGround, aF.w);
  if (aE.x > 0.0 && mode < 1.5) {
    float fy = gy + size * 0.3;
    if (p.y < fy) { p.y = fy; v.y = 0.0; }
  }

  float alpha = aD.a;
  if (aF.x > 0.0) alpha *= smoothstep(0.0, aF.x, t);
  alpha *= 1.0 - smoothstep(aF.y, 1.0, t);
  vec3 col = aD.rgb * mix(vec3(1.0), vec3(1.0, 0.3, 0.07), clamp(t * aF.z, 0.0, 1.0));

  vec2 q = position.xy + 0.5;
  vec3 mv;
  vStreak = 0.0;
  // the fragment stage fades against uGround: shift heights so that fade happens at this particle's floor instead
  float gShift = gy - uGround;
  vGround = vec2(p.y - gShift, 0.0);
  if (mode < 0.5) {
    float rot = aC.z + aC.w * dragInt;
    float c = cos(rot), s = sin(rot);
    vec2 off = mat2(c, s, -s, c) * position.xy * size;
    mv = (viewMatrix * vec4(p, 1.0)).xyz;
    mv.xy += off;
    // world-space height of this corner (camera right/up are the rows of the view matrix)
    vGround = vec2(p.y - gShift + viewMatrix[1][0] * off.x + viewMatrix[1][1] * off.y, size > 0.12 ? min(size * 0.3, 0.35) : 0.0);
  } else {
    vec3 A; vec3 B; float caps = 1.0;
    if (mode < 1.5) {
      A = p - v * aE.w; B = p; vStreak = 1.0;
    } else if (mode < 2.5) {
      float spd = length(aB.xyz);
      vec3 dir = aB.xyz / max(spd, 1e-4);
      // streak starts fully extended at the muzzle, head travels to the target, tail catches up
      float dh = min(spd * age + aE.w, aF.w);
      float dt = min(spd * age, aF.w);
      A = aA.xyz + dir * dt; B = aA.xyz + dir * dh; vStreak = 1.0;
    } else {
      A = aA.xyz; B = aA.xyz + aB.xyz * (size / max(aC.x, 1e-4)); caps = 0.0;
    }
    vec3 a = (viewMatrix * vec4(A, 1.0)).xyz;
    vec3 b = (viewMatrix * vec4(B, 1.0)).xyz;
    vec3 mid = 0.5 * (a + b);
    vec3 toCam = normalize(-mid);
    vec3 d = b - a;
    vec3 dp = d - toCam * dot(d, toCam);
    float L = length(dp);
    vec3 along = L > 1e-5 ? dp / L : normalize(cross(toCam, vec3(0.0001, 1.0, 0.0)));
    vec3 side = normalize(cross(along, toCam));
    float w = size;
    // keep thin streaks at >= ~1.4 px wide and trade the extra width for alpha (no shimmer, no vanishing)
    float wMin = uPixel * max(-mid.z, 0.05) * 1.4;
    if (caps > 0.5 && w < wMin) { alpha *= w / wMin; w = wMin; }
    mv = mix(a, b, q.y) + along * (caps * w * 0.5 * (2.0 * q.y - 1.0)) + side * (position.x * w);
  }

#ifdef ADDITIVE
  col *= uBoost;
#else
  vec3 lv = uFlashPos - p;
  col *= uAmbient + uFlashCol / (1.0 + dot(lv, lv) * 1.5);
#endif

  vec2 cell = vec2(mod(tile, uGrid), floor(tile / uGrid));
  vUv = (cell + q) / uGrid;
  vQ = q;
  vCol = vec4(col, alpha);
  vec4 mvPosition = vec4(mv, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec2 vQ;
varying vec4 vCol;
varying float vStreak;
varying vec2 vGround;
uniform float uGround;
#include <fog_pars_fragment>

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vCol.a;
  // streaks: bright head, fading tail
  a *= mix(1.0, mix(0.15, 1.0, vQ.y), vStreak);
  if (vGround.y > 0.0) a *= smoothstep(uGround, uGround + vGround.y, vGround.x);
  vec3 rgb = vCol.rgb * tex.rgb;
#ifdef USE_FOG
  #ifdef FOG_EXP2
  float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
#ifdef ADDITIVE
  rgb *= a;
  #ifdef USE_FOG
  rgb *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(rgb, 0.0);
#else
  #ifdef USE_FOG
  rgb = mix(rgb, fogColor, fogFactor);
  #endif
  gl_FragColor = vec4(rgb * a, a);
#endif
}
`;

export interface SharedParticleUniforms {
  uTime: { value: number };
  uGround: { value: number };
  uPixel: { value: number };
  uGrid: { value: number };
  uBoost: { value: number };
  uAmbient: { value: THREE.Color };
  uFlashPos: { value: THREE.Vector3 };
  uFlashCol: { value: THREE.Color };
}

const _vp = new THREE.Vector4();

export class ParticleLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
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

  constructor(capacity: number, map: THREE.Texture, shared: SharedParticleUniforms, additive: boolean) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    // everything starts dead: spawn time far in the future
    for (let i = 0; i < capacity; i++) { this.data[i * STRIDE + 3] = 1e9; this.data[i * STRIDE + 7] = 1; }
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    const names = ['aA', 'aB', 'aC', 'aD', 'aE', 'aF'];
    for (let i = 0; i < names.length; i++) geo.setAttribute(names[i], new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4));
    geo.instanceCount = 0;

    const uniforms: Record<string, THREE.IUniform> = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uMap: { value: map },
      uTime: shared.uTime,
      uGround: shared.uGround,
      uPixel: shared.uPixel,
      uGrid: shared.uGrid,
    };
    if (additive) uniforms.uBoost = shared.uBoost;
    else Object.assign(uniforms, { uAmbient: shared.uAmbient, uFlashPos: shared.uFlashPos, uFlashCol: shared.uFlashCol });

    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms,
      defines: additive ? { ADDITIVE: '' } : {},
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: additive ? THREE.ZeroFactor : THREE.OneFactor,
      blendDstAlpha: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = additive ? 'fx-particles-add' : 'fx-particles-alpha';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
    this.mesh.visible = false;
    // N8AO: don't re-render these in its transparency passes (saves 2 draws/layer/frame)
    this.mesh.userData.treatAsOpaque = true;
    const pix = shared.uPixel;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(_vp);
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera && _vp.w > 0) pix.value = (2 * Math.tan(THREE.MathUtils.DEG2RAD * cam.fov * 0.5)) / (cam.zoom * _vp.w);
    };
  }

  /** Write one particle. The time slot temporarily stores the delay; `flush` turns it into an absolute time. */
  emit(s: PSpec): void {
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    if (i + 1 > this.highWater) this.highWater = i + 1;
    if (this.dirtyCount === 0) this.dirtyStart = i;
    if (this.dirtyCount < this.capacity) this.dirtyCount++;
    const d = this.data;
    const o = i * STRIDE;
    d[o] = s.px; d[o + 1] = s.py; d[o + 2] = s.pz; d[o + 3] = s.delay;
    d[o + 4] = s.vx; d[o + 5] = s.vy; d[o + 6] = s.vz; d[o + 7] = Math.max(1e-3, s.life);
    d[o + 8] = s.size0; d[o + 9] = s.size1; d[o + 10] = s.rot; d[o + 11] = s.spin;
    d[o + 12] = s.r; d[o + 13] = s.g; d[o + 14] = s.b; d[o + 15] = s.a;
    d[o + 16] = s.gravity; d[o + 17] = s.drag; d[o + 18] = s.tile + 16 * s.mode; d[o + 19] = s.stretch;
    d[o + 20] = s.fadeIn; d[o + 21] = s.fadeOut; d[o + 22] = s.heat; d[o + 23] = s.mode === PMode.TRACER ? s.extra : s.floor;
  }

  /** Stamp spawn times for this frame's particles and queue the minimal GPU upload. */
  flush(time: number): void {
    const n = this.dirtyCount;
    if (n > 0) {
      const d = this.data;
      const cap = this.capacity;
      let idx = this.dirtyStart;
      for (let c = 0; c < n; c++) {
        const o = idx * STRIDE;
        d[o + 3] += time;
        const end = d[o + 3] + d[o + 7];
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

  /** Live particle count (CPU scan, for debug readouts only). */
  countLive(time: number): number {
    let n = 0;
    const d = this.data;
    for (let i = 0; i < this.highWater; i++) {
      const o = i * STRIDE;
      const age = time - d[o + 3];
      if (age >= -1e-4 && age < d[o + 7]) n++; // epsilon: spawn times are stored as float32
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
