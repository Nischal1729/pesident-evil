import * as THREE from 'three';
import { rng } from '../geom';
import { BARK, BARK_TILE, CELL, cellUV, type BarkId } from './atlas';

/**
 * Procedural tree generator (skeleton → tubes + leaf cards), one function per growth habit.
 * Inspired by the branching model of EZ-Tree (Dan Greenheck, MIT) but written for this game's species, with
 * crown-envelope-limited growth so each species keeps its silhouette (rain-tree dome, gulmohar umbrella,
 * Polyalthia column, Terminalia tiers, frangipani candelabra, areca clumps).
 *
 * Every tree is emitted at two detail levels that share one skeleton:
 *   lod0  all branch levels, folded leaf cards (4 tris)
 *   lod1  trunk + main limbs with fewer sides, every 3rd leaf card enlarged, flat cards
 * Attributes (identical layout for every tree so they batch): position, normal, uv, color, wind(vec4).
 */

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);

export interface TreeLOD { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry }
export interface TreeModel {
  lod0: TreeLOD;
  lod1: TreeLOD;
  /** Height and crown radius at scale 1 (metres). */
  height: number;
  radius: number;
  trunkR: number;
}

// ------------------------------------------------------------------------------------------------ geometry builder

class Geo {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; wnd: number[] = []; idx: number[] = [];
  get count(): number { return this.pos.length / 3; }
  v(p: V3, n: V3, u: number, w: number, c: [number, number, number], wy: number, wz: number, ph: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, w);
    this.col.push(c[0], c[1], c[2]);
    this.wnd.push(0, wy, wz, ph);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, a, c, d); }
  /** wind.x = trunk sway weight from height. */
  finish(H: number): THREE.BufferGeometry {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const y = Math.max(0, this.pos[i * 3 + 1]);
      this.wnd[i * 4] = Math.pow(Math.min(1.2, y / H), 1.6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('wind', new THREE.Float32BufferAttribute(this.wnd, 4));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------------------------------------ skeleton

interface Node { p: V3; r: number }
interface Branch {
  nodes: Node[];
  level: number;
  phase: number;
  /** Branch-bob weight at the root (accumulates down the hierarchy). */
  w0: number;
  wGain: number;
  bark: BarkId;
  tint: [number, number, number];
  /** Leaf placements hang off this branch (terminal twigs). */
  terminal: boolean;
  /** Drawn in lod1 as well. */
  lod1: boolean;
}

interface Leaf {
  p: V3; up: V3; n: V3; size: number; cell: number;
  mode: 'twig' | 'rosette' | 'frond';
  w: number; ph: number; tint: [number, number, number];
  /** frond only: rachis curve points + widths */
  rachis?: V3[]; fold?: number;
}

interface Env { cy: number; rx: number; ry: number }

function distToEnv(env: Env, p: V3, d: V3): number {
  const qx = p.x / env.rx, qy = (p.y - env.cy) / env.ry, qz = p.z / env.rx;
  const ex = d.x / env.rx, ey = d.y / env.ry, ez = d.z / env.rx;
  const a = ex * ex + ey * ey + ez * ez, b = 2 * (qx * ex + qy * ey + qz * ez), c = qx * qx + qy * qy + qz * qz - 1;
  if (c >= 0) return 0.25;
  const disc = b * b - 4 * a * c;
  return (-b + Math.sqrt(Math.max(0, disc))) / (2 * a);
}

class Rand {
  r: () => number;
  constructor(seed: number) { this.r = rng(seed); }
  f(a = 0, b = 1): number { return a + (b - a) * this.r(); }
  i(a: number, b: number): number { return Math.floor(this.f(a, b + 1)); }
  unit(): V3 {
    for (;;) {
      const x = this.f(-1, 1), y = this.f(-1, 1), z = this.f(-1, 1);
      const l = x * x + y * y + z * z;
      if (l > 0.01 && l <= 1) return v3(x, y, z).divideScalar(Math.sqrt(l));
    }
  }
}

/** Rotate `dir` away from itself by `angle` (rad) toward the perpendicular at azimuth `az` around it. */
function tilt(dir: V3, angle: number, az: number): V3 {
  const ref = Math.abs(dir.y) < 0.95 ? UP : v3(1, 0, 0);
  const a = v3().crossVectors(dir, ref).normalize();
  const b = v3().crossVectors(dir, a).normalize();
  const perp = a.multiplyScalar(Math.cos(az)).add(b.multiplyScalar(Math.sin(az)));
  return dir.clone().multiplyScalar(Math.cos(angle)).addScaledVector(perp, Math.sin(angle)).normalize();
}

interface GrowOpts { sections: number; gnarl: number; up: number; out?: number; r0: number; r1: number }

function grow(R: Rand, start: V3, dir: V3, length: number, o: GrowOpts): Node[] {
  const nodes: Node[] = [];
  const p = start.clone();
  const d = dir.clone().normalize();
  const seg = length / o.sections;
  for (let i = 0; i <= o.sections; i++) {
    const t = i / o.sections;
    nodes.push({ p: p.clone(), r: o.r0 + (o.r1 - o.r0) * Math.pow(t, 0.8) });
    if (i === o.sections) break;
    d.addScaledVector(R.unit(), o.gnarl);
    d.y += o.up;
    if (o.out) { const h = v3(p.x, 0, p.z); if (h.lengthSq() > 1e-4) d.addScaledVector(h.normalize(), o.out); }
    d.normalize();
    p.addScaledVector(d, seg);
  }
  return nodes;
}

/** Position / direction / radius at fraction t along a branch. */
function along(b: Branch, t: number): { p: V3; d: V3; r: number } {
  const n = b.nodes;
  const f = Math.min(n.length - 1.001, Math.max(0, t * (n.length - 1)));
  const i = Math.floor(f), k = f - i;
  const p = n[i].p.clone().lerp(n[i + 1].p, k);
  const d = n[i + 1].p.clone().sub(n[i].p).normalize();
  return { p, d, r: n[i].r + (n[i + 1].r - n[i].r) * k };
}

// ------------------------------------------------------------------------------------------------ meshing

function barkU(col: BarkId, u: number): number { return col * 16 + u; }

function tube(g: Geo, b: Branch, segs: number, step: number, capTip: boolean): void {
  const nodes = b.nodes.filter((_, i) => i % step === 0 || i === b.nodes.length - 1);
  if (nodes.length < 2) return;
  const rMax = nodes[0].r;
  const uRep = Math.max(1, Math.min(8, Math.round((Math.PI * 2 * rMax) / BARK_TILE.w)));
  let N = v3();
  let T = nodes[1].p.clone().sub(nodes[0].p).normalize();
  N = Math.abs(T.y) < 0.9 ? v3().crossVectors(T, UP).normalize() : v3().crossVectors(T, v3(1, 0, 0)).normalize();
  let vAcc = 0;
  let prevRing = -1;
  const total = nodes.length;
  for (let i = 0; i < total; i++) {
    const nd = nodes[i];
    if (i > 0) vAcc += nd.p.distanceTo(nodes[i - 1].p);
    const Tn = i === 0 ? nodes[1].p.clone().sub(nodes[0].p) : i === total - 1 ? nd.p.clone().sub(nodes[i - 1].p) : nodes[i + 1].p.clone().sub(nodes[i - 1].p);
    Tn.normalize();
    // parallel transport
    N.addScaledVector(Tn, -N.dot(Tn)).normalize();
    T = Tn;
    const B = v3().crossVectors(T, N).normalize();
    const t = i / (total - 1);
    const wy = b.w0 + b.wGain * t;
    const ring = g.count;
    const ao = b.level === 0 ? 0.82 + 0.18 * Math.min(1, nd.p.y / 3) : 0.95;
    const c: [number, number, number] = [b.tint[0] * ao, b.tint[1] * ao, b.tint[2] * ao];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const dir = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      const p = nd.p.clone().addScaledVector(dir, nd.r);
      g.v(p, dir, barkU(b.bark, (j / segs) * uRep), vAcc / BARK_TILE.h, c, wy, 0, b.phase);
    }
    if (prevRing >= 0) {
      for (let j = 0; j < segs; j++) g.quad(prevRing + j, prevRing + j + 1, ring + j + 1, ring + j);
    }
    prevRing = ring;
  }
  if (capTip) {
    const last = nodes[total - 1];
    const tip = g.v(last.p.clone().addScaledVector(T, last.r * 0.8), T, barkU(b.bark, 0.5), vAcc / BARK_TILE.h + 0.05, [b.tint[0], b.tint[1], b.tint[2]], b.w0 + b.wGain, 0, b.phase);
    for (let j = 0; j < segs; j++) g.tri(prevRing + j, prevRing + j + 1, tip);
  }
}

function leafCard(g: Geo, L: Leaf, scale: number, fold: number): void {
  const [u0, v0, u1, v1] = cellUV(L.cell);
  const s = L.size * scale;
  const side = v3().crossVectors(L.up, L.n).normalize();
  const n = L.n;
  const c = L.tint;
  if (L.mode === 'frond' && L.rachis) {
    // areca frond: V-folded strip along the rachis curve (leaflets droop from the rachis)
    const pts = L.rachis;
    const W = s;
    const f = L.fold ?? 0.6;
    const m = pts.length;
    let prev = -1;
    for (let i = 0; i < m; i++) {
      const t = i / (m - 1);
      const T = (i < m - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      const sd = v3().crossVectors(T, UP);
      if (sd.lengthSq() < 1e-4) sd.set(1, 0, 0);
      sd.normalize();
      const upv = v3().crossVectors(sd, T).normalize();
      const w = W * 0.5 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)));
      const center = pts[i];
      const l = center.clone().addScaledVector(sd, -w * Math.cos(f)).addScaledVector(upv, -w * Math.sin(f));
      const r = center.clone().addScaledVector(sd, w * Math.cos(f)).addScaledVector(upv, -w * Math.sin(f));
      const nl = upv.clone().multiplyScalar(Math.cos(f)).addScaledVector(sd, -Math.sin(f)).normalize();
      const nr = upv.clone().multiplyScalar(Math.cos(f)).addScaledVector(sd, Math.sin(f)).normalize();
      const u = u0 + (u1 - u0) * t;
      const vm = (v0 + v1) / 2;
      const fl = L.w * (0.3 + 0.7 * t);
      const ia = g.v(l, nl, u, v0, c, fl, fl, L.ph);
      const ib = g.v(center, upv, u, vm, c, fl * 0.8, fl * 0.5, L.ph);
      const ic = g.v(r, nr, u, v1, c, fl, fl, L.ph);
      if (prev >= 0) { g.quad(prev, prev + 1, ib, ia); g.quad(prev + 1, prev + 2, ic, ib); }
      prev = ia;
    }
    return;
  }
  if (L.mode === 'rosette') {
    const fwd = v3().crossVectors(n, side).normalize();
    const h = s / 2;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const ids = corners.map(([a, b]) => {
      const p = L.p.clone().addScaledVector(side, a * h).addScaledVector(fwd, b * h);
      p.addScaledVector(n, -fold * s * 0.25 * (Math.abs(a) + Math.abs(b)) * 0.5);
      return g.v(p, n, a < 0 ? u0 : u1, b < 0 ? v0 : v1, c, L.w, 1, L.ph);
    });
    g.quad(ids[0], ids[1], ids[2], ids[3]);
    return;
  }
  // twig card: attaches at the bottom centre and grows along `up`
  const h = s / 2;
  const bl = L.p.clone().addScaledVector(side, -h), br = L.p.clone().addScaledVector(side, h);
  const tl = bl.clone().addScaledVector(L.up, s), tr = br.clone().addScaledVector(L.up, s);
  if (fold > 0) {
    const bc = L.p.clone().addScaledVector(n, fold * s * 0.18);
    const tc = bc.clone().addScaledVector(L.up, s);
    const um = (u0 + u1) / 2;
    const i0 = g.v(bl, n, u0, v0, c, L.w, 0, L.ph), i1 = g.v(bc, n, um, v0, c, L.w, 0, L.ph), i2 = g.v(br, n, u1, v0, c, L.w, 0, L.ph);
    const i3 = g.v(tl, n, u0, v1, c, L.w, 1, L.ph), i4 = g.v(tc, n, um, v1, c, L.w, 1, L.ph), i5 = g.v(tr, n, u1, v1, c, L.w, 1, L.ph);
    g.quad(i0, i1, i4, i3);
    g.quad(i1, i2, i5, i4);
  } else {
    const i0 = g.v(bl, n, u0, v0, c, L.w, 0, L.ph), i1 = g.v(br, n, u1, v0, c, L.w, 0, L.ph);
    const i2 = g.v(tr, n, u1, v1, c, L.w, 1, L.ph), i3 = g.v(tl, n, u0, v1, c, L.w, 1, L.ph);
    g.quad(i0, i1, i2, i3);
  }
}

