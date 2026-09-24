import * as THREE from 'three';
import { hash2, pointInPoly, polylineToStrip, rng, samplePolyline } from './geom';
import { col, type DetailKey, type WorldKit } from './kit';
import { AREAS, GLOBE_POS, LOW_WALLS, PATHS, ROADS, type V2 } from './layout';
import { grassTuftTexture } from './materials';
import { windify, type TreeSpecies } from './trees';

// ------------------------------------------------------------------------------------------------ small reusable pieces

/** Black cube planter with a cycad / dracaena (instanced) + collision. */
export function planterCube(kit: WorldKit, x: number, z: number, size = 0.8): void {
  const s = kit.instSet('planterCube', () => ({
    geo: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    mat: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.35, metalness: 0.15 }),
  }));
  kit.addInst(s, new THREE.Vector3(x, 0, z), 0, size);
  cycad(kit, x, size, z, 0.9 + hash2(x * 3, z * 7) * 0.3);
  kit.collision.addCircle(x, z, size * 0.66, size, 'concrete', 'planter');
}

function cycadGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], colr: number[] = [], idx: number[] = [];
  const r = rng(77);
  const blades = 16;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + r() * 0.3;
    const up = 0.35 + r() * 0.9; // elevation of the blade
    const L = 0.55 + r() * 0.35, w = 0.06;
    const dx = Math.cos(a), dz = Math.sin(a);
    const sx = -dz * w, sz = dx * w;
    const mid = [dx * L * 0.5 * Math.cos(up), L * 0.5 * Math.sin(up) + 0.05, dz * L * 0.5 * Math.cos(up)];
    const tip = [dx * L * Math.cos(up * 0.7), L * Math.sin(up * 0.7) * 0.9, dz * L * Math.cos(up * 0.7)];
    const o = pos.length / 3;
    const pts = [[-sx * 0.5, 0.02, -sz * 0.5], [sx * 0.5, 0.02, sz * 0.5], [mid[0] + sx, mid[1], mid[2] + sz], [mid[0] - sx, mid[1], mid[2] - sz], [tip[0], tip[1], tip[2]]];
    const cols = [[0.16, 0.3, 0.1], [0.16, 0.3, 0.1], [0.42, 0.55, 0.16], [0.36, 0.5, 0.14], [0.66, 0.68, 0.3]];
    pts.forEach((p, k) => { pos.push(p[0], p[1], p[2]); nrm.push(dx * 0.3, 0.9, dz * 0.3); colr.push(cols[k][0], cols[k][1], cols[k][2]); });
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3, o + 3, o + 2, o + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  return g;
}

/** Cycad / dracaena clump (instanced). */
export function cycad(kit: WorldKit, x: number, y: number, z: number, scale = 1): void {
  const s = kit.instSet('cycad', () => ({ geo: cycadGeometry(), mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), cast: false }));
  kit.addInst(s, new THREE.Vector3(x, y, z), hash2(x * 11, z * 5) * Math.PI * 2, scale);
}

/** A hedge / shrub box along a segment (hedge texture, slightly lumpy top via two boxes). */
export function hedgeBox(kit: WorldKit, key: DetailKey, a: V2, b: V2, y0: number, y1: number, thick: number): void {
  const tint = col('#ffffff').multiplyScalar(0.92 + hash2(a[0], a[1]) * 0.12);
  kit.segBox(key, a, b, y0, y1, thick, tint, 0, 0.1, 0.5);
  kit.segBox(key, a, b, y1 - 0.05, y1 + 0.18, thick * 0.72, tint, 0, -0.3, 0.5);
}

/** Tree through the campus tree hook. */
export function sapling(kit: WorldKit, x: number, z: number, sp: TreeSpecies = 'sapling', scale = 1, collide = true): void {
  kit.addTree(sp, x, z, scale, collide);
}

// ------------------------------------------------------------------------------------------------ fountain grass

function tuftSet(kit: WorldKit) {
  return kit.instSet('grassTuft', () => {
    const q1 = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const q2 = q1.clone().rotateY(Math.PI / 2);
    const q3 = q1.clone().rotateY(Math.PI / 4);
    const merged = mergeGeos([q1, q2, q3]);
    const mat = new THREE.MeshStandardMaterial({ map: grassTuftTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9 });
    windify(mat, 0.08);
    return { geo: merged, mat, cast: false, colored: true };
  });
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute, u = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(0, 1, 0); uv.push(u.getX(i), u.getY(i)); }
    for (let i = 0; i < g.index!.count; i++) idx.push(g.index!.getX(i) + off);
    off += p.count;
    void n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** Raised bed strip along a polyline (offset sideways) filled with fountain-grass tufts. */
