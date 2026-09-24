/**
 * Procedural adaptive score.
 *
 * Layers (all driven by one smoothed intensity 0..1):
 *   drone    — low D pedal (sine + saw through a slowly breathing lowpass)
 *   tanpura  — Karplus–Strong plucks with a swept "jawari" buzz, Pa–Sa–Sa–Sa cycle
 *   pulse    — low filtered-saw heartbeat on the chord root, densifying with intensity
 *   tabla    — synthesised dayan / bayan strokes playing a Teentaal theka, then tirakita ghosts
 *   dhol     — dagga (bass) + tilli (treble) driving 3-3-2 chaal with fills at high intensity
 *   pads     — detuned saw clusters on a Phrygian/Todi-flavoured progression (D, Eb, Dm(maj7), Bb)
 *   strings  — tremolo minor-second cluster above everything at full horde
 *   bansuri  — rare, haunting Todi phrases at low-mid intensity
 * A lookahead scheduler keeps everything sample-accurate and it loops forever with
 * per-bar variation (dropped notes, fills, "breath" bars) so it never becomes a loop you notice.
 */
import { Biquad, type F32, RATIOS, Rng, clamp, impulseResponse, midiToHz, modesFrom, normalize, smoothstep } from './dsp';
import { pool, postProcess, renderOffline, toBuffer } from './render';
import { type RCtx, burst, chain, filter, flute, gain, modalHit, osc, sendReverb, shaper, thump } from './synth';

const BPM = 96;
const STEP = 60 / BPM / 4;
const LOOKAHEAD = 0.25;

type Inst = 'na' | 'tin' | 'te' | 'ge' | 'ghe' | 'ka' | 'dagga' | 'tilli';

const TABLA_SA = 293.66; // D4

