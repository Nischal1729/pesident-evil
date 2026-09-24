import type { V2 } from './layout';

export function signedArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a * 0.5;
}

/** Returns a copy with negative signed area (so outward normal of edge a→b is (-dz, dx)). */
export function normalizeWinding(poly: V2[]): V2[] {
  const p = poly.slice();
  if (p.length > 2) {
    const f = p[0], l = p[p.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) p.pop();
  }
  return signedArea(p) > 0 ? p.reverse() : p;
}

export function pointInPolygon(x: number, z: number, poly: ArrayLike<number>, n: number): boolean {
  // poly as flat [x0,z0,x1,z1,...]
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], zi = poly[i * 2 + 1];
    const xj = poly[j * 2], zj = poly[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPoly(x: number, z: number, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyBounds(poly: V2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

export function polyCentroid(poly: V2[]): V2 {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const f = x0 * z1 - x1 * z0;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-6) {
    let sx = 0, sz = 0;
    for (const [x, z] of poly) { sx += x; sz += z; }
    return [sx / poly.length, sz / poly.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

/** Offset a polyline to both sides → quad strip polygon (for roads/walls). */
export function polylineToStrip(pts: V2[], width: number): { left: V2[]; right: V2[] } {
  const hw = width / 2;
  const left: V2[] = [];
  const right: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx0 = p[0] - prev[0], dz0 = p[1] - prev[1];
    let dx1 = next[0] - p[0], dz1 = next[1] - p[1];
    const l0 = Math.hypot(dx0, dz0) || 1, l1 = Math.hypot(dx1, dz1) || 1;
    dx0 /= l0; dz0 /= l0; dx1 /= l1; dz1 /= l1;
    if (i === 0) { dx0 = dx1; dz0 = dz1; }
    if (i === pts.length - 1) { dx1 = dx0; dz1 = dz0; }
    // normals
    const n0x = -dz0, n0z = dx0, n1x = -dz1, n1z = dx1;
    let mx = n0x + n1x, mz = n0z + n1z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cos = mx * n1x + mz * n1z;
    const s = hw / Math.max(0.35, cos);
    left.push([p[0] + mx * s, p[1] + mz * s]);
    right.push([p[0] - mx * s, p[1] - mz * s]);
  }
  return { left, right };
}

export function polylineLength(pts: V2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** Sample points along a polyline every `step` metres (with offset from the line). */
export function samplePolyline(pts: V2[], step: number, sideOffset = 0, startOffset = step / 2): { p: V2; dir: V2 }[] {
  const out: { p: V2; dir: V2 }[] = [];
  let carry = startOffset;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    let d = carry;
    while (d <= len) {
      out.push({ p: [a[0] + ux * d - uz * sideOffset, a[1] + uz * d + ux * sideOffset], dir: [ux, uz] });
      d += step;
    }
    carry = d - len;
  }
  return out;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, z: number): number {
  let h = Math.imul(Math.floor(x) | 0, 374761393) + Math.imul(Math.floor(z) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Poisson-ish scatter inside a polygon (rejection sampling with min distance). */
export function scatterInPolygon(poly: V2[], count: number, minDist: number, seed: number, avoid?: (x: number, z: number) => boolean): V2[] {
  const r = rng(seed);
  const b = polyBounds(poly);
  const out: V2[] = [];
  let tries = 0;
  while (out.length < count && tries < count * 60) {
    tries++;
    const x = b.minX + r() * (b.maxX - b.minX);
    const z = b.minZ + r() * (b.maxZ - b.minZ);
    if (!pointInPoly(x, z, poly)) continue;
    if (avoid && avoid(x, z)) continue;
    let ok = true;
    for (const [ox, oz] of out) if ((ox - x) ** 2 + (oz - z) ** 2 < minDist * minDist) { ok = false; break; }
    if (ok) out.push([x, z]);
  }
  return out;
}
