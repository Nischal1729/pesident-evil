/**
 * Pure-JS DSP toolkit for Pesident Evil's procedural audio.
 *
 * Everything here works on raw Float32Arrays and is deterministic given an Rng seed.
 * It produces *source material* (noise, modal resonances, glottal voice pulses, bird
 * phrases, impulse responses, seamless loop beds) that the WebAudio graphs in
 * `synth.ts` / `ambience.ts` / `music.ts` then filter, envelope, distort and mix.
 */

export type F32 = Float32Array<ArrayBuffer>;
export const TAU = Math.PI * 2;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/* ------------------------------------------------------------------ RNG -- */

/** Small, fast, seedable PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Integer in [a, b] inclusive. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length] as T;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Uniform in [-1, 1). */
  bi(): number {
    return this.next() * 2 - 1;
  }
  /** Approximately standard-normal (Irwin–Hall with 4 terms). */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }
}

/* ---------------------------------------------------------------- noise -- */

export function white(n: number, rng: Rng): F32 {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng.next() * 2 - 1;
  return a;
}

/** Pink noise (Paul Kellet's refined filter), roughly unit peak. */
export function pink(n: number, rng: Rng): F32 {
  const a = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return a;
}

/** Brown (red) noise via a leaky integrator, roughly unit peak. */
export function brown(n: number, rng: Rng): F32 {
  const a = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rng.next() * 2 - 1)) / 1.02;
    a[i] = last * 3.5;
  }
  return a;
}

/* -------------------------------------------------------------- filters -- */

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'notch';

/** RBJ-cookbook biquad in transposed direct form II. Bandpass is 0 dB peak gain. */
export class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  private z1 = 0; private z2 = 0;

  constructor(kind?: BiquadKind, f = 1000, q = 0.7071, sr = 48000, gainDb = 0) {
    if (kind) this.set(kind, f, q, sr, gainDb);
  }

  set(kind: BiquadKind, f: number, q: number, sr: number, gainDb = 0): this {
    const w = (TAU * clamp(f, 5, sr * 0.49)) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(0.05, q));
    const A = Math.pow(10, gainDb / 40);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (kind) {
      case 'lowpass':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1; b1 = -2 * cw; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'peaking':
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }

  tick(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  process(buf: F32): F32 {
    for (let i = 0; i < buf.length; i++) buf[i] = this.tick(buf[i]!);
    return buf;
  }

  reset(): void {
    this.z1 = this.z2 = 0;
  }
}

/** One-pole smoothing coefficient for cutoff f. */
export function onePole(f: number, sr: number): number {
  return 1 - Math.exp((-TAU * f) / sr);
}

/**
 * Filter a buffer that is meant to loop: run the chain twice so the filter state at
 * sample 0 equals the state after the final sample, so the loop point has no seam.
 */
export function filterCircular(buf: F32, chain: Biquad[]): F32 {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < buf.length; i++) {
      let x = buf[i]!;
      for (const f of chain) x = f.tick(x);
      if (pass === 1) buf[i] = x;
    }
  }
  return buf;
}

/* ---------------------------------------------------------- utilities -- */

export function peak(buf: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > p) p = a;
  }
  return p;
}

export function rms(buf: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
  return Math.sqrt(s / Math.max(1, buf.length));
}

export function scale(buf: F32, g: number): F32 {
  for (let i = 0; i < buf.length; i++) buf[i]! *= g;
  return buf;
}

export function normalize(buf: F32, target = 1): F32 {
  const p = peak(buf);
  return p > 1e-9 ? scale(buf, target / p) : buf;
}

/** Add `src` into `dst` starting at sample `at`, scaled by g. If `wrap`, writes modulo length. */
export function mixInto(dst: F32, src: ArrayLike<number>, at: number, g = 1, wrap = false): void {
  const n = dst.length;
  for (let i = 0; i < src.length; i++) {
    let j = at + i;
    if (wrap) j = ((j % n) + n) % n;
    else if (j < 0 || j >= n) continue;
    dst[j]! += src[i]! * g;
  }
}

/** Replace NaN / ±Inf with 0. Returns how many samples were bad. */
export function sanitize(buf: F32): number {
  let bad = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]!;
    if (!Number.isFinite(v)) {
      buf[i] = 0;
      bad++;
    }
  }
  return bad;
}

/** Equal-power crossfade-loop: returns a buffer of length (n - fade) that loops seamlessly. */
export function loopCrossfade(ch: F32, fade: number): F32 {
  const n = ch.length - fade;
  const out = ch.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const a = (i / fade) * (Math.PI / 2);
    out[i] = ch[i]! * Math.sin(a) + ch[n + i]! * Math.cos(a);
  }
  return out;
}

