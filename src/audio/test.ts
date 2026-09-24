/**
 * Audio Lab — dev page for auditioning every sound, the ambience, the adaptive score,
 * the NPC barks and 3D positioning. `npm run dev` → http://127.0.0.1:5173/audio-test.html
 */
import { Vector3 } from 'three';
import {
  AudioManager,
  BARKS,
  RECIPES,
  SFX_NAMES,
  type AmbienceEvent,
  type AmbienceKind,
  type BarkCategory,
  type SfxCategory,
  type SfxHandle,
  type SfxName,
  randomBark,
} from './AudioManager';

const audio = new AudioManager();
(window as unknown as { __audio: AudioManager }).__audio = audio;

/* ------------------------------------------------------------ dom kit -- */

type Props = Record<string, unknown> & { class?: string; text?: string };
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Array<Node | string | null>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else (e as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of kids) if (c !== null) e.append(c);
  return e;
}

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt = (v: number) => v.toFixed(2)): HTMLElement {
  const out = el('output', { text: fmt(value) });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });
  return el('div', { class: 'row' }, el('label', { text: label }), input, out);
}

const app = document.getElementById('app')!;

/* ------------------------------------------------------------- header -- */

const bar = el('div');
const progress = el('div', { class: 'progress' }, bar);
const status = el('span', { class: 'status', text: 'Click “Start audio” (needs a user gesture).' });
const initBtn = el('button', { class: 'primary', text: 'Start audio' });
const header = el('header', {}, el('h1', {}, 'Pesident Evil — ', el('span', { text: 'Audio Lab' })), initBtn, progress, status);
app.append(header);

const main = el('main');
app.append(main);

/* ------------------------------------------------------------- meter -- */

const meterCanvas = el('canvas', { width: 420, height: 46 });
const meterText = el('div', { class: 'status' });
main.append(el('section', {}, el('h2', { text: 'Output meter (post-limiter)' }), meterCanvas, meterText));

/* ----------------------------------------------------------- mixer --- */

const mixer = el('section', {}, el('h2', { text: 'Mixer' }));
mixer.append(
  slider('Master', 0, 1.2, 0.01, 0.9, (v) => audio.setMasterVolume(v)),
  slider('SFX', 0, 1.2, 0.01, 1, (v) => audio.setSfxVolume(v)),
  slider('Music', 0, 1.2, 0.01, 0.6, (v) => audio.setMusicVolume(v)),
  slider('Ambience', 0, 1.2, 0.01, 0.8, (v) => audio.setAmbienceVolume(v)),
  slider('Voice (barks)', 0, 1, 0.01, 1, (v) => audio.setVoiceVolume(v)),
  slider('Low health', 0, 1, 0.01, 0, (v) => audio.setLowHealth(v)),
  el('p', { class: 'note', text: 'Low health drives the heartbeat loop and muffles the world.' }),
);
main.append(mixer);

/* -------------------------------------------------------- ambience --- */

let ambKind: AmbienceKind = 'day';
let ambInt = 1;
const kindBtns: Record<AmbienceKind, HTMLButtonElement> = {} as Record<AmbienceKind, HTMLButtonElement>;
const ambSec = el('section', {}, el('h2', { text: 'Ambience — Bengaluru' }));
const kindRow = el('div', { class: 'row' }, el('label', { text: 'Time of day' }));
for (const k of ['day', 'dusk', 'night'] as const) {
  const b = el('button', { text: k });
  b.addEventListener('click', () => {
    ambKind = k;
    audio.setAmbience(ambKind, ambInt);
    for (const kk of Object.keys(kindBtns) as AmbienceKind[]) kindBtns[kk].classList.toggle('on', kk === k);
  });
  kindBtns[k] = b;
  kindRow.append(b);
}
kindBtns.day.classList.add('on');
ambSec.append(kindRow, slider('Intensity', 0, 1, 0.01, 1, (v) => {
  ambInt = v;
  audio.setAmbience(ambKind, ambInt);
}));
ambSec.append(el('h3', { text: 'Fire an event' }));
const evGrid = el('div', { class: 'grid' });
for (const e of ['horn', 'vehicle', 'myna', 'crow', 'chirp', 'bark', 'siren', 'scream'] as AmbienceEvent[]) {
  evGrid.append(el('button', { text: e, onclick: () => audio.triggerAmbienceEvent(e) }));
}
ambSec.append(evGrid, el('p', { class: 'note', text: 'Horns/vehicles/sirens come from the Outer Ring Road (north-east of the listener); birds from the trees around you; dogs from far away.' }));
main.append(ambSec);

