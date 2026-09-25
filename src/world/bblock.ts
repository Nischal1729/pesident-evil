import * as THREE from 'three';
import type { SurfaceKind } from '../core/Events';
import type { StaticCollision } from '../sim/Collision';
import { GeoBuffer } from './buildings';
import { normalizeWinding } from './geom';
import { col, type DetailKey, type WorldKit } from './kit';
import { BE_FRAME, BE_LEVELS, bePt, type V2 } from './layout';
import { pottedPlant, quad3, type P3 } from './shapes';
import type { SignUVs } from './signs';

/**
 * B-Block = "BE block" (students' name; the 2021 campus tour's "Block BE" with "the 13th floor", the 2023 "BE BLOCK
 * TOUR") — see reference/BE_NOTES.md. 14 storeys of beige stone cladding with pilaster fins and a pink-grey stone base.
 *
 * The block has ONE centre on its east face: the buff-stone crest tower (deep portal-like recess under a solid head,
 * white roof sign) stands over the main entrance, and the portico deck over the B/MRD link road hangs off the tower's
 * base (satellite roof, 2026 tour key frames 0002 / 1406 / 1928, 2021 tour be21_0186…0198). Layout: BUILDINGS ids
 * bblock (notched footprint), bblock_tower (shaft with the recess), bblock_tower_head, bblock_core.
 *
 * This file builds, in the BE frame of layout.ts (s = south along the east facade, d = west into the block):
 *  - the two stacked steel-truss skybridges to the GJBC library, the crest sign, cornice / 10th-floor balcony bands;
 *  - the entrance: granite plinth + 3 steps, stone piers with louvres, the double-height spider-glass wall with the
 *    white "be BLOCK" logo, a stone lintel and louvred glazing up to the tower, the portico deck on four columns;
 *  - the enterable core (ground, 1st and 2nd floors): the triple-height lobby (lifts + TV, reception, the orange wall
 *    and the "Mahatma Gandhi" frieze over the mezzanine), the atrium with two floating timber stairs, galleries with
 *    black railings, CSE classrooms / labs / office off them, and a dog-leg stair core. Collision is registered the
 *    way it physically is (floors and slabs as prisms, flights as segmented ramps), so the nav graph links it all.
 *    The interior renders as one distance-culled LOD group (one mesh per shared material, no shadow casting).
 */

/** The un-notched OSM outline (cornice / balcony bands run round it). */
const BBLOCK_OSM: V2[] = [[-54.8, -177.2], [-41.0, -178.0], [-42.1, -195.0], [-12.8, -196.8], [-11.2, -171.4], [-7.6, -113.9], [-50.6, -111.2]];

// ------------------------------------------------------------------------------------------------ frame helpers
const S = BE_FRAME.s, D = BE_FRAME.d;
const P = bePt;
const P3at = (s: number, d: number, y: number): P3 => { const q = P(s, d); return [q[0], y, q[1]]; };
/** GeoBuffer.box rotation: box local x runs along s, local z along d. */
const ROT = Math.atan2(-S[1], S[0]);
const NS: P3 = [S[0], 0, S[1]];
const ND: P3 = [D[0], 0, D[1]];
const NEG = (n: P3): P3 => [-n[0], -n[1], -n[2]];
const rect = (s0: number, s1: number, d0: number, d1: number): V2[] => [P(s0, d0), P(s1, d0), P(s1, d1), P(s0, d1)];

/** Box spanning s0..s1, d0..d1, y0..y1 in the BE frame. */
function bx(b: GeoBuffer, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number, c?: THREE.Color, uv = 1): void {
  const q = P((s0 + s1) / 2, (d0 + d1) / 2);
  b.box(q[0], (y0 + y1) / 2, q[1], Math.abs(s1 - s0), y1 - y0, Math.abs(d1 - d0), ROT, c, uv);
}
/** Horizontal quad (floor facing up / ceiling facing down). */
function hq(b: GeoBuffer, s0: number, s1: number, d0: number, d1: number, y: number, up: boolean, c?: THREE.Color, uv = 0.5): void {
  quad3(b, [P3at(s0, d0, y), P3at(s1, d0, y), P3at(s1, d1, y), P3at(s0, d1, y)], [0, up ? 1 : -1, 0], c, uv);
}
/** Vertical quad on the line d = const (running along s), facing +d (face 1) or −d (face −1). */
function vqS(b: GeoBuffer, d: number, s0: number, s1: number, y0: number, y1: number, face: number, c?: THREE.Color, uv = 0.5): void {
  quad3(b, [P3at(s0, d, y0), P3at(s1, d, y0), P3at(s1, d, y1), P3at(s0, d, y1)], face > 0 ? ND : NEG(ND), c, uv);
}
/** Vertical quad on the line s = const (running along d), facing +s (face 1) or −s (face −1). */
function vqD(b: GeoBuffer, s: number, d0: number, d1: number, y0: number, y1: number, face: number, c?: THREE.Color, uv = 0.5): void {
  quad3(b, [P3at(s, d0, y0), P3at(s, d1, y0), P3at(s, d1, y1), P3at(s, d0, y1)], face > 0 ? NS : NEG(NS), c, uv);
}
function solid(c: StaticCollision, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number, tag: string, surface: SurfaceKind = 'concrete'): void {
  c.addPolygon(rect(Math.min(s0, s1), Math.max(s0, s1), Math.min(d0, d1), Math.max(d0, d1)), y1 - y0, surface, tag, y0);
}
/**
 * Stair flight or ramp along `axis` from a0 (low end, y0) to a1 (high end, y1), c0..c1 across. Collided as `segs`
 * ramp prisms: each has its own flat underside `thick` below its low edge, so flights can stack in a stair core.
 */
function flight(c: StaticCollision, axis: 's' | 'd', a0: number, a1: number, c0: number, c1: number, y0: number, y1: number, tag: string, segs = 3, thick = 0.3): void {
  const cm = (c0 + c1) / 2;
  for (let k = 0; k < segs; k++) {
    const u0 = a0 + ((a1 - a0) * k) / segs, u1 = a0 + ((a1 - a0) * (k + 1)) / segs;
    const h0 = y0 + ((y1 - y0) * k) / segs, h1 = y0 + ((y1 - y0) * (k + 1)) / segs;
    const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
    const poly = axis === 's' ? rect(lo, hi, c0, c1) : rect(c0, c1, lo, hi);
    c.addRamp(poly, axis === 's' ? P(u0, cm) : P(cm, u0), axis === 's' ? P(u1, cm) : P(cm, u1), h0, h1, 'concrete', tag, thick);
  }
}
/** Balustrade along a flight's edge (cross position `at`): a 0.2 m strip 1.1 m above the flight surface ('wall' tag). */
function flightRail(c: StaticCollision, axis: 's' | 'd', a0: number, a1: number, at: number, y0: number, y1: number, segs = 3): void {
  flight(c, axis, a0, a1, at - 0.1, at + 0.1, y0 + 1.1, y1 + 1.1, 'wall', segs, 1.45);
}
/** Straight balustrade / parapet on a floor ('wall' tag, so nothing stands on it). */
function rail(c: StaticCollision, a: [number, number], b: [number, number], floorY: number, h = 1.1): void {
  c.addSegment(P(a[0], a[1]), P(b[0], b[1]), 0.2, h, 'metal', 'wall', floorY);
}

// ------------------------------------------------------------------------------------------------ core plan
const L = BE_LEVELS;
const FLOORS = [L.G, L.F1, L.F2];
const SLAB = 0.3;
/** Visual ceiling per floor (the 2nd floor has a false ceiling under the solid block above). */
const CEIL = [L.F1 - SLAB, L.F2 - SLAB, L.top - 0.2];
const HEAD = 2.4; // doorway head height above the floor
const TOWER = { s: 9, d0: -0.8, slot: 2.5, slotD: 4, head: 42 };
const LOBBY = { s: 6, glass: 0.6, d1: 10 };
const MEZZ = 7.2; // front edge of the 1st/2nd-floor galleries over the lobby (they run back to d = 10)
const LC = { s: 3.4, d0: 10, d1: 12.6 }; // lift core behind the lobby
const HALL = { s: 7.6, d0: 10, d1: 27.6 };
const VOID = { s: 4.8, d0: 15, d1: 25 }; // atrium void through the 1st and 2nd floors
const ROOM = { s1: 15, dm: 21, d1: 32 };
const DOORS: [number, number][] = [[11, 13], [21.8, 23.8]]; // doorways in the hall walls (s = ±7.6), every floor, near each room's front
const WINDOWS: [number, number][] = [[14.2, 20.2], [24.6, 27.2]]; // glazed panels onto the hall
const ST = { a: -2.5, b: 1.0, laneA: [27.6, 29.6] as [number, number], laneB: [29.8, 32] as [number, number], wc: 3.4 }; // stair core
const T1 = { s0: -4.8, s1: -2.4, d0: 16.7, d1: 25 }; // floating stair G → 1st (rises west), 2.4 m wide
const T2 = { s0: 2.4, s1: 4.8, d0: 15, d1: 25 }; // floating stair 1st → 2nd (rises east), 2.4 m wide
const LSTAIR = { s0: 3.6, s1: 6.0, d0: 1.5, d1: MEZZ }; // lobby stair G → mezzanine

// palette (vertex colours = albedo)
const C = {
  white: col('#eeece6'), ceiling: new THREE.Color(1.02, 1.1, 1.3), floor: col('#dcd8d0'), floorRoom: col('#d2cdc3'), skirting: col('#5a5d61'),
  dado: col('#8d9095'), stone: col('#d8c9b1'), buff: col('#c9b394'), pink: col('#b49b8b'), granite: col('#8f8d88'),
  black: col('#1d1f22'), steel: col('#a9aeb3'), timber: col('#c08a4e'), timberDark: col('#8e5f33'), orange: col('#e08a1e'),
  door: col('#a8743f'), frame: col('#6b4a2c'), board: col('#27463a'), wood: col('#9a6a3e'), desk: col('#b98d5f'),
  legs: col('#3a3d41'), chair: col('#2e3238'), screen: col('#15181c'), maroon: col('#6d1f2a'), wave: col('#d8c3b4'),
};

