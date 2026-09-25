import * as THREE from 'three';
import { EventBus, type GameEvents, type SurfaceKind } from '../core/Events';
import type { PlayerInput } from '../core/Input';
import { GATES, NPC_SPAWNS, PLAYER_SPAWN, PLAYER_SPAWN_YAW, SPAWN_ZONES, STATIONS, WORLD_BOUNDS, type StationDef, type V2 } from '../world/layout';
import { distToSegment, rng } from '../world/geom';
import { CAM, cameraPose, forwardFromYawPitch, rightFromYaw } from './aim';
import { Survivor, Zombie, type Look, type ZombieType } from './actors';
import { STEP_UP, type StaticCollision } from './Collision';
import { LayeredNav } from './LayeredNav';
import { NavGrid, type Nav } from './NavGrid';
import { newSlot, WEAPONS, type WeaponDef, type WeaponId } from './weapons';

export interface GateState {
  id: string;
  index: number;
  a: V2;
  b: V2;
  hp: number;
  maxHp: number;
  broken: boolean;
  prismIds: number[];
  activeFromWave: number;
  lastHitT: number;
  repairAcc?: number;
  /** Unit normal of the gate line pointing into the campus. */
  inward: V2;
}

/** HP fraction at which a broken gate stands back up (it closes as soon as the gateway is clear). */
export const GATE_CLOSE_FRAC = 0.35;

/** Unit normal of a gate line pointing into the campus (toward the player spawn). */
export function gateInward(a: V2, b: V2): V2 {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  let nx = -dz / l, nz = dx / l;
  if ((PLAYER_SPAWN[0] - a[0]) * nx + (PLAYER_SPAWN[1] - a[1]) * nz < 0) { nx = -nx; nz = -nz; }
  return [nx, nz];
}

export interface Pickup { id: number; kind: 'ammo' | 'health'; pos: THREE.Vector3; ttl: number }

export type DirectorState = 'intro' | 'prep' | 'active' | 'gameover';

export interface NpcBrain {
  mode: 'follow' | 'hold';
  holdPos: THREE.Vector3;
  formation: THREE.Vector2;
  thinkT: number;
  targetId: number;
  reviveId: number;
  accuracy: number;
  reaction: number;
  burst: number;
  barkCd: Record<string, number>;
  strafeT: number;
  strafeDir: number;
}

export interface InteractPrompt { text: string; progress: number; cost: number; canAfford: boolean }

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _aimPivot = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _dir2 = { x: 0, z: 0 };
const _hitRes = { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 'ground' as SurfaceKind, tag: '' };

/** AI allies deal reduced damage so the player stays the main damage dealer. */
const NPC_DAMAGE = 0.65;

export interface WorldOptions {
  maxZombies: number;
  difficulty: number;
  /** Multi-level movement + layered navigation (walk up ramps, stairs, podiums, decks). */
  multiLevel?: boolean;
}

/** Anything that walks: survivors and zombies share the vertical state used in multi-level mode. */
type Walker = { pos: THREE.Vector3; prev: THREE.Vector3; radius: number; height: number; vy: number; grounded: boolean };

const GRAVITY = 16;
/** Falls higher than this hurt survivors. */
const SAFE_FALL = 4;

/**
 * Authoritative game simulation. Rendering reads its state; audio/fx/UI listen to events.
 * Co-op later: run this on a host and feed remote players' PlayerInput into update().
 */
export class World {
  events = new EventBus<GameEvents>();
  nav: Nav;
  /** multi-level mode (see WorldOptions.multiLevel) */
  readonly levels: boolean;
  survivors: Survivor[] = [];
  zombies: Zombie[] = [];
  gates: GateState[] = [];
  pickups: Pickup[] = [];
  brains = new Map<number, NpcBrain>();
  points = new Map<number, number>();
  localPlayerId = 0;
  time = 0;
  timeOfDay = 0.02;
  wave = 0;
  state: DirectorState = 'intro';
  stateT = 0;
  toSpawn = 0;
  spawnCd = 0;
  totalKills = 0;
  private rand = rng(1337);
  private zSpatial: Int32Array;
  private zNext: Int32Array;
  private spW: number;
  private spH: number;
  private fieldT = 0;
  private reviveT = new Map<number, number>();
  private pickupId = 1;
  private waveMessageShown = new Set<string>();

  constructor(public collision: StaticCollision, public opts: WorldOptions) {
    const b = WORLD_BOUNDS;
    this.levels = !!opts.multiLevel;
    this.nav = this.levels ? new LayeredNav(b.minX, b.minZ, b.maxX, b.maxZ) : new NavGrid(b.minX, b.minZ, b.maxX, b.maxZ);
    this.spW = Math.ceil((b.maxX - b.minX) / 2);
    this.spH = Math.ceil((b.maxZ - b.minZ) / 2);
    this.zSpatial = new Int32Array(this.spW * this.spH);
    this.zNext = new Int32Array(512);
  }

