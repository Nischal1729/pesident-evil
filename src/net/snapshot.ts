import * as THREE from 'three';
import { Zombie, type Survivor } from '../sim/actors';
import type { Grenade, NpcBrain, Pickup, World } from '../sim/World';
import { DSTATES, MSG_SNAPSHOT, Reader, weaponAt, weaponIndex, wrapAngle, Writer, ZSTATES, ZTYPES } from './protocol';

/**
 * World snapshots: the host serialises the parts of World that clients draw, hear or show in the HUD (~3 KB for
 * 100 zombies); clients keep the last few and render ~100 ms in the past, interpolating positions between two.
 */

export interface SurvSnap {
  id: number; x: number; y: number; z: number; yaw: number;
  health: number; maxHealth: number; alive: boolean; downed: boolean; aiming: boolean; reloading: boolean; airborne: boolean;
  reviving: boolean; waving: boolean; hold: boolean; bleedout: number; revive: number; points: number; score: number; kills: number;
  tele: number; current: number; weapons: { id: string; mag: number; reserve: number }[];
  aimPitch: number; fireT: number; reloadP: number; meleeP: number; switchP: number; hitT: number; hitDirX: number; hitDirZ: number;
  deadT: number; deathVariant: number; speed: number; localX: number; localZ: number; bloom: number;
  grenades: number; throwP: number;
}
export interface ZombSnap {
  id: number; x: number; y: number; z: number; yaw: number; type: number; state: number; alive: boolean; airborne: boolean;
  speed: number; localX: number; localZ: number; attackP: number; hitT: number; hitDirX: number; hitDirZ: number;
  deadT: number; deathVariant: number; variant: number; scale: number;
}
export interface GrenSnap { id: number; x: number; y: number; z: number; vx: number; vz: number; rolling: boolean }
export interface Snapshot {
  seq: number; time: number; tod: number; wave: number; state: number; stateT: number; toSpawn: number; totalKills: number;
  surv: SurvSnap[]; zomb: ZombSnap[]; gates: { hp: number; broken: boolean; hitAgo: number }[];
  pickups: { id: number; kind: number; x: number; y: number; z: number }[];
  grenades: GrenSnap[];
  /** receive time (client clock, ms) */
  at: number;
}

