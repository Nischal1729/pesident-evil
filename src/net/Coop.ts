import { emptyInput, type PlayerInput } from '../core/Input';
import type { Survivor } from '../sim/actors';
import type { World } from '../sim/World';
import { Link, NetClient, NetHost } from './Net';
import {
  decodeEvent, encodeEvent, MAX_PLAYERS, MSG_INPUT, MSG_SNAPSHOT, newCounters, PROTOCOL, readInput, Reader, writeInput, Writer,
  type CtrlMsg, type InputCounters, type InputPacket, type Profile, type RosterEntry, type StartSurvivor,
} from './protocol';
import { applySnapshot, readSnapshot, writeSnapshot, type Snapshot } from './snapshot';

/** Snapshot every SNAP_EVERY host ticks (60 Hz / 3 = 20 Hz); clients draw INTERP seconds behind the newest one. */
const SNAP_EVERY = 3;
const INTERP = 0.1;

export interface Member {
  link: Link;
  peer: string;
  profile: Profile;
  survivorId: number;
  last: InputPacket | null;
  primed: boolean;
  seen: InputCounters;
  scroll: number;
  fall: number;
  pin: PlayerInput;
  rtt: number;
}

export interface HostHooks {
  onReady(code: string): void;
  onRoster(): void;
  onError(msg: string): void;
  /** a client finished its handshake while a game runs: add their survivor and return it (or null to refuse) */
  onJoinInGame(m: Member): StartSurvivor | null;
  onLeaveInGame(m: Member): void;
}

/** Co-op host: owns the room, runs the real World, feeds remote inputs into it and streams it back out. */
export class CoopHost {
  readonly role = 'host';
  net = new NetHost();
  members = new Map<string, Member>();
  world: World | null = null;
  inGame = false;
  code = '';
  private pending: [string, Record<string, unknown>][] = [];
  private w = new Writer();
  private tick = 0;
  private seq = 0;
  private pingT = 0;
  private start: Omit<Extract<CtrlMsg, { t: 'start' }>, 'yourId'> | null = null;

  constructor(public profile: Profile, private hooks: HostHooks) {
    this.net.onReady = (code) => { this.code = code; hooks.onReady(code); };
    this.net.onError = (msg) => hooks.onError(msg);
    this.net.onLink = (link) => this.accept(link);
    this.net.start();
  }

  private accept(link: Link): void {
    let m: Member | null = null;
    link.onCtrl = (msg) => {
      if (msg.t === 'hello' && !m) {
        if (msg.v !== PROTOCOL) { link.send({ t: 'reject', reason: 'Different game version — both players need to reload the page.' }); setTimeout(() => link.close(), 500); return; }
        if (this.members.size + 1 >= MAX_PLAYERS) { link.send({ t: 'reject', reason: `The room is full (${MAX_PLAYERS} players).` }); setTimeout(() => link.close(), 500); return; }
        m = { link, peer: link.conn.peer, profile: sanitize(msg.profile), survivorId: 0, last: null, primed: false, seen: newCounters(), scroll: 0, fall: 0, pin: emptyInput(), rtt: 0 };
        this.members.set(m.peer, m);
        this.broadcastRoster();
        if (this.inGame && this.start) {
          const ss = this.hooks.onJoinInGame(m);
          if (ss) {
            m.survivorId = ss.id;
            this.start.survivors.push(ss);
            link.send({ ...this.start, yourId: ss.id });
            for (const o of this.members.values()) if (o !== m) o.link.send({ t: 'join', survivor: ss });
          }
        }
      } else if (msg.t === 'pong' && m) m.rtt = Math.round(performance.now() - msg.c);
      else if (msg.t === 'ping') link.send({ t: 'pong', c: msg.c });
    };
    link.onBinary = (buf) => {
      if (!m || !buf.byteLength) return;
      const r = new Reader(buf);
      if (r.u8() !== MSG_INPUT) return;
      const p = readInput(r);
      if (m.last && ((p.seq - m.last.seq) | 0) <= 0) return; // late / duplicate (unordered channel)
      m.last = p;
    };
    link.onClose = () => {
      if (!m) return;
      this.members.delete(m.peer);
      this.broadcastRoster();
      if (this.inGame && m.survivorId) {
        this.hooks.onLeaveInGame(m);
        if (this.start) this.start.survivors = this.start.survivors.filter((s) => s.id !== m!.survivorId);
        for (const o of this.members.values()) o.link.send({ t: 'leave', id: m.survivorId });
      }
    };
  }

