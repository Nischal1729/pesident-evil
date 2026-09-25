import type * as THREE from 'three';
import { col, type WorldKit } from '../kit';
import { GJB_G, GJB_L1, GJB_PODIUM_PARTS, type V2 } from '../layout';
import { C, ceiling, classroom, computerLab, cooler, electronicsLab, facultyRoom, flight, floor, noticeBoard, tube, wall, WALL_T, type Opening } from './rooms';
import { GroupKit, rect } from './util';

/**
 * The GJBC ground storey under the L1 Quad / covered plaza (reference/GJB_NOTES.md §1, §5).
 *
 * The podium used to be one solid prism with only two of its outer faces drawn, so from the drive-through and the road
 * you looked into an empty box and saw the L1 colonnades and the covered plaza floating over the ground. It is now a
 * real storey: closed podium parts, an L1 slab over an enterable ground-floor wing, and every outer face drawn
 * (gjbc.ts podiumFaces). The wing is entered from the east lobby (a door in its west wall), from PES University Rd (a
 * glass door in the north face) and by stair core S1, which rises from G to the covered plaza on L1.
 *
 * Layout (GJB_G in layout.ts): corridor A runs E–W from the lobby door, corridor B N–S from corridor A to the road door.
 * Off them: G-01 computer lab, G-02 classroom, G-03 faculty room, G-04 seminar hall (front and back doors), G-05
 * electronics lab, and the stair core. Walls are centred on the rect edges.
 * Look (GJB tour 8:32–9:10 corridors, 11:10 classrooms): polished grey granite, white walls with a grey dado in the
 * corridors and an oak dado in the rooms, light-oak door frames, white false ceilings with LED tube lights.
 */
const L1 = GJB_L1;
const G = GJB_G;
/** False-ceiling height in the ground-floor wing (the L1 slab soffit is at L1 − slab, 2 m higher). */
const CEIL = 3.6;
const SOFFIT = L1 - G.slab;
type R4 = [number, number, number, number];

export function buildGround(kit: WorldKit): void {
  const c = kit.collision;
  // solids: the closed parts of the podium (0 → L1) and the L1 slab over the enterable wing
  for (const p of GJB_PODIUM_PARTS) c.addPolygon(p, L1, 'concrete', 'podium');
  c.addPolygon(G.slabPoly, G.slab, 'concrete', 'slab', SOFFIT);
  const g = new GroupKit(kit);
  walls(kit, g);
  corridors(kit, g);
  rooms(kit, g);
  stairCore(kit, g);
  // the fit-out is drawn only while the camera is on the ground storey near the wing (it is sealed off from L1)
  const b = G.bounds;
  g.build('interior:gjb_ground', [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], 1e9, undefined, (cam) =>
    cam.y < L1 - 0.3 && cam.x > b[0] - 30 && cam.x < b[2] + 45 && cam.z > b[1] - 28 && cam.z < b[3] + 25);
}

// ------------------------------------------------------------------------------------------------ walls
function walls(kit: WorldKit, g: GroupKit): void {
  const A = G.corridorA, B = G.corridorB, R = G.rooms, S = G.core, D = G.doors, nf = G.northDoorZ;
  const door = (at: number): Opening => ({ at, w: 2.0, kind: 'door' });
  const w = (a: V2, b: V2, dadoL: THREE.Color | null, dadoR: THREE.Color | null, openings: Opening[] = [], leafSide = 1) =>
    wall(kit, a, b, { y0: 0, top: CEIL, colTop: SOFFIT, openings, dadoL, dadoR, gk: g, leafSide });
  // (a wall a→b has its left normal on the south side when it runs east, on the west side when it runs south)
  w([R.g04[0], R.g04[3]], [R.g04[2], R.g04[3]], null, C.dadoOak); // G-04 south (outer)
  w([R.g04[0], R.g04[1]], [R.g04[0], R.g04[3]], null, C.dadoOak); // G-04 west (outer)
  w([A[0], A[3]], [A[2], A[3]], C.dadoOak, C.dadoGrey, [door(D.g04a - A[0]), door(D.g04b - A[0])], 1); // corridor A south
  w([A[0], R.g05[1]], [A[0], A[1]], null, C.dadoOak); // G-05 west (outer)
  w([A[0], A[1]], [A[0], A[3]], null, C.dadoGrey); // corridor A west end (outer)
  w([R.g05[0], R.g05[1]], [R.g01[2], R.g01[1]], C.dadoOak, C.dadoOak); // G-05 / G-01 north, G-02 south
  w([R.g02[0], R.g02[1]], [R.g02[0], R.g01[3]], C.dadoOak, C.dadoOak); // x = 40: G-02 west (outer), G-05 / G-01
  w([R.g02[0], R.g02[1]], [R.g02[2], R.g02[1]], C.dadoOak, null); // G-02 north (outer)
  // corridor B west wall from the north face south to corridor A: G-02 door
  w([B[0], nf(B[0])], [B[0], A[1]], C.dadoOak, C.dadoGrey, [door(D.g02 - nf(B[0]))], 1);
  // corridor B east wall: beside the closed podium, then the stair core (full height, see stairCore), then G-03 (door)
  w([B[2], nf(B[2])], [B[2], S[1]], C.dadoGrey, null);
  w([B[2], S[3]], [B[2], A[1]], C.dadoGrey, C.dadoOak, [door(D.g03 - S[3])], -1);
  // corridor A north wall: G-05 and G-01 doors; G-03 behind a blank wall
  w([A[0], A[1]], [B[0], A[1]], C.dadoGrey, C.dadoOak, [door(D.g05 - A[0]), door(D.g01 - A[0])], -1);
  w([B[2], A[1]], [A[2], A[1]], C.dadoGrey, C.dadoOak);
  // east walls in front of the east wing's west face (G-03, G-04)
  w([R.g03[2], R.g03[1]], [R.g03[2], R.g03[3]], C.dadoOak, null);
  w([R.g04[2], R.g04[1]], [R.g04[2], R.g04[3]], C.dadoOak, null);
}

