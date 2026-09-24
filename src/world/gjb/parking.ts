import { hash2 } from '../geom';
import { col, type WorldKit } from '../kit';
import { hedgeBox } from '../landscape';
import { PARKING, type V2 } from '../layout';
import { rect, segPoly } from './util';

/**
 * The 2-wheeler parking (reference/GJB_NOTES.md §4; GJB tour 0:26–0:47, 1:04–1:10, 2:02, 3:16; the user's Google Maps
 * screenshot + reference/sat_east_grid.jpg): a long 2-level N–S concrete structure right opposite GJBC's east wing,
 * with the east lawn between it and GJBC, running from the entry walkway (north) to the food court (south).
 *  - ground floor (y = 0): walkable now; a door in the green north face (off the walkway), two doors in the lawn-side
 *    corten + green-mesh screen, open south end by the food court;
 *  - upper deck (PARKING.deck): open-air, grey parapets, the white flat-roofed covered bay at the north end facing the
 *    walkway; a slab prism with base > 1.5 m so you walk underneath it today;
 *  - vehicle ramp along the back wall at the north end (off the walkway), pedestrian stair at the south end
 *    (addRamp, solid until levels land). The back (east) wall is the campus boundary (layout.ts WALLS).
 *  - the reflecting pool sits at the north end of the lawn under a tall grey retaining wall (1:04–1:08).
 * The scooters are the Props.ts `bike` prototype, placed from parkingSlots().
 */
const P = PARKING;
const MID_X = (P.x0 + P.x1) / 2;
const COLS_Z = [-104, -97.3, -90.6, -83.9, -77.2, -70.5, -63.8, -57.1, -50.4, -43.7, -37];
/** bike-row centre lines (x) and facing (yaw: π/2 = nose east, −π/2 = nose west) */
const ROW_W = P.x0 + 1.25, ROW_MW = MID_X - 0.95, ROW_ME = MID_X + 0.95, ROW_E = P.x1 - 1.25;

export interface ParkingSlot { x: number; z: number; yaw: number; y: number }

/**
 * Deterministic parked-scooter slots on both levels, in clusters (dense near the walkway end, thinner to the south).
 * ≈170 in total; yaw 0 = facing +Z.
 */
export function parkingSlots(): ParkingSlot[] {
  const out: ParkingSlot[] = [];
  const near = (z: number, list: number[], r: number) => list.some((c) => Math.abs(z - c) < r);
  const inDoor = (z: number) => P.westDoors.some(([a, b]) => z > a - 1.2 && z < b + 1.2);
  const fillAt = (z: number, y: number, x: number) => {
    const north = (z - P.z1) / (P.z0 - P.z1); // 1 at the walkway end
    const cluster = hash2(Math.floor(z / 7) * 3.1 + x, y + 5.7); // 7 m clusters
    return (y > 0 ? 0.16 : 0.22) + 0.28 * north + (cluster - 0.5) * 0.5;
  };
  const row = (x: number, za: number, zb: number, yaw: number, y: number, skip?: (z: number) => boolean) => {
    for (let z = za; z <= zb; z += 1.0) {
      if (skip?.(z)) continue;
      if (hash2(x * 3.7 + y, z * 1.3) > fillAt(z, y, x)) continue;
      out.push({ x: x + (hash2(z, x) - 0.5) * 0.14, z, yaw, y });
    }
  };
  const colSkip = (z: number) => near(z, COLS_Z, 0.75);
  // ground floor: west row nosed to the corten face (clear of the doors and the stair), a back-to-back double row
  // on the column line, east row nosed to the back wall (south of the ramp)
  row(ROW_W, P.z0 + 2.5, P.stairZ - 1.2, -Math.PI / 2, 0, inDoor);
  row(ROW_MW, P.z0 + 3, P.z1 - 2, -Math.PI / 2, 0, colSkip);
  row(ROW_ME, P.z0 + 3, P.z1 - 2, Math.PI / 2, 0, colSkip);
  row(ROW_E, P.rampZ + 2, P.z1 - 2, Math.PI / 2, 0);
  // upper deck (the bay posts sit on the column line under the covered bay)
  const bayPosts = [P.bay.z0 + 0.4, P.bay.z1 - 0.4];
  row(ROW_W, P.z0 + 1.5, P.stairZ - 1.5, -Math.PI / 2, P.deck);
  row(ROW_MW, P.z0 + 1.5, P.z1 - 1.5, -Math.PI / 2, P.deck, (z) => near(z, bayPosts, 0.7));
  row(ROW_ME, P.z0 + 1.5, P.z1 - 1.5, Math.PI / 2, P.deck, (z) => near(z, bayPosts, 0.7));
  row(ROW_E, P.rampZ + 1.5, P.z1 - 1.5, Math.PI / 2, P.deck);
  return out;
}