export function buildBBlockBits(kit: WorldKit, signs: SignUVs): void {
  const dark = col('#3b3f44');
  // two dark steel Warren-truss skybridges to the GJBC library, stacked at one x (+14 m and +32 m; key frames 1352 /
  // 1406 show both at the same distance and span)
  const bridge = (x: number, zS: number, zN: number, y: number) => {
    const w = 3, h = 3.5;
    const b = kit.buf('metal', x, (zS + zN) / 2);
    kit.box('glass', x, y + h / 2, (zS + zN) / 2, w - 0.3, h - 0.4, zS - zN, 0, col('#46525c'));
    kit.box('metal', x, y + 0.15, (zS + zN) / 2, w, 0.3, zS - zN, 0, dark);
    kit.box('metal', x, y + h - 0.1, (zS + zN) / 2, w, 0.2, zS - zN, 0, dark);
    for (const s of [-1, 1]) {
      const xs = x + (s * w) / 2;
      b.beam([xs, y + 0.2, zS], [xs, y + 0.2, zN], 0.22, 0.3, dark);
      b.beam([xs, y + h - 0.15, zS], [xs, y + h - 0.15, zN], 0.22, 0.3, dark);
      const n = 5;
      for (let k = 0; k < n; k++) {
        const za = zS + ((zN - zS) * k) / n, zb = zS + ((zN - zS) * (k + 1)) / n;
        const up = k % 2 === 0;
        b.beam([xs, up ? y + 0.2 : y + h - 0.15, za], [xs, up ? y + h - 0.15 : y + 0.2, zb], 0.16, 0.16, dark);
        b.beam([xs, y + 0.2, za], [xs, y + h - 0.15, za], 0.14, 0.14, dark);
      }
    }
    kit.collision.addPolygon([[x - w / 2, zN], [x + w / 2, zN], [x + w / 2, zS], [x - w / 2, zS]], h, 'metal', 'bridge', y);
  };
  bridge(-42, -101.0, -112.0, 14);
  bridge(-42, -101.0, -112.0, 32);

  // crest sign on the tower roof: white box, orange PES logo + red Kannada on both long faces, bridging the slot
  {
    const q = P(0, 1.3), top = 57 + 1.1;
    const b = kit.buf('plaster', q[0], q[1]);
    bx(b, -4.7, 4.7, 0.2, 2.4, top, top + 3.4, col('#fbfbf8'), 0.5);
    const f = P(0, 0.18), r = P(0, 2.42);
    kit.signQuad(signs.bblockCrest, f[0], top + 1.7, f[1], 9.2, 3.1, -D[0], -D[1], true);
    kit.signQuad(signs.bblockCrest, r[0], top + 1.7, r[1], 9.2, 3.1, D[0], D[1], true);
    for (const s of [-3.8, 3.8]) bx(kit.buf('metal', q[0], q[1]), s - 0.15, s + 0.15, 0.9, 1.7, 57, top, col('#555a60'));
  }

  // projecting cornice at the top, balcony band + railing at the 10th floor, stone band over the 2-storey base.
  // On the east face they stop at the tower (it rises through them) and the base band stops at the entrance piers.
  const p = normalizeWinding(BBLOCK_OSM);
  const n = p.length;
  const dirOf = (i: number): V2 => { const a = p[i], c = p[(i + 1) % n], l = Math.hypot(c[0] - a[0], c[1] - a[1]); return [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; };
  const corner = (i: number, j: number) => { const u = dirOf(i), v = dirOf(j); return Math.abs(u[0] * v[1] - u[1] * v[0]) > 0.02; }; // a real corner between edges i and j
  for (let i = 0; i < n; i++) {
    const a = p[i], c = p[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const nx = -dz / len, nz = dx / len;
    const rot = Math.atan2(-dz, dx);
    // on the east facade the bands stop at the tower's sides (s = ±TOWER.s)
    const sa = (a[0] - BE_FRAME.origin[0]) * S[0] + (a[1] - BE_FRAME.origin[1]) * S[1];
    const sc = (c[0] - BE_FRAME.origin[0]) * S[0] + (c[1] - BE_FRAME.origin[1]) * S[1];
    const east = Math.abs(ux * S[0] + uz * S[1]) > 0.999 && Math.abs((a[0] - BE_FRAME.origin[0]) * D[0] + (a[1] - BE_FRAME.origin[1]) * D[1]) < 0.3;
    const runs: [number, number][] = [];
    if (east) {
      const dir = sc > sa ? 1 : -1;
      const toT = (s: number) => (s - sa) * dir; // metres along the edge from a
      const cut0 = toT(dir > 0 ? -TOWER.s : TOWER.s), cut1 = toT(dir > 0 ? TOWER.s : -TOWER.s);
      if (cut0 > 0) runs.push([0, Math.min(len, cut0)]);
      if (cut1 < len) runs.push([Math.max(0, cut1), len]);
    } else runs.push([0, len]);
    const extA = corner((i + n - 1) % n, i), extC = corner(i, (i + 1) % n);
    for (const [t0, t1] of runs) {
      if (t1 - t0 < 0.2) continue;
      for (const [y, d, t, colr] of [[49.1, 0.9, 0.5, col('#e2d6c4')], [35.2, 1.3, 0.3, col('#dccfbc')], [7.1, 0.4, 0.3, col('#9e8b7c')]] as [number, number, number, THREE.Color][]) {
        // overlap the neighbouring band only round real corners (a collinear joint would z-fight)
        const e0 = t0 - (t0 === 0 && extA ? d / 2 : 0), e1 = t1 + (t1 === len && extC ? d / 2 : 0);
        const m = (e0 + e1) / 2;
        kit.box('stone', a[0] + ux * m + nx * d / 2, y, a[1] + uz * m + nz * d / 2, e1 - e0, t, d, rot, colr);
      }
      const m = (t0 + t1) / 2;
      kit.box('metal', a[0] + ux * m + nx * 1.25, 36.0, a[1] + uz * m + nz * 1.25, t1 - t0, 1.0, 0.05, rot, col('#5d6166'));
    }
  }
  buildBEEntrance(kit, signs);
  buildBEInterior(kit);
}

// ================================================================================================ entrance
function buildBEEntrance(kit: WorldKit, signs: SignUVs): void {
  const G = L.G;
  const stone = C.stone, granite = C.granite;
  const PL = { s0: -10.5, s1: 9.5, d0: -2.8 }; // granite plinth in front of the facade (d < 0 is outside)
  const STEPS = { n: 3, tread: 0.4 };
  const dSteps = PL.d0 - STEPS.n * STEPS.tread;

  // ---------------------------------------------------------------- plinth (granite paving) + 3 steps down to the drive + apron
  const pb = kit.buf('polished', P(0, -2)[0], P(0, -2)[1]);
  hq(pb, PL.s0, PL.s1, PL.d0, 0, G, true, granite, 0.5);
  hq(pb, -LOBBY.s, LOBBY.s, 0, LOBBY.glass, G, true, granite, 0.5);
  vqD(pb, PL.s0, PL.d0, 0, 0, G, -1, granite.clone().multiplyScalar(0.9));
  vqD(pb, PL.s1, PL.d0, 0, 0, G, 1, granite.clone().multiplyScalar(0.9));
  for (let i = 0; i < STEPS.n; i++) {
    const yt = G - i * (G / STEPS.n), yb = G - (i + 1) * (G / STEPS.n), d0 = PL.d0 - i * STEPS.tread, d1 = d0 - STEPS.tread;
    vqS(pb, d0, PL.s0, PL.s1, yb, yt, -1, granite.clone().multiplyScalar(0.82), 0.5); // riser
    if (yb > 0.01) hq(pb, PL.s0, PL.s1, d1, d0, yb, true, granite.clone().multiplyScalar(1.05), 0.5); // tread
    vqD(pb, PL.s0, d1, d0, 0, yb, -1, granite.clone().multiplyScalar(0.85));
    vqD(pb, PL.s1, d1, d0, 0, yb, 1, granite.clone().multiplyScalar(0.85));
  }
  kit.collision.addPolygon(rect(PL.s0, PL.s1, PL.d0, 0), G, 'concrete', 'be:plinth');
  kit.collision.addRamp(rect(PL.s0, PL.s1, dSteps, PL.d0), P(0, dSteps), P(0, PL.d0), 0, G, 'concrete', 'be:steps');
  // paved drop-off apron between the steps and the link road
  kit.buf('stone', P(0, -6)[0], P(0, -6)[1]).flatPoly([P(PL.s0, dSteps + 0.4), P(PL.s1, dSteps + 0.4), [-4.55, -150.0], [-5.3, -170.0]], 0.066, col('#a9a69f'), 1.5);
  // raised paved walkway along the rest of the east face (2021 tour be21_0180 / 0190 / 0194): 0.3 m granite kerb,
  // potted palms against the wall, white ventilation boxes, a red hose cabinet. No trees against the facade.
  {
    const WH = 0.3, WD = -2.4;
    const wb = kit.buf('granite', P(0, -1)[0], P(0, -1)[1]);
    const stoneB = kit.buf('stone', P(0, -1)[0], P(0, -1)[1]);
    for (const [s0, s1] of [[-37.35, PL.s0], [PL.s1, 45.6]] as V2[]) {
      hq(wb, s0, s1, WD, 0, WH, true, col('#a5a39d'), 0.5);
      vqS(wb, WD, s0, s1, 0, WH, -1, col('#6f6d69'));
      vqD(wb, s0, WD, 0, 0, WH, -1, col('#6f6d69'));
      vqD(wb, s1, WD, 0, 0, WH, 1, col('#6f6d69'));
      kit.collision.addPolygon(rect(s0, s1, WD, 0), WH, 'concrete', 'be:walk');
      const dir = s1 > 0 ? 1 : -1, start = dir > 0 ? s0 : s1;
      for (let k = 0; ; k++) {
        const s = start + dir * (1.1 + k * 2.2);
        if ((dir > 0 && s > s1 - 0.8) || (dir < 0 && s < s0 + 0.8)) break;
        const q = P(s, -0.45);
        pottedPlant(kit, q[0], WH, q[1], 1.05);
        if (k % 4 === 2) { // ventilation box between the pots (the low white boxes with grilles)
          bx(stoneB, s - 0.7, s + 0.7, -1.75, -0.95, WH, WH + 0.5, col('#f1efea'), 0.5);
          bx(stoneB, s - 0.55, s + 0.55, -1.77, -1.74, WH + 0.1, WH + 0.35, col('#55585c'), 0.5);
          kit.collision.addPolygon(rect(s - 0.7, s + 0.7, -1.75, -0.95), WH + 0.5, 'concrete', 'prop', 0);
        }
      }
    }
    // red fire-hose cabinet on a post near the south end
    const hs = 30;
    bx(kit.buf('paint', P(hs, -1)[0], P(hs, -1)[1]), hs - 0.35, hs + 0.35, -1.95, -1.65, WH + 0.9, WH + 1.5, col('#b3261e'));
    bx(kit.buf('metal', P(hs, -1)[0], P(hs, -1)[1]), hs - 0.04, hs + 0.04, -1.84, -1.76, WH, WH + 0.9, col('#8a1c16'));
  }
  // potted palms along the plinth edge, clear of the doors and the piers' fronts
  for (let s = PL.s0 + 0.8; s < PL.s1 - 0.5; s += 1.3) {
    if (Math.abs(s) < 2.6) continue;
    const q = P(s, PL.d0 + 0.45);
    pottedPlant(kit, q[0], G, q[1], 1.15);
  }

  // ---------------------------------------------------------------- stone piers either side of the glass (carry the tower), louvres, lintel, louvred glazing
  const TOP = L.top;
  const sb = kit.buf('stone', P(0, 0)[0], P(0, 0)[1]);
  const mb = kit.buf('metal', P(0, 0)[0], P(0, 0)[1]);
  for (const sg of [-1, 1]) {
    const s0 = sg * LOBBY.s, s1 = sg * TOWER.s;
    bx(sb, s0, s1, TOWER.d0, LOBBY.glass, 0, TOP, stone, 0.5);
    bx(sb, s0, s1, TOWER.d0 - 0.02, TOWER.d0 + 0.3, 0, 0.9, C.pink, 0.5); // pink stone skirting
    // two tall white louvre panels set into the pier face
    const sc = sg * (LOBBY.s + TOWER.s) / 2;
    for (const [y0, y1] of [[1.4, 5.8], [7.6, 10.0]]) {
      bx(mb, sc - 0.7, sc + 0.7, TOWER.d0 - 0.03, TOWER.d0 + 0.02, y0, y1, col('#e8e6e0'));
      for (let k = 0; k < 8; k++) bx(mb, sc - 0.62 + k * 0.175, sc - 0.6 + k * 0.175, TOWER.d0 - 0.12, TOWER.d0 - 0.02, y0 + 0.1, y1 - 0.1, col('#cfccc4'));
    }
  }
  kit.collision.addPolygon(rect(-TOWER.s, -LOBBY.s, TOWER.d0, LOBBY.d1), TOP, 'concrete', 'be:pier');
  kit.collision.addPolygon(rect(LOBBY.s, TOWER.s, TOWER.d0, LOBBY.d1), TOP, 'concrete', 'be:pier');
  // stone lintel band over the glass, recessed louvred glazing above it up to the tower's underside
  bx(sb, -LOBBY.s, LOBBY.s, TOWER.d0, LOBBY.glass, 7.0, 8.3, stone, 0.5);
  bx(sb, -LOBBY.s, LOBBY.s, TOWER.d0, LOBBY.glass, TOP - 0.25, TOP, stone, 0.5);
  bx(kit.buf('glass', P(0, 0)[0], P(0, 0)[1]), -LOBBY.s, LOBBY.s, 0.25, 0.35, 8.3, TOP - 0.25, col('#56636c'));
  for (let s = -LOBBY.s + 0.4; s < LOBBY.s - 0.2; s += 0.6) bx(mb, s - 0.03, s + 0.03, -0.25, 0.25, 8.3, TOP - 0.25, col('#e3e1db'));
  for (const y of [8.9, 9.6]) bx(mb, -LOBBY.s, LOBBY.s, -0.2, -0.1, y, y + 0.06, col('#d8d6d0'));
  kit.collision.addPolygon(rect(-LOBBY.s, LOBBY.s, TOWER.d0, LOBBY.glass), TOP - 7.0, 'concrete', 'be:lintel', 7.0);
  // the recess reads as a deep shadowed portal (key frames 1406 / 1928): darker cheeks and head, a glazed wall at its
  // back with a stone spandrel at every floor
  {
    const yb = TOP + 0.3, yt = TOWER.head;
    const kb = kit.buf('stone', P(0, 2)[0], P(0, 2)[1]);
    for (const sg of [-1, 1]) bx(kb, sg * (TOWER.slot - 0.05), sg * TOWER.slot, TOWER.d0 + 0.3, TOWER.slotD, yb, yt, col('#9c8d78'), 0.5);
    const gl = kit.buf('glass', P(0, 2)[0], P(0, 2)[1]);
    bx(gl, -TOWER.slot + 0.05, TOWER.slot - 0.05, TOWER.slotD - 0.06, TOWER.slotD - 0.01, yb, yt - 0.3, col('#3e4a52'));
    for (let y = 14.0; y < yt - 1; y += 3.5) bx(kb, -TOWER.slot + 0.05, TOWER.slot - 0.05, TOWER.slotD - 0.12, TOWER.slotD - 0.05, y - 0.35, y + 0.35, col('#a89883'), 0.5);
    for (const s of [-1.2, 0, 1.2]) bx(kit.buf('metal', P(0, 2)[0], P(0, 2)[1]), s - 0.04, s + 0.04, TOWER.slotD - 0.1, TOWER.slotD - 0.05, yb, yt - 0.3, col('#3a3d41'));
  }
  // floor of the tower's recess (open above the lintel up to the tower head)
  bx(kit.buf('concrete', P(0, 0)[0], P(0, 0)[1]), -TOWER.slot, TOWER.slot, TOWER.d0, TOWER.slotD, TOP, TOP + 0.3, col('#a8a49c'), 0.5);
  kit.collision.addPolygon(rect(-TOWER.slot, TOWER.slot, TOWER.d0, TOWER.slotD), 0.3, 'concrete', 'be:slot', TOP);

  // ---------------------------------------------------------------- frameless spider-glass wall with the auto-door opening + logo
  {
    const g0 = LOBBY.glass, gTop = 7.0, doorHalf = 1.6, sA = -LOBBY.s + 0.4, sB = LOBBY.s - 0.4;
    const gb = new GeoBuffer();
    const pane = (s0: number, s1: number, y0: number, y1: number) => gb.wallQuad(P(s0, g0), P(s1, g0), y0, y1, undefined, 1, true);
    pane(sA, -doorHalf, G, gTop);
    pane(doorHalf, sB, G, gTop);
    pane(-doorHalf, doorHalf, G + 2.9, gTop);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xa9bcc6, transparent: true, opacity: 0.26, roughness: 0.04, metalness: 0.25, depthWrite: false, side: THREE.DoubleSide });
    // (interior glazing is added into the same buffer by buildBEInterior via beGlass)
    beGlass = gb;
    beGlassMat = glassMat;
    for (let s = sA; s <= sB + 0.01; s += (sB - sA) / 5) {
      for (const y of [G + 0.1, G + 3.1, gTop - 0.15]) {
        bx(mb, s - 0.14, s + 0.14, g0 - 0.05, g0 - 0.01, y - 0.02, y + 0.02, col('#c9ccd0'));
        bx(mb, s - 0.02, s + 0.02, g0 - 0.05, g0 - 0.01, y - 0.14, y + 0.14, col('#c9ccd0'));
      }
    }
    bx(mb, sA + 0.1, sB - 0.1, g0 - 0.1, g0, G + 2.9, G + 3.02, col('#b7babe')); // transom rail
    for (const sg of [-1, 1]) bx(mb, sg * doorHalf - 0.03, sg * doorHalf + 0.03, g0 - 0.04, g0 + 0.04, G, G + 2.9, col('#b7babe')); // jambs
    const lg = P(0, g0 - 0.02);
    kit.signQuad(signs.beLogo, lg[0], 5.35, lg[1], 2.4, 1.65, -D[0], -D[1], true);
    kit.collision.addSegment(P(sA, g0), P(-doorHalf, g0), 0.2, gTop, 'metal', 'be:glass');
    kit.collision.addSegment(P(doorHalf, g0), P(sB, g0), 0.2, gTop, 'metal', 'be:glass');
    // stone returns at the lobby-mouth corners
    for (const sg of [-1, 1]) bx(sb, sg * (LOBBY.s - 0.4), sg * LOBBY.s, g0 - 0.3, g0 + 0.9, G, gTop, stone, 0.5);
  }

  // ---------------------------------------------------------------- portico deck over the link road (four pink-granite columns)
  // The deck hangs off the tower at +14 m and reaches the far kerb, north-biased like the tour frames be21_0192…0198.
  const deck: V2[] = [P(-10, -0.8), P(3, -0.8), [2.6, -156.3], [2.6, -169.3]];
  const deckY = 14.0, deckT = 2.2;
  {
    const db = kit.buf('stone', P(-3.5, -6)[0], P(-3.5, -6)[1]);
    const dp = normalizeWinding(deck);
    for (let i = 0; i < dp.length; i++) {
      const a = dp[i], c = dp[(i + 1) % dp.length];
      db.wallQuad(a, c, deckY, deckY + deckT, col('#d9ccb8'), 0.5);
    }
    db.flatPoly(deck, deckY, col('#bdb9b1'), 2, true);
    db.flatPoly(deck, deckY + deckT, col('#a9a59d'), 3);
    kit.collision.addPolygon(deck, deckT, 'concrete', 'be:portico', deckY);
  }
  const colAt: V2[] = [P(-8.9, -3.4), P(2.2, -3.4), [1.95, -168.3], [1.95, -157.2]];
  for (const cp of colAt) {
    kit.box('stone', cp[0], 2.9, cp[1], 1.36, 5.8, 1.36, ROT, C.pink, 0.5);
    kit.box('stone', cp[0], 5.8 + (deckY - 5.8) / 2, cp[1], 1.3, deckY - 5.8, 1.3, ROT, stone, 0.5);
    const cs = Math.cos(ROT), sn = Math.sin(ROT);
    const k = (x: number, z: number): V2 => [cp[0] + x * cs + z * sn, cp[1] - x * sn + z * cs];
    kit.collision.addPolygon([k(-0.68, -0.68), k(0.68, -0.68), k(0.68, 0.68), k(-0.68, 0.68)], deckY, 'concrete', 'be:column');
  }
}

