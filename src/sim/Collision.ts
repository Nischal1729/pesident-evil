import type { SurfaceKind } from '../core/Events';
import { distToSegment, normalizeWinding, pointInPolygon } from '../world/geom';
import type { V2 } from '../world/layout';

/**
 * Static 2.5D collision world: vertical prisms (polygons with height) and cylinders,
 * in a uniform grid. Used for character movement, bullets and line-of-sight.
 */
interface Prism {
  id: number;
  pts: Float64Array; // flat x,z (normalized winding: outward normal of a→b is (-dz, dx))
  n: number;
  base: number;
  height: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  surface: SurfaceKind;
  enabled: boolean;
  tag: string;
  stamp: number;
  passBullets: boolean;
  /** sloped top (ramps / stair flights): top(x,z) = y0 + (y1 − y0)·clamp01(((x−ax)·dx + (z−az)·dz)·inv) */
  ramp: { ax: number; az: number; dx: number; dz: number; inv: number; y0: number; y1: number; slope: number } | null;
  /** boundary lip (see setLip): outward unit normal, outer plane dot(p, n) = off, extent along (−nz, nx) in [u0, u1] */
  lip: { nx: number; nz: number; off: number; u0: number; u1: number } | null;
}

interface Cyl {
  id: number;
  x: number; z: number; r: number;
  base: number; height: number;
  surface: SurfaceKind;
  enabled: boolean;
  tag: string;
  stamp: number;
}

export interface RayHit {
  dist: number;
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  surface: SurfaceKind;
  tag: string;
}

const CELL = 8;
/** Max rise an actor walks up without jumping (steps, kerbs, tiers). Ramps are continuous and have no limit. */
export const STEP_UP = 0.45;
/** Outline tolerance for ground queries (m). */
const GROUND_TOL = 0.15;
/** Body height used for head-room / blocking tests in multi-level mode. */
export const AGENT_HEIGHT = 1.8;
/**
 * Highest rise anyone climbs in one go (player mantle, AI climbs, navigation climb edges). Zombies hit a target less
 * than 1.3 m above or below them (World's reach test), so a single climb never lifts a survivor out of their reach.
 */
export const CLIMB_MAX = 1.3;
/**
 * Solids whose tops can be climbed onto. Everything else (buildings, parapets, desks, roofs, the gate median, trees,
 * hoardings and other 'wall' pieces) refuses, so a new tag never opens a perch the navigation can't follow.
 */
const CLIMB_TAGS = new Set(['prop', 'planter', 'mrd:planter', 'oat:planter', 'stair', 'ramp', 'landing', 'be:steps', 'mrd:steps', 'mrd:forecourt', 'oat:tier', 'oat:stair', 'oat:aisle', 'boundary']);
export function climbableTag(tag: string): boolean {
  return CLIMB_TAGS.has(tag) || tag.startsWith('gate:');
}

