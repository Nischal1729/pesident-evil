import * as THREE from 'three';
import type { SurfaceKind } from '../../core/Events';
import { col, type DetailKey, type WorldKit } from '../kit';
import type { V2 } from '../layout';
import { GroupKit, rect, segPoly } from './util';

/**
 * Building blocks for the enterable GJBC interiors (corridors, classrooms, labs, faculty rooms, stair cores).
 *
 * Split of work between the two kinds of buffer, so interiors cost almost nothing when nobody is inside:
 *  - the SHELL (walls, false ceilings, stair flights) goes into the kit's merged chunk buffers: zero extra draw calls,
 *    and it casts shadows, so the sun never leaks into a room through the one-sided building extrusions around it;
 *  - the FIT-OUT (floors, furniture, boards, door leaves, tube lights) goes into a GroupKit that is only drawn while the
 *    camera is near or inside (see GroupKit.build / visibleWhen).
 * Look (GJB tour 8:32–9:10 corridors, 11:10 classrooms): polished grey granite floors, white walls with a light grey
 * dado in corridors and a light-oak dado in rooms, white panel false ceilings with linear LED tube lights, light-oak
 * door frames with parked-open leaves, rows of long oak bench-desks, green chalkboard + whiteboard, ceiling fans.
 */
export const DOOR_H = 2.5;
export const WALL_T = 0.2;
export const C = {
  wall: col('#eceae4'),
  dadoGrey: col('#c9c9c6'),
  dadoOak: col('#c29a68'),
  ceiling: col('#f1f0ec'),
  corridor: col('#b4b3ae'),
  roomFloor: col('#d4d0c7'),
  oak: col('#c8a16c'),
  oakDark: col('#9a7148'),
  frame: col('#b38656'),
  steel: col('#2e3236'),
  steelLight: col('#8c9196'),
  chalk: col('#2f5a45'),
  white: col('#f4f4f1'),
  cork: col('#9b6a43'),
  screen: col('#15181b'),
  granite: col('#9d9d9a'),
  darkGranite: col('#3a3c3e'),
};

type Side = 'n' | 's' | 'e' | 'w';

/** An opening in a wall: centre `at` metres from the wall's start point, width `w`. */
export interface Opening {
  at: number;
  w: number;
  /** 'door' (open doorway with an oak frame and parked leaves), 'open' (plain opening), 'window' (glazed, solid for collision) */
  kind?: 'door' | 'open' | 'window';
  /** head height above the wall's y0 (doors) or window top */
  h?: number;
  /** window sill height above y0 */
  sill?: number;
}

export interface WallOpts {
  y0: number;
  /** top of the drawn wall (the false ceiling or the slab soffit) */
  top: number;
  /** top of the collision solid (defaults to `top`) */
  colTop?: number;
  thick?: number;
  color?: THREE.Color;
  key?: DetailKey;
  openings?: Opening[];
  /** dado colours on the left (normal (−dz, dx)) / right side; null = none */
  dadoL?: THREE.Color | null;
  dadoR?: THREE.Color | null;
  dadoH?: number;
  /** fit-out group for door frames / leaves / window glass */
  gk?: GroupKit;
  collide?: boolean;
  tag?: string;
  surface?: SurfaceKind;
  /** which side the door leaves are parked on (+1 = left normal side, −1 = right) */
  leafSide?: number;
}

