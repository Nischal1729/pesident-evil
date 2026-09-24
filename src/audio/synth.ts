/**
 * WebAudio graph helpers for offline (pre-rendered) sound design.
 *
 * A recipe receives an `RCtx` (an OfflineAudioContext plus an output node, RNG and
 * duration) and builds a node graph with these helpers: oscillators with pitch sweeps,
 * filtered noise bursts, waveshaper saturation, modal resonances, formant voices,
 * slap-back echo taps and convolution reverb from generated impulse responses.
 */
import {
  type F32,
  type Fn,
  type GlottalOpts,
  type Mode,
  type Vowel,
  Rng,
  TAU,
  brown,
  burstExcite,
  clamp,
  formantFilter,
  glottal,
  gurgle,
  impulseResponse,
  modal,
  normalize,
  pink,
  white,
} from './dsp';

export interface RCtx {
  ac: BaseAudioContext;
  /** Recipe output (a DC-blocking highpass in front of the destination). */
  out: AudioNode;
  rng: Rng;
  sr: number;
  /** Total render length in seconds. */
  dur: number;
  /** Variant index. */
  v: number;
}

/* ------------------------------------------------------------ basics -- */

export function mkBuffer(c: RCtx, data: F32 | F32[]): AudioBuffer {
  const chans = Array.isArray(data) ? data : [data];
  const len = Math.max(1, chans[0]!.length);
  const b = c.ac.createBuffer(chans.length, len, c.sr);
  chans.forEach((d, i) => b.getChannelData(i).set(d));
  return b;
}

export function src(c: RCtx, data: F32 | F32[] | AudioBuffer, t: number, rate = 1): AudioBufferSourceNode {
  const s = c.ac.createBufferSource();
  s.buffer = data instanceof AudioBuffer ? data : mkBuffer(c, data);
  s.playbackRate.value = rate;
  s.start(Math.max(0, t));
  return s;
}

export type NoiseColor = 'white' | 'pink' | 'brown';

export function noiseData(c: RCtx, dur: number, color: NoiseColor = 'white'): F32 {
  const n = Math.max(16, Math.ceil(dur * c.sr) + 64);
  return color === 'pink' ? pink(n, c.rng) : color === 'brown' ? brown(n, c.rng) : white(n, c.rng);
}

export function noise(c: RCtx, t: number, dur: number, color: NoiseColor = 'white'): AudioBufferSourceNode {
  return src(c, noiseData(c, dur, color), t);
}

export function osc(c: RCtx, type: OscillatorType, freq: number, t: number, dur: number): OscillatorNode {
  const o = c.ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start(Math.max(0, t));
  o.stop(Math.max(0, t) + dur);
  return o;
}

export function gain(c: RCtx, v = 0): GainNode {
  const g = c.ac.createGain();
  g.gain.value = v;
  return g;
}

export function filter(c: RCtx, type: BiquadFilterType, freq: number, q = 0.7071, gainDb = 0): BiquadFilterNode {
  const f = c.ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = clamp(freq, 10, c.sr * 0.49);
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

const shaperCache = new Map<string, F32>();
/** tanh saturation, normalised so a full-scale input maps to ±1. `asym` adds even harmonics. */
export function shaperCurve(drive: number, asym = 0): F32 {
  const key = `${drive.toFixed(3)}|${asym.toFixed(3)}`;
  let curve = shaperCache.get(key);
  if (!curve) {
    const n = 2048;
    curve = new Float32Array(n);
    const norm = Math.tanh(drive * (1 + Math.abs(asym)));
    const off = Math.tanh(drive * asym);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = (Math.tanh(drive * (x + asym)) - off) / norm;
    }
    shaperCache.set(key, curve);
  }
  return curve;
}

export function shaper(c: RCtx, drive = 2, asym = 0): WaveShaperNode {
  const s = c.ac.createWaveShaper();
  s.curve = shaperCurve(drive, asym);
  s.oversample = '4x';
  return s;
}