/* ----------------------------------------------------------- music --- */

const musSec = el('section', {}, el('h2', { text: 'Adaptive music' }));
let musicSlider: HTMLInputElement | null = null;
const musRow = slider('Intensity', 0, 1, 0.01, 0, (v) => audio.setMusicIntensity(v));
musicSlider = musRow.querySelector('input');
const presets = el('div', { class: 'grid' });
for (const [lbl, v] of [['calm 0', 0], ['tension 0.2', 0.2], ['tabla 0.4', 0.4], ['wave 0.6', 0.6], ['horde 0.85', 0.85], ['full 1.0', 1]] as const) {
  presets.append(el('button', {
    text: lbl,
    onclick: () => {
      audio.setMusicIntensity(v);
      if (musicSlider) {
        musicSlider.value = String(v);
        musicSlider.dispatchEvent(new Event('input'));
      }
    },
  }));
}
const musInfo = el('div', { class: 'status' });
musSec.append(musRow, presets, musInfo, el('p', { class: 'note', text: '0.2 drone + tanpura + pulse · 0.3+ tabla theka · 0.35+ pads · 0.5+ dhol · 0.7+ tremolo strings, tirakita ghosts, fills. Changes glide over ~2 s.' }));
main.append(musSec);

/* ------------------------------------------------------------- sfx --- */

type PosMode = '2d' | 'marker' | 'random';
let posMode: PosMode = '2d';
const marker = new Vector3(4, 1.2, -6);
const sfxSec = el('section', { class: 'wide' }, el('h2', { text: 'Sound effects' }));
const posSel = el('select');
for (const [v, t] of [['2d', '2D (non-positional)'], ['marker', 'At marker (click the spatial map)'], ['random', 'Random position 3–30 m']] as const) posSel.append(el('option', { value: v, text: t }));
posSel.addEventListener('change', () => (posMode = posSel.value as PosMode));
sfxSec.append(el('div', { class: 'row' }, el('label', { text: 'Play' }), posSel));
const groups: Record<SfxCategory, SfxName[]> = { weapon: [], foley: [], impact: [], zombie: [], player: [], ui: [], flow: [] };
for (const n of SFX_NAMES) groups[RECIPES[n].category].push(n);
const waveCanvas = el('canvas', { width: 900, height: 220 });
const waveLabel = el('div', { class: 'status', text: 'Waveform + spectrogram of the last played variant.' });
const titles: Record<SfxCategory, string> = { weapon: 'Weapons', foley: 'Foley / reloads', impact: 'Impacts', zombie: 'Zombies', player: 'Player / NPC', ui: 'UI', flow: 'Game flow' };
for (const cat of Object.keys(groups) as SfxCategory[]) {
  if (groups[cat].length === 0) continue;
  sfxSec.append(el('h3', { text: titles[cat] }));
  const g = el('div', { class: 'grid' });
  for (const n of groups[cat]) {
    g.append(el('button', { text: n, onclick: () => playSfx(n) }));
  }
  sfxSec.append(g);
}
sfxSec.append(el('h3', { text: 'Last played' }), waveCanvas, waveLabel);
main.append(sfxSec);

function randomPos(): Vector3 {
  const a = Math.random() * Math.PI * 2;
  const d = 3 + Math.random() * 27;
  return new Vector3(Math.cos(a) * d, 1.2, Math.sin(a) * d);
}

function playSfx(n: SfxName): void {
  const position = posMode === '2d' ? undefined : posMode === 'marker' ? marker.clone() : randomPos();
  const h = audio.play(n, { position });
  if (position) flashes.push({ x: position.x, z: position.z, t: performance.now(), label: n });
  if (h) {
    const b = audio.getBuffers(n)[h.variant];
    if (b) drawBuffer(b, `${n} — variant ${h.variant + 1}/${audio.getBuffers(n).length} · ${b.duration.toFixed(2)} s · ${b.numberOfChannels} ch${position ? ` · ${position.length().toFixed(1)} m` : ''}`);
  } else if (!audio.isReady) {
    status.textContent = 'Start audio first.';
  }
}

/* ----------------------------------------------------------- barks --- */

