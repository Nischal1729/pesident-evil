import * as THREE from 'three';
import { hash2 } from '../geom';
import { col, type WorldKit } from '../kit';
import { hedgeBox } from '../landscape';
import { PARKING, type V2 } from '../layout';
import { GroupKit, rect, segPoly } from './util';

/**
 * The 2-wheeler parking (the user's description of 2026-09-25; GJB tour 0:26–0:47, 1:04–1:10, 2:02, 3:16; the user's
 * Google Maps screenshot + reference/sat_east_grid.jpg): a long N–S concrete structure right opposite GJBC's east wing,
 * with the east lawn between it and GJBC, running from the entry walkway (north) to the food court (south). The campus
 * falls from the main gate towards GJB, so:
 *  - the -1 floor (PARKING.low) is at GJB / lawn level: two walk-in doors in the lawn-side corten + green-mesh screen,
 *    open south end by the food court, a pedestrian stair up to the ground floor along the screen;
 *  - the ground floor (PARKING.road) is at the level of the entry walkway: an open-air yard at the north end straight
 *    off the walkway, then the covered floor under a white fascia; the PES Innovation Lab block fills its south end
 *    (PIL west, lobby north-east opening onto the parking, Huawei innovation lab south of the lobby);
 *  - vehicles for the -1 floor turn left (east) off the yard into a lane that runs down along the back wall between a
 *    grey parapet and the green-painted back wall to the middle of the parking (0:43–0:45, the "17" post);
 *  - the roof over the covered floor (PARKING.roof) is an empty terrace with no access.
 * The back (east) wall is the campus boundary (layout.ts WALLS). The scooters are the Props.ts `bike` prototype, placed
 * from parkingSlots(). The reflecting pool sits at the north end of the lawn under a tall grey retaining wall (1:04–1:08).
 */
const P = PARKING;
const { x0: X0, x1: X1, z0: Z0, z1: Z1, low: LOW, road: ROAD, roof: ROOF, slabT: T } = P;
const L = P.labs;
const MID_X = (X0 + X1) / 2; // = L.xMid: the middle column line doubles as the PIL / lobby wall
/** middle-line columns: the -1 floor has them all; the covered ground floor those south of the fascia */
const COLS_Z = [-104, -97.3, -90.6, -83.9, -77.2, -70.5, -63.8, -57.1, -50.4, -43.7, -37];
/** bike-row centre lines (x); yaw π/2 = nose east, −π/2 = nose west */
const ROW_W = X0 + 1.25, ROW_MW = MID_X - 0.95, ROW_ME = MID_X + 0.95, ROW_LANE = P.laneX - 1.25, ROW_E = X1 - 1.25;
/**
 * Until the entry corridor is raised to road level (the campus slope), the yard is reached from the flat walkway by a
 * temporary ramp over the entry strip. Remove this (and the ramp below) once the terrain lands.
 */
const FLAT_CAMPUS_ACCESS = true;
const ACCESS_Z = -117.5;
/** PIL door (lobby → PIL, in the dividing wall) and the Huawei lab door (lobby → Huawei, in the lobby's south wall) */
const PIL_DOOR: V2 = [-46.3, -44.5];
const HUAWEI_DOOR: V2 = [132.2, 134.0];
const LOBBY_OPENING: V2 = [131.9, 134.3];
/** interior detail is culled beyond this distance from the lab block */
const LAB_CULL = 55;

export interface ParkingSlot { x: number; z: number; yaw: number; y: number }

/**
 * Deterministic parked-scooter slots on both floors, in clusters (dense near the walkway end, thinner to the south).
 * yaw 0 = facing +Z.
 */
