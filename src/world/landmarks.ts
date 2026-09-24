import * as THREE from 'three';
import { GeoBuffer } from './buildings';
import { normalizeWinding, rng } from './geom';
import { col, type WorldKit } from './kit';
import { hedgeBox } from './landscape';
import { BUILDINGS, FOUNTAIN_POS, GATES, MAIN_GATE_PORTAL, pesRdZ, type V2 } from './layout';
import { netTexture } from './materials';
import type { SignUVs } from './signs';

export interface GateVisual { panels: THREE.Object3D[]; prismIds: number[]; closedPos: THREE.Vector3[]; openOffset: THREE.Vector3; openOffsets?: THREE.Vector3[] }

const WHITE = col('#f6f5f1');
const STEEL_GATE = col('#3a3d40');

// =================================================================================================== main gate
export function buildGate(kit: WorldKit, signs: SignUVs, gates: Map<string, GateVisual>): void {
  const G = MAIN_GATE_PORTAL;
  const x = G.x;
  const sp = G.southPillar, np = G.northPillar;
  const top = G.height;
  // pillars + beam (white plaster), beam underside light grey
  kit.box('plaster', sp.cx, top / 2, sp.cz, sp.size, top, sp.size, 0, WHITE, 0.5);
  kit.box('plaster', np.cx, top / 2, np.cz, np.size, top, np.size, 0, WHITE, 0.5);
  const zA = np.cz - np.size / 2, zB = sp.cz + sp.size / 2;
  kit.box('plaster', x, (G.beamBottom + top) / 2, (zA + zB) / 2, G.beamThick, top - G.beamBottom, zB - zA, 0, WHITE, 0.5);
  kit.box('stone', x, G.beamBottom - 0.02, (zA + zB) / 2, G.beamThick - 0.1, 0.04, zB - zA - 0.1, 0, col('#c9c9c6'));
  const sq = (cx: number, cz: number, s: number): V2[] => [[cx - s / 2, cz - s / 2], [cx + s / 2, cz - s / 2], [cx + s / 2, cz + s / 2], [cx - s / 2, cz + s / 2]];
  kit.collision.addPolygon(sq(sp.cx, sp.cz, sp.size), top, 'concrete', 'gatePillar');
  kit.collision.addPolygon(sq(np.cx, np.cz, np.size), top, 'concrete', 'gatePillar');
  kit.collision.addPolygon([[x - G.beamThick / 2, zA], [x + G.beamThick / 2, zA], [x + G.beamThick / 2, zB], [x - G.beamThick / 2, zB]], top - G.beamBottom, 'concrete', 'gateBeam', G.beamBottom);
  // signage: beam faces, vertical maroon text on the south pillar, event banner on the north pillar
  const beamLen = zB - zA, beamY = (G.beamBottom + top) / 2;
  kit.signQuad(signs.gateBeamEast, x + G.beamThick / 2 + 0.02, beamY, (zA + zB) / 2, beamLen - 0.2, (top - G.beamBottom) - 0.1, 1, 0, true);
  kit.signQuad(signs.gateBeamWest, x - G.beamThick / 2 - 0.02, beamY, (zA + zB) / 2, beamLen - 0.2, (top - G.beamBottom) - 0.1, -1, 0, true);
  kit.signQuad(signs.gatePillarText, sp.cx + sp.size / 2 + 0.02, 4.4, sp.cz - sp.size / 2 + 0.7, 6.6, 0.82, 1, 0, true, -Math.PI / 2);
  kit.signQuad(signs.gatePillarText, sp.cx - sp.size / 2 - 0.02, 4.4, sp.cz - sp.size / 2 + 0.7, 6.6, 0.82, -1, 0, true, -Math.PI / 2);
  kit.signQuad(signs.gateBanner, np.cx + np.size / 2 + 0.03, 5.4, np.cz, 3.2, 4.0, 1, 0, false);
  // pedestrian door (dark slatted gate) + red sign plate in the south pillar, both faces
  for (const s of [1, -1]) {
    const fx = sp.cx + s * (sp.size / 2 + 0.03);
    kit.box('metal', fx, 1.15, sp.cz - 0.2, 0.06, 2.3, 1.3, 0, STEEL_GATE);
    for (let k = 0; k < 6; k++) kit.box('metal', fx + s * 0.03, 1.15, sp.cz - 0.75 + k * 0.22, 0.04, 2.2, 0.08, 0, col('#26292c'));
    kit.box('stone', fx, 2.85, sp.cz - 0.2, 0.05, 0.35, 0.6, 0, col('#c1261c'));
  }
  // median island between the IN and OUT leaves: kerbed, guard booth, boom barrier inside the IN lane
  const M = G.median;
  kit.box('stone', (M.x0 + M.x1) / 2, 0.13, (M.z0 + M.z1) / 2, M.x1 - M.x0, 0.26, M.z1 - M.z0, 0, col('#a8a49c'));
  kit.collision.addPolygon([[M.x0, M.z0], [M.x1, M.z0], [M.x1, M.z1], [M.x0, M.z1]], 1.1, 'concrete', 'median');
  kit.box('plaster', M.x0 + 2.2, 1.35, (M.z0 + M.z1) / 2, 1.3, 2.4, 1.25, 0, WHITE);
  kit.box('plaster', M.x0 + 2.2, 2.62, (M.z0 + M.z1) / 2, 1.6, 0.14, 1.5, 0, col('#2d59a8'));
  kit.box('glass', M.x0 + 2.2, 1.7, (M.z0 + M.z1) / 2, 1.34, 0.7, 1.29, 0, col('#34424e'));
  kit.signQuad(signs.guardBooth, M.x0 + 2.2, 2.25, M.z1 + 0.01, 1.1, 0.35, 0, 1, true);
  const boomX = M.x0 + 0.5;
  kit.box('stone', boomX, 0.55, M.z1 - 0.25, 0.35, 1.1, 0.35, 0, col('#c1261c'));
  for (let k = 0; k < 8; k++) kit.box('stone', boomX, 1.0, M.z1 + 0.5 + k, 0.1, 0.1, 1, 0, k % 2 ? col('#f2f2ee') : col('#c1261c'));
  // gate leaves (moving parts): IN = south lane, OUT = north lane; plus the west gate (two leaves)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.65, roughness: 0.45 });
  const makeLeaf = (len: number): THREE.BufferGeometry => {
    const pg = new GeoBuffer();
    pg.box(0, 0.12, 0, len, 0.12, 0.1);
    pg.box(0, 2.15, 0, len, 0.12, 0.1);
    pg.box(0, 1.15, 0, len, 0.08, 0.08);
    for (const e of [-1, 1]) pg.box((e * len) / 2, 1.1, 0, 0.12, 2.2, 0.12);
    for (let s = -len / 2 + 0.12; s <= len / 2 - 0.1; s += 0.14) pg.box(s, 1.15, 0, 0.07, 2.0, 0.035);
    for (let s = -len / 2 + 0.2; s < len / 2; s += 1.8) pg.box(s, 0.05, 0, 0.18, 0.1, 0.18); // rollers
    return pg.toGeometry();
  };
  for (const gate of GATES) {
    const panels: THREE.Object3D[] = [], prismIds: number[] = [], closedPos: THREE.Vector3[] = [], openOffsets: THREE.Vector3[] = [];
    const dx = gate.b[0] - gate.a[0], dz = gate.b[1] - gate.a[1];
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const rot = Math.atan2(-dz, dx);
    // leaf spans along the gate line (t from a)
    const spans: [number, number][] = gate.id === 'main'
      ? [[G.lanes[1].z0 - gate.a[1], G.lanes[1].z1 - gate.a[1]], [G.lanes[0].z0 - gate.a[1], G.lanes[0].z1 - gate.a[1]]] // OUT (north), IN (south)
      : [[0, len / 2], [len / 2, len]];
    spans.forEach(([t0, t1], k) => {
      const l = Math.abs(t1 - t0);
      const tm = (t0 + t1) / 2;
      const mesh = new THREE.Mesh(makeLeaf(l - 0.05), panelMat);
      const pos = new THREE.Vector3(gate.a[0] + ux * tm, 0, gate.a[1] + uz * tm);
      mesh.position.copy(pos);
      mesh.rotation.y = rot;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = `gate:${gate.id}:${k}`;
      kit.group.add(mesh);
      panels.push(mesh);
      closedPos.push(pos.clone());
      const a: V2 = [gate.a[0] + ux * t0, gate.a[1] + uz * t0], b: V2 = [gate.a[0] + ux * t1, gate.a[1] + uz * t1];
      prismIds.push(kit.collision.addSegment(a, b, 0.5, 2.4, 'metal', `gate:${gate.id}`));
      // per-leaf slide direction: first leaf toward a, second toward b (into the pillars)
      openOffsets.push(new THREE.Vector3(ux * (k === 0 ? -1 : 1) * l, 0, uz * (k === 0 ? -1 : 1) * l));
    });
    gates.set(gate.id, { panels, prismIds, closedPos, openOffset: new THREE.Vector3(ux, 0, uz), openOffsets });
  }
}

