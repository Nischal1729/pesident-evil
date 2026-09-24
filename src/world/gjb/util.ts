import * as THREE from 'three';
import { GeoBuffer } from '../buildings';
import type { DetailKey, WorldKit } from '../kit';
import type { V2 } from '../layout';

/** Oriented rectangle along a→b (plan), `thick` wide, shifted `offset` along the left normal (-dz, dx). */
export function segPoly(a: V2, b: V2, thick: number, offset = 0): V2[] {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  const nx = -dz / l, nz = dx / l;
  const o0 = offset - thick / 2, o1 = offset + thick / 2;
  return [[a[0] + nx * o0, a[1] + nz * o0], [b[0] + nx * o0, b[1] + nz * o0], [b[0] + nx * o1, b[1] + nz * o1], [a[0] + nx * o1, a[1] + nz * o1]];
}

export const rect = (x0: number, z0: number, x1: number, z1: number): V2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Always-on light panels (unlit, slightly over-bright so they read as lamps in daylight and bloom at night). */
let lightMat: THREE.MeshBasicMaterial | null = null;
export function interiorLightMaterial(): THREE.MeshBasicMaterial {
  return (lightMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.44, 1.32), toneMapped: true }));
}
/** See-through glazing for real openings (the kit's 'glass' key is opaque, facade-style). */
let clearGlass: THREE.MeshStandardMaterial | null = null;
export function clearGlassMaterial(): THREE.MeshStandardMaterial {
  return (clearGlass ??= new THREE.MeshStandardMaterial({ color: 0xaec2cc, roughness: 0.04, metalness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
}

/**
 * Small merged-geometry builder for a self-contained group (interiors, the parking): one buffer per kit material key
 * plus light panels and clear glass. `build()` returns a THREE.LOD that shows the detailed group near the camera and
 * `far` (optional cheap stand-in) beyond `cullDist`, so interiors cost nothing when the camera is away.
 */
export class GroupKit {
  bufs = new Map<string, GeoBuffer>();
  lights = new GeoBuffer();
  glass = new GeoBuffer();
  constructor(public kit: WorldKit) {}
  b(key: DetailKey): GeoBuffer {
    let g = this.bufs.get(key);
    if (!g) this.bufs.set(key, (g = new GeoBuffer({ color: true })));
    return g;
  }
  box(key: DetailKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rot = 0, c?: THREE.Color, uv = 1): void {
    this.b(key).box(cx, cy, cz, sx, sy, sz, rot, c, uv);
  }
  seg(key: DetailKey, a: V2, b: V2, y0: number, y1: number, thick: number, c?: THREE.Color, offset = 0, extend = 0, uv = 1): void {
    this.b(key).segBox(a, b, y0, y1, thick, c, offset, extend, uv);
  }
  light(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rot = 0): void {
    this.lights.box(cx, cy, cz, sx, sy, sz, rot);
  }
  /** Vertical clear-glass pane along a→b from y0 to y1. */
  pane(a: V2, b: V2, y0: number, y1: number): void {
    this.glass.wallQuad(a, b, y0, y1);
  }
  meshes(receive = true, cast = false): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const add = (geo: GeoBuffer, mat: THREE.Material, name: string, shadow: boolean) => {
      if (!geo.vertexCount) return;
      const m = new THREE.Mesh(geo.toGeometry(), mat);
      m.name = name;
      m.receiveShadow = shadow && receive;
      m.castShadow = shadow && cast;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      out.push(m);
    };
    for (const [k, g] of this.bufs) add(g, this.kit.material(k), `gk:${k}`, true);
    add(this.lights, interiorLightMaterial(), 'gk:lights', false);
    const glass = this.glass.vertexCount ? this.glass : null;
    if (glass) {
      const m = new THREE.Mesh(glass.toGeometry(), clearGlassMaterial());
      m.name = 'gk:glass'; m.renderOrder = 3; m.matrixAutoUpdate = false; m.updateMatrix();
      out.push(m);
    }
    return out;
  }
  /** Distance-culled LOD at `center` (world geometry stays in world coordinates). */
  build(name: string, center: V2, cullDist: number, far?: THREE.Object3D): THREE.LOD {
    const near = new THREE.Group();
    near.name = `${name}:near`;
    for (const m of this.meshes()) near.add(m);
    near.position.set(-center[0], 0, -center[1]);
    const lod = new THREE.LOD();
    lod.name = name;
    lod.position.set(center[0], 0, center[1]);
    lod.addLevel(near, 0);
    const farObj = far ?? new THREE.Object3D();
    farObj.position.set(-center[0], 0, -center[1]);
    lod.addLevel(farObj, cullDist);
    this.kit.group.add(lod);
    return lod;
  }
}
