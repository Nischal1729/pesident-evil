import * as THREE from 'three';
import { GeoBuffer } from '../buildings';
import { col, type WorldKit } from '../kit';
import { planterCube } from '../landscape';
import { GJB_INTERIORS, GJB_L1, gjbcEastX, type V2 } from '../layout';
import { GroupKit, rect, segPoly } from './util';

/**
 * Enterable ground-floor GJBC interiors (playable now, y = 0; reference/GJB_NOTES.md §5):
 *  - the east entrance lobby behind the cream portal (walnut slat wall + reception desk, lift doors, stair to L1);
 *  - the cafeteria under the Faculty of Law terrace (glass front to the promenade, long oak tables, LED ring lights).
 * Real openings replace the facade-shader windows: the lobby sits under `gjb_breezeway` (base = L1) and the cafeteria
 * under `gjb_cafe_top` / `gjb_law_cafe` (base = 4.5), so the extruded buildings leave the ground floor open and the walls,
 * glazing, floor and ceiling here are built by hand. Each interior is one distance-culled LOD; when the camera is far
 * away an opaque dark-glass stand-in closes the front instead.
 */
const E = gjbcEastX;
const CULL = 85;

export function buildGjbInteriors(kit: WorldKit): void {
  lobby(kit);
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
  g.b('polished').flatPoly(floor, 0.03, col('#d6d3cc'), 2);
  const bd = col('#3e4143');
  for (const p of [rect(x0, z0, fx(z0), z0 + 0.5), rect(x0, z1 - 0.5, fx(z1), z1), rect(x0, z0, x0 + 0.5, z1)]) g.b('polished').flatPoly(p, 0.035, bd, 2);
  const cx = 74, cz = (z0 + z1) / 2;
  g.b('polished').flatPoly([[cx, cz - 2.2], [cx + 2.2, cz], [cx, cz + 2.2], [cx - 2.2, cz]], 0.036, bd, 2);
  g.b('polished').flatPoly([[cx, cz - 1.5], [cx + 1.5, cz], [cx, cz + 1.5], [cx - 1.5, cz]], 0.038, col('#b9a57a'), 2);
  // walls (they cover the facade-shader faces of the neighbouring wings)
  const wall = col('#e9e6df');
  g.box('plaster', (x0 + fx(z0)) / 2, h / 2, z0 + 0.1, fx(z0) - x0, h, 0.2, 0, wall, 0.5);
  g.box('plaster', (x0 + fx(z1)) / 2, h / 2, z1 - 0.1, fx(z1) - x0, h, 0.2, 0, wall, 0.5);
  g.box('polished', x0 + 0.1, h / 2, cz, 0.2, h, z1 - z0, 0, col('#b3b1ab'), 0.5);
  // lift doors in the granite end wall
  for (const z of [-82.4, -80.0]) {
    g.box('metal', x0 + 0.24, 1.25, z, 0.06, 2.5, 1.6, 0, col('#3a3d40'));
    g.box('metal', x0 + 0.28, 1.2, z, 0.04, 2.3, 1.3, 0, col('#9aa0a6'));
    g.light(x0 + 0.3, 2.75, z, 0.02, 0.08, 0.5);
  }
  // walnut vertical-slat feature wall on the north wall behind the reception, with a gold PES compass ring
  const wx0 = 64.5, wx1 = 77.5, wz = z0 + 0.25;
  g.box('wood', (wx0 + wx1) / 2, 2.9, wz, wx1 - wx0, 5.6, 0.1, 0, col('#4a2f1f'), 0.5);
  for (let x = wx0 + 0.15; x < wx1; x += 0.3) g.box('wood', x, 2.9, wz + 0.1, 0.12, 5.5, 0.1, 0, col('#6e4a30'), 0.5);
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
  // granite stair up to L1 along the south wall, rising west into a stairwell void in the ceiling
  const sz0 = z1 - 2.3, sz1 = z1 - 0.1, sxF = 73.0, sxT = 61.8, steps = 37;
  const run = (sxF - sxT) / steps, rise = GJB_L1 / steps;
  for (let k = 0; k < steps; k++) {
    const xa = sxF - k * run, top = (k + 1) * rise;
    g.box('polished', xa - run / 2, top / 2, (sz0 + sz1) / 2, run + 0.01, top, sz1 - sz0, 0, col('#9d9d9a'), 0.5);
  }
  g.box('polished', (x0 + sxT) / 2, GJB_L1 / 2, (sz0 + sz1) / 2, sxT - x0, GJB_L1, sz1 - sz0, 0, col('#9d9d9a'), 0.5);
  // glass balustrade + stainless handrail on the open side
  const gb = g.glass;
  const q0 = gb.vert(sxF, 0.05, sz0, 0, 0, -1, 0, 0), q1 = gb.vert(sxT, GJB_L1, sz0, 0, 0, -1, 1, 0);
  const q2 = gb.vert(sxT, GJB_L1 + 1.0, sz0, 0, 0, -1, 1, 1), q3 = gb.vert(sxF, 1.0, sz0, 0, 0, -1, 0, 1);
  gb.quad(q0, q1, q2, q3); gb.quad(q0, q3, q2, q1);
  g.b('metal').beam([sxF, 1.0, sz0], [sxT, GJB_L1 + 1.0, sz0], 0.06, 0.06, col('#c8ccd0'));
  g.b('dark').flatPoly(rect(x0 + 0.2, sz0 - 0.2, 66.5, z1 - 0.2), h - 0.03, col('#0b0c0d'), 1, true);
  kit.collision.addRamp(rect(sxT, sz0, sxF, sz1), [sxF, (sz0 + sz1) / 2], [sxT, (sz0 + sz1) / 2], 0, GJB_L1, 'concrete', 'stair');
  kit.collision.addPolygon(rect(x0, sz0, sxT, sz1), GJB_L1, 'concrete', 'landing');
  // timber-slat ceiling with linear light strips (the soffit above is the breezeway underside at L1)
  for (let x = x0 + 0.4; x < fx(z1) - 0.2; x += 0.5) {
    const za = x < 66.8 ? sz0 - 0.25 : z1 - 0.25;
    g.box('wood', x, h - 0.28, (z0 + 0.3 + za) / 2, 0.08, 0.14, za - z0 - 0.3, 0, col('#8a6344'), 0.5);
  }
  for (let x = x0 + 2.2; x < fx(z1) - 1; x += 3.5) g.light(x, h - 0.4, x < 66.8 ? (z0 + sz0) / 2 : cz, 0.1, 0.03, x < 66.8 ? sz0 - z0 - 1.2 : z1 - z0 - 1.4);
  // glazed front with a 3.6 m open door (sliding leaves parked open)
  glazedFront(g, fx, z0, z1, h, [[-81.8, -78.2]]);
  kit.lampPoints.push(new THREE.Vector3(70, h - 0.5, cz), new THREE.Vector3(79, h - 0.5, cz));
  planterCube(kit, fx(z0) - 0.9, z0 + 0.8, 0.8);
  const far = new THREE.Group();
  far.add(farFront(kit, [[fx(z0), z0], [fx(z1), z1]], h));
  g.build('interior:gjb_lobby', [71, cz], CULL, far);
}

// ------------------------------------------------------------------------------------------------ cafeteria (under the Law terrace)
function cafeteria(kit: WorldKit): void {
  const I = GJB_INTERIORS.cafe;
  const g = new GroupKit(kit);
  const fx = (z: number) => E(z) - 0.4;
  const z0 = I.z0, z1 = I.z1, x0 = I.x0, h = I.ceil;
  const floor: V2[] = [[x0, z0], [fx(z0), z0], [fx(z1), z1], [x0, z1]];
  g.b('polished').flatPoly(floor, 0.03, col('#c9c5bd'), 2);
  g.b('polished').flatPoly(rect(x0, z0, fx(z0), z0 + 0.6), 0.035, col('#56585a'), 2);
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