// =================================================================================================== mural building
export function buildMurals(kit: WorldKit, signs: SignUVs): void {
  const adm = BUILDINGS.find((b) => b.id === 'admission');
  if (!adm) return;
  // outer mural: along the outside north face (admission block x 178.3–184, mural wing x 184–199.8)
  const x0 = 178.3, xm = 184, x1 = 199.8;
  const zAt = (x: number) => (x <= xm ? -120.55 - ((x - 156.2) / 27.8) * 0.05 : -120.6 - ((x - 184) / 16) * 0.6);
  const [u0, v0, u1, v1] = signs.muralOuter;
  const f = (xm - x0) / (x1 - x0);
  kit.signQuad([u0, v0, u0 + (u1 - u0) * f, v1], (x0 + xm) / 2, 6.0, zAt((x0 + xm) / 2) - 0.04, xm - x0, 10.6, 0, -1, false);
  kit.signQuad([u0 + (u1 - u0) * f, v0, u1, v1], (xm + x1) / 2, 6.0, zAt((xm + x1) / 2) - 0.04, x1 - xm, 10.6, -0.0375, -1, false);
  // protruding wooden cubes (relief)
  const r = rng(1020);
  for (let i = 0; i < 52; i++) {
    const s = 0.35 + r() * 0.35;
    const y = 1.2 + r() * 9.5;
    const x = x0 + 0.5 + r() * (x1 - x0 - 1);
    const tan = col('#c89a62').multiplyScalar(0.85 + r() * 0.25);
    kit.box('wood', x, y, zAt(x) - s / 2 - 0.02, s, s, s, x > xm ? 0.0375 : 0, tan, 0.5);
  }
  // inner mural: blue pixel-tile wall with compass rose + graduates on the campus-facing west face
  kit.signQuad(signs.muralInner, 156.2 - 0.03, 7.0, (-120.5 + -106.6) / 2, 13.4, 13.4, -1, 0, false);
}