/**
 * Smooth random function that is periodic over `period` seconds (random Fourier series
 * with integer harmonics), returning roughly [-1, 1]. Perfect for loop-safe modulation.
 */
export function periodicLfo(rng: Rng, period: number, harmonics: number, tilt = 1): (t: number) => number {
  const amps: number[] = [];
  const phases: number[] = [];
  const ks: number[] = [];
  let norm = 0;
  for (let k = 1; k <= harmonics; k++) {
    const a = rng.range(0.4, 1) / Math.pow(k, tilt);
    amps.push(a);
    phases.push(rng.range(0, TAU));
    ks.push(k);
    norm += a;
  }
  const w = TAU / period;
  return (t: number) => {
    let s = 0;
    for (let i = 0; i < ks.length; i++) s += amps[i]! * Math.sin(w * ks[i]! * t + phases[i]!);
    return (s / norm) * 1.6;
  };
}

/* ------------------------------------------------------ modal synthesis -- */

export interface Mode {
  f: number;
  amp: number;
  /** Seconds for amplitude to fall to 1/e. */
  decay: number;
}

/**
 * Bank of two-pole resonators excited by `excite` (default: unit impulse). Great for
 * metal clanks, wood knocks, bells, membranes. Output is *not* normalised.
 */
export function modal(n: number, sr: number, modes: readonly Mode[], excite?: ArrayLike<number>, offset = 0): F32 {
  const out = new Float32Array(n);
  const ex: ArrayLike<number> = excite ?? [1];
  for (const m of modes) {
    if (!(m.f > 0) || m.f >= sr * 0.46 || m.amp === 0) continue;
    const w = (TAU * m.f) / sr;
    const r = Math.exp(-1 / (Math.max(1e-4, m.decay) * sr));
    const c1 = 2 * r * Math.cos(w);
    const c2 = -r * r;
    const gIn = m.amp * Math.sin(w);
    let y1 = 0, y2 = 0;
    const exLen = ex.length;
    for (let i = offset; i < n; i++) {
      const k = i - offset;
      const x = k < exLen ? ex[k]! * gIn : 0;
      const y = c1 * y1 + c2 * y2 + x;
      y2 = y1;
      y1 = y;
      out[i]! += y;
      if (k > exLen && y1 < 1e-7 && y1 > -1e-7 && y2 < 1e-7 && y2 > -1e-7) break;
    }
  }
  return out;
}

/** Short exponentially-decaying noise burst, used to excite modal banks. */
export function burstExcite(sr: number, ms: number, rng: Rng, color: 'white' | 'soft' = 'white'): F32 {
  const n = Math.max(1, Math.round((ms / 1000) * sr));
  const a = new Float32Array(n);
  let lp = 0;
  const k = color === 'soft' ? 0.25 : 1;
  for (let i = 0; i < n; i++) {
    const e = Math.exp((-4 * i) / n);
    const w = rng.bi();
    lp += (w - lp) * k;
    a[i] = lp * e;
  }
  return a;
}

/** Build modes from ratio / decay / amp arrays around a fundamental. */
export function modesFrom(f0: number, ratios: readonly number[], decay: number, rng?: Rng, spread = 0.015, decayPow = 0.6): Mode[] {
  return ratios.map((r, i) => ({
    f: f0 * r * (rng ? 1 + rng.bi() * spread : 1),
    amp: (rng ? rng.range(0.6, 1) : 1) / Math.pow(i + 1, 0.55),
    decay: decay / Math.pow(r, decayPow),
  }));
}

export const RATIOS = {
  /** Free-free bar (clicks, small metal parts). */
  bar: [1, 2.756, 5.404, 8.933, 13.34],
  /** Thin plate / gate panel (clangs). */
  plate: [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.6, 4.06],
  /** Wood block / bat willow. */
  wood: [1, 2.37, 3.95, 5.17, 6.9],
  /** Membrane (drum) modes, first few Bessel zeros ratios. */
  membrane: [1, 1.594, 2.136, 2.296, 2.653, 2.918],
  /** Tabla dayan — the syahi makes it nearly harmonic. */
  tabla: [1, 2, 3, 4, 5.02, 6.04],
  /** Small bell / bell gong for the college electric bell. */
  bell: [1, 1.52, 2.03, 2.71, 3.86, 5.14, 6.2],
} as const;

/* ----------------------------------------------------- glottal source -- */

export type Fn = number | ((u: number) => number);
const val = (f: Fn | undefined, u: number, dflt: number): number =>
  f === undefined ? dflt : typeof f === 'number' ? f : f(u);

