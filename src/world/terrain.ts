import * as THREE from 'three';
import type { StaticCollision } from '../sim/Collision';
import { GeoBuffer } from './buildings';
import { pointInPoly } from './geom';
import { slopeY, TERRAIN, WALLS, WORLD_BOUNDS, type V2 } from './layout';

/**
 * The campus slope (layout.ts TERRAIN; the user, 2026-09-25): the ground falls from the main gate towards GJB, so the
 * entry corridor, the gate forecourt, the PES Lawn and the Ring Road near the gate stand one storey above GJB level.
 *
 * The world is authored on flat ground (y = 0) and lifted once after it is built (applyTerrain):
 *  - static geometry is lifted vertex by vertex, after triangles that cross a change in height are subdivided, so a
 *    retaining edge stays sharp instead of smearing a slope across a big ground triangle;
 *  - static instanced meshes are lifted per instance, and systems that rebuild their instance buffers at run time
 *    (trees, props) get their source matrices lifted through their own hooks;
 *  - collision prisms and cylinders get their base (ramps: both ends) lifted, then the raised ground is added as
 *    solid 'terrain' prisms (flat plateau, sloped ramps);
 *  - vertical retaining faces are drawn along every edge where the ground steps down, with parapets where people
 *    could walk off a drop into a public area.
 * Structures already built at their raised heights (the 2-wheeler parking, the front ramp, the plaza terrace and its
 * stair) sit in exclusion zones and are left alone. The sim reads terrainY for spawn and station heights.
 */
const H = TERRAIN.h;
let enabled = true;
/** Off in the legacy flat sim (?flat): everything stays at y = 0. */
export function setTerrainEnabled(on: boolean): void { enabled = on; }

// ------------------------------------------------------------------------------------------------ shapes
/** The Ring Road wall (the stone wall running WNW from the gate's ring-road return), offset out past its outer face. */
function orrWallOutside(d: number): V2[] {
  const w = WALLS.find((q) => q.pts.some((p) => p[0] === 107.2 && p[1] === -180.2));
  if (!w) return [[TERRAIN.orrX1, -164.3], [TERRAIN.orrX0, -186.4]];
  const pts = w.pts;
  const nrm = (a: V2, b: V2): V2 => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; }; // outside = left
  const off: V2[] = pts.map((p, i) => {
    const nIn = i > 0 ? nrm(pts[i - 1], p) : null, nOut = i < pts.length - 1 ? nrm(p, pts[i + 1]) : null;
    let nx: number, nz: number;
    if (nIn && nOut) {
      nx = nIn[0] + nOut[0]; nz = nIn[1] + nOut[1];
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const cs = nx * nOut[0] + nz * nOut[1] || 1; nx /= cs; nz /= cs;
    } else [nx, nz] = (nIn ?? nOut)!;
    return [p[0] + nx * d, p[1] + nz * d];
  });
  // the stretch between orrX1 and orrX0 (the wall runs with x decreasing)
  const out: V2[] = [];
  const atX = (a: V2, b: V2, x: number): V2 => { const t = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + (b[1] - a[1]) * t]; };
  for (let i = 0; i < off.length - 1; i++) {
    const a = off[i], b = off[i + 1];
    const hi = Math.max(a[0], b[0]), lo = Math.min(a[0], b[0]);
    if (hi < TERRAIN.orrX0 || lo > TERRAIN.orrX1) continue;
    if (!out.length) out.push(a[0] > TERRAIN.orrX1 ? atX(a, b, TERRAIN.orrX1) : a);
    if (b[0] >= TERRAIN.orrX0) out.push(b); else { out.push(atX(a, b, TERRAIN.orrX0)); break; }
  }
  return out;
}
const WALL_OUT = orrWallOutside(0.55);
const XM = WORLD_BOUNDS.maxX + 8, ZM = WORLD_BOUNDS.minZ - 8;
/**
 * Raised ground at H: the entry corridor east of the road slope (walkway above the reflecting pool, the parking yard
 * approach, the road to the gate), the gate forecourt inside and out with the admission building, the Ring Road east of
 * orrX1, and the PES Lawn up to the Ring Road wall (the wall stands on it) with the plaza terrace on its south-west.
 * Its south edge follows the pool's retaining wall, the parking's north face (a notch for the lane mouth) and the east
 * boundary wall; its west edge the PES Lawn (x 96), the terrace's north side and the plaza's east edge (x 114).
 */