/**
 * Saturation bus: returns an input node. Layers summed into it are scaled by `inGain`
 * (keep the sum near full scale, the shaper hard-clips beyond ±1), saturated, then
 * scaled by `outGain` into `dest`.
 */
export function satBus(c: RCtx, dest: AudioNode, drive: number, inGain = 0.5, outGain = 1, asym = 0.05): GainNode {
  const input = gain(c, inGain);
  const out = gain(c, outGain);
  input.connect(shaper(c, drive, asym)).connect(out).connect(dest);
  return input;
}

/** Connect nodes in series; returns the last. */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
  return nodes[nodes.length - 1]!;
}

/* --------------------------------------------------------- envelopes -- */

/** Percussive envelope: linear attack to `peak`, then exponential decay with time-constant `tau`. */
export function perc(p: AudioParam, t: number, peakV: number, attack: number, tau: number, base = 0): void {
  p.setValueAtTime(base, t);
  p.linearRampToValueAtTime(peakV, t + Math.max(0.0001, attack));
  p.setTargetAtTime(base, t + Math.max(0.0001, attack), Math.max(0.0005, tau));
}

/** Linear keyframes: [timeOffset, value][]. */
export function keys(p: AudioParam, t: number, pts: ReadonlyArray<readonly [number, number]>): void {
  if (pts.length === 0) return;
  p.setValueAtTime(pts[0]![1], t + pts[0]![0]);
  for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i]![1], t + pts[i]![0]);
}

/** Exponential (or linear) sweep between two positive values. */
export function sweep(p: AudioParam, t: number, from: number, to: number, time: number, kind: 'exp' | 'lin' = 'exp'): void {
  p.setValueAtTime(from, t);
  if (kind === 'exp') p.exponentialRampToValueAtTime(Math.max(1e-4, to), t + Math.max(0.001, time));
  else p.linearRampToValueAtTime(to, t + Math.max(0.001, time));
}

/* ------------------------------------------------------ space / echo -- */

/** Discrete slap-back echo taps: [delaySeconds, gain, lowpassHz][] from input into dest. */
export function echoTaps(c: RCtx, input: AudioNode, taps: ReadonlyArray<readonly [number, number, number]>, dest: AudioNode): void {
  for (const [dt, g, lp] of taps) {
    const d = c.ac.createDelay(Math.max(1, dt + 0.1));
    d.delayTime.value = dt;
    const f = filter(c, 'lowpass', lp, 0.5);
    const hp = filter(c, 'highpass', 120, 0.5);
    const gg = gain(c, g);
    chain(input, d, f, hp, gg, dest);
  }
}

const irCache = new Map<string, AudioBuffer>();
/** ConvolverNode with a cached procedural impulse response. */
export function reverb(
  c: RCtx,
  o: { secs: number; decay: number; lpStart?: number; lpEnd?: number; early?: ReadonlyArray<readonly [number, number]>; seed?: number; stereo?: boolean },
): ConvolverNode {
  const key = `${c.sr}|${o.secs}|${o.decay}|${o.lpStart}|${o.lpEnd}|${o.seed ?? 7}|${o.stereo ? 2 : 1}|${o.early?.length ?? 0}`;
  let b = irCache.get(key);
  if (!b) {
    const chans = impulseResponse(c.sr, o.secs, new Rng(o.seed ?? 7), {
      decay: o.decay,
      lpStart: o.lpStart,
      lpEnd: o.lpEnd,
      early: o.early,
      channels: o.stereo ? 2 : 1,
    });
    b = c.ac.createBuffer(chans.length, chans[0]!.length, c.sr);
    chans.forEach((d, i) => b!.getChannelData(i).set(d));
    irCache.set(key, b);
  }
  const cv = c.ac.createConvolver();
  cv.normalize = true;
  cv.buffer = b;
  return cv;
}

/** Outdoor campus courtyard: concrete blocks all round → strong early slaps, medium tail. */
export const CAMPUS_EARLY: ReadonlyArray<readonly [number, number]> = [
  [0.023, 0.5], [0.041, 0.35], [0.067, 0.3], [0.089, 0.22], [0.121, 0.2], [0.157, 0.12],
];

