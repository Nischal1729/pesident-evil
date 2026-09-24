import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Engine } from '../core/Engine';
import { QUALITY } from '../core/Settings';
import type { SurfaceKind } from '../core/Events';
import { Sky } from '../world/Sky';
import { worldUniforms } from '../world/materials';
import { Post } from './Post';
import { Fx, type WeaponKind } from './Fx';

/**
 * FX lab: a small test range with the game's sky + post chain. Buttons/keys trigger each effect,
 * "firefight" auto-fires every 80 ms. `window.fxTest` exposes hooks for scripted screenshots.
 */

const q = QUALITY.high;
const engine = new Engine(document.getElementById('app')!, q, 62);
const { renderer, scene, camera } = engine;
renderer.info.autoReset = false; // count every pass of the frame (reset manually in step())
const sky = new Sky(renderer, scene, q.shadowMapSize, q.shadowDistance);
let tod = 0.1;
sky.setTime(tod);

// ------------------------------------------------------------------------------------------------
// test range
// ------------------------------------------------------------------------------------------------

const GROUND_Y = 0.05;

function noiseTexture(base: [number, number, number], amp: number, size = 512, speck = 0.0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * amp + (Math.random() < speck ? -40 : 0);
    img.data[i * 4] = base[0] + n; img.data[i * 4 + 1] = base[1] + n; img.data[i * 4 + 2] = base[2] + n; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // large blotches
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.beginPath(); g.arc(Math.random() * size, Math.random() * size, 10 + Math.random() * 60, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const targets: THREE.Mesh[] = [];
function addTarget(mesh: THREE.Mesh, surface: SurfaceKind, weight: number): THREE.Mesh {
  mesh.userData.surface = surface;
  mesh.userData.weight = weight;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  targets.push(mesh);
  return mesh;
}

const pavingTex = noiseTexture([168, 162, 152], 26);
pavingTex.repeat.set(40, 40);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: pavingTex, roughness: 0.95 }));
ground.position.y = GROUND_Y;
addTarget(ground, 'concrete', 0);
ground.castShadow = false;

const dirtTex = noiseTexture([118, 88, 62], 40, 256, 0.04);
dirtTex.repeat.set(3, 3);
const dirt = new THREE.Mesh(new THREE.PlaneGeometry(8, 6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
dirt.position.set(-3, GROUND_Y + 0.002, -2.5);
addTarget(dirt, 'ground', 1.2);
dirt.castShadow = false;

const concTex = noiseTexture([205, 199, 190], 22);
concTex.repeat.set(3, 1);
addTarget(new THREE.Mesh(new THREE.BoxGeometry(14, 4, 0.6), new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.92 })), 'concrete', 3).position.set(0, 2 + GROUND_Y, -11);
addTarget(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0x7d858d, metalness: 0.85, roughness: 0.38 })), 'metal', 1.5).position.set(4.5, 1 + GROUND_Y, -6);
const woodTex = noiseTexture([138, 104, 68], 30);
addTarget(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8 })), 'wood', 1.2).position.set(-4.5, 0.8 + GROUND_Y, -6.5);

// steel gate (bars) — gateHit target
const gate = new THREE.Group();
const barMat = new THREE.MeshStandardMaterial({ color: 0x3d4247, metalness: 0.8, roughness: 0.45 });
for (let i = 0; i < 12; i++) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.4, 0.06), barMat);
  b.position.set(i * 0.25, 1.2 + GROUND_Y, 0);
  b.castShadow = true;
  gate.add(b);
}
for (const y of [0.3, 2.2]) {
  const r = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.08), barMat);
  r.position.set(1.4, y + GROUND_Y, 0);
  gate.add(r);
}
gate.position.set(-9, 0, -4);
gate.rotation.y = 0.6;
scene.add(gate);