const PLATEAU: V2[] = [
  [TERRAIN.slopeX1, -110.2], [119.6, -110.2], [119.6, -111.35], [133.99, -111.35], [133.99, -111.0], [137.5, -111.0],
  [137.5, -111.35], [137.95, -111.35], [137.95, -110.5], [156.2, -110.5], [156.2, -106.4], [XM, -106.4], [XM, ZM],
  [TERRAIN.orrX1, ZM], ...WALL_OUT, [TERRAIN.orrX0, -162], [114, -162], [114, -139.5], [TERRAIN.slopeX1, -139.5],
]; // (the plaza terrace, built at H, is notched out: x 96 … 114, z −162 … −153.4)
/** The entry road with its walkways and the PES Lawn promenade, sloping down west to GJB level (slopeY). */
const SLOPE: V2[] = [
  [TERRAIN.slopeX0, -139.5], [TERRAIN.slopeX1, -139.5], [TERRAIN.slopeX1, -110.2], [104, -110.2], [104, -117.5], [TERRAIN.slopeX0, -117.5],
];
/** The Ring Road outside the PES Lawn stretch of the wall, sloping down west from orrX1 to orrX0. */
const ORR_SLOPE: V2[] = [...WALL_OUT, [TERRAIN.orrX0, ZM], [TERRAIN.orrX1, ZM]];
const orrSlopeY = (x: number) => H * Math.min(1, Math.max(0, (x - TERRAIN.orrX0) / (TERRAIN.orrX1 - TERRAIN.orrX0)));
/** Built at their raised heights already: never lifted. [x0, z0, x1, z1] */
const EXCLUDE: [number, number, number, number][] = [
  [119.5, -111.36, 137.6, -29.5], // 2-wheeler parking (yard at road level, -1 floor at lawn level)
  [91, -136.8, 110.05, -131.55], // front ramp (foot at slopeY(xFoot))
  [95.9, -162.2, 114.1, -153.3], // plaza terrace (podium at H)
  [102.1, -153.4, 108.9, -148.0], // its stair up from the plaza
];
const REGION_X0 = Math.min(TERRAIN.slopeX0, TERRAIN.orrX0) - 0.1, REGION_Z1 = -106.3;

/** Ground height of the campus at (x, z): 0 at GJB level, H on the raised ground, in between on the slopes. */
export function terrainY(x: number, z: number): number {
  if (!enabled || x < REGION_X0 || z > REGION_Z1) return 0;
  if (pointInPoly(x, z, PLATEAU)) return H;
  if (pointInPoly(x, z, SLOPE)) return slopeY(x);
  if (pointInPoly(x, z, ORR_SLOPE)) return orrSlopeY(x);
  return 0;
}
function excluded(x: number, z: number): boolean {
  for (const [x0, z0, x1, z1] of EXCLUDE) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
  return false;
}
/** How far something standing at (x, z) on the flat-authored world is lifted (0 inside the exclusion zones). */
export function liftY(x: number, z: number): number {
  return excluded(x, z) ? 0 : terrainY(x, z);
}