  roster(): RosterEntry[] {
    return [{ peer: 'host', name: this.profile.name, look: this.profile.look, host: true }, ...[...this.members.values()].map((m) => ({ peer: m.peer, name: m.profile.name, look: m.profile.look, host: false }))];
  }

  private broadcastRoster(): void {
    const msg: CtrlMsg = { t: 'roster', players: this.roster(), inGame: this.inGame };
    for (const m of this.members.values()) m.link.send(msg);
    this.hooks.onRoster();
  }

  /** The game begins: `survivors` lists everyone (humans + squad); each member already has its survivorId. */
  beginGame(world: World, survivors: StartSurvivor[], difficulty: number, maxZombies: number): void {
    this.world = world;
    this.inGame = true;
    this.pending = [];
    this.start = { t: 'start', difficulty, maxZombies, survivors };
    world.events.tap = (type, payload) => { if (this.members.size) this.pending.push(encodeEvent(type as string, payload as object)); };
    for (const m of this.members.values()) {
      m.last = null;
      m.primed = false;
      if (m.survivorId) m.link.send({ ...this.start, yourId: m.survivorId });
    }
    this.broadcastRoster();
  }

  endGame(): void {
    if (this.world) this.world.events.tap = null;
    this.world = null;
    this.inGame = false;
    this.start = null;
    for (const m of this.members.values()) m.survivorId = 0;
    this.broadcastRoster();
  }

  /** Remote players' inputs for this host tick. One-shot actions come from counter deltas, so each fires once. */
  fillInputs(inputs: Map<number, PlayerInput>): void {
    for (const m of this.members.values()) {
      const p = m.last;
      if (!m.survivorId || !p) continue;
      if (!m.primed) { m.primed = true; m.seen = { ...p.c }; m.scroll = p.scrollSum; m.fall = p.fallTotal; }
      const d = (k: keyof InputCounters) => (p.c[k] - m.seen[k]) & 255;
      const pin = m.pin;
      pin.remote = true;
      pin.camAlpha = 0;
      pin.px = p.px; pin.py = p.py; pin.pz = p.pz; pin.vx = p.vx; pin.vy = p.vy; pin.vz = p.vz; pin.pyaw = p.pyaw;
      pin.poseTele = p.tele;
      pin.yaw = p.yaw; pin.pitch = p.pitch; pin.camX = p.camX; pin.camY = p.camY; pin.camZ = p.camZ;
      pin.moveX = p.moveX; pin.moveZ = p.moveZ;
      pin.fire = p.fire || d('fire') > 0;
      pin.aim = p.aim; pin.sprint = p.sprint; pin.interact = p.interact;
      pin.pGrounded = p.grounded; pin.pClimb = p.climb;
      pin.reload = d('reload') > 0;
      pin.interactPressed = d('interact') > 0;
      pin.melee = d('melee') > 0;
      pin.command = d('command') > 0;
      pin.weaponSlot = d('slot') > 0 ? p.slot : -1;
      const sc = ((p.scrollSum - m.scroll + 128) & 255) - 128;
      pin.weaponScroll = sc > 0 ? 1 : sc < 0 ? -1 : 0;
      pin.jump = false;
      pin.jumped = d('jump') > 0;
      pin.landed = d('land') > 0;
      pin.fallDmg = (p.fallTotal - m.fall) & 65535;
      m.seen = { ...p.c };
      m.scroll = p.scrollSum;
      m.fall = p.fallTotal;
      inputs.set(m.survivorId, pin);
    }
  }

