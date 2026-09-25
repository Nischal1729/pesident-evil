import * as THREE from 'three';
import { addLedgesAt } from './buildings';
import { hash2, normalizeWinding } from './geom';
import { buildGround } from './gjb/ground';
import { buildGjbInteriors } from './gjb/interiors';
import { buildParking } from './gjb/parking';
import { raisedPlanter, segPoly } from './gjb/util';
import { col, type WorldKit } from './kit';
import { hedgeBox, sapling } from './landscape';
import {
  BUILDINGS, COVERED_PLAZA, DRIVE_THROUGH, driveFootpathZ, driveNorthZ, GJB_ARCADE_TOP, GJB_G, GJB_GALLERY, GJB_L1, GJB_L1_FLOORS, gjbcEastX, pesRdZ,
  plazaParapetZ, QUAD, type V2,
} from './layout';
import type { SignUVs } from './signs';
import { worldUniforms } from './materials';

/**
 * Golden Jubilee Block (GJBC) detail. Level structure (reference/GJB_NOTES.md §1): PES University Rd, the drive-through,
 * the east forecourt/promenade and the enterable lobbies are on the ground floor (y = 0); the Quad, its colonnades, the
 * covered plaza, the inner court and the north-east porch over the drive-through are on the 1st floor (GJB_L1), on a
 * solid podium. The front ramp from the east plaza lands on L1 (landmarks.ts buildPesBridge).
 * The wing prisms themselves are regular BUILDINGS entries (arcade strips start at the L1 colonnade soffit → walkable).
 */
const WHITE_GRANITE = col('#d9d9d5');
const DARK_GRANITE = col('#3a3c3e');
const CREAM = col('#ede7da');
const YELLOW_WOOD = col('#d9a441');
const SLATE = col('#6e7f8e');
const CHARCOAL = col('#44484e');
const TERRACOTTA = col('#7f4432');
const PLANTER_GREY = col('#55595e');
const BAND = col('#3e4143');
const L1 = GJB_L1;

export function buildGJBC(kit: WorldKit, signs: SignUVs): void {
  podium(kit);
  quad(kit, signs);
  coveredPlaza(kit, signs);
  nePorch(kit, signs);
  driveThrough(kit);
  eastFacade(kit, signs);
  northArcade(kit);
  lawTerrace(kit, signs);
  fascia(kit);
  libraryDetails(kit);
  buildGjbInteriors(kit);
  buildParking(kit);
}

// ------------------------------------------------------------------------------------------------ L1 podium
/**
 * The podium under everything on L1: its solids and the enterable ground-floor wing (gjb/ground.ts), the L1 granite
 * floors, and every face of it that shows at ground level.
 */
function podium(kit: WorldKit): void {
  buildGround(kit);
  for (const f of GJB_L1_FLOORS) {
    const c = f.poly.reduce((s, p) => [s[0] + p[0] / f.poly.length, s[1] + p[1] / f.poly.length], [0, 0]);
    kit.buf('polished', c[0], c[1]).flatPoly(f.poly, L1 + 0.045, col('#aeafab'), 2);
  }
  const nf = plazaParapetZ, B = GJB_G.corridorB;
  // north face along PES Univ Rd (under the covered plaza's L1 edge): white wall, dark slot windows, granite skirting,
  // red fire cabinets and AC louvre grilles, the same treatment as the drive-through wall it continues (old tour 0540;
  // service face with louvres: 2021 tour SmHnHHxbpaE 19:36). The glass door at corridor B leads into the wing.
  groundFace(kit, [[20, nf(20)], [38, nf(38)], [55, nf(55)]], 'north', [B[0], B[2]]);
  // under the NE porch, where the podium meets the east wing across the drive-through: the same wall up to the deck
  groundFace(kit, [[55, nf(55)], [59, driveFootpathZ(59)]], 'porch');
  // the short west face under the north arcade, between the north wing's corner and the plaza's north-west corner
  groundFace(kit, [[20, -106.6], [20, nf(20)]], 'stub');
  // south face of the L1 inner court, towards Pie R Cube: glazed ground floor + glass balustrade on L1
  groundFace(kit, [[18.6, 17.25], [-8, 17.6]], 'south');
}

/**
 * Ground-floor face of the podium along a polyline (the podium on the left-hand side of a→b), plus the L1 edge on top.
 * 'north' (road side, optional door x-range), 'porch' (under the NE porch deck: wall only, up to the deck soffit),
 * 'stub' (wall + a plain parapet on L1), 'south' (glazed, glass balustrade on L1).
 */