/** A straight interior wall from a to b (centred on the line) with doors / openings / windows. */
export function wall(kit: WorldKit, a: V2, b: V2, o: WallOpts): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  if (len < 1e-3) return;
  const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
  const P = (s: number): V2 => [a[0] + ux * s, a[1] + uz * s];
  const t = o.thick ?? WALL_T;
  const key = o.key ?? 'plaster';
  const c = o.color ?? C.wall;
  const colTop = o.colTop ?? o.top;
  const tag = o.tag ?? 'wall';
  const surf = o.surface ?? 'concrete';
  const collide = o.collide !== false;
  const ops = (o.openings ?? []).slice().sort((p, q) => p.at - q.at);
  const dadoH = o.dadoH ?? 1.1;
  const runs: [number, number][] = [];
  let s = 0;
  for (const op of ops) {
    const s0 = Math.max(0, op.at - op.w / 2), s1 = Math.min(len, op.at + op.w / 2);
    if (op.kind === 'window') continue; // windows sit inside a solid run
    runs.push([s, s0]);
    s = s1;
  }
  runs.push([s, len]);
  const dado = (s0: number, s1: number) => {
    if (s1 - s0 < 0.02) return;
    for (const [dc, sgn] of [[o.dadoL, 1], [o.dadoR, -1]] as [THREE.Color | null | undefined, number][]) {
      if (!dc) continue;
      kit.segBox('plaster', P(s0), P(s1), o.y0, o.y0 + dadoH, 0.03, dc, sgn * (t / 2 + 0.015));
    }
  };
  for (const [r0, r1] of runs) {
    if (r1 - r0 < 0.02) continue;
    // windows inside this run cut the drawn wall into sill / head / piers
    const wins = ops.filter((op) => op.kind === 'window' && op.at > r0 && op.at < r1);
    let q = r0;
    for (const wdw of wins) {
      const w0 = wdw.at - wdw.w / 2, w1 = wdw.at + wdw.w / 2;
      const sill = o.y0 + (wdw.sill ?? 0.9), head = o.y0 + (wdw.h ?? 2.4);
      kit.segBox(key, P(q), P(w0), o.y0, o.top, t, c);
      kit.segBox(key, P(w0), P(w1), o.y0, sill, t, c);
      kit.segBox(key, P(w0), P(w1), head, o.top, t, c);
      if (o.gk) {
        o.gk.pane(P(w0), P(w1), sill, head);
        o.gk.seg('metal', P(w0), P(w1), sill - 0.04, sill, t + 0.08, C.steelLight);
        const n = Math.max(1, Math.round((w1 - w0) / 1.2));
        for (let k = 1; k < n; k++) {
          const p = P(w0 + ((w1 - w0) * k) / n);
          o.gk.box('metal', p[0], (sill + head) / 2, p[1], Math.abs(ux) * 0.05 + Math.abs(nx) * (t + 0.02), head - sill, Math.abs(uz) * 0.05 + Math.abs(nz) * (t + 0.02), 0, C.steelLight);
        }
      }
      dado(q, w0);
      q = w1;
    }
    kit.segBox(key, P(q), P(r1), o.y0, o.top, t, c);
    dado(q, r1);
    if (collide) kit.collision.addPolygon(segPoly(P(r0), P(r1), t), colTop - o.y0, surf, tag, o.y0);
  }
  for (const op of ops) {
    if (op.kind === 'window') continue;
    const s0 = Math.max(0, op.at - op.w / 2), s1 = Math.min(len, op.at + op.w / 2);
    const h = op.h ?? DOOR_H;
    if (o.top - (o.y0 + h) > 0.01) kit.segBox(key, P(s0), P(s1), o.y0 + h, o.top, t, c);
    if (collide && colTop - (o.y0 + h) > 0.01) kit.collision.addPolygon(segPoly(P(s0), P(s1), t), colTop - o.y0 - h, surf, tag, o.y0 + h);
    if (op.kind === 'door' && o.gk) doorFrame(o.gk, P(s0), P(s1), o.y0, h, t, o.leafSide ?? 1);
  }
}

