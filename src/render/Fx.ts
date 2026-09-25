import * as THREE from 'three';
import type { SurfaceKind } from '../core/Events';
import type { QualityProfile } from '../core/Settings';
import { ParticleLayer, PSpec, PMode, type SharedParticleUniforms } from './fx/ParticleLayer';
import { DecalLayer, DSpec } from './fx/DecalLayer';
import { makeDecalAtlas, makeParticleAtlas, PT, DT } from './fx/textures';

/**
 * Combat visual effects: muzzle flashes, tracers, impacts, blood, decals, shell casings, explosions.
 *
 * Rendering budget: at most 3 draw calls (alpha particles, additive particles, decals), each hidden when empty.
 * Particles are simulated on the GPU from their spawn state (see ParticleLayer); spawning writes a few floats
 * into a preallocated ring buffer and `update` uploads only the slots written that frame. One pooled PointLight
 * lives in the scene permanently (intensity 0 when idle) so the light count never changes (no shader recompiles).
 * No allocations in `update` or any spawn method.
 */

export type WeaponKind = 'pistol' | 'shotgun' | 'rifle' | 'smg';

interface FlashProfile { size: number; flame: number; prongs: number; smoke: number; smokeSize: number; light: number; sparks: number; casing: number }

const FLASH: Record<WeaponKind, FlashProfile> = {
  pistol: { size: 0.32, flame: 0.26, prongs: 2, smoke: 2, smokeSize: 0.32, light: 0.8, sparks: 0, casing: 0.028 },
  smg: { size: 0.38, flame: 0.34, prongs: 2, smoke: 2, smokeSize: 0.34, light: 0.85, sparks: 1, casing: 0.03 },
  rifle: { size: 0.5, flame: 0.55, prongs: 3, smoke: 3, smokeSize: 0.45, light: 1.1, sparks: 3, casing: 0.042 },
  shotgun: { size: 0.75, flame: 0.8, prongs: 4, smoke: 5, smokeSize: 0.7, light: 1.6, sparks: 9, casing: 0.055 },
};

// Tiered budgets, picked from QualityProfile.dynamicLights (2 low, 4 medium, 6 high, 8 ultra).
const PARTICLES = [600, 1200, 2000, 2800];
const DECALS = [60, 120, 200, 280];
const DETAIL = [0.6, 0.8, 1, 1.15];
const DECAL_LIFE = [20, 30, 45, 60];

// blood colours (linear). #5a0a0a ≈ (0.10, 0.003, 0.003), #8a1010 ≈ (0.25, 0.005, 0.005)
const BLOOD_MIST = [0.13, 0.006, 0.005];
const BLOOD_DROP = [0.15, 0.005, 0.005];
const BLOOD_DECAL = [0.2, 0.008, 0.007];
const BLOOD_POOL = [0.075, 0.004, 0.003];

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Height at time t under gravity g with linear drag k (matches the particle vertex shader). */
const dragY = (t: number, y0: number, vy: number, g: number, k: number) => {
  const vt = -g / k;
  return y0 + ((vy - vt) * (1 - Math.exp(-k * t))) / k + vt * t;
};
const chance = (p: number) => Math.random() < p;

export class Fx {
  /** World ground height used for blood drops/pools and the particle floor clamp. */
  groundY = 0.05;
  /** Master multiplier on spawn counts (debug / perf tuning). */
  detail: number;

  readonly light: THREE.PointLight;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private time = 0;
  private night = 0;
  private far = 1;
  private bloom: boolean;
  private tier: number;
  private decalLife: number;

  private alpha: ParticleLayer;
  private add: ParticleLayer;
  private decals: DecalLayer;
  private pTex: THREE.DataTexture;
  private dTex: THREE.DataTexture;
  private shared: SharedParticleUniforms;
  private p = new PSpec();
  private d = new DSpec();

  private lightT = 0;
  private lightDur = 0.05;
  private lightPeak = 0;
  private lightBase = new THREE.Color(1.0, 0.6, 0.3);

  constructor(scene: THREE.Scene, camera: THREE.Camera, quality: QualityProfile) {
    this.scene = scene;
    this.camera = camera;
    const dl = quality.dynamicLights;
    this.tier = dl <= 2 ? 0 : dl <= 4 ? 1 : dl <= 6 ? 2 : 3;
    this.detail = DETAIL[this.tier];
    this.decalLife = DECAL_LIFE[this.tier];
    this.bloom = quality.bloom;

    // one-off procedural generation at init (~20 ms for 512, ~50-70 ms for 1024 cold)
    this.pTex = makeParticleAtlas(this.tier >= 3 ? 1024 : 512);
    this.dTex = makeDecalAtlas(this.tier === 0 ? 512 : 1024);

    this.shared = {
      uTime: { value: 0 },
      uGround: { value: this.groundY },
      uPixel: { value: 0.001 },
      uGrid: { value: 4 },
      uBoost: { value: 1 },
      uAmbient: { value: new THREE.Color(1, 1, 1) },
      uFlashPos: { value: new THREE.Vector3(0, -1000, 0) },
      uFlashCol: { value: new THREE.Color(0, 0, 0) },
    };
    const cap = PARTICLES[this.tier];
    this.alpha = new ParticleLayer(Math.round(cap * 0.6), this.pTex, this.shared, false);
    this.add = new ParticleLayer(Math.round(cap * 0.4), this.pTex, this.shared, true);
    this.decals = new DecalLayer(DECALS[this.tier], this.dTex, this.shared.uTime);
    scene.add(this.decals.mesh, this.alpha.mesh, this.add.mesh);

    this.light = new THREE.PointLight(this.lightBase, 0, 16, 2);
    this.light.name = 'fx-muzzle-light';
    this.light.castShadow = false;
    this.light.position.set(0, -1000, 0);
    scene.add(this.light);
  }

