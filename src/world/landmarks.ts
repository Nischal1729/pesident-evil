import * as THREE from 'three';
import { GeoBuffer } from './buildings';
import { normalizeWinding, rng } from './geom';
import { col, type WorldKit } from './kit';
import { hedgeBox } from './landscape';
import { BUILDINGS, FOUNTAIN_POS, GATES, MAIN_GATE_PORTAL, pesRdZ, PLAYER_SPAWN, type V2 } from './layout';
import { netTexture } from './materials';
import type { SignUVs } from './signs';
import { buildBBlockBits } from './bblock';
import { buildMRD } from './mrd';
import { buildOAT } from './oat';
import { buildFrontRamp } from './gjb/ramp';

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
  // the 1.1 m block runs through the gate line between the leaves: survivors on it are held back at that line
  // (+X is out onto the forecourt), so the median is no way out of the campus
  const medianId = kit.collision.addPolygon([[M.x0, M.z0], [M.x1, M.z0], [M.x1, M.z1], [M.x0, M.z1]], 1.1, 'concrete', 'median');
  kit.collision.setLip(medianId, 1, 0, x);
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
    for (let s = -len / 2 + 0.12; s <= len / 2 - 0.1; s += 0.32) pg.box(s, 1.15, 0, 0.05, 2.0, 0.035);
    for (let s = -len / 2 + 0.2; s < len / 2; s += 1.8) pg.box(s, 0.05, 0, 0.18, 0.1, 0.18); // rollers
    return pg.toGeometry();
  };
  for (const gate of GATES) {
    const panels: THREE.Object3D[] = [], prismIds: number[] = [], closedPos: THREE.Vector3[] = [], openOffsets: THREE.Vector3[] = [];
    const dx = gate.b[0] - gate.a[0], dz = gate.b[1] - gate.a[1];
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const rot = Math.atan2(-dz, dx);
    // outward normal of the gate line (away from the player spawn): the leaf tops are campus boundary (setLip)
    const flip = (PLAYER_SPAWN[0] - gate.a[0]) * -uz + (PLAYER_SPAWN[1] - gate.a[1]) * ux > 0 ? -1 : 1;
    const outX = -uz * flip, outZ = ux * flip;
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
      const id = kit.collision.addSegment(a, b, 0.5, 2.4, 'metal', `gate:${gate.id}`);
      kit.collision.setLip(id, outX, outZ);
      prismIds.push(id);
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
/** The GJBC front ramp to L1 + the PES signboard over its landing (GJB agent; implementation in gjb/ramp.ts). */
export function buildPesBridge(kit: WorldKit, signs: SignUVs): void {
  buildFrontRamp(kit, signs);
}

// =================================================================================================== B-Block (BE block), MRD, Open Air Theatre
// Moved to their own files (MRD/BE agent): bblock.ts (skybridges, crest, BE entrance + lobby), mrd.ts (entrance steps,
// canopy, auditorium roof, scaffolding, food point), oat.ts (tiers, aisles, terrace, stage, bunting). Re-exported here.
export { buildBBlockBits, buildMRD, buildOAT };

// =================================================================================================== fountains + misc
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
  buildOAT(kit, signs);
  buildFountains(kit);
  buildMisc(kit, signs);
}
