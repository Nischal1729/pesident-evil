import * as THREE from 'three';
import { rng } from './geom';
import { col, type WorldKit } from './kit';
import { hedgeBox } from './landscape';
import type { V2 } from './layout';
import { arcPt, outwardNormal, pottedPlant, quad3, rubbleWall, type P3 } from './shapes';
import type { SignUVs } from './signs';

/**
 * Open Air Theatre (amphitheatre) between the MRD block and PES University Rd — see reference/MRD_NOTES.md §4.
 * OSM outline: a quarter disc with its corner at the road junction (≈(4,−120.5)) and radius ≈27 m.
 *
 * Reference (2021 + 2024/25 + 2026 tours): a flat paved stage in the south-west corner with a colourful mural
 * panel on a navy low wall; 8 plain grey concrete tiers (≈0.4 m risers, ≈0.95 m treads) curving round the
 * north and east; a low parapet painted with a rainbow "teardrop arch" pattern on the rim; behind it a wide paved
 * terrace at the MRD ground-floor level (the campus rises towards MRD), rough-dressed granite retaining walls,
 * potted plants, mature rain trees (one grows out of the tiers in a planter box) and bunting.
 *
 * Multi-level contract: every tier is its own prism with its real top height, each aisle stair is an addRamp, the
 * terrace is a podium at +3.2 m (top walkable once levels land). In the flat sim they block, like any podium.
 */
export const OAT = {
  c: [4.6, -121.6] as V2,
  stageR: 10,
  tiers: 8,
  tread: 0.95,
  riser: 0.4,
  /** tiers sweep from east (0) round to north (π/2) */
  t0: 0,
  t1: Math.PI / 2,
  /** aisle stair centre-lines (angles) and half width (m) */
  aisles: [Math.PI / 6, Math.PI / 3],
  aisleHalf: 0.8,
};
export const OAT_TOP = OAT.tiers * OAT.riser; // 3.2 m: terrace / MRD ground-floor level
const R_OUT = OAT.stageR + OAT.tiers * OAT.tread; // 17.6

/** Terrace podium behind the top tier (inner edge = the R_OUT arc), incl. the MRD west plinth along the B/MRD link road. */
function terracePoly(): V2[] {
  const { c } = OAT;
  const outer: V2[] = [
    arcPt(c, R_OUT, 0),
    [30.2, -123.4], [30.2, -124.8], [32.2, -124.8], // notch for the stair up from PES Univ Rd
    [32.2, -137.5], [34.0, -145.4], // west of the OAT footway, up to the MRD south face
    [15.0, -154.0], [9.2, -156.9], [2.8, -168.5], // along the MRD south + west faces
    [1.9, -168.5], [1.9, -146.5], // MRD west plinth, facing the link road (the rubble wall opposite the BE entrance)
    arcPt(c, R_OUT, Math.PI / 2),
  ];
  const arc: V2[] = [];
  for (let i = 17; i >= 1; i--) arc.push(arcPt(c, R_OUT, (i / 18) * (Math.PI / 2)));
  return [...outer, ...arc];
}