/** Blend leaf normals toward the crown ellipsoid normal and bake crown AO into the vertex colours. */
function shadeLeaves(g: Geo, startVert: number, bend: number, aoMin: number): void {
  const n = g.count;
  if (n <= startVert) return;
  let minY = Infinity, maxY = -Infinity;
  const c = v3();
  for (let i = startVert; i < n; i++) { const y = g.pos[i * 3 + 1]; minY = Math.min(minY, y); maxY = Math.max(maxY, y); c.x += g.pos[i * 3]; c.z += g.pos[i * 3 + 2]; }
  c.x /= n - startVert; c.z /= n - startVert;
  c.y = (minY + maxY) / 2;
  let rx = 0.3;
  for (let i = startVert; i < n; i++) rx = Math.max(rx, Math.hypot(g.pos[i * 3] - c.x, g.pos[i * 3 + 2] - c.z));
  const ry = Math.max(0.3, (maxY - minY) / 2);
  const p = v3(), e = v3(), cn = v3();
  for (let i = startVert; i < n; i++) {
    p.set(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
    e.set((p.x - c.x) / rx, (p.y - c.y) / ry, (p.z - c.z) / rx);
    const el = e.length();
    cn.set(e.x / rx, e.y / ry + 0.15, e.z / rx).normalize();
    const ln = v3(g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]);
    ln.multiplyScalar(1 - bend).addScaledVector(cn, bend).normalize();
    g.nrm[i * 3] = ln.x; g.nrm[i * 3 + 1] = ln.y; g.nrm[i * 3 + 2] = ln.z;
    const hy = (p.y - minY) / Math.max(0.01, maxY - minY);
    const ao = (aoMin + (1 - aoMin) * THREE.MathUtils.smoothstep(el, 0.25, 1.0)) * (0.78 + 0.22 * hy);
    g.col[i * 3] *= ao; g.col[i * 3 + 1] *= ao; g.col[i * 3 + 2] *= ao;
  }
}

