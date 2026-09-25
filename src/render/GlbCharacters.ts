import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Assets } from '../core/Assets';
import type { QualityProfile } from '../core/Settings';
import { type Actor, type AnimHints, type Look, type Survivor, type Zombie, CORPSE_FADE_DUR, CORPSE_FADE_START } from '../sim/actors';
import { GRENADE, type WeaponId } from '../sim/weapons';
import type { WeaponModels } from './Characters';
import { grenadeAssets } from './Grenades';

/**
 * Characters from GLB assets (Quaternius CC0 bodies retargeted to the contract in docs/ARCHITECTURE.md).
 * Material slots are merged into ONE skinned mesh with per-vertex colours → one draw call per character,
 * recoloured per variant (students, guard, zombies) with cached colour attributes.
 */
export type Region = 'skin' | 'hair' | 'shirt' | 'pants' | 'shoes' | 'accessory' | 'eyes' | 'other';
const REGIONS: Region[] = ['skin', 'hair', 'shirt', 'pants', 'shoes', 'accessory', 'eyes', 'other'];

const UPPER_HINTS = ['spine', 'neck', 'head', 'shoulder', 'arm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky', 'finger', 'clavicle', 'weapon'];
const LOWER_HINTS = ['hips', 'pelvis', 'upleg', 'thigh', 'leg', 'calf', 'foot', 'toe', 'root'];

function regionOf(name: string): Region {
  const n = name.toLowerCase();
  for (const r of REGIONS) if (n.includes(r)) return r;
  if (n.includes('body') || n.includes('face')) return 'skin';
  if (n.includes('top') || n.includes('torso') || n.includes('cloth')) return 'shirt';
  if (n.includes('leg') || n.includes('trouser') || n.includes('jean')) return 'pants';
  if (n.includes('boot') || n.includes('sole')) return 'shoes';
  return 'other';
}

function isUpperBone(bone: string): boolean {
  const b = bone.toLowerCase();
  if (LOWER_HINTS.some((h) => b.includes(h)) && !b.includes('arm') && !b.includes('hand')) {
    // 'LeftUpLeg' etc. — but 'forearm' contains 'arm', handled above
    return false;
  }
  return UPPER_HINTS.some((h) => b.includes(h));
}

interface Template {
  gltf: GLTF;
  material: THREE.MeshStandardMaterial;
  textured: Set<Region>;
  texAvg: Partial<Record<Region, THREE.Color>>;
  baseGeometry: THREE.BufferGeometry; // merged, without colour
  regionIndex: Uint8Array;
  defaultColors: Record<Region, THREE.Color>;
  clips: Map<string, THREE.AnimationClip>;
  upper: Map<string, THREE.AnimationClip>;
  lower: Map<string, THREE.AnimationClip>;
  height: number;
  /** natural (planted-foot) speed of each locomotion clip in template units (m/s), measured at load */
  natural: Map<string, number>;
}

export class GlbCharacterLibrary {
  private templates = new Map<string, Template>();
  private variantCache = new Map<string, THREE.BufferGeometry>();
  ready = false;

  async load(assets: Assets): Promise<boolean> {
    const base = `${import.meta.env.BASE_URL}models/characters/`;
    const files: [string, string][] = [['male', 'male.glb'], ['female', 'female.glb'], ['male_lod', 'male_lod.glb'], ['female_lod', 'female_lod.glb']];
    const results = await Promise.all(files.map(async ([k, f]) => [k, await assets.gltf(base + f)] as const));
    for (const [k, g] of results) if (g) this.templates.set(k, this.prepare(g));
    // LOD bodies ship without animation (same skeleton and bone names as the full bodies): share the full bodies'
    // clips, so zombies (which use the LOD bodies) animate instead of standing in the rest pose
    for (const [k, t] of this.templates) {
      const full = k.endsWith('_lod') ? this.templates.get(k.replace('_lod', '')) : undefined;
      if (full && !t.clips.size) { t.clips = full.clips; t.upper = full.upper; t.lower = full.lower; }
    }
    for (const k of this.templates.keys()) if (!k.endsWith('_lod')) this.measureNatural(k);
    for (const [k, t] of this.templates) if (k.endsWith('_lod') && !t.natural.size) t.natural = this.templates.get(k.replace('_lod', ''))?.natural ?? t.natural;
    this.ready = this.templates.has('male') && this.templates.has('female');
    if (this.ready) {
      const t = this.templates.get('male')!;
      console.log(`[characters] GLB bodies ready — clips: ${[...t.clips.keys()].join(', ')}`);
    }
    return this.ready;
  }

