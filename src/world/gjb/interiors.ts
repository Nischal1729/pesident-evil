import * as THREE from 'three';
import { GeoBuffer } from '../buildings';
import { col, type WorldKit } from '../kit';
import { planterCube } from '../landscape';
import { GJB_G, GJB_INTERIORS, GJB_L1, gjbcEastX, type V2 } from '../layout';
import { buildEastBlock } from './eastblock';
import { doorFrame } from './rooms';
import { GroupKit, rect, segPoly } from './util';

/**
 * Enterable GJBC interiors on the east side (reference/GJB_NOTES.md §5):
 *  - the east entrance lobby behind the cream portal (G: walnut slat wall + reception desk, lift doors, a door west
 *    into the ground-floor wing, and the grand stair up into the L1 admission hall through the atrium void);
 *  - the east entrance block above it (L1 admission hall, L2 lounge and classrooms: eastblock.ts);
 *  - the cafeteria under the Faculty of Law terrace (glass front to the promenade, long oak tables, LED ring lights).
 * Real openings replace the facade-shader windows: the lobby and the block above it sit under `gjb_breezeway` (base =
 * the arcade soffit) and the cafeteria under `gjb_cafe_top` / `gjb_law_cafe` (base = 4.5), so the extruded buildings
 * leave those floors open and the walls, glazing, floors and ceilings here are built by hand. The ground-floor wing
 * under the Quad is ground.ts. Each fit-out is one distance-culled LOD; when the camera is far away an opaque
 * dark-glass stand-in closes the glazed fronts instead.
 */
const E = gjbcEastX;
const CULL = 85;

export function buildGjbInteriors(kit: WorldKit): void {
  lobby(kit);
  buildEastBlock(kit);
  cafeteria(kit);
}

/** Opaque dark glass stand-in for a glazed front (one quad strip), shown only when the interior is culled. */
function farFront(kit: WorldKit, pts: V2[], h: number): THREE.Mesh {
  const g = new GeoBuffer({ color: true });
  for (let i = 1; i < pts.length; i++) g.wallQuad(pts[i - 1], pts[i], 0, h, col('#2a343d'), 1, true);
  const m = new THREE.Mesh(g.toGeometry(), kit.material('glass'));
  m.name = 'gk:farFront';
  m.matrixAutoUpdate = false; m.updateMatrix();
  return m;
}

/** Glazed front along x = fx(z) from z0 to z1 with door gaps; panes, mullions, transom and collision. */
function glazedFront(g: GroupKit, fx: (z: number) => number, z0: number, z1: number, h: number, doors: [number, number][], mullSp = 1.5): void {
  const kit = g.kit;
  const frame = col('#2b2f33');
  const runs: [number, number][] = [];
  let a = z0;
  for (const [d0, d1] of doors) { runs.push([a, d0]); a = d1; }
  runs.push([a, z1]);
  for (const [r0, r1] of runs) {
    if (r1 - r0 < 0.05) continue;
    g.pane([fx(r0), r0], [fx(r1), r1], 0.12, h);
    const n = Math.max(1, Math.round((r1 - r0) / mullSp));
    for (let k = 0; k <= n; k++) {
      const z = r0 + ((r1 - r0) * k) / n;
      g.box('metal', fx(z), h / 2, z, 0.12, h, 0.08, 0, frame);
    }
    g.seg('metal', [fx(r0), r0], [fx(r1), r1], 0, 0.12, 0.14, frame);
    kit.collision.addPolygon(segPoly([fx(r0), r0], [fx(r1), r1], 0.2), h, 'metal', 'glazing');
  }
  // head rail over the whole front + transoms over the doors
  g.seg('metal', [fx(z0), z0], [fx(z1), z1], h - 0.1, h, 0.16, frame);
  for (const [d0, d1] of doors) {
    g.seg('metal', [fx(d0), d0], [fx(d1), d1], 2.6, 2.72, 0.16, frame);
    g.pane([fx(d0), d0], [fx(d1), d1], 2.72, h - 0.1);
  }
}

