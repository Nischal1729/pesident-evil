/**
 * Offline rendering + post-processing shared by SFX, ambience and music.
 */
import { Rng, bufferStats, type BufferStats } from './dsp';
import type { RCtx } from './synth';

export interface RenderJob {
  dur: number;
  channels?: 1 | 2;
  seed: number;
  v: number;
  sr: number;
  build: (c: RCtx) => void;
}

/** Render one graph in an OfflineAudioContext (with a DC-blocking highpass on the output). */
export async function renderOffline(job: RenderJob): Promise<AudioBuffer> {
  const len = Math.max(1, Math.ceil(job.dur * job.sr));
  const ac = new OfflineAudioContext(job.channels ?? 1, len, job.sr);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 22;
  hp.Q.value = 0.5;
  hp.connect(ac.destination);
  job.build({ ac, out: hp, rng: new Rng(job.seed), sr: job.sr, dur: job.dur, v: job.v });
  return ac.startRendering();
}

export interface PostOpts {
  /** Common peak target across all variants (keeps inter-variant loudness differences). */
  targetPeak?: number;
  /** Trim trailing audio below this level (dBFS, after normalisation). */
  trimDb?: number;
  fadeMs?: number;
}

export interface PostResult {
  buffers: AudioBuffer[];
  bad: number;
  stats: BufferStats[];
}

/**
 * Sanitise NaN/Inf, normalise all variants by one shared factor, trim trailing silence
 * and apply a short fade-out so trimmed buffers never click.
 */
export function postProcess(ctx: BaseAudioContext, raw: AudioBuffer[], o: PostOpts = {}): PostResult {
  const target = o.targetPeak ?? 0.89;
  const thr = Math.pow(10, (o.trimDb ?? -66) / 20);
  let bad = 0;
  let pk = 0;
  for (const b of raw) {
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const v = d[i]!;
        if (!Number.isFinite(v)) {
          d[i] = 0;
          bad++;
        } else if (Math.abs(v) > pk) pk = Math.abs(v);
      }
    }
  }
  const g = pk > 1e-9 ? target / pk : 1;
  const out: AudioBuffer[] = [];
  for (const b of raw) {
    let last = 0;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = d.length - 1; i > last; i--) {
        if (Math.abs(d[i]! * g) > thr) {
          last = i;
          break;
        }
      }
    }
    const fade = Math.floor(((o.fadeMs ?? 8) / 1000) * b.sampleRate);
    const len = Math.min(b.length, last + fade + 1);
    const nb = ctx.createBuffer(b.numberOfChannels, Math.max(1, len), b.sampleRate);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const s = b.getChannelData(c);
      const d = nb.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = s[i]! * g;
      for (let i = 0; i < fade && len - 1 - i >= 0; i++) d[len - 1 - i]! *= i / fade;
    }
    out.push(nb);
  }
  return { buffers: out, bad, stats: out.map(bufferStats) };
}

/** Run async jobs with bounded concurrency. */
export async function pool<T>(jobs: ReadonlyArray<() => Promise<T>>, concurrency: number, onDone?: (n: number) => void): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]!();
      done++;
      onDone?.(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

/** Make an AudioBuffer from raw channel arrays on a (live) context. */
export function toBuffer(ctx: BaseAudioContext, chans: Float32Array[], sr: number): AudioBuffer {
  const b = ctx.createBuffer(chans.length, Math.max(1, chans[0]!.length), sr);
  chans.forEach((d, i) => b.getChannelData(i).set(d));
  return b;
}