/** Oak door frame (jambs + head) in an opening a→b, with two leaves parked open flat against the wall. */
export function doorFrame(g: GroupKit, a: V2, b: V2, y0: number, h: number, t: number, leafSide = 1): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
  const fw = 0.08, ft = t + 0.06;
  const sx = (along: number, across: number) => Math.abs(ux) * along + Math.abs(nx) * across;
  const sz = (along: number, across: number) => Math.abs(uz) * along + Math.abs(nz) * across;
  for (const p of [a, b]) {
    const s = p === a ? 1 : -1;
    const cx = p[0] + ux * s * fw / 2, cz = p[1] + uz * s * fw / 2;
    g.box('wood', cx, y0 + h / 2, cz, sx(fw, ft), h, sz(fw, ft), 0, C.frame);
  }
  g.box('wood', (a[0] + b[0]) / 2, y0 + h - fw / 2, (a[1] + b[1]) / 2, sx(len, ft), fw, sz(len, ft), 0, C.frame);
  // leaves: each half the opening, swung 180° flat onto the wall face beside the opening
  const lw = len / 2 - 0.04, off = (t / 2 + 0.04) * leafSide;
  for (const [p, s] of [[a, -1], [b, 1]] as [V2, number][]) {
    const cx = p[0] + ux * s * (lw / 2 + 0.05) + nx * off, cz = p[1] + uz * s * (lw / 2 + 0.05) + nz * off;
    g.box('wood', cx, y0 + 1.05, cz, sx(lw, 0.045), 2.1, sz(lw, 0.045), 0, C.oak);
    // narrow glass vision panel
    g.box('glass', cx + nx * 0.012 * leafSide, y0 + 1.45, cz + nz * 0.012 * leafSide, sx(0.18, 0.05), 0.7, sz(0.18, 0.05), 0, col('#9fb3bd'));
  }
}

/**
 * Down-facing false ceiling over `poly` at y: a shadow-casting shell in the kit buffers and, with a fit-out group, the
 * lit white panel ceiling 1 cm under it (see ceilingPanelMaterial).
 */
export function ceiling(kit: WorldKit, poly: V2[], y: number, c = C.ceiling, g?: GroupKit): void {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  kit.buf('plaster', cx, cz).flatPoly(poly, y, g ? col('#9a9a97') : c, 2, true);
  if (g) g.ceil.flatPoly(poly, y - 0.01, c, 2, true);
}

/** Up-facing floor in the fit-out group. */
export function floor(g: GroupKit, poly: V2[], y: number, c: THREE.Color, key: DetailKey = 'polished', uv = 2): void {
  g.fb(key).flatPoly(poly, y, c, uv);
}

/** Linear LED tube light (housing + lit strip) on a ceiling at y, centred (x, z), `len` long along X (alongX) or Z. */
export function tube(g: GroupKit, x: number, y: number, z: number, len: number, alongX: boolean): void {
  const sx = alongX ? len : 0.12, sz = alongX ? 0.12 : len;
  g.box('metal', x, y - 0.03, z, sx + 0.04, 0.05, sz + 0.04, 0, C.white);
  g.light(x, y - 0.065, z, alongX ? len : 0.07, 0.02, alongX ? 0.07 : len);
}

/** Tube lights in rows over a rect (ceiling at y). */
export function tubeGrid(g: GroupKit, x0: number, z0: number, x1: number, z1: number, y: number, pitch = 2.6, alongX = true): void {
  const w = x1 - x0, d = z1 - z0;
  const nu = Math.max(1, Math.round((alongX ? d : w) / pitch));
  const nv = Math.max(1, Math.round((alongX ? w : d) / 3.2));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const x = alongX ? x0 + (w * (j + 0.5)) / nv : x0 + (w * (i + 0.5)) / nu;
    const z = alongX ? z0 + (d * (i + 0.5)) / nu : z0 + (d * (j + 0.5)) / nv;
    tube(g, x, y, z, 1.2, alongX);
  }
}

/** Ceiling fan (rod, hub, three blades) hanging from a ceiling at y. */
export function fan(g: GroupKit, x: number, y: number, z: number, seed = 0): void {
  const m = g.b('metal');
  m.box(x, y - 0.25, z, 0.03, 0.5, 0.03, 0, C.white);
  m.cylinder(x, y - 0.62, z, 0.11, 0.12, 8, C.white);
  for (let k = 0; k < 3; k++) {
    const a = seed + (k / 3) * Math.PI * 2;
    m.box(x + Math.cos(a) * 0.6, y - 0.56, z - Math.sin(a) * 0.6, 1.0, 0.012, 0.12, a, C.white);
  }
}

