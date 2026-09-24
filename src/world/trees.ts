import * as THREE from 'three';
import { rng } from './geom';
import { worldUniforms, type PBRSet } from './materials';

export type TreeSpecies = 'rain' | 'ashoka' | 'gulmohar' | 'copperpod' | 'palm' | 'cloud' | 'sapling' | 'maroon' | 'frangipani' | 'ficus';

interface SpeciesDef {
  trunkH: number; trunkR: number; canopyY: number; canopyRX: number; canopyRY: number;
  cards: number; cardSize: number; atlas: number; // atlas cell 0..7
  branches: number; shape: 'umbrella' | 'column' | 'round' | 'palm' | 'tiered' | 'sparse' | 'candelabra';
  variants: number;
}

const SPECIES: Record<TreeSpecies, SpeciesDef> = {
  rain: { trunkH: 4.2, trunkR: 0.34, canopyY: 7.2, canopyRX: 6.8, canopyRY: 2.8, cards: 150, cardSize: 2.8, atlas: 0, branches: 6, shape: 'umbrella', variants: 2 },
  ashoka: { trunkH: 2.0, trunkR: 0.16, canopyY: 6.2, canopyRX: 1.35, canopyRY: 5.2, cards: 70, cardSize: 1.5, atlas: 1, branches: 0, shape: 'column', variants: 1 },
  gulmohar: { trunkH: 3.3, trunkR: 0.27, canopyY: 5.6, canopyRX: 5.2, canopyRY: 2.0, cards: 120, cardSize: 2.4, atlas: 2, branches: 5, shape: 'umbrella', variants: 1 },
  copperpod: { trunkH: 2.8, trunkR: 0.22, canopyY: 5.2, canopyRX: 3.6, canopyRY: 2.6, cards: 100, cardSize: 2.1, atlas: 3, branches: 4, shape: 'round', variants: 2 },
  palm: { trunkH: 9.5, trunkR: 0.18, canopyY: 10, canopyRX: 3.2, canopyRY: 1.2, cards: 16, cardSize: 3.6, atlas: 0, branches: 0, shape: 'palm', variants: 1 },
  // Terminalia mantaly: straight trunk, flat layered tiers
  cloud: { trunkH: 6.2, trunkR: 0.11, canopyY: 2.2, canopyRX: 2.4, canopyRY: 4.2, cards: 95, cardSize: 1.05, atlas: 6, branches: 5, shape: 'tiered', variants: 1 },
  // young Tabebuia / Pongamia saplings on the new lawns
  sapling: { trunkH: 2.2, trunkR: 0.07, canopyY: 3.4, canopyRX: 1.25, canopyRY: 1.1, cards: 26, cardSize: 1.0, atlas: 6, branches: 3, shape: 'sparse', variants: 2 },
  maroon: { trunkH: 1.8, trunkR: 0.06, canopyY: 2.9, canopyRX: 1.0, canopyRY: 1.1, cards: 26, cardSize: 0.9, atlas: 4, branches: 3, shape: 'sparse', variants: 1 },
  frangipani: { trunkH: 1.3, trunkR: 0.16, canopyY: 3.2, canopyRX: 2.5, canopyRY: 1.2, cards: 55, cardSize: 1.2, atlas: 5, branches: 6, shape: 'candelabra', variants: 1 },
  ficus: { trunkH: 3.8, trunkR: 0.45, canopyY: 7.5, canopyRX: 6.2, canopyRY: 4.2, cards: 190, cardSize: 2.8, atlas: 7, branches: 6, shape: 'round', variants: 1 },
};

