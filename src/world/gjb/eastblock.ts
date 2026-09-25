import * as THREE from 'three';
import { GeoBuffer } from '../buildings';
import { col, type WorldKit } from '../kit';
import { BUILDINGS, GJB_ARCADE_TOP, GJB_INTERIORS, GJB_L1, GJB_L2, gjbcEastX, type V2 } from '../layout';
import { C, ceiling, classroom, cooler, facultyRoom, floor, lounge, noticeBoard, tube, wall } from './rooms';
import { GroupKit, rect, segPoly } from './util';

/**
 * The GJBC east entrance block over the ground-floor lobby (reference/GJB_NOTES.md §3, §5; GJB tour 7:00–7:30; 2025 tour
 * uxqjCJBCP_g 7:03 / 7:30):
 *  - L1 ADMISSION HALL: speckled granite with white inlay lines, timber-slat ceiling with linear LEDs, oak-panelled
 *    admission counters with blue plates along the north wall, and the atrium void over the lobby's grand stair, ringed
 *    by a white parapet with a dark steel rail, in front of the red feature wall with the gold tree sculpture. It opens
 *    west onto the Quad's east colonnade (which now runs on through under the block).
 *  - a straight granite flight along the south wall up to L2 (GJB_L2);
 *  - L2: an open study lounge over the hall, glazed on the Quad side (it looks across the double-height colonnade into
 *    the Quad) and on the east front, with doors north into two rooms carved out of the east wing's south end:
 *    2-01 classroom (windows onto the colonnade and the Quad) and 2-02 faculty room.
 * Outside, the lobby's cream portal frames the two-storey glazing above the entrance (key_0105).
 * The east wing (gjb_e1) is registered here as solid except those two rooms (layout.ts: collide false).
 */
const L1 = GJB_L1, L2 = GJB_L2, ARC = GJB_ARCADE_TOP;
const E = gjbcEastX;
const fx = (z: number) => E(z) - 2.5;
const I = GJB_INTERIORS.east;
const X0 = I.x0, Z0 = I.z0, Z1 = I.z1;
/** slab soffits */
const S1 = L1 - 0.4, S2 = L2 - 0.35;
/** grand-stair void over the lobby stair (x range; z from the void edge to the south wall) */
const VOID: [number, number, number, number] = [61.8, -78.3, 68.4, Z1];
/** L1 → L2 flight along the south wall (rises east) */
const FL: [number, number, number, number] = [70.6, -78.3, 77.8, Z1 - 0.2];
const SOUTH_WALL = Z1 - 0.1; // wall centre line (−76.2 … −76.0)
const NORTH_WALL = Z0 + 0.1; // (−84.0 … −83.8)
const ROOMS = I.l2Rooms; // [59, −93.2, 80.6, −84]
const DOOR_201 = 67.5, DOOR_202 = 73.0;

export function buildEastBlock(kit: WorldKit): void {
  const g = new GroupKit(kit);
  eastWingCollision(kit);
  hall(kit, g);
  upper(kit, g);
  fronts(kit, g);
  l2Rooms(kit, g);
  const far = new THREE.Group();
  far.add(farGlass(kit));
  g.build('interior:gjb_east', [71, -80], 90, far);
}

// ------------------------------------------------------------------------------------------------ gjb_e1 collision
/** The east wing (north) is solid except the two L2 rooms at its south end. */
function eastWingCollision(kit: WorldKit): void {
  const b = BUILDINGS.find((d) => d.id === 'gjb_e1');
  if (!b) return;
  const c = kit.collision, tag = 'bld:gjb_e1';
  const top = (b.top ?? (b.floorH ?? 4.4) * b.floors) + 1.1;
  c.addPolygon(b.poly, L2, 'concrete', tag);
  c.addPolygon(b.poly, top - ARC, 'concrete', tag, ARC);
  // the L2 band: the wing's outline minus the rooms rect (the rooms touch its west and south edges)
  const [rx0, rz0, rx1, rz1] = ROOMS;
  const north = clipPoly(b.poly, (p) => p[1] <= rz0, (a, q) => lerpAt(a, q, 1, rz0));
  const east = clipPoly(clipPoly(b.poly, (p) => p[1] >= rz0, (a, q) => lerpAt(a, q, 1, rz0)), (p) => p[0] >= rx1, (a, q) => lerpAt(a, q, 0, rx1));
  for (const p of [north, east]) if (p.length >= 3) c.addPolygon(p, ARC - L2, 'concrete', tag, L2);
  void rx0; void rz1;
}