// ------------------------------------------------------------------------------------------------ corridors
function corridors(kit: WorldKit, g: GroupKit): void {
  const A = G.corridorA, B = G.corridorB, nf = G.northDoorZ;
  const bPoly = (m: number): V2[] => [[B[0] - m, nf(B[0] - m)], [B[2] + m, nf(B[2] + m)], [B[2] + m, A[1]], [B[0] - m, A[1]]];
  floor(g, rect(A[0], A[1], A[2], A[3]), 0.03, C.corridor);
  floor(g, bPoly(0), 0.03, C.corridor);
  // lighter granite border strips along corridor A
  for (const [z0, z1] of [[A[1] + 0.1, A[1] + 0.3], [A[3] - 0.3, A[3] - 0.1]]) floor(g, rect(A[0] + 0.1, z0, A[2], z1), 0.034, col('#d8d7d2'));
  ceiling(kit, rect(A[0], A[1], A[2], A[3]), CEIL, C.ceiling, g);
  ceiling(kit, bPoly(0.05), CEIL, C.ceiling, g);
  for (let x = A[0] + 1.6; x < A[2] - 0.8; x += 3.1) tube(g, x, CEIL, (A[1] + A[3]) / 2, 1.2, true);
  const bx = (B[0] + B[2]) / 2;
  for (let z = A[1] - 1.8; z > nf(bx) + 1.2; z -= 3.1) tube(g, bx, CEIL, z, 1.2, false);
  // notice boards, water cooler, red fire-extinguisher boxes
  noticeBoard(g, 50.0, 1.55, A[3] - WALL_T / 2 - 0.02, 2.2, 1.1, 0, -1, 3);
  noticeBoard(g, 32.0, 1.55, A[1] + WALL_T / 2 + 0.02, 2.0, 1.0, 0, 1, 11);
  noticeBoard(g, B[0] + WALL_T / 2 + 0.02, 1.55, -90.2, 1.8, 1.0, 1, 0, 5);
  cooler(kit, g, B[2] - 0.45, -94.4, 0);
  for (const [x, z] of [[A[0] + 0.22, (A[1] + A[3]) / 2], [B[2] - 0.22, -109.5], [58.2, A[3] - 0.22]] as V2[]) g.box('metal', x, 1.25, z, 0.22, 0.5, 0.22, 0, col('#c1261c'));
  // road door (the opening is cut in the podium's north face, gjbc.ts): aluminium frame, glass transom, open leaves
  const nz = nf(bx) + 0.32;
  for (const x of [B[0] + 0.14, B[2] - 0.14]) g.box('metal', x, 1.3, nz, 0.08, 2.6, 0.12, 0, C.steelLight);
  g.box('metal', bx, 2.56, nz, B[2] - B[0] - 0.2, 0.08, 0.12, 0, C.steelLight);
  g.pane([B[0] + 0.1, nz], [B[2] - 0.1, nz], 2.6, 3.4);
  for (const x of [B[0] + 0.2, B[2] - 0.2]) g.pane([x, nz + 0.1], [x, nz + 1.25], 0.05, 2.45);
}

