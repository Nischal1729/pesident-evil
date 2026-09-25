import { normalizeWinding } from './geom';
import { col, type WorldKit } from './kit';
import { BUILDINGS, type V2 } from './layout';

/**
 * Small exterior details on the non-MRD campus buildings (MRD/buildings agent), merged into the kit buffers:
 *  - hostel IT-Block: the stepped / crenellated cream parapet (2021 hostel tour 1OVI1TlGEho 3:16; satellite);
 *  - PES Food Court: a canteen colonnade with yellow columns under a flat canopy on its Pie R Cube side (the hostel-side
 *    canteens in the 2021 tours have yellow columns and red chairs; the building itself is only known from OSM).
 */
export function buildBlockDetails(kit: WorldKit): void {
  itBlockParapet(kit);
  foodCourtColonnade(kit);
}

function itBlockParapet(kit: WorldKit): void {
  const b = BUILDINGS.find((q) => q.id === 'hostel_it');
  if (!b) return;
  const top = (b.top ?? (b.floorH ?? 3.7) * b.floors) + (b.roof?.parapet ?? 1.1);
  const cream = col('#efe7d6');
  const p = normalizeWinding(b.poly);
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c = p[(i + 1) % p.length];
    const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 2.5) continue;
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux; // outward
    const rot = Math.atan2(-dz, dx);
    // raised merlons with square openings between them, a heavier block at each corner
    const n = Math.max(1, Math.floor(len / 3.2));
    for (let k = 0; k <= n; k++) {
      const corner = k === 0 || k === n;
      const w = corner ? 1.6 : 1.1, h = corner ? 1.6 : 1.1;
      // the corner blocks end at the corner (the two edges' blocks meet in an L) instead of overhanging it by w / 2
      const d = k === 0 ? w / 2 : k === n ? len - w / 2 : (len * k) / n;
      const cx = a[0] + ux * d - nx * 0.18, cz = a[1] + uz * d - nz * 0.18;
      kit.box('plaster', cx, top + h / 2, cz, w, h, 0.36, rot, cream, 0.5);
    }
    // a slim coping band just under the parapet top (reads as the stepped cornice)
    kit.segBox('plaster', a, c, top - 0.25, top - 0.05, 0.2, col('#e4dac6'), 0.1, 0.1, 0.5);
  }
}

function foodCourtColonnade(kit: WorldKit): void {
  const b = BUILDINGS.find((q) => q.id === 'food_court');
  if (!b) return;
  // east face (towards Pie R Cube): OSM vertices (−15.0, 52.6) → (−16.4, 27.2)
  const a: V2 = [-15.0, 52.6], c: V2 = [-16.4, 27.2];
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const ux = (c[0] - a[0]) / len, uz = (c[1] - a[1]) / len;
  let nx = -uz, nz = ux;
  if (nx < 0) { nx = -nx; nz = -nz; } // outward = east
  const depth = 3.2, y = 3.6;
  const at = (d: number, o: number): V2 => [a[0] + ux * d + nx * o, a[1] + uz * d + nz * o];
  const rot = Math.atan2(-(c[1] - a[1]), c[0] - a[0]);
  const m = at(len / 2, depth / 2);
  kit.box('concrete', m[0], y + 0.12, m[1], len - 1.5, 0.24, depth, rot, col('#e6e1d6'), 0.5);
  kit.box('paint', m[0], y + 0.34, m[1], len - 1.4, 0.2, depth + 0.1, rot, col('#b8604a'), 0.5);
  kit.collision.addPolygon([at(0.75, 0), at(len - 0.75, 0), at(len - 0.75, depth), at(0.75, depth)], 0.45, 'concrete', 'canopy', y);
  for (let d = 1.6; d < len - 1; d += 4.0) {
    const q = at(d, depth - 0.35);
    kit.buf('paint', q[0], q[1]).cylinder(q[0], 0, q[1], 0.28, y, 12, col('#d9a441'), false); // painted, not timber grain
    kit.buf('stone', q[0], q[1]).cylinder(q[0], 0, q[1], 0.3, 0.35, 12, col('#3a3c3e'), false);
    kit.collision.addCircle(q[0], q[1], 0.28, y, 'concrete', 'column');
  }
  // a glazed canteen front behind the colonnade (opaque glass: not enterable)
  const g0 = at(1.2, 0.04), g1 = at(len - 1.2, 0.04);
  kit.segBox('glass', g0, g1, 0.4, 3.3, 0.06, col('#34424e'), 0, 0, 1);
}