// ------------------------------------------------------------------------------------------------ host: write
export function writeSnapshot(w: Writer, world: World, seq: number): ArrayBuffer {
  w.reset();
  w.u8(MSG_SNAPSHOT);
  w.u32(seq);
  w.f32(world.time);
  w.f32(world.timeOfDay);
  w.u16(world.wave);
  w.u8(DSTATES.indexOf(world.state));
  w.f32(world.stateT);
  w.u16(world.toSpawn);
  w.u32(world.totalKills);
  w.u8(world.survivors.length);
  for (const s of world.survivors) {
    const a = s.anim;
    w.u32(s.id);
    w.f32(s.pos.x); w.f32(s.pos.y); w.f32(s.pos.z);
    w.i16(wrapAngle(s.yaw) * 10000);
    w.u16(s.health * 10); w.u16(s.maxHealth * 10);
    const hold = world.brains.get(s.id)?.mode === 'hold';
    w.u16((s.alive ? 1 : 0) | (s.downed ? 2 : 0) | (a.aiming ? 4 : 0) | (a.reloading ? 8 : 0) | (a.airborne ? 16 : 0) | (a.reviving ? 32 : 0) | (a.wave ? 64 : 0) | (hold ? 128 : 0));
    w.u16(Math.max(0, s.bleedout) * 10);
    w.frac(s.reviveProgress);
    w.i32(world.points.get(s.id) ?? 0);
    w.i32(world.score.get(s.id) ?? 0);
    w.u16(s.kills);
    w.u8(s.teleportSeq & 255);
    w.u8(s.current);
    w.u8(s.weapons.length);
    for (const wp of s.weapons) { w.u8(weaponIndex(wp.id)); w.u16(wp.mag); w.u16(wp.reserve); }
    w.i8(a.aimPitch * 100);
    w.secs(a.fireT);
    w.frac(a.reloadP);
    w.frac(a.meleeP);
    w.frac(a.switchP);
    w.secs(a.hitT);
    w.i8(a.hitDirX * 127); w.i8(a.hitDirZ * 127);
    w.u8(Math.min(255, a.deadT * 10));
    w.u8(a.deathVariant);
    w.u8(Math.min(255, a.speed * 20));
    w.i8(a.localX * 127); w.i8(a.localZ * 127);
    w.u8(Math.min(255, s.bloom * 50));
    w.u8(s.grenades);
    w.frac(a.throwP);
  }
  w.u16(world.zombies.length);
  for (const z of world.zombies) {
    const a = z.anim;
    w.u32(z.id);
    w.i16(z.pos.x * 64); w.i16(z.pos.y * 256); w.i16(z.pos.z * 64);
    w.i16(wrapAngle(z.yaw) * 10000);
    w.u8(ZTYPES.indexOf(z.type) | (ZSTATES.indexOf(z.state) << 2) | (z.alive ? 32 : 0) | (a.airborne ? 64 : 0));
    w.u8(Math.min(255, a.speed * 20));
    w.i8(a.localX * 127); w.i8(a.localZ * 127);
    w.frac(a.attackP);
    w.secs(a.hitT);
    w.i8(a.hitDirX * 127); w.i8(a.hitDirZ * 127);
    w.u8(Math.min(255, a.deadT * 10));
    w.u8(a.deathVariant);
    w.u8(z.variant & 255);
    w.u8(Math.min(255, z.scale * 100));
  }
  w.u8(world.gates.length);
  for (const g of world.gates) { w.u16(g.hp); w.u8(g.broken ? 1 : 0); w.u8(Math.min(255, (world.time - g.lastHitT) * 10)); }
  w.u16(world.pickups.length);
  for (const p of world.pickups) { w.u32(p.id); w.u8(p.kind === 'ammo' ? 0 : 1); w.i16(p.pos.x * 64); w.i16(p.pos.y * 256); w.i16(p.pos.z * 64); }
  w.u8(Math.min(255, world.grenades.length));
  for (const g of world.grenades.slice(0, 255)) { w.u32(g.id); w.i16(g.x * 64); w.i16(g.y * 256); w.i16(g.z * 64); w.i16(g.vx * 100); w.i16(g.vz * 100); w.u8(g.rolling ? 1 : 0); }
  return w.bytes();
}

