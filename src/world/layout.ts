/**
 * PES University, Ring Road campus — hand-authored layout (2026 state, see reference/CAMPUS_NOTES.md).
 * Coordinates: metres, +X east, +Z south, origin = centroid of the OSM Golden Jubilee Block outline.
 * Footprints follow OpenStreetMap (© OpenStreetMap contributors, ODbL); the GJBC complex is split into
 * wings / arcade strips from the 2026 campus-tour video. Best-effort likeness, tuned for gameplay.
 */
import { polylineToStrip } from './geom';

export type V2 = [number, number];

export type FacadeStyle =
  | 'gjbc' // GJBC exterior: cream stone panels + dark ribbon glass + charcoal fascia, dark glazed 2-storey base
  | 'gjbcQuad' // GJBC courtyard faces: cream plaster, blue-grey ribbon glass, glass band at the top
  | 'gjbcCurtain' // GJBC south-east: dark glass curtain wall (fins added as geometry)
  | 'library' // GJBC NW library tower: white plaster, punched strip windows
  | 'mrd' // MRD refurb: buff sandstone + frosted glass curtain + navy cornice
  | 'bblock' // B-Block: beige plaster, pilasters, near-square windows, pink-grey stone base
  | 'bblockTower' // B-Block crest tower: buff stone, tiny square windows
  | 'fTower' // F-Block tower: terracotta render, deep windows paired with beige panels
  | 'fWing' // F-Block wings: cream with continuous balcony bands
  | 'fPodium' // F-Block podium: terracotta with small punched windows
  | 'admin' // white plaster (gate / mural building, cabins)
  | 'oldCream' // generic old cream blocks (G-Block, HPC)
  | 'hostel' // cream/terracotta residential
  | 'service' // plain single storey (food point, sheds)
  | 'glass'; // MRD auditorium drum

export interface BuildingDef {
  id: string;
  name: string;
  poly: V2[];
  floors: number;
  floorH?: number;
  /** y of the bottom (bridges / overhangs / arcade strips). Prisms with base > 1.5 m are walkable underneath. */
  base?: number;
  /** explicit top height (overrides floors * floorH) */
  top?: number;
  style: FacadeStyle;
  roof?: { tanks?: number; solar?: boolean; skylights?: [number, number, number, number][]; parapet?: number };
  collide?: boolean;
  /** 'soffit' tint for the underside of overhangs */
  soffit?: 'wood' | 'red' | 'grey';
  sign?: { text: string; sub?: string; edge: number; offset?: number; color?: string };
  /**
   * Walls only (facade, no roof, no collision): a hand-built interior provides the floors, ceilings, roof and collision.
   * `skip` lists edge indices (edge i = poly[i] → poly[i+1]) whose wall is left out (internal party walls, openings).
   */
  shell?: { skip?: number[] };
}

export interface RoadDef { pts: V2[]; width: number; kind: 'asphalt' | 'paver'; kerb?: boolean; center?: boolean; median?: number; id?: string }
export type AreaKind = 'lawn' | 'paver' | 'concrete' | 'soil' | 'court' | 'granite' | 'plaza' | 'greypaver' | 'marble' | 'bed';
export interface AreaDef { poly: V2[]; kind: AreaKind; id?: string }
export interface WallDef { pts: V2[]; height: number; kind: 'stone' | 'plaster' | 'hoarding' | 'railing' | 'corten' | 'lowwhite' }
export interface GateDef { id: string; a: V2; b: V2; hp: number; activeFromWave: number }
/** Pedestrian paths (not driveable). `surface`: 'plaza' = striped "barcode" pavers, 'greypaver' = two-tone grey. */
export interface PathDef { id: string; pts: V2[]; width: number; surface: 'plaza' | 'greypaver' | 'paver' }

// ---------------------------------------------------------------------------------------------
// Outer Ring Road geometry (diagonal along the north-east)
// ---------------------------------------------------------------------------------------------
export const ORR = {
  origin: [100, -215] as V2, // point on the main-carriageway centreline
  dir: [0.883, 0.469] as V2, // WNW → ESE
  width: 26, // both carriageways
  median: 5,
  serviceOffset: -22, // service road centreline offset along the normal (normal points NE)
  serviceWidth: 7.5,
};
export const ORR_NORMAL: V2 = [ORR.dir[1], -ORR.dir[0]]; // (0.469, -0.883) → points NE
export function orrPoint(t: number, offset = 0): V2 {
  return [
    ORR.origin[0] + ORR.dir[0] * t + ORR_NORMAL[0] * offset,
    ORR.origin[1] + ORR.dir[1] * t + ORR_NORMAL[1] * offset,
  ];
}