/** Cork notice board with pinned sheets on a wall face; (nx, nz) = the direction the board faces. */
export function noticeBoard(g: GroupKit, x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, seed = 1): void {
  const alongX = Math.abs(nz) > 0.5;
  const sx = (a: number, b: number) => (alongX ? a : b), sz = (a: number, b: number) => (alongX ? b : a);
  g.box('wood', x, y, z, sx(w + 0.08, 0.04), h + 0.08, sz(w + 0.08, 0.04), 0, C.oakDark);
  g.box('plaster', x + nx * 0.02, y, z + nz * 0.02, sx(w, 0.03), h, sz(w, 0.03), 0, C.cork);
  const papers = [col('#f5f3ea'), col('#f2e27a'), col('#f4b8c8'), col('#a9cce8'), col('#f5f3ea'), col('#c9e6a6')];
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const n = Math.max(3, Math.round(w * 2.2));
  for (let k = 0; k < n; k++) {
    const u = (rnd() - 0.5) * (w - 0.35), v = (rnd() - 0.5) * (h - 0.4);
    const pw = 0.21 + rnd() * 0.1, ph = 0.28 + rnd() * 0.08;
    g.box('plaster', x + (alongX ? u : 0) + nx * 0.04, y + v, z + (alongX ? 0 : u) + nz * 0.04, sx(pw, 0.01), ph, sz(pw, 0.01), 0, papers[k % papers.length]);
  }
}

// ------------------------------------------------------------------------------------------------ room layouts
/** Local frame of a rectangular room seen from its front wall: u runs along the front wall, v into the room. */
interface Frame { W: number; D: number; P: (u: number, v: number) => V2; box: (g: GroupKit, key: DetailKey, u: number, y: number, v: number, su: number, sy: number, sv: number, c: THREE.Color) => void; rect: (u0: number, v0: number, u1: number, v1: number) => V2[]; nx: number; nz: number }

export function frame(x0: number, z0: number, x1: number, z1: number, front: Side): Frame {
  const alongX = front === 'n' || front === 's';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const P = (u: number, v: number): V2 => {
    switch (front) {
      case 'n': return [x0 + u, z0 + v];
      case 's': return [x1 - u, z1 - v];
      case 'w': return [x0 + v, z1 - u];
      default: return [x1 - v, z0 + u];
    }
  };
  // direction from the front wall into the room
  const nx = front === 'w' ? 1 : front === 'e' ? -1 : 0, nz = front === 'n' ? 1 : front === 's' ? -1 : 0;
  const box = (g: GroupKit, key: DetailKey, u: number, y: number, v: number, su: number, sy: number, sv: number, c: THREE.Color) => {
    const p = P(u, v);
    g.box(key, p[0], y, p[1], alongX ? su : sv, sy, alongX ? sv : su, 0, c);
  };
  const rectF = (u0: number, v0: number, u1: number, v1: number): V2[] => {
    const a = P(u0, v0), b = P(u1, v1);
    return rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
  };
  return { W, D, P, box, rect: rectF, nx, nz };
}

/** Green chalkboard + whiteboard on an oak panel, centred on the front wall. */
function boards(g: GroupKit, F: Frame, y0: number, v = 0.13): void {
  const cu = F.W / 2;
  F.box(g, 'wood', cu, y0 + 1.55, v, Math.min(F.W - 1, 7.4), 1.7, 0.04, C.oak);
  F.box(g, 'plaster', cu - 1.4, y0 + 1.55, v + 0.03, 3.6, 1.2, 0.03, C.chalk);
  F.box(g, 'plaster', cu + 1.95, y0 + 1.55, v + 0.03, 2.2, 1.2, 0.03, C.white);
  F.box(g, 'metal', cu, y0 + 0.9, v + 0.07, Math.min(F.W - 1.2, 6.2), 0.04, 0.1, C.steelLight);
}

