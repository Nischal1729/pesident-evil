import * as THREE from 'three';
import { rng } from '../geom';
import { CELL, cellUV, foliageTextures } from './atlas';
import { patchVegetation } from './shaders';

/**
 * Shrubs and ground cover built from the shared leaf atlas (one texture for all vegetation):
 *   fountainGrassGeometry  Pennisetum mound: arching blade strips + straw plumes
 *   frondShrubGeometry     cycad / fern / dracaena clump of arching fronds
 *   leafyShrubGeometry     rounded leafy shrub (murraya / ixora style)
 *   hedgeCardGeometry      one leaf-cluster card used to fluff hedge boxes
 * All geometries carry the `wind` attribute used by patchVegetation.
 */

class G {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; wnd: number[] = []; idx: number[] = [];
  v(p: THREE.Vector3, n: THREE.Vector3, u: number, w: number, c: number, fl: number, ph: number): number {
    this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(u, w); this.col.push(c, c, c); this.wnd.push(0, 0, fl, ph);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, a, c, d); }
  geometry(swayH: number): THREE.BufferGeometry {
    for (let i = 0; i < this.pos.length / 3; i++) this.wnd[i * 4] = Math.min(1, Math.max(0, this.pos[i * 3 + 1]) / swayH) * 0.25;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('wind', new THREE.Float32BufferAttribute(this.wnd, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** An arching card strip from `base` along azimuth `az`: starts at elevation `elev` from vertical and droops. */
function arch(g: G, cell: number, base: THREE.Vector3, az: number, elev: number, L: number, W: number, droop: number, segs: number, ph: number, ao0 = 0.5, twist = 0): void {
  const [u0, v0, u1, v1] = cellUV(cell);
  const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  side.applyAxisAngle(dir, twist);
  let prev = -1;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const hx = L * Math.sin(elev) * t * (1 + 0.35 * t);
    const hy = L * (Math.cos(elev) * t - droop * t * t);
    const p = base.clone().addScaledVector(dir, hx).addScaledVector(UP, hy);
    const tan = dir.clone().multiplyScalar(Math.sin(elev) * (1 + 0.7 * t)).addScaledVector(UP, Math.cos(elev) - 2 * droop * t).normalize();
    const n = new THREE.Vector3().crossVectors(side, tan).normalize();
    if (n.y < 0) n.negate();
    n.lerp(UP, 0.45).normalize();
    const w = W * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.8)));
    const c = ao0 + (1 - ao0) * t;
    const v = v0 + (v1 - v0) * t;
    const a = g.v(p.clone().addScaledVector(side, -w / 2), n, u0, v, c, t, ph);
    g.v(p.clone().addScaledVector(side, w / 2), n, u1, v, c, t, ph);
    if (prev >= 0) g.quad(prev, prev + 1, a + 1, a);
    prev = a;
  }
}

/** Fountain grass (Pennisetum) mound, unit height ≈ 1 m, radius ≈ 0.55 m. */
export function fountainGrassGeometry(): THREE.BufferGeometry {
  const g = new G();
  const r = rng(515);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + r() * 0.4;
    const base = new THREE.Vector3(Math.cos(az) * 0.06, 0, Math.sin(az) * 0.06);
    arch(g, CELL.fountainGrass, base, az, 0.25 + r() * 0.45, 0.95 + r() * 0.25, 0.62 + r() * 0.2, 0.28 + r() * 0.12, 3, r(), 0.45);
  }
  // straw plumes: two tall crossed cards, slightly arching
  for (let k = 0; k < 1; k++) {
    const az = k * Math.PI * 0.5 + r();
    arch(g, CELL.plume, new THREE.Vector3(0, 0.1, 0), az, 0.18, 1.2, 0.7, 0.1, 2, r(), 0.8);
    arch(g, CELL.plume, new THREE.Vector3(0, 0.1, 0), az + Math.PI, 0.18, 1.15, 0.7, 0.1, 2, r(), 0.8);
  }
  return g.geometry(1.1);
}

/** Cycad / fern / dracaena clump: arching fronds, unit height ≈ 0.8 m. */
export function frondShrubGeometry(): THREE.BufferGeometry {
  const g = new G();
  const r = rng(616);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + r() * 0.5;
    arch(g, CELL.fern, new THREE.Vector3(Math.cos(az) * 0.04, 0.02, Math.sin(az) * 0.04), az, 0.45 + r() * 0.55, 0.7 + r() * 0.25, 0.42 + r() * 0.1, 0.25 + r() * 0.15, 3, r(), 0.4, (r() - 0.5) * 0.6);
  }
  arch(g, CELL.fern, new THREE.Vector3(0, 0.02, 0), r() * 6.28, 0.1, 0.75, 0.4, 0.1, 2, r(), 0.5);
  return g.geometry(0.8);
}

/** Rounded leafy shrub: overlapping cluster cards on a dome, unit radius ≈ 0.5 m, height ≈ 0.7 m. */
export function leafyShrubGeometry(): THREE.BufferGeometry {
  const g = new G();
  const r = rng(717);
  const [u0, v0, u1, v1] = cellUV(CELL.hedge);
  const n = 11;
  for (let i = 0; i < n; i++) {
    const az = r() * Math.PI * 2, el = Math.acos(0.15 + r() * 0.85);
    const nrm = new THREE.Vector3(Math.sin(el) * Math.cos(az), Math.cos(el), Math.sin(el) * Math.sin(az));
    const c = nrm.clone().multiply(new THREE.Vector3(0.42, 0.45, 0.42)).add(new THREE.Vector3(0, 0.3, 0));
    const side = new THREE.Vector3().crossVectors(nrm, new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize()).normalize();
    const fwd = new THREE.Vector3().crossVectors(nrm, side).normalize();
    const s = 0.34 + r() * 0.12;
    const ao = 0.6 + 0.4 * (c.y / 0.75);
    const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => g.v(c.clone().addScaledVector(side, a * s).addScaledVector(fwd, b * s), nrm.clone().lerp(UP, 0.3).normalize(), a < 0 ? u0 : u1, b < 0 ? v0 : v1, ao, 0.6, r()));
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  return g.geometry(0.8);
}

/** Unit leaf-cluster card in the XY plane facing +Z (for hedge fluff). */
export function hedgeCardGeometry(): THREE.BufferGeometry {
  const g = new G();
  const [u0, v0, u1, v1] = cellUV(CELL.hedge);
  const n = new THREE.Vector3(0, 0.35, 1).normalize();
  const ids = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a, b]) => g.v(new THREE.Vector3(a, b, 0), n, a < 0 ? u0 : u1, b < 0 ? v0 : v1, b < 0 ? 0.75 : 1, 0.35, 0));
  g.quad(ids[0], ids[1], ids[2], ids[3]);
  return g.geometry(1e6);
}

const mats = new Map<string, THREE.MeshStandardMaterial>();

/** Shared alpha-tested foliage material (leaf atlas, wind, translucency). */
export function foliageMaterial(key: 'grass' | 'shrub' | 'hedge'): THREE.MeshStandardMaterial {
  let m = mats.get(key);
  if (m) return m;
  const tex = foliageTextures();
  m = new THREE.MeshStandardMaterial({ map: tex.leaves, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: key === 'grass' ? 0.88 : 0.75, metalness: 0 });
  patchVegetation(m, { wind: true, leaf: true, trans: key === 'grass' ? 0.35 : 0.25 });
  m.visible = tex.leavesLoaded;
  const mm = m;
  tex.ready.then(() => { mm.visible = true; });
  mats.set(key, m);
  return m;
}