const barkSec = el('section', {}, el('h2', { text: 'NPC barks (speechSynthesis)' }));
let barkVoice: 'male' | 'female' | 'random' = 'random';
let barkDist = 3;
const vSel = el('select');
for (const v of ['random', 'male', 'female']) vSel.append(el('option', { value: v, text: v }));
vSel.addEventListener('change', () => (barkVoice = vSel.value as typeof barkVoice));
barkSec.append(el('div', { class: 'row' }, el('label', { text: 'Voice' }), vSel));
barkSec.append(slider('Speaker distance', 0, 60, 1, 3, (v) => (barkDist = v), (v) => `${v} m`));
const barkGrid = el('div', { class: 'grid' });
for (const cat of Object.keys(BARKS) as BarkCategory[]) {
  barkGrid.append(el('button', {
    text: cat,
    onclick: () => {
      const line = randomBark(cat);
      lastLine.textContent = `“${line}”`;
      audio.say(line, {
        voice: barkVoice === 'random' ? undefined : barkVoice,
        position: new Vector3(0, 1.6, -barkDist),
        priority: cat === 'downed' ? 3 : 1,
      });
    },
  }));
}
const lastLine = el('div', { class: 'status' });
const voiceList = el('div', { class: 'voices' });
barkSec.append(barkGrid, lastLine, el('h3', { text: 'Voices' }), voiceList);
main.append(barkSec);

function refreshVoices(): void {
  const info = audio.voiceInfo;
  voiceList.innerHTML = '';
  const chosen = el('div', {}, 'Male → ', el('b', { text: info.male ? `${info.male.name} (${info.male.lang})` : 'none' }), ' · Female → ', el('b', { text: info.female ? `${info.female.name} (${info.female.lang})` : 'none' }));
  voiceList.append(chosen);
  const en = info.all.filter((v) => v.lang.toLowerCase().startsWith('en'));
  voiceList.append(el('div', { text: `${info.all.length} voices, ${en.length} English: ${en.map((v) => `${v.name} [${v.lang}]`).join(', ')}` }));
}
if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
setTimeout(refreshVoices, 300);

/* ------------------------------------------------------ spatial demo -- */

const spSec = el('section', {}, el('h2', { text: 'Spatial demo (top-down, north up, 60 m across)' }));
const map = el('canvas', { width: 420, height: 420 });
let yaw = 0;
let orbit = false;
let orbitR = 8;
let orbitSpeed = 0.6;
let clickSound: SfxName = 'zombie_groan';
const orbitBtn = el('button', { text: 'Orbiting zombie: off' });
orbitBtn.addEventListener('click', () => {
  orbit = !orbit;
  orbitBtn.textContent = `Orbiting zombie: ${orbit ? 'on' : 'off'}`;
  orbitBtn.classList.toggle('on', orbit);
  if (!orbit) for (const h of orbitHandles) h.stop(0.3);
});
const hordeBtn = el('button', { text: 'Horde stress test (40 zombies + gunfire, 12 s)' });
hordeBtn.addEventListener('click', () => startHorde());
const clickSel = el('select');
for (const n of SFX_NAMES) clickSel.append(el('option', { value: n, text: n, selected: n === clickSound }));
clickSel.addEventListener('change', () => (clickSound = clickSel.value as SfxName));
spSec.append(
  el('div', { class: 'row' }, orbitBtn, hordeBtn),
  slider('Orbit radius', 1, 30, 0.5, orbitR, (v) => (orbitR = v), (v) => `${v} m`),
  slider('Orbit speed', 0, 3, 0.05, orbitSpeed, (v) => (orbitSpeed = v), (v) => `${v} rad/s`),
  slider('Listener yaw', -180, 180, 1, 0, (v) => (yaw = (v * Math.PI) / 180), (v) => `${v}°`),
  el('div', { class: 'row' }, el('label', { text: 'Click plays' }), clickSel),
  map,
  el('p', { class: 'note', text: 'Click the map to move the marker and play the selected sound there. Use headphones to judge HRTF. The listener is the triangle; yellow = marker, red = zombies.' }),
);
main.append(spSec);

const SCALE = 60 / 420; // metres per pixel
map.addEventListener('click', (ev) => {
  const r = map.getBoundingClientRect();
  const px = ((ev.clientX - r.left) / r.width) * map.width;
  const py = ((ev.clientY - r.top) / r.height) * map.height;
  marker.set((px - map.width / 2) * SCALE, 1.2, (py - map.height / 2) * SCALE);
  audio.play(clickSound, { position: marker.clone() });
  flashes.push({ x: marker.x, z: marker.z, t: performance.now(), label: clickSound });
});

