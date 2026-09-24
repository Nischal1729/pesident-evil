import type { StaticCollision } from './Collision';
import { computeFlowField, INF } from './flowfield';
import type { GateDef } from '../world/layout';
import { distToSegment } from '../world/geom';

export type FieldKind = 'zombie' | 'player';

/**
 * 1 m navigation grid + asynchronous flow fields (Web Worker, double-buffered).
 * 'zombie' field: distance to nearest survivor. 'player' field: distance to the local player (NPC following).
 */
export class NavGrid {
  readonly cell = 1;
  w: number;
  h: number;
  grid: Uint8Array;
  gateIdx: Int8Array;
  gateClosed = new Uint8Array(8);
  private fields = new Map<FieldKind, Uint32Array>();
  private spare = new Map<FieldKind, ArrayBuffer | null>();
  private busy = new Map<FieldKind, boolean>();
  private worker: Worker | null = null;
  private reqId = 0;

  constructor(public minX: number, public minZ: number, maxX: number, maxZ: number) {
    this.w = Math.ceil(maxX - minX);
    this.h = Math.ceil(maxZ - minZ);
    this.grid = new Uint8Array(this.w * this.h);
    this.gateIdx = new Int8Array(this.w * this.h).fill(-1);
    for (const k of ['zombie', 'player'] as FieldKind[]) {
      this.fields.set(k, new Uint32Array(this.w * this.h).fill(INF));
      this.spare.set(k, new ArrayBuffer(this.w * this.h * 4));
      this.busy.set(k, false);
    }
  }

