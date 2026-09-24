/**
 * Bengaluru campus ambience: Outer Ring Road traffic, auto / bike / BMTC horns, mynas,
 * crows, sparrows, wind in the rain trees by day; crickets, far dogs and sirens by night.
 *
 * Continuous beds are generated in JS as *seamless* loops (circular filtering, periodic
 * modulation and wrap-around event writing), then looped live. One-shot events are
 * pre-rendered offline and played at world positions (horns out on the ring road to the
 * north-east, birds in the trees around the listener, dogs far away).
 */
import {
  Biquad,
  type F32,
  Rng,
  TAU,
  type Vowel,
  brown,
  clamp,
  filterCircular,
  mixInto,
  normalize,
  periodicLfo,
  pink,
  smoothstep,
  white,
} from './dsp';
import { pool, postProcess, renderOffline, toBuffer } from './render';
import {
  type RCtx,
  chain,
  filter,
  gain,
  keys,
  noise,
  osc,
  sendReverb,
  shaper,
  src,
  voice,
} from './synth';

export type AmbienceKind = 'day' | 'dusk' | 'night';

type EventKind = 'horn' | 'vehicle' | 'myna' | 'crow' | 'chirp' | 'bark' | 'siren' | 'scream';

interface KindConfig {
  traffic: number;
  trafficLp: number;
  wind: number;
  crickets: number;
  /** Events per minute. */
  rates: Record<EventKind, number>;
}

const CONFIGS: Record<AmbienceKind, KindConfig> = {
  day: {
    traffic: 0.18, trafficLp: 1000, wind: 0.16, crickets: 0,
    rates: { horn: 8, vehicle: 5, myna: 5, crow: 3, chirp: 7, bark: 0.5, siren: 0, scream: 0 },
  },
  dusk: {
    traffic: 0.22, trafficLp: 800, wind: 0.13, crickets: 0.08,
    rates: { horn: 10, vehicle: 6, myna: 3, crow: 7, chirp: 3, bark: 1, siren: 0.25, scream: 0.15 },
  },
  night: {
    traffic: 0.08, trafficLp: 420, wind: 0.1, crickets: 0.24,
    rates: { horn: 0.8, vehicle: 1.2, myna: 0, crow: 0.3, chirp: 0, bark: 3, siren: 0.8, scream: 0.7 },
  },
};

type Place = 'road' | 'trees' | 'far';

interface EventDef {
  variants: number;
  dur: number;
  build?: (c: RCtx) => void;
  level: number;
  ref: number;
  dist: readonly [number, number];
  place: Place;
  minGap: number;
  doppler?: number;
  /** Metres/second the source travels along the road while playing. */
  move?: number;
}

const EVENT_SR = 32000;

/* ------------------------------------------------------------ JS beds -- */

/** Outer Ring Road rumble: engines, tyres, passing swells, idling diesel BMTC tones. */
function trafficBed(sr: number, L: number, rng: Rng): F32[] {
  const n = Math.floor(L * sr);
  const out: F32[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const rum = brown(n, rng);
    filterCircular(rum, [new Biquad('lowpass', 260, 0.6, sr), new Biquad('highpass', 28, 0.6, sr)]);
    normalize(rum);
    const hiss = white(n, rng);
    filterCircular(hiss, [new Biquad('bandpass', 850, 0.6, sr), new Biquad('lowpass', 2500, 0.7, sr)]);
    normalize(hiss);
    const swell = periodicLfo(rng, L, 14, 0.6);
    const swell2 = periodicLfo(rng, L, 8, 0.8);
    const drone = periodicLfo(rng, L, 3, 1);
    const tones = [41, 62, 83, 124].map((f0) => ({
      f: Math.round(f0 * L * rng.range(0.97, 1.03)) / L,
      a: rng.range(0.03, 0.07),
      p: rng.range(0, TAU),
    }));
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const s = clamp(0.62 + 0.38 * swell(t), 0.15, 1.2);
      const h = clamp(0.5 + 0.5 * swell2(t), 0, 1.2);
      let x = rum[i]! * s + hiss[i]! * 0.22 * h * s;
      const dg = 0.6 + 0.4 * drone(t);
      for (const tn of tones) x += tn.a * dg * Math.sin(TAU * tn.f * t + tn.p);
      d[i] = x;
    }
    out.push(d);
  }
  let p = 1e-9;
  for (const c of out) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]!));
  for (const c of out) for (let i = 0; i < c.length; i++) c[i]! *= 0.9 / p;
  return out;
}