// ------------------------------------------------------------------------------------------------ collision
function liftCollision(col: StaticCollision): void {
  for (const P of col.prisms) {
    if (P.tag === 'terrain') continue;
    let cx = 0, cz = 0;
    for (let i = 0; i < P.n; i++) { cx += P.pts[i * 2]; cz += P.pts[i * 2 + 1]; }
    cx /= P.n; cz /= P.n;
    if (excluded(cx, cz)) continue;
    if (P.ramp) {
      const R = P.ramp; // top = y0 at (ax, az) … y1 at (ax + dx, az + dz)
      const d0 = liftY(R.ax, R.az), d1 = liftY(R.ax + R.dx, R.az + R.dz);
      if (!d0 && !d1) continue;
      const solid = P.base === 0;
      R.y0 += d0; R.y1 += d1;
      R.slope = Math.abs(R.y1 - R.y0) * Math.sqrt(R.inv);
      if (solid) P.height = Math.max(R.y0, R.y1);
      else { P.base += Math.min(d0, d1); P.height = Math.max(R.y0, R.y1) - P.base; }
      continue;
    }
    const dy = terrainY(cx, cz);
    if (dy) P.base += dy;
  }
  for (const C of col.cyls) {
    const dy = liftY(C.x, C.z);
    if (dy) C.base += dy;
  }
}

function addTerrainCollision(col: StaticCollision): void {
  col.addPolygon(PLATEAU, H, 'concrete', 'terrain');
  const zs = (SLOPE[0][1] + SLOPE[2][1]) / 2;
  col.addRamp(SLOPE, [TERRAIN.slopeX0, zs], [TERRAIN.slopeX1, zs], 0, H, 'concrete', 'terrain');
  col.addRamp(ORR_SLOPE, [TERRAIN.orrX0, -230], [TERRAIN.orrX1, -230], 0, H, 'concrete', 'terrain');
}

// ------------------------------------------------------------------------------------------------ geometry lift
const MIN_EDGE = 0.3, COARSE_EDGE = 12, MAX_DEPTH = 24;
const inRegion = (x: number, z: number) => x >= REGION_X0 - 4 && z <= REGION_Z1 + 4;

/**
 * Lift a geometry onto the terrain vertex by vertex. Triangles whose edges cross a change in ground height (or that are
 * big and inside the terrain region) are first subdivided, edge by edge, so no cracks open between neighbours. A small
 * triangle still straddling a step (a retaining edge) is drawn twice, flat at the top and flat at the bottom, instead of
 * as a steep sliver: the retaining face drawn along the edge covers the step. `f` is the lift in the local frame.
 * Returns the number of vertices added (0 and untouched if nothing in it moves).
 */
