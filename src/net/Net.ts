import Peer, { type DataConnection } from 'peerjs';
import { wakeInterval } from '../core/wakeTimer';
import { iceConfig, routeOf } from './ice';
import type { CtrlMsg } from './protocol';

/**
 * Peer-to-peer transport (PeerJS). The public PeerJS broker (0.peerjs.com) only introduces the browsers; game traffic
 * then flows directly between them over WebRTC (or through PeerJS's TURN relay when a network blocks direct links).
 * The host registers the peer id PREFIX + room code; clients connect to it.
 */
const PREFIX = 'pesident-evil-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function newRoomCode(): string {
  let c = '';
  const r = new Uint32Array(5);
  crypto.getRandomValues(r);
  for (const v of r) c += CODE_CHARS[v % CODE_CHARS.length];
  return c;
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

/** A connection to one peer: the reliable PeerJS channel (JSON control + events) and an unreliable binary channel. */
export class Link {
  fast: RTCDataChannel | null = null;
  onCtrl: (m: CtrlMsg) => void = () => {};
  onBinary: (b: ArrayBuffer) => void = () => {};
  onClose: () => void = () => {};
  closed = false;
  bytesOut = 0;

  constructor(public conn: DataConnection) {
    conn.on('data', (d: unknown) => {
      if (typeof d === 'string') {
        let m: CtrlMsg;
        try { m = JSON.parse(d) as CtrlMsg; } catch { return; }
        this.onCtrl(m);
      } else if (d instanceof ArrayBuffer) this.onBinary(d);
      else if (ArrayBuffer.isView(d)) this.onBinary(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
    });
    conn.on('close', () => this.close());
    conn.on('error', () => this.close());
  }

  /** 'direct' or 'relay' (TURN) once open. */
  route(): Promise<'direct' | 'relay' | 'unknown'> { return routeOf(this.conn.peerConnection); }

  /** Both ends create the same pre-negotiated channel on the connection's RTCPeerConnection (no extra signalling). */
  openFast(): void {
    const pc = this.conn.peerConnection;
    if (!pc) return;
    try {
      const ch = pc.createDataChannel('pe-fast', { negotiated: true, id: 100, ordered: false, maxRetransmits: 0 });
      ch.binaryType = 'arraybuffer';
      ch.onmessage = (e) => { if (e.data instanceof ArrayBuffer) this.onBinary(e.data); };
      this.fast = ch;
    } catch (e) {
      console.warn('[net] unreliable channel unavailable, using the reliable one', e);
    }
  }

  send(m: CtrlMsg): void { this.sendText(JSON.stringify(m)); }

  /** Binary over the reliable channel (compressed event batches, which must arrive, in order). */
  sendBinary(b: ArrayBuffer): void {
    if (this.closed || !this.conn.open) return;
    this.bytesOut += b.byteLength;
    this.conn.send(b);
  }

  /** An already-serialised control message (one encoding shared by every client). */
  sendText(s: string): void {
    if (this.closed || !this.conn.open) return;
    this.bytesOut += s.length;
    this.conn.send(s);
  }

  /** Snapshots / inputs: dropped rather than queued when the link is congested (the next one supersedes them). */
  sendFast(b: ArrayBuffer): void {
    if (this.closed) return;
    this.bytesOut += b.byteLength;
    const f = this.fast;
    if (f && f.readyState === 'open') { if (f.bufferedAmount < 256 * 1024) f.send(b); }
    else if (this.conn.open && (this.conn.dataChannel?.bufferedAmount ?? 0) < 256 * 1024) this.conn.send(b);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.fast?.close(); } catch { /* already closed */ }
    try { this.conn.close(); } catch { /* already closed */ }
    this.onClose();
  }
}

const describe = (e: { type?: string; message?: string }) =>
  e.type === 'peer-unavailable' ? 'Room not found — check the code.'
    : e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' ? 'Could not reach the matchmaking server.'
      : e.type === 'browser-incompatible' ? 'This browser does not support WebRTC.'
        : e.message ?? String(e.type ?? e);

/** Shown when two browsers found each other but no network path opened between them. */
export function blockedMessage(relay: boolean): string {
  return relay
    ? "Couldn't connect to the host, even through the relay server. Try again, or try another network (a phone hotspot)."
    : "Couldn't open a connection to the host: your networks don't allow a direct browser-to-browser link right now (common on mobile data, Jio / Airtel fibre and campus Wi-Fi) and no relay server is set up. Try joining again, both on the same Wi-Fi, or one of you on a phone hotspot.";
}

/**
 * Hosting: registers the room code and accepts connections. The registration must outlive a host who leaves the tab
 * in the background while friends get the code: PeerJS's own 5 s broker heartbeat runs on page timers, which a
 * hidden tab throttles to about once a minute, and the broker then forgets the room. So a worker-driven tick sends
 * our own heartbeat every 4 s and re-registers the same code whenever the broker link drops. Once the room is open,
 * broker trouble is never fatal: players already connected talk to us directly and stay.
 */
export class NetHost {
  peer: Peer | null = null;
  code = '';
  /** '' when the room is registered, else what's happening (shown in the lobby) */
  status = '';
  onReady: (code: string) => void = () => {};
  onLink: (link: Link) => void = () => {};
  onError: (msg: string) => void = () => {};
  onStatus: (status: string) => void = () => {};
  /** a player's connection reached us but no network path opened (see blockedMessage) */
  onJoinFailed: () => void = () => {};
  private tries = 0;
  private opened = false;
  private stopped = false;
  private stopTick: (() => void) | null = null;

