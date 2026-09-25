import * as THREE from 'three';
import { GeoBuffer } from '../buildings';
import type { DetailKey, WorldKit } from '../kit';
import { planterCube } from '../landscape';
import type { V2 } from '../layout';

/** Oriented rectangle along a→b (plan), `thick` wide, shifted `offset` along the left normal (-dz, dx). */
export function segPoly(a: V2, b: V2, thick: number, offset = 0): V2[] {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  const nx = -dz / l, nz = dx / l;
  const o0 = offset - thick / 2, o1 = offset + thick / 2;
  return [[a[0] + nx * o0, a[1] + nz * o0], [b[0] + nx * o0, b[1] + nz * o0], [b[0] + nx * o1, b[1] + nz * o1], [a[0] + nx * o1, a[1] + nz * o1]];
}

export const rect = (x0: number, z0: number, x1: number, z1: number): V2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/**
 * A planter cube standing on a raised floor (L1). landscape.ts `planterCube` registers its collision cylinder from the
 * ground up, which would plant a solid pillar through the enterable ground floor under the Quad; re-base it on `y`.
 */
export function raisedPlanter(kit: WorldKit, x: number, z: number, size: number, y: number): void {
  const col = kit.collision, n = col.cyls.length;
  planterCube(kit, x, z, size, y);
  for (let i = n; i < col.cyls.length; i++) { col.cyls[i].base = y; col.cyls[i].height = size; }
}

const _cam = new THREE.Vector3();
/** LOD whose detailed level is chosen by a predicate on the camera position (the renderer calls update() per frame). */
class ZoneLOD extends THREE.LOD {
  constructor(private pred: (cam: THREE.Vector3) => boolean) { super(); }
  override update(camera: THREE.Camera): void {
    if (this.levels.length < 2) return;
    _cam.setFromMatrixPosition(camera.matrixWorld);
    const vis = this.pred(_cam);
    this.levels[0].object.visible = vis;
    this.levels[1].object.visible = !vis;
  }
}

/** Always-on light panels (unlit, slightly over-bright so they read as lamps in daylight and bloom at night). */
let lightMat: THREE.MeshBasicMaterial | null = null;
export function interiorLightMaterial(): THREE.MeshBasicMaterial {
  return (lightMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.44, 1.32), toneMapped: true }));
}
/**
 * White panel false ceilings in lit rooms. A down-facing surface only gets the brownish ground bounce of the sky light,
 * so the ceilings read tan; a small emissive term stands in for the light the tube lights throw up onto them.
 */
let ceilMat: THREE.MeshStandardMaterial | null = null;
export function ceilingPanelMaterial(): THREE.MeshStandardMaterial {
  return (ceilMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, emissive: new THREE.Color(0.36, 0.36, 0.35) }));
}
/** See-through glazing for real openings (the kit's 'glass' key is opaque, facade-style). */
let clearGlass: THREE.MeshStandardMaterial | null = null;
export function clearGlassMaterial(): THREE.MeshStandardMaterial {
  return (clearGlass ??= new THREE.MeshStandardMaterial({ color: 0xaec2cc, roughness: 0.04, metalness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
}

/**
 * Interior floors lie a few cm over the campus ground planes, which carry negative polygon offsets; far away and at a
 * grazing angle those offsets win and the pavers showed through. Floors therefore use a clone of the kit material (same
 * shader program: onBeforeCompile and the program cache key are shared) with a stronger offset.
 */
const floorMats = new WeakMap<THREE.Material, THREE.Material>();
function floorMaterial(src: THREE.Material): THREE.Material {
  let m = floorMats.get(src);
  if (!m) {
    m = src.clone();
    m.onBeforeCompile = src.onBeforeCompile;
    m.customProgramCacheKey = src.customProgramCacheKey;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -4;
    m.polygonOffsetUnits = -4;
    floorMats.set(src, m);
  }
  return m;
}

/**
 * Small merged-geometry builder for a self-contained group (interiors, the parking): one buffer per kit material key
 * plus floors, light panels and clear glass. `build()` returns a THREE.LOD that shows the detailed group near the camera
 * and `far` (optional cheap stand-in) beyond `cullDist`, so interiors cost nothing when the camera is away.
 */
export class GroupKit {
  bufs = new Map<string, GeoBuffer>();
  floors = new Map<string, GeoBuffer>();
  lights = new GeoBuffer();
  glass = new GeoBuffer();
  ceil = new GeoBuffer({ color: true });
  constructor(public kit: WorldKit) {}
  b(key: DetailKey): GeoBuffer {
    let g = this.bufs.get(key);
    if (!g) this.bufs.set(key, (g = new GeoBuffer({ color: true })));
    return g;
  }
  /** Buffer for floors laid over the campus ground (drawn with a polygon offset, see floorMaterial). */
  fb(key: DetailKey): GeoBuffer {
    let g = this.floors.get(key);
    if (!g) this.floors.set(key, (g = new GeoBuffer({ color: true })));
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
    for (const [k, g] of this.floors) add(g, floorMaterial(this.kit.material(k)), `gk:floor:${k}`, true);
    add(this.ceil, ceilingPanelMaterial(), 'gk:ceil', true);
    add(this.lights, interiorLightMaterial(), 'gk:lights', false);
    const glass = this.glass.vertexCount ? this.glass : null;
    if (glass) {
      const m = new THREE.Mesh(glass.toGeometry(), clearGlassMaterial());
      m.name = 'gk:glass'; m.renderOrder = 3; m.matrixAutoUpdate = false; m.updateMatrix();
      out.push(m);
    }
    return out;
  }
  /**
   * Distance-culled LOD at `center` (world geometry stays in world coordinates). With `visibleWhen`, the detailed group
   * is shown only while the predicate holds for the camera position instead (e.g. only on the ground storey near a wing).
   */
  build(name: string, center: V2, cullDist: number, far?: THREE.Object3D, visibleWhen?: (cam: THREE.Vector3) => boolean): THREE.LOD {
    const near = new THREE.Group();
    near.name = `${name}:near`;
    for (const m of this.meshes()) near.add(m);
    near.position.set(-center[0], 0, -center[1]);
    const lod = visibleWhen ? new ZoneLOD(visibleWhen) : new THREE.LOD();
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