/** Send `input` through a reverb into `dest` with gain `wet`. */
export function sendReverb(
  c: RCtx,
  input: AudioNode,
  dest: AudioNode,
  wet: number,
  o: { secs?: number; decay?: number; lpStart?: number; lpEnd?: number; early?: ReadonlyArray<readonly [number, number]>; stereo?: boolean } = {},
): void {
  const cv = reverb(c, {
    secs: o.secs ?? 1.6,
    decay: o.decay ?? 1.2,
    lpStart: o.lpStart ?? 6000,
    lpEnd: o.lpEnd ?? 900,
    early: o.early ?? CAMPUS_EARLY,
    stereo: o.stereo,
  });
  const g = gain(c, wet);
  chain(input, cv, g, dest);
}

/* ------------------------------------------------------- layer helpers -- */

/** Sine (or other) oscillator with an exponential pitch drop — kick / thump / body weight. */
export function thump(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { f0: number; f1: number; sweep: number; tau: number; gain: number; attack?: number; type?: OscillatorType; len?: number },
): void {
  const s = osc(c, o.type ?? 'sine', o.f0, t, o.len ?? Math.min(c.dur - t, o.tau * 9 + 0.05));
  sweep(s.frequency, t, o.f0, o.f1, o.sweep);
  const g = gain(c, 0);
  perc(g.gain, t, o.gain, o.attack ?? 0.001, o.tau);
  chain(s, g, dest);
}

function bandwidthOf(type: BiquadFilterType, f: number, q: number, sr: number): number {
  switch (type) {
    case 'lowpass': return f * 1.57;
    case 'highpass': return Math.max(200, sr / 2 - f);
    case 'bandpass': return f / Math.max(0.1, q);
    default: return sr / 2;
  }
}

/**
 * Filtered noise burst with automatic level compensation, so `gain` ≈ output peak
 * regardless of filter width. Optional filter sweep to `f2` over `sweepTime`.
 */
export function burst(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: {
    type: BiquadFilterType;
    f: number;
    q?: number;
    f2?: number;
    sweepTime?: number;
    attack?: number;
    tau: number;
    gain: number;
    color?: NoiseColor;
    len?: number;
  },
): void {
  const q = o.q ?? 0.7071;
  const len = o.len ?? Math.min(c.dur - t, o.tau * 8 + (o.attack ?? 0) + 0.02);
  if (len <= 0) return;
  const n = noise(c, t, len, o.color ?? 'white');
  const f = filter(c, o.type, o.f, q);
  if (o.f2 !== undefined) sweep(f.frequency, t, o.f, o.f2, o.sweepTime ?? o.tau * 3);
  const comp = o.color && o.color !== 'white' ? 1 : clamp(Math.sqrt(c.sr / 2 / bandwidthOf(o.type, o.f, q, c.sr)) * 0.55, 1, 10);
  const g = gain(c, 0);
  perc(g.gain, t, o.gain * comp, o.attack ?? 0.0005, o.tau);
  chain(n, f, g, dest);
}

/** Modal resonator hit (metal / wood / membrane / bell) rendered in JS, then played. */
export function modalHit(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { modes: readonly Mode[]; gain: number; exciteMs?: number; excite?: F32; soft?: boolean; len?: number; rate?: number },
): void {
  const len = o.len ?? Math.min(c.dur - t, Math.max(...o.modes.map((m) => m.decay)) * 7 + 0.02);
  if (len <= 0) return;
  const n = Math.ceil(len * c.sr);
  const ex = o.excite ?? burstExcite(c.sr, o.exciteMs ?? 0.6, c.rng, o.soft ? 'soft' : 'white');
  const data = normalize(modal(n, c.sr, o.modes, ex), o.gain);
  const s = src(c, data, t, o.rate ?? 1);
  s.connect(dest);
}

