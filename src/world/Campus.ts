import * as THREE from 'three';
import osmJson from './data/osm.json';
import { StaticCollision } from '../sim/Collision';
import { addLedges, addLedgesAt, extrudeBuilding, GeoBuffer, roofClutter } from './buildings';
import { distToSegment, hash2, normalizeWinding, pointInPoly, polyBounds, polyCentroid, polylineToStrip, rng, samplePolyline, scatterInPolygon } from './geom';
import { buildGJBC } from './gjbc';
import { Chunked, col, WorldKit } from './kit';
import { buildLandscape } from './landscape';
import {
  AREAS, BUILDINGS, CAMPUS_BOUNDS, GLOBE_POS, MAIN_GATE_X, MRD_DRUM, NO_TREE_ZONES, ORR, ORR_NORMAL, orrPoint, PATHS, PLAZA_TERRACE, QUAD, ROADS, WALLS,
  type BuildingDef, type FacadeStyle, type V2,
} from './layout';
import { asphaltMaterial, barcodePaverTexture, facadeMaterial, FACADE_STYLES, greyPaverTexture, pbrMaterial, radialTexture, setLampLights, worldUniforms, type WorldTextures } from './materials';
import { drawSigns, type SignUVs } from './signs';
import { TreeSystem, type TreeSpecies } from './trees';
import { lawnBlades, lawnMaterial } from './vegetation/lawn';
import { buildLandmarksAll, type GateVisual } from './landmarks';

const osm = osmJson as unknown;

interface OsmData {
  buildings: { id: number; levels: number; seed: number; pts: V2[] }[];
  roads: { kind: string; name: string; width: number; pts: V2[]; layer: number; bridge: boolean }[];
}

const GX = MAIN_GATE_X;
/** The playable campus ground (inside the compound walls). The main gate line is the edge (GX,−120.6)→(GX,−144.6). */
export const CAMPUS_GROUND: V2[] = [
  [GX, -144.6], [GX - 1, -151.61], [150, -158.8], [107.2, -180.2], [70, -199], [42, -214], [26, -221], [-4, -220], [-46, -215], [-72, -205],
  // east side: around the HPC lab / food point, then along the 2-wheeler parking's back wall (layout.ts PARKING.backX) to the gate building
  [-72, 142], [80, 142], [80, 86], [127.8, 62], [154, 12], [154, -30.3], [137.72, -30.3], [137.72, -110.8], [156.2, -110.8], [156.2, -120.5], [GX, -120.6],
];

export interface LampInfo { pos: THREE.Vector3; }

export interface CampusBuild {
  group: THREE.Group;
  collision: StaticCollision;
  lamps: LampInfo[];
  /**
   * Breakable gates. `panels` are the moving leaves (main gate: [OUT leaf (north lane), IN leaf (south lane)]),
   * `prismIds` their collision prisms (tag `gate:<id>`). `openOffset` is the unit direction along the gate line;
   * `openOffsets` (optional) gives a per-leaf slide vector (each leaf slides away from the median into its pillar).
   */
  gates: Map<string, GateVisual>;
  roadPolys: V2[][];
  lawnPolys: V2[][];
  updatables: ((dt: number, t: number) => void)[];
}

function flatPolyGeometry(poly: V2[], y: number, uvScale: number): THREE.BufferGeometry {
  const b = new GeoBuffer();
  b.flatPoly(poly, y, undefined, uvScale);
  return b.toGeometry();
}

/** Strip along a polyline as a flat ribbon (roads / paths). along=true: u runs along the path (metres/uvScale), v across. */
function addStrip(buf: GeoBuffer, pts: V2[], width: number, y: number, uvScale: number, along = false): V2[] {
  const { left, right } = polylineToStrip(pts, width);
  const base = buf.vertexCount;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (along) {
      buf.vert(left[i][0], y, left[i][1], 0, 1, 0, s / uvScale, 0);
      buf.vert(right[i][0], y, right[i][1], 0, 1, 0, s / uvScale, width / uvScale);
    } else {
      buf.vert(left[i][0], y, left[i][1], 0, 1, 0, left[i][0] / uvScale, -left[i][1] / uvScale);
      buf.vert(right[i][0], y, right[i][1], 0, 1, 0, right[i][0] / uvScale, -right[i][1] / uvScale);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = base + i * 2;
    const l0 = left[i], r0 = right[i], r1 = right[i + 1];
    const cross = (r0[0] - l0[0]) * (r1[1] - l0[1]) - (r0[1] - l0[1]) * (r1[0] - l0[0]);
    if (cross < 0) buf.quad(a, a + 1, a + 3, a + 2); else buf.quad(a, a + 2, a + 3, a + 1);
  }
  return [...left, ...right.slice().reverse()];
}

export class CampusBuilder {
  private group = new THREE.Group();
  private collision = new StaticCollision();
  private lamps: LampInfo[] = [];
  private roadPolys: V2[][] = [];
  private lawnPolys: V2[][] = [];
  private gates: CampusBuild['gates'] = new Map();
  private kit!: WorldKit;
  private signs!: SignUVs;
  /** Points along an entry-road lane divider (angle-parked scooters). The 2026 entry road has no divider: stays empty. */
  medianPts: V2[] = [];

  constructor(private tex: WorldTextures, private trees: TreeSystem, private quality: { treeDensity: number; viewDistance: number }) {}

  /** Per-stage build timings (ms), for profiling. */
  timings: Record<string, number> = {};

  build(): CampusBuild {
    this.group.name = 'campus';
    let t = performance.now();
    const lap = (k: string) => { const n = performance.now(); this.timings[k] = Math.round(n - t); t = n; };
    this.kit = new WorldKit(this.group, this.collision, this.tex);
    this.kit.addTree = (sp, x, z, s, collide = true) => this.addTree(sp, x, z, s, collide);
    const bSigns = BUILDINGS.filter((b) => b.sign).map((b) => ({ id: b.id, text: b.sign!.text, sub: b.sign!.sub, color: b.sign!.color ?? '#1f2b45' }));
    this.signs = drawSigns(this.kit.atlas, bSigns);
    lap('signs');
    this.buildGround(); lap('ground');
    this.buildRoads(); lap('roads');
    this.buildORR(); lap('orr');
    this.buildBuildings(); lap('buildings');
    this.buildWalls(); lap('walls');
    buildLandmarksAll(this.kit, this.signs, this.gates); lap('landmarks');
    buildGJBC(this.kit, this.signs); lap('gjbc');
    buildLandscape(this.kit); lap('landscape');
    this.buildLamps(); lap('lamps');
    this.placeTrees(); lap('treePlacement');
    this.kit.flush(); lap('flush');
    this.group.add(this.trees.build({ viewDistance: this.quality.viewDistance })); lap('trees');
    return { group: this.group, collision: this.collision, lamps: this.lamps, gates: this.gates, roadPolys: this.roadPolys, lawnPolys: this.lawnPolys, updatables: this.kit.updatables };
  }

