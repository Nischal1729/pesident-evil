import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../core/Assets';
import type { QualityProfile } from '../core/Settings';
import type { Actor, AnimHints, Look, Survivor, Zombie } from '../sim/actors';
import type { World } from '../sim/World';
import type { WeaponId } from '../sim/weapons';
import { buildCharacterGeometry, buildSkeleton, type BodyColors, type BoneName } from './ProceduralCharacter';
import { GlbCharacterView, lookColors, type GlbCharacterLibrary } from './GlbCharacters';

const _p = new THREE.Vector3();

/** Weapon GLBs (from tools/blender/weapons.py). Barrel −Z, origin at grip. */
export class WeaponModels {
  private src = new Map<WeaponId, THREE.Object3D>();
  async load(assets: Assets): Promise<void> {
    const ids: WeaponId[] = ['pistol', 'smg', 'rifle', 'shotgun', 'bat'];
    await Promise.all(ids.map(async (id) => {
      const file = id === 'bat' ? 'cricket_bat' : id;
      const g = await assets.gltf(`${import.meta.env.BASE_URL}models/weapons/${file}.glb`);
      if (g) {
        g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
        this.src.set(id, g.scene);
      }
    }));
  }
  create(id: WeaponId): THREE.Object3D {
    const s = this.src.get(id);
    if (s) return s.clone(true);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, id === 'pistol' ? 0.22 : 0.8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    m.position.z = id === 'pistol' ? -0.08 : -0.3;
    const g = new THREE.Group();
    g.add(m);
    return g;
  }
  muzzleOf(obj: THREE.Object3D): THREE.Object3D | null {
    return obj.getObjectByName('muzzle') ?? null;
  }
}

function lookToColors(look: Look, zombie: boolean, seed: number): BodyColors {
  const c = (h: string) => new THREE.Color(h);
  const cols: BodyColors = {
    skin: c(look.skin), hair: c(look.hair), shirt: c(look.shirt), pants: c(look.pants), shoes: c(look.shoes),
    accessory: look.accessory ? c(look.accessory) : undefined, zombie, seed, female: look.body === 'female',
  };
  if (zombie) {
    // grey-green decayed skin, washed-out clothes
    const decay = [c('#8d9a82'), c('#9aa38c'), c('#7f8c78'), c('#a39e8a'), c('#86917f')][seed % 5];
    cols.skin = cols.skin.clone().lerp(decay, 0.72);
    cols.shirt = cols.shirt.clone().lerp(c('#6b6558'), 0.35).multiplyScalar(0.8);
    cols.pants = cols.pants.clone().multiplyScalar(0.75);
    cols.hair = cols.hair.clone().multiplyScalar(0.7);
  }
  return cols;
}

const SHIRTS = ['#2f5d9b', '#b8382f', '#f2f2ee', '#3c7d4a', '#d9a441', '#6a3f8f', '#1d1d1f', '#8c1d2c', '#4aa3b5', '#c96f2c', '#7a7a7a', '#e37fa0'];
const PANTS = ['#2b3a55', '#1f2733', '#3d4a5c', '#50473a', '#6b5b43', '#262626', '#44546a'];
const SKINS = ['#8d5a3b', '#a36a45', '#b77b52', '#7a4a2f', '#c68c62', '#6b3f28'];
const HAIRS = ['#161210', '#1f1712', '#2b1d14', '#0e0c0b'];