// ------------------------------------------------------------------------------------------------ rooms
function rooms(kit: WorldKit, g: GroupKit): void {
  const R = G.rooms, t = WALL_T / 2;
  for (const [id, r] of Object.entries(R) as [keyof typeof R, R4][]) {
    const inner: R4 = [r[0] + t, r[1] + t, r[2] - t, r[3] - t];
    floor(g, rect(r[0], r[1], r[2], r[3]), 0.03, C.roomFloor, 'polished', 1);
    ceiling(kit, rect(r[0], r[1], r[2], r[3]), CEIL, C.ceiling, g);
    switch (id) {
      case 'g01': computerLab(kit, g, inner, 'n', 0, CEIL); break;
      case 'g02': classroom(kit, g, inner, 'w', 0, CEIL); break;
      case 'g03': facultyRoom(kit, g, inner, 'w', 0, CEIL); break;
      case 'g04': classroom(kit, g, inner, 'w', 0, CEIL, { rowsMax: 12 }); break;
      case 'g05': electronicsLab(kit, g, inner, 'n', 0, CEIL); break;
    }
  }
  // wayfinding plates beside the doors (navy with a white strip)
  const A = G.corridorA, B = G.corridorB, D = G.doors;
  const plate = (x: number, z: number, nx: number, nz: number) => {
    g.box('plaster', x + nx * 0.12, 1.75, z + nz * 0.12, nz ? 0.32 : 0.02, 0.22, nx ? 0.32 : 0.02, 0, col('#1f2b45'));
    g.box('plaster', x + nx * 0.135, 1.75, z + nz * 0.135, nz ? 0.24 : 0.01, 0.05, nx ? 0.24 : 0.01, 0, C.white);
  };
  plate(D.g01 + 1.35, A[1], 0, 1); plate(D.g05 + 1.35, A[1], 0, 1);
  plate(D.g04a + 1.35, A[3], 0, -1); plate(D.g04b + 1.35, A[3], 0, -1);
  plate(B[0], D.g02 + 1.35, 1, 0); plate(B[2], D.g03 - 1.35, -1, 0);
}

// ------------------------------------------------------------------------------------------------ stair core S1 (G → L1)
/**
 * Dog-leg granite stair in a core on the east side of the covered plaza (the "dark wall zone" of GJB_NOTES §6), from
 * corridor B up to the covered plaza on L1. Flight 1 rises north along the east half to a mid landing, flight 2 returns
 * south along the west half to the top landing, whose door opens west onto the plaza. Walls run up to the arcade soffit;
 * outside, above L1, the core is clad in dark granite. Registered the way it is built: flights as ramps solid to the
 * ground, the mid landing as a solid block, the top landing as a slab over the ground-floor landing.
 */
