import * as THREE from 'three';

/**
 * Procedural low-poly humanoid as a single SkinnedMesh (rigid-skinned capsules), with bone names that
 * match the Blender character contract, so it can be swapped for the GLB characters transparently.
 * Faces +Z in its local space (like the glTF contract).
 */
export const BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
] as const;
export type BoneName = (typeof BONES)[number];

export interface BodyColors {
  skin: THREE.Color; hair: THREE.Color; shirt: THREE.Color; pants: THREE.Color; shoes: THREE.Color;
  accessory?: THREE.Color; zombie?: boolean; seed: number; female?: boolean; cap?: boolean; sleeves?: 'short' | 'long';
}

interface Proportions {
  hipY: number; shoulderX: number; shoulderY: number; hipX: number; upperArm: number; foreArm: number; thigh: number; shin: number;
  chestW: number; chestD: number; waistW: number; hipW: number; headR: number; neckY: number; headY: number; limbR: number;
}

function proportions(female: boolean): Proportions {
  return female
    ? { hipY: 0.9, shoulderX: 0.165, shoulderY: 1.34, hipX: 0.095, upperArm: 0.25, foreArm: 0.23, thigh: 0.4, shin: 0.4, chestW: 0.32, chestD: 0.2, waistW: 0.25, hipW: 0.34, headR: 0.105, neckY: 1.4, headY: 1.5, limbR: 0.046 }
    : { hipY: 0.96, shoulderX: 0.19, shoulderY: 1.44, hipX: 0.1, upperArm: 0.27, foreArm: 0.25, thigh: 0.43, shin: 0.43, chestW: 0.4, chestD: 0.23, waistW: 0.31, hipW: 0.34, headR: 0.112, neckY: 1.5, headY: 1.6, limbR: 0.054 };
}

/** Bind-pose world positions of each bone (arms hanging down). */
function bonePositions(P: Proportions): Record<BoneName, THREE.Vector3> {
  const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const legTop = P.hipY - 0.04;
  return {
    Hips: V(0, P.hipY), Spine: V(0, P.hipY + 0.1), Spine1: V(0, P.hipY + 0.22), Spine2: V(0, P.hipY + 0.34),
    Neck: V(0, P.neckY), Head: V(0, P.headY - 0.04),
    LeftShoulder: V(0.06, P.shoulderY), LeftArm: V(P.shoulderX, P.shoulderY), LeftForeArm: V(P.shoulderX, P.shoulderY - P.upperArm), LeftHand: V(P.shoulderX, P.shoulderY - P.upperArm - P.foreArm),
    RightShoulder: V(-0.06, P.shoulderY), RightArm: V(-P.shoulderX, P.shoulderY), RightForeArm: V(-P.shoulderX, P.shoulderY - P.upperArm), RightHand: V(-P.shoulderX, P.shoulderY - P.upperArm - P.foreArm),
    LeftUpLeg: V(P.hipX, legTop), LeftLeg: V(P.hipX, legTop - P.thigh), LeftFoot: V(P.hipX, legTop - P.thigh - P.shin), LeftToeBase: V(P.hipX, 0.03, 0.12),
    RightUpLeg: V(-P.hipX, legTop), RightLeg: V(-P.hipX, legTop - P.thigh), RightFoot: V(-P.hipX, legTop - P.thigh - P.shin), RightToeBase: V(-P.hipX, 0.03, 0.12),
  };
}

const PARENT: Record<BoneName, BoneName | null> = {
  Hips: null, Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck',
  LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot',
};

class Builder {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; si: number[] = []; sw: number[] = []; idx: number[] = [];
  add(g: THREE.BufferGeometry, bone: number, color: THREE.Color | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color), m: THREE.Matrix4): void {
    const gi = g.index ? g : g;
    const p = gi.attributes.position as THREE.BufferAttribute;
    const n = gi.attributes.normal as THREE.BufferAttribute;
    const off = this.pos.length / 3;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), vn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(vn.x, vn.y, vn.z);
      const c = typeof color === 'function' ? color(v, vn) : color;
      this.col.push(c.r, c.g, c.b);
      this.si.push(bone, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
    }
    if (gi.index) for (let i = 0; i < gi.index.count; i++) this.idx.push(gi.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) this.idx.push(off + i);
    g.dispose();
  }
}

