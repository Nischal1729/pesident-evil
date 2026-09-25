import * as THREE from 'three';
import { normalizeWinding, polyBounds, rng } from './geom';
import type { DetailKey, WorldKit } from './kit';
import type { V2 } from './layout';

/**
 * Accumulates geometry into big merged buffers (one per material + spatial chunk)
 * so the entire campus renders in a handful of draw calls.
 */
export class GeoBuffer {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  fac: number[] = [];
  idx: number[] = [];
  withColor: boolean;
  withFacade: boolean;

  constructor(opts: { color?: boolean; facade?: boolean } = {}) {
    this.withColor = !!opts.color;
    this.withFacade = !!opts.facade;
  }

  get vertexCount(): number { return this.pos.length / 3; }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c?: THREE.Color, f?: [number, number, number, number]): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    if (this.withColor) this.col.push(c ? c.r : 1, c ? c.g : 1, c ? c.b : 1);
    if (this.withFacade) { const ff = f ?? [3.5, 3.5, 0, 0]; this.fac.push(ff[0], ff[1], ff[2], ff[3]); }
    return this.pos.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Axis-aligned or rotated box. center (x,y,z) is the box centre; rotY radians. UVs in metres * uvScale. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0, c?: THREE.Color, uvScale = 1, skipBottom = false): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const tr = (x: number, z: number): [number, number] => [cx + x * cs + z * sn, cz - x * sn + z * cs];
    const faces: { n: [number, number, number]; v: [number, number, number][]; w: number; h: number }[] = [
      { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], w: sz, h: sy },
      { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], w: sz, h: sy },
      { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], w: sx, h: sz },
      { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], w: sx, h: sz },
      { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], w: sx, h: sy },
      { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], w: sx, h: sy },
    ];
    for (let fi = 0; fi < 6; fi++) {
      if (skipBottom && fi === 3) continue;
      const f = faces[fi];
      const nx = f.n[0] * cs + f.n[2] * sn, nz = -f.n[0] * sn + f.n[2] * cs;
      const ids = f.v.map(([x, y, z], i) => {
        const [wx, wz] = tr(x, z);
        const u = (i === 1 || i === 2 ? f.w : 0) * uvScale;
        const v = (i >= 2 ? f.h : 0) * uvScale;
        return this.vert(wx, cy + y, wz, nx, f.n[1], nz, u, v, c);
      });
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  /** Box spanning segment a→b (plan), from y0 to y1, `thick` wide, centred on the segment (offset shifts it sideways). */
  segBox(a: V2, b: V2, y0: number, y1: number, thick: number, c?: THREE.Color, offset = 0, extend = 0, uvScale = 1): void {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const nx = -dz / len, nz = dx / len;
    const cx = (a[0] + b[0]) / 2 + nx * offset, cz = (a[1] + b[1]) / 2 + nz * offset;
    this.box(cx, (y0 + y1) / 2, cz, len + extend, y1 - y0, thick, Math.atan2(-dz, dx), c, uvScale);
  }

  /** Square-section beam between two 3D points (trusses, braces, pergola members). */
  beam(p0: [number, number, number], p1: [number, number, number], tw: number, th: number, c?: THREE.Color): void {
    const ax = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = ax.length();
    if (len < 1e-5) return;
    ax.divideScalar(len);
    const ref = Math.abs(ax.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3().crossVectors(ax, ref).normalize().multiplyScalar(tw / 2);
    const t = new THREE.Vector3().crossVectors(s, ax).normalize().multiplyScalar(th / 2);
    const P0 = new THREE.Vector3(...p0), P1 = new THREE.Vector3(...p1);
    const corners = (P: THREE.Vector3) => [
      P.clone().sub(s).sub(t), P.clone().add(s).sub(t), P.clone().add(s).add(t), P.clone().sub(s).add(t),
    ];
    const A = corners(P0), B = corners(P1);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const face = (q: THREE.Vector3[], n: THREE.Vector3) => {
      e1.subVectors(q[1], q[0]); e2.subVectors(q[3], q[0]);
      if (e1.cross(e2).dot(n) < 0) q = [q[0], q[3], q[2], q[1]];
      const ids = q.map((v, i) => this.vert(v.x, v.y, v.z, n.x, n.y, n.z, i === 1 || i === 2 ? len : 0, i >= 2 ? 1 : 0, c));
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    };
    const sn = s.clone().normalize(), tn = t.clone().normalize();
    face([A[0], B[0], B[3], A[3]], sn.clone().negate());
    face([A[1], A[2], B[2], B[1]], sn);
    face([A[0], A[1], B[1], B[0]], tn.clone().negate());
    face([A[3], B[3], B[2], A[2]], tn);
    face([A[0], A[3], A[2], A[1]], ax.clone().negate());
    face([B[0], B[1], B[2], B[3]], ax);
  }

  cylinder(cx: number, y0: number, cz: number, r: number, h: number, seg: number, c?: THREE.Color, capTop = true): void {
    const base = this.vertexCount;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      this.vert(cx + x * r, y0, cz + z * r, x, 0, z, (i / seg) * 2 * Math.PI * r, 0, c);
      this.vert(cx + x * r, y0 + h, cz + z * r, x, 0, z, (i / seg) * 2 * Math.PI * r, h, c);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.quad(a, a + 1, a + 3, a + 2);
    }
    if (capTop) {
      const center = this.vert(cx, y0 + h, cz, 0, 1, 0, 0, 0, c);
      const ring: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(this.vert(cx + Math.cos(a) * r, y0 + h, cz + Math.sin(a) * r, 0, 1, 0, Math.cos(a) * r, Math.sin(a) * r, c));
      }
      for (let i = 0; i < seg; i++) this.tri(center, ring[i + 1], ring[i]);
    }
  }

  /** Flat horizontal polygon at height y (facing up, or down when `down`). UVs = world xz / uvScale. */
  flatPoly(poly: V2[], y: number, c?: THREE.Color, uvScale = 1, down = false): void {
    const p = normalizeWinding(poly);
    const tris = THREE.ShapeUtils.triangulateShape(p.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const base = this.vertexCount;
    for (const [x, z] of p) this.vert(x, y, z, 0, down ? -1 : 1, 0, x / uvScale, -z / uvScale, c);
    for (const [a, b, cc] of tris) {
      const cross = (p[b][0] - p[a][0]) * (p[cc][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[cc][0] - p[a][0]);
      const up = cross < 0;
      if (up !== down) this.tri(base + a, base + b, base + cc); else this.tri(base + a, base + cc, base + b);
    }
  }

  /** Vertical quad from (a, y0) to (b, y1) facing the left-hand normal of a→b (or both sides). */
  wallQuad(a: V2, b: V2, y0: number, y1: number, c?: THREE.Color, uvScale = 1, doubleSided = false, u0 = 0): void {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return;
    const nx = -dz / len, nz = dx / len;
    const put = (sgn: number) => {
      const i0 = this.vert(a[0], y0, a[1], nx * sgn, 0, nz * sgn, u0 * uvScale, y0 * uvScale, c);
      const i1 = this.vert(b[0], y0, b[1], nx * sgn, 0, nz * sgn, (u0 + len) * uvScale, y0 * uvScale, c);
      const i2 = this.vert(b[0], y1, b[1], nx * sgn, 0, nz * sgn, (u0 + len) * uvScale, y1 * uvScale, c);
      const i3 = this.vert(a[0], y1, a[1], nx * sgn, 0, nz * sgn, u0 * uvScale, y1 * uvScale, c);
      if (sgn > 0) this.quad(i0, i1, i2, i3); else this.quad(i0, i3, i2, i1);
    };
    put(1);
    if (doubleSided) put(-1);
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.withFacade) g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fac, 4));
    const idx = this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1);
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface ExtrudeOpts {
  base: number;
  height: number; // top - base
  floorH: number;
  floors: number;
  seed: number;
  color?: THREE.Color;
  parapet: number;
  bottom?: boolean;
}