  // -----------------------------------------------------------------------------------------------
  private buildGround(): void {
    const t = this.tex;
    // outside: red Bengaluru earth
    const soilMat = pbrMaterial(t.soil, { color: 0xc8b8a8, macro: 0.8, macroScale: 0.03, macroTint: new THREE.Color(0.7, 0.6, 0.5) });
    const size = 1600;
    const soilGeo = new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2);
    const uv = soilGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 5, uv.getY(i) * size / 5);
    const soil = new THREE.Mesh(soilGeo, soilMat);
    soil.position.set(60, 0, -40);
    soil.receiveShadow = true;
    soil.matrixAutoUpdate = false; soil.updateMatrix();
    this.group.add(soil);

    // campus paved ground (interlocking pavers)
    const paverMat = pbrMaterial(t.pavers, { color: 0xd9d4cc, macro: 0.6, macroScale: 0.04, normalScale: 0.8 });
    paverMat.polygonOffset = true; paverMat.polygonOffsetFactor = -1; paverMat.polygonOffsetUnits = -1;
    const campus = new THREE.Mesh(flatPolyGeometry(CAMPUS_GROUND, 0.02, 2.2), paverMat);
    campus.receiveShadow = true;
    campus.matrixAutoUpdate = false; campus.updateMatrix();
    this.group.add(campus);

    const off = (m: THREE.Material, f: number) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f; return m; };
    const grassMat = off(lawnMaterial(t.grass), -2); // NATURE: turf texture + anti-tiling (vegetation/lawn.ts)
    const concMat = off(pbrMaterial(t.concrete, { color: 0xcfc9c0, macro: 0.5, macroScale: 0.05 }), -2);
    const paver2 = off(pbrMaterial(t.pavers, { color: 0xd4cec4, macro: 0.5, macroScale: 0.05 }), -2);
    const barcodeMap = barcodePaverTexture();
    const barcodeMat = off(new THREE.MeshStandardMaterial({ map: barcodeMap, roughness: 0.7, normalMap: t.pavers.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) }), -3);
    const greyMap = greyPaverTexture();
    const greyMat = off(new THREE.MeshStandardMaterial({ map: greyMap, roughness: 0.78 }), -3);
    const marbleMat = off(new THREE.MeshStandardMaterial({ color: 0x5f7468, roughness: 0.18, metalness: 0.05 }), -2);
    const bufs = new Map<string, { buf: GeoBuffer; mat: THREE.Material }>();
    const get = (k: string, mat: THREE.Material) => { let e = bufs.get(k); if (!e) bufs.set(k, (e = { buf: new GeoBuffer(), mat })); return e.buf; };
    const pathIds = new Set(PATHS.map((p) => p.id));
    for (const a of AREAS) {
      if (a.id && pathIds.has(a.id)) continue;
      switch (a.kind) {
        case 'lawn': get('lawn', grassMat).flatPoly(a.poly, 0.045, undefined, 3.5); this.lawnPolys.push(a.poly); break;
        case 'concrete': get('conc', concMat).flatPoly(a.poly, 0.04, undefined, 4); break;
        case 'granite': this.kit.buf('polished', polyCentroid(a.poly)[0], polyCentroid(a.poly)[1]).flatPoly(a.poly, 0.045, col('#aeafab'), 2); break;
        case 'plaza': get('barcode', barcodeMat).flatPoly(a.poly, 0.05, undefined, 6); break;
        case 'greypaver': get('grey', greyMat).flatPoly(a.poly, 0.05, undefined, 6); break;
        case 'marble': get('marble', marbleMat).flatPoly(a.poly, 0.05, undefined, 2); break;
        default: get('paver', paver2).flatPoly(a.poly, 0.04, undefined, 2.2); break;
      }
    }
    // pedestrian paths: pavers laid across the path (u along)
    for (const p of PATHS) {
      if (p.surface === 'plaza') addStrip(get('barcodePath', barcodeMat), p.pts, p.width, 0.055, 6, true);
      else if (p.surface === 'greypaver') addStrip(get('greyPath', greyMat), p.pts, p.width, 0.055, 6, true);
      else addStrip(get('paverPath', paver2), p.pts, p.width, 0.05, 2.2);
    }
    for (const [k, e] of bufs) {
      const m = new THREE.Mesh(e.buf.toGeometry(), e.mat);
      m.receiveShadow = true; m.name = `ground:${k}`;
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.group.add(m);
    }
    // NATURE: short grass tufts around the camera on the lawns (high / ultra)
    if (this.quality.viewDistance >= 500) {
      const blades = lawnBlades(this.lawnPolys, { paths: PATHS });
      if (blades) this.group.add(blades);
    }
  }

  // -----------------------------------------------------------------------------------------------
  private buildRoads(): void {
    const t = this.tex;
    // weathered pale asphalt; strips use along-road UVs (u = s / width, v = 0..1 across) for lane-aware wear
    const asphaltMat = asphaltMaterial(t.asphaltFine, t.asphaltMacro, { lanes: 2 });
    asphaltMat.polygonOffset = true; asphaltMat.polygonOffsetFactor = -4; asphaltMat.polygonOffsetUnits = -4;
    const asphalt = new Chunked({}, 256);
    const strips: V2[][] = [];
    for (const r of ROADS) {
      const c = polyCentroid(r.pts);
      const strip = addStrip(asphalt.get('road', c[0], c[1]), r.pts, r.width, 0.06, r.width, true);
      strips.push(strip);
      this.roadPolys.push(strip);
    }
    // gate aprons (inside flare + outside link to the ORR service road)
    const aprons: V2[][] = [
      [[GX, -141.4], [GX, -122.4], [GX - 8, -123.6], [GX - 16, -124.8], [GX - 18, -125.4], [GX - 18, -137.2], [GX - 10, -139.6]],
      [[GX, -141.4], [GX, -122.4], [184, -122.2], [196, -126.2], [206, -131.2], [192, -138.8], [183, -142.8], [172, -146.9], [GX, -146]],
    ];
    for (const ap of aprons) { asphalt.get('road', ap[0][0], ap[0][1]).flatPoly(ap, 0.061, undefined, 6); strips.push(ap); this.roadPolys.push(ap); }
    // kerbs: alternating black & white 0.5 m blocks (textured strip), broken where another road crosses
    const inOther = (x: number, z: number, self: number) => strips.some((s, i) => i !== self && pointInPoly(x, z, s));
    ROADS.forEach((r, ri) => {
      if (!r.kerb) return;
      for (const side of [-1, 1]) {
        const samples = samplePolyline(r.pts, 0.5, side * (r.width / 2 + 0.1), 0.25);
        let run: V2[] = [];
        const flush = () => { if (run.length > 1) this.kerbStrip(run); run = []; };
        for (const s of samples) {
          if (inOther(s.p[0], s.p[1], ri)) { flush(); continue; }
          run.push(s.p);
        }
        flush();
      }
    });
    // OSM neighbourhood roads (context), excluding those inside campus and the ORR (authored separately)
    for (const r of (osm as OsmData).roads) {
      if (r.kind === 'trunk' || r.kind === 'trunk_link' || r.bridge) continue;
      const inside = r.pts.filter(([x, z]) => pointInPoly(x, z, CAMPUS_GROUND)).length;
      if (inside > r.pts.length * 0.3) continue;
      const nearOrr = r.pts.every(([x, z]) => Math.abs((x - ORR.origin[0]) * ORR_NORMAL[0] + (z - ORR.origin[1]) * ORR_NORMAL[1]) < 30);
      if (nearOrr) continue;
      const c = polyCentroid(r.pts);
      const strip = addStrip(asphalt.get('road', c[0], c[1]), r.pts, r.width, 0.05, r.width, true);
      this.roadPolys.push(strip);
    }
    asphalt.build(this.group, () => asphaltMat, { cast: false, receive: true });
  }

  /** Black & white painted kerb along a polyline (0.2 m wide, 0.18 m tall, texture period 1 m). */
  private kerbStrip(pts: V2[], h = 0.18): void {
    const w = 0.2;
    const { left, right } = polylineToStrip(pts, w);
    const buf = this.kit.buf('kerb', pts[0][0], pts[0][1]);
    const white = col('#ffffff');
    let s = 0;
    const base = buf.vertexCount;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const d = i < pts.length - 1 ? [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]] : [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
      const l = Math.hypot(d[0], d[1]) || 1;
      const nx = -d[1] / l, nz = d[0] / l;
      // 4 verts per ring: left-bottom, left-top, right-top, right-bottom
      buf.vert(left[i][0], 0.02, left[i][1], nx, 0, nz, s, 0, white);
      buf.vert(left[i][0], h, left[i][1], 0, 1, 0, s, 0.5, white);
      buf.vert(right[i][0], h, right[i][1], 0, 1, 0, s, 0.5, white);
      buf.vert(right[i][0], 0.02, right[i][1], -nx, 0, -nz, s, 1, white);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 4, b = a + 4;
      // determine orientation with the top face normal
      const l0 = left[i], r0 = right[i], r1 = right[i + 1];
      const cross = (r0[0] - l0[0]) * (r1[1] - l0[1]) - (r0[1] - l0[1]) * (r1[0] - l0[0]);
      const flip = cross >= 0;
      const q = (p0: number, p1: number, p2: number, p3: number) => (flip ? buf.quad(p0, p3, p2, p1) : buf.quad(p0, p1, p2, p3));
      q(a + 1, a + 2, b + 2, b + 1); // top
      q(a + 0, a + 1, b + 1, b + 0); // left side
      q(a + 2, a + 3, b + 3, b + 2); // right side
    }
  }

  // -----------------------------------------------------------------------------------------------
  private buildORR(): void {
    const asphaltMat = asphaltMaterial(this.tex.asphaltFine, this.tex.asphaltMacro, { lanes: 3, color: new THREE.Color(0.12, 0.117, 0.112) });
    asphaltMat.polygonOffset = true; asphaltMat.polygonOffsetFactor = -4; asphaltMat.polygonOffsetUnits = -4;
    const t0 = -430, t1 = 330;
    const line = (off: number): V2[] => { const pts: V2[] = []; for (let t = t0; t <= t1; t += 40) pts.push(orrPoint(t, off)); return pts; };
    const buf = new GeoBuffer();
    const halfMain = (ORR.width - ORR.median) / 2;
    const off1 = ORR.median / 2 + halfMain / 2;
    for (const off of [off1, -off1]) this.roadPolys.push(addStrip(buf, line(off), halfMain, 0.06, halfMain, true));
    for (const off of [ORR.serviceOffset, -ORR.serviceOffset]) this.roadPolys.push(addStrip(buf, line(off), ORR.serviceWidth, 0.06, ORR.serviceWidth, true));
    const road = new THREE.Mesh(buf.toGeometry(), asphaltMat);
    road.receiveShadow = true;
    road.matrixAutoUpdate = false; road.updateMatrix();
    this.group.add(road);

    const white = col('#eeeeea'), yellow = col('#e0b020'), conc = col('#b8b4ac');
    const marks = this.kit;
    const rot = Math.atan2(-ORR.dir[1], ORR.dir[0]);
    for (let t = t0; t < t1; t += 9) {
      for (const lane of [1, 2]) for (const s of [1, -1]) {
        const off = s * (ORR.median / 2 + (halfMain / 3) * lane);
        const p = orrPoint(t, off);
        marks.box('dark', p[0], 0.075, p[1], 3, 0.01, 0.15, rot, white, 0);
      }
    }
    for (const s of [1, -1]) {
      for (let t = t0; t < t1; t += 95) {
        const a = orrPoint(t, s * (ORR.median / 2 + 0.3)), b = orrPoint(Math.min(t1, t + 95), s * (ORR.median / 2 + 0.3));
        marks.segBox('dark', a, b, 0.07, 0.08, 0.15, yellow, 0, 0, 0);
      }
    }
    const metro = this.kit;
    for (let t = t0; t < t1; t += 20) {
      const p = orrPoint(t + 10, 0);
      metro.box('concrete', p[0], 0.5, p[1], 20, 1.0, 0.6, rot, conc, 0.5);
    }
    const r = rng(77);
    for (let t = t0 + 10; t < t1; t += 28) {
      const p = orrPoint(t, 0);
      metro.buf('concrete', p[0], p[1]).cylinder(p[0], 0, p[1], 0.95, 10.5, 12, conc, false);
      metro.box('concrete', p[0], 11.2, p[1], 2.4, 1.5, 7.5, rot + Math.PI / 2, conc, 0.5);
      this.collision.addCircle(p[0], p[1], 1.0, 12, 'concrete', 'pier');
      if (t < 150 && r() > 0.25) {
        const q = orrPoint(t + 14, 0);
        metro.box('concrete', q[0], 12.9, q[1], 27.4, 1.9, 8.5, rot, conc, 0.5);
      }
    }
    // green construction mesh barriers along the service road (Namma Metro works)
    const green = col('#2f8a4a'), steel = col('#777777');
    for (let t = -150; t < 260; t += 3) {
      if (r() < 0.12) continue;
      const p = orrPoint(t, ORR.serviceOffset + ORR.serviceWidth / 2 + 1.2);
      metro.box('dark', p[0], 1.0, p[1], 2.8, 1.8, 0.04, rot, green, 0.5);
      metro.box('metal', p[0], 0.95, p[1], 0.06, 1.9, 0.06, rot, steel, 0.5);
    }
    for (let t = -300; t < 280; t += 13) {
      for (const s of [1, -1]) {
        if (r() < 0.25) continue;
        const off = s * (ORR.width / 2 + (Math.abs(ORR.serviceOffset) - ORR.width / 2) / 2 + (r() - 0.5));
        const p = orrPoint(t + r() * 5, off);
        const sp: TreeSpecies = r() < 0.6 ? 'rain' : r() < 0.5 ? 'gulmohar' : 'copperpod';
        this.addTree(sp, p[0], p[1], 0.85 + r() * 0.35);
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  private buildBuildings(): void {
    const t = this.tex;
    const facades = new Chunked({ facade: true });
    const houseFacades = new Chunked({ facade: true, color: true }, 256);
    const houseRoofs = new Chunked({}, 256);
    const roofs = new Chunked({});
    const soffits = new Chunked({});
    const cabins = new Chunked({ color: true }, 256);
    const tanks: THREE.Matrix4[] = [];
    const solar: THREE.Matrix4[] = [];

    const buildOne = (b: BuildingDef, seed: number) => {
      const floorH = b.floorH ?? 3.7;
      const base = b.base ?? 0;
      const top = b.top ?? floorH * b.floors;
      const height = top - base;
      const parapet = b.roof?.parapet ?? (b.style === 'service' ? 0.6 : base > 0 && base < 10 && b.style !== 'gjbc' && b.style !== 'gjbcQuad' ? 0.6 : 1.1);
      const c = polyCentroid(b.poly);
      extrudeBuilding(b.poly, { base, height, floorH, floors: b.floors, seed, parapet, bottom: base > 0 }, facades.get(b.style, c[0], c[1]), roofs.get('roof', c[0], c[1]), soffits.get(b.soffit ?? 'grey', c[0], c[1]));
      const ledge = this.kit.buf('stone', c[0], c[1]);
      if (b.style === 'hostel') addLedges(b.poly, base, floorH, b.floors - 1, 0.45, 0.22, ledge, FACADE_STYLES.hostel.band);
      else if (b.style === 'fWing') addLedges(b.poly, base, floorH, b.floors - 1, 0.55, 0.18, ledge, col('#e2d4b8'));
      else if (b.style === 'oldCream') addLedges(b.poly, base, floorH, b.floors - 1, 0.5, 0.15, ledge, col('#e6e1d8'));
      if (b.style === 'fTower' || b.style === 'fPodium' || b.style === 'fWing') addLedgesAt(b.poly, [top + 0.2], 0.8, 0.7, ledge, b.style === 'fWing' ? col('#b8604a') : col('#9e4a38'));
      if (b.style === 'mrd') addLedgesAt(b.poly, [top + 0.1], 1.0, 0.45, ledge, col('#1f2b45'), 3);
      if (base === 0 && b.roof) roofClutter(b.poly, top, seed, b.roof, tanks, solar, cabins.get('cabin', c[0], c[1]), col('#e2ddd2'));
      if (b.roof?.skylights) {
        for (const [sx, sz, sw, sd] of b.roof.skylights) {
          const skyBuf = roofs.get('skylight', sx, sz);
          for (let k = 0; k < Math.floor(sd / 2); k++) skyBuf.box(sx + sw / 2, top + 0.5, sz + k * 2 + 1, sw, 1.0, 1.7, 0, undefined, 0.5);
        }
      }
      if (b.collide !== false) this.collision.addPolygon(b.poly, height + parapet, 'concrete', `bld:${b.id}`, base);
      if (b.sign) this.buildingSign(b, top);
    };
    BUILDINGS.forEach((b, i) => buildOne(b, i * 17 + 3));

    // MRD octagonal auditorium drum
    {
      const d = MRD_DRUM;
      const poly: V2[] = [];
      for (let i = 0; i < d.sides; i++) {
        const a = (i / d.sides) * Math.PI * 2 + Math.PI / 8;
        poly.push([d.center[0] + Math.cos(a) * d.radius, d.center[1] + Math.sin(a) * d.radius]);
      }
      extrudeBuilding(poly, { base: 0, height: d.height, floorH: 4.5, floors: 6, seed: 991, parapet: 0.8 }, facades.get('glass', d.center[0], d.center[1]), roofs.get('roof', d.center[0], d.center[1]));
      this.collision.addPolygon(poly, d.height, 'concrete', 'bld:mrd_drum');
    }

    // OSM neighbourhood houses (colourful apartment blocks beyond the walls)
    const palette = ['#f2f2ee', '#e9d38c', '#5fc18e', '#9ccfe0', '#e39a7e', '#f4c7c3', '#fbfaf5', '#f5e3bd', '#dccbe9', '#f4efe2', '#e4e4e4', '#b9dcc4'].map((h) => new THREE.Color(h));
    const orrDist = (x: number, z: number) => Math.abs((x - ORR.origin[0]) * ORR_NORMAL[0] + (z - ORR.origin[1]) * ORR_NORMAL[1]);
    for (const h of (osm as OsmData).buildings) {
      const c = polyCentroid(h.pts);
      if (pointInPoly(c[0], c[1], CAMPUS_GROUND)) continue;
      if (h.pts.some(([x, z]) => orrDist(x, z) < Math.abs(ORR.serviceOffset) + ORR.serviceWidth / 2 + 2)) continue;
      if (h.pts.some(([x, z]) => pointInPoly(x, z, CAMPUS_GROUND))) continue;
      // keep the gate forecourt clear
      if (c[0] > GX - 2 && c[0] < 222 && c[1] > -152 && c[1] < -118) continue;
      const floorH = 3.1;
      const levels = h.levels;
      // collision for every house (quality-independent sim); visuals only within the view distance
      this.collision.addPolygon(h.pts, floorH * levels + 0.9, 'concrete', 'house');
      const dist = Math.hypot(c[0] - 50, c[1] + 40);
      if (dist > this.quality.viewDistance * 0.9) continue;
      const r = rng(h.seed);
      const color = palette[Math.floor(r() * palette.length)];
      extrudeBuilding(h.pts, { base: 0, height: floorH * levels, floorH, floors: levels, seed: h.seed % 997, parapet: 0.9, color }, houseFacades.get('house', c[0], c[1]), houseRoofs.get('roofHouse', c[0], c[1]));
      if (levels >= 2 && r() < 0.8) roofClutter(h.pts, floorH * levels, h.seed, { tanks: 1 + Math.floor(r() * 2) }, tanks, solar, cabins.get('cabin', c[0], c[1]), color.clone().multiplyScalar(0.95));
    }

    const styleMats = new Map<string, THREE.Material>();
    const matFor = (key: string): THREE.Material => {
      let m = styleMats.get(key);
      if (!m) styleMats.set(key, (m = facadeMaterial(key as FacadeStyle | 'house', t.plaster, t.brick)));
      return m;
    };
    facades.build(this.group, matFor, { cast: true, receive: true });
    houseFacades.build(this.group, matFor, { cast: true, receive: true });
    const roofMat = pbrMaterial(t.concrete, { color: new THREE.Color(0xc9c4ba).multiplyScalar(1.9), macro: 0.5, macroScale: 0.1 });
    const roofHouseMat = pbrMaterial(t.concrete, { color: 0xb4ada2, macro: 0.7, macroScale: 0.1 });
    const skylightMat = new THREE.MeshStandardMaterial({ color: 0x2a3d4f, roughness: 0.1, metalness: 0.8 });
    roofs.build(this.group, (k) => (k === 'skylight' ? skylightMat : roofMat), { cast: true, receive: true });
    houseRoofs.build(this.group, () => roofHouseMat, { cast: true, receive: true });
    const soffitMats: Record<string, THREE.Material> = {
      wood: pbrMaterial(t.plaster, { color: 0x6b4a36, roughness: 0.6, normalScale: 0.2 }),
      red: pbrMaterial(t.plaster, { color: 0x7e4a34, roughness: 0.6, normalScale: 0.2 }),
      grey: pbrMaterial(t.concrete, { color: 0xbab8b2, roughness: 0.8 }),
    };
    soffits.build(this.group, (k) => soffitMats[k] ?? soffitMats.grey, { cast: false, receive: true });
    cabins.build(this.group, () => { const m = pbrMaterial(t.plaster, { roughness: 0.9 }); m.vertexColors = true; return m; }, { cast: true, receive: true });

    const tankGeo = new THREE.CylinderGeometry(1, 0.94, 1, 12, 1).translate(0, 0.5, 0);
    const tankMesh = new THREE.InstancedMesh(tankGeo, new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.55 }), tanks.length);
    tanks.forEach((m, i) => tankMesh.setMatrixAt(i, m));
    tankMesh.castShadow = true; tankMesh.receiveShadow = true;
    tankMesh.computeBoundingSphere();
    this.group.add(tankMesh);
    if (solar.length) {
      const solarMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.2, metalness: 0.7 }), solar.length);
      solar.forEach((m, i) => solarMesh.setMatrixAt(i, m));
      solarMesh.castShadow = true;
      solarMesh.computeBoundingSphere();
      this.group.add(solarMesh);
    }
  }

  private buildingSign(b: BuildingDef, top: number): void {
    const s = b.sign!;
    const uv = this.signs.building.get(b.id);
    if (!uv) return;
    const p = normalizeWinding(b.poly);
    const orig = b.poly;
    const oa = orig[s.edge % orig.length], ob = orig[(s.edge + 1) % orig.length];
    const mid: V2 = [(oa[0] + ob[0]) / 2, (oa[1] + ob[1]) / 2];
    let best = 0, bd = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      const d = Math.hypot((a[0] + c[0]) / 2 - mid[0], (a[1] + c[1]) / 2 - mid[1]);
      if (d < bd) { bd = d; best = i; }
    }
    const a = p[best], c = p[(best + 1) % p.length];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    const nx = -dz / len, nz = dx / len;
    const w = Math.min(len * 0.8, s.text.length * 1.0 + 2);
    const h = s.sub ? w * 0.25 : w * 0.17;
    const y = Math.max(top - h / 2 - 0.4, h / 2 + 2.6);
    const o = 0.06 + (s.offset ?? 0) * 0.1;
    this.kit.signQuad(uv, (a[0] + c[0]) / 2 + nx * o, y, (a[1] + c[1]) / 2 + nz * o, w, h, nx, nz, true);
  }

  // -----------------------------------------------------------------------------------------------
  private buildWalls(): void {
    const stoneMat = pbrMaterial(this.tex.stone, { color: 0xb3ada4, macro: 0.4 });
    const plasterMat = pbrMaterial(this.tex.plaster, { color: 0xf2f0ea });
    const hoardMat = new THREE.MeshStandardMaterial({ map: this.hoardingTexture(), roughness: 0.6, metalness: 0.3 });
    const copingMat = pbrMaterial(this.tex.concrete, { color: 0xd8d4cc });
    const stone = new GeoBuffer(), plaster = new GeoBuffer(), hoard = new GeoBuffer(), coping = new GeoBuffer(), corten = new GeoBuffer({ color: true });
    for (const w of WALLS) {
      for (let i = 1; i < w.pts.length; i++) {
        const a = w.pts[i - 1], b = w.pts[i];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        const rot = Math.atan2(-dz, dx);
        const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
        if (w.kind === 'corten') {
          // rust panels + green mesh panels (texture), both faces, dark cap
          corten.wallQuad(a, b, 0, w.height, col('#ffffff'), 1, true);
          const nx = -dz / len, nz = dx / len;
          for (const s of [0.16, -0.16]) corten.wallQuad([a[0] + nx * s, a[1] + nz * s], [b[0] + nx * s, b[1] + nz * s], 0, w.height, col('#ffffff'), 1, true);
          this.kit.segBox('metal', a, b, w.height, w.height + 0.08, 0.4, col('#2a211b'));
          this.collision.addSegment(a, b, 0.4, w.height + 0.2, 'metal', 'wall');
          continue;
        }
        const buf = w.kind === 'stone' ? stone : w.kind === 'hoarding' ? hoard : plaster;
        const th = w.kind === 'hoarding' ? 0.12 : 0.45;
        buf.box(cx, w.height / 2, cz, len + th, w.height, th, rot, undefined, w.kind === 'stone' ? 0.5 : 0.33);
        if (w.kind !== 'hoarding') coping.box(cx, w.height + 0.06, cz, len + 0.6, 0.12, 0.6, rot, undefined, 0.5);
        if (w.kind === 'hoarding') this.collision.addSegment(a, b, 0.4, w.height + 0.2, 'metal', 'wall');
        else {
          // walkable top at the coping; WALLS run with the outside on the left, so (−dz, dx) is the outward normal
          const id = this.collision.addSegment(a, b, th, w.height + 0.12, 'concrete', 'boundary');
          this.collision.setLip(id, -dz / len, dx / len);
        }
        if (w.kind === 'stone') {
          const n = Math.floor(len / 4);
          for (let k = 0; k <= n; k++) {
            const f = n ? k / n : 0;
            buf.box(a[0] + dx * f, w.height / 2 + 0.1, a[1] + dz * f, 0.7, w.height + 0.2, 0.7, rot, undefined, 0.5);
          }
        }
      }
    }
    const cortenMat = this.kit.material('corten') as THREE.MeshStandardMaterial;
    cortenMat.map!.repeat.set(1 / 6, 1 / 3.2);
    for (const [buf, mat] of [[stone, stoneMat], [plaster, plasterMat], [hoard, hoardMat], [coping, copingMat], [corten, cortenMat]] as [GeoBuffer, THREE.Material][]) {
      if (!buf.vertexCount) continue;
      const m = new THREE.Mesh(buf.toGeometry(), mat);
      m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.group.add(m);
    }
  }

  private hoardingTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2f6fa7'; g.fillRect(0, 0, 256, 128);
    for (let x = 0; x < 256; x += 8) { g.fillStyle = x % 16 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 4, 128); }
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 96, 256, 12);
    g.fillStyle = '#e4b21f'; g.fillRect(0, 108, 256, 20);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // -----------------------------------------------------------------------------------------------
  private buildLamps(): void {
    const pole = col('#3a3e43');
    const pools: THREE.Vector3[] = [];
    const place = (x: number, z: number, dirX: number, dirZ: number) => {
      if (this.collision.blocked(x, z, 0.45)) return;
      const b = this.kit.buf('metal', x, z);
      b.box(x, 3.2, z, 0.16, 6.4, 0.16, Math.atan2(-dirZ, dirX), pole);
      const hx = x + dirX * 1.0, hz = z + dirZ * 1.0;
      b.box((x + hx) / 2, 6.35, (z + hz) / 2, 1.1, 0.1, 0.1, Math.atan2(-dirZ, dirX), pole);
      b.box(hx, 6.28, hz, 0.7, 0.12, 0.3, Math.atan2(-dirZ, dirX), pole);
      this.kit.box('emissive', hx, 6.21, hz, 0.6, 0.02, 0.24, Math.atan2(-dirZ, dirX), col('#ffffff'));
      this.collision.addCircle(x, z, 0.12, 6.4, 'metal', 'lamp');
      const p = new THREE.Vector3(hx, 6.1, hz);
      this.lamps.push({ pos: p });
      pools.push(p);
    };
    for (const r of ROADS) {
      if (r.kind !== 'asphalt' || r.id === 'bus_bay') continue;
      for (const s of samplePolyline(r.pts, 24, r.width / 2 + 1.0, 6)) place(s.p[0], s.p[1], s.dir[1], -s.dir[0]);
    }
    for (const p of PATHS) {
      if (p.id === 'oat_footway') continue;
      const step = p.id === 'lawn_diagonal' ? 14 : 20;
      for (const s of samplePolyline(p.pts, step, p.width / 2 + 0.6, step / 2)) place(s.p[0], s.p[1], s.dir[1], -s.dir[0]);
    }
    for (let t = -80; t < 220; t += 30) {
      const p = orrPoint(t, ORR.serviceOffset - ORR.serviceWidth / 2 - 1.2);
      place(p[0], p[1], ORR_NORMAL[0], ORR_NORMAL[1]);
    }
    for (const p of this.kit.lampPoints) { this.lamps.push({ pos: p.clone() }); pools.push(p.clone()); }
    // lamp pools: baked into a world light map that every lit world material samples at night (materials.ts)
    setLampLights(pools);
  }

  // -----------------------------------------------------------------------------------------------
  /**
   * Tree: collision is always added (identical sim / nav at every quality level); only the visual instance is
   * thinned by `quality.treeDensity` (deterministic).
   */
  private addTree(sp: TreeSpecies, x: number, z: number, scale: number, collide = true): void {
    if (collide) this.collision.addCircle(x, z, this.trees.trunkRadius(sp, scale), 4, 'wood', 'tree');
    const keep = sp === 'palm' || sp === 'cloud' || sp === 'frangipani' || sp === 'sapling' || sp === 'maroon' || sp === 'ficus';
    if (!keep && hash2(x * 3.1, z * 2.7) > this.quality.treeDensity) return; // visual thinning only
    this.trees.add(sp, x, z, scale, hash2(x, z) * Math.PI * 2, this.treeBaseY(x, z));
  }

  /** Trees planted in raised planters / on terraces stand on them: top of the solid (ground-based, ≤ 4 m) prism under the trunk. */
  private treeBaseY(x: number, z: number): number {
    let y = 0;
    for (const P of this.collision.prisms) {
      if (!P.enabled || P.base > 0.2 || P.height < 0.25 || P.height > 4) continue;
      if (x < P.minX || x > P.maxX || z < P.minZ || z > P.maxZ || P.tag === 'tree' || P.tag.startsWith('gate')) continue;
      let inside = false;
      for (let i = 0, j = P.n - 1; i < P.n; j = i++) {
        const xi = P.pts[i * 2], zi = P.pts[i * 2 + 1], xj = P.pts[j * 2], zj = P.pts[j * 2 + 1];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) y = Math.max(y, P.base + P.height);
    }
    return y;
  }

  /** 1 m raster of road / path clearance used by tree placement (built lazily once). */
  private clearRaster: { minX: number; minZ: number; w: number; h: number; d: Uint8Array } | null = null;
  private roadClear(x: number, z: number): boolean {
    if (!this.clearRaster) {
      const minX = -330, minZ = -460, w = 760, h = 760;
      const d = new Uint8Array(w * h);
      const mark = (pts: V2[], rad: number) => {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.max(1, Math.ceil(len / 0.8));
          for (let k = 0; k <= n; k++) {
            const px = a[0] + (b[0] - a[0]) * (k / n), pz = a[1] + (b[1] - a[1]) * (k / n);
            const r = Math.ceil(rad);
            for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
              if (dx * dx + dz * dz > (rad + 0.5) * (rad + 0.5)) continue;
              const ix = Math.floor(px - minX) + dx, iz = Math.floor(pz - minZ) + dz;
              if (ix >= 0 && iz >= 0 && ix < w && iz < h) d[iz * w + ix] = 1;
            }
          }
        }
      };
      for (const r2 of ROADS) mark(r2.pts, r2.width / 2 + 1.2);
      for (const p of PATHS) mark(p.pts, p.width / 2 + 0.6);
      for (const r of (osm as OsmData).roads) if (!(r.kind === 'trunk' || r.kind === 'trunk_link' || r.bridge)) mark(r.pts, r.width / 2 + 0.5);
      for (const off of [ORR.serviceOffset, -ORR.serviceOffset]) mark([orrPoint(-430, off), orrPoint(330, off)], ORR.serviceWidth / 2 + 0.5);
      for (const s of [1, -1]) mark([orrPoint(-430, s * (ORR.median / 2 + (ORR.width - ORR.median) / 4)), orrPoint(330, s * (ORR.median / 2 + (ORR.width - ORR.median) / 4))], (ORR.width - ORR.median) / 4 + 0.5);
      this.clearRaster = { minX, minZ, w, h, d };
    }
    const R = this.clearRaster;
    const ix = Math.floor(x - R.minX), iz = Math.floor(z - R.minZ);
    if (ix < 0 || iz < 0 || ix >= R.w || iz >= R.h) return true;
    return R.d[iz * R.w + ix] === 0;
  }

  private clearForTree(x: number, z: number, r: number): boolean {
    if (x > QUAD.minX - 5 && x < QUAD.maxX + 5 && z > -118 && z < QUAD.maxZ) return false;
    if (NO_TREE_ZONES.some((p) => pointInPoly(x, z, p))) return false; // GJB: 2-wheeler parking floor + pool
    if (Math.hypot(x - 4.6, z + 121.6) < 10) return false; // keep the Open Air Theatre stage clear (MRD/BE)
    if (!this.roadClear(x, z)) return false;
    if (this.collision.blocked(x, z, r)) return false;
    return true;
  }

  private placeTrees(): void {
    const r = rng(4242);
    const tryTree = (sp: TreeSpecies, x: number, z: number, s: number, clear = 1.4) => { if (this.clearForTree(x, z, clear)) this.addTree(sp, x, z, s); };
    const cluster = (cx: number, cz: number, rad: number, n: number, pick: () => TreeSpecies, s0: number, s1: number, minD: number, seed: number) => {
      const poly: V2[] = [];
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; poly.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]); }
      for (const [x, z] of scatterInPolygon(poly, n, minD, seed, (x, z) => !this.clearForTree(x, z, 1.2) || !pointInPoly(x, z, CAMPUS_GROUND))) this.addTree(pick(), x, z, s0 + r() * (s1 - s0));
    };
    // yellow copperpods along the ring-road wall behind the PES Lawn
    for (const s of samplePolyline([[104, -176.5], [150, -154], [GX - 4, -149.6]], 9, 0, 4)) tryTree(r() < 0.75 ? 'copperpod' : 'rain', s.p[0] + (r() - 0.5), s.p[1] + (r() - 0.5), 0.85 + r() * 0.3);
    // big dense ficus at the gate (south side, over the shelter) and a rain tree by the north pillar
    this.addTree('ficus', 152, -113.5, 0.8);
    this.addTree('rain', GX - 5.5, -150.3, 0.9);
    // frangipani garden + east plaza planters
    cluster(87, -153, 7, 9, () => 'frangipani', 0.8, 1.15, 3.2, 81);
    for (const [x, z] of [[99, -147.8], [110.8, -147.8], [108.2, -141.5]] as V2[]) this.addTree('frangipani', x, z, 1.0, false);
    // PES Lawn: a garden grove under an almost closed canopy (Google satellite), not an open lawn: mature rain trees,
    // copperpods, gulmohars and ashokas with a few frangipani and palms, kept off the plaza terrace, its ramp and path
    // and the young trees along the promenade's north bed
    const pes = AREAS.find((a) => a.id === 'pes_lawn');
    const prom = PATHS.find((p) => p.id === 'pes_lawn_promenade');
    if (pes && prom) {
      const T = PLAZA_TERRACE;
      const avoid = (x: number, z: number) => (x > T.x0 - 2 && x < T.x1 + 2 && z < T.zS + 2 && z > T.ramp.zEnd - 1.5)
        || (Math.abs(x - 105.5) < 3.5 && z < T.zN)
        || prom.pts.some((_, i) => i > 0 && distToSegment(x, z, prom.pts[i - 1][0], prom.pts[i - 1][1], prom.pts[i][0], prom.pts[i][1]) < 6.5)
        || !this.clearForTree(x, z, 1.4) || !pointInPoly(x, z, CAMPUS_GROUND);
      const pick = (): TreeSpecies => { const v = r(); return v < 0.32 ? 'rain' : v < 0.52 ? 'copperpod' : v < 0.66 ? 'gulmohar' : v < 0.82 ? 'ashoka' : v < 0.92 ? 'frangipani' : 'palm'; };
      for (const [x, z] of scatterInPolygon(pes.poly, 48, 5.2, 91, avoid)) this.addTree(pick(), x, z, 0.72 + r() * 0.33);
    }
    // tiered "cloud" trees along the entry walkway (south side) and at the PES Lawn promenade
    // (try a few lateral offsets so planter walls / crossing paths don't knock whole stretches out)
    const tryAround = (sp: TreeSpecies, x: number, z: number, sc: number, clear: number, dz: number[]) => {
      for (const o of dz) if (this.clearForTree(x, z + o, clear)) { this.addTree(sp, x, z + o, sc); return; }
    };
    for (const s of samplePolyline([[108, -113.2], [144, -116.5]], 9, 0, 3)) tryAround('cloud', s.p[0], s.p[1], 0.9 + r() * 0.25, 0.8, [0, 1.6, 2.6, -4.3]);
    for (const s of samplePolyline([[112, -141.8], [160, -147]], 12, 0, 4)) tryAround('cloud', s.p[0], s.p[1], 0.9 + r() * 0.2, 0.8, [0, -1.2, 1.2, -2.2]);
    // east lawn: young saplings on a loose grid, a quarter with maroon leaves. Follows the east_lawn AREA polygon
    // (inset ~2 m from its edges) and the campus ground, so it adapts when the lawn outline changes.
    const eastLawn = AREAS.find((a) => a.id === 'east_lawn');
    if (eastLawn) {
      const b = polyBounds(eastLawn.poly);
      const inside = (x: number, z: number) => [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([ox, oz]) => pointInPoly(x + ox, z + oz, eastLawn.poly) && pointInPoly(x + ox, z + oz, CAMPUS_GROUND));
      for (let x = b.minX + 4; x <= b.maxX - 2; x += 9) for (let z = b.minZ + 3; z <= b.maxZ - 2; z += 11) {
        const jx = x + (hash2(x, z) - 0.5) * 3, jz = z + (hash2(z, x) - 0.5) * 4;
        if (!inside(jx, jz)) continue;
        tryTree(hash2(jx * 2, jz) < 0.25 ? 'maroon' : 'sapling', jx, jz, 1.0 + hash2(jz, jx) * 0.5, 0.6);
      }
    }
    // mature trees along the B-Block east strip and around the Open Air Theatre
    for (let z = -190; z <= -122; z += 11) tryTree('rain', -7.8 + (r() - 0.5), z, 0.75 + r() * 0.2, 0.5);
    // (the Open Air Theatre plants its own terrace / planter rain trees in oat.ts; its tiers stay clear)
    // palms in the terraced garden near F-Block
    cluster(80, 54, 11, 7, () => 'palm', 0.85, 1.1, 3.5, 61);
    // remaining lawns
    for (const a of AREAS) {
      if (a.kind !== 'lawn' || ['pes_lawn', 'frangipani_garden', 'east_lawn', 'oat_lawn', 'walkway_lawn'].includes(a.id ?? '')) continue;
      for (const [x, z] of scatterInPolygon(a.poly, 6, 7, 100 + (a.id?.length ?? 3), (x, z) => !this.clearForTree(x, z, 1.5) || Math.hypot(x - GLOBE_POS[0], z - GLOBE_POS[1]) < 9)) this.addTree(r() < 0.5 ? 'rain' : 'copperpod', x, z, 0.75 + r() * 0.35);
    }
    // campus edges: trees inside the stone boundary walls (not along the ORR stretch by the gate)
    for (const w of WALLS.filter((w) => w.kind === 'stone')) {
      for (const s of samplePolyline(w.pts, 10, -2.4, 3)) {
        if (!pointInPoly(s.p[0], s.p[1], CAMPUS_GROUND) || !this.clearForTree(s.p[0], s.p[1], 1.2)) continue;
        this.addTree(r() < 0.6 ? 'copperpod' : 'rain', s.p[0], s.p[1], 0.7 + r() * 0.3);
      }
      for (const s of samplePolyline(w.pts, 11, 3.5, 5)) {
        if (pointInPoly(s.p[0], s.p[1], CAMPUS_GROUND) || !this.clearForTree(s.p[0], s.p[1], 1.2)) continue;
        this.addTree(r() < 0.5 ? 'rain' : 'gulmohar', s.p[0], s.p[1], 0.8 + r() * 0.3);
      }
    }
    // avenue trees along the service / loop roads
    for (const rd of ROADS) {
      if (!['mrd_loop', 'south_service', 'west_service', 'b_mrd_link'].includes(rd.id ?? '')) continue;
      for (const side of [-1, 1]) {
        for (const s of samplePolyline(rd.pts, 15, side * (rd.width / 2 + 2.6), 7 + (side > 0 ? 7 : 0))) {
          if (!pointInPoly(s.p[0], s.p[1], CAMPUS_GROUND)) continue;
          tryTree(r() < 0.35 ? 'ashoka' : r() < 0.5 ? 'rain' : 'copperpod', s.p[0], s.p[1], 0.7 + r() * 0.35, 1.6);
        }
      }
    }
    // neighbourhood greenery: sparse trees in gaps outside the campus
    const species: TreeSpecies[] = ['rain', 'rain', 'gulmohar', 'copperpod', 'ashoka'];
    for (let i = 0; i < 200; i++) {
      const x = -220 + r() * 520, z = -330 + r() * 560;
      if (pointInPoly(x, z, CAMPUS_GROUND)) continue;
      if (!this.clearForTree(x, z, 2.5)) continue;
      const nearOrr = Math.abs((x - ORR.origin[0]) * ORR_NORMAL[0] + (z - ORR.origin[1]) * ORR_NORMAL[1]);
      if (nearOrr < Math.abs(ORR.serviceOffset) + 6) continue;
      this.addTree(species[Math.floor(r() * 5)], x, z, 0.7 + r() * 0.5);
    }
    void polyBounds; void CAMPUS_BOUNDS;
  }
}