function groundFace(kit: WorldKit, line: V2[], kind: 'north' | 'porch' | 'stub' | 'south', door?: [number, number]): void {
  const wall = col('#ebe7de');
  const lerp = (a: V2, b: V2, f: number): V2 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const wallTop = kind === 'porch' ? DRIVE_THROUGH.clear : L1 - 0.65;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // wall runs, split round the door if it falls in this segment
    const runs: [V2, V2][] = [];
    let dA: V2 | null = null, dB: V2 | null = null;
    if (door && door[0] > Math.min(a[0], b[0]) && door[1] < Math.max(a[0], b[0])) {
      dA = lerp(a, b, (door[0] - a[0]) / (b[0] - a[0]));
      dB = lerp(a, b, (door[1] - a[0]) / (b[0] - a[0]));
      runs.push([a, dA], [dB, b]);
    } else runs.push([a, b]);
    for (const [p, q] of runs) {
      const rl = Math.hypot(q[0] - p[0], q[1] - p[1]);
      kit.segBox('polished', p, q, 0, 0.6, 0.36, col('#2f3133'), 0.15, 0, 0.5);
      kit.segBox('plaster', p, q, 0.6, wallTop, 0.3, wall, kind === 'south' ? 0.3 : 0.15, 0, 0.5);
      if (kind === 'south') {
        kit.segBox('glass', p, q, 0.6, L1 - 1.3, 0.06, col('#33414c'), 0.12);
        const n = Math.floor(rl / 2);
        for (let k = 0; k <= n; k++) {
          const c = lerp(p, q, k / n);
          kit.box('polished', c[0], (L1 - 0.65) / 2, c[1] - 0.25, 0.7, L1 - 0.65, 0.7, 0, col('#b9b7b1'), 0.5);
        }
        continue;
      }
      if (kind === 'stub') continue;
      // dark slot windows with mullions, fire cabinets; AC louvre grilles on the long road runs
      kit.segBox('glass', p, q, 1.0, 2.3, 0.06, col('#2c3740'), -0.02);
      const n = Math.floor(rl / 1.5);
      for (let k = 1; k < n; k++) {
        const c = lerp(p, q, k / n);
        kit.segBox('metal', [c[0] - 0.04, c[1]], [c[0] + 0.04, c[1]], 1.0, 2.3, 0.1, col('#2b2f33'), -0.03);
        if (k % 6 === 3) kit.box('stone', c[0], 1.0, c[1] + 0.05, 0.55, 0.9, 0.12, 0, col('#c1261c'));
      }
      if (kind === 'north' && rl > 10) {
        for (let f = 0.25; f < 1; f += 0.5) {
          const c0 = lerp(p, q, f - 2.2 / rl), c1 = lerp(p, q, f + 2.2 / rl);
          kit.segBox('metal', c0, c1, 2.85, 4.65, 0.08, col('#e3e1dc'), -0.03);
          for (let y = 2.95; y < 4.55; y += 0.16) kit.segBox('metal', c0, c1, y, y + 0.05, 0.1, col('#9da2a6'), -0.07);
        }
      }
    }
    if (dA && dB) {
      // road door into the ground-floor wing: wall over the opening, a small canopy, a navy name plate
      kit.segBox('plaster', dA, dB, 2.6, wallTop, 0.3, wall, 0.15, 0, 0.5);
      kit.segBox('stone', dA, dB, 2.72, 2.86, 1.3, col('#e8e2d5'), -0.5, 0.6);
      const m = lerp(dA, dB, 0.5);
      kit.box('plaster', m[0], 3.35, m[1] - 0.03, 1.6, 0.36, 0.06, Math.atan2(-(dB[1] - dA[1]), dB[0] - dA[0]), col('#1f2b45'));
      kit.collision.addPolygon(segPoly(dA, dB, 0.3, 0.15), L1 - GJB_G.slab - 2.6, 'concrete', 'wall', 2.6);
    }
    if (kind === 'porch') continue;
    kit.segBox('stone', a, b, L1 - 0.65, L1 + 0.08, 0.5, CHARCOAL, 0.22);
    if (kind === 'north') {
      // L1 planter parapet + dense hedge (Heliconia / peace lily) on the covered-plaza edge
      kit.segBox('stone', a, b, L1, L1 + 0.95, 1.3, PLANTER_GREY, 0.65, 0.02);
      kit.segBox('stone', a, b, L1 + 0.95, L1 + 1.05, 1.45, col('#2c2e30'), 0.65, 0.02);
      const segN = Math.max(1, Math.round(len / 2));
      for (let k = 0; k < segN; k++) {
        const pa = lerp(a, b, k / segN), pb = lerp(a, b, (k + 1) / segN);
        hedgeBox(kit, 'hedge', [pa[0], pa[1] + 0.65], [pb[0], pb[1] + 0.65], L1 + 1.0, L1 + 1.85, 1.1);
      }
      kit.collision.addPolygon(segPoly(a, b, 1.3, 0.65), 1.1, 'concrete', 'parapet', L1);
    } else if (kind === 'stub') {
      kit.segBox('plaster', a, b, L1 + 0.08, L1 + 1.1, 0.3, wall, 0.15, 0.3);
      kit.segBox('stone', a, b, L1 + 1.1, L1 + 1.18, 0.4, col('#2c2e30'), 0.15, 0.3);
      kit.collision.addPolygon(segPoly(a, b, 0.3, 0.15), 1.1, 'concrete', 'parapet', L1);
    } else {
      kit.segBox('glass', a, b, L1 + 0.1, L1 + 1.1, 0.04, col('#6f8290'), 0.4);
      kit.segBox('metal', a, b, L1 + 1.1, L1 + 1.16, 0.08, col('#9aa0a6'), 0.4);
      kit.collision.addPolygon(segPoly(a, b, 0.3, 0.4), 1.1, 'concrete', 'parapet', L1);
    }
  }
}

