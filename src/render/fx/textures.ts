import * as THREE from 'three';

/**
 * Procedural FX textures. Everything is generated per-pixel into RGBA8 DataTextures (no downloads, no canvas
 * premultiplication artefacts). Two 4x4 atlases:
 *  - particle atlas (linear): rgb = shading/heat ramp, a = coverage. Tinted per particle in the shader.
 *  - decal atlas (sRGB): bullet holes carry their own colour; blood tiles are grey detail tinted per decal.
 * Tile (col,row) occupies uv [col/4,(col+1)/4] x [row/4,(row+1)/4], row 0 at the bottom (flipY = false).
 */

export const GRID = 4;

export const PT = {
  SOFT: 0, DROP: 1, STAR_A: 2, STAR_B: 3,
  FLAME_A: 4, FLAME_B: 5, SMOKE_A: 6, SMOKE_B: 7,
  SMOKE_C: 8, CLUMP: 9, CHIP: 10, SPLINTER: 11,
  CASING: 12, FIRE: 13, MIST: 14, BURST: 15,
} as const;

export const DT = {
  HOLE_CONCRETE_A: 0, HOLE_CONCRETE_B: 1, HOLE_METAL: 2, HOLE_WOOD: 3,
  SCUFF: 4, SCORCH: 5, SPLAT_ROUND: 6, SPRAY_A: 7,
  DROPS: 8, SPLAT_BIG: 9, SPRAY_B: 10, SMEAR: 11,
  POOL_A: 12, POOL_B: 13, DROP_A: 14, DROP_B: 15,
} as const;

// ------------------------------------------------------------------------------------------------
// noise helpers
// ------------------------------------------------------------------------------------------------