/** The lobby's spider-glass buffer (see-through); interior glazing joins it so it stays one draw call. */
let beGlass: GeoBuffer | null = null;
let beGlassMat: THREE.Material | null = null;

// ================================================================================================ interior
/** Always-on panels (tube lights, skylight diffusers, TV screens): unlit and slightly over-bright, vertex-tinted. */
function lampMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.5, 1.45, 1.36), toneMapped: true });
}

/** Set the largest bold font (≤ size) at which `text` fits in maxW. */
function fitFont(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: string, family: string): void {
  g.font = `${weight} ${size}px ${family}`;
  while (g.measureText(text).width > maxW && size > 8) { size -= 2; g.font = `${weight} ${size}px ${family}`; }
}

/** Canvas decals for the interior (frieze, department sign, notice boards, room plates, floor numbers). */
function decalTexture(): { tex: THREE.CanvasTexture; uv: Record<string, [number, number, number, number]> } {
  const W = 1024, H = 640;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const SANS = '"Helvetica Neue", "Segoe UI", Arial, sans-serif';
  const KN = '"Noto Sans Kannada", "Kannada Sangam MN", "Tunga", "Nirmala UI", sans-serif';
  const uv: Record<string, [number, number, number, number]> = {};
  const reg = (k: string, x: number, y: number, w: number, h: number) => { uv[k] = [x / W + 0.5 / W, 1 - (y + h) / H + 0.5 / H, (x + w) / W - 0.5 / W, 1 - y / H - 0.5 / H]; };
  // Mahatma Gandhi frieze (white, grey line sketches of the Dandi march, chakra + tricolour swoosh, "150")
  {
    g.fillStyle = '#f7f6f2'; g.fillRect(0, 0, W, 128);
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.strokeStyle = '#6d6d70'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 24; i++) {
      const x = 20 + i * 27 + r() * 8, base = 116, hh = 58 + r() * 26;
      g.beginPath(); g.arc(x, base - hh, 6, 0, Math.PI * 2); g.stroke(); // head
      g.beginPath(); g.moveTo(x, base - hh + 6); g.lineTo(x + (r() - 0.5) * 6, base - hh * 0.45); g.stroke(); // body
      g.beginPath(); g.moveTo(x + (r() - 0.5) * 6, base - hh * 0.45); g.lineTo(x - 8 - r() * 4, base); g.moveTo(x, base - hh * 0.45); g.lineTo(x + 7 + r() * 5, base); g.stroke(); // legs
      g.beginPath(); g.moveTo(x, base - hh * 0.8); g.lineTo(x + 10, base - hh * 0.55 - r() * 10); g.stroke(); // arm / staff
      if (i % 4 === 1) { g.beginPath(); g.moveTo(x + 10, base - hh * 0.62); g.lineTo(x + 12, base); g.stroke(); }
    }
    const cx = 752, cy = 64;
    g.strokeStyle = '#ff9933'; g.lineWidth = 9; g.beginPath(); g.arc(cx - 30, cy + 70, 95, -1.9, -0.9); g.stroke();
    g.strokeStyle = '#138808'; g.beginPath(); g.arc(cx - 30, cy + 90, 95, -1.7, -0.8); g.stroke();
    g.strokeStyle = '#1b2a7a'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34); g.stroke(); }
    g.fillStyle = '#2b2b2e'; g.textBaseline = 'middle'; g.textAlign = 'left';
    const tx = 806, tw = W - tx - 12;
    fitFont(g, 'MAHATMA', tw, 40, '800', SANS); g.fillText('MAHATMA', tx, 46);
    g.fillText('GANDHI', tx, 90);
    g.font = `700 22px ${SANS}`; g.fillText('150', tx, 16);
    reg('frieze', 0, 0, W, 128);
  }
  // Department of Computer Science and Engineering (red plate, white Kannada + English)
  {
    g.fillStyle = '#c8322a'; g.fillRect(0, 128, 512, 128);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 24px ${KN}`; g.fillText('ಗಣಕ ವಿಜ್ಞಾನ ಮತ್ತು ಇಂಜಿನಿಯರಿಂಗ್ ವಿಭಾಗ', 256, 156);
    g.font = `700 30px ${SANS}`; g.fillText('Department of', 256, 196);
    fitFont(g, 'Computer Science and Engineering', 488, 30, '700', SANS); g.fillText('Computer Science and Engineering', 256, 232);
    reg('cse', 0, 128, 512, 128);
    // Electronics and Communication Engineering shares the block (2023 ECE tour, UOVu_0124)
    g.fillStyle = '#c8322a'; g.fillRect(0, 512, 512, 128);
    g.fillStyle = '#ffffff';
    g.font = `600 24px ${KN}`; g.fillText('ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್ ಮತ್ತು ಸಂವಹನ ಇಂಜಿನಿಯರಿಂಗ್ ವಿಭಾಗ', 256, 540);
    g.font = `700 30px ${SANS}`; g.fillText('Department of', 256, 580);
    fitFont(g, 'Electronics & Communication Engineering', 488, 30, '700', SANS); g.fillText('Electronics & Communication Engineering', 256, 616);
    reg('ece', 0, 512, 512, 128);
  }
  // pin board: maroon felt with student posters
  {
    g.fillStyle = '#6d1f2a'; g.fillRect(512, 128, 512, 128);
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pal = ['#f4f1e8', '#f2c94c', '#56ccf2', '#eb5757', '#ffffff', '#27ae60', '#e0e0e0', '#bb6bd9', '#222222'];
    for (let i = 0; i < 22; i++) {
      const w = 34 + r() * 40, h = 30 + r() * 44, x = 520 + r() * (496 - w), y = 134 + r() * (116 - h);
      g.fillStyle = pal[Math.floor(r() * pal.length)]; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(0,0,0,0.35)'; for (let k = 0; k < 3; k++) g.fillRect(x + 4, y + 6 + k * 8, w * (0.4 + r() * 0.5), 2);
    }
    reg('pinboard', 512, 128, 512, 128);
  }
  // room plates (orange, white text), 16 slots of 128 x 64
  const plates = ['G01 CSE OFFICE', 'G02 CLASSROOM', 'G03 CSE LAB 1', 'G04 CLASSROOM', '101 CLASSROOM', '102 CSE LAB 2', '103 CLASSROOM', '104 CLASSROOM', '201 CSE LAB 3', '202 CLASSROOM', '203 CSE LAB 4', '204 CLASSROOM', 'WC', 'LIFT', 'STAIRS', 'EXIT'];
  plates.forEach((t, i) => {
    const x = (i % 8) * 128, y = 256 + Math.floor(i / 8) * 64;
    g.fillStyle = i >= 12 ? '#2f3a40' : '#e3662b'; g.fillRect(x + 2, y + 2, 124, 60);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const [num, ...rest] = t.split(' ');
    if (rest.length) { g.font = `800 26px ${SANS}`; g.fillText(num, x + 64, y + 22); g.font = `600 14px ${SANS}`; g.fillText(rest.join(' '), x + 64, y + 46); }
    else { g.font = `800 28px ${SANS}`; g.fillText(num, x + 64, y + 33); }
    reg(`plate${i}`, x, y, 128, 64);
  });
  // floor numbers for the stair core (G / 1 / 2)
  ['G', '1', '2'].forEach((t, i) => {
    const x = i * 128, y = 384;
    g.fillStyle = '#f2f1ec'; g.fillRect(x, y, 128, 128);
    g.fillStyle = '#e3662b'; g.fillRect(x + 8, y + 8, 112, 112);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 84px ${SANS}`; g.fillText(t, x + 64, y + 70);
    reg(`floor${i}`, x, y, 128, 128);
  });
  // green chalk board with a few chalk lines
  {
    g.fillStyle = '#23443a'; g.fillRect(384, 384, 384, 128);
    g.strokeStyle = 'rgba(240,240,230,0.7)'; g.lineWidth = 2;
    let seed = 3;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 7; k++) { const y = 400 + k * 15; g.beginPath(); g.moveTo(400, y); for (let x = 400; x < 400 + 120 + r() * 180; x += 6) g.lineTo(x, y + (r() - 0.5) * 4); g.stroke(); }
    g.beginPath(); g.arc(700, 440, 26, 0, Math.PI * 2); g.moveTo(660, 480); g.lineTo(740, 480); g.lineTo(700, 410); g.closePath(); g.stroke();
    reg('chalk', 384, 384, 384, 128);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, uv };
}

