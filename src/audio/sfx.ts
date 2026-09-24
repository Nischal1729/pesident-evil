/**
 * The SFX recipe book. Each recipe builds an offline WebAudio graph that is rendered
 * into several AudioBuffer variants at init. Playback metadata (level, priority, voice
 * cap, distance model, reverb send) lives next to the sound so the mix is tuned in one place.
 */
import { RATIOS, type Mode, type Vowel, TAU, clamp, gurgle, lerp, modal, modesFrom, normalize, periodicLfo, smoothstep } from './dsp';
import {
  type RCtx,
  burst,
  chain,
  crackle,
  echoTaps,
  filter,
  flute,
  fmBell,
  gain,
  keys,
  metalClick,
  modalHit,
  noise,
  osc,
  perc,
  sawCluster,
  satBus,
  scrape,
  sendReverb,
  shaper,
  src,
  sweep,
  thump,
  voice,
  whoosh,
} from './synth';

export const SFX_NAMES = [
  // weapons
  'pistol_fire', 'rifle_fire', 'shotgun_fire', 'smg_fire', 'dry_fire', 'reload_mag_out', 'reload_mag_in',
  'reload_rack', 'shotgun_pump', 'shell_insert', 'bat_swing', 'bat_hit', 'weapon_switch', 'bullet_whiz',
  // impacts
  'impact_flesh', 'impact_concrete', 'impact_metal', 'impact_wood', 'headshot',
  // zombies
  'zombie_groan', 'zombie_growl_near', 'zombie_attack', 'zombie_death', 'zombie_scream', 'zombie_hit_door',
  // player / npc
  'player_hurt', 'player_death', 'footstep_concrete', 'footstep_grass', 'jump_land', 'heartbeat',
  'revive_progress', 'pickup_ammo', 'pickup_health', 'pickup_weapon', 'points_ding', 'barricade_repair', 'gate_close',
  // game flow
  'wave_start', 'wave_end', 'ui_click', 'ui_hover', 'ui_error', 'round_counter_tick',
  // extras
  'ricochet', 'body_fall', 'zombie_footstep', 'low_ammo', 'ui_confirm',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export type SfxCategory = 'weapon' | 'impact' | 'zombie' | 'player' | 'foley' | 'ui' | 'flow';

export interface SfxRecipe {
  /** Render length in seconds (trailing silence is trimmed after rendering). */
  dur: number;
  variants: number;
  channels?: 1 | 2;
  /** Render sample rate (default: the AudioContext's). 32 kHz is plenty for voices / drones. */
  sr?: number;
  render: (c: RCtx) => void;
  category: SfxCategory;
  /** Playback level in dB (buffers are peak-normalised to -1 dBFS). */
  level: number;
  /** 1 (expendable) … 10 (never steal). */
  priority: number;
  /** Max simultaneous voices of this sound. */
  maxVoices: number;
  /** Distance (m) under which the sound plays at full level. */
  refDistance: number;
  rolloff?: number;
  /** Send into the live campus reverb for positional playback. */
  reverb?: number;
  /** Random playbackRate spread per call (±). */
  pitchJitter?: number;
  /** Route to the UI bus (not muffled by the low-health filter). */
  ui?: boolean;
}

const T0 = 0.004;

/* ------------------------------------------------------ shared builders -- */

interface GunSpec {
  crack: number;
  crackHp: number;
  crackTau: number;
  sonic?: number;
  thump: { f0: number; f1: number; sweep: number; tau: number; gain: number };
  body: { lp0: number; lp1: number; tau: number; gain: number };
  mid: { f: number; q: number; tau: number; gain: number };
  lowmid: { f: number; q: number; tau: number; gain: number };
  boom?: { tau: number; gain: number; lp: number };
  drive: number;
  /** Input gain into the saturator (keeps the layer sum near full scale). */
  pre?: number;
  /** Level of the saturated body relative to the (unsaturated) crack. */
  bodyLevel?: number;
  mech?: { t: number; f: number; decay: number; gain: number };
  taps: ReadonlyArray<readonly [number, number, number]>;
  tail: { wet: number; decay: number };
}

/**
 * Gunshot = sharp transient crack (kept *outside* the saturator so it pokes above the
 * body) + pitched low thump + swept noise body + low-mid chest + mid "bark", glued by
 * saturation, followed by building slap-back echoes and a short dark tail.
 */
function gunshot(c: RCtx, s: GunSpec): void {
  const r = c.rng;
  const t = T0;
  const j = (x: number, amt = 0.08) => x * (1 + r.bi() * amt);
  const echoIn = gain(c, 1);
  echoIn.connect(c.out);
  const body = satBus(c, echoIn, s.drive, s.pre ?? 0.45, s.bodyLevel ?? 0.55, 0.06);

  const crack = gain(c, 1);
  crack.connect(c.out);
  crack.connect(gain(c, 0.5)).connect(echoIn);
  // deterministic spike + decaying noise so every variant has the same transient peak
  const cl = Math.ceil(s.crackTau * 8 * c.sr);
  const cd = new Float32Array(cl);
  const ct = s.crackTau * c.sr;
  for (let i = 0; i < cl; i++) cd[i] = (i === 0 ? 1 : 0) + r.bi() * 0.55 * Math.exp(-i / ct);
  chain(src(c, cd, t), filter(c, 'highpass', j(s.crackHp), 0.7), gain(c, s.crack), crack);
  if (s.sonic) {
    // supersonic N-wave: instant positive jump, linear fall, snap back
    const n = Math.round(c.sr * 0.0005);
    const d = new Float32Array(n + 2);
    for (let i = 0; i < n; i++) d[i] = 1 - (2 * i) / n;
    src(c, d, t).connect(gain(c, s.sonic)).connect(crack);
  }
  thump(c, t, body, { f0: j(s.thump.f0), f1: j(s.thump.f1), sweep: j(s.thump.sweep), tau: j(s.thump.tau), gain: s.thump.gain });
  burst(c, t, body, {
    type: 'lowpass', f: j(s.body.lp0), f2: j(s.body.lp1), sweepTime: s.body.tau * 2.5, q: 0.9,
    tau: j(s.body.tau), gain: s.body.gain, attack: 0.0004,
  });
  burst(c, t, body, { type: 'bandpass', f: j(s.mid.f), q: s.mid.q, tau: j(s.mid.tau), gain: s.mid.gain, attack: 0.0003 });
  burst(c, t, body, { type: 'bandpass', f: j(s.lowmid.f), q: s.lowmid.q, tau: j(s.lowmid.tau), gain: s.lowmid.gain, attack: 0.0005 });
  if (s.boom) burst(c, t + 0.002, body, { type: 'lowpass', f: s.boom.lp, tau: j(s.boom.tau), gain: s.boom.gain, attack: 0.006 });
  if (s.mech) metalClick(c, t + j(s.mech.t, 0.15), c.out, { f: j(s.mech.f), decay: s.mech.decay, gain: s.mech.gain, tick: 0.4 });

  const taps = s.taps.map(([d, g, lp]) => [d * r.range(0.85, 1.2), g * r.range(0.8, 1.1), lp] as const);
  echoTaps(c, echoIn, taps, c.out);
  sendReverb(c, echoIn, c.out, s.tail.wet, { secs: s.tail.decay * 1.3, decay: s.tail.decay, lpStart: 5000, lpEnd: 700 });
}

/** Ricochet whine: a fast descending, wobbling sine with a little air around it. */
function ricochetWhine(c: RCtx, t: number, dest: AudioNode, g: number): void {
  const r = c.rng;
  const len = r.range(0.35, 0.5);
  const o = osc(c, 'sine', 3400, t, len + 0.05);
  const f0 = r.range(2900, 4000);
  const f1 = f0 * r.range(0.42, 0.55);
  sweep(o.frequency, t, f0, f1, len);
  const vib = osc(c, 'sine', r.range(28, 45), t, len + 0.05);
  const vg = gain(c, r.range(40, 90));
  vib.connect(vg).connect(o.frequency);
  const e = gain(c, 0);
  keys(e.gain, t, [[0, 0], [0.008, g], [len * 0.6, g * 0.45], [len, 0]]);
  chain(o, e, dest);
  burst(c, t, dest, { type: 'bandpass', f: f0 * 0.8, q: 3, tau: len * 0.3, gain: g * 0.25, attack: 0.005 });
}

/** A body (or heavy bag) dropping onto concrete: thud, bounce, cloth. */
function bodyFall(c: RCtx, t: number, dest: AudioNode, g: number): void {
  const r = c.rng;
  thump(c, t, dest, { f0: r.range(80, 95), f1: 42, sweep: 0.05, tau: 0.06, gain: g * 0.7 });
  burst(c, t, dest, { type: 'lowpass', f: r.range(900, 1300), tau: 0.04, gain: g * 0.8, attack: 0.002 });
  burst(c, t, dest, { type: 'bandpass', f: r.range(450, 650), q: 1.1, tau: 0.03, gain: g * 0.6, attack: 0.002 });
  const tb = t + r.range(0.09, 0.14);
  thump(c, tb, dest, { f0: 65, f1: 38, sweep: 0.04, tau: 0.05, gain: g * 0.45 });
  burst(c, tb, dest, { type: 'lowpass', f: 800, tau: 0.035, gain: g * 0.4, attack: 0.002 });
  scrape(c, t + 0.01, dest, { dur: 0.16, f0: 800, f1: 1500, q: 0.8, gain: g * 0.25, grain: 0.9 });
  crackle(c, t, dest, { count: 5, spread: 0.08, fLo: 1500, fHi: 4000, gain: g * 0.12 });
}

/** Randomised zombie groan / moan — the signature sound. */
function zombieGroan(c: RCtx): void {
  const r = c.rng;
  const d = r.range(1.4, 2.5);
  const base = r.range(58, 92);
  const shape = c.v % 4;
  const wobF = r.range(3.5, 6.5);
  const wobP = r.range(0, TAU);
  const wobA = r.range(0.02, 0.05);
  const slow = periodicLfo(r, d, 4);
  const f0 = (tt: number): number => {
    const u = tt / d;
    const contour =
      shape === 0 ? 1 + 0.22 * Math.sin(Math.PI * u)
      : shape === 1 ? 1.25 - 0.45 * u
      : shape === 2 ? 0.9 + 0.42 * smoothstep(0, 0.7, u) - 0.4 * smoothstep(0.75, 1, u)
      : 1 + 0.12 * Math.sin(TAU * 1.6 * tt);
    return base * contour * (1 + wobA * Math.sin(TAU * wobF * tt + wobP) + 0.05 * slow(tt));
  };
  const vowelSets: ReadonlyArray<ReadonlyArray<readonly [number, Vowel]>> = [
    [[0, 'u'], [0.35, 'o'], [0.7, 'a'], [1, 'uh']],
    [[0, 'uh'], [0.5, 'aa'], [1, 'o']],
    [[0, 'o'], [0.4, 'u'], [0.8, 'er'], [1, 'uh']],
    [[0, 'er'], [0.3, 'a'], [0.75, 'o'], [1, 'u']],
    [[0, 'u'], [0.6, 'uh'], [1, 'aa']],
    [[0, 'a'], [0.5, 'o'], [1, 'u']],
  ];
  const att = r.range(0.15, 0.35);
  voice(c, T0, c.out, {
    dur: d,
    f0,
    vowels: vowelSets[c.v % vowelSets.length]!,
    vt: r.range(0.78, 0.9),
    bw: r.range(1.3, 1.8),
    chest: 0.35,
    jitter: r.range(0.04, 0.08),
    shimmer: 0.25,
    fry: (u) => lerp(0.25, 0.65, u),
    breath: r.range(0.35, 0.55),
    tilt: 0.35,
    amp: [[0, 0], [att, 1], [d * 0.6, 0.85], [d * 0.85, 0.5], [d, 0]],
    drive: r.range(2.5, 4),
    lp: 4500,
    gurgle: r.range(8, 25),
    gurgleGain: 0.25,
    flutter: shape === 3 ? { rate: r.range(3.5, 5), depth: 0.6 } : undefined,
    double: c.v % 2 ? [0.5, 0.97, 0.3] : [1.013, 1.05, 0.35],
  });
  if (c.v % 3 === 1) {
    // trailing death-rattle exhale
    voice(c, T0 + d - 0.12, c.out, {
      dur: 0.55,
      f0: () => base * 0.6,
      vowels: [[0, 'uh'], [1, 'u']],
      vt: 0.85,
      bw: 2,
      fry: 0.9,
      jitter: 0.12,
      breath: 0.9,
      amp: [[0, 0], [0.08, 0.35], [0.55, 0]],
      drive: 3,
      lp: 3500,
    });
  }
}

/* ------------------------------------------------------------ recipes -- */

export const RECIPES: Record<SfxName, SfxRecipe> = {
  /* ---------------- weapons ---------------- */
  pistol_fire: {
    dur: 1.3, variants: 5, category: 'weapon', level: -5, priority: 9, maxVoices: 6, refDistance: 8, reverb: 0.25, pitchJitter: 0.04,
    render: (c) =>
      gunshot(c, {
        crack: 1.0, crackHp: 2200, crackTau: 0.0012,
        thump: { f0: 160, f1: 60, sweep: 0.035, tau: 0.03, gain: 0.9 },
        body: { lp0: 8000, lp1: 1200, tau: 0.035, gain: 1.0 },
        mid: { f: 1700, q: 1.1, tau: 0.025, gain: 0.7 },
        lowmid: { f: 600, q: 1.0, tau: 0.03, gain: 0.6 },
        boom: { tau: 0.09, gain: 0.2, lp: 220 },
        drive: 2.5,
        mech: { t: 0.03, f: 3000, decay: 0.02, gain: 0.1 },
        taps: [[0.085, 0.3, 2600], [0.15, 0.2, 1900], [0.26, 0.12, 1300], [0.41, 0.06, 900]],
        tail: { wet: 0.4, decay: 0.9 },
      }),
  },
  rifle_fire: {
    dur: 1.7, variants: 5, category: 'weapon', level: -4, priority: 9, maxVoices: 8, refDistance: 10, reverb: 0.3, pitchJitter: 0.035,
    render: (c) =>
      gunshot(c, {
        crack: 1.0, crackHp: 2800, crackTau: 0.001, sonic: 0.9,
        thump: { f0: 150, f1: 50, sweep: 0.045, tau: 0.04, gain: 1.0 },
        body: { lp0: 10000, lp1: 1400, tau: 0.045, gain: 1.0 },
        mid: { f: 2000, q: 1.0, tau: 0.03, gain: 0.75 },
        lowmid: { f: 550, q: 0.9, tau: 0.04, gain: 0.9 },
        boom: { tau: 0.16, gain: 0.3, lp: 200 },
        drive: 2.8,
        pre: 0.4,
        bodyLevel: 0.8,
        mech: { t: 0.045, f: 2400, decay: 0.03, gain: 0.1 },
        taps: [[0.1, 0.34, 3000], [0.18, 0.24, 2200], [0.31, 0.15, 1500], [0.47, 0.09, 1000], [0.66, 0.05, 800]],
        tail: { wet: 0.5, decay: 1.3 },
      }),
  },
  shotgun_fire: {
    dur: 2.1, variants: 5, category: 'weapon', level: -3, priority: 9, maxVoices: 4, refDistance: 10, reverb: 0.3, pitchJitter: 0.035,
    render: (c) =>
      gunshot(c, {
        crack: 0.9, crackHp: 1800, crackTau: 0.0018,
        thump: { f0: 115, f1: 38, sweep: 0.07, tau: 0.07, gain: 1.1 },
        body: { lp0: 7000, lp1: 700, tau: 0.08, gain: 1.1 },
        mid: { f: 1100, q: 0.9, tau: 0.05, gain: 0.75 },
        lowmid: { f: 450, q: 0.9, tau: 0.06, gain: 0.7 },
        boom: { tau: 0.3, gain: 0.45, lp: 170 },
        drive: 3.2,
        pre: 0.4,
        bodyLevel: 0.7,
        taps: [[0.11, 0.38, 2400], [0.2, 0.27, 1700], [0.34, 0.18, 1200], [0.52, 0.1, 850], [0.74, 0.05, 700]],
        tail: { wet: 0.6, decay: 1.5 },
      }),
  },
  smg_fire: {
    dur: 0.9, variants: 6, category: 'weapon', level: -7, priority: 8, maxVoices: 8, refDistance: 8, reverb: 0.2, pitchJitter: 0.05,
    render: (c) =>
      gunshot(c, {
        crack: 0.9, crackHp: 2800, crackTau: 0.0009,
        thump: { f0: 180, f1: 75, sweep: 0.025, tau: 0.022, gain: 0.8 },
        body: { lp0: 8500, lp1: 1800, tau: 0.025, gain: 0.9 },
        mid: { f: 2300, q: 1.2, tau: 0.02, gain: 0.6 },
        lowmid: { f: 700, q: 1.1, tau: 0.02, gain: 0.5 },
        boom: { tau: 0.07, gain: 0.1, lp: 250 },
        drive: 2.3,
        mech: { t: 0.018, f: 3400, decay: 0.012, gain: 0.08 },
        taps: [[0.075, 0.2, 2600], [0.14, 0.12, 1800], [0.24, 0.06, 1200]],
        tail: { wet: 0.3, decay: 0.7 },
      }),
  },
  dry_fire: {
    dur: 0.15, variants: 3, category: 'weapon', level: -10, priority: 6, maxVoices: 2, refDistance: 2,
    render: (c) => {
      metalClick(c, T0, c.out, { f: 4200 * c.rng.range(0.95, 1.05), decay: 0.006, gain: 0.45, tick: 0.8 });
      metalClick(c, T0 + 0.012, c.out, { f: 2300 * c.rng.range(0.95, 1.05), decay: 0.02, gain: 1, tick: 0.6, body: 0.3, bodyF: 320 });
    },
  },
  reload_mag_out: {
    dur: 0.5, variants: 3, category: 'foley', level: -9, priority: 5, maxVoices: 3, refDistance: 2,
    render: (c) => {
      const r = c.rng;
      metalClick(c, T0, c.out, { f: 3600 * r.range(0.95, 1.05), decay: 0.01, gain: 0.5 });
      scrape(c, T0 + 0.02, c.out, { dur: 0.11, f0: 2600, f1: 1500, q: 3, gain: 0.35 });
      metalClick(c, T0 + r.range(0.12, 0.14), c.out, { f: 1300 * r.range(0.92, 1.08), decay: 0.035, gain: 0.8, body: 0.4, bodyF: 170 });
    },
  },
  reload_mag_in: {
    dur: 0.45, variants: 3, category: 'foley', level: -8, priority: 5, maxVoices: 3, refDistance: 2,
    render: (c) => {
      const r = c.rng;
      scrape(c, T0, c.out, { dur: 0.075, f0: 1300, f1: 2900, q: 2.5, gain: 0.4 });
      metalClick(c, T0 + 0.085, c.out, { f: 1700 * r.range(0.93, 1.07), decay: 0.045, gain: 1, body: 0.6, bodyF: 150 });
      metalClick(c, T0 + 0.1, c.out, { f: 4300 * r.range(0.95, 1.05), decay: 0.008, gain: 0.35 });
    },
  },
  reload_rack: {
    dur: 0.55, variants: 3, category: 'foley', level: -8, priority: 5, maxVoices: 3, refDistance: 2,
    render: (c) => {
      const r = c.rng;
      metalClick(c, T0, c.out, { f: 2600 * r.range(0.95, 1.05), decay: 0.02, gain: 0.6 });
      scrape(c, T0 + 0.01, c.out, { dur: 0.09, f0: 1800, f1: 3200, q: 3, gain: 0.35 });
      const tf = T0 + r.range(0.14, 0.16);
      metalClick(c, tf, c.out, { f: 1450 * r.range(0.94, 1.06), decay: 0.06, gain: 1, body: 0.5, bodyF: 130 });
      metalClick(c, tf + 0.008, c.out, { f: 3900, decay: 0.01, gain: 0.4 });
    },
  },
  shotgun_pump: {
    dur: 0.6, variants: 3, category: 'foley', level: -7, priority: 5, maxVoices: 3, refDistance: 2.5,
    render: (c) => {
      const r = c.rng;
      scrape(c, T0, c.out, { dur: 0.09, f0: 900, f1: 1900, q: 2, gain: 0.45 });
      metalClick(c, T0 + 0.085, c.out, { f: 1100 * r.range(0.93, 1.07), decay: 0.04, gain: 0.8, body: 0.5, bodyF: 140 });
      const tf = T0 + r.range(0.19, 0.22);
      scrape(c, tf, c.out, { dur: 0.08, f0: 1700, f1: 900, q: 2, gain: 0.4 });
      metalClick(c, tf + 0.08, c.out, { f: 1250 * r.range(0.93, 1.07), decay: 0.06, gain: 1, body: 0.7, bodyF: 120 });
      metalClick(c, tf + 0.09, c.out, { f: 3200, decay: 0.012, gain: 0.35 });
    },
  },
  shell_insert: {
    dur: 0.3, variants: 4, category: 'foley', level: -10, priority: 4, maxVoices: 3, refDistance: 2,
    render: (c) => {
      const r = c.rng;
      metalClick(c, T0, c.out, { f: 2100 * r.range(0.93, 1.07), decay: 0.015, gain: 0.45, ratios: [1, 2.1, 3.3] });
      scrape(c, T0 + 0.02, c.out, { dur: 0.05, f0: 1200, f1: 2500, q: 2, gain: 0.3 });
      metalClick(c, T0 + r.range(0.065, 0.085), c.out, { f: 2900 * r.range(0.95, 1.05), decay: 0.012, gain: 0.7, body: 0.35, bodyF: 260 });
    },
  },
  bat_swing: {
    dur: 0.5, variants: 4, category: 'weapon', level: -7, priority: 6, maxVoices: 3, refDistance: 3, pitchJitter: 0.06,
    render: (c) => {
      const r = c.rng;
      const d = r.range(0.36, 0.44);
      whoosh(c, T0, c.out, { dur: d, fLo: r.range(250, 320), fHi: r.range(1100, 1500), peakAt: 0.45, q: 2.2, gain: 0.9, fEnd: 420 });
      const o = osc(c, 'sine', 80, T0, d);
      o.frequency.setValueAtTime(80, T0);
      o.frequency.linearRampToValueAtTime(150, T0 + d * 0.45);
      o.frequency.linearRampToValueAtTime(70, T0 + d);
      const g = gain(c, 0);
      keys(g.gain, T0, [[0, 0], [d * 0.45, 0.1], [d, 0]]);
      chain(o, g, c.out);
    },
  },
  bat_hit: {
    dur: 0.6, variants: 4, category: 'weapon', level: -3, priority: 8, maxVoices: 4, refDistance: 4, reverb: 0.15, pitchJitter: 0.05,
    render: (c) => {
      const r = c.rng;
      const pre = satBus(c, c.out, 2.2, 0.4, 0.8);
      modalHit(c, T0, pre, { modes: modesFrom(r.range(260, 360), RATIOS.wood, 0.08, r, 0.03, 0.8), gain: 0.9, exciteMs: 0.8 });
      burst(c, T0, c.out, { type: 'highpass', f: 2500, tau: 0.002, gain: 0.7 });
      thump(c, T0, pre, { f0: 140, f1: 52, sweep: 0.05, tau: 0.06, gain: 1 });
      burst(c, T0, pre, { type: 'lowpass', f: 900, tau: 0.045, gain: 0.7, attack: 0.002 });
      crackle(c, T0, pre, { count: 10, spread: 0.035, fLo: 1800, fHi: 4000, gain: 0.35, decayMs: 0.3 });
      echoTaps(c, pre, [[0.09, 0.15, 2200], [0.17, 0.08, 1500]], c.out);
    },
  },
  weapon_switch: {
    dur: 0.45, variants: 3, category: 'foley', level: -11, priority: 4, maxVoices: 2, refDistance: 2,
    render: (c) => {
      const r = c.rng;
      scrape(c, T0, c.out, { dur: 0.16, f0: 1200, f1: 2200, q: 0.8, gain: 0.35, grain: 0.9 });
      metalClick(c, T0 + r.range(0.09, 0.11), c.out, { f: 2800 * r.range(0.93, 1.07), decay: 0.05, gain: 0.6 });
      metalClick(c, T0 + r.range(0.19, 0.22), c.out, { f: 3700, decay: 0.01, gain: 0.5, body: 0.3, bodyF: 250 });
    },
  },
  bullet_whiz: {
    dur: 0.35, variants: 5, category: 'weapon', level: -6, priority: 7, maxVoices: 4, refDistance: 3, pitchJitter: 0.08,
    render: (c) => {
      const r = c.rng;
      burst(c, T0, c.out, { type: 'highpass', f: 4000, tau: 0.0008, gain: 0.5 });
      const d = r.range(0.2, 0.28);
      whoosh(c, T0 + 0.005, c.out, { dur: d, fLo: r.range(4000, 5200), fHi: 3000, peakAt: 0.3, q: 5, gain: 0.7, fEnd: r.range(1000, 1500), color: 'white' });
      const o = osc(c, 'sine', 3000, T0, d);
      sweep(o.frequency, T0, r.range(2600, 3400), r.range(650, 900), d);
      const g = gain(c, 0);
      keys(g.gain, T0, [[0, 0], [d * 0.3, 0.35], [d, 0]]);
      chain(o, g, c.out);
    },
  },

  /* ---------------- impacts ---------------- */
  impact_flesh: {
    dur: 0.35, variants: 6, category: 'impact', level: -8, priority: 6, maxVoices: 6, refDistance: 3, pitchJitter: 0.08,
    render: (c) => {
      const r = c.rng;
      const pre = satBus(c, c.out, 2, 0.45);
      thump(c, T0, pre, { f0: r.range(90, 115), f1: 45, sweep: 0.04, tau: 0.03, gain: 0.6 });
      burst(c, T0, pre, { type: 'lowpass', f: r.range(1200, 1800), tau: 0.02, gain: 0.9, attack: 0.001 });
      burst(c, T0, pre, { type: 'bandpass', f: r.range(700, 1100), q: 1.2, tau: 0.015, gain: 0.7, attack: 0.0008 });
      const gg = gurgle(c.sr, 0.12, r.range(50, 80), r, 200, 700);
      chain(src(c, gg, T0 + 0.005), filter(c, 'bandpass', 800, 1), gain(c, 0.55), pre);
      crackle(c, T0, pre, { count: 5, spread: 0.03, fLo: 1000, fHi: 2800, gain: 0.35 });
    },
  },
  impact_concrete: {
    dur: 0.7, variants: 6, category: 'impact', level: -9, priority: 5, maxVoices: 6, refDistance: 3, pitchJitter: 0.06,
    render: (c) => {
      const r = c.rng;
      const pre = gain(c, 1);
      pre.connect(c.out);
      burst(c, T0, pre, { type: 'highpass', f: 3000, tau: 0.002, gain: 1 });
      burst(c, T0, pre, { type: 'bandpass', f: r.range(1800, 2600), q: 1, tau: 0.03, gain: 0.6 });
      crackle(c, T0 + 0.004, pre, { count: r.int(8, 14), spread: 0.22, fLo: 2500, fHi: 7000, gain: 0.3, decayMs: 0.25, falloff: 2 });
      thump(c, T0, pre, { f0: 220, f1: 120, sweep: 0.01, tau: 0.015, gain: 0.3 });
      if (c.v % 3 === 2) ricochetWhine(c, T0 + 0.015, pre, 0.35);
      echoTaps(c, pre, [[0.06, 0.15, 3000]], c.out);
    },
  },
  impact_metal: {
    dur: 1.0, variants: 5, category: 'impact', level: -9, priority: 5, maxVoices: 5, refDistance: 3, pitchJitter: 0.06,
    render: (c) => {
      const r = c.rng;
      burst(c, T0, c.out, { type: 'highpass', f: 4500, tau: 0.0012, gain: 0.8 });
      const ratios = c.v % 2 ? RATIOS.bar : RATIOS.plate;
      modalHit(c, T0, c.out, { modes: modesFrom(r.range(800, 1500), ratios, r.range(0.25, 0.5), r, 0.02, 0.7), gain: 0.8, exciteMs: 0.4 });
      thump(c, T0, c.out, { f0: 300, f1: 200, sweep: 0.01, tau: 0.01, gain: 0.2 });
      if (c.v === 3) ricochetWhine(c, T0 + 0.01, c.out, 0.4);
    },
  },
  impact_wood: {
    dur: 0.4, variants: 5, category: 'impact', level: -9, priority: 5, maxVoices: 5, refDistance: 3, pitchJitter: 0.06,
    render: (c) => {
      const r = c.rng;
      burst(c, T0, c.out, { type: 'highpass', f: 2000, tau: 0.002, gain: 0.6 });
      modalHit(c, T0, c.out, { modes: modesFrom(r.range(180, 320), RATIOS.wood, 0.06, r, 0.03, 0.8), gain: 0.9, exciteMs: 0.7 });
      crackle(c, T0 + 0.003, c.out, { count: 6, spread: 0.07, fLo: 2000, fHi: 4500, gain: 0.3 });
      thump(c, T0, c.out, { f0: 160, f1: 90, sweep: 0.02, tau: 0.02, gain: 0.35 });
    },
  },
  headshot: {
    dur: 0.5, variants: 4, category: 'impact', level: -3, priority: 8, maxVoices: 4, refDistance: 5, reverb: 0.1, pitchJitter: 0.05,
    render: (c) => {
      const r = c.rng;
      const pre = satBus(c, c.out, 3, 0.4, 0.75, 0.1);
      burst(c, T0, c.out, { type: 'highpass', f: 2600, tau: 0.0015, gain: 1 });
      const f = r.range(520, 650);
      const pop: Mode[] = [
        { f, decay: 0.035, amp: 1 },
        { f: f * 2.3, decay: 0.02, amp: 0.6 },
        { f: f * 3.9, decay: 0.012, amp: 0.4 },
      ];
      modalHit(c, T0, pre, { modes: pop, gain: 0.9, exciteMs: 0.4 });
      thump(c, T0, pre, { f0: 1200, f1: 180, sweep: 0.03, tau: 0.025, gain: 0.6 });
      crackle(c, T0 + 0.002, pre, { count: 12, spread: 0.045, fLo: 1800, fHi: 4200, gain: 1.0, decayMs: 0.35 });
      crackle(c, T0 + 0.001, c.out, { count: 7, spread: 0.03, fLo: 2500, fHi: 6000, gain: 0.35, decayMs: 0.2 });
      burst(c, T0, pre, { type: 'lowpass', f: 900, tau: 0.06, gain: 0.6, attack: 0.003 });
      thump(c, T0, pre, { f0: 95, f1: 38, sweep: 0.05, tau: 0.05, gain: 1 });
      const gg = gurgle(c.sr, 0.2, 80, r, 250, 900);
      chain(src(c, gg, T0 + 0.02), filter(c, 'bandpass', 700, 0.9), gain(c, 0.3), c.out);
      echoTaps(c, pre, [[0.07, 0.12, 2500]], c.out);
    },
  },

  /* ---------------- zombies ---------------- */
  zombie_groan: {
    sr: 32000, dur: 3.2, variants: 8, category: 'zombie', level: -8, priority: 4, maxVoices: 10, refDistance: 3, reverb: 0.2, pitchJitter: 0.12,
    render: zombieGroan,
  },
  zombie_growl_near: {
    sr: 32000, dur: 1.5, variants: 5, category: 'zombie', level: -5, priority: 6, maxVoices: 5, refDistance: 2.5, reverb: 0.12, pitchJitter: 0.1,
    render: (c) => {
      const r = c.rng;
      const d = r.range(0.7, 1.2);
      const base = r.range(48, 68);
      const wf = r.range(4, 7);
      voice(c, T0, c.out, {
        dur: d,
        f0: (tt) => base * (1 + 0.15 * Math.sin((Math.PI * tt) / d)) * (1 + 0.04 * Math.sin(TAU * wf * tt)),
        vowels: c.v % 2 ? [[0, 'o'], [0.4, 'aa'], [1, 'uh']] : [[0, 'uh'], [0.5, 'a'], [1, 'o']],
        vt: 0.75, bw: 1.8, chest: 0.5, jitter: 0.1, shimmer: 0.4, fry: 0.7, breath: 0.55, tilt: 0.45,
        amp: [[0, 0], [0.06, 1], [d * 0.7, 0.9], [d, 0]],
        flutter: { rate: r.range(22, 32), depth: 0.55 },
        drive: 6, asym: 0.15, lp: 5000, gurgle: 30, gurgleGain: 0.3,
        double: [0.5, 0.95, 0.5],
      });
    },
  },
  zombie_attack: {
    sr: 32000, dur: 1.1, variants: 5, category: 'zombie', level: -4, priority: 7, maxVoices: 4, refDistance: 3, reverb: 0.12, pitchJitter: 0.08,
    render: (c) => {
      const r = c.rng;
      const d = r.range(0.55, 0.85);
      const base = r.range(130, 170);
      voice(c, T0, c.out, {
        dur: d,
        f0: (tt) => {
          const u = tt / d;
          return base * (u < 0.15 ? lerp(0.8, 1.5, u / 0.15) : lerp(1.5, 1.05, (u - 0.15) / 0.85)) * (1 + 0.05 * Math.sin(TAU * 7 * tt));
        },
        vowels: [[0, 'a'], [0.2, 'aa'], [0.6, 'ae'], [1, 'a']],
        vt: 0.9, bw: 1.6, jitter: 0.08, shimmer: 0.3, fry: 0.25, breath: 0.65, tilt: 0.7,
        amp: [[0, 0], [0.03, 1], [d * 0.5, 0.8], [d, 0]],
        drive: 7, lp: 6500,
        double: [1.41, 1.05, 0.35],
      });
      whoosh(c, T0 + 0.12, c.out, { dur: 0.3, fLo: 350, fHi: 1500, peakAt: 0.5, q: 2, gain: 0.5, fEnd: 500 });
    },
  },
  zombie_death: {
    sr: 32000, dur: 2.6, variants: 4, category: 'zombie', level: -6, priority: 6, maxVoices: 5, refDistance: 3, reverb: 0.2, pitchJitter: 0.08,
    render: (c) => {
      const r = c.rng;
      const d = r.range(1.3, 1.8);
      const base = r.range(95, 125);
      voice(c, T0, c.out, {
        dur: d,
        f0: (tt) => base * Math.exp((-1.0 * tt) / d) * (1 + 0.03 * Math.sin(TAU * 5 * tt)),
        vowels: [[0, 'aa'], [0.4, 'o'], [0.8, 'u'], [1, 'uh']],
        vt: 0.85, bw: 1.5,
        fry: (u) => lerp(0.2, 0.9, u),
        breath: (u) => lerp(0.4, 0.9, u),
        jitter: (u) => lerp(0.05, 0.12, u),
        shimmer: 0.3,
        amp: [[0, 0], [0.05, 1], [d * 0.5, 0.8], [d * 0.9, 0.35], [d, 0]],
        drive: 4, lp: 4500, gurgle: 40, gurgleGain: 0.4,
        double: [0.5, 1, 0.25],
      });
      bodyFall(c, T0 + d - 0.2, c.out, 0.8);
    },
  },
  zombie_scream: {
    sr: 32000, dur: 1.9, variants: 4, category: 'zombie', level: -3, priority: 8, maxVoices: 3, refDistance: 6, reverb: 0.35, pitchJitter: 0.06,
    render: (c) => {
      const r = c.rng;
      const d = r.range(1.0, 1.5);
      const base = r.range(360, 520);
      const vibF = r.range(6, 8);
      const slow = periodicLfo(r, d, 3);
      voice(c, T0, c.out, {
        dur: d,
        f0: (tt) => {
          const u = tt / d;
          const rise = 0.65 + 0.35 * smoothstep(0, 0.08, u);
          const fall = 1 - 0.3 * smoothstep(0.7, 1, u);
          return base * rise * fall * (1 + 0.045 * Math.sin(TAU * vibF * tt) + 0.03 * slow(tt));
        },
        vowels: c.v % 2 ? [[0, 'aa'], [0.3, 'ae'], [0.7, 'e'], [1, 'a']] : [[0, 'a'], [0.5, 'i'], [1, 'aa']],
        vt: 1.1, bw: 2.2, chest: 0.1, jitter: 0.06, shimmer: 0.25, fry: 0.08, breath: 0.7, tilt: 0.85,
        amp: [[0, 0], [0.05, 1], [d * 0.8, 0.9], [d, 0]],
        drive: 8, asym: 0.2, lp: 7500,
        double: [1.47, 1.1, 0.55],
      });
      const n = noise(c, T0, d + 0.05);
      const g = gain(c, 0);
      keys(g.gain, T0, [[0, 0], [0.05, 0.3], [d * 0.8, 0.22], [d, 0]]);
      chain(n, filter(c, 'highpass', 2800, 0.7), g, c.out);
    },
  },
  zombie_hit_door: {
    dur: 1.4, variants: 6, category: 'zombie', level: -5, priority: 6, maxVoices: 4, refDistance: 4, reverb: 0.25, pitchJitter: 0.07,
    render: (c) => {
      const r = c.rng;
      const pre = satBus(c, c.out, 2, 0.45);
      if (c.v < 4) {
        // steel gate / grille: low panel boom + bright bar clang + rattling bars
        thump(c, T0, pre, { f0: 90, f1: 45, sweep: 0.04, tau: 0.06, gain: 0.7 });
        burst(c, T0, pre, { type: 'lowpass', f: 500, tau: 0.04, gain: 0.6, attack: 0.002 });
        modalHit(c, T0, pre, { modes: modesFrom(r.range(95, 160), RATIOS.plate, r.range(0.5, 0.9), r, 0.02, 0.5), gain: 0.8, exciteMs: 3, soft: true });
        modalHit(c, T0, pre, { modes: modesFrom(r.range(420, 700), RATIOS.plate, r.range(0.3, 0.5), r, 0.02, 0.6), gain: 0.7, exciteMs: 1 });
        burst(c, T0, c.out, { type: 'highpass', f: 2500, tau: 0.003, gain: 0.35 });
        const count = r.int(10, 18);
        for (let k = 0; k < count; k++) {
          const dt = 0.03 + Math.pow(r.next(), 1.5) * 0.55;
          metalClick(c, T0 + dt, pre, { f: r.range(1400, 3600), decay: r.range(0.008, 0.03), gain: r.range(0.1, 0.35) * (1 - dt / 0.7), tick: 0.3 });
        }
      } else {
        // wooden barricade / desk pile
        thump(c, T0, pre, { f0: 110, f1: 55, sweep: 0.03, tau: 0.05, gain: 1 });
        modalHit(c, T0, pre, { modes: modesFrom(r.range(90, 150), RATIOS.wood, 0.1, r, 0.03, 0.8), gain: 0.9, exciteMs: 2 });
        crackle(c, T0 + 0.005, pre, { count: 14, spread: 0.12, fLo: 1500, fHi: 4000, gain: 0.4 });
        const cr = osc(c, 'sawtooth', r.range(150, 210), T0 + 0.05, 0.25);
        const crv = osc(c, 'sine', 23, T0 + 0.05, 0.25);
        crv.connect(gain(c, 25)).connect(cr.frequency);
        const cg = gain(c, 0);
        keys(cg.gain, T0 + 0.05, [[0, 0], [0.03, 0.15], [0.2, 0]]);
        chain(cr, filter(c, 'bandpass', 900, 5), cg, pre);
      }
      echoTaps(c, pre, [[0.08, 0.2, 2000], [0.15, 0.1, 1400]], c.out);
    },
  },

  /* ---------------- player / npc ---------------- */
  player_hurt: {
    sr: 32000, dur: 0.6, variants: 5, category: 'player', level: -7, priority: 8, maxVoices: 2, refDistance: 3, pitchJitter: 0.04,
    render: (c) => {
      const r = c.rng;
      const d = r.range(0.25, 0.42);
      const base = r.range(125, 160);
      const sets: ReadonlyArray<ReadonlyArray<readonly [number, Vowel]>> = [
        [[0, 'uh'], [1, 'a']], [[0, 'e'], [1, 'uh']], [[0, 'a'], [1, 'uh']], [[0, 'ae'], [1, 'er']], [[0, 'uh'], [1, 'o']],
      ];
      voice(c, T0, c.out, {
        dur: d,
        f0: (tt) => base * (1.15 - 0.3 * (tt / d)),
        vowels: sets[c.v % sets.length]!,
        vt: 1, bw: 1.1, jitter: 0.02, shimmer: 0.12, fry: (u) => u * 0.3, breath: 0.35, tilt: 0.6,
        amp: [[0, 0], [0.015, 1], [d * 0.4, 0.8], [d, 0]],
        drive: 1.8, lp: 7000,
      });
      thump(c, T0, c.out, { f0: 110, f1: 50, sweep: 0.03, tau: 0.03, gain: 0.35 });
      burst(c, T0, c.out, { type: 'lowpass', f: 1000, tau: 0.02, gain: 0.25 });
    },
  },
  player_death: {
    sr: 32000, dur: 3.0, variants: 2, category: 'player', level: -3, priority: 10, maxVoices: 1, refDistance: 3,
    render: (c) => {
      const r = c.rng;
      const d = 1.3;
      const base = r.range(160, 180);
      const dry = gain(c, 1);
      dry.connect(c.out);
      voice(c, T0, dry, {
        dur: d,
        f0: (tt) => base * (tt < 0.25 ? lerp(0.9, 1.1, tt / 0.25) : lerp(1.1, 0.55, (tt - 0.25) / (d - 0.25))) * (1 + 0.02 * Math.sin(TAU * 5.5 * tt)),
        vowels: [[0, 'a'], [0.5, 'aa'], [0.8, 'o'], [1, 'u']],
        vt: 1, bw: 1.2,
        jitter: (u) => lerp(0.02, 0.06, u), fry: (u) => u * 0.6, breath: (u) => lerp(0.3, 0.8, u), tilt: 0.6,
        amp: [[0, 0], [0.04, 1], [0.6, 0.8], [1.1, 0.35], [d, 0]],
        drive: 2, lp: 7000,
      });
      bodyFall(c, T0 + 1.05, dry, 0.9);
      thump(c, T0 + 1.05, dry, { f0: 55, f1: 30, sweep: 0.3, tau: 0.7, gain: 0.7 });
      const tin = osc(c, 'sine', 3800, T0 + 1.0, 1.9);
      const tg = gain(c, 0);
      keys(tg.gain, T0 + 1.0, [[0, 0], [0.2, 0.06], [1.8, 0]]);
      chain(tin, tg, c.out);
      sendReverb(c, dry, c.out, 0.3, { decay: 1.6, secs: 2 });
    },
  },
  footstep_concrete: {
    dur: 0.25, variants: 6, category: 'foley', level: -16, priority: 3, maxVoices: 6, refDistance: 2, pitchJitter: 0.06,
    render: (c) => {
      const r = c.rng;
      burst(c, T0, c.out, { type: 'lowpass', f: r.range(800, 1200), tau: 0.012, gain: 0.8, attack: 0.002 });
      burst(c, T0, c.out, { type: 'bandpass', f: r.range(350, 550), q: 1.2, tau: 0.015, gain: 0.5, attack: 0.002 });
      thump(c, T0, c.out, { f0: r.range(95, 120), f1: 60, sweep: 0.015, tau: 0.015, gain: 0.18 });
      burst(c, T0 + r.range(0.02, 0.045), c.out, { type: 'bandpass', f: r.range(2400, 3800), q: 1.4, tau: 0.018, gain: 0.45, attack: 0.003 });
      crackle(c, T0, c.out, { count: 6, spread: 0.05, fLo: 3000, fHi: 7000, gain: 0.25 });
      burst(c, T0 + r.range(0.05, 0.07), c.out, { type: 'lowpass', f: 1400, tau: 0.008, gain: 0.35, attack: 0.001 });
    },
  },
  footstep_grass: {
    dur: 0.3, variants: 6, category: 'foley', level: -17, priority: 3, maxVoices: 6, refDistance: 2, pitchJitter: 0.06,
    render: (c) => {
      const r = c.rng;
      crackle(c, T0, c.out, { count: r.int(30, 50), spread: 0.12, fLo: 2500, fHi: 7000, gain: 0.6, decayMs: 0.4, falloff: 1.2 });
      burst(c, T0, c.out, { type: 'bandpass', f: r.range(2800, 3600), q: 0.7, tau: 0.05, gain: 0.3, attack: 0.01 });
      burst(c, T0, c.out, { type: 'lowpass', f: 300, tau: 0.02, gain: 0.5, attack: 0.003 });
    },
  },
  jump_land: {
    dur: 0.45, variants: 3, category: 'foley', level: -10, priority: 5, maxVoices: 3, refDistance: 2.5,
    render: (c) => {
      thump(c, T0, c.out, { f0: 85, f1: 45, sweep: 0.04, tau: 0.045, gain: 0.6 });
      burst(c, T0, c.out, { type: 'lowpass', f: 900, tau: 0.03, gain: 0.9, attack: 0.002 });
      burst(c, T0 + 0.02, c.out, { type: 'bandpass', f: 2600, q: 1.2, tau: 0.04, gain: 0.35 });
      scrape(c, T0 + 0.01, c.out, { dur: 0.12, f0: 900, f1: 1600, q: 0.8, gain: 0.2, grain: 0.9 });
      metalClick(c, T0 + 0.03, c.out, { f: 3500, decay: 0.01, gain: 0.12 });
      metalClick(c, T0 + 0.06, c.out, { f: 3900, decay: 0.01, gain: 0.1 });
    },
  },
  heartbeat: {
    sr: 32000, dur: 0.9, variants: 2, category: 'player', level: -4, priority: 9, maxVoices: 2, refDistance: 2, ui: true,
    render: (c) => {
      const pre = gain(c, 0.6);
      chain(pre, filter(c, 'lowpass', 180, 0.7), shaper(c, 1.6), c.out);
      thump(c, T0, pre, { f0: 62, f1: 42, sweep: 0.05, tau: 0.06, gain: 1 });
      burst(c, T0, pre, { type: 'lowpass', f: 120, tau: 0.04, gain: 0.5 });
      thump(c, T0 + 0.28, pre, { f0: 56, f1: 40, sweep: 0.04, tau: 0.05, gain: 0.7 });
      burst(c, T0 + 0.28, pre, { type: 'lowpass', f: 110, tau: 0.035, gain: 0.35 });
    },
  },
  revive_progress: {
    dur: 0.6, variants: 2, category: 'player', level: -15, priority: 6, maxVoices: 2, refDistance: 3, ui: true,
    render: (c) => {
      const o = osc(c, 'sine', 520, T0, 0.5);
      sweep(o.frequency, T0, 520, 780, 0.18);
      const g = gain(c, 0);
      keys(g.gain, T0, [[0, 0], [0.02, 0.8], [0.25, 0.3], [0.45, 0]]);
      chain(o, g, c.out);
      const o2 = osc(c, 'triangle', 1040, T0, 0.5);
      sweep(o2.frequency, T0, 1040, 1560, 0.18);
      const g2 = gain(c, 0);
      keys(g2.gain, T0, [[0, 0], [0.02, 0.12], [0.25, 0.05], [0.45, 0]]);
      chain(o2, g2, c.out);
      fmBell(c, T0 + 0.1, c.out, { f: 2080, ratio: 2.01, index: 0.8, tau: 0.12, gain: 0.12 });
    },
  },
  pickup_ammo: {
    dur: 0.5, variants: 3, category: 'foley', level: -8, priority: 6, maxVoices: 2, refDistance: 2, ui: true,
    render: (c) => {
      const r = c.rng;
      modalHit(c, T0, c.out, { modes: modesFrom(r.range(160, 220), RATIOS.wood, 0.05, r), gain: 0.7, exciteMs: 1.5 });
      const n = r.int(7, 10);
      for (let k = 0; k < n; k++) {
        metalClick(c, T0 + r.range(0.01, 0.16), c.out, { f: r.range(3000, 5500), decay: r.range(0.02, 0.06), gain: r.range(0.15, 0.4), ratios: RATIOS.bar, tick: 0.3 });
      }
      scrape(c, T0, c.out, { dur: 0.1, f0: 1400, f1: 2400, q: 0.8, gain: 0.15, grain: 0.9 });
    },
  },
  pickup_health: {
    dur: 0.9, variants: 2, category: 'foley', level: -10, priority: 6, maxVoices: 2, refDistance: 2, ui: true,
    render: (c) => {
      scrape(c, T0, c.out, { dur: 0.09, f0: 2500, f1: 4200, q: 2, gain: 0.25, grain: 0.95 });
      const up = c.v ? 1.1225 : 1;
      fmBell(c, T0 + 0.03, c.out, { f: 880 * up, ratio: 2, index: 1.2, tau: 0.25, gain: 0.5 });
      fmBell(c, T0 + 0.12, c.out, { f: 1318.5 * up, ratio: 2, index: 1, tau: 0.3, gain: 0.45 });
      const o = osc(c, 'sine', 440 * up, T0 + 0.03, 0.7);
      const g = gain(c, 0);
      perc(g.gain, T0 + 0.03, 0.12, 0.05, 0.2);
      chain(o, g, c.out);
    },
  },
  pickup_weapon: {
    dur: 0.7, variants: 2, category: 'foley', level: -7, priority: 6, maxVoices: 2, refDistance: 2, ui: true,
    render: (c) => {
      metalClick(c, T0, c.out, { f: 900, decay: 0.08, gain: 0.9, body: 0.6, bodyF: 120 });
      scrape(c, T0 + 0.1, c.out, { dur: 0.08, f0: 1800, f1: 3000, q: 3, gain: 0.3 });
      metalClick(c, T0 + 0.2, c.out, { f: 1500, decay: 0.05, gain: 0.8, body: 0.4, bodyF: 150 });
      metalClick(c, T0 + 0.21, c.out, { f: 3800, decay: 0.01, gain: 0.35 });
      scrape(c, T0, c.out, { dur: 0.15, f0: 1000, f1: 1800, q: 0.8, gain: 0.15, grain: 0.9 });
    },
  },
  points_ding: {
    dur: 0.7, variants: 3, category: 'ui', level: -14, priority: 5, maxVoices: 3, refDistance: 2, ui: true, pitchJitter: 0.01,
    render: (c) => {
      const f = 1320 * [1, 1.0595, 0.9439][c.v % 3]!;
      fmBell(c, T0, c.out, { f, ratio: 1.4, index: 1.6, tau: 0.18, gain: 0.6 });
      const o = osc(c, 'sine', f * 2, T0, 0.3);
      const g = gain(c, 0);
      perc(g.gain, T0, 0.2, 0.001, 0.05);
      chain(o, g, c.out);
      const o2 = osc(c, 'sine', f, T0, 0.65);
      const g2 = gain(c, 0);
      perc(g2.gain, T0, 0.5, 0.002, 0.35);
      chain(o2, g2, c.out);
    },
  },
  barricade_repair: {
    dur: 1.3, variants: 3, category: 'foley', level: -8, priority: 5, maxVoices: 3, refDistance: 3, reverb: 0.15,
    render: (c) => {
      const r = c.rng;
      const pre = gain(c, 1);
      pre.connect(c.out);
      const times = [0, r.range(0.28, 0.36), r.range(0.6, 0.7)];
      times.forEach((tk, k) => {
        const s = k === 2 ? 1 : r.range(0.7, 0.9);
        const t = T0 + tk;
        metalClick(c, t, pre, { f: r.range(2300, 3100), decay: 0.1, gain: 0.5 * s, ratios: RATIOS.bar, tick: 0.3 });
        modalHit(c, t, pre, { modes: modesFrom(r.range(170, 240), RATIOS.wood, 0.06, r), gain: 0.9 * s, exciteMs: 1 });
        burst(c, t, pre, { type: 'highpass', f: 2200, tau: 0.002, gain: 0.5 * s });
        thump(c, t, pre, { f0: 150, f1: 80, sweep: 0.02, tau: 0.025, gain: 0.5 * s });
      });
      echoTaps(c, pre, [[0.07, 0.15, 2500], [0.13, 0.08, 1800]], c.out);
    },
  },
  gate_close: {
    sr: 32000, dur: 3.4, variants: 2, category: 'foley', level: -4, priority: 7, maxVoices: 2, refDistance: 6, reverb: 0.3,
    render: (c) => {
      const r = c.rng;
      const L = r.range(1.4, 1.8);
      const t = T0;
      const pre = satBus(c, c.out, 1.8, 0.5);
      // rolling rumble of wheels on the track
      const rum = noise(c, t, L + 0.1, 'brown');
      const rg = gain(c, 0);
      keys(rg.gain, t, [[0, 0], [0.15, 0.9], [L * 0.8, 0.8], [L, 0.3], [L + 0.1, 0]]);
      chain(rum, filter(c, 'lowpass', 160, 0.8), rg, pre);
      for (let tb = 0.05; tb < L; tb += r.range(0.08, 0.14)) {
        thump(c, t + tb, pre, { f0: 70, f1: 45, sweep: 0.01, tau: 0.02, gain: r.range(0.2, 0.4) });
      }
      // grinding track
      const gr = noise(c, t, L + 0.1);
      const gf = filter(c, 'bandpass', 700, 3);
      const gg = gain(c, 0);
      keys(gg.gain, t, [[0, 0], [0.2, 1.2], [L * 0.8, 1.0], [L, 0]]);
      chain(gr, gf, gg, pre);
      // squealing wheel
      const sq = osc(c, 'sawtooth', 1050, t, L);
      keys(sq.frequency, t, [[0, 1000], [L * 0.5, 1250], [L, 1100]]);
      const sv = osc(c, 'sine', 5.5, t, L);
      sv.connect(gain(c, 25)).connect(sq.frequency);
      const sg = gain(c, 0);
      keys(sg.gain, t, [[0, 0], [0.3, 0], [0.6, 0.18], [1.1, 0.05], [L, 0]]);
      chain(sq, filter(c, 'bandpass', 1200, 6), sg, pre);
      // rattling bars
      for (let k = 0; k < 12; k++) {
        metalClick(c, t + r.range(0.1, L), pre, { f: r.range(1500, 3000), decay: r.range(0.01, 0.03), gain: r.range(0.1, 0.2), tick: 0.3 });
      }
      // the slam
      const ts = t + L;
      thump(c, ts, pre, { f0: 80, f1: 40, sweep: 0.05, tau: 0.08, gain: 1 });
      modalHit(c, ts, pre, { modes: modesFrom(r.range(70, 100), RATIOS.plate, 1.3, r, 0.02, 0.45), gain: 0.9, exciteMs: 4, soft: true });
      metalClick(c, ts + 0.07, pre, { f: 1400, decay: 0.05, gain: 0.6, body: 0.4, bodyF: 150 });
      for (let k = 0; k < 8; k++) {
        const dt = 0.05 + Math.pow(r.next(), 1.4) * 0.4;
        metalClick(c, ts + dt, pre, { f: r.range(1500, 3200), decay: r.range(0.01, 0.03), gain: r.range(0.1, 0.25) * (1 - dt), tick: 0.3 });
      }
      echoTaps(c, pre, [[0.1, 0.3, 2000], [0.19, 0.18, 1400], [0.33, 0.1, 900]], c.out);
    },
  },

  /* ---------------- game flow ---------------- */
  wave_start: {
    sr: 32000, dur: 6.5, variants: 2, channels: 2, category: 'flow', level: -3, priority: 10, maxVoices: 1, refDistance: 10, ui: true,
    render: (c) => {
      const r = c.rng;
      const t = T0;
      // --- the college electric bell (trembler hammer on a gong) ---
      const f0 = r.range(980, 1150);
      const ringDur = r.range(2.2, 2.6);
      const rate = r.range(17, 22);
      const n = Math.ceil((ringDur + 1.6) * c.sr);
      const ex = new Float32Array(Math.ceil(ringDur * c.sr));
      for (let k = 0; ; k++) {
        const at = Math.floor(((k + r.bi() * 0.06) / rate) * c.sr);
        if (at >= ex.length - 8) break;
        if (at < 0) continue;
        const a = r.range(0.6, 1);
        for (let i = 0; i < 6; i++) ex[at + i]! += a * Math.exp(-i / 1.5) * (i % 2 ? -0.6 : 1);
      }
      const amps = [1, 0.55, 0.7, 0.35, 0.3, 0.15, 0.1];
      const decs = [1.1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.15];
      const modes: Mode[] = RATIOS.bell.map((ra, i) => ({ f: f0 * ra * (1 + r.bi() * 0.005), amp: amps[i]!, decay: decs[i]! }));
      const bell = normalize(modal(n, c.sr, modes, ex), 0.9);
      // the bell gong resonance builds up (~9 dB crest); saturate it for a loud, rattly ring
      const bellBus = gain(c, 0.8);
      bellBus.connect(c.out);
      chain(src(c, bell, t), filter(c, 'highpass', 500, 0.7), satBus(c, bellBus, 1.6, 1.8));
      // hammer ticks + electromagnet buzz
      chain(src(c, ex, t), filter(c, 'highpass', 3000, 0.7), gain(c, 0.12), bellBus);
      const buzz = osc(c, 'square', 100, t, ringDur);
      const bz = gain(c, 0);
      keys(bz.gain, t, [[0, 0], [0.02, 0.05], [ringDur - 0.02, 0.05], [ringDur, 0]]);
      chain(buzz, filter(c, 'bandpass', 400, 2), bz, bellBus);
      // college corridor reverb
      sendReverb(c, bellBus, c.out, 0.55, {
        secs: 2, decay: 1.6, lpStart: 7000, lpEnd: 1500, stereo: true,
        early: [[0.011, 0.6], [0.019, 0.5], [0.031, 0.4], [0.047, 0.35], [0.066, 0.3], [0.09, 0.2]],
      });
      // --- low drone hit ("braam") ---
      const tb = t + ringDur + 0.35;
      const braam = satBus(c, c.out, 2, 0.45, 0.6);
      thump(c, tb, braam, { f0: 52, f1: 32, sweep: 0.4, tau: 1.2, gain: 1, len: 3.5 });
      burst(c, tb, braam, { type: 'lowpass', f: 140, tau: 0.7, gain: 0.6, attack: 0.01, len: 3.2 });
      sawCluster(c, tb, braam, { freqs: [36.71, 55, 77.78, 73.42], detune: 12, lp0: 900, lp1: 160, attack: 0.04, tau: 1.1, gain: 0.9, len: 3.4 });
      sendReverb(c, braam, c.out, 0.35, { secs: 3, decay: 2.5, lpStart: 3000, lpEnd: 400, stereo: true });
    },
  },
  wave_end: {
    sr: 32000, dur: 4.5, variants: 2, channels: 2, category: 'flow', level: -6, priority: 10, maxVoices: 1, refDistance: 10, ui: true,
    render: (c) => {
      const t = T0;
      const bus = gain(c, 1);
      bus.connect(c.out);
      const lp = filter(c, 'lowpass', 1800, 0.7);
      const pad = gain(c, 0);
      keys(pad.gain, t, [[0, 0], [0.4, 0.22], [1.6, 0.18], [3.8, 0]]);
      chain(lp, pad, bus);
      for (const f of [146.83, 220, 293.66, 369.99, 659.25]) {
        for (const d of [-6, 6]) {
          const o = osc(c, 'triangle', f, t, 4);
          o.detune.value = d;
          o.connect(lp);
        }
      }
      const notes: ReadonlyArray<readonly [number, number, number]> = c.v
        ? [[0.3, 587.33, 0.3], [0.6, 659.25, 0.3], [0.9, 739.99, 1.1]]
        : [[0.35, 440, 0.35], [0.7, 493.88, 0.35], [1.05, 587.33, 1.0]];
      flute(c, t, bus, { notes, gain: 0.35 });
      // manjira (small hand cymbals) shimmer
      for (const tm of [0.05, 1.05]) {
        modalHit(c, t + tm, bus, {
          modes: [
            { f: 2600, amp: 1, decay: 1.2 }, { f: 2600 * 2.93, amp: 0.6, decay: 0.8 },
            { f: 2600 * 4.1, amp: 0.4, decay: 0.5 }, { f: 2600 * 5.6, amp: 0.25, decay: 0.3 },
          ],
          gain: 0.18,
          exciteMs: 0.3,
        });
      }
      sendReverb(c, bus, c.out, 0.5, { secs: 3, decay: 2.4, lpStart: 6000, lpEnd: 1200, stereo: true });
    },
  },
  ui_click: {
    dur: 0.1, variants: 3, category: 'ui', level: -14, priority: 4, maxVoices: 3, refDistance: 1, ui: true,
    render: (c) => {
      const o = osc(c, 'sine', 1500, T0, 0.08);
      sweep(o.frequency, T0, 1500 * c.rng.range(0.95, 1.05), 1000, 0.012);
      const g = gain(c, 0);
      perc(g.gain, T0, 0.8, 0.001, 0.012);
      chain(o, g, c.out);
      burst(c, T0, c.out, { type: 'highpass', f: 5000, tau: 0.0015, gain: 0.3 });
    },
  },
  ui_hover: {
    dur: 0.06, variants: 2, category: 'ui', level: -22, priority: 2, maxVoices: 2, refDistance: 1, ui: true,
    render: (c) => {
      const o = osc(c, 'sine', 2400 + c.v * 120, T0, 0.05);
      const g = gain(c, 0);
      perc(g.gain, T0, 0.5, 0.001, 0.006);
      chain(o, g, c.out);
    },
  },
  ui_error: {
    dur: 0.35, variants: 2, category: 'ui', level: -17, priority: 5, maxVoices: 1, refDistance: 1, ui: true,
    render: (c) => {
      const lp = filter(c, 'lowpass', 1400, 0.7);
      lp.connect(c.out);
      ([[0, 220], [0.13, 175]] as const).forEach(([dt, f]) => {
        const o = osc(c, 'square', f * (c.v ? 1.03 : 1), T0 + dt, 0.1);
        const g = gain(c, 0);
        keys(g.gain, T0 + dt, [[0, 0], [0.004, 0.5], [0.08, 0.45], [0.095, 0]]);
        chain(o, g, lp);
      });
    },
  },
  round_counter_tick: {
    dur: 0.15, variants: 3, category: 'ui', level: -12, priority: 5, maxVoices: 2, refDistance: 1, ui: true,
    render: (c) => {
      const f = 1900 * c.rng.range(0.97, 1.03);
      modalHit(c, T0, c.out, { modes: [{ f, decay: 0.02, amp: 1 }, { f: f * 2.3, decay: 0.01, amp: 0.5 }], gain: 0.7, exciteMs: 0.3 });
      burst(c, T0, c.out, { type: 'highpass', f: 3500, tau: 0.001, gain: 0.4 });
      thump(c, T0, c.out, { f0: 500, f1: 380, sweep: 0.005, tau: 0.008, gain: 0.3 });
    },
  },

  /* ---------------- extras ---------------- */
  ricochet: {
    dur: 0.7, variants: 4, category: 'impact', level: -9, priority: 5, maxVoices: 3, refDistance: 3, reverb: 0.15, pitchJitter: 0.06,
    render: (c) => {
      burst(c, T0, c.out, { type: 'highpass', f: 3500, tau: 0.0015, gain: 0.6 });
      ricochetWhine(c, T0 + 0.005, c.out, 0.8);
    },
  },
  body_fall: {
    dur: 0.6, variants: 3, category: 'foley', level: -8, priority: 4, maxVoices: 4, refDistance: 3, pitchJitter: 0.06,
    render: (c) => bodyFall(c, T0, c.out, 1),
  },
  zombie_footstep: {
    dur: 0.5, variants: 5, category: 'zombie', level: -18, priority: 2, maxVoices: 6, refDistance: 2, pitchJitter: 0.08,
    render: (c) => {
      const r = c.rng;
      scrape(c, T0, c.out, { dur: r.range(0.2, 0.3), f0: 900, f1: 1400, q: 1, gain: 0.35, grain: 0.8 });
      burst(c, T0 + 0.01, c.out, { type: 'lowpass', f: 400, tau: 0.02, gain: 0.5, attack: 0.002 });
      thump(c, T0 + 0.01, c.out, { f0: 80, f1: 50, sweep: 0.02, tau: 0.03, gain: 0.3 });
    },
  },
  low_ammo: {
    dur: 0.3, variants: 2, category: 'ui', level: -12, priority: 5, maxVoices: 1, refDistance: 1, ui: true,
    render: (c) => {
      metalClick(c, T0, c.out, { f: 3800, decay: 0.012, gain: 0.5 });
      const o = osc(c, 'sine', 1100, T0 + 0.07, 0.15);
      const g = gain(c, 0);
      perc(g.gain, T0 + 0.07, 0.3, 0.002, 0.03);
      chain(o, g, c.out);
      metalClick(c, T0 + 0.09, c.out, { f: 3800, decay: 0.012, gain: 0.4 });
    },
  },
  ui_confirm: {
    dur: 0.3, variants: 2, category: 'ui', level: -16, priority: 4, maxVoices: 2, refDistance: 1, ui: true,
    render: (c) => {
      ([[0, 880, 0.05], [0.07, 1318.5, 0.08]] as const).forEach(([dt, f, tau]) => {
        const o = osc(c, 'sine', f, T0 + dt, 0.22);
        const g = gain(c, 0);
        perc(g.gain, T0 + dt, 0.5, 0.002, tau);
        chain(o, g, c.out);
      });
    },
  },
};

/** Quick sanity: clamp helper reused by the manager. */
export const clampPitch = (p: number): number => clamp(p, 0.25, 4);