// ------------------------------------------------------------------------------------------------ client: read
export function readSnapshot(r: Reader, at: number): Snapshot {
  const seq = r.u32(), time = r.f32(), tod = r.f32(), wave = r.u16(), state = r.u8(), stateT = r.f32(), toSpawn = r.u16(), totalKills = r.u32();
  const surv: SurvSnap[] = [];
  for (let i = 0, n = r.u8(); i < n; i++) {
    const id = r.u32(), x = r.f32(), y = r.f32(), z = r.f32(), yaw = r.i16() / 10000;
    const health = r.u16() / 10, maxHealth = r.u16() / 10, fl = r.u16();
    const bleedout = r.u16() / 10, revive = Math.max(0, r.frac()), points = r.i32(), score = r.i32(), kills = r.u16(), tele = r.u8(), current = r.u8();
    const weapons: SurvSnap['weapons'] = [];
    for (let k = 0, nw = r.u8(); k < nw; k++) { const wi = r.u8(), mag = r.u16(), reserve = r.u16(); weapons.push({ id: weaponAt(wi) ?? 'pistol', mag, reserve }); }
    const aimPitch = r.i8() / 100, fireT = r.secs(), reloadP = Math.max(0, r.frac()), meleeP = r.frac(), switchP = r.frac(), hitT = r.secs();
    const hitDirX = r.i8() / 127, hitDirZ = r.i8() / 127, deadT = r.u8() / 10, deathVariant = r.u8(), speed = r.u8() / 20;
    const localX = r.i8() / 127, localZ = r.i8() / 127, bloom = r.u8() / 50, grenades = r.u8(), throwP = r.frac();
    surv.push({
      id, x, y, z, yaw, health, maxHealth, alive: !!(fl & 1), downed: !!(fl & 2), aiming: !!(fl & 4), reloading: !!(fl & 8), airborne: !!(fl & 16),
      reviving: !!(fl & 32), waving: !!(fl & 64), hold: !!(fl & 128), bleedout, revive, points, score, kills, tele, current, weapons,
      aimPitch, fireT, reloadP, meleeP, switchP, hitT, hitDirX, hitDirZ, deadT, deathVariant, speed, localX, localZ, bloom, grenades, throwP,
    });
  }
  const zomb: ZombSnap[] = [];
  for (let i = 0, n = r.u16(); i < n; i++) {
    const id = r.u32(), x = r.i16() / 64, y = r.i16() / 256, z = r.i16() / 64, yaw = r.i16() / 10000, fl = r.u8();
    const speed = r.u8() / 20, localX = r.i8() / 127, localZ = r.i8() / 127, attackP = r.frac(), hitT = r.secs();
    const hitDirX = r.i8() / 127, hitDirZ = r.i8() / 127, deadT = r.u8() / 10, deathVariant = r.u8(), variant = r.u8(), scale = r.u8() / 100;
    zomb.push({ id, x, y, z, yaw, type: fl & 3, state: (fl >> 2) & 7, alive: !!(fl & 32), airborne: !!(fl & 64), speed, localX, localZ, attackP, hitT, hitDirX, hitDirZ, deadT, deathVariant, variant, scale });
  }
  const gates: Snapshot['gates'] = [];
  for (let i = 0, n = r.u8(); i < n; i++) gates.push({ hp: r.u16(), broken: r.u8() === 1, hitAgo: r.u8() / 10 });
  const pickups: Snapshot['pickups'] = [];
  for (let i = 0, n = r.u16(); i < n; i++) pickups.push({ id: r.u32(), kind: r.u8(), x: r.i16() / 64, y: r.i16() / 256, z: r.i16() / 64 });
  const grenades: GrenSnap[] = [];
  for (let i = 0, n = r.u8(); i < n; i++) grenades.push({ id: r.u32(), x: r.i16() / 64, y: r.i16() / 256, z: r.i16() / 64, vx: r.i16() / 100, vz: r.i16() / 100, rolling: r.u8() === 1 });
  return { seq, time, tod, wave, state, stateT, toSpawn, totalKills, surv, zomb, gates, pickups, grenades, at };
}

// ------------------------------------------------------------------------------------------------ client: apply
const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

type SurvPair = { s: Survivor; sn: SurvSnap; pa: SurvSnap | undefined };
type ZombPair = { z: Zombie; zn: ZombSnap; pa: ZombSnap | undefined };
type GrenPair = { g: Grenade; gn: GrenSnap; pa: GrenSnap | undefined };

/**
 * What applySnapshot keeps between frames: the bracketing pair it last synced, the actors matched to it, and the
 * mirror's zombies by id. Membership and state change only when a new pair comes up (20 Hz); every frame only
 * re-interpolates positions, without allocating.
 */
export class ApplyCache {
  a: Snapshot | null = null;
  b: Snapshot | null = null;
  surv: SurvPair[] = [];
  zomb: ZombPair[] = [];
  gren: GrenPair[] = [];
  zmap = new Map<number, Zombie>();
}

const survIndex = new WeakMap<Snapshot, Map<number, SurvSnap>>();
const zombIndex = new WeakMap<Snapshot, Map<number, ZombSnap>>();
function survById(s: Snapshot): Map<number, SurvSnap> {
  let m = survIndex.get(s);
  if (!m) survIndex.set(s, (m = new Map(s.surv.map((q) => [q.id, q]))));
  return m;
}
function zombById(s: Snapshot): Map<number, ZombSnap> {
  let m = zombIndex.get(s);
  if (!m) zombIndex.set(s, (m = new Map(s.zomb.map((q) => [q.id, q]))));
  return m;
}

/**
 * Write the state at render time into the client's mirror World: `a` and `b` are the snapshots around it and `t`
 * the fraction between them (b alone when there is no a). Positions are interpolated and written to both pos and
 * prev, so the renderer's own tick alpha has no effect on remote actors. The local player keeps its own pose and
 * locomotion (it moves on this machine) unless the host moved it (teleport counter changed).
 */