/** Capsule between two points. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 8): { g: THREE.BufferGeometry; m: THREE.Matrix4 } {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  // rounded ends
  const capA = new THREE.SphereGeometry(r0, seg, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -len / 2, 0);
  const capB = new THREE.SphereGeometry(r1, seg, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, len / 2, 0);
  const merged = mergeGeos([g, capA, capB]);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return { g: merged, m: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)) };
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

function box(w: number, h: number, d: number, bevel = 0.35): THREE.BufferGeometry {
  // a rounded box: sphere-ish scaled cube for softer silhouettes
  const g = new THREE.SphereGeometry(0.5, 10, 8);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 2, y = p.getY(i) * 2, z = p.getZ(i) * 2;
    // push toward a cube (superellipsoid-ish)
    const k = 1 - bevel;
    const f = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), k);
    x = f(x); y = f(y); z = f(z);
    p.setXYZ(i, (x * w) / 2, (y * h) / 2, (z * d) / 2);
  }
  g.computeVertexNormals();
  return g;
}

const _c = new THREE.Color();

export function buildCharacterGeometry(colors: BodyColors): { geometry: THREE.BufferGeometry; bindPositions: Record<BoneName, THREE.Vector3> } {
  const female = !!colors.female;
  const P = proportions(female);
  const B = bonePositions(P);
  const bi = (n: BoneName) => BONES.indexOf(n);
  const b = new Builder();
  const I = new THREE.Matrix4();
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const rnd = mulberry(colors.seed);
  const dirt = (base: THREE.Color, amount: number) => (p: THREE.Vector3) => {
    const c = _c.copy(base);
    if (colors.zombie) {
      const n = Math.sin(p.x * 23 + colors.seed) * Math.cos(p.y * 17 + colors.seed * 0.3) * Math.sin(p.z * 19);
      if (n > 0.55 - amount) c.lerp(new THREE.Color(0.28, 0.02, 0.02), 0.75); // blood
      else if (n < -0.6) c.multiplyScalar(0.55); // grime / tear
    }
    return c.clone();
  };
  // pelvis + torso
  b.add(box(P.hipW, 0.2, 0.2), bi('Hips'), dirt(colors.pants, 0.1), T(0, P.hipY - 0.03, 0));
  b.add(box(P.waistW, 0.2, P.chestD * 0.9), bi('Spine'), dirt(colors.shirt, 0.15), T(0, P.hipY + 0.14, 0));
  const chest = box(P.chestW, 0.3, P.chestD);
  b.add(chest, bi('Spine2'), dirt(colors.shirt, 0.2), T(0, P.hipY + 0.38, 0.0));
  if (female) b.add(box(P.chestW * 0.75, 0.12, 0.08), bi('Spine2'), dirt(colors.shirt, 0.2), T(0, P.hipY + 0.34, P.chestD * 0.42));
  // kurti / long top for female: a skirt piece over the hips
  if (female) b.add(box(P.hipW + 0.04, 0.3, 0.24, 0.5), bi('Hips'), dirt(colors.shirt, 0.2), T(0, P.hipY - 0.1, 0));
  // accessory: ID lanyard / belt
  if (colors.accessory && !colors.zombie) b.add(box(0.05, 0.07, 0.01), bi('Spine2'), colors.accessory, T(0, P.hipY + 0.27, P.chestD * 0.52));
  // neck + head
  b.add(limb(B.Neck, B.Head, 0.052, 0.05, 6).g, bi('Neck'), colors.skin, limb(B.Neck, B.Head, 0.052, 0.05, 6).m);
  const headG = new THREE.SphereGeometry(P.headR, 14, 10);
  headG.scale(0.92, 1.12, 1.0);
  b.add(headG, bi('Head'), (p, n) => {
    // eyes (dark) on the front, slightly below middle
    const hy = p.y - (P.headY + 0.06);
    if (n.z > 0.75 && Math.abs(hy) < 0.018 && Math.abs(Math.abs(p.x) - 0.035) < 0.017) return colors.zombie ? new THREE.Color(0.9, 0.85, 0.3) : new THREE.Color(0.08, 0.06, 0.05);
    if (colors.zombie && n.z > 0.6 && hy < -0.05 && Math.abs(p.x) < 0.04) return new THREE.Color(0.25, 0.03, 0.03);
    return colors.skin;
  }, T(0, P.headY + 0.06, 0.005));
  // nose
  b.add(box(0.03, 0.045, 0.04), bi('Head'), colors.skin, T(0, P.headY + 0.055, P.headR * 0.98));
  // ears
  for (const s of [-1, 1]) b.add(box(0.02, 0.05, 0.035), bi('Head'), colors.skin, T(s * P.headR * 0.9, P.headY + 0.06, 0));
  // hair
  const hairG = new THREE.SphereGeometry(P.headR * 1.08, 14, 8, 0, Math.PI * 2, 0, Math.PI * (female ? 0.62 : 0.5));
  hairG.scale(0.95, 1.1, 1.05);
  b.add(hairG, bi('Head'), colors.hair, T(0, P.headY + 0.075, -0.012));
  if (female) {
    // ponytail / braid
    const braid = limb(new THREE.Vector3(0, P.headY + 0.05, -P.headR * 0.95), new THREE.Vector3(0, P.headY - 0.3, -P.headR * 1.05), 0.045, 0.03, 6);
    b.add(braid.g, bi('Head'), colors.hair, braid.m);
  }
  if (colors.cap) {
    const capG = new THREE.CylinderGeometry(P.headR * 1.05, P.headR * 1.12, 0.07, 14);
    b.add(capG, bi('Head'), colors.accessory ?? colors.shirt, T(0, P.headY + 0.16, 0));
    b.add(box(0.16, 0.015, 0.1), bi('Head'), colors.accessory ?? colors.shirt, T(0, P.headY + 0.13, P.headR * 1.05));
  }
  // arms
  const sleeveCut = colors.sleeves === 'long' ? 1.0 : 0.55;
  for (const side of ['Left', 'Right'] as const) {
    const s = side === 'Left' ? 1 : -1;
    const sh = B[`${side}Arm`], el = B[`${side}ForeArm`], wr = B[`${side}Hand`];
    // shoulder cap (shirt)
    b.add(new THREE.SphereGeometry(P.limbR * 1.35, 8, 6), bi(`${side}Arm`), dirt(colors.shirt, 0.2), T(sh.x - s * 0.01, sh.y - 0.01, 0));
    const ua = limb(sh, el, P.limbR * 1.12, P.limbR * 0.95);
    b.add(ua.g, bi(`${side}Arm`), (p) => (p.y > sh.y - P.upperArm * sleeveCut ? dirt(colors.shirt, 0.2)(p) : colors.skin), ua.m);
    const fa = limb(el, wr, P.limbR * 0.95, P.limbR * 0.75);
    b.add(fa.g, bi(`${side}ForeArm`), colors.sleeves === 'long' ? dirt(colors.shirt, 0.2) : colors.skin, fa.m);
    // hand (mitten + thumb)
    b.add(box(0.075, 0.1, 0.04), bi(`${side}Hand`), colors.skin, T(wr.x, wr.y - 0.05, 0.01));
    b.add(box(0.025, 0.05, 0.025), bi(`${side}Hand`), colors.skin, T(wr.x - s * 0.035, wr.y - 0.035, 0.03));
  }
  // legs
  for (const side of ['Left', 'Right'] as const) {
    const hip = B[`${side}UpLeg`], knee = B[`${side}Leg`], ankle = B[`${side}Foot`];
    const th = limb(hip, knee, P.limbR * 1.55, P.limbR * 1.2);
    b.add(th.g, bi(`${side}UpLeg`), dirt(colors.pants, 0.15), th.m);
    const sn = limb(knee, ankle, P.limbR * 1.2, P.limbR * 0.9);
    b.add(sn.g, bi(`${side}Leg`), dirt(colors.pants, 0.2), sn.m);
    b.add(box(0.1, 0.08, 0.25), bi(`${side}Foot`), colors.shoes, T(ankle.x, 0.045, 0.05));
  }
  void I; void rnd;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  g.boundingSphere!.radius = 1.4;
  g.boundingSphere!.center.set(0, 0.9, 0);
  return { geometry: g, bindPositions: B };
}

export function buildSkeleton(bind: Record<BoneName, THREE.Vector3>): { root: THREE.Bone; bones: Record<BoneName, THREE.Bone>; skeleton: THREE.Skeleton } {
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONES) {
    const bone = new THREE.Bone();
    bone.name = n;
    bones[n] = bone;
  }
  for (const n of BONES) {
    const parent = PARENT[n];
    const wp = bind[n];
    if (parent) {
      bones[parent].add(bones[n]);
      bones[n].position.copy(wp).sub(bind[parent]);
    } else bones[n].position.copy(wp);
  }
  const list = BONES.map((n) => bones[n]);
  bones.Hips.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  return { root: bones.Hips, bones, skeleton };
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