export function parkingSlots(): ParkingSlot[] {
  const out: ParkingSlot[] = [];
  const near = (z: number, list: number[], r: number) => list.some((c) => Math.abs(z - c) < r);
  const inDoor = (z: number) => P.westDoors.some(([a, b]) => z > a - 1.2 && z < b + 1.2);
  const inStair = (z: number) => z > P.stairZ1 - 1.4 && z < P.stairZ0 + 1.4;
  const fillAt = (z: number, y: number, x: number) => {
    const north = (z - Z1) / (Z0 - Z1); // 1 at the walkway end
    const cluster = hash2(Math.floor(z / 7) * 3.1 + x, y + 5.7); // 7 m clusters
    return (y > LOW ? 0.24 : 0.18) + 0.28 * north + (cluster - 0.5) * 0.5;
  };
  const row = (x: number, za: number, zb: number, yaw: number, y: number, skip?: (z: number) => boolean) => {
    for (let z = za; z <= zb; z += 1.0) {
      if (skip?.(z)) continue;
      if (hash2(x * 3.7 + y, z * 1.3) > fillAt(z, y, x)) continue;
      out.push({ x: x + (hash2(z, x) - 0.5) * 0.14, z, yaw, y });
    }
  };
  const colSkip = (z: number) => near(z, COLS_Z, 0.75);
  // -1 floor: west row nosed to the screen (clear of the doors and the stair), a back-to-back double row on the column
  // line, and a row along the back wall south of the lane (the lane itself stays clear)
  row(ROW_W, Z0 + 2.5, Z1 - 2, -Math.PI / 2, LOW, (z) => inDoor(z) || inStair(z));
  row(ROW_MW, Z0 + 3, Z1 - 2, -Math.PI / 2, LOW, colSkip);
  row(ROW_ME, Z0 + 3, Z1 - 2, Math.PI / 2, LOW, colSkip);
  row(ROW_E, P.rampZ + 4, Z1 - 2, Math.PI / 2, LOW);
  // ground floor (yard + covered floor, north of the labs): west row, double row, and an east row nosed to the lane
  // parapet (north) or the back wall (over the -1 lane, south)
  const gEnd = L.z0 - 2.5;
  row(ROW_W, Z0 + 1.5, gEnd, -Math.PI / 2, ROAD, inStair);
  row(ROW_MW, Z0 + 1.5, gEnd, -Math.PI / 2, ROAD, colSkip);
  row(ROW_ME, Z0 + 1.5, gEnd, Math.PI / 2, ROAD, colSkip);
  row(ROW_LANE, Z0 + 1.5, P.rampZ - 1, Math.PI / 2, ROAD);
  row(ROW_E, P.rampZ + 1.5, gEnd, Math.PI / 2, ROAD);
  return out;
}