/**
 * Walls into `walls` (facade buffer), roof + parapet caps into `roof`, underside (overhangs) into `bottomBuf`.
 * Facade attribute = (floorH, topY, seed, baseY).
 */
export function extrudeBuilding(poly: V2[], o: ExtrudeOpts, walls: GeoBuffer, roof: GeoBuffer, bottomBuf?: GeoBuffer): void {
  const p = normalizeWinding(poly);
  const n = p.length;
  const top = o.base + o.height;
  const wallTop = top + o.parapet;
  const fac: [number, number, number, number] = [o.floorH, top, o.seed, o.base];
  let u = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[(i + 1) % n];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = -dz / len, nz = dx / len;
    const h = wallTop - o.base;
    const a0 = walls.vert(ax, o.base, az, nx, 0, nz, u, 0, o.color, fac);
    const b0 = walls.vert(bx, o.base, bz, nx, 0, nz, u + len, 0, o.color, fac);
    const b1 = walls.vert(bx, wallTop, bz, nx, 0, nz, u + len, h, o.color, fac);
    const a1 = walls.vert(ax, wallTop, az, nx, 0, nz, u, h, o.color, fac);
    walls.quad(a0, b0, b1, a1);
    u += len;
    // round u to bay-friendly offsets per edge so windows don't straddle corners badly
    u = Math.ceil(u / 0.6) * 0.6;
  }
  const contour = p.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const rbase = roof.vertexCount;
  for (const [x, z] of p) roof.vert(x, top, z, 0, 1, 0, x / 4, z / 4);
  for (const t of tris) {
    const [a, b, c] = t;
    const ax = p[a][0], az = p[a][1], bx = p[b][0], bz = p[b][1], cx = p[c][0], cz = p[c][1];
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (cross < 0) roof.tri(rbase + a, rbase + b, rbase + c);
    else roof.tri(rbase + a, rbase + c, rbase + b);
  }
  if (o.bottom) {
    const bot = bottomBuf ?? roof;
    const bb = bot.vertexCount;
    for (const [x, z] of p) bot.vert(x, o.base, z, 0, -1, 0, x / 2, z / 2);
    for (const t of tris) {
      const [a, b, c] = t;
      const ax = p[a][0], az = p[a][1], bx = p[b][0], bz = p[b][1], cx = p[c][0], cz = p[c][1];
      const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (cross < 0) bot.tri(bb + a, bb + c, bb + b);
      else bot.tri(bb + a, bb + b, bb + c);
    }
  }
  if (o.parapet > 0.05) {
    const inset = 0.25;
    for (let i = 0; i < n; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[(i + 1) % n];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = -dz / len, nz = dx / len; // outward
      const ix = -nx * inset, iz = -nz * inset;
      const v0 = roof.vert(bx + ix, top, bz + iz, -nx, 0, -nz, 0, 0);
      const v1 = roof.vert(ax + ix, top, az + iz, -nx, 0, -nz, len / 4, 0);
      const v2 = roof.vert(ax + ix, wallTop, az + iz, -nx, 0, -nz, len / 4, o.parapet / 4);
      const v3 = roof.vert(bx + ix, wallTop, bz + iz, -nx, 0, -nz, 0, o.parapet / 4);
      roof.quad(v0, v1, v2, v3);
      const c0 = roof.vert(ax, wallTop, az, 0, 1, 0, 0, 0);
      const c1 = roof.vert(bx, wallTop, bz, 0, 1, 0, len / 4, 0);
      const c2 = roof.vert(bx + ix, wallTop, bz + iz, 0, 1, 0, len / 4, 0.06);
      const c3 = roof.vert(ax + ix, wallTop, az + iz, 0, 1, 0, 0, 0.06);
      roof.quad(c0, c1, c2, c3);
    }
  }
}