// =================================================================================================== PES sign bridge, ramp, landing
export function buildPesBridge(kit: WorldKit, signs: SignUVs): void {
  const parapet = col('#55595e'), side = col('#8d8f90'), deck = col('#3f4347'), buff = col('#cdbda3');
  // ramp rising west from the east plaza (x 104 → 84) up to a landing at +3.5 m
  const z0 = -136.5, z1 = -131.5, xFoot = 104, xTop = 84, H = 3.5;
  const b = kit.buf('stone', 94, -134);
  const slope = (x: number) => H * (xFoot - x) / (xFoot - xTop);
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const xa = xFoot - (xFoot - xTop) * (i / steps), xb = xFoot - (xFoot - xTop) * ((i + 1) / steps);
    const ya = slope(xa), yb = slope(xb);
    // deck (sloped quad, buff pavers)
    const n = new THREE.Vector3(ya - yb, xa - xb, 0).normalize();
    const i0 = b.vert(xa, ya, z1, n.x, n.y, n.z, xa, z1, buff), i1 = b.vert(xa, ya, z0, n.x, n.y, n.z, xa, z0, buff);
    const i2 = b.vert(xb, yb, z0, n.x, n.y, n.z, xb, z0, buff), i3 = b.vert(xb, yb, z1, n.x, n.y, n.z, xb, z1, buff);
    b.quad(i0, i3, i2, i1);
    // side walls + parapets (dark grey, solid to the ground)
    for (const [z, s] of [[z0 - 0.15, -1], [z1 + 0.15, 1]] as [number, number][]) {
      const t0 = b.vert(xa, 0, z, 0, 0, s, xa, 0, side), t1 = b.vert(xb, 0, z, 0, 0, s, xb, 0, side);
      const t2 = b.vert(xb, yb + 1.1, z, 0, 0, s, xb, 1, parapet), t3 = b.vert(xa, ya + 1.1, z, 0, 0, s, xa, 1, parapet);
      if (s > 0) b.quad(t0, t3, t2, t1); else b.quad(t0, t1, t2, t3);
      const c0 = b.vert(xa, ya + 1.1, z - 0.15, 0, 1, 0, 0, 0, parapet), c1 = b.vert(xb, yb + 1.1, z - 0.15, 0, 1, 0, 0, 0, parapet);
      const c2 = b.vert(xb, yb + 1.1, z + 0.15, 0, 1, 0, 0, 0, parapet), c3 = b.vert(xa, ya + 1.1, z + 0.15, 0, 1, 0, 0, 0, parapet);
      b.quad(c0, c3, c2, c1);
      // inner face of the parapet above the deck
      const k0 = b.vert(xa, ya, z - s * 0.15, 0, 0, -s, 0, 0, parapet), k1 = b.vert(xb, yb, z - s * 0.15, 0, 0, -s, 0, 0, parapet);
      const k2 = b.vert(xb, yb + 1.1, z - s * 0.15, 0, 0, -s, 0, 0, parapet), k3 = b.vert(xa, ya + 1.1, z - s * 0.15, 0, 0, -s, 0, 0, parapet);
      if (s > 0) b.quad(k0, k1, k2, k3); else b.quad(k0, k3, k2, k1);
    }
  }
  kit.collision.addPolygon([[xTop, z0 - 0.3], [xFoot, z0 - 0.3], [xFoot, z1 + 0.3], [xTop, z1 + 0.3]], H + 1.1, 'concrete', 'ramp');
  // landing platform (+3.5 m) and the stair/lift tower that carries the sign bridge
  const lx0 = 78.9, lx1 = xTop, lz0 = -137.8, lz1 = -129.8;
  kit.box('stone', (lx0 + lx1) / 2, H / 2, (lz0 + lz1) / 2, lx1 - lx0, H, lz1 - lz0, 0, parapet);
  kit.box('stone', (lx0 + lx1) / 2, H + 0.05, (lz0 + lz1) / 2, lx1 - lx0 + 0.1, 0.1, lz1 - lz0 + 0.1, 0, buff);
  kit.segBox('stone', [lx0, lz1], [lx1, lz1], H, H + 1.1, 0.3, parapet);
  kit.collision.addPolygon([[lx0, lz0], [lx1, lz0], [lx1, lz1], [lx0, lz1]], H + 1.1, 'concrete', 'landing');
  const tx0 = 78.9, tx1 = 82.4, tz0 = -141.2, tz1 = -137.8, tH = 11.3;
  kit.box('stone', (tx0 + tx1) / 2, tH / 2, (tz0 + tz1) / 2, tx1 - tx0, tH, tz1 - tz0, 0, col('#f0efea'));
  kit.box('glass', tx1 + 0.02, 6.5, (tz0 + tz1) / 2, 0.05, 7, 1.6, 0, col('#34424e'));
  kit.collision.addPolygon([[tx0, tz0], [tx1, tz0], [tx1, tz1], [tx0, tz1]], tH, 'concrete', 'tower');
  // the bridge deck (8 m) from the GJBC north-east block to the tower, glazed, with the big sign box on top
  const bx0 = 78.9, bx1 = 82.4, bzS = pesRdZ(80) - 5.4 - 0.2, bzN = -141.2;
  kit.box('stone', (bx0 + bx1) / 2, 8.4, (bzS + bzN) / 2, bx1 - bx0, 0.8, bzS - bzN, 0, deck);
  kit.box('glass', (bx0 + bx1) / 2, 9.95, (bzS + bzN) / 2, bx1 - bx0 - 0.1, 2.3, bzS - bzN - 0.2, 0, col('#40505c'));
  kit.box('metal', bx1 - 0.05, 9.0, (bzS + bzN) / 2, 0.08, 0.06, bzS - bzN, 0, col('#9aa0a6'));
  const sz0 = -141.4, sz1 = -123.4, sy0 = 11.1, sy1 = 14.9;
  kit.box('plaster', (bx0 + bx1) / 2, (sy0 + sy1) / 2, (sz0 + sz1) / 2, bx1 - bx0, sy1 - sy0, sz1 - sz0, 0, col('#fbfbf8'));
  kit.signQuad(signs.pesBridge, bx1 + 0.02, (sy0 + sy1) / 2, (sz0 + (bzS - 0.5)) / 2, (bzS - 0.5 - sz0) * 0.98, 3.2, 1, 0, true);
  kit.collision.addPolygon([[bx0, bzN], [bx1, bzN], [bx1, bzS], [bx0, bzS]], sy1 - 8, 'concrete', 'bridge', 8);
  // east–west bridge from the deck over the MRD loop road into the MRD south-east wing
  const wz0 = -136.8, wz1 = -133.2, wx0 = 67.4;
  kit.box('stone', (wx0 + bx0) / 2, 8.4, (wz0 + wz1) / 2, bx0 - wx0, 0.8, wz1 - wz0, 0, deck);
  kit.box('glass', (wx0 + bx0) / 2, 9.9, (wz0 + wz1) / 2, bx0 - wx0, 2.2, wz1 - wz0 - 0.1, 0, col('#40505c'));
  kit.box('stone', (wx0 + bx0) / 2, 11.15, (wz0 + wz1) / 2, bx0 - wx0 + 0.3, 0.3, wz1 - wz0 + 0.4, 0, deck);
  kit.collision.addPolygon([[wx0, wz0], [bx0, wz0], [bx0, wz1], [wx0, wz1]], 3.5, 'concrete', 'bridge', 8);
}

