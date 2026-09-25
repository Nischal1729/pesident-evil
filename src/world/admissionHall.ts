import * as THREE from 'three';
import { GeoBuffer, InteriorKit, PlanFrame } from './buildings';
import { col, type WorldKit } from './kit';
import type { V2 } from './layout';
import { pottedPlant } from './shapes';

/**
 * Ground floor of the OSM "Admission Enquiry" building at the main gate (way 347418529): an enterable enquiry hall
 * facing the entry walkway, next to the player spawn. No tour shows this room; its fittings follow the admission
 * counters the 2026 campus tours show elsewhere on campus (key frames 0724 / gjb 0710: oak-panelled counters with blue
 * "ADMISSION" plates, a timber-slat ceiling with linear lights, yellow-wood columns, a red feature wall with a gold tree
 * sculpture, black steel waiting benches). Confidence: L for the layout, M for the look.
 * Frame: s = x − 156.2 (east), t = z + 120.5 (south). The building above (layout.ts 'admission', from 3.5 m) and the
 * walls-only ground-floor shell ('admission_g', its walkway face between s 2 and 14 left out) are regular BUILDINGS.
 */
const F = new PlanFrame([156.2, -120.5], [1, 0], [0, 1]);
const H = 3.5, CEIL = 3.3;
// west of the gate's south pillar (x 162–166 since the gate moved to x 164; the pillar is built into this building)
const DOOR: V2 = [2.8, 5.0];
const GLAZE: V2 = [2.0, 14.0];