/** Wind moving through the rain trees + leaf rustle, gusting on a loop-periodic envelope. */
function windBed(sr: number, L: number, rng: Rng): F32[] {
  const n = Math.floor(L * sr);
  const gust = periodicLfo(rng, L, 6, 1);
  const tone = periodicLfo(rng, L, 3, 1);
  const g = (t: number) => clamp(0.45 + 0.55 * gust(((t % L) + L) % L), 0.05, 1);
  const out: F32[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const lo = pink(n, rng);
    filterCircular(lo, [new Biquad('bandpass', 330, 0.6, sr)]);
    normalize(lo);
    const hi = pink(n, rng);
    filterCircular(hi, [new Biquad('bandpass', 820, 0.8, sr)]);
    normalize(hi);
    const leaves = white(n, rng);
    filterCircular(leaves, [new Biquad('highpass', 2200, 0.7, sr), new Biquad('lowpass', 9000, 0.7, sr)]);
    normalize(leaves);
    const d = new Float32Array(n);
    let grain = 0;
    let target = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const gg = g(t + ch * 0.13);
      const mix = 0.5 + 0.5 * tone(t);
      if (i % 120 === 0) target = rng.next() < 0.35 + gg * 0.5 ? rng.range(0.4, 1) : 0.1;
      grain += (target - grain) * 0.01;
      const lg = g(t - 0.45);
      d[i] = (lo[i]! * (1 - mix) + hi[i]! * mix) * Math.pow(gg, 1.3) * 0.8 + leaves[i]! * 0.3 * lg * lg * grain;
    }
    out.push(d);
  }
  let p = 0;
  for (const c of out) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]!));
  for (const c of out) for (let i = 0; i < c.length; i++) c[i]! *= 0.9 / p;
  return out;
}

/** Field crickets (near, panned), a far chorus, and a continuous mole-cricket trill. */
function cricketBed(sr: number, L: number, rng: Rng): F32[] {
  const n = Math.floor(L * sr);
  const Lc = new Float32Array(n);
  const Rc = new Float32Array(n);
  const addCricket = (amp: number, fLo: number, fHi: number): void => {
    const fc = rng.range(fLo, fHi);
    const pulseRate = rng.range(28, 42);
    const pulses = rng.int(3, 5);
    const period = L / Math.max(1, Math.round(L / rng.range(0.4, 0.9)));
    const count = Math.round(L / period);
    const pan = rng.bi() * 0.9;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * amp;
    const gr = Math.sin(((pan + 1) * Math.PI) / 4) * amp;
    const plen = Math.floor((0.62 / pulseRate) * sr);
    const offset = rng.range(0, period);
    const pulse = new Float32Array(plen);
    for (let m = 0; m < count; m++) {
      const tc = offset + m * period + rng.range(-0.008, 0.008);
      for (let p = 0; p < pulses; p++) {
        const a = p === pulses - 1 ? 0.7 : 1;
        const ph = rng.range(0, TAU);
        for (let i = 0; i < plen; i++) {
          const e = Math.sin((Math.PI * i) / plen);
          const w = (TAU * fc * i) / sr + ph;
          pulse[i] = (Math.sin(w) + 0.12 * Math.sin(2 * w)) * e * e * a;
        }
        const at = Math.floor((tc + p / pulseRate) * sr);
        mixInto(Lc, pulse, at, gl, true);
        mixInto(Rc, pulse, at, gr, true);
      }
    }
  };
  for (let k = 0; k < 7; k++) addCricket(rng.range(0.35, 1), 4300, 5300);
  for (let k = 0; k < 18; k++) addCricket(rng.range(0.06, 0.16), 3700, 4800);
  // continuous trill (loop-exact pulse rate)
  const rate = Math.round(48 * L) / L;
  const tf = Math.round(3100 * L) / L;
  const wob = periodicLfo(rng, L, 2, 1);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const pp = (t * rate) % 1;
    const e = pp < 0.55 ? Math.sin((Math.PI * pp) / 0.55) : 0;
    const s = Math.sin(TAU * tf * t) * e * e * 0.1 * (0.7 + 0.3 * wob(t));
    Lc[i]! += s * 0.8;
    Rc[i]! += s * 0.6;
  }
  let p = 1e-9;
  for (const c of [Lc, Rc]) for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(c[i]!));
  for (const c of [Lc, Rc]) for (let i = 0; i < n; i++) c[i]! *= 0.9 / p;
  return [Lc, Rc];
}