// =================================================================================================== B-Block skybridges + crest
export function buildBBlockBits(kit: WorldKit, signs: SignUVs): void {
  const dark = col('#3b3f44');
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
  bridge(-40, -101.2, -112.0, 14);
  bridge(-22, -103.4, -113.1, 32);
  // crest tower: deep recessed slot + white box sign (orange logo + red Kannada) facing east
  const T = BUILDINGS.find((b) => b.id === 'bblock_tower');
  if (T) {
    kit.box('dark', -8.3, 31, -131.5, 0.3, 46, 1.8, Math.atan2(0.95, 15), col('#4a4238'));
    kit.box('plaster', -11.2, 59.2, -131.5, 2.2, 3.4, 9.4, 0, col('#fbfbf8'));
    kit.signQuad(signs.bblockCrest, -10.08, 59.2, -131.5, 9.2, 3.1, 1, 0, true);
    kit.signQuad(signs.bblockCrest, -12.32, 59.2, -131.5, 9.2, 3.1, -1, 0, true);
    kit.box('metal', -11.2, 57.2, -131.5, 0.3, 0.6, 8, 0, col('#555'));
  }
  // B-Block: projecting cornice at the top + balcony band at the 10th floor
  const B = BUILDINGS.find((b) => b.id === 'bblock');
  if (B) {
    const p = normalizeWinding(B.poly);
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      const nx = -dz / len, nz = dx / len;
      const rot = Math.atan2(-dz, dx);
      for (const [y, d, t, colr] of [[49.1, 0.9, 0.5, col('#e2d6c4')], [35.2, 1.3, 0.3, col('#dccfbc')], [7.1, 0.4, 0.3, col('#9e8b7c')]] as [number, number, number, THREE.Color][]) {
        kit.box('stone', (a[0] + c[0]) / 2 + nx * d / 2, y, (a[1] + c[1]) / 2 + nz * d / 2, len + d, t, d, rot, colr);
      }
      kit.box('metal', (a[0] + c[0]) / 2 + nx * 1.25, 36.0, (a[1] + c[1]) / 2 + nz * 1.25, len, 1.0, 0.05, rot, col('#5d6166'));
    }
  }
}