// ------------------------------------------------------------------------------------------------ east entrance lobby
function lobby(kit: WorldKit): void {
  const I = GJB_INTERIORS.lobby;
  const g = new GroupKit(kit);
  const fx = (z: number) => E(z) - 2.5;
  const z0 = I.z0, z1 = I.z1, x0 = I.x0, h = I.ceil;
  const floor: V2[] = [[x0, z0], [fx(z0), z0], [fx(z1), z1], [x0, z1]];
  // floor: light polished granite, charcoal border band + a compass inlay on the axis
  g.fb('polished').flatPoly(floor, 0.03, col('#d6d3cc'), 2);
  const bd = col('#3e4143');
  for (const p of [rect(x0, z0, fx(z0), z0 + 0.5), rect(x0, z1 - 0.5, fx(z1), z1), rect(x0, z0, x0 + 0.5, z1)]) g.fb('polished').flatPoly(p, 0.035, bd, 2);
  const cx = 74, cz = (z0 + z1) / 2;
  g.fb('polished').flatPoly([[cx, cz - 2.2], [cx + 2.2, cz], [cx, cz + 2.2], [cx - 2.2, cz]], 0.036, bd, 2);
  g.fb('polished').flatPoly([[cx, cz - 1.5], [cx + 1.5, cz], [cx, cz + 1.5], [cx - 1.5, cz]], 0.038, col('#b9a57a'), 2);
  // walls (they cover the facade-shader faces of the neighbouring wings); the south wall is the red feature wall
  // behind the grand stair (eastblock.ts carries it up to L2)
  const wall = col('#e9e6df');
  const sxF = 73.0, sxT = 61.8; // grand stair: foot (east) and top (west)
  kit.box('plaster', (x0 + fx(z0)) / 2, h / 2, z0 + 0.1, fx(z0) - x0, h, 0.2, 0, wall, 0.5);
  kit.box('plaster', (x0 + fx(z1)) / 2, h / 2, z1 - 0.1, fx(z1) - x0, h, 0.2, 0, wall, 0.5);
  // west wall in granite, with the doorway into the ground-floor wing (corridor A, gjb/ground.ts)
  const dA = GJB_G.lobbyDoor;
  const granite = col('#b3b1ab');
  for (const [a, b] of [[z0, dA[0]], [dA[1], z1]] as V2[]) {
    kit.box('polished', x0 + 0.1, h / 2, (a + b) / 2, 0.2, h, b - a, 0, granite, 0.5);
    kit.collision.addPolygon(rect(x0, a, x0 + 0.2, b), h, 'concrete', 'wall');
  }
  kit.box('polished', x0 + 0.1, (2.5 + h) / 2, (dA[0] + dA[1]) / 2, 0.2, h - 2.5, dA[1] - dA[0], 0, granite, 0.5);
  kit.collision.addPolygon(rect(x0, dA[0], x0 + 0.2, dA[1]), h - 2.5, 'concrete', 'wall', 2.5);
  doorFrame(g, [x0 + 0.1, dA[0]], [x0 + 0.1, dA[1]], 0, 2.5, 0.2, 1);
  g.box('plaster', x0 + 0.24, 2.85, (dA[0] + dA[1]) / 2, 0.03, 0.26, 1.4, 0, col('#1f2b45'));
  g.box('plaster', x0 + 0.255, 2.85, (dA[0] + dA[1]) / 2, 0.01, 0.06, 1.0, 0, col('#f4f4f1'));
  // lift doors in the north wall's west end (steel frames, brushed leaves, call-button lights)
  for (const x of [60.4, 62.8]) {
    g.box('metal', x, 1.25, z0 + 0.24, 1.6, 2.5, 0.06, 0, col('#3a3d40'));
    g.box('metal', x, 1.2, z0 + 0.28, 1.3, 2.3, 0.04, 0, col('#9aa0a6'));
    g.box('metal', x, 1.2, z0 + 0.3, 0.02, 2.3, 0.01, 0, col('#5d6369'));
    g.light(x, 2.75, z0 + 0.3, 0.5, 0.08, 0.02);
  }
  // walnut vertical-slat feature wall on the north wall behind the reception, with a gold PES compass ring
  const wx0 = 64.5, wx1 = 77.5, wz = z0 + 0.25;
  g.box('wood', (wx0 + wx1) / 2, 2.9, wz, wx1 - wx0, 5.4, 0.1, 0, col('#4a2f1f'), 0.5);
  for (let x = wx0 + 0.15; x < wx1; x += 0.3) g.box('wood', x, 2.9, wz + 0.1, 0.12, 5.3, 0.1, 0, col('#6e4a30'), 0.5);
  const gold = col('#c9a24a');
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    g.box('metal', 71 + Math.cos(a) * 1.05, 3.9 + Math.sin(a) * 1.05, wz + 0.2, 0.34, 0.12, 0.05, 0, gold);
  }
  for (const a of [0, Math.PI / 2]) g.box('metal', 71, 3.9, wz + 0.21, 0.08 + Math.abs(Math.cos(a)) * 1.9, 0.08 + Math.abs(Math.sin(a)) * 1.9, 0.04, 0, gold);
  // white granite reception desk with a maroon top in front of the slat wall
  const dz = z0 + 1.45;
  g.box('polished', 71, 0.52, dz, 5.0, 1.04, 0.85, 0, col('#e3e1dc'), 0.5);
  g.box('wood', 71, 1.08, dz, 5.1, 0.08, 0.95, 0, col('#6b2a26'));
  g.box('polished', 71, 0.4, dz - 0.75, 4.2, 0.8, 0.5, 0, col('#cfccc5'), 0.5);
  kit.collision.addPolygon(rect(68.45, dz - 1.05, 73.55, dz + 0.48), 1.1, 'concrete', 'desk');
  // black steel 3-seat waiting benches by the glass front
  for (const z of [z0 + 1.2, z1 - 1.0]) {
    g.box('metal', 79.2, 0.45, z, 1.9, 0.06, 0.55, 0, col('#1e2124'));
    g.box('metal', 79.2, 0.75, z + (z < cz ? -0.25 : 0.25), 1.9, 0.55, 0.05, 0, col('#1e2124'));
    for (const lx of [-0.85, 0.85]) g.box('metal', 79.2 + lx, 0.22, z, 0.05, 0.44, 0.5, 0, col('#1e2124'));
    kit.collision.addPolygon(rect(78.2, z - 0.35, 80.2, z + 0.35), 0.8, 'metal', 'prop');
  }
  // standee banners (navy / orange) near the entrance
  for (const [z, c] of [[-83.0, '#1f2b45'], [-77.3, '#e8622a']] as [number, string][]) {
    g.box('plaster', 81.2, 1.05, z, 0.8, 1.9, 0.04, 0, col(c));
    g.box('metal', 81.2, 0.03, z, 0.6, 0.06, 0.35, 0, col('#2b2f33'));
  }
  // the grand stair up to the L1 admission hall along the south wall, rising west; the atrium void over its upper part
  // is cut in the L1 slab (eastblock.ts), and it lands on the granite block at the west end (L1)
  const sz0 = z1 - 2.3, sz1 = z1 - 0.1, steps = 37;
  const run = (sxF - sxT) / steps, rise = GJB_L1 / steps;
  for (let k = 0; k < steps; k++) {
    const xa = sxF - k * run, top = (k + 1) * rise;
    kit.box('polished', xa - run / 2, top / 2, (sz0 + sz1) / 2, run + 0.01, top, sz1 - sz0, 0, col('#9d9d9a'), 0.5);
  }
  kit.box('polished', (x0 + sxT) / 2, GJB_L1 / 2, (sz0 + sz1) / 2, sxT - x0, GJB_L1, sz1 - sz0, 0, col('#9d9d9a'), 0.5);
  // white solid balustrade with a dark steel rail on the open side (as the L1 parapet round the void, 7:22)
  const bal = new GeoBuffer({ color: true });
  const yAt = (x: number) => ((sxF - x) / (sxF - sxT)) * GJB_L1;
  for (const [zf, nz] of [[sz0 - 0.18, -1], [sz0 + 0.02, 1]] as [number, number][]) {
    const i0 = bal.vert(sxF, 0, zf, 0, 0, nz, 0, 0, col('#eceae4')), i1 = bal.vert(sxT, 0, zf, 0, 0, nz, 1, 0, col('#eceae4'));
    const i2 = bal.vert(sxT, yAt(sxT) + 1.0, zf, 0, 0, nz, 1, 1, col('#eceae4')), i3 = bal.vert(sxF, 1.0, zf, 0, 0, nz, 0, 1, col('#eceae4'));
    // the balustrade runs west (sxF → sxT), so the side facing −z winds i0 → i1 → i2 → i3
    if (nz < 0) bal.quad(i0, i1, i2, i3); else bal.quad(i0, i3, i2, i1);
  }
  {
    const c = col('#8f8e8a');
    const i0 = bal.vert(sxF, 1.0, sz0 - 0.2, 0, 1, 0, 0, 0, c), i1 = bal.vert(sxT, yAt(sxT) + 1.0, sz0 - 0.2, 0, 1, 0, 1, 0, c);
    const i2 = bal.vert(sxT, yAt(sxT) + 1.0, sz0 + 0.04, 0, 1, 0, 1, 1, c), i3 = bal.vert(sxF, 1.0, sz0 + 0.04, 0, 1, 0, 0, 1, c);
    bal.quad(i0, i1, i2, i3);
    const e0 = bal.vert(sxF, 0, sz0 - 0.18, 1, 0, 0, 0, 0, c), e1 = bal.vert(sxF, 0, sz0 + 0.02, 1, 0, 0, 1, 0, c);
    const e2 = bal.vert(sxF, 1.0, sz0 + 0.02, 1, 0, 0, 1, 1, c), e3 = bal.vert(sxF, 1.0, sz0 - 0.18, 1, 0, 0, 0, 1, c);
    bal.quad(e0, e3, e2, e1);
  }
  mergeBuf(kit.buf('plaster', 67, sz0), bal);
  kit.buf('metal', 67, sz0).beam([sxF, 1.15, sz0 - 0.08], [sxT, GJB_L1 + 1.15, sz0 - 0.08], 0.05, 0.05, col('#2e3236'));
  for (let k = 0; k < 4; k++) {
    const xa = sxF - ((sxF - sxT) * k) / 4, xb = sxF - ((sxF - sxT) * (k + 1)) / 4;
    kit.collision.addPolygon(rect(xb, sz0 - 0.2, xa, sz0 + 0.02), yAt(xb) + 1.1, 'concrete', 'parapet');
  }
  kit.collision.addRamp(rect(sxT, sz0, sxF, sz1), [sxF, (sz0 + sz1) / 2], [sxT, (sz0 + sz1) / 2], 0, GJB_L1, 'concrete', 'stair');
  kit.collision.addPolygon(rect(x0, sz0, sxT, sz1), GJB_L1, 'concrete', 'landing');
  // ceiling: the L1 slab soffit (dark, shadow-casting shell) with a timber-slat ceiling and linear lights under it,
  // open over the atrium void (x 61.8 … 68.4 along the stair)
  const vx0 = 61.8, vx1 = 68.4;
  kit.buf('dark', 70, cz).flatPoly([[x0, z0], [fx(z0), z0], [fx(z1), z1], [vx1, z1], [vx1, sz0], [vx0, sz0], [vx0, z1], [x0, z1]], h, col('#141516'), 1, true);
  for (let x = x0 + 0.4; x < fx(z1) - 0.2; x += 0.5) {
    const inVoid = x > vx0 - 0.1 && x < vx1 + 0.1;
    const za = inVoid ? sz0 - 0.25 : z1 - 0.25;
    g.box('wood', x, h - 0.28, (z0 + 0.3 + za) / 2, 0.08, 0.14, za - z0 - 0.3, 0, col('#8a6344'), 0.5);
  }
  for (let x = x0 + 2.2; x < fx(z1) - 1; x += 3.5) {
    const inVoid = x > vx0 - 0.5 && x < vx1 + 0.5;
    g.light(x, h - 0.4, inVoid ? (z0 + sz0) / 2 : cz, 0.1, 0.03, inVoid ? sz0 - z0 - 1.2 : z1 - z0 - 1.4);
  }
  // glazed front with a 3.6 m open door (sliding leaves parked open)
  glazedFront(g, fx, z0, z1, h, [[-81.8, -78.2]]);
  kit.lampPoints.push(new THREE.Vector3(70, h - 0.5, cz), new THREE.Vector3(79, h - 0.5, cz));
  planterCube(kit, fx(z0) - 0.9, z0 + 0.8, 0.8);
  const far = new THREE.Group();
  far.add(farFront(kit, [[fx(z0), z0], [fx(z1), z1]], h));
  g.build('interior:gjb_lobby', [71, cz], CULL, far);
}

