/**
 * AudioManager — Pesident Evil's procedural audio front-end.
 *
 *   const audio = new AudioManager();
 *   button.onclick = () => audio.init();           // must start from a user gesture
 *   audio.setListener(camera.position, forward, up);
 *   audio.play('rifle_fire', { position: muzzle });
 *   audio.setAmbience('dusk', 1);
 *   audio.setMusicIntensity(0.6);
 *   audio.say(randomBark('reloading'), { voice: 'male', position: npc.position });
 *
 * Everything is synthesised: one-shots are pre-rendered into AudioBuffers with
 * OfflineAudioContext at init (several variants each), then played through a voice
 * pool with priority stealing, distance culling, HRTF/equal-power panning, air
 * absorption, a campus convolution reverb and a compressor + limiter on the master.
 *
 * Graph:
 *   voices ─► sfxIn ─► sfxVol ─┐
 *   voices ─► reverbIn ─► convolver ─► sfxVol
 *   ambience ─► ambVol ────────┼─► worldFilter (low-health muffle) ─► master
 *   ui voices ─► uiIn ─► uiVol ─────────────────────────────────────► master
 *   music ─► musicVol ─► musicFilter ───────────────────────────────► master
 *   master ─► compressor ─► limiter ─► destination (+ analyser tap)
 */
import type { Vector3 } from 'three';
import { Ambience, type AmbienceEvent, type AmbienceKind, setPannerPos } from './ambience';
import { BARKS, Barker, type BarkCategory, type SayOptions, type VoiceGender, randomBark } from './barks';
import { type BufferStats, Rng, clamp, dbToGain, impulseResponse } from './dsp';
import { Music } from './music';
import { pool, postProcess, renderOffline, toBuffer } from './render';
import { RECIPES, SFX_NAMES, type SfxCategory, type SfxName, type SfxRecipe } from './sfx';

export type { SfxName, SfxCategory } from './sfx';
export type { AmbienceKind, AmbienceEvent } from './ambience';
export type { BarkCategory, VoiceGender } from './barks';
export { SFX_NAMES, RECIPES, BARKS, randomBark };

export interface PlayOptions {
  /** World position (metres). Omit for a 2D (non-positional) sound. */
  position?: Vector3;
  /** Linear volume multiplier (default 1). */
  volume?: number;
  /** Playback-rate multiplier (default 1). Also shifts formants/timbre. */
  pitch?: number;
  /** Loop until `handle.stop()`. */
  loop?: boolean;
  /** Start this many seconds from now (sample-accurate). */
  delay?: number;
  /** Override the recipe priority (1..10). */
  priority?: number;
}

/** Returned by `play()` so moving sources (sprinting zombies, passing vehicles) can follow. */
export interface SfxHandle {
  readonly name: SfxName;
  readonly variant: number;
  readonly ended: boolean;
  setPosition(p: Vector3): void;
  setVolume(v: number): void;
  setPitch(p: number): void;
  stop(fade?: number): void;
}

export interface AudioStats {
  ready: boolean;
  state: AudioContextState | 'none';
  voices: number;
  hrtfVoices: number;
  buffers: number;
  bufferSeconds: number;
  bufferMB: number;
  renderMs: number;
  badSamples: number;
  compressorReductionDb: number;
  musicIntensity: number;
  culled: number;
  stolen: number;
}

interface Voice {
  id: number;
  name: SfxName;
  variant: number;
  recipe: SfxRecipe;
  src: AudioBufferSourceNode;
  gain: GainNode;
  air?: BiquadFilterNode;
  panner?: PannerNode;
  send?: GainNode;
  start: number;
  end: number;
  vol: number;
  eff: number;
  priority: number;
  hrtf: boolean;
  dead: boolean;
}

const MAX_VOICES = 56;
const MAX_HRTF = 16;
const HRTF_RANGE = 25;
const CULL_GAIN = 0.004; // ≈ -48 dB
const BURST_WINDOW = 0.03;
const BURST_MAX = 3;

