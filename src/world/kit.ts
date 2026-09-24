import * as THREE from 'three';
import type { StaticCollision } from '../sim/Collision';
import { GeoBuffer } from './buildings';
import type { V2 } from './layout';
import type { TreeSpecies } from './trees';
import { cortenTexture, detailMaterial, hedgeTexture, injectWorldLighting, kerbTexture, worldUniforms, type WorldTextures } from './materials';

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

/**
 * Detail material keys. stone = cream stone / render cladding, plaster = rough painted render, metal = steel,
 * glass = tinted glazing (dielectric, reflective), wood = fine-grain timber / veneer, polished = polished granite
 * (floors, columns), granite = honed / flamed granite (steps, plinths, copings), concrete = exposed concrete,
 * paint = smooth satin paint (fascias, canopies, railings), dark = untextured matte (markings, voids).
 * Vertex colours are the albedo for every key; textures only add grain.
 */
export type DetailKey = 'stone' | 'plaster' | 'metal' | 'glass' | 'wood' | 'polished' | 'granite' | 'concrete' | 'paint' | 'hedge' | 'lime' | 'murraya' | 'corten' | 'kerb' | 'dark' | 'emissive';

/** Keys whose texture needs real UVs: triangles with zero UV area get a world-space box projection in flush(). */
const PROJECT_KEYS = new Set(['stone', 'plaster', 'wood', 'polished', 'granite', 'concrete', 'hedge', 'lime', 'murraya']);

/** Replace degenerate (zero-area) UVs with a world-space projection (1 UV unit per metre), leaving good UVs alone. */
function fixDegenerateUVs(b: GeoBuffer): void {
  const { pos, uv, idx } = b;
  const nv = pos.length / 3;
  const locked = new Uint8Array(nv);
  const bad: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], c = idx[t + 1], d = idx[t + 2];
    const area = (uv[c * 2] - uv[a * 2]) * (uv[d * 2 + 1] - uv[a * 2 + 1]) - (uv[d * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]);
    if (Math.abs(area) > 1e-9) { locked[a] = locked[c] = locked[d] = 1; } else bad.push(t);
  }
  for (const t of bad) {
    const ids = [idx[t], idx[t + 1], idx[t + 2]];
    const [a, c, d] = ids;
    const e1x = pos[c * 3] - pos[a * 3], e1y = pos[c * 3 + 1] - pos[a * 3 + 1], e1z = pos[c * 3 + 2] - pos[a * 3 + 2];
    const e2x = pos[d * 3] - pos[a * 3], e2y = pos[d * 3 + 1] - pos[a * 3 + 1], e2z = pos[d * 3 + 2] - pos[a * 3 + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const i of ids) {
      if (locked[i]) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (Math.abs(ny) > 0.7) { uv[i * 2] = x; uv[i * 2 + 1] = -z; }
      else { const hl = Math.hypot(nx, nz) || 1; uv[i * 2] = (x * -nz + z * nx) / hl; uv[i * 2 + 1] = y; }
    }
  }
}

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
      // textured keys: vertex colour = albedo (textures are normalised per channel and only add grain)
      case 'stone': m = detailMaterial(t.stucco, { key, roughness: 0.78, normalScale: 0.35, macro: 0.07 }); break;
      case 'plaster': m = detailMaterial(t.stucco, { key, roughness: 0.9, normalScale: 0.7, macro: 0.1 }); break;
      case 'wood': m = detailMaterial(t.wood, { key, roughness: 0.55, normalScale: 0.45, macro: 0.05, roughVar: 0.2 }); break;
      case 'polished': m = detailMaterial(t.granite, { key, roughness: 0.13, normalScale: 0.12, macro: 0.04, roughVar: 0.45 }); break;
      case 'granite': m = detailMaterial(t.granite, { key, roughness: 0.55, normalScale: 0.5, macro: 0.05 }); break;
      case 'concrete': m = detailMaterial(t.concreteWall, { key, roughness: 0.85, normalScale: 0.6, macro: 0.08 }); break;
      case 'metal': {
        const mm = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.48 });
        mm.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{ vec3 mp = wlWorldPos(); roughnessFactor *= 0.8 + 0.4 * wlNoise(mp.xz * 2.1 + mp.y * 1.7); }`);
          injectWorldLighting(shader);
        };
        mm.customProgramCacheKey = () => 'kit_metal';
        m = mm;
        break;
      }
      case 'paint': m = detailMaterial(t.stucco, { key, roughness: 0.4, normalScale: 0.06, macro: 0.03, roughVar: 0.25 }); break;
      case 'glass': {
        // tinted dielectric glazing: dark body (the vertex colour tints it), strong Fresnel reflection of the sky
        const gm = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.05 });
        gm.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.28;')
            .replace('#include <lights_fragment_end>', '#if defined( RE_IndirectSpecular )\n  radiance *= 2.2;\n#endif\n#include <lights_fragment_end>');
          injectWorldLighting(shader);
        };
        gm.customProgramCacheKey = () => 'kit_glass';
        m = gm;
        break;
      }
      case 'dark': m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.85 }); break;
      case 'hedge': case 'lime': case 'murraya': {
        const map = hedgeTexture(key === 'hedge' ? 'green' : key === 'lime' ? 'lime' : 'white');
        m = new THREE.MeshStandardMaterial({ map, color: new THREE.Color(1.7, 1.7, 1.7), vertexColors: true, roughness: 0.9 });
        break;
      }
      case 'corten': m = new THREE.MeshStandardMaterial({ map: cortenTexture(), vertexColors: true, roughness: 0.85, metalness: 0.15 }); break;
      case 'kerb': m = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.82, vertexColors: true }); break;
      case 'emissive': {
        const em = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x333333, emissive: new THREE.Color(1.0, 0.86, 0.62), emissiveIntensity: 0 });
        this.updatables.push(() => { em.emissiveIntensity = worldUniforms.uNight.value * 5; });
        m = em;
        break;
      }
      default: m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    }
    this.mats.set(key, m);
    return m;
  }

  /** Flush detail buffers, instanced sets and signs into the group. */
  flush(): void {
    const noShadow = new Set(['kerb', 'emissive']);
    for (const [k, buf] of this.detail.map) if (PROJECT_KEYS.has(k.split('|')[0])) fixDegenerateUVs(buf);
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