/** Horizontal ledges / fascia bands protruding from the facade at the given heights. */
export function addLedgesAt(poly: V2[], ys: number[], depth: number, thick: number, buf: GeoBuffer, color: THREE.Color, minLen = 2, edgeFilter?: (a: V2, b: V2, nx: number, nz: number) => boolean): void {
  const p = normalizeWinding(poly);
  const n = p.length;
  for (const y of ys) {
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < minLen) continue;
      const nx = -dz / len, nz = dx / len;
      if (edgeFilter && !edgeFilter(a, b, nx, nz)) continue;
      const cx = (a[0] + b[0]) / 2 + nx * depth / 2, cz = (a[1] + b[1]) / 2 + nz * depth / 2;
      buf.box(cx, y - thick / 2, cz, len + depth * 1.2, thick, depth, Math.atan2(-dz, dx), color, 0.25);
    }
  }
}

/** Horizontal floor ledges / sunshade slabs (chajjas) protruding from the facade. */
export function addLedges(poly: V2[], base: number, floorH: number, floors: number, depth: number, thick: number, buf: GeoBuffer, color: THREE.Color, every = 1): void {
  const ys: number[] = [];
  for (let f = 1; f <= floors; f += every) ys.push(base + f * floorH);
  addLedgesAt(poly, ys, depth, thick, buf, color);
}