/* ------------------------------------------------------- bird phrases -- */

function birdPhrase(sr: number, rng: Rng, style: 'myna' | 'chirp' | 'bulbul'): F32 {
  const n = Math.floor(2.8 * sr);
  const out = new Float32Array(n);
  let t = 0.02;
  const note = (len: number, fn: (u: number, tt: number) => number): void => {
    const L = Math.floor(len * sr);
    const at = Math.floor(t * sr);
    const att = Math.max(1, Math.floor(0.005 * sr));
    const rel = Math.max(1, Math.floor(0.012 * sr));
    for (let i = 0; i < L && at + i < n; i++) {
      const e = Math.min(1, i / att, (L - i) / rel);
      out[at + i]! += fn(i / L, i / sr) * e;
    }
    t += len;
  };
  const tone = (f1: number, f2: number, len: number, fm = 0, fmRate = 0, h2 = 0.2): void => {
    let ph = 0;
    note(len, (u, tt) => {
      const f = f1 + (f2 - f1) * u + fm * Math.sin(TAU * fmRate * tt);
      ph += (TAU * f) / sr;
      return Math.sin(ph) + h2 * Math.sin(2 * ph);
    });
  };
  if (style === 'myna') {
    const count = rng.int(5, 10);
    for (let k = 0; k < count && t < 2.4; k++) {
      const kind = rng.pick(['whistle', 'whistle', 'trill', 'chuck', 'gurgle', 'squawk'] as const);
      if (kind === 'whistle') tone(rng.range(1500, 3500), rng.range(1200, 4000), rng.range(0.06, 0.2));
      else if (kind === 'trill') tone(rng.range(2000, 3000), rng.range(2000, 3000), rng.range(0.12, 0.2), rng.range(300, 600), rng.range(35, 55));
      else if (kind === 'chuck') {
        const f = rng.range(1300, 1800);
        note(rng.range(0.03, 0.05), (_u, tt) =>
          (Math.sin(TAU * f * tt) * Math.exp(-tt / 0.01) + 0.6 * Math.sin(TAU * f * 1.55 * tt) * Math.exp(-tt / 0.008) + 0.4 * rng.bi() * Math.exp(-tt / 0.004)) * 1.2);
      } else if (kind === 'gurgle') {
        const f = rng.range(1200, 1800);
        const am = rng.range(70, 90);
        let ph = 0;
        note(rng.range(0.1, 0.15), (u, tt) => {
          ph += (TAU * f * (1 + 0.1 * Math.sin(TAU * 9 * tt))) / sr;
          return Math.sin(ph) * (0.5 + 0.5 * Math.sin(TAU * am * tt)) * (1 - 0.3 * u);
        });
      } else {
        const f0 = rng.range(700, 900);
        let ph = 0;
        note(rng.range(0.1, 0.16), (u) => {
          ph += (TAU * f0 * (1 - 0.25 * u)) / sr;
          let s = 0;
          for (let h = 1; h <= 8; h++) s += Math.sin(h * ph) / h;
          return (s * 0.6 + rng.bi() * 0.3) * 0.8;
        });
      }
      t += rng.range(0.03, 0.15);
    }
  } else if (style === 'chirp') {
    const count = rng.int(3, 7);
    for (let k = 0; k < count; k++) {
      const up = rng.chance(0.6);
      tone(up ? rng.range(2800, 3600) : rng.range(5000, 6000), up ? rng.range(5000, 6200) : rng.range(3000, 3800), rng.range(0.03, 0.06), 0, 0, 0.1);
      t += rng.range(0.05, 0.12);
    }
  } else {
    const count = rng.int(3, 5);
    let f = rng.range(1500, 2200);
    for (let k = 0; k < count; k++) {
      const f2 = clamp(f * rng.range(0.8, 1.3), 1300, 2800);
      tone(f, f2, rng.range(0.12, 0.25), f * 0.02, 6, 0.3);
      f = f2;
      t += rng.range(0.03, 0.08);
    }
  }
  return normalize(out, 0.9);
}