  /**
   * Merge all primitives into one skinned geometry. Textured slots (face/skin, hair, eyes) are packed into a
   * runtime texture atlas; untextured slots (clothes) sample a white texel and are coloured per vertex.
   */
  private prepare(gltf: GLTF): Template {
    const skinned: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
    // ---- atlas packing (shelf) of all distinct base-colour textures
    const texImages = new Map<THREE.Texture, { img: CanvasImageSource; w: number; h: number; x: number; y: number }>();
    for (const m of skinned) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        const tex = mat?.map;
        if (tex && tex.image && !texImages.has(tex)) {
          const img = tex.image as HTMLImageElement | ImageBitmap;
          texImages.set(tex, { img, w: (img as HTMLImageElement).naturalWidth || img.width, h: (img as HTMLImageElement).naturalHeight || img.height, x: 0, y: 0 });
        }
      }
    }
    const entries = [...texImages.values()].sort((a, b) => b.h - a.h);
    const AW = Math.max(1024, ...entries.map((e) => e.w));
    let x = 0, y = 0, shelf = 0;
    for (const e of entries) {
      if (x + e.w > AW) { x = 0; y += shelf; shelf = 0; }
      e.x = x; e.y = y; x += e.w; shelf = Math.max(shelf, e.h);
    }
    // white patch for untextured regions
    if (x + 16 > AW) { x = 0; y += shelf; shelf = 0; }
    const white = { x, y, w: 16, h: 16 };
    shelf = Math.max(shelf, 16);
    const AH = THREE.MathUtils.ceilPowerOfTwo(Math.max(16, y + shelf));
    const canvas = document.createElement('canvas');
    canvas.width = AW; canvas.height = AH;
    const g2 = canvas.getContext('2d', { willReadFrequently: true })!;
    g2.fillStyle = '#ffffff';
    g2.fillRect(0, 0, AW, AH);
    for (const e of entries) g2.drawImage(e.img, e.x, e.y, e.w, e.h);
    const atlas = new THREE.CanvasTexture(canvas);
    atlas.flipY = false; // glTF UV convention
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    const material = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.7, metalness: 0 });

    const parts: THREE.BufferGeometry[] = [];
    const regions: number[] = [];
    const defaults = {} as Record<Region, THREE.Color>;
    for (const r of REGIONS) defaults[r] = new THREE.Color(0x888888);
    const textured = new Set<Region>();
    const texAvg: Partial<Record<Region, THREE.Color>> = {};
    for (const m of skinned) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) {
        const mat = mats[gr.materialIndex ?? 0] as THREE.MeshStandardMaterial;
        const reg = regionOf(mat?.name || m.name);
        if (mat?.color) defaults[reg] = mat.color.clone();
        const sub = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
          const a = geo.getAttribute(name) as THREE.BufferAttribute;
          if (!a) continue;
          const arr = (a.array as ArrayLike<number>);
          const size = a.itemSize;
          const Ctor = (a.array as unknown as { constructor: new (n: number) => Float32Array }).constructor;
          const out = new Ctor(gr.count * size);
          for (let i = 0; i < gr.count * size; i++) out[i] = arr[gr.start * size + i];
          sub.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized));
        }
        if (!sub.getAttribute('normal')) sub.computeVertexNormals();
        // UVs remapped into the atlas
        const uvSrc = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
        const uv = new Float32Array(gr.count * 2);
        const ent = mat?.map ? texImages.get(mat.map) : undefined;
        for (let i = 0; i < gr.count; i++) {
          if (ent && uvSrc) {
            let u = uvSrc.getX(gr.start + i), v = uvSrc.getY(gr.start + i);
            u = u - Math.floor(u); v = v - Math.floor(v);
            uv[i * 2] = (ent.x + u * ent.w) / AW;
            uv[i * 2 + 1] = (ent.y + v * ent.h) / AH;
          } else {
            uv[i * 2] = (white.x + 8) / AW;
            uv[i * 2 + 1] = (white.y + 8) / AH;
          }
        }
        sub.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        if (ent) {
          textured.add(reg);
          if (!texAvg[reg]) {
            const step = Math.max(1, Math.floor(Math.min(ent.w, ent.h) / 64));
            const data = g2.getImageData(ent.x, ent.y, ent.w, ent.h).data;
            let r = 0, gg = 0, b = 0, n = 0;
            for (let yy = 0; yy < ent.h; yy += step) for (let xx = 0; xx < ent.w; xx += step) {
              const k = (yy * ent.w + xx) * 4;
              if (data[k + 3] < 128) continue;
              r += data[k]; gg += data[k + 1]; b += data[k + 2]; n++;
            }
            texAvg[reg] = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace).multiply(mat.color ?? new THREE.Color(1, 1, 1));
          }
        }
        // normalise skin attributes to fixed types for merging
        const si = sub.getAttribute('skinIndex') as THREE.BufferAttribute;
        if (si && !(si.array instanceof Uint16Array)) sub.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(si.array as ArrayLike<number>), 4));
        const sw = sub.getAttribute('skinWeight') as THREE.BufferAttribute;
        if (sw && !(sw.array instanceof Float32Array)) {
          const f = new Float32Array(sw.count * 4);
          for (let i = 0; i < sw.count; i++) for (let c = 0; c < 4; c++) f[i * 4 + c] = sw.getComponent(i, c);
          sub.setAttribute('skinWeight', new THREE.BufferAttribute(f, 4));
        }
        parts.push(sub);
        for (let i = 0; i < gr.count; i++) regions.push(REGIONS.indexOf(reg));
      }
      m.visible = false;
    }
    const merged = mergeGeometries(parts, false)!;
    merged.computeBoundingBox();
    const height = merged.boundingBox!.max.y - merged.boundingBox!.min.y;
    merged.computeBoundingSphere();
    const clips = new Map<string, THREE.AnimationClip>();
    const upper = new Map<string, THREE.AnimationClip>();
    const lower = new Map<string, THREE.AnimationClip>();
    for (const c of gltf.animations) {
      clips.set(c.name, c);
      const up = c.tracks.filter((t) => isUpperBone(t.name.split('.')[0]));
      const lo = c.tracks.filter((t) => !isUpperBone(t.name.split('.')[0]));
      upper.set(c.name, new THREE.AnimationClip(c.name + '_upper', c.duration, up));
      lower.set(c.name, new THREE.AnimationClip(c.name + '_lower', c.duration, lo));
    }
    return { gltf, material, textured, texAvg, baseGeometry: merged, regionIndex: Uint8Array.from(regions), defaultColors: defaults, clips, upper, lower, height, natural: new Map() };
  }

  has(key: string): boolean { return this.templates.has(key); }

  /** Geometry sharing all attributes with the template except a per-variant colour attribute. */
  variant(key: string, colors: Partial<Record<Region, THREE.Color>>, zombieSeed = -1): THREE.BufferGeometry {
    const t = this.templates.get(key)!;
    const ck = `${key}|${REGIONS.map((r) => colors[r]?.getHexString() ?? '-').join(',')}|${zombieSeed}`;
    let g = this.variantCache.get(ck);
    if (g) return g;
    g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(t.baseGeometry.attributes)) g.setAttribute(name, attr);
    g.boundingBox = t.baseGeometry.boundingBox;
    g.boundingSphere = t.baseGeometry.boundingSphere!.clone();
    g.boundingSphere.radius *= 1.6;
    const n = t.regionIndex.length;
    const col = new Float32Array(n * 3);
    const pos = t.baseGeometry.getAttribute('position') as THREE.BufferAttribute;
    const c = new THREE.Color();
    // per-region vertex colour: plain colour for untextured slots, tint multiplier for textured ones
    const regionColor = new Map<Region, THREE.Color>();
    for (const r of REGIONS) {
      const want = colors[r];
      if (t.textured.has(r)) {
        const avg = t.texAvg[r];
        const base = t.defaultColors[r];
        if (want && avg && r !== 'eyes') {
          const k = (a: number, b: number) => THREE.MathUtils.clamp(a / Math.max(0.02, b), 0.35, 2.2);
          regionColor.set(r, new THREE.Color(k(want.r, avg.r), k(want.g, avg.g), k(want.b, avg.b)).multiply(base));
        } else if (want && r === 'eyes' && zombieSeed >= 0) regionColor.set(r, want.clone());
        else regionColor.set(r, base.clone());
      } else regionColor.set(r, (want ?? t.defaultColors[r]).clone());
    }
    for (let i = 0; i < n; i++) {
      const r = REGIONS[t.regionIndex[i]];
      c.copy(regionColor.get(r)!);
      if (zombieSeed >= 0) {
        // blood + grime blotches
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const nse = Math.sin(x * 21 + zombieSeed) * Math.cos(y * 15 + zombieSeed * 0.37) * Math.sin(z * 17 + zombieSeed * 0.11);
        if (nse > 0.5 && r !== 'eyes') c.lerp(_blood, 0.8);
        else if (nse < -0.62) c.multiplyScalar(0.55);
      }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.variantCache.set(ck, g);
    return g;
  }

  /**
   * Measure how fast each locomotion clip's planted foot slides backwards (= the body speed at which the clip
   * plays without foot sliding). Samples the toe bones through one cycle; frames within 3 cm of the lowest point
   * count as planted. Done at load so re-exported clips stay in sync automatically.
   */
  private measureNatural(key: string): void {
    const t = this.templates.get(key)!;
    const inst = this.instantiate(key, t.baseGeometry);
    const lf = inst.bones.get('LeftToeBase') ?? inst.bones.get('LeftFoot');
    const rf = inst.bones.get('RightToeBase') ?? inst.bones.get('RightFoot');
    if (!lf || !rf) return;
    const mixer = new THREE.AnimationMixer(inst.root);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const name of ['Walk', 'Run', 'RifleWalk', 'RifleRun', 'RifleWalkBack', 'RifleStrafeLeft', 'RifleStrafeRight', 'PistolWalk', 'ZombieWalk', 'ZombieRun']) {
      const clip = t.clips.get(name);
      if (!clip) continue;
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      const N = 90, dt = clip.duration / N;
      const sm: number[][] = [];
      for (let i = 0; i <= N; i++) {
        mixer.setTime(dt * i);
        inst.root.updateMatrixWorld(true);
        lf.getWorldPosition(a); rf.getWorldPosition(b);
        sm.push([a.x, a.y, a.z, b.x, b.y, b.z]);
      }
      const sp: number[] = [];
      for (const o of [0, 3]) {
        let minY = Infinity;
        for (const v of sm) minY = Math.min(minY, v[o + 1]);
        for (let i = 1; i < sm.length; i++) {
          if (sm[i - 1][o + 1] < minY + 0.03 && sm[i][o + 1] < minY + 0.03) sp.push(Math.hypot(sm[i][o] - sm[i - 1][o], sm[i][o + 2] - sm[i - 1][o + 2]) / dt);
        }
      }
      if (sp.length >= 4) { sp.sort((x, y) => x - y); t.natural.set(name, sp[sp.length >> 1]); }
    }
    mixer.stopAllAction();
  }

  instantiate(key: string, geometry: THREE.BufferGeometry): { root: THREE.Object3D; mesh: THREE.SkinnedMesh; bones: Map<string, THREE.Bone>; template: Template } {
    const t = this.templates.get(key)!;
    const root = SkeletonUtils.clone(t.gltf.scene) as THREE.Object3D;
    let src: THREE.SkinnedMesh | null = null;
    const toRemove: THREE.Object3D[] = [];
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) { if (!src) src = o as THREE.SkinnedMesh; toRemove.push(o); }
      else if ((o as THREE.Mesh).isMesh) toRemove.push(o);
    });
    const s = src as unknown as THREE.SkinnedMesh;
    const mesh = new THREE.SkinnedMesh(geometry, t.material);
    mesh.bind(s.skeleton, s.bindMatrix);
    s.parent!.add(mesh);
    mesh.position.copy(s.position); mesh.quaternion.copy(s.quaternion); mesh.scale.copy(s.scale);
    for (const o of toRemove) o.removeFromParent();
    mesh.frustumCulled = true;
    const bones = new Map<string, THREE.Bone>();
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
    return { root, mesh, bones, template: t };
  }
}