export function buildParking(kit: WorldKit): void {
  const c = kit.collision;
  const concrete = col('#bdb8ae'), slabTop = col('#aaa69e'), slabUnder = col('#cfcac2'), parapet = col('#9c9a94');
  const green = col('#3f8566'), darkWall = col('#5f6163'), white = col('#f1f1ee');
  const scrTop = ROOF + 1.0; // the lawn-side screen runs up to the roof parapet over the covered floor
  const yardTop = ROAD + 1.1; // ... and doubles as the yard's parapet at the north end

  // --- ground-floor slab at road level: everything but the lane trench (north-east) and the stairwell (south-west)
  const slab: V2[] = [[X0, Z0], [P.laneX, Z0], [P.laneX, P.rampZ], [X1, P.rampZ], [X1, Z1], [X0, Z1], [X0, P.stairZ0], [P.stairX, P.stairZ0], [P.stairX, P.stairZ1], [X0, P.stairZ1]];
  kit.buf('concrete', MID_X, -70).flatPoly(slab, ROAD, slabTop, 3);
  kit.buf('concrete', MID_X, -70).flatPoly(slab, ROAD - T, slabUnder, 3, true);
  c.addPolygon(slab, T, 'concrete', 'deck', ROAD - T);
  // --- roof slab over the covered floor: an empty terrace (the screen, back wall and parapets keep it out of reach)
  const covered = rect(X0, P.yardZ, X1, Z1);
  kit.buf('concrete', MID_X, -64).flatPoly(covered, ROOF, col('#a3a09a'), 3);
  kit.buf('concrete', MID_X, -64).flatPoly(covered, ROOF - T, slabUnder, 3, true);
  c.addPolygon(covered, T, 'concrete', 'roof', ROOF - T);
  // white fascia across the covered floor's north edge (the white "covered bay" read from the yard, 0:40 / 0:47)
  kit.box('paint', MID_X, (ROAD + 2.35 + scrTop) / 2, P.yardZ + 0.15, X1 - X0, scrTop - ROAD - 2.35, 0.3, 0, white, 0.5);
  c.addPolygon(rect(X0, P.yardZ, X1, P.yardZ + 0.3), scrTop - ROAD - 2.35, 'concrete', 'fascia', ROAD + 2.35);

  // painted white bay lines on both floors (not on the lane body, in the stairwell or in the lab block)
  for (let z = Z0 + 1.5; z < Z1 - 0.5; z += 2) for (const [x, y] of [[X0 + 2.6, ROAD], [MID_X - 2.4, ROAD], [MID_X + 2.4, ROAD], [X0 + 2.6, LOW], [MID_X - 2.4, LOW], [MID_X + 2.4, LOW]] as V2[]) {
    if (y === ROAD && z > L.z0 - 0.5) continue;
    if (x < P.stairX + 1 && z > P.stairZ1 - 0.5 && z < P.stairZ0 + 0.5) continue;
    kit.box('stone', x, y + (y === LOW ? 0.052 : 0.012), z, 1.6, 0.01, 0.06, 0, col('#e8e8e2')); // over the -1 floor's paving (y 0.04)
  }

  // --- columns on the middle line (the screen and the back wall carry the slab edges)
  for (const z of COLS_Z) {
    kit.box('concrete', MID_X, (ROAD - T) / 2, z, 0.42, ROAD - T, 0.42, 0, concrete, 0.5);
    c.addCircle(MID_X, z, 0.3, ROAD - T, 'concrete', 'column');
    if (z > P.yardZ + 0.5 && z < L.z0) {
      kit.box('concrete', MID_X, (ROAD + ROOF - T) / 2, z, 0.42, ROOF - T - ROAD, 0.42, 0, concrete, 0.5);
      c.addCircle(MID_X, z, 0.3, ROOF - T - ROAD, 'concrete', 'column', ROAD);
    }
  }

  // --- lawn-side (west) face: corten + green-mesh screen from the lawn up to the roof parapet (the tall screen along
  // the path by the pool, 1:10), two walk-in doors into the -1 floor (lintels above)
  const uv = 3.2 / 4.4; // one texture repeat (rust panel + green panel) per 4.4 m, as before
  const runs: V2[] = [];
  let a = Z0;
  for (const [d0, d1] of P.westDoors) { runs.push([a, d0]); a = d1; }
  runs.push([a, Z1]);
  for (const [r0, r1] of runs) {
    kit.segBox('corten', [X0, r0], [X0, r1], 0, yardTop, 0.24, col('#ffffff'), 0, 0, uv);
    c.addPolygon(rect(X0 - 0.15, r0, X0 + 0.15, r1), yardTop, 'metal', 'wall');
  }
  for (const [d0, d1] of P.westDoors) {
    kit.segBox('corten', [X0, d0], [X0, d1], 2.5, yardTop, 0.24, col('#ffffff'), 0, 0, uv);
    kit.segBox('metal', [X0 - 0.16, d0], [X0 - 0.16, d1], 2.45, 2.55, 0.06, col('#2a211b'));
    c.addPolygon(rect(X0 - 0.15, d0, X0 + 0.15, d1), yardTop - 2.5, 'metal', 'lintel', 2.5);
  }
  kit.segBox('corten', [X0, P.yardZ], [X0, Z1], yardTop, scrTop, 0.24, col('#ffffff'), 0, 0, uv);
  c.addPolygon(rect(X0 - 0.15, P.yardZ, X0 + 0.15, Z1), scrTop - yardTop, 'metal', 'wall', yardTop);
  kit.segBox('metal', [X0, Z0], [X0, P.yardZ], yardTop, yardTop + 0.08, 0.36, col('#2a211b'));
  kit.segBox('metal', [X0, P.yardZ], [X0, Z1], scrTop, scrTop + 0.08, 0.36, col('#2a211b'));

  // --- north face of the -1 floor under the yard: a green-painted retaining wall (the walkway is at road level)
  kit.segBox('paint', [X0, Z0], [P.laneX, Z0], LOW, ROAD, 0.3, green, -0.15, 0, 0.5);
  c.addPolygon(rect(X0, Z0 - 0.3, P.laneX, Z0), ROAD - LOW, 'concrete', 'wall', LOW);

  // --- lane down to the -1 floor along the back wall: road level at the yard (z0) → -1 floor at rampZ
  const lx0 = P.laneX, lx1 = X1;
  const rb = kit.buf('concrete', (lx0 + lx1) / 2, (Z0 + P.rampZ) / 2);
  const rn = 12, laneCol = col('#a9a59d');
  for (let i = 0; i < rn; i++) {
    const za = Z0 + ((P.rampZ - Z0) * i) / rn, zb = Z0 + ((P.rampZ - Z0) * (i + 1)) / rn;
    const ya = ROAD + ((LOW - ROAD) * i) / rn, yb = ROAD + ((LOW - ROAD) * (i + 1)) / rn;
    const len = Math.hypot(zb - za, yb - ya);
    const ny = (zb - za) / len, nz = -(yb - ya) / len;
    const i0 = rb.vert(lx0, ya + 0.02, za, 0, ny, nz, lx0, za, laneCol), i1 = rb.vert(lx1, ya + 0.02, za, 0, ny, nz, lx1, za, laneCol);
    const i2 = rb.vert(lx1, yb + 0.02, zb, 0, ny, nz, lx1, zb, laneCol), i3 = rb.vert(lx0, yb + 0.02, zb, 0, ny, nz, lx0, zb, laneCol);
    rb.quad(i0, i3, i2, i1);
    for (let k = 1; k < 4; k++) { // anti-skid grooves
      const f = k / 4, z = za + (zb - za) * f, y = ya + (yb - ya) * f;
      kit.box('concrete', (lx0 + lx1) / 2, y + 0.04, z, lx1 - lx0 - 0.3, 0.04, 0.08, 0, col('#8f8b84'));
    }
  }
  c.addRamp(rect(lx0, Z0, lx1, P.rampZ), [(lx0 + lx1) / 2, Z0], [(lx0 + lx1) / 2, P.rampZ], ROAD, LOW, 'concrete', 'ramp');
  // grey parapet between the lane and the ground floor (the lane's side wall below, a 1 m parapet above the floor)
  kit.segBox('concrete', [lx0, Z0], [lx0, P.rampZ], LOW, ROAD + 1.0, 0.25, parapet, 0.125, 0, 0.5);
  c.addPolygon(rect(lx0 - 0.25, Z0, lx0, P.rampZ), ROAD + 1.0 - LOW, 'concrete', 'parapet', LOW);
  // ... and across the slab edge where the lane passes under the ground floor
  kit.segBox('concrete', [lx0, P.rampZ], [lx1, P.rampZ], ROAD - T, ROAD + 1.0, 0.22, parapet, -0.11, 0, 0.5);
  c.addPolygon(rect(lx0, P.rampZ, lx1, P.rampZ + 0.22), T + 1.0, 'concrete', 'parapet', ROAD - T);
  // green-painted back wall along the lane and the -1 floor (the "green block", 0:43), with dark windows and doors
  const gx = X1 - 0.03;
  kit.box('paint', gx, (LOW + ROAD + 1.4) / 2, (Z0 + P.rampZ) / 2, 0.05, ROAD + 1.4 - LOW, P.rampZ - Z0, 0, green, 0.5);
  kit.box('paint', gx, (LOW + ROAD - T) / 2, (P.rampZ + Z1) / 2, 0.05, ROAD - T - LOW, Z1 - P.rampZ, 0, green, 0.5);
  for (let z = Z0 + 4; z < Z1 - 2; z += 6) {
    const laneY = z < P.rampZ ? ROAD + ((LOW - ROAD) * (z - Z0)) / (P.rampZ - Z0) : LOW;
    const door = Math.round((z - Z0) / 6) % 4 === 1;
    const y0 = laneY + (door ? 0.02 : 1.0), y1 = laneY + (door ? 2.1 : 2.0);
    if (y1 > (z < P.rampZ ? ROAD + 1.3 : ROAD - T - 0.2)) continue;
    kit.box('dark', X1 - 0.07, (y0 + y1) / 2, z, 0.04, y1 - y0, door ? 1.0 : 1.4, 0, col('#1d2226'));
  }
  // a "17" level post at the lane mouth
  kit.box('paint', lx1 - 0.35, ROAD + 1.0, Z0 + 1.0, 0.25, 2.0, 0.6, 0, white, 0.5);
  kit.box('dark', lx1 - 0.49, ROAD + 1.45, Z0 + 1.0, 0.02, 0.35, 0.4, 0, col('#c0392b'));
  c.addPolygon(rect(lx1 - 0.48, Z0 + 0.7, lx1 - 0.22, Z0 + 1.3), 2.0, 'concrete', 'post', ROAD);

  // --- pedestrian stair between the floors along the screen, north of the labs (rises north onto the ground floor)
  const steps = 20, run = (P.stairZ1 - P.stairZ0) / steps, rise = (ROAD - LOW) / steps; // run < 0 (northward)
  for (let k = 0; k < steps; k++) {
    const za = P.stairZ0 + k * run, h = (k + 1) * rise;
    kit.box('granite', (X0 + P.stairX) / 2, LOW + h / 2, za + run / 2, P.stairX - X0 - 0.1, h, Math.abs(run) + 0.01, 0, col('#b3aea6'), 0.5);
  }
  kit.buf('metal', P.stairX, (P.stairZ0 + P.stairZ1) / 2).beam([P.stairX - 0.05, LOW + 1.0, P.stairZ0], [P.stairX - 0.05, ROAD + 1.0, P.stairZ1], 0.06, 0.06, col('#8d9398'));
  c.addRamp(rect(X0, P.stairZ1, P.stairX, P.stairZ0), [(X0 + P.stairX) / 2, P.stairZ0], [(X0 + P.stairX) / 2, P.stairZ1], LOW, ROAD, 'concrete', 'stair');
  // stairwell parapets on the ground floor (east side and south end; the stair tops out at its north end)
  const par = (p0: V2, p1: V2) => {
    kit.segBox('concrete', p0, p1, ROAD - T, ROAD + 1.0, 0.22, parapet, 0, 0.1, 0.5);
    c.addPolygon(segPoly(p0, p1, 0.22), T + 1.0, 'concrete', 'parapet', ROAD - T);
  };
  par([P.stairX + 0.11, P.stairZ1], [P.stairX + 0.11, P.stairZ0]);
  par([X0, P.stairZ0 + 0.11], [P.stairX + 0.22, P.stairZ0 + 0.11]);

  // --- temporary access from the flat walkway up to the yard (see FLAT_CAMPUS_ACCESS)
  if (FLAT_CAMPUS_ACCESS) {
    const ab = kit.buf('concrete', MID_X, (ACCESS_Z + Z0) / 2);
    const len = Math.hypot(Z0 - ACCESS_Z, ROAD), ny = (Z0 - ACCESS_Z) / len, nz = -ROAD / len;
    const i0 = ab.vert(X0, 0.02, ACCESS_Z, 0, ny, nz, X0, ACCESS_Z, laneCol), i1 = ab.vert(X1, 0.02, ACCESS_Z, 0, ny, nz, X1, ACCESS_Z, laneCol);
    const i2 = ab.vert(X1, ROAD + 0.02, Z0, 0, ny, nz, X1, Z0, laneCol), i3 = ab.vert(X0, ROAD + 0.02, Z0, 0, ny, nz, X0, Z0, laneCol);
    ab.quad(i0, i3, i2, i1);
    for (const x of [X0 + 0.12, X1 - 0.12]) {
      const b0 = kit.buf('concrete', x, (ACCESS_Z + Z0) / 2);
      const n = 6;
      for (let k = 0; k < n; k++) {
        const za = ACCESS_Z + ((Z0 - ACCESS_Z) * k) / n, zb = ACCESS_Z + ((Z0 - ACCESS_Z) * (k + 1)) / n;
        const h = (ROAD * (k + 1)) / n;
        b0.box(x, h / 2, (za + zb) / 2, 0.24, h, zb - za + 0.01, 0, darkWall, 0.5);
      }
    }
    c.addRamp(rect(X0, ACCESS_Z, X1, Z0), [MID_X, ACCESS_Z], [MID_X, Z0], 0, ROAD, 'concrete', 'ramp');
  }

  // --- tube lights under the ground-floor slab (-1 floor) and under the roof (covered ground floor)
  for (let z = Z0 + 4; z < Z1 - 1; z += 6.5) for (const x of [X0 + 3.5, X1 - 3.5]) {
    if (!(x > P.laneX && z < P.rampZ)) kit.box('emissive', x, ROAD - T - 0.03, z, 0.1, 0.05, 1.2, 0, col('#ffffff'));
    if (z > P.yardZ + 1 && z < L.z0 - 1) kit.box('emissive', x, ROOF - T - 0.03, z, 0.1, 0.05, 1.2, 0, col('#ffffff'));
  }

  // ground-floor bike-row collision (base = road level; the -1 floor bikes get their own prop collision in Props.ts)
  for (const [xa, xb, za, zb] of [
    [X0 + 0.2, X0 + 2.2, Z0 + 1, P.stairZ1 - 1.4], [MID_X - 1.95, MID_X + 1.95, Z0 + 1, L.z0 - 2],
    [P.laneX - 2.2, P.laneX - 0.3, Z0 + 1, P.rampZ - 0.5], [X1 - 2.2, X1 - 0.2, P.rampZ + 1, L.z0 - 2],
  ] as number[][]) c.addPolygon(rect(xa, za, xb, zb), 1.1, 'metal', 'prop', ROAD);

  // --- corten screens with a leaf cut-out marking the entrances (the yard's lane corner, the -1 floor's south end)
  for (const [cx, cz, y0, h, alongX] of [[P.laneX - 1.6, Z0 + 0.4, ROAD, 3.4, 1], [X1 - 1.6, Z1 + 0.4, LOW, 5.4, 1]] as number[][]) {
    const sx = alongX ? 2.6 : 0.16, sz = alongX ? 0.16 : 2.6;
    kit.box('corten', cx, y0 + h / 2, cz, sx, h, sz, 0, col('#ffffff'), 1);
    for (let k = 0; k < Math.floor((h - 1.2) / 0.6); k++) {
      const o = ((k % 2) - 0.5) * 0.5;
      kit.box('dark', cx + (alongX ? o : 0.09), y0 + 1.2 + k * 0.6, cz + (alongX ? 0.09 : o), alongX ? 0.12 : 0.02, 0.35, alongX ? 0.02 : 0.12, 0, col('#1a1410'));
    }
    c.addPolygon(rect(cx - sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2), h, 'metal', 'screen', y0);
  }

  buildLabs(kit);

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
  for (const [r0, r1] of runs) if (r1 - r0 > 4) hedgeBox(kit, 'hedge', [X0 - 0.6, r0 + 1], [X0 - 0.6, r1 - 1], 0, 0.55, 0.6);
}

