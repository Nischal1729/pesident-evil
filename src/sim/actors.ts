import * as THREE from 'three';
import { WEAPONS, type WeaponDef, type WeaponId, type WeaponSlot } from './weapons';

export type ActorKind = 'player' | 'npc' | 'zombie';
export type ZombieType = 'walker' | 'runner' | 'brute' | 'crawler';

/** What the render layer needs to animate an actor. Plain data (networkable). */
export interface AnimHints {
  speed: number;
  localX: number; // strafe component of velocity relative to facing (-1..1)
  localZ: number; // forward component (-1..1)
  aiming: boolean;
  aimPitch: number;
  fireT: number; // seconds since last shot
  reloading: boolean;
  reloadP: number; // 0..1
  meleeP: number; // swing progress 0..1, -1 none
  switchP: number; // weapon switch progress 0..1, -1 none
  airborne: boolean;
  hitT: number; // seconds since last hit
  hitDirX: number;
  hitDirZ: number;
  dead: boolean;
  deadT: number;
  deathVariant: number;
  downed: boolean;
  reviving: boolean;
  attackP: number; // zombie attack progress 0..1, -1 none
  weapon: WeaponId | null;
  wave: boolean; // friendly wave gesture
}

export function newAnim(): AnimHints {
  return {
    speed: 0, localX: 0, localZ: 0, aiming: false, aimPitch: 0, fireT: 99, reloading: false, reloadP: 0, meleeP: -1, switchP: -1,
    airborne: false, hitT: 99, hitDirX: 0, hitDirZ: 0, dead: false, deadT: 0, deathVariant: 0, downed: false, reviving: false,
    attackP: -1, weapon: null, wave: false,
  };
}

let nextId = 1;

export class Actor {
  id = nextId++;
  pos = new THREE.Vector3();
  prev = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  prevYaw = 0;
  radius = 0.36;
  height = 1.75;
  scale = 1;
  health = 100;
  maxHealth = 100;
  alive = true;
  anim: AnimHints = newAnim();
  /** Timed climb onto a ledge (from f to t, progress t over dur seconds), or null. */
  mantle: { t: number; dur: number; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number } | null = null;
  constructor(public kind: ActorKind) {}

  snapshotPrev(): void {
    this.prev.copy(this.pos);
    this.prevYaw = this.yaw;
  }
}

export interface Look {
  body: 'male' | 'female';
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  accessory?: string;
  seed: number;
}

export class Survivor extends Actor {
  name: string;
  voice: 'male' | 'female';
  look: Look;
  weapons: WeaponSlot[] = [];
  current = 0;
  switchT = -1;
  fireCd = 0;
  reloadT = -1;
  reloadDur = 0;
  meleeT = -1;
  meleeDone = false;
  downed = false;
  bleedout = 0;
  reviveProgress = 0;
  reviverId = 0;
  sinceDamage = 99;
  sinceFire = 99;
  bloom = 0;
  aimYaw = 0;
  aimPitch = 0;
  aiming = false;
  aimOrigin = new THREE.Vector3();
  vy = 0;
  grounded = true;
  kills = 0;
  prevFire = false;
  infiniteReserve = false;
  stepAcc = 0;
  /** Co-op: bumped when the host moves this player (spawn, respawn), so the owning client snaps to it. */
  teleportSeq = 0;
  /** Co-op client bookkeeping for its local player, sent to the host with the next input: fall damage, jump, land. */
  pendingFall = 0;
  netJumped = false;
  netLanded = false;

  constructor(kind: 'player' | 'npc', name: string, voice: 'male' | 'female', look: Look) {
    super(kind);
    this.name = name;
    this.voice = voice;
    this.look = look;
  }

  get slot(): WeaponSlot { return this.weapons[this.current]; }
  get def(): WeaponDef { return WEAPONS[this.slot.id]; }
  has(id: WeaponId): WeaponSlot | undefined { return this.weapons.find((w) => w.id === id); }
  get busy(): boolean { return this.reloadT >= 0 || this.switchT >= 0 || this.meleeT >= 0; }
  get active(): boolean { return this.alive && !this.downed; }
}

export type ZombieState = 'chase' | 'attack' | 'gate' | 'dead' | 'stagger';

export const CORPSE_FADE_START = 4.4; // 1.4 s ZombieDeathForward clip + 3 s lying
export const CORPSE_FADE_DUR = 1.0;

export class Zombie extends Actor {
  type: ZombieType = 'walker';
  state: ZombieState = 'chase';
  speed = 1.2;
  damage = 18;
  targetId = 0;
  retargetT = 0;
  losT = 0;
  hasLos = false;
  attackT = -1;
  attackCd = 0;
  stunT = 0;
  deadT = 0;
  deathYaw = 0;
  gateIdx = -1;
  groanT = 0;
  variant = 0;
  knock = new THREE.Vector3();
  lastHitBy = 0;
  alerted = false;
  stuckT = 0;
  lastProgressCost = Infinity;
  /** multi-level vertical state */
  vy = 0;
  grounded = true;
  constructor() {
    super('zombie');
  }
}