const _blood = new THREE.Color(0.3, 0.02, 0.02);
const _v = new THREE.Vector3();

type Loco = 'Idle' | 'Walk' | 'Run' | 'RifleIdle' | 'RifleWalk' | 'RifleRun' | 'RifleWalkBack' | 'RifleStrafeLeft' | 'RifleStrafeRight' | 'PistolIdle' | 'PistolWalk';

/** One animated character driven by the sim's AnimHints. */
export class GlbCharacterView {
  root = new THREE.Group();
  private model: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  private mixer: THREE.AnimationMixer;
  private bones: Map<string, THREE.Bone>;
  private full = new Map<string, THREE.AnimationAction>();
  private up = new Map<string, THREE.AnimationAction>();
  private lo = new Map<string, THREE.AnimationAction>();
  private weights = new Map<THREE.AnimationAction, number>();
  private weapon: THREE.Object3D | null = null;
  private weaponId: WeaponId | null = null;
  muzzle: THREE.Object3D | null = null;
  private socket: THREE.Object3D | null = null;
  private frame = 0;
  private lastFireT = 99;
  private lastAttackP = -1;
  private deathPlayed = false;
  private deadMat: THREE.Material | null = null;
  private natural: Map<string, number>;
  private speedS = 0;
  private aimS = 0;
  private spine: THREE.Bone[] = [];
  /** grenade throw overlay (left arm) and the grenade shown in the left hand until it is let go */
  private throwBones: { spine: THREE.Bone; arm: THREE.Bone; fore: THREE.Bone; hand: THREE.Bone } | null = null;
  private handNade: THREE.Mesh | null = null;