function lerpAt(a: V2, b: V2, axis: 0 | 1, v: number): V2 {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Sutherland–Hodgman clip of a polygon against one half-plane. */
function clipPoly(poly: V2[], inside: (p: V2) => boolean, cut: (a: V2, b: V2) => V2): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) out.push(cut(a, b));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ L1 admission hall
function slabPoly(notch: [number, number, number, number]): V2[] {
  return [[X0, Z0], [fx(Z0), Z0], [fx(Z1), Z1], [notch[2], Z1], [notch[2], notch[1]], [notch[0], notch[1]], [notch[0], Z1], [X0, Z1]];
}

function hall(kit: WorldKit, g: GroupKit): void {
  const c = kit.collision;
  const l1 = slabPoly(VOID);
  c.addPolygon(l1, L1 - S1, 'concrete', 'slab', S1);
  // floor: speckled grey granite with thin white inlay lines running east–west (7:00)
  floor(g, l1, L1 + 0.03, col('#b7b6b1'));
  for (let z = Z0 + 1.1; z < VOID[1] - 0.3; z += 1.3) floor(g, rect(X0 + 0.2, z, fx(z) - 0.2, z + 0.06), L1 + 0.034, col('#ecebe7'), 'polished', 1);
  // the void's slab edges (seen from the lobby) and the white parapet with a dark steel rail round it
  const white = C.wall;
  kit.box('plaster', (VOID[0] + VOID[2]) / 2, (S1 + L1) / 2, VOID[1] - 0.02, VOID[2] - VOID[0] + 0.04, L1 - S1 + 0.02, 0.06, 0, white);
  kit.box('plaster', VOID[2] + 0.02, (S1 + L1) / 2, (VOID[1] + VOID[3]) / 2, 0.06, L1 - S1 + 0.02, VOID[3] - VOID[1], 0, white);
  const parapet = (a: V2, b: V2) => {
    kit.segBox('plaster', a, b, L1, L1 + 1.0, 0.2, white);
    kit.segBox('polished', a, b, L1 + 1.0, L1 + 1.05, 0.26, col('#8f8e8a'), 0, 0, 0.5);
    for (const y of [L1 + 1.18, L1 + 1.3]) kit.segBox('metal', a, b, y, y + 0.05, 0.05, C.steel);
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5));
    for (let k = 0; k <= n; k++) {
      const p: V2 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      kit.box('metal', p[0], L1 + 1.18, p[1], 0.05, 0.3, 0.05, 0, C.steel);
    }
    c.addPolygon(segPoly(a, b, 0.2), 1.35, 'concrete', 'parapet', L1);
  };
  parapet([VOID[0], VOID[1] - 0.1], [VOID[2] + 0.2, VOID[1] - 0.1]);
  parapet([VOID[2] + 0.1, VOID[1] - 0.1], [VOID[2] + 0.1, SOUTH_WALL - 0.1]);
  // gold tree sculpture beside the void (a lattice vase with bare golden branches)
  const gold = col('#c9a24a'), vx = 66.2, vz = VOID[1] - 1.05;
  const m = g.b('metal');
  for (let k = 0; k < 5; k++) m.cylinder(vx, L1 + 0.12 + k * 0.2, vz, 0.2 + Math.sin((k / 4) * Math.PI) * 0.16, 0.2, 10, gold, k === 4);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2, r = 0.5 + (k % 3) * 0.25, h = 1.6 + (k % 4) * 0.35;
    m.beam([vx, L1 + 1.0, vz], [vx + Math.cos(a) * r, L1 + h, vz + Math.sin(a) * r], 0.03, 0.03, gold);
    m.beam([vx + Math.cos(a) * r, L1 + h, vz + Math.sin(a) * r], [vx + Math.cos(a + 0.5) * r * 1.4, L1 + h + 0.4, vz + Math.sin(a + 0.5) * r * 1.4], 0.018, 0.018, gold);
  }
  c.addCircle(vx, vz, 0.42, 1.2, 'metal', 'prop', L1);
  // admission counters along the north wall: oak-panelled base, oak fins, glass screens, blue plates, oak header
  const oak = col('#c9a26b'), cz = NORTH_WALL + 0.1;
  const cx0 = 61.6, cx1 = 80.6;
  kit.box('wood', (cx0 + cx1) / 2, L1 + 0.55, cz + 0.32, cx1 - cx0, 1.1, 0.64, 0, oak);
  g.box('wood', (cx0 + cx1) / 2, L1 + 1.12, cz + 0.36, cx1 - cx0 + 0.04, 0.05, 0.74, 0, col('#e6dccb'));
  c.addPolygon(rect(cx0, cz, cx1, cz + 0.68), 1.15, 'wood', 'desk', L1);
  kit.box('wood', (cx0 + cx1) / 2, L1 + 3.05, cz + 0.2, cx1 - cx0, 0.5, 0.4, 0, oak);
  const nCtr = 8;
  for (let k = 0; k <= nCtr; k++) {
    const x = cx0 + ((cx1 - cx0) * k) / nCtr;
    kit.box('wood', x, L1 + 1.95, cz + 0.2, 0.3, 1.7, 0.4, 0, oak);
    if (k === nCtr) break;
    const xm = x + (cx1 - cx0) / nCtr / 2;
    g.pane([x + 0.15, cz + 0.12], [x + (cx1 - cx0) / nCtr - 0.15, cz + 0.12], L1 + 1.12, L1 + 2.8);
    g.box('dark', xm, L1 + 1.9, cz + 0.02, (cx1 - cx0) / nCtr - 0.3, 1.6, 0.02, 0, col('#39424a'));
    g.box('plaster', xm, L1 + 2.62, cz + 0.42, 0.9, 0.24, 0.03, 0, col('#2a3f8f'));
    g.box('plaster', xm - 0.3, L1 + 2.62, cz + 0.435, 0.18, 0.16, 0.01, 0, col('#f2c230'));
  }
  // waiting benches facing the counters, a standee
  for (const x of [73.5, 77.5]) {
    g.box('metal', x, L1 + 0.45, -80.4, 1.9, 0.06, 0.55, 0, col('#1e2124'));
    g.box('metal', x, L1 + 0.75, -80.15, 1.9, 0.55, 0.05, 0, col('#1e2124'));
    for (const lx of [-0.85, 0.85]) g.box('metal', x + lx, L1 + 0.22, -80.4, 0.05, 0.44, 0.5, 0, col('#1e2124'));
    c.addPolygon(rect(x - 1.0, -80.72, x + 1.0, -80.08), 0.8, 'metal', 'prop', L1);
  }
  g.box('plaster', 60.4, L1 + 1.05, -82.8, 0.8, 1.9, 0.04, 0, col('#1f2b45'));
  // red feature wall on the south wall behind the void (from the lobby floor up to the L2 slab), white beyond
  kit.box('plaster', (X0 + FL[0]) / 2, (0.02 + S2) / 2, SOUTH_WALL - 0.105, FL[0] - X0 - 0.2, S2 - 0.02, 0.01, 0, col('#b4432c'));
  // timber-slat ceiling with linear LEDs (the L2 slab soffit above is dark)
  const l2 = slabPoly(FL);
  ceiling(kit, l2, S2 - 0.02, col('#1a1b1d'));
  for (let z = Z0 + 0.3; z < Z1 - 0.2; z += 0.28) {
    const xEnd = z > FL[1] - 0.2 ? FL[0] - 0.1 : fx(z) - 0.15;
    g.box('wood', (X0 + 0.15 + xEnd) / 2, S2 - 0.42, z, xEnd - X0 - 0.15, 0.14, 0.07, 0, col('#9a7350'), 0.5);
  }
  for (let z = Z0 + 1.0; z < FL[1] - 0.3; z += 1.4) g.light((X0 + 0.4 + fx(z) - 0.4) / 2, S2 - 0.5, z, fx(z) - X0 - 0.8, 0.02, 0.05);
}