function grassBed(kit: WorldKit, pts: V2[], offset: number, width: number, seed: number, opts: { kerb?: boolean; avoid?: (x: number, z: number) => boolean; tint?: 'straw' | 'purple' | 'green' } = {}): void {
  const shifted = samplePolyline(pts, 1.5, offset, 0).map((s) => s.p);
  if (shifted.length < 2) return;
  const { left, right } = polylineToStrip(shifted, width);
  const bedPoly: V2[] = [...left, ...right.slice().reverse()];
  const mulch = opts.tint === 'purple' ? col('#4a2a3c') : col('#3d3226');
  kit.buf('stone', shifted[0][0], shifted[0][1]).flatPoly(bedPoly, 0.07, mulch, 2);
  if (opts.kerb !== false) {
    for (const side of [left, right]) for (let i = 1; i < side.length; i++) kit.segBox('stone', side[i - 1], side[i], 0, 0.28, 0.16, col('#9d9b96'), 0, 0.02);
  }
  const set = tuftSet(kit);
  const r = rng(seed);
  const area = polylineLen(shifted) * width;
  const n = Math.floor(area / 0.55);
  for (let i = 0; i < n; i++) {
    const f = r(), s = (r() - 0.5) * (width - 0.4);
    const p = along(shifted, f);
    const x = p.p[0] - p.d[1] * s, z = p.p[1] + p.d[0] * s;
    if (opts.avoid && opts.avoid(x, z)) continue;
    if (kit.collision.blocked(x, z, 0.2)) continue;
    const h = 0.7 + r() * 0.6;
    const tint = opts.tint === 'purple' ? col('#8a4a78') : opts.tint === 'green' ? col('#6f9a3a') : col('#ffffff').multiplyScalar(0.85 + r() * 0.25);
    kit.addInst(set, new THREE.Vector3(x, 0.05, z), r() * Math.PI, new THREE.Vector3(0.8 + r() * 0.5, h, 0.8 + r() * 0.5), tint);
  }
}

function polylineLen(p: V2[]): number { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return l; }
function along(p: V2[], f: number): { p: V2; d: V2 } {
  const L = polylineLen(p) * f;
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= L || i === p.length - 1) {
      const t = l > 0 ? Math.min(1, (L - acc) / l) : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: [(b[0] - a[0]) / (l || 1), (b[1] - a[1]) / (l || 1)] };
    }
    acc += l;
  }
  return { p: p[0], d: [1, 0] };
}

const inRoad = (x: number, z: number, pad = 0.5) => ROADS.some((r) => {
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], b = r.pts[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    if (Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z) < r.width / 2 + pad) return true;
  }
  return false;
});

// ------------------------------------------------------------------------------------------------ landscape builder