// dummy zombies
const zombies: THREE.Mesh[] = [];
const zMat = new THREE.MeshStandardMaterial({ color: 0x5b6650, roughness: 0.85 });
for (const [x, z] of [[-1.5, -4], [1.2, -5.5], [2.8, -3], [-2.8, -7.5], [0.2, -8], [6.5, -2.5]]) {
  const m = addTarget(new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.15, 6, 12), zMat), 'flesh', 2);
  m.position.set(x, 0.86 + GROUND_Y, z);
  zombies.push(m);
}

// player / ally gun positions
const guns = [
  { pos: new THREE.Vector3(0.35, 1.42, 5), weapon: 'rifle' as WeaponKind },
  { pos: new THREE.Vector3(-3.6, 1.4, 3.4), weapon: 'smg' as WeaponKind },
  { pos: new THREE.Vector3(3.9, 1.38, 3.6), weapon: 'shotgun' as WeaponKind },
];
const shooterMat = new THREE.MeshStandardMaterial({ color: 0x2d4f7a, roughness: 0.7 });
for (const g of guns) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 1.1, 6, 12), shooterMat);
  m.position.set(g.pos.x - 0.3, 0.86 + GROUND_Y, g.pos.z + 0.25);
  m.castShadow = true;
  scene.add(m);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.5 }));
  gun.position.set(g.pos.x, g.pos.y - 0.02, g.pos.z - 0.36);
  scene.add(gun);
}

// ------------------------------------------------------------------------------------------------
// fx + post
// ------------------------------------------------------------------------------------------------

const t0 = performance.now();
const fx = new Fx(scene, camera, q);
fx.groundY = GROUND_Y;
console.log(`[fx] init ${(performance.now() - t0).toFixed(1)} ms`);
const post = new Post(renderer, scene, camera, q);
engine.onResize = (w, h) => post.setSize(w, h);
engine.resize();

camera.position.set(1.25, 1.95, 7.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.2, 1.25, -3);
controls.enableDamping = true;
controls.update();

function setTime(t: number): void {
  tod = t;
  sky.setTime(t);
  post.setNight(worldUniforms.uNight.value);
  post.setExposure(sky.exposure);
  fx.setNight(worldUniforms.uNight.value);
}
setTime(tod);

// ------------------------------------------------------------------------------------------------
// shooting
// ------------------------------------------------------------------------------------------------

const ray = new THREE.Raycaster();
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpPt = new THREE.Vector3();
const normalMat = new THREE.Matrix3();

function pickTarget(filter?: SurfaceKind): THREE.Mesh {
  const list = targets.filter((t) => t.userData.weight > 0 && (!filter || t.userData.surface === filter));
  const total = list.reduce((s, t) => s + t.userData.weight, 0);
  let r = Math.random() * total;
  for (const t of list) { r -= t.userData.weight; if (r <= 0) return t; }
  return list[list.length - 1];
}

function randomPointOn(m: THREE.Mesh, out: THREE.Vector3): THREE.Vector3 {
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox!;
  out.set(THREE.MathUtils.lerp(b.min.x, b.max.x, 0.1 + Math.random() * 0.8), THREE.MathUtils.lerp(b.min.y, b.max.y, 0.1 + Math.random() * 0.8), THREE.MathUtils.lerp(b.min.z, b.max.z, 0.1 + Math.random() * 0.8));
  return m.localToWorld(out);
}

interface Hit { point: THREE.Vector3; normal: THREE.Vector3; surface: SurfaceKind; mesh: THREE.Mesh }

function cast(from: THREE.Vector3, dir: THREE.Vector3): Hit | null {
  ray.set(from, dir);
  ray.far = 150;
  const hits = ray.intersectObjects(targets, false);
  if (!hits.length) return null;
  const h = hits[0];
  const n = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0);
  normalMat.getNormalMatrix(h.object.matrixWorld);
  n.applyMatrix3(normalMat).normalize();
  return { point: h.point.clone(), normal: n, surface: h.object.userData.surface as SurfaceKind, mesh: h.object as THREE.Mesh };
}

