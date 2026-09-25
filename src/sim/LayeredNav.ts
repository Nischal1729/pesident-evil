import { AGENT_HEIGHT, CLIMB_MAX, climbableTag, STEP_UP, type StaticCollision } from './Collision';
import { computeGraphField, INF } from './flowfield';
import type { FieldKind } from './NavGrid';
import type { GateDef } from '../world/layout';
import { distToSegment } from '../world/geom';

/** Orthogonal directions first (cost 10), then diagonals (cost 14) — must match computeGraphField. */
const DX = [1, -1, 0, 0, 1, -1, 1, -1];
const DZ = [0, 0, 1, -1, 1, 1, -1, -1];
/** Edge slots per node: the 8 neighbour directions, then one link to another surface in the same cell (slot 8). */
const SLOTS = 9;
/** Extra cost of a climb edge (≈ 3 m of walking), so bodies still walk round a row of scooters instead of over it. */
const CLIMB_COST = 30;

interface Graph {
  w: number; h: number;
  cellStart: Int32Array; // per-cell node range [cellStart[c], cellStart[c+1])
  nodeY: Float32Array;
  // node position: the cell centre, or for a thin top the centreline point nearest the cell centre
  nodeX: Float32Array;
  nodeZ: Float32Array;
  nodeThin: Uint8Array;
  nbr: Int32Array; // n·SLOTS forward edges (−1 = none)
  nodeGate: Int8Array;
  // reverse edges (CSR): predecessors of each node, for the flow-field relaxation
  rStart: Int32Array;
  rList: Int32Array;
  rCost: Uint8Array;
}

/** Static geometry never changes between games, so the (expensive) graph is built once per collision world. */
const graphCache = new WeakMap<StaticCollision, Graph>();

/**
 * Multi-level navigation: a 1 m grid where every cell holds one node per walkable surface (terrain, podium tops,
 * decks, ramps, stair flights, tiers…). Neighbouring nodes connect when the rise between them is a step
 * (≤ STEP_UP), a continuous slope, or a climb (≤ CLIMB_MAX onto a climbable top, straight neighbours only, as the
 * player's mantle). Flow fields (Dial's algorithm) run on this graph in the nav worker.
 * Same interface as NavGrid, with the actor's height passed to the queries.
 */
export class LayeredNav {
  readonly cell = 1;
  w: number;
  h: number;
  g!: Graph;
  gateClosed = new Uint8Array(8);
  private fields = new Map<FieldKind, Uint32Array>();
  private spare = new Map<FieldKind, ArrayBuffer | null>();
  private busy = new Map<FieldKind, boolean>();
  private worker: Worker | null = null;
  private reqId = 0;
  private targetBuf: number[] = [];

  constructor(public minX: number, public minZ: number, maxX: number, maxZ: number) {
    this.w = Math.ceil(maxX - minX);
    this.h = Math.ceil(maxZ - minZ);
  }

  get nodeCount(): number { return this.g.nodeY.length; }

