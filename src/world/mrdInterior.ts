import * as THREE from 'three';
import { GeoBuffer, InteriorKit, PlanFrame } from './buildings';
import { col, type DetailKey, type WorldKit } from './kit';
import { BUILDINGS, MRD_DRUM, MRD_FRAME, MRD_LV, mrdOctagon, type V2 } from './layout';

/**
 * Enterable interior of the Prof. MRD Block (reference/MRD_NOTES.md §5; campus tour 2026 4:10–5:28, 2021 tour 0:57,
 * 2025 tour 0:00–0:40). Everything is laid out in the MRD plan frame of layout.ts `mrdAt(s, t)` (s along the east
 * curtain wall, t into the building):
 *  - ground floor (MRD_LV.f0, the forecourt level): the lobby behind the east glazing ("education for the real world"
 *    wall between cream columns, PES photo-mosaic walls with black reception desks at both ends), a corridor with the
 *    administrative office, the passage into the atrium, the atrium hall (red chairs on black tables, yellow wall
 *    panels, navy lift core, white round columns round the void), and a corridor with a stair down to a door on the
 *    Open Air Theatre side (ground level, where the OAT footway meets MRD);
 *  - a straight stair up to the 1st floor (MRD_LV.f1): the gallery round the void and a classroom;
 *  - the upper galleries (not walkable) round the void up to the octagonal skylight lantern on the roof.
 * The shells above (mrd_east from u1, the mrd_up_* pieces from u2) are regular BUILDINGS; the walls, floors, stairs and
 * furniture here are one distance-culled InteriorKit LOD (shared kit materials, no lights, no shadow casting).
 */
const F = new PlanFrame(MRD_FRAME.origin, MRD_FRAME.u, MRD_FRAME.n);
const L = MRD_LV;
const A = L.atrium;
const [CS, CT] = L.c;
const CULL = 95;

type UV = [number, number, number, number];

// palette (2026 tour frames): white marble floor with charcoal bands, cream walls and columns, yellow panels, navy cores
const MARBLE = col('#dddbd4'), BAND = col('#3a3c3e'), CREAM = col('#ece4d2'), COLUMN = col('#efe6cf'), YELLOW = col('#e0b22c');
const NAVY = col('#1f2b45'), BLACK = col('#1b1c1e'), DOOR = col('#2e2522'), WHITE = col('#f1efe9'), SKIRT = col('#2a2b2d');
/** Down-facing ceilings: the cool boost offsets the warm ground half of the hemisphere light, which turned the white
 * ceilings tan (bblock.ts does the same). */
const CEIL = new THREE.Color(1.02, 1.1, 1.3);

/**
 * The interior's signs on one small canvas (the shared sign atlas is full): the lobby's "education for the real world"
 * wall, the two photo-mosaic walls, the office plate and a classroom board. Each is drawn at its design size and scaled
 * into its slot; returns the UV rects.
 */