/** Canvas atlas (4x2 cells): dense green, light green, gulmohar red, copperpod yellow, maroon, frangipani white, fine light green, dark ficus. */
function leafAtlas(): THREE.CanvasTexture {
  const CW = 512, CH = 512;
  const c = document.createElement('canvas');
  c.width = CW * 4; c.height = CH * 2;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  const r = rng(99);
  const cells: { greens: string[]; flower?: string[]; leaf?: number; n?: number; flowers?: number }[] = [
    { greens: ['#2f6a2a', '#3f7d31', '#4f8f3a', '#255a22', '#5f9c42'] },
    { greens: ['#355f2a', '#46752f', '#58893a', '#2a4a22'], leaf: 11, n: 700 },
    { greens: ['#2f5a28', '#3f6c30', '#4d7c37'], flower: ['#e0421d', '#f2622a', '#c9311a', '#ff7a3a'] },
    { greens: ['#3a6a2c', '#4b7b34', '#5a8a3c'], flower: ['#f5c518', '#ffd43b', '#e8b10c'] },
    { greens: ['#5a1f2a', '#6b2432', '#7a2c3a', '#4a1822', '#8a3a44'], leaf: 9 },
    { greens: ['#3f6a2c', '#4f7d34', '#5e8c3c'], flower: ['#f7f4ea', '#fffbe8', '#f1e7c0', '#fff'], leaf: 13, n: 520, flowers: 170 },
    { greens: ['#5f8f3a', '#6fa044', '#7fb04c', '#4f7f32', '#8aba58'], leaf: 5, n: 1500 },
    { greens: ['#1f4a1f', '#2a5a26', '#224f22', '#336230'], leaf: 7, n: 1300 },
  ];
  cells.forEach((cd, ci) => {
    const ox = (ci % 4) * CW, oy = Math.floor(ci / 4) * CH;
    g.save();
    g.beginPath(); g.rect(ox, oy, CW, CH); g.clip();
    const cx = ox + CW / 2, cy = oy + CH / 2;
    const n = cd.n ?? 900;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const rad = Math.sqrt(r()) * CW * 0.44;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad * 0.92;
      const edge = rad / (CW * 0.44);
      const sz = (cd.leaf ?? 8) + r() * 9;
      g.fillStyle = cd.greens[Math.floor(r() * cd.greens.length)];
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI * 2);
      g.beginPath();
      g.ellipse(0, 0, sz, sz * 0.42, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgba(255,255,220,${0.08 + (1 - edge) * 0.1})`;
      g.beginPath(); g.ellipse(-sz * 0.2, -sz * 0.08, sz * 0.5, sz * 0.15, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    if (cd.flower) {
      for (let i = 0; i < (cd.flowers ?? 120); i++) {
        const a = r() * Math.PI * 2;
        const rad = Math.sqrt(r()) * CW * 0.42;
        g.fillStyle = cd.flower[Math.floor(r() * cd.flower.length)];
        g.beginPath();
        g.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 4 + r() * 6, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

function frondTexture(): THREE.CanvasTexture {
  const W = 512, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#6b7a2a';
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(0, H / 2); g.quadraticCurveTo(W / 2, H / 2 - 10, W, H / 2 + 12); g.stroke();
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const x = t * W, y = H / 2 - 10 * Math.sin(t * Math.PI) + t * 12;
    const len = (1 - Math.abs(t - 0.4)) * 55;
    g.strokeStyle = ['#3f6b25', '#4d7c2c', '#5a8a33'][i % 3];
    g.lineWidth = 4;
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14, y + s * len); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cyl(rTop: number, rBot: number, h: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, true);
  g.translate(0, h / 2, 0);
  return g;
}

function buildTrunk(def: SpeciesDef, seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  if (def.shape === 'palm') {
    const pts: THREE.Vector3[] = [];
    const lean = 0.6 + r() * 0.6;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3(Math.sin(t * 1.2) * lean, t * def.trunkH, 0));
    }
    geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, def.trunkR, 7, false));
  } else if (def.shape === 'tiered') {
    geos.push(cyl(def.trunkR * 0.6, def.trunkR, def.trunkH + 0.4, 7));
    const tiers = 5;
    for (let k = 0; k < tiers; k++) {
      const y = def.canopyY + (k / (tiers - 1)) * (def.canopyRY);
      const rad = def.canopyRX * (1 - k / tiers * 0.72);
      for (let b = 0; b < def.branches; b++) {
        const ang = (b / def.branches) * Math.PI * 2 + k * 0.7 + r() * 0.3;
        const br = cyl(0.02, 0.045, rad * 0.9, 4);
        br.rotateZ(-Math.PI / 2 + 0.12);
        br.rotateY(ang);
        br.translate(0, y - 0.05, 0);
        geos.push(br);
      }
    }
  } else if (def.shape === 'candelabra') {
    geos.push(cyl(def.trunkR * 0.8, def.trunkR, def.trunkH + 0.2, 7));
    for (let b = 0; b < def.branches; b++) {
      const ang = (b / def.branches) * Math.PI * 2 + r() * 0.5;
      const len = 1.6 + r() * 0.8;
      const br = cyl(def.trunkR * 0.45, def.trunkR * 0.7, len, 6);
      br.rotateZ(-(0.45 + r() * 0.35));
      br.rotateY(ang);
      br.translate(0, def.trunkH, 0);
      geos.push(br);
    }
  } else {
    const trunk = new THREE.CylinderGeometry(def.trunkR * 0.75, def.trunkR * 1.15, def.trunkH + 0.6, def.trunkR < 0.1 ? 5 : 9, 3, true);
    trunk.translate(0, (def.trunkH + 0.6) / 2, 0);
    const p = trunk.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) + Math.sin(y * 0.9 + seed) * 0.08 * Math.min(1, def.trunkR * 4));
    }
    geos.push(trunk);
    for (let b = 0; b < def.branches; b++) {
      const ang = (b / def.branches) * Math.PI * 2 + r() * 0.6;
      const len = def.canopyRX * (0.45 + r() * 0.35);
      const tilt = def.shape === 'umbrella' ? 0.95 + r() * 0.3 : 0.55 + r() * 0.3;
      const br = new THREE.CylinderGeometry(def.trunkR * 0.28, def.trunkR * 0.55, len, def.trunkR < 0.1 ? 4 : 6, 1, true);
      br.translate(0, len / 2, 0);
      br.rotateZ(-tilt);
      br.rotateY(ang);
      br.translate(0, def.trunkH - 0.2 + r() * 0.5, 0);
      geos.push(br);
    }
  }
  return mergeSimple(geos);
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i) * 2, u.getY(i) * 3);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

function buildCanopy(def: SpeciesDef, seed: number): THREE.BufferGeometry {
  const r = rng(seed * 31 + 7);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const center = new THREE.Vector3(0, def.canopyY, 0);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const cu = (def.atlas % 4) * 0.25, cv = 1 - (Math.floor(def.atlas / 4) + 1) * 0.5;
  const card = (p: THREE.Vector3, n: THREE.Vector3, s: number, shade: number) => {
    const o = pos.length / 3;
    for (const [cx, cy] of corners) {
      const v = new THREE.Vector3(cx * s, cy * s, 0).applyQuaternion(q).add(p);
      pos.push(v.x, v.y, v.z);
      nrm.push(n.x, n.y, n.z);
      uv.push(cu + (cx + 0.5) * 0.25, cv + (cy + 0.5) * 0.5);
      col.push(shade, shade, shade);
    }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  if (def.shape === 'palm') {
    for (let i = 0; i < def.cards; i++) {
      const ang = (i / def.cards) * Math.PI * 2 + r() * 0.3;
      const droop = 0.35 + r() * 0.5;
      const L = def.cardSize, Wd = 0.9;
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const base = center.clone().add(new THREE.Vector3(Math.sin(1.2) * 0.9, 0, 0));
      const tip = base.clone().addScaledVector(dir, L * Math.cos(droop)).add(new THREE.Vector3(0, -L * Math.sin(droop), 0));
      const mid = base.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.5, 0));
      const pts = [base, mid, tip];
      const o = pos.length / 3;
      for (let k = 0; k < 3; k++) {
        const p = pts[k];
        for (const s of [-1, 1]) {
          const v = p.clone().addScaledVector(side, s * Wd * 0.5);
          pos.push(v.x, v.y, v.z);
          nrm.push(0, 1, 0);
          uv.push(k / 2, s < 0 ? 0 : 1);
          col.push(0.9, 0.9, 0.9);
        }
      }
      idx.push(o, o + 2, o + 3, o, o + 3, o + 1, o + 2, o + 4, o + 5, o + 2, o + 5, o + 3);
    }
  } else if (def.shape === 'tiered') {
    const tiers = 5;
    const per = Math.round(def.cards / tiers);
    for (let k = 0; k < tiers; k++) {
      const y = def.canopyY + (k / (tiers - 1)) * def.canopyRY;
      const rad = def.canopyRX * (1 - (k / tiers) * 0.72);
      for (let i = 0; i < per; i++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * rad;
        const p = new THREE.Vector3(Math.cos(a) * rr, y + (r() - 0.5) * 0.25, Math.sin(a) * rr);
        e.set(-Math.PI / 2 + (r() - 0.5) * 1.3, 0, r() * Math.PI * 2, 'XZY');
        q.setFromEuler(e);
        card(p, new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4).normalize(), def.cardSize * (0.8 + r() * 0.5) * (1 - k * 0.08), 0.85 + 0.15 * (k / tiers) + r() * 0.1);
      }
    }
  } else {
    for (let i = 0; i < def.cards; i++) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 20; k++) {
        x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1;
        const d = x * x + y * y + z * z;
        if (d <= 1 && d > (def.shape === 'sparse' ? 0.05 : 0.25)) break;
      }
      if (def.shape === 'umbrella' || def.shape === 'candelabra') y = y * 0.8 + 0.15 * (1 - (x * x + z * z));
      const p = new THREE.Vector3(x * def.canopyRX, y * def.canopyRY, z * def.canopyRX).add(center);
      const n = new THREE.Vector3(x, y * 1.4 + 0.3, z).normalize();
      e.set((r() - 0.5) * 1.6, r() * Math.PI * 2, (r() - 0.5) * 1.6);
      q.setFromEuler(e);
      const s = def.cardSize * (0.75 + r() * 0.5);
      const shade = 0.55 + 0.45 * Math.max(0, n.y * 0.5 + 0.5) * (0.7 + 0.3 * (p.distanceTo(center) / Math.max(def.canopyRX, def.canopyRY)));
      card(p, n, s, shade);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function windify(mat: THREE.MeshStandardMaterial, amount: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.uniforms.uWind = worldUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
  #endif
  #ifdef USE_BATCHING
    ip = batchingMatrix[3].xyz;
  #endif
  float h = max(transformed.y - 2.0, 0.0);
  float ph = ip.x * 0.13 + ip.z * 0.17;
  float sway = sin(uTime * 1.3 + ph) * 0.5 + sin(uTime * 2.7 + ph * 1.7 + transformed.x) * 0.25;
  transformed.x += sway * h * ${amount.toFixed(4)} * uWind;
  transformed.z += cos(uTime * 1.1 + ph) * h * ${(amount * 0.6).toFixed(4)} * uWind;
}`);
  };
  mat.customProgramCacheKey = () => `wind_${amount}`;
}