// ---------------------------------------------------------------------------------------------
// Key lines of the GJBC complex
// ---------------------------------------------------------------------------------------------
/** PES University Rd centreline, east (porte-cochère / drive-through) → west gate. 8 m wide. */
export const PES_RD: V2[] = [[86, -123.6], [72, -121.7], [55, -119.4], [38, -116.7], [20, -113.8], [11.3, -112.4], [0.1, -111], [-60.2, -104.6], [-72, -103.5], [-95, -101.5]];
/** z of the PES Univ Rd centreline at x (linear interpolation along PES_RD). */
export function pesRdZ(x: number): number {
  const p = PES_RD;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    if ((x <= a[0] && x >= b[0]) || (x >= a[0] && x <= b[0])) {
      const f = (x - a[0]) / (b[0] - a[0] || 1);
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return x > p[0][0] ? p[0][1] : p[p.length - 1][1];
}
/** GJBC east facade line (OSM): x at a given z. */
export function gjbcEastX(z: number): number { return 82 + (12 * (z + 123)) / 161; }

/**
 * GJBC 1st floor ("L1") height. The front ramp lands on L1, and the Quad, the covered plaza, the inner court and the
 * Quad colonnades all sit on a solid podium at this height (reference/GJB_NOTES.md §1). PES University Rd, the
 * drive-through, the east promenade/forecourt and the enterable lobbies are on the ground floor (y = 0).
 */
export const GJB_L1 = 6.0;
/** The Quad (granite courtyard on the L1 podium) — colonnade column lines at x=20.45 / 54.55; columns stand on L1. */
export const QUAD = { minX: 20, maxX: 55, minZ: -95, maxZ: -15, arcade: 4, colSpacing: 4.5, colSize: 0.9, colHeight: 8.5, floorY: GJB_L1 };
/** Covered plaza at the Quad's north end (floor on L1): roofed (slab at L1 + 9 m) south part + open steel pergola strip on the north. */
export const COVERED_PLAZA = { minX: 20, maxX: 55, southZ: -95, roofY: GJB_L1 + 9, pergolaDepth: 5, verge: 1.5 };
/** z of the covered-plaza north parapet (planter + hedge on the L1 edge, above PES Univ Rd) at x. */
export function plazaParapetZ(x: number): number { return pesRdZ(x) + 4 + COVERED_PLAZA.verge; }
/** Drive-through: PES Univ Rd runs under the GJBC north-east L1 porch between these x (clear height 5.5 m, deck top = L1). */
export const DRIVE_THROUGH = { x0: 55, x1: 84, clear: 5.5, footpath: 2.5 };
/** z of the drive-through footpath's south edge (= the building line) and of the porch's north edge at x. */
export function driveFootpathZ(x: number): number { return pesRdZ(x) + 4 + DRIVE_THROUGH.footpath; }
export function driveNorthZ(x: number): number { return pesRdZ(x) - 5.4; }
/** Arcade soffit on L1 (the Quad colonnade strips start here). */
export const GJB_ARCADE_TOP = GJB_L1 + 8.5;
/** Depth of the open gallery on top of the Quad colonnades (the upper floors stand back this far from the column line). */
export const GJB_GALLERY = 1.8;

const FS = driveFootpathZ; // south edge of the drive-through footpath
const E = gjbcEastX;
const L1 = GJB_L1;
const ARC = GJB_ARCADE_TOP;

/**
 * Outline of the L1 podium: everything under the Quad + its colonnades, the covered plaza and the inner court. Its top is
 * the L1 granite floor. The wings around it are regular BUILDINGS; its north face (PES Univ Rd, and under the NE porch),
 * its south face (Pie R Cube) and the stub under the north arcade are exposed at ground level (gjbc.ts podiumFaces).
 */
export const GJB_PODIUM: V2[] = [
  [20, plazaParapetZ(20)], [38, plazaParapetZ(38)], [55, plazaParapetZ(55)], [59, FS(59)], [59, -15], [20, -15], [20, -10],
  [19, -10], [18.5, 16], [18.6, 17.25], [-8, 17.6], [-8, -24], [16, -24], [16, -95], [20, -95],
];
/**
 * The enterable ground-floor wing under the east half of the Quad and the covered plaza (src/world/gjb/ground.ts). Rects
 * are [x0, z0, x1, z1]. Corridor A runs west from a door in the east lobby's west wall; corridor B runs north from it to a
 * glass door in the podium's north face on PES University Rd; stair core S1 rises from corridor B to the covered plaza.
 * The rest of the podium stays solid (GJB_PODIUM_PARTS); the wing is roofed by the L1 slab `slabPoly`.
 */
const PPZ = plazaParapetZ;
export const GJB_G = {
  /** L1 slab thickness over the wing (soffit at GJB_L1 − slab) */
  slab: 0.4,
  corridorA: [28, -83.6, 59, -80.8] as [number, number, number, number],
  corridorB: [51.2, -113.6, 54, -83.6] as [number, number, number, number],
  rooms: {
    g01: [40, -95, 51.2, -83.6] as [number, number, number, number], // computer lab
    g02: [40, -106.5, 51.2, -95] as [number, number, number, number], // classroom
    g03: [54, -97.5, 59, -83.6] as [number, number, number, number], // faculty room
    g04: [40, -80.8, 59, -70.8] as [number, number, number, number], // seminar hall
    g05: [28, -95, 40, -83.6] as [number, number, number, number], // electronics lab
  },
  /** door centres: along corridor A (x) / corridor B (z) */
  doors: { g01: 46.8, g05: 36, g04a: 43, g04b: 56, g02: -100.5, g03: -86.5 },
  /** stair core S1 (outer rect; its west wall is corridor B's east wall), G → L1 */
  core: [54, -107.5, 59, -97.5] as [number, number, number, number],
  coreDoor: [-99.7, -97.7] as V2,
  coreLanding: 2.2,
  coreRun: 5.0,
  coreTop: GJB_L1 + 8.5,
  /** lobby door in the lobby's west wall (x = 59), z range */
  lobbyDoor: [-83.4, -81.0] as V2,
  /** z of the podium's north face at x (the road door is at corridor B) */
  northDoorZ: (x: number): number => PPZ(x),
  bounds: [28, -113.6, 59, -70.8] as [number, number, number, number],
  /** L1 slab over the wing (the stair core is open above its landings) */
  slabPoly: [[59, -70.8], [40, -70.8], [40, -80.8], [28, -80.8], [28, -95], [40, -95], [40, -106.5], [51.2, -106.5], [51.2, PPZ(51.2)], [54, PPZ(54)], [54, -97.5], [59, -97.5]] as V2[],
};
/** The closed parts of the podium (solid 0 → L1): everything except the ground-floor wing, and the NE island it cuts off. */
export const GJB_PODIUM_PARTS: V2[][] = [
  [
    [20, PPZ(20)], [38, PPZ(38)], [51.2, PPZ(51.2)], [51.2, -106.5], [40, -106.5], [40, -95], [28, -95], [28, -80.8], [40, -80.8], [40, -70.8],
    [59, -70.8], [59, -15], [20, -15], [20, -10], [19, -10], [18.5, 16], [18.6, 17.25], [-8, 17.6], [-8, -24], [16, -24], [16, -95], [20, -95],
  ],
  [[54, PPZ(54)], [55, PPZ(55)], [59, FS(59)], [59, -107.5], [54, -107.5]],
];
/** L1 granite floors (drawn at GJB_L1 by gjbc.ts). The covered plaza is notched round stair core S1. */
export const GJB_L1_FLOORS: { id: string; poly: V2[] }[] = [
  { id: 'quad', poly: [[16, -95], [59, -95], [59, -15], [16, -15]] },
  { id: 'covered_plaza', poly: [[20, PPZ(20)], [38, PPZ(38)], [55, PPZ(55)], [59, FS(59)], [59, -107.5], [54, -107.5], [54, -97.5], [59, -97.5], [59, -95], [20, -95]] },
  { id: 'inner_court', poly: [[-8, -24], [16, -24], [16, -15], [20, -15], [20, -10], [19, -10], [18.5, 16], [18.6, 17.25], [-8, 17.6]] },
];
/** GJBC 2nd floor (L2) in the east entrance block and the east wing (gjb/eastblock.ts): floor level and slab thickness. */
export const GJB_L2 = GJB_L1 + 4.3;
/**
 * Enterable GJBC interiors. Rect bounds; `front` = x of the glazed east front.
 * lobby: GJBC east entrance lobby (G; reception, walnut slat wall, the grand stair up into the L1 admission hall).
 * cafe: GJBC cafeteria under the Law terrace (G).
 * east: the east entrance block over the lobby (gjb/eastblock.ts): L1 admission hall + L2 floor (x0 … front, z0 … z1),
 *   and the L2 classrooms carved into the east wing (gjb_e1) north of it (`l2Rooms`).
 */
export const GJB_INTERIORS = {
  lobby: { x0: 59, x1: gjbcEastX(-80) - 2.5, z0: -84, z1: -76, ceil: GJB_L1 - 0.45 },
  cafe: { x0: 72, z0: -10, z1: 22, ceil: 4.45 },
  east: { x0: 59, z0: -84, z1: -76, l2Rooms: [59, -93.2, 80.6, -84] as [number, number, number, number] },
};
/**
 * 2-wheeler parking (reference/GJB_NOTES.md §4; user's Google Maps + reference/sat_east_grid.jpg): a long 2-level
 * N–S structure right opposite GJBC's east wing, with the east lawn between it and GJBC. Its lawn-facing (west) side is
 * the corten + green-mesh screen; its back (east) wall is the campus boundary. Ground floor at y = 0 (walkable now),
 * open upper deck at `deck` (slab prism with base > 1.5 → walk under it). Vehicle ramp at the north end off the entry
 * walkway, pedestrian stair at the south end by the food court, white-roofed covered bay on the deck at the north end.
 */
/**
 * The campus slope (user, 2026-09-25): the ground falls from the main gate towards GJB. The entry corridor (road,
 * walkways, the 2-wheeler parking's yard), the gate forecourt, the PES Lawn and the Ring Road near the gate sit one
 * storey (`h`) above GJB level; the entry road, its walkways and the PES Lawn promenade descend to GJB level between
 * slopeX1 and slopeX0, and the Ring Road outside the campus between orrX1 and orrX0. Shapes and the lift of everything
 * standing on the raised ground: src/world/terrain.ts.
 */
export const TERRAIN = { h: 3.2, slopeX0: 92, slopeX1: 118, orrX0: 96, orrX1: 140 };
/** Raised-ground height on the entry-road slope at x (the ramp foot, the walkway ends). */
export function slopeY(x: number): number {
  return TERRAIN.h * Math.min(1, Math.max(0, (x - TERRAIN.slopeX0) / (TERRAIN.slopeX1 - TERRAIN.slopeX0)));
}
/**
 * 2-wheeler parking (user's description 2026-09-25; GJB tour 0:40–0:47): the campus falls from the main gate towards
 * GJB, so the -1 floor sits at GJB / lawn level (`low`) and the ground floor one storey up at the level of the entry
 * walkway it opens off (`road`). Above the covered part of the ground floor is an empty roof (`roof`).
 */
export const PARKING = {
  x0: 120, x1: 137.5, z0: -111, z1: -30,
  low: 0, road: TERRAIN.h, roof: TERRAIN.h + 3.2, slabT: 0.35,
  /** open-air north yard of the ground floor (z0 … yardZ), straight off the walkway; covered floor south of it */
  yardZ: -97,
  /** vehicle lane to the -1 floor: branches left (east) off the yard and runs south along the back wall, down from
   * road level at z0 to the -1 floor at rampZ, in the middle of the parking (x laneX … x1) */
  laneX: 134, rampZ: -72,
  /** walk-in doors from the lawn into the -1 floor (z ranges in the corten screen) */
  westDoors: [[-92, -88], [-66, -62]] as V2[],
  /**
   * PES Innovation Lab block across the ground floor's south end (the user's sketch, 2026-09-25): the PIL along the west
   * half (z0 … z1), the Huawei innovation lab in the south-east (huaZ0 … z1), and between the Huawei lab and the parking
   * a lobby (xMid … lobbyX1) opening north onto the parking, with the PIL door in its west wall and the Huawei door in
   * its south wall, and the stair down to the -1 floor east of it (lobbyX1 … x1).
   */
  labs: { z0: -49.5, xMid: 128.75, lobbyX1: 133.5, huaZ0: -42.4 },
  /** reflecting pool at the north end of the east lawn, under the entry walkway's tall grey retaining wall */
  pool: { x0: 105, x1: 117.5, z0: -108.4, z1: -105.4 },
  retainingWall: { x0: 104, x1: 119.6, z: -110.4, h: 1.0 }, // parapet above the raised walkway (its face to the pool is terrain)
  /** campus east boundary line (the parking's back wall), z range */
  backX: 137.72, backZ0: -110.8, backZ1: -30.3,
};
export const PARKING_FOOTPRINT: V2[] = [[PARKING.x0, PARKING.z0], [PARKING.x1, PARKING.z0], [PARKING.x1, PARKING.z1], [PARKING.x0, PARKING.z1]];
/**
 * The front ramp (reference/GJB_NOTES.md §2): rises west from the east plaza (foot at xFoot, y = 0) along the north side
 * of the entry road to an L1 landing beside the porte-cochère, under the PES signboard; the landing joins the L1 porch
 * over the drive-through (→ covered plaza → Quad) and a glazed L1 bridge crosses the MRD loop road into MRD.
 */
export const FRONT_RAMP = { xFoot: 110, xTop: 86, z0: -136.3, z1: -131.9, landing: { x0: 78.9, x1: 86, zN: -137.8 }, footY: slopeY(110) };
/**
 * Raised terrace on the north side of the east plaza (2026 tour 0216 / sheet 2:08: a wide granite stair climbs north
 * from the plaza between white cheek walls to a white pavilion; Google satellite: the paved strip x ≈ 103–113 running
 * north from the plaza into the PES Lawn path). Walkable: stair up from the plaza, ramp down north onto the lawn path.
 */
export const PLAZA_TERRACE = {
  x0: 96, x1: 114, zS: -153.4, zN: -162, y: TERRAIN.h, // flush with the raised PES Lawn behind it
  stair: { x0: 102.5, x1: 108.5, zFoot: -148.2 },
  ramp: { x0: 103, x1: 108, zEnd: -173 },
  pavilion: { x0: 108.5, x1: 114, zS: -157, h: 3.4 },
};
/**
 * Black-granite reflecting pool in the garden east of the MRD loop road, facing MRD's grand steps across the road with a
 * planted bed between it and the kerb (GJB tour 1:44–1:52; 2026 tour 4:00; OSM amenity=fountain x 80–91, z −148…−130).
 * Centre, unit long axis (parallel to the road), length, width.
 */
export const MRD_POOL = { c: [91.0, -148.0] as V2, u: [0.469, -0.884] as V2, len: 11, wid: 4 };
/** Areas where the campus tree scatter must not put trees (the parking floor is walkable, so collision alone won't stop it). */
export const NO_TREE_ZONES: V2[][] = [
  // the parking (and the paved strip along its corten face) + its north entry strip
  [[PARKING.x0 - 1.7, PARKING.z0 - 4.5], [PARKING.backX + 0.5, PARKING.z0 - 4.5], [PARKING.backX + 0.5, PARKING.z1 + 1.2], [PARKING.x0 - 1.7, PARKING.z1 + 1.2]],
  // reflecting pool + its paved court and the retaining wall
  [[PARKING.retainingWall.x0, PARKING.retainingWall.z - 0.6], [PARKING.x0, PARKING.retainingWall.z - 0.6], [PARKING.x0, PARKING.pool.z1 + 1], [PARKING.retainingWall.x0, PARKING.pool.z1 + 1]],
];

// ---------------------------------------------------------------------------------------------
// B-Block ("BE block") frame (reference/BE_NOTES.md, src/world/bblock.ts). s runs south along the east facade line,
// d runs west into the block; (0, 0) is the entrance axis on the facade. The crest tower stands over the entrance.
// ---------------------------------------------------------------------------------------------
export const BE_FRAME = { origin: [-10.455, -159.5] as V2, s: [0.0625, 0.998] as V2, d: [-0.998, 0.0625] as V2 };
/** Plan point (x, z) at (s, d) in the BE frame. */
export function bePt(s: number, d: number): V2 {
  const f = BE_FRAME;
  return [f.origin[0] + f.s[0] * s + f.d[0] * d, f.origin[1] + f.s[1] * s + f.d[1] * d];
}
/** Floor tops of the enterable BE-block core (G = entrance plinth) and the underside of the solid block above it. */
export const BE_LEVELS = { G: 0.45, F1: 3.95, F2: 7.45, top: 10.65 };

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------
const GJ_H = 26.4; // 6 floors x 4.4 m
export const BUILDINGS: BuildingDef[] = [
  // --- Golden Jubilee Block complex (GJBC) ---
  {
    id: 'gjb_library', name: 'GJBC Central Library', style: 'library', floors: 10, floorH: 4.2,
    poly: [[-60, -99], [-8, -105.3], [-8, -50], [-57.9, -50]],
    roof: { tanks: 2 },
  },
  {
    id: 'gjb_north_w', name: 'GJBC North Wing', style: 'gjbc', floors: 6, floorH: 4.4,
    poly: [[-8, -102.3], [9, -105], [20, -106.6], [20, -95], [-8, -95]],
    roof: { tanks: 2 },
  },
  { id: 'gjb_north_w_arc', name: 'GJBC North Arcade', style: 'gjbc', floors: 6, floorH: 4.4, base: 9, top: GJ_H, soffit: 'wood', poly: [[-8, -105.3], [9, -108], [20, -109.6], [20, -106.6], [9, -105], [-8, -102.3]] },
  {
    id: 'gjb_west', name: 'GJBC West Wing', style: 'gjbcQuad', floors: 6, floorH: 4.4,
    poly: [[-8, -95], [16, -95], [16, -24], [-8, -24]],
  },
  // the upper floors over the Quad colonnades stand back GJB_GALLERY m behind the column line: the colonnade carries an
  // open gallery with a dark railing on top (gjbc.ts quad(); tour frames key_1150, uxqjCJBCP_g 11:33)
  { id: 'gjb_west_arc', name: 'GJBC Quad West Arcade (upper floors over the L1 colonnade)', style: 'gjbcQuad', floors: 6, floorH: 4.4, base: ARC, top: GJ_H, soffit: 'red', poly: [[16, -95], [20 - GJB_GALLERY, -95], [20 - GJB_GALLERY, -15], [16, -15]] },
  { id: 'gjb_west_s', name: 'GJBC West Wing (over the L1 inner court)', style: 'gjbcQuad', floors: 6, floorH: 4.4, base: ARC, top: GJ_H, soffit: 'red', poly: [[-8, -24], [16, -24], [16, -15], [-8, -15]] },
  { id: 'gjb_plaza_roof', name: 'GJBC Covered Plaza (upper floors)', style: 'gjbcQuad', floors: 6, floorH: 4.4, base: COVERED_PLAZA.roofY, top: GJ_H, soffit: 'wood', poly: [[20, -104.3], [38, -106.7], [55, -109.4], [55, -95], [20, -95]] },
  // (the north-east porch over the drive-through — L1 deck, roof and porte-cochère — is custom geometry in gjbc.ts)
  // east wing (inset ground blocks + arcade / colonnade strips at +9 m)
  // collision is registered by gjb/eastblock.ts (solid except the L2 classrooms carved out of its south end)
  { id: 'gjb_e1', name: 'GJBC East Wing (north)', style: 'gjbc', floors: 6, floorH: 4.4, collide: false, poly: [[59, FS(59)], [80, FS(80)], [E(-84) - 2.5, -84], [59, -84]], roof: { tanks: 2 } },
  { id: 'gjb_e1_col', name: 'GJBC East Colonnade (north)', style: 'gjbc', floors: 6, floorH: 4.4, base: 9, top: GJ_H, soffit: 'wood', poly: [[80, FS(80)], [E(FS(80)) + 0.5, FS(80)], [E(-84), -84], [E(-84) - 2.5, -84]] },
  { id: 'gjb_e1_arc', name: 'GJBC Quad East Arcade (north)', style: 'gjbcQuad', floors: 6, floorH: 4.4, base: ARC, top: GJ_H, soffit: 'red', poly: [[55, FS(55)], [59, FS(59)], [59, -84], [55 + GJB_GALLERY, -84], [55 + GJB_GALLERY, -95], [55, -95]] },
  // over the east entrance block: the G lobby (gjb/interiors.ts), the L1 admission hall and the L2 floor (gjb/eastblock.ts)
  // are hand-built below ARC, and the Quad's east colonnade runs on through under it
  { id: 'gjb_breezeway', name: 'GJBC East Entrance Block (upper floors)', style: 'gjbc', floors: 6, floorH: 4.4, base: ARC, top: GJ_H, soffit: 'grey', poly: [[55 + GJB_GALLERY, -84], [E(-84), -84], [E(-76), -76], [55 + GJB_GALLERY, -76]] },
  { id: 'gjb_e2', name: 'GJBC East Wing (middle)', style: 'gjbc', floors: 6, floorH: 4.4, poly: [[59, -76], [E(-76) - 2.5, -76], [E(-60) - 2.5, -60], [59, -60]] },
  { id: 'gjb_e2_col', name: 'GJBC East Colonnade (middle)', style: 'gjbc', floors: 6, floorH: 4.4, base: 9, top: GJ_H, soffit: 'wood', poly: [[E(-76) - 2.5, -76], [E(-76), -76], [E(-60), -60], [E(-60) - 2.5, -60]] },
  {
    id: 'gjb_e3', name: 'GJBC East Wing (south, curtain wall)', style: 'gjbcCurtain', floors: 6, floorH: 4.4,
    poly: [[59, -60], [E(-60), -60], [E(-10), -10], [59, -10]],
  },
  { id: 'gjb_e_arc', name: 'GJBC Quad East Arcade (south)', style: 'gjbcQuad', floors: 6, floorH: 4.4, base: ARC, top: GJ_H, soffit: 'red', poly: [[55 + GJB_GALLERY, -76], [59, -76], [59, -15], [55 + GJB_GALLERY, -15]] },
  { id: 'gjb_quad_s', name: 'GJBC Quad South Gallery', style: 'gjbcCurtain', floors: 2, floorH: 4.5, top: L1 + 9, poly: [[20, -15], [59, -15], [59, -10], [20, -10]] },
  {
    id: 'gjb_south', name: 'GJBC Electrical Block (south hall)', style: 'gjbc', floors: 4, floorH: 4.0,
    poly: [[19, -10], [72, -10], [72, 22], [87.5, 22], [88, 38], [86, 47], [78, 52], [58, 40], [20, 39], [18.5, 16]],
    roof: { skylights: [[24, 8, 8, 28], [36, 8, 8, 28], [48, 8, 8, 28], [60, 8, 8, 28]], tanks: 2 },
  },
  // the enterable G-floor cafeteria (gjb/interiors.ts, GJB_INTERIORS.cafe) sits under these two (base = its ceiling)
  { id: 'gjb_cafe_top', name: 'GJBC Electrical Block (over the cafeteria)', style: 'gjbc', floors: 4, floorH: 4.0, base: 4.5, top: 16, soffit: 'grey', poly: [[72, -10], [86.5, -10], [87.5, 22], [72, 22]] },
  { id: 'gjb_law_cafe', name: 'Faculty of Law terrace (over the cafeteria)', style: 'gjbcCurtain', floors: 2, floorH: 4.0, base: 4.5, top: 8, soffit: 'grey', poly: [[86.5, -10], [E(-10), -10], [E(22), 22], [87.5, 22]], roof: { parapet: 1.1 }, sign: { text: 'CAFETERIA', edge: 1, offset: 0.4, color: '#1f2b45' } },
  { id: 'gjb_law_base', name: 'Faculty of Law terrace (south part)', style: 'gjbcCurtain', floors: 2, floorH: 4.0, poly: [[87.5, 22], [E(22), 22], [E(38), 38], [88, 38]], roof: { parapet: 1.1 } },
  { id: 'gjb_law_roof', name: 'Faculty of Law terrace canopy', style: 'gjbc', floors: 1, floorH: 4.0, base: 15.2, top: 16.4, soffit: 'grey', poly: [[86.5, -10], [E(-10), -10], [E(38), 38], [88, 38]], roof: { parapet: 0.4 } },
  {
    id: 'gjb_techpark', name: 'GJBC Tech Park', style: 'gjbc', floors: 4, floorH: 4.4,
    poly: [[-57.9, -50], [-8, -50], [-8, 17.5], [-13, 18], [-43, 20], [-55, 20], [-56, 17], [-56, -5]],
    roof: { tanks: 2 },
  },
  // --- North of PES University Rd ---
  // Prof. MRD Block (Dr. M.R. Doreswamy Silver Jubilee Complex, OSM way 199316438, 6 levels), split into its wings
  // (satellite + 2021/2026 tours, reference/MRD_NOTES.md). Refurbished 2025-26 parts use 'mrd' (buff stone, frosted
  // glass, navy cornices), the old wings facing the Open Air Theatre stay cream. Detail: src/world/mrd.ts.
  // id 'mrd' is kept on the NW auditorium hall (Props looks it up); its metal hip roof is built in mrd.ts.
  // the auditorium is an enterable hall (mrdInterior.ts buildMrdAuditorium): a walls-only shell, its party walls with the
  // central wings (edges 5–7) left out; the hall walls, ceiling, collision and the metal hip roof are hand-built
  {
    id: 'mrd', name: 'Prof. MRD Block — auditorium', style: 'admin', floors: 4, floorH: 4.0,
    poly: [[2.0, -179.8], [9.2, -182.4], [21.2, -187.0], [25.8, -185.8], [30.2, -187.9], [31.1, -183.2], [33.0, -172.0], [28.0, -158.0], [15.0, -154.0], [9.2, -156.9], [2.8, -168.5]],
    roof: { parapet: 0.3 }, shell: { skip: [5, 6, 7] },
  },
  // The entrance block and the central wings are hollowed out for the enterable interior (src/world/mrdInterior.ts,
  // plan in the local frame of mrdAt(): lobby behind the east glazing, the 4-storey atrium under the octagonal skylight,
  // a corridor out to the Open Air Theatre side). mrd_fan keeps the outer wings full height (C-shape round the atrium);
  // the atrium's upper floors are the four mrd_up_* pieces around the gallery ring (base = 2nd-floor slab underside).
  // (split by the passage from the atrium into the auditorium: local s −6.6…−4.2 from the atrium's west wall)
  {
    id: 'mrd_fan', name: 'Prof. MRD Block — central wings', style: 'oldCream', floors: 6, floorH: 3.6, top: 22,
    poly: [[31.1, -183.2], [34.8, -180.9], [59.3, -169.6], mrdAt(12.512, 15.3), mrdAt(9.6, 15.3), mrdAt(9.6, 33.5), mrdAt(-4.2, 33.5), mrdAt(-4.2, 38.895), [33.0, -172.0]],
    roof: { tanks: 3 },
  },
  {
    id: 'mrd_fan_w', name: 'Prof. MRD Block — central wings (OAT side)', style: 'oldCream', floors: 6, floorH: 3.6, top: 22,
    poly: [mrdAt(-6.6, 33.5), mrdAt(-16, 33.5), mrdAt(-16, 22), mrdAt(-20.95, 22), [15.0, -154.0], [28.0, -158.0], mrdAt(-6.6, 38.407)],
    roof: { tanks: 1 },
  },
  { id: 'mrd_fan_pass', name: 'Prof. MRD Block — over the auditorium passage', style: 'oldCream', floors: 5, floorH: 3.6, base: 5.85, top: 22, soffit: 'grey', roof: { parapet: 0.4 }, poly: [mrdAt(-6.6, 33.5), mrdAt(-4.2, 33.5), mrdAt(-4.2, 38.895), mrdAt(-6.6, 38.407)] },
  { id: 'mrd_fan_s', name: 'Prof. MRD Block — central wings (south-east corner)', style: 'oldCream', floors: 6, floorH: 3.6, top: 22, poly: [mrdAt(-20.176, 15.3), mrdAt(-16, 15.3), mrdAt(-16, 19), mrdAt(-20.602, 19)] },
  ...mrdUpperPieces(),
  {
    id: 'mrd_east', name: 'Prof. MRD Block — east entrance block (Silver Jubilee Complex)', style: 'glass', floors: 4, floorH: 4.0, base: 5.85, top: 20, soffit: 'grey',
    poly: [mrdAt(12.512, 15.3), [73.5, -161.8], [66.7, -150.5], [59.9, -139.3], [43.6, -141.0], mrdAt(-20.176, 15.3)],
    roof: { tanks: 2, parapet: 1.1 },
  },
  {
    id: 'mrd_ne', name: 'Prof. MRD Block — north-east wing', style: 'mrd', floors: 5, floorH: 4.0,
    poly: [[59.3, -169.6], [62.8, -176.0], [74.4, -180.3], [79.4, -167.0], [80.8, -163.9], [73.5, -161.8]],
    roof: { tanks: 2, solar: true },
  },
  {
    id: 'mrd_se', name: 'Prof. MRD Block — south-east wing', style: 'mrd', floors: 5, floorH: 4.0,
    poly: [[59.9, -139.3], [59.3, -136.4], [62.9, -136.1], [68.4, -135.7], [66.8, -131.8], [45.0, -126.0], [40.9, -137.6], [43.6, -141.0]],
    roof: { solar: true },
  },
  // B-Block = "BE block" (reference/BE_NOTES.md). It has ONE centre: the buff-stone crest tower (deep slot, roof sign)
  // stands over the main entrance on the east face, entrance axis z ≈ −159.5 (satellite + 2021/2026 tours). The
  // footprint is notched for the enterable core behind the entrance (lobby, atrium, G/1st/2nd-floor rooms, built in
  // src/world/bblock.ts); bblock_tower and bblock_core cover the notch from BE_LEVELS.top up. The portico deck over the
  // link road is a low slab on four columns (bblock.ts), not a full-height block.
  {
    id: 'bblock', name: 'B-Block (BE block)', style: 'bblock', floors: 14, floorH: 3.5,
    poly: [[-54.8, -177.2], [-41.0, -178.0], [-42.1, -195.0], [-12.8, -196.8], [-11.2, -171.4],
      bePt(-9, 0), bePt(-9, 10), bePt(-15, 10), bePt(-15, 32), bePt(15, 32), bePt(15, 10), bePt(9, 10), bePt(9, 0),
      [-7.6, -113.9], [-50.6, -111.2]],
    roof: { solar: true, tanks: 4 },
    sign: { text: 'BE BLOCK', sub: 'COMPUTER SCIENCE & ENGG', edge: 14, offset: 0.5, color: '#2f3a40' },
  },
  // the tower's deep portal-like recess runs up its east face to a solid stone head ~2 floors above the 10th-floor
  // balcony band (key frames 1406 / 1928 / 0002), so the tower is a notched shaft plus a solid head
  {
    id: 'bblock_tower', name: 'B-Block crest tower (over the entrance)', style: 'bblockTower', floors: 9, floorH: 3.5, base: BE_LEVELS.top, top: 42, soffit: 'grey', roof: { parapet: 0 },
    poly: [bePt(-9, -0.8), bePt(-2.5, -0.8), bePt(-2.5, 4), bePt(2.5, 4), bePt(2.5, -0.8), bePt(9, -0.8), bePt(9, 18), bePt(-9, 18)],
  },
  {
    id: 'bblock_tower_head', name: 'B-Block crest tower (solid head)', style: 'bblockTower', floors: 4, floorH: 3.5, base: 42, top: 57, soffit: 'grey',
    poly: [bePt(-9, -0.8), bePt(9, -0.8), bePt(9, 18), bePt(-9, 18)],
  },
  {
    id: 'bblock_core', name: 'BE block (over the enterable core)', style: 'bblock', floors: 11, floorH: 3.5, base: BE_LEVELS.top, top: 50.15, soffit: 'grey', roof: { parapet: 0 },
    poly: [bePt(-15, 10), bePt(-9, 10), bePt(-9, 18), bePt(9, 18), bePt(9, 10), bePt(15, 10), bePt(15, 32), bePt(-15, 32)],
  },
  // OSM "Admission Enquiry" (way 347418529), the white mural building the main gate's south pillar is built into. Its
  // ground floor is an enterable enquiry hall facing the entry walkway (src/world/admissionHall.ts): a walls-only shell
  // whose front between x 158.2 and 170.2 is hand-built glazing; the three upper floors are a solid block on top.
  {
    id: 'admission', name: 'Admission Enquiry (gate mural building)', style: 'admin', floors: 3, floorH: 3.5, base: 3.5, top: 14,
    poly: admissionPoly(),
  },
  { id: 'admission_g', name: 'Admission Enquiry (ground floor)', style: 'admin', floors: 1, floorH: 3.5, top: 3.5, roof: { parapet: 0 }, shell: { skip: [1] }, poly: admissionPoly() },
  { id: 'gate_annex', name: 'Gate mural wing (outside)', style: 'admin', floors: 3, floorH: 3.6, poly: [[184, -120.6], [200, -121.2], [200.1, -116.4], [184, -116.0]] },
  { id: 'gate_annex2', name: 'Gate annex strip', style: 'admin', floors: 1, floorH: 4, poly: [[200, -121.2], [213.7, -121.8], [213.9, -116.7], [200.1, -116.4]] },
  // F-Block (Panini Block, OSM way 199315793): an L of beige open-corridor wings with terracotta blocks at the north end
  // (the 10-storey tower with the PES roof sign, a 3-storey terracotta podium in front of it) and at the elbow (an
  // 8-storey terracotta end block). Law terrace key frames 0050 / 1534 look straight at the tower rising behind the podium
  // with the wing running south to the end block; the 2011 Wikimedia photo (reference/frames/fblock/) shows the same
  // tower + wing + end block from the west.
  { id: 'f_podium', name: 'F-Block (podium)', style: 'fPodium', floors: 3, floorH: 3.5, poly: [[101.6, 9.5], [118.1, 7.1], [119.9, 18.0], [104.0, 20.4]], sign: { text: 'F BLOCK', edge: 0, offset: 0.5, color: '#f4efe2' } },
  { id: 'f_tower', name: 'F-Block (Panini) tower', style: 'fTower', floors: 10, floorH: 3.5, poly: [[104.0, 20.4], [119.9, 18.0], [122.5, 33.0], [107.3, 35.3]], roof: { tanks: 2 } },
  { id: 'f_wing1', name: 'F-Block (east wing)', style: 'fWing', floors: 8, floorH: 3.5, poly: [[107.3, 35.3], [122.5, 33.0], [124.0, 42], [109.2, 44]], roof: { tanks: 2 } },
  { id: 'f_end', name: 'F-Block (terracotta end block at the elbow)', style: 'fTower', floors: 8, floorH: 3.5, poly: [[109.2, 44], [124.0, 42], [127.2, 60.9], [111.3, 53.6]], roof: { tanks: 2 } },
  { id: 'fblock', name: 'F-Block (south wing)', style: 'fWing', floors: 8, floorH: 3.5, poly: [[75.2, 69.8], [107.2, 55.5], [111.3, 53.6], [127.2, 60.9], [82.7, 84.5]], roof: { tanks: 3 } },
  {
    id: 'gblock', name: 'G-Block', style: 'oldCream', floors: 5, floorH: 3.5,
    poly: [[-67.2, 32.9], [-48.4, 31.7], [-47.4, 46.0], [-46.5, 60.8], [-65.3, 62.0]],
    roof: { tanks: 2 },
    sign: { text: 'G BLOCK', edge: 1, offset: 0.5 },
  },
  {
    id: 'thindies', name: 'South Thindies (Food Point)', style: 'service', floors: 1, floorH: 3.6,
    poly: [[133.4, -21.7], [151.0, -22.0], [151.4, -1.9], [142.8, -1.7], [142.7, -5.5], [134.3, -5.5]],
    sign: { text: 'SOUTH THINDIES', sub: 'FOOD POINT', edge: 5, offset: 0.5, color: '#b3261e' },
  },
  {
    id: 'hpc', name: 'High Performance Computing Lab', style: 'oldCream', floors: 2, floorH: 3.8,
    poly: [[123.3, -1.1], [151.4, -1.9], [150.2, 10.3], [123.6, 10.5]],
  },
  {
    id: 'hostel1', name: 'PES Boys Hostel', style: 'hostel', floors: 5,
    poly: [[64.5, 77.8], [58.8, 67.7], [50.7, 60.6], [44.4, 57.4], [36.0, 57.3], [35.9, 51.6], [25.9, 51.3], [26.8, 77.8], [20.0, 78.0], [20.2, 85.6], [14.6, 85.8], [14.7, 90.2], [-2.1, 90.7], [-1.5, 108.1], [-4.2, 108.2], [-3.8, 120.4], [40.4, 119.1], [39.9, 104.3], [48.8, 104.0], [48.5, 95.1], [74.6, 94.3], [74.3, 84.7], [64.7, 85.0]],
    roof: { tanks: 4 },
  },
  {
    id: 'hostel2', name: 'PES Boys Hostel (Annexe)', style: 'hostel', floors: 5,
    poly: [[24.2, 138.2], [23.6, 128.0], [-9.5, 129.0], [-13.7, 125.4], [-14.1, 92.3], [-26.1, 93.0], [-23.7, 140.7]],
    roof: { tanks: 3 },
  },
  // OSM buildings inside the campus that were missing (src/world/data/osm.json; reference/sat_campus.jpg shows all three):
  // the hostel IT-Block (1182315666, 3 levels, cream with a stepped / crenellated parapet: 2021 hostel tour 1OVI1TlGEho
  // 2:50–3:32), the PES Food Court (351160549, 2 levels, OSM restaurant node inside) west of Pie R Cube, and a 3-level
  // hostel block (347418355) south of the Boys Hostel. Parapet merlons + the food court's colonnade: src/world/blocks.ts.
  {
    id: 'hostel_it', name: 'PES Boys Hostel — IT Block', style: 'oldCream', floors: 3, floorH: 3.5, roof: { tanks: 3, parapet: 0.9 },
    poly: [[-39.0, 68.9], [-38.3, 68.9], [-38.0, 82.0], [-9.5, 81.4], [-9.6, 76.5], [13.6, 76.0], [13.3, 64.0], [14.9, 63.9], [14.8, 58.3], [6.4, 58.5], [6.4, 56.6], [3.0, 56.7], [3.0, 58.6], [-18.4, 59.0], [-18.3, 62.2], [-19.6, 62.3], [-19.7, 59.0], [-23.1, 59.1], [-23.1, 60.7], [-27.5, 60.8], [-27.5, 59.2], [-31.2, 59.3], [-31.1, 63.4], [-32.5, 63.4], [-32.5, 62.6], [-39.1, 62.7]],
  },
  {
    id: 'food_court', name: 'PES Food Court', style: 'oldCream', floors: 2, floorH: 3.8, roof: { tanks: 2 },
    poly: [[-27.9, 53.3], [-15.0, 52.6], [-16.4, 27.2], [-29.3, 27.9]],
  },
  {
    id: 'hostel_s', name: 'PES Boys Hostel — south block', style: 'hostel', floors: 3, floorH: 3.5, roof: { tanks: 2 },
    poly: [[44.8, 132.4], [53.9, 141.2], [66.3, 129.8], [57.2, 120.5]],
  },
  {
    // just inside the main gate, west of the north pillar (MAIN_GATE_X − 9.5 … − 6), blue door facing the gate apron
    id: 'cabin_gate', name: 'Security Cabin', style: 'admin', floors: 1, floorH: 2.8,
    poly: [[154.5, -145.4], [158, -145.4], [158, -142], [154.5, -142]],
    sign: { text: 'SECURITY', edge: 2, offset: 0.2, color: '#2d59a8' },
  },
  {
    id: 'cabin_west', name: 'West Gate Cabin', style: 'admin', floors: 1, floorH: 3,
    poly: [[-68, -97], [-64.5, -97], [-64.5, -94], [-68, -94]],
  },
];

/**
 * MRD local plan frame (reference/MRD_NOTES.md §5): origin = midpoint of the east curtain-wall face (OSM V14 → V12),
 * s along that face (+ towards NNE), t into the building (+ towards WSW). Hoisted (plain numbers) so BUILDINGS can use it.
 */
export function mrdAt(s: number, t: number): V2 {
  return [66.7 + 0.51729 * s - 0.85581 * t, -150.55 - 0.85581 * s - 0.51729 * t];
}
/** Unit axes of the MRD frame (see mrdAt). */
export const MRD_FRAME = { origin: [66.7, -150.55] as V2, u: [0.51729, -0.85581] as V2, n: [-0.85581, -0.51729] as V2 };
/**
 * MRD interior levels (m): ground floor at the forecourt level, 1st floor, the (not walkable) upper gallery floors, roof.
 * `u*` = slab undersides. The atrium (local s −16…9.6, t 15.3…33.5) has its void centred at `c` (octagon apothem
 * `voidR`, gallery ring apothem `ringR`), mrdUpperPieces() fill the atrium footprint minus the ring from `u2` up.
 */
export const MRD_LV = {
  f0: 1.8, f1: 6.2, u1: 5.85, f2: 10.2, u2: 9.85, f3: 14.2, u3: 13.85, f4: 18.2, u4: 17.85, roof: 22.0, roofU: 21.6,
  atrium: { s0: -16, s1: 9.6, t0: 15.3, t1: 33.5 }, c: [-3.2, 24.4] as [number, number], voidR: 5.0, ringR: 7.4,
};
/** Octagon (frame coordinates, sides parallel to s / t) with apothem r round the atrium centre, counter-clockwise from −t. */
export function mrdOctagon(r: number): [number, number][] {
  const h = r * Math.tan(Math.PI / 8), [cs, ct] = [-3.2, 24.4];
  return [[-h, -r], [h, -r], [r, -h], [r, h], [h, r], [-h, r], [-r, h], [-r, -h]].map(([a, b]) => [cs + a, ct + b] as [number, number]);
}
/** The atrium's upper floors (2nd floor up): the atrium footprint minus the gallery ring, as four extruded pieces. */
function mrdUpperPieces(): BuildingDef[] {
  const [cs, ct] = [-3.2, 24.4], hs = 12.8, ht = 9.1, g = 7.4, h = g * Math.tan(Math.PI / 8);
  const P = (pts: [number, number][]): V2[] => pts.map(([a, b]) => mrdAt(cs + a, ct + b));
  const piece = (id: string, name: string, pts: [number, number][]): BuildingDef => ({
    id, name, style: 'oldCream', floors: 4, floorH: 4.0, base: 9.85, top: 22, soffit: 'grey', roof: { parapet: 0.4 }, poly: P(pts),
  });
  return [
    piece('mrd_up_s', 'Prof. MRD Block — atrium upper floors (south)', [[-hs, -ht], [-hs, ht], [-h, g], [-g, h], [-g, -h], [-h, -g]]),
    piece('mrd_up_n', 'Prof. MRD Block — atrium upper floors (north)', [[hs, ht], [hs, -ht], [h, -g], [g, -h], [g, h], [h, g]]),
    piece('mrd_up_e', 'Prof. MRD Block — atrium upper floors (east)', [[-hs, -ht], [-h, -g], [h, -g], [hs, -ht]]),
    piece('mrd_up_w', 'Prof. MRD Block — atrium upper floors (west)', [[hs, ht], [h, g], [-h, g], [-hs, ht]]),
    // over the corridor to the Open Air Theatre side (its façade below is hand-built round the door)
    { id: 'mrd_up_corr', name: 'Prof. MRD Block — over the OAT-side corridor', style: 'oldCream', floors: 4, floorH: 4.0, base: 9.85, top: 22, soffit: 'grey', roof: { parapet: 0.4 },
      poly: [mrdAt(-16, 19), mrdAt(-16, 22), mrdAt(-20.95, 22), [37.7, -143.7], mrdAt(-20.602, 19)] },
  ];
}
/**
 * Plan footprints of the enterable interiors (walls, floors, ceilings hand-built): the MRD lobby block, atrium, OAT-side
 * corridor and auditorium passage. Facade ledges are not drawn on building faces that front one of these.
 */
export const INTERIOR_ZONES: V2[][] = [
  [mrdAt(-12.7, 0), mrdAt(12.5, 0), mrdAt(12.5, 15.3), mrdAt(-12.7, 15.3)],
  [mrdAt(-16, 15.3), mrdAt(9.6, 15.3), mrdAt(9.6, 33.5), mrdAt(-16, 33.5)],
  [mrdAt(-16, 19), mrdAt(-16, 22), mrdAt(-20.95, 22), mrdAt(-20.602, 19)],
  [mrdAt(-6.6, 33.5), mrdAt(-4.2, 33.5), mrdAt(-4.2, 38.895), mrdAt(-6.6, 38.407)],
];
/** Admission Enquiry building outline (OSM), with extra vertices on the walkway face round the enquiry hall's glazed front. */
export function admissionPoly(): V2[] {
  return [[156.2, -120.5], [158.2, -120.51], [170.2, -120.54], [184, -120.6], [184.1, -107.3], [156.2, -106.6]];
}
/** F-Block tower roof sign ("PES", facing north towards GJBC's east colonnade): centre on the tower's north edge. */
export const F_BLOCK_SIGN = { x: 112.0, y: 37.6, z: 19.3, rot: 0.15, nx: -0.15, nz: -1 };
/**
 * Octagonal skylight lantern over the MRD atrium void (tour 2026 4:40–5:00: pyramid glazing on a white frame). Built by
 * mrd.ts on the roof slab round the void (`base` = MRD_LV.roof); centre = the atrium void centre.
 */
export const MRD_DRUM = { center: mrdAt(-3.2, 24.4), radius: 5.0, base: 22.0, height: 1.3, sides: 8 };

// ---------------------------------------------------------------------------------------------
// Gates (breakable). Zombies must break them; players can repair.
// The main gate has two sliding leaves (IN = south lane, OUT = north lane) with a solid median island.
// ---------------------------------------------------------------------------------------------
/**
 * x of the main-gate line. Google satellite (z20/z21 tiles, reference/frames/campus/gsat_gate*.jpg), the user's Google
 * Maps screenshot and the GJB tour (0:00–0:30: the pedestrian door in the south pillar opens onto the walkway along the
 * mural tower's north face) put the portal at the WEST end of the "Admission Enquiry" block, its south pillar merged
 * with the NE corner of the 4-storey mural tower (x ≈ 155–168). It was at x = 176 before (the OSM carriageway ends).
 */
export const MAIN_GATE_X = 164;
const GX = MAIN_GATE_X;
export const GATES: GateDef[] = [
  { id: 'main', a: [GX, -141.25], b: [GX, -122.5], hp: 1500, activeFromWave: 1 },
  { id: 'west', a: [-72, -110.5], b: [-72, -96.5], hp: 900, activeFromWave: 4 },
];

/**
 * The white portal of the main gate (§3.6): beam ≈26 m span, underside 8 m, top 10.6 m, 4 m thick (E–W).
 * Legacy fields (x, zN, zS, pillarW, pillarD, height, beamH) are kept for older callers.
 */
export const MAIN_GATE_PORTAL = {
  x: GX, zN: -143, zS: -120.5, pillarW: 3.5, pillarD: 4, height: 10.6, beamH: 2.6,
  beamBottom: 8.0, beamThick: 4,
  northPillar: { cx: GX, cz: -143, size: 3.5 },
  southPillar: { cx: GX, cz: -120.5, size: 4 },
  lanes: [
    { id: 'in', z0: -130.75, z1: -122.5 },
    { id: 'out', z0: -141.25, z1: -132.25 },
  ],
  median: { x0: GX - 5, x1: GX + 5, z0: -132.25, z1: -130.75 },
};

// ---------------------------------------------------------------------------------------------
// Compound walls (the play boundary). Gaps = gates.
// ---------------------------------------------------------------------------------------------
export const WALLS: WallDef[] = [
  // along the Outer Ring Road: white plaster next to the gate (a short return from the north pillar to the ring-road
  // line, which runs along the service road's inner edge), then rough-dressed granite blocks
  { kind: 'plaster', height: 2.6, pts: [[GX, -144.6], [GX - 1, -151.61], [150, -158.8]] },
  { kind: 'stone', height: 2.5, pts: [[150, -158.8], [107.2, -180.2], [70, -199], [42, -214], [26, -221], [-4, -220], [-46, -215], [-72, -205]] },
  // west boundary (construction hoarding beyond), with the west gate gap on PES University Rd
  { kind: 'stone', height: 2.5, pts: [[-72, -205], [-72, -110.5]] },
  { kind: 'hoarding', height: 3.2, pts: [[-72, -96.5], [-72, 142]] },
  // south boundary behind the hostels
  { kind: 'stone', height: 2.5, pts: [[-72, 142], [80, 142], [80, 78]] },
  // east: F-block → around the HPC lab / food point (granite), then the 2-wheeler parking's back wall (the parking's
  // lawn-facing corten + green-mesh screen is built with the parking, src/world/gjb/parking.ts), then to the gate building
  { kind: 'stone', height: 2.5, pts: [[127.8, 62], [154, 12], [154, PARKING.backZ1], [PARKING.backX, PARKING.backZ1]] },
  { kind: 'plaster', height: PARKING.roof + 1.0, pts: [[PARKING.backX, PARKING.backZ1], [PARKING.backX, PARKING.backZ0]] },
  { kind: 'plaster', height: 2.6, pts: [[PARKING.backX, PARKING.backZ0], [156.2, PARKING.backZ0]] },
];
/** White free-standing low walls on the east lawn, in front of the parking's corten face (not part of the boundary). */
export const LOW_WALLS: { a: V2; b: V2; height: number }[] = [
  { a: [116.6, -84], b: [116.6, -70], height: 1.3 },
  { a: [116.6, -58], b: [116.6, -42], height: 1.3 },
];

// ---------------------------------------------------------------------------------------------
// Roads (inside campus) and paved/lawn areas
// ---------------------------------------------------------------------------------------------
export const ROADS: RoadDef[] = [
  // Entry road from the main gate, ~12 m, one undivided carriageway with black & white kerbs (2026 tour 0022 / 0530 /
  // 1952 and the GJB tour show no lane divider or scooter rows inside the gate; buses park along the south kerb)
  { id: 'entry', kind: 'asphalt', width: 12, kerb: true, pts: [[GX + 3, -131.9], [GX - 8, -131.6], [152, -131], [130, -128], [110, -125.4], [96, -124.2], [86, -123.6]] },
  // PES University Rd: through the GJBC drive-through, along the covered plaza, between GJBC and B-Block, to the west gate
  { id: 'pes_univ_rd', kind: 'asphalt', width: 8, kerb: true, pts: PES_RD },
  // Loop road: MRD east entrance → round MRD and B-Block → back to PES University Rd
  { id: 'mrd_loop', kind: 'asphalt', width: 6, kerb: true, pts: [[72, -121.7], [72, -133], [77.5, -144.7], [80, -149], [92.1, -171.8], [80.4, -179.1], [67.3, -186.3], [39.5, -199.5], [25, -204.4], [9.3, -206.1], [-3.5, -203.7], [-38.4, -198.8], [-49.3, -196.6], [-56.9, -177.8], [-61, -153.1], [-61, -116.2], [-60.2, -104.6]] },
  // Link road between B-Block and MRD
  { id: 'b_mrd_link', kind: 'asphalt', width: 6, kerb: true, pts: [[-3.5, -203.7], [-2, -160], [0.1, -111]] },
  // Bus drop-off lane into the GJBC east forecourt (buses park on the pavers by the colonnade)
  { id: 'bus_bay', kind: 'asphalt', width: 7, pts: [[92, -119], [94.5, -106], [96, -94]] },
  // Service road south of GJBC (F-Block, terraced garden, Pie R Cube)
  { id: 'south_service', kind: 'asphalt', width: 6, kerb: true, pts: [[103, 44], [98, 48], [88, 54], [74, 61], [67, 53], [57, 47], [45, 44], [30, 43], [21, 44]] },
  // Service road along the GJBC south-west edge (Tech Park, G-Block)
  { id: 'west_service', kind: 'asphalt', width: 6, kerb: true, pts: [[-71, 26.5], [-56, 24.8], [-43, 23.8], [-14, 21.8], [-6, 21.4]] },
];

/** Pedestrian paths (strips are also exported as paved AREAS). */
export const PATHS: PathDef[] = [
  // PES Lawn promenade (striped "barcode" pavers, fountain-grass beds each side) → east plaza → ramp
  { id: 'pes_lawn_promenade', surface: 'plaza', width: 6, pts: [[GX - 11, -142.5], [150, -142], [130, -139], [110, -136.8], [100, -136.2]] },
  // south-side walkway along the entry road to the gate: along the mural tower's north face to the pedestrian door in
  // the south pillar
  { id: 'entry_south_walkway', surface: 'plaza', width: 3.5, pts: [[GX - 2, -122.2], [156, -122.2], [150, -121.3], [140, -119.3], [120, -117.1], [104, -115.6]] },
  // GJBC east promenade (grey two-tone pavers), forecourt → Law terrace stair → F-Block
  { id: 'east_promenade', surface: 'greypaver', width: 9, pts: [[90.5, -113], [92, -95], [95, -60], [98.5, -10], [101, 20], [102.5, 44]] },
  // diagonal path across the east lawn
  // diagonal path across the east lawn to the parking's middle door
  { id: 'lawn_diagonal', surface: 'greypaver', width: 3, pts: [[100.6, -50], [118.4, -64]] },
  // PES Lawn path: from the plaza terrace's north ramp through the garden towards the ring-road wall (satellite)
  { id: 'pes_lawn_north', surface: 'paver', width: 4, pts: [[105.5, -172.6], [105.5, -179]] },
  // footway round the Open Air Theatre
  { id: 'oat_footway', surface: 'paver', width: 2.5, pts: [[38, -117.5], [37, -123], [34.5, -131], [34, -138], [36, -143]] },
];

const pathPoly = (p: PathDef): V2[] => { const s = polylineToStrip(p.pts, p.width); return [...s.left, ...s.right.slice().reverse()]; };

export const AREAS: AreaDef[] = [
  // PES Lawn (the big lawn between MRD and the ring road)
  { id: 'pes_lawn', kind: 'lawn', poly: [[91, -150.5], [PLAZA_TERRACE.x0, -150.5], [PLAZA_TERRACE.x0, PLAZA_TERRACE.zS], [PLAZA_TERRACE.x1, PLAZA_TERRACE.zS], [114, -142.5], [130, -145], [150, -148], [GX - 3, -149.2], [GX - 3.5, -151.9], [150, -158.4], [107.2, -179.6], [96, -173.5]] },
  // frangipani garden between the MRD loop road and the east plaza (the gold globe stands at its east end)
  { id: 'frangipani_garden', kind: 'lawn', poly: [[80.6, -141], [88, -141], [88, -150.5], [91, -150.5], [96, -163], [90.5, -166], [82, -150.8]] },
  // east lawn (Student Lounge + garden) between GJBC's east promenade and the 2-wheeler parking: young trees, white low
  // walls; the reflecting pool at its north end, the parking's corten face on its east side (reference/GJB_NOTES.md §4)
  { id: 'east_lawn', kind: 'lawn', poly: [[104, -104.2], [118.4, -104.2], [118.4, -30.5], [121.2, -30.5], [121.2, -4], [103.5, -3], [103.1, -10], [99.6, -60], [97.0, -90], [96.7, -94], [104, -94]] },
  // 2-wheeler parking: concrete ground floor under the deck; paved pool court + strip along the corten face; north entry strip
  { id: 'parking_floor', kind: 'concrete', poly: PARKING_FOOTPRINT },
  { id: 'parking_apron', kind: 'greypaver', poly: [[101, -110.6], [PARKING.x0, -110.6], [PARKING.x0, -30.5], [118.4, -30.5], [118.4, -104.2], [100.9, -104.2]] },
  { id: 'parking_entry', kind: 'greypaver', poly: [[119.6, -115.3], [PARKING.backX, -117.2], [PARKING.backX, PARKING.z0], [119.6, PARKING.z0]] },
  // Open Air Theatre lawn
  // Open Air Theatre ground (paved; tiers, stage, terrace are geometry in src/world/oat.ts). Kind is not lawn any more.
  { id: 'oat_lawn', kind: 'concrete', poly: [[4.0, -120.5], [3.7, -149.7], [12.5, -150.2], [21.4, -146.4], [27.6, -138.6], [31.5, -123.6], [10.4, -121.3]] },
  // lawn around B-block front
  { id: 'bblock_lawn', kind: 'lawn', poly: [[-58, -150], [-54, -176], [-51, -113.5], [-58, -114]] },
  // drive apron east of B-Block along the link road (a raised walkway runs along the facade, bblock.ts; 2021 tour)
  { id: 'bblock_east_lawn', kind: 'concrete', poly: [[-6.5, -118], [-5.8, -148], [-8.5, -148], [-7.4, -118]] },
  { id: 'bblock_east_lawn_n', kind: 'concrete', poly: [[-5.9, -172], [-6.8, -195], [-10.4, -195], [-9.35, -172]] },
  // (the Quad, the covered plaza and the inner court are granite floors on the L1 podium, drawn by gjbc.ts — see GJB_L1_FLOORS)
  // GJBC east forecourt (bus drop-off)
  { id: 'gjbc_east_forecourt', kind: 'greypaver', poly: [[86.2, -117.2], [104, -115.3], [104, -94], [86.8, -94]] },
  // east plaza (striped pavers) — the ramp rises west from here
  { id: 'east_plaza', kind: 'plaza', poly: [[84, -150.5], [PLAZA_TERRACE.x0, -150.5], [PLAZA_TERRACE.x0, PLAZA_TERRACE.zS], [PLAZA_TERRACE.x1, PLAZA_TERRACE.zS], [114, -130.2], [104, -129.8], [88, -129.8], [84, -137]] },
  // Pie R Cube plaza
  { id: 'pie_r_cube', kind: 'paver', poly: [[-10, 21], [18, 21], [18, 45], [3, 49], [-6, 49]] },
  // terraced garden below the Law terrace (granite planter tiers, palms)
  { id: 'terraced_garden', kind: 'paver', poly: [[60, 44], [95, 42], [99, 50], [76, 66], [62, 58]] },
  // food point apron
  { id: 'food_apron', kind: 'concrete', poly: [[121.5, -30], [133.4, -30], [133.4, -3], [121.5, -3]] },
  // outside forecourt (grey interlocking pavers) between the gate and the ORR service road
  { id: 'gate_forecourt', kind: 'concrete', poly: [[GX, -150.6], [GX, -120.6], [184, -120.8], [214, -122], [216, -122.4], [216, -128.4], [196, -139], [182, -146.6], [172, -148.8]] },
  // pedestrian path strips
  ...PATHS.map((p): AreaDef => ({ id: p.id, kind: p.surface === 'greypaver' ? 'greypaver' : p.surface === 'plaza' ? 'plaza' : 'paver', poly: pathPoly(p) })),
];

// ---------------------------------------------------------------------------------------------
// Gameplay anchors
// ---------------------------------------------------------------------------------------------
export const PLAYER_SPAWN: V2 = [128, -126];
export const PLAYER_SPAWN_YAW = -Math.PI / 2 - 0.05; // facing east toward the gate
export const NPC_SPAWNS: V2[] = [[122, -131], [124, -119.5], [116, -127]];
/** The gold PES armillary globe (model placed by Props.ts; it brings its own plinth). */
export const GLOBE_POS: V2 = [84.4, -140];
/** Height of the white drum the globe's plinth stands on (landscape.ts globe bed). */
export const GLOBE_Y = 0.9;
/** The Pie R Cube fountain (OSM amenity=fountain x 12–15, z 25–28). The old PES Lawn fountain is gone: the lawn is a garden grove. */
export const FOUNTAIN_POS: V2 = [13.5, 26.5];
/**
 * Sandbag step stacks (placed by Props.ts) up onto gate and compound-wall tops, every rise ≤ CLIMB_MAX (1.3 m).
 * `at` lies on the gate / wall centreline, `in` is the inward unit normal, `gap` the clearance (m) from the centreline
 * to the first tier. Tiers run inward from there, each two bags deep; `layers` gives each tier's bag layers (0.57 m
 * pitch on a 0.69 m bag: 2 layers = 1.26 m, 4 layers = 2.40 m under the 2.62 / 2.72 m wall copings).
 */
export const STEP_STACKS: { id: string; at: V2; in: V2; gap: number; layers: number[] }[] = [
  { id: 'main_out', at: [GX, -136.5], in: [-1, 0], gap: 0.27, layers: [2] },
  { id: 'main_in', at: [GX, -126.2], in: [-1, 0], gap: 0.27, layers: [2] },
  { id: 'west', at: [-72, -107.7], in: [1, 0], gap: 0.27, layers: [2] },
  { id: 'orr_plaster', at: [159.55, -153.89], in: [-0.4569, 0.8896], gap: 0.23, layers: [4, 2] },
  { id: 'orr_stone', at: [126.74, -170.43], in: [-0.4472, 0.8944], gap: 0.23, layers: [4, 2] },
];

/** Zombie spawn zones outside the walls, keyed by the gate they funnel into. */
export const SPAWN_ZONES: { gate: string; pts: V2[] }[] = [
  { gate: 'main', pts: [orrPoint(95, -12), orrPoint(120, -8), orrPoint(140, -4), orrPoint(160, 2), orrPoint(60, -10), orrPoint(75, 0), orrPoint(180, 6), orrPoint(110, 6)] },
  { gate: 'west', pts: [[-100, -102], [-110, -95], [-115, -108], [-125, -100], [-120, -104]] },
];

/** Interactable stations (COD-style). */
export type StationKind = 'ammo' | 'health' | 'weapon' | 'repair';
export interface StationDef { id: string; kind: StationKind; pos: V2; cost: number; item?: string; label: string; /** floor height (multi-level), default 0 */ y?: number }
export const STATIONS: StationDef[] = [
  { id: 'ammo_gate', kind: 'ammo', pos: [150, -121], cost: 250, label: 'Ammo crate' },
  // moved from the Quad (22.5, −33) into the enterable G-floor east lobby; belongs back in the Quad's SW arcade on L1 once levels land
  { id: 'ammo_court', kind: 'ammo', pos: [64, -81], cost: 250, label: 'Ammo crate' },
  { id: 'ammo_food', kind: 'ammo', pos: [127, -27.5], cost: 250, label: 'Ammo crate' },
  { id: 'ammo_bblock', kind: 'ammo', pos: [-30, -108.6], cost: 250, label: 'Ammo crate' },
  { id: 'med_admission', kind: 'health', pos: [GX - 6.5, -122.3], cost: 400, label: 'First-aid kit' },
  // moved from the Quad (45.5, −78) into the enterable G-floor cafeteria; belongs back in the Quad's east arcade on L1 once levels land
  { id: 'med_court', kind: 'health', pos: [74.8, 4], cost: 400, label: 'First-aid kit' },
  { id: 'buy_shotgun', kind: 'weapon', item: 'shotgun', pos: [GX - 4.5, -140.2], cost: 1200, label: 'Security locker — Shotgun' },
  { id: 'buy_smg', kind: 'weapon', item: 'smg', pos: [133, -24.5], cost: 1500, label: 'Canteen stash — SMG' },
  { id: 'buy_rifle', kind: 'weapon', item: 'rifle', pos: [50, -124.2], cost: 2500, label: 'NCC armoury — Rifle' },
];

/** Play-area bounds (for nav grid & culling). */
export const WORLD_BOUNDS = { minX: -130, maxX: 272, minZ: -300, maxZ: 160 };
export const CAMPUS_BOUNDS = { minX: -72, maxX: 214, minZ: -222, maxZ: 142 };