export function randomStudentLook(seed: number, body?: 'male' | 'female'): Look {
  const r = (n: number) => Math.abs(Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1;
  const b = body ?? (r(1) < 0.4 ? 'female' : 'male');
  return {
    body: b,
    skin: SKINS[Math.floor(r(2) * SKINS.length)],
    hair: HAIRS[Math.floor(r(3) * HAIRS.length)],
    shirt: SHIRTS[Math.floor(r(4) * SHIRTS.length)],
    pants: b === 'female' && r(5) < 0.4 ? ['#d9c7a3', '#f0e6d2', '#3d4a5c'][Math.floor(r(6) * 3)] : PANTS[Math.floor(r(5) * PANTS.length)],
    shoes: ['#f2f2f2', '#222222', '#6b4a2e', '#3b5a8a'][Math.floor(r(7) * 4)],
    accessory: r(8) < 0.6 ? '#2d59a8' : undefined,
    seed,
  };
}

// -------------------------------------------------------------------------------------------------
// Character view: SkinnedMesh + procedural pose animation driven by AnimHints
// -------------------------------------------------------------------------------------------------
export class CharacterView {
  root = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  private hipsY: number;
  private phase = Math.random() * Math.PI * 2;
  private aimBlend = 0;
  private speedS = 0;
  private t = Math.random() * 10;
  private weapon: THREE.Object3D | null = null;
  private weaponId: WeaponId | null = null;
  muzzle: THREE.Object3D | null = null;
  private recoil = 0;
  private lastFireT = 99;
  private lod = 0;
  private frame = 0;
  private variant: number;

  constructor(public actor: Actor, colors: BodyColors, material: THREE.Material, private weapons: WeaponModels | null, prebuilt?: ReturnType<typeof buildCharacterGeometry>, private sharedGeo = false) {
    const { geometry, bindPositions } = prebuilt ?? buildCharacterGeometry(colors);
    const { root, bones, skeleton } = buildSkeleton(bindPositions);
    this.bones = bones;
    this.hipsY = bindPositions.Hips.y;
    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.mesh.add(root);
    this.mesh.bind(skeleton);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = true;
    this.root.add(this.mesh);
    this.root.scale.setScalar(actor.scale);
    this.variant = colors.seed;
  }

  setWeapon(id: WeaponId | null): void {
    if (id === this.weaponId) return;
    if (this.weapon) this.weapon.removeFromParent();
    this.weapon = null;
    this.muzzle = null;
    this.weaponId = id;
    if (!id || !this.weapons) return;
    const w = this.weapons.create(id);
    this.weapon = w;
    this.muzzle = this.weapons.muzzleOf(w);
    this.bones.Spine2.add(w);
  }

  get weaponObject(): THREE.Object3D | null { return this.weapon; }

  update(dt: number, alpha: number, camPos: THREE.Vector3, q: QualityProfile): void {
    const a = this.actor;
    // interpolated transform
    this.root.position.lerpVectors(a.prev, a.pos, alpha);
    let dy = a.yaw - a.prevYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.set(0, a.prevYaw + dy * alpha + Math.PI, 0);
    const dist = _p.copy(this.root.position).distanceTo(camPos);
    this.mesh.castShadow = dist < q.characterShadowDistance;
    this.lod = dist < q.animLodNear ? 1 : dist < q.animLodNear * 2 ? 2 : 3;
    this.frame++;
    this.t += dt;
    if (this.frame % this.lod !== 0 && !a.anim.dead) return;
    const step = dt * this.lod;
    if (a.kind === 'zombie') this.poseZombie(a as Zombie, step);
    else this.poseSurvivor(a as Survivor, step);
  }

  private reset(): void {
    for (const k in this.bones) this.bones[k as BoneName].rotation.set(0, 0, 0);
    this.bones.Hips.position.y = this.hipsY;
    this.bones.Hips.position.z = 0;
    this.mesh.position.set(0, 0, 0);
    this.mesh.rotation.set(0, 0, 0);
  }

  private legs(an: AnimHints, dt: number, stride: number, amp: number, knee: number): void {
    const b = this.bones;
    const sp = this.speedS;
    this.phase += (dt * sp) / stride * Math.PI * 2;
    const move = THREE.MathUtils.clamp(sp / 1.1, 0, 1);
    const back = an.localZ < -0.3 ? -1 : 1;
    const side = THREE.MathUtils.clamp(an.localX, -1, 1);
    const fwd = Math.abs(an.localZ) > 0.3 ? 1 : 1 - Math.abs(side) * 0.6;
    const s = Math.sin(this.phase) * amp * move * back;
    b.LeftUpLeg.rotation.x = -s * fwd;
    b.RightUpLeg.rotation.x = s * fwd;
    b.LeftUpLeg.rotation.z = side * Math.sin(this.phase) * 0.25 * move;
    b.RightUpLeg.rotation.z = -side * Math.sin(this.phase) * 0.25 * move;
    const kl = Math.max(0, Math.sin(this.phase + Math.PI * 0.5 * back)) * knee * move;
    const kr = Math.max(0, Math.sin(this.phase + Math.PI + Math.PI * 0.5 * back)) * knee * move;
    b.LeftLeg.rotation.x = kl + 0.05;
    b.RightLeg.rotation.x = kr + 0.05;
    b.LeftFoot.rotation.x = -kl * 0.3 + s * 0.2;
    b.RightFoot.rotation.x = -kr * 0.3 - s * 0.2;
    b.Hips.position.y = this.hipsY - Math.abs(Math.cos(this.phase)) * 0.035 * move - (sp > 4 ? 0.04 : 0);
    b.Hips.rotation.y = Math.sin(this.phase) * 0.1 * move;
    b.Spine.rotation.y = -Math.sin(this.phase) * 0.08 * move;
  }

  private poseSurvivor(s: Survivor, dt: number): void {
    const an = s.anim;
    const b = this.bones;
    this.reset();
    this.setWeapon(an.dead ? null : an.weapon);
    this.speedS += (an.speed - this.speedS) * Math.min(1, dt * 10);
    this.aimBlend += ((an.aiming ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 12);
    if (an.fireT < this.lastFireT) this.recoil = 1;
    this.lastFireT = an.fireT;
    this.recoil = Math.max(0, this.recoil - dt * 12);

    if (an.dead) { this.poseDead(an, dt, 0); return; }
    if (an.downed) { this.poseDowned(); this.placeWeapon('down'); return; }
    if (an.reviving) { this.poseKneel(); this.placeWeapon('down'); return; }

    const running = this.speedS > 4.8;
    this.legs(an, dt, running ? 2.5 : 1.45, running ? 0.75 : 0.42, running ? 1.2 : 0.6);
    // jump pose
    if (an.airborne) {
      b.LeftUpLeg.rotation.x = -0.6; b.LeftLeg.rotation.x = 0.9;
      b.RightUpLeg.rotation.x = -0.2; b.RightLeg.rotation.x = 0.5;
    }
    const pitch = an.aimPitch * this.aimBlend;
    b.Spine.rotation.x = running ? 0.18 : 0.04;
    b.Spine1.rotation.x = -pitch * 0.35;
    b.Spine2.rotation.x = -pitch * 0.35;
    b.Neck.rotation.x = -pitch * 0.15;
    b.Head.rotation.x = -pitch * 0.15;
    const w = an.weapon;
    const kind = w === 'pistol' ? 'pistol' : w === 'bat' ? 'bat' : w ? 'rifle' : 'none';
    const swing = Math.sin(this.phase) * THREE.MathUtils.clamp(this.speedS / 1.2, 0, 1);
    if (kind === 'rifle') {
      const ready = Math.max(this.aimBlend, running ? 0 : 0.55);
      // right hand on grip, left hand forward on handguard
      b.RightArm.rotation.set(-0.35 - 0.95 * ready, 0.3 * ready, -0.15);
      b.RightForeArm.rotation.set(-1.45 + 0.25 * ready, 0, 0);
      b.LeftArm.rotation.set(-0.55 - 0.85 * ready, -0.2, 0.55 * ready + 0.1);
      b.LeftForeArm.rotation.set(-0.9 + 0.35 * ready, 0, 0);
      b.Spine2.rotation.y = 0.25 * ready;
      b.Head.rotation.y = -0.2 * ready;
      if (running) { b.RightArm.rotation.x += swing * 0.15; b.LeftArm.rotation.x -= swing * 0.15; }
      if (an.reloading) {
        const p = an.reloadP;
        b.LeftArm.rotation.x = -0.6 + Math.sin(p * Math.PI * 2) * 0.35;
        b.LeftForeArm.rotation.x = -1.2;
      }
      this.placeWeapon(running && !an.aiming ? 'port' : 'rifle', an);
    } else if (kind === 'pistol') {
      const ready = Math.max(this.aimBlend, 0.25);
      b.RightArm.rotation.set(-0.3 - 1.25 * ready, 0.15, -0.1);
      b.RightForeArm.rotation.set(-0.6 + 0.5 * ready, 0, 0);
      b.LeftArm.rotation.set(-0.25 - 1.2 * ready * this.aimBlend - swing * 0.4 * (1 - this.aimBlend), -0.3 * this.aimBlend, 0.4 * this.aimBlend);
      b.LeftForeArm.rotation.set(-0.3 - 0.2 * (1 - this.aimBlend), 0, 0);
      if (an.reloading) { b.LeftArm.rotation.x = -0.9; b.LeftForeArm.rotation.x = -1.0; }
      this.placeWeapon('pistol', an);
    } else if (kind === 'bat') {
      const m = an.meleeP;
      if (m >= 0) {
        // wind-up then big horizontal swing
        const wind = m < 0.3 ? m / 0.3 : 1;
        const sw = m < 0.3 ? 0 : Math.min(1, (m - 0.3) / 0.35);
        const yaw = 0.9 * wind - 2.0 * sw;
        b.Spine1.rotation.y = yaw * 0.5;
        b.Spine2.rotation.y = yaw * 0.5;
        b.RightArm.rotation.set(-1.3, 0.4, -0.4 + sw * 0.3);
        b.RightForeArm.rotation.set(-0.5, 0, 0);
        b.LeftArm.rotation.set(-1.3, -0.6, 0.7);
        b.LeftForeArm.rotation.set(-0.6, 0, 0);
        this.placeWeapon('batSwing', an, 1 - wind + sw);
      } else {
        b.RightArm.rotation.set(-0.5 + swing * 0.1, 0.2, -0.25);
        b.RightForeArm.rotation.set(-1.9, 0, 0);
        b.LeftArm.rotation.set(-0.8 - swing * 0.1, -0.3, 0.55);
        b.LeftForeArm.rotation.set(-1.5, 0, 0);
        this.placeWeapon('bat', an);
      }
    } else {
      b.LeftArm.rotation.x = swing * 0.6;
      b.RightArm.rotation.x = -swing * 0.6;
      b.LeftArm.rotation.z = 0.08; b.RightArm.rotation.z = -0.08;
      b.LeftForeArm.rotation.x = -0.25; b.RightForeArm.rotation.x = -0.25;
    }
    // hit flinch
    if (an.hitT < 0.25) {
      const f = 1 - an.hitT / 0.25;
      b.Spine1.rotation.x -= 0.25 * f;
      b.Head.rotation.x -= 0.2 * f;
    }
  }

  /** Weapon transform in Spine2 space (character faces +Z). */
  private placeWeapon(mode: 'rifle' | 'port' | 'pistol' | 'bat' | 'batSwing' | 'down', an?: AnimHints, swingT = 0): void {
    const w = this.weapon;
    if (!w) return;
    const rk = this.recoil;
    w.visible = true;
    switch (mode) {
      case 'rifle':
        w.position.set(-0.14, 0.06, 0.3 - rk * 0.06);
        w.rotation.set(-rk * 0.08 + (an?.reloading ? 0.5 * Math.sin((an.reloadP) * Math.PI) : 0), Math.PI - 0.08, 0);
        break;
      case 'port':
        w.position.set(-0.1, 0.02, 0.22);
        w.rotation.set(0.9, Math.PI - 0.5, 0.3);
        break;
      case 'pistol':
        w.position.set(-0.06, 0.12 - (1 - this.aimBlend) * 0.25, 0.45 * (0.55 + this.aimBlend * 0.45) - rk * 0.04);
        w.rotation.set(-rk * 0.25 + (1 - this.aimBlend) * 0.6 + (an?.reloading ? 0.6 : 0), Math.PI, 0);
        break;
      case 'bat':
        w.position.set(-0.22, 0.12, 0.08);
        w.rotation.set(-2.3, Math.PI * 0.1, 0.2);
        break;
      case 'batSwing':
        w.position.set(-0.05, 0.02, 0.45);
        w.rotation.set(-1.4 + swingT * 0.2, Math.PI * 0.5 - swingT * 1.5, 0);
        break;
      case 'down':
        w.visible = false;
        break;
    }
  }

  private poseDowned(): void {
    const b = this.bones;
    b.Hips.position.y = 0.22;
    b.Spine.rotation.x = -0.35;
    b.LeftUpLeg.rotation.set(-1.35, 0, 0.15);
    b.RightUpLeg.rotation.set(-1.1, 0, -0.25);
    b.LeftLeg.rotation.x = 0.4;
    b.RightLeg.rotation.x = 1.1;
    b.LeftArm.rotation.set(-2.3 + Math.sin(this.t * 3) * 0.15, 0, 0.3);
    b.LeftForeArm.rotation.x = -0.3;
    b.RightArm.rotation.set(0.35, 0, -0.6);
    b.Head.rotation.x = -0.2;
  }

  private poseKneel(): void {
    const b = this.bones;
    b.Hips.position.y = 0.55;
    b.LeftUpLeg.rotation.x = -1.5; b.LeftLeg.rotation.x = 1.5;
    b.RightUpLeg.rotation.x = 0.1; b.RightLeg.rotation.x = 1.6;
    b.Spine.rotation.x = 0.4;
    b.LeftArm.rotation.x = -1.1 + Math.sin(this.t * 6) * 0.15; b.RightArm.rotation.x = -1.1 - Math.sin(this.t * 6) * 0.15;
    b.LeftForeArm.rotation.x = -0.3; b.RightForeArm.rotation.x = -0.3;
  }

  private poseDead(an: AnimHints, _dt: number, extraSink: number): void {
    const b = this.bones;
    const f = THREE.MathUtils.clamp(an.deadT / 0.65, 0, 1);
    const e = f * f * (3 - 2 * f);
    const forward = an.deathVariant === 1;
    // tip the whole mesh over around the feet
    this.mesh.rotation.x = (forward ? 1 : -1) * e * (Math.PI / 2 - 0.08);
    this.mesh.position.y = -extraSink;
    this.mesh.position.z = (forward ? 0.25 : -0.2) * e;
    b.LeftArm.rotation.set(forward ? -2.6 * e : -0.4 * e, 0, 0.9 * e);
    b.RightArm.rotation.set(forward ? -2.4 * e : -0.2 * e, 0, -1.1 * e);
    b.LeftUpLeg.rotation.set(-0.2 * e, 0, 0.2 * e);
    b.RightUpLeg.rotation.set(0.15 * e, 0, -0.15 * e);
    b.LeftLeg.rotation.x = 0.4 * e;
    b.Head.rotation.set(0.3 * e, 0.6 * e, 0);
  }

  private poseZombie(z: Zombie, dt: number): void {
    const an = z.anim;
    const b = this.bones;
    this.reset();
    this.speedS += (an.speed - this.speedS) * Math.min(1, dt * 8);
    if (an.dead) {
      const sink = an.deadT > 10 ? (an.deadT - 10) * 0.25 : 0;
      this.poseDead(an, dt, sink);
      return;
    }
    const v = this.variant;
    const runner = z.type === 'runner';
    if (z.type === 'crawler') {
      // prone, pulling itself along
      this.mesh.rotation.x = Math.PI / 2 - 0.15;
      this.mesh.position.set(0, 0.22, -0.7);
      this.phase += dt * (0.8 + this.speedS * 2.5);
      b.LeftArm.rotation.set(-2.6 + Math.sin(this.phase) * 0.6, 0, 0.3);
      b.RightArm.rotation.set(-2.6 - Math.sin(this.phase) * 0.6, 0, -0.3);
      b.Head.rotation.x = -0.9;
      b.LeftUpLeg.rotation.x = 0.1; b.RightUpLeg.rotation.x = 0.15;
      b.LeftLeg.rotation.x = 0.3;
      return;
    }
    this.legs(an, dt, runner ? 2.4 : 1.1, runner ? 0.8 : 0.32, runner ? 1.3 : 0.45);
    const tt = this.t * (runner ? 2 : 1);
    const lurch = runner ? 0 : Math.sin(this.phase * 0.5 + v) * 0.08;
    b.Spine.rotation.x = (runner ? 0.42 : 0.28) + lurch;
    b.Spine1.rotation.z = Math.sin(v) * 0.12;
    b.Neck.rotation.x = 0.15;
    b.Head.rotation.set(0.1 + Math.sin(tt * 0.7 + v) * 0.12, Math.sin(tt * 0.5 + v * 2) * 0.25, 0.3 * Math.sin(v * 3) + Math.sin(tt * 0.9) * 0.1);
    // dragging foot on shamblers
    if (!runner && v % 3 === 0) { b.RightFoot.rotation.x = 0.5; b.RightLeg.rotation.x += 0.2; }
    const swing = Math.sin(this.phase);
    if (runner) {
      b.LeftArm.rotation.set(-0.3 + swing * 1.1, 0, 0.3);
      b.RightArm.rotation.set(-0.3 - swing * 1.1, 0, -0.3);
      b.LeftForeArm.rotation.x = -1.0; b.RightForeArm.rotation.x = -1.0;
    } else {
      const reachL = -1.35 + Math.sin(tt * 1.3 + v) * 0.12 + (v % 2 ? 0.5 : 0);
      const reachR = -1.2 + Math.sin(tt * 1.1 + v * 1.7) * 0.12;
      b.LeftArm.rotation.set(reachL, 0.1, 0.15);
      b.RightArm.rotation.set(reachR, -0.1, -0.12);
      b.LeftForeArm.rotation.x = -0.25; b.RightForeArm.rotation.x = -0.15;
      b.LeftHand.rotation.x = 0.4; b.RightHand.rotation.x = 0.3;
    }
    // attack: raise both arms, lunge and swipe down
    if (an.attackP >= 0) {
      const p = an.attackP;
      const up = p < 0.45 ? p / 0.45 : 1 - (p - 0.45) / 0.55;
      const down = p > 0.45 ? Math.min(1, (p - 0.45) / 0.15) : 0;
      b.LeftArm.rotation.set(-1.2 - 1.3 * up + 0.6 * down, 0, 0.2);
      b.RightArm.rotation.set(-1.3 - 1.2 * up + 0.7 * down, 0, -0.2);
      b.Spine.rotation.x = 0.2 + 0.5 * down * (1 - Math.max(0, p - 0.7) / 0.3);
      b.Hips.position.z = 0.12 * down;
      b.Head.rotation.x = -0.3 * up;
    }
    // hit reaction: snap back along hit direction
    if (an.hitT < 0.3) {
      const f = 1 - an.hitT / 0.3;
      b.Spine1.rotation.x -= 0.5 * f;
      b.Head.rotation.x -= 0.4 * f;
      b.Spine1.rotation.y += 0.3 * f * (v % 2 ? 1 : -1);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    if (!this.sharedGeo) this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
  }
}

// -------------------------------------------------------------------------------------------------
// Manager: keeps views in sync with the sim
// -------------------------------------------------------------------------------------------------
interface ViewLike {
  root: THREE.Object3D;
  muzzle: THREE.Object3D | null;
  update(dt: number, alpha: number, camPos: THREE.Vector3, q: QualityProfile): void;
  dispose(): void;
}

export class CharacterManager {
  views = new Map<number, ViewLike>();
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  private zombieGeo = new Map<string, ReturnType<typeof buildCharacterGeometry>>();
  group = new THREE.Group();

  constructor(scene: THREE.Scene, private weapons: WeaponModels, private q: QualityProfile, private lib: GlbCharacterLibrary | null = null) {
    this.group.name = 'characters';
    scene.add(this.group);
  }

  setQuality(q: QualityProfile): void { this.q = q; }

  private makeSurvivor(s: Survivor): ViewLike {
    if (this.lib?.ready) {
      const key = s.look.body;
      const geo = this.lib.variant(key, lookColors(s.look, false));
      return new GlbCharacterView(s, this.lib, key, geo, this.weapons, s.look.body === 'female' ? 1.62 : 1.75);
    }
    return new CharacterView(s, lookToColors(s.look, false, s.look.seed), this.material, this.weapons);
  }

  private makeZombie(z: Zombie): ViewLike {
    const vk = z.variant % 16;
    const look = randomStudentLook(vk * 31 + 7);
    if (this.lib?.ready) {
      const lodKey = `${look.body}_lod`;
      const key = this.lib.has(lodKey) && z.type !== 'brute' ? lodKey : look.body;
      const cols = lookColors({ ...look, seed: vk }, true);
      if (z.type === 'brute') { cols.shirt = new THREE.Color('#3b3f2f'); cols.pants = new THREE.Color('#2a2a26'); }
      const geo = this.lib.variant(key, cols, vk);
      return new GlbCharacterView(z, this.lib, key, geo, null, look.body === 'female' ? 1.62 : 1.75);
    }
    const bkey = `${vk}|${z.type === 'brute' ? 'b' : 'n'}`;
    let pre = this.zombieGeo.get(bkey);
    const cols = lookToColors(look, true, vk);
    if (z.type === 'brute') { cols.shirt = new THREE.Color('#3b3f2f'); cols.pants = new THREE.Color('#2a2a26'); }
    if (!pre) { pre = buildCharacterGeometry(cols); this.zombieGeo.set(bkey, pre); }
    cols.seed = z.variant;
    return new CharacterView(z, cols, this.material, null, pre, true);
  }

  sync(world: World, alpha: number, dt: number, camPos: THREE.Vector3): void {
    const seen = new Set<number>();
    for (const s of world.survivors) {
      seen.add(s.id);
      let v = this.views.get(s.id);
      if (!v) { v = this.makeSurvivor(s); this.views.set(s.id, v); this.group.add(v.root); }
      v.update(dt, alpha, camPos, this.q);
    }
    for (const z of world.zombies) {
      seen.add(z.id);
      let v = this.views.get(z.id);
      if (!v) { v = this.makeZombie(z); this.views.set(z.id, v); this.group.add(v.root); }
      v.update(dt, alpha, camPos, this.q);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.dispose(); this.views.delete(id); }
    }
  }

  view(id: number): ViewLike | undefined { return this.views.get(id); }
}

void SkeletonUtils;