/** One long bench-desk (desk top, modesty panel, steel side frames, attached bench) facing the front (−v). */
function benchDesk(g: GroupKit, F: Frame, u: number, v: number, len: number, y0: number): void {
  F.box(g, 'wood', u, y0 + 0.74, v, len, 0.04, 0.45, C.oak);
  F.box(g, 'wood', u, y0 + 0.5, v - 0.2, len, 0.42, 0.02, C.oak);
  F.box(g, 'wood', u, y0 + 0.44, v + 0.52, len, 0.04, 0.3, C.oak);
  for (const du of [-len / 2 + 0.05, len / 2 - 0.05]) F.box(g, 'metal', u + du, y0 + 0.37, v + 0.15, 0.04, 0.74, 0.95, C.steel);
}

function addSolid(kit: WorldKit, poly: V2[], h: number, y0: number, tag = 'prop', surface: SurfaceKind = 'wood'): void {
  kit.collision.addPolygon(poly, h, surface, tag, y0);
}

/**
 * Classroom (GJB tour 11:10): boards on the front wall, teacher's table on a low dais, rows of long bench-desks in two
 * blocks with a centre aisle, tube lights and ceiling fans. `ceil` = false-ceiling height.
 */
export function classroom(kit: WorldKit, g: GroupKit, r: [number, number, number, number], front: Side, y0: number, ceil: number, opts: { seats?: 'bench' | 'lab'; rowsMax?: number } = {}): void {
  const F = frame(r[0], r[1], r[2], r[3], front);
  boards(g, F, y0 + 0.2);
  // dais 0.2 m (steppable) and the teacher's table + chair
  const dais = F.rect(0.8, 0.1, F.W - 0.8, 2.0);
  F.box(g, 'wood', F.W / 2, y0 + 0.1, 1.05, F.W - 1.6, 0.2, 1.9, C.oakDark); // closed box (it had no end faces)
  addSolid(kit, dais, 0.2, y0, 'dais', 'wood');
  F.box(g, 'wood', F.W * 0.3, y0 + 0.95, 1.1, 1.5, 0.05, 0.7, C.oak);
  F.box(g, 'wood', F.W * 0.3, y0 + 0.58, 1.1, 1.4, 0.7, 0.62, C.oakDark);
  addSolid(kit, F.rect(F.W * 0.3 - 0.75, 0.75, F.W * 0.3 + 0.75, 1.45), 0.78, y0 + 0.2, 'desk');
  // desks: two blocks either side of a 1.5 m centre aisle, 1.6 m side aisles (1.1 m left no nav cells along the door
  // wall, so G-04's second door led nowhere for zombies and NPCs)
  const aisle = 1.5, side = 1.6;
  const block = (F.W - aisle - 2 * side) / 2;
  const n = Math.max(1, Math.floor(block / 3.1));
  const len = Math.min(3.0, block / n - 0.1);
  const rows: number[] = [];
  for (let v = 3.2; v <= F.D - 1.4 && rows.length < (opts.rowsMax ?? 9); v += 1.12) rows.push(v);
  for (const v of rows) {
    for (const b0 of [side, side + block + aisle]) {
      for (let k = 0; k < n; k++) {
        const u = b0 + (block / n) * (k + 0.5);
        benchDesk(g, F, u, v, len, y0);
        addSolid(kit, F.rect(u - len / 2, v - 0.23, u + len / 2, v + 0.68), 0.76, y0);
      }
    }
  }
  tubeGrid(g, r[0] + 0.6, r[1] + 0.6, r[2] - 0.6, r[3] - 0.6, ceil, 2.8, front === 'w' || front === 'e');
  for (const v of [F.D * 0.33, F.D * 0.72]) for (const u of [F.W * 0.28, F.W * 0.72]) { const p = F.P(u, v); fan(g, p[0], ceil, p[1], u + v); }
}