function stairCore(kit: WorldKit, g: GroupKit): void {
  const c = kit.collision;
  const S = G.core, B = G.corridorB, t = WALL_T / 2;
  const top = G.coreTop;
  const x0 = S[0] + t, z0 = S[1] + t, x1 = S[2] - t, z1 = S[3] - t; // interior
  const mid = (x0 + x1) / 2, cw = 0.2;
  const fw = mid - cw / 2 - x0; // flight width (2.3 m)
  const zLand = z1 - G.coreLanding; // south edge of the flights
  const zMid = zLand - G.coreRun; // north edge of the flights
  const yMid = L1 / 2;
  const dz = G.coreDoor, doorAt = (dz[0] + dz[1]) / 2 - S[1], doorW = dz[1] - dz[0];
  // walls: west (= corridor B east wall, a door at G and one at L1), north, east, south — up to the arcade soffit
  wall(kit, [B[2], S[1]], [B[2], S[3]], { y0: 0, top: L1, colTop: L1, dadoL: C.dadoGrey, dadoR: null, gk: g, leafSide: -1, openings: [{ at: doorAt, w: doorW, kind: 'door' }] });
  wall(kit, [B[2], S[1]], [B[2], S[3]], { y0: L1, top, gk: g, leafSide: -1, openings: [{ at: doorAt, w: doorW, kind: 'door' }] });
  wall(kit, [S[0], S[1]], [S[2], S[1]], { y0: 0, top, gk: g });
  wall(kit, [S[2], S[1]], [S[2], S[3]], { y0: 0, top, gk: g });
  wall(kit, [S[0], S[3]], [S[2], S[3]], { y0: 0, top, dadoL: C.dadoOak, gk: g }); // G-03 on its south side below L1
  // flights + landings
  const f1x = mid + cw / 2 + fw / 2, f2x = x0 + fw / 2;
  flight(kit, [f1x, zLand], [f1x, zMid], 0, yMid, fw, 0, 20);
  flight(kit, [f2x, zMid], [f2x, zLand], yMid, L1, fw, 0, 20);
  c.addRamp(rect(mid + cw / 2, zMid, x1, zLand), [f1x, zLand], [f1x, zMid], 0, yMid, 'concrete', 'stair');
  c.addRamp(rect(x0, zMid, mid - cw / 2, zLand), [f2x, zMid], [f2x, zLand], yMid, L1, 'concrete', 'stair');
  kit.box('polished', (x0 + x1) / 2, yMid / 2, (z0 + zMid) / 2, x1 - x0, yMid, zMid - z0, 0, C.granite, 0.5);
  c.addPolygon(rect(x0, z0, x1, zMid), yMid, 'concrete', 'landing');
  kit.box('polished', (x0 + x1) / 2, L1 - G.slab / 2, (zLand + z1) / 2, x1 - x0, G.slab, z1 - zLand, 0, C.granite, 0.5);
  c.addPolygon(rect(x0, zLand, x1, z1), G.slab, 'concrete', 'slab', SOFFIT);
  floor(g, rect(x0, zLand, x1, z1), 0.03, C.corridor);
  // centre wall between the flights (up to a rail height over the upper flight), rails on the open landing edges
  kit.box('plaster', mid, (L1 + 1.1) / 2, (zMid + zLand) / 2, cw, L1 + 1.1, zLand - zMid, 0, C.wall);
  c.addPolygon(rect(mid - cw / 2, zMid, mid + cw / 2, zLand), L1 + 1.1, 'concrete', 'wall');
  const rail = (a: V2, b: V2, y: number) => {
    kit.segBox('metal', a, b, y + 1.0, y + 1.06, 0.06, C.steel);
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.9));
    for (let k = 0; k <= n; k++) {
      const f = k / n, p: V2 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      kit.box('metal', p[0], y + 0.5, p[1], 0.04, 1.0, 0.04, 0, C.steel);
    }
    kit.segBox('metal', a, b, y + 0.12, y + 0.94, 0.015, col('#5b6167'));
  };
  rail([mid + cw / 2, zLand + 0.04], [x1, zLand + 0.04], L1);
  c.addPolygon(rect(mid + cw / 2, zLand, x1, zLand + 0.08), 1.1, 'metal', 'parapet', L1);
  // ceiling, roof slab, a fascia up to the covered plaza roof (15 m) on the plaza side, wall lights
  ceiling(kit, rect(S[0], S[1], S[2], S[3]), top - 0.45, C.ceiling, g);
  c.addPolygon(rect(S[0], S[1], S[2], S[3]), 0.45, 'concrete', 'roof', top - 0.45);
  kit.box('stone', S[0] + 0.45, top + 0.25, (S[1] + S[3]) / 2, 1.1, 0.5, S[3] - S[1] + 0.2, 0, col('#e6e0d2'));
  for (const [y, z] of [[2.7, (zLand + z1) / 2], [yMid + 2.7, (z0 + zMid) / 2], [L1 + 2.9, (zLand + z1) / 2], [L1 + 5.5, (z0 + zMid) / 2]] as V2[]) {
    g.light(x1 - 0.05, y, z, 0.03, 0.07, 1.2);
    g.light(x0 + 0.05, y + 0.3, z, 0.03, 0.07, 1.2);
  }
  // dark granite cladding outside, above L1 (west face with the plaza door, south and north faces)
  const dark = C.darkGranite, sk = 0.04, wx = B[2] - t - sk / 2;
  kit.box('polished', wx, (L1 + 2.5 + top) / 2, dz[0] + doorW / 2, sk, top - L1 - 2.5, doorW, 0, dark, 0.5);
  kit.box('polished', wx, (L1 + top) / 2, (S[1] + dz[0]) / 2, sk, top - L1, dz[0] - S[1], 0, dark, 0.5);
  kit.box('polished', wx, (L1 + top) / 2, (dz[1] + S[3]) / 2 + 0.05, sk, top - L1, S[3] - dz[1] + 0.1, 0, dark, 0.5);
  kit.box('polished', (S[0] + S[2]) / 2, (L1 + top) / 2, S[3] + t + sk / 2, S[2] - S[0] + 0.1, top - L1, sk, 0, dark, 0.5);
  kit.box('polished', (S[0] + S[2]) / 2, (L1 + top) / 2, S[1] - t - sk / 2, S[2] - S[0] + 0.1, top - L1, sk, 0, dark, 0.5);
  // stair sign beside the plaza door
  kit.box('plaster', wx - 0.03, L1 + 1.7, dz[0] - 0.8, 0.02, 0.5, 0.9, 0, col('#1f6b3a'));
  kit.box('emissive', wx - 0.045, L1 + 1.7, dz[0] - 0.8, 0.01, 0.12, 0.6, 0, col('#ffffff'));
}
