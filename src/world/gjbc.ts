import * as THREE from 'three';
import { addLedgesAt } from './buildings';
import { hash2, normalizeWinding } from './geom';
import { col, type WorldKit } from './kit';
import { hedgeBox, planterCube, sapling } from './landscape';
import {
  BUILDINGS, COVERED_PLAZA, DRIVE_THROUGH, gjbcEastX, pesRdZ, plazaParapetZ, QUAD, type V2,
} from './layout';
import type { SignUVs } from './signs';
import { worldUniforms } from './materials';

/**
 * Golden Jubilee Block (GJBC) detail: the Quad colonnades + granite pattern, the covered plaza (yellow columns,
 * steel beams, pergola, hedge parapet, cone lamps), the drive-through columns + porte-cochère, the east
 * colonnade / fins / entrance portal, the north arcade, charcoal fascia bands and the Faculty of Law terrace.
 * The wing prisms themselves are regular BUILDINGS entries (arcade strips have base 9 m → walkable).
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

export function buildGJBC(kit: WorldKit, signs: SignUVs): void {
  quad(kit, signs);
  coveredPlaza(kit, signs);
  driveThrough(kit, signs);
  eastFacade(kit, signs);
  northArcade(kit);
  lawTerrace(kit, signs);
  fascia(kit);
  libraryDetails(kit);
}

// ------------------------------------------------------------------------------------------------ the Quad
function quad(kit: WorldKit, signs: SignUVs): void {
  const Q = QUAD;
  const polished = (x: number, z: number) => kit.buf('polished', x, z);
  // floor pattern: two longitudinal charcoal bands, transverse bands every 15 m with diamonds on the axis
  const y = 0.052;
  const midX = (Q.minX + Q.maxX) / 2;
  for (const bx of [midX - 6.5, midX + 6.5]) polished(bx, -55).flatPoly([[bx - 0.7, Q.minZ], [bx + 0.7, Q.minZ], [bx + 0.7, Q.maxZ], [bx - 0.7, Q.maxZ]], y, BAND, 2);
  for (let z = Q.minZ + 7.5; z < Q.maxZ; z += 15) {
    polished(midX, z).flatPoly([[Q.minX + 2.2, z - 0.7], [Q.maxX - 2.2, z - 0.7], [Q.maxX - 2.2, z + 0.7], [Q.minX + 2.2, z + 0.7]], y, BAND, 2);
    const d = 3.2;
    polished(midX, z).flatPoly([[midX, z - d], [midX + d, z], [midX, z + d], [midX - d, z]], y + 0.002, BAND, 2);
    polished(midX, z).flatPoly([[midX, z - d + 1], [midX + d - 1, z], [midX, z + d - 1], [midX - d + 1, z]], y + 0.004, col('#aeafab'), 2);
  }
  // arcade step lip along both column lines
  for (const x of [Q.minX + 0.45, Q.maxX - 0.45]) kit.box('polished', x, 0.08, (Q.minZ + Q.maxZ) / 2, 1.6, 0.16, Q.maxZ - Q.minZ, 0, col('#b9bab6'), 0.5);
  // double-height colonnades: white granite shafts on dark granite bases, blue banners on every 2nd column
  const n = Math.round((Q.maxZ - Q.minZ) / Q.colSpacing);
  for (const [x, face] of [[Q.minX + 0.45, 1], [Q.maxX - 0.45, -1]] as [number, number][]) {
    for (let k = 0; k < n; k++) {
      const z = Q.minZ + Q.colSpacing / 2 + k * Q.colSpacing;
      kit.box('polished', x, 0.6, z, 1.02, 1.2, 1.02, 0, DARK_GRANITE, 0.5);
      kit.box('polished', x, 5.1, z, Q.colSize, 7.8, Q.colSize, 0, WHITE_GRANITE, 0.5);
      kit.box('stone', x, 8.8, z, 1.0, 0.4, 1.0, 0, col('#e2e0da'));
      kit.collision.addCircle(x, z, 0.62, Q.colHeight, 'concrete', 'column');
      if (k % 2 === 0) kit.signQuad(signs.quadBanner[k % 3], x + face * (Q.colSize / 2 + 0.03), 5.0, z, 0.78, 2.6, face, 0, false);
      else {
        // small wall-mounted light on the Quad face of the column
        kit.box('emissive', x + face * (Q.colSize / 2 + 0.06), 3.4, z, 0.12, 0.3, 0.18, 0, col('#ffffff'));
        if (k % 4 === 1) kit.lampPoints.push(new THREE.Vector3(x + face * 1.2, 3.4, z));
      }
    }
  }
  // arcade beam line on top of the columns + continuous balcony (slab + glass railing) at +13.2 m
  for (const [x, face] of [[Q.minX, 1], [Q.maxX, -1]] as [number, number][]) {
    kit.box('stone', x + face * 0.1, 9.45, (Q.minZ + Q.maxZ) / 2, 0.5, 0.9, Q.maxZ - Q.minZ, 0, col('#e6e0d2'));
    kit.box('stone', x + face * 0.6, 13.1, (Q.minZ + Q.maxZ) / 2, 1.2, 0.22, Q.maxZ - Q.minZ, 0, col('#e8e2d4'));
    kit.box('glass', x + face * 1.15, 13.75, (Q.minZ + Q.maxZ) / 2, 0.04, 1.05, Q.maxZ - Q.minZ, 0, col('#6f8290'));
    kit.box('metal', x + face * 1.15, 14.3, (Q.minZ + Q.maxZ) / 2, 0.08, 0.06, Q.maxZ - Q.minZ, 0, col('#9aa0a6'));
  }
  // black cube planters with cycads, 5 m apart along each colonnade edge (kept clear of the station spots)
  for (const x of [Q.minX + 3.2, Q.maxX - 3.2]) {
    for (let z = Q.minZ + 5; z <= Q.maxZ - 5; z += 5) planterCube(kit, x, z, 0.85);
  }
  // south end: glass gallery bridge above the 2-storey dark base
  kit.box('glass', (Q.minX + Q.maxX) / 2, 10.8, -12.6, Q.maxX - Q.minX + 4, 3.4, 3.8, 0, col('#50626f'));
  kit.box('stone', (Q.minX + Q.maxX) / 2, 12.65, -12.6, Q.maxX - Q.minX + 4.4, 0.3, 4.2, 0, col('#e6e0d2'));
  kit.box('stone', (Q.minX + Q.maxX) / 2, 9.0, -12.6, Q.maxX - Q.minX + 4.4, 0.35, 4.2, 0, col('#e6e0d2'));
}

// ------------------------------------------------------------------------------------------------ covered plaza
function coveredPlaza(kit: WorldKit, signs: SignUVs): void {
  const P = COVERED_PLAZA;
  const roofY = P.roofY;
  // yellow-wood clad columns with dark grey bases
  const colsX = [26.5, 34, 41.5, 49];
  const colsZ = [-97.5, -103.8];
  for (const x of colsX) for (const z of colsZ) {
    if (z < plazaParapetZ(x) + P.pergolaDepth + 0.8) continue;
    kit.box('stone', x, 0.55, z, 1.34, 1.1, 1.34, 0, col('#4a4f55'));
    kit.box('wood', x, 0.55 + (roofY - 1.1) / 2 + 0.55, z, 1.2, roofY - 1.1, 1.2, 0, YELLOW_WOOD, 0.4);
    kit.collision.addCircle(x, z, 0.8, roofY, 'wood', 'column');
  }
  // slate-grey steel beams under the roof slab
  const zS = P.southZ, zN = (x: number) => plazaParapetZ(x) + P.pergolaDepth;
  for (const x of [P.minX + 0.4, ...colsX, P.maxX - 0.4]) kit.buf('metal', x, -100).beam([x, roofY - 0.45, zN(x)], [x, roofY - 0.45, zS], 0.5, 0.9, SLATE);
  for (const z of colsZ) kit.box('metal', (P.minX + P.maxX) / 2, roofY - 0.45, z, P.maxX - P.minX, 0.9, 0.5, 0, SLATE);
  kit.buf('metal', 37, -95).beam([P.minX, roofY - 0.6, zS], [P.maxX, roofY - 0.6, zS], 0.6, 1.2, col('#3f454c'));
  // open-sky steel pergola: portal frames with knee braces over the north strip
  const pergY = 7.2;
  const frameXs: number[] = [];
  for (let x = P.minX + 3; x <= P.maxX - 2; x += 6.5) frameXs.push(x);
  const pb = kit.buf('metal', 37, -108);
  for (const x of frameXs) {
    const zp = plazaParapetZ(x) + 0.9, zr = zN(x);
    pb.beam([x, 0, zp], [x, pergY, zp], 0.5, 0.5, SLATE);
    pb.beam([x, pergY, zp - 0.4], [x, pergY, zr + 0.5], 0.5, 0.7, SLATE);
    pb.beam([x, pergY - 1.6, zp], [x, pergY - 0.2, zp + 1.5], 0.25, 0.25, SLATE);
    kit.collision.addCircle(x, zp, 0.36, pergY, 'metal', 'pergola');
  }
  for (const f of [0, 0.5, 1]) {
    const pts: [number, number, number][] = frameXs.map((x) => [x, pergY + 0.35, plazaParapetZ(x) + 0.9 + f * (zN(x) - plazaParapetZ(x) - 1.4)]);
    for (let i = 1; i < pts.length; i++) pb.beam(pts[i - 1], pts[i], 0.35, 0.45, SLATE);
  }
  // planter parapet with dense hedge along the pergola edge (two gaps = routes down to PES Univ Rd)
  const gaps: [number, number][] = [[27.2, 31.2], [42.8, 46.8]];
  const runs: [number, number][] = [];
  let x0 = P.minX;
  for (const [g0, g1] of gaps) { runs.push([x0, g0]); x0 = g1; }
  runs.push([x0, P.maxX]);
  for (const [a, b] of runs) {
    for (let x = a; x < b - 0.01; x += 2) {
      const xb = Math.min(b, x + 2);
      const pa: V2 = [x, plazaParapetZ(x)], pbb: V2 = [xb, plazaParapetZ(xb)];
      kit.segBox('stone', pa, pbb, 0, 0.95, 1.3, PLANTER_GREY, 0, 0.02);
      kit.segBox('stone', pa, pbb, 0.95, 1.05, 1.45, col('#2c2e30'), 0, 0.02);
      hedgeBox(kit, 'hedge', pa, pbb, 1.0, 1.85, 1.1);
    }
    kit.collision.addSegment([a, plazaParapetZ(a)], [b, plazaParapetZ(b)], 1.3, 1.0, 'concrete', 'parapet');
  }
  // paper cone-lamp clusters hanging under the roof
  const lamps = kit.instSet('coneLamp', () => {
    const g = new THREE.ConeGeometry(0.26, 0.5, 9, 1, true).translate(0, -0.25, 0);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide, emissive: new THREE.Color(1, 0.85, 0.62), emissiveIntensity: 0 });
    kit.updatables.push(() => { m.emissiveIntensity = 0.1 + worldUniforms.uNight.value * 1.4; });
    return { geo: g, mat: m, cast: false, colored: true };
  });
  const white = col('#f2eee6'), tan = col('#b07a45');
  for (const [cx, cz] of [[30, -99.5], [38, -101.5], [46, -99.5]] as V2[]) {
    kit.lampPoints.push(new THREE.Vector3(cx, 6.5, cz));
    for (let i = 0; i < 36; i++) {
      const h1 = hash2(cx * 13 + i * 7.1, cz * 3 + i * 1.3), h2 = hash2(i * 3.7 + cx, cz * 1.9 - i);
      const a = h1 * Math.PI * 2, rr = Math.sqrt(h2) * 3.2;
      const y = 8.6 - h2 * 2.6 - (1 - rr / 3.2) * 0.8;
      kit.addInst(lamps, new THREE.Vector3(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr), a, 0.8 + h1 * 0.5, h2 > 0.62 ? tan : white);
      kit.buf('metal', cx, cz).beam([cx + Math.cos(a) * rr, roofY - 0.9, cz + Math.sin(a) * rr], [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr], 0.012, 0.012, col('#222'));
    }
  }
  // "PEOPLES EDUCATION SOCIETY" glass entrance on the west wall (north wing east face, x = 20)
  kit.box('glass', P.minX + 0.08, 2.6, -100.5, 0.12, 5.2, 9, 0, col('#34424e'));
  kit.box('stone', P.minX + 0.2, 6.0, -100.5, 0.3, 1.4, 11, 0, col('#f2f1ec'));
  kit.signQuad(signs.pesSociety, P.minX + 0.37, 6.0, -100.5, 10.4, 0.98, 1, 0, true);
  for (let z = -104.5; z <= -96.5; z += 2) kit.box('metal', P.minX + 0.15, 2.6, z, 0.08, 5.2, 0.08, 0, col('#2b2f33'));
  // granite cladding panels + dark wall zone on the east side of the plaza
  kit.box('polished', P.maxX + 3.9, 4.5, -104, 0.2, 9, 14, 0, col('#9b9a96'), 0.5);
}

// ------------------------------------------------------------------------------------------------ drive-through + porte-cochère
function driveThrough(kit: WorldKit, signs: SignUVs): void {
  const D = DRIVE_THROUGH;
  const no = (x: number) => pesRdZ(x) - 5.4;
  // square granite-clad columns along the north kerb (skipping the MRD loop-road mouth)
  for (const x of [56.5, 63.5, 78.6, 83.2]) {
    const z = no(x) + 0.65;
    kit.box('polished', x, D.clear / 2, z, 1.05, D.clear, 1.05, 0, col('#b9b7b1'), 0.5);
    kit.collision.addCircle(x, z, 0.65, D.clear, 'concrete', 'column');
  }
  // ceiling light strips under the soffit
  for (let x = D.x0 + 3; x < D.x1 - 1; x += 5) {
    const z = pesRdZ(x);
    kit.box('emissive', x, D.clear - 0.04, z, 2.2, 0.06, 0.25, 0, col('#ffffff'));
    kit.box('emissive', x, D.clear - 0.04, z + 4.8, 1.2, 0.06, 0.2, 0, col('#ffffff'));
  }
  // red fire-extinguisher cabinets along the building wall
  for (let x = D.x0 + 6; x < D.x1 - 2; x += 9) {
    const z = pesRdZ(x) + 4 + D.footpath - 0.15;
    kit.box('stone', x, 1.0, z, 0.55, 0.9, 0.3, 0, col('#c1261c'));
  }
  // porte-cochère on the east face: terracotta picture frame (5–10.5 m) + dark recess + planter band
  const x = D.x1;
  const zNo = no(x) - 0.4, zSo = pesRdZ(x) + 4 + D.footpath + 1.0;
  const zc = (zNo + zSo) / 2, span = zSo - zNo;
  kit.box('stone', x + 0.6, 10.0, zc, 1.3, 1.4, span + 2.4, 0, TERRACOTTA);
  kit.box('stone', x + 0.6, 7.6, zNo - 0.6, 1.3, 5.2, 1.2, 0, TERRACOTTA);
  kit.box('stone', x + 0.6, 7.6, zSo + 0.6, 1.3, 5.2, 1.2, 0, TERRACOTTA);
  kit.box('dark', x + 0.06, 8.0, zc, 0.12, 3.6, span, 0, col('#26282b'));
  kit.box('stone', x + 0.8, 5.8, zc, 1.6, 1.6, span, 0, PLANTER_GREY);
  kit.box('stone', x + 0.8, 5.0, zc, 1.62, 0.06, span, 0, col('#3a3d40'));
  hedgeBox(kit, 'lime', [x + 0.8, zNo + 0.3], [x + 0.8, zSo - 0.3], 6.6, 7.4, 1.3);
  kit.signQuad(signs.porteBanner, x + 1.62, 5.8, zSo - 3.5, 5.6, 1.4, 1, 0, false);
  // the planter band continues along the north face of the overhang
  const n0: V2 = [D.x0 + 1, no(D.x0 + 1) - 0.1], n1: V2 = [x, no(x) - 0.1];
  kit.segBox('stone', n0, n1, 5.0, 6.6, 1.2, PLANTER_GREY, -0.5);
  hedgeBox(kit, 'lime', [n0[0], n0[1] - 0.5], [n1[0], n1[1] - 0.5], 6.6, 7.3, 1.0);
  // footpath kerb (building side)
  kit.segBox('stone', [D.x0, pesRdZ(D.x0) + 4.1], [x, pesRdZ(x) + 4.1], 0, 0.16, 0.3, col('#9c9c9a'));
}

// ------------------------------------------------------------------------------------------------ east facade
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
  // east entrance: two-storey cream portal box projecting from the colonnade + speckled granite steps
  const zA = -86, zB = -74;
  const xa = E(zA), xb = E(zB);
  for (const z of [zA, zB]) {
    const xx = E(z);
    kit.box('stone', xx + 1.2, 5.25, z, 3.6, 10.5, 0.8, 0, CREAM);
    kit.collision.addPolygon([[xx - 0.6, z - 0.4], [xx + 3.0, z - 0.4], [xx + 3.0, z + 0.4], [xx - 0.6, z + 0.4]], 10.5, 'concrete', 'portal');
  }
  kit.box('stone', (xa + xb) / 2 + 1.3, 9.75, (zA + zB) / 2, 3.4, 1.5, zB - zA + 0.8, Math.atan2(-12, 161), CREAM);
  for (let k = 0; k < 4; k++) kit.box('polished', (xa + xb) / 2 + 3.4 + k * 0.4, 0.07 + k * 0.0, (zA + zB) / 2, 0.4, 0.14 - k * 0.03, 11, Math.atan2(-12, 161), col('#9c9c9a'), 0.5);
  // walnut-slat wall panel on the north side of the entrance hall (the hall itself stays open to the Quad)
  kit.box('wood', 70, 4.5, -83.9, 9, 8.6, 0.2, 0, col('#5a3a26'), 0.5);
  for (let x = 65.6; x <= 74.4; x += 0.4) kit.box('wood', x, 4.5, -83.75, 0.12, 8.4, 0.1, 0, col('#6e4a30'), 0.5);
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
  kit.collision.addPolygon([[x0 - 0.4, zBot], [x0 + w + 0.4, zBot], [x0 + w + 0.4, zTop], [x0 - 0.4, zTop]], 8, 'concrete', 'stair');
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