function applyHit(h: Hit, dir: THREE.Vector3, weapon: WeaponKind): void {
  if (h.surface === 'flesh') {
    const headshot = h.point.y > h.mesh.position.y + 0.55;
    fx.blood(h.point, dir, weapon === 'shotgun' ? 0.7 : 1, headshot);
    if (Math.random() < 0.08) fx.bloodPool(h.mesh.position, 1);
  } else fx.impact(h.point, h.normal, h.surface);
}

function fire(weapon: WeaponKind, gunIndex = 0, filter?: SurfaceKind): void {
  const g = guns[gunIndex];
  const target = pickTarget(filter);
  randomPointOn(target, tmpPt);
  tmpDir.subVectors(tmpPt, g.pos).normalize();
  const muzzle = g.pos.clone().addScaledVector(tmpDir, 0.72);
  tmpRight.set(-tmpDir.z, 0, tmpDir.x).normalize();
  fx.muzzleFlash(muzzle, tmpDir, weapon);
  if (weapon !== 'shotgun') fx.shellEject(muzzle.clone().addScaledVector(tmpDir, -0.45).addScaledVector(tmpRight, 0.05), tmpRight, weapon);
  const pellets = weapon === 'shotgun' ? 8 : 1;
  const spread = weapon === 'shotgun' ? 0.05 : weapon === 'smg' ? 0.012 : 0.006;
  for (let i = 0; i < pellets; i++) {
    const d = tmpDir.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2)).normalize();
    const h = cast(muzzle, d);
    const end = h ? h.point : muzzle.clone().addScaledVector(d, 120);
    if (pellets === 1 || i < 3) fx.tracer(muzzle, end, pellets > 1 ? 0.6 : 1);
    if (h) applyHit(h, d, weapon);
  }
}

function impactOn(kind: SurfaceKind): void {
  const target = pickTarget(kind);
  randomPointOn(target, tmpPt);
  const from = guns[0].pos;
  tmpDir.subVectors(tmpPt, from).normalize();
  const h = cast(from, tmpDir);
  if (h) applyHit(h, tmpDir, 'rifle');
}

function bloodOn(headshot: boolean): void {
  const z = zombies[Math.floor(Math.random() * zombies.length)];
  const p = z.position.clone().add(new THREE.Vector3(0, headshot ? 0.7 : 0.25, 0));
  tmpDir.subVectors(p, guns[0].pos).normalize();
  fx.blood(p, tmpDir, 1, headshot);
}

function meleeOn(): void {
  const z = zombies[Math.floor(Math.random() * zombies.length)];
  // bat swing right-to-left across the zombie's front (the side facing the player)
  const p = z.position.clone().add(new THREE.Vector3(0.1, 0.45, 0.3));
  tmpDir.set(-1, 0.12, 0.15).normalize();
  fx.melee(p, tmpDir);
}

function gateOn(): void {
  const bar = gate.children[Math.floor(Math.random() * 10)] as THREE.Mesh;
  bar.getWorldPosition(tmpPt);
  tmpPt.y = 0.6 + Math.random() * 1.2;
  fx.gateHit(tmpPt);
}

function explosionOn(): void {
  fx.explosion(new THREE.Vector3((Math.random() - 0.5) * 6, GROUND_Y, -7 + Math.random() * 3));
}

function shellOn(): void {
  const g = guns[0];
  tmpRight.set(1, 0, 0);
  fx.shellEject(g.pos.clone().add(new THREE.Vector3(0.05, 0, 0.2)), tmpRight, 'rifle');
}

// ------------------------------------------------------------------------------------------------
// UI
// ------------------------------------------------------------------------------------------------

let firefight = false;
let frozen = false;
let ffAcc = 0;
const panel = document.getElementById('panel')!;
const statsEl = document.getElementById('stats')!;

function btn(parent: HTMLElement, label: string, key: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.innerHTML = `${label}${key ? `<kbd>${key}</kbd>` : ''}`;
  b.addEventListener('click', () => { fn(); renderer.domElement.focus(); });
  parent.appendChild(b);
  return b;
}
function section(title: string): HTMLDivElement {
  const h = document.createElement('h2');
  h.textContent = title;
  panel.appendChild(h);
  const d = document.createElement('div');
  d.className = 'grid';
  panel.appendChild(d);
  return d;
}