function buildBEInterior(kit: WorldKit): void {
  const col_ = kit.collision;
  const bufs = new Map<string, GeoBuffer>();
  const B = (k: DetailKey | 'lamp' | 'decal'): GeoBuffer => { let b = bufs.get(k); if (!b) bufs.set(k, (b = new GeoBuffer({ color: true }))); return b; };
  const glass = beGlass ?? new GeoBuffer();
  const { tex, uv } = decalTexture();

  /** Decal quad facing direction n (world, horizontal) centred at (s, d, y). */
  const decal = (key: string, s: number, d: number, y: number, w: number, h: number, n: P3) => {
    const r = uv[key];
    if (!r) return;
    const b = B('decal');
    const rx = n[2], rz = -n[0]; // right vector for a viewer looking along −n
    const q = P(s, d);
    const x = q[0] + n[0] * 0.012, z = q[1] + n[2] * 0.012;
    const i0 = b.vert(x - rx * w / 2, y - h / 2, z - rz * w / 2, n[0], 0, n[2], r[0], r[1]);
    const i1 = b.vert(x + rx * w / 2, y - h / 2, z + rz * w / 2, n[0], 0, n[2], r[2], r[1]);
    const i2 = b.vert(x + rx * w / 2, y + h / 2, z + rz * w / 2, n[0], 0, n[2], r[2], r[3]);
    const i3 = b.vert(x - rx * w / 2, y + h / 2, z - rz * w / 2, n[0], 0, n[2], r[0], r[3]);
    b.quad(i0, i1, i2, i3);
  };
  const tube = (s: number, d: number, y: number, alongS: boolean, len = 1.2) => {
    if (alongS) { bx(B('metal'), s - len / 2 - 0.03, s + len / 2 + 0.03, d - 0.07, d + 0.07, y - 0.05, y, C.white); bx(B('lamp'), s - len / 2, s + len / 2, d - 0.03, d + 0.03, y - 0.075, y - 0.045, C.white); }
    else { bx(B('metal'), s - 0.07, s + 0.07, d - len / 2 - 0.03, d + len / 2 + 0.03, y - 0.05, y, C.white); bx(B('lamp'), s - 0.03, s + 0.03, d - len / 2, d + len / 2, y - 0.075, y - 0.045, C.white); }
  };

  // ============================================================ collision: floors, slabs, cores, walls
  // ground floor: one podium prism under the whole core (the lobby and plinth tops meet at the glass line)
  col_.addPolygon([P(-TOWER.s, 0), P(-TOWER.s, 10), P(-ROOM.s1, 10), P(-ROOM.s1, ROOM.d1), P(ROOM.s1, ROOM.d1), P(ROOM.s1, 10), P(TOWER.s, 10), P(TOWER.s, 0)], L.G, 'concrete', 'be:floor');
  // lift core
  solid(col_, -LC.s, LC.s, LC.d0, LC.d1, L.G, L.top, 'be:core');
  // WC / service block beside the stair core
  solid(col_, ST.wc, HALL.s + 0.1, HALL.d1, ROOM.d1, L.G, L.top, 'be:core');
  // 1st / 2nd floor slabs (holes: the lobby void, the atrium void, the stair well)
  const slabRects: [number, number, number, number][] = [
    [-LOBBY.s, LOBBY.s, MEZZ, LOBBY.d1], // galleries over the lobby's back
    [-HALL.s, -LC.s, LC.d0, LC.d1], [LC.s, HALL.s, LC.d0, LC.d1], // passages beside the lift core
    [-HALL.s, HALL.s, LC.d1, VOID.d0], // east gallery
    [-HALL.s, -VOID.s, VOID.d0, VOID.d1], [VOID.s, HALL.s, VOID.d0, VOID.d1], // north / south galleries
    [-HALL.s, HALL.s, VOID.d1, HALL.d1], // west gallery
    [-ROOM.s1, -HALL.s, HALL.d0, ROOM.d1], [HALL.s, ROOM.s1, HALL.d0, ROOM.d1], // room wings
    [-HALL.s, ST.a, HALL.d1, ROOM.d1], // stair landing
  ];
  for (const fy of [L.F1, L.F2]) for (const [s0, s1, d0, d1] of slabRects) solid(col_, s0, s1, d0, d1, fy - SLAB, fy, 'be:slab');
  // walls between the hall and the room wings / stair core (s = ±7.6), with doorways on every floor
  const wallRun = (s: number, cuts: [number, number][], d0: number, d1: number) => {
    let a = d0;
    for (const [c0, c1] of [...cuts, [d1, d1] as [number, number]]) {
      if (c0 - a > 0.05) solid(col_, s - 0.1, s + 0.1, a, c0, L.G, L.top, 'be:wall');
      if (c1 > c0) for (let f = 0; f < 3; f++) solid(col_, s - 0.1, s + 0.1, c0, c1, FLOORS[f] + HEAD, f < 2 ? FLOORS[f + 1] - SLAB : L.top, 'be:wall');
      a = c1;
    }
  };
  for (const sg of [-1, 1]) {
    wallRun(sg * HALL.s, DOORS, HALL.d0, ROOM.d1);
    solid(col_, sg * (HALL.s + 0.1), sg * ROOM.s1, ROOM.dm - 0.1, ROOM.dm + 0.1, L.G, L.top, 'be:wall'); // room partition
  }
  // stair core: segmented flights (stack cleanly), mid landings, spine wall
  const [a0, a1] = ST.laneA, [b0, b1] = ST.laneB;
  flight(col_, 's', ST.a, ST.b, a0, a1, L.G, (L.G + L.F1) / 2, 'stair');
  flight(col_, 's', ST.b, ST.a, b0, b1, (L.G + L.F1) / 2, L.F1, 'stair');
  flight(col_, 's', ST.a, ST.b, a0, a1, L.F1, (L.F1 + L.F2) / 2, 'stair');
  flight(col_, 's', ST.b, ST.a, b0, b1, (L.F1 + L.F2) / 2, L.F2, 'stair');
  solid(col_, ST.b, ST.wc, a0, b1, (L.G + L.F1) / 2 - SLAB, (L.G + L.F1) / 2, 'landing');
  solid(col_, ST.b, ST.wc, a0, b1, (L.F1 + L.F2) / 2 - SLAB, (L.F1 + L.F2) / 2, 'landing');
  solid(col_, ST.a, ST.b, a1, b0, L.G, L.top, 'be:wall');
  rail(col_, [ST.b, HALL.d1], [ST.wc, HALL.d1], L.F1); // parapet over the lower mid landing
  rail(col_, [ST.a, HALL.d1], [ST.wc, HALL.d1], L.F2); // 2nd floor: stair-well edge
  rail(col_, [ST.a, a0], [ST.a, a1], L.F2);
  // floating timber stairs in the atrium + the lobby stair
  flight(col_, 'd', T1.d0, T1.d1, T1.s0, T1.s1, L.G, L.F1, 'stair');
  flight(col_, 'd', T2.d1, T2.d0, T2.s0, T2.s1, L.F1, L.F2, 'stair');
  flight(col_, 'd', LSTAIR.d0, LSTAIR.d1, LSTAIR.s0, LSTAIR.s1, L.G, L.F1, 'stair');
  flightRail(col_, 'd', T1.d0, T1.d1, T1.s1, L.G, L.F1);
  flightRail(col_, 'd', T2.d1, T2.d0, T2.s0, L.F1, L.F2);
  flightRail(col_, 'd', LSTAIR.d0, LSTAIR.d1, LSTAIR.s0, L.G, L.F1);
  // gallery balustrades round the voids
  rail(col_, [-LOBBY.s, MEZZ], [LSTAIR.s0, MEZZ], L.F1);
  rail(col_, [-LOBBY.s, MEZZ], [LOBBY.s, MEZZ], L.F2);
  for (const [f, fy] of [[1, L.F1], [2, L.F2]] as [number, number][]) {
    rail(col_, [-VOID.s, VOID.d0], [f === 2 ? T2.s0 : VOID.s, VOID.d0], fy);
    rail(col_, [f === 1 ? T1.s1 : -VOID.s, VOID.d1], [f === 1 ? T2.s0 : VOID.s, VOID.d1], fy);
    rail(col_, [-VOID.s, VOID.d0], [-VOID.s, VOID.d1], fy);
    rail(col_, [VOID.s, VOID.d0], [VOID.s, VOID.d1], fy);
  }

  // ============================================================ visuals: floors, ceilings, slab edges
  const flr = B('polished'), pl = B('plaster'), pt = B('paint');
  // ground floor finishes
  hq(flr, -LOBBY.s, LOBBY.s, LOBBY.glass, LOBBY.d1, L.G + 0.004, true, C.floor, 0.5);
  hq(flr, -HALL.s, HALL.s, HALL.d0, HALL.d1, L.G + 0.004, true, C.floor, 0.5);
  hq(flr, -HALL.s, ST.wc, HALL.d1, ROOM.d1, L.G + 0.004, true, C.floor, 0.5);
  for (const sg of [-1, 1]) hq(flr, sg * HALL.s, sg * ROOM.s1, HALL.d0, ROOM.d1, L.G + 0.004, true, C.floorRoom, 0.5);
  for (const fy of [L.F1, L.F2]) {
    for (const [s0, s1, d0, d1] of slabRects) {
      const room = Math.abs(s0) >= HALL.s - 0.01 && Math.abs(s1) >= HALL.s - 0.01 && Math.sign(s0) === Math.sign(s1) && Math.abs(s0 + s1) > 2 * HALL.s;
      hq(flr, s0, s1, d0, d1, fy + 0.004, true, room ? C.floorRoom : C.floor, 0.5);
      hq(pl, s0, s1, d0, d1, fy - SLAB, false, C.ceiling, 0.5);
    }
  }
  // 2nd-floor false ceiling over everything (lobby, atrium, stair well included)
  hq(pl, -LOBBY.s, LOBBY.s, LOBBY.glass, LOBBY.d1, CEIL[2], false, C.ceiling, 0.5);
  hq(pl, -HALL.s, HALL.s, HALL.d0, ROOM.d1, CEIL[2], false, C.ceiling, 0.5);
  for (const sg of [-1, 1]) hq(pl, sg * HALL.s, sg * ROOM.s1, HALL.d0, ROOM.d1, CEIL[2], false, C.ceiling, 0.5);
  // slab edges at the voids (thick white bands) + the frieze bulkhead over the lobby
  for (const fy of [L.F1, L.F2]) {
    const y0 = fy - SLAB - 0.15, y1 = fy + 0.12;
    vqS(pl, MEZZ, -LOBBY.s, LOBBY.s, y0, y1, -1, C.white);
    hq(pl, -LOBBY.s, LOBBY.s, MEZZ - 0.001, MEZZ, y0, false, C.white);
    vqS(pl, VOID.d0, -VOID.s, VOID.s, y0, y1, 1, C.white);
    vqS(pl, VOID.d1, -VOID.s, VOID.s, y0, y1, -1, C.white);
    vqD(pl, -VOID.s, VOID.d0, VOID.d1, y0, y1, 1, C.white);
    vqD(pl, VOID.s, VOID.d0, VOID.d1, y0, y1, -1, C.white);
    vqS(pl, HALL.d1, ST.a, ST.wc, y0, y1, 1, C.white);
    vqD(pl, ST.a, HALL.d1, ROOM.d1, y0, y1, 1, C.white);
  }
  vqS(pl, MEZZ, -LOBBY.s, LOBBY.s, 6.1, L.F2 - SLAB - 0.15, -1, C.white); // bulkhead carrying the frieze
  hq(pl, -LOBBY.s, LOBBY.s, MEZZ, MEZZ + 0.25, 6.1, false, C.white);
  vqS(pl, MEZZ + 0.25, -LOBBY.s, LOBBY.s, 6.1, L.F2 - SLAB, 1, C.white);
  decal('frieze', 0, MEZZ, 6.83, 11.2, 1.4, NEG(ND));

  // ============================================================ walls (visual): lobby sides, jogs, lift core, hall walls, rooms
  // lobby side walls (faces of the solid piers' back strips), full height
  for (const sg of [-1, 1]) {
    vqD(pl, sg * LOBBY.s, LOBBY.glass, LOBBY.d1, L.G, CEIL[2], -sg, C.white);
    vqS(pl, LOBBY.d1, sg * LOBBY.s, sg * HALL.s, L.G, CEIL[2], 1, C.white); // jog into the hall
    vqS(pl, HALL.d0 + 0.02, sg * HALL.s, sg * ROOM.s1, L.G, CEIL[2], 1, C.white); // room wing east wall
    vqD(pl, sg * (ROOM.s1 - 0.02), HALL.d0, ROOM.d1, L.G, CEIL[2], -sg, C.white); // room wing outer wall
  }
  vqS(pl, ROOM.d1 - 0.02, -ROOM.s1, ROOM.s1, L.G, CEIL[2], -1, C.white); // west wall of the core
  // lift core: granite-clad lift wall to the lobby at G, the orange wall above the mezzanine, plaster elsewhere
  {
    const gr = B('granite');
    vqS(gr, LC.d0 - 0.01, -LC.s, LC.s, L.G, L.F1 - SLAB, -1, col('#6d6a66'));
    vqS(pl, LC.d0 - 0.01, -LC.s, LC.s, L.F1, L.F2 - SLAB, -1, C.orange);
    vqS(pl, LC.d0 - 0.01, -LC.s, LC.s, L.F2, CEIL[2], -1, C.white);
    for (const sg of [-1, 1]) vqD(pl, sg * (LC.s + 0.01), LC.d0, LC.d1, L.G, CEIL[2], sg, C.white);
    // wave-pattern relief wall to the atrium (vertical wavy bronze ribs), full height
    vqS(pl, LC.d1 + 0.01, -LC.s, LC.s, L.G, CEIL[2], 1, col('#e9e4dc'));
    // continuous wavy ribbons: sloped beams between points on a sine, the depth breathing with it (s23b_03)
    const wv = B('metal');
    for (let k = 0; k < 11; k++) {
      const s = -LC.s + 0.45 + k * ((2 * LC.s - 0.9) / 10);
      const pt = (y: number): P3 => P3at(s + Math.sin(y * 1.35 + k * 0.9) * 0.22, LC.d1 + 0.09 + 0.05 * Math.sin(y * 2.1 + k * 1.7), y);
      for (let y = L.G + 0.5; y < CEIL[2] - 0.8; y += 0.38) wv.beam(pt(y), pt(y + 0.4), 0.13, 0.05, C.wave);
    }
    // lift doors: two at G facing the lobby (TV between), two per upper floor in the passages beside the core
    const liftDoor = (s: number, d: number, fy: number, alongS: boolean) => {
      const mt = B('metal');
      if (alongS) { bx(mt, s - 0.7, s + 0.7, d - 0.04, d + 0.04, fy, fy + 2.3, col('#7b7f84')); bx(mt, s - 0.6, s + 0.6, d - 0.06, d + 0.06, fy, fy + 2.15, C.steel); bx(mt, s - 0.01, s + 0.01, d - 0.07, d + 0.07, fy, fy + 2.15, col('#6a6e73')); }
      else { bx(mt, s - 0.04, s + 0.04, d - 0.7, d + 0.7, fy, fy + 2.3, col('#7b7f84')); bx(mt, s - 0.06, s + 0.06, d - 0.6, d + 0.6, fy, fy + 2.15, C.steel); bx(mt, s - 0.07, s + 0.07, d - 0.01, d + 0.01, fy, fy + 2.15, col('#6a6e73')); }
    };
    for (const s of [-1.75, 1.75]) liftDoor(s, LC.d0, L.G, true);
    bx(B('dark'), -0.65, 0.65, LC.d0 - 0.06, LC.d0 - 0.01, L.G + 2.3, L.G + 3.05, C.screen);
    bx(B('lamp'), -0.58, 0.58, LC.d0 - 0.07, LC.d0 - 0.06, L.G + 2.35, L.G + 3.0, col('#6f9fd6'));
    decal('plate13', 0, LC.d0 - 0.01, L.G + 3.3, 0.6, 0.3, NEG(ND));
    for (const fy of [L.F1, L.F2]) for (const sg of [-1, 1]) liftDoor(sg * LC.s, (LC.d0 + LC.d1) / 2, fy, false);
  }
  // hall walls at s = ±7.6 with doorways (lintels), windows onto the hall between the doorways, door leaves
  for (const sg of [-1, 1]) {
    const s = sg * HALL.s;
    const hallN = sg < 0 ? 1 : -1; // hall-side facing
    const openings = [...DOORS.map(([a, b]) => ({ a, b, door: true })), ...WINDOWS.filter(([, b]) => sg < 0 || b <= HALL.d1).map(([a, b]) => ({ a, b, door: false }))].sort((x, y) => x.a - y.a);
    for (let f = 0; f < 3; f++) {
      const fy = FLOORS[f], cy = CEIL[f];
      let a = HALL.d0;
      for (const o of [...openings, { a: ROOM.d1, b: ROOM.d1, door: false }]) {
        if (o.a - a > 0.02) {
          bx(pl, s - 0.1, s + 0.1, a, o.a, fy, cy, C.white);
          // skirting + dado rail on the hall side (the stair core / WC block side has its own finishes)
          const e = Math.min(o.a, HALL.d1);
          if (e - a > 0.05) {
            vqD(pt, s - sg * 0.105, a, e, fy, fy + 0.12, hallN, C.skirting);
            vqD(pt, s - sg * 0.105, a, e, fy + 1.0, fy + 1.04, hallN, C.dado);
          }
        }
        if (o.b <= o.a) break;
        if (o.door) {
          bx(pl, s - 0.1, s + 0.1, o.a, o.b, fy + HEAD, cy, C.white); // lintel
          const fr = B('wood');
          bx(fr, s - 0.13, s + 0.13, o.a - 0.06, o.a, fy, fy + HEAD, C.frame);
          bx(fr, s - 0.13, s + 0.13, o.b, o.b + 0.06, fy, fy + HEAD, C.frame);
          bx(fr, s - 0.13, s + 0.13, o.a - 0.06, o.b + 0.06, fy + HEAD, fy + HEAD + 0.06, C.frame);
          // two leaves swung open into the room, against the wall
          const inS = sg * (HALL.s + 0.12);
          bx(fr, inS, inS + sg * 0.04, o.a - 0.95, o.a - 0.05, fy + 0.02, fy + HEAD - 0.05, C.door);
          bx(fr, inS, inS + sg * 0.04, o.b + 0.05, o.b + 0.95, fy + 0.02, fy + HEAD - 0.05, C.door);
          const room = f * 4 + (sg < 0 ? 0 : 2) + (o.a > ROOM.dm ? 1 : 0);
          decal(`plate${room}`, s - sg * 0.11, o.b + 0.55, fy + 1.6, 0.5, 0.25, sg < 0 ? NS : NEG(NS));
        } else {
          // glazed panel with black frame and horizontal bars (2021 tour: labs seen from the galleries)
          bx(pl, s - 0.1, s + 0.1, o.a, o.b, fy, fy + 1.0, C.white);
          bx(pl, s - 0.1, s + 0.1, o.a, o.b, fy + 2.1, cy, C.white);
          vqD(pt, s - sg * 0.105, o.a, o.b, fy, fy + 0.12, hallN, C.skirting);
          glass.wallQuad(P(s, o.a), P(s, o.b), fy + 1.0, fy + 2.1, undefined, 1, true);
          const mt = B('metal');
          for (const y of [fy + 1.0, fy + 2.1]) bx(mt, s - 0.12, s + 0.12, o.a, o.b, y - 0.03, y + 0.03, C.black);
          for (let k = 1; k < 4; k++) bx(mt, s - sg * 0.12, s - sg * 0.1, o.a, o.b, fy + 1.0 + k * 0.275 - 0.01, fy + 1.0 + k * 0.275 + 0.01, C.black);
          const nm = Math.max(1, Math.round((o.b - o.a) / 1.5));
          for (let k = 0; k <= nm; k++) { const dd = o.a + ((o.b - o.a) * k) / nm; bx(mt, s - 0.12, s + 0.12, dd - 0.03, dd + 0.03, fy + 1.0, fy + 2.1, C.black); }
        }
        a = o.b;
      }
    }
    // room partition
    for (let f = 0; f < 3; f++) bx(pl, sg * (HALL.s + 0.1), sg * ROOM.s1, ROOM.dm - 0.1, ROOM.dm + 0.1, FLOORS[f], CEIL[f], C.white);
  }
  // CSE sign over the 1st-floor north window, pin boards in the hall
  decal('cse', -HALL.s + 0.11, 19.75, L.F1 + 2.55, 2.9, 0.72, NS);
  decal('ece', HALL.s - 0.11, 19.75, L.F2 + 2.55, 2.9, 0.72, NEG(NS));

  // ============================================================ stair core visuals
  {
    const fl = B('granite');
    const stepsAlong = (a0s: number, a1s: number, c0: number, c1: number, y0: number, y1: number) => {
      const n = Math.round((y1 - y0) / 0.175), run = (a1s - a0s) / n;
      for (let i = 0; i < n; i++) {
        const sA = a0s + run * i, sB = sA + run, yt = y0 + ((y1 - y0) * (i + 1)) / n;
        bx(fl, Math.min(sA, sB), Math.max(sA, sB), c0, c1, yt - 0.2, yt, col('#b7b4ad'), 0.5);
      }
      // sloped soffit plate under the flight
      const pA = P3at(a0s, (c0 + c1) / 2, y0 - 0.2), pB = P3at(a1s, (c0 + c1) / 2, y1 - 0.2);
      B('plaster').beam(pA, pB, c1 - c0, 0.12, C.white);
    };
    const mid1 = (L.G + L.F1) / 2, mid2 = (L.F1 + L.F2) / 2;
    stepsAlong(ST.a, ST.b, a0, a1, L.G, mid1);
    stepsAlong(ST.b, ST.a, b0, b1, mid1, L.F1);
    stepsAlong(ST.a, ST.b, a0, a1, L.F1, mid2);
    stepsAlong(ST.b, ST.a, b0, b1, mid2, L.F2);
    for (const my of [mid1, mid2]) {
      hq(fl, ST.b, ST.wc, a0, b1, my + 0.003, true, col('#b7b4ad'));
      hq(pl, ST.b, ST.wc, a0, b1, my - SLAB, false, C.ceiling);
      vqS(pl, a0, ST.b, ST.wc, my - SLAB, my, -1, C.white);
    }
    // spine wall + handrails on the hall side of lane A
    bx(pl, ST.a, ST.b, a1, b0, L.G, CEIL[2], C.white);
    const mt = B('metal');
    for (const [y0, y1] of [[L.G, mid1], [L.F1, mid2]]) {
      B('metal').beam(P3at(ST.a, a0 + 0.05, y0 + 1.0), P3at(ST.b, a0 + 0.05, y1 + 1.0), 0.05, 0.05, C.black);
      for (let k = 0; k <= 3; k++) { const s = ST.a + ((ST.b - ST.a) * k) / 3, y = y0 + ((y1 - y0) * k) / 3; bx(mt, s - 0.025, s + 0.025, a0 + 0.02, a0 + 0.08, y, y + 1.0, C.black); }
    }
    // 1st-floor parapet and 2nd-floor railings at the stair well
    const railLine = (sa: number, da: number, sb2: number, db: number, fy: number) => railVisual(B('metal'), sa, da, sb2, db, fy);
    railLine(ST.b, HALL.d1, ST.wc, HALL.d1, L.F1);
    railLine(ST.a, HALL.d1, ST.wc, HALL.d1, L.F2);
    railLine(ST.a, a0, ST.a, a1, L.F2);
    // WC block face with a closed door per floor, floor numbers on the landing wall
    vqS(pl, HALL.d1 - 0.01, ST.wc, HALL.s, L.G, CEIL[2], -1, C.white);
    vqD(pl, ST.wc - 0.01, a0, b1, L.G, CEIL[2], -1, C.white);
    for (let f = 0; f < 3; f++) {
      const fy = FLOORS[f];
      bx(B('wood'), 5.0, 6.1, HALL.d1 - 0.05, HALL.d1, fy, fy + 2.2, C.door);
      decal('plate12', 5.55, HALL.d1 - 0.05, fy + 2.45, 0.44, 0.22, NEG(ND));
      decal(`floor${f}`, -HALL.s + 0.11, 30.4, fy + 1.9, 0.9, 0.9, NS);
      decal('plate14', -HALL.s + 0.11, 30.4, fy + 1.2, 0.5, 0.25, NS);
    }
  }

  // ============================================================ lobby
  {
    const G = L.G;
    // lobby stair to the mezzanine (granite treads on a white stringer) with a black balustrade
    const n = 20, run = (LSTAIR.d1 - LSTAIR.d0) / n;
    for (let i = 0; i < n; i++) {
      const d = LSTAIR.d0 + run * i, yt = G + ((L.F1 - G) * (i + 1)) / n;
      bx(B('granite'), LSTAIR.s0, LSTAIR.s1, d, d + run, yt - 0.18, yt, col('#b7b4ad'), 0.5);
    }
    B('plaster').beam(P3at((LSTAIR.s0 + LSTAIR.s1) / 2, LSTAIR.d0, G - 0.15), P3at((LSTAIR.s0 + LSTAIR.s1) / 2, LSTAIR.d1, L.F1 - 0.2), LSTAIR.s1 - LSTAIR.s0, 0.14, C.white);
    sloped(B('metal'), LSTAIR.d0, LSTAIR.d1, LSTAIR.s0 + 0.04, G, L.F1);
    // lift bank on the north wall (2024 tour ZyeL_0500 / UOVu_0094): light-grey granite panels with dark joints, three
    // steel lifts, a dark granite band above them with a TV
    {
      const w = -LOBBY.s + 0.02, gr = B('granite'), mt = B('metal');
      vqD(gr, w, 1.6, 9.4, G, G + 2.7, 1, col('#b8b6b0'));
      vqD(gr, w + 0.01, 1.6, 9.4, G + 2.7, G + 3.35, 1, col('#3b3c3e'));
      for (const d of [2.7, 4.5, 6.3, 8.1]) bx(gr, w, w + 0.04, d - 0.08, d + 0.08, G, G + 2.7, col('#4a4b4d'));
      for (const d of [3.6, 5.4, 7.2]) {
        bx(mt, w, w + 0.05, d - 0.62, d + 0.62, G, G + 2.3, col('#7b7f84'));
        bx(mt, w, w + 0.07, d - 0.55, d + 0.55, G, G + 2.18, C.steel);
        bx(mt, w, w + 0.08, d - 0.01, d + 0.01, G, G + 2.18, col('#6a6e73'));
        decal('plate13', w + 0.01, d, G + 2.5, 0.36, 0.18, NS);
      }
      bx(B('dark'), w, w + 0.06, 4.75, 6.05, G + 2.75, G + 3.3, C.screen);
      bx(B('lamp'), w + 0.061, w + 0.07, 4.8, 6.0, G + 2.8, G + 3.25, col('#6f9fd6'));
    }
    // security desk, black benches, potted plants, entrance mat
    bx(B('plaster'), 1.0, 3.0, 5.8, 6.4, G, G + 1.0, col('#f3f2ee'));
    bx(B('wood'), 0.95, 3.05, 5.75, 6.45, G + 1.0, G + 1.05, C.timberDark);
    solid(col_, 0.95, 3.05, 5.75, 6.45, G, G + 1.05, 'prop', 'wood');
    for (const s of [-2.6, 2.2]) { bx(B('dark'), s - 0.8, s + 0.8, 1.9, 2.4, G + 0.38, G + 0.46, C.chair); bx(B('metal'), s - 0.75, s + 0.75, 1.95, 2.35, G, G + 0.38, C.legs); }
    bx(B('dark'), -1.4, 1.4, 0.8, 2.6, G + 0.003, G + 0.012, col('#3a3530'));
    // TV on the south wall, lobby ceiling panels (square LEDs) + downlights under the mezzanine
    for (const s of [-3.5, 0, 3.5]) for (const d of [2.2, 4.6]) bx(B('lamp'), s - 0.5, s + 0.5, d - 0.5, d + 0.5, CEIL[2] - 0.03, CEIL[2], C.white);
    for (const s of [-4.5, -1.5, 1.5, 4.5]) for (const fy of [L.F1, L.F2]) bx(B('lamp'), s - 0.12, s + 0.12, 8.5, 8.74, fy - SLAB - 0.02, fy - SLAB, C.white);
    // pin board + departmental notice on the lobby side walls
    kit.lampPoints.push(new THREE.Vector3(P(0, 4.5)[0], CEIL[2] - 0.6, P(0, 4.5)[1]));
    for (const [s, d] of [[-5.3, 1.2], [-5.3, 9.3], [2.9, 9.3]] as V2[]) { const q = P(s, d); pottedPlant(kit, q[0], G, q[1], 1.3); }
    // mezzanine / 2nd-floor gallery railings over the lobby
    railVisual(B('metal'), -LOBBY.s, MEZZ, LSTAIR.s0, MEZZ, L.F1);
    railVisual(B('metal'), -LOBBY.s, MEZZ, LOBBY.s, MEZZ, L.F2);
  }

  // ============================================================ atrium: floating timber stairs, railings, sculpture, TVs, boards
  {
    const timberFlight = (lo: number, hi: number, s0: number, s1: number, y0: number, y1: number) => {
      const n = Math.round((y1 - y0) / 0.175), run = (hi - lo) / n;
      const tb = B('wood');
      for (let i = 0; i < n; i++) {
        const d = lo + run * i, yt = y0 + ((y1 - y0) * (i + 1)) / n;
        bx(tb, s0 + 0.05, s1 - 0.05, Math.min(d, d + run), Math.max(d, d + run), yt - 0.06, yt, C.timber, 0.5);
      }
      // folded timber-clad plate + side cheeks (the stairs "float": no posts)
      const sm = (s0 + s1) / 2;
      tb.beam(P3at(sm, lo, y0 - 0.25), P3at(sm, hi, y1 - 0.25), s1 - s0, 0.38, C.timberDark);
      for (const s of [s0 + 0.03, s1 - 0.03]) tb.beam(P3at(s, lo, y0 + 0.02), P3at(s, hi, y1 + 0.02), 0.06, 0.5, C.timber);
    };
    timberFlight(T1.d0, T1.d1, T1.s0, T1.s1, L.G, L.F1);
    timberFlight(T2.d1, T2.d0, T2.s0, T2.s1, L.F1, L.F2);
    sloped(B('metal'), T1.d0, T1.d1, T1.s1 - 0.04, L.G, L.F1);
    sloped(B('metal'), T2.d1, T2.d0, T2.s0 + 0.04, L.F1, L.F2);
    sloped(B('metal'), T2.d1, T2.d0, T2.s1 - 0.04, L.F1, L.F2);
    for (const [f, fy] of [[1, L.F1], [2, L.F2]] as [number, number][]) {
      const m = B('metal');
      railVisual(m, -VOID.s, VOID.d0, f === 2 ? T2.s0 : VOID.s, VOID.d0, fy);
      railVisual(m, f === 1 ? T1.s1 : -VOID.s, VOID.d1, f === 1 ? T2.s0 : VOID.s, VOID.d1, fy);
      railVisual(m, -VOID.s, VOID.d0, -VOID.s, VOID.d1, fy);
      railVisual(m, VOID.s, VOID.d0, VOID.s, VOID.d1, fy);
    }
    // skylight diffusers over the atrium, tube lights along the galleries and the ground-floor hall
    for (const s of [-2.4, 0, 2.4]) for (const d of [16.5, 19, 21.5, 24]) bx(B('lamp'), s - 1.0, s + 1.0, d - 1.0, d + 1.0, CEIL[2] - 0.02, CEIL[2], col('#fdfcf6'));
    { const q = P(0, 20); kit.lampPoints.push(new THREE.Vector3(q[0], CEIL[2] - 0.6, q[1])); } // baked into the lamp light map (night)
    for (let f = 0; f < 3; f++) {
      const cy = CEIL[f];
      for (let d = 11.2; d < 27; d += 2.8) { tube(-6.2, d, cy, false); tube(6.2, d, cy, false); }
      for (let s = -3.6; s <= 3.6; s += 2.4) { tube(s, 13.8, cy, true); tube(s, 26.3, cy, true); }
    }
    // white stacked-block sculpture on the ground floor (key frame map11_297), a hanging TV over the void
    const sc = B('plaster');
    let y = L.G;
    for (let k = 0; k < 9; k++) {
      const w = 0.5 + ((k * 37) % 5) * 0.08, h = 0.35 + ((k * 13) % 4) * 0.06, off = ((k * 29) % 7 - 3) * 0.05;
      bx(sc, 1.2 + off - w / 2, 1.2 + off + w / 2, 20 - w / 2, 20 + w / 2, y, y + h, col('#f5f4f0'));
      y += h;
    }
    bx(B('granite'), 0.7, 1.7, 19.5, 20.5, L.G, L.G + 0.25, col('#8d8a85'));
    col_.addCircle(P(1.2, 20)[0], P(1.2, 20)[1], 0.75, 3.8, 'concrete', 'be:sculpture', L.G);
    bx(B('metal'), -0.02, 0.02, 19.98, 20.02, 9.0, CEIL[2], C.black);
    bx(B('dark'), -1.1, 1.1, 19.9, 20.1, 8.2, 9.1, C.screen);
    bx(B('lamp'), -1.02, 1.02, 19.88, 19.9, 8.25, 9.05, col('#6f9fd6'));
    bx(B('lamp'), -1.02, 1.02, 20.1, 20.12, 8.25, 9.05, col('#6f9fd6'));
    // free-standing pin boards with student work in the ground-floor hall
    for (const [s, d] of [[-6.4, 16.3], [-6.4, 19.4], [6.4, 16.3], [6.4, 19.4]] as V2[]) {
      const fr = B('paint');
      bx(fr, s - 0.04, s + 0.04, d - 1.25, d + 1.25, L.G + 0.5, L.G + 2.0, col('#f1efe8'));
      decal('pinboard', s + 0.05, d, L.G + 1.25, 2.3, 1.3, NS);
      decal('pinboard', s - 0.05, d, L.G + 1.25, 2.3, 1.3, NEG(NS));
      for (const dd of [d - 1.2, d + 1.2]) bx(fr, s - 0.25, s + 0.25, dd - 0.03, dd + 0.03, L.G, L.G + 2.05, col('#f1efe8'));
      solid(col_, s - 0.15, s + 0.15, d - 1.25, d + 1.25, L.G, L.G + 2.05, 'be:board');
    }
  }

  // ============================================================ rooms
  const kinds: ('office' | 'class' | 'lab')[] = ['office', 'class', 'lab', 'class', 'class', 'lab', 'class', 'class', 'lab', 'class', 'lab', 'class'];
  for (let f = 0; f < 3; f++) {
    for (const sg of [-1, 1]) {
      for (const half of [0, 1]) {
        const idx = f * 4 + (sg < 0 ? 0 : 2) + half;
        const sIn = sg * (HALL.s + 0.1), sOut = sg * (ROOM.s1 - 0.02);
        const dA = half === 0 ? HALL.d0 + 0.02 : ROOM.dm + 0.1, dB = half === 0 ? ROOM.dm - 0.1 : ROOM.d1 - 0.02;
        buildRoom(kinds[idx], FLOORS[f], CEIL[f], Math.min(sIn, sOut), Math.max(sIn, sOut), dA, dB, dA, sg); // board on the wall nearest the door
      }
    }
  }

  function buildRoom(kind: 'office' | 'class' | 'lab', fy: number, cy: number, s0: number, s1: number, d0: number, d1: number, front: number, sg: number): void {
    const sm = (s0 + s1) / 2;
    const dir = front === d0 ? 1 : -1; // +d = away from the board
    const at = (k: number) => front + dir * k;
    // tube lights (2 rows) + ceiling fans
    for (const s of [sm - 1.8, sm + 1.8]) for (const k of [2.2, 5.3, 8.4]) tube(s, at(k), cy, false);
    const fan = (s: number, d: number) => {
      const m = B('metal');
      bx(m, s - 0.02, s + 0.02, d - 0.02, d + 0.02, cy - 0.45, cy, C.white);
      bx(m, s - 0.1, s + 0.1, d - 0.1, d + 0.1, cy - 0.55, cy - 0.45, C.white);
      bx(m, s - 0.6, s + 0.6, d - 0.05, d + 0.05, cy - 0.52, cy - 0.5, col('#dcdad4'));
      bx(m, s - 0.05, s + 0.05, d - 0.6, d + 0.6, cy - 0.52, cy - 0.5, col('#dcdad4'));
    };
    if (kind !== 'lab') for (const k of [3.7, 6.9]) for (const s of [sm - 1.8, sm + 1.8]) fan(s, at(k));
    // skirting round the room
    const pt = B('paint');
    vqS(pt, d0 + 0.01, s0, s1, fy, fy + 0.1, 1, C.skirting);
    vqS(pt, d1 - 0.01, s0, s1, fy, fy + 0.1, -1, C.skirting);
    const wallSide = sg < 0 ? s0 : s1; // outer wall
    const u = (x: number) => wallSide - sg * x; // x metres in from the outer wall towards the hall
    vqD(pt, wallSide - sg * 0.01, d0, d1, fy, fy + 0.1, -sg, C.skirting);
    // notice board on the outer wall
    decal('pinboard', wallSide - sg * 0.01, (d0 + d1) / 2, fy + 1.55, 2.2, 1.1, sg < 0 ? NS : NEG(NS));
    const n: P3 = dir > 0 ? ND : NEG(ND);
    if (kind === 'class') {
      // green board with a wooden frame + chalk tray, teacher's desk and chair on a low dais
      bx(B('wood'), sm - 2.0, sm + 2.0, front + dir * 0.01, front + dir * 0.05, fy + 0.85, fy + 2.15, C.frame);
      decal('chalk', sm, front + dir * 0.05, fy + 1.5, 3.8, 1.2, n);
      bx(B('wood'), sm - 1.9, sm + 1.9, front + dir * 0.05, front + dir * 0.12, fy + 0.85, fy + 0.88, C.frame);
      bx(B('granite'), s0 + 0.2, s1 - 0.2, Math.min(front, at(1.6)), Math.max(front, at(1.6)), fy, fy + 0.15, col('#9c9a95'), 0.5);
      solid(col_, s0 + 0.2, s1 - 0.2, front, at(1.6), fy, fy + 0.15, 'be:dais');
      bx(B('wood'), u(0.8), u(2.2), Math.min(at(0.7), at(1.4)), Math.max(at(0.7), at(1.4)), fy + 0.15, fy + 0.93, C.desk);
      solid(col_, u(0.8), u(2.2), at(0.7), at(1.4), fy, fy + 0.93, 'prop', 'wood');
      // benches: two columns of 3-seater desk + bench units, 7 rows; a 1.8 m aisle along the door wall
      const colS: [number, number][] = [[u(0.25), u(2.25)], [u(3.45), u(5.45)]];
      for (let r = 0; r < 7; r++) {
        const k0 = 3.2 + r * 1.02;
        for (const [a, b] of colS) {
          const w = B('wood'), l = B('metal');
          bx(w, a, b, Math.min(at(k0), at(k0 + 0.45)), Math.max(at(k0), at(k0 + 0.45)), fy + 0.72, fy + 0.77, C.desk); // desk top
          bx(w, a, b, Math.min(at(k0 + 0.05), at(k0 + 0.1)), Math.max(at(k0 + 0.05), at(k0 + 0.1)), fy + 0.35, fy + 0.72, C.wood); // modesty panel
          bx(w, a, b, Math.min(at(k0 + 0.55), at(k0 + 0.85)), Math.max(at(k0 + 0.55), at(k0 + 0.85)), fy + 0.42, fy + 0.46, C.wood); // bench seat
          for (const s of [a + 0.05, b - 0.05]) bx(l, s - 0.025, s + 0.025, Math.min(at(k0), at(k0 + 0.85)), Math.max(at(k0), at(k0 + 0.85)), fy, fy + 0.72, C.legs);
          solid(col_, a, b, at(k0), at(k0 + 0.85), fy, fy + 0.77, 'prop', 'wood');
        }
      }
    } else if (kind === 'lab') {
      // computer lab: 4 rows of benches with monitors and chairs, whiteboard at the front
      bx(B('paint'), sm - 1.6, sm + 1.6, front + dir * 0.01, front + dir * 0.04, fy + 0.9, fy + 2.1, col('#f6f6f3'));
      bx(B('metal'), sm - 1.65, sm + 1.65, front + dir * 0.01, front + dir * 0.03, fy + 0.87, fy + 2.13, col('#9ea3a8'));
      const len = Math.min(3.6, s1 - s0 - 3.6);
      for (let r = 0; r < 4; r++) {
        const k0 = 1.9 + r * 2.35;
        const a = sm - len / 2, b = sm + len / 2;
        bx(B('wood'), a, b, Math.min(at(k0), at(k0 + 0.75)), Math.max(at(k0), at(k0 + 0.75)), fy + 0.72, fy + 0.76, col('#d9d4c8'));
        bx(B('metal'), a + 0.05, b - 0.05, Math.min(at(k0 + 0.05), at(k0 + 0.7)), Math.max(at(k0 + 0.05), at(k0 + 0.7)), fy, fy + 0.72, col('#8a8e93'));
        solid(col_, a, b, at(k0), at(k0 + 0.75), fy, fy + 0.76, 'prop', 'metal');
        for (let s = a + 0.45; s < b - 0.3; s += 0.9) {
          bx(B('dark'), s - 0.28, s + 0.28, Math.min(at(k0 + 0.2), at(k0 + 0.24)), Math.max(at(k0 + 0.2), at(k0 + 0.24)), fy + 0.86, fy + 1.2, C.screen);
          bx(B('lamp'), s - 0.25, s + 0.25, Math.min(at(k0 + 0.245), at(k0 + 0.25)), Math.max(at(k0 + 0.245), at(k0 + 0.25)), fy + 0.89, fy + 1.17, col('#3a5f8a'));
          bx(B('dark'), s - 0.04, s + 0.04, Math.min(at(k0 + 0.15), at(k0 + 0.2)), Math.max(at(k0 + 0.15), at(k0 + 0.2)), fy + 0.76, fy + 0.86, C.screen);
          bx(B('dark'), s - 0.22, s + 0.22, Math.min(at(k0 + 0.35), at(k0 + 0.5)), Math.max(at(k0 + 0.35), at(k0 + 0.5)), fy + 0.76, fy + 0.78, C.screen);
          // chair
          bx(B('dark'), s - 0.24, s + 0.24, Math.min(at(k0 + 0.95), at(k0 + 1.4)), Math.max(at(k0 + 0.95), at(k0 + 1.4)), fy + 0.44, fy + 0.5, C.chair);
          bx(B('dark'), s - 0.22, s + 0.22, Math.min(at(k0 + 1.35), at(k0 + 1.4)), Math.max(at(k0 + 1.35), at(k0 + 1.4)), fy + 0.5, fy + 0.95, C.chair);
          bx(B('metal'), s - 0.03, s + 0.03, Math.min(at(k0 + 1.15), at(k0 + 1.2)), Math.max(at(k0 + 1.15), at(k0 + 1.2)), fy, fy + 0.44, C.legs);
        }
      }
      for (const s of [sm - 1.2, sm + 1.2]) for (const k of [3.2, 7.6]) bx(B('lamp'), s - 0.3, s + 0.3, Math.min(at(k), at(k + 0.6)), Math.max(at(k), at(k + 0.6)), cy - 0.02, cy, C.white);
    } else {
      // CSE department office: service counter across the room, desks with monitors, steel cupboards
      // (the 1.9 m gap at the outer wall lets staff, and zombies, round the counter)
      const kc = 3.0, w = Math.abs(s1 - s0);
      bx(B('plaster'), u(1.9), u(w), Math.min(at(kc), at(kc + 0.6)), Math.max(at(kc), at(kc + 0.6)), fy, fy + 1.05, col('#f0eee8'));
      bx(B('wood'), u(1.85), u(w), Math.min(at(kc - 0.05), at(kc + 0.65)), Math.max(at(kc - 0.05), at(kc + 0.65)), fy + 1.05, fy + 1.1, C.timberDark);
      solid(col_, u(1.85), u(w), at(kc - 0.05), at(kc + 0.65), fy, fy + 1.1, 'prop', 'wood');
      for (const [x, k] of [[3.0, 5.2], [5.4, 5.2], [3.0, 7.9], [5.4, 7.9]] as V2[]) {
        const s = u(x);
        bx(B('wood'), s - 0.8, s + 0.8, Math.min(at(k), at(k + 0.8)), Math.max(at(k), at(k + 0.8)), fy + 0.72, fy + 0.76, C.desk);
        bx(B('metal'), s - 0.75, s + 0.75, Math.min(at(k + 0.05), at(k + 0.75)), Math.max(at(k + 0.05), at(k + 0.75)), fy, fy + 0.72, col('#8a8e93'));
        solid(col_, s - 0.8, s + 0.8, at(k), at(k + 0.8), fy, fy + 0.76, 'prop', 'wood');
        bx(B('dark'), s - 0.28, s + 0.28, Math.min(at(k + 0.15), at(k + 0.2)), Math.max(at(k + 0.15), at(k + 0.2)), fy + 0.86, fy + 1.2, C.screen);
        bx(B('dark'), s - 0.24, s + 0.24, Math.min(at(k + 1.0), at(k + 1.45)), Math.max(at(k + 1.0), at(k + 1.45)), fy + 0.44, fy + 0.5, C.chair);
      }
      for (let k = 4.6; k < 9.8; k += 1.0) bx(B('metal'), u(0.02), u(0.52), Math.min(at(k), at(k + 0.95)), Math.max(at(k), at(k + 0.95)), fy, fy + 1.9, col('#b8bcc0'));
      solid(col_, u(0), u(0.55), at(4.6), at(9.85), fy, fy + 1.9, 'be:cupboard', 'metal');
    }
  }

  // ============================================================ assemble: one mesh per material in a distance-culled LOD
  const lamp = lampMaterial();
  const decalMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const group = new THREE.Group();
  group.name = 'be:interior';
  for (const [k, b] of bufs) {
    if (!b.vertexCount) continue;
    const mat = k === 'lamp' ? lamp : k === 'decal' ? decalMat : kit.material(k);
    const m = new THREE.Mesh(b.toGeometry(), mat);
    m.castShadow = false; m.receiveShadow = k !== 'lamp'; m.matrixAutoUpdate = false; m.updateMatrix();
    m.name = `be:int:${k}`;
    group.add(m);
  }
  const lc = P(0, 16);
  const lod = new THREE.LOD();
  lod.name = 'be:interiorLOD';
  lod.position.set(lc[0], 0, lc[1]);
  group.position.set(-lc[0], 0, -lc[1]);
  lod.addLevel(group, 0);
  const far = new THREE.Object3D();
  lod.addLevel(far, 75);
  kit.group.add(lod);
  // see-through glazing (entrance wall + hall windows), always drawn: one transparent mesh
  if (glass.vertexCount && beGlassMat) {
    const gm = new THREE.Mesh(glass.toGeometry(), beGlassMat);
    gm.name = 'be:glass'; gm.renderOrder = 1; gm.matrixAutoUpdate = false; gm.updateMatrix();
    kit.group.add(gm);
  }
}

