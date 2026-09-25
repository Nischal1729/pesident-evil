import * as THREE from 'three';
import { cameraPivot, cameraPose } from '../sim/aim';
import type { StaticCollision } from '../sim/Collision';

const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _hit = { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, surface: 'ground' as const, tag: '' };

/** Over-the-shoulder third-person camera with collision pull-in, aim zoom, and shake. */
export class CameraRig {
  aimBlend = 0;
  private shake = 0;
  private dist = 99;
  private t = 0;
  baseFov = 62;
  shoulderSide = 1;
  private shoulderS = 1;

  constructor(private camera: THREE.PerspectiveCamera, private collision: StaticCollision) {}

  addShake(a: number): void { this.shake = Math.min(1.2, this.shake + a); }

  private pivotY: number | null = null;

  update(dt: number, target: THREE.Vector3, yaw: number, pitch: number, aiming: boolean, sprinting: boolean, downed: boolean): void {
    this.t += dt;
    this.aimBlend += ((aiming ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 11);
    this.shoulderS += (this.shoulderSide - this.shoulderS) * Math.min(1, dt * 8);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const tgt = _pivot.copy(target);
    // smooth the pivot height so snapping up steps / onto ramps doesn't jolt the camera (jumps still read)
    if (this.pivotY === null || Math.abs(tgt.y - this.pivotY) > 3) this.pivotY = tgt.y;
    else this.pivotY += (tgt.y - this.pivotY) * Math.min(1, dt * 14);
    tgt.y = this.pivotY;
    if (downed) tgt.y -= 0.9;
    cameraPose(tgt, yaw, pitch, this.aimBlend, _desired, _dir, this.shoulderS);
    cameraPivot(tgt, yaw, this.aimBlend, _pivot, this.shoulderS);
    // collision pull-in (sphere-ish: test a few rays)
    const toCam = _desired.clone().sub(_pivot);
    const full = toCam.length();
    toCam.divideScalar(full);
    let allowed = full;
    const h = this.collision.raycast(_pivot.x, _pivot.y, _pivot.z, toCam.x, toCam.y, toCam.z, full + 0.3, _hit as any);
    if (h && h.tag !== 'ground') allowed = Math.max(0.35, h.dist - 0.3);
    // ease out, snap in
    if (allowed < this.dist) this.dist = allowed;
    else this.dist += (allowed - this.dist) * Math.min(1, dt * 5);
    this.dist = Math.min(this.dist, full);
    this.camera.position.copy(_pivot).addScaledVector(toCam, this.dist);
    if (this.camera.position.y < 0.3) this.camera.position.y = 0.3;
    // shake
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.08;
      this.camera.position.x += Math.sin(this.t * 61) * s;
      this.camera.position.y += Math.sin(this.t * 47 + 1) * s;
    }
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    const fov = this.baseFov * THREE.MathUtils.lerp(1, 0.72, this.aimBlend) + (sprinting ? 5 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
  }
}