// ------------------------------------------------------------------------------------------------ growth habits

interface Skeleton { branches: Branch[]; leaves: Leaf[]; H: number; R: number; trunkR: number; bend: number; aoMin: number; leafFold: number; lod1Leaf: { every: number; scale: number } }

interface CrownSpec {
  H: number;
  trunkH: number; trunkR: number; flare: number; lean: number;
  /** Trunk continues as a central leader to this height (else it forks at trunkH). */
  leaderTop?: number;
  env: Env;
  n1: [number, number]; a1: [number, number]; s1: [number, number]; len1: [number, number]; r1: number; up1: number; out1?: number;
  n2: [number, number]; a2: [number, number]; s2: [number, number]; len2: [number, number]; max2: number; r2: number; up2: number;
  n3: [number, number]; a3: [number, number]; s3: [number, number]; max3: number; up3: number;
  leaf: { cell: number; size: [number, number]; per: number; start: number; mode?: 'twig' | 'rosette'; sky?: number; hang?: boolean; tip?: boolean; flowerCell?: number; flowerP?: number };
  bark: BarkId; barkTint: [number, number, number]; leafTint: [number, number, number];
  bend?: number; aoMin?: number; lod1?: { every: number; scale: number }; trunks?: number;
  /** Also hang leaves on level-2 branches (sparse young trees). */
  leavesOnL2?: boolean;
  /** Leaves deeper than this normalised crown radius are mostly skipped (hollow, shell-like crowns). */
  shell?: number;
  roots?: number;
}

function leafOrient(R: Rand, base: V3, dir: V3, spec: CrownSpec['leaf']): { up: V3; n: V3 } {
  const out = v3(base.x, 0, base.z);
  if (out.lengthSq() < 1e-4) out.set(R.f(-1, 1), 0, R.f(-1, 1));
  out.normalize();
  let up: V3;
  if (spec.hang) up = v3(0, -1, 0).addScaledVector(out, 0.55).addScaledVector(R.unit(), 0.35).normalize();
  else up = dir.clone().multiplyScalar(0.45).addScaledVector(out, 0.45).addScaledVector(UP, 0.35 + (spec.sky ?? 0)).addScaledVector(R.unit(), 0.45).normalize();
  const n0 = out.clone().multiplyScalar(0.6).addScaledVector(UP, 1.1).addScaledVector(R.unit(), 0.9).normalize();
  if (spec.mode === 'rosette') {
    const n = UP.clone().multiplyScalar(1.4).addScaledVector(out, 0.45).addScaledVector(R.unit(), 0.35).normalize();
    const u2 = v3().crossVectors(n, R.unit()).normalize();
    return { up: u2, n };
  }
  const side = v3().crossVectors(up, n0);
  if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
  side.normalize();
  const n = v3().crossVectors(side, up).normalize();
  return { up, n };
}