function polyblep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export interface GlottalOpts {
  dur: number;
  /** f0 in Hz as a function of time in seconds. */
  f0: (t: number) => number;
  /** Fractional per-period pitch randomisation (0.01 human … 0.1 monstrous). */
  jitter?: Fn;
  /** Per-period amplitude randomisation. */
  shimmer?: Fn;
  /** Probability per period of a creaky, stretched, weak period (vocal fry). */
  fry?: Fn;
  /** Aspiration noise amount. */
  breath?: Fn;
  /** 0 = soft/dark closure, 1 = sharp/bright. */
  tilt?: Fn;
}

/**
 * Derivative-of-Rosenberg glottal pulse train with polyBLEP-smoothed closure, jitter,
 * shimmer, vocal fry and aspiration. Output roughly unit peak.
 */
export function glottal(sr: number, o: GlottalOpts, rng: Rng): F32 {
  const n = Math.ceil(o.dur * sr);
  const out = new Float32Array(n);
  let phase = 0;
  let pScale = 1;
  let amp = 1;
  let hpState = 0;
  const tp = 0.42;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = t / o.dur;
    const f = Math.max(18, o.f0(t)) / pScale;
    const dt = f / sr;
    const tilt = clamp(val(o.tilt, u, 0.5), 0, 1);
    const tn = Math.max(3 * dt, lerp(0.34, 0.08, tilt));
    const pc = Math.min(0.97, tp + tn);
    const p = phase;
    let s: number;
    if (p < tp) s = ((Math.PI / (2 * tp)) * Math.sin((Math.PI * p) / tp)) / (Math.PI / (2 * tn));
    else if (p < pc) s = -Math.sin((Math.PI * (p - tp)) / (2 * tn));
    else s = 0;
    let q = p - pc;
    if (q < 0) q += 1;
    s += 0.5 * polyblep(q, dt);

    const br = val(o.breath, u, 0);
    let nz = 0;
    if (br > 0) {
      const w = rng.next() * 2 - 1;
      hpState += (w - hpState) * 0.08;
      nz = (w - hpState) * br * (p < pc ? 1 : 0.4);
    }
    out[i] = amp * s + nz;

    phase += dt;
    if (phase >= 1) {
      phase -= 1;
      const j = val(o.jitter, u, 0.01);
      const sh = val(o.shimmer, u, 0.05);
      const fr = val(o.fry, u, 0);
      pScale = 1 + j * rng.gauss();
      amp = Math.max(0.05, 1 + sh * rng.gauss());
      if (fr > 0 && rng.next() < fr) {
        pScale *= rng.range(1.25, 2.3);
        amp *= rng.range(0.35, 1);
      }
      pScale = clamp(pScale, 0.5, 3.2);
    }
  }
  return out;
}

/* ------------------------------------------------------------ formants -- */

export type Vowel = 'a' | 'aa' | 'o' | 'u' | 'e' | 'i' | 'uh' | 'er' | 'ae';

export const VOWELS: Record<Vowel, readonly [number, number, number, number]> = {
  a: [730, 1090, 2440, 3400],
  aa: [850, 1220, 2810, 3800],
  o: [570, 840, 2410, 3300],
  u: [300, 870, 2240, 3200],
  e: [530, 1840, 2480, 3500],
  i: [270, 2290, 3010, 3700],
  uh: [640, 1190, 2390, 3400],
  er: [490, 1350, 1690, 3000],
  ae: [660, 1720, 2410, 3400],
};
const FORMANT_BW = [90, 110, 170, 250];
const FORMANT_AMP = [1, 0.7, 0.4, 0.22];

/** Interpolate formant frequencies along vowel keyframes (u in 0..1), in log-frequency. */
export function vowelAt(keys: ReadonlyArray<readonly [number, Vowel]>, u: number): number[] {
  if (keys.length === 0) return [...VOWELS.uh];
  if (u <= keys[0]![0]) return [...VOWELS[keys[0]![1]]];
  for (let k = 1; k < keys.length; k++) {
    const [u1, v1] = keys[k]!;
    if (u <= u1) {
      const [u0, v0] = keys[k - 1]!;
      const t = u1 > u0 ? (u - u0) / (u1 - u0) : 1;
      const A = VOWELS[v0], B = VOWELS[v1];
      return A.map((a, i) => Math.exp(lerp(Math.log(a), Math.log(B[i]!), t)));
    }
  }
  return [...VOWELS[keys[keys.length - 1]![1]]];
}

export interface FormantOpts {
  vowels: ReadonlyArray<readonly [number, Vowel]>;
  /** Vocal-tract scale: <1 = bigger / deeper creature, >1 = smaller. */
  vt?: number;
  /** Bandwidth multiplier (bigger = hoarser, less vowel-y). */
  bw?: number;
  /** Mix of low-passed "chest" source added underneath. */
  chest?: number;
}