const INSTRUMENTS: Record<Inst, { dur: number; variants: number; build: (c: RCtx) => void }> = {
  na: {
    dur: 1.2, variants: 2,
    build: (c) => {
      const amps = [0.45, 1, 0.75, 0.5, 0.3, 0.15];
      const decs = [0.35, 0.3, 0.22, 0.15, 0.1, 0.07];
      modalHit(c, 0.002, c.out, { modes: RATIOS.tabla.map((r, i) => ({ f: TABLA_SA * r * (1 + c.rng.bi() * 0.003), amp: amps[i]!, decay: decs[i]! })), gain: 0.8, exciteMs: 0.4 });
      burst(c, 0.002, c.out, { type: 'highpass', f: 3000, tau: 0.002, gain: 0.35 });
    },
  },
  tin: {
    dur: 1.6, variants: 1,
    build: (c) => {
      const amps = [1, 0.4, 0.2, 0.1];
      const decs = [0.7, 0.45, 0.25, 0.15];
      modalHit(c, 0.002, c.out, { modes: amps.map((a, i) => ({ f: TABLA_SA * (i + 1), amp: a, decay: decs[i]! })), gain: 0.75, exciteMs: 0.8, soft: true });
      burst(c, 0.002, c.out, { type: 'highpass', f: 2500, tau: 0.0015, gain: 0.15 });
    },
  },
  te: {
    dur: 0.25, variants: 2,
    build: (c) => {
      const amps = [0.45, 1, 0.75, 0.5];
      modalHit(c, 0.002, c.out, { modes: amps.map((a, i) => ({ f: TABLA_SA * (i + 1), amp: a, decay: 0.04 / (i + 1) })), gain: 0.5, exciteMs: 0.4 });
      burst(c, 0.002, c.out, { type: 'lowpass', f: 2000, tau: 0.01, gain: 0.5 });
    },
  },
  ge: {
    dur: 1.2, variants: 2,
    build: (c) => {
      const pre = gain(c, 1);
      chain(pre, shaper(c, 1.5), c.out);
      const o = osc(c, 'sine', 80, 0.002, 1.1);
      o.frequency.setValueAtTime(78 + c.rng.range(0, 4), 0.002);
      o.frequency.linearRampToValueAtTime(92, 0.2);
      const g = gain(c, 0);
      g.gain.setValueAtTime(0, 0.002);
      g.gain.linearRampToValueAtTime(1, 0.006);
      g.gain.setTargetAtTime(0, 0.006, 0.35);
      chain(o, g, pre);
      thump(c, 0.002, pre, { f0: 125, f1: 120, sweep: 0.1, tau: 0.12, gain: 0.25 });
      burst(c, 0.002, pre, { type: 'lowpass', f: 300, tau: 0.02, gain: 0.5 });
    },
  },
  ghe: {
    dur: 1.5, variants: 1,
    build: (c) => {
      const o = osc(c, 'sine', 78, 0.002, 1.4);
      o.frequency.setValueAtTime(78, 0.002);
      o.frequency.linearRampToValueAtTime(118, 0.45);
      const g = gain(c, 0);
      g.gain.setValueAtTime(0, 0.002);
      g.gain.linearRampToValueAtTime(1, 0.008);
      g.gain.setTargetAtTime(0, 0.008, 0.6);
      chain(o, g, shaper(c, 1.4), c.out);
      burst(c, 0.002, c.out, { type: 'lowpass', f: 300, tau: 0.02, gain: 0.4 });
    },
  },
  ka: {
    dur: 0.25, variants: 1,
    build: (c) => {
      burst(c, 0.002, c.out, { type: 'lowpass', f: 700, tau: 0.02, gain: 0.8 });
      thump(c, 0.002, c.out, { f0: 130, f1: 80, sweep: 0.02, tau: 0.02, gain: 0.6 });
    },
  },
  dagga: {
    dur: 1.2, variants: 2,
    build: (c) => {
      const pre = gain(c, 1);
      chain(pre, shaper(c, 2.2), c.out);
      thump(c, 0.002, pre, { f0: 100, f1: 55, sweep: 0.08, tau: 0.22, gain: 1 });
      modalHit(c, 0.002, pre, { modes: modesFrom(70, RATIOS.membrane, 0.2, c.rng), gain: 0.4, exciteMs: 2, soft: true });
      burst(c, 0.002, pre, { type: 'lowpass', f: 1500, tau: 0.015, gain: 0.6 });
    },
  },
  tilli: {
    dur: 0.4, variants: 2,
    build: (c) => {
      modalHit(c, 0.002, c.out, { modes: modesFrom(380, RATIOS.membrane, 0.06, c.rng), gain: 0.6, exciteMs: 0.4 });
      burst(c, 0.002, c.out, { type: 'highpass', f: 2500, tau: 0.003, gain: 0.8 });
      burst(c, 0.002, c.out, { type: 'bandpass', f: 1200, q: 1, tau: 0.01, gain: 0.4 });
    },
  },
};

/** Todi-ish bansuri phrases [time, midi, dur]. */
const PHRASES: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[0, 81, 0.5], [0.5, 82, 0.35], [0.85, 81, 0.35], [1.2, 80, 0.4], [1.6, 77, 0.35], [1.95, 75, 0.9]],
  [[0, 74, 0.6], [0.6, 75, 0.4], [1.0, 77, 0.8], [1.8, 75, 0.35], [2.15, 74, 1.1]],
  [[0, 73, 0.4], [0.4, 74, 0.5], [0.9, 80, 0.6], [1.5, 81, 1.2]],
  [[0, 86, 0.8], [0.8, 85, 0.4], [1.2, 82, 0.4], [1.6, 81, 1.3]],
];

/** Chords (MIDI) — two bars each. Roots for the pulse follow `ROOTS`. */
const CHORDS: ReadonlyArray<readonly number[]> = [
  [50, 57, 62, 65], // Dm
  [51, 58, 63, 67], // Eb (bII)
  [50, 57, 61, 65], // Dm(maj7) — creepy
  [46, 53, 62, 65], // Bb
];
const ROOTS = [38, 39, 38, 34];

