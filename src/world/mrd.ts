import * as THREE from 'three';
import { GeoBuffer } from './buildings';
import { polyCentroid, rng } from './geom';
import { col, type WorldKit } from './kit';
import { BUILDINGS, type V2 } from './layout';
import { netTexture } from './materials';
import { buildMrdInterior } from './mrdInterior';
import { outwardNormal, pottedPlant, quad3, type P3 } from './shapes';
import type { SignUVs } from './signs';

/**
 * Prof. MRD Block ("Dr. M.R. Doreswamy Silver Jubilee Complex", OSM alt name A-Block) — see reference/MRD_NOTES.md.
 * The OSM outline is split into its wings in layout.ts (ids mrd = NW auditorium, mrd_fan, mrd_east, mrd_ne, mrd_se).
 * This file adds the detail: the east entrance (grand white granite steps, green-marble forecourt, glazed ground
 * floor with blue-grey columns, navy name band + big sloping navy canopy), navy cantilever slabs on the refurbished
 * stone wings, the perforated roof screen, the auditorium's metal hip roof, the 2026 refurbishment scaffolding and
 * the PES food point shops on the west face (opposite the BE-block entrance).
 */
const NAVY = col('#1f2b45');
/** East (curtain-wall) face of the entrance block: OSM vertices V14 → V12. */
export const MRD_EAST_FACE: [V2, V2] = [[59.9, -139.3], [73.5, -161.8]];
/** Grand steps: 12 risers x 0.15 m up to the forecourt at +1.8 m (OSM highway=steps (77.5,−144.7)→(66.7,−150.5)). */
export const MRD_STEPS = { width: 24, forecourt: 4.0, risers: 12, rise: 0.15, tread: 0.38 };

const bld = (id: string) => BUILDINGS.find((b) => b.id === id);