// =================================================================================================== MRD refurb
export function buildMRD(kit: WorldKit, signs: SignUVs): void {
  const mrd = BUILDINGS.find((b) => b.id === 'mrd');
  if (!mrd) return;
  // east entrance on the face (59.9,−139.3)→(66.7,−150.5): forecourt + white granite steps + glazing + navy canopy
  const A: V2 = [59.9, -139.3], B: V2 = [66.7, -150.5];
  const dx = B[0] - A[0], dz = B[1] - A[1], len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const nx = -uz, nz = ux; // outward (east-south-east)
  const sgn = nx > 0 ? 1 : -1;
  const ox = nx * sgn, oz = nz * sgn;
  const mid: V2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const W = 17, fore = 3.2, nSteps = 13, tread = 0.34, rise = 0.15;
  const rot = Math.atan2(-uz, ux);
  const P = (along: number, out: number): V2 => [mid[0] + ux * along + ox * out, mid[1] + uz * along + oz * out];
  const topY = nSteps * rise;
  // forecourt slab (green marble top)
  { const c = P(0, fore / 2); kit.box('polished', c[0], topY / 2, c[1], W, topY, fore, rot, col('#e4e2dc'), 0.5); kit.box('polished', c[0], topY + 0.01, c[1], W - 0.2, 0.02, fore - 0.2, rot, col('#5f7468'), 0.5); }
  for (let k = 0; k < nSteps; k++) {
    const out = fore + (nSteps - k - 0.5) * tread;
    const c = P(0, out);
    kit.box('polished', c[0], ((k + 1) * rise) / 2, c[1], W, (k + 1) * rise, tread + 0.01, rot, col('#e9e7e1').multiplyScalar(0.96 + (k % 2) * 0.04), 0.5);
  }
  const depth = fore + nSteps * tread;
  kit.collision.addPolygon([P(-W / 2, 0), P(W / 2, 0), P(W / 2, depth), P(-W / 2, depth)], topY, 'concrete', 'steps');
  // glazed ground floor with blue-grey mullions
  const g0 = P(0, 0.08);
  kit.box('glass', g0[0], topY + 1.95, g0[1], W - 3, 3.9, 0.12, rot, col('#2c3642'));
  for (let s = -W / 2 + 1.5; s <= W / 2 - 1.4; s += 3.4) { const c = P(s, 0.25); kit.box('stone', c[0], topY + 1.95, c[1], 0.55, 3.9, 0.45, rot, col('#4f6d8c')); }
  // name band above the glazing + big sloping navy canopy
  const sb = P(0, 0.2);
  kit.box('stone', sb[0], topY + 4.35, sb[1], W - 1, 0.9, 0.3, rot, col('#1f2b45'));
  kit.signQuad(signs.mrdCanopy, sb[0] + ox * 0.17, topY + 4.35, sb[1] + oz * 0.17, W - 1.4, 0.86, ox, oz, true);
  const cb = new GeoBuffer({ color: true });
  const navy = col('#1f2b45');
  const cp = (along: number, out: number, y: number): [number, number, number] => { const p = P(along, out); return [p[0], y, p[1]]; };
  const q = [cp(-W / 2 - 2, 0, topY + 5.0), cp(W / 2 + 2, 0, topY + 5.0), cp(W / 2 + 2, 5.2, topY + 6.4), cp(-W / 2 - 2, 5.2, topY + 6.4)];
  const nrm = new THREE.Vector3(-ox * 0.26, -0.96, -oz * 0.26);
  const ids = q.map((p) => cb.vert(p[0], p[1], p[2], nrm.x, nrm.y, nrm.z, 0, 0, navy));
  cb.quad(ids[0], ids[3], ids[2], ids[1]);
  cb.quad(ids[0], ids[1], ids[2], ids[3]);
  const buf = kit.buf('stone', mid[0], mid[1]);
  const base = buf.vertexCount;
  cb.pos.forEach((v, i) => { if (i % 3 === 0) buf.vert(cb.pos[i], cb.pos[i + 1], cb.pos[i + 2], cb.nrm[i], cb.nrm[i + 1], cb.nrm[i + 2], 0, 0, navy); });
  for (const i of cb.idx) buf.idx.push(base + i);
  { const f = P(0, 5.25); kit.box('stone', f[0], topY + 6.2, f[1], W + 4, 0.7, 0.3, rot, navy); }
  // navy cantilever slabs on the stone towers (SE wing + north-east block)
  for (const [x, z, w, d, y, r] of [[56, -131.2, 12, 3, 15.8, Math.atan2(5.8, 21.8)], [73, -158.5, 9, 2.8, 12.2, Math.atan2(-11.3, 6.8)]] as number[][]) {
    kit.box('stone', x, y, z, w, 0.6, d, r, navy);
  }
  // perforated metal roof screen (dark grey) along the east faces
  kit.segBox('metal', [59.9, -139.3], [73.5, -161.8], 22.8, 24.4, 0.1, col('#4a4e53'), 0.3);
  scaffolding(kit);
}