function liftGeometry(g: THREE.BufferGeometry, f: (x: number, z: number) => number): number {
  const names = Object.keys(g.attributes);
  const src = names.map((nm) => g.attributes[nm] as THREE.BufferAttribute);
  const pi = names.indexOf('position');
  const n0 = src[pi].count;
  const data: number[][] = src.map((a) => Array.from(a.array as ArrayLike<number>));
  const size = src.map((a) => a.itemSize);
  const P = data[pi];
  const T: number[] = [];
  const tAt = (i: number) => (T[i] ??= f(P[i * 3], P[i * 3 + 2]));
  let count = n0;
  const push = (from: (j: number, c: number) => number): number => {
    for (let j = 0; j < data.length; j++) for (let c = 0; c < size[j]; c++) data[j].push(from(j, c));
    return count++;
  };
  const mids = new Map<number, Map<number, number>>();
  const mid = (a: number, b: number): number => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    let m = mids.get(lo);
    if (!m) mids.set(lo, (m = new Map()));
    let k = m.get(hi);
    if (k === undefined) { k = push((j, c) => (data[j][a * size[j] + c] + data[j][b * size[j] + c]) / 2); m.set(hi, k); }
    return k;
  };
  const needs = (a: number, b: number, depth: number): boolean => {
    if (depth >= MAX_DEPTH) return false;
    const ax = P[a * 3], az = P[a * 3 + 2], bx = P[b * 3], bz = P[b * 3 + 2];
    const len = Math.hypot(bx - ax, bz - az);
    if (len <= MIN_EDGE) return false;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (Math.abs(f(mx, mz) - (tAt(a) + tAt(b)) / 2) > 0.02) return true;
    return len > COARSE_EDGE && (inRegion(ax, az) || inRegion(bx, bz) || inRegion(mx, mz));
  };
  const out: number[] = [];
  const refine = (a: number, b: number, c: number, depth: number): void => {
    const sab = needs(a, b, depth), sbc = needs(b, c, depth), sca = needs(c, a, depth);
    if (!sab && !sbc && !sca) { out.push(a, b, c); return; }
    const d = depth + 1;
    if (sab && sbc && sca) {
      const m1 = mid(a, b), m2 = mid(b, c), m3 = mid(c, a);
      refine(a, m1, m3, d); refine(m1, b, m2, d); refine(m3, m2, c, d); refine(m1, m2, m3, d);
    } else if (sab && sbc) {
      const m1 = mid(a, b), m2 = mid(b, c);
      refine(m1, b, m2, d); refine(a, m1, m2, d); refine(a, m2, c, d);
    } else if (sbc && sca) {
      const m2 = mid(b, c), m3 = mid(c, a);
      refine(m3, m2, c, d); refine(a, b, m2, d); refine(a, m2, m3, d);
    } else if (sca && sab) {
      const m3 = mid(c, a), m1 = mid(a, b);
      refine(a, m1, m3, d); refine(m1, b, c, d); refine(m1, c, m3, d);
    } else if (sab) {
      const m1 = mid(a, b); refine(a, m1, c, d); refine(m1, b, c, d);
    } else if (sbc) {
      const m2 = mid(b, c); refine(a, b, m2, d); refine(a, m2, c, d);
    } else {
      const m3 = mid(c, a); refine(a, b, m3, d); refine(m3, b, c, d);
    }
  };
  const idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: n0 }, (_, i) => i);
  const groups = g.groups.length ? g.groups.map((gr) => ({ ...gr })) : [{ start: 0, count: idx.length, materialIndex: 0 }];
  const ranges: { start: number; end: number; materialIndex?: number }[] = [];
  for (const gr of groups) {
    const s0 = out.length, end = Math.min(idx.length, gr.start + gr.count);
    for (let i = gr.start; i + 2 < end; i += 3) refine(idx[i], idx[i + 1], idx[i + 2], 0);
    ranges.push({ start: s0, end: out.length, materialIndex: gr.materialIndex });
  }
  // final triangles: a small triangle still across a step is dropped; the terrain's own top surface and the retaining
  // face fill the ≤ MIN_EDGE gap it leaves (no steep slivers)
  const nSplit = count;
  for (let i = 0; i < nSplit; i++) tAt(i);
  const lift: number[] = T.slice(0, nSplit);
  const tri: number[] = [];
  const newGroups: { start: number; count: number; materialIndex?: number }[] = [];
  let moved = false;
  for (const r of ranges) {
    const s0 = tri.length;
    for (let i = r.start; i < r.end; i += 3) {
      const a = out[i], b = out[i + 1], c = out[i + 2];
      const lo = Math.min(lift[a], lift[b], lift[c]), hi = Math.max(lift[a], lift[b], lift[c]);
      if (hi > 0) moved = true;
      if (hi - lo <= 0.3) tri.push(a, b, c);
    }
    newGroups.push({ start: s0, count: tri.length - s0, materialIndex: r.materialIndex });
  }
  if (!moved) return 0;
  for (let i = 0; i < count; i++) P[i * 3 + 1] += lift[i];
  for (let j = 0; j < names.length; j++) {
    const a = src[j];
    const Ctor = (a.array as Float32Array).constructor as new (n: number) => Float32Array;
    const arr = new Ctor(data[j].length);
    arr.set(data[j]);
    g.setAttribute(names[j], new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(tri, 1) : new THREE.Uint16BufferAttribute(tri, 1));
  g.clearGroups();
  if (g.groups.length === 0 && groups.length > 1) for (const gr of newGroups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  return count - n0;
}

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _inv = new THREE.Matrix4(), _box = new THREE.Box3();
function translationOnly(m: THREE.Matrix4): boolean {
  const e = m.elements;
  return Math.abs(e[0] - 1) < 1e-6 && Math.abs(e[5] - 1) < 1e-6 && Math.abs(e[10] - 1) < 1e-6
    && Math.abs(e[1]) < 1e-6 && Math.abs(e[2]) < 1e-6 && Math.abs(e[4]) < 1e-6 && Math.abs(e[6]) < 1e-6 && Math.abs(e[8]) < 1e-6 && Math.abs(e[9]) < 1e-6;
}

/** Objects with their own terrain hook (their instance buffers are rebuilt from source matrices at run time). */
export interface TerrainHooked { applyTerrain(f: (x: number, z: number) => number): void }
function hooked(o: THREE.Object3D): o is THREE.Object3D & TerrainHooked {
  return typeof (o as unknown as TerrainHooked).applyTerrain === 'function';
}

const heavy: string[] = [];
const overlays: THREE.Mesh[] = [];
function liftObject(root: THREE.Object3D): { meshes: number; verts: number; added: number } {
  root.updateMatrixWorld(true);
  const users = new Map<THREE.BufferGeometry, number>();
  root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) users.set(g, (users.get(g) ?? 0) + 1); });
  const stats = { meshes: 0, verts: 0, added: 0 };
  const visit = (o: THREE.Object3D): void => {
    if (o.userData.terrainOverlay) overlays.push(o as THREE.Mesh);
    if (o.userData.noTerrain) return;
    if (hooked(o)) { o.applyTerrain(liftY); return; }
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      let moved = false;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, _m);
        _v.setFromMatrixPosition(_m).applyMatrix4(im.matrixWorld);
        const dy = liftY(_v.x, _v.z);
        if (!dy) continue;
        const sy = im.matrixWorld.elements[5] || 1;
        _m.elements[13] += dy / sy;
        im.setMatrixAt(i, _m);
        moved = true;
      }
      if (moved) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox(); }
    } else if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.attributes.position) {
      const mesh = o as THREE.Mesh, g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      _box.copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld);
      if (!(_box.max.x < REGION_X0 || _box.min.z > REGION_Z1)) {
        if ((users.get(g) ?? 0) > 1) {
          _v.setFromMatrixPosition(mesh.matrixWorld);
          const dy = liftY(_v.x, _v.z);
          if (dy) { mesh.position.y += dy; mesh.updateMatrix(); mesh.updateMatrixWorld(true); }
        } else {
          const e = mesh.matrixWorld.elements;
          const n0 = g.attributes.position.count;
          if (translationOnly(mesh.matrixWorld) && (g.index || n0 % 3 === 0)) {
            const tx = e[12], tz = e[14];
            const before = g.attributes.position;
            const added = liftGeometry(g, (x, z) => liftY(x + tx, z + tz));
            if (g.attributes.position !== before) {
              g.computeBoundingBox(); g.computeBoundingSphere();
              stats.meshes++; stats.verts += g.attributes.position.count; stats.added += added;
              if (added > 5000) heavy.push(`${mesh.name || mesh.parent?.name || '?'}: ${n0} → +${added}`);
            }
          } else {
            _inv.copy(mesh.matrixWorld).invert();
            const p = g.attributes.position as THREE.BufferAttribute;
            let any = false;
            for (let i = 0; i < p.count; i++) {
              _v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
              const dy = liftY(_v.x, _v.z);
              if (!dy) continue;
              _v.y += dy;
              _v.applyMatrix4(_inv);
              p.setXYZ(i, _v.x, _v.y, _v.z);
              any = true;
            }
            if (any) { p.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere(); stats.meshes++; stats.verts += p.count; }
          }
        }
      }
    }
    for (const ch of o.children) visit(ch);
  };
  visit(root);
  return stats;
}