/**
 * The PES Innovation Lab block across the ground floor's south end (the user's description): the square south end is
 * split into a west half, the PES Innovation Lab (PIL), entered by a door in its east wall, and an east half whose
 * north part is a lobby opening onto the parking and whose south part is the Huawei innovation lab, entered from the
 * lobby through its south wall. Shell (walls, fronts, windows) is always drawn; furniture, linings, ceilings, lights and
 * signs sit in a distance-culled group.
 */
function buildLabs(kit: WorldKit): void {
  const c = kit.collision;
  const ceil = ROOF - T; // the rooms run up to the roof slab
  const wallH = ceil - ROAD;
  const cream = col('#ebe7df'), frame = col('#2b2f33'), white = col('#f4f3ef');
  const wall = (p0: V2, p1: V2, gaps: V2[] = [], alongZ = false, color = cream) => {
    // a straight interior/exterior wall from p0 to p1 with door gaps (ranges along its length axis) and lintels
    let s = alongZ ? p0[1] : p0[0];
    const e = alongZ ? p1[1] : p1[0];
    const at = (u: number): V2 => (alongZ ? [p0[0], u] : [u, p0[1]]);
    const lintel = ROAD + 2.2;
    for (const [g0, g1] of [...gaps, [e, e] as V2]) {
      if (g0 > s + 0.01) {
        kit.segBox('plaster', at(s), at(g0), ROAD, ceil, 0.2, color, 0, 0, 0.5);
        c.addPolygon(segPoly(at(s), at(g0), 0.2), wallH, 'concrete', 'wall', ROAD);
      }
      if (g1 > g0) {
        kit.segBox('plaster', at(g0), at(g1), lintel, ceil, 0.2, color, 0, 0, 0.5);
        c.addPolygon(segPoly(at(g0), at(g1), 0.2), ceil - lintel, 'concrete', 'lintel', lintel);
        // dark metal door frame
        for (const u of [g0, g1]) kit.box('metal', at(u)[0], ROAD + 1.1, at(u)[1], alongZ ? 0.24 : 0.08, 2.2, alongZ ? 0.08 : 0.24, 0, frame);
      }
      s = g1;
    }
  };
  // PIL north wall (solid, facing the parking), the dividing wall with the PIL door, the lobby / Huawei wall
  wall([X0 + 0.15, L.z0], [L.xMid, L.z0]);
  wall([L.xMid, L.z0], [L.xMid, Z1], [PIL_DOOR], true);
  wall([L.xMid, L.lobbyZ1], [X1, L.lobbyZ1], [HUAWEI_DOOR]);
  // lobby front onto the parking: glazing on dark mullions with a wide opening
  const fz = L.z0;
  const lobbyGlass: V2[] = [[L.xMid + 0.1, LOBBY_OPENING[0]], [LOBBY_OPENING[1], X1]];
  for (const [u0, u1] of lobbyGlass) {
    for (let u = u0; u <= u1 + 0.01; u += (u1 - u0) / Math.max(1, Math.round((u1 - u0) / 1.3))) kit.box('metal', u, ROAD + 1.3, fz, 0.07, 2.6, 0.1, 0, frame);
    c.addPolygon(rect(u0, fz - 0.06, u1, fz + 0.06), 2.6, 'metal', 'glass', ROAD);
  }
  kit.box('plaster', (L.xMid + X1) / 2, (ROAD + 2.6 + ceil) / 2, fz, X1 - L.xMid, ceil - ROAD - 2.6, 0.2, 0, cream, 0.5);
  c.addPolygon(rect(L.xMid, fz - 0.1, X1, fz + 0.1), ceil - ROAD - 2.6, 'concrete', 'lintel', ROAD + 2.6);
  // south wall: the building's south face, up to the roof parapet, with a band of dark windows to each lab
  kit.segBox('plaster', [X0, Z1], [X1, Z1], ROAD - T, ROOF + 1.0, 0.3, white, 0.15, 0, 0.5);
  c.addPolygon(rect(X0, Z1, X1, Z1 + 0.3), ROOF + 1.0 - (ROAD - T), 'concrete', 'wall', ROAD - T);
  for (let x = X0 + 1.2; x < X1 - 1.4; x += 2.1) {
    if (Math.abs(x + 0.8 - L.xMid) < 0.9) continue;
    kit.box('glass', x + 0.8, ROAD + 1.6, Z1 + 0.31, 1.6, 1.5, 0.04, 0, col('#26323a'));
  }

  // ------------------------------------------------------------------ culled interior detail
  const g = new GroupKit(kit);
  const floorPIL = col('#c9ccce'), floorLobby = col('#d8d2c6'), floorHuawei = col('#6f7479');
  const pil = rect(X0 + 0.15, L.z0 + 0.1, L.xMid - 0.1, Z1);
  const lobby = rect(L.xMid + 0.1, L.z0 + 0.1, X1, L.lobbyZ1 - 0.1);
  const hua = rect(L.xMid + 0.1, L.lobbyZ1 + 0.1, X1, Z1);
  g.b('polished').flatPoly(pil, ROAD + 0.012, floorPIL, 2);
  g.b('polished').flatPoly(lobby, ROAD + 0.012, floorLobby, 1.2);
  g.b('concrete').flatPoly(hua, ROAD + 0.012, floorHuawei, 1);
  // false ceilings with light panels
  for (const r of [pil, lobby, hua]) g.b('plaster').flatPoly(r, ceil - 0.25, white, 2, true);
  for (let z = L.z0 + 2; z < Z1 - 1; z += 2.6) {
    for (const x of [X0 + 2.5, X0 + 6]) g.light(x, ceil - 0.27, z, 1.2, 0.03, 0.3);
    if (z > L.lobbyZ1 + 0.5) for (const x of [L.xMid + 2.5, L.xMid + 6.2]) g.light(x, ceil - 0.27, z, 1.2, 0.03, 0.3);
  }
  g.light(L.xMid + 4.4, ceil - 0.27, (L.z0 + L.lobbyZ1) / 2, 2.4, 0.03, 0.6);
  // the lobby's glazing onto the parking (see-through; the mullions and lintel are in the always-drawn shell)
  for (const [u0, u1] of lobbyGlass) g.pane([u0, L.z0], [u1, L.z0], ROAD, ROAD + 2.6);
  // inner linings over the corten screen (PIL) and the back wall (lobby, Huawei)
  g.box('plaster', X0 + 0.14, (ROAD + ceil) / 2, (L.z0 + Z1) / 2, 0.04, wallH, Z1 - L.z0, 0, white, 0.5);
  g.box('plaster', X1 - 0.02, (ROAD + ceil) / 2, (L.z0 + Z1) / 2, 0.04, wallH, Z1 - L.z0, 0, white, 0.5);

  // PES Innovation Lab: two long workbenches with monitors and stools, a component rack along the screen, a 3D printer
  // bay by the south windows, whiteboard + project wall on the north wall, blue accent wall behind the door
  const benchCol = col('#e2dccf'), benchTop = col('#8a6a48'), dark = col('#1c1f22'), blue = col('#1f5fa8');
  for (const bz of [L.z0 + 5.0, L.z0 + 10.0]) {
    const bx0 = X0 + 2.4, bx1 = L.xMid - 2.2, bw = 1.4; // ≥ 1.5 m aisles at both ends (1 m nav grid, radius 0.38)
    g.box('wood', (bx0 + bx1) / 2, ROAD + 0.88, bz, bx1 - bx0, 0.06, bw, 0, benchTop);
    g.box('metal', (bx0 + bx1) / 2, ROAD + 0.44, bz, bx1 - bx0 - 0.2, 0.82, bw - 0.3, 0, benchCol);
    c.addPolygon(rect(bx0, bz - bw / 2, bx1, bz + bw / 2), 0.92, 'wood', 'prop', ROAD);
    for (let x = bx0 + 0.6; x < bx1 - 0.3; x += 1.2) for (const s of [-1, 1]) {
      g.box('dark', x, ROAD + 1.12, bz + s * 0.25, 0.55, 0.34, 0.03, 0, dark); // monitor
      g.box('metal', x, ROAD + 0.93, bz + s * 0.25, 0.08, 0.1, 0.08, 0, dark);
      g.box('metal', x, ROAD + 0.5, bz + s * 1.05, 0.34, 0.05, 0.34, 0, dark); // stool
      g.box('metal', x, ROAD + 0.25, bz + s * 1.05, 0.05, 0.5, 0.05, 0, col('#80868b'));
    }
  }
  // component rack along the screen
  for (let z = L.z0 + 1.2; z < Z1 - 1.5; z += 2.2) {
    g.box('metal', X0 + 0.55, ROAD + 1.0, z, 0.6, 2.0, 2.0, 0, col('#5b6168'));
    for (let k = 0; k < 4; k++) g.box('plaster', X0 + 0.62, ROAD + 0.35 + k * 0.45, z, 0.5, 0.04, 1.9, 0, col('#d9dde0'));
  }
  c.addPolygon(rect(X0 + 0.2, L.z0 + 0.2, X0 + 0.9, Z1 - 0.4), 2.0, 'metal', 'shelf', ROAD);
  // 3D printers on a table by the south wall
  g.box('wood', (X0 + L.xMid) / 2, ROAD + 0.75, Z1 - 0.8, 5.5, 0.05, 0.9, 0, benchTop);
  g.box('metal', (X0 + L.xMid) / 2, ROAD + 0.37, Z1 - 0.8, 5.3, 0.72, 0.8, 0, benchCol);
  for (let k = 0; k < 3; k++) {
    const x = X0 + 2.2 + k * 1.8;
    g.box('metal', x, ROAD + 1.05, Z1 - 0.8, 0.5, 0.55, 0.5, 0, dark);
    g.box('glass', x, ROAD + 1.08, Z1 - 1.06, 0.4, 0.4, 0.02, 0, col('#9fb5c2'));
  }
  c.addPolygon(rect(X0 + 1.1, Z1 - 1.3, L.xMid - 1.1, Z1 - 0.25), 0.8, 'wood', 'prop', ROAD);
  // whiteboard + pinned project posters on the PIL north wall, blue accent on the dividing wall
  g.box('plaster', X0 + 3.4, ROAD + 1.45, L.z0 + 0.13, 3.2, 1.2, 0.03, 0, col('#fbfbf8'));
  g.box('metal', X0 + 3.4, ROAD + 0.83, L.z0 + 0.17, 3.2, 0.04, 0.08, 0, col('#9aa0a6'));
  for (let k = 0; k < 4; k++) g.box('paint', X0 + 5.6 + k * 0.7, ROAD + 1.6, L.z0 + 0.13, 0.55, 0.78, 0.02, 0, col(['#f2b233', '#e5484d', '#3fa7d6', '#6cc070'][k]));
  g.box('paint', L.xMid - 0.12, ROAD + 1.4, (L.lobbyZ1 + Z1) / 2 - 1, 0.03, 2.8, 6, 0, blue);

  // lobby: a bench and a notice board, the lab signs over the two doors
  g.box('wood', X1 - 0.6, ROAD + 0.42, (L.z0 + L.lobbyZ1) / 2, 0.5, 0.06, 2.8, 0, benchTop);
  g.box('metal', X1 - 0.6, ROAD + 0.2, (L.z0 + L.lobbyZ1) / 2, 0.4, 0.4, 2.6, 0, dark);
  c.addPolygon(rect(X1 - 0.9, (L.z0 + L.lobbyZ1) / 2 - 1.4, X1 - 0.3, (L.z0 + L.lobbyZ1) / 2 + 1.4), 0.46, 'wood', 'prop', ROAD);
  g.box('wood', X1 - 0.05, ROAD + 1.5, (L.z0 + L.lobbyZ1) / 2 - 2.9, 0.03, 1.0, 1.4, 0, col('#9c7a52'));

  // Huawei innovation lab: rows of desks with PCs facing a red accent wall and a screen
  const red = col('#cf0a2c');
  for (let r = 0; r < 3; r++) {
    const dz = L.lobbyZ1 + 2.2 + r * 2.2;
    const dx0 = L.xMid + 1.7, dx1 = X1 - 1.6; // walkable aisles at both ends of every row
    g.box('wood', (dx0 + dx1) / 2, ROAD + 0.74, dz, dx1 - dx0, 0.04, 0.75, 0, col('#e9e6df'));
    g.box('metal', (dx0 + dx1) / 2, ROAD + 0.37, dz, dx1 - dx0 - 0.2, 0.7, 0.05, 0, col('#80868b'));
    c.addPolygon(rect(dx0, dz - 0.38, dx1, dz + 0.38), 0.78, 'wood', 'prop', ROAD);
    for (let x = dx0 + 0.6; x < dx1 - 0.3; x += 1.15) {
      g.box('dark', x, ROAD + 0.98, dz - 0.18, 0.5, 0.32, 0.03, 0, dark);
      g.box('metal', x, ROAD + 0.47, dz + 0.65, 0.42, 0.06, 0.42, 0, dark); // chair
    }
  }
  g.box('paint', X1 - 0.06, ROAD + 1.4, (L.lobbyZ1 + Z1) / 2, 0.02, 2.8, Z1 - L.lobbyZ1 - 0.4, 0, red); // clear of the lining (X1 − 0.04)
  g.box('dark', X1 - 0.09, ROAD + 1.55, (L.lobbyZ1 + Z1) / 2, 0.03, 1.1, 2.0, 0, dark);

  const lod = g.build('interior:parking_labs', [(X0 + X1) / 2, (L.z0 + Z1) / 2], LAB_CULL);
  // lab signs (a small canvas texture): over the PIL door in the lobby and over the Huawei door
  const near = lod.levels[0].object;
  near.add(labSigns());
}

