import * as THREE from 'three';
import { GeoBuffer } from './buildings';
import { normalizeWinding } from './geom';
import { col, type DetailKey, type WorldKit } from './kit';
import { BUILDINGS, type V2 } from './layout';
import { pottedPlant, quad3, type P3 } from './shapes';
import type { SignUVs } from './signs';

/**
 * B-Block = "BE block" (students' name; the 2021 campus tour's "Block BE" with "the 13th floor", and the 2023 "BE
 * BLOCK TOUR") — see reference/BE_NOTES.md. 14 storeys, beige stone/plaster with pilaster fins, pink-grey stone base.
 * This file: the two steel-truss skybridges to GJBC, the crest-tower sign, cornice / balcony bands, and the main
 * entrance on the EAST face (facing the B/MRD link road and the PES food point):
 *   a raised granite plinth with 3 steps along the drive, a double-height frameless spider-glass wall with the white
 *   "be BLOCK" logo between stone piers with louvres, a stone band above, and a portico where the upper floors bridge
 *   the link road on tall pink-granite columns (the 2021 tour frames be21_0196/0198).
 * Behind the glass: a double-height lobby (orange wall + white frieze, mezzanine with black railing, lifts, reception),
 * carved out of the block (layout ids bblock / bblock_lobby_over / bblock_portico) so it becomes walkable when
 * multi-level movement lands; the plinth + lobby floor are registered as a 0.45 m podium, the steps as a ramp.
 */
/** The un-notched OSM outline (cornices run across the lobby opening). */
const BBLOCK_OSM: V2[] = [[-54.8, -177.2], [-41.0, -178.0], [-42.1, -195.0], [-12.8, -196.8], [-11.2, -171.4], [-7.6, -113.9], [-50.6, -111.2]];

/** Entrance frame: origin on the east facade at z = −159.5; s = along the facade (south), o = outward (east). */
export const BE_ENTRANCE = {
  origin: [-10.455, -159.5] as V2,
  s: [0.0625, 0.998] as V2,
  o: [0.998, -0.0625] as V2,
  lobby: { s0: -6, s1: 6, depth: 9, glassO: -0.6, doorHalf: 1.6, ceil: 7.0 },
  plinth: { s0: -10.5, s1: 9.5, o1: 2.8, h: 0.45 },
  steps: { n: 3, tread: 0.4 },
};

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
  // projecting cornice at the top, balcony band at the 10th floor, stone band over the 2-storey base (runs across the lobby opening)
  const p = normalizeWinding(BBLOCK_OSM);
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
  buildBEEntrance(kit, signs);
}

