import * as THREE from 'three';
import { normalizeWinding, polyBounds, rng } from './geom';
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
