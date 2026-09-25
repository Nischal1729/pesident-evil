import * as THREE from 'three';
import { Assets } from './Assets';
import { AudioBridge } from './AudioBridge';
import { Engine } from './Engine';
import { emptyInput, Input, type PlayerInput } from './Input';
import { loadHighScore, loadSettings, QUALITY, saveHighScore, saveSettings, type QualityProfile, type Settings } from './Settings';
import { CampusBuilder, type CampusBuild } from '../world/Campus';
import { loadWorldTextures, worldUniforms } from '../world/materials';
import { Sky } from '../world/Sky';
import { TreeSystem } from '../world/trees';
import { GATES, GLOBE_POS, MAIN_GATE_PORTAL, STATIONS } from '../world/layout';
import { Post } from '../render/Post';
import { CameraRig } from '../render/CameraRig';
import { CharacterManager, WeaponModels } from '../render/Characters';
import { GlbCharacterLibrary } from '../render/GlbCharacters';
import { gateInward, World } from '../sim/World';
import type { Look } from '../sim/actors';
import { WEAPONS } from '../sim/weapons';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';

type GameState = 'loading' | 'menu' | 'playing' | 'paused' | 'gameover';

// Optional modules produced by parallel work streams (loaded if present)
const fxModules = import.meta.glob('../render/Fx.ts');
const propModules = import.meta.glob('../world/Props.ts');

interface FxLike {
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, weapon: string): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, strength?: number): void;
  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: string): void;
  blood(point: THREE.Vector3, dir: THREE.Vector3, amount?: number, headshot?: boolean): void;
  bloodPool?(pos: THREE.Vector3, scale?: number): void;
  melee?(point: THREE.Vector3, dir: THREE.Vector3): void;
  gateHit?(point: THREE.Vector3): void;
  shellEject?(pos: THREE.Vector3, right: THREE.Vector3, weapon: string): void;
  update(dt: number): void;
  setNight?(n: number): void;
}

const PLAYER_LOOK: Look = { body: 'male', skin: '#a36a45', hair: '#161210', shirt: '#7a1f2b', pants: '#243044', shoes: '#f2f2f2', accessory: '#2d59a8', seed: 11 };
const SQUAD: { name: string; voice: 'male' | 'female'; weapon: 'rifle' | 'smg' | 'shotgun' | 'pistol'; acc: number; look: Look }[] = [
  { name: 'Rahul (CSE, 3rd yr)', voice: 'male', weapon: 'rifle', acc: 0.82, look: { body: 'male', skin: '#8d5a3b', hair: '#1f1712', shirt: '#2f5d9b', pants: '#2b3a55', shoes: '#222222', accessory: '#2d59a8', seed: 21 } },
  { name: 'Ananya (ECE, 2nd yr)', voice: 'female', weapon: 'smg', acc: 0.74, look: { body: 'female', skin: '#b77b52', hair: '#0e0c0b', shirt: '#b3261e', pants: '#f0e6d2', shoes: '#6b4a2e', accessory: '#2d59a8', seed: 33 } },
  { name: 'Manjunath (Security)', voice: 'male', weapon: 'shotgun', acc: 0.66, look: { body: 'male', skin: '#6b3f28', hair: '#161210', shirt: '#26324f', pants: '#1f2430', shoes: '#111111', accessory: '#1d2f6f', seed: 45 } },
];

const _gateX = new THREE.Vector3(1, 0, 0);
const _gateZ = new THREE.Vector3();
const _gateQ = new THREE.Quaternion();