  init(gatePrisms: Map<string, number[]>): void {
    this.nav.build(this.collision, GATES);
    GATES.forEach((g, i) => {
      this.gates.push({ id: g.id, index: i, a: g.a, b: g.b, hp: g.hp, maxHp: g.hp, broken: false, prismIds: gatePrisms.get(g.id) ?? [], activeFromWave: g.activeFromWave, lastHitT: -99, inward: gateInward(g.a, g.b) });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------------------------
  addPlayer(name: string, look: Look): Survivor {
    const p = new Survivor('player', name, look.body === 'female' ? 'female' : 'male', look);
    p.pos.set(PLAYER_SPAWN[0], 0, PLAYER_SPAWN[1]);
    p.yaw = PLAYER_SPAWN_YAW;
    p.health = p.maxHealth = 100;
    p.weapons = [newSlot('pistol'), newSlot('bat')];
    p.snapshotPrev();
    this.survivors.push(p);
    this.points.set(p.id, 500);
    if (!this.localPlayerId) this.localPlayerId = p.id;
    return p;
  }

  addNpc(name: string, voice: 'male' | 'female', look: Look, weapon: WeaponId, spawnIndex: number, accuracy: number): Survivor {
    const n = new Survivor('npc', name, voice, look);
    const sp = NPC_SPAWNS[spawnIndex % NPC_SPAWNS.length];
    n.pos.set(sp[0], 0, sp[1]);
    n.yaw = PLAYER_SPAWN_YAW;
    n.health = n.maxHealth = 140;
    n.weapons = [newSlot(weapon), newSlot('bat')];
    n.infiniteReserve = true;
    n.snapshotPrev();
    this.survivors.push(n);
    const angle = [-2.3, 2.3, 3.14][spawnIndex % 3];
    const dist = [3.2, 3.2, 4.2][spawnIndex % 3];
    this.brains.set(n.id, {
      mode: 'follow', holdPos: n.pos.clone(), formation: new THREE.Vector2(Math.sin(angle) * dist, Math.cos(angle) * dist),
      thinkT: this.rand() * 0.2, targetId: 0, reviveId: 0, accuracy, reaction: 0.25 + this.rand() * 0.2, burst: 0,
      barkCd: {}, strafeT: 0, strafeDir: 1,
    });
    return n;
  }

  get player(): Survivor | undefined { return this.survivors.find((s) => s.id === this.localPlayerId); }

  // ---------------------------------------------------------------------------------------------
  // Main tick
  // ---------------------------------------------------------------------------------------------
  update(dt: number, inputs: Map<number, PlayerInput>): void {
    this.time += dt;
    for (const s of this.survivors) s.snapshotPrev();
    for (const z of this.zombies) z.snapshotPrev();

    this.updateDirector(dt);
    this.updateFields(dt);
    this.rebuildSpatial();
    for (const s of this.survivors) {
      if (!s.alive) continue;
      if (s.kind === 'player') this.updatePlayer(s, inputs.get(s.id), dt);
      else this.updateNpc(s, dt);
      this.updateSurvivorCommon(s, dt);
    }
    for (let i = 0; i < this.zombies.length; i++) this.updateZombie(this.zombies[i], i, dt);
    this.separate();
    this.updateGateStates();
    this.updatePickups(dt);
    this.cleanupCorpses(dt);
    this.updateTimeOfDay(dt);
  }

  // ---------------------------------------------------------------------------------------------
  // Director (waves)
  // ---------------------------------------------------------------------------------------------
  private waveCount(w: number): number { return Math.round(7 + w * 4 + w * w * 0.45); }
  private maxAlive(w: number): number { return Math.min(this.opts.maxZombies, 10 + w * 5); }

  startGame(): void {
    this.state = 'prep';
    this.stateT = 25;
    this.events.emit('message', { text: 'Classes are cancelled. Something is coming down the Ring Road. Hold the main gate!', kind: 'warn' });
  }

  skipPrep(): void {
    if (this.state === 'prep' && this.stateT > 3) this.stateT = 3;
  }

  private updateDirector(dt: number): void {
    if (this.state === 'intro' || this.state === 'gameover') return;
    this.stateT -= dt;
    if (this.state === 'prep') {
      const secs = Math.ceil(this.stateT);
      if (secs !== Math.ceil(this.stateT + dt)) this.events.emit('prepTick', { wave: this.wave + 1, secondsLeft: secs });
      if (this.stateT <= 0) this.startWave();
    } else if (this.state === 'active') {
      this.spawnCd -= dt;
      const alive = this.zombies.reduce((n, z) => n + (z.alive ? 1 : 0), 0);
      if (this.toSpawn > 0 && alive < this.maxAlive(this.wave) && this.spawnCd <= 0) {
        this.spawnZombie();
        this.spawnCd = Math.max(0.12, 1.1 - this.wave * 0.07) * (0.6 + this.rand() * 0.8);
      }
      if (this.toSpawn <= 0 && alive === 0) {
        this.events.emit('waveEnd', { wave: this.wave });
        for (const s of this.survivors) if (s.kind === 'player') this.addPoints(s, 250 + this.wave * 50, 'Wave survived');
        // revive everyone downed at wave end, top up NPC health
        for (const s of this.survivors) if (s.alive && s.downed) this.revive(s, 0);
        this.state = 'prep';
        this.stateT = 22;
      }
    }
    // game over: no active survivor able to fight and the player can't be revived
    const p = this.player;
    if (p && !p.alive && (this.state as DirectorState) !== 'gameover') {
      this.state = 'gameover';
      this.events.emit('gameOver', { wave: this.wave, kills: p.kills, points: this.points.get(p.id) ?? 0 });
    }
  }

  private startWave(): void {
    this.wave++;
    this.state = 'active';
    this.toSpawn = Math.round(this.waveCount(this.wave) * this.opts.difficulty);
    this.spawnCd = 1.5;
    this.events.emit('waveStart', { wave: this.wave, count: this.toSpawn });
    for (const g of this.gates) {
      if (g.activeFromWave === this.wave && g.id !== 'main' && !this.waveMessageShown.has(g.id)) {
        this.waveMessageShown.add(g.id);
        this.events.emit('message', { text: `They're coming round to the ${g.id.toUpperCase()} GATE on PES University Road!`, kind: 'warn' });
      }
    }
    if (this.wave === 3) this.events.emit('message', { text: 'Runners! Some of them are sprinting now.', kind: 'warn' });
    if (this.wave === 5) this.events.emit('message', { text: 'Something big is coming… (Brute)', kind: 'warn' });
  }

  private pickZombieType(): ZombieType {
    const w = this.wave;
    const r = this.rand();
    if (w >= 5 && r < Math.min(0.08, 0.02 + (w - 5) * 0.01)) return 'brute';
    if (w >= 3 && r < Math.min(0.4, 0.1 + (w - 3) * 0.04) + 0.08) return 'runner';
    if (w >= 4 && r > 0.95) return 'crawler';
    return 'walker';
  }

  private spawnZombie(): void {
    const zones = SPAWN_ZONES.filter((z) => {
      const g = this.gates.find((gg) => gg.id === z.gate);
      return g && this.wave >= g.activeFromWave;
    });
    const zone = zones[Math.floor(this.rand() * zones.length)] ?? SPAWN_ZONES[0];
    let pos: V2 | null = null;
    for (let tries = 0; tries < 12; tries++) {
      const base = zone.pts[Math.floor(this.rand() * zone.pts.length)];
      const x = base[0] + (this.rand() - 0.5) * 8, z = base[1] + (this.rand() - 0.5) * 8;
      if (this.nav.isBlocked(x, z)) continue;
      let tooClose = false;
      for (const s of this.survivors) if (s.alive && Math.hypot(s.pos.x - x, s.pos.z - z) < 22) tooClose = true;
      if (tooClose) continue;
      pos = [x, z];
      break;
    }
    if (!pos) return;
    let z = this.zombies.find((zz) => !zz.alive && zz.deadT > 12);
    if (z) {
      const idx = this.zombies.indexOf(z);
      this.zombies.splice(idx, 1);
    }
    z = new Zombie();
    const type = this.pickZombieType();
    const hpScale = (1 + (this.wave - 1) * 0.13) * this.opts.difficulty;
    z.type = type;
    z.variant = Math.floor(this.rand() * 1000);
    switch (type) {
      case 'runner': z.speed = 4.3 + this.rand() * 0.9; z.maxHealth = 75; z.damage = 14; z.scale = 0.95 + this.rand() * 0.08; break;
      case 'brute': z.speed = 1.55; z.maxHealth = 520; z.damage = 38; z.scale = 1.3; z.radius = 0.55; break;
      case 'crawler': z.speed = 0.9; z.maxHealth = 60; z.damage = 12; z.scale = 1; break;
      default: z.speed = 0.85 + this.rand() * 0.75 + Math.min(0.8, this.wave * 0.06); z.maxHealth = 100; z.damage = 18; z.scale = 0.92 + this.rand() * 0.16;
    }
    z.maxHealth *= hpScale;
    z.health = z.maxHealth;
    z.pos.set(pos[0], 0, pos[1]);
    z.yaw = this.rand() * Math.PI * 2;
    z.snapshotPrev();
    z.groanT = 1 + this.rand() * 6;
    z.retargetT = this.rand() * 0.5;
    this.zombies.push(z);
    this.toSpawn--;
  }

  private updateTimeOfDay(dt: number): void {
    const target = this.state === 'intro' ? 0.02 : Math.min(1, 0.03 + Math.max(0, this.wave - 0.4) * 0.11);
    this.timeOfDay += (target - this.timeOfDay) * Math.min(1, dt * 0.05);
  }

  private updateFields(dt: number): void {
    this.fieldT -= dt;
    if (this.fieldT > 0) return;
    this.fieldT = 0.3;
    const targets = this.survivors.filter((s) => s.alive).map((s) => ({ x: s.pos.x, y: s.pos.y, z: s.pos.z }));
    if (targets.length) this.nav.request('zombie', targets);
    const p = this.player;
    if (p && p.alive) this.nav.request('player', [{ x: p.pos.x, y: p.pos.y, z: p.pos.z }], 12000);
  }

  // ---------------------------------------------------------------------------------------------
  // Spatial hash for zombies
  // ---------------------------------------------------------------------------------------------
  private rebuildSpatial(): void {
    this.zSpatial.fill(-1);
    if (this.zNext.length < this.zombies.length) this.zNext = new Int32Array(this.zombies.length * 2);
    const b = WORLD_BOUNDS;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive) continue;
      const cx = Math.floor((z.pos.x - b.minX) / 2), cz = Math.floor((z.pos.z - b.minZ) / 2);
      if (cx < 0 || cz < 0 || cx >= this.spW || cz >= this.spH) continue;
      const c = cz * this.spW + cx;
      this.zNext[i] = this.zSpatial[c];
      this.zSpatial[c] = i;
    }
  }

  forZombiesNear(x: number, z: number, r: number, fn: (zb: Zombie, i: number) => void): void {
    const b = WORLD_BOUNDS;
    const x0 = Math.max(0, Math.floor((x - r - b.minX) / 2)), x1 = Math.min(this.spW - 1, Math.floor((x + r - b.minX) / 2));
    const z0 = Math.max(0, Math.floor((z - r - b.minZ) / 2)), z1 = Math.min(this.spH - 1, Math.floor((z + r - b.minZ) / 2));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.zSpatial[cz * this.spW + cx];
        while (i >= 0) {
          fn(this.zombies[i], i);
          i = this.zNext[i];
        }
      }
  }

  private separate(): void {
    // zombie-zombie and zombie-survivor soft separation
    for (let i = 0; i < this.zombies.length; i++) {
      const a = this.zombies[i];
      if (!a.alive) continue;
      this.forZombiesNear(a.pos.x, a.pos.z, 1.2, (b, j) => {
        if (j <= i || !b.alive || Math.abs(b.pos.y - a.pos.y) > 1.2) return;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      });
    }
    for (const s of this.survivors) {
      if (!s.alive) continue;
      this.forZombiesNear(s.pos.x, s.pos.z, 1.2, (z) => {
        if (!z.alive || Math.abs(z.pos.y - s.pos.y) > 1.2) return;
        const dx = s.pos.x - z.pos.x, dz = s.pos.z - z.pos.z;
        const min = s.radius + z.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = min - d;
          // survivors get shoved more (zombies are relentless)
          s.pos.x += (dx / d) * push * 0.6; s.pos.z += (dz / d) * push * 0.6;
          z.pos.x -= (dx / d) * push * 0.4; z.pos.z -= (dz / d) * push * 0.4;
        }
      });
      for (const o of this.survivors) {
        if (o === s || !o.alive || o.id < s.id || Math.abs(o.pos.y - s.pos.y) > 1.2) continue;
        const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z;
        const min = s.radius + o.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          s.pos.x -= (dx / d) * push; s.pos.z -= (dz / d) * push;
          o.pos.x += (dx / d) * push; o.pos.z += (dz / d) * push;
        }
      }
      if (this.levels) this.collision.resolveBody(s.pos, s.radius, s.pos.y, s.height);
      else this.collision.resolveCircle(s.pos, s.radius, s.pos.y + 0.3);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Multi-level movement
  // ---------------------------------------------------------------------------------------------
  /**
   * Collide a walker at its body height, then follow the ground: snap onto steps/ramps (up to STEP_UP up, a bit
   * more down), fall off ledges under gravity, bump heads on ceilings. Returns the fall height on landing (else 0).
   */
  private moveBody(a: Walker, dt: number): number {
    const c = this.collision;
    c.resolveBody(a.pos, a.radius, a.pos.y, a.height);
    if (a.grounded) {
      const g = c.groundAt(a.pos.x, a.pos.z, a.pos.y + STEP_UP);
      if (a.pos.y - g <= 0.65) { a.pos.y = g; a.vy = 0; return 0; }
      a.grounded = false;
      a.vy = 0;
    }
    const y0 = a.pos.y;
    a.vy -= GRAVITY * dt;
    a.pos.y += a.vy * dt;
    if (a.vy > 0) {
      const ceil = c.ceilingAt(a.pos.x, a.pos.z, y0 + a.height - 0.05);
      if (a.pos.y + a.height > ceil) { a.pos.y = ceil - a.height; a.vy = 0; }
    }
    const g = c.groundAt(a.pos.x, a.pos.z, Math.max(y0, a.pos.y) + 0.05);
    if (a.pos.y <= g) {
      const v = -a.vy;
      a.pos.y = g;
      a.vy = 0;
      a.grounded = true;
      return v > 0 ? (v * v) / (2 * GRAVITY) : 0;
    }
    return 0;
  }

