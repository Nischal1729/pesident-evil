import * as THREE from 'three';
import type { StaticCollision } from '../sim/Collision';
import { GeoBuffer } from './buildings';
import type { V2 } from './layout';
import type { TreeSpecies } from './trees';
import { cortenTexture, hedgeTexture, kerbTexture, pbrMaterial, speckleTexture, worldUniforms, type WorldTextures } from './materials';

export const CHUNK = 128;
/** Larger chunks for small, scattered detail (kerbs, lamps, fixtures) to keep draw calls down. */
export const DETAIL_CHUNK = 200;

/** Geometry buffers split by material key and spatial chunk (so far-away chunks are frustum culled). */
export class Chunked {
  map = new Map<string, GeoBuffer>();
  constructor(private opts: { color?: boolean; facade?: boolean }, private chunk = CHUNK) {}
  get(key: string, x: number, z: number): GeoBuffer {
    const k = `${key}|${Math.floor(x / this.chunk)}|${Math.floor(z / this.chunk)}`;
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = new GeoBuffer(this.opts)));
    return b;
  }
  build(group: THREE.Group, matFor: (key: string) => THREE.Material, shadows: { cast: boolean; receive: boolean } | ((key: string) => { cast: boolean; receive: boolean })): number {
    let n = 0;
    for (const [k, buf] of this.map) {
      if (buf.vertexCount === 0) continue;
      const key = k.split('|')[0];
      const mesh = new THREE.Mesh(buf.toGeometry(), matFor(key));
      const s = typeof shadows === 'function' ? shadows(key) : shadows;
      mesh.castShadow = s.cast;
      mesh.receiveShadow = s.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = k;
      group.add(mesh);
      n++;
    }
    return n;
  }
}

export type DetailKey = 'stone' | 'plaster' | 'metal' | 'glass' | 'wood' | 'polished' | 'hedge' | 'lime' | 'murraya' | 'corten' | 'kerb' | 'dark' | 'emissive';

interface InstSet { geo: THREE.BufferGeometry; mat: THREE.Material; mats: THREE.Matrix4[]; cols: THREE.Color[] | null; cast: boolean; receive: boolean }

/** Sign / mural atlas: one canvas, many signs, 2 draw calls (glowing signs + matte murals). Requests are packed on pack(). */
export class SignAtlas {
  readonly W = 2048;
  readonly H = 2048;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  private queue: { w: number; h: number; draw: (g: CanvasRenderingContext2D, w: number, h: number) => void; uv: [number, number, number, number] }[] = [];
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.g = this.canvas.getContext('2d')!;
  }
  /** Request a w x h pixel rectangle; returns a UV rect [u0,v0,u1,v1] that is filled in by pack(). */
  add(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): [number, number, number, number] {
    const uv: [number, number, number, number] = [0, 0, 0.001, 0.001];
    this.queue.push({ w, h, draw, uv });
    return uv;
  }
  /** Shelf-pack all requests (tallest first) and draw them. */
  pack(): void {
    const q = this.queue.slice().sort((a, b) => b.h - a.h || b.w - a.w);
    let cx = 0, cy = 0, rowH = 0;
    this.g.clearRect(0, 0, this.W, this.H);
    for (const r of q) {
      if (cx + r.w > this.W) { cx = 0; cy += rowH + 4; rowH = 0; }
      if (cy + r.h > this.H) { console.warn('[signs] atlas full'); continue; }
      const x = cx, y = cy;
      this.g.save();
      this.g.translate(x, y);
      this.g.beginPath(); this.g.rect(0, 0, r.w, r.h); this.g.clip();
      r.draw(this.g, r.w, r.h);
      this.g.restore();
      cx += r.w + 4;
      rowH = Math.max(rowH, r.h);
      // UV: canvas y down → v up (flipY texture); inset half a texel
      const hx = 0.5 / this.W, hy = 0.5 / this.H;
      r.uv[0] = x / this.W + hx; r.uv[1] = 1 - (y + r.h) / this.H + hy; r.uv[2] = (x + r.w) / this.W - hx; r.uv[3] = 1 - y / this.H - hy;
    }
    this.queue = [];
  }
}