export function buildOAT(kit: WorldKit, signs?: SignUVs): void {
  const { c, stageR, tiers, tread, riser, aisles, aisleHalf } = OAT;
  const buf = kit.buf('stone', c[0] + 10, c[1] - 10);
  const topC = col('#9d998f'), riseC = col('#86827a'), sideC = col('#8f8b83');
  const r = rng(636);
  // angular limits of the three seating sectors at radius rr (sector edges run parallel to the aisle centre-lines)
  const lim = (sec: number, rr: number): [number, number] => {
    const d = Math.asin(Math.min(0.99, aisleHalf / rr));
    if (sec === 0) return [OAT.t0, aisles[0] - d];
    if (sec === 1) return [aisles[0] + d, aisles[1] - d];
    return [aisles[1] + d, OAT.t1];
  };
  const P = (rr: number, t: number, y: number): P3 => { const p = arcPt(c, rr, t); return [p[0], y, p[1]]; };

  // ---------------------------------------------------------------- tiers (3 sectors x 8 tiers)
  for (let sec = 0; sec < 3; sec++) {
    for (let k = 0; k < tiers; k++) {
      const r0 = stageR + k * tread, r1 = r0 + tread, y0 = k * riser, y1 = (k + 1) * riser;
      const [a0, b0] = lim(sec, r0), [a1, b1] = lim(sec, r1);
      const n = Math.max(3, Math.ceil(((b1 - a1) * r1) / 1.1));
      const tint = (0.95 + r() * 0.08);
      const poly: V2[] = [];
      for (let i = 0; i <= n; i++) {
        const f0 = a0 + ((b0 - a0) * i) / n, f1 = a1 + ((b1 - a1) * i) / n;
        poly.push(arcPt(c, r0, f0));
        if (i < n) {
          const g0 = a0 + ((b0 - a0) * (i + 1)) / n, g1 = a1 + ((b1 - a1) * (i + 1)) / n;
          // tread top
          quad3(buf, [P(r0, f0, y1), P(r0, g0, y1), P(r1, g1, y1), P(r1, f1, y1)], [0, 1, 0], topC.clone().multiplyScalar(tint));
          // riser (faces the stage) + a slim darker nosing line
          const m = (f0 + g0) / 2, nx = -Math.cos(m), nz = Math.sin(m);
          quad3(buf, [P(r0, f0, y0), P(r0, g0, y0), P(r0, g0, y1), P(r0, f0, y1)], [nx, 0, nz], riseC.clone().multiplyScalar(tint));
          quad3(buf, [P(r0 - 0.02, f0, y1 - 0.05), P(r0 - 0.02, g0, y1 - 0.05), P(r0 - 0.02, g0, y1), P(r0 - 0.02, f0, y1)], [nx, 0, nz], col('#7f7b73'));
        }
      }
      for (let i = n; i >= 0; i--) poly.push(arcPt(c, r1, a1 + ((b1 - a1) * i) / n));
      // side faces (towards the aisles / the open ends)
      for (const [t0s, t1s, sgn] of [[a0, a1, -1], [b0, b1, 1]] as [number, number, number][]) {
        const pa = arcPt(c, r0, t0s), pb = arcPt(c, r1, t1s);
        // normal points to increasing angle for the b side, decreasing for the a side
        const tm = (t0s + t1s) / 2;
        const nx = -Math.sin(tm) * sgn, nz = -Math.cos(tm) * sgn;
        quad3(buf, [[pa[0], 0, pa[1]], [pb[0], 0, pb[1]], [pb[0], y1, pb[1]], [pa[0], y1, pa[1]]], [nx, 0, nz], sideC);
      }
      kit.collision.addPolygon(poly, y1, 'concrete', 'oat:tier');
    }
  }

  // ---------------------------------------------------------------- aisle stairs (half risers) = ramps
  for (const ta of aisles) {
    const u: V2 = [Math.cos(ta), -Math.sin(ta)], s: V2 = [Math.sin(ta), Math.cos(ta)]; // radial, side
    const at = (rr: number, off: number): V2 => [c[0] + u[0] * rr + s[0] * off, c[1] + u[1] * rr + s[1] * off];
    const steps = tiers * 2, st = tread / 2, sr = riser / 2;
    for (let j = 0; j < steps; j++) {
      const ra = stageR + j * st, rb = ra + st, y = (j + 1) * sr;
      const q = [at(ra, -aisleHalf), at(ra, aisleHalf), at(rb, aisleHalf), at(rb, -aisleHalf)];
      quad3(buf, q.map((p) => [p[0], y, p[1]] as P3), [0, 1, 0], col('#a5a197'));
      quad3(buf, [[q[0][0], y - sr, q[0][1]], [q[1][0], y - sr, q[1][1]], [q[1][0], y, q[1][1]], [q[0][0], y, q[0][1]]], [-u[0], 0, -u[1]], col('#7c786f'));
    }
    const strip = [at(stageR, -aisleHalf), at(stageR, aisleHalf), at(R_OUT, aisleHalf), at(R_OUT, -aisleHalf)];
    kit.collision.addRamp(strip, at(stageR, 0), at(R_OUT, 0), 0, OAT_TOP, 'concrete', 'oat:aisle');
    // steel handrail down the middle
    const hb = kit.buf('metal', c[0], c[1]);
    for (let j = 0; j <= 4; j++) { const p = at(stageR + 0.3 + j * ((R_OUT - stageR - 0.6) / 4), 0); const y = ((p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1] - stageR) / (R_OUT - stageR) * OAT_TOP; hb.box(p[0], y + 0.5, p[1], 0.05, 1.0, 0.05, 0, col('#8d9196')); }
    const pA = at(stageR + 0.3, 0), pB = at(R_OUT - 0.3, 0);
    hb.beam([pA[0], 1.0 + 0.04, pA[1]], [pB[0], OAT_TOP + 1.0 - 0.1, pB[1]], 0.05, 0.05, col('#8d9196'));
  }

  // ---------------------------------------------------------------- stage floor + mural backdrop
  const chordA: V2 = [c[0], c[1] - 4.5], chordB: V2 = [c[0] + 4.5, c[1]];
  const stage: V2[] = [chordB, arcPt(c, stageR, 0)];
  for (let i = 1; i < 12; i++) stage.push(arcPt(c, stageR, (i / 12) * (Math.PI / 2)));
  stage.push(arcPt(c, stageR, Math.PI / 2), chordA);
  kit.buf('stone', c[0] + 5, c[1] - 5).flatPoly(stage, 0.075, col('#aaa599'), 1.5);
  {
    const mx = (chordA[0] + chordB[0]) / 2, mz = (chordA[1] + chordB[1]) / 2;
    const len = Math.hypot(chordB[0] - chordA[0], chordB[1] - chordA[1]);
    const rot = Math.atan2(-(chordB[1] - chordA[1]), chordB[0] - chordA[0]);
    const nx = Math.SQRT1_2, nz = -Math.SQRT1_2; // faces the tiers (north-east)
    kit.box('stone', mx, 0.45, mz, len + 0.4, 0.9, 0.3, rot, col('#27335c'), 0.5);
    kit.box('stone', mx - nx * 0.05, 2.15, mz - nz * 0.05, len, 2.5, 0.2, rot, col('#e9e6df'), 0.5);
    kit.box('stone', mx, 3.45, mz, len + 0.2, 0.1, 0.34, rot, col('#27335c'), 0.5);
    if (signs) kit.signQuad(signs.oatMural, mx + nx * 0.06, 2.15, mz + nz * 0.06, len - 0.2, 2.4, nx, nz, false);
    kit.collision.addSegment(chordA, chordB, 0.35, 3.5, 'concrete', 'oat:mural');
    // planted triangle behind the mural (the road-junction corner)
    hedgeBox(kit, 'hedge', [c[0] + 0.6, c[1] - 3.2], [c[0] + 3.2, c[1] - 0.6], 0, 0.8, 1.2);
    // speaker boxes each side of the stage
    for (const p of [[c[0] + 1.2, c[1] - 6.3], [c[0] + 6.3, c[1] - 1.2]] as V2[]) kit.box('dark', p[0], 0.8, p[1], 0.6, 1.6, 0.55, Math.PI / 4, col('#1c1d20'));
  }

  // ---------------------------------------------------------------- rim parapet with the rainbow teardrop arches (gaps at the aisles)
  const rainbow = ['#e94b3c', '#f08a24', '#f2c200', '#27ae60', '#00b8a9', '#2d9cdb', '#6c5ce7', '#e84393'].map((h) => col(h));
  const pr = R_OUT + 0.14;
  for (let sec = 0; sec < 3; sec++) {
    const [a, b] = lim(sec, pr);
    const n = Math.max(2, Math.ceil(((b - a) * pr) / 1.2));
    for (let i = 0; i < n; i++) {
      const f = a + ((b - a) * i) / n, g = a + ((b - a) * (i + 1)) / n;
      const pa = arcPt(c, pr, f), pb = arcPt(c, pr, g);
      kit.segBox('plaster', pa, pb, OAT_TOP, OAT_TOP + 0.8, 0.26, col('#efebe2'), 0, 0.02, 0.5);
      kit.collision.addPolygon(segQuad(pa, pb, 0.26), 0.8, 'concrete', 'oat:parapet', OAT_TOP);
    }
    // arch tiles on the stage-facing side
    const tn = Math.floor(((b - a) * (pr - 0.145)) / 0.42);
    for (let i = 0; i < tn; i++) {
      const t = a + ((b - a) * (i + 0.5)) / tn;
      const p = arcPt(c, pr - 0.145, t);
      const rot = t + Math.PI / 2; // tangent
      const colr = rainbow[i % rainbow.length];
      const bb = kit.buf('plaster', p[0], p[1]);
      bb.box(p[0], OAT_TOP + 0.33, p[1], 0.3, 0.42, 0.02, rot, colr, 0.5);
      bb.box(p[0], OAT_TOP + 0.6, p[1], 0.16, 0.12, 0.02, rot, colr, 0.5);
      bb.box(p[0], OAT_TOP + 0.69, p[1], 0.07, 0.07, 0.02, rot, colr, 0.5);
    }
  }

  // ---------------------------------------------------------------- terrace podium (MRD ground-floor level) + retaining walls
  const terr = terracePoly();
  kit.buf('stone', 18, -140).flatPoly(terr, OAT_TOP + 0.02, col('#aba69c'), 1.5);
  kit.collision.addPolygon(terr, OAT_TOP, 'concrete', 'oat:terrace');
  // exposed faces: from the tier end (θ=0) round the east / stair notch, and the west faces along the link road
  const faces: [V2, V2][] = [
    [arcPt(c, R_OUT, 0), [30.2, -123.4]], [[32.2, -124.8], [32.2, -137.5]], [[32.2, -137.5], [34.0, -145.4]],
    [[2.8, -168.5], [1.9, -168.5]], [[1.9, -168.5], [1.9, -146.5]], [[1.9, -146.5], arcPt(c, R_OUT, Math.PI / 2)],
  ];
  faces.forEach(([a, b], i) => {
    const n = outwardNormal(terr, a, b);
    rubbleWall(kit, a, b, n, 0, OAT_TOP + 0.1, 400 + i * 17);
    // low rubble parapet on top with shrubs / potted plants
    kit.segBox('stone', a, b, OAT_TOP, OAT_TOP + 0.75, 0.4, col('#77716a'), -0.2, 0, 0.5);
    kit.collision.addPolygon(segQuad([a[0] - n[0] * 0.2, a[1] - n[1] * 0.2], [b[0] - n[0] * 0.2, b[1] - n[1] * 0.2], 0.4), 0.75, 'concrete', 'oat:parapet', OAT_TOP);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0.8; s < len - 0.5; s += 1.6 + r() * 0.8) {
      const f = s / len;
      pottedPlant(kit, a[0] + (b[0] - a[0]) * f - n[0] * 0.2, OAT_TOP + 0.75, a[1] + (b[1] - a[1]) * f - n[1] * 0.2, 0.8 + r() * 0.3);
    }
  });
  // the stair from PES Univ Rd up to the terrace (east end), with rubble cheek walls + handrail
  {
    const x0 = 30.2, x1 = 32.2, zb = -120.0, zt = -124.8, n = 16;
    for (let j = 0; j < n; j++) {
      const za = zb + ((zt - zb) * j) / n, zc = zb + ((zt - zb) * (j + 1)) / n, y = ((j + 1) * OAT_TOP) / n;
      kit.box('stone', (x0 + x1) / 2, y / 2, (za + zc) / 2, x1 - x0, y, Math.abs(zc - za) + 0.01, 0, col('#b3aea4').multiplyScalar(0.95 + (j % 2) * 0.05), 0.5);
    }
    kit.collision.addRamp([[x0, zb], [x1, zb], [x1, zt], [x0, zt]], [(x0 + x1) / 2, zb], [(x0 + x1) / 2, zt], 0, OAT_TOP, 'concrete', 'oat:stair');
    rubbleWall(kit, [x1 + 0.35, zb], [x1 + 0.35, zt], [1, 0], 0, OAT_TOP + 0.8, 991, 0.35);
    kit.collision.addPolygon([[x1, zb], [x1 + 0.35, zb], [x1 + 0.35, zt], [x1, zt]], OAT_TOP + 0.8, 'concrete', 'oat:wall');
    const hb = kit.buf('metal', x0, zb);
    hb.beam([x0 + 0.1, 1.0, zb], [x0 + 0.1, OAT_TOP + 1.0, zt], 0.05, 0.05, col('#8d9196'));
    for (let j = 0; j <= 3; j++) { const z = zb + ((zt - zb) * j) / 3; hb.box(x0 + 0.1, (OAT_TOP * j) / 3 + 0.5, z, 0.05, 1.0, 0.05, 0, col('#8d9196')); }
  }
  // terrace planters (hedge boxes) along the MRD faces + trees
  hedgeBox(kit, 'hedge', [31.5, -144.4], [17, -151.2], OAT_TOP, OAT_TOP + 0.9, 1.4);
  for (const [t, rr, s] of [[0.28, 21.5, 1.25], [0.72, 23.5, 1.35], [1.1, 22, 1.2], [1.42, 20.6, 1.3]] as number[][]) {
    const p = arcPt(c, rr, t);
    kit.addTree('rain', p[0], p[1], s);
  }

  // ---------------------------------------------------------------- the big tree growing out of the tiers, in a raised planter box
  {
    const t = Math.PI / 4, rr = 13.9;
    const p = arcPt(c, rr, t);
    const h = 2.6, s = 1.9, rot = t;
    kit.box('stone', p[0], h / 2, p[1], s, h, s, rot, col('#c9c4b8'), 0.5);
    kit.box('hedge', p[0], h + 0.15, p[1], s - 0.3, 0.35, s - 0.3, rot, col('#ffffff'), 0.5);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const corner = (x: number, z: number): V2 => [p[0] + x * cs + z * sn, p[1] - x * sn + z * cs];
    kit.collision.addPolygon([corner(-s / 2, -s / 2), corner(s / 2, -s / 2), corner(s / 2, s / 2), corner(-s / 2, s / 2)], h, 'concrete', 'oat:planter');
    kit.addTree('rain', p[0], p[1], 1.45);
  }

  // ---------------------------------------------------------------- bunting: thin steel poles on the rim and the stage edge, strings of flags
  const bunt = kit.buf('plaster', c[0] + 10, c[1] - 10);
  const pole = (p: V2, y0: number, h: number) => kit.box('metal', p[0], y0 + h / 2, p[1], 0.05, h, 0.05, 0, col('#6d7075'));
  const lines: [V2, number, V2, number][] = [];
  for (const t of [0.2, 0.62, 1.0, 1.36]) {
    const a = arcPt(c, R_OUT + 0.5, t), b = arcPt(c, stageR - 0.3, t + 0.08);
    pole(a, OAT_TOP, 3.2); pole(b, 0, 4.6);
    lines.push([a, OAT_TOP + 3.1, b, 4.5]);
  }
  for (let i = 0; i < 3; i++) { const a = arcPt(c, R_OUT + 0.5, [0.2, 0.62, 1.0][i]), b = arcPt(c, R_OUT + 0.5, [0.62, 1.0, 1.36][i]); lines.push([a, OAT_TOP + 3.1, b, OAT_TOP + 3.1]); }
  for (const [a, ya, b, yb] of lines) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nf = Math.floor(len / 0.5);
    const sag = Math.min(1.4, len * 0.07);
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
    for (let k = 0; k < nf; k++) {
      const f = (k + 0.5) / nf;
      const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      const y = ya + (yb - ya) * f - Math.sin(f * Math.PI) * sag;
      const colr = rainbow[Math.floor(r() * rainbow.length)];
      const w = 0.16;
      const v = [bunt.vert(x - tx * w, y, z - tz * w, -tz, 0, tx, 0, 0, colr), bunt.vert(x + tx * w, y, z + tz * w, -tz, 0, tx, 1, 0, colr), bunt.vert(x, y - 0.34, z, -tz, 0, tx, 0.5, 1, colr)];
      bunt.tri(v[0], v[2], v[1]);
      const v2 = [bunt.vert(x - tx * w, y, z - tz * w, tz, 0, -tx, 0, 0, colr), bunt.vert(x + tx * w, y, z + tz * w, tz, 0, -tx, 1, 0, colr), bunt.vert(x, y - 0.34, z, tz, 0, -tx, 0.5, 1, colr)];
      bunt.tri(v2[0], v2[1], v2[2]);
    }
  }
}

/** Plan rectangle of thickness `t` centred on segment a→b. */
function segQuad(a: V2, b: V2, t: number): V2[] {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * t * 0.5, nz = (dx / l) * t * 0.5;
  return [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]];
}

void THREE;