// ------------------------------------------------------------------------------------------------ retaining faces
function signedArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Vertical faces where the ground steps down, parapets along the public drops, and the walkway's stair to the bus bay. */
function buildEdges(group: THREE.Group, col: StaticCollision): void {
  const face = new GeoBuffer({ color: true });
  const wallCol = new THREE.Color('#7d7b76'), whiteCol = new THREE.Color('#efeee9'), copeCol = new THREE.Color('#8e8c86');
  const e = 0.06; // probe distance either side of an edge
  for (const poly of [PLATEAU, SLOPE, ORR_SLOPE]) {
    const ccw = signedArea(poly) > 0; // x right, z down: outward normal of a→b is (dz, −dx) for ccw in this sense
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      let nx = dz / len, nz = -dx / len;
      if (!ccw) { nx = -nx; nz = -nz; }
      const steps = Math.max(1, Math.ceil(len / 1.0));
      for (let s = 0; s < steps; s++) {
        const u0 = s / steps, u1 = (s + 1) / steps;
        const p0: V2 = [a[0] + dx * u0, a[1] + dz * u0], p1: V2 = [a[0] + dx * u1, a[1] + dz * u1];
        const m: V2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        if (excluded(m[0] - nx * e, m[1] - nz * e) || excluded(m[0] + nx * e, m[1] + nz * e)) continue;
        const hi0 = terrainY(p0[0] - nx * e, p0[1] - nz * e), lo0 = terrainY(p0[0] + nx * e, p0[1] + nz * e);
        const hi1 = terrainY(p1[0] - nx * e, p1[1] - nz * e), lo1 = terrainY(p1[0] + nx * e, p1[1] + nz * e);
        if (hi0 - lo0 < 0.03 && hi1 - lo1 < 0.03) continue;
        // quad facing outward (+n) from lo to hi
        const i0 = face.vert(p0[0], lo0, p0[1], nx, 0, nz, 0, lo0, wallCol), i1 = face.vert(p1[0], lo1, p1[1], nx, 0, nz, len * (u1 - u0), lo1, wallCol);
        const i2 = face.vert(p1[0], hi1, p1[1], nx, 0, nz, len * (u1 - u0), hi1, wallCol), i3 = face.vert(p0[0], hi0, p0[1], nx, 0, nz, 0, hi0, wallCol);
        face.quad(i0, i1, i2, i3);
        face.quad(i0, i3, i2, i1); // both sides: some edges are seen from the high side through gaps
      }
    }
  }
  // parapets on the public drops: the plaza's east edge, the promenade over the plaza, the PES Lawn's west edge
  const parapets: [V2, V2][] = [
    [[114.15, -153.3], [114.15, -139.6]],
    [[100.5, -139.35], [113.95, -139.35]],
    [[96.15, WALL_OUT[WALL_OUT.length - 1][1] + 0.9], [96.15, -162.3]],
  ];
  for (const [a, b] of parapets) {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let s = 0; s < steps; s++) {
      const p0: V2 = [a[0] + (dx * s) / steps, a[1] + (dz * s) / steps], p1: V2 = [a[0] + (dx * (s + 1)) / steps, a[1] + (dz * (s + 1)) / steps];
      const hA = hiSide(p0), hB = hiSide(p1), lo = Math.min(hA, hB), hi = Math.max(hA, hB);
      if (lo < 1.0) continue; // low drops (the slope's toe) need no parapet
      face.segBox(p0, p1, lo - 0.02, hi + 0.9, 0.25, whiteCol, 0, 0.125, 0.5);
      face.segBox(p0, p1, hi + 0.9, hi + 0.98, 0.34, copeCol, 0, 0.17);
      col.addSegment(p0, p1, 0.25, hi + 1.0 - lo, 'concrete', 'wall', lo - 0.02);
    }
  }
  // stair from the walkway's west end (on the road slope) down to the bus bay
  {
    const x1 = 104, x0 = 100, za = -117.4, zb = -114.7, top = slopeY(x1), n = 9; // clear of the bus-bay planter north of it
    for (let k = 0; k < n; k++) {
      const xa = x1 - ((x1 - x0) * k) / n, xb = x1 - ((x1 - x0) * (k + 1)) / n, hgt = top * (1 - (k + 1) / n);
      if (hgt > 0.01) face.box((xa + xb) / 2, hgt / 2, (za + zb) / 2, xa - xb + 0.01, hgt, zb - za, 0, new THREE.Color(k % 2 ? '#b3aea6' : '#a7a29a'), 0.8);
    }
    col.addRamp([[x0, za], [x1, za], [x1, zb], [x0, zb]], [x1, (za + zb) / 2], [x0, (za + zb) / 2], top, 0, 'concrete', 'stair');
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const mesh = new THREE.Mesh(face.toGeometry(), mat);
  mesh.name = 'terrain:edges';
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  group.add(mesh);
}
/** Ground height just on the high side of a parapet line point (max of the two sides). */
function hiSide(p: V2): number {
  return Math.max(terrainY(p[0] + 0.2, p[1]), terrainY(p[0] - 0.2, p[1]), terrainY(p[0], p[1] + 0.2), terrainY(p[0], p[1] - 0.2));
}