export class Game {
  engine!: Engine;
  settings: Settings = loadSettings();
  q: QualityProfile = QUALITY[this.settings.quality];
  assets = new Assets();
  sky!: Sky;
  campus!: CampusBuild;
  post!: Post;
  rig!: CameraRig;
  chars!: CharacterManager;
  weapons = new WeaponModels();
  charLib = new GlbCharacterLibrary();
  hud!: Hud;
  menu!: Menu;
  input!: Input;
  audio = new AudioBridge();
  fx: FxLike | null = null;
  world: World | null = null;
  state: GameState = 'loading';
  private acc = 0;
  private readonly fixed = 1 / 60;
  private last = performance.now();
  private inputs = new Map<number, PlayerInput>();
  private pin = emptyInput();
  private menuT = 0;
  private detach: (() => void)[] = [];
  private pickupMeshes = new Map<number, THREE.Object3D>();
  private pickupGeo = { ammo: new THREE.BoxGeometry(0.5, 0.3, 0.3), health: new THREE.BoxGeometry(0.4, 0.3, 0.2) };
  private pickupMat = { ammo: new THREE.MeshStandardMaterial({ color: 0x556b2f, emissive: 0x3a4a10, emissiveIntensity: 0.6 }), health: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0xaa2020, emissiveIntensity: 0.5 }) };
  private gateAnim = new Map<string, number>();
  /** Walkable ramps/stairs/podiums/decks with layered navigation (see World.levels). ?flat falls back to the old flat sim. */
  readonly multiLevel = !new URLSearchParams(location.search).has('flat');
  private lastTod = -1;
  private stationMarkers: THREE.InstancedMesh | null = null;
  private clickHint: HTMLElement | null = null;

  async boot(): Promise<void> {
    (window as unknown as { game: Game }).game = this;
    const ui = document.getElementById('ui')!;
    this.engine = new Engine(document.getElementById('app')!, this.q, this.settings.fov);
    this.assets.maxAnisotropy = Math.min(8, this.engine.renderer.capabilities.getMaxAnisotropy());
    this.menu = new Menu(ui, this.settings, {
      onPlay: () => this.startGame(),
      onResume: () => this.resume(),
      onQuitToMenu: () => this.quitToMenu(),
      onRestart: () => { this.quitToMenu(); this.startGame(); },
      onSettings: (s) => this.applySettings(s),
    });
    this.menu.show('loading');
    this.hud = new Hud(ui);
    this.input = new Input(this.engine.renderer.domElement);
    this.input.onPause = () => { if (this.state === 'playing') this.pause(); else if (this.state === 'paused' && this.menu.current === 'pause') this.resume(); };
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
      if (this.clickHint) this.clickHint.style.display = locked || this.state !== 'playing' ? 'none' : 'block';
    };
    this.engine.renderer.domElement.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.input.requestLock(); });
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'playing' || !this.world) return;
      if (e.code === 'KeyN') this.world.skipPrep();
      if (e.code === 'KeyC') this.rig.shoulderSide *= -1;
    });
    this.applySettings(this.settings, false);

    let stage = 'Loading textures';
    this.assets.onProgress = (d, t) => this.menu.setProgress(Math.min(0.6, (d / Math.max(1, t)) * 0.6), `${stage}…`);
    const tex = await loadWorldTextures(this.assets);
    stage = 'Loading models';
    await this.weapons.load(this.assets);
    await this.charLib.load(this.assets);
    this.menu.setProgress(0.62, 'Building the campus…');
    await nextFrame();
    const trees = new TreeSystem(tex.bark);
    const builder = new CampusBuilder(tex, trees, this.q);
    this.campus = builder.build();
    for (const [id, g] of this.campus.gates) this.gateBase(id, g.panels);
    this.engine.scene.add(this.campus.group);
    this.menu.setProgress(0.75, 'Dressing the set…');
    await nextFrame();
    const propLoader = Object.values(propModules)[0];
    if (propLoader) {
      try {
        const mod = (await propLoader()) as { buildProps?: (...a: unknown[]) => Promise<{ group: THREE.Group }> };
        if (mod.buildProps) {
          const pb = await mod.buildProps(this.assets, this.campus.collision, { quality: this.q, medianPts: builder.medianPts });
          this.engine.scene.add(pb.group);
        }
      } catch (err) { console.warn('[props] failed, continuing without', err); }
    }
    this.menu.setProgress(0.85, 'Lighting…');
    this.sky = new Sky(this.engine.renderer, this.engine.scene, this.q.shadowMapSize, this.q.shadowDistance, { low: 4, medium: 6, high: 8, ultra: 10 }[this.settings.quality], { low: 0.35, medium: 0.42, high: 0.5, ultra: 0.6 }[this.settings.quality]);
    this.sky.setTime(0.02);
    this.post = new Post(this.engine.renderer, this.engine.scene, this.engine.camera, this.q);
    this.engine.onResize = (w, h) => this.post.setSize(w, h);
    this.engine.resize();
    this.rig = new CameraRig(this.engine.camera, this.campus.collision);
    this.rig.baseFov = this.settings.fov;
    this.chars = new CharacterManager(this.engine.scene, this.weapons, this.q, this.charLib);
    const fxLoader = Object.values(fxModules)[0];
    if (fxLoader) {
      try {
        const mod = (await fxLoader()) as { Fx?: new (s: THREE.Scene, c: THREE.Camera, q: QualityProfile) => FxLike };
        if (mod.Fx) this.fx = new mod.Fx(this.engine.scene, this.engine.camera, this.q);
      } catch (err) { console.warn('[fx] failed, continuing without', err); }
    }
    this.buildStationMarkers();
    this.menu.setProgress(0.95, 'Warming up shaders…');
    this.menuCamera(0);
    this.engine.renderer.compile(this.engine.scene, this.engine.camera);
    this.menu.setProgress(1, 'Ready');
    this.state = 'menu';
    this.menu.show('main');
    (window as unknown as { game: Game }).game = this;
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  // -----------------------------------------------------------------------------------------------
  private applySettings(s: Settings, persist = true): void {
    this.settings = s;
    if (persist) saveSettings(s);
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    if (this.rig) this.rig.baseFov = s.fov;
    this.hud.showFps = s.showFps;
    if (this.audio.ready) {
      this.audio.audio.setMasterVolume(s.masterVolume);
      this.audio.audio.setMusicVolume(s.musicVolume);
      this.audio.audio.setSfxVolume(s.sfxVolume);
      this.audio.audio.setVoiceVolume(s.npcVoices ? 1 : 0);
    }
  }

  private async startGame(): Promise<void> {
    if (!this.audio.ready) {
      this.audio.init().then(() => this.applySettings(this.settings, false)).catch((e) => console.warn('[audio] init failed', e));
    }
    // reset collision state of gates (in case of restart)
    for (const [, g] of this.campus.gates) g.prismIds.forEach((id) => this.campus.collision.setPrismEnabled(id, true));
    const world = new World(this.campus.collision, { maxZombies: this.q.maxZombies, difficulty: 1, multiLevel: this.multiLevel });
    const gp = new Map<string, number[]>();
    for (const [id, g] of this.campus.gates) gp.set(id, g.prismIds);
    world.init(gp);
    world.addPlayer('You', PLAYER_LOOK);
    SQUAD.forEach((m, i) => world.addNpc(m.name, m.voice, m.look, m.weapon, i, m.acc));
    this.world = world;
    this.input.yaw = world.player!.yaw;
    this.input.pitch = -0.05;
    this.input.resetRecoil();
    this.detach.push(this.audio.attach(world));
    this.hud.attach(world);
    this.attachFx(world);
    world.events.on('gameOver', (e) => this.onGameOver(e.wave, e.kills, e.points));
    world.events.on('playerDamaged', (e) => { this.rig.addShake(Math.min(0.6, e.amount / 40)); this.post.hit(Math.min(1, e.amount / 30)); });
    this.hud.show(true);
    this.menu.show('none');
    this.state = 'playing';
    this.input.requestLock();
    world.startGame();
    if (!this.clickHint) {
      this.clickHint = document.createElement('div');
      this.clickHint.className = 'click-to-play';
      this.clickHint.textContent = 'Click to capture the mouse';
      document.getElementById('ui')!.append(this.clickHint);
    }
    this.clickHint.style.display = 'none';
  }

  private attachFx(world: World): void {
    const ev = world.events;
    const off: (() => void)[] = [];
    const muzzleWorld = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let lastRecoilT = -1; // a shotgun trigger pull emits several local 'shot' events in one tick; kick once
    off.push(ev.on('shot', (e) => {
      // recoil moves the aim, so it must not depend on the FX module having loaded
      if (e.shooterId === world.localPlayerId && world.time !== lastRecoilT) {
        lastRecoilT = world.time;
        this.input.addRecoil(WEAPONS[e.weapon as keyof typeof WEAPONS]?.recoil ?? 0.02, world.player!.aiming);
      }
      if (!this.fx) return;
      const v = this.chars.view(e.shooterId);
      if (v?.muzzle) v.muzzle.getWorldPosition(muzzleWorld); else muzzleWorld.copy(e.origin);
      dir.copy(e.end).sub(muzzleWorld).normalize();
      this.fx.muzzleFlash(muzzleWorld, dir, e.weapon);
      this.fx.tracer(muzzleWorld, e.end, e.weapon === 'shotgun' ? 0.6 : 1);
      if (e.weapon !== 'shotgun') {
        const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize().negate();
        this.fx.shellEject?.(muzzleWorld.clone().addScaledVector(dir, -0.35), right, e.weapon);
      }
    }));
    off.push(ev.on('impact', (e) => this.fx?.impact(e.point, e.normal, e.surface)));
    off.push(ev.on('hit', (e) => {
      if (!this.fx || e.surface !== 'flesh') return;
      const d = e.normal.clone().negate();
      const shooter = world.survivors.find((s) => s.id === e.attackerId);
      if (shooter?.def.kind === 'melee') this.fx.melee?.(e.point, d) ?? this.fx.blood(e.point, d, 1.5, false);
      else this.fx.blood(e.point, d, e.headshot ? 1.6 : 1, e.headshot);
    }));
    off.push(ev.on('death', (e) => { if (e.kind === 'zombie') setTimeout(() => this.fx?.bloodPool?.(e.position, 0.8 + Math.random() * 0.5), 700); }));
    off.push(ev.on('gateHit', (e) => this.fx?.gateHit?.(e.position.clone().setY(1.2))));
    this.detach.push(() => off.forEach((o) => o()));
  }

  private onGameOver(wave: number, kills: number, points: number): void {
    const hs = loadHighScore();
    if (!hs || wave > hs.wave || (wave === hs.wave && points > hs.points)) saveHighScore({ wave, kills, points });
    setTimeout(() => {
      this.state = 'gameover';
      this.input.exitLock();
      this.hud.show(false);
      this.menu.gameOver(wave, kills, points);
    }, 2500);
  }

  private pause(): void {
    this.state = 'paused';
    this.input.exitLock();
    this.menu.show('pause');
  }

  private resume(): void {
    this.menu.show('none');
    this.state = 'playing';
    this.input.requestLock();
    this.last = performance.now();
  }

  private quitToMenu(): void {
    this.detach.forEach((d) => d());
    this.detach = [];
    if (this.world) {
      this.world.nav && (this.world as unknown as { nav: { worker?: Worker } }).nav;
      for (const [, m] of this.pickupMeshes) m.removeFromParent();
      this.pickupMeshes.clear();
    }
    this.world = null;
    this.chars.sync({ survivors: [], zombies: [] } as unknown as World, 1, 0, this.engine.camera.position);
    // restore gates visually
    for (const [id] of this.campus.gates) {
      this.poseGate(id, 0);
      this.gateAnim.set(id, 0);
    }
    this.hud.show(false);
    this.state = 'menu';
    this.input.exitLock();
    this.menu.show('main');
  }

  // -----------------------------------------------------------------------------------------------
  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    worldUniforms.uTime.value += dt;
    const e = this.engine;
    e.renderer.info.reset();
    const w = this.world;
    if (w && (this.state === 'playing' || this.state === 'gameover')) {
      if (this.state === 'playing') {
        this.acc += dt;
        this.input.updateRecoil(dt);
        let first = true;
        let steps = 0;
        while (this.acc >= this.fixed && steps < 5) {
          this.input.sample(this.pin, first);
          if (!this.input.locked) { this.pin.fire = false; this.pin.aim = false; this.pin.moveX = this.pin.moveZ = 0; }
          if (this.pin.command) w.toggleNpcMode();
          this.inputs.set(w.localPlayerId, this.pin);
          w.update(this.fixed, this.inputs);
          this.pin.command = false;
          first = false;
          this.acc -= this.fixed;
          steps++;
        }
        if (steps === 5) this.acc = 0;
      } else {
        w.update(dt, new Map());
      }
      const alpha = this.acc / this.fixed;
      const p = w.player!;
      this.chars.sync(w, alpha, dt, e.camera.position);
      const pp = new THREE.Vector3().lerpVectors(p.prev, p.pos, alpha);
      const sprinting = this.pin.sprint && this.pin.moveZ > 0 && Math.hypot(p.vel.x, p.vel.z) > 5;
      this.rig.update(dt, pp, this.input.yaw, this.input.pitch, p.aiming && !p.downed, sprinting, p.downed);
      this.updateGates(dt, w);
      this.updatePickups(dt, w);
      this.audio.update(dt, w, e.camera);
      const def = p.def;
      const spread = def.kind === 'gun' ? (p.aiming ? def.spreadAim : def.spreadHip) * (1 + p.bloom) * (Math.hypot(p.vel.x, p.vel.z) > 0.8 ? 1.5 : 1) : 0;
      this.hud.update(dt, w, e.camera, this.input.yaw, spread);
      this.sky.follow(pp);
      this.setTime(w.timeOfDay);
      this.fx?.update(dt);
      this.sky.prepare(this.engine.camera);
      this.post.render(dt, p.alive ? THREE.MathUtils.clamp(1 - p.health / 40, 0, 1) : 1);
    } else {
      this.menuT += dt;
      this.menuCamera(this.menuT);
      this.sky.follow(this.engine.camera.position);
      this.setTime(0.06);
      this.fx?.update(dt);
      this.sky.prepare(this.engine.camera);
      this.post.render(dt, 0);
    }
    for (const u of this.campus.updatables) u(dt, this.lastTod);
    this.pulseStations();
    requestAnimationFrame(this.loop);
  };

  /** Debug/testing: advance the simulation synchronously (works in background tabs). */
  debugStep(seconds: number, input?: Partial<PlayerInput>): void {
    const w = this.world;
    if (!w) return;
    const steps = Math.round(seconds / this.fixed);
    const pin = { ...emptyInput(), yaw: this.input.yaw, pitch: this.input.pitch, ...input };
    for (let i = 0; i < steps; i++) {
      this.inputs.set(w.localPlayerId, pin);
      w.update(this.fixed, this.inputs);
      pin.reload = pin.jump = pin.melee = pin.interactPressed = false;
      pin.weaponSlot = -1;
    }
  }

  private setTime(t: number): void {
    if (Math.abs(t - this.lastTod) < 0.002) return;
    this.lastTod = t;
    this.sky.setTime(t);
    // time-of-day exposure (dusk/night lift) at 60% of the keyframe curve: keeps the mood, keeps nights readable
    this.post.setExposure(1 + (this.sky.exposure - 1) * 0.6);
    this.post.setNight(worldUniforms.uNight.value);
    this.fx?.setNight?.(worldUniforms.uNight.value);
  }

  private menuCamera(t: number): void {
    // slow cinematic drift along the entry road toward the gate and globe
    const cam = this.engine.camera;
    // high sweep over the entry road: gate + mural on one side, globe plaza + MRD on the other
    const a = t * 0.03;
    const cx = 132 + Math.sin(a) * 22, cz = -104 + Math.cos(a * 0.8) * 8;
    cam.position.set(cx, 19 + Math.sin(a * 1.3) * 2.5, cz);
    const gate = new THREE.Vector3(MAIN_GATE_PORTAL.x, 5, -128);
    const globe = new THREE.Vector3(GLOBE_POS[0], 4, GLOBE_POS[1]);
    cam.lookAt(gate.lerp(globe, 0.5 + Math.sin(a * 0.7) * 0.45));
    if (Math.abs(cam.fov - 55) > 0.1) { cam.fov = 55; cam.updateProjectionMatrix(); }
  }

  /** Base (closed) orientation of every gate leaf, captured once at boot: the animation always starts from it. */
  private gateBaseQuat = new Map<string, THREE.Quaternion[]>();

  private gateBase(id: string, panels: THREE.Object3D[]): THREE.Quaternion[] {
    let q = this.gateBaseQuat.get(id);
    if (!q) this.gateBaseQuat.set(id, (q = panels.map((p) => p.quaternion.clone())));
    return q;
  }

  /** Pose the gate leaves from scratch: cur 0 = shut, 1 = knocked flat toward the campus. */
  private poseGate(id: string, cur: number, shake = 0): void {
    const vis = this.campus.gates.get(id);
    const def = GATES.find((g) => g.id === id);
    if (!vis || !def) return;
    const base = this.gateBase(id, vis.panels);
    const [ix, iz] = gateInward(def.a, def.b);
    vis.panels.forEach((panel, i) => {
      const fall = cur * (Math.PI / 2 - 0.05) * (i % 2 ? 1 : 0.92);
      // the leaf's local +Z after its base yaw decides which way a +X tilt topples it; always topple inward
      _gateZ.set(0, 0, 1).applyQuaternion(base[i]);
      const sign = _gateZ.x * ix + _gateZ.z * iz >= 0 ? 1 : -1;
      panel.quaternion.copy(base[i]).multiply(_gateQ.setFromAxisAngle(_gateX, sign * fall));
      panel.position.copy(vis.closedPos[i]);
      panel.position.x += ix * (Math.sin(fall) * 1.1) + shake;
      panel.position.z += iz * (Math.sin(fall) * 1.1);
    });
  }

  private updateGates(dt: number, w: World): void {
    for (const g of w.gates) {
      const target = g.broken ? 1 : 0;
      let cur = this.gateAnim.get(g.id) ?? 0;
      cur += (target - cur) * Math.min(1, dt * (g.broken ? 3 : 5));
      if (Math.abs(target - cur) < 1e-3) cur = target;
      this.gateAnim.set(g.id, cur);
      const shake = !g.broken && w.time - g.lastHitT < 0.15 ? (Math.random() - 0.5) * 0.04 : 0;
      this.poseGate(g.id, cur, shake);
    }
  }

  private updatePickups(dt: number, w: World): void {
    const seen = new Set<number>();
    for (const pk of w.pickups) {
      seen.add(pk.id);
      let m = this.pickupMeshes.get(pk.id);
      if (!m) {
        m = new THREE.Mesh(this.pickupGeo[pk.kind], this.pickupMat[pk.kind]);
        m.castShadow = true;
        this.engine.scene.add(m);
        this.pickupMeshes.set(pk.id, m);
      }
      m.position.set(pk.pos.x, pk.pos.y + 0.45 + Math.sin(w.time * 3 + pk.id) * 0.1, pk.pos.z);
      m.rotation.y += dt * 2;
      m.visible = pk.ttl > 5 || Math.sin(w.time * 12) > 0;
    }
    for (const [id, m] of this.pickupMeshes) if (!seen.has(id)) { m.removeFromParent(); this.pickupMeshes.delete(id); }
  }

  private buildStationMarkers(): void {
    const geo = new THREE.RingGeometry(0.75, 0.95, 32).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: false });
    const mesh = new THREE.InstancedMesh(geo, mat, STATIONS.length);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    STATIONS.forEach((s, i) => {
      m4.makeTranslation(s.pos[0], (this.multiLevel ? s.y ?? 0 : 0) + 0.08, s.pos[1]);
      mesh.setMatrixAt(i, m4);
      col.set(s.kind === 'ammo' ? 0xf2b233 : s.kind === 'health' ? 0xe5484d : 0x46c46e).multiplyScalar(2);
      mesh.setColorAt(i, col);
    });
    mesh.frustumCulled = false;
    this.engine.scene.add(mesh);
    this.stationMarkers = mesh;
  }

  private pulseStations(): void {
    if (!this.stationMarkers) return;
    const m = this.stationMarkers.material as THREE.MeshBasicMaterial;
    m.opacity = 0.45 + Math.sin(performance.now() * 0.004) * 0.25;
  }
}

function nextFrame(): Promise<void> {
  // rAF never fires in hidden tabs; fall back to a timeout so loading still completes
  return new Promise((r) => {
    let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(fin);
    setTimeout(fin, 50);
  });
}