function crown(spec: CrownSpec, seed: number): Skeleton {
  const R = new Rand(seed);
  const branches: Branch[] = [];
  const leaves: Leaf[] = [];
  const env = spec.env;
  const tintB = spec.barkTint;
  const trunks = spec.trunks ?? 1;
  const trunkList: Branch[] = [];
  for (let k = 0; k < trunks; k++) {
    const off = trunks > 1 ? v3(Math.cos((k / trunks) * Math.PI * 2) * spec.trunkR * 0.7, 0, Math.sin((k / trunks) * Math.PI * 2) * spec.trunkR * 0.7) : v3();
    const leanDir = v3(R.f(-1, 1), 0, R.f(-1, 1)).normalize();
    const dir = UP.clone().addScaledVector(trunks > 1 ? off.clone().normalize() : leanDir, trunks > 1 ? 0.18 : spec.lean).normalize();
    const top = spec.leaderTop ?? spec.trunkH;
    const r0 = spec.trunkR / Math.sqrt(trunks);
    const nodes = grow(R, off.clone().setY(-0.25), dir, top + 0.25, { sections: Math.max(4, Math.round(top / 0.7)), gnarl: 0.03, up: 0.02, r0, r1: spec.leaderTop ? r0 * 0.28 : r0 * 0.72 });
    // root flare
    for (const nd of nodes) nd.r *= 1 + spec.flare * Math.exp(-Math.max(0, nd.p.y) * 2.2);
    const tr: Branch = { nodes, level: 0, phase: R.f(), w0: 0, wGain: 0, bark: spec.bark, tint: tintB, terminal: false, lod1: true };
    branches.push(tr);
    trunkList.push(tr);
  }
  // L1 scaffold limbs
  const golden = Math.PI * (3 - Math.sqrt(5));
  const l1: Branch[] = [];
  let az = R.f(0, Math.PI * 2);
  for (const tr of trunkList) {
    const n1 = R.i(spec.n1[0], spec.n1[1]);
    for (let i = 0; i < n1; i++) {
      az += golden + R.f(-0.3, 0.3);
      const t = spec.leaderTop ? (spec.s1[0] + (spec.s1[1] - spec.s1[0]) * (i / Math.max(1, n1 - 1))) : R.f(spec.s1[0], spec.s1[1]);
      const at = along(tr, t);
      const ang = THREE.MathUtils.degToRad(R.f(spec.a1[0], spec.a1[1]));
      const dir = v3(Math.sin(ang) * Math.cos(az), Math.cos(ang), Math.sin(ang) * Math.sin(az));
      const L = Math.max(0.6, distToEnv(env, at.p, dir) * R.f(spec.len1[0], spec.len1[1]));
      const r0 = Math.max(0.03, at.r * spec.r1);
      const nodes = grow(R, at.p, dir, L, { sections: Math.max(3, Math.round(L / 0.6)), gnarl: 0.09, up: spec.up1, out: spec.out1, r0, r1: r0 * 0.45 });
      const b: Branch = { nodes, level: 1, phase: R.f(), w0: 0.05, wGain: 0.35, bark: spec.bark, tint: tintB, terminal: false, lod1: true };
      branches.push(b);
      l1.push(b);
    }
  }
  // aerial roots (ficus)
  for (let k = 0; k < (spec.roots ?? 0); k++) {
    const b = l1[k % l1.length];
    const at = along(b, R.f(0.3, 0.8));
    const len = at.p.y - R.f(0.0, 0.8);
    if (len < 1) continue;
    const nodes = grow(R, at.p, v3(0, -1, 0), len, { sections: 4, gnarl: 0.04, up: 0, r0: R.f(0.015, 0.035), r1: 0.012 });
    branches.push({ nodes, level: 2, phase: R.f(), w0: 0.1, wGain: 0.3, bark: spec.bark, tint: tintB, terminal: false, lod1: false });
  }
  // L2 + L3
  const shell = spec.shell ?? 0;
  /** Flowering cards sit mostly on top of the crown. */
  const pickCell = (p: V3) => {
    const f = spec.leaf.flowerCell;
    if (f === undefined) return spec.leaf.cell;
    const top = p.y > env.cy + env.ry * 0.1;
    return R.f() < (spec.leaf.flowerP ?? 0.3) * (top ? 1.7 : 0.35) ? f : spec.leaf.cell;
  };
  const inner = (p: V3) => Math.hypot(p.x / env.rx, (p.y - env.cy) / env.ry, p.z / env.rx) < shell && R.f() < 0.85;
  const addLeaves = (b: Branch, count: number) => {
    for (let k = 0; k < count; k++) {
      const t = spec.leaf.start + (1 - spec.leaf.start) * (count === 1 ? 1 : k / (count - 1)) * 0.98 + R.f(-0.03, 0.03);
      const at = along(b, Math.min(1, Math.max(0, t)));
      if (inner(at.p)) continue;
      const o = leafOrient(R, at.p, at.d, spec.leaf);
      leaves.push({ p: at.p, up: o.up, n: o.n, size: R.f(spec.leaf.size[0], spec.leaf.size[1]), cell: pickCell(at.p), mode: spec.leaf.mode ?? 'twig', w: b.w0 + b.wGain * t + 0.1, ph: b.phase + R.f(0, 0.2), tint: spec.leafTint });
    }
    if (spec.leaf.tip !== false) {
      const at = along(b, 1);
      const o = leafOrient(R, at.p, at.d, spec.leaf);
      leaves.push({ p: at.p, up: o.up, n: o.n, size: R.f(spec.leaf.size[0], spec.leaf.size[1]), cell: pickCell(at.p), mode: spec.leaf.mode ?? 'twig', w: b.w0 + b.wGain + 0.1, ph: b.phase, tint: spec.leafTint });
    }
  };
  for (const p1 of l1) {
    const n2 = R.i(spec.n2[0], spec.n2[1]);
    let az2 = R.f(0, Math.PI * 2);
    for (let i = 0; i < n2; i++) {
      az2 += golden * 1.3 + R.f(-0.4, 0.4);
      const t = spec.s2[0] + (spec.s2[1] - spec.s2[0]) * (n2 === 1 ? 1 : i / (n2 - 1));
      const at = along(p1, t);
      let dir = tilt(at.d, THREE.MathUtils.degToRad(R.f(spec.a2[0], spec.a2[1])), az2);
      const out = v3(at.p.x, 0, at.p.z).normalize();
      dir.addScaledVector(out, 0.35).addScaledVector(UP, 0.15).normalize();
      if (dir.y < -0.35) { dir.y = -0.35; dir.normalize(); }
      const L = Math.min(spec.max2, Math.max(0.4, distToEnv(env, at.p, dir) * R.f(spec.len2[0], spec.len2[1])));
      const r0 = Math.max(0.018, at.r * spec.r2);
      const nodes = grow(R, at.p, dir, L, { sections: Math.max(2, Math.round(L / 0.5)), gnarl: 0.12, up: spec.up2, r0, r1: r0 * 0.4 });
      const b2: Branch = { nodes, level: 2, phase: R.f(), w0: p1.w0 + p1.wGain * t, wGain: 0.3, bark: spec.bark, tint: tintB, terminal: false, lod1: false };
      branches.push(b2);
      if (spec.leavesOnL2) addLeaves(b2, spec.leaf.per);
      const n3 = R.i(spec.n3[0], spec.n3[1]);
      let az3 = R.f(0, Math.PI * 2);
      for (let j = 0; j < n3; j++) {
        az3 += golden * 1.7;
        const t3 = spec.s3[0] + (spec.s3[1] - spec.s3[0]) * (n3 === 1 ? 1 : j / (n3 - 1));
        const a3 = along(b2, t3);
        const d3 = tilt(a3.d, THREE.MathUtils.degToRad(R.f(spec.a3[0], spec.a3[1])), az3).addScaledVector(UP, 0.12).normalize();
        const L3 = Math.min(spec.max3, Math.max(0.25, distToEnv(env, a3.p, d3) * 0.95));
        const r3 = Math.max(0.008, a3.r * 0.6);
        const nodes3 = grow(R, a3.p, d3, L3, { sections: 2, gnarl: 0.15, up: spec.up3, r0: r3, r1: r3 * 0.5 });
        const b3: Branch = { nodes: nodes3, level: 3, phase: b2.phase + R.f(0, 0.3), w0: b2.w0 + b2.wGain * t3, wGain: 0.25, bark: spec.bark, tint: tintB, terminal: true, lod1: false };
        branches.push(b3);
        addLeaves(b3, spec.leaf.per);
      }
      if (n3 === 0 && !spec.leavesOnL2) addLeaves(b2, spec.leaf.per);
    }
  }
  return {
    branches, leaves, H: spec.H, R: env.rx, trunkR: spec.trunkR,
    bend: spec.bend ?? 0.72, aoMin: spec.aoMin ?? 0.5, leafFold: 1, lod1Leaf: spec.lod1 ?? { every: 3, scale: 1.7 },
  };
}