export function buildMRD(kit: WorldKit, signs: SignUVs): void {
  const east = bld('mrd_east');
  if (!east) return;
  const [A, B] = MRD_EAST_FACE;
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const u: V2 = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
  const n = outwardNormal(east.poly, A, B); // ≈ (0.854, 0.520): towards the loop road
  const mid: V2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const P = (along: number, out: number): V2 => [mid[0] + u[0] * along + n[0] * out, mid[1] + u[1] * along + n[1] * out];
  const P3d = (along: number, out: number, y: number): P3 => { const p = P(along, out); return [p[0], y, p[1]]; };
  const rot = Math.atan2(-u[1], u[0]); // box local x along the face, local z along n
  const { width: W, forecourt: F, risers, rise, tread } = MRD_STEPS;
  const topY = risers * rise;
  const run = risers * tread;

  // ---------------------------------------------------------------- forecourt (white granite sides, glossy green marble top) + grand steps
  { const c = P(0, F / 2); kit.box('polished', c[0], topY / 2, c[1], W, topY, F, rot, col('#e6e4de'), 0.5); }
  { const c = P(0, F / 2); kit.box('polished', c[0], topY + 0.012, c[1], W - 0.3, 0.024, F - 0.2, rot, col('#5f7468'), 0.5); }
  for (let i = 0; i < risers; i++) {
    const c = P(0, F + (risers - 0.5 - i) * tread);
    kit.box('polished', c[0], ((i + 1) * rise) / 2, c[1], W, (i + 1) * rise, tread + 0.012, rot, col('#ecebe6').multiplyScalar(0.95 + (i % 2) * 0.05), 0.5);
  }
  kit.collision.addPolygon([P(-W / 2, 0), P(W / 2, 0), P(W / 2, F), P(-W / 2, F)], topY, 'concrete', 'mrd:forecourt');
  kit.collision.addRamp([P(-W / 2, F), P(W / 2, F), P(W / 2, F + run), P(-W / 2, F + run)], P(0, F + run), P(0, F), 0, topY, 'concrete', 'mrd:steps');
  // steel handrails at both ends of the flight
  {
    const hb = kit.buf('metal', mid[0], mid[1]);
    for (const s of [-W / 2 + 0.25, W / 2 - 0.25]) {
      const a = P3d(s, F + run - 0.2, 0.95), b = P3d(s, F + 0.1, topY + 0.95);
      hb.beam(a, b, 0.05, 0.05, col('#9aa0a6'));
      for (let k = 0; k <= 4; k++) { const f = k / 4; hb.box(a[0] + (b[0] - a[0]) * f, (a[1] + (b[1] - a[1]) * f) - 0.47, a[2] + (b[2] - a[2]) * f, 0.05, 0.95, 0.05, 0, col('#9aa0a6')); }
    }
  }
  // north end: raised planter of purple heart + a big tree beside the steps; south end: granite cheek wall
  {
    const a = P(W / 2 + 0.1, 0.6), b = P(W / 2 + 0.1, F + run);
    kit.segBox('stone', a, b, 0, 1.25, 1.1, col('#d9d6cf'), -0.55, 0, 0.5);
    kit.segBox('hedge', a, b, 1.2, 1.75, 0.95, col('#8a4a78'), -0.55, -0.2, 0.5);
    const tp = P(W / 2 + 2.6, F + run - 1.2);
    kit.addTree('rain', tp[0], tp[1], 0.95);
    const c0 = P(-W / 2 - 0.3, 0.3), c1 = P(-W / 2 - 0.3, F + run);
    kit.segBox('polished', c0, c1, 0, topY + 0.35, 0.6, col('#e2e0da'), 0, 0, 0.5);
    // planted bed filling the wedge between the south end of the flight and the SE wing's north face (no dead pocket)
    const bed: V2[] = [P(-W / 2 - 0.6, 0), [59.9, -139.3], [59.3, -136.4], [62.9, -136.1], [68.4, -135.7], P(-W / 2 - 0.6, F + run)];
    for (let i = 0; i < bed.length; i++) kit.segBox('stone', bed[i], bed[(i + 1) % bed.length], 0, 0.8, 0.25, col('#9d9b96'), 0, 0.1, 0.5);
    kit.buf('stone', bed[0][0], bed[0][1]).flatPoly(bed, 0.75, col('#3d3226'), 2);
    kit.buf('hedge', bed[0][0], bed[0][1]).flatPoly(bed.map(([x, z]) => [x + (64 - x) * 0.12, z + (-137.5 - z) * 0.12] as V2), 1.15, col('#8a4a78'), 1);
    kit.collision.addPolygon(bed, 0.8, 'concrete', 'mrd:planter');
  }
  // glazed ground floor with blue-grey columns and two open doorways into the lobby, and the whole enterable interior
  // behind it (lobby, atrium, stair to the 1st floor, OAT-side corridor): src/world/mrdInterior.ts
  buildMrdInterior(kit);
  {
    // navy name band above the glazing: "DR. M.R. DORESWAMY SILVER JUBILEE COMPLEX"
    const sb = P(0, 0.3);
    kit.box('stone', sb[0], topY + 4.95, sb[1], W - 0.8, 0.9, 0.35, rot, NAVY, 0.5);
    kit.signQuad(signs.mrdCanopy, sb[0] + n[0] * 0.18, topY + 4.95, sb[1] + n[1] * 0.18, W - 1.4, 0.82, n[0], n[1], true);
  }
  // big navy canopy: soffit rises from the wall to the tip, thick fascia (the tour's key frame 0332)
  {
    const cb = kit.buf('stone', mid[0], mid[1]);
    const hw = W / 2 + 1.2, d = 5.6;
    const ys0 = topY + 5.5, ys1 = topY + 6.5, yt0 = topY + 6.2, yt1 = topY + 7.2;
    const nav = NAVY, navD = NAVY.clone().multiplyScalar(0.8);
    quad3(cb, [P3d(-hw, 0, ys0), P3d(hw, 0, ys0), P3d(hw, d, ys1), P3d(-hw, d, ys1)], [-n[0] * 0.18, -0.98, -n[1] * 0.18], navD);
    quad3(cb, [P3d(-hw, 0, yt0), P3d(hw, 0, yt0), P3d(hw, d, yt1), P3d(-hw, d, yt1)], [-n[0] * 0.18, 0.98, -n[1] * 0.18], nav);
    quad3(cb, [P3d(-hw, d, ys1), P3d(hw, d, ys1), P3d(hw, d, yt1), P3d(-hw, d, yt1)], [n[0], 0, n[1]], nav);
    for (const s of [-hw, hw]) quad3(cb, [P3d(s, 0, ys0), P3d(s, d, ys1), P3d(s, d, yt1), P3d(s, 0, yt0)], [u[0] * Math.sign(s), 0, u[1] * Math.sign(s)], nav);
    const cp = [P(-hw, 0), P(hw, 0), P(hw, d), P(-hw, d)];
    kit.collision.addPolygon(cp, yt1 - ys0, 'concrete', 'mrd:canopy', ys0);
  }
  // perforated metal screen on the navy top cornice of the entrance block
  { const top = (east.top ?? (east.floorH ?? 3.8) * east.floors); kit.segBox('metal', A, B, top + 0.1, top + 1.9, 0.08, col('#3f444a'), 1.05, 0, 0.3); }

  // ---------------------------------------------------------------- navy cantilever slabs on the refurbished stone wings (SE tower + NE block)
  const se = bld('mrd_se'), ne = bld('mrd_ne');
  const slab = (poly: V2[], a: V2, b: V2, w: number, depth: number, y: number) => {
    const nn = outwardNormal(poly, a, b);
    const m: V2 = [(a[0] + b[0]) / 2 + nn[0] * depth / 2, (a[1] + b[1]) / 2 + nn[1] * depth / 2];
    kit.box('stone', m[0], y, m[1], w, 0.55, depth, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), NAVY, 0.5);
  };
  if (se) slab(se.poly, [68.4, -135.7], [66.8, -131.8], 7.5, 2.8, 11.6);
  if (ne) slab(ne.poly, [80.8, -163.9], [73.5, -161.8], 8.5, 2.8, 11.6);
  // green safety net hanging at the north end of the entrance glazing (2026)
  const nets = new GeoBuffer();
  { const a = P(W / 2 - 3.2, 0.7), b = P(W / 2 - 0.4, 0.7); nets.wallQuad(a, b, topY, topY + 5.4, undefined, 0.25, true); }

  // ---------------------------------------------------------------- auditorium hip roof (metal sheets) on the NW block
  const aud = bld('mrd');
  if (aud) {
    const top = aud.top ?? (aud.floorH ?? 4) * aud.floors;
    const c = polyCentroid(aud.poly);
    const eaveY = top + (aud.roof?.parapet ?? 0.3), ridgeY = top + 5.2;
    const eave = aud.poly.map(([x, z]) => [c[0] + (x - c[0]) * 1.035, c[1] + (z - c[1]) * 1.035] as V2);
    const ridge = aud.poly.map(([x, z]) => [c[0] + (x - c[0]) * 0.42, c[1] + (z - c[1]) * 0.42] as V2);
    const rb = kit.buf('metal', c[0], c[1]);
    const roofC = col('#8e949a');
    for (let i = 0; i < eave.length; i++) {
      const j = (i + 1) % eave.length;
      const p0: P3 = [eave[i][0], eaveY, eave[i][1]], p1: P3 = [eave[j][0], eaveY, eave[j][1]];
      const p2: P3 = [ridge[j][0], ridgeY, ridge[j][1]], p3: P3 = [ridge[i][0], ridgeY, ridge[i][1]];
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      quad3(rb, [p0, p1, p2, p3], [nx / l, ny / l, nz / l], roofC.clone().multiplyScalar(0.94 + (i % 3) * 0.04));
      // eave soffit (under the overhang)
      const w0: P3 = [aud.poly[i][0], eaveY - 0.02, aud.poly[i][1]], w1: P3 = [aud.poly[j][0], eaveY - 0.02, aud.poly[j][1]];
      quad3(rb, [w0, w1, [p1[0], eaveY - 0.02, p1[2]], [p0[0], eaveY - 0.02, p0[2]]], [0, -1, 0], col('#6f7378'));
    }
    rb.flatPoly(ridge, ridgeY, roofC.clone().multiplyScalar(1.04), 2);
    // ridge vents
    kit.box('metal', c[0], ridgeY + 0.35, c[1], 6, 0.7, 1.4, 0.4, col('#777b80'));
  }

  // ---------------------------------------------------------------- 2026 refurbishment scaffolding (bamboo / steel tubes, green nets)
  const faces: { poly: V2[]; a: V2; b: V2; h: number }[] = [];
  if (se) faces.push({ poly: se.poly, a: [66.8, -131.8], b: [45.0, -126.0], h: 21 }); // SE wing, facing PES Univ Rd
  if (ne) faces.push({ poly: ne.poly, a: [74.4, -180.3], b: [79.4, -167.0], h: 21 }); // NE block, east face
  scaffolding(kit, faces, nets);

  // ---------------------------------------------------------------- the PES signboard skybridge between the NE and SE towers
  pesSignBridge(kit, signs);

  // ---------------------------------------------------------------- PES food point shops on the west face (opposite the BE entrance)
  foodPoint(kit, signs);

  if (nets.vertexCount) {
    const m = new THREE.Mesh(nets.toGeometry(), new THREE.MeshStandardMaterial({ map: netTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.9 }));
    m.castShadow = false; m.receiveShadow = true; m.name = 'mrd:nets';
    m.matrixAutoUpdate = false; m.updateMatrix();
    kit.group.add(m);
  }
}