/** Karplus–Strong tanpura pluck with a swept jawari "buzz" band. */
function tanpuraPluck(sr: number, f: number, dur: number, rng: Rng): F32 {
  const n = Math.ceil(dur * sr);
  const ks = new Float32Array(n);
  const N = sr / f;
  const D = N - 0.5;
  const M = Math.ceil(N) + 4;
  const dl = new Float64Array(M);
  const exLen = Math.floor(N);
  const ex = new Float32Array(exLen);
  let lp = 0;
  for (let i = 0; i < exLen; i++) {
    lp += (rng.bi() - lp) * 0.5;
    ex[i] = lp;
  }
  const rho = Math.pow(0.001, 1 / (dur * 0.85 * f));
  let w = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const rp = w - D;
    const i0 = Math.floor(rp);
    const a = rp - i0;
    const s0 = dl[((i0 % M) + M) % M]!;
    const s1 = dl[(((i0 + 1) % M) + M) % M]!;
    const del = s0 + (s1 - s0) * a;
    const y = rho * 0.5 * (del + prev);
    prev = del;
    const v = (i < exLen ? ex[i]! : 0) + y;
    dl[w] = v;
    ks[i] = v;
    w = (w + 1) % M;
  }
  const out = new Float32Array(n);
  const jw = new Biquad();
  for (let b = 0; b < n; b += 64) {
    const u = b / n;
    const fc = 700 + 2600 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.4)), 1.5);
    jw.set('bandpass', fc, 5, sr);
    const end = Math.min(n, b + 64);
    for (let i = b; i < end; i++) out[i] = Math.tanh(1.3 * (ks[i]! * 0.55 + jw.tick(ks[i]!) * 2.5));
  }
  return normalize(out, 0.9);
}

type Pattern = Array<number>;

export class Music {
  readonly output: GainNode;
  private readonly mix: GainNode;
  private readonly revSend: GainNode;
  private layers!: Record<'drone' | 'tanpura' | 'pulse' | 'tabla' | 'dhol' | 'pad' | 'trem' | 'flute', GainNode>;
  private tanpuraLp!: BiquadFilterNode;
  private padLp!: BiquadFilterNode;
  private droneLp!: BiquadFilterNode;
  private tremAM!: GainNode;
  private inst = new Map<Inst, AudioBuffer[]>();
  private tanpura: AudioBuffer[] = [];
  private flutes: AudioBuffer[] = [];
  private continuous: Array<OscillatorNode | AudioBufferSourceNode> = [];
  private target = 0;
  private I = 0;
  private running = false;
  private step = 0;
  private nextTime = 0;
  private lastTick = 0;
  private rng = new Rng((Date.now() ^ 0xbeef) >>> 0);
  private tabla: Array<Inst[] | null> = [];
  private tablaVel: number[] = [];
  private dagga: Pattern = [];
  private tilli: Pattern = [];
  private pulse: Pattern = [];
  private breath = false;
  private lastFluteBar = -99;