/** Black railing (posts every ~1.2 m, top rail + 3 bars) along a straight line on a floor. */
function railVisual(b: GeoBuffer, sa: number, da: number, sb: number, db: number, fy: number): void {
  const along = Math.abs(sb - sa) > Math.abs(db - da);
  const len = along ? Math.abs(sb - sa) : Math.abs(db - da);
  const n = Math.max(1, Math.round(len / 1.2));
  const [s0, s1] = [Math.min(sa, sb), Math.max(sa, sb)], [d0, d1] = [Math.min(da, db), Math.max(da, db)];
  const k = 0.025;
  for (const [y, t] of [[fy + 1.05, 0.05], [fy + 0.8, 0.02], [fy + 0.55, 0.02], [fy + 0.3, 0.02]]) {
    if (along) bx(b, s0, s1, da - t / 2, da + t / 2, y, y + t, C.black); else bx(b, sa - t / 2, sa + t / 2, d0, d1, y, y + t, C.black);
  }
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const s = along ? s0 + (s1 - s0) * f : sa, d = along ? da : d0 + (d1 - d0) * f;
    bx(b, s - k, s + k, d - k, d + k, fy, fy + 1.1, C.black);
  }
}

/** Sloped handrail + posts along a flight edge (cross position `at`). */
function sloped(b: GeoBuffer, lo: number, hi: number, at: number, y0: number, y1: number): void {
  b.beam(P3at(at, lo, y0 + 1.0), P3at(at, hi, y1 + 1.0), 0.05, 0.05, C.black);
  b.beam(P3at(at, lo, y0 + 0.55), P3at(at, hi, y1 + 0.55), 0.02, 0.02, C.black);
  const n = Math.max(2, Math.round(Math.abs(hi - lo) / 1.4));
  for (let i = 0; i <= n; i++) {
    const d = lo + ((hi - lo) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    bx(b, at - 0.025, at + 0.025, d - 0.025, d + 0.025, y, y + 1.0, C.black);
  }
}