function inverseAtten(d: number, ref: number, rolloff: number): number {
  return ref / (ref + rolloff * (Math.max(d, ref) - ref));
}
function airCutoff(d: number): number {
  return clamp(22000 / (1 + d / 25), 1200, 20000);
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private initPromise: Promise<void> | null = null;
  private ready = false;

  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private limiter!: DynamicsCompressorNode;
  private analyser!: AnalyserNode;
  private sfxIn!: GainNode;
  private sfxVol!: GainNode;
  private uiIn!: GainNode;
  private uiVol!: GainNode;
  private ambVol!: GainNode;
  private musicVol!: GainNode;
  private worldFilter!: BiquadFilterNode;
  private musicFilter!: BiquadFilterNode;
  private reverbIn!: GainNode;

  private buffers = new Map<SfxName, AudioBuffer[]>();
  private voices: Voice[] = [];
  private nextId = 1;
  private hrtfCount = 0;
  private lastVariant = new Map<SfxName, number>();
  private recentStarts = new Map<SfxName, number[]>();
  private rng = new Rng((Date.now() ^ 0xa11ce) >>> 0);

  private ambience: Ambience | null = null;
  private music: Music | null = null;
  private readonly barker: Barker;

  private lx = 0; private ly = 1.6; private lz = 0;
  private volumes = { master: 0.9, sfx: 1, music: 0.6, ambience: 0.8 };
  private ambKind: AmbienceKind = 'day';
  private ambIntensity = 0;
  private musicTarget = 0;
  private lowHealth = 0;
  private nextBeat = 0;
  private timer = 0;
  private lastTick = 0;
  private renderMs = 0;
  private badSamples = 0;
  private culled = 0;
  private stolen = 0;
  private unlockHandler: (() => void) | null = null;
  private visHandler: (() => void) | null = null;
  private statsCache = new Map<SfxName, BufferStats[]>();

  /** Suspend the AudioContext while the tab is hidden (default true). */
  autoSuspendOnHidden = true;

  constructor() {
    this.barker = new Barker(() => ({ x: this.lx, y: this.ly, z: this.lz }));
  }

  /* ================================================================ init == */

  /**
   * Create/resume the AudioContext (call from a click/keydown handler) and pre-render
   * every buffer. Safe to call repeatedly; later calls just resume the context.
   * `onProgress(fraction, label)` reports rendering progress.
   */
  init(onProgress?: (fraction: number, label: string) => void): Promise<void> {
    if (this.initPromise) {
      void this.ctx?.resume().catch(() => undefined);
      return this.initPromise;
    }
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      this.initPromise = Promise.reject(new Error('Web Audio API not supported'));
      return this.initPromise;
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch (err) {
      this.initPromise = null;
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    this.ctx = ctx;
    void ctx.resume().catch(() => undefined); // synchronous-in-gesture resume
    this.installLifecycleHandlers();
    this.buildGraph(ctx);
    this.initPromise = this.prepare(ctx, onProgress);
    return this.initPromise;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  private buildGraph(ctx: AudioContext): void {
    const g = (v = 1): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    this.master = g(this.volumes.master);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.25;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.comp).connect(this.limiter).connect(ctx.destination);
    this.limiter.connect(this.analyser);

    this.worldFilter = ctx.createBiquadFilter();
    this.worldFilter.type = 'lowpass';
    this.worldFilter.frequency.value = 20000;
    this.worldFilter.Q.value = 0.6;
    this.worldFilter.connect(this.master);

    this.sfxIn = g(1);
    this.sfxVol = g(this.volumes.sfx);
    this.sfxIn.connect(this.sfxVol).connect(this.worldFilter);
    this.uiIn = g(1);
    this.uiVol = g(this.volumes.sfx);
    this.uiIn.connect(this.uiVol).connect(this.master);
    this.ambVol = g(this.volumes.ambience);
    this.ambVol.connect(this.worldFilter);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicVol = g(this.volumes.music);
    this.musicVol.connect(this.musicFilter).connect(this.master);

    // campus courtyard reverb: concrete blocks all round
    this.reverbIn = g(1);
    const cv = ctx.createConvolver();
    const ir = impulseResponse(ctx.sampleRate, 2.2, new Rng(31), {
      decay: 1.7,
      lpStart: 6000,
      lpEnd: 800,
      predelay: 0.012,
      early: [[0.019, 0.5], [0.034, 0.4], [0.052, 0.35], [0.078, 0.3], [0.11, 0.22], [0.15, 0.15], [0.21, 0.1]],
      channels: 2,
    });
    cv.buffer = toBuffer(ctx, ir, ctx.sampleRate);
    const ret = g(0.7);
    this.reverbIn.connect(cv).connect(ret).connect(this.sfxVol);
  }

  private async prepare(ctx: AudioContext, onProgress?: (f: number, label: string) => void): Promise<void> {
    const t0 = performance.now();
    const sr = ctx.sampleRate;
    this.ambience = new Ambience(ctx, this.ambVol, () => ({ x: this.lx, y: this.ly, z: this.lz }), () => this.buffers.get('zombie_scream') ?? [], this.reverbIn);
    this.music = new Music(ctx, this.musicVol);
    const sfxJobs: Array<() => Promise<void>> = [];
    let seed = 1;
    for (const name of SFX_NAMES) {
      const rec = RECIPES[name];
      const raw: AudioBuffer[] = [];
      let finished = 0;
      for (let v = 0; v < rec.variants; v++) {
        const s = seed++ * 7919;
        sfxJobs.push(async () => {
          try {
            raw[v] = await renderOffline({ dur: rec.dur, channels: rec.channels ?? 1, seed: s, v, sr: Math.min(sr, rec.sr ?? sr), build: rec.render });
          } catch (err) {
            console.warn(`[audio] render failed: ${name}#${v}`, err);
          }
          if (++finished === rec.variants) {
            const ok = raw.filter(Boolean);
            if (ok.length === 0) return;
            const res = postProcess(ctx, ok, { targetPeak: 0.89 });
            this.badSamples += res.bad;
            if (res.bad) console.warn(`[audio] ${name}: ${res.bad} non-finite samples zeroed`);
            this.buffers.set(name, res.buffers);
            this.statsCache.set(name, res.stats);
          }
        });
      }
    }
    const total = sfxJobs.length + this.ambience.jobCount + this.music.jobCount;
    let doneSfx = 0, doneAmb = 0, doneMus = 0;
    const report = (label: string): void => onProgress?.((doneSfx + doneAmb + doneMus) / total, label);
    await pool(sfxJobs, 6, (d) => {
      doneSfx = d;
      report('sound effects');
    });
    this.ready = true;
    // Ambience / music failures must not take the SFX down with them.
    await Promise.all([
      this.ambience.prepare((d) => {
        doneAmb = d;
        report('ambience');
      }).catch((err) => console.warn('[audio] ambience render failed', err)),
      this.music.prepare((d) => {
        doneMus = d;
        report('music');
      }).catch((err) => console.warn('[audio] music render failed', err)),
    ]);
    this.renderMs = performance.now() - t0;
    this.ambience.start();
    this.ambience.setKind(this.ambKind, this.ambIntensity);
    this.music.setIntensity(this.musicTarget);
    this.music.start();
    this.lastTick = ctx.currentTime;
    this.timer = window.setInterval(() => this.tick(), 40);
    onProgress?.(1, 'ready');
  }

  private installLifecycleHandlers(): void {
    const unlock = (): void => {
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    };
    this.unlockHandler = unlock;
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    this.visHandler = () => {
      if (!this.ctx || !this.autoSuspendOnHidden) return;
      if (document.hidden) void this.ctx.suspend().catch(() => undefined);
      else void this.ctx.resume().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', this.visHandler);
  }

  /* ============================================================ listener == */

  setListener(pos: Vector3, forward: Vector3, up: Vector3): void {
    this.lx = pos.x;
    this.ly = pos.y;
    this.lz = pos.z;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const fl = Math.hypot(forward.x, forward.y, forward.z);
    const ul = Math.hypot(up.x, up.y, up.z);
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      if (fl > 1e-6 && ul > 1e-6) {
        l.forwardX.value = forward.x / fl;
        l.forwardY.value = forward.y / fl;
        l.forwardZ.value = forward.z / fl;
        l.upX.value = up.x / ul;
        l.upY.value = up.y / ul;
        l.upZ.value = up.z / ul;
      }
    } else {
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(pos.x, pos.y, pos.z);
      if (fl > 1e-6 && ul > 1e-6) legacy.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /* ================================================================ play == */

  play(name: SfxName, opts: PlayOptions = {}): SfxHandle | null {
    const ctx = this.ctx;
    // While suspended the clock is frozen: scheduling now would burst everything on resume.
    if (!ctx || !this.ready || ctx.state !== 'running') return null;
    const recipe = RECIPES[name];
    const bufs = this.buffers.get(name);
    if (!recipe || !bufs || bufs.length === 0) return null;
    const now = ctx.currentTime;
    const when = now + Math.max(0, opts.delay ?? 0);
    const vol = Math.max(0, opts.volume ?? 1);
    if (vol <= 0) return null;

    const pos = opts.position;
    let d = 0;
    let atten = 1;
    if (pos) {
      d = Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz);
      atten = inverseAtten(d, recipe.refDistance, recipe.rolloff ?? 1);
    }
    const level = dbToGain(recipe.level);
    const eff = vol * atten * level;
    if (eff < CULL_GAIN) {
      this.culled++;
      return null;
    }

    // burst limiter: e.g. 8 shotgun pellets hitting in the same frame
    const starts = (this.recentStarts.get(name) ?? []).filter((t) => now - t < BURST_WINDOW);
    if (starts.length >= BURST_MAX) {
      this.culled++;
      return null;
    }

    const priority = opts.priority ?? recipe.priority;
    this.reapDead(now);
    const same = this.voices.filter((v) => v.name === name);
    if (same.length >= recipe.maxVoices) {
      let victim = same[0]!;
      for (const v of same) if (v.eff < victim.eff || (v.eff === victim.eff && v.start < victim.start)) victim = v;
      const victimScore = victim.eff * (now > victim.start + (victim.end - victim.start) * 0.6 ? 0.5 : 1);
      if (victimScore > eff) {
        this.culled++;
        return null;
      }
      this.kill(victim);
      this.stolen++;
    }
    if (this.voices.length >= MAX_VOICES) {
      const score = (v: Voice): number => v.priority * Math.sqrt(v.eff) * (now > v.start + (v.end - v.start) * 0.7 ? 0.5 : 1);
      let victim = this.voices[0]!;
      for (const v of this.voices) if (score(v) < score(victim)) victim = v;
      if (score(victim) >= priority * Math.sqrt(eff)) {
        this.culled++;
        return null;
      }
      this.kill(victim);
      this.stolen++;
    }

    // variant (never the same one twice in a row)
    let variant = Math.floor(this.rng.next() * bufs.length);
    if (bufs.length > 1 && variant === this.lastVariant.get(name)) variant = (variant + 1 + Math.floor(this.rng.next() * (bufs.length - 1))) % bufs.length;
    this.lastVariant.set(name, variant);
    const buf = bufs[variant]!;
    const rate = clamp((opts.pitch ?? 1) * (1 + this.rng.bi() * (recipe.pitchJitter ?? 0.02)), 0.25, 4);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.loop = !!opts.loop;
    const gain = ctx.createGain();
    gain.gain.value = vol * level;
    src.connect(gain);
    const bus = recipe.ui ? this.uiIn : this.sfxIn;

    const voice: Voice = {
      id: this.nextId++,
      name,
      variant,
      recipe,
      src,
      gain,
      start: when,
      end: opts.loop ? Infinity : when + buf.duration / rate,
      vol,
      eff,
      priority,
      hrtf: false,
      dead: false,
    };

    if (pos) {
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = airCutoff(d);
      air.Q.value = 0.5;
      const p = ctx.createPanner();
      voice.hrtf = d < HRTF_RANGE && this.hrtfCount < MAX_HRTF;
      if (voice.hrtf) this.hrtfCount++;
      p.panningModel = voice.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = recipe.refDistance;
      p.rolloffFactor = recipe.rolloff ?? 1;
      p.maxDistance = 10000;
      setPannerPos(p, pos.x, pos.y, pos.z);
      gain.connect(air).connect(p).connect(bus);
      voice.air = air;
      voice.panner = p;
      if (recipe.reverb) {
        const send = ctx.createGain();
        send.gain.value = recipe.reverb * Math.sqrt(atten);
        air.connect(send).connect(this.reverbIn);
        voice.send = send;
      }
    } else {
      gain.connect(bus);
    }

    src.addEventListener('ended', () => this.cleanup(voice));
    src.start(when);
    this.voices.push(voice);
    starts.push(now);
    this.recentStarts.set(name, starts);
    return this.makeHandle(voice);
  }

  private makeHandle(v: Voice): SfxHandle {
    const self = this;
    return {
      name: v.name,
      variant: v.variant,
      get ended() {
        return v.dead;
      },
      setPosition(p: Vector3): void {
        if (v.dead || !v.panner || !self.ctx) return;
        const d = Math.hypot(p.x - self.lx, p.y - self.ly, p.z - self.lz);
        setPannerPos(v.panner, p.x, p.y, p.z);
        const atten = inverseAtten(d, v.recipe.refDistance, v.recipe.rolloff ?? 1);
        v.eff = v.vol * atten * dbToGain(v.recipe.level);
        const now = self.ctx.currentTime;
        v.air?.frequency.setTargetAtTime(airCutoff(d), now, 0.05);
        if (v.send) v.send.gain.setTargetAtTime((v.recipe.reverb ?? 0) * Math.sqrt(atten), now, 0.05);
      },
      setVolume(vol: number): void {
        if (v.dead || !self.ctx) return;
        v.vol = Math.max(0, vol);
        v.gain.gain.setTargetAtTime(v.vol * dbToGain(v.recipe.level), self.ctx.currentTime, 0.02);
      },
      setPitch(pitch: number): void {
        if (v.dead || !self.ctx) return;
        v.src.playbackRate.setTargetAtTime(clamp(pitch, 0.25, 4), self.ctx.currentTime, 0.02);
      },
      stop(fade = 0.05): void {
        self.kill(v, fade);
      },
    };
  }

  private kill(v: Voice, fade = 0.03): void {
    if (v.dead || !this.ctx) return;
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.setTargetAtTime(0, now, Math.max(0.005, fade / 3));
    try {
      v.src.stop(now + fade + 0.02);
    } catch {
      /* not started yet / already stopped */
    }
    this.markDead(v);
  }

  private markDead(v: Voice): void {
    if (v.dead) return;
    v.dead = true;
    if (v.hrtf) this.hrtfCount = Math.max(0, this.hrtfCount - 1);
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  private cleanup(v: Voice): void {
    this.markDead(v);
    v.src.disconnect();
    v.gain.disconnect();
    v.air?.disconnect();
    v.panner?.disconnect();
    v.send?.disconnect();
  }

  /** Drop bookkeeping for voices whose `ended` event is late (e.g. suspended context). */
  private reapDead(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i]!;
      if (v.end + 1 < now) this.markDead(v);
    }
  }

  /** Stop every sound effect (e.g. on game over / menu). */
  stopAll(fade = 0.1): void {
    for (const v of [...this.voices]) this.kill(v, fade);
  }

  /* =========================================================== ambience == */

  setAmbience(kind: AmbienceKind, intensity: number): void {
    this.ambKind = kind;
    this.ambIntensity = clamp(intensity, 0, 1);
    this.ambience?.setKind(kind, this.ambIntensity);
  }

  /** Fire a specific ambience event now (test page / scripted moments). */
  triggerAmbienceEvent(kind: AmbienceEvent): void {
    this.ambience?.fire(kind);
  }

  /* ============================================================== music == */

  setMusicIntensity(x: number): void {
    this.musicTarget = clamp(x, 0, 1);
    this.music?.setIntensity(this.musicTarget);
  }

  /* ============================================================= barks == */

  say(line: string, opts: { voice?: 'male' | 'female'; character?: string; position?: Vector3; priority?: number; volume?: number } = {}): void {
    const o: SayOptions = { voice: opts.voice, character: opts.character, priority: opts.priority, volume: opts.volume };
    if (opts.position) o.position = { x: opts.position.x, y: opts.position.y, z: opts.position.z };
    this.barker.volume = this.volumes.master * (this.voiceVolume ?? 1);
    this.barker.say(line, o);
  }

  /** Convenience: speak a random line from a BARKS category. */
  bark(category: BarkCategory, opts: { voice?: VoiceGender; character?: string; position?: Vector3; priority?: number } = {}): void {
    this.say(randomBark(category), opts);
  }

  get voiceInfo(): Barker['voiceInfo'] {
    return this.barker.voiceInfo;
  }

  private voiceVolume = 1;

  /* ========================================================== low health == */

  /**
   * 0 = healthy … 1 = nearly dead. Drives a heartbeat loop (rate and level rise) and
   * muffles the world (sfx + ambience, and music a little) with a lowpass.
   */
  setLowHealth(amount: number): void {
    this.lowHealth = clamp(amount, 0, 1);
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const x = this.lowHealth;
    this.worldFilter.frequency.setTargetAtTime(20000 * Math.pow(900 / 20000, Math.pow(x, 1.2)), now, 0.25);
    this.musicFilter.frequency.setTargetAtTime(20000 * Math.pow(2500 / 20000, x), now, 0.25);
  }

  /* ============================================================ volumes == */

  setMasterVolume(v: number): void {
    this.volumes.master = clamp(v, 0, 1.5);
    if (this.ctx) this.master.gain.setTargetAtTime(this.volumes.master, this.ctx.currentTime, 0.03);
  }
  setSfxVolume(v: number): void {
    this.volumes.sfx = clamp(v, 0, 1.5);
    if (this.ctx) {
      this.sfxVol.gain.setTargetAtTime(this.volumes.sfx, this.ctx.currentTime, 0.03);
      this.uiVol.gain.setTargetAtTime(this.volumes.sfx, this.ctx.currentTime, 0.03);
    }
  }
  setMusicVolume(v: number): void {
    this.volumes.music = clamp(v, 0, 1.5);
    if (this.ctx) this.musicVol.gain.setTargetAtTime(this.volumes.music, this.ctx.currentTime, 0.03);
  }
  setAmbienceVolume(v: number): void {
    this.volumes.ambience = clamp(v, 0, 1.5);
    if (this.ctx) this.ambVol.gain.setTargetAtTime(this.volumes.ambience, this.ctx.currentTime, 0.03);
  }
  /** Volume of speechSynthesis barks (multiplied by master). */
  setVoiceVolume(v: number): void {
    this.voiceVolume = clamp(v, 0, 1);
  }

  /* ========================================================= per-frame == */

  /** Optional per-frame hook. Scheduling also runs on an internal 40 ms timer. */
  update(_dt: number): void {
    this.tick();
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const now = ctx.currentTime;
    const dt = Math.max(0, Math.min(0.5, now - this.lastTick));
    if (dt <= 0 && this.lastTick !== 0) return;
    this.lastTick = now;
    this.ambience?.tick(now, dt);
    this.music?.tick(now);
    if (this.lowHealth > 0.05) {
      if (this.nextBeat < now) this.nextBeat = now + 0.05;
      while (this.nextBeat < now + 0.15) {
        this.play('heartbeat', { volume: 0.35 + 0.65 * this.lowHealth, delay: this.nextBeat - now });
        this.nextBeat += 60 / (66 + 74 * this.lowHealth);
      }
    }
  }

  /* ========================================================= debugging == */

  get stats(): AudioStats {
    let secs = 0, bytes = 0, count = 0;
    for (const bufs of this.buffers.values()) {
      for (const b of bufs) {
        secs += b.duration;
        bytes += b.length * b.numberOfChannels * 4;
        count++;
      }
    }
    return {
      ready: this.ready,
      state: this.ctx?.state ?? 'none',
      voices: this.voices.length,
      hrtfVoices: this.hrtfCount,
      buffers: count,
      bufferSeconds: secs,
      bufferMB: bytes / (1024 * 1024),
      renderMs: this.renderMs,
      badSamples: this.badSamples,
      compressorReductionDb: this.ctx ? this.comp.reduction + this.limiter.reduction : 0,
      musicIntensity: this.music?.intensity ?? 0,
      culled: this.culled,
      stolen: this.stolen,
    };
  }

  /** Output analyser (post-limiter) for meters. */
  getAnalyser(): AnalyserNode | null {
    return this.ctx ? this.analyser : null;
  }

  /** Rendered variants for a sound (for waveform views / tests). */
  getBuffers(name: SfxName): readonly AudioBuffer[] {
    return this.buffers.get(name) ?? [];
  }

  /** Per-variant peak/RMS/duration/NaN stats recorded at render time. */
  analyze(): Record<string, BufferStats[]> {
    const out: Record<string, BufferStats[]> = {};
    for (const [k, v] of this.statsCache) out[k] = v;
    return out;
  }

  /* ============================================================ dispose == */

  dispose(): void {
    window.clearInterval(this.timer);
    this.stopAll(0.02);
    this.ambience?.stop();
    this.music?.stop(0.1);
    this.barker.cancel();
    if (this.unlockHandler) {
      window.removeEventListener('pointerdown', this.unlockHandler, true);
      window.removeEventListener('keydown', this.unlockHandler, true);
      window.removeEventListener('touchend', this.unlockHandler, true);
    }
    if (this.visHandler) document.removeEventListener('visibilitychange', this.visHandler);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.ready = false;
    this.initPromise = null;
    this.buffers.clear();
    this.voices = [];
    this.hrtfCount = 0;
    this.ambience = null;
    this.music = null;
  }
}
