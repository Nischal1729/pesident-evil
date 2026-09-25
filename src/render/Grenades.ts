import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../sim/World';

/**
 * Frag grenade model (~14 cm tall, origin at its centre): olive segmented body, steel fuse head with lever and
 * pull ring. One vertex-coloured geometry, so every grenade in flight (and the one in a thrower's hand) shares one
 * geometry and one material.
 */
function grenadeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  // body: an egg with shallow horizontal grooves (lathe profile)
  const prof: THREE.Vector2[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = -0.05 + t * 0.09;
    const r = Math.sin(Math.PI * Math.min(1, t * 0.98 + 0.02)) * 0.036 * (1 - 0.06 * (i % 2)) + (t > 0.9 ? 0.004 : 0);
    prof.push(new THREE.Vector2(Math.max(0.004, r), y));
  }
  paint(new THREE.LatheGeometry(prof, 10), 0x3f4a2c);
  // fuse head + lever + ring
  paint(new THREE.CylinderGeometry(0.012, 0.014, 0.022, 8).translate(0, 0.048, 0), 0x8a8d8f);
  paint(new THREE.BoxGeometry(0.012, 0.066, 0.008).translate(0.02, 0.022, 0).rotateZ(-0.12), 0x9a9c9e);
  paint(new THREE.TorusGeometry(0.011, 0.0022, 4, 10).translate(-0.02, 0.056, 0), 0xb4b6b8);
  const geo = mergeGeometries(parts, false)!;
  geo.deleteAttribute('uv');
  geo.scale(1.25, 1.25, 1.25); // a touch over life size so it reads at third-person distances
  geo.computeBoundingSphere();
  return geo;
}

let shared: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } | null = null;
/** The one grenade geometry + material, shared by the in-flight instances and the grenade in a thrower's hand. */
export function grenadeAssets(): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
  if (!shared) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
    material.name = 'grenade';
    shared = { geometry: grenadeGeometry(), material };
  }
  return shared;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

interface Spin { q: THREE.Quaternion; seen: number; roll: number; lying: boolean }

/** Renders World.grenades: one InstancedMesh, interpolated between sim ticks, spinning in flight and rolling on the ground. */
export class GrenadeView {
  readonly mesh: THREE.InstancedMesh;
  private spin = new Map<number, Spin>();
  private frame = 0;

  constructor(scene: THREE.Scene, private capacity = 24) {
    const { geometry, material } = grenadeAssets();
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'grenades';
    this.mesh.frustumCulled = false; // instances roam the whole campus; there are only ever a few
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Shader warm-up: one instance far below the ground, visible, so compile() and the warm-up frames see it. */
  prewarm(on: boolean): void {
    this.mesh.count = on ? 1 : 0;
    this.mesh.visible = on;
    if (on) { this.mesh.setMatrixAt(0, _m.makeTranslation(0, -1000, 0)); this.mesh.instanceMatrix.needsUpdate = true; }
  }

  update(world: World | null, alpha: number, dt: number): void {
    const list = world ? world.grenades : null;
    const n = list ? Math.min(list.length, this.capacity) : 0;
    this.frame++;
    for (let i = 0; i < n; i++) {
      const g = list![i];
      let s = this.spin.get(g.id);
      if (!s) {
        s = { q: new THREE.Quaternion().setFromAxisAngle(_axis.set(0.3, 0.2, 1).normalize(), 0.6 + (g.id % 7) * 0.9), seen: 0, roll: 0, lying: false };
        this.spin.set(g.id, s);
      }
      s.seen = this.frame;
      const sp = Math.hypot(g.vx, g.vz);
      if (g.rolling) {
        // on the ground it lies on its side and rolls about its long axis, which lies across the direction of travel
        if (sp > 0.02) {
          _axis.set(g.vz, 0, -g.vx).divideScalar(sp);
          s.roll += (sp / 0.045) * dt;
          s.q.setFromUnitVectors(_up, _axis).multiply(_dq.setFromAxisAngle(_up, s.roll));
          s.lying = true;
        }
      } else {
        // tumbling end over end in flight
        s.lying = false;
        if (sp > 0.02) s.q.premultiply(_dq.setFromAxisAngle(_axis.set(g.vz, 0, -g.vx).divideScalar(sp), (9 + sp * 0.6) * dt));
        else s.q.premultiply(_dq.setFromAxisAngle(_up, 6 * dt));
      }
      _p.set(g.px + (g.x - g.px) * alpha, g.py + (g.y - g.py) * alpha, g.pz + (g.z - g.pz) * alpha);
      // lying down the body is 4.5 cm in radius while the sim centre sits at the 7 cm collision radius; drawn a little
      // proud of the collision floor, since campus ground and road meshes sit 2-6 cm above it
      if (s.lying) _p.y -= 0.012;
      this.mesh.setMatrixAt(i, _m.compose(_p, s.q, _s));
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.spin.size > n) for (const [id, s] of this.spin) if (s.seen !== this.frame) this.spin.delete(id);
  }
}