export function buildParking(kit: WorldKit): void {
  const c = kit.collision;
  const concrete = col('#bdb8ae'), deckTop = col('#aaa69e'), deckUnder = col('#cfcac2'), parapet = col('#9c9a94');
  const green = col('#3f8566'), darkWall = col('#5f6163'), white = col('#f1f1ee');
  const { x0, x1, z0, z1, deck: D, deckT: T } = P;
  const top = D + 1.2; // height of the screens / walls that double as the deck parapets
  // --- upper deck slab (openings over the ramp at the north-east and over the stair at the south-west)
  const deck: V2[] = [[x0, z0], [P.rampX, z0], [P.rampX, P.rampZ], [x1, P.rampZ], [x1, z1], [P.stairX, z1], [P.stairX, P.stairZ], [x0, P.stairZ]];
  kit.buf('concrete', MID_X, -70).flatPoly(deck, D, deckTop, 3);
  kit.buf('concrete', MID_X, -70).flatPoly(deck, D - T, deckUnder, 3, true);
  c.addPolygon(deck, T, 'concrete', 'deck', D - T);
  // painted white bay lines on the deck and the ground floor
  for (let z = z0 + 1.5; z < z1 - 0.5; z += 2) for (const [x, y] of [[x0 + 2.6, D], [MID_X - 2.4, D], [MID_X + 2.4, D], [x1 - 2.6, D], [x0 + 2.6, 0], [MID_X - 2.4, 0], [MID_X + 2.4, 0], [x1 - 2.6, 0]] as V2[]) {
    if (y === 0 && x > P.rampX - 1 && z < P.rampZ) continue;
    kit.box('stone', x, y + 0.012, z, 1.6, 0.01, 0.06, 0, col('#e8e8e2'));
  }
  // --- ground-floor columns on the middle line (the corten screen and the back wall carry the deck edges)
  for (const z of COLS_Z) {
    kit.box('concrete', MID_X, (D - T) / 2, z, 0.42, D - T, 0.42, 0, concrete, 0.5);
    c.addCircle(MID_X, z, 0.3, D - T, 'concrete', 'column');
  }
  // --- lawn-side (west) face: corten + green-mesh screen, full height, two walk-in doors (lintels above)
  const uv = 3.2 / top; // fit one texture repeat (rust panel + green panel) to the screen height
  const runs: V2[] = [];
  let a = z0;
  for (const [d0, d1] of P.westDoors) { runs.push([a, d0]); a = d1; }
  runs.push([a, z1]);
  for (const [r0, r1] of runs) {
    kit.segBox('corten', [x0, r0], [x0, r1], 0, top, 0.24, col('#ffffff'), 0, 0, uv);
    c.addPolygon(rect(x0 - 0.15, r0, x0 + 0.15, r1), top, 'metal', 'wall');
  }
  for (const [d0, d1] of P.westDoors) {
    kit.segBox('corten', [x0, d0], [x0, d1], 2.5, top, 0.24, col('#ffffff'), 0, 0, uv);
    kit.segBox('metal', [x0 - 0.16, d0], [x0 - 0.16, d1], 2.45, 2.55, 0.06, col('#2a211b'));
    c.addPolygon(rect(x0 - 0.15, d0, x0 + 0.15, d1), top - 2.5, 'metal', 'lintel', 2.5);
  }
  kit.segBox('metal', [x0, z0], [x0, z1], top, top + 0.08, 0.36, col('#2a211b'));
  // --- north face towards the walkway: green-painted, a door on the pedestrian line; the ramp lane is open
  const [n0, n1] = P.northDoor;
  for (const [ra, rb] of [[x0, n0], [n1, P.rampX]] as V2[]) {
    kit.segBox('paint', [ra, z0], [rb, z0], 0, top, 0.3, green, 0, 0, 0.5);
    c.addPolygon(rect(ra, z0 - 0.15, rb, z0 + 0.15), top, 'concrete', 'wall');
  }
  kit.segBox('paint', [n0, z0], [n1, z0], 2.6, top, 0.3, green, 0, 0, 0.5);
  c.addPolygon(rect(n0, z0 - 0.15, n1, z0 + 0.15), top - 2.6, 'concrete', 'lintel', 2.6);
  // --- vehicle ramp along the back wall at the north end: ground at the walkway → deck at rampZ; its inner side wall
  // doubles as the deck edge
  const rx0 = P.rampX, rx1 = x1;
  const rb = kit.buf('concrete', (rx0 + rx1) / 2, (z0 + P.rampZ) / 2);
  const rn = 8, rampCol = col('#a9a59d');
  for (let i = 0; i < rn; i++) {
    const za = z0 + ((P.rampZ - z0) * i) / rn, zb = z0 + ((P.rampZ - z0) * (i + 1)) / rn;
    const ya = (D * i) / rn, yb = (D * (i + 1)) / rn;
    const len = Math.hypot(zb - za, yb - ya);
    const ny = (zb - za) / len, nz = -(yb - ya) / len;
    const i0 = rb.vert(rx0, ya + 0.02, za, 0, ny, nz, rx0, za, rampCol), i1 = rb.vert(rx1, ya + 0.02, za, 0, ny, nz, rx1, za, rampCol);
    const i2 = rb.vert(rx1, yb + 0.02, zb, 0, ny, nz, rx1, zb, rampCol), i3 = rb.vert(rx0, yb + 0.02, zb, 0, ny, nz, rx0, zb, rampCol);
    rb.quad(i0, i3, i2, i1);
    for (let k = 1; k < 4; k++) {
      const f = k / 4, z = za + (zb - za) * f, y = ya + (yb - ya) * f;
      kit.box('concrete', (rx0 + rx1) / 2, y + 0.04, z, rx1 - rx0 - 0.3, 0.04, 0.08, 0, col('#8f8b84'));
    }
  }
  kit.segBox('concrete', [rx0, z0], [rx0, P.rampZ], 0, top, 0.25, parapet, 0.125, 0, 0.5);
  c.addPolygon(rect(rx0 - 0.25, z0, rx0, P.rampZ), top, 'concrete', 'wall');
  c.addRamp(rect(rx0, z0, rx1, P.rampZ), [(rx0 + rx1) / 2, z0], [(rx0 + rx1) / 2, P.rampZ], 0, D, 'concrete', 'ramp');
  // --- pedestrian stair at the south end along the corten face (rises north onto the deck)
  const steps = 20, run = (P.stairZ - z1) / steps, rise = D / steps; // run < 0 (northward)
  for (let k = 0; k < steps; k++) {
    const za = z1 + k * run, h = (k + 1) * rise;
    kit.box('granite', (x0 + P.stairX) / 2, h / 2, za + run / 2, P.stairX - x0 - 0.1, h, Math.abs(run) + 0.01, 0, col('#b3aea6'), 0.5);
  }
  kit.buf('metal', P.stairX, (z1 + P.stairZ) / 2).beam([P.stairX + 0.05, 1.0, z1], [P.stairX + 0.05, D + 1.0, P.stairZ], 0.06, 0.06, col('#8d9398'));
  c.addRamp(rect(x0, P.stairZ, P.stairX, z1), [(x0 + P.stairX) / 2, z1], [(x0 + P.stairX) / 2, P.stairZ], 0, D, 'concrete', 'stair');
  // --- deck parapets (grey concrete, 1 m): south end and the stairwell side (the other edges are the screen / walls)
  const par = (p0: V2, p1: V2) => {
    kit.segBox('concrete', p0, p1, D - T, D + 1.0, 0.22, parapet, 0, 0.1, 0.5);
    c.addPolygon(segPoly(p0, p1, 0.22), T + 1.0, 'concrete', 'parapet', D - T);
  };
  par([P.stairX, z1 - 0.11], [x1, z1 - 0.11]);
  par([P.stairX + 0.11, P.stairZ], [P.stairX + 0.11, z1]);
  // --- white flat-roofed covered bay on the deck at the north end (open to the walkway, 0:40 / 0:47 / old tour 1922)
  const B = P.bay;
  const bayPoly = rect(B.x0, B.z0, B.x1, B.z1);
  kit.buf('paint', (B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2).flatPoly(bayPoly, B.roof + 0.35, col('#e6e6e2'), 3);
  kit.buf('paint', (B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2).flatPoly(bayPoly, B.roof, col('#d9d8d3'), 3, true);
  kit.box('paint', (B.x0 + B.x1) / 2, B.roof - 0.25, B.z0 + 0.12, B.x1 - B.x0 + 0.2, 1.2, 0.25, 0, white, 0.5);
  kit.box('paint', (B.x0 + B.x1) / 2, B.roof - 0.25, B.z1 - 0.12, B.x1 - B.x0 + 0.2, 1.2, 0.25, 0, white, 0.5);
  kit.box('paint', B.x1 - 0.12, B.roof - 0.25, (B.z0 + B.z1) / 2, 0.25, 1.2, B.z1 - B.z0, 0, white, 0.5);
  kit.box('paint', B.x0 + 0.12, (top + B.roof + 0.35) / 2, (B.z0 + B.z1) / 2, 0.25, B.roof + 0.35 - top, B.z1 - B.z0, 0, white, 0.5);
  for (const x of [B.x0 + 0.4, MID_X, B.x1 - 0.4]) for (const z of [B.z0 + 0.4, B.z1 - 0.4]) {
    kit.box('metal', x, (D + B.roof) / 2, z, 0.2, B.roof - D, 0.2, 0, col('#6f757b'));
    c.addCircle(x, z, 0.16, B.roof, 'metal', 'post');
  }
  c.addPolygon(bayPoly, 0.6, 'concrete', 'roof', B.roof - 0.25);
  // --- corten screens with a leaf cut-out marking the entrances (beside the north door, the ramp mouth, the south-east corner)
  for (const [cx, cz, h, alongX] of [[n0 - 1.6, z0 - 0.5, 5.6, 1], [x1 - 0.2, z0 - 1.6, 6.2, 0], [x1 - 1.6, z1 + 0.4, 5.4, 1]] as number[][]) {
    const sx = alongX ? 2.6 : 0.16, sz = alongX ? 0.16 : 2.6;
    kit.box('corten', cx, h / 2, cz, sx, h, sz, 0, col('#ffffff'), 1);
    for (let k = 0; k < 7; k++) {
      const o = ((k % 2) - 0.5) * 0.5;
      kit.box('dark', cx + (alongX ? o : 0.09), 1.2 + k * 0.6, cz + (alongX ? 0.09 : o), alongX ? 0.12 : 0.02, 0.35, alongX ? 0.02 : 0.12, 0, col('#1a1410'));
    }
    c.addPolygon(rect(cx - sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2), h, 'metal', 'screen');
  }
  // --- tube lights under the deck (night) and in the bay
  for (let z = z0 + 4; z < z1 - 1; z += 6.5) for (const x of [x0 + 3.5, x1 - 3.5]) kit.box('emissive', x, D - T - 0.03, z, 0.1, 0.05, 1.2, 0, col('#ffffff'));
  for (let x = B.x0 + 3; x < B.x1 - 1; x += 4.5) kit.box('emissive', x, B.roof - 0.03, (B.z0 + B.z1) / 2, 0.1, 0.05, 1.2, 0, col('#ffffff'));
  // deck bike-row collision (base = deck; the ground-floor bikes get their own prop collision in Props.ts)
  for (const [xa, xb, za, zb] of [
    [x0 + 0.2, x0 + 2.2, z0 + 1, P.stairZ - 1], [MID_X - 1.95, MID_X + 1.95, z0 + 1, z1 - 1], [x1 - 2.2, x1 - 0.2, P.rampZ + 1, z1 - 1],
  ] as number[][]) c.addPolygon(rect(xa, za, xb, zb), 1.1, 'metal', 'prop', D);
  // --- reflecting pool at the north end of the lawn, under the entry walkway's tall grey retaining wall (1:04–1:08)
  const W = P.retainingWall;
  kit.segBox('concrete', [W.x0, W.z], [W.x1, W.z], 0, W.h, 0.35, darkWall, 0, 0, 0.5);
  kit.segBox('granite', [W.x0, W.z], [W.x1, W.z], W.h, W.h + 0.08, 0.45, col('#2c2e30'));
  c.addSegment([W.x0, W.z], [W.x1, W.z], 0.35, W.h, 'concrete', 'wall');
  hedgeBox(kit, 'hedge', [W.x0 + 1.5, W.z + 0.6], [W.x1 - 0.5, W.z + 0.6], 0, 0.7, 0.7);
  const Q = P.pool;
  const pc = col('#34373a');
  for (const [p0, p1] of [[[Q.x0, Q.z0], [Q.x1, Q.z0]], [[Q.x1, Q.z0], [Q.x1, Q.z1]], [[Q.x1, Q.z1], [Q.x0, Q.z1]], [[Q.x0, Q.z1], [Q.x0, Q.z0]]] as [V2, V2][]) kit.segBox('polished', p0, p1, 0, 0.45, 0.35, pc, 0, 0.35, 0.5);
  kit.buf('glass', (Q.x0 + Q.x1) / 2, (Q.z0 + Q.z1) / 2).flatPoly(rect(Q.x0, Q.z0, Q.x1, Q.z1), 0.32, col('#1f2d33'), 4);
  c.addPolygon(rect(Q.x0 - 0.18, Q.z0 - 0.18, Q.x1 + 0.18, Q.z1 + 0.18), 0.45, 'concrete', 'pool');
  // fountain grass along the foot of the corten screen on the lawn side (between the doors)
  for (const [r0, r1] of runs) if (r1 - r0 > 4) hedgeBox(kit, 'hedge', [x0 - 0.6, r0 + 1], [x0 - 0.6, r1 - 1], 0, 0.55, 0.6);
}