/** Rooftop clutter: black Sintex-style water tanks, solar panels, stair cabins. */
export function roofClutter(poly: V2[], top: number, seed: number, opts: { tanks?: number; solar?: boolean }, tanks: THREE.Matrix4[], solar: THREE.Matrix4[], cabins: GeoBuffer, cabinColor: THREE.Color): void {
  const r = rng(seed * 7919 + 13);
  const b = polyBounds(poly);
  const p = normalizeWinding(poly);
  const inside = (x: number, z: number, m: number) => {
    let ins = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i], [xj, zj] = p[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    if (!ins) return false;
    for (let i = 0; i < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < m) return false;
    }
    return true;
  };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let tries = 0; tries < 20; tries++) {
    const x = b.minX + r() * (b.maxX - b.minX), z = b.minZ + r() * (b.maxZ - b.minZ);
    const w = 3 + r() * 3, d = 3 + r() * 2;
    if (inside(x, z, Math.max(w, d) * 0.7 + 0.5)) {
      cabins.box(x, top + 1.5, z, w, 3, d, 0, cabinColor, 0.5);
      for (let k = 0; k < 2; k++) {
        const tr = 0.7 + r() * 0.25;
        s.set(tr, 1.2 + r() * 0.3, tr);
        v.set(x + (k - 0.5) * w * 0.45, top + 3, z);
        m4.compose(v, q.identity(), s);
        tanks.push(m4.clone());
      }
      break;
    }
  }
  const nT = opts.tanks ?? 0;
  for (let k = 0, tries = 0; k < nT && tries < 60; tries++) {
    const x = b.minX + r() * (b.maxX - b.minX), z = b.minZ + r() * (b.maxZ - b.minZ);
    if (!inside(x, z, 1.6)) continue;
    const tr = 0.65 + r() * 0.35;
    s.set(tr, 1.1 + r() * 0.5, tr);
    v.set(x, top, z);
    m4.compose(v, q.identity(), s);
    tanks.push(m4.clone());
    if (r() < 0.6) { v.x += tr * 2.3; m4.compose(v, q, s); tanks.push(m4.clone()); }
    k++;
  }
  if (opts.solar) {
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.23, 0, 0));
    for (let z = b.minZ + 2; z < b.maxZ - 2; z += 2.6)
      for (let x = b.minX + 2; x < b.maxX - 2; x += 2.1) {
        if (!inside(x, z, 1.4) || r() < 0.15) continue;
        v.set(x, top + 0.6, z);
        s.set(1.95, 0.05, 1.1);
        m4.compose(v, tilt, s);
        solar.push(m4.clone());
      }
  }
}

// -------------------------------------------------------------------------------------------------
// Enterable interiors
// -------------------------------------------------------------------------------------------------