/** Two sign boards on one small canvas texture, parented to the culled interior group (whose meshes use world coordinates). */
function labSigns(): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const x = cv.getContext('2d')!;
  // top half: PES Innovation Lab (navy with an orange mark); bottom half: Huawei (white with a red mark)
  x.fillStyle = '#12284b'; x.fillRect(0, 0, 512, 128);
  x.fillStyle = '#f28c28'; x.fillRect(24, 34, 60, 60);
  x.fillStyle = '#ffffff'; x.font = 'bold 44px sans-serif'; x.textBaseline = 'middle';
  x.fillText('PES INNOVATION LAB', 100, 66);
  x.fillStyle = '#ffffff'; x.fillRect(0, 128, 512, 128);
  x.fillStyle = '#cf0a2c';
  for (let k = 0; k < 8; k++) { x.save(); x.translate(70, 196); x.rotate((k / 8) * Math.PI * 2); x.beginPath(); x.ellipse(0, -22, 7, 20, 0, 0, Math.PI * 2); x.fill(); x.restore(); }
  x.fillStyle = '#1b1b1b'; x.font = 'bold 40px sans-serif';
  x.fillText('INNOVATION LAB', 118, 194);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const quad = (p: [number, number, number][], v0: number, v1: number) => {
    const b = pos.length / 3;
    for (const q of p) pos.push(q[0], q[1], q[2]);
    uv.push(0, v1, 1, v1, 1, v0, 0, v0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const y0 = ROAD + 2.3, y1 = ROAD + 2.7;
  // PIL sign on the lobby face of the dividing wall, above the PIL door (facing +x)
  const pz = (PIL_DOOR[0] + PIL_DOOR[1]) / 2, sx = L.xMid + 0.11;
  quad([[sx, y0, pz + 0.8], [sx, y0, pz - 0.8], [sx, y1, pz - 0.8], [sx, y1, pz + 0.8]], 0.5, 1);
  // Huawei sign on the lobby face of the lobby's south wall, above the Huawei door (facing −z)
  const hx = (HUAWEI_DOOR[0] + HUAWEI_DOOR[1]) / 2, sz = L.lobbyZ1 - 0.11;
  quad([[hx + 0.8, y0, sz], [hx - 0.8, y0, sz], [hx - 0.8, y1, sz], [hx + 0.8, y1, sz]], 0, 0.5);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  m.name = 'parking:lab_signs';
  return m;
}