/**
 * Shared world-building kit: collision, chunked detail buffers with a handful of vertex-coloured materials,
 * instanced sets, and the sign atlas. Sub-builders (GJBC, landmarks, landscape) all add into this.
 */
export class WorldKit {
  detail = new Chunked({ color: true }, DETAIL_CHUNK);
  inst = new Map<string, InstSet>();
  atlas = new SignAtlas();
  signGlow = new GeoBuffer();
  signMatte = new GeoBuffer();
  mats = new Map<string, THREE.Material>();
  updatables: ((dt: number, t: number) => void)[] = [];
  /** Extra light positions (wall / column lights) that the campus exposes as LampInfo. */
  lampPoints: THREE.Vector3[] = [];
  /** Tree placement hook (set by the campus builder): species, x, z, scale, collide. */
  addTree: (sp: TreeSpecies, x: number, z: number, scale: number, collide?: boolean) => void = () => {};

  constructor(public group: THREE.Group, public collision: StaticCollision, public tex: WorldTextures) {}

  /** Box into a detail buffer (chunk chosen by centre). */
  box(key: DetailKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rot = 0, c?: THREE.Color, uv = 1): void {
    this.detail.get(key, cx, cz).box(cx, cy, cz, sx, sy, sz, rot, c, uv);
  }
  segBox(key: DetailKey, a: V2, b: V2, y0: number, y1: number, thick: number, c?: THREE.Color, offset = 0, extend = 0, uv = 1): void {
    this.detail.get(key, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2).segBox(a, b, y0, y1, thick, c, offset, extend, uv);
  }
  buf(key: DetailKey, x: number, z: number): GeoBuffer { return this.detail.get(key, x, z); }