panel.innerHTML = '<h1>PESU <span>FX Lab</span></h1>';
const sW = section('Weapons (flash + tracer + hit)');
btn(sW, 'Pistol', '1', () => fire('pistol'));
btn(sW, 'SMG', '2', () => fire('smg'));
btn(sW, 'Rifle', '3', () => fire('rifle'));
btn(sW, 'Shotgun', '4', () => fire('shotgun'));
const sI = section('Impacts');
btn(sI, 'Concrete', 'Q', () => impactOn('concrete'));
btn(sI, 'Metal', 'W', () => impactOn('metal'));
btn(sI, 'Wood', 'E', () => impactOn('wood'));
btn(sI, 'Ground', 'R', () => impactOn('ground'));
const sB = section('Blood & melee');
btn(sB, 'Blood', '5', () => bloodOn(false));
btn(sB, 'Headshot', '6', () => bloodOn(true));
btn(sB, 'Pool', '7', () => fx.bloodPool(zombies[Math.floor(Math.random() * zombies.length)].position, 1));
btn(sB, 'Bat hit', '8', meleeOn);
const sO = section('Other');
btn(sO, 'Gate hit', '9', gateOn);
btn(sO, 'Explosion', '0', explosionOn);
btn(sO, 'Shell', 'S', shellOn);
btn(sO, 'Clear', 'C', () => fx.clear());
const sM = section('Modes');
const ffBtn = btn(sM, 'Firefight', 'F', () => toggleFirefight());
const frBtn = btn(sM, 'Freeze', 'P', () => toggleFreeze());
function toggleFirefight(v = !firefight): void { firefight = v; ffBtn.classList.toggle('on', v); }
function toggleFreeze(v = !frozen): void { frozen = v; frBtn.classList.toggle('on', v); }

const todRow = document.createElement('div');
todRow.className = 'row';
todRow.innerHTML = '<label>Time of day</label><input type="range" min="0" max="1" step="0.01"><output></output>';
panel.appendChild(todRow);
const todInput = todRow.querySelector('input')!;
const todOut = todRow.querySelector('output')!;
todInput.value = String(tod);
todOut.textContent = tod.toFixed(2);
todInput.addEventListener('input', () => { setTime(Number(todInput.value)); todOut.textContent = tod.toFixed(2); });
const note = document.createElement('div');
note.className = 'note';
note.textContent = 'Drag to orbit, wheel to zoom. N toggles day/night. window.fxTest has scripting hooks.';
panel.appendChild(note);

const keyMap: Record<string, () => void> = {
  Digit1: () => fire('pistol'), Digit2: () => fire('smg'), Digit3: () => fire('rifle'), Digit4: () => fire('shotgun'),
  KeyQ: () => impactOn('concrete'), KeyW: () => impactOn('metal'), KeyE: () => impactOn('wood'), KeyR: () => impactOn('ground'),
  Digit5: () => bloodOn(false), Digit6: () => bloodOn(true), Digit7: () => fx.bloodPool(zombies[Math.floor(Math.random() * zombies.length)].position, 1), Digit8: meleeOn,
  Digit9: gateOn, Digit0: explosionOn, KeyS: shellOn, KeyC: () => fx.clear(),
  KeyF: () => toggleFirefight(), KeyP: () => toggleFreeze(),
  KeyN: () => { setTime(tod > 0.5 ? 0.1 : 1); todInput.value = String(tod); todOut.textContent = tod.toFixed(2); },
};
addEventListener('keydown', (e) => { const f = keyMap[e.code]; if (f && !e.repeat) f(); });

// ------------------------------------------------------------------------------------------------
// loop
// ------------------------------------------------------------------------------------------------

let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fps = 0, statAcc = 0;
let lastCalls = 0, lastTris = 0;
let pendingAdvance = 0;
const WEAPONS: WeaponKind[] = ['pistol', 'smg', 'rifle', 'shotgun'];

function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  requestAnimationFrame(loop);
}