// ------------------------------------------------------------------------------------------------ flight + L2 lounge
function upper(kit: WorldKit, g: GroupKit): void {
  const c = kit.collision;
  const [x0, z0, x1, z1] = FL;
  const zc = (z0 + z1) / 2, w = z1 - z0;
  // flight: granite treads on a solid white stringer block (solid down to the L1 slab)
  const steps = 26;
  for (let k = 0; k < steps; k++) {
    const top = L1 + ((L2 - L1) * (k + 1)) / steps, run = (x1 - x0) / steps;
    kit.box('polished', x0 + run * (k + 0.5), (L1 + top) / 2, zc, run + 0.004, top - L1, w, 0, C.granite, 0.5);
  }
  c.addRamp(rect(x0, z0, x1, z1), [x0, zc], [x1, zc], L1, L2, 'concrete', 'stair', L1 - S1);
  // solid white balustrade wall on the open (north) side, following the flight up to the L2 slab soffit; stepped collision
  const side = new GeoBuffer({ color: true });
  const zs = z0 - 0.1;
  const q = (x: number) => L1 + ((L2 - L1) * (x - x0)) / (x1 - x0);
  const xk = x0 + ((S2 - 1.0 - L1) / (L2 - L1)) * (x1 - x0); // where the balustrade top meets the L2 slab
  const topAt = (x: number) => Math.min(q(x) + 1.0, S2);
  for (const [xa, xb] of [[x0, xk], [xk, x1]]) {
    for (const [zf, nz] of [[zs - 0.1, -1], [zs + 0.1, 1]] as [number, number][]) {
      const i0 = side.vert(xa, L1 - 0.02, zf, 0, 0, nz, 0, 0, C.wall), i1 = side.vert(xb, L1 - 0.02, zf, 0, 0, nz, 1, 0, C.wall);
      const i2 = side.vert(xb, topAt(xb), zf, 0, 0, nz, 1, 1, C.wall), i3 = side.vert(xa, topAt(xa), zf, 0, 0, nz, 0, 1, C.wall);
      if (nz > 0) side.quad(i0, i1, i2, i3); else side.quad(i0, i3, i2, i1);
    }
    const t0 = side.vert(xa, topAt(xa), zs - 0.1, 0, 1, 0, 0, 0, C.wall), t1 = side.vert(xb, topAt(xb), zs - 0.1, 0, 1, 0, 1, 0, C.wall);
    const t2 = side.vert(xb, topAt(xb), zs + 0.1, 0, 1, 0, 1, 1, C.wall), t3 = side.vert(xa, topAt(xa), zs + 0.1, 0, 1, 0, 0, 1, C.wall);
    side.quad(t0, t3, t2, t1);
  }
  const e0 = side.vert(x0, L1, zs - 0.1, -1, 0, 0, 0, 0, C.wall), e1 = side.vert(x0, L1, zs + 0.1, -1, 0, 0, 1, 0, C.wall);
  const e2 = side.vert(x0, topAt(x0), zs + 0.1, -1, 0, 0, 1, 1, C.wall), e3 = side.vert(x0, topAt(x0), zs - 0.1, -1, 0, 0, 0, 1, C.wall);
  side.quad(e0, e1, e2, e3);
  mergeInto(kit.buf('plaster', x0, z0), side);
  kit.buf('metal', x0, z0).beam([x0, q(x0) + 1.1, zs + 0.13], [xk, S2 + 0.1, zs + 0.13], 0.05, 0.05, C.steel);
  for (let k = 0; k < 4; k++) {
    const xa = x0 + ((x1 - x0) * k) / 4, xb = x0 + ((x1 - x0) * (k + 1)) / 4;
    c.addPolygon(rect(xa, zs - 0.1, xb, zs + 0.1), Math.min(q(xb) + 1.1, S2) - L1, 'concrete', 'parapet', L1);
  }
  // L2 slab (open over the flight), floor, ceiling
  const l2 = slabPoly(FL);
  c.addPolygon(l2, L2 - S2, 'concrete', 'slab', S2);
  floor(g, l2, L2 + 0.03, col('#b7b6b1'));
  kit.box('plaster', (x0 + x1) / 2, (S2 + L2) / 2, z0 - 0.03, x1 - x0, L2 - S2, 0.06, 0, C.wall);
  kit.box('plaster', x0 - 0.03, (S2 + L2) / 2, zc, 0.06, L2 - S2, w + 0.2, 0, C.wall);
  ceiling(kit, [[X0, Z0], [fx(Z0), Z0], [fx(Z1), Z1], [X0, Z1]], ARC - 0.05, C.ceiling, g);
  for (let x = X0 + 1.6; x < fx(Z0) - 1; x += 3.2) for (const z of [-82.2, -79.4, -77.0]) {
    if (x > FL[0] - 0.5 && x < FL[2] + 0.5 && z > FL[1]) continue;
    tube(g, x, ARC - 0.05, z, 1.2, true);
  }
  // glass balustrade round the flight opening on L2
  const glassRail = (a: V2, b: V2) => {
    g.pane(a, b, L2 + 0.05, L2 + 1.05);
    kit.segBox('metal', a, b, L2 + 1.05, L2 + 1.1, 0.07, C.steelLight);
    kit.segBox('polished', a, b, L2, L2 + 0.08, 0.12, col('#8f8e8a'), 0, 0, 0.5);
    c.addPolygon(segPoly(a, b, 0.12), 1.1, 'metal', 'parapet', L2);
  };
  glassRail([x0, z0 - 0.06], [x1, z0 - 0.06]);
  glassRail([x0 - 0.06, z0], [x0 - 0.06, SOUTH_WALL - 0.1]);
  // lounge: study tables, a notice board, a water cooler, a planter
  lounge(kit, g, [[62.6, -80.3], [66.6, -80.3], [63.4, -77.3]], L2);
  noticeBoard(g, 67.2, L2 + 1.55, SOUTH_WALL - 0.12, 2.4, 1.1, 0, -1, 17);
  cooler(kit, g, 60.0, -77.0, L2);
  kit.box('polished', fx(-78) - 0.6, L2 + 0.4, -77.0, 0.8, 0.8, 0.8, 0, col('#1f2022'), 0.5);
  kit.collision.addPolygon(rect(fx(-78) - 1.0, -77.4, fx(-78) - 0.2, -76.6), 0.8, 'concrete', 'planter', L2);
  // north wall (L1: behind the counters; L2: doors into the rooms), south wall, both up to the arcade soffit
  wall(kit, [X0, NORTH_WALL], [fx(Z0), NORTH_WALL], { y0: S1 - 0.05, top: L2, colTop: L2, collide: true, color: C.wall });
  wall(kit, [X0, NORTH_WALL], [fx(Z0), NORTH_WALL], { y0: L2, top: ARC, dadoL: C.dadoGrey, dadoR: C.dadoOak, gk: g, leafSide: -1, openings: [
    { at: DOOR_201 - X0, w: 2.0, kind: 'door' }, { at: DOOR_202 - X0, w: 2.0, kind: 'door' },
  ] });
  wall(kit, [X0, SOUTH_WALL], [fx(Z1), SOUTH_WALL], { y0: S1 - 0.05, top: ARC, color: C.wall });
  // room plates beside the L2 doors
  for (const x of [DOOR_201 + 1.35, DOOR_202 + 1.35]) {
    g.box('plaster', x, L2 + 1.75, NORTH_WALL + 0.12, 0.32, 0.22, 0.02, 0, col('#1f2b45'));
    g.box('plaster', x, L2 + 1.75, NORTH_WALL + 0.135, 0.24, 0.05, 0.01, 0, C.white);
  }
}