  start(): void {
    void this.register(newRoomCode());
    this.stopTick ??= wakeInterval(4000, () => this.keepAlive());
  }

  private setStatus(s: string): void {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }

  private async register(code: string): Promise<void> {
    this.code = code;
    const ice = await iceConfig();
    if (this.stopped) return;
    const peer = new Peer(PREFIX + code, { debug: 1, config: { iceServers: ice.servers } });
    this.peer = peer;
    peer.on('open', () => {
      this.setStatus('');
      if (!this.opened) { this.opened = true; this.onReady(this.code); }
    });
    peer.on('connection', (conn) => {
      let opened = false;
      conn.on('open', () => {
        opened = true;
        const link = new Link(conn);
        link.openFast();
        this.onLink(link);
      });
      conn.on('error', (e: { type?: string }) => { if (!opened && e.type === 'negotiation-failed') this.onJoinFailed(); });
    });
    peer.on('error', (e: { type?: string; message?: string }) => {
      if (e.type === 'peer-unavailable') return; // a client that vanished mid-handshake
      if (!this.opened) {
        // a brand-new room whose random code is taken: try another code
        if (e.type === 'unavailable-id' && this.tries++ < 4) { peer.destroy(); void this.register(newRoomCode()); return; }
        this.onError(describe(e));
        return;
      }
      // an open room keeps its code (friends already have it); keepAlive retries. 'unavailable-id' here means the
      // broker still holds our dropped session and frees it within about a minute.
      this.setStatus('Reconnecting to the matchmaking server… (players already in stay connected)');
    });
  }

  /** Every 4 s, unthrottled: our own heartbeat on the broker socket, or a re-registration of the same code. */
  private keepAlive(): void {
    if (this.stopped || !this.opened) return;
    const p = this.peer;
    if (!p || p.destroyed) { void this.register(this.code); return; }
    if (p.disconnected) {
      this.setStatus('Reconnecting to the matchmaking server… (players already in stay connected)');
      try { p.reconnect(); } catch { /* a reconnect is already under way */ }
      return;
    }
    (p.socket as unknown as { send(m: object): void }).send({ type: 'HEARTBEAT' });
  }

  destroy(): void {
    this.stopped = true;
    this.stopTick?.();
    this.stopTick = null;
    this.peer?.destroy();
    this.peer = null;
  }
}

/**
 * Joining: connects to a room code. A room that doesn't answer our offer is retried a few times: its host may be
 * re-registering with the broker right then (see NetHost). When the host answers but the connectivity checks fail
 * (no network path: NAT / firewall), the attempt is retried too, since direct paths between some networks only open
 * some of the time; a relay server (ice.ts) makes these reliable. The last failure's cause is reported with advice.
 */
export class NetClient {
  peer: Peer | null = null;
  link: Link | null = null;
  onLink: (link: Link) => void = () => {};
  onError: (msg: string) => void = () => {};
  onStatus: (status: string) => void = () => {};
  private destroyed = false;

  async connect(code: string, attempt = 1): Promise<void> {
    const ATTEMPTS = 3;
    const ice = await iceConfig();
    if (this.destroyed) return;
    const peer = new Peer({ debug: 1, config: { iceServers: ice.servers } });
    this.peer = peer;
    let done = false;
    let checking = false; // the host answered and connectivity checks began
    let lastMsg = 'Timed out connecting to the room.';
    const fail = (why: 'blocked' | 'retryable' | 'fatal') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.destroy();
      if (this.destroyed) return;
      if (why === 'blocked') lastMsg = blockedMessage(ice.relay);
      if (attempt < ATTEMPTS && why !== 'fatal') {
        this.onStatus(why === 'blocked'
          ? `No network path to the host on that try — trying again (${attempt + 1}/${ATTEMPTS})…`
          : `The room isn't answering yet — trying again (${attempt + 1}/${ATTEMPTS})…`);
        setTimeout(() => { if (!this.destroyed) void this.connect(code, attempt + 1); }, 2000);
      } else this.onError(lastMsg);
    };
    // a relayed path over TCP can take a while to come up; checks that started and never finished mean "no path"
    const timer = setTimeout(() => fail(checking ? 'blocked' : 'retryable'), 20000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + normalizeCode(code), { reliable: true, serialization: 'raw' });
      conn.on('iceStateChanged', (st: RTCIceConnectionState) => {
        if (st === 'checking' && !checking) { checking = true; this.onStatus(`Found the room — connecting${attempt > 1 ? ` (try ${attempt}/${ATTEMPTS})` : ''}…`); }
        if (st === 'failed') fail('blocked');
      });
      conn.on('error', (e: { type?: string }) => { if (e.type === 'negotiation-failed') fail('blocked'); });
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const link = new Link(conn);
        link.openFast();
        this.link = link;
        this.onLink(link);
      });
    });
    peer.on('error', (e: { type?: string; message?: string }) => {
      if (done) return;
      lastMsg = e.type === 'peer-unavailable' ? 'Room not found — check the code, or ask the host to open a new room.' : describe(e);
      // the room's id isn't registered (host re-registering?) or the broker link failed: worth another try
      fail(e.type === 'peer-unavailable' || e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'webrtc' ? 'retryable' : 'fatal');
    });
  }

  destroy(): void { this.destroyed = true; this.link?.close(); this.peer?.destroy(); this.peer = null; this.link = null; }
}