/* ------------------------------------------------------ event recipes -- */

const DIST_EARLY: ReadonlyArray<readonly [number, number]> = [[0.05, 0.4], [0.11, 0.3], [0.19, 0.25], [0.3, 0.15], [0.45, 0.08]];

function hornBuild(c: RCtx): void {
  const r = c.rng;
  const t = 0.01;
  const pre = gain(c, 1);
  const dist = filter(c, 'lowpass', 3200, 0.6);
  chain(pre, shaper(c, 2.5, 0.1), filter(c, 'bandpass', 1400, 0.6), dist, c.out);
  sendReverb(c, dist, c.out, 0.45, { secs: 2.2, decay: 1.8, lpStart: 3000, lpEnd: 600, early: DIST_EARLY });
  const kind = c.v < 2 ? 'auto' : c.v < 4 ? 'bike' : 'bus';
  let f: number;
  let ratios: number[];
  let toots: number;
  let lenR: [number, number];
  let gapR: [number, number];
  let type: OscillatorType = 'square';
  if (kind === 'auto') {
    f = r.range(430, 520); ratios = [1, 1.19]; toots = r.int(1, 3); lenR = [0.1, 0.3]; gapR = [0.07, 0.14];
  } else if (kind === 'bike') {
    f = r.range(560, 700); ratios = [1, 1.26]; toots = r.int(2, 3); lenR = [0.07, 0.14]; gapR = [0.05, 0.1];
  } else {
    f = r.range(300, 360); ratios = [1, 1.26, 1.5]; toots = r.int(1, 2); lenR = [0.4, 0.8]; gapR = [0.12, 0.2]; type = 'sawtooth';
  }
  let tt = t;
  const seq: Array<[number, number]> = [];
  for (let k = 0; k < toots; k++) {
    const len = r.range(lenR[0], lenR[1]);
    seq.push([tt, len]);
    tt += len + r.range(gapR[0], gapR[1]);
  }
  const total = tt - t;
  const dop = kind === 'bus' ? 0.01 : 0.025;
  for (const [st, len] of seq) {
    const u0 = (st - t) / total;
    const u1 = (st + len - t) / total;
    for (const ra of ratios) {
      const o = osc(c, type, f * ra, st, len + 0.03);
      o.frequency.setValueAtTime(f * ra * (1 + dop - 2 * dop * u0), st);
      o.frequency.linearRampToValueAtTime(f * ra * (1 + dop - 2 * dop * u1), st + len);
      const g = gain(c, 0);
      keys(g.gain, st, [[0, 0], [0.012, 0.4], [len - 0.015, 0.36], [len, 0]]);
      chain(o, g, pre);
    }
  }
}