// value noise on a permuted lattice (table lookups; much cheaper than integer hashing per corner)
const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
{
  let a = 0x2545f491;
  const r = () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { p[i] = i; VAL[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function vnoise(x: number, y: number, seed: number): number {
  const fx0 = Math.floor(x), fy0 = Math.floor(y);
  let fx = x - fx0, fy = y - fy0;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const ix = (fx0 + seed * 57) & 255, iy = fy0 & 255;
  const r0 = PERM[ix], r1 = PERM[ix + 1];
  const a = VAL[PERM[r0 + iy]], b = VAL[PERM[r1 + iy]], c = VAL[PERM[r0 + iy + 1]], d = VAL[PERM[r1 + iy + 1]];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number, oct = 4): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, seed + i * 31);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hyp = (x: number, y: number) => Math.sqrt(x * x + y * y);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

type Px = (u: number, v: number, out: Float32Array) => void;

/** Paint one tile. `fn` gets u,v in [-1,1] (v up) and writes rgba (0..1) into out. */
function paintTile(data: Uint8ClampedArray, size: number, tile: number, fn: Px): void {
  const T = size / GRID;
  const col = tile % GRID, row = Math.floor(tile / GRID);
  const out = OUT;
  const inv = 2 / T;
  for (let py = 0; py < T; py++) {
    const v = (py + 0.5) * inv - 1;
    const av = v < 0 ? -v : v;
    let i = ((row * T + py) * size + col * T) * 4;
    for (let px = 0; px < T; px++, i += 4) {
      const u = (px + 0.5) * inv - 1;
      out[0] = out[1] = out[2] = 1; out[3] = 0;
      fn(u, v, out);
      // hard guarantee of an empty border so mips don't bleed between tiles
      const au = u < 0 ? -u : u;
      const m = au > av ? au : av;
      const edge = m > 0.9 ? smooth(1.0, 0.9, m) : 1;
      data[i] = out[0] * 255;
      data[i + 1] = out[1] * 255;
      data[i + 2] = out[2] * 255;
      data[i + 3] = out[3] * edge * 255;
    }
  }
}
const OUT = new Float32Array(4);

/** Fire/flash colour ramp: 0 = deep orange-red, 1 = white. Writes rgb. */
function heatRamp(h: number, out: Float32Array): void {
  h = clamp01(h);
  if (h < 0.4) { const t = h / 0.4; out[0] = 1; out[1] = mix(0.28, 0.62, t); out[2] = mix(0.06, 0.18, t); }
  else if (h < 0.75) { const t = (h - 0.4) / 0.35; out[0] = 1; out[1] = mix(0.62, 0.88, t); out[2] = mix(0.18, 0.5, t); }
  else { const t = (h - 0.75) / 0.25; out[0] = 1; out[1] = mix(0.88, 1, t); out[2] = mix(0.5, 0.95, t); }
}

// ------------------------------------------------------------------------------------------------
// particle atlas
// ------------------------------------------------------------------------------------------------

function starFn(seed: number, lens: number[], sharp: number, rotOff: number): Px {
  const petals = lens.length;
  return (u, v, o) => {
    const r = hyp(u, v);
    const th = Math.atan2(v, u) + rotOff;
    const k = (th / (Math.PI * 2) + 2) * petals;
    const nearest = Math.floor(k + 0.5);
    const f = k - nearest;
    const len = lens[((nearest % petals) + petals) % petals];
    const prof = Math.pow(Math.cos(f * Math.PI), sharp);
    const jag = (vnoise(th * 7 + 11, r * 5, seed) - 0.5) * 0.22;
    const edge = 0.3 + (len * 0.92 - 0.3 + jag) * prof;
    const x = r / Math.max(edge, 0.02);
    const petal = x < 1 ? Math.pow(1 - x, 1.35) : 0;
    const streak = 0.75 + 0.25 * vnoise(th * 23, r * 2, seed + 5);
    const core = Math.exp(-r * r * 14);
    const I = clamp01(petal * streak * 0.95 + core);
    heatRamp(core * 1.1 + petal * 0.55 + 0.1, o);
    o[3] = I;
  };
}

function flameFn(seed: number, prongs: boolean): Px {
  return (u, v, o) => {
    const y = (v + 1) * 0.5; // 0 at muzzle, 1 at tip
    if (y <= 0.001 || y >= 0.999) { o[3] = 0; return; }
    const n = fbm(u * 2.5 + seed, y * 6, seed, 3);
    const wBase = 1.7 * Math.pow(y, 0.35) * Math.pow(1 - y, 0.95) * 0.6;
    const w = Math.max(0.01, wBase * (0.72 + 0.56 * n));
    let I: number;
    if (!prongs) {
      const d = u / w;
      I = Math.exp(-d * d * 2.4) * Math.pow(1 - y, 0.55);
    } else {
      I = 0;
      for (let k = -1; k <= 1; k++) {
        const c = k * 0.5 * Math.pow(y, 1.15);
        const len = k === 0 ? 1 : 0.78;
        if (y > len) continue;
        const d = (u - c) / (w * (k === 0 ? 0.55 : 0.42));
        I = Math.max(I, Math.exp(-d * d * 2.4) * Math.pow(1 - y / len, 0.6));
      }
    }
    I *= 0.7 + 0.3 * fbm(u * 5, y * 16 - seed, seed + 9, 2);
    I *= smooth(0.0, 0.05, y);
    heatRamp(I * (1.15 - y * 0.8), o);
    o[3] = clamp01(I * 1.15);
  };
}

function smokeFn(seed: number, wispy: boolean): Px {
  return (u, v, o) => {
    const r = hyp(u, v * (wispy ? 1.25 : 1));
    if (r > 1.4) { o[3] = 0; return; }
    const n1 = fbm(u * 1.6 + seed * 3.1, v * 1.6 - seed, seed, 5);
    const dist = r + (n1 - 0.5) * (wispy ? 0.95 : 0.7);
    const dens = smooth(0.92, wispy ? 0.3 : 0.12, dist);
    if (dens <= 0) { o[3] = 0; return; }
    const det = fbm(u * 4.2 + 7, v * 4.2 + seed, seed + 3, 4);
    const a = dens * (0.5 + 0.5 * det) * (wispy ? 0.8 : 1);
    const light = 0.66 + 0.34 * clamp01(0.55 + 0.55 * (v * 0.6 - u * 0.25) + (det - 0.5) * 0.9);
    o[0] = o[1] = o[2] = light;
    o[3] = a;
  };
}

function clumpFn(seed: number): Px {
  return (u, v, o) => {
    const r = hyp(u, v);
    const d = r + (fbm(u * 2.4 + seed, v * 2.4, seed, 3) - 0.5) * 0.55;
    const a = smooth(0.6, 0.5, d);
    const s = (0.62 + 0.38 * clamp01(0.5 + v * 0.55 - u * 0.3)) * (0.78 + 0.44 * fbm(u * 9, v * 9, seed + 2, 2));
    o[0] = o[1] = o[2] = s;
    o[3] = a;
  };
}

function chipFn(seed: number): Px {
  const rnd = mulberry(seed);
  const N = 6;
  const ang: number[] = [], rad: number[] = [], shade: number[] = [];
  for (let i = 0; i < N; i++) { ang.push((i + rnd() * 0.6) / N * Math.PI * 2); rad.push(0.42 + rnd() * 0.3); shade.push(0.5 + rnd() * 0.5); }
  // polygon vertices
  const vx = ang.map((a, i) => Math.cos(a) * rad[i]), vy = ang.map((a, i) => Math.sin(a) * rad[i]);
  return (u, v, o) => {
    // signed distance to convex-ish polygon via edge half-planes (star-shaped around 0)
    let inside = 1e9;
    let sector = 0, best = -1e9;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const ex = vx[j] - vx[i], ey = vy[j] - vy[i];
      const len = hyp(ex, ey);
      const nx = ey / len, ny = -ex / len; // outward for CCW polygon
      const dist = (vx[i] - u) * nx + (vy[i] - v) * ny; // >0 inside
      inside = Math.min(inside, dist);
      const c = (u * (vx[i] + vx[j]) + v * (vy[i] + vy[j]));
      if (c > best) { best = c; sector = i; }
    }
    const a = smooth(-0.02, 0.02, inside);
    const s = shade[sector] * (0.85 + 0.15 * clamp01(0.5 + v * 0.5));
    o[0] = o[1] = o[2] = s;
    o[3] = a;
  };
}

function splinterFn(seed: number): Px {
  return (u, v, o) => {
    const L = 0.86;
    if (Math.abs(u) > L) { o[3] = 0; return; }
    const x = u / L;
    const t = 0.1 * Math.sqrt(Math.max(0, 1 - x * x)) * (0.65 + 0.7 * vnoise(u * 7, 0, seed)) * (x > 0.3 ? 1 - (x - 0.3) * 0.9 : 1);
    const cy = 0.05 * Math.sin(u * 3 + seed);
    const d = Math.abs(v - cy);
    const a = smooth(t + 0.02, t - 0.01, d);
    const grain = 0.78 + 0.22 * vnoise(u * 3, v * 60, seed + 1);
    o[0] = o[1] = o[2] = grain * (0.8 + 0.2 * clamp01(0.5 + (v - cy) / Math.max(t, 0.01) * 0.5));
    o[3] = a;
  };
}

const casingFn: Px = (u, v, o) => {
  const x0 = -0.62, x1 = 0.62, R = 0.2;
  const cx = Math.max(x0, Math.min(x1, u));
  const d = hyp(u - cx, v);
  const a = smooth(R + 0.03, R - 0.01, d);
  const s = clamp01(v / R);
  let c = 0.42 + 0.58 * Math.pow(clamp01(1 - Math.abs(s - 0.35) * 1.4), 2.2) + 0.25 * Math.exp(-((s - 0.45) ** 2) * 60);
  if (u > x1 - 0.06) c *= 0.45; // open mouth
  if (u < x0 + 0.1 && u > x0 + 0.04) c *= 0.7; // extractor groove
  o[0] = o[1] = o[2] = clamp01(c);
  o[3] = a;
};

function fireFn(seed: number): Px {
  return (u, v, o) => {
    const r = hyp(u, v);
    if (r > 1.3) { o[3] = 0; return; }
    const n1 = fbm(u * 1.8 + seed, v * 1.8, seed, 5);
    const dens = smooth(0.9, 0.1, r + (n1 - 0.5) * 0.8);
    if (dens <= 0) { o[3] = 0; return; }
    const det = fbm(u * 5 + 3, v * 5 - seed, seed + 4, 4);
    const I = dens * (0.45 + 0.55 * det);
    heatRamp(I * 1.2, o);
    o[3] = clamp01(dens * (0.6 + 0.4 * det));
  };
}

function mistFn(seed: number): Px {
  const rnd = mulberry(seed);
  const dots: number[] = [];
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.pow(rnd(), 0.7) * 0.8;
    dots.push(Math.cos(a) * rr, Math.sin(a) * rr, 0.012 + Math.pow(rnd(), 2.5) * 0.055);
  }
  return (u, v, o) => {
    const r = hyp(u, v);
    const haze = Math.exp(-r * r * 3.6) * 0.5 * (0.55 + 0.9 * fbm(u * 3, v * 3, seed, 3));
    let dot = 0;
    if (r < 0.9) {
      for (let i = 0; i < dots.length; i += 3) {
        const dx = u - dots[i], dy = v - dots[i + 1];
        const rd = dots[i + 2] * 1.3;
        const d2 = dx * dx + dy * dy;
        if (d2 < rd * rd) dot = Math.max(dot, smooth(rd * 0.96, rd * 0.54, Math.sqrt(d2)));
      }
    }
    o[0] = o[1] = o[2] = 0.8 + 0.2 * dot;
    o[3] = clamp01(Math.max(haze, dot));
  };
}