// ------------------------------------------------------------------------------------------------ the Quad (on L1)
function quad(kit: WorldKit, signs: SignUVs): void {
  const Q = QUAD;
  const y0 = Q.floorY;
  const polished = (x: number, z: number) => kit.buf('polished', x, z);
  // floor pattern (tour frames key_1150, key_0606, uxqjCJBCP_g 11:33): a checkerboard strip of dark and light granite
  // squares down the axis between thin dark borders, and wide dark bands across the Quad every 15 m
  const y = y0 + 0.052;
  const midX = (Q.minX + Q.maxX) / 2, cs = 4, cz0 = Q.minZ + 1.5, rows = Math.floor((Q.maxZ - Q.minZ - 3) / cs);
  const rect4 = (x0: number, z0: number, x1: number, z1: number): V2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (let r = 0; r < rows; r++) {
    const z = cz0 + r * cs, x = r % 2 ? midX : midX - cs;
    polished(x + cs / 2, z + cs / 2).flatPoly(rect4(x, z, x + cs, z + cs), y + 0.002, BAND, 2);
  }
  for (const bx of [midX - cs - 0.35, midX + cs + 0.05]) polished(bx, -55).flatPoly(rect4(bx, cz0, bx + 0.3, cz0 + rows * cs), y + 0.002, BAND, 2);
  for (let z = Q.minZ + 7.5; z < Q.maxZ; z += 15) {
    for (const [x0, x1] of [[Q.minX + 2.2, midX - cs - 0.35], [midX + cs + 0.35, Q.maxX - 2.2]]) polished((x0 + x1) / 2, z).flatPoly(rect4(x0, z - 0.7, x1, z + 0.7), y, BAND, 2);
  }
  // arcade step lip along both column lines
  for (const x of [Q.minX + 0.45, Q.maxX - 0.45]) kit.box('polished', x, y0 + 0.08, (Q.minZ + Q.maxZ) / 2, 1.6, 0.16, Q.maxZ - Q.minZ, 0, col('#b9bab6'), 0.5);
  // double-height colonnades on L1: white granite shafts on dark granite bases, blue banners on every 2nd column
  const n = Math.round((Q.maxZ - Q.minZ) / Q.colSpacing);
  const shaftH = Q.colHeight - 1.2 - 0.4;
  for (const [x, face] of [[Q.minX + 0.45, 1], [Q.maxX - 0.45, -1]] as [number, number][]) {
    for (let k = 0; k < n; k++) {
      const z = Q.minZ + Q.colSpacing / 2 + k * Q.colSpacing;
      kit.box('polished', x, y0 + 0.6, z, 1.02, 1.2, 1.02, 0, DARK_GRANITE, 0.5);
      kit.box('polished', x, y0 + 1.2 + shaftH / 2, z, Q.colSize, shaftH, Q.colSize, 0, WHITE_GRANITE, 0.5);
      kit.box('stone', x, y0 + Q.colHeight - 0.2, z, 1.0, 0.4, 1.0, 0, col('#e2e0da'));
      kit.collision.addCircle(x, z, 0.62, Q.colHeight, 'concrete', 'column', y0);
      if (k % 2 === 0) kit.signQuad(signs.quadBanner[k % 3], x + face * (Q.colSize / 2 + 0.03), y0 + 4.6, z, 0.78, 2.6, face, 0, false);
      else {
        // small wall-mounted light on the Quad face of the column
        kit.box('emissive', x + face * (Q.colSize / 2 + 0.06), y0 + 3.4, z, 0.12, 0.3, 0.18, 0, col('#ffffff'));
        if (k % 4 === 1) kit.lampPoints.push(new THREE.Vector3(x + face * 1.2, y0 + 3.4, z));
      }
    }
  }
  // the thick white beam on top of the columns carries an open gallery in front of the set-back upper floors (layout.ts
  // GJB_GALLERY), behind a dark perforated-metal railing (key_1150; uxqjCJBCP_g 11:33): slab, terracotta soffit, rail
  const gz = (Q.minZ + Q.maxZ) / 2, gl = Q.maxZ - Q.minZ, gY = GJB_ARCADE_TOP, gw = GJB_GALLERY + 0.25;
  for (const [x, face] of [[Q.minX, 1], [Q.maxX, -1]] as [number, number][]) {
    const xc = x + face * (0.25 - gw / 2);
    kit.box('stone', xc, gY + 0.45, gz, gw, 0.9, gl, 0, col('#e6e0d2'));
    kit.box('stone', xc, gY - 0.01, gz, gw - 0.02, 0.02, gl, 0, col('#8a4a36'));
    kit.collision.addPolygon(rect4(Math.min(xc - gw / 2, xc + gw / 2), Q.minZ, Math.max(xc - gw / 2, xc + gw / 2), Q.maxZ), 0.9, 'concrete', 'gallery', gY);
    const rx = x + face * 0.2;
    kit.box('metal', rx, gY + 1.45, gz, 0.05, 1.1, gl, 0, col('#34383c'));
    for (let z = Q.minZ + 0.2; z < Q.maxZ; z += 1.5) kit.box('metal', rx - face * 0.05, gY + 1.45, z, 0.06, 1.1, 0.06, 0, col('#26292c'));
    kit.box('metal', rx, gY + 2.03, gz, 0.1, 0.06, gl, 0, col('#9aa0a6'));
    kit.collision.addPolygon(rect4(rx - 0.05, Q.minZ, rx + 0.05, Q.maxZ), 1.15, 'metal', 'parapet', gY + 0.9);
  }
  // black cube planters with fiddle-leaf figs / palms in one row beside the checkerboard strip, 5 m apart
  for (let z = Q.minZ + 5; z <= Q.maxZ - 5; z += 5) raisedPlanter(kit, midX + cs + 1.3, z, 0.85, y0);
  // south end: glass gallery bridge above the 2-storey dark base
  kit.box('glass', (Q.minX + Q.maxX) / 2, y0 + 10.8, -12.6, Q.maxX - Q.minX + 4, 3.4, 3.8, 0, col('#50626f'));
  kit.box('stone', (Q.minX + Q.maxX) / 2, y0 + 12.65, -12.6, Q.maxX - Q.minX + 4.4, 0.3, 4.2, 0, col('#e6e0d2'));
  kit.box('stone', (Q.minX + Q.maxX) / 2, y0 + 9.0, -12.6, Q.maxX - Q.minX + 4.4, 0.35, 4.2, 0, col('#e6e0d2'));
  // the inner court (L1, south-west of the Quad): a few planters + a granite bench block
  for (const [x, z] of [[-2, -8], [8, -8], [-2, 6], [8, 6]] as V2[]) raisedPlanter(kit, x, z, 0.85, y0);
  kit.box('polished', 3, y0 + 0.23, -1, 2.4, 0.45, 0.5, 0, col('#8e8e8b'), 0.5);
}