  constructor(public actor: Actor, lib: GlbCharacterLibrary, key: string, geometry: THREE.BufferGeometry, private weapons: WeaponModels | null, private scaleToHeight: number) {
    const inst = lib.instantiate(key, geometry);
    this.model = inst.root;
    this.mesh = inst.mesh;
    this.bones = inst.bones;
    const h = inst.template.height || 1.75;
    this.model.scale.setScalar((scaleToHeight / h) * actor.scale);
    this.root.add(this.model);
    this.natural = inst.template.natural;
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of inst.template.clips) this.full.set(name, this.mixer.clipAction(clip));
    for (const [name, clip] of inst.template.upper) this.up.set(name, this.mixer.clipAction(clip));
    for (const [name, clip] of inst.template.lower) this.lo.set(name, this.mixer.clipAction(clip));
    const findBone = (...names: string[]) => { for (const n of names) { const b = this.bones.get(n); if (b) return b; } return undefined; };
    this.socket = findBone('RightHandWeapon', 'RightHand', 'hand_r', 'Hand_R') ?? null;
    for (const n of ['Spine1', 'Spine2', 'spine_02', 'spine_03']) { const b = this.bones.get(n); if (b) this.spine.push(b); }
    const sp2 = this.bones.get('Spine2'), la = this.bones.get('LeftArm'), lf = this.bones.get('LeftForeArm'), lh = this.bones.get('LeftHand');
    if (sp2 && la && lf && lh) this.throwBones = { spine: sp2, arm: la, fore: lf, hand: lh };
    this.mesh.castShadow = true;
  }

  /** Natural clip speed in world m/s (measured foot speed × this model's scale). */
  private nat(name: string, fallback: number): number {
    const v = this.natural.get(name) ?? this.natural.get(fallbackLoco(name as Loco));
    return v ? v * this.model.scale.x : fallback;
  }

  private setWeight(a: THREE.AnimationAction | undefined, w: number, dt: number, rate = 10): void {
    if (!a) return;
    const cur = this.weights.get(a) ?? 0;
    const nw = cur + (w - cur) * Math.min(1, dt * rate);
    this.weights.set(a, nw);
    if (nw > 0.001) {
      if (!a.isRunning()) { a.enabled = true; a.play(); }
      a.setEffectiveWeight(nw);
    } else if (a.isRunning()) a.stop();
  }

  private oneShot(a: THREE.AnimationAction | undefined, clamp = false): void {
    if (!a) return;
    a.reset();
    a.setLoop(clamp ? THREE.LoopOnce : THREE.LoopOnce, 1);
    a.clampWhenFinished = clamp;
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
  }

  setWeapon(id: WeaponId | null): void {
    if (id === this.weaponId) return;
    this.weapon?.removeFromParent();
    this.weapon = null;
    this.muzzle = null;
    this.weaponId = id;
    if (!id || !this.weapons || !this.socket) return;
    const w = this.weapons.create(id);
    // undo the model scale so the weapon keeps real size
    const s = 1 / this.model.scale.x;
    w.scale.setScalar(s);
    WEAPON_GRIP[id](w);
    this.socket.add(w);
    this.weapon = w;
    this.muzzle = this.weapons.muzzleOf(w);
  }

  update(dt: number, alpha: number, camPos: THREE.Vector3, q: QualityProfile): void {
    const a = this.actor;
    this.root.position.lerpVectors(a.prev, a.pos, alpha);
    let dy = a.yaw - a.prevYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.set(0, a.prevYaw + dy * alpha + Math.PI, 0);
    const dist = _v.copy(this.root.position).distanceTo(camPos);
    this.mesh.castShadow = dist < q.characterShadowDistance;
    const lod = dist < q.animLodNear ? 1 : dist < q.animLodNear * 2 ? 2 : 4;
    this.frame++;
    if (this.frame % lod !== 0 && !a.anim.dead) return;
    const step = dt * lod;
    if (a.kind === 'zombie') this.animZombie(a as Zombie, step);
    else this.animSurvivor(a as Survivor, step);
    this.mixer.update(step);
    if (a.kind !== 'zombie' && !a.anim.dead && !a.anim.downed) {
      // procedural aim pitch on the spine (after the mixer)
      const pitch = a.anim.aimPitch * this.aimS;
      for (const b of this.spine) b.rotateX(-pitch * 0.5);
    }
    if (a.kind !== 'zombie') this.throwPose(a.anim.dead || a.anim.downed ? -1 : a.anim.throwP);
  }

  /**
   * Overhand grenade throw with the left arm, layered on whatever the mixer posed (the right hand keeps the weapon):
   * cocked with the hand behind the head, whipped forward at GRENADE.releaseAt, follow-through, then blended out.
   * Bone directions are set in the character frame (+Z forward, +X its left, +Y up), so no rig axis conventions leak in.
   */
  private throwPose(tp: number): void {
    const tb = this.throwBones;
    if (!tb) return;
    const holding = tp >= 0.03 && tp < GRENADE.releaseAt;
    if (holding && !this.handNade) {
      const { geometry, material } = grenadeAssets();
      this.handNade = new THREE.Mesh(geometry, material);
      this.handNade.castShadow = true;
      tb.hand.add(this.handNade);
      tb.hand.getWorldScale(_ts);
      const k = 1 / (_ts.x || 1);
      this.handNade.scale.setScalar(k);
      // the hand bone points toward the fingers: sit the grenade in the palm, a little out from the wrist
      const child = tb.hand.children.find((c) => (c as THREE.Bone).isBone);
      if (child) this.handNade.position.copy(child.position).multiplyScalar(0.6);
      else this.handNade.position.set(0, 0.07 * k, 0);
    }
    if (this.handNade) this.handNade.visible = holding;
    if (tp < 0) return;
    const w = THREE.MathUtils.smoothstep(tp, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(tp, 0.6, 1));
    if (w < 0.002) return;
    const r = GRENADE.releaseAt;
    // keys: cocked (0..0.28) → release (r) → follow-through (0.62)
    const a = THREE.MathUtils.smoothstep(tp, 0.28, r), b = THREE.MathUtils.smoothstep(tp, r, 0.62);
    const twist = 0.5 * (1 - a) - 0.25 * a * (1 - b) - 0.35 * b;
    _tUp.set(0.62, 0.12, -0.78).lerp(_tUpRel, a).lerp(_tUpFol, b).normalize();
    _tFo.set(-0.08, 0.96, 0.25).lerp(_tFoRel, a).lerp(_tFoFol, b).normalize();
    this.root.getWorldQuaternion(_tRoot);
    // torso: the left shoulder winds back, then drives through
    tb.spine.parent!.getWorldQuaternion(_tPq);
    _tDq.setFromAxisAngle(_tY, twist * w);
    tb.spine.quaternion.premultiply(_tInv.copy(_tPq).invert().multiply(_tDq).multiply(_tPq));
    aimBone(tb.arm, tb.fore, _tUp.applyQuaternion(_tRoot), w);
    aimBone(tb.fore, tb.hand, _tFo.applyQuaternion(_tRoot), w);
  }

  private animZombie(z: Zombie, dt: number): void {
    const an = z.anim;
    this.speedS += (an.speed - this.speedS) * Math.min(1, dt * 8);
    if (an.dead) {
      if (!this.deathPlayed) {
        this.deathPlayed = true;
        this.mixer.stopAllAction();
        this.weights.clear();
        this.oneShot(this.full.get(an.deathVariant ? 'ZombieDeathForward' : 'ZombieDeath') ?? this.full.get('Death'), true);
        // every view of a body shares one template material: fade a private copy
        this.deadMat = (this.mesh.material as THREE.Material).clone();
        this.deadMat.transparent = true;
        this.mesh.material = this.deadMat;
      }
      const f = THREE.MathUtils.clamp((an.deadT - CORPSE_FADE_START) / CORPSE_FADE_DUR, 0, 1);
      if (f > 0 && this.deadMat) { this.deadMat.opacity = 1 - f; this.deadMat.depthWrite = false; this.mesh.castShadow = false; }
      return;
    }
    if (an.attackP >= 0 && this.lastAttackP < 0) this.oneShot(this.full.get('ZombieAttack'));
    this.lastAttackP = an.attackP;
    const attacking = an.attackP >= 0;
    const crawl = z.type === 'crawler';
    const runner = z.type === 'runner';
    const moving = this.speedS > 0.25;
    this.setWeight(this.full.get('ZombieCrawl'), crawl ? 1 : 0, dt);
    this.setWeight(this.full.get('ZombieIdle'), !crawl && !moving && !attacking ? 1 : 0, dt);
    this.setWeight(this.full.get('ZombieWalk'), !crawl && moving && !runner && !attacking ? 1 : 0, dt);
    this.setWeight(this.full.get('ZombieRun'), !crawl && moving && runner && !attacking ? 1 : 0, dt);
    const walk = this.full.get('ZombieWalk');
    if (walk) walk.timeScale = THREE.MathUtils.clamp(this.speedS / this.nat('ZombieWalk', ZOMBIE_WALK_SPEED), 0.5, 2.2);
    const run = this.full.get('ZombieRun');
    if (run) run.timeScale = THREE.MathUtils.clamp(this.speedS / this.nat('ZombieRun', ZOMBIE_RUN_SPEED), 0.6, 1.8);
  }

  private animSurvivor(s: Survivor, dt: number): void {
    const an = s.anim;
    this.setWeapon(an.dead ? null : an.weapon);
    this.speedS += (an.speed - this.speedS) * Math.min(1, dt * 10);
    this.aimS += ((an.aiming ? 1 : 0) - this.aimS) * Math.min(1, dt * 12);
    if (an.dead) {
      if (!this.deathPlayed) { this.deathPlayed = true; this.mixer.stopAllAction(); this.weights.clear(); this.oneShot(this.full.get('Death'), true); }
      return;
    }
    this.deathPlayed = false;
    const special = an.downed ? 'Downed' : an.reviving ? 'Revive' : null;
    if (special) {
      for (const act of [...this.up.values(), ...this.lo.values()]) this.setWeight(act, 0, dt, 20);
      for (const [n, act] of this.full) this.setWeight(act, n === special ? 1 : 0, dt, 8);
      return;
    }
    for (const n of ['Downed', 'Revive', 'Death']) this.setWeight(this.full.get(n), 0, dt, 12);
    const w = an.weapon;
    const kind: 'rifle' | 'pistol' | 'bat' | 'none' = w === 'pistol' ? 'pistol' : w === 'bat' ? 'bat' : w ? 'rifle' : 'none';
    // ---- lower body locomotion blend
    const sp = this.speedS;
    const moving = sp > 0.3;
    const lz = an.localZ, lx = an.localX;
    // walk ↔ run crossfade by speed: the walk can be sped up to ~2×, the run slowed to ~0.55×, and the blend
    // happens between those two speeds so the planted feet always travel at the body's speed (no sliding)
    const walkNat = this.nat('Walk', 1.4), runNat = this.nat('Run', 4.5);
    const wr = THREE.MathUtils.smoothstep(sp, walkNat * 1.9, runNat * 0.6);
    const running = wr > 0.5;
    const target = new Map<Loco, number>();
    if (!moving) target.set(kind === 'rifle' ? 'RifleIdle' : kind === 'pistol' ? 'PistolIdle' : 'Idle', 1);
    else if (an.aiming || kind === 'rifle') {
      const f = Math.max(0, lz), b = Math.max(0, -lz), l = Math.max(0, -lx), r = Math.max(0, lx);
      const sum = f + b + l + r || 1;
      target.set('RifleWalk', (f / sum) * (1 - wr));
      target.set('RifleRun', (f / sum) * wr);
      target.set('RifleWalkBack', b / sum);
      target.set('RifleStrafeLeft', l / sum);
      target.set('RifleStrafeRight', r / sum);
    } else {
      target.set(kind === 'pistol' ? 'PistolWalk' : 'Walk', 1 - wr);
      target.set('Run', wr);
    }
    const LOCOS: Loco[] = ['Idle', 'Walk', 'Run', 'RifleIdle', 'RifleWalk', 'RifleRun', 'RifleWalkBack', 'RifleStrafeLeft', 'RifleStrafeRight', 'PistolIdle', 'PistolWalk'];
    for (const n of LOCOS) {
      const act = this.lo.get(n) ?? this.lo.get(fallbackLoco(n));
      this.setWeight(act, target.get(n) ?? 0, dt);
      if (!act) continue;
      const isRun = n === 'Run' || n === 'RifleRun';
      act.timeScale = moving ? THREE.MathUtils.clamp(sp / this.nat(n, LOCO_SPEED[n] ?? 1.4), isRun ? 0.5 : 0.6, isRun ? 1.6 : 2.2) : 1;
    }
    // ---- upper body
    let upName: string;
    if (kind === 'rifle') upName = an.reloading ? 'RifleReload' : running && !an.aiming ? 'RifleRun' : 'RifleIdle';
    else if (kind === 'pistol') upName = an.reloading ? 'PistolReload' : 'PistolIdle';
    else if (kind === 'bat') upName = an.meleeP >= 0 ? 'BatSwing' : 'BatIdle';
    else upName = moving ? (running ? 'Run' : 'Walk') : 'Idle';
    for (const [n, act] of this.up) this.setWeight(act, n === upName ? 1 : 0, dt, 14);
    if (kind === 'bat' && an.meleeP >= 0 && an.meleeP < 0.05) this.oneShot(this.up.get('BatSwing'));
    if (an.reloading && an.reloadP < 0.03) this.oneShot(this.up.get(kind === 'pistol' ? 'PistolReload' : 'RifleReload'));
    if (an.fireT < this.lastFireT && an.fireT < 0.05) {
      const fire = this.up.get(kind === 'pistol' ? 'PistolFire' : 'RifleFire');
      if (fire) { this.oneShot(fire); fire.setEffectiveWeight(0.8); }
    }
    this.lastFireT = an.fireT;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    this.deadMat?.dispose();
  }
}