  build(col: StaticCollision, gates: GateDef[], agentR = 0.38): void {
    const t0 = performance.now();
    const notGate = (tag: string) => !tag.startsWith('gate:');
    for (let j = 0; j < this.h; j++) {
      const z = this.minZ + j + 0.5;
      for (let i = 0; i < this.w; i++) {
        const x = this.minX + i + 0.5;
        if (col.blocked(x, z, agentR, notGate)) this.grid[j * this.w + i] = 1;
      }
    }
    gates.forEach((g, gi) => {
      const x0 = Math.floor(Math.min(g.a[0], g.b[0]) - 2 - this.minX), x1 = Math.ceil(Math.max(g.a[0], g.b[0]) + 2 - this.minX);
      const z0 = Math.floor(Math.min(g.a[1], g.b[1]) - 2 - this.minZ), z1 = Math.ceil(Math.max(g.a[1], g.b[1]) + 2 - this.minZ);
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const x = this.minX + i + 0.5, z = this.minZ + j + 0.5;
        if (distToSegment(x, z, g.a[0], g.a[1], g.b[0], g.b[1]) < 0.75) {
          const idx = j * this.w + i;
          if (this.grid[idx] !== 1) { this.grid[idx] = 2; this.gateIdx[idx] = gi; }
        }
      }
      this.gateClosed[gi] = 1;
    });
    console.log(`[nav] grid ${this.w}x${this.h} built in ${(performance.now() - t0).toFixed(0)} ms`);
    try {
      this.worker = new Worker(new URL('./navWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.onWorker(e.data);
      this.worker.postMessage({ type: 'init', w: this.w, h: this.h, grid: this.grid, gateIdx: this.gateIdx });
      this.worker.postMessage({ type: 'gates', closed: this.gateClosed });
    } catch (err) {
      console.warn('[nav] worker unavailable, computing on main thread', err);
      this.worker = null;
    }
  }

  setGateClosed(gi: number, closed: boolean): void {
    this.gateClosed[gi] = closed ? 1 : 0;
    this.worker?.postMessage({ type: 'gates', closed: this.gateClosed.slice() });
  }

  private onWorker(m: { type: string; kind: FieldKind; buffer: ArrayBuffer }): void {
    if (m.type !== 'field') return;
    const old = this.fields.get(m.kind)!;
    this.fields.set(m.kind, new Uint32Array(m.buffer));
    this.spare.set(m.kind, old.buffer as ArrayBuffer);
    this.busy.set(m.kind, false);
  }

  /** Request a new field toward the given world-space target points. */
  request(kind: FieldKind, targets: { x: number; z: number }[], maxCost = 60000): void {
    if (this.busy.get(kind)) return;
    const t = new Float32Array(targets.length * 2);
    targets.forEach((p, i) => { t[i * 2] = p.x - this.minX; t[i * 2 + 1] = p.z - this.minZ; });
    if (this.worker) {
      const buf = this.spare.get(kind);
      if (!buf) return;
      this.spare.set(kind, null);
      this.busy.set(kind, true);
      this.worker.postMessage({ type: 'compute', kind, id: ++this.reqId, targets: t, buffer: buf, maxCost }, [buf]);
    } else {
      const f = this.fields.get(kind)!;
      computeFlowField(this.w, this.h, this.grid, this.gateIdx, this.gateClosed, t, f, maxCost);
    }
  }

  field(kind: FieldKind): Uint32Array { return this.fields.get(kind)!; }

  cost(kind: FieldKind, x: number, z: number): number {
    const i = Math.floor(x - this.minX), j = Math.floor(z - this.minZ);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return INF;
    return this.fields.get(kind)![j * this.w + i];
  }

  isBlocked(x: number, z: number): boolean {
    const i = Math.floor(x - this.minX), j = Math.floor(z - this.minZ);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return true;
    return this.grid[j * this.w + i] === 1;
  }

  /** Gate index if (x,z) is a gate cell, else -1 */
  gateAt(x: number, z: number): number {
    const i = Math.floor(x - this.minX), j = Math.floor(z - this.minZ);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return this.grid[j * this.w + i] === 2 ? this.gateIdx[j * this.w + i] : -1;
  }

  /**
   * Direction of steepest descent at (x,z). Writes into out {x,z}; returns the next cell's gate index or -1,
   * or -2 if no route.
   */
  descend(kind: FieldKind, x: number, z: number, out: { x: number; z: number }): number {
    const f = this.fields.get(kind)!;
    const w = this.w;
    let i = Math.floor(x - this.minX), j = Math.floor(z - this.minZ);
    if (i < 1 || j < 1 || i >= w - 1 || j >= this.h - 1) { out.x = 0; out.z = 0; return -2; }
    let here = f[j * w + i];
    if (here === INF || this.grid[j * w + i] === 1) {
      // we're inside an obstacle cell: step to the best reachable neighbour
      here = INF;
    }
    let best = here, bi = -1, bj = -1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const ni = i + dx, nj = j + dz;
      const idx = nj * w + ni;
      if (this.grid[idx] === 1) continue;
      if (dx && dz && (this.grid[j * w + ni] === 1 || this.grid[nj * w + i] === 1)) continue;
      const c = f[idx];
      if (c < best) { best = c; bi = ni; bj = nj; }
    }
    if (bi < 0) {
      out.x = 0; out.z = 0;
      return here === 0 ? -1 : -2;
    }
    // aim at the chosen cell centre, but look one more step ahead for smoother paths
    let tx = this.minX + bi + 0.5, tz = this.minZ + bj + 0.5;
    let ci = bi, cj = bj, cb = best;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const ni = bi + dx, nj = bj + dz;
      if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
      const idx = nj * w + ni;
      if (this.grid[idx] === 1) continue;
      if (f[idx] < cb) { cb = f[idx]; ci = ni; cj = nj; }
    }
    if (ci !== bi || cj !== bj) {
      tx = (tx + this.minX + ci + 0.5) * 0.5;
      tz = (tz + this.minZ + cj + 0.5) * 0.5;
    }
    let dx = tx - x, dz = tz - z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l; out.z = dz / l;
    const gidx = bj * w + bi;
    return this.grid[gidx] === 2 ? this.gateIdx[gidx] : -1;
  }
}