function scaffolding(kit: WorldKit): void {
  const mrd = BUILDINGS.find((b) => b.id === 'mrd')!;
  const H = (mrd.floorH ?? 3.8) * mrd.floors + 1.5;
  const p = normalizeWinding(mrd.poly);
  // edges picked by their midpoints (SE wing south + east faces, the east block north of the entrance)
  const targets: V2[] = [[56, -129], [70.1, -156.2], [77.2, -162.9]];
  const tube = kit.instSet('scaffoldTube', () => ({
    geo: new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 1, true).translate(0, 0.5, 0),
    mat: new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.5 }),
    cast: true, colored: true,
  }));
  const rust = col('#b0703a'), grey = col('#8a8d90');
  const up = new THREE.Vector3(0, 1, 0);
  const addTube = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Color) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const l = d.length();
    if (l < 0.01) return;
    const qq = new THREE.Quaternion().setFromUnitVectors(up, d.divideScalar(l));
    kit.addInstMatrix(tube, new THREE.Matrix4().compose(a, qq, new THREE.Vector3(1, l, 1)), c);
  };
  const nets = new GeoBuffer();
  for (const t of targets) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const d = Math.hypot((a[0] + b[0]) / 2 - t[0], (a[1] + b[1]) / 2 - t[1]);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0 || bd > 6) continue;
    const a = p[best], b = p[(best + 1) % p.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const r = rng(Math.round(t[0] * 13 - t[1] * 7));
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
    // transoms + planks every other level, diagonal braces on the outer face
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
    // green safety nets on random vertical strips of the outer face
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
    // collision: the scaffold band is not walkable
    kit.collision.addSegment([a[0] + nx * 1.5, a[1] + nz * 1.5], [b[0] + nx * 1.5, b[1] + nz * 1.5], 1.9, H, 'metal', 'scaffold');
    // construction material at the base
    for (let k = 0; k < 3; k++) {
      const f = 0.2 + r() * 0.6;
      const cx = a[0] + dx * f + nx * 3.6, cz = a[1] + dz * f + nz * 3.6;
      kit.box('stone', cx, 0.3, cz, 1.2 + r(), 0.6, 0.8 + r() * 0.5, Math.atan2(-dz, dx), col('#b8b2a4'));
    }
  }
  if (nets.vertexCount) {
    const tex = netTexture();
    const m = new THREE.Mesh(nets.toGeometry(), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.9 }));
    m.castShadow = false; m.receiveShadow = true; m.name = 'mrd:nets';
    kit.group.add(m);
  }
}