/** Computer lab: benches with monitors along the side walls + two back-to-back islands, grey task chairs. */
export function computerLab(kit: WorldKit, g: GroupKit, r: [number, number, number, number], front: Side, y0: number, ceil: number): void {
  const F = frame(r[0], r[1], r[2], r[3], front);
  F.box(g, 'plaster', F.W / 2, y0 + 1.7, 0.13, Math.min(F.W - 2, 3.2), 1.8, 0.03, C.white); // projector screen
  const bench = (u0: number, u1: number, v0: number, v1: number, alongU: boolean, faceSign: number) => {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    F.box(g, 'wood', cu, y0 + 0.74, cv, u1 - u0, 0.04, v1 - v0, col('#d9d4c8'));
    F.box(g, 'metal', cu, y0 + 0.36, cv, u1 - u0 - 0.1, 0.72, v1 - v0 - 0.1, C.steelLight);
    addSolid(kit, F.rect(u0, v0, u1, v1), 0.76, y0, 'desk');
    const L = alongU ? u1 - u0 : v1 - v0;
    const nSeat = Math.floor(L / 1.1);
    for (let k = 0; k < nSeat; k++) {
      const t = (k + 0.5) / nSeat;
      const u = alongU ? u0 + (u1 - u0) * t : cu + faceSign * ((u1 - u0) / 2 - 0.25);
      const v = alongU ? cv + faceSign * ((v1 - v0) / 2 - 0.25) : v0 + (v1 - v0) * t;
      F.box(g, 'dark', u, y0 + 1.02, v, alongU ? 0.55 : 0.04, 0.34, alongU ? 0.04 : 0.55, C.screen);
      F.box(g, 'metal', u, y0 + 0.8, v, 0.18, 0.1, 0.14, C.steel);
      // chair in front of the screen
      const cu2 = alongU ? u : u - faceSign * 0.95, cv2 = alongU ? v - faceSign * 0.95 : v;
      F.box(g, 'plaster', cu2, y0 + 0.48, cv2, 0.46, 0.07, 0.46, col('#5b6168'));
      F.box(g, 'plaster', cu2 + (alongU ? 0 : -faceSign * 0.22), y0 + 0.8, cv2 + (alongU ? -faceSign * 0.22 : 0), alongU ? 0.44 : 0.05, 0.5, alongU ? 0.05 : 0.44, col('#5b6168'));
      F.box(g, 'metal', cu2, y0 + 0.24, cv2, 0.06, 0.44, 0.06, C.steel);
    }
  };
  // side benches (0.7 deep) along both side walls, then two islands in the middle
  bench(0.15, 0.85, 2.4, F.D - 0.6, false, -1);
  bench(F.W - 0.85, F.W - 0.15, 2.4, F.D - 0.6, false, 1);
  const midU = F.W / 2;
  for (const [a, b] of [[3.4, F.D / 2 - 0.5], [F.D / 2 + 0.9, F.D - 1.8]] as V2[]) {
    if (b - a < 1.5) continue;
    bench(midU - 0.75, midU, a, b, false, 1);
    bench(midU, midU + 0.75, a, b, false, -1);
  }
  tubeGrid(g, r[0] + 0.6, r[1] + 0.6, r[2] - 0.6, r[3] - 0.6, ceil, 2.6, front === 'w' || front === 'e');
}