/**
 * The PES signboard skybridge (key frames 0152, 0208, 0230, 1928; GJB tour 0:58 / 1:52): a navy-fascia walkway at the
 * top of the frosted-glass entrance block, spanning the mouth of the recess between the SE tower (north face, V15–V17)
 * and the NE tower (south face, V12–V11). Glass balustrade + steel handrail on the east edge, a long white box on the
 * back half of the deck carrying the big "PES UNIVERSITY" board (atlas entry `pesBridge`) facing east, a thin white roof
 * slab on top, a dark soffit underneath. The soffit is at ≈17 m, well above the entrance canopy; below it the view runs
 * back to the set-back curtain wall. Collision: deck slab (base 17 m) + sign box (base 18.8 m), both walk-under.
 */
export const PES_SIGN_BRIDGE = { soffit: 17.0, deckTop: 18.8, boxTop: 23.2, depth: 4.0, boxDepth: 2.3 };
function pesSignBridge(kit: WorldKit, signs: SignUVs): void {
  const B = PES_SIGN_BRIDGE;
  const faceSE: [V2, V2] = [[59.3, -136.4], [68.4, -135.7]]; // SE tower north face (OSM V15 → V17)
  const faceNE: [V2, V2] = [[73.5, -161.8], [80.8, -163.9]]; // NE tower south face (OSM V12 → V11)
  // front (east) edge of the deck: from near the SE tower's NE corner to near the NE tower's SE corner
  const E1 = onSeg(faceSE, 68.0), E2 = onSeg(faceNE, 80.2);
  const len = Math.hypot(E2[0] - E1[0], E2[1] - E1[1]);
  const u: V2 = [(E2[0] - E1[0]) / len, (E2[1] - E1[1]) / len];
  const nIn: V2 = -u[1] < 0 ? [-u[1], u[0]] : [u[1], -u[0]]; // points west, towards the curtain wall
  const nOut: V2 = [-nIn[0], -nIn[1]];
  // a line parallel to the front edge at depth d, clipped to the two tower faces
  const cut = (d: number): [V2, V2] => {
    const p: V2 = [E1[0] + nIn[0] * d, E1[1] + nIn[1] * d];
    return [hitLine(p, u, faceSE), hitLine(p, u, faceNE)];
  };
  const [f0, f1] = cut(0), [m0, m1] = cut(B.depth - B.boxDepth), [b0, b1] = cut(B.depth);
  const navy = NAVY, soffitC = col('#262d3a'), white = col('#f6f5f1');
  const buf = kit.buf('stone', (E1[0] + E2[0]) / 2, (E1[1] + E2[1]) / 2);
  const P3 = (p: V2, y: number): P3 => [p[0], y, p[1]];
  const deck: V2[] = [f0, f1, b1, b0];
  // deck: soffit (dark), walking surface (grey pavers), navy fascia on the front + back faces
  quad3(buf, deck.map((p) => P3(p, B.soffit)), [0, -1, 0], soffitC);
  quad3(buf, deck.map((p) => P3(p, B.deckTop)), [0, 1, 0], col('#8f918f'));
  quad3(buf, [P3(f0, B.soffit), P3(f1, B.soffit), P3(f1, B.deckTop), P3(f0, B.deckTop)], [nOut[0], 0, nOut[1]], navy);
  quad3(buf, [P3(b0, B.soffit), P3(b1, B.soffit), P3(b1, B.deckTop), P3(b0, B.deckTop)], [nIn[0], 0, nIn[1]], navy);
  // a slim lighter drip line under the fascia (reads as the metal edge in the frames)
  quad3(buf, [P3(f0, B.soffit - 0.06), P3(f1, B.soffit - 0.06), P3(f1, B.soffit), P3(f0, B.soffit)], [nOut[0], 0, nOut[1]], col('#3a4660'));
  kit.collision.addPolygon(deck, B.deckTop - B.soffit, 'concrete', 'mrd:pesbridge', B.soffit);
  // glazed balustrade + steel handrail + posts along the front edge
  const r0: V2 = [f0[0] + nIn[0] * 0.15, f0[1] + nIn[1] * 0.15], r1: V2 = [f1[0] + nIn[0] * 0.15, f1[1] + nIn[1] * 0.15];
  const gb = new GeoBuffer();
  gb.wallQuad(r0, r1, B.deckTop + 0.05, B.deckTop + 1.0, undefined, 1, true);
  const gm = new THREE.Mesh(gb.toGeometry(), new THREE.MeshStandardMaterial({ color: 0x9fb3bd, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide }));
  gm.name = 'mrd:pesbridge:glass'; gm.renderOrder = 1; gm.matrixAutoUpdate = false; gm.updateMatrix();
  kit.group.add(gm);
  const mb = kit.buf('metal', (E1[0] + E2[0]) / 2, (E1[1] + E2[1]) / 2);
  const rl = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
  mb.beam(P3(r0, B.deckTop + 1.08), P3(r1, B.deckTop + 1.08), 0.06, 0.06, col('#2a2d31'));
  for (let s = 0; s <= rl; s += 2.0) {
    const q: V2 = [r0[0] + u[0] * s, r0[1] + u[1] * s];
    mb.box(q[0], B.deckTop + 0.55, q[1], 0.05, 1.1, 0.05, 0, col('#2a2d31'));
  }
  kit.collision.addPolygon([r0, r1, [r1[0] + nIn[0] * 0.1, r1[1] + nIn[1] * 0.1], [r0[0] + nIn[0] * 0.1, r0[1] + nIn[1] * 0.1]], 1.1, 'metal', 'mrd:pesbridge', B.deckTop);
  // the white sign box on the back half of the deck, thin roof slab overhanging all round
  const box: V2[] = [m0, m1, b1, b0];
  quad3(buf, [P3(m0, B.deckTop), P3(m1, B.deckTop), P3(m1, B.boxTop), P3(m0, B.boxTop)], [nOut[0], 0, nOut[1]], white);
  quad3(buf, [P3(b0, B.deckTop), P3(b1, B.deckTop), P3(b1, B.boxTop), P3(b0, B.boxTop)], [nIn[0], 0, nIn[1]], white.clone().multiplyScalar(0.92));
  const slab: V2[] = [cutAt(m0, m1, -0.5, u, nOut, 0.45), cutAt(m1, m0, 0.5, u, nOut, 0.45), cutAt(b1, b0, 0.5, u, nIn, 0.3), cutAt(b0, b1, -0.5, u, nIn, 0.3)];
  quad3(buf, slab.map((p) => P3(p, B.boxTop + 0.35)), [0, 1, 0], col('#e9e8e3'));
  quad3(buf, slab.map((p) => P3(p, B.boxTop)), [0, -1, 0], col('#dcdad4'));
  for (let i = 0; i < 4; i++) {
    const a = slab[i], c = slab[(i + 1) % 4];
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    const cx = (slab[0][0] + slab[2][0]) / 2, cz = (slab[0][1] + slab[2][1]) / 2;
    let nx = -(c[1] - a[1]), nz = c[0] - a[0];
    if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const l = Math.hypot(nx, nz) || 1;
    quad3(buf, [P3(a, B.boxTop), P3(c, B.boxTop), P3(c, B.boxTop + 0.35), P3(a, B.boxTop + 0.35)], [nx / l, 0, nz / l], white);
  }
  kit.collision.addPolygon(box, B.boxTop + 0.35 - B.deckTop, 'concrete', 'mrd:pessign', B.deckTop);
  // the board: inset panel frame + the atlas sign, centred on the box's east face
  const mid: V2 = [(m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2];
  const boxLen = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]);
  const sh = 3.3, sw = Math.min(boxLen * 0.62, sh * 5.12);
  const sy = (B.deckTop + B.boxTop) / 2 + 0.1;
  const rot = Math.atan2(-u[1], u[0]);
  kit.box('stone', mid[0] + nOut[0] * 0.02, sy, mid[1] + nOut[1] * 0.02, sw + 0.5, sh + 0.4, 0.06, rot, col('#e4e3de'), 0.5);
  kit.signQuad(signs.pesBridge, mid[0] + nOut[0] * 0.07, sy, mid[1] + nOut[1] * 0.07, sw, sh * 0.97, nOut[0], nOut[1], true);
  // downlights under the soffit (lit at night)
  for (let s = 3; s < len - 2; s += 4.5) {
    const q: V2 = [E1[0] + u[0] * s + nIn[0] * 1.2, E1[1] + u[1] * s + nIn[1] * 1.2];
    kit.box('emissive', q[0], B.soffit - 0.02, q[1], 0.35, 0.02, 0.35, rot, col('#ffffff'));
  }
}