/** Always-on ceiling light panels (unlit, a touch over-bright so they read as lamps by day and bloom at night). */
let panelMat: THREE.MeshBasicMaterial | null = null;
export function lightPanelMaterial(): THREE.MeshBasicMaterial {
  return (panelMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.44, 1.32), toneMapped: true }));
}
/** See-through glazing for real openings (the kit's 'glass' key is opaque, facade-style). */
let seeThrough: THREE.MeshStandardMaterial | null = null;
export function seeThroughGlassMaterial(): THREE.MeshStandardMaterial {
  return (seeThrough ??= new THREE.MeshStandardMaterial({ color: 0xaec2cc, roughness: 0.04, metalness: 0.25, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
}

/**
 * Rectangular building frame for interiors laid out on a rotated grid: `s` runs along `u`, `t` along `n` (both unit,
 * perpendicular), from `origin`. Boxes built through it are aligned with the frame (box x = s, box z = t).
 */
export class PlanFrame {
  readonly rot: number;
  constructor(public origin: V2, public u: V2, public n: V2) {
    // box local x maps to (cos r, −sin r) and local z to (sin r, cos r): x = u; z = ±n (boxes are symmetric in z)
    this.rot = Math.atan2(-u[1], u[0]);
  }
  at(s: number, t: number): V2 { return [this.origin[0] + this.u[0] * s + this.n[0] * t, this.origin[1] + this.u[1] * s + this.n[1] * t]; }
  rect(s0: number, t0: number, s1: number, t1: number): V2[] { return [this.at(s0, t0), this.at(s1, t0), this.at(s1, t1), this.at(s0, t1)]; }
  /** Plan polygon from local points. */
  poly(pts: [number, number][]): V2[] { return pts.map(([s, t]) => this.at(s, t)); }
}

/**
 * Merged-geometry builder for one enterable interior: one buffer per kit material key (shared materials) plus light
 * panels and see-through glass. `build()` adds a THREE.LOD that shows the interior near the camera and `far` (a cheap
 * stand-in, e.g. an opaque dark glass front) beyond `cullDist`, so the interior costs nothing from across the campus.
 * Interiors receive shadows; only the keys in `castKeys` (walls / slabs) cast them.
 */
export class InteriorKit {
  bufs = new Map<string, GeoBuffer>();
  lights = new GeoBuffer();
  glass = new GeoBuffer();
  /** Extra objects shown with the interior (e.g. a sign mesh with its own small canvas texture). */
  extras: THREE.Object3D[] = [];
  constructor(public kit: WorldKit, public f: PlanFrame) {}
  b(key: DetailKey): GeoBuffer {
    let g = this.bufs.get(key);
    if (!g) this.bufs.set(key, (g = new GeoBuffer({ color: true })));
    return g;
  }
  /** World-space box (rot about Y). */
  box(key: DetailKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rot = 0, c?: THREE.Color, uv = 1): void {
    this.b(key).box(cx, cy, cz, sx, sy, sz, rot, c, uv);
  }
  /** Frame-aligned box spanning s0..s1, y0..y1, t0..t1. */
  fbox(key: DetailKey, s0: number, y0: number, t0: number, s1: number, y1: number, t1: number, c?: THREE.Color, uv = 1): void {
    const p = this.f.at((s0 + s1) / 2, (t0 + t1) / 2);
    this.b(key).box(p[0], (y0 + y1) / 2, p[1], Math.abs(s1 - s0), Math.abs(y1 - y0), Math.abs(t1 - t0), this.f.rot, c, uv);
  }
  /** Frame-aligned light panel. */
  flight(s: number, y: number, t: number, ds: number, dt: number): void {
    const p = this.f.at(s, t);
    this.lights.box(p[0], y, p[1], ds, 0.03, dt, this.f.rot);
  }
  /** Vertical see-through pane from frame point (s0,t0) to (s1,t1), y0..y1. */
  fpane(s0: number, t0: number, s1: number, t1: number, y0: number, y1: number): void {
    this.glass.wallQuad(this.f.at(s0, t0), this.f.at(s1, t1), y0, y1);
  }
  /** Horizontal polygon (frame coordinates) facing up (or down). */
  fflat(key: DetailKey, pts: [number, number][], y: number, c?: THREE.Color, uv = 2, down = false): void {
    this.b(key).flatPoly(this.f.poly(pts), y, c, uv, down);
  }
  /**
   * Wall along the frame from (s0,t0) to (s1,t1), `thick` wide on its left (+) or right (−) side (`side`), y0..y1,
   * with rectangular openings given as [a0, a1, oy0, oy1] in metres along the wall. Adds the collision (one prism per
   * solid run of full height, lintels / sills as prisms with a base) unless `tag` is null.
   */
  wall(key: DetailKey, s0: number, t0: number, s1: number, t1: number, y0: number, y1: number, thick: number, c: THREE.Color, openings: [number, number, number, number][] = [], tag: string | null = 'wall:int', side = 1): void {
    const a = this.f.at(s0, t0), b = this.f.at(s1, t1);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) return;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const nx = -dz * side, nz = dx * side; // the side the wall thickness goes to
    const at = (d: number, o: number): V2 => [a[0] + dx * d + nx * o, a[1] + dz * d + nz * o];
    const rot = Math.atan2(-dz, dx);
    const piece = (d0: number, d1: number, py0: number, py1: number) => {
      if (d1 - d0 < 0.01 || py1 - py0 < 0.01) return;
      const m = at((d0 + d1) / 2, thick / 2);
      this.b(key).box(m[0], (py0 + py1) / 2, m[1], d1 - d0, py1 - py0, thick, rot, c, 0.5);
      if (tag !== null) this.kit.collision.addPolygon([at(d0, 0), at(d1, 0), at(d1, thick), at(d0, thick)], py1 - py0, 'concrete', tag, py0);
    };
    const ops = openings.map(([o0, o1, oy0, oy1]) => [Math.max(0, o0), Math.min(len, o1), Math.max(y0, oy0), Math.min(y1, oy1)] as const).sort((p, q) => p[0] - q[0]);
    let d = 0;
    for (const [o0, o1, oy0, oy1] of ops) {
      piece(d, o0, y0, y1);
      piece(o0, o1, y0, oy0); // sill
      piece(o0, o1, oy1, y1); // lintel
      d = o1;
    }
    piece(d, len, y0, y1);
  }
  /** Kit keys whose geometry casts shadows (walls and slabs, so no sunlight leaks in under the shells). */
  castKeys = new Set<string>();
  meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const add = (geo: GeoBuffer, mat: THREE.Material, name: string, receive: boolean) => {
      if (!geo.vertexCount) return;
      const m = new THREE.Mesh(geo.toGeometry(), mat);
      m.name = name;
      m.receiveShadow = receive;
      m.castShadow = this.castKeys.has(name.slice(3));
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      out.push(m);
    };
    for (const [k, g] of this.bufs) add(g, this.kit.material(k), `ik:${k}`, true);
    add(this.lights, lightPanelMaterial(), 'ik:lights', false);
    if (this.glass.vertexCount) {
      const m = new THREE.Mesh(this.glass.toGeometry(), seeThroughGlassMaterial());
      m.name = 'ik:glass'; m.renderOrder = 3; m.matrixAutoUpdate = false; m.updateMatrix();
      out.push(m);
    }
    return out;
  }
  /** Distance-culled LOD at `center` (geometry stays in world coordinates). */
  build(name: string, center: V2, cullDist: number, far?: THREE.Object3D): THREE.LOD {
    const near = new THREE.Group();
    near.name = `${name}:near`;
    for (const m of this.meshes()) near.add(m);
    for (const o of this.extras) near.add(o);
    near.position.set(-center[0], 0, -center[1]);
    const lod = new THREE.LOD();
    lod.name = name;
    lod.position.set(center[0], 0, center[1]);
    lod.addLevel(near, 0);
    const farObj = far ?? new THREE.Object3D();
    farObj.position.set(-center[0], 0, -center[1]);
    lod.addLevel(farObj, cullDist);
    this.kit.group.add(lod);
    return lod;
  }
}
