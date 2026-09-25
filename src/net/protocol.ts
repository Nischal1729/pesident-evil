import * as THREE from 'three';
import type { GameEvents } from '../core/Events';
import type { Look } from '../sim/actors';
import { WEAPONS, type WeaponId } from '../sim/weapons';

/**
 * Co-op wire format. Two channels per peer:
 * - reliable (PeerJS data connection, raw): JSON control messages and batched game events;
 * - fast (a negotiated unordered RTCDataChannel with no retransmits): binary world snapshots (host → client, ~20 Hz)
 *   and binary player inputs (client → host, 30 Hz). A lost packet is simply superseded by the next one, so every
 *   one-shot action in an input travels as a wrapping press counter rather than a flag.
 */
export const PROTOCOL = 1;
export const MAX_PLAYERS = 10;

export interface Profile { name: string; look: Look }

export interface RosterEntry { peer: string; name: string; look: Look; host: boolean }

export interface StartSurvivor { id: number; kind: 'player' | 'npc'; name: string; look: Look; voice: 'male' | 'female'; peer?: string }

/** Reliable-channel messages. */
export type CtrlMsg =
  | { t: 'hello'; v: number; profile: Profile }
  | { t: 'roster'; players: RosterEntry[]; inGame: boolean }
  | { t: 'reject'; reason: string }
  | { t: 'start'; yourId: number; difficulty: number; maxZombies: number; survivors: StartSurvivor[] }
  | { t: 'join'; survivor: StartSurvivor }
  | { t: 'leave'; id: number }
  | { t: 'ev'; e: [string, Record<string, unknown>][] }
  | { t: 'ping'; c: number }
  | { t: 'pong'; c: number }
  | { t: 'rtt'; ms: Record<number, number> }
  | { t: 'end'; reason: string };

// ------------------------------------------------------------------------------------------------ events
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Event payloads are flat: Vector3 fields become {$v:[x,y,z]}, numbers are rounded to mm. */
export function encodeEvent(type: string, payload: object): [string, Record<string, unknown>] {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v && (v as THREE.Vector3).isVector3) { const q = v as THREE.Vector3; out[k] = { $v: [round(q.x), round(q.y), round(q.z)] }; }
    else out[k] = typeof v === 'number' ? round(v) : v;
  }
  return [type, out];
}

export function decodeEvent(e: [string, Record<string, unknown>]): [keyof GameEvents, GameEvents[keyof GameEvents]] {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e[1])) {
    const vv = v as { $v?: number[] } | null;
    out[k] = vv && typeof vv === 'object' && Array.isArray(vv.$v) ? new THREE.Vector3(vv.$v[0], vv.$v[1], vv.$v[2]) : v;
  }
  return [e[0] as keyof GameEvents, out as unknown as GameEvents[keyof GameEvents]];
}

// ------------------------------------------------------------------------------------------------ binary helpers
export const MSG_SNAPSHOT = 1;
export const MSG_INPUT = 2;

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const weaponIndex = (id: WeaponId | null) => (id ? WEAPON_IDS.indexOf(id) : 255);
export const weaponAt = (i: number): WeaponId | null => (i === 255 ? null : WEAPON_IDS[i] ?? null);

export const ZTYPES = ['walker', 'runner', 'brute', 'crawler'] as const;
export const ZSTATES = ['chase', 'attack', 'gate', 'dead', 'stagger'] as const;
export const DSTATES = ['intro', 'prep', 'active', 'gameover'] as const;

/** Growable little-endian writer. */
export class Writer {
  buf = new ArrayBuffer(4096);
  dv = new DataView(this.buf);
  o = 0;
  reset(): this { this.o = 0; return this; }
  private need(n: number): void {
    if (this.o + n <= this.buf.byteLength) return;
    const nb = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = nb;
    this.dv = new DataView(nb);
  }
  u8(v: number): void { this.need(1); this.dv.setUint8(this.o, v); this.o += 1; }
  i8(v: number): void { this.need(1); this.dv.setInt8(this.o, Math.max(-127, Math.min(127, Math.round(v)))); this.o += 1; }
  u16(v: number): void { this.need(2); this.dv.setUint16(this.o, Math.max(0, Math.min(65535, Math.round(v))), true); this.o += 2; }
  i16(v: number): void { this.need(2); this.dv.setInt16(this.o, Math.max(-32767, Math.min(32767, Math.round(v))), true); this.o += 2; }
  u32(v: number): void { this.need(4); this.dv.setUint32(this.o, v >>> 0, true); this.o += 4; }
  i32(v: number): void { this.need(4); this.dv.setInt32(this.o, Math.round(v), true); this.o += 4; }
  f32(v: number): void { this.need(4); this.dv.setFloat32(this.o, v, true); this.o += 4; }
  /** unit fraction 0..1 as a byte; 255 encodes "none" (-1) */
  frac(v: number): void { this.u8(v < 0 ? 255 : Math.min(254, Math.round(v * 254))); }
  /** seconds as 1/30 s steps, saturating at 8.5 s */
  secs(v: number): void { this.u8(Math.min(255, Math.max(0, v * 30))); }
  bytes(): ArrayBuffer { return this.buf.slice(0, this.o); }
}