// ------------------------------------------------------------------------------------------------ covered plaza (on L1)
function coveredPlaza(kit: WorldKit, signs: SignUVs): void {
  const P = COVERED_PLAZA;
  const y0 = L1;
  const roofY = P.roofY;
  // yellow-wood clad columns with dark grey bases
  const colsX = [26.5, 34, 41.5, 49];
  const colsZ = [-97.5, -103.8];
  for (const x of colsX) for (const z of colsZ) {
    if (z < plazaParapetZ(x) + P.pergolaDepth + 0.8) continue;
    kit.box('stone', x, y0 + 0.55, z, 1.34, 1.1, 1.34, 0, col('#4a4f55'));
    kit.box('wood', x, (y0 + 1.1 + roofY) / 2, z, 1.2, roofY - y0 - 1.1, 1.2, 0, YELLOW_WOOD, 0.4);
    kit.collision.addCircle(x, z, 0.8, roofY - y0, 'wood', 'column', y0);
  }
  // slate-grey steel beams under the roof slab
  const zS = P.southZ, zN = (x: number) => plazaParapetZ(x) + P.pergolaDepth;
  for (const x of [P.minX + 0.4, ...colsX, P.maxX - 0.4]) kit.buf('metal', x, -100).beam([x, roofY - 0.45, zN(x)], [x, roofY - 0.45, zS], 0.5, 0.9, SLATE);
  for (const z of colsZ) kit.box('metal', (P.minX + P.maxX) / 2, roofY - 0.45, z, P.maxX - P.minX, 0.9, 0.5, 0, SLATE);
  kit.buf('metal', 37, -95).beam([P.minX, roofY - 0.6, zS], [P.maxX, roofY - 0.6, zS], 0.6, 1.2, col('#3f454c'));
  // open-sky steel pergola over the north strip: portal frames with knee braces standing on L1
  const pergY = y0 + 7.2;
  const frameXs: number[] = [];
  for (let x = P.minX + 3; x <= P.maxX - 2; x += 6.5) frameXs.push(x);
  const pb = kit.buf('metal', 37, -108);
  for (const x of frameXs) {
    const zp = plazaParapetZ(x) + 1.7, zr = zN(x);
    pb.beam([x, y0, zp], [x, pergY, zp], 0.5, 0.5, SLATE);
    pb.beam([x, pergY, zp - 0.4], [x, pergY, zr + 0.5], 0.5, 0.7, SLATE);
    pb.beam([x, pergY - 1.6, zp], [x, pergY - 0.2, zp + 1.5], 0.25, 0.25, SLATE);
    kit.collision.addCircle(x, zp, 0.36, pergY - y0, 'metal', 'pergola', y0);
  }
  for (const f of [0, 0.5, 1]) {
    const pts: [number, number, number][] = frameXs.map((x) => [x, pergY + 0.35, plazaParapetZ(x) + 1.7 + f * (zN(x) - plazaParapetZ(x) - 2.2)]);
    for (let i = 1; i < pts.length; i++) pb.beam(pts[i - 1], pts[i], 0.35, 0.45, SLATE);
  }
  // (the planter parapet + hedge along the pergola edge is part of the podium's north face, see podium())
  // paper cone-lamp clusters hanging under the roof
  const lamps = kit.instSet('coneLamp', () => {
    const g = new THREE.ConeGeometry(0.26, 0.5, 9, 1, true).translate(0, -0.25, 0);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide, emissive: new THREE.Color(1, 0.85, 0.62), emissiveIntensity: 0 });
    kit.updatables.push(() => { m.emissiveIntensity = 0.1 + worldUniforms.uNight.value * 1.4; });
    return { geo: g, mat: m, cast: false, colored: true };
  });
  const white = col('#f2eee6'), tan = col('#b07a45');
  for (const [cx, cz] of [[30, -99.5], [38, -101.5], [46, -99.5]] as V2[]) {
    kit.lampPoints.push(new THREE.Vector3(cx, y0 + 6.5, cz));
    for (let i = 0; i < 36; i++) {
      const h1 = hash2(cx * 13 + i * 7.1, cz * 3 + i * 1.3), h2 = hash2(i * 3.7 + cx, cz * 1.9 - i);
      const a = h1 * Math.PI * 2, rr = Math.sqrt(h2) * 3.2;
      const y = y0 + 8.6 - h2 * 2.6 - (1 - rr / 3.2) * 0.8;
      kit.addInst(lamps, new THREE.Vector3(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr), a, 0.8 + h1 * 0.5, h2 > 0.62 ? tan : white);
      kit.buf('metal', cx, cz).beam([cx + Math.cos(a) * rr, roofY - 0.9, cz + Math.sin(a) * rr], [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr], 0.012, 0.012, col('#222'));
    }
  }
  // "PEOPLES EDUCATION SOCIETY" glass entrance on the west wall (north wing east face, x = 20)
  kit.box('glass', P.minX + 0.08, y0 + 2.6, -100.5, 0.12, 5.2, 9, 0, col('#34424e'));
  kit.box('stone', P.minX + 0.2, y0 + 6.0, -100.5, 0.3, 1.4, 11, 0, col('#f2f1ec'));
  kit.signQuad(signs.pesSociety, P.minX + 0.37, y0 + 6.0, -100.5, 10.4, 0.98, 1, 0, true);
  for (let z = -104.5; z <= -96.5; z += 2) kit.box('metal', P.minX + 0.15, y0 + 2.6, z, 0.08, 5.2, 0.08, 0, col('#2b2f33'));
  // white granite reception desks with a maroon top (1000) and black steel waiting benches
  for (const [x, z] of [[31, -97.2], [44, -97.2]] as V2[]) {
    kit.box('polished', x, y0 + 0.5, z, 3.2, 1.0, 0.8, 0, col('#e3e1dc'), 0.5);
    kit.box('wood', x, y0 + 1.04, z, 3.3, 0.08, 0.9, 0, col('#6b2a26'));
    kit.collision.addPolygon([[x - 1.6, z - 0.4], [x + 1.6, z - 0.4], [x + 1.6, z + 0.4], [x - 1.6, z + 0.4]], 1.1, 'concrete', 'desk', y0);
  }
  // (the dark wall zone on the east side of the plaza is stair core S1, gjb/ground.ts)
}

