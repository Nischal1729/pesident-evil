import Peer, { type DataConnection } from 'peerjs';
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

  send(m: CtrlMsg): void {
    if (this.closed || !this.conn.open) return;
    const s = JSON.stringify(m);
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

/** Hosting: registers the room code and accepts connections. */
export class NetHost {
  peer: Peer | null = null;
  code = '';
  onReady: (code: string) => void = () => {};
  onLink: (link: Link) => void = () => {};
  onError: (msg: string) => void = () => {};
  private tries = 0;

  start(): void {
    this.code = newRoomCode();
    const peer = new Peer(PREFIX + this.code, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => this.onReady(this.code));
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const link = new Link(conn);
        link.openFast();
        this.onLink(link);
      });
    });
    peer.on('error', (e: { type?: string; message?: string }) => {
      if (e.type === 'unavailable-id' && this.tries++ < 4) { peer.destroy(); this.start(); return; }
      if (e.type === 'peer-unavailable') return; // a client that vanished mid-handshake
      this.onError(describe(e));
    });
    // the broker link can drop (idle timeouts); peers already connected stay connected, new ones need it back
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500); });
  }

  destroy(): void { this.peer?.destroy(); this.peer = null; }
}

/** Joining: connects to a room code. */
export class NetClient {
  peer: Peer | null = null;
  link: Link | null = null;
  onLink: (link: Link) => void = () => {};
  onError: (msg: string) => void = () => {};

  connect(code: string): void {
    const peer = new Peer({ debug: 1 });
    this.peer = peer;
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; this.onError('Timed out connecting to the room.'); } }, 15000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + normalizeCode(code), { reliable: true, serialization: 'raw' });
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
      if (done && e.type !== 'peer-unavailable') return;
      done = true;
      clearTimeout(timer);
      this.onError(describe(e));
    });
  }

  destroy(): void { this.link?.close(); this.peer?.destroy(); this.peer = null; this.link = null; }
}