interface Flash { x: number; z: number; t: number; label: string }
const flashes: Flash[] = [];
let orbitAngle = 0;
let nextOrbitGroan = 0;
const orbitHandles: SfxHandle[] = [];
const orbitPos = new Vector3();

interface HordeZ { pos: Vector3; next: number; handle: SfxHandle | null; vel: Vector3 }
let horde: HordeZ[] = [];
let hordeEnd = 0;
let nextShot = 0;
let burstLeft = 0;

function startHorde(): void {
  horde = [];
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 4 + Math.random() * 36;
    horde.push({ pos: new Vector3(Math.cos(a) * d, 1.6, Math.sin(a) * d), next: performance.now() + Math.random() * 3000, handle: null, vel: new Vector3(-Math.cos(a), 0, -Math.sin(a)).multiplyScalar(0.9) });
  }
  hordeEnd = performance.now() + 12000;
  audio.setMusicIntensity(0.9);
  if (musicSlider) {
    musicSlider.value = '0.9';
    musicSlider.dispatchEvent(new Event('input'));
  }
  audio.play('wave_start');
}

/* ------------------------------------------------------------ frame -- */

const listenerPos = new Vector3(0, 1.6, 0);
const fwd = new Vector3();
const up = new Vector3(0, 1, 0);
let peakHold = -60;
let lastFrame = performance.now();
const timeBuf = new Float32Array(2048);

function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  fwd.set(Math.sin(yaw), 0, -Math.cos(yaw));
  audio.setListener(listenerPos, fwd, up);
  audio.update(dt);

  // orbiting zombie
  if (orbit && audio.isReady) {
    orbitAngle += orbitSpeed * dt;
    orbitPos.set(Math.cos(orbitAngle) * orbitR, 1.6, Math.sin(orbitAngle) * orbitR);
    if (now > nextOrbitGroan) {
      const h = audio.play(orbitR < 4 ? 'zombie_growl_near' : 'zombie_groan', { position: orbitPos.clone() });
      if (h) orbitHandles.push(h);
      nextOrbitGroan = now + 1200 + Math.random() * 1500;
      if (Math.random() < 0.3) audio.play('zombie_footstep', { position: orbitPos.clone() });
    }
    for (let i = orbitHandles.length - 1; i >= 0; i--) {
      const h = orbitHandles[i]!;
      if (h.ended) orbitHandles.splice(i, 1);
      else h.setPosition(orbitPos);
    }
  }

  // horde stress
  if (horde.length && audio.isReady) {
    for (const z of horde) {
      if (z.pos.length() > 2.5) z.pos.addScaledVector(z.vel, dt);
      if (now > z.next) {
        const d = z.pos.length();
        z.handle = audio.play(d < 4 ? 'zombie_growl_near' : Math.random() < 0.05 ? 'zombie_scream' : 'zombie_groan', { position: z.pos.clone() });
        z.next = now + 1500 + Math.random() * 4000;
      }
      if (z.handle && !z.handle.ended) z.handle.setPosition(z.pos);
    }
    if (now > nextShot) {
      if (burstLeft <= 0) burstLeft = 4 + Math.floor(Math.random() * 6);
      audio.play('rifle_fire');
      const target = horde[Math.floor(Math.random() * horde.length)]!;
      audio.play(Math.random() < 0.2 ? 'headshot' : 'impact_flesh', { position: target.pos.clone() });
      burstLeft--;
      nextShot = now + (burstLeft > 0 ? 110 : 600 + Math.random() * 700);
    }
    if (now > hordeEnd) {
      horde = [];
      audio.play('wave_end');
      audio.setMusicIntensity(0.2);
      if (musicSlider) {
        musicSlider.value = '0.2';
        musicSlider.dispatchEvent(new Event('input'));
      }
    }
  }

  drawMap(now);
  drawMeter();
  requestAnimationFrame(frame);
}

