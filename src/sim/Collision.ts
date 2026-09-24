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

export class StaticCollision {
  prisms: Prism[] = [];
  cyls: Cyl[] = [];
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
    this.prisms.push({ id, pts, n: p.length, base, height, minX, maxX, minZ, maxZ, surface, enabled: true, tag, stamp: 0, passBullets: tag.startsWith('gate:') });
    this.cellsFor(minX, maxX, minZ, maxZ, (c) => c.p.push(id));
    return id;
  }

  /** Thick line segment (walls, gates, fences) */
  addSegment(a: V2, b: V2, thickness: number, height: number, surface: SurfaceKind = 'concrete', tag = ''): number {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * thickness * 0.5, nz = (dx / l) * thickness * 0.5;
    return this.addPolygon([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], height, surface, tag);
  }

  addPolyline(pts: V2[], thickness: number, height: number, surface: SurfaceKind = 'concrete', tag = ''): void {
    for (let i = 1; i < pts.length; i++) this.addSegment(pts[i - 1], pts[i], thickness, height, surface, tag);
  }

  addCircle(x: number, z: number, r: number, height: number, surface: SurfaceKind = 'wood', tag = ''): number {
    const id = this.cyls.length;
    this.cyls.push({ id, x, z, r, base: 0, height, surface, enabled: true, tag, stamp: 0 });
    this.cellsFor(x - r, x + r, z - r, z + r, (c) => c.c.push(id));
    return id;
  }

  setPrismEnabled(id: number, enabled: boolean): void {
    this.prisms[id].enabled = enabled;
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
        if (y < P.base || y > top) continue;
        // outward normal (-ez, ex) normalized; only count hits from outside
        const el = Math.hypot(ex, ez);
        const nx = -ez / el, nz = ex / el;
        if (nx * dx + nz * dz > 0) continue;
        best = t;
        res.nx = nx; res.ny = 0; res.nz = nz; res.surface = P.surface; res.tag = P.tag;
      }
    }
    // roof (from above)
    if (dy < -1e-6 && oy > top) {
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

  /** Line of sight between two points at given heights. */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const h = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, scratchHit, true);
    return !h || h.tag === 'ground';
  }
}

const scratchHit: RayHit = { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 'ground', tag: '' };