function mergeBuf(dst: GeoBuffer, src: GeoBuffer): void {
  const base = dst.vertexCount;
  for (let i = 0; i < src.vertexCount; i++) {
    dst.pos.push(src.pos[i * 3], src.pos[i * 3 + 1], src.pos[i * 3 + 2]);
    dst.nrm.push(src.nrm[i * 3], src.nrm[i * 3 + 1], src.nrm[i * 3 + 2]);
    dst.uv.push(src.uv[i * 2], src.uv[i * 2 + 1]);
    if (dst.withColor) dst.col.push(src.col[i * 3] ?? 1, src.col[i * 3 + 1] ?? 1, src.col[i * 3 + 2] ?? 1);
  }
  for (const k of src.idx) dst.idx.push(base + k);
}

// ------------------------------------------------------------------------------------------------ cafeteria (under the Law terrace)
function cafeteria(kit: WorldKit): void {
  const I = GJB_INTERIORS.cafe;
  const g = new GroupKit(kit);
  const fx = (z: number) => E(z) - 0.4;
  const z0 = I.z0, z1 = I.z1, x0 = I.x0, h = I.ceil;
  const floor: V2[] = [[x0, z0], [fx(z0), z0], [fx(z1), z1], [x0, z1]];
  g.fb('polished').flatPoly(floor, 0.03, col('#c9c5bd'), 2);
  g.fb('polished').flatPoly(rect(x0, z0, fx(z0), z0 + 0.6), 0.035, col('#56585a'), 2);
  // exposed black ceiling (the extruded soffit sits just above)
  g.b('dark').flatPoly(floor, h - 0.05, col('#1b1c1e'), 2, true);
  // walls: plaster north + west, brick-red feature wall on the south
  const cz = (z0 + z1) / 2;
  g.box('plaster', (x0 + fx(z0)) / 2, h / 2, z0 + 0.1, fx(z0) - x0, h, 0.2, 0, col('#e8e5de'), 0.5);
  g.box('plaster', (x0 + fx(z1)) / 2, h / 2, z1 - 0.1, fx(z1) - x0, h, 0.2, 0, col('#9a3b2e'), 0.5);
  g.box('plaster', x0 + 0.1, h / 2, cz, 0.2, h, z1 - z0, 0, col('#e8e5de'), 0.5);
  // servery counter along the red wall
  g.box('polished', 80, 0.52, z1 - 1.4, 12, 1.04, 0.9, 0, col('#e3e1dc'), 0.5);
  g.box('wood', 80, 1.08, z1 - 1.4, 12.1, 0.08, 1.0, 0, col('#3a2a20'));
  g.box('metal', 80, 1.6, z1 - 0.35, 11, 1.4, 0.35, 0, col('#9aa0a6'));
  kit.collision.addPolygon(rect(74, z1 - 1.9, 86, z1 - 0.2), 1.1, 'concrete', 'counter');
  // long light-oak tables + grey chairs in rows, square LED ring lights above each table pair
  const oak = col('#b8905f'), leg = col('#2b2d30'), chair = col('#8a8d91');
  for (const tz of [-6, -2, 2, 6, 10, 14]) {
    for (const [tx0, tx1] of [[77.5, 82.5], [84.0, 88.5]] as V2[]) {
      const tcx = (tx0 + tx1) / 2, len = tx1 - tx0;
      g.box('wood', tcx, 0.73, tz, len, 0.05, 0.9, 0, oak, 0.5);
      for (const lx of [tx0 + 0.2, tx1 - 0.2]) for (const lz of [-0.35, 0.35]) g.box('metal', lx, 0.36, tz + lz, 0.05, 0.71, 0.05, 0, leg);
      for (let x = tx0 + 0.45; x < tx1 - 0.2; x += 0.72) for (const s of [-1, 1]) {
        g.box('plaster', x, 0.45, tz + s * 0.75, 0.44, 0.06, 0.44, 0, chair, 0.5);
        g.box('plaster', x, 0.7, tz + s * 0.97, 0.44, 0.45, 0.05, 0, chair, 0.5);
        g.box('metal', x, 0.22, tz + s * 0.75, 0.36, 0.44, 0.36, 0, leg);
      }
      kit.collision.addPolygon(rect(tx0, tz - 0.45, tx1, tz + 0.45), 0.75, 'wood', 'prop');
      // LED ring
      const ry = h - 1.0, s = 1.1;
      for (const [ox, oz, sx, sz] of [[0, -s, 2 * s, 0.05], [0, s, 2 * s, 0.05], [-s, 0, 0.05, 2 * s], [s, 0, 0.05, 2 * s]] as number[][]) g.light(tcx + ox, ry, tz + oz, sx, 0.04, sz);
      g.b('metal').beam([tcx, ry, tz], [tcx, h - 0.05, tz], 0.01, 0.01, leg);
    }
  }
  glazedFront(g, fx, z0, z1, h, [[-1.2, 1.2], [10.8, 13.2]], 1.6);
  kit.lampPoints.push(new THREE.Vector3(80, h - 0.6, 0), new THREE.Vector3(80, h - 0.6, 12));
  const far = new THREE.Group();
  far.add(farFront(kit, [[fx(z0), z0], [fx(z1), z1]], h));
  g.build('interior:gjb_cafe', [82, cz], CULL, far);
}