  constructor(private readonly ctx: AudioContext, dest: AudioNode) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.output.connect(dest);
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.4; // music trim: sits ~8-10 dB under gameplay SFX
    this.mix.connect(this.output);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.14;
    const cv = ctx.createConvolver();
    const chans = impulseResponse(ctx.sampleRate, 3.2, new Rng(77), { decay: 2.8, lpStart: 5000, lpEnd: 700, channels: 2 });
    cv.buffer = toBuffer(ctx, chans, ctx.sampleRate);
    this.revSend.connect(cv).connect(this.output);
  }

  get jobCount(): number {
    return (Object.values(INSTRUMENTS) as Array<{ variants: number }>).reduce((s, d) => s + d.variants, 0) + PHRASES.length;
  }

  async prepare(onProgress?: (done: number, total: number) => void): Promise<void> {
    const sr = this.ctx.sampleRate;
    const rng = new Rng(4321);
    this.tanpura = [110, 146.83, 146.83 * 1.0012, 73.42].map((f) => toBuffer(this.ctx, [tanpuraPluck(sr, f, 5.5, rng)], sr));
    const jobs: Array<() => Promise<void>> = [];
    let seed = 500;
    for (const k of Object.keys(INSTRUMENTS) as Inst[]) {
      const def = INSTRUMENTS[k];
      const raw: AudioBuffer[] = [];
      for (let v = 0; v < def.variants; v++) {
        const s = seed++;
        jobs.push(async () => {
          raw[v] = await renderOffline({ dur: def.dur, seed: s * 17, v, sr, build: def.build });
          if (raw.filter(Boolean).length === def.variants) this.inst.set(k, postProcess(this.ctx, raw, { targetPeak: 0.89 }).buffers);
        });
      }
    }
    const fl: AudioBuffer[] = [];
    PHRASES.forEach((ph, i) => {
      jobs.push(async () => {
        const b = await renderOffline({
          dur: 5, seed: 900 + i, v: i, sr,
          build: (c) => {
            const bus = gain(c, 1);
            bus.connect(c.out);
            flute(c, 0.02, bus, { notes: ph.map(([t, m, d]) => [t, midiToHz(m), d] as const), gain: 0.5, vib: 0.01 });
            sendReverb(c, bus, c.out, 0.4, { secs: 2.5, decay: 2, lpStart: 5000, lpEnd: 900 });
          },
        });
        fl[i] = postProcess(this.ctx, [b], { targetPeak: 0.89 }).buffers[0]!;
      });
    });
    await pool(jobs, 4, (d) => onProgress?.(d, jobs.length));
    this.flutes = fl.filter(Boolean);
  }

  setIntensity(x: number): void {
    this.target = clamp(x, 0, 1);
  }

  get intensity(): number {
    return this.I;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const mkLayer = (g: number, reverb = 0): GainNode => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.connect(this.mix);
      if (reverb > 0) {
        const s = ctx.createGain();
        s.gain.value = reverb;
        n.connect(s).connect(this.revSend);
      }
      return n;
    };
    this.layers = {
      drone: mkLayer(0, 0.3),
      tanpura: mkLayer(0, 0.8),
      pulse: mkLayer(0, 0.15),
      tabla: mkLayer(0, 0.6),
      dhol: mkLayer(0, 0.4),
      pad: mkLayer(0, 0.9),
      trem: mkLayer(0, 0.8),
      flute: mkLayer(0.3, 0.8),
    };
    // drone
    this.droneLp = ctx.createBiquadFilter();
    this.droneLp.type = 'lowpass';
    this.droneLp.frequency.value = 220;
    this.droneLp.Q.value = 1.5;
    this.droneLp.connect(this.layers.drone);
    const dOsc = (type: OscillatorType, f: number, g: number, det = 0): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(this.droneLp);
      o.start(now);
      this.continuous.push(o);
    };
    dOsc('sine', 36.71, 0.5);
    dOsc('sine', 73.42, 0.35);
    dOsc('sawtooth', 73.42, 0.25, -6);
    dOsc('sawtooth', 73.42, 0.25, 6);
    dOsc('sawtooth', 110, 0.08, 3);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(this.droneLp.frequency);
    lfo.start(now);
    this.continuous.push(lfo);
    // tanpura / pad filters
    this.tanpuraLp = ctx.createBiquadFilter();
    this.tanpuraLp.type = 'lowpass';
    this.tanpuraLp.frequency.value = 900;
    this.tanpuraLp.connect(this.layers.tanpura);
    this.padLp = ctx.createBiquadFilter();
    this.padLp.type = 'lowpass';
    this.padLp.frequency.value = 600;
    this.padLp.Q.value = 0.9;
    this.padLp.connect(this.layers.pad);
    // tremolo strings AM
    this.tremAM = ctx.createGain();
    this.tremAM.gain.value = 0.5;
    const tl = ctx.createOscillator();
    tl.frequency.value = 11;
    const tg = ctx.createGain();
    tg.gain.value = 0.5;
    tl.connect(tg).connect(this.tremAM.gain);
    tl.start(now);
    this.continuous.push(tl);
    const tbp = ctx.createBiquadFilter();
    tbp.type = 'bandpass';
    tbp.frequency.value = 1400;
    tbp.Q.value = 0.8;
    this.tremAM.connect(tbp).connect(this.layers.trem);

    this.output.gain.setTargetAtTime(1, now, 0.8);
    this.step = 0;
    this.nextTime = now + 0.1;
    this.lastTick = now;
  }

  stop(fade = 1.5): void {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    this.output.gain.setTargetAtTime(0, now, fade / 4);
    const cont = this.continuous;
    this.continuous = [];
    for (const o of cont) {
      try {
        o.stop(now + fade + 0.1);
      } catch {
        /* noop */
      }
    }
    this.running = false;
  }

  tick(now: number): void {
    if (!this.running) return;
    const dt = Math.max(0, Math.min(0.5, now - this.lastTick));
    this.lastTick = now;
    this.I += (this.target - this.I) * (1 - Math.exp(-dt / 2));
    this.applyLayers(now);
    if (this.nextTime < now - 0.2) {
      this.nextTime = now + 0.05;
    }
    while (this.nextTime < now + LOOKAHEAD) {
      this.schedule(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  private applyLayers(now: number): void {
    const I = this.I;
    const presence = 0.3 + 0.7 * smoothstep(0, 0.15, I);
    const set = (g: GainNode, v: number): void => {
      g.gain.setTargetAtTime(v, now, 0.5);
    };
    const L = this.layers;
    set(L.drone, 0.32 * presence * (0.6 + 0.4 * smoothstep(0.2, 0.8, I)));
    set(L.tanpura, 0.3 * presence * (1 - 0.4 * smoothstep(0.6, 1, I)));
    set(L.pulse, 0.25 * smoothstep(0.1, 0.25, I));
    set(L.tabla, 0.42 * smoothstep(0.28, 0.45, I) * (1 - 0.3 * smoothstep(0.8, 1, I)) * (this.breath ? 0 : 1));
    set(L.dhol, 0.5 * smoothstep(0.5, 0.7, I) * (this.breath ? 0 : 1));
    set(L.pad, 0.22 * smoothstep(0.35, 0.6, I));
    set(L.trem, 0.1 * smoothstep(0.7, 0.95, I));
    this.tanpuraLp.frequency.setTargetAtTime(700 + 2500 * I, now, 0.5);
    this.padLp.frequency.setTargetAtTime(500 + 2500 * I, now, 0.5);
  }

  private hit(name: Inst, t: number, g: number, dest: AudioNode, rate = 1): void {
    const bufs = this.inst.get(name);
    if (!bufs || bufs.length === 0) return;
    this.play(this.rng.pick(bufs), t, g, dest, rate);
  }

  private play(buf: AudioBuffer, t: number, g: number, dest: AudioNode, rate = 1): void {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const gg = this.ctx.createGain();
    gg.gain.value = g;
    s.connect(gg).connect(dest);
    s.start(Math.max(this.ctx.currentTime, t));
    s.addEventListener('ended', () => {
      s.disconnect();
      gg.disconnect();
    });
  }

  private onBar(bar: number, t: number): void {
    const I = this.I;
    const r = this.rng;
    const phraseBar = bar % 4;
    this.breath = phraseBar === 0 && bar % 8 === 0 && bar > 0 && I < 0.9 && r.chance(0.25);
    // chord change every 2 bars
    if (bar % 2 === 0) {
      const ci = Math.floor(bar / 2) % CHORDS.length;
      this.chord(CHORDS[ci]!, ROOTS[ci]!, t, STEP * 32);
    }
    // pulse pattern
    this.pulse = new Array(16).fill(0);
    if (I < 0.4) {
      this.pulse[0] = 1;
      this.pulse[8] = 0.7;
    } else if (I < 0.7) {
      [1, 0.6, 0.8, 0.6].forEach((v, i) => (this.pulse[i * 4] = v));
    } else {
      [1, 0.5, 0.7, 0.5, 0.9, 0.5, 0.7, 0.6].forEach((v, i) => (this.pulse[i * 2] = v));
    }
    // tabla: Teentaal theka on 8ths over two bars
    const A: Array<'dha' | 'dhin' | 'tin' | 'ta'> = ['dha', 'dhin', 'dhin', 'dha', 'dha', 'dhin', 'dhin', 'dha'];
    const B: Array<'dha' | 'dhin' | 'tin' | 'ta'> = ['dha', 'tin', 'tin', 'ta', 'ta', 'dhin', 'dhin', 'dha'];
    const bols = bar % 2 === 0 ? A : B;
    const map: Record<string, Inst[]> = { dha: ['na', 'ge'], dhin: ['tin', 'ge'], tin: ['tin'], ta: ['na'] };
    this.tabla = new Array(16).fill(null);
    this.tablaVel = new Array(16).fill(0);
    const density = I < 0.45 ? 0.5 : 1;
    bols.forEach((b, i) => {
      const s = i * 2;
      if (s === 0 && bar % 2 === 0) {
        this.tabla[s] = r.chance(0.3) ? ['na', 'ghe'] : map[b]!;
        this.tablaVel[s] = 1;
      } else if (r.chance(density)) {
        this.tabla[s] = map[b]!;
        this.tablaVel[s] = r.range(0.6, 0.9);
      }
    });
    if (I > 0.7) {
      for (let s = 1; s < 16; s += 2) {
        if (r.chance(0.5)) {
          this.tabla[s] = [r.chance(0.7) ? 'te' : 'ka'];
          this.tablaVel[s] = r.range(0.3, 0.55);
        }
      }
    }
    if (phraseBar === 3 && I > 0.6) {
      // tihai-ish fill: dha te te | dha te te | dha
      const fill: Array<Inst[] | null> = [['na', 'ge'], ['te'], ['te'], ['na', 'ge'], ['te'], ['te'], ['na', 'ge'], null];
      for (let k = 0; k < 8; k++) {
        this.tabla[8 + k] = fill[k] ?? null;
        this.tablaVel[8 + k] = fill[k] ? (k % 3 === 0 ? 0.95 : 0.55) : 0;
      }
    }
    // dhol
    this.dagga = new Array(16).fill(0);
    this.tilli = new Array(16).fill(0);
    if (I > 0.5) {
      this.dagga[0] = 1; this.dagga[6] = 0.8; this.dagga[12] = 0.85;
      [2, 4, 8, 10, 14].forEach((s) => (this.tilli[s] = r.range(0.5, 0.75)));
      if (I > 0.8) {
        this.dagga[3] = 0.5; this.dagga[9] = 0.5;
        for (let s = 1; s < 16; s += 2) if (r.chance(0.6)) this.tilli[s] = 0.35;
      }
      if (phraseBar === 3 && I > 0.75) {
        for (let s = 8; s < 16; s++) this.tilli[s] = 0.4 + (s - 8) * 0.07;
        this.dagga[8] = 0.9; this.dagga[12] = 0.9; this.dagga[14] = 0.8; this.dagga[15] = 1;
      }
    }
    // big phrase boom
    if (phraseBar === 0 && I > 0.7 && !this.breath) this.hit('dagga', t, 1.1, this.layers.dhol, 0.55);
    // rare bansuri phrase
    if (phraseBar === 0 && I > 0.12 && I < 0.65 && bar - this.lastFluteBar >= 16 && r.chance(0.22) && this.flutes.length) {
      this.lastFluteBar = bar;
      this.play(r.pick(this.flutes), t + STEP * 2, 0.9, this.layers.flute);
    }
  }

  private chord(notes: readonly number[], root: number, t: number, len: number): void {
    const ctx = this.ctx;
    const I = this.I;
    if (I > 0.3) {
      const env = ctx.createGain();
      env.gain.value = 0;
      env.gain.setValueAtTime(0, t);
      env.gain.setTargetAtTime(1, t, 0.5);
      env.gain.setTargetAtTime(0, t + len, 0.6);
      env.connect(this.padLp);
      const extra = I > 0.8 ? [notes[notes.length - 1]! + 13] : [];
      for (const m of [...notes, ...extra]) {
        for (const det of [-7, 7]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = midiToHz(m);
          o.detune.value = det + this.rng.bi() * 3;
          const g = ctx.createGain();
          g.gain.value = 0.12;
          o.connect(g).connect(env);
          o.start(t);
          o.stop(t + len + 3);
          o.addEventListener('ended', () => {
            o.disconnect();
            g.disconnect();
          });
        }
      }
      setTimeout(() => env.disconnect(), (t - ctx.currentTime + len + 3.5) * 1000);
    }
    if (I > 0.65) {
      const env = ctx.createGain();
      env.gain.value = 0;
      env.gain.setValueAtTime(0, t);
      env.gain.setTargetAtTime(1, t, 0.8);
      env.gain.setTargetAtTime(0, t + len, 0.5);
      env.connect(this.tremAM);
      for (const m of [root + 36, root + 37]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToHz(m);
        o.detune.value = this.rng.bi() * 4;
        const g = ctx.createGain();
        g.gain.value = 0.25;
        o.connect(g).connect(env);
        o.start(t);
        o.stop(t + len + 3);
        o.addEventListener('ended', () => {
          o.disconnect();
          g.disconnect();
        });
      }
      setTimeout(() => env.disconnect(), (t - ctx.currentTime + len + 3.5) * 1000);
    }
    this.currentRoot = root;
  }

  private currentRoot = 38;

  private pulseNote(t: number, v: number): void {
    const ctx = this.ctx;
    const f = midiToHz(this.currentRoot);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f / 2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    const top = 300 + 900 * this.I;
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.setTargetAtTime(110, t, 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.5, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.006, 0.12);
    const sg = ctx.createGain();
    sg.gain.value = 0.9;
    o.connect(lp).connect(g);
    sub.connect(sg).connect(g);
    g.connect(this.layers.pulse);
    o.start(t);
    sub.start(t);
    o.stop(t + 0.8);
    sub.stop(t + 0.8);
    o.addEventListener('ended', () => {
      o.disconnect();
      sub.disconnect();
      lp.disconnect();
      sg.disconnect();
      g.disconnect();
    });
  }

  private schedule(s: number, t: number): void {
    const inBar = s % 16;
    const bar = Math.floor(s / 16);
    if (inBar === 0) this.onBar(bar, t);
    const r = this.rng;
    const hum = () => t + r.bi() * 0.004;
    // tanpura: one string every beat, Pa–Sa–Sa–Sa(low)
    if (inBar % 4 === 0 && this.tanpura.length === 4) {
      const k = Math.floor(s / 4) % 4;
      this.play(this.tanpura[k]!, hum(), 0.6 + 0.2 * r.next(), this.tanpuraLp);
    }
    const pv = this.pulse[inBar];
    if (pv && this.I > 0.1) this.pulseNote(t, pv);
    const tb = this.tabla[inBar];
    if (tb && this.I > 0.25 && !this.breath) {
      const vel = this.tablaVel[inBar] ?? 0.7;
      const th = hum();
      for (const st of tb) this.hit(st, th, vel * (st === 'ge' || st === 'ghe' ? 0.9 : 0.7), this.layers.tabla);
    }
    if (!this.breath) {
      const dg = this.dagga[inBar];
      if (dg) this.hit('dagga', hum(), dg, this.layers.dhol, 0.97 + r.next() * 0.06);
      const tl = this.tilli[inBar];
      if (tl) this.hit('tilli', hum(), tl * 0.8, this.layers.dhol, 0.97 + r.next() * 0.06);
    }
  }
}