/** Faculty room: cubicle desks with low partitions along both side walls, steel almirahs at the back, a meeting table. */
export function facultyRoom(kit: WorldKit, g: GroupKit, r: [number, number, number, number], front: Side, y0: number, ceil: number, boardU?: number): void {
  const F = frame(r[0], r[1], r[2], r[3], front);
  const cub = (u: number, v: number, face: number) => {
    F.box(g, 'wood', u, y0 + 0.74, v, 1.3, 0.04, 0.7, col('#b99a74'));
    F.box(g, 'metal', u - face * 0.3, y0 + 0.36, v, 0.5, 0.72, 0.62, C.steelLight);
    F.box(g, 'plaster', u + face * 0.66, y0 + 0.62, v, 0.04, 1.24, 0.72, col('#7d8a93'));
    F.box(g, 'dark', u - face * 0.35, y0 + 0.91, v, 0.04, 0.3, 0.5, C.screen); // stands on the desk top (0.76)
    F.box(g, 'plaster', u + face * 0.2, y0 + 0.47, v, 0.46, 0.07, 0.46, col('#3f4a57'));
  };
  const nCub = Math.max(1, Math.floor((F.D - 1.2) / 1.4));
  for (let k = 0; k < nCub; k++) {
    const v = 0.9 + k * 1.4 + 0.35;
    if (v > F.D - 0.8) break;
    cub(0.55, v, -1);
    cub(F.W - 0.55, v, 1);
    addSolid(kit, F.rect(0.1, v - 0.37, 1.25, v + 0.37), 0.76, y0, 'desk');
    addSolid(kit, F.rect(F.W - 1.25, v - 0.37, F.W - 0.1, v + 0.37), 0.76, y0, 'desk');
  }
  // almirahs along the back wall
  const nA = Math.max(1, Math.floor((F.W - 2.6) / 1.05));
  for (let k = 0; k < nA; k++) {
    const u = 1.3 + (k + 0.5) * ((F.W - 2.6) / nA);
    F.box(g, 'metal', u, y0 + 0.98, F.D - 0.3, 0.95, 1.96, 0.46, col('#9aa0a4'));
    F.box(g, 'metal', u, y0 + 1.0, F.D - 0.535, 0.02, 1.8, 0.01, C.steel);
  }
  addSolid(kit, F.rect(1.3, F.D - 0.56, F.W - 1.3, F.D - 0.05), 2.0, y0, 'wall', 'metal');
  // meeting table in the middle
  if (F.W > 4.5) {
    const tw = Math.min(2.4, F.W - 4.2);
    F.box(g, 'wood', F.W / 2, y0 + 0.74, F.D / 2, tw, 0.05, 1.1, col('#8a6242'));
    F.box(g, 'wood', F.W / 2, y0 + 0.36, F.D / 2, tw - 0.3, 0.7, 0.7, col('#6e4d33'));
    addSolid(kit, F.rect(F.W / 2 - tw / 2, F.D / 2 - 0.55, F.W / 2 + tw / 2, F.D / 2 + 0.55), 0.77, y0, 'desk');
  }
  const bu = boardU ?? F.W / 2;
  noticeBoard(g, F.P(bu, 0.14)[0], y0 + 1.6, F.P(bu, 0.14)[1], Math.min(2.4, F.W - 1.5), 1.1, F.nx, F.nz, 7);
  tubeGrid(g, r[0] + 0.6, r[1] + 0.6, r[2] - 0.6, r[3] - 0.6, ceil, 2.6, front === 'w' || front === 'e');
}

