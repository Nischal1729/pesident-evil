import * as THREE from 'three';
import { col, type WorldKit } from '../kit';
import { driveNorthZ, FRONT_RAMP, GJB_L1, type V2 } from '../layout';
import type { SignUVs } from '../signs';
import { raisedPlanter, rect, segPoly } from './util';

/**
 * The GJBC front ramp + PES signboard (reference/GJB_NOTES.md §2; GJB tour 0:33–0:36, 0:52, 1:52–2:06; old tour 0208,
 * 1912). A long pedestrian ramp in striped pavers with dark-grey solid parapets rises west from the east plaza to an L1
 * landing beside the porte-cochère. The landing is a slab over the road junction (walk under it today) that joins the
 * L1 porch over the drive-through, so the ramp takes you to the GJBC 1st floor (covered plaza → Quad). A canopy covers
 * the landing between the stair/lift tower and the porch roof, and a glazed L1 bridge continues west over the MRD loop
 * road into MRD's south-east wing. The big white "PES UNIVERSITY" signboard is NOT here: it sits on the skybridge
 * between MRD's NE and SE towers (src/world/mrd.ts `pesSignBridge`, key frames 0208 / 0230; MRD/BE agent).
 */
export function buildFrontRamp(kit: WorldKit, signs: SignUVs): void {
  const R = FRONT_RAMP, L1 = GJB_L1;
  const c = kit.collision;
  const parapet = col('#55595e'), side = col('#8d8f90'), deck = col('#3f4347'), buff = col('#cdbda3');
  const { xFoot, xTop, z0, z1 } = R;
  const zc = (z0 + z1) / 2;
  // --- the ramp: sloped paver deck, side walls solid to the ground, 1.1 m parapets with a granite coping
  const b = kit.buf('stone', (xFoot + xTop) / 2, zc);
  // the foot stands on the entry road partway up its slope (layout.ts TERRAIN), so the ramp climbs from there to L1
  const slope = (x: number) => R.footY + (L1 - R.footY) * (xFoot - x) / (xFoot - xTop);
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const xa = xFoot - (xFoot - xTop) * (i / steps), xb = xFoot - (xFoot - xTop) * ((i + 1) / steps);
    const ya = slope(xa), yb = slope(xb);
    const n = new THREE.Vector3(ya - yb, xa - xb, 0).normalize();
    const i0 = b.vert(xa, ya, z1, n.x, n.y, n.z, xa, z1, buff), i1 = b.vert(xa, ya, z0, n.x, n.y, n.z, xa, z0, buff);
    const i2 = b.vert(xb, yb, z0, n.x, n.y, n.z, xb, z0, buff), i3 = b.vert(xb, yb, z1, n.x, n.y, n.z, xb, z1, buff);
    b.quad(i0, i1, i2, i3); // counter-clockwise seen from above → faces up
    for (const [z, s] of [[z0 - 0.15, -1], [z1 + 0.15, 1]] as [number, number][]) {
      const t0 = b.vert(xa, 0, z, 0, 0, s, xa, 0, side), t1 = b.vert(xb, 0, z, 0, 0, s, xb, 0, side);
      const t2 = b.vert(xb, yb + 1.1, z, 0, 0, s, xb, 1, parapet), t3 = b.vert(xa, ya + 1.1, z, 0, 0, s, xa, 1, parapet);
      if (s > 0) b.quad(t0, t3, t2, t1); else b.quad(t0, t1, t2, t3);
      const cc = col('#2c2e30');
      const c0 = b.vert(xa, ya + 1.1, z - 0.17, 0, 1, 0, 0, 0, cc), c1 = b.vert(xb, yb + 1.1, z - 0.17, 0, 1, 0, 0, 0, cc);
      const c2 = b.vert(xb, yb + 1.1, z + 0.17, 0, 1, 0, 0, 0, cc), c3 = b.vert(xa, ya + 1.1, z + 0.17, 0, 1, 0, 0, 0, cc);
      b.quad(c0, c3, c2, c1);
      const k0 = b.vert(xa, ya, z - s * 0.15, 0, 0, -s, 0, 0, parapet), k1 = b.vert(xb, yb, z - s * 0.15, 0, 0, -s, 0, 0, parapet);
      const k2 = b.vert(xb, yb + 1.1, z - s * 0.15, 0, 0, -s, 0, 0, parapet), k3 = b.vert(xa, ya + 1.1, z - s * 0.15, 0, 0, -s, 0, 0, parapet);
      if (s > 0) b.quad(k0, k1, k2, k3); else b.quad(k0, k3, k2, k1);
    }
    // recessed step lights in the parapets
    if (i % 2 === 1) for (const z of [z0 + 0.02, z1 - 0.02]) kit.box('emissive', (xa + xb) / 2, (ya + yb) / 2 + 0.35, z, 0.3, 0.08, 0.04, 0, col('#ffffff'));
  }
  c.addRamp(rect(xTop, z0, xFoot, z1), [xFoot, zc], [xTop, zc], R.footY, L1, 'concrete', 'ramp');
  // parapets in stepped pieces so bullets clear the low end (side walls are solid to the ground)
  for (let k = 0; k < 4; k++) {
    const xa = xFoot - ((xFoot - xTop) * k) / 4, xb = xFoot - ((xFoot - xTop) * (k + 1)) / 4;
    for (const z of [z0 - 0.15, z1 + 0.15]) c.addPolygon(segPoly([xb, z], [xa, z], 0.3), slope(xb) + 1.1, 'concrete', 'parapet');
  }
  // --- L1 landing: a slab over the road junction (base 5.5 → walk under it), joining the porch deck on the south
  const Ld = R.landing, NO = driveNorthZ;
  const land: V2[] = [[Ld.x0, Ld.zN], [Ld.x1, Ld.zN], [Ld.x1, NO(84)], [84, NO(84)], [Ld.x0, NO(Ld.x0)]];
  kit.buf('stone', 82, -133).flatPoly(land, L1 + 0.02, buff, 3);
  kit.buf('stone', 82, -133).flatPoly(land, L1 - 0.5, col('#bab8b2'), 3, true);
  c.addPolygon(land, 0.5, 'concrete', 'landing', L1 - 0.5);
  for (const [x, z] of [[85.4, -137.2], [79.5, -130.1], [85.4, -130.1]] as V2[]) {
    kit.box('stone', x, (L1 - 0.5) / 2, z, 0.6, L1 - 0.5, 0.6, 0, side, 0.5);
    c.addCircle(x, z, 0.4, L1 - 0.5, 'concrete', 'column');
  }
  // landing parapets (open to the ramp on the east, to the porch on the south, to the MRD bridge on the west)
  const edge = (a: V2, bb: V2, off: number) => {
    kit.segBox('stone', a, bb, L1 - 0.5, L1 + 1.1, 0.3, parapet, off, 0.15);
    kit.segBox('stone', a, bb, L1 + 1.1, L1 + 1.17, 0.36, col('#2c2e30'), off, 0.15);
    c.addPolygon(segPoly(a, bb, 0.3, off), 1.6, 'concrete', 'parapet', L1 - 0.5);
  };
  edge([82.4, Ld.zN], [Ld.x1, Ld.zN], 0.15);
  edge([Ld.x1, Ld.zN], [Ld.x1, z0 - 0.3], -0.15);
  edge([Ld.x1, z1 + 0.3], [Ld.x1, NO(84)], -0.15);
  edge([Ld.x0, -136.8], [Ld.x0, Ld.zN], -0.15);
  edge([Ld.x0, NO(Ld.x0)], [Ld.x0, -133.2], -0.15);
  // --- stair / lift tower at the north-west corner of the landing (white plaster, glass slot) + founders' statue alcove
  const tx0 = 78.9, tx1 = 82.4, tz0 = -141.2, tz1 = Ld.zN, tH = L1 + 6.8;
  kit.box('plaster', (tx0 + tx1) / 2, tH / 2, (tz0 + tz1) / 2, tx1 - tx0, tH, tz1 - tz0, 0, col('#f0efea'), 0.5);
  kit.box('glass', tx1 + 0.02, L1 + 3, (tz0 + tz1) / 2, 0.05, 5, 1.6, 0, col('#34424e'));
  c.addPolygon(rect(tx0, tz0, tx1, tz1), tH, 'concrete', 'tower');
  // navy wall + granite bench with two seated bronze figures (the founders' statue at the top of the ramp, 2:06)
  const nz = tz1 + 0.08;
  kit.box('plaster', (tx0 + tx1) / 2, L1 + 1.8, nz, tx1 - tx0, 3.6, 0.12, 0, col('#2a3a66'));
  kit.box('polished', (tx0 + tx1) / 2, L1 + 0.25, nz + 0.6, 2.2, 0.5, 0.7, 0, col('#9a9994'), 0.5);
  const bronze = col('#5a4630');
  for (const fx of [(tx0 + tx1) / 2 - 0.5, (tx0 + tx1) / 2 + 0.5]) {
    kit.box('metal', fx, L1 + 0.82, nz + 0.55, 0.42, 0.62, 0.3, 0, bronze);
    kit.box('metal', fx, L1 + 1.3, nz + 0.55, 0.22, 0.26, 0.24, 0, bronze);
    kit.box('metal', fx, L1 + 0.55, nz + 0.85, 0.36, 0.14, 0.5, 0, bronze);
    kit.box('metal', fx, L1 + 0.27, nz + 1.08, 0.3, 0.5, 0.14, 0, bronze);
  }
  c.addPolygon(rect(tx0 + 0.1, nz, tx1 - 0.1, nz + 1.2), 1.5, 'metal', 'statue', L1);
  raisedPlanter(kit, tx0 + 0.5, nz + 1.6, 0.7, L1);
  raisedPlanter(kit, tx1 - 0.5, nz + 1.6, 0.7, L1);
  // --- canopy over the west half of the landing (joins the porch roof)
  const cY = L1 + 5.2, cT = 0.7;
  const canopy = rect(tx0, tz0, tx1, NO(tx1) - 0.3);
  kit.buf('stone', 80.6, -134).flatPoly(canopy, cY + cT, deck, 3);
  kit.buf('stone', 80.6, -134).flatPoly(canopy, cY, col('#6b4a36'), 3, true);
  kit.segBox('stone', [tx1, tz0], [tx1, NO(tx1) - 0.3], cY, cY + cT, 0.3, col('#e8e2d5'), -0.15);
  c.addPolygon(canopy, cT, 'concrete', 'canopy', cY);
  // (the PES signboard box that stood on this canopy moved to MRD's NE–SE sign bridge, see the header)
  void signs;
  // --- glazed L1 bridge west over the MRD loop road into MRD's south-east wing
  const wz0 = -136.8, wz1 = -133.2, wx0 = 67.4;
  kit.box('stone', (wx0 + tx0) / 2, L1 - 0.3, (wz0 + wz1) / 2, tx0 - wx0, 0.6, wz1 - wz0, 0, deck);
  kit.box('glass', (wx0 + tx0) / 2, L1 + 1.4, (wz0 + wz1) / 2, tx0 - wx0, 2.8, wz1 - wz0 - 0.1, 0, col('#40505c'));
  kit.box('stone', (wx0 + tx0) / 2, L1 + 3.0, (wz0 + wz1) / 2, tx0 - wx0 + 0.3, 0.4, wz1 - wz0 + 0.4, 0, deck);
  c.addPolygon(rect(wx0, wz0, tx0, wz1), 3.8, 'concrete', 'bridge', L1 - 0.6);
}