/** Point on segment a→b at the given x. */
function onSeg([a, b]: [V2, V2], x: number): V2 {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + (b[1] - a[1]) * t];
}
/** Intersection of the infinite line p + t·u with the infinite line through segment a→b. */
function hitLine(p: V2, u: V2, [a, b]: [V2, V2]): V2 {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const den = u[0] * dz - u[1] * dx;
  const t = ((a[0] - p[0]) * dz - (a[1] - p[1]) * dx) / den;
  return [p[0] + u[0] * t, p[1] + u[1] * t];
}
/** p pushed along the span direction u by `along` and outwards along n by `out` (roof-slab overhang). */
function cutAt(p: V2, _q: V2, along: number, u: V2, n: V2, out: number): V2 {
  return [p[0] + u[0] * along + n[0] * out, p[1] + u[1] * along + n[1] * out];
}

/** Scaffold bands on the given faces: two tube planes (0.9 / 2.1 m out), ledgers every 2 m, planks, braces, nets. */
function scaffolding(kit: WorldKit, faces: { poly: V2[]; a: V2; b: V2; h: number }[], nets: GeoBuffer): void {
  const tube = kit.instSet('scaffoldTube', () => ({
    geo: new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 1, true).translate(0, 0.5, 0),
    mat: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.5 }),
    cast: true, colored: true,
  }));
  const rust = col('#b0703a'), grey = col('#8a8d90');
  const up = new THREE.Vector3(0, 1, 0);
  const addTube = (p: THREE.Vector3, q: THREE.Vector3, c: THREE.Color) => {
    const d = new THREE.Vector3().subVectors(q, p);
    const l = d.length();
    if (l < 0.01) return;
    const qq = new THREE.Quaternion().setFromUnitVectors(up, d.divideScalar(l));
    kit.addInstMatrix(tube, new THREE.Matrix4().compose(p, qq, new THREE.Vector3(1, l, 1)), c);
  };
  for (const [fi, f] of faces.entries()) {
    const { a, b, h: H } = f;
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const [nx, nz] = outwardNormal(f.poly, a, b);
    const r = rng(1301 + fi * 97);
    const bays = Math.max(1, Math.round(len / 2));
    const bw = len / bays;
    const levels = Math.floor(H / 2);
    for (const off of [0.9, 2.1]) {
      for (let i = 0; i <= bays; i++) {
        const x = a[0] + ux * bw * i + nx * off, z = a[1] + uz * bw * i + nz * off;
        addTube(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, H, z), r() < 0.7 ? rust : grey);
      }
      for (let lv = 1; lv <= levels; lv++) {
        const y = lv * 2;
        addTube(new THREE.Vector3(a[0] + nx * off, y, a[1] + nz * off), new THREE.Vector3(b[0] + nx * off, y, b[1] + nz * off), r() < 0.6 ? rust : grey);
      }
    }
    for (let lv = 1; lv <= levels; lv++) {
      const y = lv * 2;
      for (let i = 0; i <= bays; i += 2) {
        const x = a[0] + ux * bw * i, z = a[1] + uz * bw * i;
        addTube(new THREE.Vector3(x + nx * 0.6, y, z + nz * 0.6), new THREE.Vector3(x + nx * 2.4, y, z + nz * 2.4), grey);
      }
      if (lv % 2 === 0) kit.segBox('wood', [a[0] + nx * 1.5, a[1] + nz * 1.5], [b[0] + nx * 1.5, b[1] + nz * 1.5], y + 0.02, y + 0.07, 1.1, col('#8a6a45'));
      for (let i = lv % 3; i < bays; i += 3) {
        const xa = a[0] + ux * bw * i + nx * 2.1, za = a[1] + uz * bw * i + nz * 2.1;
        addTube(new THREE.Vector3(xa, y - 2, za), new THREE.Vector3(xa + ux * bw, y, za + uz * bw), rust);
      }
    }
    let s = 0;
    while (s < len) {
      const w = 2 + r() * 6;
      if (r() < 0.65) {
        const y0 = r() < 0.3 ? 0 : 2 * Math.floor(r() * 4), y1 = Math.min(H, y0 + 6 + r() * H);
        const pa: V2 = [a[0] + ux * s + nx * 2.25, a[1] + uz * s + nz * 2.25];
        const pb: V2 = [a[0] + ux * Math.min(len, s + w) + nx * 2.25, a[1] + uz * Math.min(len, s + w) + nz * 2.25];
        nets.wallQuad(pa, pb, y0, y1, undefined, 0.25, true);
      }
      s += w;
    }
    kit.collision.addSegment([a[0] + nx * 1.5, a[1] + nz * 1.5], [b[0] + nx * 1.5, b[1] + nz * 1.5], 1.9, H, 'metal', 'scaffold');
    for (let k = 0; k < 3; k++) {
      const fr = 0.2 + r() * 0.6;
      const cx = a[0] + dx * fr + nx * 3.6, cz = a[1] + dz * fr + nz * 3.6;
      kit.box('stone', cx, 0.3, cz, 1.2 + r(), 0.6, 0.8 + r() * 0.5, Math.atan2(-dz, dx), col('#b8b2a4'));
    }
  }
}