  // ----------------------------------------------------------------------------------------------
  // public API
  // ----------------------------------------------------------------------------------------------

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponKind): void {
    const lod = this.lod(pos);
    const f = FLASH[weapon] ?? FLASH.rifle;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const p = this.p;
    if (lod > 0) {
      const sz = f.size * rand(0.85, 1.15);
      // smoke puffs first (alpha layer), drifting forward and up
      const ns = this.count(f.smoke, lod);
      for (let i = 0; i < ns; i++) {
        const k = rand(0.05, 0.35);
        p.reset();
        p.px = pos.x + dx * k; p.py = pos.y + dy * k; p.pz = pos.z + dz * k;
        const sp = rand(0.4, 1.6);
        p.vx = dx * sp + rand(-0.15, 0.15); p.vy = dy * sp + rand(0.1, 0.35); p.vz = dz * sp + rand(-0.15, 0.15);
        p.drag = 2.2; p.gravity = -0.12;
        p.life = rand(0.9, 1.7);
        p.size0 = f.smokeSize * 0.2; p.size1 = f.smokeSize * rand(0.8, 1.3);
        p.rot = rand(0, 6.28); p.spin = rand(-0.8, 0.8);
        const c = rand(0.55, 0.7);
        p.r = c; p.g = c; p.b = c * 0.97; p.a = rand(0.14, 0.24);
        p.tile = i % 2 === 0 ? PT.SMOKE_A : PT.SMOKE_C;
        p.fadeIn = 0.06; p.fadeOut = 0.35;
        this.alpha.emit(p);
      }
      // wide soft glow (drives bloom / fakes it on low)
      p.reset();
      p.px = pos.x + dx * sz * 0.3; p.py = pos.y + dy * sz * 0.3; p.pz = pos.z + dz * sz * 0.3;
      p.life = 0.06; p.size0 = sz * (this.bloom ? 2.2 : 3.2); p.size1 = p.size0 * 1.2;
      p.r = 1; p.g = 0.5; p.b = 0.18; p.a = this.bloom ? 0.55 : 0.45;
      p.tile = PT.SOFT; p.fadeOut = 0;
      this.add.emit(p);
      // flame tongues along the barrel (axial ribbons, always facing the camera around the barrel axis)
      for (let i = 0; i < f.prongs; i++) {
        this.cone(_v1, dir, i === 0 ? 0.05 : 0.32);
        const len = f.flame * (i === 0 ? rand(0.9, 1.2) : rand(0.45, 0.8));
        p.reset();
        p.px = pos.x - dx * 0.02; p.py = pos.y - dy * 0.02; p.pz = pos.z - dz * 0.02;
        p.vx = _v1.x * len; p.vy = _v1.y * len; p.vz = _v1.z * len;
        p.mode = PMode.AXIAL;
        p.life = rand(0.035, 0.05);
        p.size0 = len * rand(0.42, 0.55); p.size1 = p.size0 * 1.15;
        const I = rand(3, 4.5);
        p.r = I; p.g = I * 0.7; p.b = I * 0.42; p.a = 1;
        p.tile = i === 0 ? PT.FLAME_B : PT.FLAME_A;
        p.fadeOut = 0.35;
        this.add.emit(p);
      }
      // front star, random rotation
      p.reset();
      p.px = pos.x + dx * sz * 0.12; p.py = pos.y + dy * sz * 0.12; p.pz = pos.z + dz * sz * 0.12;
      p.life = rand(0.035, 0.05);
      p.size0 = sz; p.size1 = sz * 1.25;
      p.rot = rand(0, 6.28);
      const I = rand(3.4, 4.6);
      p.r = I; p.g = I * 0.78; p.b = I * 0.52; p.a = 1;
      p.tile = chance(0.5) ? PT.STAR_A : PT.STAR_B;
      p.fadeOut = 0.3;
      this.add.emit(p);
      // burning powder grains
      const ng = this.count(f.sparks, lod);
      for (let i = 0; i < ng; i++) {
        this.cone(_v1, dir, 0.25);
        const sp = rand(10, 26);
        p.reset();
        p.px = pos.x; p.py = pos.y; p.pz = pos.z;
        p.vx = _v1.x * sp; p.vy = _v1.y * sp; p.vz = _v1.z * sp;
        p.mode = PMode.STRETCH; p.stretch = 0.012;
        p.drag = 6; p.gravity = 2;
        p.life = rand(0.07, 0.16);
        p.size0 = p.size1 = rand(0.008, 0.014);
        p.r = 6; p.g = 3.6; p.b = 1.4; p.a = 1; p.heat = 0.8;
        p.fadeOut = 0.4;
        this.add.emit(p);
      }
    }
    // far-away flashes (> ~70 m) don't grab the single pooled light
    if (lod > 0.55) this.popLight(pos.x + dx * 0.35, pos.y + dy * 0.35, pos.z + dz * 0.35, 9 * f.light, 0.055, 1.0, 0.6, 0.28);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, strength = 1): void {
    _v1.subVectors(to, from);
    let dist = _v1.length();
    if (dist < 1.2 || this.lod(from) <= 0) return;
    _v1.multiplyScalar(1 / dist);
    // start a little in front of the muzzle so the streak doesn't overlap the flash
    const skip = Math.min(0.6, dist * 0.2);
    dist -= skip;
    const L = Math.min(dist, THREE.MathUtils.clamp(dist * 0.25, 1.5, 7));
    const speed = THREE.MathUtils.clamp(dist / 0.075, 200, 900);
    const p = this.p;
    p.reset();
    p.px = from.x + _v1.x * skip; p.py = from.y + _v1.y * skip; p.pz = from.z + _v1.z * skip;
    p.vx = _v1.x * speed; p.vy = _v1.y * speed; p.vz = _v1.z * speed;
    p.mode = PMode.TRACER; p.stretch = L; p.extra = dist;
    p.life = Math.max(0.035, dist / speed);
    p.size0 = p.size1 = 0.028;
    const I = 5.5 * strength;
    p.r = I; p.g = I * 0.78; p.b = I * 0.5; p.a = 1;
    p.tile = PT.SOFT; p.fadeOut = 0.85;
    this.add.emit(p);
    if (!this.bloom) {
      // no bloom on low: a faint wide halo stands in for it
      p.size0 = p.size1 = 0.09;
      p.r = I * 0.12; p.g = I * 0.09; p.b = I * 0.05;
      this.add.emit(p);
    }
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceKind): void {
    if (surface === 'flesh') { this.blood(point, normal, 0.6, false); return; }
    const lod = this.lod(point);
    if (lod <= 0) return;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    const bx = point.x + nx * 0.02, by = point.y + ny * 0.02, bz = point.z + nz * 0.02;
    const p = this.p;
    switch (surface) {
      case 'metal': {
        this.flashGlow(bx, by, bz, 0.3, 5, 1.0, 0.75, 0.45, 0.05);
        this.sparks(bx, by, bz, normal, this.count(12, lod), 3, 9, 1.2);
        this.dust(bx, by, bz, normal, this.count(1, lod), 0.45, 0.43, 0.4, 0.22, 0.35, 0.5);
        this.decal(point, normal, DT.HOLE_METAL, rand(0.13, 0.17), 1, 1, 1, 0.35);
        break;
      }
      case 'wood': {
        this.flashGlow(bx, by, bz, 0.14, 1.2, 1.0, 0.8, 0.55, 0.04);
        this.dust(bx, by, bz, normal, this.count(2, lod), 0.52, 0.42, 0.3, 0.35, 0.5 * this.far, 1.1);
        const n = this.count(7, lod);
        for (let i = 0; i < n; i++) {
          this.cone(_v1, normal, 0.9);
          const sp = rand(2, 5.5);
          p.reset();
          p.px = bx; p.py = by; p.pz = bz;
          p.vx = _v1.x * sp; p.vy = _v1.y * sp + 0.8; p.vz = _v1.z * sp;
          p.gravity = 9.8; p.drag = 1.2;
          p.life = rand(0.8, 1.4);
          p.size0 = p.size1 = rand(0.07, 0.14);
          p.rot = rand(0, 6.28); p.spin = rand(-25, 25);
          const c = rand(0.8, 1.05);
          p.r = 0.78 * c; p.g = 0.6 * c; p.b = 0.38 * c; p.a = 1;
          p.tile = PT.SPLINTER; p.fadeOut = 0.8;
          this.alpha.emit(p);
        }
        this.decal(point, normal, DT.HOLE_WOOD, rand(0.2, 0.25), 1, 1, 1, 0.8, rand(-0.15, 0.15));
        break;
      }
      case 'ground': {
        this.flashGlow(bx, by, bz, 0.12, 0.8, 1.0, 0.8, 0.55, 0.03);
        // dirt plume: fast up, heavy, drops back
        const np = this.count(5, lod);
        for (let i = 0; i < np; i++) {
          this.cone(_v1, normal, 0.3);
          const sp = rand(2.0, 4.2);
          p.reset();
          p.px = bx; p.py = by; p.pz = bz;
          p.vx = _v1.x * sp; p.vy = _v1.y * sp; p.vz = _v1.z * sp;
          p.gravity = 6; p.drag = 2.2;
          p.life = rand(0.5, 0.9);
          p.size0 = rand(0.1, 0.14) * this.far; p.size1 = rand(0.45, 0.7) * this.far;
          p.rot = rand(0, 6.28); p.spin = rand(-2, 2);
          const c = rand(0.8, 1.1);
          p.r = 0.16 * c; p.g = 0.11 * c; p.b = 0.07 * c; p.a = 0.9;
          p.tile = i % 2 ? PT.SMOKE_B : PT.CLUMP; p.fadeIn = 0.04; p.fadeOut = 0.4;
          this.alpha.emit(p);
        }
        this.debris(bx, by, bz, normal, this.count(9, lod), 0.14, 0.1, 0.07, 0.025, 0.055, 0.45, PT.CLUMP);
        this.dust(bx, by, bz, normal, this.count(2, lod), 0.34, 0.28, 0.21, 0.3, 0.8 * this.far, 0.9);
        this.decal(point, normal, DT.SCUFF, rand(0.3, 0.42), 1, 1, 1, 1);
        break;
      }
      default: { // concrete
        this.flashGlow(bx, by, bz, 0.16, 2.2, 1.0, 0.85, 0.6, 0.04);
        // quick jet along the normal, then a lingering cloud
        const nj = this.count(2, lod);
        for (let i = 0; i < nj; i++) {
          this.cone(_v1, normal, 0.2);
          const sp = rand(3, 5);
          p.reset();
          p.px = bx; p.py = by; p.pz = bz;
          p.vx = _v1.x * sp; p.vy = _v1.y * sp; p.vz = _v1.z * sp;
          p.drag = 7; p.gravity = -0.2;
          p.life = rand(0.35, 0.55);
          p.size0 = 0.05 * this.far; p.size1 = rand(0.25, 0.35) * this.far;
          p.rot = rand(0, 6.28);
          p.r = 0.6; p.g = 0.58; p.b = 0.54; p.a = 0.6;
          p.tile = PT.SMOKE_C; p.fadeOut = 0.3;
          this.alpha.emit(p);
        }
        this.dust(bx, by, bz, normal, this.count(3, lod), 0.6, 0.58, 0.54, 0.4, 1.0 * this.far, 1.7);
        this.debris(bx, by, bz, normal, this.count(6, lod), 0.34, 0.33, 0.31, 0.022, 0.045, 0.8, PT.CHIP);
        if (chance(0.35)) this.sparks(bx, by, bz, normal, 2, 2, 5, 0.6);
        this.decal(point, normal, chance(0.5) ? DT.HOLE_CONCRETE_A : DT.HOLE_CONCRETE_B, rand(0.24, 0.3), 1, 1, 1, 0.95);
        break;
      }
    }
  }

  blood(point: THREE.Vector3, dir: THREE.Vector3, amount = 1, headshot = false): void {
    const lod = this.lod(point);
    if (lod <= 0) return;
    _v2.copy(dir);
    if (_v2.lengthSq() < 1e-6) _v2.set(0, 0, 1);
    _v2.normalize();
    const amt = amount * (headshot ? 1.8 : 1);
    const p = this.p;
    const px = point.x, py = point.y, pz = point.z;
    // fast splash impression
    const nb = headshot ? 2 : 1;
    for (let i = 0; i < nb; i++) {
      p.reset();
      p.px = px + _v2.x * 0.04; p.py = py + _v2.y * 0.04; p.pz = pz + _v2.z * 0.04;
      p.vx = _v2.x * 1.2; p.vy = _v2.y * 1.2; p.vz = _v2.z * 1.2; p.drag = 8;
      p.life = rand(0.14, 0.2);
      p.size0 = 0.12 * Math.sqrt(amt); p.size1 = rand(0.45, 0.6) * Math.sqrt(amt);
      p.rot = rand(0, 6.28);
      p.r = BLOOD_MIST[0] * 0.8; p.g = BLOOD_MIST[1]; p.b = BLOOD_MIST[2]; p.a = 0.9;
      p.tile = PT.BURST; p.fadeOut = 0.4;
      this.alpha.emit(p);
    }
    // mist: dense dark core that disperses quickly
    const nm = this.count(6 * amt, lod);
    for (let i = 0; i < nm; i++) {
      this.cone(_v1, _v2, 0.6);
      const sp = rand(0.6, 3.0);
      p.reset();
      p.px = px; p.py = py; p.pz = pz;
      p.vx = _v1.x * sp; p.vy = _v1.y * sp + 0.15; p.vz = _v1.z * sp;
      p.drag = 6; p.gravity = 1.0;
      p.life = rand(0.35, 0.7) * (headshot ? 1.3 : 1);
      p.size0 = rand(0.06, 0.1); p.size1 = rand(0.35, 0.6) * (headshot ? 1.35 : 1);
      p.rot = rand(0, 6.28); p.spin = rand(-1.5, 1.5);
      const c = rand(0.8, 1.2);
      p.r = BLOOD_MIST[0] * c; p.g = BLOOD_MIST[1] * c; p.b = BLOOD_MIST[2] * c; p.a = rand(0.85, 1);
      p.tile = i % 3 === 0 ? PT.MIST : i % 3 === 1 ? PT.SMOKE_A : PT.SMOKE_C;
      p.fadeIn = 0.02; p.fadeOut = 0.15;
      this.alpha.emit(p);
    }
    // heavier spurts (round blobs) that arc down
    const ns = this.count(4 * amt, lod);
    for (let i = 0; i < ns; i++) {
      this.cone(_v1, _v2, 0.45);
      const sp = rand(1.4, 3.6);
      const vy = _v1.y * sp + rand(0.4, 1.2);
      p.reset();
      p.px = px; p.py = py; p.pz = pz;
      p.vx = _v1.x * sp; p.vy = vy; p.vz = _v1.z * sp;
      p.gravity = 9.8; p.drag = 0.6;
      p.life = Math.min(this.landTime(py, vy, 9.8, 0.6) + 0.02, 2);
      p.size0 = rand(0.03, 0.05); p.size1 = p.size0 * 0.7;
      p.rot = rand(0, 6.28);
      p.r = BLOOD_DROP[0]; p.g = BLOOD_DROP[1]; p.b = BLOOD_DROP[2]; p.a = 1;
      p.tile = PT.DROP; p.fadeOut = 0.97;
      this.alpha.emit(p);
    }
    // heavy droplets with gravity; some leave splats where they land
    const nd = this.count(10 * amt, lod);
    const g = 9.8, k = 0.35;
    let splats = headshot ? 3 : 2;
    for (let i = 0; i < nd; i++) {
      this.cone(_v1, _v2, 0.55);
      const sp = rand(1.8, 5.2);
      const vx = _v1.x * sp, vy = _v1.y * sp + rand(0.3, 1.4), vz = _v1.z * sp;
      const tl = this.landTime(py, vy, g, k);
      p.reset();
      p.px = px; p.py = py; p.pz = pz;
      p.vx = vx; p.vy = vy; p.vz = vz;
      p.gravity = g; p.drag = k;
      p.mode = PMode.STRETCH; p.stretch = 0.035;
      p.life = Math.min(tl + 0.02, 2);
      p.size0 = p.size1 = rand(0.012, 0.028);
      const c = rand(0.8, 1.2);
      p.r = BLOOD_DROP[0] * c; p.g = BLOOD_DROP[1] * c; p.b = BLOOD_DROP[2] * c; p.a = 1;
      p.tile = PT.DROP; p.fadeOut = 0.97;
      this.alpha.emit(p);
      if (splats > 0 && tl < 2 && chance(0.3 * this.detail)) {
        splats--;
        const h = (1 - Math.exp(-k * tl)) / k; // ∫ e^{-ks} ds: horizontal displacement factor
        _v3.set(px + vx * h, this.groundY, pz + vz * h);
        this.bloodDecal(_v3, chance(0.6) ? DT.DROP_A : chance(0.5) ? DT.DROP_B : DT.DROPS, rand(0.05, 0.13), tl, rand(0, 6.28));
      }
    }
    if (headshot) {
      // a few darker chunks
      const nc = this.count(5, lod);
      for (let i = 0; i < nc; i++) {
        this.cone(_v1, _v2, 0.6);
        const sp = rand(2, 4.5);
        p.reset();
        p.px = px; p.py = py; p.pz = pz;
        p.vx = _v1.x * sp; p.vy = _v1.y * sp + rand(0.5, 1.5); p.vz = _v1.z * sp;
        p.gravity = 9.8; p.drag = 0.5;
        p.life = rand(0.8, 1.2);
        p.size0 = p.size1 = rand(0.025, 0.045);
        p.rot = rand(0, 6.28); p.spin = rand(-12, 12);
        p.r = 0.1; p.g = 0.008; p.b = 0.006; p.a = 1;
        p.tile = PT.CLUMP; p.fadeOut = 0.85;
        this.alpha.emit(p);
      }
    }
    // directional spray on the ground behind the target
    if (chance(headshot ? 1 : Math.min(1, 0.65 * amount))) {
      let hx = _v2.x, hz = _v2.z;
      const hl = Math.sqrt(hx * hx + hz * hz);
      if (hl < 0.2) { const a = rand(0, 6.28); hx = Math.cos(a); hz = Math.sin(a); } else { hx /= hl; hz /= hl; }
      const back = rand(0.35, 1.2) * Math.min(1.6, 0.6 + py * 0.5);
      _v3.set(px + hx * back, this.groundY, pz + hz * back);
      const delay = Math.sqrt(Math.max(0.05, py - this.groundY) * 2 / g) * 0.85;
      this.bloodDecal(_v3, chance(0.5) ? DT.SPRAY_A : DT.SPRAY_B, rand(0.55, 0.95) * (headshot ? 1.35 : 1), delay, Math.atan2(hx, hz));
    }
  }

  bloodPool(pos: THREE.Vector3, scale = 1): void {
    const d = this.d;
    d.reset();
    // pools always sit on the (flat) campus ground; pos.y is ignored so callers can pass a body centre
    d.px = pos.x; d.pz = pos.z;
    d.py = this.groundY;
    d.nx = 0; d.ny = 1; d.nz = 0;
    d.rot = rand(0, 6.28);
    d.size = rand(1.1, 1.5) * scale;
    d.tile = chance(0.5) ? DT.POOL_A : DT.POOL_B;
    d.life = this.decalLife * 1.5;
    d.r = BLOOD_POOL[0]; d.g = BLOOD_POOL[1]; d.b = BLOOD_POOL[2];
    d.rough = 0.42;
    d.delay = 0.35; d.grow = 2.2; d.start = 0.06; d.fade = 5;
    this.decals.emit(d);
  }

  melee(point: THREE.Vector3, dir: THREE.Vector3): void {
    this.blood(point, dir, 0.8, false);
    const lod = this.lod(point);
    if (lod <= 0) return;
    const p = this.p;
    // dusty "smack" (sweat, grime off clothes, bat wood)
    p.reset();
    p.px = point.x; p.py = point.y; p.pz = point.z;
    p.life = 0.18; p.size0 = 0.2; p.size1 = 0.7;
    p.rot = rand(0, 6.28);
    p.r = 0.42; p.g = 0.38; p.b = 0.34; p.a = 0.22;
    p.tile = PT.SMOKE_C; p.fadeOut = 0.1;
    this.alpha.emit(p);
    const n = this.count(3, lod);
    for (let i = 0; i < n; i++) {
      this.cone(_v1, dir, 1.3);
      const sp = rand(1.2, 2.6);
      p.reset();
      p.px = point.x; p.py = point.y; p.pz = point.z;
      p.vx = _v1.x * sp; p.vy = _v1.y * sp; p.vz = _v1.z * sp;
      p.drag = 6; p.gravity = -0.1;
      p.life = rand(0.45, 0.7);
      p.size0 = 0.08; p.size1 = rand(0.35, 0.5);
      p.rot = rand(0, 6.28); p.spin = rand(-1, 1);
      p.r = 0.55; p.g = 0.5; p.b = 0.45; p.a = 0.28;
      p.tile = PT.SMOKE_B; p.fadeIn = 0.05; p.fadeOut = 0.3;
      this.alpha.emit(p);
    }
  }

  gateHit(point: THREE.Vector3): void {
    const lod = this.lod(point);
    if (lod <= 0) return;
    _v2.set(rand(-0.5, 0.5), 0.6, rand(-0.5, 0.5)).normalize();
    this.flashGlow(point.x, point.y, point.z, 0.35, 3.5, 1.0, 0.75, 0.45, 0.06);
    this.sparks(point.x, point.y, point.z, _v2, this.count(14, lod), 2.5, 7, 1.4);
    this.dust(point.x, point.y, point.z, _v2, this.count(3, lod), 0.5, 0.42, 0.34, 0.35, 0.6, 1.2);
    this.debris(point.x, point.y, point.z, _v2, this.count(4, lod), 0.35, 0.22, 0.14, 0.012, 0.025, 1.2, PT.CHIP);
    if (lod > 0.55) this.popLight(point.x, point.y + 0.2, point.z, 10, 0.06, 1.0, 0.7, 0.4);
  }

  /**
   * Frag / blast at `pos` resting on (or above) a floor at world height `floorY` (default: the campus ground): white-hot
   * core flash, fireballs, an expanding dark smoke column, a ground dust ring, sparks and dirt clods, a scorch decal
   * and the pooled light flash. Particles clamp and fade against `floorY`, so a blast on the raised gate forecourt or
   * an upper storey sits on that floor.
   */
  explosion(pos: THREE.Vector3, floorY = this.groundY): void {
    const lod = Math.max(0.5, this.lod(pos));
    const p = this.p;
    const fl = Math.max(floorY, this.groundY);
    const x = pos.x, y = Math.max(pos.y, fl + 0.1), z = pos.z;
    // smoke column (spawned first so fire draws on top)
    const ns = this.count(14, lod);
    for (let i = 0; i < ns; i++) {
      p.reset();
      p.px = x + rand(-0.6, 0.6); p.py = y + rand(0.2, 1.0); p.pz = z + rand(-0.6, 0.6);
      p.vx = rand(-2, 2); p.vy = rand(0.6, 2.6); p.vz = rand(-2, 2);
      p.drag = 1.5; p.gravity = -0.55;
      p.life = rand(2.5, 4.2);
      p.size0 = rand(0.6, 1.0); p.size1 = rand(2.8, 4.2);
      p.rot = rand(0, 6.28); p.spin = rand(-0.4, 0.4);
      const c = rand(0.07, 0.13);
      p.r = c; p.g = c * 0.95; p.b = c * 0.9; p.a = rand(0.55, 0.75);
      p.tile = i % 2 ? PT.SMOKE_A : PT.SMOKE_B; p.fadeIn = 0.08; p.fadeOut = 0.45;
      p.delay = rand(0, 0.12); p.floor = fl;
      this.alpha.emit(p);
    }
    // ground dust ring
    const nr = this.count(12, lod);
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * 6.283 + rand(-0.2, 0.2);
      const sp = rand(5, 9);
      p.reset();
      p.px = x; p.py = fl + 0.3; p.pz = z;
      p.vx = Math.cos(a) * sp; p.vy = rand(0.2, 0.8); p.vz = Math.sin(a) * sp;
      p.drag = 2.8; p.gravity = -0.2;
      p.life = rand(1.4, 2.4);
      p.size0 = 0.4; p.size1 = rand(1.6, 2.4);
      p.rot = rand(0, 6.28);
      p.r = 0.48; p.g = 0.42; p.b = 0.34; p.a = 0.45;
      p.tile = PT.SMOKE_B; p.fadeIn = 0.05; p.fadeOut = 0.4; p.floor = fl;
      this.alpha.emit(p);
    }
    this.debris(x, y, z, _up, this.count(22, lod), 0.18, 0.14, 0.1, 0.03, 0.07, 1.4, PT.CLUMP, 5, 13, fl);
    // fireballs
    const nf = this.count(10, lod);
    for (let i = 0; i < nf; i++) {
      p.reset();
      p.px = x + rand(-0.4, 0.4); p.py = y + rand(0.1, 0.9); p.pz = z + rand(-0.4, 0.4);
      p.vx = rand(-3, 3); p.vy = rand(1, 5); p.vz = rand(-3, 3);
      p.drag = 3.5; p.gravity = -2;
      p.life = rand(0.35, 0.65);
      p.size0 = rand(0.6, 1.0); p.size1 = rand(2.0, 3.0);
      p.rot = rand(0, 6.28); p.spin = rand(-2, 2);
      const I = rand(3.5, 6);
      p.r = I; p.g = I * 0.7; p.b = I * 0.45; p.a = 1; p.heat = 1;
      p.tile = PT.FIRE; p.fadeOut = 0.35;
      p.delay = rand(0, 0.05); p.floor = fl;
      this.add.emit(p);
    }
    this.flashGlow(x, y + 0.5, z, 7, 3, 1.0, 0.7, 0.4, 0.14);
    // white-hot core, gone within two frames
    this.flashGlow(x, y + 0.25, z, 2.2, 6, 1.0, 0.92, 0.8, 0.05);
    this.sparks(x, y + 0.3, z, _up, this.count(34, lod), 5, 16, 2.2, fl);
    const d = this.d;
    d.reset();
    // road and ground meshes sit up to ~6 cm above the collision floor the sim reports: keep the scorch above them
    d.px = x; d.py = fl + 0.065; d.pz = z;
    d.rot = rand(0, 6.28); d.size = rand(3.2, 4.0); d.tile = DT.SCORCH;
    d.life = this.decalLife * 2; d.rough = 1; d.grow = 0.12; d.start = 0.3; d.fade = 6;
    this.decals.emit(d);
    this.popLight(x, y + 1.2, z, 420, 0.35, 1.0, 0.58, 0.28);
  }

  shellEject(pos: THREE.Vector3, right: THREE.Vector3, weapon: string): void {
    if (this.lod(pos) < 0.5) return;
    const f = FLASH[weapon as WeaponKind] ?? FLASH.rifle;
    const shotgun = weapon === 'shotgun';
    const p = this.p;
    const sp = rand(1.6, 2.6);
    p.reset();
    p.px = pos.x; p.py = pos.y; p.pz = pos.z;
    p.vx = right.x * sp + rand(-0.3, 0.3); p.vy = rand(1.6, 2.6); p.vz = right.z * sp + rand(-0.3, 0.3);
    p.gravity = 9.8; p.drag = 1.4;
    p.life = rand(1.8, 2.6);
    p.size0 = p.size1 = f.casing;
    p.rot = rand(0, 6.28); p.spin = rand(18, 32) * (chance(0.5) ? 1 : -1);
    if (shotgun) { p.r = 0.55; p.g = 0.06; p.b = 0.04; } else { p.r = 0.85; p.g = 0.58; p.b = 0.2; }
    p.a = 1;
    p.tile = PT.CASING; p.fadeOut = 0.85;
    this.alpha.emit(p);
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.shared.uTime.value = t;
    this.shared.uGround.value = this.groundY;
    this.alpha.flush(t);
    this.add.flush(t);
    this.decals.flush(t);
    // pooled flash light
    if (this.lightT > 0) {
      this.lightT = Math.max(0, this.lightT - dt);
      const k = this.lightT / this.lightDur;
      this.light.intensity = this.lightPeak * k * k * (0.85 + Math.random() * 0.3);
    } else this.light.intensity = 0;
    const li = this.light.intensity;
    this.shared.uFlashPos.value.copy(this.light.position);
    this.shared.uFlashCol.value.copy(this.light.color).multiplyScalar(li * 0.035);
  }

  /** 0 day … 1 night: flashes read stronger, smoke/dust/blood particles darken with the ambient. */
  setNight(n: number): void {
    this.night = THREE.MathUtils.clamp(n, 0, 1);
    this.shared.uBoost.value = 1 + 0.45 * this.night;
    this.shared.uAmbient.value.setRGB(1, 1, 1).lerp(_nightAmbient, this.night);
  }

  /** Remove all live particles and decals. */
  clear(): void {
    this.alpha.clear();
    this.add.clear();
    this.decals.clear();
    this.lightT = 0;
    this.light.intensity = 0;
  }

  /** Debug readout (scans buffers; don't call every frame in production). */
  stats(): { particles: number; decals: number; drawCalls: number; capacity: { particles: number; decals: number } } {
    const t = this.time;
    return {
      particles: this.alpha.countLive(t) + this.add.countLive(t),
      decals: this.decals.countLive(t),
      drawCalls: (this.alpha.mesh.visible ? 1 : 0) + (this.add.mesh.visible ? 1 : 0) + (this.decals.mesh.visible ? 1 : 0),
      capacity: { particles: this.alpha.capacity + this.add.capacity, decals: this.decals.capacity },
    };
  }

  dispose(): void {
    this.alpha.dispose();
    this.add.dispose();
    this.decals.dispose();
    this.pTex.dispose();
    this.dTex.dispose();
    this.light.removeFromParent();
    this.light.dispose();
  }

  // ----------------------------------------------------------------------------------------------
  // building blocks
  // ----------------------------------------------------------------------------------------------

  /** Distance LOD: 1 near, fades to ~0.3 by 120 m, 0 (skip) beyond 220 m. */
  private lod(p: THREE.Vector3): number {
    _camPos.setFromMatrixPosition(this.camera.matrixWorld);
    const d = _camPos.distanceTo(p);
    // far impacts get bigger puffs so they still read at gameplay distance
    this.far = d < 10 ? 1 : Math.min(2, 1 + (d - 10) / 25);
    if (d < 30) return 1;
    if (d > 220) return 0;
    return d < 120 ? 1 - ((d - 30) / 90) * 0.7 : 0.3;
  }

  private count(n: number, lod: number): number {
    const x = n * this.detail * lod;
    const i = Math.floor(x);
    return i + (Math.random() < x - i ? 1 : 0);
  }

  /** Random direction within `angle` radians of `axis` (axis must be normalised-ish). */
  private cone(out: THREE.Vector3, axis: THREE.Vector3, angle: number): THREE.Vector3 {
    const ax = axis.x, ay = axis.y, az = axis.z;
    // orthonormal basis around axis
    if (Math.abs(ay) < 0.9) _t1.set(az, 0, -ax); else _t1.set(0, -az, ay);
    _t1.normalize();
    _t2.set(ay * _t1.z - az * _t1.y, az * _t1.x - ax * _t1.z, ax * _t1.y - ay * _t1.x);
    const cosA = 1 - Math.random() * (1 - Math.cos(angle));
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const phi = Math.random() * Math.PI * 2;
    const c = Math.cos(phi) * sinA, s = Math.sin(phi) * sinA;
    out.set(ax * cosA + _t1.x * c + _t2.x * s, ay * cosA + _t1.y * c + _t2.y * s, az * cosA + _t1.z * c + _t2.z * s);
    return out.normalize();
  }

  /** Solve y(t) = groundY for a particle under gravity g with linear drag k (bisection, no allocation). */
  private landTime(y0: number, vy: number, g: number, k: number): number {
    const gy = this.groundY;
    if (y0 <= gy) return 0.05;
    let lo = 0, hi = 0.25;
    while (dragY(hi, y0, vy, g, k) > gy && hi < 4) hi *= 2;
    if (hi >= 4) return 4;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) * 0.5;
      if (dragY(m, y0, vy, g, k) > gy) lo = m; else hi = m;
    }
    return (lo + hi) * 0.5;
  }

  private popLight(x: number, y: number, z: number, peak: number, dur: number, r: number, g: number, b: number): void {
    const boost = 1 + 1.6 * this.night;
    const pk = peak * boost;
    // don't let a small flash cut short a bigger one still decaying
    const cur = this.lightT > 0 ? this.lightPeak * (this.lightT / this.lightDur) ** 2 : 0;
    if (cur > pk) return;
    this.light.position.set(x, y, z);
    this.light.color.setRGB(r, g, b);
    this.lightPeak = pk;
    this.lightDur = dur;
    this.lightT = dur;
  }

  private flashGlow(x: number, y: number, z: number, size: number, I: number, r: number, g: number, b: number, life: number): void {
    const p = this.p;
    p.reset();
    p.px = x; p.py = y; p.pz = z;
    p.life = life; p.size0 = size * 0.7; p.size1 = size;
    p.rot = Math.random() * 6.28;
    p.r = r * I; p.g = g * I; p.b = b * I; p.a = 1;
    p.tile = PT.SOFT; p.fadeOut = 0.2;
    this.add.emit(p);
  }

  private sparks(x: number, y: number, z: number, n: THREE.Vector3, count: number, vmin: number, vmax: number, spread: number, floor = 0): void {
    const p = this.p;
    for (let i = 0; i < count; i++) {
      this.cone(_v1, n, spread);
      const sp = rand(vmin, vmax);
      p.reset();
      p.px = x; p.py = y; p.pz = z;
      p.vx = _v1.x * sp; p.vy = _v1.y * sp + rand(0, 1.5); p.vz = _v1.z * sp;
      p.gravity = 9.8; p.drag = 1.4;
      p.mode = PMode.STRETCH; p.stretch = 0.04;
      p.life = rand(0.2, 0.65);
      p.size0 = p.size1 = rand(0.012, 0.02);
      const I = rand(7, 11);
      p.r = I; p.g = I * 0.72; p.b = I * 0.38; p.a = 1; p.heat = 1;
      p.tile = PT.SOFT; p.fadeOut = 0.55; p.floor = floor;
      this.add.emit(p);
    }
  }

  private dust(x: number, y: number, z: number, n: THREE.Vector3, count: number, r: number, g: number, b: number, a: number, size: number, life: number): void {
    const p = this.p;
    for (let i = 0; i < count; i++) {
      this.cone(_v1, n, 0.75);
      const sp = rand(0.6, 1.8);
      p.reset();
      p.px = x; p.py = y; p.pz = z;
      p.vx = _v1.x * sp; p.vy = _v1.y * sp; p.vz = _v1.z * sp;
      p.drag = 3.2; p.gravity = -0.15;
      p.life = life * rand(0.75, 1.25);
      p.size0 = size * 0.15; p.size1 = size * rand(0.8, 1.2);
      p.rot = rand(0, 6.28); p.spin = rand(-0.7, 0.7);
      const c = rand(0.9, 1.08);
      p.r = r * c; p.g = g * c; p.b = b * c; p.a = a;
      p.tile = i % 2 ? PT.SMOKE_A : PT.SMOKE_C; p.fadeIn = 0.05; p.fadeOut = 0.35;
      this.alpha.emit(p);
    }
  }

  private debris(x: number, y: number, z: number, n: THREE.Vector3, count: number, r: number, g: number, b: number, smin: number, smax: number, spread: number, tile: number, vmin = 2.5, vmax = 6, floor = 0): void {
    const p = this.p;
    for (let i = 0; i < count; i++) {
      this.cone(_v1, n, spread);
      const sp = rand(vmin, vmax);
      p.reset();
      p.px = x; p.py = y; p.pz = z;
      p.vx = _v1.x * sp; p.vy = _v1.y * sp + rand(0.3, 1.2); p.vz = _v1.z * sp;
      p.gravity = 9.8; p.drag = 0.9;
      p.life = rand(0.7, 1.2);
      p.size0 = p.size1 = rand(smin, smax);
      p.rot = rand(0, 6.28); p.spin = rand(-18, 18);
      const c = rand(0.75, 1.15);
      p.r = r * c; p.g = g * c; p.b = b * c; p.a = 1;
      p.tile = tile; p.fadeOut = 0.8; p.floor = floor;
      this.alpha.emit(p);
    }
  }

  private decal(point: THREE.Vector3, normal: THREE.Vector3, tile: number, size: number, r: number, g: number, b: number, rough: number, rot = Math.random() * 6.283): void {
    const d = this.d;
    d.reset();
    d.px = point.x; d.py = point.y; d.pz = point.z;
    d.nx = normal.x; d.ny = normal.y; d.nz = normal.z;
    d.rot = rot; d.size = size; d.tile = tile;
    d.life = this.decalLife; d.r = r; d.g = g; d.b = b; d.rough = rough;
    d.grow = 0.03; d.start = 0.6; d.fade = 3;
    this.decals.emit(d);
  }

  private bloodDecal(pos: THREE.Vector3, tile: number, size: number, delay: number, rot: number): void {
    const d = this.d;
    d.reset();
    d.px = pos.x; d.py = pos.y; d.pz = pos.z;
    d.nx = 0; d.ny = 1; d.nz = 0;
    d.rot = rot; d.size = size; d.tile = tile;
    d.life = this.decalLife; d.fade = 4;
    const c = rand(0.8, 1.15);
    d.r = BLOOD_DECAL[0] * c; d.g = BLOOD_DECAL[1] * c; d.b = BLOOD_DECAL[2] * c;
    d.rough = 0.7;
    d.delay = delay; d.grow = 0.1; d.start = 0.35;
    this.decals.emit(d);
  }
}

const _nightAmbient = new THREE.Color(0.14, 0.15, 0.2);