export function applySnapshot(world: World, a: Snapshot | null, b: Snapshot, t: number, localTele: { seq: number }, cache: ApplyCache): void {
  if (cache.a !== a || cache.b !== b) syncPair(world, a, b, localTele, cache);
  for (const { s, sn, pa } of cache.surv) {
    if (pa) {
      s.pos.set(pa.x + (sn.x - pa.x) * t, pa.y + (sn.y - pa.y) * t, pa.z + (sn.z - pa.z) * t);
      s.yaw = lerpAngle(pa.yaw, sn.yaw, t);
    } else { s.pos.set(sn.x, sn.y, sn.z); s.yaw = sn.yaw; }
    s.prev.copy(s.pos);
    s.prevYaw = s.yaw;
  }
  for (const { z, zn, pa } of cache.zomb) {
    if (pa) {
      z.pos.set(pa.x + (zn.x - pa.x) * t, pa.y + (zn.y - pa.y) * t, pa.z + (zn.z - pa.z) * t);
      z.yaw = lerpAngle(pa.yaw, zn.yaw, t);
    } else { z.pos.set(zn.x, zn.y, zn.z); z.yaw = zn.yaw; }
    z.prev.copy(z.pos);
    z.prevYaw = z.yaw;
  }
  // grenades: this frame's position in both x and px, so the view's own tick alpha changes nothing
  for (const { g, gn, pa } of cache.gren) {
    if (pa) { g.x = pa.x + (gn.x - pa.x) * t; g.y = pa.y + (gn.y - pa.y) * t; g.z = pa.z + (gn.z - pa.z) * t; }
    else { g.x = gn.x; g.y = gn.y; g.z = gn.z; }
    g.px = g.x; g.py = g.y; g.pz = g.z;
  }
}

/** A new bracketing pair: take b's globals, survivor states, zombie roster, gates and pickups. */
function syncPair(world: World, a: Snapshot | null, b: Snapshot, localTele: { seq: number }, cache: ApplyCache): void {
  cache.a = a;
  cache.b = b;
  world.time = b.time;
  world.timeOfDay = b.tod;
  world.wave = b.wave;
  world.state = DSTATES[b.state] ?? 'prep';
  world.stateT = b.stateT;
  world.toSpawn = b.toSpawn;
  world.totalKills = b.totalKills;
  const prevS = a ? survById(a) : null;
  cache.surv.length = 0;
  for (const sn of b.surv) {
    const s = world.survivors.find((q) => q.id === sn.id);
    if (!s) continue;
    const local = s.id === world.localPlayerId;
    if (!local) cache.surv.push({ s, sn, pa: prevS?.get(sn.id) });
    else if (sn.tele !== localTele.seq) {
      // the host placed us (spawn, respawn): snap
      localTele.seq = sn.tele;
      s.pos.set(sn.x, sn.y, sn.z);
      s.prev.copy(s.pos);
      s.vel.set(0, 0, 0);
      s.vy = 0;
      s.mantle = null;
      s.yaw = s.prevYaw = sn.yaw;
    }
    applySurvivorState(world, s, sn, local);
  }
  // zombies: create, update, drop
  const prevZ = a ? zombById(a) : null;
  const zmap = cache.zmap;
  cache.zomb.length = 0;
  const next: Zombie[] = [];
  for (const zn of b.zomb) {
    let z = zmap.get(zn.id);
    if (!z) {
      z = new Zombie();
      z.id = zn.id;
      z.type = ZTYPES[zn.type] ?? 'walker';
      z.variant = zn.variant;
      z.scale = zn.scale;
      zmap.set(zn.id, z);
    }
    cache.zomb.push({ z, zn, pa: prevZ?.get(zn.id) });
    z.state = ZSTATES[zn.state] ?? 'chase';
    z.alive = zn.alive;
    z.grounded = !zn.airborne;
    const an = z.anim;
    an.speed = zn.speed; an.localX = zn.localX; an.localZ = zn.localZ; an.attackP = zn.attackP; an.hitT = zn.hitT;
    an.hitDirX = zn.hitDirX; an.hitDirZ = zn.hitDirZ; an.dead = !zn.alive; an.deadT = zn.deadT; an.deathVariant = zn.deathVariant;
    an.airborne = zn.airborne;
    next.push(z);
  }
  if (zmap.size > next.length) { const keep = zombById(b); for (const id of zmap.keys()) if (!keep.has(id)) zmap.delete(id); }
  world.zombies = next;
  // gates (collision follows the host's broken flag so our own movement agrees)
  b.gates.forEach((gs, i) => {
    const g = world.gates[i];
    if (!g) return;
    if (gs.broken !== g.broken) world.clientGateChanged(g, gs.broken);
    g.hp = gs.hp;
    g.lastHitT = world.time - gs.hitAgo;
  });
  // pickups
  const pk = new Map(world.pickups.map((p) => [p.id, p]));
  world.pickups = b.pickups.map((p): Pickup => {
    const q = pk.get(p.id);
    if (q) { q.pos.set(p.x, p.y, p.z); return q; }
    return { id: p.id, kind: p.kind === 0 ? 'ammo' : 'health', pos: new THREE.Vector3(p.x, p.y, p.z), ttl: 30 };
  });
  // grenades in flight
  const gm = new Map(world.grenades.map((g) => [g.id, g]));
  const pg = a ? new Map(a.grenades.map((g) => [g.id, g])) : null;
  cache.gren.length = 0;
  world.grenades = b.grenades.map((gn): Grenade => {
    const g = gm.get(gn.id) ?? { id: gn.id, ownerId: 0, x: gn.x, y: gn.y, z: gn.z, px: gn.x, py: gn.y, pz: gn.z, vx: 0, vy: 0, vz: 0, fuse: 0, rolling: false };
    g.vx = gn.vx; g.vz = gn.vz; g.rolling = gn.rolling;
    cache.gren.push({ g, gn, pa: pg?.get(gn.id) });
    return g;
  });
}