// ------------------------------------------------------------------------------------------------ north-east porch (L1) over the drive-through
/**
 * The L1 porch over the drive-through: deck (top = L1, soffit = the drive-through ceiling), roof at L1 + 5.2, the
 * terracotta porte-cochère frame on the east face and planter parapets. The ramp landing joins it on the north
 * (x 79…84); from here you walk west into the covered plaza and south into the Quad. (GJB_NOTES §2)
 */
function nePorch(kit: WorldKit, signs: SignUVs): void {
  const D = DRIVE_THROUGH;
  const NO = driveNorthZ, FS = driveFootpathZ;
  const x0 = D.x0, x1 = D.x1;
  const deck: V2[] = [[x0, NO(x0)], [x1, NO(x1)], [x1, FS(x1)], [59, FS(59)], [x0, plazaParapetZ(x0)]];
  const cx = (x0 + x1) / 2, cz = NO(cx) + 6;
  // deck: granite top on L1 (continuing the covered plaza floor), dark grey soffit with downlights over the road (old tour
  // 0540), charcoal edge fascia
  kit.buf('polished', cx, cz).flatPoly(deck, L1 + 0.045, col('#aeafab'), 2);
  kit.buf('stone', cx, cz).flatPoly(deck, D.clear, col('#45484c'), 2, true);
  kit.segBox('stone', [x0, NO(x0)], [x1, NO(x1)], D.clear, L1 + 0.05, 0.35, CHARCOAL, -0.17);
  kit.segBox('stone', [x0, NO(x0)], [x0, plazaParapetZ(x0)], D.clear, L1 + 0.05, 0.35, CHARCOAL, 0.17);
  kit.collision.addPolygon(deck, L1 - D.clear, 'concrete', 'deck', D.clear);
  // porch roof slab at L1 + 5.2 (wood soffit, cream fascia)
  const rY = L1 + 5.2, rT = 0.7;
  const roof: V2[] = [[x0, NO(x0) - 0.3], [x1 + 0.6, NO(x1) - 0.3], [x1 + 0.6, FS(x1)], [59, FS(59)], [x0, plazaParapetZ(x0)]];
  kit.buf('stone', cx, cz).flatPoly(roof, rY + rT, col('#d9d4c8'), 4);
  kit.buf('wood', cx, cz).flatPoly(roof, rY, col('#6b4a36'), 2, true);
  kit.segBox('stone', roof[0], roof[1], rY, rY + rT, 0.3, col('#e8e2d5'), -0.15, 0.3);
  kit.segBox('stone', roof[0], roof[4], rY, rY + rT, 0.3, col('#e8e2d5'), 0.15, 0.3);
  kit.collision.addPolygon(roof, rT, 'concrete', 'porch_roof', rY);
  // granite-clad columns along the north kerb: ground (drive-through) + porch level, skipping the MRD loop-road mouth
  for (const x of [56.5, 63.5, 78.6, 83.2]) {
    const z = NO(x) + 0.65;
    kit.box('polished', x, D.clear / 2, z, 1.05, D.clear, 1.05, 0, col('#b9b7b1'), 0.5);
    kit.box('polished', x, (L1 + rY) / 2, z, 0.8, rY - L1, 0.8, 0, col('#b9b7b1'), 0.5);
    kit.collision.addCircle(x, z, 0.65, rY, 'concrete', 'column');
  }
  // planter parapet + lime shrubs along the north edge (open where the ramp landing joins, x ≥ 78.9) and the west edge
  const pa: V2 = [x0, NO(x0) + 0.6], pbN: V2 = [78.9, NO(78.9) + 0.6];
  kit.segBox('stone', pa, pbN, D.clear - 0.6, L1 + 1.1, 1.2, PLANTER_GREY);
  hedgeBox(kit, 'lime', pa, pbN, L1 + 1.1, L1 + 1.8, 1.0);
  kit.collision.addPolygon(segPoly(pa, pbN, 1.2), L1 + 1.1 - (D.clear - 0.6), 'concrete', 'parapet', D.clear - 0.6);
  const wa: V2 = [x0 + 0.6, NO(x0) + 1.2], wb: V2 = [x0 + 0.6, plazaParapetZ(x0) - 0.4];
  kit.segBox('stone', wa, wb, L1, L1 + 1.1, 1.0, PLANTER_GREY);
  hedgeBox(kit, 'lime', wa, wb, L1 + 1.1, L1 + 1.8, 0.8);
  kit.collision.addPolygon(segPoly(wa, wb, 1.0), 1.1, 'concrete', 'parapet', L1);
  // porte-cochère on the east face: terracotta picture frame around the L1 porch opening + grey planter band (the
  // L1 parapet, with the lime shrubs and the PES banner) spanning the drive-through mouth
  const x = x1;
  const zNo = NO(x) - 0.4, zSo = FS(x) + 1.0;
  const zc = (zNo + zSo) / 2, span = zSo - zNo;
  const fTop = rY + 1.6;
  kit.box('stone', x + 0.6, (rY + fTop) / 2, zc, 1.3, fTop - rY, span + 2.4, 0, TERRACOTTA);
  kit.box('stone', x + 0.6, (D.clear - 0.6 + fTop) / 2, zNo - 0.6, 1.3, fTop - D.clear + 0.6, 1.2, 0, TERRACOTTA);
  kit.box('stone', x + 0.6, (D.clear - 0.6 + fTop) / 2, zSo + 0.6, 1.3, fTop - D.clear + 0.6, 1.2, 0, TERRACOTTA);
  kit.box('stone', x + 0.8, (D.clear - 0.6 + L1 + 1.1) / 2, zc, 1.6, L1 + 1.1 - D.clear + 0.6, span, 0, PLANTER_GREY);
  kit.box('stone', x + 0.8, D.clear - 0.62, zc, 1.62, 0.06, span, 0, col('#3a3d40'));
  hedgeBox(kit, 'lime', [x + 0.8, zNo + 0.3], [x + 0.8, zSo - 0.3], L1 + 1.1, L1 + 1.9, 1.3);
  kit.signQuad(signs.porteBanner, x + 1.62, L1 - 0.1, zSo - 3.5, 5.6, 1.4, 1, 0, false);
  kit.collision.addPolygon([[x, zNo], [x + 1.6, zNo], [x + 1.6, zSo], [x, zSo]], L1 + 1.1 - (D.clear - 0.6), 'concrete', 'parapet', D.clear - 0.6);
  kit.collision.addPolygon([[x - 0.05, zNo - 1.2], [x + 1.25, zNo - 1.2], [x + 1.25, zNo], [x - 0.05, zNo]], fTop - D.clear + 0.6, 'concrete', 'frame', D.clear - 0.6);
  // a couple of black steel benches and planters on the porch
  for (const px of [62, 70]) raisedPlanter(kit, px, FS(px) - 1.6, 0.85, L1);
}