  /** After each host tick: snapshots at 20 Hz, events with them, pings every 2 s. */
  afterTick(world: World): void {
    if (++this.tick % SNAP_EVERY !== 0 || !this.members.size) return;
    const snap = writeSnapshot(this.w, world, ++this.seq);
    const ev: CtrlMsg | null = this.pending.length ? { t: 'ev', e: this.pending } : null;
    this.pending = [];
    for (const m of this.members.values()) {
      if (!m.survivorId) continue;
      m.link.sendFast(snap);
      if (ev) m.link.send(ev);
    }
    const now = performance.now();
    if (now - this.pingT > 2000) {
      this.pingT = now;
      const ms: Record<number, number> = {};
      for (const m of this.members.values()) { m.link.send({ t: 'ping', c: now }); if (m.survivorId) ms[m.survivorId] = m.rtt; }
      for (const m of this.members.values()) m.link.send({ t: 'rtt', ms });
    }
  }

  rttOf(survivorId: number): number | undefined {
    for (const m of this.members.values()) if (m.survivorId === survivorId) return m.rtt;
    return undefined;
  }

  destroy(): void {
    for (const m of this.members.values()) m.link.send({ t: 'end', reason: 'The host closed the room.' });
    const net = this.net;
    setTimeout(() => net.destroy(), 300);
    if (this.world) this.world.events.tap = null;
  }
}

export interface ClientHooks {
  onRoster(players: RosterEntry[], inGame: boolean): void;
  onStart(msg: Extract<CtrlMsg, { t: 'start' }>): void;
  onJoin(ss: StartSurvivor): void;
  onLeave(id: number): void;
  onEnd(reason: string): void;
}

/** Co-op client: mirrors the host's World, moves its own player locally and streams its inputs to the host. */
export class CoopClient {
  readonly role = 'client';
  net = new NetClient();
  link: Link | null = null;
  world: World | null = null;
  roster: RosterEntry[] = [];
  rtt = new Map<number, number>();
  private snaps: Snapshot[] = [];
  private renderT = -1;
  private w = new Writer();
  private seq = 0;
  private tickN = 0;
  private c = newCounters();
  private scrollSum = 0;
  private fallTotal = 0;
  private slot = -1;
  private prevFire = false;
  private tele = { seq: -1 };
  private lastSnapAt = 0;
  private ended = false;

  constructor(code: string, private profile: Profile, private hooks: ClientHooks, onConnectError: (msg: string) => void) {
    this.net.onError = (msg) => { if (!this.link) onConnectError(msg); };
    this.net.onLink = (link) => {
      this.link = link;
      link.onCtrl = (m) => this.onCtrl(m);
      link.onBinary = (b) => this.onBinary(b);
      link.onClose = () => this.end('Lost connection to the host.');
      link.send({ t: 'hello', v: PROTOCOL, profile: this.profile });
    };
    this.net.connect(code);
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.hooks.onEnd(reason);
  }

  private onCtrl(m: CtrlMsg): void {
    switch (m.t) {
      case 'roster': this.roster = m.players; this.hooks.onRoster(m.players, m.inGame); break;
      case 'reject': this.end(m.reason); break;
      case 'start': this.hooks.onStart(m); break;
      case 'join': this.hooks.onJoin(m.survivor); break;
      case 'leave': this.hooks.onLeave(m.id); break;
      case 'ping': this.link?.send({ t: 'pong', c: m.c }); break;
      case 'rtt': this.rtt = new Map(Object.entries(m.ms).map(([k, v]) => [Number(k), v])); break;
      case 'end': this.end(m.reason); break;
      case 'ev': {
        const w = this.world;
        if (!w) break;
        for (const e of m.e) {
          const [type, payload] = decodeEvent(e);
          // our own jumps and landings already played here (World.movePlayer)
          if ((type === 'jump' || type === 'land') && (payload as { actorId: number }).actorId === w.localPlayerId) continue;
          w.events.emit(type, payload as never);
        }
        break;
      }
    }
  }