function drawMrdSigns(): { tex: THREE.CanvasTexture; edu: UV; pes: UV; compass: UV; admin: UV; board: UV; aud: UV } {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cg = cv.getContext('2d')!;
  const slot = (x: number, y: number, w: number, h: number, dw: number, dh: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): UV => {
    cg.save(); cg.translate(x, y); cg.beginPath(); cg.rect(0, 0, w, h); cg.clip(); cg.scale(w / dw, h / dh);
    draw(cg, dw, dh);
    cg.restore();
    const hx = 0.5 / W, hy = 0.5 / H;
    return [x / W + hx, 1 - (y + h) / H + hy, (x + w) / W - hx, 1 - y / H - hy];
  };
  const edu = slot(0, 0, 768, 240, 1024, 320, (g, w, h) => {
    g.fillStyle = '#4c5660'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9ccef'; g.font = 'bold 58px Arial, sans-serif'; g.textBaseline = 'top';
    g.fillText('education for the real world', 40, 22);
    const r = mulberry(7);
    // timeline cards, yellow "SPIRIT" discs, stat blocks and a globe
    for (let i = 0; i < 14; i++) {
      const x = 40 + i * 68 + (i > 6 ? 60 : 0), y = 110 + (i % 3) * 58;
      g.fillStyle = ['#f2c200', '#ffffff', '#c8342e', '#1b1c1e', '#8fc36b'][Math.floor(r() * 5)];
      g.fillRect(x, y, 44 + r() * 20, 30 + r() * 18);
    }
    g.fillStyle = '#f2c200';
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(520 + (k % 2) * 26, 108 + k * 34, 15, 0, Math.PI * 2); g.fill(); }
    for (let k = 0; k < 6; k++) g.fillRect(600 + k * 22, 110, 14, 40);
    g.beginPath(); g.arc(880, 150, 42, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4c5660'; g.fillRect(846, 146, 68, 6); g.fillRect(876, 110, 6, 80);
    g.fillStyle = '#ffffff'; g.font = 'bold 20px Arial, sans-serif';
    g.fillText('PERSEVERANCE', 800, 206); g.fillText('EXCELLENCE', 800, 230); g.fillText('SERVICE', 800, 254);
    g.font = 'bold 22px Arial, sans-serif'; g.fillStyle = '#f2c200';
    ['1972', '1988', '2002', '2004', '2013'].forEach((t, i) => g.fillText(t, 60 + i * 150, 280));
  });
  const mosaic = (g: CanvasRenderingContext2D, w: number, h: number, seed: number) => {
    const r = mulberry(seed);
    const cell = 32;
    for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
      const v = 70 + Math.floor(r() * 150);
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, cell - 1, cell - 1);
      // a pale face / figure blob in most tiles (the photo mosaic)
      const f = 150 + Math.floor(r() * 90);
      g.fillStyle = `rgb(${f},${f},${f})`;
      g.beginPath(); g.arc(x + 10 + r() * 12, y + 10 + r() * 8, 5 + r() * 4, 0, Math.PI * 2); g.fill();
      g.fillRect(x + 6 + r() * 8, y + 20, 12 + r() * 8, 11);
    }
  };
  const pes = slot(0, 244, 256, 256, 448, 448, (g, w, h) => {
    mosaic(g, w, h, 11);
    g.fillStyle = '#233a8c'; g.font = 'bold 150px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PES', w / 2, h * 0.42);
    g.fillStyle = '#a3182a'; g.font = 'bold 50px Arial, sans-serif';
    g.fillText('UNIVERSITY', w / 2, h * 0.64);
  });
  const compass = slot(260, 244, 256, 256, 448, 448, (g, w, h) => {
    mosaic(g, w, h, 23);
    const cx = w / 2, cy = h / 2;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, big = k % 2 === 0, rr = big ? 120 : 80;
      g.fillStyle = big ? '#c8342e' : '#e8622a';
      g.beginPath(); g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      g.lineTo(cx + Math.cos(a + 0.35) * 42, cy + Math.sin(a + 0.35) * 42); g.lineTo(cx + Math.cos(a - 0.35) * 42, cy + Math.sin(a - 0.35) * 42); g.fill();
    }
    g.fillStyle = '#1f2b45'; g.beginPath(); g.arc(cx, cy, 58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3f86c8'; g.beginPath(); g.arc(cx, cy, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5aa05a'; g.fillRect(cx - 20, cy - 14, 18, 20); g.fillRect(cx + 4, cy - 4, 16, 22);
  });
  const admin = slot(520, 244, 256, 51, 320, 64, (g, w, h) => {
    g.fillStyle = '#111214'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2f2f2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 20px Arial, sans-serif'; g.fillText('ಆಡಳಿತ ಕಛೇರಿ', w / 2, h * 0.3);
    g.font = 'bold 22px Arial, sans-serif'; g.fillText('Administrative Office', w / 2, h * 0.72);
  });
  const board = slot(520, 300, 288, 96, 384, 128, (g, w, h) => {
    g.fillStyle = '#29423a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(235,240,235,0.75)'; g.lineWidth = 3; g.font = '22px "Comic Sans MS", cursive, sans-serif'; g.fillStyle = 'rgba(235,240,235,0.85)';
    g.fillText('UE23CS251 — Design & Analysis of Algorithms', 16, 36);
    g.fillText('T(n) = 2T(n/2) + O(n)  =>  O(n log n)', 16, 74);
    g.beginPath(); g.moveTo(16, 96); g.lineTo(300, 96); g.stroke();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const aud = slot(776, 0, 248, 50, 320, 64, (g, w, h) => {
    g.fillStyle = '#111214'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2f2f2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 20px Arial, sans-serif'; g.fillText('ಸಭಾಂಗಣ', w / 2, h * 0.3);
    g.font = 'bold 24px Arial, sans-serif'; g.fillText('Auditorium', w / 2, h * 0.72);
  });
  return { tex, edu, pes, compass, admin, board, aud };
}

/** Sign quad (same layout as WorldKit.signQuad) into a local buffer: centre, size, facing (nx, nz). */
function signQuad(b: GeoBuffer, uv: UV, x: number, y: number, z: number, w: number, h: number, nx: number, nz: number): void {
  const l = Math.hypot(nx, nz) || 1;
  nx /= l; nz /= l;
  const rx = nz, rz = -nx;
  const c = (sx: number, sy: number): [number, number, number] => [x + rx * sx * w / 2, y + sy * h / 2, z + rz * sx * w / 2];
  const [u0, v0, u1, v1] = uv;
  const p0 = c(-1, -1), p1 = c(1, -1), p2 = c(1, 1), p3 = c(-1, 1);
  const i0 = b.vert(p0[0], p0[1], p0[2], nx, 0, nz, u0, v0), i1 = b.vert(p1[0], p1[1], p1[2], nx, 0, nz, u1, v0);
  const i2 = b.vert(p2[0], p2[1], p2[2], nx, 0, nz, u1, v1), i3 = b.vert(p3[0], p3[1], p3[2], nx, 0, nz, u0, v1);
  b.quad(i0, i1, i2, i3);
}


function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Wall occupying the frame rect s0..s1 × t0..t1 (it runs along its long side), openings measured from its start. */
function fwall(k: InteriorKit, key: DetailKey, s0: number, t0: number, s1: number, t1: number, y0: number, y1: number, c: THREE.Color, openings: [number, number, number, number][] = [], tag: string | null = 'mrd:wall'): void {
  if (s1 - s0 >= t1 - t0) k.wall(key, s0, t0, s1, t0, y0, y1, t1 - t0, c, openings, tag, -1);
  else k.wall(key, s0, t0, s0, t1, y0, y1, s1 - s0, c, openings, tag, 1);
}

/** Frame-aligned rectangle in plan (collision helper). */
const R = (s0: number, t0: number, s1: number, t1: number): V2[] => F.rect(s0, t0, s1, t1);

export function buildMrdInterior(kit: WorldKit): void {
  const k = new InteriorKit(kit, F);
  // walls + slabs cast shadows (keeps sunlight out from under the shells); furniture and fittings do not
  k.castKeys = new Set(['plaster']);
  const C = kit.collision;
  const { f0: F0, f1: F1, u1: U1, u2: U2 } = L;
  const { doors } = mrdGlazing(kit);
  mrdGlazingPanes(k, doors);
  const SG = drawMrdSigns();
  const sb = new GeoBuffer();

  // ================================================================ solids: floor podium, filled pockets, office block
  C.addPolygon(R(-12.7, 0, 12.5, 15.3), F0, 'concrete', 'mrd:floor');
  C.addPolygon(R(A.s0, A.t0, A.s1, A.t1), F0, 'concrete', 'mrd:floor');
  C.addPolygon(F.poly([[-12.7, 0], [-13.145, 0], [-20.122, 14.829], [-20.176, 15.3], [-12.7, 15.3]]), U1, 'concrete', 'mrd:solid');
  C.addPolygon(F.poly([[12.5, 0], [13.145, 0], [12.512, 15.3], [12.5, 15.3]]), U1, 'concrete', 'mrd:solid');
  C.addPolygon(R(-12.5, 8.8, -1.8, 15.3), U1 - F0, 'concrete', 'mrd:solid', F0);

  // ================================================================ lobby (t 0…8.6) behind the east glazing
  const yl = F0 + 0.006;
  k.fflat('polished', [[-12.7, 0], [12.5, 0], [12.5, 8.8], [-12.7, 8.8]], yl, MARBLE, 2);
  // charcoal granite bands: one along the glazing, diagonals across the lobby (frames 4:12–4:20)
  k.fflat('polished', [[-12.5, 0.9], [12.3, 0.9], [12.3, 1.15], [-12.5, 1.15]], yl + 0.006, BAND, 2);
  for (const s of [-9, -3, 3, 9]) k.fflat('polished', [[s - 0.12, 1.15], [s + 0.12, 1.15], [s + 3.1, 8.6], [s + 2.86, 8.6]], yl + 0.006, BAND, 2);
  // end walls with the photo mosaics (north: PES UNIVERSITY letters, south: the compass emblem)
  fwall(k, 'plaster', 12.3, 0, 12.5, 8.8, F0, U1, CREAM);
  fwall(k, 'plaster', -12.7, 0, -12.5, 8.8, F0, U1, CREAM);
  const nL: V2 = [-F.u[0], -F.u[1]], nR: V2 = [F.u[0], F.u[1]];
  {
    const pn = F.at(12.28, 4.4), ps = F.at(-12.48, 4.4);
    signQuad(sb, SG.pes, pn[0], F0 + 2.05, pn[1], 4.4, 3.9, nL[0], nL[1]);
    signQuad(sb, SG.compass, ps[0], F0 + 2.05, ps[1], 4.4, 3.9, nR[0], nR[1]);
  }
  // back wall of the lobby: the passage (centre) and the administrative office door (north); dark doors, notice boards
  fwall(k, 'plaster', -12.5, 8.6, 12.3, 8.8, F0, U1, CREAM, [[10.9, 14.1, F0, F0 + 3.6], [17.3, 19.7, F0, F0 + 2.5]]);
  for (const s of [-10.0, -5.2]) { k.fbox('wood', s - 0.55, F0, 8.57, s + 0.55, F0 + 2.3, 8.6, DOOR, 0.5); k.fbox('metal', s + 0.35, F0 + 1.0, 8.55, s + 0.43, F0 + 1.1, 8.57, col('#b8bcc0')); }
  for (const s of [-8, 3.4, 9.6]) { k.fbox('wood', s - 0.7, F0 + 1.1, 8.56, s + 0.7, F0 + 2.1, 8.6, col('#7b5a3a'), 0.5); k.fbox('plaster', s - 0.62, F0 + 1.16, 8.555, s + 0.62, F0 + 2.04, 8.56, col('#f4f1e8')); }
  // skirting along every lobby wall
  for (const [s0, t0, s1, t1] of [[-12.5, 8.56, 12.3, 8.6], [12.26, 0, 12.3, 8.6], [-12.5, 0, -12.46, 8.6]] as number[][]) k.fbox('polished', s0, F0, t0, s1, F0 + 0.12, t1, SKIRT);
  { const p = F.at(6.1, 8.585); signQuad(sb, SG.admin, p[0], F0 + 2.8, p[1], 1.6, 0.32, -F.n[0], -F.n[1]); }
  { const p = F.at(-5.4, A.t1 - 0.245); signQuad(sb, SG.aud, p[0], F0 + 3.05, p[1], 1.5, 0.3, -F.n[0], -F.n[1]); }
  // the "education for the real world" wall between cream columns, facing the doors
  k.fbox('plaster', -4.2, F0, 4.2, 4.2, F0 + 3.4, 4.5, col('#4c5660'), 0.5);
  k.fbox('polished', -4.25, F0, 4.18, 4.25, F0 + 0.12, 4.52, SKIRT);
  C.addPolygon(R(-4.2, 4.2, 4.2, 4.5), 3.4, 'concrete', 'mrd:wall', F0);
  { const p = F.at(0, 4.185); signQuad(sb, SG.edu, p[0], F0 + 1.75, p[1], 8.2, 2.56, -F.n[0], -F.n[1]); }
  for (const s of [-10.4, -6.2, 6.2, 10.4]) column(k, s, 4.35, F0, U1, 0.32);
  // black granite reception desks in front of both mosaics, black steel waiting benches
  // (desks run into the end walls and back to the skirting of the lobby's back wall: no player-sized gap is left behind
  // them that the navigation cannot reach; the 0.8 m slot at t 7.8…8.6 was one. Their fronts stop at t 5.95: at 5.6 the
  // floor between the south desk, the column and the end wall was a 1 m nav cell cut off from its neighbours.)
  for (const [s0, s1] of [[10.6, 12.3], [-12.5, -10.8]] as V2[]) {
    k.fbox('polished', s0, F0, 5.95, s1, F0 + 1.05, 8.56, BLACK, 0.5);
    k.fbox('polished', s0 - 0.05, F0 + 1.05, 5.9, s1 + 0.05, F0 + 1.1, 8.6, col('#2a2c2e'));
    C.addPolygon(R(s0, 5.95, s1, 8.6), 1.1, 'concrete', 'desk', F0);
  }
  bench(k, C, -8.0, 8.1, F0, 0);
  bench(k, C, 2.9, 8.1, F0, 0);
  // white ceiling under the mrd_east soffit (lobby, passage, office)
  k.fflat('plaster', [[-12.7, -0.12], [12.5, -0.12], [12.5, 15.3], [-12.7, 15.3]], U1 - 0.02, CEIL, 2, true);
  // ceiling light panels
  for (const s of [-9.6, -4.8, 0, 4.8, 9.6]) for (const t of [2.6, 6.6]) k.flight(s, U1 - 0.03, t, 1.2, 0.6);

  // ================================================================ passage (s ±1.6) and the administrative office
  fwall(k, 'plaster', -1.8, 8.8, -1.6, 15.3, F0, U1, CREAM);
  fwall(k, 'plaster', 1.6, 8.8, 1.8, 15.3, F0, U1, CREAM);
  k.fflat('polished', [[-1.6, 8.8], [1.6, 8.8], [1.6, 15.3], [-1.6, 15.3]], yl, MARBLE, 2);
  k.fflat('polished', [[-0.12, 8.8], [0.12, 8.8], [0.12, 15.3], [-0.12, 15.3]], yl + 0.006, BAND, 2);
  for (const t of [10.2, 13.4]) { k.fbox('wood', -1.6, F0, t - 0.55, -1.57, F0 + 2.3, t + 0.55, DOOR, 0.5); k.flight(0, U1 - 0.03, t, 0.6, 1.2); }
  // office: s 1.8…12.3, t 8.8…15.1 (door from the lobby corridor)
  fwall(k, 'plaster', 1.8, 15.1, 12.3, 15.3, F0, U1, CREAM);
  fwall(k, 'plaster', 12.3, 8.8, 12.5, 15.1, F0, U1, CREAM);
  k.fflat('polished', [[1.8, 8.8], [12.3, 8.8], [12.3, 15.1], [1.8, 15.1]], yl, col('#d2cfc6'), 2);
  // one row of desks with ≥ 2 m walkways all round: the frame is turned ~59° to the 1 m nav grid, so a 1.8 m gap
  // between the desks, the counter and the cupboards left the corner behind them unreachable
  for (const [s, t] of [[4.7, 11.8], [8.0, 11.8]] as V2[]) desk(k, C, s, t, F0);
  for (let s = 2.4; s < 11.8; s += 1.0) k.fbox('metal', s, F0, 14.55, s + 0.9, F0 + 2.0, 15.1, col('#8d9096'));
  C.addPolygon(R(2.4, 14.55, 11.8, 15.1), 2.0, 'metal', 'prop', F0);
  // service counter against the east wall, run back to the lobby wall (a 0.8 m slot at t 8.8…9.6 was left behind it)
  k.fbox('wood', 11.0, F0, 8.8, 12.3, F0 + 1.05, 11.8, col('#6b4b33'), 0.5);
  C.addPolygon(R(11.0, 8.8, 12.3, 11.8), 1.05, 'wood', 'desk', F0);
  for (const s of [4, 8]) for (const t of [10.6, 13.4]) k.flight(s, U1 - 0.03, t, 1.2, 0.6);

  // ================================================================ atrium walls (ground + 1st floor)
  const at0 = A.t0, at1 = A.t1, as0 = A.s0, as1 = A.s1;
  fwall(k, 'plaster', as0 + 0.2, at0, as1 - 0.2, at0 + 0.2, F0, U2, CREAM, [[14.2, 17.4, F0, F0 + 3.6]]);
  fwall(k, 'plaster', as1 - 0.2, at0, as1, at1, F0, U2, CREAM);
  fwall(k, 'plaster', as0 + 0.2, at1 - 0.2, as1 - 0.2, at1, F0, U2, CREAM, [[9.2, 11.6, F0, F0 + 2.6]]); // auditorium doors (s −6.6…−4.2)
  fwall(k, 'plaster', as0, at0, as0 + 0.2, at1, F0, U2, CREAM, [[3.9, 6.5, F0, U2]]);
  // lintel strip over the corridor opening on the ground floor
  k.fbox('plaster', as0, F0 + 3.4, 19.2, as0 + 0.2, U1, 21.8, CREAM, 0.5);
  // skirting + yellow wall panels + navy pilasters (ground floor), doors and notice boards on both floors
  k.fbox('polished', as0 + 0.2, F0, at0 + 0.2, as1 - 0.2, F0 + 0.12, at0 + 0.24, SKIRT);
  k.fbox('polished', as0 + 0.2, F0, at1 - 0.24, as1 - 0.2, F0 + 0.12, at1 - 0.2, SKIRT);
  k.fbox('polished', as1 - 0.24, F0, at0 + 0.2, as1 - 0.2, F0 + 0.12, at1 - 0.2, SKIRT);
  k.fbox('polished', as0 + 0.2, F0, at0 + 0.2, as0 + 0.24, F0 + 0.12, at1 - 0.2, SKIRT);
  for (const [s0, s1] of [[-13.5, -8.5], [-3.6, 1.0], [3.0, 7.5]] as V2[]) k.fbox('plaster', s0, F0 + 0.12, at1 - 0.23, s1, U1 - 0.4, at1 - 0.2, YELLOW, 0.5);
  // the auditorium entrance (2021 tour 5bxHqmfj7bE 1:28: black double doors under a bilingual plate in a yellow wall)
  for (const [s0, s1] of [[-7.4, -6.6], [-4.2, -3.6]] as V2[]) k.fbox('plaster', s0, F0 + 0.12, at1 - 0.23, s1, U1 - 0.4, at1 - 0.2, YELLOW, 0.5);
  k.fbox('plaster', -7.4, F0 + 2.6, at1 - 0.23, -3.6, U1 - 0.4, at1 - 0.2, YELLOW, 0.5);
  for (const [s, dir] of [[-6.6, 1], [-4.2, -1]] as V2[]) k.fbox('wood', s, F0, at1 - 0.2 + 0.05, s + dir * 0.06, F0 + 2.5, at1 + 1.2, col('#141516'), 0.5);
  k.fbox('metal', -6.66, F0 + 2.55, at1 - 0.24, -4.14, F0 + 2.65, at1 - 0.18, col('#141516'));
  for (const [t0, t1] of [[23.5, 28.5]] as V2[]) k.fbox('plaster', as1 - 0.23, F0 + 0.12, t0, as1 - 0.2, U1 - 0.4, t1, YELLOW, 0.5);
  // navy pilasters (solid: they stand 0.3 m proud of the walls)
  for (const s of [-12.2, -1.4, 7.8]) {
    k.fbox('stone', s - 0.35, F0, at1 - 0.5, s + 0.35, U2, at1 - 0.2, NAVY, 0.5);
    C.addPolygon(R(s - 0.35, at1 - 0.5, s + 0.35, at1 - 0.2), U2 - F0, 'concrete', 'column', F0);
  }
  for (const t of [20.0, 26.0, 31.4]) {
    k.fbox('stone', as1 - 0.5, F0, t - 0.35, as1 - 0.2, U1, t + 0.35, NAVY, 0.5);
    C.addPolygon(R(as1 - 0.5, t - 0.35, as1 - 0.2, t + 0.35), U1 - F0, 'concrete', 'column', F0);
  }
  // (the 1st-floor door at s −12 was hidden behind the pilaster at s −12.2)
  for (const [s, t, y] of [[-9.8, at1 - 0.21, F0], [4.8, at1 - 0.21, F0], [-10.2, at1 - 0.21, F1], [-6.0, at1 - 0.21, F1]] as number[][]) {
    k.fbox('wood', s - 0.55, y, t - 0.03, s + 0.55, y + 2.3, t, DOOR, 0.5);
    k.fbox('plaster', s - 0.62, y + 2.3, t - 0.03, s + 0.62, y + 2.45, t, col('#111214'));
  }
  // notice boards on the east wall, clear of the lift core (to t 18.0) and the pilasters (t 20, 26, 31.4)
  for (const [t, y] of [[21.8, F0], [29.9, F0]] as V2[]) { k.fbox('wood', as1 - 0.23, y + 1.1, t - 0.8, as1 - 0.2, y + 2.1, t + 0.8, col('#7b5a3a'), 0.5); k.fbox('plaster', as1 - 0.235, y + 1.16, t - 0.72, as1 - 0.23, y + 2.04, t + 0.72, col('#f4f1e8')); }
  // navy lift core in the NE corner (lift doors on both floors)
  k.fbox('stone', 7.0, F0, at0 + 0.2, as1 - 0.2, U2, 18.0, NAVY, 0.5);
  C.addPolygon(R(7.0, at0 + 0.2, as1 - 0.2, 18.0), U2 - F0, 'concrete', 'mrd:core', F0);
  for (const y of [F0, F1]) {
    k.fbox('metal', 6.97, y, 16.1, 7.0, y + 2.3, 17.5, col('#9aa0a6'));
    k.fbox('metal', 6.95, y, 16.78, 6.97, y + 2.3, 16.82, col('#2b2f33'));
    k.fbox('glass', 6.96, y + 2.5, 16.4, 7.0, y + 3.4, 17.2, col('#34424e'));
  }

  // ================================================================ atrium floors, void, columns
  const oct5 = mrdOctagon(L.voidR), ring = mrdOctagon(L.ringR);
  const hs = (as1 - as0) / 2, ht = (at1 - at0) / 2;
  const rel = (p: [number, number][]): [number, number][] => p.map(([a, b]) => [CS + a, CT + b]);
  k.fflat('polished', [[as0, at0], [as1, at0], [as1, at1], [as0, at1]], yl, MARBLE, 2);
  // charcoal bands framing the space under the void (frame 5:02: dark bands with a white marble field)
  for (let i = 0; i < 8; i++) {
    const a = mrdOctagon(L.voidR + 0.3)[i], b = mrdOctagon(L.voidR + 0.3)[(i + 1) % 8], a2 = oct5[i], b2 = oct5[(i + 1) % 8];
    k.fflat('polished', [a2, b2, b, a], yl + 0.006, BAND, 2);
  }
  // 1st-floor slab: the atrium footprint minus the void (four pieces) minus the stairwell (south-west strip)
  const h5 = L.voidR * Math.tan(Math.PI / 8);
  const sw = { s0: -15.8, s1: -13.2, t0: 23.0, t1: 31.2 };
  const swr = { s0: sw.s0 - CS, s1: sw.s1 - CS, t0: sw.t0 - CT, t1: sw.t1 - CT };
  const slabs: [number, number][][] = [
    rel([[-hs, -ht], [-hs, swr.t0], [swr.s1, swr.t0], [swr.s1, swr.t1], [-hs, swr.t1], [-hs, ht], [-h5, L.voidR], [-L.voidR, h5], [-L.voidR, -h5], [-h5, -L.voidR]]),
    rel([[hs, ht], [hs, -ht], [h5, -L.voidR], [L.voidR, -h5], [L.voidR, h5], [h5, L.voidR]]),
    rel([[-hs, -ht], [-h5, -L.voidR], [h5, -L.voidR], [hs, -ht]]),
    rel([[hs, ht], [h5, L.voidR], [-h5, L.voidR], [-hs, ht]]),
    [[-16, 19], [-16, 22], [-20.95, 22], [-20.602, 19]], // over the OAT-side corridor
  ];
  for (const p of slabs) {
    C.addPolygon(F.poly(p), F1 - U1, 'concrete', 'mrd:slab', U1);
    k.fflat('polished', p, F1 + 0.005, MARBLE, 2);
    k.fflat('plaster', p, U1, CEIL, 2, true);
  }
  // slab edge fascia round the void and the stairwell
  const edgeRun = (pts: [number, number][], y0: number, y1: number, closed: boolean) => {
    const g = k.b('plaster');
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const a = F.at(...pts[i]), b = F.at(...pts[(i + 1) % pts.length]);
      g.wallQuad(b, a, y0, y1, WHITE, 0.5, true);
    }
  };
  edgeRun(oct5, U1, F1, true);
  edgeRun([[sw.s1, sw.t0], [sw.s1, sw.t1]], U1, F1, false);
  edgeRun([[sw.s0, sw.t0], [sw.s1, sw.t0]], U1, F1, false);
  // parapets round the void (1st floor walkable; upper floors visual) + the round white columns at the void corners
  for (const y of [F1, L.f2, L.f3, L.f4]) parapetRun(k, C, oct5, y, true, y === F1);
  for (const p of oct5) column(k, p[0], p[1], F0, L.roofU, 0.34, true);
  // upper galleries (2nd–4th floor): ring minus void slabs, visual + ceilings (not reachable)
  for (const [top, und] of [[L.f2, L.u2], [L.f3, L.u3], [L.f4, L.u4]] as V2[]) {
    for (let i = 0; i < 8; i++) {
      const p = [ring[i], ring[(i + 1) % 8], oct5[(i + 1) % 8], oct5[i]];
      C.addPolygon(F.poly(p), top - und, 'concrete', 'mrd:gallery', und);
      k.fflat('polished', p, top + 0.005, col('#d8d6cf'), 2);
      k.fflat('plaster', p, und, CEIL, 2, true);
    }
    edgeRun(oct5, und, top, true);
    // gallery ceiling lights
    for (let i = 0; i < 8; i++) { const m = mid(ring[i], oct5[(i + 1) % 8]); k.flight(m[0], und - 0.03, m[1], 0.6, 0.6); }
  }
  // 1st-floor ceiling under the mrd_up_* soffits (atrium footprint minus the ring) and over the corridor landing
  {
    const g = L.ringR, hg = g * Math.tan(Math.PI / 8);
    for (const p of [
      rel([[-hs, -ht], [-hs, ht], [-hg, g], [-g, hg], [-g, -hg], [-hg, -g]]), rel([[hs, ht], [hs, -ht], [hg, -g], [g, -hg], [g, hg], [hg, g]]),
      rel([[-hs, -ht], [-hg, -g], [hg, -g], [hs, -ht]]), rel([[hs, ht], [hg, g], [-hg, g], [-hs, ht]]),
      [[-16, 19], [-16, 22], [-20.95, 22], [-20.602, 19]] as [number, number][],
    ]) k.fflat('plaster', p, U2 - 0.02, CEIL, 2, true);
  }
  // roof round the lantern (ring minus void) — underside seen from the atrium, top seen from the air
  for (let i = 0; i < 8; i++) {
    const p = [ring[i], ring[(i + 1) % 8], oct5[(i + 1) % 8], oct5[i]];
    C.addPolygon(F.poly(p), L.roof - L.roofU, 'concrete', 'mrd:roof', L.roofU);
    k.fflat('plaster', p, L.roofU, CEIL, 2, true);
    kit.buf('concrete', F.at(CS, CT)[0], F.at(CS, CT)[1]).flatPoly(F.poly(p), L.roof, col('#b9b3a8'), 3);
  }
  edgeRun(oct5, L.roofU, L.roof, true);
  lantern(kit);

  // ================================================================ stair up to the 1st floor (south wall, rising +t)
  {
    const n = 29, run = (sw.t1 - sw.t0) / n, rise = (F1 - F0) / n;
    for (let i = 0; i < n; i++) {
      const t0 = sw.t0 + i * run, y = F0 + (i + 1) * rise;
      k.fbox('polished', sw.s0, F0 - 0.01, t0, sw.s1, y, t0 + run + 0.005, col('#e4e2dc'), 0.5);
      k.fbox('polished', sw.s0, y - 0.004, t0 - 0.004, sw.s1, y + 0.004, t0 + 0.03, BAND); // dark nosing
    }
    C.addRamp(R(sw.s0, sw.t0, sw.s1, sw.t1), F.at((sw.s0 + sw.s1) / 2, sw.t0), F.at((sw.s0 + sw.s1) / 2, sw.t1), F0, F1, 'concrete', 'mrd:stair');
    // black steel railing on the open side of the flight (collision in short pieces following the slope)
    const rs = sw.s1 - 0.06;
    const railC = col('#1e2023');
    const mb = k.b('metal');
    const p0 = F.at(rs, sw.t0), p1 = F.at(rs, sw.t1);
    mb.beam([p0[0], F0 + 1.0, p0[1]], [p1[0], F1 + 1.0, p1[1]], 0.05, 0.05, railC);
    mb.beam([p0[0], F0 + 0.5, p0[1]], [p1[0], F1 + 0.5, p1[1]], 0.03, 0.03, railC);
    for (let i = 0; i <= 8; i++) { const t = sw.t0 + ((sw.t1 - sw.t0) * i) / 8, y = F0 + ((F1 - F0) * i) / 8; k.fbox('metal', rs - 0.025, y, t - 0.025, rs + 0.025, y + 1.0, t + 0.025, railC); }
    for (let i = 0; i < 8; i++) {
      const ta = sw.t0 + ((sw.t1 - sw.t0) * i) / 8, tb = sw.t0 + ((sw.t1 - sw.t0) * (i + 1)) / 8, ya = F0 + ((F1 - F0) * i) / 8;
      C.addPolygon(R(rs - 0.06, ta, rs + 0.06, tb), 1.0 + (F1 - F0) / 8, 'metal', 'mrd:rail', ya);
    }
    // stair side (plaster stringer face towards the hall) is the steps' own side; white wall behind is the atrium wall
    // 1st-floor railings round the stairwell
    parapetRun(k, C, [[sw.s1 + 0.1, sw.t1], [sw.s1 + 0.1, sw.t0 - 0.1], [sw.s0, sw.t0 - 0.1]], F1, false, true, true);
  }

  // ================================================================ 1st floor: classroom on the north side of the gallery
  {
    const s0 = 4.4, s1 = as1 - 0.2, t0 = 18.5, t1 = 31.0;
    fwall(k, 'plaster', s0, t0, s0 + 0.2, t1, F1, U2, CREAM, [[1.0, 4.2, F1 + 1.0, F1 + 2.4], [5.1, 7.3, F1, F1 + 2.4], [8.3, 11.5, F1 + 1.0, F1 + 2.4]]);
    fwall(k, 'plaster', s0 + 0.2, t0, s1, t0 + 0.2, F1, U2, CREAM);
    fwall(k, 'plaster', s0 + 0.2, t1 - 0.2, s1, t1, F1, U2, CREAM);
    // black-framed windows onto the gallery (see-through) and the door frame
    for (const [a, b] of [[t0 + 1.0, t0 + 4.2], [t0 + 8.3, t0 + 11.5]] as V2[]) {
      k.fpane(s0 + 0.1, a, s0 + 0.1, b, F1 + 1.0, F1 + 2.4);
      for (let t = a; t <= b + 0.01; t += (b - a) / 3) k.fbox('metal', s0 + 0.06, F1 + 1.0, t - 0.03, s0 + 0.14, F1 + 2.4, t + 0.03, BLACK);
      k.fbox('metal', s0 + 0.06, F1 + 1.66, a, s0 + 0.14, F1 + 1.72, b, BLACK);
    }
    k.fbox('wood', s0 - 0.02, F1 + 2.4, t0 + 5.1, s0 + 0.22, F1 + 2.55, t0 + 7.3, DOOR, 0.5);
    // green board + teacher's desk on the far wall, desk-bench rows facing it
    // (the wooden frame stood 2.5 cm in front of the board and hid most of it)
    const bs = (s0 + 0.2 + s1) / 2;
    { const p = F.at(bs, t1 - 0.245); signQuad(sb, SG.board, p[0], F1 + 1.6, p[1], 3.6, 1.2, -F.n[0], -F.n[1]); }
    k.fbox('wood', bs - 1.95, F1 + 0.9, t1 - 0.24, bs + 1.95, F1 + 2.3, t1 - 0.2, col('#5a4632'), 0.5);
    // teacher's desk against the board wall; desk rows packed from the entry end (no player-sized gaps behind them)
    k.fbox('wood', 6.4, F1, t1 - 0.95, 8.4, F1 + 0.78, t1 - 0.2, col('#6b4b33'), 0.5);
    C.addPolygon(R(6.4, t1 - 0.95, 8.4, t1 - 0.2), 0.8, 'wood', 'desk', F1);
    for (let t = t0 + 0.95; t < t1 - 3.2; t += 1.45) deskBench(k, C, 7.9, t, F1);
    for (const t of [21.5, 25.5, 29.0]) k.flight(6.9, U2 - 0.03, t, 1.2, 0.6);
  }
  // 1st floor gallery details: benches along the walls, a water dispenser, ceiling lights over the walkways
  bench(k, C, -8.5, at1 - 0.65, F1, 0);
  bench(k, C, 0.5, at1 - 0.65, F1, 0);
  waterCooler(k, C, -11.2, 33.0, F1);
  for (const [s, t] of [[-11.8, 17.0], [-3.2, 16.2], [4.0, 16.2], [-3.2, 32.6], [-11.8, 32.6], [-11.8, 24.5]] as V2[]) k.flight(s, U2 - 0.03, t, 1.0, 0.5);
  // ground-floor ceiling lights under the 1st-floor slab
  for (const [s, t] of [[-12.5, 17.5], [-3.2, 16.8], [5.2, 20.5], [7.8, 26.5], [5.2, 31.5], [-3.2, 32.0], [-12.0, 32.0], [-11.2, 27.0]] as V2[]) k.flight(s, U1 - 0.03, t, 1.2, 0.6);

  // ================================================================ atrium furniture: black tables with red chairs, benches, bins
  for (const [s, t] of [[-5.6, 21.6], [-0.6, 21.6], [-5.6, 27.2], [-0.6, 27.2], [4.4, 29.5], [4.4, 21.5], [-9.4, 18.3], [2.6, 32.0], [-7.6, 31.9]] as V2[]) tableSet(k, C, s, t, F0);
  bench(k, C, -12.0, at0 + 0.65, F0, 1);
  bench(k, C, 4.0, at0 + 0.65, F0, 1);
  for (const [s, t] of [[-15.3, 17.8], [8.9, 32.9]] as V2[]) { const p = F.at(s, t); k.box('plaster', p[0], F0 + 0.35, p[1], 0.45, 0.7, 0.45, F.rot, col('#2d59a8'), 0.5); C.addCircle(p[0], p[1], 0.26, 0.7, 'metal', 'prop', F0); }

  // ================================================================ corridor to the Open Air Theatre side (ground level door)
  {
    const cz0 = 19.0, cz1 = 22.0, sa = -16, sb = -19.4, fa: [number, number] = [-20.602, 19.0], fb: [number, number] = [-20.95, 22.0];
    const fs = (t: number) => fa[0] + (fb[0] - fa[0]) * ((t - fa[1]) / (fb[1] - fa[1])); // façade s at t
    // side walls from the ground to the upper floors
    k.wall('plaster', sa, cz0, fs(cz0), cz0, 0, U2, 0.2, CREAM, [], 'mrd:wall', 1);
    k.wall('plaster', sa, cz1, fs(cz1), cz1, 0, U2, 0.2, CREAM, [], 'mrd:wall', -1);
    // stair down 12 risers along −s, then a granite landing at the ground
    const n = 12, run = (sa - sb) / n, rise = F0 / n;
    for (let i = 0; i < n; i++) {
      const sHi = sa - i * run, y = F0 - i * rise;
      k.fbox('granite', sHi - run - 0.005, 0, cz0 + 0.2, sHi, y, cz1 - 0.2, col('#b9b6ae').multiplyScalar(0.96 + (i % 2) * 0.04), 0.5);
    }
    C.addRamp(R(sb, cz0 + 0.2, sa, cz1 - 0.2), F.at(sa, 20.5), F.at(sb, 20.5), F0, 0, 'concrete', 'mrd:stair');
    k.fflat('granite', [[sb, cz0 + 0.2], [sb, cz1 - 0.2], [fs(cz1 - 0.2), cz1 - 0.2], [fs(cz0 + 0.2), cz0 + 0.2]], 0.03, col('#a9a69f'), 2);
    for (const t of [cz0 + 0.24, cz1 - 0.24]) { const a = F.at(sa, t), b = F.at(sb, t); k.b('metal').beam([a[0], F0 + 0.95, a[1]], [b[0], 0.95, b[1]], 0.05, 0.05, col('#8d9196')); }
    k.flight(-18.2, U1 - 0.03, 20.5, 1.4, 0.6);
    k.flight(-18.4, U2 - 0.03, 20.5, 1.2, 0.6);
    // the façade round the door + the 1st-floor window (outer face flush with the extruded wings either side)
    const doorA: [number, number, number, number] = [0.42, 2.62, 0, 2.75], win: [number, number, number, number] = [0.6, 2.4, F1 + 0.9, F1 + 2.5];
    k.wall('plaster', fa[0], fa[1], fb[0], fb[1], 0, F0 + 1.2, 0.3, col('#efe7d6'), [doorA], 'mrd:wall', 1);
    k.wall('plaster', fa[0], fa[1], fb[0], fb[1], F0 + 1.2, U2, 0.3, col('#efe7d6'), [win], 'mrd:wall', 1);
    // door frame, glass leaves parked open, navy canopy on the outside, window frame + glass
    const along = (d: number, o: number): V2 => { const a = F.at(...fa), b = F.at(...fb), l = Math.hypot(b[0] - a[0], b[1] - a[1]); const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l; return [a[0] + ux * d + uz * o, a[1] + uz * d - ux * o]; };
    const fr = Math.atan2(-(F.at(...fb)[1] - F.at(...fa)[1]), F.at(...fb)[0] - F.at(...fa)[0]);
    for (const d of [doorA[0], doorA[1]]) { const p = along(d, 0.05); k.box('metal', p[0], 1.4, p[1], 0.1, 2.8, 0.2, fr, col('#2b2f33')); }
    { const p = along((doorA[0] + doorA[1]) / 2, 0.05); k.box('metal', p[0], 2.8, p[1], 2.3, 0.12, 0.2, fr, col('#2b2f33')); }
    { const p = along((doorA[0] + doorA[1]) / 2, 0.7); kit.box('stone', p[0], 3.05, p[1], 3.0, 0.22, 1.4, fr, NAVY, 0.5); }
    for (const d of [win[0], (win[0] + win[1]) / 2, win[1]]) { const p = along(d, 0.02); k.box('metal', p[0], (win[2] + win[3]) / 2, p[1], 0.07, win[3] - win[2], 0.1, fr, BLACK); }
    { const p = along((win[0] + win[1]) / 2, 0.02); k.box('metal', p[0], win[2] + 1.0, p[1], win[1] - win[0], 0.07, 0.1, fr, BLACK); }
    const pa = along(win[0], -0.12), pb = along(win[1], -0.12);
    k.glass.wallQuad(pa, pb, win[2], win[3]);
  }

  // ================================================================ far stand-in: opaque glass for the glazing, the OAT-side
  // facade (its plaster wall round the door and window belongs to the interior LOD, so the far level redraws the whole
  // wall: plaster, the door and the window, side by side on the outer face)
  const far = new THREE.Group();
  {
    const g = new GeoBuffer({ color: true }), pl = new GeoBuffer({ color: true });
    g.wallQuad(F.at(12.5, -0.12), F.at(-12.7, -0.12), F0, U1, col('#2a343d'), 1, true);
    const a = F.at(-20.602, 19.0), b = F.at(-20.95, 22.0), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (d: number): V2 => [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
    const plaster = col('#efe7d6'), door = col('#1c2024'), glass = col('#2a343d');
    const [d0, d1, dTop] = [0.42, 2.62, 2.75], [w0, w1, wy0, wy1] = [0.6, 2.4, F1 + 0.9, F1 + 2.5]; // as the near wall
    const rect = (buf: GeoBuffer, x0: number, x1: number, y0: number, y1: number, c: THREE.Color) => buf.wallQuad(at(x0), at(x1), y0, y1, c, 1, true);
    rect(pl, 0, d0, 0, dTop, plaster); rect(g, d0, d1, 0, dTop, door); rect(pl, d1, len, 0, dTop, plaster);
    rect(pl, 0, len, dTop, wy0, plaster);
    rect(pl, 0, w0, wy0, wy1, plaster); rect(g, w0, w1, wy0, wy1, glass); rect(pl, w1, len, wy0, wy1, plaster);
    rect(pl, 0, len, wy1, U2, plaster);
    for (const [buf, key, name] of [[g, 'glass', 'mrd:farFront'], [pl, 'plaster', 'mrd:farWall']] as const) {
      const m = new THREE.Mesh(buf.toGeometry(), kit.material(key));
      m.name = name; m.matrixAutoUpdate = false; m.updateMatrix();
      far.add(m);
    }
  }
  {
    const m = new THREE.Mesh(sb.toGeometry(), new THREE.MeshStandardMaterial({ map: SG.tex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.name = 'mrd:signs'; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    k.extras.push(m);
  }
  k.build('interior:mrd', F.at(CS, 12), CULL, far);
  buildMrdAuditorium(kit);
}

/** The east entrance glazing: see-through panes (interior LOD) between black mullions, with two open doorways. */
export function mrdGlazing(kit: WorldKit): { doors: V2[] } {
  const { f0: F0, u1: U1 } = L;
  const tg = -0.12; // glass plane just outside the curtain-wall face
  const doors: V2[] = [[-1.2, 1.2], [5.2, 7.6]];
  const frame = col('#1e2226'), blue = col('#4f6d8c');
  // blue-grey columns every 3.2 m (key 0332) and stone end piers closing the face under the extruded block
  // (both solid: the columns stand on the forecourt in front of the glazing line, the piers straddle the face)
  for (const s of [-11.2, -8.0, -4.8, -1.6, 1.6, 4.8, 8.0, 11.2]) {
    const p = F.at(s, tg - 0.2);
    kit.box('stone', p[0], (F0 + U1) / 2, p[1], 0.52, U1 - F0, 0.46, F.rot, blue, 0.5);
    kit.collision.addPolygon(R(s - 0.26, tg - 0.43, s + 0.26, tg + 0.03), U1 - F0, 'concrete', 'column', F0);
  }
  for (const [s0, s1] of [[-13.2, -12.7], [12.5, 13.2]] as V2[]) {
    const p = F.at((s0 + s1) / 2, -0.1);
    kit.box('stone', p[0], (U1 + 0.4) / 2, p[1], s1 - s0, U1 + 0.4, 0.4, F.rot, col('#c8b89e'), 0.5);
    kit.collision.addPolygon(R(s0, -0.3, s1, 0.1), U1 + 0.4, 'concrete', 'column');
  }
  // mullions, transoms and the navy spandrel over the glazing
  const runs: V2[] = [];
  let a = -12.7;
  for (const [d0, d1] of doors) { runs.push([a, d0]); a = d1; }
  runs.push([a, 12.5]);
  const mb = kit.buf('metal', F.origin[0], F.origin[1]);
  for (const [r0, r1] of runs) {
    const n = Math.max(1, Math.round((r1 - r0) / 1.07));
    for (let i = 0; i <= n; i++) { const s = r0 + ((r1 - r0) * i) / n, p = F.at(s, tg); mb.box(p[0], (F0 + U1) / 2, p[1], 0.07, U1 - F0, 0.12, F.rot, frame); }
    for (const y of [F0 + 0.06, F0 + 2.55, F0 + 3.3]) { const p = F.at((r0 + r1) / 2, tg); mb.box(p[0], y, p[1], r1 - r0, 0.08, 0.12, F.rot, frame); }
    kit.collision.addPolygon(R(r0, tg - 0.08, r1, tg + 0.08), U1 - F0, 'metal', 'glazing', F0);
  }
  for (const [d0, d1] of doors) {
    // door frames + transom panes above the open leaves; the leaves swing in against the reveals
    for (const s of [d0, d1]) { const p = F.at(s, tg); mb.box(p[0], (F0 + U1) / 2, p[1], 0.1, U1 - F0, 0.16, F.rot, frame); }
    const p = F.at((d0 + d1) / 2, tg); mb.box(p[0], F0 + 2.55, p[1], d1 - d0, 0.1, 0.16, F.rot, frame);
    // the glass leaves parked open against the reveals: a slim frame here, the pane in mrdGlazingPanes (the leaf was
    // one opaque near-black slab)
    for (const [s, dir] of [[d0, 1], [d1, -1]] as V2[]) {
      const sl = s + dir * 0.05;
      for (const t of [0.03, 1.07]) { const q = F.at(sl, t); mb.box(q[0], F0 + 1.2, q[1], 0.06, 2.3, 0.06, F.rot, frame); }
      for (const y of [F0 + 0.09, F0 + 2.31]) { const q = F.at(sl, 0.55); mb.box(q[0], y, q[1], 0.06, 0.08, 1.1, F.rot, frame); }
    }
  }
  const sp = F.at(-0.1, tg - 0.05);
  kit.box('stone', sp[0], U1 + 0.25, sp[1], 25.4, 0.5, 0.3, F.rot, col('#1f2b45'), 0.5);
  return { doors };
}

/** See-through panes of the east glazing (inside the interior LOD, so they vanish with it; the far front replaces them). */
export function mrdGlazingPanes(k: InteriorKit, doors: V2[]): void {
  const { f0: F0, u1: U1 } = L;
  const tg = -0.12;
  let a = -12.7;
  const runs: V2[] = [];
  for (const [d0, d1] of doors) { runs.push([a, d0]); a = d1; }
  runs.push([a, 12.5]);
  for (const [r0, r1] of runs) k.fpane(r0, tg, r1, tg, F0, U1);
  for (const [d0, d1] of doors) {
    k.fpane(d0, tg, d1, tg, F0 + 2.6, U1);
    for (const [s, dir] of [[d0, 1], [d1, -1]] as V2[]) k.fpane(s + dir * 0.05, 0.06, s + dir * 0.05, 1.04, F0 + 0.13, F0 + 2.27); // open leaves
  }
}

// ------------------------------------------------------------------------------------------------ pieces
function xyz(s: number, y: number, t: number): [number, number, number] { const p = F.at(s, t); return [p[0], y, p[1]]; }
function mid(a: [number, number], b: [number, number]): [number, number] { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

/** Round column (cream plaster) with a dark skirting ring; collision cylinder. */
function column(k: InteriorKit, s: number, t: number, y0: number, y1: number, r: number, white = false): void {
  const p = F.at(s, t);
  k.b('plaster').cylinder(p[0], y0, p[1], r, y1 - y0, 14, white ? WHITE : COLUMN, false);
  k.b('polished').cylinder(p[0], y0, p[1], r + 0.02, 0.12, 14, SKIRT, false);
  k.kit.collision.addCircle(p[0], p[1], r, y1 - y0, 'concrete', 'column', y0);
}

/**
 * White parapet + black steel handrail along a polyline (frame coordinates) at floor y. `outward`: the parapet sits on
 * the side away from the atrium centre (void edges). Collision only when `solid`.
 */
function parapetRun(k: InteriorKit, C: WorldKit['collision'], pts: [number, number][], y: number, closed: boolean, solid: boolean, railOnly = false): void {
  const n = pts.length - (closed ? 0 : 1);
  const cen = F.at(CS, CT);
  for (let i = 0; i < n; i++) {
    const a = F.at(...pts[i]), b = F.at(...pts[(i + 1) % pts.length]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    let nx = -dz, nz = dx;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (closed && (mx - cen[0]) * nx + (mz - cen[1]) * nz < 0) { nx = -nx; nz = -nz; }
    const o = 0.1;
    const rot = Math.atan2(-dz, dx);
    if (!railOnly) k.box('plaster', mx + nx * o, y + 0.45, mz + nz * o, len + 0.2, 0.9, 0.2, rot, WHITE, 0.5);
    else for (let d = 0; d <= len + 0.01; d += Math.max(0.1, len / Math.max(1, Math.round(len / 0.12)))) k.box('metal', a[0] + dx * d, y + 0.5, a[1] + dz * d, 0.02, 1.0, 0.02, 0, col('#1e2023'));
    k.box('metal', mx + nx * o, y + (railOnly ? 1.02 : 1.0), mz + nz * o, len + 0.2, 0.06, 0.08, rot, col('#1e2023'));
    if (!railOnly) for (let d = 0; d <= len; d += 1.2) k.box('metal', a[0] + dx * d + nx * o, y + 0.95, a[1] + dz * d + nz * o, 0.04, 0.12, 0.04, 0, col('#1e2023'));
    if (solid) C.addPolygon([[a[0], a[1]], [b[0], b[1]], [b[0] + nx * 0.2, b[1] + nz * 0.2], [a[0] + nx * 0.2, a[1] + nz * 0.2]], 1.1, 'concrete', 'parapet', y);
  }
}

/** Black canteen table with six attached red plastic seats (tour 2026 frame 0449), long side along s. */
function tableSet(k: InteriorKit, C: WorldKit['collision'], s: number, t: number, y: number): void {
  const red = col('#c81f2a'), frame = col('#2a2c2f');
  k.fbox('polished', s - 0.95, y + 0.72, t - 0.42, s + 0.95, y + 0.76, t + 0.42, col('#141516'), 0.5);
  k.fbox('metal', s - 0.9, y + 0.3, t - 0.03, s + 0.9, y + 0.36, t + 0.03, frame);
  for (const ds of [-0.75, 0.75]) k.fbox('metal', s + ds - 0.03, y, t - 0.75, s + ds + 0.03, y + 0.72, t + 0.75, frame);
  for (const side of [-1, 1]) for (const ds of [-0.62, 0, 0.62]) {
    const tt = t + side * 0.78;
    k.fbox('plaster', s + ds - 0.21, y + 0.42, tt - 0.2, s + ds + 0.21, y + 0.47, tt + 0.2, red, 0.5);
    k.fbox('plaster', s + ds - 0.2, y + 0.47, tt + side * 0.17, s + ds + 0.2, y + 0.9, tt + side * 0.22, red, 0.5);
  }
  C.addPolygon(R(s - 1.0, t - 1.0, s + 1.0, t + 1.0), 0.8, 'metal', 'prop', y);
}

/** Black steel three-seat waiting bench against a wall (seats along s). */
function bench(k: InteriorKit, C: WorldKit['collision'], s: number, t: number, y: number, flip: number): void {
  const c = col('#1e2124'), bk = flip ? -1 : 1; // backrest on the +t side (wall behind at +t), or −t when flipped
  k.fbox('metal', s - 0.95, y + 0.42, t - 0.25, s + 0.95, y + 0.47, t + 0.25, c);
  k.fbox('metal', s - 0.95, y + 0.47, t + bk * 0.22, s + 0.95, y + 0.85, t + bk * 0.27, c);
  for (const ds of [-0.85, 0.85]) k.fbox('metal', s + ds - 0.03, y, t - 0.22, s + ds + 0.03, y + 0.42, t + 0.22, c);
  C.addPolygon(R(s - 1.0, t - 0.3, s + 1.0, t + 0.3), 0.8, 'metal', 'prop', y);
}

/** Office desk + chair (grey laminate, black chair). */
function desk(k: InteriorKit, C: WorldKit['collision'], s: number, t: number, y: number): void {
  k.fbox('wood', s - 0.8, y + 0.72, t - 0.4, s + 0.8, y + 0.76, t + 0.4, col('#8a7a66'), 0.5);
  k.fbox('wood', s - 0.78, y, t + 0.3, s + 0.78, y + 0.72, t + 0.36, col('#6f6252'), 0.5);
  for (const ds of [-0.74, 0.74]) k.fbox('wood', s + ds - 0.03, y, t - 0.38, s + ds + 0.03, y + 0.72, t + 0.38, col('#6f6252'), 0.5);
  k.fbox('dark', s - 0.25, y + 0.9, t + 0.2, s + 0.25, y + 1.25, t + 0.24, col('#15171a')); // monitor
  k.fbox('metal', s - 0.24, y + 0.44, t - 0.95, s + 0.24, y + 0.5, t - 0.5, col('#1e2124'));
  k.fbox('metal', s - 0.24, y + 0.5, t - 1.0, s + 0.24, y + 1.0, t - 0.95, col('#1e2124'));
  C.addPolygon(R(s - 0.82, t - 0.42, s + 0.82, t + 0.42), 0.8, 'wood', 'desk', y);
}

/** Classroom desk-bench unit (timber top on a steel frame), seats three, faces +t. */
function deskBench(k: InteriorKit, C: WorldKit['collision'], s: number, t: number, y: number): void {
  const w = col('#9a6f45'), m = col('#3a3d41');
  k.fbox('wood', s - 0.9, y + 0.74, t + 0.05, s + 0.9, y + 0.78, t + 0.5, w, 0.5);
  k.fbox('wood', s - 0.9, y + 0.42, t - 0.45, s + 0.9, y + 0.46, t - 0.15, w, 0.5);
  k.fbox('wood', s - 0.9, y + 0.46, t + 0.46, s + 0.9, y + 0.74, t + 0.5, w, 0.5);
  for (const ds of [-0.85, 0.85]) k.fbox('metal', s + ds - 0.025, y, t - 0.45, s + ds + 0.025, y + 0.74, t + 0.5, m);
  C.addPolygon(R(s - 0.92, t - 0.5, s + 0.92, t + 0.55), 0.8, 'wood', 'prop', y);
}

function waterCooler(k: InteriorKit, C: WorldKit['collision'], s: number, t: number, y: number): void {
  k.fbox('plaster', s - 0.2, y, t - 0.2, s + 0.2, y + 1.0, t + 0.2, col('#e8e8e4'), 0.5);
  const p = F.at(s, t);
  k.b('glass').cylinder(p[0], y + 1.0, p[1], 0.16, 0.42, 10, col('#6fa0c8'));
  C.addCircle(p[0], p[1], 0.28, 1.4, 'metal', 'prop', y);
}

/** Octagonal skylight lantern on the atrium roof: glazed drum on a white frame + frosted pyramid glazing. */
function lantern(kit: WorldKit): void {
  const d = MRD_DRUM, oct = mrdOctagon(d.radius);
  const y0 = d.base, y1 = d.base + d.height, apex = y1 + 1.6;
  const c = F.at(CS, CT);
  const white = col('#eeeeea');
  const g = kit.buf('glass', c[0], c[1]);
  const fb = kit.buf('paint', c[0], c[1]);
  const pts = oct.map((p) => F.at(...p));
  for (let i = 0; i < 8; i++) {
    const a = pts[i], b = pts[(i + 1) % 8];
    g.wallQuad(b, a, y0 + 0.25, y1 - 0.12, col('#cfdce3'), 1, true);
    fb.beam([a[0], y0, a[1]], [a[0], y1, a[1]], 0.14, 0.14, white);
    fb.beam([a[0], y1, a[1]], [b[0], y1, b[1]], 0.16, 0.16, white);
    fb.beam([a[0], y0 + 0.12, a[1]], [b[0], y0 + 0.12, b[1]], 0.25, 0.25, white);
    fb.beam([a[0], y1, a[1]], [c[0], apex, c[1]], 0.1, 0.1, white);
  }
  // frosted pyramid panes (double-sided so they read from the atrium below)
  const pg = new GeoBuffer();
  for (let i = 0; i < 8; i++) {
    const a = pts[i], b = pts[(i + 1) % 8];
    const e1 = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]), e2 = new THREE.Vector3(c[0] - a[0], apex - y1, c[1] - a[1]);
    const n = new THREE.Vector3().crossVectors(e2, e1).normalize();
    if (n.y < 0) n.negate();
    const i0 = pg.vert(a[0], y1, a[1], n.x, n.y, n.z, 0, 0), i1 = pg.vert(b[0], y1, b[1], n.x, n.y, n.z, 1, 0), i2 = pg.vert(c[0], apex, c[1], n.x, n.y, n.z, 0.5, 1);
    pg.tri(i0, i1, i2); pg.tri(i0, i2, i1);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2f4f5, emissive: new THREE.Color(0.55, 0.57, 0.58), roughness: 0.35, metalness: 0.0, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(pg.toGeometry(), mat);
  m.name = 'mrd:skylight'; m.renderOrder = 2; m.castShadow = false; m.receiveShadow = false; m.matrixAutoUpdate = false; m.updateMatrix();
  kit.group.add(m);
  kit.collision.addPolygon(pts, apex - y0, 'concrete', 'mrd:lantern', y0);
}

// ================================================================================================ auditorium / indoor court
/**
 * The MRD auditorium (2021 tour cWKYL-ruQ_E 1:40–2:10 "The Auditorium – a complete inside view"; Wikimedia "PESIT
 * Auditorium" 2013): a multi-purpose hall with a raked bank of yellow seats at the entrance end, a red court floor with
 * basketball backboards on the side walls, a stage with yellow panels and a screen at the far end, magenta walls,
 * steel trusses with hanging banners. Entered from the atrium through the passage behind the "Auditorium" doors; the
 * seat tiers step down from the atrium level (MRD_LV.f0) to the hall floor at the ground. The 'mrd' building is a
 * walls-only shell; the hall walls, ceiling, roof collision and floor are built here (own distance-culled LOD).
 */
const AUD = { tier0: 38.7, tierD: 1.0, tiers: 6, rise: 0.3, stageT: 59, stageH: 1.0, ceil: 14.2, roofTop: 16.3, wall: 0.3 };

/** World → MRD frame. */
function toLocal(p: V2): [number, number] {
  const rx = p[0] - F.origin[0], rz = p[1] - F.origin[1];
  return [rx * F.u[0] + rz * F.u[1], rx * F.n[0] + rz * F.n[1]];
}
/** Clip a plan polygon (frame coordinates) to the band t0 ≤ t ≤ t1 (Sutherland–Hodgman against two half-planes). */
function clipBand(poly: [number, number][], t0: number, t1: number): [number, number][] {
  const half = (pts: [number, number][], keep: (p: [number, number]) => number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const da = keep(a), db = keep(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const f = da / (da - db); out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
    }
    return out;
  };
  return half(half(poly, (p) => p[1] - t0), (p) => t1 - p[1]);
}
/** s range of a polygon (frame coordinates) at t (from a thin band). */
function spanAt(poly: [number, number][], t: number): [number, number] {
  const row = clipBand(poly, t - 0.01, t + 0.01);
  if (row.length < 2) return [0, 0];
  return [Math.min(...row.map((p) => p[0])), Math.max(...row.map((p) => p[0]))];
}
/** Inset a simple polygon (frame coordinates, any winding) by d. */
function inset(poly: [number, number][], d: number): [number, number][] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1; // CCW (s right, t up): the inward normal of a→b is the left normal
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n], dx = b[0] - a[0], dt = b[1] - a[1], l = Math.hypot(dx, dt) || 1;
    const nx = (-dt / l) * sgn, nt = (dx / l) * sgn;
    return { p: [a[0] + nx * d, a[1] + nt * d] as [number, number], d: [dx / l, dt / l] as [number, number] };
  });
  return poly.map((_, i) => {
    const L1 = lines[(i + n - 1) % n], L2 = lines[i];
    const den = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0];
    if (Math.abs(den) < 1e-6) return L2.p;
    const tt = ((L2.p[0] - L1.p[0]) * L2.d[1] - (L2.p[1] - L1.p[1]) * L2.d[0]) / den;
    return [L1.p[0] + L1.d[0] * tt, L1.p[1] + L1.d[1] * tt] as [number, number];
  });
}

