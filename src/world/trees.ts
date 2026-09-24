import * as THREE from 'three';
import { injectWorldLighting, worldUniforms, type PBRSet } from './materials';
import { foliageTextures } from './vegetation/atlas';
import { bakeImpostors, impostorMaterial, impostorQuads, type BakedImpostors, type ImpostorQuad } from './vegetation/impostor';
import { patchVegetation } from './vegetation/shaders';
import { generateTree, SPECIES_VARIANTS, TRUNK_R, type SpeciesKey, type TreeModel } from './vegetation/treeGen';

export type TreeSpecies = SpeciesKey;

// start fetching the vegetation atlases as soon as the world code loads (in parallel with the other textures)
foliageTextures();

/** Legacy wind for simple cards (height-based sway; still used by some small instanced plants). */
export function windify(mat: THREE.MeshStandardMaterial, amount: number): void {
  mat.onBeforeCompile = (shader) => {
    injectWorldLighting(shader);
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.uniforms.uWind = worldUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
  #endif
  #ifdef USE_BATCHING
    ip = batchingMatrix[3].xyz;
  #endif
  float h = max(transformed.y - 2.0, 0.0);
  float ph = ip.x * 0.13 + ip.z * 0.17;
  float sway = sin(uTime * 1.3 + ph) * 0.5 + sin(uTime * 2.7 + ph * 1.7 + transformed.x) * 0.25;
  transformed.x += sway * h * ${amount.toFixed(4)} * uWind;
  transformed.z += cos(uTime * 1.1 + ph) * h * ${(amount * 0.6).toFixed(4)} * uWind;
}`);
  };
  mat.customProgramCacheKey = () => `wind_${amount}`;
}

/** BatchedMesh that runs a per-frame hook (LOD selection) before its own per-instance culling. */
class VegBatch extends THREE.BatchedMesh {
  hook: ((renderer: THREE.WebGLRenderer, camera: THREE.Camera) => void) | null = null;
  override onBeforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material, group: THREE.Group): void {
    if (scene && this.hook) this.hook(renderer, camera);
    super.onBeforeRender(renderer, scene, camera, geometry, material, group);
  }
}

interface Tree {
  sp: TreeSpecies;
  variant: number;
  vi: number; // index into the generated variant list
  pos: THREE.Vector3;
  m: THREE.Matrix4;
  sy: number;
  size: number; // LOD size factor
  tint: THREE.Color;
  idA: number; // lod0 instance
  idB: number; // lod1 instance
  fa: number; fb: number; fi: number; // last fade codes (NaN = hidden)
}

const HIDDEN = Number.NaN;

/**
 * Trees: procedurally generated species variants (see vegetation/treeGen.ts), drawn as
 *   lod0 (near)  full branches + folded leaf cards
 *   lod1 (mid)   main limbs + enlarged leaf cards
 *   impostor     baked camera-facing billboards (vegetation/impostor.ts)
 * with dithered cross-fades between levels. All trees share one bark and one leaf BatchedMesh (both LODs live in the
 * same batch, switched per instance) plus one impostor InstancedMesh → 3 draw calls + 2 shadow draws for the map.
 */
export class TreeSystem {
  private trees: Tree[] = [];
  group = new THREE.Group();
  private barkMat: THREE.MeshStandardMaterial;
  private leafMat: THREE.MeshStandardMaterial;
  private barkDepth: THREE.MeshDepthMaterial;
  private leafDepth: THREE.MeshDepthMaterial;
  private bark?: VegBatch;
  private leaves?: VegBatch;
  private imp?: THREE.InstancedMesh;
  private impMat?: THREE.MeshStandardMaterial;
  private baked: BakedImpostors | null = null;
  private variants: { sp: TreeSpecies; v: number; model: TreeModel }[] = [];
  private quads: ImpostorQuad[] = [];
  private r0 = 30;
  private r1 = 100;
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private lastFrame = -1;
  private framesSince = 0;
  private bakeFailed = false;
  /** Generation / bake timings (ms) for profiling. */
  timings: Record<string, number> = {};

  constructor(bark?: PBRSet) {
    void bark;
    const tex = foliageTextures();
    this.barkMat = new THREE.MeshStandardMaterial({ map: tex.bark, normalMap: tex.barkN, roughness: 0.93, metalness: 0, vertexColors: true });
    this.barkMat.normalScale.set(1.1, 1.1);
    patchVegetation(this.barkMat, { wind: true, fade: true, barkAtlas: true });
    this.leafMat = new THREE.MeshStandardMaterial({ map: tex.leaves, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.74, metalness: 0 });
    patchVegetation(this.leafMat, { wind: true, fade: true, leaf: true, trans: 0.3 });
    this.barkDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchVegetation(this.barkDepth, { wind: true, fade: true });
    this.leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex.leaves, alphaTest: 0.5, side: THREE.DoubleSide });
    patchVegetation(this.leafDepth, { wind: true, fade: true, leaf: true });
    // hide until the atlases arrive (an unloaded texture samples opaque black)
    this.barkMat.visible = tex.barkLoaded;
    this.leafMat.visible = tex.leavesLoaded;
    tex.ready.then(() => { this.barkMat.visible = true; this.leafMat.visible = true; });
    this.group.name = 'trees';
  }

  /** `y` lifts the tree onto a planter / terrace (default: ground). */
  add(species: TreeSpecies, x: number, z: number, scale = 1, rot = 0, y = 0): void {
    const sy = scale * (0.9 + (((x * 7.13 + z * 3.7) % 1) + 1) % 1 * 0.2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(scale, sy, scale));
    const h = (Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 43758.5453) % 1;
    const variant = Math.floor(h * SPECIES_VARIANTS[species]) % SPECIES_VARIANTS[species];
    const j1 = (Math.abs(Math.sin(x * 3.1 + z * 1.7)) * 9143.1) % 1, j2 = (Math.abs(Math.sin(x * 1.3 - z * 2.9)) * 5417.7) % 1;
    const b = 0.9 + j1 * 0.18;
    const tint = new THREE.Color(b * (0.97 + j2 * 0.06), b, b * (1.03 - j2 * 0.06));
    this.trees.push({ sp: species, variant, vi: -1, pos: new THREE.Vector3(x, y, z), m, sy, size: 1, tint, idA: -1, idB: -1, fa: HIDDEN, fb: HIDDEN, fi: HIDDEN });
  }

  count(): number { return this.trees.length; }

  trunkRadius(species: TreeSpecies, scale: number): number {
    return Math.max(0.12, TRUNK_R[species] * scale * 1.1);
  }

  /** LOD distances follow the quality profile's view distance (high 500 m → lod0 < 30 m, impostor > 100 m). */
  build(opts: { viewDistance?: number } = {}): THREE.Group {
    const vd = opts.viewDistance ?? 500;
    this.r0 = vd * 0.06;
    this.r1 = vd * 0.2;
    const t0 = performance.now();
    const index = new Map<string, number>();
    for (const t of this.trees) {
      const k = `${t.sp}:${t.variant}`;
      let vi = index.get(k);
      if (vi === undefined) {
        vi = this.variants.length;
        index.set(k, vi);
        this.variants.push({ sp: t.sp, v: t.variant, model: generateTree(t.sp, t.variant) });
      }
      t.vi = vi;
    }
    this.timings.generate = Math.round(performance.now() - t0);
    if (!this.trees.length) return this.group;
    this.quads = impostorQuads(this.variants.map((v) => ({ lod: v.model.lod0 })));

    const mkBatch = (pick: (m: TreeModel, lod: 0 | 1) => THREE.BufferGeometry, mat: THREE.Material, depth: THREE.Material, name: string) => {
      let nV = 0, nI = 0;
      for (const v of this.variants) for (const lod of [0, 1] as const) { const g = pick(v.model, lod); nV += g.attributes.position.count; nI += g.index!.count; }
      const bm = new VegBatch(this.trees.length * 2, Math.max(3, nV), Math.max(3, nI), mat);
      const ids = this.variants.map((v) => [bm.addGeometry(pick(v.model, 0)), bm.addGeometry(pick(v.model, 1))]);
      bm.customDepthMaterial = depth;
      bm.castShadow = true;
      bm.receiveShadow = true;
      bm.perObjectFrustumCulled = true;
      bm.sortObjects = false;
      bm.frustumCulled = false;
      bm.name = name;
      return { bm, ids };
    };
    const bark = mkBatch((m, l) => (l ? m.lod1.bark : m.lod0.bark), this.barkMat, this.barkDepth, 'trees:bark');
    const leaves = mkBatch((m, l) => (l ? m.lod1.leaves : m.lod0.leaves), this.leafMat, this.leafDepth, 'trees:leaves');
    this.bark = bark.bm;
    this.leaves = leaves.bm;
    const c4 = new THREE.Vector4();
    for (const t of this.trees) {
      const model = this.variants[t.vi].model;
      t.size = 0.55 + 0.45 * THREE.MathUtils.clamp((model.height * t.sy) / 10, 0.4, 1.5);
      t.pos.y += model.height * t.sy * 0.45;
      for (const [b, ids] of [[bark.bm, bark.ids], [leaves.bm, leaves.ids]] as [VegBatch, number[][]][]) {
        const a = b.addInstance(ids[t.vi][0]);
        const bb = b.addInstance(ids[t.vi][1]);
        t.idA = a; t.idB = bb;
        b.setMatrixAt(a, t.m); b.setMatrixAt(bb, t.m);
        c4.set(t.tint.r, t.tint.g, t.tint.b, 1);
        b.setColorAt(a, c4); b.setColorAt(bb, c4);
        b.setVisibleAt(a, false); b.setVisibleAt(bb, true);
      }
      t.fa = HIDDEN; t.fb = 1; t.fi = HIDDEN;
    }
    const hook = (r: THREE.WebGLRenderer, c: THREE.Camera) => this.update(r, c);
    bark.bm.hook = hook;
    leaves.bm.hook = hook;
    this.group.add(bark.bm, leaves.bm);

    // impostor billboards (material + atlas come from the first bake)
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    quad.setAttribute('aImp', new THREE.InstancedBufferAttribute(new Float32Array(this.trees.length * 4), 4));
    quad.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(this.trees.length), 1));
    this.impMat = impostorMaterial(new THREE.Texture(), new THREE.Texture());
    this.impMat.visible = false;
    const imp = new THREE.InstancedMesh(quad, this.impMat, this.trees.length);
    imp.count = 0;
    imp.frustumCulled = false;
    imp.castShadow = false;
    imp.receiveShadow = true;
    imp.name = 'trees:impostors';
    this.imp = imp;
    this.group.add(imp);
    this.timings.build = Math.round(performance.now() - t0);
    return this.group;
  }

  private bake(renderer: THREE.WebGLRenderer): void {
    const tex = foliageTextures();
    const t0 = performance.now();
    try {
      this.baked = bakeImpostors(renderer, this.variants.map((v) => ({ lod: v.model.lod0 })), tex.leaves, tex.bark);
    } catch (e) {
      console.warn('[trees] impostor bake failed; using lod1 at all distances', e);
      this.bakeFailed = true;
      return;
    }
    const mat = impostorMaterial(this.baked.albedo, this.baked.normal);
    patchVegetation(mat, { leaf: true, trans: 0.25 });
    this.impMat?.dispose();
    this.impMat = mat;
    this.imp!.material = mat;
    this.timings.bake = Math.round(performance.now() - t0);
    this.lastCam.set(1e9, 0, 0); // force a full LOD pass
  }

  /** Per-frame LOD selection (called from the batches' onBeforeRender with the rendering camera). */
  private update(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const frame = renderer.info.render.frame;
    if (frame === this.lastFrame) return;
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    this.lastFrame = frame;
    const tex = foliageTextures();
    if (!this.baked && !this.bakeFailed && tex.leavesLoaded && tex.barkLoaded) this.bake(renderer);
    const e = camera.matrixWorld.elements;
    const cx = e[12], cy = e[13], cz = e[14];
    this.framesSince++;
    const dx = cx - this.lastCam.x, dy = cy - this.lastCam.y, dz = cz - this.lastCam.z;
    if (dx * dx + dy * dy + dz * dz < 0.04 && this.framesSince < 20) return;
    this.framesSince = 0;
    this.lastCam.set(cx, cy, cz);
    const bark = this.bark!, leaves = this.leaves!, imp = this.imp!;
    const useImp = !!this.baked;
    const aImp = imp.geometry.attributes.aImp as THREE.InstancedBufferAttribute;
    const aFade = imp.geometry.attributes.aFade as THREE.InstancedBufferAttribute;
    let n = 0;
    const c4 = new THREE.Vector4();
    const setState = (b: VegBatch, id: number, prev: number, next: number, tint: THREE.Color) => {
      if (prev === next || (Number.isNaN(prev) && Number.isNaN(next))) return;
      const vis = !Number.isNaN(next);
      b.setVisibleAt(id, vis);
      if (vis) b.setColorAt(id, c4.set(tint.r, tint.g, tint.b, next));
    };
    for (const t of this.trees) {
      const d = Math.hypot(t.pos.x - cx, t.pos.y - cy, t.pos.z - cz);
      const r0 = this.r0 * t.size, r1 = this.r1 * t.size;
      const b0 = r0 * 0.1, b1 = r1 * 0.08;
      const t0 = THREE.MathUtils.clamp((d - (r0 - b0 * 0.5)) / b0, 0, 1);
      const t1 = useImp ? THREE.MathUtils.clamp((d - (r1 - b1 * 0.5)) / b1, 0, 1) : 0;
      const fa = t0 < 1 ? 1 - t0 : HIDDEN;
      let fb: number;
      if (t0 <= 0 || t1 >= 1) fb = HIDDEN;
      else if (t0 < 1) fb = -1 - (1 - t0); // complement of lod0
      else fb = t1 > 0 ? 1 - t1 : 1;
      const fi = t1 > 0 ? -1 - (1 - t1) : HIDDEN; // complement of lod1
      const fq = (x: number) => (Number.isNaN(x) ? x : Math.round(x * 64) / 64);
      const qa = fq(fa), qb = fq(fb);
      setState(bark, t.idA, t.fa, qa, t.tint); setState(leaves, t.idA, t.fa, qa, t.tint);
      setState(bark, t.idB, t.fb, qb, t.tint); setState(leaves, t.idB, t.fb, qb, t.tint);
      t.fa = qa; t.fb = qb;
      if (!Number.isNaN(fi)) {
        const q = this.quads[t.vi];
        imp.setMatrixAt(n, t.m);
        aImp.setXYZW(n, q.w, q.h, q.y0, t.vi);
        aFade.setX(n, fi);
        n++;
      }
      t.fi = fi;
    }
    imp.count = n;
    imp.instanceMatrix.needsUpdate = true;
    aImp.needsUpdate = true;
    aFade.needsUpdate = true;
    if (this.impMat) this.impMat.visible = useImp && n > 0;
  }
}