  /** Horizontal collision for AI bodies (flat: legacy 2D push-out; levels: body collision + ground following). */
  private collideWalker(a: Walker, dt: number): void {
    if (this.levels) this.moveBody(a, dt);
    else this.collision.resolveCircle(a.pos, a.radius, 0.3);
  }

  // ---------------------------------------------------------------------------------------------
  // Survivors: shared
  // ---------------------------------------------------------------------------------------------
  private updateSurvivorCommon(s: Survivor, dt: number): void {
    s.sinceDamage += dt;
    s.sinceFire += dt;
    s.fireCd -= dt;
    s.bloom = Math.max(0, s.bloom - dt * 2.2);
    const a = s.anim;
    a.fireT = s.sinceFire;
    a.hitT += dt;
    a.weapon = s.slot?.id ?? null;
    a.downed = s.downed;
    a.dead = !s.alive;
    if (!s.downed && s.sinceDamage > 5 && s.health < s.maxHealth) s.health = Math.min(s.maxHealth, s.health + dt * (s.kind === 'npc' ? 6 : 9));
    // reload progress
    if (s.reloadT >= 0) {
      const d = s.def;
      const prevP = s.reloadT / s.reloadDur;
      s.reloadT += dt;
      const p = s.reloadT / s.reloadDur;
      if (!d.perShell) {
        if (prevP < 0.3 && p >= 0.3) this.events.emit('reload', { actorId: s.id, weapon: d.id, stage: 'magOut', position: s.pos });
        if (prevP < 0.7 && p >= 0.7) this.events.emit('reload', { actorId: s.id, weapon: d.id, stage: 'magIn', position: s.pos });
      }
      if (p >= 1) {
        const slot = s.slot;
        if (d.perShell) {
          if (slot.reserve > 0 || s.infiniteReserve) {
            slot.mag++;
            if (!s.infiniteReserve) slot.reserve--;
            this.events.emit('reload', { actorId: s.id, weapon: d.id, stage: 'magIn', position: s.pos });
          }
          if (slot.mag < d.mag && (slot.reserve > 0 || s.infiniteReserve)) s.reloadT = 0;
          else { s.reloadT = -1; this.events.emit('reload', { actorId: s.id, weapon: d.id, stage: 'rack', position: s.pos }); }
        } else {
          const need = d.mag - slot.mag;
          const take = s.infiniteReserve ? need : Math.min(need, slot.reserve);
          slot.mag += take;
          if (!s.infiniteReserve) slot.reserve -= take;
          s.reloadT = -1;
          this.events.emit('reload', { actorId: s.id, weapon: d.id, stage: 'end', position: s.pos });
        }
      }
    }
    a.reloading = s.reloadT >= 0;
    a.reloadP = s.reloadT >= 0 ? s.reloadT / s.reloadDur : 0;
    if (s.switchT >= 0) {
      s.switchT += dt / 0.4;
      if (s.switchT >= 1) s.switchT = -1;
    }
    a.switchP = s.switchT;
    // melee swing
    if (s.meleeT >= 0) {
      s.meleeT += dt / 0.7;
      if (!s.meleeDone && s.meleeT > 0.38) { s.meleeDone = true; this.meleeHit(s); }
      if (s.meleeT >= 1) s.meleeT = -1;
    }
    a.meleeP = s.meleeT;
    // downed / bleed-out
    if (s.downed) {
      s.bleedout -= dt;
      if (s.bleedout <= 0) this.killSurvivor(s);
    }
    // footsteps
    const sp = Math.hypot(s.vel.x, s.vel.z);
    a.speed = sp;
    if (sp > 0.5 && s.grounded) {
      s.stepAcc += sp * dt;
      const stride = sp > 5 ? 1.8 : sp > 3 ? 1.5 : 1.0;
      if (s.stepAcc > stride) {
        s.stepAcc = 0;
        this.events.emit('footstep', { actorId: s.id, position: s.pos, surface: 'concrete', loud: sp > 5 });
      }
    }
    // local velocity for strafe animations
    const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const fx = -sn, fz = -cs, rx = cs, rz = -sn;
    const ref = Math.max(1, sp);
    a.localZ = (s.vel.x * fx + s.vel.z * fz) / ref;
    a.localX = (s.vel.x * rx + s.vel.z * rz) / ref;
    a.airborne = !s.grounded;
  }

  private startReload(s: Survivor): void {
    const d = s.def;
    if (d.kind !== 'gun' || s.reloadT >= 0) return;
    if (s.slot.mag >= d.mag) return;
    if (s.slot.reserve <= 0 && !s.infiniteReserve) return;
    s.reloadT = 0;
    s.reloadDur = d.reload;
    this.events.emit('reload', { actorId: s.id, weapon: d.id, stage: 'start', position: s.pos });
    if (s.kind === 'npc') this.bark(s, 'reloading', 0.6);
  }

  private switchWeapon(s: Survivor, idx: number): void {
    if (idx < 0 || idx >= s.weapons.length || idx === s.current) return;
    s.current = idx;
    s.reloadT = -1;
    s.meleeT = -1;
    s.switchT = 0;
    this.events.emit('weaponSwitch', { actorId: s.id, weapon: s.slot.id });
  }

  // ---------------------------------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------------------------------
  private updatePlayer(p: Survivor, input: PlayerInput | undefined, dt: number): void {
    if (!input) return;
    p.aimYaw = input.yaw;
    p.aimPitch = input.pitch;
    p.anim.aimPitch = input.pitch;
    const def = p.def;
    const wantsAim = input.aim && def.kind === 'gun';
    // aim origin/dir for this tick: the render camera when the client supplied one, else the sim's own camera pose.
    // Runs every tick (not just on fire) since the squad's aim-corridor check reads p.aimOrigin off the player.
    if (Number.isFinite(input.camX)) {
      p.aimOrigin.set(input.camX, input.camY, input.camZ);
      forwardFromYawPitch(input.yaw, input.pitch, _camDir);
    } else {
      cameraPose(p.pos, input.yaw, input.pitch, wantsAim ? 1 : 0, p.aimOrigin, _camDir);
    }
    if (p.downed) {
      p.vel.set(0, 0, 0);
      p.aiming = false;
      p.anim.aiming = false;
      return;
    }
    // weapon switching
    if (input.weaponSlot >= 0) this.switchWeapon(p, input.weaponSlot);
    else if (input.weaponScroll) this.switchWeapon(p, (p.current + input.weaponScroll + p.weapons.length) % p.weapons.length);
    if (input.reload) this.startReload(p);

    const sprinting = input.sprint && input.moveZ > 0.1 && !wantsAim && !input.fire && p.reloadT < 0;
    p.aiming = wantsAim;
    p.anim.aiming = wantsAim || (input.fire && def.kind === 'gun') || p.sinceFire < 0.8;

    // movement
    const f = forwardFromYawPitch(input.yaw, 0, _v);
    const r = rightFromYaw(input.yaw, _v2);
    let wx = r.x * input.moveX + f.x * input.moveZ;
    let wz = r.z * input.moveX + f.z * input.moveZ;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const speed = (sprinting ? 6.3 : wantsAim ? 2.3 : 4.1) * def.moveMult;
    const accel = p.grounded ? 16 : 3;
    const k = Math.min(1, accel * dt);
    p.vel.x += (wx * speed - p.vel.x) * k;
    p.vel.z += (wz * speed - p.vel.z) * k;
    // jump + gravity
    if (input.jump && p.grounded) {
      p.vy = 5.0;
      p.grounded = false;
      this.events.emit('jump', { actorId: p.id, position: p.pos });
    }
    if (this.levels) {
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      const wasAir = !p.grounded;
      const fell = this.moveBody(p, dt);
      if (wasAir && p.grounded) {
        this.events.emit('land', { actorId: p.id, position: p.pos });
        if (fell > SAFE_FALL) this.damageSurvivor(p, Math.round((fell - SAFE_FALL) * 14), null);
      }
    } else {
      if (!p.grounded) {
        p.vy -= GRAVITY * dt;
        p.pos.y += p.vy * dt;
        if (p.pos.y <= 0) {
          p.pos.y = 0;
          p.grounded = true;
          this.events.emit('land', { actorId: p.id, position: p.pos });
        }
      }
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      this.collision.resolveCircle(p.pos, p.radius, p.pos.y + 0.3);
    }

    // facing: face the camera when aiming/shooting, otherwise the direction of travel
    const facingCam = p.anim.aiming || p.meleeT >= 0;
    let targetYaw = p.yaw;
    if (facingCam) targetYaw = input.yaw;
    else if (Math.hypot(p.vel.x, p.vel.z) > 0.6) targetYaw = Math.atan2(-p.vel.x, -p.vel.z);
    p.yaw = turnToward(p.yaw, targetYaw, (facingCam ? 18 : 10) * dt);

    // melee (bat equipped + fire, or quick melee key)
    if ((input.melee || (def.kind === 'melee' && input.fire && !p.prevFire)) && p.meleeT < 0 && p.switchT < 0) {
      p.meleeT = 0;
      p.meleeDone = false;
      p.reloadT = -1;
      this.events.emit('meleeSwing', { actorId: p.id, position: p.pos });
    }
    // shooting
    if (def.kind === 'gun' && input.fire && p.fireCd <= 0 && p.reloadT < 0 && p.switchT < 0 && p.meleeT < 0) {
      const semiOk = def.auto || !p.prevFire;
      if (semiOk) {
        if (p.slot.mag <= 0) {
          if (!p.prevFire) { this.events.emit('dryFire', { actorId: p.id, position: p.pos }); this.startReload(p); }
          p.fireCd = 0.25;
          if (p.slot.reserve <= 0 && !p.prevFire) this.events.emit('message', { text: 'Out of ammo — find an ammo crate (E)', kind: 'warn' });
        } else {
          _aimPivot.set(p.pos.x, p.pos.y + CAM.pivotY, p.pos.z);
          const aimPoint = this.aimPoint(p.aimOrigin, _camDir, 250, _v3, _aimPivot);
          const muzzle = this.muzzlePos(p, _v);
          this.fire(p, muzzle, aimPoint, wantsAim);
        }
      }
    }
    p.prevFire = input.fire;

    // interaction
    this.handleInteract(p, input, dt);
  }