// ------------------------------------------------------------------------------------------------ drive-through (ground floor)
function driveThrough(kit: WorldKit): void {
  const D = DRIVE_THROUGH;
  // ceiling light strips under the porch deck
  for (let x = D.x0 + 3; x < D.x1 - 1; x += 5) {
    const z = pesRdZ(x);
    kit.box('emissive', x, D.clear - 0.04, z, 2.2, 0.06, 0.25, 0, col('#ffffff'));
    kit.box('emissive', x, D.clear - 0.04, z + 4.8, 1.2, 0.06, 0.2, 0, col('#ffffff'));
  }
  // red fire-extinguisher cabinets along the building wall
  for (let x = D.x0 + 6; x < D.x1 - 2; x += 9) {
    const z = driveFootpathZ(x) - 0.15;
    kit.box('stone', x, 1.0, z, 0.55, 0.9, 0.3, 0, col('#c1261c'));
  }
  // footpath kerb (building side)
  kit.segBox('stone', [D.x0, pesRdZ(D.x0) + 4.1], [D.x1, pesRdZ(D.x1) + 4.1], 0, 0.16, 0.3, col('#9c9c9a'));
}

// ------------------------------------------------------------------------------------------------ east facade (ground floor)
function eastFacade(kit: WorldKit, signs: SignUVs): void {
  const E = gjbcEastX;
  // slender 2-storey cream columns in front of the recessed dark glazing (z −116 … −60, not at the entrance)
  for (let z = -115.6; z <= -60.5; z += 4) {
    if (z > -87 && z < -73) continue;
    const x = E(z) - 0.32;
    kit.box('stone', x, 4.5, z, 0.62, 9, 0.62, 0, CREAM, 0.5);
    kit.collision.addCircle(x, z, 0.4, 9, 'concrete', 'column');
  }
  // tall fins in front of the dark curtain wall (z −60 … −10)
  for (let z = -58.5; z <= -11; z += 3) {
    const x = E(z) + 0.6;
    kit.box('stone', x, 13.2, z, 1.2, 26.4, 0.42, Math.atan2(-12, 161), CREAM, 0.5);
    kit.collision.addCircle(x, z, 0.5, 26, 'concrete', 'fin');
  }
  // plinth steps along the east face (visual only) + long black-granite planters with young trees
  for (let z0 = -116; z0 < -10; z0 += 10) {
    const z1 = Math.min(-10, z0 + 10);
    if (z0 >= -87 && z1 <= -73) continue;
    const a: V2 = [E(z0) + 0.9, z0], b: V2 = [E(z1) + 0.9, z1];
    kit.segBox('polished', a, b, 0, 0.15, 1.8, col('#a3a3a0'), 0, 0, 0.5);
    kit.segBox('polished', a, b, 0.15, 0.3, 1.0, col('#b0b0ad'), -0.4, 0, 0.5);
  }
  for (let z = -70; z <= -14; z += 12) {
    const x = E(z) + 2.6;
    const a: V2 = [x, z - 2.6], b: V2 = [E(z + 2.6) + 2.6, z + 2.6];
    kit.segBox('polished', a, b, 0, 0.62, 1.2, col('#1f2022'), 0, 0, 0.5);
    kit.collision.addSegment(a, b, 1.2, 0.62, 'concrete', 'planter');
    sapling(kit, x + 0.05, z, 'sapling', 0.85, false);
  }
  // east entrance: cream portal frame projecting from the colonnade round the ground-floor lobby and the two-storey
  // glazing of the L1 admission hall + L2 above it (key_0105), speckled granite steps; the lobby and the block above
  // it are enterable (gjb/interiors.ts, gjb/eastblock.ts)
  const zA = -86, zB = -74, pTop = GJB_ARCADE_TOP + 1.5;
  const xa = E(zA), xb = E(zB);
  for (const z of [zA, zB]) {
    const xx = E(z);
    kit.box('stone', xx + 1.2, pTop / 2, z, 3.6, pTop, 0.8, 0, CREAM);
    kit.collision.addPolygon([[xx - 0.6, z - 0.4], [xx + 3.0, z - 0.4], [xx + 3.0, z + 0.4], [xx - 0.6, z + 0.4]], pTop, 'concrete', 'portal');
  }
  kit.box('stone', (xa + xb) / 2 + 1.3, pTop - 0.75, (zA + zB) / 2, 3.4, 1.5, zB - zA + 0.8, Math.atan2(-12, 161), CREAM);
  for (let k = 0; k < 4; k++) kit.box('polished', (xa + xb) / 2 + 3.4 + k * 0.4, 0.07, (zA + zB) / 2, 0.4, 0.14 - k * 0.03, 11, Math.atan2(-12, 161), col('#9c9c9a'), 0.5);
  // hanging creeper at the entrance cheek walls
  hedgeBox(kit, 'hedge', [xa + 2.6, zA + 0.5], [xa + 2.6, zA + 1.2], 6, 9.5, 0.4);
  void signs;
}