/** Small metallic click / clack (gun mechanisms, latches, brass) with a noise tick on top. */
export function metalClick(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { f: number; decay: number; gain: number; ratios?: readonly number[]; tick?: number; body?: number; bodyF?: number },
): void {
  const ratios = o.ratios ?? [1, 1.58, 2.37, 3.41, 4.9, 6.3];
  const modes: Mode[] = ratios.map((r, i) => ({
    f: o.f * r * (1 + c.rng.bi() * 0.02),
    amp: c.rng.range(0.5, 1) / Math.pow(i + 1, 0.5),
    decay: o.decay / Math.pow(r, 0.5),
  }));
  modalHit(c, t, dest, { modes, gain: o.gain, exciteMs: 0.3 });
  burst(c, t, dest, { type: 'highpass', f: Math.min(9000, o.f * 1.5), tau: 0.0012, gain: o.gain * (o.tick ?? 0.7) });
  if (o.body) thump(c, t, dest, { f0: (o.bodyF ?? 220) * 1.6, f1: o.bodyF ?? 220, sweep: 0.01, tau: 0.012, gain: o.body });
}

/** Grainy friction scrape (mag sliding, slide racking, gate track). */
export function scrape(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { dur: number; f0: number; f1: number; q?: number; gain: number; grain?: number },
): void {
  const n = Math.ceil((o.dur + 0.02) * c.sr);
  const d = new Float32Array(n);
  const grain = o.grain ?? 0.6;
  let env = 0;
  let target = 1;
  for (let i = 0; i < n; i++) {
    if (i % 90 === 0) target = 1 - grain + grain * c.rng.next() * c.rng.next() * 2;
    env += (target - env) * 0.02;
    d[i] = (c.rng.next() * 2 - 1) * env;
  }
  const s = src(c, d, t);
  const q = o.q ?? 2.5;
  const f = filter(c, 'bandpass', o.f0, q);
  sweep(f.frequency, t, o.f0, o.f1, o.dur);
  const comp = clamp(Math.sqrt(c.sr / 2 / (o.f0 / q)) * 0.5, 1, 10);
  const g = gain(c, 0);
  keys(g.gain, t, [[0, 0], [Math.min(0.012, o.dur * 0.2), o.gain * comp], [o.dur * 0.7, o.gain * comp * 0.8], [o.dur, 0]]);
  chain(s, f, g, dest);
}

/** Scatter of tiny clicks (debris, splinters, bone crunch, grass, gravel). */
export function crackle(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { count: number; spread: number; fLo: number; fHi: number; gain: number; decayMs?: number; falloff?: number; q?: number },
): void {
  const n = Math.ceil((o.spread + 0.03) * c.sr);
  const d = new Float32Array(n);
  const dec = ((o.decayMs ?? 0.6) / 1000) * c.sr;
  for (let k = 0; k < o.count; k++) {
    const u = Math.pow(c.rng.next(), o.falloff ?? 1.6);
    const at = Math.floor(u * o.spread * c.sr);
    const a = c.rng.range(0.3, 1) * (1 - u * 0.7) * (c.rng.chance(0.5) ? 1 : -1);
    const L = Math.ceil(dec * 6);
    for (let i = 0; i < L && at + i < n; i++) d[at + i]! += a * Math.exp(-i / dec) * (c.rng.next() * 2 - 1);
  }
  normalize(d);
  const s = src(c, d, t);
  const fc = Math.sqrt(o.fLo * o.fHi);
  const bp = filter(c, 'bandpass', fc, o.q ?? fc / Math.max(50, o.fHi - o.fLo));
  const g = gain(c, o.gain * 1.6);
  chain(s, bp, g, dest);
}