export function buildMrdAuditorium(kit: WorldKit): void {
  const bd = BUILDINGS.find((b) => b.id === 'mrd');
  if (!bd) return;
  const k = new InteriorKit(kit, F);
  k.castKeys = new Set(['plaster']);
  const C = kit.collision;
  const F0 = L.f0;
  const outline = bd.poly.map((p) => toLocal(p));
  const hall = inset(outline, AUD.wall);
  // the hall's walls are drawn from 3 cm inside the outline: their outer faces were coplanar with the shell's facade and
  // z-fought through it (magenta / yellow patches on the outside)
  const skin = inset(outline, 0.03);
  const worldOut = bd.poly;
  const MAG = col('#a8386c'), RED = col('#8e2b2b'), WOOD = col('#9a6a3e'), SEATY = col('#e8b923');

  // ---------------------------------------------------------------- floor, walls, ceiling, roof collision
  C.addPolygon(worldOut, 0.05, 'concrete', 'mrd:floor'); // also keeps the tree / prop scatter out of the hall
  k.fflat('polished', hall, 0.06, RED, 2);
  const passA = toLocal([33.0, -172.0]), passB = toLocal([28.0, -158.0]);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const isPass = Math.hypot(a[0] - passA[0], a[1] - passA[1]) < 0.05 && Math.hypot(b[0] - passB[0], b[1] - passB[1]) < 0.05;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const openings: [number, number, number, number][] = [];
    if (isPass) {
      const along = (s: number) => ((a[0] - s) / (a[0] - b[0])) * len;
      openings.push([along(-4.2), along(-6.6), F0, F0 + 2.6]);
    }
    const side = sideInward(outline, a, b);
    const c = (a[1] + b[1]) / 2 > 60 ? col('#e0a92a') : CREAM;
    const a2 = skin[i], b2 = skin[(i + 1) % outline.length];
    k.wall('plaster', a2[0], a2[1], b2[0], b2[1], 0, AUD.ceil, AUD.wall - 0.03, c, openings, null, side);
    wallCollision(C, a, b, 0, AUD.roofTop, AUD.wall, side, openings);
    // magenta band + skirting on every wall
    k.wall('plaster', a2[0], a2[1], b2[0], b2[1], 4.6, 6.2, AUD.wall, MAG, [], null, side);
    k.wall('polished', a2[0], a2[1], b2[0], b2[1], 0, 0.14, AUD.wall, SKIRT, openings, null, side);
  }
  k.fflat('plaster', hall, AUD.ceil, CEIL, 3, true);
  C.addPolygon(worldOut, AUD.roofTop - AUD.ceil, 'concrete', 'mrd:roof', AUD.ceil);
  // steel trusses across the hall, hanging banners, lights under the trusses
  const mb = k.b('metal'), truss = col('#3a3d42');
  for (const t of [44, 48.5, 53, 57.5, 62]) {
    const [r0, r1] = spanAt(hall, t);
    if (r1 - r0 < 2) continue;
    const s0 = r0 + 0.2, s1 = r1 - 0.2;
    const top = AUD.ceil - 0.25, bot = AUD.ceil - 1.3;
    const P = (s: number, y: number): [number, number, number] => { const q = F.at(s, t); return [q[0], y, q[1]]; };
    mb.beam(P(s0, top), P(s1, top), 0.18, 0.18, truss);
    mb.beam(P(s0, bot), P(s1, bot), 0.18, 0.18, truss);
    const n = Math.max(2, Math.round((s1 - s0) / 1.6));
    for (let j = 0; j < n; j++) {
      const sa = s0 + ((s1 - s0) * j) / n, sb2 = s0 + ((s1 - s0) * (j + 1)) / n;
      mb.beam(P(sa, bot), P(sb2, top), 0.08, 0.08, truss);
      mb.beam(P(sa, bot), P(sa, top), 0.08, 0.08, truss);
    }
    for (let s = s0 + 2; s < s1 - 1; s += 4) k.flight(s, bot - 0.1, t, 0.9, 0.35);
  }
  const bannerC = ['#1f4aa8', '#e8622a', '#2d8c4a', '#c8342e', '#f2c200', '#6a3fa0'];
  for (let i = 0; i < 6; i++) {
    const s = -18 + i * 4.6, t = 48.5 + (i % 2) * 4.5;
    k.fbox('plaster', s - 0.6, AUD.ceil - 4.6, t - 0.02, s + 0.6, AUD.ceil - 1.4, t + 0.02, col(bannerC[i]), 0.5);
  }

  // ---------------------------------------------------------------- raked seat tiers from the atrium level down to the court
  // The top landing runs 1.7 m in from tier0 (just inside the passage doorway, whose reveal reaches t 38.7…39.2) and
  // back to the hall's south corner (t ≈ 37), so the corner behind the landing is filled, not a pit. With tier0 at 36.9
  // the door opened straight onto the second tier and the rows ran into the passage wall.
  const tierT = (kk: number): [number, number] => [kk === 0 ? -1e3 : AUD.tier0 + 1.7 + (kk - 1) * AUD.tierD, AUD.tier0 + 1.7 + kk * AUD.tierD];
  for (let kk = 0; kk < AUD.tiers; kk++) {
    const [t0, t1] = tierT(kk);
    const top = F0 - kk * AUD.rise;
    const band = clipBand(outline, t0, t1);
    if (band.length < 3) continue;
    C.addPolygon(F.poly(band), top, 'concrete', 'mrd:tier');
    const vis = clipBand(hall, t0, t1);
    if (vis.length >= 3) k.fflat('polished', vis, top + 0.004, col('#b9b4aa'), 2);
    const [s0, s1] = spanAt(hall, t1);
    if (s1 - s0 < 1) continue;
    k.fbox('polished', s0, top - AUD.rise, t1 - 0.02, s1, top, t1, col('#8f8a82'), 0.5); // riser
    // a row of yellow seats with the aisle on the entrance axis; none on the top landing. The row spans the hall where
    // the seat backs are (t1 − 0.9): the side walls close in towards t0, and a span taken at t1 put the end seats
    // through the walls.
    const [r0, r1] = spanAt(hall, t1 - 0.9);
    if (kk > 0) for (let s = r0 + 0.7; s < r1 - 0.6; s += 0.56) {
      if (Math.abs(s + 5.4) < 0.9) continue;
      const ts = t1 - 0.62;
      k.fbox('plaster', s - 0.22, top + 0.4, ts - 0.2, s + 0.22, top + 0.46, ts + 0.2, SEATY, 0.5);
      k.fbox('plaster', s - 0.22, top + 0.46, ts - 0.26, s + 0.22, top + 0.86, ts - 0.2, SEATY, 0.5);
      k.fbox('metal', s - 0.03, top, ts - 0.05, s + 0.03, top + 0.4, ts + 0.05, col('#2a2c2f'));
    }
  }
  // steel railing along the front of the top landing, broken by the central aisle
  {
    const t = AUD.tier0 + 1.7 - 0.08;
    const [s0, s1] = spanAt(hall, t);
    for (const [a0, a1] of [[s0 + 0.2, -6.4], [-4.4, s1 - 0.2]] as V2[]) {
      if (a1 - a0 < 0.5) continue;
      const pa = F.at(a0, t), pb = F.at(a1, t);
      mb.beam([pa[0], F0 + 1.0, pa[1]], [pb[0], F0 + 1.0, pb[1]], 0.05, 0.05, col('#8d9196'));
      for (let s = a0; s <= a1; s += 1.5) { const q = F.at(s, t); k.box('metal', q[0], F0 + 0.5, q[1], 0.04, 1.0, 0.04, 0, col('#8d9196')); }
    }
  }

  // ---------------------------------------------------------------- stage with yellow panels, a screen, side stairs
  {
    const st = clipBand(outline, AUD.stageT, 200);
    C.addPolygon(F.poly(st), AUD.stageH, 'concrete', 'mrd:stage');
    k.fflat('wood', clipBand(hall, AUD.stageT, 200), AUD.stageH + 0.004, WOOD, 1);
    const [s0, s1] = spanAt(hall, AUD.stageT);
    k.fbox('dark', s0, 0, AUD.stageT - 0.03, s1, AUD.stageH, AUD.stageT, col('#2a1d1a'));
    // magenta proscenium header over the stage front, the screen
    k.fbox('plaster', s0, 8.2, AUD.stageT - 0.3, s1, AUD.ceil, AUD.stageT, MAG, 0.5);
    // (the back wall is a V: the hall is only s −13.5…−4.0 wide at t 66.5, so the screen stops short of the east wall)
    k.fbox('plaster', -13.5, 3.2, 66.3, -4.2, 8.0, 66.45, col('#f4f4f2'), 0.5);
    k.fbox('dark', -13.6, 3.1, 66.45, -4.1, 8.1, 66.55, col('#1b1c1e'));
    // side stairs (6 steps) up from the court
    for (const [sa, sb2] of [[-16.8, -14.6], [1.0, 3.2]] as V2[]) {
      const tA = AUD.stageT - 2.0;
      for (let j = 0; j < 6; j++) k.fbox('wood', sa, 0, tA + (j * 2.0) / 6, sb2, ((j + 1) * AUD.stageH) / 6, AUD.stageT, col('#6e4a2c'), 0.5);
      C.addRamp(R(sa, tA, sb2, AUD.stageT), F.at((sa + sb2) / 2, tA), F.at((sa + sb2) / 2, AUD.stageT), 0, AUD.stageH, 'concrete', 'mrd:stair');
    }
    for (let s = s0 + 2; s < s1 - 1; s += 3.5) k.flight(s, AUD.ceil - 0.03, AUD.stageT + 3, 0.8, 0.8);
    // speakers either side of the stage front, placed from the hall width at their back face (the east wall closes in
    // behind the stage front: at s1 − 1 the east speaker stood half inside it)
    const [q0, q1] = spanAt(hall, AUD.stageT + 0.9);
    for (const s of [q0 + 0.6, q1 - 0.6]) {
      k.fbox('dark', s - 0.35, AUD.stageH, AUD.stageT + 0.3, s + 0.35, AUD.stageH + 1.6, AUD.stageT + 0.9, col('#161718'));
      C.addPolygon(R(s - 0.35, AUD.stageT + 0.3, s + 0.35, AUD.stageT + 0.9), 1.6, 'metal', 'prop', AUD.stageH);
    }
  }

  // ---------------------------------------------------------------- court markings + basketball backboards on the side walls
  {
    const cs0 = -21, cs1 = 7, ct0 = 45.8, ct1 = 57.8, y = 0.068, w = 0.06, white = col('#f2f0ea');
    const line = (s0: number, t0: number, s1: number, t1: number) => { const a = F.at(s0, t0), b = F.at(s1, t1); k.b('paint').segBox(a, b, y - 0.004, y, w, white, 0, w); };
    line(cs0, ct0, cs1, ct0); line(cs0, ct1, cs1, ct1); line(cs0, ct0, cs0, ct1); line(cs1, ct0, cs1, ct1);
    const mid = (cs0 + cs1) / 2, tc = (ct0 + ct1) / 2;
    line(mid, ct0, mid, ct1);
    const arc = (sc: number, r: number, a0: number, a1: number) => {
      const n = 20;
      for (let j = 0; j < n; j++) { const p = a0 + ((a1 - a0) * j) / n, q = a0 + ((a1 - a0) * (j + 1)) / n; line(sc + Math.cos(p) * r, tc + Math.sin(p) * r, sc + Math.cos(q) * r, tc + Math.sin(q) * r); }
    };
    arc(mid, 1.8, 0, Math.PI * 2);
    const [wS0, wS1] = spanAt(hall, tc);
    for (const [end, dir] of [[cs0, 1], [cs1, -1]] as V2[]) {
      line(end, tc - 2.45, end + dir * 5.8, tc - 2.45); line(end, tc + 2.45, end + dir * 5.8, tc + 2.45); line(end + dir * 5.8, tc - 2.45, end + dir * 5.8, tc + 2.45);
      arc(end + dir * 5.8, 1.8, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5);
      arc(end + dir * 1.575, 6.75, dir > 0 ? -1.1 : Math.PI - 1.1, dir > 0 ? 1.1 : Math.PI + 1.1);
      // backboard on brackets from the side wall behind the baseline
      const bs = end - dir * 1.2, wallS = dir > 0 ? wS0 : wS1;
      k.fbox('plaster', bs - 0.03, 2.9, tc - 0.9, bs + 0.03, 3.95, tc + 0.9, col('#f6f6f4'), 0.5);
      k.fbox('dark', bs - 0.035, 3.05, tc - 0.3, bs + 0.035, 3.5, tc + 0.3, col('#c8342e'));
      const ring = F.at(bs + dir * 0.45, tc);
      k.b('metal').cylinder(ring[0], 3.05, ring[1], 0.23, 0.03, 12, col('#e8622a'), false);
      for (const yb of [3.6, 4.4]) k.fbox('metal', Math.min(bs, wallS), yb, tc - 0.05, Math.max(bs, wallS), yb + 0.1, tc + 0.05, col('#3a3d42'));
    }
  }

  // ---------------------------------------------------------------- passage from the atrium (between the central wings)
  {
    const pt0 = A.t1;
    // floor under the passage and the doorway reveal (follows the slanted hall wall; the old rectangle stuck out into
    // the hall beyond the wall at the west jamb)
    C.addPolygon(F.poly([[-6.6, pt0], [-4.2, pt0], [-4.2, 39.19], [-6.6, 38.7]]), F0, 'concrete', 'mrd:floor');
    k.fflat('polished', [[-6.6, pt0], [-4.2, pt0], [-4.2, 38.9], [-6.6, 38.4]], F0 + 0.006, MARBLE, 2);
    k.fflat('plaster', [[-6.6, pt0], [-4.2, pt0], [-4.2, 38.9], [-6.6, 38.4]], L.u1 - 0.02, CEIL, 2, true);
    k.fbox('plaster', -6.64, F0, pt0, -6.6, L.u1, 38.4, YELLOW, 0.5);
    k.fbox('plaster', -4.2, F0, pt0, -4.16, L.u1, 38.9, YELLOW, 0.5);
    k.flight(-5.4, L.u1 - 0.05, 36.2, 0.6, 1.2);
  }

  let cx = 0, cz = 0;
  for (const p of bd.poly) { cx += p[0]; cz += p[1]; }
  // the hall has no openings to the outside (only the passage from the atrium), so it can be culled early; 60 m keeps
  // it in view through the passage and the auditorium doors from the atrium, the lobby and the forecourt
  k.build('interior:mrd_auditorium', [cx / bd.poly.length, cz / bd.poly.length], 60);
}