  muzzlePos(s: Survivor, out: THREE.Vector3): THREE.Vector3 {
    const yaw = s.yaw;
    const f = forwardFromYawPitch(yaw, 0, _muzF);
    const r = rightFromYaw(yaw, _dirR);
    const pistol = s.def.anim === 'pistol';
    return out.set(s.pos.x, s.pos.y + (pistol ? 1.42 : 1.38), s.pos.z).addScaledVector(r, pistol ? 0.18 : 0.22).addScaledVector(f, pistol ? 0.62 : 0.78);
  }

  /**
   * First thing the camera ray hits (static geometry or a zombie), or a far point.
   * `pivot` is the point near the player the ray should be judged from (e.g. the shoulder pivot): geometry or
   * zombies between `origin` and `pivot` are ignored, so a render camera sitting behind or beside the player
   * (far/high views, or one pulled through a wall) can't capture the aim on something in front of it.
   */
  aimPoint(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: THREE.Vector3, pivot: THREE.Vector3): THREE.Vector3 {
    const tStart = Math.max(0, (pivot.x - origin.x) * dir.x + (pivot.y - origin.y) * dir.y + (pivot.z - origin.z) * dir.z);
    let best = maxDist;
    const h = this.collision.raycast(origin.x + dir.x * tStart, origin.y + dir.y * tStart, origin.z + dir.z * tStart, dir.x, dir.y, dir.z, maxDist - tStart, _hitRes, true);
    if (h) best = tStart + h.dist;
    for (const z of this.zombies) {
      if (!z.alive) continue;
      const t = rayZombie(z, origin, dir, best);
      if (t && t.t < best && t.t >= tStart) best = t.t;
    }
    // don't aim at points behind/very close to the pivot (inside the shoulder zone)
    best = Math.max(best, tStart + 1.0);
    return out.copy(origin).addScaledVector(dir, best);
  }

  // ---------------------------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------------------------
  fire(s: Survivor, originIn: THREE.Vector3, target: THREE.Vector3, aiming: boolean): void {
    const d = s.def;
    const origin = _fireOrigin.copy(originIn); // callers pass scratch vectors; snapshot before tracing
    s.slot.mag--;
    s.fireCd = 60 / d.rpm;
    s.sinceFire = 0;
    const moving = Math.hypot(s.vel.x, s.vel.z) > 0.8;
    let spread = aiming ? d.spreadAim : d.spreadHip;
    spread *= (moving ? 1.5 : 1) * (1 + s.bloom) * (s.grounded ? 1 : 2);
    if (s.kind === 'npc') spread = spread * 1.2 + (1 - (this.brains.get(s.id)?.accuracy ?? 0.7)) * 0.05;
    const dir = _fireDir.copy(target).sub(origin);
    const dist = dir.length();
    if (dist < 0.01) dir.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    else dir.divideScalar(dist);
    // muzzle blocked by a wall right in front? shoot from slightly behind to avoid tunnelling
    let firstEnd: THREE.Vector3 | null = null;
    let firstSurface: SurfaceKind | null = null;
    for (let p = 0; p < Math.max(1, d.pellets); p++) {
      const pd = perturb(dir, spread, _pelletDir, this.rand);
      const res = this.traceBullet(s, origin, pd, d);
      if (!firstEnd) { firstEnd = _endA.copy(res.end); firstSurface = res.surface; }
      else if (p < 4) this.events.emit('shot', { shooterId: s.id, weapon: d.id, origin: origin.clone(), end: res.end.clone(), hitSurface: res.surface });
    }
    s.bloom = Math.min(1.6, s.bloom + (d.pellets > 1 ? 0.6 : 0.22));
    this.events.emit('shot', { shooterId: s.id, weapon: d.id, origin: origin.clone(), end: firstEnd!.clone(), hitSurface: firstSurface });
    if (s.slot.mag <= 0 && (s.slot.reserve > 0 || s.infiniteReserve) && s.kind === 'npc') this.startReload(s);
  }