const _ts = new THREE.Vector3();
const _tUp = new THREE.Vector3();
const _tFo = new THREE.Vector3();
const _tUpRel = new THREE.Vector3(0.22, 0.78, 0.58);
const _tUpFol = new THREE.Vector3(0.12, -0.3, 0.95);
const _tFoRel = new THREE.Vector3(0.0, 0.55, 0.84);
const _tFoFol = new THREE.Vector3(-0.2, -0.45, 0.87);
const _tY = new THREE.Vector3(0, 1, 0);
const _tRoot = new THREE.Quaternion();
const _tPq = new THREE.Quaternion();
const _tDq = new THREE.Quaternion();
const _tInv = new THREE.Quaternion();
const _tBq = new THREE.Quaternion();
const _tAim = new THREE.Quaternion();
const _tAlong = new THREE.Vector3();

/** Turn bone `b` (weight w) so the direction to its child `child` points along `dir` (world space, unit length). */
function aimBone(b: THREE.Bone, child: THREE.Object3D, dir: THREE.Vector3, w: number): void {
  b.parent!.getWorldQuaternion(_tPq);
  _tBq.copy(_tPq).multiply(b.quaternion);
  _tAlong.copy(child.position).normalize().applyQuaternion(_tBq);
  _tAim.setFromUnitVectors(_tAlong, dir).multiply(_tBq);
  _tAim.premultiply(_tPq.invert());
  b.quaternion.slerp(_tAim, w);
}