/** Air whoosh (swings, swipes, passing bullets): band-passed noise with a moving centre. */
export function whoosh(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { dur: number; fLo: number; fHi: number; peakAt?: number; q?: number; gain: number; color?: NoiseColor; fEnd?: number },
): void {
  const pk = o.peakAt ?? 0.45;
  const n = noise(c, t, o.dur + 0.02, o.color ?? 'pink');
  const q = o.q ?? 2;
  const f1 = filter(c, 'bandpass', o.fLo, q);
  const f2 = filter(c, 'bandpass', o.fLo * 2.1, q * 1.3);
  for (const [f, mul] of [[f1, 1], [f2, 2.1]] as const) {
    f.frequency.setValueAtTime(o.fLo * mul, t);
    f.frequency.exponentialRampToValueAtTime(o.fHi * mul, t + o.dur * pk);
    f.frequency.exponentialRampToValueAtTime((o.fEnd ?? o.fLo * 1.2) * mul, t + o.dur);
  }
  const g = gain(c, 0);
  const g2 = gain(c, 0.45);
  const comp = 3.2;
  keys(g.gain, t, [[0, 0], [o.dur * pk * 0.8, o.gain * comp * 0.8], [o.dur * pk, o.gain * comp], [o.dur, 0]]);
  n.connect(f1).connect(g);
  n.connect(f2).connect(g2).connect(g);
  g.connect(dest);
}

/* ------------------------------------------------------------ voices -- */

export interface VoiceOpts {
  dur: number;
  f0: (t: number) => number;
  vowels: ReadonlyArray<readonly [number, Vowel]>;
  vt?: number;
  bw?: number;
  chest?: number;
  jitter?: Fn;
  shimmer?: Fn;
  fry?: Fn;
  breath?: Fn;
  tilt?: Fn;
  /** Amplitude keyframes [seconds, gain]. */
  amp: ReadonlyArray<readonly [number, number]>;
  drive?: number;
  asym?: number;
  lp?: number;
  gain?: number;
  /** Gurgle bubbles per second (wet throat). */
  gurgle?: number;
  gurgleGain?: number;
  /** Amplitude flutter — throat rattle / growl trill. */
  flutter?: { rate: number; depth: number };
  /** Second detuned voice for an inhuman, doubled throat. [f0 ratio, formant ratio, gain]. */
  double?: readonly [number, number, number];
}

function voiceData(c: RCtx, o: VoiceOpts, f0mul: number, vtMul: number): F32 {
  const g: GlottalOpts = {
    dur: o.dur,
    f0: (tt) => o.f0(tt) * f0mul,
    jitter: o.jitter,
    shimmer: o.shimmer,
    fry: o.fry,
    breath: o.breath,
    tilt: o.tilt,
  };
  return formantFilter(glottal(c.sr, g, c.rng), c.sr, {
    vowels: o.vowels,
    vt: (o.vt ?? 1) * vtMul,
    bw: o.bw,
    chest: o.chest,
  });
}

/**
 * Formant voice: glottal pulses (+ aspiration) → time-varying formant bank (JS), then in
 * the graph: amplitude envelope → flutter → saturation → lowpass → out.
 */
export function voice(c: RCtx, t: number, dest: AudioNode, o: VoiceOpts): void {
  const main = voiceData(c, o, 1, 1);
  if (o.double) {
    const [fr, vr, dg] = o.double;
    const second = voiceData(c, o, fr, vr);
    for (let i = 0; i < main.length; i++) main[i]! += second[i]! * dg;
  }
  if (o.gurgle && o.gurgle > 0) {
    const gg = gurgle(c.sr, o.dur, o.gurgle, c.rng);
    const gGain = o.gurgleGain ?? 0.35;
    for (let i = 0; i < main.length; i++) main[i]! += gg[i]! * gGain;
  }
  normalize(main);
  const s = src(c, main, t);
  const env = gain(c, 0);
  keys(env.gain, t, o.amp);
  let node: AudioNode = chain(s, env);
  if (o.flutter) {
    const fl = gain(c, 1 - o.flutter.depth * 0.5);
    const lfo = osc(c, 'triangle', o.flutter.rate, t, o.dur);
    const depth = gain(c, o.flutter.depth * 0.5);
    lfo.connect(depth).connect(fl.gain);
    node = chain(node, fl);
  }
  const drv = o.drive ?? 1.5;
  const pre = gain(c, 1);
  const sh = shaper(c, drv, o.asym ?? 0.08);
  const lp = filter(c, 'lowpass', o.lp ?? 6000, 0.6);
  const out = gain(c, o.gain ?? 1);
  chain(node, pre, sh, lp, out, dest);
}