// ------------------------------------------------------------------------------------------------ glazed fronts
/** West (Quad colonnade) and east (portal) glazing of L1 + L2, with spandrels at the L2 slab. */
function fronts(kit: WorldKit, g: GroupKit): void {
  const c = kit.collision;
  const frame = col('#2b2f33');
  const glaze = (a: V2, b: V2, y0: number, y1: number, mull: number, door?: [number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (s: number): V2 => [a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len];
    const runs: [number, number][] = door ? [[0, door[0]], [door[1], len]] : [[0, len]];
    for (const [s0, s1] of runs) {
      if (s1 - s0 < 0.05) continue;
      g.pane(at(s0), at(s1), y0, y1);
      c.addPolygon(segPoly(at(s0), at(s1), 0.14), y1 - y0, 'metal', 'glazing', y0);
    }
    if (door) {
      g.pane(at(door[0]), at(door[1]), y0 + 2.6, y1);
      kit.segBox('metal', at(door[0]), at(door[1]), y0 + 2.55, y0 + 2.65, 0.14, frame);
      c.addPolygon(segPoly(at(door[0]), at(door[1]), 0.14), y1 - y0 - 2.6, 'metal', 'glazing', y0 + 2.6);
    }
    const n = Math.max(1, Math.round(len / mull));
    for (let k = 0; k <= n; k++) {
      const p = at((len * k) / n);
      kit.box('metal', p[0], (y0 + y1) / 2, p[1], 0.1, y1 - y0, 0.1, 0, frame);
    }
    kit.segBox('metal', a, b, y0, y0 + 0.08, 0.14, frame);
    kit.segBox('metal', a, b, y1 - 0.08, y1, 0.14, frame);
  };
  // west: L1 with a 3.6 m doorway onto the colonnade (glass leaves parked open), L2 floor-to-ceiling glass
  const wA: V2 = [X0, Z0 + 0.2], wB: V2 = [X0, Z1 - 0.2];
  glaze(wA, wB, L1, S2, 1.5, [1.6, 5.2]);
  glaze(wA, wB, L2, ARC - 0.1, 1.5);
  kit.segBox('stone', wA, wB, S2, L2 + 0.05, 0.3, col('#44484e'));
  kit.segBox('stone', wA, wB, ARC - 0.1, ARC + 0.02, 0.3, col('#e6e0d2'));
  for (const z of [Z0 + 1.9, Z0 + 5.3]) g.pane([X0 + 0.1, z], [X0 + 1.3, z], L1 + 0.05, L1 + 2.5);
  // L2: a glass rail inside the Quad-side glazing (the floor-to-ceiling panes start at the slab)
  kit.segBox('metal', [X0 + 0.12, Z0 + 0.2], [X0 + 0.12, Z1 - 0.2], L2 + 1.0, L2 + 1.05, 0.05, C.steelLight);
  // east: two-storey curtain wall above the lobby's glazing, inside the cream portal
  const eA: V2 = [fx(Z0 + 0.2), Z0 + 0.2], eB: V2 = [fx(Z1 - 0.2), Z1 - 0.2];
  glaze(eA, eB, L1 - 0.35, S2, 1.6);
  glaze(eA, eB, L2, ARC - 0.1, 1.6);
  kit.segBox('stone', eA, eB, S1 - 0.05, L1 - 0.35, 0.34, col('#44484e'));
  kit.segBox('stone', eA, eB, S2, L2 + 0.05, 0.34, col('#44484e'));
  kit.segBox('stone', eA, eB, ARC - 0.1, ARC + 0.02, 0.34, col('#e6e0d2'));
}

/** Opaque dark glass stand-in for both glazed fronts, shown when the fit-out is culled (panes are in the fit-out). */
function farGlass(kit: WorldKit): THREE.Mesh {
  const g = new GeoBuffer({ color: true });
  const dark = col('#2a343d');
  for (const [a, b] of [[[X0, Z1 - 0.2], [X0, Z0 + 0.2]], [[fx(Z0 + 0.2), Z0 + 0.2], [fx(Z1 - 0.2), Z1 - 0.2]]] as [V2, V2][]) {
    g.wallQuad(a, b, L1, ARC - 0.1, dark, 1, true);
  }
  const m = new THREE.Mesh(g.toGeometry(), kit.material('glass'));
  m.name = 'gk:farGlass';
  m.matrixAutoUpdate = false; m.updateMatrix();
  return m;
}

// ------------------------------------------------------------------------------------------------ L2 rooms in the east wing
function l2Rooms(kit: WorldKit, g: GroupKit): void {
  const [rx0, rz0, rx1, rz1] = ROOMS;
  const mid = 70.2, CEIL = ARC - 0.45;
  const opts = { y0: L2, top: CEIL + 0.05, colTop: ARC, gk: g };
  // west wall just inside the east wing's west face, with windows onto the colonnade and the Quad
  wall(kit, [rx0 + 0.15, rz0], [rx0 + 0.15, rz1 + 0.1], { ...opts, dadoR: C.dadoOak, openings: [
    { at: 1.6, w: 2.2, kind: 'window', sill: 0.9, h: 2.9 }, { at: 4.5, w: 2.2, kind: 'window', sill: 0.9, h: 2.9 }, { at: 7.4, w: 1.8, kind: 'window', sill: 0.9, h: 2.9 },
  ] });
  wall(kit, [rx0, rz0 + 0.1], [rx1, rz0 + 0.1], { ...opts, dadoL: C.dadoOak });
  wall(kit, [rx1 - 0.1, rz0], [rx1 - 0.1, rz1 + 0.1], { ...opts, dadoL: C.dadoOak });
  wall(kit, [mid, rz0 + 0.2], [mid, rz1 + 0.1], { ...opts, dadoL: C.dadoOak, dadoR: C.dadoOak });
  for (const r of [[rx0 + 0.25, rz0 + 0.2, mid - 0.1, rz1 - 0.1], [mid + 0.1, rz0 + 0.2, rx1 - 0.2, rz1 - 0.1]] as [number, number, number, number][]) {
    floor(g, rect(r[0] - 0.1, r[1] - 0.1, r[2] + 0.1, r[3] + 0.1), L2 + 0.03, C.roomFloor, 'polished', 1);
    ceiling(kit, rect(r[0] - 0.15, r[1] - 0.15, r[2] + 0.15, r[3] + 0.15), CEIL, C.ceiling, g);
  }
  classroom(kit, g, [rx0 + 0.25, rz0 + 0.2, mid - 0.1, rz1 - 0.1], 'n', L2, CEIL);
  facultyRoom(kit, g, [mid + 0.1, rz0 + 0.2, rx1 - 0.2, rz1 - 0.1], 's', L2, CEIL);
}

function mergeInto(dst: GeoBuffer, src: GeoBuffer): void {
  const base = dst.vertexCount;
  for (let i = 0; i < src.vertexCount; i++) {
    dst.pos.push(src.pos[i * 3], src.pos[i * 3 + 1], src.pos[i * 3 + 2]);
    dst.nrm.push(src.nrm[i * 3], src.nrm[i * 3 + 1], src.nrm[i * 3 + 2]);
    dst.uv.push(src.uv[i * 2], src.uv[i * 2 + 1]);
    if (dst.withColor) dst.col.push(src.col[i * 3] ?? 1, src.col[i * 3 + 1] ?? 1, src.col[i * 3 + 2] ?? 1);
    if (dst.withFacade) dst.fac.push(3.5, 3.5, 0, 0);
  }
  for (const k of src.idx) dst.idx.push(base + k);
}