function fallbackLoco(n: Loco): Loco {
  switch (n) {
    case 'RifleIdle': case 'PistolIdle': return 'Idle';
    case 'RifleWalk': case 'RifleWalkBack': case 'RifleStrafeLeft': case 'RifleStrafeRight': case 'PistolWalk': return 'Walk';
    case 'RifleRun': return 'Run';
    default: return n;
  }
}

/** Fallback clip speeds (m/s) if a clip's foot speed can't be measured at load (see measureNatural). */
export const LOCO_SPEED: Partial<Record<Loco, number>> = { Walk: 1.4, Run: 4.5, RifleWalk: 1.5, RifleRun: 4.2, RifleWalkBack: 1.2, RifleStrafeLeft: 1.3, RifleStrafeRight: 1.3, PistolWalk: 1.4 };
export const ZOMBIE_WALK_SPEED = 0.9;
export const ZOMBIE_RUN_SPEED = 4.8;

/** Grip transforms for weapons parented to the hand socket (tuned per rig). */
export const WEAPON_GRIP: Record<WeaponId, (w: THREE.Object3D) => void> = {
  pistol: (w) => { w.position.set(0, 0, 0); w.rotation.set(0, 0, 0); },
  smg: (w) => { w.position.set(0, 0, 0); w.rotation.set(0, 0, 0); },
  rifle: (w) => { w.position.set(0, 0, 0); w.rotation.set(0, 0, 0); },
  shotgun: (w) => { w.position.set(0, 0, 0); w.rotation.set(0, 0, 0); },
  bat: (w) => { w.position.set(0, 0, 0); w.rotation.set(0, 0, 0); },
};

export function lookColors(look: Look, zombie: boolean): Partial<Record<Region, THREE.Color>> {
  const c = (h: string) => new THREE.Color(h);
  const out: Partial<Record<Region, THREE.Color>> = { skin: c(look.skin), hair: c(look.hair), shirt: c(look.shirt), pants: c(look.pants), shoes: c(look.shoes), eyes: c('#1a1410') };
  if (look.accessory) out.accessory = c(look.accessory);
  if (zombie) {
    const decay = [c('#8d9a82'), c('#9aa38c'), c('#7f8c78'), c('#a39e8a'), c('#86917f')][look.seed % 5];
    out.skin = out.skin!.clone().lerp(decay, 0.72);
    out.shirt = out.shirt!.clone().lerp(c('#6b6558'), 0.35).multiplyScalar(0.8);
    out.pants = out.pants!.clone().multiplyScalar(0.75);
    out.eyes = c('#d8d060');
  }
  return out;
}

export type { AnimHints };