function drawMap(now: number): void {
  const g = map.getContext('2d')!;
  const W = map.width, H = map.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#1d2227';
  g.lineWidth = 1;
  for (let m = -30; m <= 30; m += 5) {
    const p = W / 2 + m / SCALE;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, H); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(W, p); g.stroke();
  }
  // ring road hint (NE)
  g.strokeStyle = '#3a2f1a';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(W * 0.35, 0);
  g.lineTo(W, H * 0.42);
  g.stroke();
  g.fillStyle = '#7a6a4a';
  g.font = '11px system-ui';
  g.fillText('to Outer Ring Road →', W - 150, 16);
  const toPx = (x: number, z: number): [number, number] => [W / 2 + x / SCALE, H / 2 + z / SCALE];
  // listener
  const [lx, ly] = toPx(0, 0);
  g.save();
  g.translate(lx, ly);
  g.rotate(yaw);
  g.fillStyle = '#58b36b';
  g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 8); g.lineTo(-8, 8); g.closePath(); g.fill();
  g.restore();
  // marker
  const [mx, my] = toPx(marker.x, marker.z);
  g.strokeStyle = '#e0b43a';
  g.lineWidth = 2;
  g.beginPath(); g.arc(mx, my, 6, 0, Math.PI * 2); g.stroke();
  // orbit
  if (orbit) {
    const [ox, oy] = toPx(orbitPos.x, orbitPos.z);
    g.fillStyle = '#c8412f';
    g.beginPath(); g.arc(ox, oy, 6, 0, Math.PI * 2); g.fill();
  }
  for (const z of horde) {
    const [zx, zy] = toPx(z.pos.x, z.pos.z);
    g.fillStyle = z.handle && !z.handle.ended ? '#ff6a50' : '#7a2a20';
    g.beginPath(); g.arc(zx, zy, 3.5, 0, Math.PI * 2); g.fill();
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]!;
    const age = (now - f.t) / 800;
    if (age > 1) {
      flashes.splice(i, 1);
      continue;
    }
    const [fx, fy] = toPx(f.x, f.z);
    g.strokeStyle = `rgba(224,180,58,${1 - age})`;
    g.beginPath(); g.arc(fx, fy, 6 + age * 30, 0, Math.PI * 2); g.stroke();
  }
}

function drawMeter(): void {
  const g = meterCanvas.getContext('2d')!;
  const W = meterCanvas.width, H = meterCanvas.height;
  g.clearRect(0, 0, W, H);
  const an = audio.getAnalyser();
  let pk = -90, rmsDb = -90;
  if (an) {
    an.getFloatTimeDomainData(timeBuf);
    let p = 0, s = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = timeBuf[i]!;
      p = Math.max(p, Math.abs(v));
      s += v * v;
    }
    pk = 20 * Math.log10(p + 1e-9);
    rmsDb = 10 * Math.log10(s / timeBuf.length + 1e-12);
  }
  peakHold = Math.max(pk, peakHold - 0.4);
  const x = (db: number) => ((Math.max(-60, Math.min(0, db)) + 60) / 60) * W;
  g.fillStyle = '#22272d';
  g.fillRect(0, 8, W, 12);
  g.fillRect(0, 26, W, 12);
  g.fillStyle = '#58b36b';
  g.fillRect(0, 8, x(rmsDb), 12);
  g.fillStyle = pk > -1 ? '#c8412f' : '#e0b43a';
  g.fillRect(0, 26, x(pk), 12);
  g.fillStyle = '#fff';
  g.fillRect(x(peakHold) - 1, 24, 2, 16);
  const s = audio.stats;
  meterText.textContent = `RMS ${rmsDb.toFixed(1)} dB · peak ${pk.toFixed(1)} dB (hold ${peakHold.toFixed(1)}) · GR ${s.compressorReductionDb.toFixed(1)} dB · voices ${s.voices} (HRTF ${s.hrtfVoices}) · culled ${s.culled} · stolen ${s.stolen} · ctx ${s.state}`;
  musInfo.textContent = `smoothed intensity ${s.musicIntensity.toFixed(2)}`;
}