/**
 * Trees: all species share two BatchedMeshes (trunks, leaf canopies) + one for palm fronds,
 * with per-instance frustum culling → ~3 draw calls for every tree on the map.
 */
export class TreeSystem {
  private items = new Map<TreeSpecies, THREE.Matrix4[]>();
  group = new THREE.Group();
  private leafMat: THREE.MeshStandardMaterial;
  private frondMat: THREE.MeshStandardMaterial;
  private barkMat: THREE.MeshStandardMaterial;

  constructor(bark: PBRSet) {
    this.leafMat = new THREE.MeshStandardMaterial({ map: leafAtlas(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85, metalness: 0 });
    windify(this.leafMat, 0.022);
    this.frondMat = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8 });
    windify(this.frondMat, 0.03);
    this.barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95, color: 0xb8a89a });
    this.group.name = 'trees';
  }

  add(species: TreeSpecies, x: number, z: number, scale = 1, rot = 0): void {
    let list = this.items.get(species);
    if (!list) this.items.set(species, (list = []));
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(scale, scale * (0.9 + ((x * 7.13 + z * 3.7) % 1 + 1) % 1 * 0.2), scale));
    list.push(m);
  }

  count(): number {
    let n = 0;
    for (const l of this.items.values()) n += l.length;
    return n;
  }

  trunkRadius(species: TreeSpecies, scale: number): number {
    return Math.max(0.12, SPECIES[species].trunkR * scale * 1.1);
  }

  build(): THREE.Group {
    type Entry = { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry; mats: THREE.Matrix4[]; palm: boolean };
    const entries: Entry[] = [];
    for (const [species, mats] of this.items) {
      const def = SPECIES[species];
      for (let v = 0; v < def.variants; v++) {
        const subset = mats.filter((_, i) => i % def.variants === v);
        if (!subset.length) continue;
        entries.push({ trunk: buildTrunk(def, 11 + v * 101 + def.atlas * 7), canopy: buildCanopy(def, 23 + v * 57 + def.atlas * 3), mats: subset, palm: species === 'palm' });
      }
    }
    const makeBatch = (list: { geo: THREE.BufferGeometry; mats: THREE.Matrix4[] }[], mat: THREE.Material, name: string) => {
      if (!list.length) return;
      let nInst = 0, nV = 0, nI = 0;
      for (const e of list) { nInst += e.mats.length; nV += e.geo.attributes.position.count; nI += e.geo.index!.count; }
      const bm = new THREE.BatchedMesh(nInst, nV, nI, mat);
      for (const e of list) {
        const gid = bm.addGeometry(e.geo);
        for (const m of e.mats) { const id = bm.addInstance(gid); bm.setMatrixAt(id, m); }
      }
      bm.castShadow = true; bm.receiveShadow = true;
      bm.perObjectFrustumCulled = true;
      bm.sortObjects = false;
      bm.name = name;
      this.group.add(bm);
    };
    makeBatch(entries.map((e) => ({ geo: e.trunk, mats: e.mats })), this.barkMat, 'trees:trunks');
    makeBatch(entries.filter((e) => !e.palm).map((e) => ({ geo: e.canopy, mats: e.mats })), this.leafMat, 'trees:leaves');
    makeBatch(entries.filter((e) => e.palm).map((e) => ({ geo: e.canopy, mats: e.mats })), this.frondMat, 'trees:fronds');
    return this.group;
  }
}