/** Polyalthia longifolia ("ashoka"): straight leader, short drooping branches all the way up → narrow column. */
function columnTree(seed: number, H: number): Skeleton {
  const R = new Rand(seed);
  const branches: Branch[] = [];
  const leaves: Leaf[] = [];
  const tint: [number, number, number] = [0.78, 0.72, 0.66];
  const trunk: Branch = { nodes: grow(R, v3(0, -0.2, 0), UP.clone().addScaledVector(R.unit(), 0.03), H * 0.97, { sections: 12, gnarl: 0.015, up: 0.03, r0: 0.16, r1: 0.03 }), level: 0, phase: R.f(), w0: 0, wGain: 0, bark: BARK.rough, tint, terminal: false, lod1: true };
  for (const nd of trunk.nodes) nd.r *= 1 + 0.35 * Math.exp(-Math.max(0, nd.p.y) * 3);
  branches.push(trunk);
  const n = 34;
  let az = R.f(0, 6.28);
  for (let i = 0; i < n; i++) {
    az += 2.4 + R.f(-0.3, 0.3);
    const t = 0.16 + 0.82 * (i / (n - 1));
    const at = along(trunk, t);
    const h = at.p.y / H;
    const ang = THREE.MathUtils.degToRad(R.f(95, 125) - 30 * h * h);
    const dir = v3(Math.sin(ang) * Math.cos(az), Math.cos(ang), Math.sin(ang) * Math.sin(az));
    const L = (0.35 + 1.25 * Math.pow(Math.max(0, 1 - h), 0.7)) * R.f(0.8, 1.1) * (h < 0.25 ? 0.8 : 1);
    const nodes = grow(R, at.p, dir, L, { sections: 3, gnarl: 0.08, up: -0.1, r0: Math.max(0.012, at.r * 0.35), r1: 0.008 });
    const b: Branch = { nodes, level: 1, phase: R.f(), w0: 0.05, wGain: 0.4, bark: BARK.rough, tint, terminal: true, lod1: false };
    branches.push(b);
    const per = 3 + Math.round(L * 2);
    for (let k = 0; k < per; k++) {
      const tt = 0.2 + 0.8 * (k / Math.max(1, per - 1));
      const a = along(b, tt);
      const out = v3(a.p.x, 0, a.p.z).normalize();
      const up = v3(0, -1, 0).addScaledVector(out, R.f(0.3, 0.8)).addScaledVector(R.unit(), 0.3).normalize();
      const side = v3().crossVectors(up, out.clone().addScaledVector(R.unit(), 0.6)).normalize();
      const nn = v3().crossVectors(side, up).normalize();
      if (nn.dot(out) < 0) nn.negate();
      leaves.push({ p: a.p.clone().addScaledVector(UP, 0.12), up, n: nn, size: R.f(0.75, 1.05) * (0.8 + 0.3 * (1 - h)), cell: CELL.ashoka, mode: 'twig', w: 0.2 + 0.4 * tt, ph: b.phase, tint: [0.92, 0.95, 0.9] });
    }
  }
  // crown tip
  const top = along(trunk, 1);
  for (let k = 0; k < 5; k++) {
    const up = UP.clone().addScaledVector(R.unit(), 0.5).normalize();
    const nn = v3().crossVectors(v3().crossVectors(up, R.unit()).normalize(), up).normalize();
    leaves.push({ p: top.p.clone().addScaledVector(UP, -0.4), up, n: nn, size: 0.8, cell: CELL.ashoka, mode: 'twig', w: 0.4, ph: 0.3, tint: [0.95, 1, 0.92] });
  }
  return { branches, leaves, H, R: 1.6, trunkR: 0.16, bend: 0.55, aoMin: 0.55, leafFold: 1, lod1Leaf: { every: 3, scale: 1.6 } };
}