// ------------------------------------------------------------------------------------------------ north arcade (road side)
function northArcade(kit: WorldKit): void {
  const line: V2[] = [[-8, -105.3], [9, -108], [20, -109.6]];
  // columns every 4 m along the outer line, granite clad, with a dark-green slatted fence between some bays
  let carry = 2;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const nx = -dz / len, nz = dx / len; // points into the building (winding of this polyline)
    for (let d = carry; d < len; d += 4) {
      const x = a[0] + (dx * d) / len + nx * 0.4, z = a[1] + (dz * d) / len + nz * 0.4;
      kit.box('polished', x, 4.5, z, 0.7, 9, 0.7, Math.atan2(-dz, dx), col('#b9b7b1'), 0.5);
      kit.collision.addCircle(x, z, 0.42, 9, 'concrete', 'column');
      carry = d + 4 - len;
    }
  }
}

// ------------------------------------------------------------------------------------------------ Faculty of Law terrace
function lawTerrace(kit: WorldKit, signs: SignUVs): void {
  const E = gjbcEastX;
  // big cream stone columns on the terrace edge (8 → 15.2 m) and a dark granite skirting band
  for (let z = -7; z <= 36; z += 6) {
    const x = E(z) - 0.7;
    kit.box('stone', x, 11.6, z, 1.0, 7.2, 1.0, 0, CREAM, 0.5);
    kit.box('polished', x, 8.25, z, 1.1, 0.5, 1.1, 0, DARK_GRANITE, 0.5);
  }
  kit.segBox('polished', [E(-10) + 0.02, -10], [E(38) + 0.02, 38], 7.6, 8.0, 0.1, DARK_GRANITE, 0.05);
  kit.segBox('polished', [E(-10), -10], [E(38), 38], 9.08, 9.2, 0.5, col('#1d1e20'), 0);
  // granite stair down to the promenade (runs north along the facade), between cream walls
  const x0 = E(-13) + 0.35, w = 3.2;
  const zTop = -10, zBot = -17.4, steps = 22;
  for (let k = 0; k < steps; k++) {
    const f = k / steps;
    const z = zTop - (zTop - zBot) * f - (zTop - zBot) / steps / 2;
    const h = 8 * (1 - f);
    kit.box('polished', x0 + w / 2, h / 2, z, w, h, (zTop - zBot) / steps + 0.01, 0, col('#9d9d9a'), 0.5);
  }
  for (const xs of [x0 - 0.2, x0 + w + 0.2]) {
    kit.segBox('stone', [xs, zBot], [xs, zTop], 0, 1.2, 0.4, CREAM);
    kit.buf('stone', xs, -13).beam([xs, 9.2, zTop], [xs, 1.2, zBot], 0.4, 0.4, CREAM);
  }
  kit.collision.addRamp([[x0 - 0.4, zBot], [x0 + w + 0.4, zBot], [x0 + w + 0.4, zTop], [x0 - 0.4, zTop]], [x0 + w / 2, zBot], [x0 + w / 2, zTop], 0, 8, 'concrete', 'stair');
  kit.signQuad(signs.lawSign, E(-10) - 1.2, 10.6, -10.05, 2.4, 0.68, 0, -1, true);
}