  /** Register / fetch an instanced set. */
  instSet(key: string, make: () => { geo: THREE.BufferGeometry; mat: THREE.Material; cast?: boolean; receive?: boolean; colored?: boolean }): InstSet {
    let s = this.inst.get(key);
    if (!s) {
      const m = make();
      s = { geo: m.geo, mat: m.mat, mats: [], cols: m.colored ? [] : null, cast: m.cast ?? true, receive: m.receive ?? true };
      this.inst.set(key, s);
    }
    return s;
  }
  addInst(s: InstSet, pos: THREE.Vector3, rotY: number, scale: THREE.Vector3 | number, color?: THREE.Color): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const sc = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
    s.mats.push(new THREE.Matrix4().compose(pos, q, sc));
    if (s.cols) s.cols.push(color ?? new THREE.Color(1, 1, 1));
  }
  addInstMatrix(s: InstSet, m: THREE.Matrix4, color?: THREE.Color): void {
    s.mats.push(m);
    if (s.cols) s.cols.push(color ?? new THREE.Color(1, 1, 1));
  }

  /** Quad textured from the sign atlas. centre (x,y,z), size w x h, facing direction (nx, nz); glow = lit at night. */
  signQuad(uv: [number, number, number, number], x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, glow = true, rotZ = 0): void {
    const b = glow ? this.signGlow : this.signMatte;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    // right vector for a viewer facing the sign (looking along -n): right = (nz, -nx)
    const rx = nz, rz = -nx;
    const cs = Math.cos(rotZ), sn = Math.sin(rotZ);
    const corner = (sx: number, sy: number): [number, number, number] => {
      const px = (sx * w) / 2, py = (sy * h) / 2;
      const lx = px * cs - py * sn, ly = px * sn + py * cs;
      return [x + rx * lx, y + ly, z + rz * lx];
    };
    const [u0, v0, u1, v1] = uv;
    const p0 = corner(-1, -1), p1 = corner(1, -1), p2 = corner(1, 1), p3 = corner(-1, 1);
    const i0 = b.vert(p0[0], p0[1], p0[2], nx, 0, nz, u0, v0);
    const i1 = b.vert(p1[0], p1[1], p1[2], nx, 0, nz, u1, v0);
    const i2 = b.vert(p2[0], p2[1], p2[2], nx, 0, nz, u1, v1);
    const i3 = b.vert(p3[0], p3[1], p3[2], nx, 0, nz, u0, v1);
    b.quad(i0, i1, i2, i3);
  }

  material(key: string): THREE.Material {
    let m = this.mats.get(key);
    if (m) return m;
    const t = this.tex;
    switch (key) {
      // the plaster albedo averages ≈0.41 (linear): scale it out so vertex colours are the actual albedo
      case 'stone': m = pbrMaterial(t.plaster, { color: new THREE.Color(2.3, 2.3, 2.3), roughness: 0.85, vertexColors: true, normalScale: 0.35 }); break;
      case 'plaster': m = pbrMaterial(t.plaster, { color: new THREE.Color(2.3, 2.3, 2.3), roughness: 0.9, vertexColors: true, normalScale: 0.5 }); break;
      case 'metal': m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.55 }); break;
      case 'glass': m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.07 }); break;
      case 'wood': m = pbrMaterial(t.plaster, { color: new THREE.Color(2.2, 2.2, 2.2), roughness: 0.6, vertexColors: true, normalScale: 0.3 }); break;
      case 'dark': m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.85 }); break;
      case 'polished': {
        const map = speckleTexture();
        map.repeat.set(1, 1);
        m = new THREE.MeshStandardMaterial({ map, color: new THREE.Color(1.3, 1.3, 1.3), vertexColors: true, roughness: 0.3, metalness: 0.0 });
        break;
      }
      case 'hedge': case 'lime': case 'murraya': {
        const map = hedgeTexture(key === 'hedge' ? 'green' : key === 'lime' ? 'lime' : 'white');
        m = new THREE.MeshStandardMaterial({ map, color: new THREE.Color(1.7, 1.7, 1.7), vertexColors: true, roughness: 0.9 });
        break;
      }
      case 'corten': m = new THREE.MeshStandardMaterial({ map: cortenTexture(), vertexColors: true, roughness: 0.85, metalness: 0.15 }); break;
      case 'kerb': m = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.8, vertexColors: true }); break;
      case 'emissive': {
        const em = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x333333, emissive: new THREE.Color(1.0, 0.86, 0.62), emissiveIntensity: 0 });
        this.updatables.push(() => { em.emissiveIntensity = worldUniforms.uNight.value * 5; });
        m = em;
        break;
      }
      default: m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    }
    // detail materials use constant roughness (the texture ARM maps are too glossy for matte cladding)
    if ((m as THREE.MeshStandardMaterial).roughnessMap && (key === 'stone' || key === 'plaster' || key === 'wood')) (m as THREE.MeshStandardMaterial).roughnessMap = null;
    this.mats.set(key, m);
    return m;
  }

  /** Flush detail buffers, instanced sets and signs into the group. */
  flush(): void {
    const noShadow = new Set(['kerb', 'polished', 'emissive']);
    this.detail.build(this.group, (k) => this.material(k), (k) => ({ cast: !noShadow.has(k), receive: true }));
    for (const [key, s] of this.inst) {
      if (!s.mats.length) continue;
      const mesh = new THREE.InstancedMesh(s.geo, s.mat, s.mats.length);
      s.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      if (s.cols) s.cols.forEach((c, i) => mesh.setColorAt(i, c));
      mesh.castShadow = s.cast; mesh.receiveShadow = s.receive;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      mesh.name = `inst:${key}`;
      this.group.add(mesh);
    }
    const tex = new THREE.CanvasTexture(this.atlas.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    if (this.signGlow.vertexCount) {
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, roughness: 0.45, metalness: 0.05, emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.updatables.push(() => { mat.emissiveIntensity = worldUniforms.uNight.value * 0.75; });
      const m = new THREE.Mesh(this.signGlow.toGeometry(), mat);
      m.name = 'signs:glow'; m.receiveShadow = true;
      this.group.add(m);
    }
    if (this.signMatte.vertexCount) {
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
      const m = new THREE.Mesh(this.signMatte.toGeometry(), mat);
      m.name = 'signs:matte'; m.receiveShadow = true;
      this.group.add(m);
    }
  }
}

/** Colour helper */
export const col = (hex: string | number): THREE.Color => new THREE.Color(hex);