/** Terminalia mantaly ("cloud" tree): straight leader with whorls of horizontal branches → flat layered tiers. */
function tieredTree(seed: number, H: number): Skeleton {
  const R = new Rand(seed);
  const branches: Branch[] = [];
  const leaves: Leaf[] = [];
  const tint: [number, number, number] = [0.9, 0.88, 0.85];
  const trunk: Branch = { nodes: grow(R, v3(0, -0.2, 0), UP, H, { sections: 12, gnarl: 0.012, up: 0.02, r0: 0.13, r1: 0.025 }), level: 0, phase: R.f(), w0: 0, wGain: 0, bark: BARK.smooth, tint, terminal: false, lod1: true };
  branches.push(trunk);
  const tiers = 6;
  let y = 2.1;
  let az0 = R.f(0, 6.28);
  const lt: [number, number, number] = [0.95, 1.0, 0.92];
  for (let k = 0; k < tiers && y < H - 0.5; k++) {
    const nb = R.i(4, 5);
    az0 += 0.7;
    const len = 3.0 * (1 - (k / tiers) * 0.72) * R.f(0.9, 1.1);
    const at = along(trunk, (y + 0.2) / (H + 0.2));
    for (let i = 0; i < nb; i++) {
      const az = az0 + (i / nb) * Math.PI * 2 + R.f(-0.25, 0.25);
      const ang = THREE.MathUtils.degToRad(R.f(76, 86));
      const dir = v3(Math.sin(ang) * Math.cos(az), Math.cos(ang), Math.sin(ang) * Math.sin(az));
      const L = len * R.f(0.85, 1.1);
      const nodes = grow(R, at.p, dir, L, { sections: 4, gnarl: 0.05, up: 0.035, r0: Math.max(0.018, at.r * 0.45), r1: 0.01 });
      const b: Branch = { nodes, level: 1, phase: R.f(), w0: 0.05, wGain: 0.45, bark: BARK.smooth, tint, terminal: true, lod1: k < 4 };
      branches.push(b);
      // side twigs in the tier plane, each ending in a flat rosette
      const nt = Math.max(2, Math.round(L * 1.4));
      for (let j = 0; j < nt; j++) {
        const t = 0.3 + 0.7 * (j / Math.max(1, nt - 1));
        const a = along(b, t);
        const sd = v3().crossVectors(a.d, UP).normalize().multiplyScalar(j % 2 ? 1 : -1);
        const d2 = a.d.clone().multiplyScalar(0.6).addScaledVector(sd, 0.8).normalize();
        d2.y = 0.05;
        const L2 = (0.35 + 0.45 * (1 - t)) * L * 0.45;
        const n2 = grow(R, a.p, d2, L2, { sections: 1, gnarl: 0.05, up: 0.02, r0: 0.01, r1: 0.006 });
        branches.push({ nodes: n2, level: 2, phase: b.phase, w0: b.w0 + b.wGain * t, wGain: 0.2, bark: BARK.smooth, tint, terminal: true, lod1: false });
        const tipP = n2[n2.length - 1].p;
        leaves.push({ p: tipP.clone().addScaledVector(UP, 0.04), up: d2, n: UP.clone().addScaledVector(R.unit(), 0.18).normalize(), size: R.f(0.75, 1.0) * (1 - k * 0.05), cell: CELL.terminalia, mode: 'rosette', w: b.w0 + b.wGain * t + 0.2, ph: b.phase + R.f(0, 0.2), tint: lt });
      }
      const tip = nodes[nodes.length - 1].p;
      leaves.push({ p: tip.clone().addScaledVector(UP, 0.05), up: dir, n: UP.clone().addScaledVector(R.unit(), 0.15).normalize(), size: R.f(0.9, 1.15) * (1 - k * 0.06), cell: CELL.terminalia, mode: 'rosette', w: 0.55, ph: b.phase, tint: lt });
    }
    y += R.f(0.95, 1.2);
  }
  const top = along(trunk, 1);
  leaves.push({ p: top.p, up: v3(1, 0, 0), n: UP.clone(), size: 0.8, cell: CELL.terminalia, mode: 'rosette', w: 0.4, ph: 0.1, tint: lt });
  return { branches, leaves, H, R: 3.1, trunkR: 0.13, bend: 0.35, aoMin: 0.62, leafFold: 0.6, lod1Leaf: { every: 2, scale: 1.4 } };
}

/** Frangipani (Plumeria): short thick trunk, forking blunt branches, leaf rosettes with white flowers at the tips. */
function candelabraTree(seed: number): Skeleton {
  const R = new Rand(seed);
  const branches: Branch[] = [];
  const leaves: Leaf[] = [];
  const tint: [number, number, number] = [0.92, 0.92, 0.88];
  const trunk: Branch = { nodes: grow(R, v3(0, -0.2, 0), UP.clone().addScaledVector(R.unit(), 0.12), 1.35, { sections: 3, gnarl: 0.05, up: 0, r0: 0.17, r1: 0.14 }), level: 0, phase: R.f(), w0: 0, wGain: 0, bark: BARK.mottled, tint, terminal: false, lod1: true };
  branches.push(trunk);
  const split = (from: Branch, level: number, dir0: V3) => {
    const end = from.nodes[from.nodes.length - 1];
    const k = level === 1 ? 3 : R.f() < 0.6 ? 2 : 3;
    const az0 = R.f(0, 6.28);
    for (let i = 0; i < k; i++) {
      const az = az0 + (i / k) * Math.PI * 2 + R.f(-0.4, 0.4);
      const d = tilt(dir0, THREE.MathUtils.degToRad(R.f(28, 42) + (level === 1 ? 12 : 0)), az);
      const L = (level === 1 ? 1.1 : level === 2 ? 0.95 : 0.7) * R.f(0.8, 1.15);
      const r0 = Math.max(0.045, end.r * 0.74);
      const nodes = grow(R, end.p, d, L, { sections: 3, gnarl: 0.06, up: 0.1, r0, r1: r0 * 0.85 });
      const b: Branch = { nodes, level, phase: R.f(), w0: from.w0 + from.wGain, wGain: 0.22, bark: BARK.mottled, tint, terminal: level === 3, lod1: level <= 2 };
      branches.push(b);
      const nd = nodes[nodes.length - 1].p.clone().sub(nodes[nodes.length - 2].p).normalize();
      if (level < 3) split(b, level + 1, nd);
      else {
        const tip = nodes[nodes.length - 1].p;
        const out = v3(tip.x, 0, tip.z).normalize();
        for (let q = 0; q < 3; q++) {
          // leaves splay up and outward from the blunt tip, so the rosettes read from eye height too
          const n = UP.clone().multiplyScalar(q === 2 ? 0.5 : 1.0).addScaledVector(out, 0.7 + q * 0.25).addScaledVector(nd, 0.3).addScaledVector(R.unit(), 0.45).normalize();
          leaves.push({ p: tip.clone().addScaledVector(nd, 0.05 + q * 0.07), up: v3().crossVectors(n, R.unit()).normalize(), n, size: R.f(1.0, 1.25) * (q ? 0.85 : 1), cell: CELL.frangipani, mode: 'rosette', w: b.w0 + b.wGain, ph: b.phase + q * 0.3, tint: [1, 1, 1] });
        }
      }
    }
  };
  split(trunk, 1, UP);
  return { branches, leaves, H: 4.6, R: 2.5, trunkR: 0.17, bend: 0.4, aoMin: 0.7, leafFold: 0.5, lod1Leaf: { every: 2, scale: 1.25 } };
}