/** Single-storey shop row on the MRD west face (x≈2.4, z −169…−179): snacks counters, yellow fascias, red plate. */
function foodPoint(kit: WorldKit, signs: SignUVs): void {
  const a: V2 = [2.75, -169.3], b: V2 = [2.08, -178.9]; // along the MRD west face (OSM V26 → V0)
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: V2 = [u[1], -u[0]]; // west (towards the link road)
  const D = 1.8, H = 3.2;
  const rot = Math.atan2(-u[1], u[0]);
  const at = (s: number, o: number): V2 => [a[0] + u[0] * s + n[0] * o, a[1] + u[1] * s + n[1] * o];
  const m = at(len / 2, D / 2);
  kit.box('plaster', m[0], H / 2, m[1], len, H, D, rot, col('#ebe6da'), 0.5);
  // lean-to corrugated roof projecting over the counters
  const rf = at(len / 2, D + 0.3);
  kit.box('metal', rf[0], H + 0.15, rf[1], len + 0.4, 0.08, 0.9, rot, col('#9a9ea2'));
  const shops = 3, sw = len / shops;
  for (let i = 0; i < shops; i++) {
    const cs = sw * (i + 0.5);
    const f = at(cs, D + 0.02);
    kit.box('dark', f[0], 1.35, f[1], sw - 0.7, 2.1, 0.05, rot, col('#2a2a2c')); // open shop front
    const k = at(cs, D + 0.3);
    kit.box('wood', k[0], 0.5, k[1], sw - 0.9, 1.0, 0.5, rot, col('#b98a52'), 0.5); // counter
    const sh = at(cs, D + 0.04);
    kit.box('metal', sh[0], 2.65, sh[1], sw - 0.6, 0.5, 0.08, rot, col('#8d9094')); // rolled-up shutter
    const fb = at(cs, D + 0.07);
    kit.box('stone', fb[0], 3.0, fb[1], sw - 0.3, 0.45, 0.06, rot, col('#f2c200'), 0.5); // yellow fascia board
    if (i > 0) { const pp = at(sw * i, D + 0.25); pottedPlant(kit, pp[0], 0, pp[1], 0.7); }
  }
  const sp = at(sw * 0.5, D + 0.12);
  kit.signQuad(signs.foodPoint, sp[0], 3.0, sp[1], sw - 0.5, 0.46, n[0], n[1], true);
  kit.collision.addPolygon([at(0, 0), at(len, 0), at(len, D + 0.2), at(0, D + 0.2)], H, 'concrete', 'foodpoint');
}