/** Time-varying 4-formant parallel bandpass filter bank. Output normalised to unit peak. */
export function formantFilter(src: F32, sr: number, o: FormantOpts): F32 {
  const n = src.length;
  const out = new Float32Array(n);
  const fs = [0, 1, 2, 3].map(() => new Biquad());
  const vt = o.vt ?? 1;
  const bw = o.bw ?? 1;
  const chest = new Biquad('lowpass', 320, 0.8, sr);
  const chestAmt = o.chest ?? 0.25;
  const BLOCK = 32;
  for (let b = 0; b < n; b += BLOCK) {
    const F = vowelAt(o.vowels, b / n);
    for (let k = 0; k < 4; k++) {
      const fc = F[k]! * vt;
      fs[k]!.set('bandpass', fc, fc / (FORMANT_BW[k]! * bw), sr);
    }
    const end = Math.min(n, b + BLOCK);
    for (let i = b; i < end; i++) {
      const x = src[i]!;
      let y = 0;
      for (let k = 0; k < 4; k++) y += FORMANT_AMP[k]! * fs[k]!.tick(x);
      out[i] = y * 3 + chest.tick(x) * chestAmt;
    }
  }
  return normalize(out);
}

/** Wet "bubbling" gurgle: a stream of tiny rising-pitch damped sinusoids (Minnaert bubbles). */
export function gurgle(sr: number, dur: number, rate: number, rng: Rng, fLo = 140, fHi = 520): F32 {
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const count = Math.round(rate * dur);
  for (let b = 0; b < count; b++) {
    const at = Math.floor(rng.next() * n);
    const f = rng.range(fLo, fHi);
    const len = Math.floor(sr * rng.range(0.012, 0.035));
    const a = rng.range(0.3, 1);
    let ph = 0;
    for (let i = 0; i < len && at + i < n; i++) {
      const tt = i / len;
      const fi = f * (1 + 0.8 * tt);
      ph += (TAU * fi) / sr;
      out[at + i]! += Math.sin(ph) * a * Math.exp(-4 * tt) * Math.min(1, i / 20);
    }
  }
  return normalize(out);
}

/* --------------------------------------------------------- reverb IRs -- */

export interface IrOpts {
  /** RT60 in seconds. */
  decay: number;
  /** Lowpass cutoff at the start / end of the tail (air + surfaces absorb highs). */
  lpStart?: number;
  lpEnd?: number;
  predelay?: number;
  /** Discrete early reflections [seconds, gain]. */
  early?: ReadonlyArray<readonly [number, number]>;
  channels?: 1 | 2;
}

/** Procedural impulse response: early reflections + exponentially-decaying, darkening diffuse tail. */
export function impulseResponse(sr: number, seconds: number, rng: Rng, o: IrOpts): F32[] {
  const n = Math.ceil(seconds * sr);
  const chans: F32[] = [];
  const nch = o.channels ?? 2;
  const lp0 = o.lpStart ?? 9000;
  const lp1 = o.lpEnd ?? 1500;
  const pre = Math.floor((o.predelay ?? 0.008) * sr);
  for (let c = 0; c < nch; c++) {
    const a = new Float32Array(n);
    let s1 = 0;
    let s2 = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.91 * t) / o.decay) * Math.min(1, t / 0.025);
      const fc = Math.exp(lerp(Math.log(lp0), Math.log(lp1), clamp(t / o.decay, 0, 1)));
      const k = onePole(fc, sr);
      const w = rng.bi();
      s1 += (w - s1) * k;
      s2 += (s1 - s2) * k;
      a[i] = s2 * env;
    }
    if (o.early) {
      for (const [et, eg] of o.early) {
        const j = pre + Math.floor((et + rng.range(-0.0015, 0.0015)) * sr);
        if (j >= 0 && j < n - 4) {
          const sgn = rng.chance(0.5) ? 1 : -1;
          a[j]! += eg * sgn;
          a[j + 1]! += eg * sgn * 0.5;
          a[j + 2]! += eg * sgn * 0.2;
        }
      }
    }
    normalize(a, 0.5);
    chans.push(a);
  }
  return chans;
}

/* --------------------------------------------------------- analysis -- */

export interface BufferStats {
  duration: number;
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  bad: number;
}

export function bufferStats(b: AudioBuffer): BufferStats {
  let p = 0, s = 0, bad = 0, count = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i]!;
      if (!Number.isFinite(v)) {
        bad++;
        continue;
      }
      const a = Math.abs(v);
      if (a > p) p = a;
      s += v * v;
      count++;
    }
  }
  const r = Math.sqrt(s / Math.max(1, count));
  return {
    duration: b.duration,
    peak: p,
    peakDb: 20 * Math.log10(p + 1e-12),
    rms: r,
    rmsDb: 20 * Math.log10(r + 1e-12),
    bad,
  };
}