function vehicleBuild(c: RCtx): void {
  const r = c.rng;
  const D = 4.6;
  const t = 0.02;
  const bell = new Float32Array(256);
  for (let i = 0; i < 256; i++) bell[i] = Math.pow(Math.sin((Math.PI * i) / 255), 2.2);
  const dopCurve = (f: number, amt: number): Float32Array => {
    const a = new Float32Array(128);
    for (let i = 0; i < 128; i++) a[i] = f * (1 - amt * Math.tanh(((i / 127) * 2 - 1) * 3));
    return a;
  };
  const env = gain(c, 0);
  env.gain.setValueCurveAtTime(bell, t, D);
  const dist = filter(c, 'lowpass', 2000, 0.6);
  chain(env, dist, c.out);
  sendReverb(c, dist, c.out, 0.3, { secs: 1.8, decay: 1.4, lpStart: 2500, lpEnd: 500 });
  // tyre / body noise
  const nz = noise(c, t, D, 'brown');
  chain(nz, filter(c, 'lowpass', 600, 0.7), gain(c, 0.8), env);
  const hs = noise(c, t, D);
  chain(hs, filter(c, 'bandpass', 1100, 0.8), gain(c, 0.12), env);
  if (c.v === 0) {
    // auto-rickshaw: the LPG putter
    const o = osc(c, 'sawtooth', 26, t, D);
    o.frequency.setValueCurveAtTime(dopCurve(r.range(24, 30), 0.05), t, D);
    chain(o, filter(c, 'lowpass', 380, 2), shaper(c, 3), gain(c, 0.6), env);
    const w = osc(c, 'sawtooth', 110, t, D);
    w.frequency.setValueCurveAtTime(dopCurve(r.range(100, 120), 0.05), t, D);
    chain(w, filter(c, 'lowpass', 700, 1), gain(c, 0.12), env);
  } else if (c.v === 1) {
    // motorbike
    const f = r.range(45, 58);
    for (const h of [1, 2, 3]) {
      const o = osc(c, 'sawtooth', f * h, t, D);
      o.frequency.setValueCurveAtTime(dopCurve(f * h, 0.06), t, D);
      chain(o, filter(c, 'lowpass', 900, 1.2), gain(c, 0.3 / h), env);
    }
  } else {
    // car / BMTC bus diesel
    const f = c.v === 3 ? r.range(32, 38) : r.range(40, 50);
    const o = osc(c, c.v === 3 ? 'sawtooth' : 'sine', f, t, D);
    o.frequency.setValueCurveAtTime(dopCurve(f, 0.04), t, D);
    chain(o, filter(c, 'lowpass', 300, 1), gain(c, 0.5), env);
  }
}

function birdBuild(style: 'myna' | 'chirp' | 'bulbul') {
  return (c: RCtx): void => {
    const data = birdPhrase(c.sr, c.rng, style === 'chirp' && c.v === 2 ? 'bulbul' : style);
    const hp = filter(c, 'highpass', 900, 0.7);
    chain(src(c, data, 0.01), hp, c.out);
    sendReverb(c, hp, c.out, 0.2, { secs: 1.4, decay: 1.1, lpStart: 7000, lpEnd: 1500, early: DIST_EARLY });
  };
}

function crowBuild(c: RCtx): void {
  const r = c.rng;
  const pre = gain(c, 1);
  const hp = filter(c, 'highpass', 400, 0.7);
  chain(pre, hp, c.out);
  sendReverb(c, hp, c.out, 0.25, { secs: 1.5, decay: 1.2, lpStart: 6000, lpEnd: 1200, early: DIST_EARLY });
  const count = [2, 3, 1][c.v % 3]!;
  for (let k = 0; k < count; k++) {
    const t = 0.02 + k * r.range(0.38, 0.6);
    const d = count === 1 ? r.range(0.35, 0.45) : r.range(0.2, 0.34);
    const base = r.range(520, 680);
    voice(c, t, pre, {
      dur: d,
      f0: (tt) => base * (1.05 - 0.2 * (tt / d)),
      vowels: [[0, 'a'], [1, 'aa']],
      vt: 1.45, bw: 2.2, chest: 0.05, jitter: 0.06, shimmer: 0.3, fry: 0.15, breath: 0.8, tilt: 0.8,
      amp: [[0, 0], [0.02, 1], [d * 0.6, 0.85], [d, 0]],
      drive: 3.5, lp: 5000,
    });
  }
}

function barkBuild(c: RCtx): void {
  const r = c.rng;
  const pre = gain(c, 1);
  const dist = filter(c, 'lowpass', 2200, 0.6);
  chain(pre, dist, c.out);
  sendReverb(c, dist, c.out, 0.6, { secs: 2.6, decay: 2.2, lpStart: 2500, lpEnd: 500, early: DIST_EARLY });
  if (c.v === 4) {
    const d = 1.8;
    voice(c, 0.02, pre, {
      dur: d,
      f0: (tt) => {
        const u = tt / d;
        return 480 * (1 + 0.35 * smoothstep(0, 0.3, u) - 0.2 * smoothstep(0.7, 1, u)) * (1 + 0.02 * Math.sin(TAU * 5.5 * tt));
      },
      vowels: [[0, 'u'], [0.3, 'o'], [0.8, 'o'], [1, 'u']],
      vt: 1.25, bw: 1.4, jitter: 0.02, shimmer: 0.1, breath: 0.3, tilt: 0.5,
      amp: [[0, 0], [0.15, 1], [1.4, 0.8], [d, 0]],
      drive: 1.8, lp: 4000,
    });
    return;
  }
  const count = r.int(2, 5);
  const vw: ReadonlyArray<readonly [number, Vowel]> = [[0, 'a'], [0.5, 'aa'], [1, 'uh']];
  for (let k = 0; k < count; k++) {
    const t = 0.02 + k * r.range(0.28, 0.5);
    const d = r.range(0.1, 0.17);
    const base = r.range(380, 560);
    voice(c, t, pre, {
      dur: d,
      f0: (tt) => base * (1.25 - 0.45 * (tt / d)),
      vowels: vw,
      vt: 1.3, bw: 1.8, jitter: 0.05, shimmer: 0.2, fry: 0.1, breath: 0.6, tilt: 0.7,
      amp: [[0, 0], [0.008, 1], [d * 0.4, 0.8], [d, 0]],
      drive: 4, lp: 4500,
    });
  }
}