function applySurvivorState(world: World, s: Survivor, sn: SurvSnap, local: boolean): void {
  s.health = sn.health;
  s.maxHealth = sn.maxHealth;
  if (!s.alive && sn.alive) s.snapshotPrev();
  s.alive = sn.alive;
  s.downed = sn.downed;
  s.bleedout = sn.bleedout;
  s.reviveProgress = sn.revive;
  s.kills = sn.kills;
  s.bloom = sn.bloom;
  s.grenades = sn.grenades;
  s.throwT = sn.throwP;
  world.points.set(s.id, sn.points);
  world.score.set(s.id, sn.score);
  // weapons: keep the slot objects stable when the loadout is unchanged
  if (s.weapons.length !== sn.weapons.length || s.weapons.some((w, i) => w.id !== sn.weapons[i].id)) {
    s.weapons = sn.weapons.map((w) => ({ id: w.id as Survivor['weapons'][number]['id'], mag: w.mag, reserve: w.reserve }));
  } else sn.weapons.forEach((w, i) => { s.weapons[i].mag = w.mag; s.weapons[i].reserve = w.reserve; });
  s.current = Math.min(sn.current, s.weapons.length - 1);
  s.sinceFire = sn.fireT;
  s.reloadT = sn.reloading ? sn.reloadP : -1;
  s.reloadDur = 1;
  s.meleeT = sn.meleeP;
  s.switchT = sn.switchP;
  const an = s.anim;
  an.fireT = sn.fireT; an.reloading = sn.reloading; an.reloadP = sn.reloadP; an.meleeP = sn.meleeP; an.switchP = sn.switchP;
  an.hitT = sn.hitT; an.hitDirX = sn.hitDirX; an.hitDirZ = sn.hitDirZ; an.dead = !sn.alive; an.deadT = sn.deadT;
  an.deathVariant = sn.deathVariant; an.downed = sn.downed; an.reviving = sn.reviving; an.wave = sn.waving; an.throwP = sn.throwP;
  an.weapon = s.weapons[s.current]?.id ?? null;
  if (!local) {
    // remote bodies animate from the host's hints; the local body computes its own (World.predictLocal)
    s.aiming = sn.aiming;
    an.aiming = sn.aiming; an.aimPitch = sn.aimPitch; an.airborne = sn.airborne; an.speed = sn.speed; an.localX = sn.localX; an.localZ = sn.localZ;
  }
  if (s.kind === 'npc') {
    const b = world.brains.get(s.id);
    if (b) b.mode = sn.hold ? 'hold' : 'follow';
    else world.brains.set(s.id, { mode: sn.hold ? 'hold' : 'follow' } as NpcBrain);
  }
}