// =================================================================================================== Open Air Theatre + fountains + misc
export function buildOAT(kit: WorldKit): void {
  const oc: V2 = [5, -122];
  const tierR0 = 8, tierStep = 1.8, tierCount = 9;
  const stripes = [col('#e94b3c'), col('#f2c200'), col('#2d9cdb'), col('#27ae60'), col('#f08a24'), col('#9b59b6')];
  for (let k = 0; k < tierCount; k++) {
    const r0 = tierR0 + k * tierStep, r1 = r0 + tierStep, h = 0.38 * (k + 1);
    const seg = 10 + k * 2;
    const c = stripes[k % stripes.length];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 0.5, a1 = ((i + 1) / seg) * Math.PI * 0.5;
      const am = (a0 + a1) / 2, rm = (r0 + r1) / 2;
      const x = oc[0] + Math.cos(am) * rm, z = oc[1] - Math.sin(am) * rm;
      const chord = 2 * rm * Math.sin((a1 - a0) / 2) + 0.08;
      kit.box('stone', x, h / 2, z, chord, h, r1 - r0, Math.atan2(Math.cos(am), -Math.sin(am)), c, 0.5);
    }
  }
  const tierPoly: V2[] = [];
  const rOut = tierR0 + tierCount * tierStep;
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 0.5; tierPoly.push([oc[0] + Math.cos(a) * rOut, oc[1] - Math.sin(a) * rOut]); }
  for (let i = 8; i >= 0; i--) { const a = (i / 8) * Math.PI * 0.5; tierPoly.push([oc[0] + Math.cos(a) * tierR0, oc[1] - Math.sin(a) * tierR0]); }
  kit.collision.addPolygon(tierPoly, 0.38 * tierCount, 'concrete', 'theatre');
  // grey stone retaining wall behind the top tier (the seating is set into the slope) + shrubs on top
  const segs = 18;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 0.5, a1 = ((i + 1) / segs) * Math.PI * 0.5;
    const p0: V2 = [oc[0] + Math.cos(a0) * (rOut + 0.25), oc[1] - Math.sin(a0) * (rOut + 0.25)];
    const p1: V2 = [oc[0] + Math.cos(a1) * (rOut + 0.25), oc[1] - Math.sin(a1) * (rOut + 0.25)];
    kit.segBox('stone', p0, p1, 0, 0.38 * tierCount + 0.5, 0.5, col('#8f8a82'), 0, 0.1, 0.5);
    hedgeBox(kit, 'hedge', p0, p1, 0.38 * tierCount + 0.5, 0.38 * tierCount + 1.3, 0.8);
  }
  kit.box('stone', oc[0] + 3, 0.3, oc[1] - 3, 5.5, 0.6, 5.5, Math.PI / 4, col('#b8b1a6'), 0.5);
  // colourful bunting strung across the tiers
  const bunt = kit.buf('stone', 12, -130);
  const r = rng(636);
  for (let line = 0; line < 3; line++) {
    const a0 = 0.15 + line * 0.5, rr = 12 + line * 3.5;
    const pA: V2 = [oc[0] + Math.cos(a0) * rr, oc[1] - Math.sin(a0) * rr], pB: V2 = [oc[0] + Math.cos(a0 + 0.7) * rr, oc[1] - Math.sin(a0 + 0.7) * rr];
    for (let k = 0; k < 16; k++) {
      const f = (k + 0.5) / 16;
      const x = pA[0] + (pB[0] - pA[0]) * f, z = pA[1] + (pB[1] - pA[1]) * f;
      const y = 5.2 + line * 0.4 - Math.sin(f * Math.PI) * 0.9;
      bunt.box(x, y - 0.18, z, 0.3, 0.36, 0.02, Math.atan2(-(pB[1] - pA[1]), pB[0] - pA[0]), stripes[Math.floor(r() * stripes.length)]);
    }
  }
}