/** Clumping areca palm: several slender ringed stems, green crown shafts, arching V-folded pinnate fronds. */
function palmClump(seed: number): Skeleton {
  const R = new Rand(seed);
  const branches: Branch[] = [];
  const leaves: Leaf[] = [];
  const stems = R.i(3, 5);
  let H = 0;
  for (let s = 0; s < stems; s++) {
    const az = (s / stems) * Math.PI * 2 + R.f(-0.4, 0.4);
    const base = v3(Math.cos(az) * R.f(0.12, 0.3), -0.15, Math.sin(az) * R.f(0.12, 0.3));
    const h = R.f(3.8, 6.6) * (s === 0 ? 1.1 : 1);
    H = Math.max(H, h);
    const dir = UP.clone().addScaledVector(v3(Math.cos(az), 0, Math.sin(az)), R.f(0.08, 0.2)).normalize();
    const nodes = grow(R, base, dir, h - 0.8, { sections: 8, gnarl: 0.02, up: 0.012, r0: 0.085, r1: 0.068 });
    const stem: Branch = { nodes, level: 0, phase: R.f(), w0: 0, wGain: 0.1, bark: BARK.palm, tint: [0.95, 0.93, 0.88], terminal: false, lod1: true };
    branches.push(stem);
    const top = nodes[nodes.length - 1];
    const sd = nodes[nodes.length - 1].p.clone().sub(nodes[nodes.length - 2].p).normalize();
    const shaft = grow(R, top.p, sd, 0.8, { sections: 2, gnarl: 0.01, up: 0.01, r0: 0.078, r1: 0.06 });
    branches.push({ nodes: shaft, level: 1, phase: stem.phase, w0: 0.1, wGain: 0.1, bark: BARK.smooth, tint: [0.62, 0.85, 0.42], terminal: false, lod1: true });
    const crownP = shaft[shaft.length - 1].p;
    const nf = R.i(7, 9);
    const faz = R.f(0, 6.28);
    for (let f = 0; f < nf; f++) {
      const a = faz + f * 2.4;
      const elev = THREE.MathUtils.degToRad(12 + 62 * (f / nf) + R.f(-6, 6));
      const L = R.f(1.8, 2.4) * (f < 2 ? 0.85 : 1);
      const d0 = v3(Math.sin(elev) * Math.cos(a), Math.cos(elev), Math.sin(elev) * Math.sin(a));
      const pts: V3[] = [];
      const p = crownP.clone().addScaledVector(UP, -0.05);
      const d = d0.clone();
      const segs = 8;
      for (let i = 0; i <= segs; i++) {
        pts.push(p.clone());
        d.y -= 0.12 + 0.1 * (i / segs);
        d.normalize();
        p.addScaledVector(d, L / segs);
      }
      leaves.push({ p: crownP, up: d0, n: UP, size: R.f(1.0, 1.25), cell: CELL.palmFrond, mode: 'frond', w: 0.5, ph: R.f(), tint: [0.92, 0.96, 0.88], rachis: pts, fold: R.f(0.55, 0.8) });
    }
    // spent frond hanging down + a spathe hint
    if (R.f() < 0.5) {
      const pts: V3[] = [];
      for (let i = 0; i <= 4; i++) pts.push(crownP.clone().add(v3(Math.cos(faz) * 0.15 * i, -0.35 * i, Math.sin(faz) * 0.15 * i)));
      leaves.push({ p: crownP, up: v3(0, -1, 0), n: UP, size: 0.6, cell: CELL.palmFrond, mode: 'frond', w: 0.2, ph: 0.2, tint: [0.75, 0.62, 0.4], rachis: pts, fold: 1.0 });
    }
  }
  return { branches, leaves, H: H + 0.5, R: 2.4, trunkR: 0.09, bend: 0.3, aoMin: 0.7, leafFold: 0, lod1Leaf: { every: 1, scale: 1 } };
}

// ------------------------------------------------------------------------------------------------ species

export type SpeciesKey = 'rain' | 'ashoka' | 'gulmohar' | 'copperpod' | 'palm' | 'cloud' | 'sapling' | 'maroon' | 'frangipani' | 'ficus';