/* ----------------------------------------------------- tonal helpers -- */

/** Simple 2-operator FM bell (pickups, dings, manjira shimmer). */
export function fmBell(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { f: number; ratio: number; index: number; tau: number; gain: number; attack?: number },
): void {
  const len = Math.min(c.dur - t, o.tau * 8 + 0.02);
  if (len <= 0) return;
  const car = osc(c, 'sine', o.f, t, len);
  const mod = osc(c, 'sine', o.f * o.ratio, t, len);
  const mg = gain(c, 0);
  perc(mg.gain, t, o.f * o.index, 0.001, o.tau * 0.5);
  mod.connect(mg).connect(car.frequency);
  const g = gain(c, 0);
  perc(g.gain, t, o.gain, o.attack ?? 0.002, o.tau);
  chain(car, g, dest);
}

/** Detuned sawtooth cluster through a lowpass — dark brass / "braam" / pads. */
export function sawCluster(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { freqs: readonly number[]; detune?: number; lp0: number; lp1: number; attack: number; tau: number; gain: number; len?: number },
): void {
  const len = o.len ?? Math.min(c.dur - t, o.attack + o.tau * 6);
  const lp = filter(c, 'lowpass', o.lp0, 1.2);
  sweep(lp.frequency, t, o.lp0, o.lp1, o.attack + o.tau * 2);
  const g = gain(c, 0);
  perc(g.gain, t, o.gain / Math.sqrt(o.freqs.length * 2), o.attack, o.tau);
  for (const f of o.freqs) {
    for (const d of [-1, 1]) {
      const s = osc(c, 'sawtooth', f, t, len);
      s.detune.value = d * (o.detune ?? 9) + c.rng.bi() * 3;
      s.connect(lp);
    }
  }
  chain(lp, g, dest);
}

/** A soft, breathy flute-like tone (bansuri nod) with vibrato; `notes` = [time, hz, dur]. */
export function flute(
  c: RCtx,
  t: number,
  dest: AudioNode,
  o: { notes: ReadonlyArray<readonly [number, number, number]>; gain: number; vib?: number },
): void {
  if (o.notes.length === 0) return;
  const last = o.notes[o.notes.length - 1]!;
  const total = last[0] + last[2] + 0.3;
  const s = osc(c, 'sine', o.notes[0]![1], t, total);
  const s2 = osc(c, 'triangle', o.notes[0]![1] * 2, t, total);
  const vib = osc(c, 'sine', 5.2, t, total);
  const vg = gain(c, 0);
  keys(vg.gain, t, [[0, 0], [0.25, 0], [0.6, (o.vib ?? 0.012) * o.notes[0]![1]]]);
  vib.connect(vg);
  vg.connect(s.frequency);
  const env = gain(c, 0);
  const g2 = gain(c, 0.12);
  s.frequency.setValueAtTime(o.notes[0]![1], t);
  s2.frequency.setValueAtTime(o.notes[0]![1] * 2, t);
  env.gain.setValueAtTime(0, t);
  for (const [nt, hz, nd] of o.notes) {
    const glide = Math.min(0.08, nd * 0.3);
    s.frequency.setTargetAtTime(hz, t + nt, glide / 3);
    s2.frequency.setTargetAtTime(hz * 2, t + nt, glide / 3);
    env.gain.setTargetAtTime(o.gain, t + nt, 0.03);
    env.gain.setTargetAtTime(o.gain * 0.75, t + nt + nd * 0.6, nd * 0.4);
  }
  env.gain.setTargetAtTime(0, t + last[0] + last[2], 0.08);
  // breath
  const br = noise(c, t, total, 'white');
  const bf = filter(c, 'bandpass', o.notes[0]![1] * 2, 3);
  const bg = gain(c, 0.35);
  chain(br, bf, bg, env);
  s.connect(env);
  s2.connect(g2).connect(env);
  env.connect(dest);
}

export { TAU };