function buildBEEntrance(kit: WorldKit, signs: SignUVs): void {
  const E = BE_ENTRANCE;
  const Q = (sl: number, ol: number): V2 => [E.origin[0] + E.s[0] * sl + E.o[0] * ol, E.origin[1] + E.s[1] * sl + E.o[1] * ol];
  const Q3 = (sl: number, ol: number, y: number): P3 => { const q = Q(sl, ol); return [q[0], y, q[1]]; };
  const rot = Math.atan2(-E.s[1], E.s[0]); // box local x along the facade, local z = −o … use rotO for outward depth
  const L = E.lobby, PL = E.plinth, ST = E.steps;
  const H = PL.h;
  const o3: P3 = [E.o[0], 0, E.o[1]];
  const stone = col('#d8c9b1'), pink = col('#b49b8b'), granite = col('#8f8d88');

  // ---------------------------------------------------------------- plinth (granite paving) + 3 steps down to the drive + apron
  const pb = kit.buf('polished', E.origin[0], E.origin[1]);
  quad3(pb, [Q3(PL.s0, 0, H), Q3(PL.s1, 0, H), Q3(PL.s1, PL.o1, H), Q3(PL.s0, PL.o1, H)], [0, 1, 0], granite, 0.5);
  quad3(pb, [Q3(L.s0, L.glassO, H), Q3(L.s1, L.glassO, H), Q3(L.s1, 0, H), Q3(L.s0, 0, H)], [0, 1, 0], granite, 0.5);
  quad3(pb, [Q3(PL.s0, PL.o1, 0), Q3(PL.s0, PL.o1 + ST.n * ST.tread, 0), Q3(PL.s0, PL.o1 + ST.n * ST.tread, 0.02), Q3(PL.s0, PL.o1, H)], [-E.s[0], 0, -E.s[1]], granite, 0.5);
  quad3(pb, [Q3(PL.s0, 0, 0), Q3(PL.s0, PL.o1, 0), Q3(PL.s0, PL.o1, H), Q3(PL.s0, 0, H)], [-E.s[0], 0, -E.s[1]], granite.clone().multiplyScalar(0.9), 0.5);
  quad3(pb, [Q3(PL.s1, 0, 0), Q3(PL.s1, PL.o1, 0), Q3(PL.s1, PL.o1, H), Q3(PL.s1, 0, H)], [E.s[0], 0, E.s[1]], granite.clone().multiplyScalar(0.9), 0.5);
  quad3(pb, [Q3(PL.s1, PL.o1, 0), Q3(PL.s1, PL.o1 + ST.n * ST.tread, 0), Q3(PL.s1, PL.o1 + ST.n * ST.tread, 0.02), Q3(PL.s1, PL.o1, H)], [E.s[0], 0, E.s[1]], granite, 0.5);
  for (let i = 0; i < ST.n; i++) {
    const y = H - i * (H / ST.n), h = H - (i + 1) * (H / ST.n), o0 = PL.o1 + i * ST.tread, o1 = o0 + ST.tread;
    quad3(pb, [Q3(PL.s0, o0, y), Q3(PL.s1, o0, y), Q3(PL.s1, o0, h), Q3(PL.s0, o0, h)], o3, granite.clone().multiplyScalar(0.82), 0.5); // riser
    if (h > 0.01) quad3(pb, [Q3(PL.s0, o0, h), Q3(PL.s1, o0, h), Q3(PL.s1, o1, h), Q3(PL.s0, o1, h)], [0, 1, 0], granite.clone().multiplyScalar(1.05), 0.5); // tread
  }
  // (last riser ends at the drive level; the outer-most tread is the apron)
  kit.collision.addPolygon([Q(PL.s0, 0), Q(L.s0, 0), Q(L.s0, -L.depth), Q(L.s1, -L.depth), Q(L.s1, 0), Q(PL.s1, 0), Q(PL.s1, PL.o1), Q(PL.s0, PL.o1)], H, 'concrete', 'be:plinth');
  kit.collision.addRamp([Q(PL.s0, PL.o1), Q(PL.s1, PL.o1), Q(PL.s1, PL.o1 + ST.n * ST.tread), Q(PL.s0, PL.o1 + ST.n * ST.tread)], Q(0, PL.o1 + ST.n * ST.tread), Q(0, PL.o1), 0, H, 'concrete', 'be:steps');
  // paved drop-off apron between the steps and the link road
  kit.buf('stone', E.origin[0], E.origin[1]).flatPoly([Q(PL.s0, PL.o1 + ST.n * ST.tread - 0.4), Q(PL.s1, PL.o1 + ST.n * ST.tread - 0.4), [-4.55, -150.0], [-5.3, -170.0]], 0.066, col('#a9a69f'), 1.5);
  // potted palms along the plinth edge (either side of the steps' middle run)
  for (let s = PL.s0 + 0.8; s < PL.s1 - 0.5; s += 1.3) {
    if (Math.abs(s) < L.s1 + 0.4) continue;
    const q = Q(s, PL.o1 - 0.45);
    pottedPlant(kit, q[0], H, q[1], 1.15);
  }

  // ---------------------------------------------------------------- stone piers with louvres either side of the glass, stone band above
  for (const sgn of [-1, 1]) {
    const sc = sgn * (L.s1 + 0.7);
    const c = Q(sc, 0.2);
    kit.box('stone', c[0], 3.5, c[1], 1.4, 7.0, 0.5, rot, stone, 0.5);
    const lv = Q(sc, 0.47);
    kit.box('metal', lv[0], 4.2, lv[1], 1.0, 4.6, 0.05, rot, col('#e8e6e0'));
    for (let k = 0; k < 7; k++) { const q = Q(sc - 0.45 + k * 0.15, 0.5); kit.box('metal', q[0], 4.2, q[1], 0.03, 4.4, 0.12, rot, col('#cfccc4')); }
  }
  { const c = Q(0, 0.18); kit.box('stone', c[0], 7.6, c[1], 2 * L.s1 + 2.8, 1.2, 0.5, rot, stone, 0.5); }

  // ---------------------------------------------------------------- frameless spider-glass wall with the auto door opening + logo
  {
    const gb = new GeoBuffer();
    const g0 = L.glassO;
    const pane = (s0: number, s1: number, y0: number, y1: number) => {
      const a = Q(s0, g0), b = Q(s1, g0);
      gb.wallQuad(a, b, y0, y1, undefined, 1, true);
    };
    pane(L.s0 + 0.4, -L.doorHalf, H, L.ceil);
    pane(L.doorHalf, L.s1 - 0.4, H, L.ceil);
    pane(-L.doorHalf, L.doorHalf, H + 2.9, L.ceil);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xa9bcc6, transparent: true, opacity: 0.26, roughness: 0.04, metalness: 0.25, depthWrite: false, side: THREE.DoubleSide });
    const gm = new THREE.Mesh(gb.toGeometry(), glassMat);
    gm.name = 'be:glass'; gm.renderOrder = 1; gm.matrixAutoUpdate = false; gm.updateMatrix();
    kit.group.add(gm);
    // spider fittings, transom rail, door-track, patch fittings
    const mb = kit.buf('metal', E.origin[0], E.origin[1]);
    for (let s = L.s0 + 0.4; s <= L.s1 - 0.39; s += (2 * L.s1 - 0.8) / 5) {
      for (const y of [H + 0.1, H + 3.1, L.ceil - 0.15]) {
        const q = Q(s, g0 + 0.03);
        mb.box(q[0], y, q[1], 0.28, 0.04, 0.04, rot, col('#c9ccd0'));
        mb.box(q[0], y, q[1], 0.04, 0.28, 0.04, rot, col('#c9ccd0'));
      }
    }
    { const q = Q(0, g0 + 0.05); mb.box(q[0], H + 2.95, q[1], 2 * L.s1 - 0.6, 0.12, 0.1, rot, col('#b7babe')); }
    // open sliding leaves parked behind the side panes
    for (const sg of [-1, 1]) { const q = Q(sg * L.doorHalf, g0); mb.box(q[0], H + 1.45, q[1], 0.06, 2.9, 0.08, rot, col('#b7babe')); } // door jambs (leaves slid open)
    // logo on the glass
    const lg = Q(0, g0 + 0.02);
    kit.signQuad(signs.beLogo, lg[0], 5.35, lg[1], 2.4, 1.65, E.o[0], E.o[1], true);
    kit.collision.addSegment(Q(L.s0 + 0.4, g0), Q(-L.doorHalf, g0), 0.2, L.ceil, 'metal', 'be:glass');
    kit.collision.addSegment(Q(L.doorHalf, g0), Q(L.s1 - 0.4, g0), 0.2, L.ceil, 'metal', 'be:glass');
    // glass fins at the lobby-mouth corners (stone returns)
    for (const sg of [-1, 1]) { const q = Q(sg * (L.s1 - 0.2), g0 + 0.3); kit.box('stone', q[0], (H + L.ceil) / 2, q[1], 0.4, L.ceil - H, 1.2, rot, stone, 0.5); }
  }

  // ---------------------------------------------------------------- portico columns (upper floors bridge the link road; layout id bblock_portico)
  const colAt: V2[] = [Q(-8.9, 3.4), Q(2.2, 3.4), [1.95, -168.3], [1.95, -157.2]];
  for (const cp of colAt) {
    kit.box('stone', cp[0], 2.9, cp[1], 1.36, 5.8, 1.36, rot, pink, 0.5);
    kit.box('stone', cp[0], 5.8 + (14 - 5.8) / 2, cp[1], 1.3, 14 - 5.8, 1.3, rot, stone, 0.5);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const k = (x: number, z: number): V2 => [cp[0] + x * cs + z * sn, cp[1] - x * sn + z * cs];
    kit.collision.addPolygon([k(-0.68, -0.68), k(0.68, -0.68), k(0.68, 0.68), k(-0.68, 0.68)], 14, 'concrete', 'be:column');
  }

  // ---------------------------------------------------------------- lobby interior (distance-culled LOD; 2 meshes: vertex-coloured plaster + emissive)
  const bufs = new Map<DetailKey, GeoBuffer>();
  const B = (k: DetailKey) => { let b = bufs.get(k); if (!b) bufs.set(k, (b = new GeoBuffer({ color: true }))); return b; };
  const oBack = -L.depth + 0.06, sA = L.s0 + 0.06, sB = L.s1 - 0.06;
  const white = col('#f1efe9'), orange = col('#e0801a');
  // floor (polished granite) and walls (white plaster finishes over the carved block walls)
  quad3(B('plaster'), [Q3(sA, oBack, H + 0.01), Q3(sB, oBack, H + 0.01), Q3(sB, L.glassO, H + 0.01), Q3(sA, L.glassO, H + 0.01)], [0, 1, 0], col('#cfcdc6'), 0.5);
  quad3(B('plaster'), [Q3(sA, oBack, H), Q3(sB, oBack, H), Q3(sB, oBack, L.ceil), Q3(sA, oBack, L.ceil)], o3, white);
  quad3(B('plaster'), [Q3(sA, oBack, H), Q3(sA, L.glassO, H), Q3(sA, L.glassO, L.ceil), Q3(sA, oBack, L.ceil)], [E.s[0], 0, E.s[1]], white);
  quad3(B('plaster'), [Q3(sB, oBack, H), Q3(sB, L.glassO, H), Q3(sB, L.glassO, L.ceil), Q3(sB, oBack, L.ceil)], [-E.s[0], 0, -E.s[1]], white);
  quad3(B('plaster'), [Q3(sA, oBack, L.ceil - 0.02), Q3(sB, oBack, L.ceil - 0.02), Q3(sB, L.glassO, L.ceil - 0.02), Q3(sA, L.glassO, L.ceil - 0.02)], [0, -1, 0], col('#e6e4de'));
  // mezzanine along the back wall: slab, black railing, orange wall + white sketch frieze ("Mahatma Gandhi")
  const mz = 4.1, md = 2.6;
  { const c = Q(0, oBack + md / 2); B('plaster').box(c[0], mz - 0.15, c[1], sB - sA, 0.3, md, rot, col('#e9e6df')); }
  { const c = Q(0, oBack + md); B('plaster').box(c[0], mz + 0.5, c[1], sB - sA, 0.06, 0.06, rot, col('#1d1f22')); for (let s = sA + 0.1; s < sB; s += 0.25) { const q = Q(s, oBack + md); B('plaster').box(q[0], mz + 0.25, q[1], 0.025, 0.5, 0.025, rot, col('#1d1f22')); } }
  quad3(B('plaster'), [Q3(sA, oBack + 0.01, mz), Q3(sB, oBack + 0.01, mz), Q3(sB, oBack + 0.01, mz + 1.6), Q3(sA, oBack + 0.01, mz + 1.6)], o3, orange);
  quad3(B('plaster'), [Q3(sA, oBack + 0.01, mz + 1.75), Q3(sB, oBack + 0.01, mz + 1.75), Q3(sB, oBack + 0.01, mz + 2.6), Q3(sA, oBack + 0.01, mz + 2.6)], o3, col('#fbfaf6'));
  for (let s = sA + 0.4; s < sB - 0.3; s += 0.37) { const q = Q(s, oBack + 0.03); B('plaster').box(q[0], mz + 2.15 + Math.sin(s * 3.1) * 0.12, q[1], 0.05, 0.45 + Math.cos(s * 1.7) * 0.15, 0.01, rot, col('#3a3a3c')); }
  { const q = Q(sB - 1.3, oBack + 0.03); B('plaster').box(q[0], mz + 2.15, q[1], 0.7, 0.7, 0.02, rot, col('#e8622a')); }
  // mezzanine stair (visual) up the right-hand side wall
  for (let k = 0; k < 12; k++) { const q = Q(sB - 0.6, oBack + md + 0.3 + (11 - k) * 0.28); B('plaster').box(q[0], H + (k + 0.5) * ((mz - H) / 12), q[1], 1.1, (mz - H) / 12, 0.28, rot, col('#dedbd3')); }
  // two lifts + TV between them under the mezzanine, reception desk, benches
  for (const sl of [-2.3, 0.2]) { const q = Q(sl, oBack + 0.03); B('plaster').box(q[0], H + 1.1, q[1], 1.2, 2.2, 0.04, rot, col('#a4a9ae')); B('plaster').box(q[0], H + 1.1, q[1], 0.02, 2.2, 0.05, rot, col('#5d6166')); }
  { const q = Q(-1.05, oBack + 0.04); B('plaster').box(q[0], H + 2.6, q[1], 1.3, 0.75, 0.05, rot, col('#15181c')); B('emissive').box(q[0], H + 2.6, q[1] , 1.2, 0.66, 0.06, rot, col('#8fb0d8')); }
  { const q = Q(2.8, -4.2); B('plaster').box(q[0], H + 0.55, q[1], 3.2, 1.1, 0.8, rot, col('#f4f3ef')); B('plaster').box(q[0], H + 1.12, q[1], 3.3, 0.05, 0.9, rot, col('#3b2f2a')); }
  for (const sl of [-4.2, -2.6]) { const q = Q(sl, -3.0); B('plaster').box(q[0], H + 0.45, q[1], 1.5, 0.08, 0.5, rot, col('#2b2d31')); }
  // ceiling light panels (emissive, lit at night) + one lamp point for the night light pool
  for (const sl of [-3.5, 0, 3.5]) for (const ol of [-2.6, -6.2]) {
    const q = Q(sl, ol);
    B('emissive').box(q[0], L.ceil - 0.05, q[1], 1.0, 0.03, 1.0, rot, col('#ffffff'));
  }
  { const q = Q(0, -4.5); kit.lampPoints.push(new THREE.Vector3(q[0], L.ceil - 0.6, q[1])); }
  const lobby = new THREE.Group();
  lobby.name = 'be:lobby';
  for (const [k, b] of bufs) {
    const m = new THREE.Mesh(b.toGeometry(), kit.material(k));
    m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    m.name = `be:lobby:${k}`;
    lobby.add(m);
  }
  const lod = new THREE.LOD();
  lod.name = 'be:lobbyLOD';
  const lc = Q(0, -4.5);
  lod.position.set(lc[0], 0, lc[1]);
  lobby.position.set(-lc[0], 0, -lc[1]);
  lod.addLevel(lobby, 0);
  lod.addLevel(new THREE.Object3D(), 90);
  kit.group.add(lod);
  // lobby potted plants (instanced cycads + pots in the shared buffers)
  for (const [sl, ol] of [[-5.2, -1.4], [5.2, -1.4], [-5.2, -8.2]] as V2[]) { const q = Q(sl, ol); pottedPlant(kit, q[0], H, q[1], 1.3); }
}