/** Electronics / project lab: high lab benches with instrument boxes and stools. */
export function electronicsLab(kit: WorldKit, g: GroupKit, r: [number, number, number, number], front: Side, y0: number, ceil: number): void {
  const F = frame(r[0], r[1], r[2], r[3], front);
  boards(g, F, y0);
  const instr = [col('#2c6fa8'), col('#d9d4c8'), col('#3a3d40'), col('#c7502e')];
  // rows 1.9 m apart with a 1.8 m centre aisle (1.4 / 1.2 m left no nav cells between the benches); a ≥ 2 m aisle along
  // the back wall (the door side)
  for (let v = 2.6; v <= F.D - 2.6; v += 2.8) {
    for (const u0 of [1.0, F.W / 2 + 0.9]) {
      const u1 = Math.min(F.W - 1.0, u0 + F.W / 2 - 1.9);
      if (u1 - u0 < 1.5) continue;
      const cu = (u0 + u1) / 2;
      F.box(g, 'wood', cu, y0 + 0.88, v, u1 - u0, 0.05, 0.9, col('#3d3f42'));
      F.box(g, 'wood', cu, y0 + 0.43, v, u1 - u0 - 0.1, 0.86, 0.8, col('#c9b89a'));
      addSolid(kit, F.rect(u0, v - 0.45, u1, v + 0.45), 0.92, y0, 'desk');
      for (let u = u0 + 0.5; u < u1 - 0.3; u += 0.9) {
        const k = Math.floor(u * 3 + v) % instr.length;
        F.box(g, 'metal', u, y0 + 1.02, v - 0.15, 0.4, 0.24, 0.3, instr[(k + 4) % instr.length]);
        F.box(g, 'metal', u, y0 + 0.33, v + 0.75, 0.32, 0.05, 0.32, C.steel);
        F.box(g, 'metal', u, y0 + 0.16, v + 0.75, 0.05, 0.32, 0.05, C.steel);
      }
    }
  }
  tubeGrid(g, r[0] + 0.6, r[1] + 0.6, r[2] - 0.6, r[3] - 0.6, ceil, 2.6, front === 'w' || front === 'e');
}

/** Study lounge: square tables with four chairs, a water cooler. */
export function lounge(kit: WorldKit, g: GroupKit, spots: V2[], y0: number): void {
  for (const [x, z] of spots) {
    g.box('wood', x, y0 + 0.74, z, 1.1, 0.04, 1.1, 0, C.oak);
    g.box('metal', x, y0 + 0.37, z, 0.08, 0.72, 0.08, 0, C.steel);
    g.box('metal', x, y0 + 0.02, z, 0.6, 0.04, 0.6, 0, C.steel);
    for (const [dx, dz] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]] as V2[]) {
      g.box('plaster', x + dx, y0 + 0.46, z + dz, 0.44, 0.06, 0.44, 0, col('#8a8d91'));
      g.box('plaster', x + dx * 1.27, y0 + 0.72, z + dz * 1.27, dx ? 0.05 : 0.44, 0.48, dz ? 0.05 : 0.44, 0, col('#8a8d91'));
      g.box('metal', x + dx, y0 + 0.22, z + dz, 0.36, 0.44, 0.36, 0, C.steel);
    }
    addSolid(kit, rect(x - 0.55, z - 0.55, x + 0.55, z + 0.55), 0.76, y0);
  }
}

/** Drinking-water cooler (steel cabinet with a blue tank top). */
export function cooler(kit: WorldKit, g: GroupKit, x: number, z: number, y0: number): void {
  g.box('metal', x, y0 + 0.6, z, 0.5, 1.2, 0.45, 0, col('#c4c8cc'));
  g.box('metal', x, y0 + 1.35, z, 0.36, 0.3, 0.36, 0, col('#3f78b5'));
  kit.collision.addCircle(x, z, 0.32, 1.5, 'metal', 'prop', y0);
}

/**
 * Straight axis-aligned granite flight rising from (a, y0) to (b, y1) (plan centre line), `w` wide, drawn as step blocks
 * from `base` (solid under the flight) or, with `soffit` > 0, as a waist slab that thick under the nosings.
 */
export function flight(kit: WorldKit, a: V2, b: V2, y0: number, y1: number, w: number, base: number, steps: number, c = C.granite, soffit = 0): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const run = len / steps;
  const alongX = Math.abs(ux) > 0.5;
  for (let k = 0; k < steps; k++) {
    const top = y0 + ((y1 - y0) * (k + 1)) / steps;
    const s = run * (k + 0.5);
    const x = a[0] + ux * s, z = a[1] + uz * s;
    const lo = soffit > 0 ? Math.max(base, y0 + ((y1 - y0) * k) / steps - soffit) : base;
    kit.box('polished', x, (lo + top) / 2, z, alongX ? run + 0.004 : w, top - lo, alongX ? w : run + 0.004, 0, c, 0.5);
  }
}