const SPECS: Partial<Record<SpeciesKey, (v: number) => CrownSpec>> = {
  // Samanea saman: short trunk forking into massive spreading limbs, broad dome
  rain: (v) => ({
    H: 11.5, trunkH: 2.5 + v * 0.3, trunkR: 0.42, flare: 0.55, lean: 0.08, shell: 0.6,
    env: { cy: 7.7, rx: 9.2, ry: 3.8 },
    n1: [4, 5], a1: [40, 62], s1: [0.93, 1], len1: [0.62, 0.74], r1: 0.62, up1: -0.03,
    n2: [5, 7], a2: [45, 70], s2: [0.45, 1], len2: [0.75, 0.9], max2: 5.0, r2: 0.55, up2: 0.0,
    n3: [5, 6], a3: [30, 58], s3: [0.3, 1], max3: 1.7, up3: 0.03,
    leaf: { cell: CELL.rain, size: [1.25, 1.75], per: 3, start: 0.35, sky: -0.12 },
    bark: BARK.rough, barkTint: [0.85, 0.8, 0.76], leafTint: [0.92, 0.96, 0.9],
    bend: 0.75, aoMin: 0.45,
  }),
  // Delonix regia: flat spreading umbrella, feathery, a few red flower clusters
  gulmohar: (v) => ({
    H: 8.5, trunkH: 2.3 + v * 0.3, trunkR: 0.3, flare: 0.4, lean: 0.1,
    env: { cy: 5.8, rx: 7.0, ry: 2.4 }, shell: 0.55,
    n1: [4, 5], a1: [50, 68], s1: [0.93, 1], len1: [0.64, 0.76], r1: 0.62, up1: -0.02,
    n2: [5, 6], a2: [45, 68], s2: [0.45, 1], len2: [0.75, 0.9], max2: 4.0, r2: 0.55, up2: 0.0,
    n3: [4, 6], a3: [30, 55], s3: [0.35, 1], max3: 1.4, up3: 0.03,
    leaf: { cell: CELL.rain, flowerCell: CELL.gulmohar, flowerP: 0.25, size: [1.05, 1.45], per: 3, start: 0.35, sky: -0.18 },
    bark: BARK.smooth, barkTint: [0.9, 0.85, 0.8], leafTint: [1.08, 1.15, 0.92],
    bend: 0.75, aoMin: 0.5,
  }),
  // Peltophorum pterocarpum: rounded crown on a central leader, yellow panicles on top
  copperpod: (v) => ({
    H: 9.5, trunkH: 2.2, trunkR: 0.27, flare: 0.35, lean: 0.05, leaderTop: 6.8 + v * 0.4,
    env: { cy: 6.0, rx: 4.4, ry: 3.8 }, shell: 0.5,
    n1: [7, 9], a1: [42, 64], s1: [0.3, 0.92], len1: [0.72, 0.88], r1: 0.58, up1: 0.01,
    n2: [4, 5], a2: [36, 58], s2: [0.4, 1], len2: [0.75, 0.9], max2: 2.6, r2: 0.55, up2: 0.03,
    n3: [4, 5], a3: [30, 55], s3: [0.35, 1], max3: 1.2, up3: 0.06,
    leaf: { cell: CELL.rain, flowerCell: CELL.copperpod, flowerP: 0.22, size: [1.0, 1.35], per: 3, start: 0.35, sky: 0.25 },
    bark: BARK.smooth, barkTint: [0.95, 0.93, 0.9], leafTint: [0.92, 0.96, 0.9],
    bend: 0.75, aoMin: 0.45,
  }),
  // Ficus benjamina / microcarpa: dense dark dome, fused stems, aerial roots
  ficus: () => ({
    H: 10.5, trunkH: 2.6, trunkR: 0.5, flare: 0.5, lean: 0, trunks: 3, roots: 10,
    env: { cy: 6.8, rx: 6.8, ry: 4.4 }, shell: 0.55,
    n1: [2, 3], a1: [30, 58], s1: [0.9, 1], len1: [0.6, 0.72], r1: 0.7, up1: -0.01,
    n2: [6, 7], a2: [38, 62], s2: [0.4, 1], len2: [0.8, 0.92], max2: 4.2, r2: 0.55, up2: 0.02,
    n3: [5, 7], a3: [30, 60], s3: [0.3, 1], max3: 1.5, up3: 0.04,
    leaf: { cell: CELL.ficus, size: [1.15, 1.5], per: 4, start: 0.3 },
    bark: BARK.mottled, barkTint: [0.95, 0.93, 0.9], leafTint: [0.9, 0.95, 0.88],
    bend: 0.8, aoMin: 0.35,
  }),
  // young Tabebuia (palmate) / Pongamia (glossy pinnate) street saplings
  sapling: (v) => ({
    H: 4.6, trunkH: 1.6, trunkR: 0.075, flare: 0.2, lean: 0.06, leaderTop: 3.4 + v * 0.3,
    env: { cy: 3.3, rx: 1.45, ry: 1.45 },
    n1: [4, 6], a1: [24, 48], s1: [0.45, 0.95], len1: [0.8, 0.95], r1: 0.6, up1: 0.03,
    n2: [2, 3], a2: [30, 50], s2: [0.4, 1], len2: [0.8, 0.95], max2: 0.8, r2: 0.6, up2: 0.04,
    n3: [0, 0], a3: [30, 50], s3: [0.4, 1], max3: 0.5, up3: 0.05,
    leaf: { cell: v === 2 ? CELL.broadleaf : CELL.palmate, size: [0.55, 0.75], per: 2, start: 0.4 },
    bark: BARK.smooth, barkTint: [0.85, 0.8, 0.72], leafTint: [0.95, 1, 0.92],
    bend: 0.55, aoMin: 0.7, leavesOnL2: false, lod1: { every: 2, scale: 1.35 },
  }),
  maroon: () => ({
    H: 3.8, trunkH: 1.1, trunkR: 0.065, flare: 0.2, lean: 0.08,
    env: { cy: 2.7, rx: 1.25, ry: 1.15 },
    n1: [3, 4], a1: [22, 42], s1: [0.9, 1], len1: [0.75, 0.9], r1: 0.7, up1: 0.03,
    n2: [3, 4], a2: [30, 55], s2: [0.3, 1], len2: [0.85, 0.95], max2: 0.8, r2: 0.6, up2: 0.04,
    n3: [0, 0], a3: [30, 50], s3: [0.4, 1], max3: 0.5, up3: 0.05,
    leaf: { cell: CELL.maroon, size: [0.5, 0.66], per: 3, start: 0.3 },
    bark: BARK.smooth, barkTint: [0.78, 0.7, 0.66], leafTint: [1, 1, 1],
    bend: 0.6, aoMin: 0.65, lod1: { every: 2, scale: 1.35 },
  }),
};

export const SPECIES_VARIANTS: Record<SpeciesKey, number> = {
  rain: 3, ashoka: 2, gulmohar: 2, copperpod: 2, palm: 2, cloud: 2, sapling: 3, maroon: 2, frangipani: 2, ficus: 1,
};

/** Collision trunk radius at scale 1. */
export const TRUNK_R: Record<SpeciesKey, number> = {
  rain: 0.42, ashoka: 0.16, gulmohar: 0.3, copperpod: 0.27, palm: 0.3, cloud: 0.13, sapling: 0.075, maroon: 0.065, frangipani: 0.17, ficus: 0.55,
};

function skeletonFor(sp: SpeciesKey, variant: number): Skeleton {
  const seed = 1000 + variant * 7919 + sp.length * 131 + sp.charCodeAt(0) * 17;
  switch (sp) {
    case 'ashoka': return columnTree(seed, 9.5 + variant * 0.8);
    case 'cloud': return tieredTree(seed, 8.2 + variant * 0.6);
    case 'frangipani': return candelabraTree(seed);
    case 'palm': return palmClump(seed);
    default: return crown(SPECS[sp]!(variant), seed);
  }
}

const LOD0_SEGS = [9, 6, 4, 3];
const LOD1_SEGS = [6, 4, 3, 3];

export function generateTree(sp: SpeciesKey, variant: number): TreeModel {
  const sk = skeletonFor(sp, variant);
  const build = (lod: 0 | 1): TreeLOD => {
    const bark = new Geo();
    for (const b of sk.branches) {
      if (lod === 1 && !b.lod1) continue;
      const segs = (lod === 0 ? LOD0_SEGS : LOD1_SEGS)[Math.min(3, b.level)];
      const thin = b.nodes[0].r < 0.03;
      tube(bark, b, thin ? Math.min(segs, 3) : segs, lod === 1 && b.nodes.length > 4 ? 2 : 1, b.level > 0 && b.nodes[b.nodes.length - 1].r > 0.03);
    }
    const leaves = new Geo();
    const every = lod === 0 ? 1 : sk.lod1Leaf.every;
    const scale = lod === 0 ? 1 : sk.lod1Leaf.scale;
    sk.leaves.forEach((L, i) => {
      if (i % every !== 0 && L.mode !== 'frond') return;
      if (L.mode === 'frond' && lod === 1 && L.rachis) {
        const r = L.rachis.filter((_, k) => k % 2 === 0);
        leafCard(leaves, { ...L, rachis: r }, 1, 0);
      } else leafCard(leaves, L, scale, lod === 0 ? sk.leafFold : 0);
    });
    shadeLeaves(leaves, 0, sk.bend, sk.aoMin);
    return { bark: bark.finish(sk.H), leaves: leaves.finish(sk.H) };
  };
  return { lod0: build(0), lod1: build(1), height: sk.H, radius: sk.R, trunkR: sk.trunkR };
}