export function buildAdmissionHall(kit: WorldKit): void {
  const k = new InteriorKit(kit, F);
  k.castKeys = new Set(['plaster']);
  const C = kit.collision;
  const R = (s0: number, t0: number, s1: number, t1: number): V2[] => F.rect(s0, t0, s1, t1);
  const white = col('#eeece6'), oak = col('#b8905f'), black = col('#1e2124'), frame = col('#23272b');
  const sign = drawSigns();
  const sb = new GeoBuffer();

  // ---------------------------------------------------------------- floor, walls, ceiling (the shell has no collision)
  C.addPolygon(R(0, 0, 27.9, 13.9), 0.05, 'concrete', 'adm:floor');
  k.fflat('polished', [[0.3, 0.12], [17.4, 0.12], [17.4, 13.2], [0.3, 13.2]], 0.06, col('#d3d0c8'), 2);
  k.fflat('polished', [[0.3, 0.12], [17.4, 0.12], [17.4, 0.6], [0.3, 0.6]], 0.065, col('#3e4143'), 2);
  const wallY = (s0: number, t0: number, s1: number, t1: number, c: THREE.Color) => { k.fbox('plaster', s0, 0, t0, s1, CEIL, t1, c, 0.5); C.addPolygon(R(s0, t0, s1, t1), H, 'concrete', 'adm:wall'); };
  wallY(0, 0, 0.3, 13.9, white); // west (the blue mosaic mural is on its outside face)
  wallY(17.4, 0, 17.7, 13.9, white); // east: the red feature wall is a panel on its inner face
  C.addPolygon(F.poly([[0.3, 13.2], [17.4, 13.2], [17.4, 13.5], [0.3, 13.9]]), H, 'concrete', 'adm:wall');
  k.fbox('plaster', 0.3, 0, 13.2, 17.4, CEIL, 13.35, white, 0.5);
  C.addPolygon(R(17.7, 0, 27.9, 13.3), H, 'concrete', 'adm:solid'); // service rooms behind the gate pillar
  for (const [s0, s1] of [[0, GLAZE[0]], [GLAZE[1], 17.7]] as V2[]) C.addPolygon(R(s0, -0.06, s1, 0.16), H, 'concrete', 'adm:wall');
  k.fflat('plaster', [[0.3, 0.1], [17.4, 0.1], [17.4, 13.2], [0.3, 13.2]], CEIL, white, 2, true);
  // timber-slat ceiling with linear lights between the slats
  for (let t = 0.6; t < 13.0; t += 0.45) k.fbox('wood', 0.4, CEIL - 0.2, t, 17.3, CEIL - 0.06, t + 0.09, col('#8a6344'), 0.5);
  for (const t of [2.9, 6.5, 10.1]) k.flight(8.85, CEIL - 0.21, t, 15.5, 0.06);
  k.fbox('polished', 0.3, 0, 0.12, 0.34, 0.12, 13.2, col('#2a2b2d'));
  k.fbox('polished', 0.3, 0, 13.16, 17.4, 0.12, 13.2, col('#2a2b2d'));

  // ---------------------------------------------------------------- glazed front with the door (sliding leaves parked open)
  const runs: V2[] = [[GLAZE[0], DOOR[0]], [DOOR[1], GLAZE[1]]];
  for (const [r0, r1] of runs) {
    k.fpane(r0, 0.08, r1, 0.08, 0.05, CEIL);
    const n = Math.max(1, Math.round((r1 - r0) / 1.2));
    for (let i = 0; i <= n; i++) { const s = r0 + ((r1 - r0) * i) / n; k.fbox('metal', s - 0.04, 0, 0.02, s + 0.04, CEIL, 0.14, frame); }
    k.fbox('metal', r0, 0, 0.02, r1, 0.1, 0.14, frame);
    C.addPolygon(R(r0, 0.0, r1, 0.16), CEIL, 'metal', 'glazing');
  }
  k.fbox('metal', GLAZE[0], CEIL - 0.1, 0.0, GLAZE[1], H, 0.16, frame);
  k.fbox('metal', DOOR[0], 2.6, 0.0, DOOR[1], 2.72, 0.16, frame);
  k.fpane(DOOR[0], 0.08, DOOR[1], 0.08, 2.72, CEIL - 0.1);
  for (const [s, d] of [[DOOR[0] - 0.02, -1], [DOOR[1] + 0.02, 1]] as V2[]) k.fbox('metal', Math.min(s, s + d * 1.1), 0.05, 0.2, Math.max(s, s + d * 1.1), 2.55, 0.24, frame);
  // navy canopy over the door + a fascia board (outside, always visible)
  { const p = F.at((DOOR[0] + DOOR[1]) / 2, -0.8); kit.box('stone', p[0], 3.05, p[1], 4.4, 0.22, 1.6, 0, col('#1f2b45'), 0.5); }

  // ---------------------------------------------------------------- enquiry counters along the back wall, blue plates
  k.fbox('wood', 2.0, 0, 12.05, 15.0, 1.02, 13.2, oak, 0.5);
  k.fbox('polished', 1.95, 1.02, 12.0, 15.05, 1.08, 13.2, col('#e6e4de'), 0.5);
  for (let s = 2.4; s < 15; s += 1.3) k.fbox('wood', s, 0.1, 12.03, s + 0.04, 0.95, 12.05, col('#8a6844'));
  C.addPolygon(R(2.0, 12.0, 15.0, 13.2), 1.1, 'wood', 'desk');
  for (let i = 0; i < 4; i++) {
    const sc = 3.6 + i * 3.2, p = F.at(sc, 13.14);
    k.fbox('plaster', sc - 0.85, 2.05, 13.14, sc + 0.85, 2.55, 13.16, col('#1f4aa8'), 0.5);
    signQuad(sb, sign.plate, p[0], 2.3, p[1], 1.6, 0.4, 0, -1);
    k.fbox('dark', sc - 0.3, 1.1, 12.5, sc + 0.3, 1.45, 12.55, col('#15171a')); // monitor
  }
  // red feature wall with a gold tree sculpture on the east wall
  k.fbox('plaster', 17.36, 0.12, 1.0, 17.4, CEIL - 0.2, 11.6, col('#9a2a24'), 0.5);
  {
    const gold = col('#c9a24a'), s = 17.3, tc = 6.3;
    k.fbox('metal', s - 0.06, 0.4, tc - 0.12, s, 1.9, tc + 0.12, gold);
    const branch = (y0: number, dt: number, len: number) => { const a = F.at(s - 0.03, tc), b = F.at(s - 0.03, tc + dt * len); k.b('metal').beam([a[0], y0, a[1]], [b[0], y0 + len * 0.7, b[1]], 0.06, 0.06, gold); return tc + dt * len; };
    for (const [y0, dt, len] of [[1.6, 1, 1.4], [1.6, -1, 1.3], [1.9, 0.5, 1.2], [1.9, -0.6, 1.1], [1.8, 0, 0.9]] as number[][]) {
      const te = branch(y0, dt, len);
      for (let j = 0; j < 5; j++) { const p = F.at(s - 0.04, te + (j - 2) * 0.22); k.b('metal').cylinder(p[0], y0 + len * 0.7 - 0.2 + (j % 2) * 0.3, p[1], 0.14, 0.03, 8, gold); }
    }
  }
  // yellow-wood columns, black steel waiting benches, standees, plants, a water cooler
  for (const sc of [6.0, 11.6]) {
    const p = F.at(sc, 7.0);
    k.b('wood').cylinder(p[0], 0, p[1], 0.36, CEIL, 14, col('#d9a441'), false);
    k.b('polished').cylinder(p[0], 0, p[1], 0.38, 0.3, 14, col('#3a3c3e'), false);
    C.addCircle(p[0], p[1], 0.36, CEIL, 'wood', 'column');
  }
  for (const [sc, tc] of [[3.4, 4.6], [3.4, 8.2], [14.2, 4.6], [14.2, 8.2]] as V2[]) {
    k.fbox('metal', sc - 1.0, 0.42, tc - 0.25, sc + 1.0, 0.47, tc + 0.25, black);
    k.fbox('metal', sc - 1.0, 0.47, tc + 0.22, sc + 1.0, 0.85, tc + 0.27, black);
    for (const d of [-0.9, 0.9]) k.fbox('metal', sc + d - 0.03, 0, tc - 0.22, sc + d + 0.03, 0.42, tc + 0.22, black);
    C.addPolygon(R(sc - 1.05, tc - 0.3, sc + 1.05, tc + 0.3), 0.8, 'metal', 'prop');
  }
  for (const [sc, c] of [[5.9, '#1f2b45'], [10.1, '#e8622a']] as [number, string][]) {
    k.fbox('plaster', sc - 0.4, 0.06, 1.2, sc + 0.4, 1.95, 1.24, col(c), 0.5);
    k.fbox('metal', sc - 0.3, 0.02, 1.05, sc + 0.3, 0.06, 1.4, frame);
  }
  for (const [sc, tc] of [[0.9, 0.9], [16.8, 0.9], [16.8, 12.4]] as V2[]) { const p = F.at(sc, tc); pottedPlant(kit, p[0], 0.05, p[1], 0.9); C.addCircle(p[0], p[1], 0.3, 1.0, 'concrete', 'prop'); }
  { const p = F.at(0.8, 11.2); k.fbox('plaster', 0.55, 0.05, 10.95, 1.05, 1.05, 11.45, col('#e8e8e4'), 0.5); k.b('glass').cylinder(p[0], 1.05, p[1], 0.17, 0.44, 10, col('#6fa0c8')); C.addCircle(p[0], p[1], 0.3, 1.5, 'metal', 'prop'); }

  // ---------------------------------------------------------------- signs mesh, far stand-in, LOD
  {
    const m = new THREE.Mesh(sb.toGeometry(), new THREE.MeshStandardMaterial({ map: sign.tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.name = 'adm:signs'; m.matrixAutoUpdate = false; m.updateMatrix();
    k.extras.push(m);
  }
  const far = new THREE.Group();
  {
    const g = new GeoBuffer({ color: true });
    g.wallQuad(F.at(GLAZE[1], 0.05), F.at(GLAZE[0], 0.05), 0.05, CEIL, col('#2a343d'), 1, true);
    const m = new THREE.Mesh(g.toGeometry(), kit.material('glass'));
    m.name = 'adm:farFront'; m.matrixAutoUpdate = false; m.updateMatrix();
    far.add(m);
  }
  k.build('interior:admission', F.at(8.8, 6.5), 70, far);
}

type UV = [number, number, number, number];
function drawSigns(): { tex: THREE.CanvasTexture; plate: UV } {
  const W = 256, Hc = 64;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Hc;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1f4aa8'; g.fillRect(0, 0, W, Hc);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 34px Arial, sans-serif'; g.fillText('ADMISSION', W / 2, Hc * 0.55);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, plate: [0.5 / W, 0.5 / Hc, 1 - 0.5 / W, 1 - 0.5 / Hc] };
}
function signQuad(b: GeoBuffer, uv: UV, x: number, y: number, z: number, w: number, h: number, nx: number, nz: number): void {
  const rx = nz, rz = -nx;
  const c = (sx: number, sy: number): [number, number, number] => [x + rx * sx * w / 2, y + sy * h / 2, z + rz * sx * w / 2];
  const [u0, v0, u1, v1] = uv;
  const p0 = c(-1, -1), p1 = c(1, -1), p2 = c(1, 1), p3 = c(-1, 1);
  const i0 = b.vert(p0[0], p0[1], p0[2], nx, 0, nz, u0, v0), i1 = b.vert(p1[0], p1[1], p1[2], nx, 0, nz, u1, v0);
  const i2 = b.vert(p2[0], p2[1], p2[2], nx, 0, nz, u1, v1), i3 = b.vert(p3[0], p3[1], p3[2], nx, 0, nz, u0, v1);
  b.quad(i0, i1, i2, i3);
}