function burstFn(seed: number): Px {
  const rnd = mulberry(seed);
  const N = 15;
  const ang: number[] = [], len: number[] = [], wid: number[] = [];
  for (let i = 0; i < N; i++) { ang.push(rnd() * Math.PI * 2); len.push(0.4 + rnd() * 0.5); wid.push(0.04 + rnd() * 0.05); }
  return (u, v, o) => {
    const r = hyp(u, v);
    if (r > 1.0) { o[3] = 0; return; }
    let a = r < 0.6 ? smooth(0.42, 0.12, r + (fbm(u * 3 + seed, v * 3, seed, 3) - 0.5) * 0.3) : 0;
    for (let i = 0; i < N; i++) {
      if (r > len[i] + 0.12) continue;
      const ca = Math.cos(ang[i]), sa = Math.sin(ang[i]);
      const along = u * ca + v * sa;
      const lat = -u * sa + v * ca;
      if (along > 0 && along < len[i]) {
        const w = wid[i] * Math.pow(1 - along / len[i], 0.6) + 0.006;
        a = Math.max(a, smooth(w, w * 0.4, Math.abs(lat)) * (0.6 + 0.4 * (1 - along / len[i])));
      }
      const ex = ca * (len[i] + 0.03), ey = sa * (len[i] + 0.03);
      const dd = hyp(u - ex, v - ey);
      const dr = wid[i] * 0.9;
      if (dd < dr * 1.4) a = Math.max(a, smooth(dr * 1.3, dr * 0.6, dd));
    }
    o[0] = o[1] = o[2] = 1;
    o[3] = clamp01(a);
  };
}