export class Reader {
  dv: DataView;
  o = 0;
  constructor(buf: ArrayBuffer) { this.dv = new DataView(buf); }
  u8(): number { return this.dv.getUint8(this.o++); }
  i8(): number { return this.dv.getInt8(this.o++); }
  u16(): number { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  i16(): number { const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  u32(): number { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  i32(): number { const v = this.dv.getInt32(this.o, true); this.o += 4; return v; }
  f32(): number { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  frac(): number { const v = this.u8(); return v === 255 ? -1 : v / 254; }
  secs(): number { const v = this.u8(); return v >= 255 ? 99 : v / 30; }
}

/** Wrap an angle to (-π, π] for 16-bit transport. */
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ------------------------------------------------------------------------------------------------ input packet
/** Wrapping press counters: the host applies (new − old) & 255 presses, so a lost packet loses nothing. */
export interface InputCounters { fire: number; reload: number; interact: number; melee: number; command: number; slot: number; scroll: number; jump: number; land: number; grenade: number }
export const newCounters = (): InputCounters => ({ fire: 0, reload: 0, interact: 0, melee: 0, command: 0, slot: 0, scroll: 0, jump: 0, land: 0, grenade: 0 });

export interface InputPacket {
  seq: number;
  px: number; py: number; pz: number; vx: number; vy: number; vz: number; pyaw: number;
  yaw: number; pitch: number; camX: number; camY: number; camZ: number;
  moveX: number; moveZ: number;
  fire: boolean; aim: boolean; sprint: boolean; interact: boolean; grounded: boolean; climb: boolean;
  c: InputCounters;
  slot: number; // last requested weapon slot
  scrollSum: number; // cumulative wheel steps (wrapping int8)
  fallTotal: number; // cumulative fall damage (wrapping u16)
  tele: number; // the host teleport this pose already reflects (wrapping u8): older poses must not undo a respawn
}

export function writeInput(w: Writer, p: InputPacket): ArrayBuffer {
  w.reset();
  w.u8(MSG_INPUT);
  w.u32(p.seq);
  for (const v of [p.px, p.py, p.pz, p.vx, p.vy, p.vz, p.pyaw, p.yaw, p.pitch, p.camX, p.camY, p.camZ]) w.f32(v);
  w.i8(p.moveX * 127); w.i8(p.moveZ * 127);
  w.u8((p.fire ? 1 : 0) | (p.aim ? 2 : 0) | (p.sprint ? 4 : 0) | (p.interact ? 8 : 0) | (p.grounded ? 16 : 0) | (p.climb ? 32 : 0));
  const c = p.c;
  for (const v of [c.fire, c.reload, c.interact, c.melee, c.command, c.slot, c.scroll, c.jump, c.land, c.grenade]) w.u8(v & 255);
  w.i8(p.slot);
  w.u8(p.scrollSum & 255);
  w.u16(p.fallTotal & 65535);
  w.u8(p.tele & 255);
  return w.bytes();
}

export function readInput(r: Reader): InputPacket {
  const seq = r.u32();
  const f = Array.from({ length: 12 }, () => r.f32());
  const moveX = r.i8() / 127, moveZ = r.i8() / 127;
  const fl = r.u8();
  const cs = Array.from({ length: 10 }, () => r.u8());
  const slot = r.i8();
  const scrollSum = r.u8();
  const fallTotal = r.u16();
  const tele = r.u8();
  return {
    seq, px: f[0], py: f[1], pz: f[2], vx: f[3], vy: f[4], vz: f[5], pyaw: f[6], yaw: f[7], pitch: f[8], camX: f[9], camY: f[10], camZ: f[11],
    moveX, moveZ, fire: !!(fl & 1), aim: !!(fl & 2), sprint: !!(fl & 4), interact: !!(fl & 8), grounded: !!(fl & 16), climb: !!(fl & 32),
    c: { fire: cs[0], reload: cs[1], interact: cs[2], melee: cs[3], command: cs[4], slot: cs[5], scroll: cs[6], jump: cs[7], land: cs[8], grenade: cs[9] },
    slot, scrollSum, fallTotal, tele,
  };
}