export function buildFountains(kit: WorldKit): void {
  const conc = col('#c9c3b8');
  for (const [fx, fz, rr] of [[FOUNTAIN_POS[0], FOUNTAIN_POS[1], 3.2], [4, 36, 2.2]] as [number, number, number][]) {
    kit.buf('stone', fx, fz).cylinder(fx, 0, fz, rr, 0.55, 28, conc);
    kit.buf('stone', fx, fz).cylinder(fx, 0, fz, 0.35, 1.4, 10, conc);
    const water = new THREE.Mesh(new THREE.CircleGeometry(rr - 0.25, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1f3a44, roughness: 0.05, metalness: 0.9 }));
    water.position.set(fx, 0.45, fz);
    water.matrixAutoUpdate = false; water.updateMatrix();
    kit.group.add(water);
    kit.collision.addCircle(fx, fz, rr, 0.55, 'concrete', 'fountain');
  }
}

/** F-Block roof sign + podium detail, admission-building compound wall, security cabin door. */
export function buildMisc(kit: WorldKit, signs: SignUVs): void {
  // F-Block tower: "PES" roof sign facing north (towards GJBC's east colonnade)
  kit.box('plaster', 118, 37.6, 48.6, 7.2, 2.6, 0.4, 0.1, col('#fbfbf8'));
  kit.signQuad(signs.fBlockRoof, 118.02, 37.6, 48.38, 6.8, 2.5, -0.1, -1, true);
  kit.box('metal', 118, 35.6, 48.8, 6, 1.4, 0.2, 0.1, col('#555'));
  // security cabin: blue door facing the road
  kit.box('stone', 168.25, 1.05, -141.95, 0.9, 2.1, 0.08, 0, col('#2d59a8'));
  // low hedge beside the security cabin, inside the north pillar
  hedgeBox(kit, 'hedge', [171.2, -145.9], [173.6, -145.9], 0, 1.0, 0.8);
}

/** All landmark builders in dependency order. */
export function buildLandmarksAll(kit: WorldKit, signs: SignUVs, gates: Map<string, GateVisual>): void {
  buildGate(kit, signs, gates);
  buildMurals(kit, signs);
  buildPesBridge(kit, signs);
  buildBBlockBits(kit, signs);
  buildMRD(kit, signs);
  buildOAT(kit);
  buildFountains(kit);
  buildMisc(kit, signs);
}