export function makeParticleAtlas(size = 1024): THREE.DataTexture {
  const data = new Uint8ClampedArray(size * size * 4);
  paintTile(data, size, PT.SOFT, (u, v, o) => {
    const r2 = u * u + v * v;
    o[3] = Math.exp(-r2 * 5.5) * (1 - smooth(0.7, 1.0, Math.sqrt(r2)));
  });
  paintTile(data, size, PT.DROP, (u, v, o) => {
    const r = hyp(u, v);
    const hl = Math.exp(-((u + 0.2) ** 2 + (v - 0.22) ** 2) * 40);
    o[0] = o[1] = o[2] = clamp01(0.72 + 0.5 * hl - 0.25 * smooth(0.25, 0.55, r));
    o[3] = smooth(0.62, 0.5, r);
  });
  paintTile(data, size, PT.STAR_A, starFn(11, [0.95, 0.62, 0.85, 0.7, 1.0], 1.7, 0.3));
  paintTile(data, size, PT.STAR_B, starFn(23, [1.0, 0.6, 0.9, 0.62, 0.97, 0.58, 0.85, 0.6], 2.6, 0));
  paintTile(data, size, PT.FLAME_A, flameFn(3, false));
  paintTile(data, size, PT.FLAME_B, flameFn(7, true));
  paintTile(data, size, PT.SMOKE_A, smokeFn(1, false));
  paintTile(data, size, PT.SMOKE_B, smokeFn(2, false));
  paintTile(data, size, PT.SMOKE_C, smokeFn(5, true));
  paintTile(data, size, PT.CLUMP, clumpFn(4));
  paintTile(data, size, PT.CHIP, chipFn(9));
  paintTile(data, size, PT.SPLINTER, splinterFn(6));
  paintTile(data, size, PT.CASING, casingFn);
  paintTile(data, size, PT.FIRE, fireFn(8));
  paintTile(data, size, PT.MIST, mistFn(12));
  paintTile(data, size, PT.BURST, burstFn(13));
  const t = new THREE.DataTexture(new Uint8Array(data.buffer), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------------
// decal atlas
// ------------------------------------------------------------------------------------------------

/** Compact-support metaball field on a T x T tile in [-1,1]^2. */
class Field {
  f: Float32Array;
  constructor(public T: number) { this.f = new Float32Array(T * T); }
  /** Blob with *visible* radius rv at threshold 0.3 (kernel (1-q)^3). */
  blob(x: number, y: number, rv: number, w = 1): void {
    const R = rv / 0.575;
    this.cap(x, y, x, y, R, R, w);
  }
  /** Capsule from (x0,y0) radius R0 to (x1,y1) radius R1 (kernel radii, not visible). */
  cap(x0: number, y0: number, x1: number, y1: number, R0: number, R1: number, w = 1): void {
    const T = this.T;
    const Rm = Math.max(R0, R1);
    const minX = Math.max(0, Math.floor(((Math.min(x0, x1) - Rm + 1) / 2) * T));
    const maxX = Math.min(T - 1, Math.ceil(((Math.max(x0, x1) + Rm + 1) / 2) * T));
    const minY = Math.max(0, Math.floor(((Math.min(y0, y1) - Rm + 1) / 2) * T));
    const maxY = Math.min(T - 1, Math.ceil(((Math.max(y0, y1) + Rm + 1) / 2) * T));
    const dx = x1 - x0, dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    for (let py = minY; py <= maxY; py++) {
      const v = ((py + 0.5) / T) * 2 - 1;
      for (let px = minX; px <= maxX; px++) {
        const u = ((px + 0.5) / T) * 2 - 1;
        let t = l2 > 0 ? ((u - x0) * dx + (v - y0) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = x0 + dx * t, cy = y0 + dy * t;
        const R = R0 + (R1 - R0) * t;
        const q = ((u - cx) ** 2 + (v - cy) ** 2) / (R * R);
        if (q < 1) { const k = 1 - q; this.f[py * T + px] += w * k * k * k; }
      }
    }
  }
  at(u: number, v: number): number {
    const T = this.T;
    const px = Math.min(T - 1, Math.max(0, Math.floor(((u + 1) / 2) * T)));
    const py = Math.min(T - 1, Math.max(0, Math.floor(((v + 1) / 2) * T)));
    return this.f[py * T + px];
  }
}

/** Blood look from a metaball field: thick = slightly lighter/glossier centre, darker dried rim. */
function bloodFromField(F: Field, seed: number, pool = false): Px {
  const TH = 0.3;
  return (u, v, o) => {
    const f0 = F.at(u, v);
    if (f0 < TH - 0.12) { o[0] = o[1] = o[2] = 0.42; o[3] = 0; return; } // edge colour (no light halo from filtering)
    const n = fbm(u * 9 + seed, v * 9, seed, 3);
    const f = f0 + (n - 0.5) * 0.12;
    const a = smooth(TH - 0.05, TH + 0.05, f);
    const thick = smooth(TH, TH + (pool ? 1.5 : 0.9), f);
    const rim = 1 - smooth(TH, TH + 0.22, f);
    let c = 0.6 + 0.3 * thick + 0.14 * (fbm(u * 3 - seed, v * 3, seed + 7, 3) - 0.5);
    c *= 1 - 0.38 * rim;
    o[0] = o[1] = o[2] = clamp01(c);
    o[3] = a * (pool ? 0.98 : 0.96);
  };
}

function holeConcrete(seed: number): Px {
  const rnd = mulberry(seed);
  const cracks: number[] = [];
  const nc = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < nc; i++) cracks.push(rnd() * Math.PI * 2, 0.45 + rnd() * 0.4);
  return (u, v, o) => {
    const r = hyp(u, v);
    if (r > 0.97) { o[0] = o[1] = o[2] = 0.42; o[3] = 0; return; }
    const th = Math.atan2(v, u);
    const n = fbm(u * 5 + seed, v * 5, seed, 4);
    const holeR = 0.1 + 0.03 * n;
    const craterR = 0.26 + 0.2 * (fbm(Math.cos(th) * 1.5 + seed, Math.sin(th) * 1.5, seed + 1, 3) - 0.5) * 2 * 0.5;
    const rimR = craterR + 0.1 + 0.12 * vnoise(th * 3 + seed, 0, seed + 2);
    let c: number, a: number;
    if (r < holeR) { c = 0.05; a = 1; }
    else if (r < craterR) { const t = (r - holeR) / (craterR - holeR); c = mix(0.14, 0.42, t) * (0.8 + 0.4 * n); a = 1; }
    else if (r < rimR) { c = (0.7 + 0.18 * n) * (0.92 + 0.08 * vnoise(u * 30, v * 30, seed)); a = smooth(rimR, rimR - 0.03, r); }
    else { c = 0.42; a = 0.38 * (1 - smooth(rimR, 0.88, r)) * (0.5 + n); }
    // AA between regions
    if (r >= holeR - 0.015 && r < holeR + 0.015) c = mix(0.05, c, smooth(holeR - 0.015, holeR + 0.015, r));
    // radial hairline cracks
    for (let i = 0; i < cracks.length; i += 2) {
      const ca = Math.cos(cracks[i]), sa = Math.sin(cracks[i]);
      const along = u * ca + v * sa;
      const lat = -u * sa + v * ca + (vnoise(along * 9, 0, seed + i) - 0.5) * 0.06;
      if (along > craterR * 0.8 && along < cracks[i + 1]) {
        const w = 0.012 * (1 - along / cracks[i + 1]) + 0.004;
        const k = smooth(w, 0, Math.abs(lat));
        c = mix(c, 0.12, k * 0.9);
        a = Math.max(a, k * 0.9);
      }
    }
    o[0] = c * 1.02; o[1] = c; o[2] = c * 0.96;
    o[3] = a;
  };
}

const holeMetal: Px = (u, v, o) => {
  const r = hyp(u, v);
  const n = fbm(u * 6, v * 6, 77, 3);
  let c: number, a: number;
  if (r < 0.11) { c = 0.03; a = 1; }
  else if (r < 0.19) { const t = (r - 0.11) / 0.08; c = mix(0.95, 0.6, t) * (0.9 + 0.2 * vnoise(Math.atan2(v, u) * 12, 0, 3)); a = 1; }
  else if (r < 0.3) { c = 0.28 + 0.1 * n; a = smooth(0.3, 0.26, r) * 0.85 + 0.15; }
  else { c = 0.1; a = 0.45 * (1 - smooth(0.3, 0.75 + n * 0.15, r)); }
  if (r > 0.1 && r < 0.12) c = mix(0.03, c, smooth(0.1, 0.12, r));
  o[0] = c; o[1] = c * 0.98; o[2] = c * 0.95;
  o[3] = a;
};

const holeWood: Px = (u, v, o) => {
  const r = hyp(u, v);
  const e = hyp(u * 0.45, v * 1.25); // splintering along the grain (u)
  const n = fbm(u * 3, v * 22, 41, 3);
  let r0: number, g0: number, b0: number, a: number;
  if (r < 0.1) { r0 = 0.05; g0 = 0.035; b0 = 0.02; a = 1; }
  else if (e < 0.3 + (n - 0.5) * 0.25) {
    const fib = 0.75 + 0.25 * vnoise(u * 4, v * 50, 42);
    r0 = 0.86 * fib; g0 = 0.7 * fib; b0 = 0.48 * fib; a = 1;
    if (r < 0.16) { const t = (r - 0.1) / 0.06; r0 = mix(0.12, r0, t); g0 = mix(0.08, g0, t); b0 = mix(0.05, b0, t); }
  } else { r0 = 0.25; g0 = 0.18; b0 = 0.1; a = 0.35 * (1 - smooth(0.3, 0.7, e)); }
  o[0] = r0; o[1] = g0; o[2] = b0;
  o[3] = a;
};

function scuffFn(seed: number): Px {
  const rnd = mulberry(seed);
  const specks: number[] = [];
  for (let i = 0; i < 40; i++) { const a = rnd() * Math.PI * 2, rr = 0.25 + Math.pow(rnd(), 0.8) * 0.6; specks.push(Math.cos(a) * rr, Math.sin(a) * rr, 0.015 + rnd() * 0.035); }
  return (u, v, o) => {
    const r = hyp(u, v);
    const n = fbm(u * 3 + seed, v * 3, seed, 4);
    const core = smooth(0.4, 0.28, r + (n - 0.5) * 0.35);
    let a = core * 0.95 + 0.3 * (1 - smooth(0.3, 0.8, r)) * n;
    if (r > 0.2 && r < 0.92) {
      for (let i = 0; i < specks.length; i += 3) {
        const dx = u - specks[i], dy = v - specks[i + 1], rr = specks[i + 2];
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr) a = Math.max(a, smooth(rr, rr * 0.5, Math.sqrt(d2)) * 0.9);
      }
    }
    const c = 0.1 + 0.06 * n + 0.05 * (1 - core);
    o[0] = c * 1.25; o[1] = c * 0.95; o[2] = c * 0.72;
    o[3] = clamp01(a);
  };
}

const scorchFn: Px = (u, v, o) => {
  const r = hyp(u, v);
  const th = Math.atan2(v, u);
  const n = fbm(u * 2.5, v * 2.5, 91, 5);
  const rays = 0.5 + 0.5 * vnoise(th * 9, 0, 92);
  const a = (1 - smooth(0.15, 0.95, r + (n - 0.5) * 0.4 - rays * 0.12)) * 0.92;
  const c = 0.03 + 0.06 * n + 0.04 * smooth(0.2, 0.8, r);
  o[0] = c * 1.1; o[1] = c; o[2] = c * 0.9;
  o[3] = a;
};

export function makeDecalAtlas(size = 1024): THREE.DataTexture {
  const data = new Uint8ClampedArray(size * size * 4);
  const T = size / GRID;
  paintTile(data, size, DT.HOLE_CONCRETE_A, holeConcrete(101));
  paintTile(data, size, DT.HOLE_CONCRETE_B, holeConcrete(202));
  paintTile(data, size, DT.HOLE_METAL, holeMetal);
  paintTile(data, size, DT.HOLE_WOOD, holeWood);
  paintTile(data, size, DT.SCUFF, scuffFn(303));
  paintTile(data, size, DT.SCORCH, scorchFn);

  const rnd = mulberry(4242);
  const R = (a: number, b: number) => a + rnd() * (b - a);

  // round splat: central body + lobes + spikes + satellite drops
  {
    const F = new Field(T);
    F.blob(0, 0, 0.3);
    for (let i = 0; i < 9; i++) { const a = R(0, 6.283), d = R(0.18, 0.32); F.blob(Math.cos(a) * d, Math.sin(a) * d, R(0.07, 0.14)); }
    for (let i = 0; i < 7; i++) {
      const a = R(0, 6.283), l = R(0.45, 0.7);
      F.cap(Math.cos(a) * 0.2, Math.sin(a) * 0.2, Math.cos(a) * l, Math.sin(a) * l, 0.09, 0.03);
      F.blob(Math.cos(a) * (l + 0.05), Math.sin(a) * (l + 0.05), R(0.02, 0.04));
    }
    for (let i = 0; i < 16; i++) { const a = R(0, 6.283), d = R(0.45, 0.85); F.blob(Math.cos(a) * d, Math.sin(a) * d, R(0.012, 0.04)); }
    paintTile(data, size, DT.SPLAT_ROUND, bloodFromField(F, 1));
  }
  // directional sprays along +u (origin near u = -0.8)
  for (const [tile, seed, fine] of [[DT.SPRAY_A, 2, false], [DT.SPRAY_B, 3, true]] as [number, number, boolean][]) {
    const F = new Field(T);
    F.cap(-0.8, 0, -0.35, R(-0.05, 0.05), 0.22, 0.12);
    F.blob(-0.72, 0, 0.16);
    const n = fine ? 70 : 42;
    for (let i = 0; i < n; i++) {
      const spread = R(-0.42, 0.42) * (fine ? 1.1 : 1);
      const d = Math.pow(rnd(), 0.8) * 1.55;
      const x = -0.75 + Math.cos(spread) * d, y = Math.sin(spread) * d;
      if (x > 0.85 || Math.abs(y) > 0.85) continue;
      const rv = (fine ? 0.02 : 0.035) * (1.2 - d * 0.45) * R(0.4, 1.3);
      if (rnd() < 0.45) {
        // elongated "exclamation" drop pointing away from the origin
        const l = rv * R(2, 4.5);
        F.cap(x - Math.cos(spread) * l, y - Math.sin(spread) * l, x, y, rv * 0.5 / 0.575, rv / 0.575);
      } else F.blob(x, y, rv);
    }
    paintTile(data, size, tile, bloodFromField(F, seed));
  }
  // cluster of drops
  {
    const F = new Field(T);
    for (let i = 0; i < 26; i++) { const a = R(0, 6.283), d = Math.pow(rnd(), 0.7) * 0.72; F.blob(Math.cos(a) * d, Math.sin(a) * d, R(0.02, 0.1) * (1 - d * 0.5)); }
    paintTile(data, size, DT.DROPS, bloodFromField(F, 4));
  }
  // big irregular splat with tendrils
  {
    const F = new Field(T);
    F.blob(R(-0.05, 0.05), R(-0.05, 0.05), 0.36);
    for (let i = 0; i < 7; i++) { const a = R(0, 6.283), d = R(0.2, 0.4); F.blob(Math.cos(a) * d, Math.sin(a) * d, R(0.1, 0.18)); }
    for (let i = 0; i < 10; i++) {
      const a = R(0, 6.283), l = R(0.55, 0.82);
      const bend = R(-0.25, 0.25);
      const mx = Math.cos(a + bend) * l * 0.6, my = Math.sin(a + bend) * l * 0.6;
      F.cap(Math.cos(a) * 0.25, Math.sin(a) * 0.25, mx, my, 0.08, 0.05);
      F.cap(mx, my, Math.cos(a) * l, Math.sin(a) * l, 0.05, 0.025);
    }
    for (let i = 0; i < 20; i++) { const a = R(0, 6.283), d = R(0.5, 0.88); F.blob(Math.cos(a) * d, Math.sin(a) * d, R(0.01, 0.035)); }
    paintTile(data, size, DT.SPLAT_BIG, bloodFromField(F, 5));
  }
  // smear with drips
  {
    const F = new Field(T);
    let x = -0.75, y = 0, w = 0.2;
    for (let i = 0; i < 10; i++) {
      const nx = x + 0.15, ny = y + R(-0.04, 0.04), nw = Math.max(0.06, w * R(0.85, 1.05));
      F.cap(x, y, nx, ny, w, nw);
      if (rnd() < 0.35) F.cap(nx, ny, nx + R(-0.03, 0.03), ny - R(0.15, 0.4), 0.06, 0.035);
      x = nx; y = ny; w = nw;
    }
    for (let i = 0; i < 12; i++) F.blob(R(-0.7, 0.8), R(-0.5, 0.5), R(0.01, 0.03));
    paintTile(data, size, DT.SMEAR, bloodFromField(F, 6));
  }
  // pools: smooth big blobs
  for (const [tile, seed] of [[DT.POOL_A, 7], [DT.POOL_B, 8]] as [number, number][]) {
    const F = new Field(T);
    F.blob(0, 0, 0.58);
    for (let i = 0; i < 8; i++) { const a = R(0, 6.283), d = R(0.3, 0.46); F.blob(Math.cos(a) * d, Math.sin(a) * d, R(0.22, 0.34)); }
    for (let i = 0; i < 5; i++) { const a = R(0, 6.283), d = R(0.66, 0.76); F.blob(Math.cos(a) * d, Math.sin(a) * d, R(0.05, 0.1)); }
    paintTile(data, size, tile, bloodFromField(F, seed, true));
  }
  // single drops
  {
    const F = new Field(T);
    F.blob(0, 0, 0.32);
    for (let i = 0; i < 5; i++) { const a = R(0, 6.283), d = R(0.45, 0.7); F.blob(Math.cos(a) * d, Math.sin(a) * d, R(0.03, 0.07)); }
    paintTile(data, size, DT.DROP_A, bloodFromField(F, 9));
    const G = new Field(T);
    G.blob(0, 0, 0.28);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.283 + R(-0.1, 0.1), l = R(0.35, 0.55); G.cap(0, 0, Math.cos(a) * l, Math.sin(a) * l, 0.1, 0.04); G.blob(Math.cos(a) * (l + 0.06), Math.sin(a) * (l + 0.06), R(0.02, 0.04)); }
    paintTile(data, size, DT.DROP_B, bloodFromField(G, 10));
  }

  const t = new THREE.DataTexture(new Uint8Array(data.buffer), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}