/** One frame: sim + fx.update + render. `fxOverride` forces the fx time step (scripted captures). */
function step(dt: number, fxOverride?: number): void {
  controls.update();
  worldUniforms.uTime.value += dt;
  sky.follow(controls.target);

  if (firefight && !frozen) {
    ffAcc += dt;
    while (ffAcc >= 0.08) {
      ffAcc -= 0.08;
      const gi = Math.floor(Math.random() * guns.length);
      const w = Math.random() < 0.15 ? WEAPONS[Math.floor(Math.random() * 4)] : guns[gi].weapon;
      fire(w, gi);
    }
  }

  const fxDt = fxOverride ?? (frozen ? pendingAdvance : dt);
  pendingAdvance = 0;
  const tf = performance.now();
  fx.update(fxDt);
  const fxMs = performance.now() - tf;

  renderer.info.reset();
  post.render(dt, 0);
  lastCalls = renderer.info.render.calls;
  lastTris = renderer.info.render.triangles;

  fpsAcc += dt; fpsFrames++; statAcc += dt;
  if (fpsAcc >= 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  if (statAcc >= 0.25) {
    statAcc = 0;
    const s = fx.stats();
    statsEl.textContent =
      `FPS        ${fps.toFixed(0)}\n` +
      `draw calls ${lastCalls}\n` +
      `triangles  ${lastTris}\n` +
      `fx calls   ${s.drawCalls} / 3\n` +
      `particles  ${s.particles} / ${s.capacity.particles}\n` +
      `decals     ${s.decals} / ${s.capacity.decals}\n` +
      `fx.update  ${fxMs.toFixed(3)} ms\n` +
      `night      ${worldUniforms.uNight.value.toFixed(2)}${frozen ? '\nFROZEN' : ''}${firefight ? '\nFIREFIGHT' : ''}`;
  }
}
loop();

// scripting hooks for automated screenshots / perf checks
(window as any).fxTest = {
  fx, engine, post, sky, camera, controls, THREE,
  fire, impactOn, bloodOn, meleeOn, gateOn, explosionOn, shellOn,
  pool: () => fx.bloodPool(zombies[0].position, 1),
  hitAt: (x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: SurfaceKind) => fx.impact(new THREE.Vector3(x, y, z), new THREE.Vector3(nx, ny, nz).normalize(), surface),
  bloodAt: (x: number, y: number, z: number, dx: number, dy: number, dz: number, amount = 1, headshot = false) => fx.blood(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz).normalize(), amount, headshot),
  /** flash + tracer from the player's gun straight down -Z (for framing close-ups) */
  flash: (w: WeaponKind = 'rifle', yaw = 0) => {
    const d = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const m = guns[0].pos.clone().addScaledVector(d, 0.72);
    fx.muzzleFlash(m, d, w);
    fx.tracer(m, m.clone().addScaledVector(d, 40));
    return m;
  },
  setTime,
  firefight: (v: boolean) => toggleFirefight(v),
  freeze: (v: boolean) => toggleFreeze(v),
  /** advance fx time by ms while frozen */
  advance: (ms: number) => { pendingAdvance += ms / 1000; },
  /** synchronously step the fx clock by ms and render one frame (works even when rAF is paused in a hidden tab) */
  step: (ms: number) => { step(1 / 60, ms / 1000); },
  view: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => { camera.position.set(px, py, pz); controls.target.set(tx, ty, tz); controls.update(); },
  stats: () => ({ ...fx.stats(), calls: lastCalls, tris: lastTris, fps }),
  /** magnify a sub-rectangle of the view (normalised 0..1 coords) through the full pipeline; crop() resets */
  crop: (x?: number, y?: number, w?: number, h?: number) => {
    if (x === undefined) camera.clearViewOffset();
    else camera.setViewOffset(engine.width, engine.height, x * engine.width, y! * engine.height, w! * engine.width, h! * engine.height);
  },
  ui: (v: boolean) => { panel.hidden = !v; statsEl.hidden = !v; },
};