// ------------------------------------------------------------------------------------------------ raised ground surfaces
const RAISED: { poly: V2[]; t: (x: number) => number }[] = [
  { poly: PLATEAU, t: () => H }, { poly: SLOPE, t: slopeY }, { poly: ORR_SLOPE, t: orrSlopeY },
];
function triangulate(poly: V2[]): V2[][] {
  const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
  return tris.map(([a, b, c]) => [poly[a], poly[b], poly[c]]);
}
/** Sutherland–Hodgman: `subject` clipped by the convex polygon `clip`. */
function clipConvex(subject: V2[], clip: V2[]): V2[] {
  const ccw = signedArea(clip) > 0;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p: V2) => { const v = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); return ccw ? v : -v; };
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out;
}
/**
 * The two big flat ground layers (the soil plane and the campus paving, tagged terrainOverlay in Campus.ts) stay at
 * y = 0 and end up hidden inside the raised ground; each gets a copy over the raised polygons (the paving clipped to
 * its own outline) at the raised height, in its own material.
 */
function buildOverlays(group: THREE.Group): void {
  for (const base of overlays) {
    const cfg = base.userData.terrainOverlay as { poly?: V2[]; y: number; uv: number };
    const buf = new GeoBuffer();
    const emit = (pts: V2[], t: (x: number) => number) => {
      if (pts.length < 3) return;
      const flip = signedArea(pts) > 0; // make every triangle face up (the kit's flatPoly convention)
      const v = pts.map(([x, z]) => buf.vert(x, t(x) + cfg.y, z, 0, 1, 0, x / cfg.uv, -z / cfg.uv));
      for (let i = 1; i + 1 < v.length; i++) flip ? buf.tri(v[0], v[i + 1], v[i]) : buf.tri(v[0], v[i], v[i + 1]);
    };
    const own = cfg.poly ? triangulate(cfg.poly) : null;
    for (const r of RAISED) for (const rt of triangulate(r.poly)) {
      if (!own) { emit(rt, r.t); continue; }
      for (const ot of own) emit(clipConvex(ot, rt), r.t);
    }
    const mesh = new THREE.Mesh(buf.toGeometry(), base.material);
    mesh.name = `terrain:${base.name}`;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
}

// ------------------------------------------------------------------------------------------------ entry point
/**
 * Lift the flat-authored world onto the campus terrain and add the raised ground. Call once after the campus and props
 * are built and before any World (nav graph) is created. `roots` are the static scene groups; `hooks` are systems that
 * keep their own instance matrices (TreeSystem). The edge geometry is added to `edgeGroup`.
 */
export function applyTerrain(opts: { roots: THREE.Object3D[]; collision: StaticCollision; hooks?: TerrainHooked[]; edgeGroup: THREE.Group }): { ms: number; meshes: number; verts: number; added: number } {
  const t0 = performance.now();
  const stats = { ms: 0, meshes: 0, verts: 0, added: 0 };
  if (!enabled) return stats;
  liftCollision(opts.collision);
  for (const r of opts.roots) {
    const s = liftObject(r);
    stats.meshes += s.meshes; stats.verts += s.verts; stats.added += s.added;
  }
  for (const h of opts.hooks ?? []) h.applyTerrain(liftY);
  addTerrainCollision(opts.collision);
  buildOverlays(opts.edgeGroup);
  buildEdges(opts.edgeGroup, opts.collision);
  stats.ms = Math.round(performance.now() - t0);
  if (heavy.length) console.debug('[terrain] heavy subdivision:', heavy.join(' | '));
  return stats;
}