export function buildLandscape(kit: WorldKit): void {
  const path = (id: string) => PATHS.find((p) => p.id === id)!;
  const promenade = path('pes_lawn_promenade');
  const walkway = path('entry_south_walkway');
  // PES Lawn promenade: fountain-grass beds both sides (granite kerbs), granite block benches are props
  grassBed(kit, promenade.pts, promenade.width / 2 + 1.5, 2.6, 11, { avoid: (x, z) => inRoad(x, z, 0.3) });
  grassBed(kit, promenade.pts, -(promenade.width / 2 + 1.6), 2.8, 12, { avoid: (x, z) => x < 104 });
  // entry south walkway: grass bed between road and walkway, planter wall + murraya hedge on the other side
  grassBed(kit, walkway.pts, -(walkway.width / 2 + 1.0), 1.7, 13, { avoid: (x, z) => inRoad(x, z, 0.15) });
  // purple-heart / maroon ground cover in front of the grass along the walkway (1920)
  for (let x = 108; x < 150; x += 7) {
    const zc = walkPathZ(walkway.pts, x) - walkway.width / 2 - 1.0;
    kit.buf('stone', x, zc).flatPoly([[x - 1.2, zc - 0.6], [x + 1.2, zc - 0.6], [x + 1.2, zc + 0.6], [x - 1.2, zc + 0.6]], 0.075, col('#4c2438'), 2);
    for (let k = 0; k < 4; k++) cycad(kit, x - 0.9 + k * 0.6, 0.05, zc + (k % 2 ? 0.2 : -0.2), 0.7);
  }
  // raised planter wall with a white-flowering hedge on the south side of the walkway (gaps for access)
  const wallRuns: [number, number][] = [[106, 116], [121, 131], [136, 144]];
  for (const [x0, x1] of wallRuns) {
    const a: V2 = [x0, walkPathZ(walkway.pts, x0) + walkway.width / 2 + 0.7], b: V2 = [x1, walkPathZ(walkway.pts, x1) + walkway.width / 2 + 0.7];
    kit.segBox('stone', a, b, 0, 0.55, 1.0, col('#a19e98'), 0, 0.02);
    kit.segBox('stone', a, b, 0.55, 0.62, 1.12, col('#3c3e40'));
    hedgeBox(kit, 'murraya', a, b, 0.6, 1.35, 0.8);
    kit.collision.addSegment(a, b, 1.0, 1.1, 'concrete', 'planter');
  }
  // entry-road north verge: grass bed between the road and the promenade
  // (covered by the promenade's south bed)

  // east plaza: raised planters with frangipani + mixed shrubs, trench drain across the plaza
  for (const [x0, z0, x1, z1] of [[95, -149.5, 111, -146], [104, -143.5, 112.5, -139.5]] as [number, number, number, number][]) {
    kit.box('stone', (x0 + x1) / 2, 0.25, (z0 + z1) / 2, x1 - x0, 0.5, z1 - z0, 0, col('#a6a39c'));
    kit.box('stone', (x0 + x1) / 2, 0.52, (z0 + z1) / 2, x1 - x0 + 0.1, 0.06, z1 - z0 + 0.1, 0, col('#3c3e40'));
    kit.box('stone', (x0 + x1) / 2, 0.56, (z0 + z1) / 2, x1 - x0 - 0.4, 0.04, z1 - z0 - 0.4, 0, col('#3d3226'));
    kit.collision.addPolygon([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], 0.55, 'concrete', 'planter');
    const r = rng(x0 * 7);
    for (let i = 0; i < (x1 - x0) * (z1 - z0) / 1.6; i++) cycad(kit, x0 + 0.4 + r() * (x1 - x0 - 0.8), 0.56, z0 + 0.4 + r() * (z1 - z0 - 0.8), 1.0 + r() * 0.8);
  }
  kit.box('metal', 99, 0.075, -131.2, 22, 0.02, 0.35, 0, col('#2c2e30'));

  // frangipani garden: purple Tradescantia beds + shrubs; the globe stands in a planted bed at its east end
  const fg = AREAS.find((a) => a.id === 'frangipani_garden');
  if (fg) {
    const r = rng(256);
    for (let i = 0; i < 9; i++) {
      const x = 81 + r() * 12, z = -163 + r() * 21;
      if (!pointInPoly(x, z, fg.poly) || Math.hypot(x - GLOBE_POS[0], z - GLOBE_POS[1]) < 3.5) continue;
      const rr = 1.2 + r() * 1.4;
      const ring: V2[] = [];
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; ring.push([x + Math.cos(a) * rr * 1.3, z + Math.sin(a) * rr]); }
      kit.buf('stone', x, z).flatPoly(ring, 0.07, r() < 0.6 ? col('#4f2744') : col('#6b1f2e'), 2);
    }
  }
  // globe bed: low granite ring planter + shrubs; the globe (its own plinth) is placed by Props
  {
    const [gx, gz] = GLOBE_POS;
    const R = 3.6;
    const seg = 20;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      if (a0 > Math.PI * 0.85 && a0 < Math.PI * 1.15) continue; // a step-in gap facing the plaza (west side is the tower)
      const p0: V2 = [gx + Math.cos(a0) * R, gz + Math.sin(a0) * R], p1: V2 = [gx + Math.cos(a1) * R, gz + Math.sin(a1) * R];
      kit.segBox('polished', p0, p1, 0, 0.45, 0.45, col('#4e5a55'), 0, 0.05, 0.5);
    }
    const ring: V2[] = [];
    for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; ring.push([gx + Math.cos(a) * (R - 0.2), gz + Math.sin(a) * (R - 0.2)]); }
    kit.buf('stone', gx, gz).flatPoly(ring, 0.08, col('#4a2a3c'), 2);
    const r = rng(84);
    for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, rr = 2.2 + r() * 1.1; cycad(kit, gx + Math.cos(a) * rr, 0.08, gz + Math.sin(a) * rr, 1.1 + r() * 0.6); }
    kit.collision.addCircle(gx, gz, 1.8, 3.2, 'metal', 'globe');
  }

  // terraced garden (below the Law terrace): stepped granite planter boxes with charcoal coping
  for (const [x, z, w, d, h] of [[66, 49, 7, 2.2, 0.6], [74, 47, 8, 2.2, 0.9], [83, 46, 7, 2.2, 0.6], [70, 55, 6, 2.0, 0.6], [80, 53, 7, 2.0, 0.9], [89, 50, 5, 2.0, 0.6], [75, 60, 5, 1.8, 0.45]] as number[][]) {
    kit.box('stone', x, h / 2, z, w, h, d, 0.12, col('#8f8d88'));
    kit.box('stone', x, h + 0.04, z, w + 0.12, 0.08, d + 0.12, 0.12, col('#2e3032'));
    kit.box('stone', x, h + 0.09, z, w - 0.3, 0.04, d - 0.3, 0.12, col('#3d3226'));
    for (let k = 0; k < w / 1.2; k++) cycad(kit, x - w / 2 + 0.6 + k * 1.2, h + 0.1, z, 1.2);
    const cs = Math.cos(0.12), sn = Math.sin(0.12);
    const c = (lx: number, lz: number): V2 => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    kit.collision.addPolygon([c(-w / 2, -d / 2), c(w / 2, -d / 2), c(w / 2, d / 2), c(-w / 2, d / 2)], h, 'concrete', 'planter');
  }

  // east lawn: low grey concrete kerb along the promenade edge
  const east = path('east_promenade');
  {
    const { right } = polylineToStrip(east.pts, east.width + 0.3);
    for (let i = 1; i < right.length; i++) kit.segBox('stone', right[i - 1], right[i], 0, 0.14, 0.25, col('#9a9892'));
  }

  // white low walls in front of the corten boundary
  for (const w of LOW_WALLS) {
    kit.segBox('plaster', w.a, w.b, 0, w.height, 0.35, col('#edede9'), 0, 0, 0.5);
    kit.segBox('plaster', w.a, w.b, 0, 0.12, 0.4, col('#b9a38a'), 0, 0);
    kit.collision.addSegment(w.a, w.b, 0.4, w.height, 'concrete', 'wall');
  }

  shelters(kit);
  forecourtPlanters(kit);
}

