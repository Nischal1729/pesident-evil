import * as THREE from 'three';
import type { GeoBuffer } from './buildings';
import { rng } from './geom';
import { col, type WorldKit } from './kit';
import { cycad } from './landscape';
import type { V2 } from './layout';

/**
 * Small geometry helpers shared by the MRD / BE-block / Open Air Theatre builders (mrd.ts, bblock.ts, oat.ts).
 * Everything writes into the kit's merged, chunked detail buffers (no extra draw calls).
 */
export type P3 = [number, number, number];

/** Planar quad with an explicit normal; the winding is fixed up so the face points along `n`. */
export function quad3(b: GeoBuffer, p: P3[], n: P3, c?: THREE.Color, uvScale = 0.5): void {
  const e1x = p[1][0] - p[0][0], e1y = p[1][1] - p[0][1], e1z = p[1][2] - p[0][2];
  const e2x = p[2][0] - p[0][0], e2y = p[2][1] - p[0][1], e2z = p[2][2] - p[0][2];
  const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
  const q = cx * n[0] + cy * n[1] + cz * n[2] < 0 ? [p[0], p[3], p[2], p[1]] : p;
  // world-space UVs: horizontal faces use xz, vertical faces use (along, y)
  const horiz = Math.abs(n[1]) > 0.7;
  const ids = q.map((v) => b.vert(v[0], v[1], v[2], n[0], n[1], n[2], (horiz ? v[0] : v[0] * Math.abs(n[2]) + v[2] * Math.abs(n[0])) * uvScale, (horiz ? -v[2] : v[1]) * uvScale, c));
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** Outward unit normal of edge a→b of polygon `poly` (the side away from the polygon centroid). */
export function outwardNormal(poly: V2[], a: V2, b: V2): V2 {
  let cx = 0, cz = 0;
  for (const p of poly) { cx += p[0]; cz += p[1]; }
  cx /= poly.length; cz /= poly.length;
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  let nx = -dz / l, nz = dx / l;
  if ((cx - (a[0] + b[0]) / 2) * nx + (cz - (a[1] + b[1]) / 2) * nz > 0) { nx = -nx; nz = -nz; }
  return [nx, nz];
}

const RUBBLE = ['#6f6a62', '#7d776d', '#5f5b55', '#8a8378', '#746b5f', '#666159'].map((h) => col(h));

/**
 * Rough-dressed grey granite retaining wall (the OAT / MRD plinth walls): a mortar-coloured core plus courses of
 * irregular protruding blocks on the face that points along `n` (unit, plan). `a`→`b` is the face line.
 */
export function rubbleWall(kit: WorldKit, a: V2, b: V2, n: V2, y0: number, y1: number, seed: number, thick = 0.5): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  if (len < 0.2) return;
  const ux = dx / len, uz = dz / len;
  const rot = Math.atan2(-dz, dx);
  // core (set back a little so the blocks read), mortar colour
  kit.box('stone', (a[0] + b[0]) / 2 - n[0] * thick / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2 - n[1] * thick / 2, len, y1 - y0, thick, rot, col('#8c877d'), 0.5);
  const buf = kit.buf('stone', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  const r = rng(seed);
  let row = 0;
  for (let y = y0 + 0.02; y < y1 - 0.12; row++) {
    const h = Math.min(y1 - y - 0.03, 0.32 + r() * 0.22);
    let s = row % 2 ? -0.35 * r() : 0;
    while (s < len - 0.1) {
      const w = 0.55 + r() * 0.7;
      const s0 = Math.max(0, s), s1 = Math.min(len, s + w);
      if (s1 - s0 > 0.12) {
        const cs = (s0 + s1) / 2;
        const ww = s1 - s0 - 0.035;
        const d = 0.05 + r() * 0.07;
        const cx = a[0] + ux * cs + n[0] * d / 2, cz = a[1] + uz * cs + n[1] * d / 2;
        buf.box(cx, y + h / 2, cz, ww, h - 0.035, d + 0.02, rot, RUBBLE[Math.floor(r() * RUBBLE.length)].clone().multiplyScalar(0.9 + r() * 0.2), 0.5, true);
      }
      s += w;
    }
    y += h;
  }
}

/** Terracotta pot with a leafy plant (instanced cycad clump). */
export function pottedPlant(kit: WorldKit, x: number, y: number, z: number, s = 1): void {
  kit.box('stone', x, y + 0.2 * s, z, 0.42 * s, 0.4 * s, 0.42 * s, 0, col('#9a4f2e'), 0.5);
  kit.box('stone', x, y + 0.41 * s, z, 0.48 * s, 0.05 * s, 0.48 * s, 0, col('#8a4428'), 0.5);
  cycad(kit, x, y + 0.42 * s, z, 0.75 * s);
}

/** Point on an arc around centre c at radius r and angle t (t measured from +X towards north, i.e. −Z). */
export function arcPt(c: V2, r: number, t: number): V2 {
  return [c[0] + Math.cos(t) * r, c[1] - Math.sin(t) * r];
}