  private traceBullet(s: Survivor, origin: THREE.Vector3, dir: THREE.Vector3, d: WeaponDef): { end: THREE.Vector3; surface: SurfaceKind | null } {
    const sh = this.collision.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, d.range, _hitRes, true);
    const maxT = sh ? sh.dist : d.range;
    // collect zombie hits
    _hits.length = 0;
    for (const z of this.zombies) {
      if (!z.alive) continue;
      // quick reject by distance to ray
      const t = rayZombie(z, origin, dir, maxT);
      if (t) _hits.push({ z, t: t.t, head: t.head });
    }
    _hits.sort((a, b) => a.t - b.t);
    let pen = d.penetration + 1;
    let endT = maxT;
    let surface: SurfaceKind | null = sh ? sh.surface : null;
    for (const h of _hits) {
      if (pen <= 0) break;
      const fall = h.t > d.falloffStart ? Math.max(0.45, 1 - (h.t - d.falloffStart) / (d.range - d.falloffStart)) : 1;
      const dmg = d.damage * (h.head ? d.headMult : 1) * fall * (pen < d.penetration + 1 ? 0.7 : 1) * (s.kind === 'npc' ? NPC_DAMAGE : 1);
      const point = _hitPoint.copy(origin).addScaledVector(dir, h.t);
      this.damageZombie(h.z, dmg, s, point, dir, h.head, d);
      pen--;
      if (pen <= 0) { endT = h.t; surface = 'flesh'; }
    }
    if (surface !== 'flesh' && sh) {
      this.events.emit('impact', { point: new THREE.Vector3(sh.x, sh.y, sh.z), normal: new THREE.Vector3(sh.nx, sh.ny, sh.nz), surface: sh.surface });
    }
    return { end: _endB.copy(origin).addScaledVector(dir, endT), surface };
  }

  private meleeHit(s: Survivor): void {
    const d = WEAPONS.bat;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    let hits = 0;
    this.forZombiesNear(s.pos.x, s.pos.z, d.meleeRange! + 1, (z) => {
      if (!z.alive || hits >= 3 || Math.abs(z.pos.y - s.pos.y) > 1.2) return;
      const dx = z.pos.x - s.pos.x, dz = z.pos.z - s.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > d.meleeRange! + z.radius) return;
      const cos = (dx * fx + dz * fz) / (dist || 1);
      if (cos < Math.cos(d.meleeArc! / 2)) return;
      hits++;
      const head = this.rand() < 0.3;
      const point = _v.set(z.pos.x, z.pos.y + 1.3 * z.scale, z.pos.z);
      this.damageZombie(z, d.damage * (head ? d.headMult : 1), s, point, _v3.set(dx / (dist || 1), 0, dz / (dist || 1)), head, d);
    });
    if (hits === 0) {
      // bash the gate or nothing
    }
  }

  damageZombie(z: Zombie, dmg: number, by: Survivor | null, point: THREE.Vector3, dir: THREE.Vector3, head: boolean, d: WeaponDef | null): void {
    if (!z.alive) return;
    z.health -= dmg;
    z.anim.hitT = 0;
    z.anim.hitDirX = dir.x;
    z.anim.hitDirZ = dir.z;
    z.lastHitBy = by?.id ?? 0;
    z.alerted = true;
    if (by) z.targetId = by.id;
    this.events.emit('hit', { targetId: z.id, attackerId: by?.id ?? 0, damage: dmg, point: point.clone(), normal: dir.clone().negate(), headshot: head, surface: 'flesh' });
    if (d) {
      const stagger = d.stagger * (z.type === 'brute' ? 0.3 : 1);
      if (stagger > 0.2 || this.rand() < 0.3) {
        z.stunT = Math.max(z.stunT, stagger);
        if (z.state === 'attack') { z.attackT = -1; z.anim.attackP = -1; }
      }
      const kb = d.knockback * (z.type === 'brute' ? 0.2 : 1);
      z.knock.x += dir.x * kb;
      z.knock.z += dir.z * kb;
    }
    if (by && by.kind === 'player') this.addPoints(by, 10, '');
    if (z.health <= 0) this.killZombie(z, by, head, d);
  }

  private killZombie(z: Zombie, by: Survivor | null, head: boolean, d: WeaponDef | null): void {
    z.alive = false;
    z.state = 'dead';
    z.deadT = 0;
    z.anim.dead = true;
    z.anim.deathVariant = this.rand() < 0.5 ? 0 : 1;
    z.anim.attackP = -1;
    z.vel.set(0, 0, 0);
    this.totalKills++;
    if (by) {
      by.kills++;
      if (by.kind === 'player') this.addPoints(by, 50 + (head ? 40 : 0) + (d?.kind === 'melee' ? 30 : 0), head ? 'Headshot' : d?.kind === 'melee' ? 'Sixer!' : 'Kill');
      else if (this.rand() < 0.12) this.bark(by, 'kill', 4);
    }
    this.events.emit('death', { id: z.id, kind: 'zombie', killerId: by?.id ?? 0, headshot: head, position: z.pos.clone() });
    // drops
    const r = this.rand();
    if (r < 0.07) this.spawnPickup('ammo', z.pos);
    else if (r < 0.1) this.spawnPickup('health', z.pos);
  }

  // ---------------------------------------------------------------------------------------------
  // Damage to survivors
  // ---------------------------------------------------------------------------------------------
  damageSurvivor(s: Survivor, amount: number, from: THREE.Vector3 | null): void {
    if (!s.alive || s.downed) return;
    s.health -= amount;
    s.sinceDamage = 0;
    s.anim.hitT = 0;
    let dir: THREE.Vector3 | null = null;
    if (from) {
      dir = new THREE.Vector3(from.x - s.pos.x, 0, from.z - s.pos.z).normalize();
      s.anim.hitDirX = dir.x;
      s.anim.hitDirZ = dir.z;
    }
    if (s.kind === 'player') this.events.emit('playerDamaged', { playerId: s.id, amount, fromDir: dir, health: Math.max(0, s.health) });
    else if (this.rand() < 0.35) this.bark(s, 'hurt', 3);
    if (s.health <= 0) {
      s.health = 0;
      s.downed = true;
      s.bleedout = s.kind === 'player' ? 30 : 40;
      s.reloadT = -1;
      s.meleeT = -1;
      s.vel.set(0, 0, 0);
      this.events.emit('downed', { id: s.id, kind: s.kind === 'player' ? 'player' : 'npc', position: s.pos.clone() });
      if (s.kind === 'npc') this.bark(s, 'downed', 0);
      else this.events.emit('message', { text: "You're down! Hold on — your friends can revive you.", kind: 'warn' });
    }
  }

  private killSurvivor(s: Survivor): void {
    s.alive = false;
    s.downed = false;
    s.anim.dead = true;
    s.anim.downed = false;
    this.events.emit('death', { id: s.id, kind: s.kind === 'player' ? 'player' : 'npc', killerId: 0, headshot: false, position: s.pos.clone() });
    if (s.kind === 'npc') this.events.emit('message', { text: `${s.name} didn't make it.`, kind: 'warn' });
  }

  private revive(s: Survivor, byId: number): void {
    s.downed = false;
    s.health = s.maxHealth * 0.5;
    s.reviveProgress = 0;
    s.sinceDamage = 0;
    this.events.emit('revived', { id: s.id, byId });
  }

  // ---------------------------------------------------------------------------------------------
  // Interactions: revive, stations, gate repair
  // ---------------------------------------------------------------------------------------------
  getInteract(p: Survivor): { kind: 'revive' | 'station' | 'repair' | null; target?: Survivor; station?: StationDef; gate?: GateState; prompt: InteractPrompt | null } {
    if (!p.active) return { kind: null, prompt: null };
    for (const o of this.survivors) {
      if (o === p || !o.alive || !o.downed) continue;
      if (Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) < 2.0 && Math.abs(o.pos.y - p.pos.y) < 1.5) {
        return { kind: 'revive', target: o, prompt: { text: `Hold E to revive ${o.name}`, progress: o.reviveProgress, cost: 0, canAfford: true } };
      }
    }
    const pts = this.points.get(p.id) ?? 0;
    for (const st of STATIONS) {
      if (Math.hypot(st.pos[0] - p.pos.x, st.pos[1] - p.pos.z) > 2.0 || Math.abs((st.y ?? 0) - p.pos.y) > 1.6) continue;
      let text = '';
      let cost = st.cost;
      if (st.kind === 'ammo') text = `E — Refill ammo (${cost})`;
      else if (st.kind === 'health') text = `E — Patch up (${cost})`;
      else if (st.kind === 'weapon' && st.item) {
        const owned = p.has(st.item as WeaponId);
        if (owned) { cost = Math.round(st.cost / 2); text = `E — ${WEAPONS[st.item as WeaponId].name} ammo (${cost})`; }
        else text = `E — Buy ${WEAPONS[st.item as WeaponId].name} (${cost})`;
      }
      return { kind: 'station', station: st, prompt: { text, progress: 0, cost, canAfford: pts >= cost } };
    }
    for (const g of this.gates) {
      if (distToSegment(p.pos.x, p.pos.z, g.a[0], g.a[1], g.b[0], g.b[1]) > 3.2 || p.pos.y > 1.5) continue;
      if (!g.broken && g.hp >= g.maxHp) continue;
      // gates are rebuilt from the campus side only (so nobody locks themselves out)
      if ((p.pos.x - g.a[0]) * g.inward[0] + (p.pos.z - g.a[1]) * g.inward[1] < 0) {
        return { kind: null, prompt: { text: `Get back inside to repair the ${g.id} gate`, progress: g.hp / g.maxHp, cost: 0, canAfford: false } };
      }
      const pct = Math.round((g.hp / g.maxHp) * 100);
      const text = !g.broken ? `Hold E to repair the ${g.id} gate (${pct}%)`
        : g.hp >= g.maxHp * GATE_CLOSE_FRAC && this.gateBlocked(g) ? `Clear the gateway! Zombies are blocking the ${g.id} gate (${pct}%)`
          : `Hold E to rebuild the ${g.id} gate (${pct}%)`;
      return { kind: 'repair', gate: g, prompt: { text, progress: g.hp / g.maxHp, cost: 0, canAfford: true } };
    }
    return { kind: null, prompt: null };
  }

  private handleInteract(p: Survivor, input: PlayerInput, dt: number): void {
    const it = this.getInteract(p);
    p.anim.reviving = false;
    if (it.kind === 'revive' && input.interact && it.target) {
      it.target.reviveProgress += dt / 3.0;
      p.anim.reviving = true;
      p.vel.multiplyScalar(0.2);
      if (it.target.reviveProgress >= 1) {
        this.revive(it.target, p.id);
        this.addPoints(p, 100, 'Revive');
        this.bark(it.target, 'thanks', 0);
      }
    } else if (it.kind === 'station' && input.interactPressed && it.station) {
      this.useStation(p, it.station, it.prompt!.cost);
    } else if (it.kind === 'repair' && input.interact && it.gate) {
      const g = it.gate;
      if (this.time - g.lastHitT < 0.8 && !g.broken) return; // can't repair while it's being bashed
      const before = g.hp;
      g.hp = Math.min(g.maxHp, g.hp + dt * 110);
      const gained = g.hp - before;
      g.repairAcc = (g.repairAcc ?? 0) + gained;
      if (g.repairAcc > 60) { g.repairAcc -= 60; this.addPoints(p, 10, 'Repair'); this.events.emit('gateRepaired', { hp: g.hp, maxHp: g.maxHp, position: p.pos.clone() }); }
    }
  }

  private useStation(p: Survivor, st: StationDef, cost: number): void {
    const pts = this.points.get(p.id) ?? 0;
    if (pts < cost) { this.events.emit('message', { text: 'Not enough points', kind: 'warn' }); return; }
    if (st.kind === 'ammo') {
      let changed = false;
      for (const w of p.weapons) {
        const d = WEAPONS[w.id];
        if (d.kind !== 'gun') continue;
        if (w.reserve < d.reserve) { w.reserve = d.reserve; changed = true; }
      }
      if (!changed) { this.events.emit('message', { text: 'Ammo already full', kind: 'info' }); return; }
      this.events.emit('pickup', { playerId: p.id, kind: 'ammo', item: 'crate' });
    } else if (st.kind === 'health') {
      if (p.health >= p.maxHealth) { this.events.emit('message', { text: 'Already at full health', kind: 'info' }); return; }
      p.health = p.maxHealth;
      this.events.emit('pickup', { playerId: p.id, kind: 'health', item: 'kit' });
    } else if (st.kind === 'weapon' && st.item) {
      const id = st.item as WeaponId;
      const owned = p.has(id);
      if (owned) { owned.reserve = WEAPONS[id].reserve; owned.mag = WEAPONS[id].mag; }
      else {
        // keep pistol + bat + up to 2 primaries; replace current primary if full
        const primaries = p.weapons.filter((w) => w.id !== 'pistol' && w.id !== 'bat');
        if (primaries.length >= 2) {
          const cur = p.slot.id !== 'pistol' && p.slot.id !== 'bat' ? p.slot : primaries[0];
          p.weapons.splice(p.weapons.indexOf(cur), 1);
        }
        p.weapons.splice(p.weapons.length - 1, 0, newSlot(id));
        p.current = p.weapons.findIndex((w) => w.id === id);
        p.switchT = 0;
        this.events.emit('weaponSwitch', { actorId: p.id, weapon: id });
      }
      this.events.emit('pickup', { playerId: p.id, kind: 'weapon', item: id });
    }
    this.addPoints(p, -cost, '');
  }

  addPoints(p: Survivor, amount: number, reason: string): void {
    const total = (this.points.get(p.id) ?? 0) + amount;
    this.points.set(p.id, total);
    if (amount !== 0) this.events.emit('points', { playerId: p.id, amount, total, reason });
  }

  // ---------------------------------------------------------------------------------------------
  // Gates
  // ---------------------------------------------------------------------------------------------
  private damageGate(g: GateState, amount: number, at: THREE.Vector3): void {
    if (g.broken) return;
    g.hp -= amount;
    g.lastHitT = this.time;
    this.events.emit('gateHit', { hp: Math.max(0, g.hp), maxHp: g.maxHp, position: at.clone() });
    if (g.hp <= 0) {
      g.hp = 0;
      g.broken = true;
      for (const id of g.prismIds) this.collision.setPrismEnabled(id, false);
      this.nav.setGateClosed(g.index, false);
      this.events.emit('gateBroken', { position: at.clone() });
      this.events.emit('message', { text: `The ${g.id} gate is down! Fall back or rebuild it (hold E).`, kind: 'warn' });
    }
  }

  /** A living zombie standing in the gateway stops a rebuilt gate from standing back up. */
  private gateBlocked(g: GateState): boolean {
    for (const z of this.zombies) {
      if (!z.alive) continue;
      if (distToSegment(z.pos.x, z.pos.z, g.a[0], g.a[1], g.b[0], g.b[1]) < z.radius + 0.6) return true;
    }
    return false;
  }

  /**
   * Gate state machine (kept in one place so visuals, collision and nav always agree):
   * intact (hp > 0) = leaves shut, collision on, nobody passes (bullets still pass the bars) →
   * broken (hp hits 0) = leaves knocked flat, collision off, everyone passes →
   * rebuilt to GATE_CLOSE_FRAC from the campus side = leaves stand up as soon as no zombie is in the gateway.
   */
  private updateGateStates(): void {
    for (const g of this.gates) if (g.broken && g.hp >= g.maxHp * GATE_CLOSE_FRAC && !this.gateBlocked(g)) this.closeGate(g);
  }

  private closeGate(g: GateState): void {
    g.broken = false;
    for (const id of g.prismIds) this.collision.setPrismEnabled(id, true);
    this.nav.setGateClosed(g.index, true);
    // survivors standing in the gateway are moved to the campus side of the leaves
    for (const s of this.survivors) {
      if (!s.alive) continue;
      const d = (s.pos.x - g.a[0]) * g.inward[0] + (s.pos.z - g.a[1]) * g.inward[1];
      if (d < s.radius + 0.35 && distToSegment(s.pos.x, s.pos.z, g.a[0], g.a[1], g.b[0], g.b[1]) < s.radius + 0.6) {
        const push = s.radius + 0.4 - d;
        s.pos.x += g.inward[0] * push; s.pos.z += g.inward[1] * push;
        s.prev.copy(s.pos);
      }
    }
    this.events.emit('gateRepaired', { hp: g.hp, maxHp: g.maxHp, position: new THREE.Vector3((g.a[0] + g.b[0]) / 2, 0, (g.a[1] + g.b[1]) / 2) });
    this.events.emit('message', { text: `The ${g.id} gate is back up.`, kind: 'good' });
  }

  // ---------------------------------------------------------------------------------------------
  // Pickups
  // ---------------------------------------------------------------------------------------------
  private spawnPickup(kind: 'ammo' | 'health', at: THREE.Vector3): void {
    this.pickups.push({ id: this.pickupId++, kind, pos: new THREE.Vector3(at.x, this.levels ? at.y : 0, at.z), ttl: 30 });
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.ttl -= dt;
      let taken = false;
      for (const s of this.survivors) {
        if (s.kind !== 'player' || !s.active) continue;
        if (Math.hypot(s.pos.x - pk.pos.x, s.pos.z - pk.pos.z) < 1.3 && Math.abs(s.pos.y - pk.pos.y) < 1.5) {
          if (pk.kind === 'health') {
            if (s.health >= s.maxHealth) continue;
            s.health = Math.min(s.maxHealth, s.health + 45);
          } else {
            for (const w of s.weapons) {
              const d = WEAPONS[w.id];
              if (d.kind === 'gun') w.reserve = Math.min(d.reserve, w.reserve + Math.ceil(d.mag * 1.5));
            }
          }
          this.events.emit('pickup', { playerId: s.id, kind: pk.kind, item: 'drop' });
          taken = true;
          break;
        }
      }
      if (taken || pk.ttl <= 0) this.pickups.splice(i, 1);
    }
  }

  private cleanupCorpses(dt: number): void {
    let corpses = 0;
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.alive) continue;
      z.deadT += dt;
      z.anim.deadT = z.deadT;
      corpses++;
      if (z.deadT > 14 || (corpses > 30 && z.deadT > 3)) this.zombies.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Zombies
  // ---------------------------------------------------------------------------------------------
  private findSurvivor(id: number): Survivor | undefined {
    for (const s of this.survivors) if (s.id === id) return s;
    return undefined;
  }

  private updateZombie(z: Zombie, _i: number, dt: number): void {
    if (!z.alive) return;
    const a = z.anim;
    a.hitT += dt;
    z.groanT -= dt;
    if (z.groanT <= 0) {
      z.groanT = 3 + this.rand() * 7;
      this.events.emit('zombieGroan', { id: z.id, position: z.pos, kind: z.type === 'runner' && !z.alerted ? 'scream' : this.rand() < 0.3 ? 'near' : 'groan' });
      if (z.type === 'runner') z.alerted = true;
    }
    // target selection
    z.retargetT -= dt;
    let target = this.findSurvivor(z.targetId);
    if (z.retargetT <= 0 || !target || !target.alive) {
      z.retargetT = 0.6 + this.rand() * 0.4;
      let best = Infinity;
      target = undefined;
      for (const s of this.survivors) {
        if (!s.alive) continue;
        const d = Math.hypot(s.pos.x - z.pos.x, s.pos.z - z.pos.z) * (s.downed ? 0.8 : 1);
        if (d < best) { best = d; target = s; }
      }
      z.targetId = target?.id ?? 0;
    }
    // knockback decay
    if (z.knock.lengthSq() > 1e-4) {
      z.pos.x += z.knock.x * dt * 6;
      z.pos.z += z.knock.z * dt * 6;
      z.knock.multiplyScalar(Math.max(0, 1 - dt * 7));
    }
    if (z.stunT > 0) {
      z.stunT -= dt;
      z.vel.multiplyScalar(Math.max(0, 1 - dt * 10));
      this.collideWalker(z, dt);
      a.speed = Math.hypot(z.vel.x, z.vel.z);
      return;
    }
    const cr = z.type === 'crawler';
    let desiredX = 0, desiredZ = 0;
    let wantSpeed = z.speed;
    if (target) {
      const dx = target.pos.x - z.pos.x, dz = target.pos.z - z.pos.z;
      const sameLevel = Math.abs(target.pos.y - z.pos.y) < 1.3;
      // a target on another floor is never "in reach"
      const dist = sameLevel ? Math.hypot(dx, dz) : Math.hypot(dx, dz) + 50;
      const reach = 0.95 + z.radius + (z.type === 'brute' ? 0.4 : 0);
      // attacking
      if (z.attackT >= 0) {
        z.attackT += dt / (z.type === 'runner' ? 0.7 : z.type === 'brute' ? 1.2 : 0.95);
        a.attackP = z.attackT;
        z.vel.multiplyScalar(Math.max(0, 1 - dt * 8));
        z.yaw = turnToward(z.yaw, Math.atan2(-dx, -dz), 6 * dt);
        if (z.attackT >= 0.5 && z.attackT - dt / 0.95 < 0.5) {
          if (dist < reach + 0.55 && target.alive && !target.downed) {
            this.damageSurvivor(target, z.damage, z.pos);
            this.events.emit('zombieAttack', { id: z.id, targetId: target.id, position: z.pos });
          } else if (target.downed && dist < reach + 0.55 && this.rand() < 0.5) {
            target.bleedout -= 3;
          }
        }
        if (z.attackT >= 1) { z.attackT = -1; a.attackP = -1; z.attackCd = 0.25 + this.rand() * 0.35; }
        this.collideWalker(z, dt);
        a.speed = Math.hypot(z.vel.x, z.vel.z);
        return;
      }
      z.attackCd -= dt;
      if (dist < reach && z.attackCd <= 0 && !target.downed) {
        z.attackT = 0;
        a.attackP = 0;
        z.state = 'attack';
      } else if (dist < reach && target.downed) {
        // feed on downed survivors
        target.bleedout -= dt * 0.8;
        wantSpeed = 0;
      }
      // line of sight check (periodic)
      z.losT -= dt;
      if (z.losT <= 0) {
        z.losT = 0.35 + this.rand() * 0.2;
        z.hasLos = dist < 14 && this.collision.los(z.pos.x, z.pos.y + 1.2, z.pos.z, target.pos.x, target.pos.y + 1.2, target.pos.z);
      }
      if (z.hasLos && dist > 0.1) {
        desiredX = dx / dist; desiredZ = dz / dist;
        z.state = 'chase';
      } else {
        const gi = this.nav.descend('zombie', z.pos.x, z.pos.z, _dir2, z.pos.y);
        if (gi === -2) { desiredX = dx / (dist || 1); desiredZ = dz / (dist || 1); }
        else { desiredX = _dir2.x; desiredZ = _dir2.z; }
        // at a closed gate?
        const gate = gi >= 0 ? this.gates[gi] : null;
        if (gate && !gate.broken) {
          const gd = distToSegment(z.pos.x, z.pos.z, gate.a[0], gate.a[1], gate.b[0], gate.b[1]);
          if (gd < z.radius + 0.75) {
            z.state = 'gate';
            wantSpeed = 0;
            z.gateIdx = gi;
            // bash
            if (z.attackCd <= 0) {
              z.attackT = 0; a.attackP = 0;
              z.attackCd = 1.0 + this.rand() * 0.6;
              this.damageGate(gate, (z.type === 'brute' ? 45 : z.type === 'runner' ? 8 : 12) * this.opts.difficulty, z.pos);
            }
          } else z.state = 'chase';
        } else z.state = 'chase';
      }
    }
    if (cr) wantSpeed *= 1;
    if (z.state === 'gate') wantSpeed = 0;
    const k = Math.min(1, dt * (z.type === 'runner' ? 5 : 3));
    z.vel.x += (desiredX * wantSpeed - z.vel.x) * k;
    z.vel.z += (desiredZ * wantSpeed - z.vel.z) * k;
    z.pos.x += z.vel.x * dt;
    z.pos.z += z.vel.z * dt;
    this.collideWalker(z, dt);
    const sp = Math.hypot(z.vel.x, z.vel.z);
    if (sp > 0.15) z.yaw = turnToward(z.yaw, Math.atan2(-z.vel.x, -z.vel.z), (z.type === 'runner' ? 8 : 4) * dt);
    else if (z.state === 'gate' && z.gateIdx >= 0) {
      const g = this.gates[z.gateIdx];
      const nx = -(g.b[1] - g.a[1]), nz = g.b[0] - g.a[0];
      const side = (z.pos.x - g.a[0]) * nx + (z.pos.z - g.a[1]) * nz > 0 ? -1 : 1;
      z.yaw = turnToward(z.yaw, Math.atan2(-nx * side, -nz * side), 5 * dt);
    }
    a.speed = sp;
    a.localZ = 1;
    a.localX = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // NPC allies
  // ---------------------------------------------------------------------------------------------
  toggleNpcMode(): 'follow' | 'hold' {
    let mode: 'follow' | 'hold' = 'hold';
    const first = [...this.brains.values()][0];
    if (first) mode = first.mode === 'follow' ? 'hold' : 'follow';
    for (const [id, b] of this.brains) {
      b.mode = mode;
      const n = this.findSurvivor(id);
      if (n) b.holdPos.copy(n.pos);
    }
    this.events.emit('message', { text: mode === 'hold' ? 'Squad: holding position' : 'Squad: following you', kind: 'info' });
    const any = this.survivors.find((s) => s.kind === 'npc' && s.active);
    if (any) this.bark(any, mode === 'hold' ? 'hold' : 'follow', 0);
    return mode;
  }

  bark(s: Survivor, category: string, cooldown: number): void {
    const b = this.brains.get(s.id);
    const t = this.time;
    if (b) {
      if ((b.barkCd[category] ?? -99) > t) return;
      b.barkCd[category] = t + Math.max(cooldown, 2);
    }
    this.events.emit('bark', { actorId: s.id, category, position: s.pos, voice: s.voice });
  }

  private updateNpc(n: Survivor, dt: number): void {
    const b = this.brains.get(n.id)!;
    const p = this.player;
    n.anim.reviving = false;
    if (n.downed) { n.vel.set(0, 0, 0); return; }
    b.thinkT -= dt;
    let target = b.targetId ? this.zombies.find((z) => z.id === b.targetId && z.alive) : undefined;
    if (b.thinkT <= 0) {
      b.thinkT = 0.15 + this.rand() * 0.08;
      // pick target: nearest visible zombie within range, prefer ones threatening the player
      let best = Infinity;
      let found: Zombie | undefined;
      let checks = 0;
      const cands: { z: Zombie; d: number }[] = [];
      for (const z of this.zombies) {
        if (!z.alive) continue;
        const d = Math.hypot(z.pos.x - n.pos.x, z.pos.z - n.pos.z);
        if (d > 75) continue;
        let score = d;
        if (p && Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) < 4) score *= 0.5;
        cands.push({ z, d: score });
      }
      cands.sort((x, y) => x.d - y.d);
      for (const c of cands) {
        if (checks++ > 5) break;
        if (this.collision.los(n.pos.x, n.pos.y + 1.5, n.pos.z, c.z.pos.x, c.z.pos.y + 1.3, c.z.pos.z)) { found = c.z; best = c.d; break; }
      }
      if (found && found.id !== b.targetId && !target) this.bark(n, 'spotted', 12);
      target = found;
      b.targetId = found?.id ?? 0;
      void best;
      // revive duty
      b.reviveId = 0;
      for (const o of this.survivors) {
        if (o === n || !o.alive || !o.downed) continue;
        if (Math.hypot(o.pos.x - n.pos.x, o.pos.z - n.pos.z) > 35) continue;
        let danger = false;
        this.forZombiesNear(o.pos.x, o.pos.z, 3.5, (z) => { if (z.alive) danger = true; });
        if (!danger || o.kind === 'player') { b.reviveId = o.id; break; }
      }
      // low ammo tactical reload
      if (!target && n.def.kind === 'gun' && n.slot.mag < n.def.mag * 0.5) this.startReload(n);
    }

    // decide where to go
    const goal = _v.copy(n.pos);
    let urgent = false;
    const reviveT = b.reviveId ? this.findSurvivor(b.reviveId) : undefined;
    if (reviveT && reviveT.downed) {
      goal.copy(reviveT.pos);
      urgent = true;
    } else if (b.mode === 'follow' && p && p.alive) {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      // formation offset rotated by player facing (x right, y back)
      goal.set(p.pos.x + c * b.formation.x + s * b.formation.y, p.pos.y, p.pos.z - s * b.formation.x + c * b.formation.y);
      if (this.nav.isBlocked(goal.x, goal.z, goal.y)) goal.copy(p.pos);
    } else {
      goal.copy(b.holdPos);
    }
    // push forward into weapon range of a visible target (leashed to the player / hold spot)
    if (!urgent && target && n.def.kind === 'gun') {
      const eff = effectiveRange(n.def);
      const tdx = target.pos.x - n.pos.x, tdz = target.pos.z - n.pos.z;
      const td = Math.hypot(tdx, tdz);
      if (td > eff) {
        const anchor = b.mode === 'follow' && p && p.alive ? p.pos : b.holdPos;
        const want = _v2.set(n.pos.x + (tdx / td) * (td - eff + 2), n.pos.y, n.pos.z + (tdz / td) * (td - eff + 2));
        const ax = want.x - anchor.x, az = want.z - anchor.z;
        const al = Math.hypot(ax, az);
        const leash = 16;
        if (al > leash) { want.x = anchor.x + (ax / al) * leash; want.z = anchor.z + (az / al) * leash; }
        if (!this.nav.isBlocked(want.x, want.z, want.y)) goal.copy(want);
      }
    }
    let mx = 0, mz = 0, speed = 0;
    const gdx = goal.x - n.pos.x, gdz = goal.z - n.pos.z;
    const gdist = Math.hypot(gdx, gdz);
    const followingPlayer = !urgent && b.mode === 'follow' && p && p.alive;
    const stopDist = urgent ? 1.1 : followingPlayer ? 1.4 : 0.8;
    if (gdist > stopDist) {
      speed = gdist > 9 || urgent ? 4.6 : gdist > 4 ? 3.4 : 2.2;
      const direct = gdist < 10 && Math.abs(goal.y - n.pos.y) < 0.6 && this.collision.los(n.pos.x, n.pos.y + 1.0, n.pos.z, goal.x, goal.y + 1.0, goal.z);
      if (direct) { mx = gdx / gdist; mz = gdz / gdist; }
      else if (followingPlayer && this.nav.descend('player', n.pos.x, n.pos.z, _dir2, n.pos.y) >= -1 && (_dir2.x || _dir2.z)) { mx = _dir2.x; mz = _dir2.z; }
      else { mx = gdx / gdist; mz = gdz / gdist; }
    }
    // kite away from close zombies
    let threatX = 0, threatZ = 0, threat = false;
    this.forZombiesNear(n.pos.x, n.pos.z, 3.6, (z) => {
      if (!z.alive) return;
      const dx = n.pos.x - z.pos.x, dz = n.pos.z - z.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 3.4) { threat = true; threatX += dx / d / d; threatZ += dz / d / d; }
    });
    if (threat && !urgent) {
      const tl = Math.hypot(threatX, threatZ) || 1;
      mx = mx * 0.3 + (threatX / tl) * 0.9;
      mz = mz * 0.3 + (threatZ / tl) * 0.9;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      speed = Math.max(speed, 3.2);
    }
    // gentle strafing while fighting in place
    if (target && speed < 0.1 && !urgent) {
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafeT = 1.5 + this.rand() * 2; b.strafeDir = this.rand() < 0.5 ? -1 : this.rand() < 0.5 ? 0 : 1; }
      const tx = target.pos.x - n.pos.x, tz = target.pos.z - n.pos.z;
      const tl = Math.hypot(tx, tz) || 1;
      mx = (-tz / tl) * b.strafeDir; mz = (tx / tl) * b.strafeDir;
      speed = b.strafeDir ? 1.0 : 0;
    }
    const k = Math.min(1, dt * 10);
    n.vel.x += (mx * speed - n.vel.x) * k;
    n.vel.z += (mz * speed - n.vel.z) * k;
    n.pos.x += n.vel.x * dt;
    n.pos.z += n.vel.z * dt;
    this.collideWalker(n, dt);

    // revive
    if (reviveT && reviveT.downed && Math.hypot(reviveT.pos.x - n.pos.x, reviveT.pos.z - n.pos.z) < 1.6) {
      n.vel.multiplyScalar(0.1);
      n.anim.reviving = true;
      reviveT.reviveProgress += dt / 3.5;
      if (reviveT.reviveProgress >= 1) {
        this.revive(reviveT, n.id);
        this.bark(n, 'revive', 0);
      }
      return;
    }

    // facing + shooting
    let faceYaw = n.yaw;
    if (target) {
      const aimY = target.type === 'crawler' ? 0.4 : (b.accuracy > 0.8 && this.rand() < 0.35 ? 1.55 : 1.2) * target.scale;
      const tx = target.pos.x - n.pos.x, tz = target.pos.z - n.pos.z;
      faceYaw = Math.atan2(-tx, -tz);
      n.yaw = turnToward(n.yaw, faceYaw, 9 * dt);
      n.anim.aiming = true;
      n.anim.aimPitch = Math.atan2(target.pos.y + aimY - (n.pos.y + 1.45), Math.hypot(tx, tz));
      const aligned = Math.abs(angleDiff(n.yaw, faceYaw)) < 0.2;
      const d = n.def;
      const inRange = Math.hypot(target.pos.x - n.pos.x, target.pos.z - n.pos.z) <= effectiveRange(d) + 4;
      if (d.kind === 'gun' && aligned && inRange && n.fireCd <= 0 && n.reloadT < 0 && n.switchT < 0) {
        if (n.slot.mag <= 0) this.startReload(n);
        else {
          // NPCs fire in short bursts with a reaction delay
          if (b.burst <= 0) b.burst = d.auto ? 3 + Math.floor(this.rand() * 4) : 1;
          const muzzle = this.muzzlePos(n, _v2);
          const lead = _v3.set(target.pos.x + target.vel.x * 0.1, target.pos.y + aimY, target.pos.z + target.vel.z * 0.1);
          this.fire(n, muzzle, lead, true);
          b.burst--;
          if (b.burst <= 0) n.fireCd = Math.max(n.fireCd, b.reaction + this.rand() * 0.25 + (d.auto ? 0.15 : 0.2));
          else n.fireCd = Math.max(n.fireCd, 60 / d.rpm * 1.25);
        }
      }
      // close-quarters bat swing if swarmed and gun empty
      if (threat && n.slot.mag <= 0 && n.meleeT < 0) {
        n.meleeT = 0; n.meleeDone = false;
      }
    } else {
      n.anim.aiming = false;
      if (Math.hypot(n.vel.x, n.vel.z) > 0.5) faceYaw = Math.atan2(-n.vel.x, -n.vel.z);
      else if (p) faceYaw = p.yaw;
      n.yaw = turnToward(n.yaw, faceYaw, 6 * dt);
      n.anim.aimPitch = 0;
    }
    if (n.health < n.maxHealth * 0.35 && this.rand() < dt * 0.1) this.bark(n, 'hurt', 10);
  }
}