function walkPathZ(pts: V2[], x: number): number {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((x <= a[0] && x >= b[0]) || (x >= a[0] && x <= b[0])) return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0] || 1));
  }
  return pts[pts.length - 1][1];
}

// ------------------------------------------------------------------------------------------------ sheds and shelters
function shelters(kit: WorldKit): void {
  const white = col('#f1f1ee'), steel = col('#6f757b');
  // bike parking canopy: white flat roof on slim posts over the bike yard
  {
    const x0 = 134.5, x1 = 150.5, z0 = -106.5, z1 = -97.5, h = 3.4;
    kit.box('plaster', (x0 + x1) / 2, h + 0.15, (z0 + z1) / 2, x1 - x0 + 1, 0.3, z1 - z0 + 1, 0, white);
    kit.box('metal', (x0 + x1) / 2, h - 0.1, (z0 + z1) / 2, x1 - x0, 0.2, 0.2, 0, steel);
    for (let x = x0; x <= x1 + 0.01; x += 4) for (const z of [z0, z1]) {
      kit.box('metal', x, h / 2, z, 0.14, h, 0.14, 0, steel);
      kit.collision.addCircle(x, z, 0.15, h, 'metal', 'post');
    }
    // painted parking bays
    for (let x = x0 + 1; x < x1; x += 1.2) kit.box('stone', x, 0.06, (z0 + z1) / 2, 0.06, 0.01, z1 - z0 - 1.5, 0, col('#e8e8e2'));
  }
  // steel mesh shelter on a raised plinth near the gate walkway
  {
    const x0 = 145.5, x1 = 155.3, z0 = -117.2, z1 = -111.2, h = 3.2;
    kit.box('stone', (x0 + x1) / 2, 0.25, (z0 + z1) / 2, x1 - x0, 0.5, z1 - z0, 0, col('#b3aea6'));
    kit.box('metal', (x0 + x1) / 2, h + 0.05, (z0 + z1) / 2, x1 - x0 + 0.6, 0.12, z1 - z0 + 0.6, 0, col('#9ea3a7'));
    for (const x of [x0, (x0 + x1) / 2, x1]) for (const z of [z0, z1]) kit.box('metal', x, h / 2 + 0.25, z, 0.12, h - 0.5, 0.12, 0, steel);
    const mesh = kit.instSet('chainLink', () => {
      const g = new THREE.PlaneGeometry(1, 1);
      const tex = chainLinkTexture();
      const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5, color: 0xb8bcc0 });
      return { geo: g, mat: m, cast: true };
    });
    for (const [cx, cz, w, rot] of [[(x0 + x1) / 2, z0, x1 - x0, 0], [(x0 + x1) / 2, z1, x1 - x0, 0], [x0, (z0 + z1) / 2, z1 - z0, Math.PI / 2]] as number[][]) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, 0.5 + (h - 0.5) / 2, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(w, h - 0.6, 1));
      kit.addInstMatrix(mesh, m);
    }
    kit.collision.addPolygon([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], h, 'metal', 'shelter');
  }
  // South Thindies food point: curved (arched) white metal roof + grey frieze
  {
    const x0 = 133.2, x1 = 151.2, z0 = -22.2, z1 = -5.3, y0 = 3.6, rise = 1.5;
    const b = kit.buf('metal', (x0 + x1) / 2, (z0 + z1) / 2);
    const seg = 10;
    const roofCol = col('#e4e6e6');
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg, t1 = (i + 1) / seg;
      const za = z0 + (z1 - z0) * t0, zb = z0 + (z1 - z0) * t1;
      const ya = y0 + Math.sin(t0 * Math.PI) * rise, yb = y0 + Math.sin(t1 * Math.PI) * rise;
      b.beam([x0 - 0.3, ya, za], [x0 - 0.3, yb, zb], 0.02, 0.02, roofCol);
      const n = new THREE.Vector3(0, zb - za, -(yb - ya)).normalize();
      if (n.y < 0) n.negate();
      const i0 = b.vert(x0 - 0.4, ya, za, n.x, n.y, n.z, 0, 0, roofCol), i1 = b.vert(x1 + 0.4, ya, za, n.x, n.y, n.z, 1, 0, roofCol);
      const i2 = b.vert(x1 + 0.4, yb, zb, n.x, n.y, n.z, 1, 1, roofCol), i3 = b.vert(x0 - 0.4, yb, zb, n.x, n.y, n.z, 0, 1, roofCol);
      b.quad(i0, i3, i2, i1);
      b.quad(i0, i1, i2, i3);
    }
  }
  // food court: steel posts + white tensile canopy (tables are props)
  {
    const r = kit.buf('metal', 127.5, -16.5);
    for (let x = 122.5; x <= 132.5; x += 5) for (let z = -28.5; z <= -4.5; z += 6) {
      r.cylinder(x, 0, z, 0.1, 3.6, 8, col('#9aa0a6'));
      kit.collision.addCircle(x, z, 0.12, 3.6, 'metal', 'post');
    }
    const sail = new THREE.PlaneGeometry(12, 26, 6, 12).rotateX(-Math.PI / 2);
    const sp = sail.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), z = sp.getZ(i);
      sp.setY(i, 3.9 + Math.cos((x / 6) * Math.PI) * 0.35 + Math.cos((z / 6) * Math.PI * 1.5) * 0.3);
    }
    sail.computeVertexNormals();
    const sailMesh = new THREE.Mesh(sail, new THREE.MeshStandardMaterial({ color: 0xf6f5f0, roughness: 0.7, side: THREE.DoubleSide }));
    sailMesh.position.set(127.5, 0, -16.5);
    sailMesh.castShadow = true;
    sailMesh.matrixAutoUpdate = false; sailMesh.updateMatrix();
    kit.group.add(sailMesh);
  }
}

function chainLinkTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(200,205,210,1)'; g.lineWidth = 2;
  for (let k = -S; k < S * 2; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke(); g.beginPath(); g.moveTo(k + S, 0); g.lineTo(k, S); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 4);
  return t;
}

// ------------------------------------------------------------------------------------------------ east forecourt planters
function forecourtPlanters(kit: WorldKit): void {
  for (const [x, z, w, d] of [[101.5, -112.5, 4, 1.4], [101.8, -104, 4, 1.4], [102, -96.5, 4, 1.4]] as number[][]) {
    kit.box('stone', x, 0.45, z, d, 0.9, w, 0, col('#a4a19b'));
    kit.box('stone', x, 0.92, z, d + 0.1, 0.05, w + 0.1, 0, col('#3c3e40'));
    hedgeBox(kit, 'lime', [x, z - w / 2 + 0.3], [x, z + w / 2 - 0.3], 0.9, 1.6, d - 0.3);
    kit.collision.addPolygon([[x - d / 2, z - w / 2], [x + d / 2, z - w / 2], [x + d / 2, z + w / 2], [x - d / 2, z + w / 2]], 0.9, 'concrete', 'planter');
  }
}