function sirenBuild(c: RCtx): void {
  const r = c.rng;
  const L = 9;
  const P = r.range(3.5, 4.5);
  const N = 900;
  const curve = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * L;
    const ph = (t % P) / P;
    curve[i] = 650 + 700 * (ph < 0.35 ? smoothstep(0, 1, ph / 0.35) : 1 - smoothstep(0, 1, (ph - 0.35) / 0.65));
  }
  const t = 0.02;
  const o = osc(c, 'sawtooth', 650, t, L);
  o.frequency.setValueCurveAtTime(curve, t, L);
  const o2 = osc(c, 'triangle', 650, t, L);
  o2.frequency.setValueCurveAtTime(curve, t, L);
  o2.detune.value = 9;
  const env = gain(c, 0);
  keys(env.gain, t, [[0, 0], [1.5, 1], [L - 2, 1], [L, 0]]);
  const dist = filter(c, 'lowpass', 1600, 0.6);
  const pre = gain(c, 0.5);
  o.connect(pre);
  o2.connect(pre);
  chain(pre, filter(c, 'bandpass', 1100, 0.8), shaper(c, 2), env, dist, c.out);
  sendReverb(c, dist, c.out, 0.8, { secs: 3.5, decay: 3, lpStart: 2000, lpEnd: 400, early: DIST_EARLY });
}

const EVENTS: Record<EventKind, EventDef> = {
  horn: { variants: 6, dur: 3, build: hornBuild, level: 0.35, ref: 60, dist: [60, 170], place: 'road', minGap: 0.8, doppler: 0.01 },
  vehicle: { variants: 4, dur: 6, build: vehicleBuild, level: 0.35, ref: 50, dist: [50, 140], place: 'road', minGap: 2, move: 14 },
  myna: { variants: 4, dur: 3.2, build: birdBuild('myna'), level: 0.22, ref: 12, dist: [8, 40], place: 'trees', minGap: 2 },
  crow: { variants: 3, dur: 3, build: crowBuild, level: 0.3, ref: 15, dist: [10, 60], place: 'trees', minGap: 2.5 },
  chirp: { variants: 4, dur: 3, build: birdBuild('chirp'), level: 0.16, ref: 10, dist: [6, 30], place: 'trees', minGap: 1 },
  bark: { variants: 5, dur: 3.8, build: barkBuild, level: 0.35, ref: 60, dist: [60, 220], place: 'far', minGap: 3 },
  siren: { variants: 2, dur: 12.5, build: sirenBuild, level: 0.3, ref: 150, dist: [150, 400], place: 'road', minGap: 25, move: 10 },
  scream: { variants: 0, dur: 0, level: 0.25, ref: 70, dist: [70, 200], place: 'far', minGap: 8 },
};

/* ----------------------------------------------------------- engine -- */

export interface ListenerRef {
  x: number;
  y: number;
  z: number;
}

interface Bed {
  src: AudioBufferSourceNode;
  gain: GainNode;
  filter?: BiquadFilterNode;
}

