import * as THREE from 'three';

/** Over-the-shoulder camera placement, shared by the sim (aim ray) and the render camera rig. */
export const CAM = {
  pivotY: 1.58,
  shoulder: 0.62,
  shoulderAim: 0.72,
  dist: 3.3,
  distAim: 1.65,
  up: 0.18,
  upAim: 0.12,
};

export function forwardFromYawPitch(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

export function rightFromYaw(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

/**
 * Ideal (uncollided) camera position and forward for a player at `pos` with yaw/pitch.
 * `aimBlend` 0..1 interpolates hip → aim framing.
 */
export function cameraPose(pos: THREE.Vector3, yaw: number, pitch: number, aimBlend: number, outPos: THREE.Vector3, outDir: THREE.Vector3, shoulderSide = 1): void {
  forwardFromYawPitch(yaw, pitch, outDir);
  rightFromYaw(yaw, _r);
  const dist = THREE.MathUtils.lerp(CAM.dist, CAM.distAim, aimBlend);
  const sh = THREE.MathUtils.lerp(CAM.shoulder, CAM.shoulderAim, aimBlend) * shoulderSide;
  const up = THREE.MathUtils.lerp(CAM.up, CAM.upAim, aimBlend);
  outPos.set(pos.x, pos.y + CAM.pivotY + up, pos.z).addScaledVector(_r, sh).addScaledVector(outDir, -dist);
}

/** Pivot the camera orbits (used for collision pull-in). */
export function cameraPivot(pos: THREE.Vector3, yaw: number, aimBlend: number, out: THREE.Vector3, shoulderSide = 1): THREE.Vector3 {
  rightFromYaw(yaw, _r);
  const sh = THREE.MathUtils.lerp(CAM.shoulder, CAM.shoulderAim, aimBlend) * shoulderSide * 0.35;
  return out.set(pos.x, pos.y + CAM.pivotY, pos.z).addScaledVector(_r, sh);
}

export { _f as _scratchF };