/** Which side (for InteriorKit.wall) points into the polygon for edge a→b (frame coordinates). */
function sideInward(poly: [number, number][], a: [number, number], b: [number, number]): number {
  let cs = 0, ct = 0;
  for (const p of poly) { cs += p[0]; ct += p[1]; }
  cs /= poly.length; ct /= poly.length;
  const pa = F.at(...a), pb = F.at(...b), c = F.at(cs, ct);
  const dx = pb[0] - pa[0], dz = pb[1] - pa[1];
  return (c[0] - (pa[0] + pb[0]) / 2) * -dz + (c[1] - (pa[1] + pb[1]) / 2) * dx > 0 ? 1 : -1;
}
/** Wall collision prisms along a→b (frame coordinates), `thick` to `side`, y0..y1, with rectangular openings. */
function wallCollision(C: WorldKit['collision'], a: [number, number], b: [number, number], y0: number, y1: number, thick: number, side: number, openings: [number, number, number, number][]): void {
  const pa = F.at(...a), pb = F.at(...b);
  const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  const dx = (pb[0] - pa[0]) / len, dz = (pb[1] - pa[1]) / len, nx = -dz * side, nz = dx * side;
  const at = (d: number, o: number): V2 => [pa[0] + dx * d + nx * o, pa[1] + dz * d + nz * o];
  const piece = (d0: number, d1: number, py0: number, py1: number) => { if (d1 - d0 > 0.01 && py1 - py0 > 0.01) C.addPolygon([at(d0, 0), at(d1, 0), at(d1, thick), at(d0, thick)], py1 - py0, 'concrete', 'mrd:wall', py0); };
  let d = 0;
  for (const [o0, o1, oy0, oy1] of openings) { piece(d, o0, y0, y1); piece(o0, o1, y0, oy0); piece(o0, o1, oy1, y1); d = o1; }
  piece(d, len, y0, y1);
}