// ---------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------
const _dirR = new THREE.Vector3();
const _muzF = new THREE.Vector3();
const _fireOrigin = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _fireDir = new THREE.Vector3();
const _pelletDir = new THREE.Vector3();
const _endA = new THREE.Vector3();
const _endB = new THREE.Vector3();
const _hits: { z: Zombie; t: number; head: boolean }[] = [];

/** Distance an NPC is willing to engage at with a weapon. */
export function effectiveRange(d: WeaponDef): number {
  return d.kind === 'melee' ? 2 : Math.min(70, d.pellets > 1 ? d.range * 0.8 : d.range * 0.75);
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(cur: number, target: number, maxStep: number): number {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

function perturb(dir: THREE.Vector3, spread: number, out: THREE.Vector3, rand: () => number): THREE.Vector3 {
  if (spread <= 0) return out.copy(dir);
  // random point in cone (gaussian-ish)
  const r = spread * Math.sqrt(-2 * Math.log(Math.max(1e-6, rand()))) * 0.5;
  const a = rand() * Math.PI * 2;
  // build orthonormal basis
  const up = Math.abs(dir.y) < 0.95 ? _up : _right;
  const u = _u.crossVectors(dir, up).normalize();
  const v = _w.crossVectors(dir, u).normalize();
  return out.copy(dir).addScaledVector(u, Math.cos(a) * Math.tan(r)).addScaledVector(v, Math.sin(a) * Math.tan(r)).normalize();
}
const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(1, 0, 0);
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Ray vs zombie hit volumes (head sphere + body capsule). Returns nearest t or null. */
export function rayZombie(z: Zombie, o: THREE.Vector3, d: THREE.Vector3, maxT: number): { t: number; head: boolean } | null {
  const s = z.scale;
  const crawl = z.type === 'crawler';
  // quick reject: distance from ray to zombie axis
  const px = z.pos.x - o.x, pz = z.pos.z - o.z;
  const hl2 = d.x * d.x + d.z * d.z;
  const tAxis = hl2 > 1e-6 ? (px * d.x + pz * d.z) / hl2 : 0;
  if (tAxis < -1 || tAxis > maxT + 1) return null;
  // head
  const fx = -Math.sin(z.yaw), fz = -Math.cos(z.yaw);
  const hx = z.pos.x + fx * 0.12 * s, hy = z.pos.y + (crawl ? 0.45 : 1.58) * s, hz = z.pos.z + fz * 0.12 * s;
  const hr = 0.16 * s;
  let best: { t: number; head: boolean } | null = null;
  const th = raySphere(o, d, hx, hy, hz, hr);
  if (th !== null && th < maxT) best = { t: th, head: true };
  // body: approximate capsule with 3 spheres along the spine
  const bodyR = 0.3 * s;
  const ys = crawl ? [0.25, 0.3, 0.3] : [0.5, 0.9, 1.25];
  for (let i = 0; i < 3; i++) {
    const lean = crawl ? (i - 1) * 0.35 : (i * 0.05);
    const t = raySphere(o, d, z.pos.x + fx * lean * s, z.pos.y + ys[i] * s, z.pos.z + fz * lean * s, crawl ? 0.28 * s : bodyR * (i === 0 ? 0.9 : 1));
    if (t !== null && t < maxT && (!best || t < best.t - 0.02)) best = { t, head: false };
  }
  return best;
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, cx: number, cy: number, cz: number, r: number): number | null {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