/* ----------------------------------------------------- waveform view -- */

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti;
        re[a]! += tr; im[a]! += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function drawBuffer(b: AudioBuffer, label: string): void {
  const g = waveCanvas.getContext('2d')!;
  const W = waveCanvas.width, H = waveCanvas.height;
  const wh = 70;
  g.clearRect(0, 0, W, H);
  const d = b.getChannelData(0);
  g.strokeStyle = '#e0b43a';
  g.beginPath();
  for (let x = 0; x < W; x++) {
    const s0 = Math.floor((x / W) * d.length), s1 = Math.floor(((x + 1) / W) * d.length);
    let mn = 1, mx = -1;
    for (let i = s0; i < s1; i++) {
      const v = d[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    g.moveTo(x + 0.5, wh / 2 - mx * (wh / 2));
    g.lineTo(x + 0.5, wh / 2 - mn * (wh / 2) + 1);
  }
  g.stroke();
  // spectrogram (log frequency 50 Hz … Nyquist)
  const N = 1024;
  const top = wh + 4, sh = H - top;
  const frames = W;
  const img = g.createImageData(W, sh);
  const re = new Float32Array(N), im = new Float32Array(N);
  const nyq = b.sampleRate / 2;
  for (let x = 0; x < frames; x++) {
    const start = Math.floor((x / frames) * Math.max(1, d.length - N));
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = (d[start + i] ?? 0) * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < sh; y++) {
      const f = 50 * Math.pow(nyq / 50, 1 - y / sh);
      const bin = Math.min(N / 2 - 1, Math.round((f / nyq) * (N / 2)));
      const mag = Math.hypot(re[bin]!, im[bin]!);
      const db = 20 * Math.log10(mag + 1e-9);
      const v = Math.max(0, Math.min(1, (db + 70) / 70));
      const o = (y * W + x) * 4;
      img.data[o] = 255 * Math.min(1, v * 1.6);
      img.data[o + 1] = 255 * Math.max(0, v * 1.4 - 0.4);
      img.data[o + 2] = 90 * (1 - v) + 40 * v;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, top);
  waveLabel.textContent = label;
}

/* --------------------------------------------------------- analysis -- */

const anSec = el('section', { class: 'wide' }, el('h2', { text: 'Render analysis' }));
const anBtn = el('button', { text: 'Analyse all rendered buffers' });
const anOut = el('div', { class: 'scroll' });
anBtn.addEventListener('click', () => renderAnalysis());
anSec.append(el('div', { class: 'row' }, anBtn, el('span', { class: 'note', text: 'Peak should sit at −1.0 dBFS (shared normalisation), no non-finite samples.' })), anOut);
main.append(anSec);

function renderAnalysis(): void {
  const st = audio.analyze();
  const s = audio.stats;
  const t = el('table');
  t.append(el('tr', {}, ...['sound', 'variants', 'dur (s)', 'peak dB', 'RMS dB (avg)', 'bad samples', 'level dB', 'prio'].map((h) => el('th', { text: h }))));
  for (const n of SFX_NAMES) {
    const arr = st[n] ?? [];
    const dur = Math.max(0, ...arr.map((a) => a.duration));
    const pk = Math.max(-200, ...arr.map((a) => a.peakDb));
    const rms = arr.length ? arr.reduce((a, b) => a + b.rmsDb, 0) / arr.length : -200;
    const bad = arr.reduce((a, b) => a + b.bad, 0);
    t.append(el('tr', {},
      el('td', { text: n }),
      el('td', { text: String(arr.length), class: arr.length === RECIPES[n].variants ? 'good' : 'bad' }),
      el('td', { text: dur.toFixed(2) }),
      el('td', { text: pk.toFixed(1), class: pk > -0.9 || pk < -1.1 ? 'bad' : 'good' }),
      el('td', { text: rms.toFixed(1) }),
      el('td', { text: String(bad), class: bad ? 'bad' : 'good' }),
      el('td', { text: String(RECIPES[n].level) }),
      el('td', { text: String(RECIPES[n].priority) }),
    ));
  }
  anOut.innerHTML = '';
  anOut.append(el('p', { class: 'note', text: `${s.buffers} buffers · ${s.bufferSeconds.toFixed(1)} s · ${s.bufferMB.toFixed(1)} MB · rendered in ${(s.renderMs / 1000).toFixed(2)} s · bad samples ${s.badSamples}` }), t);
}

/* ---------------------------------------------------------- start --- */

initBtn.addEventListener('click', async () => {
  initBtn.disabled = true;
  status.textContent = 'Rendering…';
  const t0 = performance.now();
  try {
    await audio.init((f, label) => {
      bar.style.width = `${(f * 100).toFixed(0)}%`;
      status.textContent = `Rendering ${label}… ${(f * 100).toFixed(0)}%`;
    });
    audio.setAmbience(ambKind, ambInt);
    const s = audio.stats;
    status.textContent = `Ready in ${((performance.now() - t0) / 1000).toFixed(2)} s — ${s.buffers} buffers, ${s.bufferMB.toFixed(1)} MB, ${s.badSamples} bad samples.`;
    initBtn.textContent = 'Audio running';
    refreshVoices();
  } catch (err) {
    status.textContent = `Audio init failed: ${String(err)}`;
    initBtn.disabled = false;
  }
});

requestAnimationFrame(frame);