// ------------------------------------------------------------------------------------------------ charcoal fascia bands
function fascia(kit: WorldKit): void {
  for (const b of BUILDINGS) {
    if (b.style !== 'gjbc' || !b.id.startsWith('gjb')) continue;
    const base = b.base ?? 0;
    const top = b.top ?? (b.floorH ?? 4.4) * b.floors;
    const ys = [9.0, 17.8].filter((y) => y > base + 0.5 && y < top - 0.5);
    if (!ys.length) continue;
    const poly = b.poly;
    addLedgesAt(poly, ys.map((y) => y + 0.02), 0.22, 0.9, kit.buf('stone', poly[0][0], poly[0][1]), CHARCOAL, 3);
    // thin projecting roof slab at the top
    addLedgesAt(poly, [top + 0.05], 0.6, 0.25, kit.buf('stone', poly[0][0], poly[0][1]), col('#e8e2d5'), 3);
  }
  for (const b of BUILDINGS) {
    if (b.style !== 'gjbcQuad') continue;
    const top = b.top ?? (b.floorH ?? 4.4) * b.floors;
    addLedgesAt(b.poly, [top + 0.05], 0.5, 0.25, kit.buf('stone', b.poly[0][0], b.poly[0][1]), col('#e8e2d5'), 3);
  }
}

// ------------------------------------------------------------------------------------------------ library tower
function libraryDetails(kit: WorldKit): void {
  const lib = BUILDINGS.find((b) => b.id === 'gjb_library');
  if (!lib) return;
  // projecting glass bays on the north (road) face and the west face
  const p = normalizeWinding(lib.poly);
  const glass = col('#2e3a44');
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const nx = -dz / len, nz = dx / len;
    if (nz > -0.5 && nx > -0.5) continue; // only north- and west-facing edges
    for (const f of [0.28, 0.72]) {
      const cx = a[0] + dx * f + nx * 0.6, cz = a[1] + dz * f + nz * 0.6;
      kit.box('glass', cx, 24, cz, 5, 30, 1.2, Math.atan2(-dz, dx), glass);
      kit.box('stone', cx, 39.2, cz, 5.4, 0.4, 1.6, Math.atan2(-dz, dx), col('#eeece6'));
    }
  }
  // rooftop plant room
  kit.box('stone', -34, 43.6, -78, 14, 3, 10, 0, col('#e6e3dc'));
}
