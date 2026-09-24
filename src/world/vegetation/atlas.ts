import * as THREE from 'three';

/**
 * Vegetation texture atlases (built by tools/trees/build_atlas.py from CC0 Poly Haven / ambientCG sources).
 *
 * leaves.webp: 2048² RGBA, 4×4 cells of 512 px. Cell conventions:
 *   twig    — the card attaches at the bottom centre (u .5, v 0) and grows toward v 1
 *   rosette — attaches at the centre and is laid flat
 *   frond   — attaches at the left centre (u 0, v .5); the rachis runs along v .5
 * bark.jpg / bark_n.jpg: 2048×1024, four bark columns 512 px wide (tiling vertically).
 */
export const CELL = {
  rain: 0, gulmohar: 1, copperpod: 2, ficus: 3,
  broadleaf: 4, palmate: 5, maroon: 6, ashoka: 7,
  frangipani: 8, terminalia: 9, palmFrond: 10, fountainGrass: 11,
  plume: 12, lawnBlades: 13, fern: 14, hedge: 15,
} as const;
export type CellId = (typeof CELL)[keyof typeof CELL];

export const BARK = { rough: 0, smooth: 1, palm: 2, mottled: 3 } as const;
export type BarkId = (typeof BARK)[keyof typeof BARK];

/** Metres of bark covered by one texture column (width, height). */
export const BARK_TILE = { w: 0.9, h: 1.8 };

/** UV rect of a leaf-atlas cell: [u0, v0, u1, v1] (v0 = bottom of the cell, texture flipY). */
export function cellUV(cell: number): [number, number, number, number] {
  const col = cell % 4, row = Math.floor(cell / 4);
  const e = 1.5 / 2048; // inset against bilinear bleed
  return [col / 4 + e, 1 - (row + 1) / 4 + e, (col + 1) / 4 - e, 1 - row / 4 - e];
}

export interface FoliageTextures {
  leaves: THREE.Texture;
  bark: THREE.Texture;
  barkN: THREE.Texture;
  lawn: THREE.Texture;
  lawnN: THREE.Texture;
  /** Resolves when leaves + bark are uploaded-ready (lawn resolves separately). */
  ready: Promise<void>;
  lawnReady: Promise<void>;
  leavesLoaded: boolean;
  barkLoaded: boolean;
  lawnLoaded: boolean;
}

let _tex: FoliageTextures | null = null;

/** Shared vegetation textures (singleton; loading starts on first call). Texture objects exist immediately. */
export function foliageTextures(): FoliageTextures {
  if (_tex) return _tex;
  const base = `${import.meta.env.BASE_URL}textures/foliage/`;
  const loader = new THREE.TextureLoader();
  const load = (file: string, srgb: boolean, aniso: number, onDone: () => void): { t: THREE.Texture; p: Promise<void> } => {
    let resolve!: () => void;
    const p = new Promise<void>((r) => { resolve = r; });
    const t = loader.load(base + file, () => { onDone(); resolve(); }, undefined, () => { console.warn(`[vegetation] missing ${file}`); resolve(); });
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return { t, p };
  };
  const state = { leaves: false, bark: 0, lawn: 0 };
  const leaves = load('leaves.webp', true, 4, () => { state.leaves = true; if (_tex) _tex.leavesLoaded = true; });
  leaves.t.wrapS = leaves.t.wrapT = THREE.ClampToEdgeWrapping;
  const barkDone = () => { if (++state.bark === 2 && _tex) _tex.barkLoaded = true; };
  const bark = load('bark.jpg', true, 8, barkDone);
  const barkN = load('bark_n.jpg', false, 8, barkDone);
  const lawnDone = () => { if (++state.lawn === 2 && _tex) _tex.lawnLoaded = true; };
  const lawn = load('lawn.jpg', true, 8, lawnDone);
  const lawnN = load('lawn_n.jpg', false, 8, lawnDone);
  _tex = {
    leaves: leaves.t, bark: bark.t, barkN: barkN.t, lawn: lawn.t, lawnN: lawnN.t,
    ready: Promise.all([leaves.p, bark.p, barkN.p]).then(() => undefined),
    lawnReady: Promise.all([lawn.p, lawnN.p]).then(() => undefined),
    leavesLoaded: state.leaves, barkLoaded: state.bark === 2, lawnLoaded: state.lawn === 2,
  };
  return _tex;
}