  build(col: StaticCollision, gates: GateDef[], agentR = 0.38): void {
    const t0 = performance.now();
    let g = graphCache.get(col);
    if (!g || g.w !== this.w || g.h !== this.h) {
      g = this.buildGraph(col, gates, agentR);
      graphCache.set(col, g);
      console.log(`[nav] layered graph ${this.w}x${this.h}: ${g.nodeY.length} nodes in ${(performance.now() - t0).toFixed(0)} ms`);
    }
    this.g = g;
    const n = g.nodeY.length;
    for (const k of ['zombie', 'player'] as FieldKind[]) {
      this.fields.set(k, new Uint32Array(n).fill(INF));
      this.spare.set(k, new ArrayBuffer(n * 4));
      this.busy.set(k, false);
    }
    gates.forEach((_, gi) => { this.gateClosed[gi] = 1; });
    try {
      this.worker = new Worker(new URL('./navWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.onWorker(e.data);
      this.worker.postMessage({ type: 'initGraph', n, rStart: g.rStart, rList: g.rList, rCost: g.rCost, nodeGate: g.nodeGate });
      this.worker.postMessage({ type: 'gates', closed: this.gateClosed });
    } catch (err) {
      console.warn('[nav] worker unavailable, computing on main thread', err);
      this.worker = null;
    }
  }

  private buildGraph(col: StaticCollision, gates: GateDef[], agentR: number): Graph {
    const { w, h, minX, minZ } = this;
    const notGate = (tag: string) => !tag.startsWith('gate:');
    // 0) thin climbable tops (compound walls, gate leaves, scooter and barricade strips) are narrower than a cell and
    // rarely contain a cell centre: sample each centreline and give every cell it crosses a candidate at the
    // centreline point nearest the cell centre
    const thin = new Map<number, { y: number; x: number; z: number; d: number; p: number }[]>();
    for (const P of col.prisms) {
      if (!P.enabled || P.n !== 4 || P.ramp || !climbableTag(P.tag)) continue;
      const q = P.pts;
      const l01 = Math.hypot(q[2] - q[0], q[3] - q[1]), l12 = Math.hypot(q[4] - q[2], q[5] - q[3]);
      if (Math.min(l01, l12) >= 1) continue;
      const [ax, az, bx, bz] = l01 < l12
        ? [(q[0] + q[2]) / 2, (q[1] + q[3]) / 2, (q[4] + q[6]) / 2, (q[5] + q[7]) / 2]
        : [(q[2] + q[4]) / 2, (q[3] + q[5]) / 2, (q[6] + q[0]) / 2, (q[7] + q[1]) / 2];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let k = 0; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps, z = az + ((bz - az) * k) / steps;
        const i = Math.floor(x - minX), j = Math.floor(z - minZ);
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const c = j * w + i, d = (x - minX - i - 0.5) ** 2 + (z - minZ - j - 0.5) ** 2;
        let list = thin.get(c);
        if (!list) thin.set(c, (list = []));
        const e = list.find((t) => t.p === P.id);
        if (!e) list.push({ y: P.base + P.height, x, z, d, p: P.id });
        else if (d < e.d) { e.x = x; e.z = z; e.d = d; }
      }
    }
    // 1) nodes: every surface top under the cell centre (plus the thin tops above) with head-room above it
    const cellStart = new Int32Array(w * h + 1);
    const ys: number[] = [], xs: number[] = [], zs: number[] = [], th: number[] = [], src: number[] = [], clb: number[] = [];
    const cols = [ys, xs, zs, th, src, clb];
    type Cand = { y: number; x: number; z: number; thin: number; p: number; climb: number };
    const pool: Cand[] = [], cand: Cand[] = [];
    const add = (y: number, x: number, z: number, thin: number, p: number, climb: number) => {
      const e = pool[cand.length] ?? (pool[cand.length] = { y, x, z, thin, p, climb });
      e.y = y; e.x = x; e.z = z; e.thin = thin; e.p = p; e.climb = climb;
      cand.push(e);
    };
    for (let j = 0; j < h; j++) {
      const z = minZ + j + 0.5;
      for (let i = 0; i < w; i++) {
        const x = minX + i + 0.5;
        const c = j * w + i;
        cellStart[c] = ys.length;
        cand.length = 0;
        add(0, x, z, 0, -1, 0);
        col.forTopsAt(x, z, (t, p, cl) => add(t, x, z, 0, p, cl ? 1 : 0));
        const tl = thin.get(c);
        if (tl) for (const t of tl) add(t.y, t.x, t.z, 1, t.p, 1);
        // highest first; near-duplicates keep the higher surface, and at one height the cell-centre node
        if (cand.length > 1) cand.sort((a, b) => b.y - a.y || a.thin - b.thin);
        const first = ys.length;
        let last = Infinity;
        for (const e of cand) {
          if (last - e.y < 0.25) continue;
          last = e.y;
          if (col.blockedBand(e.x, e.z, agentR, e.y + STEP_UP, e.y + AGENT_HEIGHT - 0.1, notGate)) continue;
          ys.push(e.y); xs.push(e.x); zs.push(e.z); th.push(e.thin); src.push(e.p); clb.push(e.climb);
        }
        // store ascending within the cell
        for (let a = first, b = ys.length - 1; a < b; a++, b--) {
          for (const arr of cols) { const t = arr[a]; arr[a] = arr[b]; arr[b] = t; }
        }
      }
    }
    const n = ys.length;
    cellStart[w * h] = n;
    const nodeY = Float32Array.from(ys), nodeX = Float32Array.from(xs), nodeZ = Float32Array.from(zs);
    const nodeThin = Uint8Array.from(th), nodeClimb = Uint8Array.from(clb), nodeSrc = Int32Array.from(src);
    // 2) gate nodes (ground level along each gate line)
    const nodeGate = new Int8Array(n).fill(-1);
    gates.forEach((gt, gi) => {
      const x0 = Math.floor(Math.min(gt.a[0], gt.b[0]) - 2 - minX), x1 = Math.ceil(Math.max(gt.a[0], gt.b[0]) + 2 - minX);
      const z0 = Math.floor(Math.min(gt.a[1], gt.b[1]) - 2 - minZ), z1 = Math.ceil(Math.max(gt.a[1], gt.b[1]) + 2 - minZ);
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const x = minX + i + 0.5, z = minZ + j + 0.5;
        if (distToSegment(x, z, gt.a[0], gt.a[1], gt.b[0], gt.b[1]) >= 0.75) continue;
        const c = j * w + i;
        for (let k = cellStart[c]; k < cellStart[c + 1]; k++) if (nodeY[k] < 0.5) nodeGate[k] = gi;
      }
    });
    // 3) edges
    // nodes with a solid within ~1 m get their links checked for thin walls (a wall thinner than the gap between two
    // clear cell centres would otherwise be walked straight through)
    const nearWall = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const y = nodeY[k];
      if (col.blockedBand(nodeX[k], nodeZ[k], 1.0, y + STEP_UP, y + AGENT_HEIGHT - 0.1, notGate)) nearWall[k] = 1;
    }
    const nbr = new Int32Array(n * SLOTS).fill(-1);
    const ecost = new Uint8Array(n * SLOTS);
    const nodeNear = (c: number, y: number, tol: number): number => {
      let best = -1, bd = tol;
      for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
        const d = Math.abs(nodeY[k] - y);
        if (d <= bd) { bd = d; best = k; }
      }
      return best;
    };
    // a climb between nodes lo (lower) and up: the upper surface is climbable and a boundary top is entered from the
    // inside (the down edge follows the same rule, so nothing leads off a wall or gate to the outside). No climb starts
    // on a gate node: the link from outside the gate line onto a stack tier inside it would cross a closed gate, and a
    // zombie steering along it presses on the bars instead of bashing them.
    const climbOk = (lo: number, up: number): boolean => {
      if (!nodeClimb[up] || nodeGate[lo] >= 0 || nodeY[up] - nodeY[lo] > CLIMB_MAX + 0.01) return false;
      const L = nodeSrc[up] >= 0 ? col.prisms[nodeSrc[up]].lip : null;
      return !L || (nodeX[up] - nodeX[lo]) * L.nx + (nodeZ[up] - nodeZ[lo]) * L.nz > 0;
    };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = j * w + i;
      for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
        const y = nodeY[k], x0 = nodeX[k], z0 = nodeZ[k];
        for (let d = 0; d < 8; d++) {
          const ni = i + DX[d], nj = j + DZ[d];
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const m = nodeNear(nj * w + ni, y, CLIMB_MAX + 0.05);
          if (m < 0) continue;
          const ym = nodeY[m];
          const dy = Math.abs(ym - y);
          let cost = d < 4 ? 10 : 14;
          if (dy > STEP_UP + 0.02) {
            // bigger rise: along a continuous surface (ramp / stair flight), else a straight climb, never up a wall
            const gm = col.groundAt((x0 + nodeX[m]) * 0.5, (z0 + nodeZ[m]) * 0.5, Math.max(y, ym) + STEP_UP);
            if (Math.abs(gm - y) > STEP_UP || Math.abs(ym - gm) > STEP_UP) {
              if (d >= 4 || !(ym > y ? climbOk(k, m) : climbOk(m, k))) continue;
              cost += CLIMB_COST;
            }
          }
          if (d >= 4) {
            // no corner cutting: both orthogonal cells must be walkable at this height
            if (nodeNear(j * w + ni, y, STEP_UP + 0.35) < 0 || nodeNear(nj * w + i, y, STEP_UP + 0.35) < 0) continue;
          }
          if (nearWall[k] || nearWall[m]) {
            // thin walls / parapets / railings between the two nodes: sample the link at ¼, ½ and ¾
            const yb = Math.max(y, ym);
            let wall = false;
            for (const f of [0.25, 0.5, 0.75]) {
              if (col.blockedBand(x0 + (nodeX[m] - x0) * f, z0 + (nodeZ[m] - z0) * f, 0.08, yb + STEP_UP, yb + AGENT_HEIGHT - 0.1, notGate)) { wall = true; break; }
            }
            if (wall) continue;
          }
          nbr[k * SLOTS + d] = m;
          ecost[k * SLOTS + d] = cost;
        }
        // slot 8: a thin top and another surface in the same cell (a stack tier beside a gate, a scooter strip over
        // the ground) have no neighbour slot between them
        let bm = -1, bd = Infinity;
        for (let m = cellStart[c]; m < cellStart[c + 1]; m++) {
          if (m === k || (!nodeThin[k] && !nodeThin[m])) continue;
          const dy = Math.abs(nodeY[m] - y);
          if (dy >= bd || (dy > STEP_UP + 0.02 && !(nodeY[m] > y ? climbOk(k, m) : climbOk(m, k)))) continue;
          bd = dy; bm = m;
        }
        if (bm >= 0) {
          nbr[k * SLOTS + 8] = bm;
          ecost[k * SLOTS + 8] = bd > STEP_UP + 0.02 ? 10 + CLIMB_COST : 10;
        }
      }
    }
    // 4) reverse adjacency (CSR)
    const rStart = new Int32Array(n + 1);
    for (let e = 0; e < n * SLOTS; e++) { const m = nbr[e]; if (m >= 0) rStart[m + 1]++; }
    for (let k = 0; k < n; k++) rStart[k + 1] += rStart[k];
    const fill = rStart.slice(0, n);
    const rList = new Int32Array(rStart[n]);
    const rCost = new Uint8Array(rStart[n]);
    for (let k = 0; k < n; k++) for (let d = 0; d < SLOTS; d++) {
      const m = nbr[k * SLOTS + d];
      if (m < 0) continue;
      const e = fill[m]++;
      rList[e] = k;
      rCost[e] = ecost[k * SLOTS + d];
    }
    return { w, h, cellStart, nodeY, nodeX, nodeZ, nodeThin, nbr, nodeGate, rStart, rList, rCost };
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

  /** Request a new field toward the given world-space targets (y = feet height). */
  request(kind: FieldKind, targets: { x: number; y?: number; z: number }[], maxCost = 60000): void {
    if (this.busy.get(kind)) return;
    const tb = this.targetBuf;
    tb.length = 0;
    for (const p of targets) {
      const k = this.nodeAt(p.x, p.y ?? 0, p.z, true);
      if (k >= 0) tb.push(k);
    }
    const t = Int32Array.from(tb);
    if (this.worker) {
      const buf = this.spare.get(kind);
      if (!buf) return;
      this.spare.set(kind, null);
      this.busy.set(kind, true);
      this.worker.postMessage({ type: 'computeGraph', kind, id: ++this.reqId, targets: t, buffer: buf, maxCost }, [buf]);
    } else {
      computeGraphField(this.g.nodeY.length, this.g.rStart, this.g.rList, this.g.rCost, this.g.nodeGate, this.gateClosed, t, this.fields.get(kind)!, maxCost);
    }
  }

  field(kind: FieldKind): Uint32Array { return this.fields.get(kind)!; }

  /**
   * Node for a body standing at (x, y, z): the surface in the cell nearest the feet, at most 0.6 m above them.
   * With `search`, falls back to the neighbouring cells (bodies hugging a wall stand in unwalkable cells).
   */
  nodeAt(x: number, y: number, z: number, search = false): number {
    const g = this.g;
    const i = Math.floor(x - this.minX), j = Math.floor(z - this.minZ);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    const k = this.nodeInCell(j * this.w + i, y);
    if (k >= 0 || !search) return k;
    let best = -1, bd = Infinity;
    for (let d = 0; d < 8; d++) {
      const ni = i + DX[d], nj = j + DZ[d];
      if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
      const m = this.nodeInCell(nj * this.w + ni, y);
      if (m < 0) continue;
      const dd = Math.abs(g.nodeY[m] - y) + (d >= 4 ? 0.4 : 0);
      if (dd < bd) { bd = dd; best = m; }
    }
    return best;
  }

  private nodeInCell(c: number, y: number): number {
    const g = this.g;
    let best = -1, by = -Infinity;
    for (let k = g.cellStart[c]; k < g.cellStart[c + 1]; k++) {
      const ny = g.nodeY[k];
      // nearest surface at or just below the feet (a stack tier and the wall top beside it share cells)
      if (ny <= y + 0.6 && Math.abs(ny - y) < Math.abs(by - y)) { by = ny; best = k; }
    }
    if (best >= 0 && y - by < 1.6) return best;
    // falling / slightly below a surface: nearest by height
    let bd = 1.0;
    best = -1;
    for (let k = g.cellStart[c]; k < g.cellStart[c + 1]; k++) {
      const d = Math.abs(g.nodeY[k] - y);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }


  cost(kind: FieldKind, x: number, z: number, y = 0): number {
    const k = this.nodeAt(x, y, z);
    return k < 0 ? INF : this.fields.get(kind)![k];
  }

  /** Is there no walkable surface near height y at (x,z)? */
  isBlocked(x: number, z: number, y = 0): boolean {
    const k = this.nodeAt(x, y, z);
    return k < 0 || Math.abs(this.g.nodeY[k] - y) > 0.8;
  }

  /** Walkable surface height at (x,z) nearest to y (or null). */
  surfaceY(x: number, z: number, y = 0): number | null {
    const k = this.nodeAt(x, y, z);
    return k < 0 ? null : this.g.nodeY[k];
  }

  /** Is the body at (x, y, z) on a thin top (wall, gate or strip centreline node)? */
  thinAt(x: number, z: number, y = 0): boolean {
    const k = this.nodeAt(x, y, z);
    return k >= 0 && this.g.nodeThin[k] === 1;
  }

  gateAt(x: number, z: number, y = 0): number {
    const k = this.nodeAt(x, y, z);
    return k < 0 ? -1 : this.g.nodeGate[k];
  }

  /**
   * Direction of steepest descent for a body at (x, y, z). Writes into out {x,z}, plus the next node's height and
   * whether it is a thin top (out.y, out.thin); returns the next node's gate index or −1, or −2 if there is no route.
   */
  descend(kind: FieldKind, x: number, z: number, out: { x: number; z: number; y?: number; thin?: boolean }, y = 0): number {
    const g = this.g;
    const f = this.fields.get(kind)!;
    const own = this.nodeAt(x, y, z);
    const k0 = own >= 0 ? own : this.nodeAt(x, y, z, true);
    if (k0 < 0) { out.x = 0; out.z = 0; return -2; }
    let bm = -1;
    let best = own >= 0 ? f[k0] : INF;
    if (own < 0) { bm = k0; best = f[k0]; } // standing off-grid (against a wall): step back onto the graph first
    else {
      for (let d = 0; d < SLOTS; d++) {
        const m = g.nbr[k0 * SLOTS + d];
        if (m >= 0 && f[m] < best) { best = f[m]; bm = m; }
      }
    }
    if (bm < 0 || best === INF) {
      out.x = 0; out.z = 0;
      return f[k0] === 0 ? -1 : -2;
    }
    // aim at the chosen node, but look one more step ahead for smoother paths
    out.y = g.nodeY[bm];
    out.thin = g.nodeThin[bm] === 1;
    let tx = g.nodeX[bm], tz = g.nodeZ[bm];
    let b2 = -1, c2 = best;
    for (let d = 0; d < SLOTS; d++) {
      const m = g.nbr[bm * SLOTS + d];
      if (m >= 0 && f[m] < c2) { c2 = f[m]; b2 = m; }
    }
    // no look-ahead across a climb: aim straight at the face
    if (b2 >= 0 && Math.abs(g.nodeY[b2] - g.nodeY[bm]) <= STEP_UP + 0.02 && Math.abs(g.nodeY[bm] - y) <= STEP_UP + 0.02) { tx = (tx + g.nodeX[b2]) * 0.5; tz = (tz + g.nodeZ[b2]) * 0.5; }
    const dx = tx - x, dz = tz - z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l; out.z = dz / l;
    return g.nodeGate[bm] >= 0 ? g.nodeGate[bm] : -1;
  }
}