  private onBinary(b: ArrayBuffer): void {
    if (!this.world || !b.byteLength) return;
    const r = new Reader(b);
    if (r.u8() !== MSG_SNAPSHOT) return;
    const s = readSnapshot(r, performance.now());
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.seq <= last.seq) return; // late (unordered channel)
    this.snaps.push(s);
    if (this.snaps.length > 12) this.snaps.shift();
    this.lastSnapAt = s.at;
  }

  beginGame(world: World): void {
    this.world = world;
    this.snaps = [];
    this.renderT = -1;
    this.tele.seq = -1;
    this.lastSnapAt = performance.now();
  }

  endGame(): void { this.world = null; this.snaps = []; }

  /** The first snapshot has placed our player (until then the mirror doesn't know where anyone is). */
  get ready(): boolean { return this.tele.seq >= 0; }

  /** After the local prediction tick: count one-shot presses, send the pose + input at 30 Hz. */
  sendInput(pin: PlayerInput, p: Survivor, climbing: boolean): void {
    const c = this.c;
    if (pin.fire && !this.prevFire) c.fire++;
    this.prevFire = pin.fire;
    if (pin.reload) c.reload++;
    if (pin.interactPressed) c.interact++;
    if (pin.melee) c.melee++;
    if (pin.command) c.command++;
    if (pin.weaponSlot >= 0) { c.slot++; this.slot = pin.weaponSlot; }
    if (pin.weaponScroll) this.scrollSum += pin.weaponScroll;
    if (p.netJumped) { c.jump++; p.netJumped = false; }
    if (p.netLanded) { c.land++; p.netLanded = false; }
    if (p.pendingFall) { this.fallTotal += p.pendingFall; p.pendingFall = 0; }
    if (++this.tickN % 2 !== 0 || !this.link) return;
    const cam = Number.isFinite(pin.camX);
    this.link.sendFast(writeInput(this.w, {
      seq: ++this.seq, px: p.pos.x, py: p.pos.y, pz: p.pos.z, vx: p.vel.x, vy: p.vy, vz: p.vel.z, pyaw: p.yaw,
      yaw: pin.yaw, pitch: pin.pitch, camX: cam ? pin.camX : p.pos.x, camY: cam ? pin.camY : p.pos.y + 1.6, camZ: cam ? pin.camZ : p.pos.z,
      moveX: pin.moveX, moveZ: pin.moveZ, fire: pin.fire, aim: pin.aim, sprint: pin.sprint, interact: pin.interact,
      grounded: p.grounded, climb: climbing, c, slot: this.slot, scrollSum: this.scrollSum, fallTotal: this.fallTotal,
      tele: Math.max(0, this.tele.seq),
    }));
  }

  /** Before drawing: write the host's state at (newest snapshot − INTERP) into the mirror World. */
  interpolate(dt: number): void {
    const w = this.world;
    if (!w) return;
    if (performance.now() - this.lastSnapAt > 8000) { this.end('The host stopped responding.'); return; }
    const n = this.snaps.length;
    if (!n) return;
    const latest = this.snaps[n - 1];
    const target = latest.time - INTERP;
    if (this.renderT < 0 || Math.abs(this.renderT - target) > 0.35) this.renderT = target;
    else this.renderT += dt + (target - this.renderT) * Math.min(1, dt * 2);
    let a: Snapshot | null = null;
    let b = latest;
    for (let i = 0; i < n; i++) {
      if (this.snaps[i].time >= this.renderT) { b = this.snaps[i]; a = i > 0 ? this.snaps[i - 1] : null; break; }
    }
    if (b === latest && latest.time < this.renderT) a = n > 1 ? this.snaps[n - 2] : null;
    const t = a ? Math.min(1, Math.max(0, (this.renderT - a.time) / Math.max(1e-4, b.time - a.time))) : 1;
    applySnapshot(w, a, b, t, this.tele);
  }

  destroy(): void { this.ended = true; this.net.destroy(); }
}

const COLOR = /^#[0-9a-f]{6}$/i;
/** Clamp what a peer tells us about itself. */
function sanitize(p: Profile): Profile {
  const L = p?.look ?? ({} as Profile['look']);
  const c = (v: unknown, d: string) => (typeof v === 'string' && COLOR.test(v) ? v : d);
  return {
    name: String(p?.name ?? 'Student').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Student',
    look: {
      body: L.body === 'female' ? 'female' : 'male', skin: c(L.skin, '#a36a45'), hair: c(L.hair, '#161210'), shirt: c(L.shirt, '#7a1f2b'),
      pants: c(L.pants, '#243044'), shoes: c(L.shoes, '#f2f2f2'), accessory: c(L.accessory, '#2d59a8'), seed: Number(L.seed) | 0,
    },
  };
}
export { sanitize as sanitizeProfile };