export class Ambience {
  readonly output: GainNode;
  private readonly bedBus: GainNode;
  private readonly eventBus: GainNode;
  private beds: Partial<Record<'traffic' | 'wind' | 'crickets', Bed>> = {};
  private bedBuffers: Partial<Record<'traffic' | 'wind' | 'crickets', AudioBuffer>> = {};
  private events = new Map<EventKind, AudioBuffer[]>();
  private kind: AmbienceKind = 'day';
  private intensity = 1;
  private rates: Record<EventKind, number> = { ...CONFIGS.day.rates };
  private lastAt: Record<EventKind, number> = { horn: -99, vehicle: -99, myna: -99, crow: -99, chirp: -99, bark: -99, siren: -99, scream: -99 };
  private rng = new Rng((Date.now() ^ 0x5eed) >>> 0);
  private running = false;
  private active = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    private readonly listener: () => ListenerRef,
    private readonly screams: () => AudioBuffer[],
    private readonly reverbIn: AudioNode | null,
  ) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.output.connect(dest);
    this.bedBus = ctx.createGain();
    this.bedBus.connect(this.output);
    this.eventBus = ctx.createGain();
    this.eventBus.connect(this.output);
  }

  /** Generate loop beds and render event variants. */
  async prepare(onProgress?: (done: number, total: number) => void): Promise<void> {
    const sr = this.ctx.sampleRate;
    const rng = new Rng(2024);
    this.bedBuffers.traffic = toBuffer(this.ctx, trafficBed(16000, 16, rng), 16000);
    this.bedBuffers.wind = toBuffer(this.ctx, windBed(24000, 16, rng), 24000);
    this.bedBuffers.crickets = toBuffer(this.ctx, cricketBed(32000, 8, rng), 32000);
    const kinds = (Object.keys(EVENTS) as EventKind[]).filter((k) => EVENTS[k].variants > 0);
    const jobs: Array<() => Promise<void>> = [];
    let seed = 9001;
    for (const k of kinds) {
      const def = EVENTS[k];
      const raw: AudioBuffer[] = [];
      for (let v = 0; v < def.variants; v++) {
        const s = seed++;
        jobs.push(async () => {
          raw[v] = await renderOffline({ dur: def.dur, seed: s * 131, v, sr: Math.min(sr, EVENT_SR), build: def.build! });
          if (raw.filter(Boolean).length === def.variants) {
            this.events.set(k, postProcess(this.ctx, raw, { targetPeak: 0.89 }).buffers);
          }
        });
      }
    }
    await pool(jobs, 4, (d) => onProgress?.(d, jobs.length));
  }

  get jobCount(): number {
    return (Object.values(EVENTS) as EventDef[]).reduce((s, d) => s + d.variants, 0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const now = this.ctx.currentTime;
    const mk = (name: 'traffic' | 'wind' | 'crickets', lp?: number): void => {
      const buf = this.bedBuffers[name];
      if (!buf) return;
      const s = this.ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      let node: AudioNode = s;
      let f: BiquadFilterNode | undefined;
      if (lp) {
        f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lp;
        node.connect(f);
        node = f;
      }
      node.connect(g).connect(this.bedBus);
      s.start(now, this.rng.range(0, buf.duration));
      this.beds[name] = { src: s, gain: g, filter: f };
    };
    mk('traffic', 900);
    mk('wind');
    mk('crickets');
    this.apply(1.5);
  }

  setKind(kind: AmbienceKind, intensity: number): void {
    this.kind = kind;
    this.intensity = clamp(intensity, 0, 1);
    if (this.running) this.apply(1.2);
  }

  private apply(tau: number): void {
    const cfg = CONFIGS[this.kind];
    const now = this.ctx.currentTime;
    const I = this.intensity;
    this.output.gain.setTargetAtTime(Math.pow(I, 0.8), now, tau * 0.5);
    this.beds.traffic?.gain.gain.setTargetAtTime(cfg.traffic, now, tau);
    this.beds.traffic?.filter?.frequency.setTargetAtTime(cfg.trafficLp, now, tau);
    this.beds.wind?.gain.gain.setTargetAtTime(cfg.wind, now, tau);
    this.beds.crickets?.gain.gain.setTargetAtTime(cfg.crickets * 0.8, now, tau);
  }

  /** Called ~20×/s: blends event rates towards the current kind and fires Poisson events. */
  tick(now: number, dt: number): void {
    if (!this.running || this.intensity <= 0.01) return;
    const target = CONFIGS[this.kind].rates;
    const k = 1 - Math.exp(-dt / 3);
    for (const e of Object.keys(target) as EventKind[]) {
      this.rates[e] += (target[e] - this.rates[e]) * k;
      const rate = this.rates[e] * (0.4 + 0.6 * this.intensity);
      if (rate <= 0.01) continue;
      if (now - this.lastAt[e] < EVENTS[e].minGap) continue;
      if (this.rng.next() < (rate / 60) * dt) {
        this.lastAt[e] = now;
        this.fire(e, now);
      }
    }
  }

  /** Fire an event immediately (also used by the test page). */
  fire(kind: EventKind, now = this.ctx.currentTime): void {
    const def = EVENTS[kind];
    const bufs = kind === 'scream' ? this.screams() : this.events.get(kind);
    if (!bufs || bufs.length === 0 || this.active.size > 12) return;
    const buf = this.rng.pick(bufs);
    const L = this.listener();
    const d = this.rng.range(def.dist[0], def.dist[1]);
    let x: number, y: number, z: number;
    let ax = 0, az = 0;
    if (def.place === 'road') {
      // Outer Ring Road runs WNW→ESE along the campus' north-east edge.
      const Nx = 0.38, Nz = -0.92;
      ax = 0.92; az = 0.38;
      const along = this.rng.range(-120, 120);
      x = L.x + Nx * d + ax * along;
      z = L.z + Nz * d + az * along;
      y = 1.5;
    } else {
      const a = this.rng.range(0, TAU);
      x = L.x + Math.cos(a) * d;
      z = L.z + Math.sin(a) * d;
      y = def.place === 'trees' ? this.rng.range(5, 12) : 2;
    }
    const dist = Math.hypot(x - L.x, y - L.y, z - L.z);
    const g = def.level * Math.min(1, def.ref / Math.max(1, dist)) * (kind === 'scream' ? 1 : 1);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'scream' ? 900 : clamp(22000 / (1 + dist / 25), 1200, 20000);
    const gg = this.ctx.createGain();
    gg.gain.value = g;
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.rolloffFactor = 0;
    const t0 = now + 0.02;
    const dur = buf.duration;
    if (def.move) {
      const half = (def.move * dur) / 2;
      const dir = this.rng.chance(0.5) ? 1 : -1;
      setPannerPos(p, x - ax * half * dir, y, z - az * half * dir, t0);
      rampPannerPos(p, x + ax * half * dir, y, z + az * half * dir, t0 + dur);
    } else setPannerPos(p, x, y, z, t0);
    if (def.doppler) {
      s.playbackRate.setValueAtTime(1 + def.doppler, t0);
      s.playbackRate.linearRampToValueAtTime(1 - def.doppler, t0 + dur);
    }
    chain2(s, lp, gg, p, this.eventBus);
    if (kind === 'scream' && this.reverbIn) {
      const send = this.ctx.createGain();
      send.gain.value = g * 1.5;
      lp.connect(send).connect(this.reverbIn);
      s.addEventListener('ended', () => send.disconnect());
    }
    s.start(t0);
    this.active.add(s);
    s.addEventListener('ended', () => {
      this.active.delete(s);
      s.disconnect();
      p.disconnect();
      gg.disconnect();
      lp.disconnect();
    });
  }

  stop(): void {
    const now = this.ctx.currentTime;
    for (const b of Object.values(this.beds)) {
      try {
        b?.src.stop(now + 0.05);
      } catch {
        /* already stopped */
      }
    }
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        /* noop */
      }
    }
    this.beds = {};
    this.running = false;
  }

  static get eventKinds(): EventKind[] {
    return Object.keys(EVENTS) as EventKind[];
  }
}

export type { EventKind as AmbienceEvent };

function chain2(...nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
}

export function setPannerPos(p: PannerNode, x: number, y: number, z: number, t?: number): void {
  if (p.positionX) {
    if (t === undefined) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.positionX.setValueAtTime(x, t);
      p.positionY.setValueAtTime(y, t);
      p.positionZ.setValueAtTime(z, t);
    }
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}

function rampPannerPos(p: PannerNode, x: number, y: number, z: number, t: number): void {
  if (!p.positionX) return;
  p.positionX.linearRampToValueAtTime(x, t);
  p.positionY.linearRampToValueAtTime(y, t);
  p.positionZ.linearRampToValueAtTime(z, t);
}