export class StaticCollision {
  prisms: Prism[] = [];
  cyls: Cyl[] = [];
  /** Ramp / stair-flight metadata for the upcoming multi-level movement (see addRamp). */
  ramps: { prism: number; poly: V2[]; from: V2; to: V2; y0: number; y1: number; thickness: number }[] = [];
  private grid = new Map<number, { p: number[]; c: number[] }>();
  private stampCounter = 1;

  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private cellsFor(minX: number, maxX: number, minZ: number, maxZ: number, fn: (cell: { p: number[]; c: number[] }) => void): void {
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = { p: [], c: [] }));
        fn(cell);
      }
  }

  addPolygon(poly: V2[], height: number, surface: SurfaceKind = 'concrete', tag = '', base = 0): number {
    const p = normalizeWinding(poly);
    const pts = new Float64Array(p.length * 2);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    p.forEach(([x, z], i) => {
      pts[i * 2] = x; pts[i * 2 + 1] = z;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    });
    const id = this.prisms.length;
    this.prisms.push({ id, pts, n: p.length, base, height, minX, maxX, minZ, maxZ, surface, enabled: true, tag, stamp: 0, passBullets: tag.startsWith('gate:'), ramp: null, lip: null });
    this.cellsFor(minX, maxX, minZ, maxZ, (c) => c.p.push(id));
    return id;
  }

  /**
   * Sloped walkable solid: ramps AND stair flights (collide stairs as a ramp, draw the steps visually).
   * Surface height at p = y0 + (y1 − y0) · clamp01(dot(p − from, to − from) / |to − from|²); the solid spans from
   * (surface − thickness) up to the surface (default thickness: down to y = 0).
   * The sim is still flat (multi-level movement is planned): for now the ramp is recorded in `ramps` and collides
   * as a plain prism up to max(y0, y1). Register raised geometry the way it physically is — podiums/decks as
   * prisms (tops become walkable later), ramps/stairs with this — so it works unchanged once levels land.
   */
  addRamp(poly: V2[], from: V2, to: V2, y0: number, y1: number, surface: SurfaceKind = 'concrete', tag = 'ramp', thickness = Infinity): number {
    const top = Math.max(y0, y1);
    const base = Number.isFinite(thickness) ? Math.max(0, Math.min(y0, y1) - thickness) : 0;
    const id = this.addPolygon(poly, top - base, surface, tag, base);
    this.ramps.push({ prism: id, poly: poly.map((p) => [p[0], p[1]] as V2), from, to, y0, y1, thickness });
    const dx = to[0] - from[0], dz = to[1] - from[1];
    const l2 = dx * dx + dz * dz || 1;
    this.prisms[id].ramp = { ax: from[0], az: from[1], dx, dz, inv: 1 / l2, y0, y1, slope: Math.abs(y1 - y0) / Math.sqrt(l2) };
    return id;
  }

  /** Thick line segment (walls, gates, fences) */
  addSegment(a: V2, b: V2, thickness: number, height: number, surface: SurfaceKind = 'concrete', tag = '', base = 0): number {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * thickness * 0.5, nz = (dx / l) * thickness * 0.5;
    return this.addPolygon([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], height, surface, tag, base);
  }

  addPolyline(pts: V2[], thickness: number, height: number, surface: SurfaceKind = 'concrete', tag = '', base = 0): void {
    for (let i = 1; i < pts.length; i++) this.addSegment(pts[i - 1], pts[i], thickness, height, surface, tag, base);
  }

  addCircle(x: number, z: number, r: number, height: number, surface: SurfaceKind = 'wood', tag = '', base = 0): number {
    const id = this.cyls.length;
    this.cyls.push({ id, x, z, r, base, height, surface, enabled: true, tag, stamp: 0 });
    this.cellsFor(x - r, x + r, z - r, z + r, (c) => c.c.push(id));
    return id;
  }

  setPrismEnabled(id: number, enabled: boolean): void {
    this.prisms[id].enabled = enabled;
  }

  /**
   * Mark a prism as part of the campus boundary with outward unit normal (nx, nz). Its top is climbable only from the
   * inside (ledgeAt and the navigation climb edges), and survivors on it are held back at its outer face (clampLip),
   * so nobody leaves the campus over a wall or gate. `off` moves the plane (default: the outer face less 5 cm).
   */
  setLip(id: number, nx: number, nz: number, off?: number): void {
    const P = this.prisms[id];
    let o = -Infinity, u0 = Infinity, u1 = -Infinity;
    for (let i = 0; i < P.n; i++) {
      const x = P.pts[i * 2], z = P.pts[i * 2 + 1];
      o = Math.max(o, x * nx + z * nz);
      const u = -x * nz + z * nx;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    }
    P.lip = { nx, nz, off: off ?? o - 0.05, u0, u1 };
  }

  /**
   * Hold a survivor (feet at y) inside the campus: past the outer plane of a lipped prism whose top is within
   * [y − 1.0, y + 0.3], it is put back on the plane. The 0.3 m keeps a hop on the ground outside (peak 0.74 m) from
   * being caught by the 1.1 m gate median; the 0.6 m depth only catches a body that crossed the plane this tick.
   */
  clampLip(pos: { x: number; z: number }, y: number): boolean {
    let hit = false;
    const stamp = ++this.stampCounter;
    this.cellsAround(pos.x, pos.z, 0.6, (cell) => {
      for (const pi of cell.p) {
        const P = this.prisms[pi];
        if (P.stamp === stamp) continue;
        P.stamp = stamp;
        const L = P.lip;
        if (!L || !P.enabled) continue;
        const top = P.base + P.height;
        if (y < top - 0.3 || y > top + 1.0) continue;
        const u = -pos.x * L.nz + pos.z * L.nx;
        if (u < L.u0 || u > L.u1) continue;
        const d = pos.x * L.nx + pos.z * L.nz - L.off;
        if (d <= 0 || d > 0.6) continue;
        pos.x -= L.nx * d; pos.z -= L.nz * d;
        hit = true;
      }
    });
    return hit;
  }

  private cellsAround(x: number, z: number, r: number, fn: (cell: { p: number[]; c: number[] }) => void): void {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const cell = this.grid.get(this.key(cx, cz));
        if (cell) fn(cell);
      }
  }

  /** Push a circle out of all static shapes. Returns true if any collision happened. */
  resolveCircle(pos: { x: number; z: number }, r: number, y = 0.5): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const cx0 = Math.floor((pos.x - r) / CELL), cx1 = Math.floor((pos.x + r) / CELL);
      const cz0 = Math.floor((pos.z - r) / CELL), cz1 = Math.floor((pos.z + r) / CELL);
      const stamp = ++this.stampCounter;
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cz = cz0; cz <= cz1; cz++) {
          const cell = this.grid.get(this.key(cx, cz));
          if (!cell) continue;
          for (const pi of cell.p) {
            const P = this.prisms[pi];
            if (P.stamp === stamp || !P.enabled) continue;
            P.stamp = stamp;
            if (y > P.base + P.height || y + 1.6 < P.base) continue;
            if (pos.x + r < P.minX || pos.x - r > P.maxX || pos.z + r < P.minZ || pos.z - r > P.maxZ) continue;
            if (this.pushOutPrism(P, pos, r)) { moved = true; hit = true; }
          }
          for (const ci of cell.c) {
            const C = this.cyls[ci];
            if (C.stamp === stamp || !C.enabled) continue;
            C.stamp = stamp;
            const dx = pos.x - C.x, dz = pos.z - C.z;
            const d = Math.hypot(dx, dz);
            const min = r + C.r;
            if (d < min) {
              const f = d > 1e-5 ? (min - d) / d : 1;
              pos.x += dx * f + (d > 1e-5 ? 0 : 0.01);
              pos.z += dz * f;
              moved = true; hit = true;
            }
          }
        }
      if (!moved) break;
    }
    return hit;
  }

  private pushOutPrism(P: Prism, pos: { x: number; z: number }, r: number): boolean {
    const pts = P.pts, n = P.n;
    const inside = pointInPolygon(pos.x, pos.z, pts, n);
    // nearest edge
    let best = Infinity, bx = 0, bz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1], cx = pts[j * 2], cz = pts[j * 2 + 1];
      const dx = cx - ax, dz = cz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((pos.x - ax) * dx + (pos.z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t, qz = az + dz * t;
      const d = (pos.x - qx) ** 2 + (pos.z - qz) ** 2;
      if (d < best) { best = d; bx = qx; bz = qz; }
    }
    const d = Math.sqrt(best);
    if (inside) {
      // push out through nearest edge
      const dx = bx - pos.x, dz = bz - pos.z;
      const l = d || 1;
      pos.x = bx + (dx / l) * r;
      pos.z = bz + (dz / l) * r;
      return true;
    }
    if (d < r) {
      const dx = pos.x - bx, dz = pos.z - bz;
      const l = d || 1;
      pos.x = bx + (dx / l) * r;
      pos.z = bz + (dz / l) * r;
      return true;
    }
    return false;
  }

  /** Is the point inside (or within `r` of) any enabled shape? */
  blocked(x: number, z: number, r: number, filter?: (tag: string) => boolean): boolean {
    const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL), cz1 = Math.floor((z + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const cell = this.grid.get(this.key(cx, cz));
        if (!cell) continue;
        for (const pi of cell.p) {
          const P = this.prisms[pi];
          if (!P.enabled || P.base > 1.5) continue;
          if (filter && !filter(P.tag)) continue;
          if (x + r < P.minX || x - r > P.maxX || z + r < P.minZ || z - r > P.maxZ) continue;
          if (pointInPolygon(x, z, P.pts, P.n)) return true;
          if (r > 0) {
            for (let i = 0; i < P.n; i++) {
              const j = (i + 1) % P.n;
              if (distToSegment(x, z, P.pts[i * 2], P.pts[i * 2 + 1], P.pts[j * 2], P.pts[j * 2 + 1]) < r) return true;
            }
          }
        }
        for (const ci of cell.c) {
          const C = this.cyls[ci];
          if (!C.enabled) continue;
          if (filter && !filter(C.tag)) continue;
          if ((x - C.x) ** 2 + (z - C.z) ** 2 < (r + C.r) ** 2) return true;
        }
      }
    return false;
  }

  // -------------------------------------------------------------------------------------------- multi-level queries
  /** Top of a prism at (x,z): flat, or the ramp surface. */
  topAt(P: Prism, x: number, z: number): number {
    const r = P.ramp;
    if (!r) return P.base + P.height;
    let t = ((x - r.ax) * r.dx + (z - r.az) * r.dz) * r.inv;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return r.y0 + (r.y1 - r.y0) * t;
  }

  private cellAt(x: number, z: number): { p: number[]; c: number[] } | undefined {
    return this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
  }

  /**
   * Highest walkable surface under (x,z) that is at or below maxY (0 = terrain). Surfaces whose outline passes within
   * GROUND_TOL count as underfoot, so hairline seams between adjacent solids (tier rings, stacked slabs) never open a
   * hole to fall through. Gate and compound-wall ('boundary') tops count. Tops of 'wall' prisms (hoardings, low and
   * parking walls) never do: they are too thin or too tall to stand on.
   */
  groundAt(x: number, z: number, maxY: number): number {
    let best = 0;
    const cell = this.cellAt(x, z);
    if (!cell) return best;
    const T = GROUND_TOL;
    for (const pi of cell.p) {
      const P = this.prisms[pi];
      if (!P.enabled || P.tag === 'wall') continue;
      if (x < P.minX - T || x > P.maxX + T || z < P.minZ - T || z > P.maxZ + T) continue;
      const top = this.topAt(P, x, z);
      if (top <= best || top > maxY) continue;
      if (pointInPolygon(x, z, P.pts, P.n) || this.nearestEdge(P, x, z) < T * T) best = top;
    }
    for (const ci of cell.c) {
      const C = this.cyls[ci];
      if (!C.enabled) continue;
      const top = C.base + C.height;
      if (top <= best || top > maxY) continue;
      if ((x - C.x) ** 2 + (z - C.z) ** 2 < C.r * C.r) best = top;
    }
    return best;
  }

  /** Lowest solid underside above y at (x,z) (Infinity if open sky). */
  ceilingAt(x: number, z: number, y: number): number {
    let best = Infinity;
    const cell = this.cellAt(x, z);
    if (!cell) return best;
    for (const pi of cell.p) {
      const P = this.prisms[pi];
      if (!P.enabled || P.base <= y || P.base >= best) continue;
      if (x < P.minX || x > P.maxX || z < P.minZ || z > P.maxZ) continue;
      if (pointInPolygon(x, z, P.pts, P.n)) best = P.base;
    }
    return best;
  }

  /**
   * Is there a boundary top (a lipped gate leaf, compound wall or median, see setLip) underfoot at (x,z), by the same
   * GROUND_TOL rule as groundAt, with its top in [y0, y1]? The squad probes ahead with it to stay off those tops.
   */
  lipTopAt(x: number, z: number, y0: number, y1: number): boolean {
    const cell = this.cellAt(x, z);
    if (!cell) return false;
    const T = GROUND_TOL;
    for (const pi of cell.p) {
      const P = this.prisms[pi];
      if (!P.lip || !P.enabled) continue;
      const top = P.base + P.height;
      if (top < y0 || top > y1) continue;
      if (x < P.minX - T || x > P.maxX + T || z < P.minZ - T || z > P.maxZ + T) continue;
      if (pointInPolygon(x, z, P.pts, P.n) || this.nearestEdge(P, x, z) < T * T) return true;
    }
    return false;
  }

  /**
   * Ledge to climb onto, probing ahead along the unit direction (dx,dz). The first probe inside something decides:
   * its highest top (prisms and cylinders) must rise more than STEP_UP and at most CLIMB_MAX above the feet, belong to a
   * climbable solid (climbableTag), have AGENT_HEIGHT of headroom, and for a lipped (boundary) solid be approached from
   * the inside. Used by the player's jump and by AI climbs; the navigation climb edges apply the same rule.
   */
  ledgeAt(x: number, z: number, dx: number, dz: number, feetY: number, r: number): { x: number; z: number; y: number } | null {
    for (const s of [0.25, 0.45, 0.65]) {
      const px = x + dx * (r + s), pz = z + dz * (r + s);
      const cell = this.cellAt(px, pz);
      if (!cell) continue;
      let top = -Infinity, best: Prism | Cyl | null = null;
      for (const pi of cell.p) {
        const P = this.prisms[pi];
        if (!P.enabled || P.base > feetY + CLIMB_MAX || px < P.minX || px > P.maxX || pz < P.minZ || pz > P.maxZ || !pointInPolygon(px, pz, P.pts, P.n)) continue;
        const t = this.topAt(P, px, pz);
        if (t > top) { top = t; best = P; }
      }
      for (const ci of cell.c) {
        const C = this.cyls[ci];
        if (!C.enabled || C.base > feetY + CLIMB_MAX || (px - C.x) ** 2 + (pz - C.z) ** 2 >= C.r * C.r) continue;
        if (C.base + C.height > top) { top = C.base + C.height; best = C; }
      }
      if (!best || top <= feetY + STEP_UP) continue;
      const lip = 'lip' in best ? best.lip : null;
      if (top > feetY + CLIMB_MAX || !climbableTag(best.tag) || (lip && dx * lip.nx + dz * lip.nz <= 0) || this.ceilingAt(px, pz, top) < top + AGENT_HEIGHT) return null;
      return { x: px, z: pz, y: top };
    }
    return null;
  }

  /**
   * Visit the tops of every solid whose footprint contains (x,z) (navigation candidates) with the solid's prism id
   * (−1 for cylinders) and whether it is climbable. Gates are skipped: their 0.5 m tops get nodes from their centreline.
   */
  forTopsAt(x: number, z: number, fn: (top: number, prism: number, climbable: boolean) => void): void {
    const cell = this.cellAt(x, z);
    if (!cell) return;
    for (const pi of cell.p) {
      const P = this.prisms[pi];
      if (!P.enabled || P.passBullets) continue;
      if (x < P.minX || x > P.maxX || z < P.minZ || z > P.maxZ) continue;
      if (pointInPolygon(x, z, P.pts, P.n)) fn(this.topAt(P, x, z), pi, climbableTag(P.tag));
    }
    for (const ci of cell.c) {
      const C = this.cyls[ci];
      if (C.enabled && (x - C.x) ** 2 + (z - C.z) ** 2 < C.r * C.r) fn(C.base + C.height, -1, climbableTag(C.tag));
    }
  }

  /** Nearest point on the prism outline to (x,z): returns squared distance, writes the point to _near. */
  private nearestEdge(P: Prism, x: number, z: number): number {
    const pts = P.pts, n = P.n;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1], cx = pts[j * 2], cz = pts[j * 2 + 1];
      const dx = cx - ax, dz = cz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t, qz = az + dz * t;
      const d = (x - qx) ** 2 + (z - qz) ** 2;
      if (d < best) { best = d; _near.x = qx; _near.z = qz; }
    }
    return best;
  }

  /** Is any solid (within r of (x,z)) occupying the vertical band [y0, y1]? Ramps use their surface near the point. */
  blockedBand(x: number, z: number, r: number, y0: number, y1: number, filter?: (tag: string) => boolean): boolean {
    const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL), cz1 = Math.floor((z + r) / CELL);
    const stamp = ++this.stampCounter;
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const cell = this.grid.get(this.key(cx, cz));
        if (!cell) continue;
        for (const pi of cell.p) {
          const P = this.prisms[pi];
          if (P.stamp === stamp || !P.enabled) continue;
          P.stamp = stamp;
          if (P.base >= y1) continue;
          if (!P.ramp && P.base + P.height <= y0) continue;
          if (P.ramp && Math.max(P.ramp.y0, P.ramp.y1) <= y0) continue;
          if (filter && !filter(P.tag)) continue;
          if (x + r < P.minX || x - r > P.maxX || z + r < P.minZ || z - r > P.maxZ) continue;
          if (pointInPolygon(x, z, P.pts, P.n)) {
            const top = P.ramp ? this.topAt(P, x, z) + P.ramp.slope * r : P.base + P.height;
            if (top > y0) return true;
          } else if (this.nearestEdge(P, x, z) < r * r) {
            if (this.topAt(P, _near.x, _near.z) > y0) return true;
          }
        }
        for (const ci of cell.c) {
          const C = this.cyls[ci];
          if (C.stamp === stamp || !C.enabled) continue;
          C.stamp = stamp;
          if (C.base >= y1 || C.base + C.height <= y0) continue;
          if (filter && !filter(C.tag)) continue;
          if ((x - C.x) ** 2 + (z - C.z) ** 2 < (r + C.r) ** 2) return true;
        }
      }
    return false;
  }

  /**
   * Multi-level version of resolveCircle: push the body (feet at y, height h) out of every solid that occupies
   * [y + STEP_UP, y + h]. Low steps, kerbs and ramps are walked onto instead (the caller snaps y to groundAt()).
   */
  resolveBody(pos: { x: number; z: number }, r: number, y: number, h = AGENT_HEIGHT): boolean {
    let hit = false;
    const feet = y + STEP_UP, head = y + h;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const cx0 = Math.floor((pos.x - r) / CELL), cx1 = Math.floor((pos.x + r) / CELL);
      const cz0 = Math.floor((pos.z - r) / CELL), cz1 = Math.floor((pos.z + r) / CELL);
      const stamp = ++this.stampCounter;
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cz = cz0; cz <= cz1; cz++) {
          const cell = this.grid.get(this.key(cx, cz));
          if (!cell) continue;
          for (const pi of cell.p) {
            const P = this.prisms[pi];
            if (P.stamp === stamp || !P.enabled) continue;
            P.stamp = stamp;
            if (P.base >= head) continue;
            if (!P.ramp && P.base + P.height <= feet) continue;
            if (P.ramp && Math.max(P.ramp.y0, P.ramp.y1) <= feet) continue;
            if (pos.x + r < P.minX || pos.x - r > P.maxX || pos.z + r < P.minZ || pos.z - r > P.maxZ) continue;
            const inside = pointInPolygon(pos.x, pos.z, P.pts, P.n);
            const d2 = this.nearestEdge(P, pos.x, pos.z);
            if (!inside && d2 >= r * r) continue;
            // the surface where we touch it: on it (inside) → under our feet; at its edge → the rim we'd climb
            const top = P.ramp ? (inside ? this.topAt(P, pos.x, pos.z) : this.topAt(P, _near.x, _near.z)) : P.base + P.height;
            if (top <= feet) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const bx = _near.x, bz = _near.z;
            if (inside) {
              const dx = bx - pos.x, dz = bz - pos.z;
              pos.x = bx + (dx / d) * r; pos.z = bz + (dz / d) * r;
            } else {
              const dx = pos.x - bx, dz = pos.z - bz;
              pos.x = bx + (dx / d) * r; pos.z = bz + (dz / d) * r;
            }
            moved = true; hit = true;
          }
          for (const ci of cell.c) {
            const C = this.cyls[ci];
            if (C.stamp === stamp || !C.enabled) continue;
            C.stamp = stamp;
            if (C.base >= head || C.base + C.height <= feet) continue;
            const dx = pos.x - C.x, dz = pos.z - C.z;
            const d = Math.hypot(dx, dz);
            const min = r + C.r;
            if (d < min) {
              const f = d > 1e-5 ? (min - d) / d : 1;
              pos.x += dx * f + (d > 1e-5 ? 0 : 0.01);
              pos.z += dz * f;
              moved = true; hit = true;
            }
          }
        }
      if (!moved) break;
    }
    return hit;
  }

  /**
   * 3D ray vs prisms/cylinders/ground. dir must be normalized.
   * Traverses the grid with a DDA in XZ.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out?: RayHit, bullet = false): RayHit | null {
    let bestT = maxDist;
    let hit: RayHit | null = null;
    const res = out ?? { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, surface: 'ground' as SurfaceKind, tag: '' };
    // ground plane
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t > 0 && t < bestT) {
        bestT = t;
        res.nx = 0; res.ny = 1; res.nz = 0; res.surface = 'ground'; res.tag = 'ground';
        hit = res;
      }
    }
    const stamp = ++this.stampCounter;
    const hl = Math.hypot(dx, dz);
    // DDA over cells
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / Math.abs(dx)) : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / Math.abs(dz)) : Infinity;
    let tCell = 0;
    let guard = 0;
    while (tCell <= bestT && guard++ < 400) {
      const cell = this.grid.get(this.key(cx, cz));
      if (cell) {
        for (const pi of cell.p) {
          const P = this.prisms[pi];
          if (P.stamp === stamp || !P.enabled) continue;
          P.stamp = stamp;
          if (bullet && P.passBullets) continue;
          const t = this.rayPrism(P, ox, oy, oz, dx, dy, dz, hl, bestT, res);
          if (t < bestT) { bestT = t; hit = res; }
        }
        for (const ci of cell.c) {
          const C = this.cyls[ci];
          if (C.stamp === stamp || !C.enabled) continue;
          C.stamp = stamp;
          const t = this.rayCyl(C, ox, oy, oz, dx, dy, dz, bestT, res);
          if (t < bestT) { bestT = t; hit = res; }
        }
      }
      if (hl < 1e-6) break;
      if (tMaxX < tMaxZ) { tCell = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else { tCell = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
    }
    if (hit) {
      hit.dist = bestT;
      hit.x = ox + dx * bestT; hit.y = oy + dy * bestT; hit.z = oz + dz * bestT;
    }
    return hit;
  }

  private rayPrism(P: Prism, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hl: number, bestT: number, res: RayHit): number {
    let best = bestT;
    const top = P.base + P.height;
    const R = P.ramp;
    const pts = P.pts, n = P.n;
    if (hl > 1e-9) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
        const ex = bx - ax, ez = bz - az;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((ax - ox) * ez - (az - oz) * ex) / den;
        if (t <= 1e-4 || t >= best) continue;
        const u = ((ax - ox) * dz - (az - oz) * dx) / den;
        if (u < 0 || u > 1) continue;
        const y = oy + dy * t;
        if (y < P.base || y > (R ? this.topAt(P, ox + dx * t, oz + dz * t) : top)) continue;
        // outward normal (-ez, ex) normalized; only count hits from outside
        const el = Math.hypot(ex, ez);
        const nx = -ez / el, nz = ex / el;
        if (nx * dx + nz * dz > 0) continue;
        best = t;
        res.nx = nx; res.ny = 0; res.nz = nz; res.surface = P.surface; res.tag = P.tag;
      }
    }
    // sloped top (ramps): plane y = y0 + s·((x−ax)·rdx + (z−az)·rdz), hit from above
    if (R) {
      const sl = (R.y1 - R.y0) * R.inv;
      const A = (ox - R.ax) * R.dx + (oz - R.az) * R.dz, B = dx * R.dx + dz * R.dz;
      const den = dy - sl * B;
      if (Math.abs(den) > 1e-9) {
        const t = (R.y0 + sl * A - oy) / den;
        if (t > 1e-4 && t < best) {
          const x = ox + dx * t, z = oz + dz * t;
          // normal (−s·rdx, 1, −s·rdz): only count hits coming from above the surface
          if (dy - sl * B < 0 && pointInPolygon(x, z, pts, n)) {
            best = t;
            const nl = Math.hypot(sl * R.dx, 1, sl * R.dz);
            res.nx = (-sl * R.dx) / nl; res.ny = 1 / nl; res.nz = (-sl * R.dz) / nl; res.surface = P.surface; res.tag = P.tag;
          }
        }
      }
    }
    // roof (from above)
    if (!R && dy < -1e-6 && oy > top) {
      const t = (top - oy) / dy;
      if (t > 0 && t < best) {
        const x = ox + dx * t, z = oz + dz * t;
        if (pointInPolygon(x, z, pts, n)) {
          best = t;
          res.nx = 0; res.ny = 1; res.nz = 0; res.surface = P.surface; res.tag = P.tag;
        }
      }
    }
    // underside (bridges)
    if (dy > 1e-6 && oy < P.base && P.base > 0.5) {
      const t = (P.base - oy) / dy;
      if (t > 0 && t < best) {
        const x = ox + dx * t, z = oz + dz * t;
        if (pointInPolygon(x, z, pts, n)) {
          best = t;
          res.nx = 0; res.ny = -1; res.nz = 0; res.surface = P.surface; res.tag = P.tag;
        }
      }
    }
    return best;
  }

  private rayCyl(C: Cyl, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, bestT: number, res: RayHit): number {
    const fx = ox - C.x, fz = oz - C.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-12) return bestT;
    const b = 2 * (fx * dx + fz * dz);
    const c = fx * fx + fz * fz - C.r * C.r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return bestT;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t <= 1e-4 || t >= bestT) return bestT;
    const y = oy + dy * t;
    if (y < C.base || y > C.base + C.height) return bestT;
    const hx = fx + dx * t, hz = fz + dz * t;
    const l = Math.hypot(hx, hz) || 1;
    res.nx = hx / l; res.ny = 0; res.nz = hz / l; res.surface = C.surface; res.tag = C.tag;
    return t;
  }

  /** Line of sight between two points at given heights. Gates are see-through unless solidGates is set. */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number, solidGates = false): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const h = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, scratchHit, !solidGates);
    return !h || h.tag === 'ground';
  }
}

const _near = { x: 0, z: 0 };
const scratchHit: RayHit = { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 'ground', tag: '' };
