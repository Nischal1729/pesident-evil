import '../ui/style.css';
import * as THREE from 'three';
import { Assets } from '../core/Assets';
import { Engine } from '../core/Engine';
import { loadSettings, QUALITY } from '../core/Settings';
import { Post } from '../render/Post';
import { NavGrid } from '../sim/NavGrid';
import { computeFlowField, INF } from '../sim/flowfield';
import { CampusBuilder, type CampusBuild } from './Campus';
import { GATES, NPC_SPAWNS, PLAYER_SPAWN, SPAWN_ZONES, STATIONS, WORLD_BOUNDS, type V2 } from './layout';
import { loadWorldTextures, worldUniforms } from './materials';
import { Sky } from './Sky';
import { TreeSystem } from './trees';

/**
 * Stand-alone campus viewer (fly camera) used to verify the procedural campus.
 * URL params: ?x=&y=&z=&yaw=&pitch=&t=&q=(low|medium|high|ultra)&nav=1&props=0
 * Console: view(x,y,z,yaw,pitch,t?), goto(name) (see VIEWS), renderInfo(), measure(x,y,z,yaw,pitch), navCheck(), navMap()
 */
/** Named camera poses matching the reference key frames (x, y, z, yaw, pitch). */
const VIEWS: Record<string, [number, number, number, number, number]> = {
  gateOutside: [197, 1.7, -124.5, 1.45, 0.1], // key_0020
  gateInside: [172, 1.7, -128, 1.62, 0.06], // key_0022 / 1952
  walkwayToGate: [140, 1.7, -119.5, -1.5, 0.12], // key_1920 / 1946
  promenade: [132, 1.7, -139.5, 1.5, 0.1], // key_0141 / 0152
  eastPlaza: [112, 1.7, -134.5, 1.5, 0.12], // key_0208
  mrdSteps: [82, 1.7, -139, 1.2, 0.12], // key_0316 / 0332
  porteCochere: [101, 1.7, -120, 1.5, 0.18], // key_0538
  driveThrough: [88, 1.7, -118.5, 1.5, 0.05], // key_0540
  eastColonnade: [96, 1.7, -100, 3.1, 0.1], // key_0546
  quad: [37, 1.7, -93, 3.14, 0.12], // key_1150
  coveredPlaza: [40, 1.7, -110, 2.9, 0.1], // key_1100 / 1136
  pergolaToBBlock: [30, 1.7, -107, 0.55, 0.25], // key_1034 / 1332
  skybridges: [-15, 1.7, -107, 1.35, 0.55], // key_1352
  eastLawn: [108, 1.7, -60, -1.3, 0.05], // key_1812 (the corten face is now the parking's lawn side)
  eastPromenade: [96, 1.7, -66, 0.05, 0.08], // key_1756
  lawTerrace: [92, 10.5, 24, -2.35, -0.2], // key_1534
  aerial: [70, 230, 40, 0.25, -0.95],
};
async function boot() {
  const params = new URLSearchParams(location.search);
  const settings = loadSettings();
  const qName = (params.get('q') as keyof typeof QUALITY) || settings.quality;
  const q = QUALITY[qName] ?? QUALITY.high;
  const engine = new Engine(document.getElementById('app')!, q, settings.fov);
  const assets = new Assets();
  assets.maxAnisotropy = engine.renderer.capabilities.getMaxAnisotropy();
  const tex = await loadWorldTextures(assets);
  const trees = new TreeSystem(tex.bark);
  const t0 = performance.now();
  const builder = new CampusBuilder(tex, trees, q);
  const campus = builder.build();
  const buildMs = performance.now() - t0;
  console.log(`[campus] built in ${buildMs.toFixed(0)} ms, trees=${trees.count()}, prisms=${campus.collision.prisms.length}, cyls=${campus.collision.cyls.length}; stages ${JSON.stringify(builder.timings)}`);
  engine.scene.add(campus.group);

  // Optional props from the set-dressing agent (tolerate absence).
  if (params.get('props') !== '0') {
    const mods = import.meta.glob('./Props.ts');
    const loader = mods['./Props.ts'];
    if (loader) {
      try {
        const m = (await loader()) as Record<string, unknown>;
        const fn = m.buildProps as ((...a: unknown[]) => unknown) | undefined;
        if (typeof fn === 'function') {
          const res = await fn(assets, campus.collision, { quality: q, medianPts: builder.medianPts });
          const obj = (res as { group?: THREE.Object3D } | THREE.Object3D | undefined);
          if (obj instanceof THREE.Object3D) engine.scene.add(obj);
          else if (obj && (obj as { group?: THREE.Object3D }).group instanceof THREE.Object3D) engine.scene.add((obj as { group: THREE.Object3D }).group);
          console.log('[campus] props built');
        }
      } catch (err) {
        console.warn('[campus] props failed (ignored)', err);
      }
    }
  }

  const sky = new Sky(engine.renderer, engine.scene, q.shadowMapSize, q.shadowDistance);
  let tod = Number(params.get('t') ?? 0.15);
  sky.setTime(tod);
  const post = new Post(engine.renderer, engine.scene, engine.camera, q);
  engine.onResize = (w, h) => post.setSize(w, h);
  engine.resize();

  const cam = engine.camera;
  const pos = new THREE.Vector3(Number(params.get('x') ?? 150), Number(params.get('y') ?? 1.7), Number(params.get('z') ?? -126));
  let yaw = Number(params.get('yaw') ?? 1.6), pitch = Number(params.get('pitch') ?? 0.05);
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  engine.renderer.domElement.addEventListener('click', () => { void (engine.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== engine.renderer.domElement) return;
    yaw -= e.movementX * 0.0025; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0025));
  });
  const W = window as unknown as Record<string, unknown>;
  W.view = (x: number, y: number, z: number, yw: number, pt: number, t?: number) => { pos.set(x, y, z); yaw = yw; pitch = pt; if (t !== undefined) { tod = t; sky.setTime(t); } };
  W.dbg = { engine, sky, campus, post, THREE, builder };
  W.goto = (name: string, t?: number) => { const v = VIEWS[name]; if (!v) return Object.keys(VIEWS); pos.set(v[0], v[1], v[2]); yaw = v[3]; pitch = v[4]; if (t !== undefined) { tod = t; sky.setTime(t); } return name; };
  const startView = params.get('view');
  if (startView && VIEWS[startView]) { const v = VIEWS[startView]; pos.set(v[0], v[1], v[2]); yaw = v[3]; pitch = v[4]; }
  let lastInfo = { calls: 0, tris: 0 };
  W.renderInfo = () => ({ ...lastInfo, geos: engine.renderer.info.memory.geometries, tex: engine.renderer.info.memory.textures, buildMs: Math.round(buildMs), meshes: countMeshes(campus.group) });
  /** Synchronously render one frame from a pose and return the renderer stats (works while the tab is hidden). */
  W.measure = (x: number, y: number, z: number, yw: number, pt: number) => {
    pos.set(x, y, z); yaw = yw; pitch = pt;
    cam.position.copy(pos); cam.rotation.set(pitch, yaw, 0, 'YXZ'); cam.updateMatrixWorld();
    sky.follow(pos);
    engine.renderer.info.autoReset = false;
    engine.renderer.info.reset();
    post.render(0.016, 0);
    return { calls: engine.renderer.info.render.calls, tris: engine.renderer.info.render.triangles };
  };

  // ---- nav connectivity check -----------------------------------------------------------------
  const nav = navCheck(campus);
  W.navCheck = () => navCheck(campus);
  W.navMap = () => drawNavMap(nav.grid, nav.field);
  if (params.get('nav') === '1') drawNavMap(nav.grid, nav.field);

  const hud = document.getElementById('hud')!;
  let hudT = 0;
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fps = 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    fpsAcc += (now - last); fpsN++;
    last = now;
    worldUniforms.uTime.value += dt;
    const sp = (keys.has('ShiftLeft') ? 40 : 10) * dt;
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (keys.has('KeyW')) pos.addScaledVector(f, sp);
    if (keys.has('KeyS')) pos.addScaledVector(f, -sp);
    if (keys.has('KeyD')) pos.addScaledVector(r, sp);
    if (keys.has('KeyA')) pos.addScaledVector(r, -sp);
    if (keys.has('KeyE')) pos.y += sp;
    if (keys.has('KeyQ')) pos.y -= sp;
    if (keys.has('KeyT')) { tod = Math.min(1, tod + dt * 0.1); sky.setTime(tod); }
    if (keys.has('KeyG')) { tod = Math.max(0, tod - dt * 0.1); sky.setTime(tod); }
    cam.position.copy(pos);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    sky.follow(pos);
    for (const u of campus.updatables) u(dt, tod);
    post.setNight(worldUniforms.uNight.value);
    engine.renderer.info.autoReset = false;
    engine.renderer.info.reset();
    post.render(dt, 0);
    lastInfo = { calls: engine.renderer.info.render.calls, tris: engine.renderer.info.render.triangles };
    hudT += dt;
    if (hudT > 0.4) {
      fps = 1000 / (fpsAcc / fpsN); fpsAcc = 0; fpsN = 0; hudT = 0;
      hud.textContent = `pos ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}  yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)}  t ${tod.toFixed(2)}\n` +
        `calls ${lastInfo.calls}  tris ${(lastInfo.tris / 1000).toFixed(0)}k  fps ${fps.toFixed(0)}  build ${buildMs.toFixed(0)}ms  nav ${nav.ok ? 'OK' : 'FAIL'}`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

function countMeshes(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) n++; });
  return n;
}

/** Key places that must be reachable from the Quad (zombie field target). */
const CHECK_POINTS: Record<string, V2> = {
  quad: [37, -55],
  coveredPlaza: [37, -106],
  driveThrough: [50, -119],
  entryRoad: [130, -124],
  eastPlaza: [100, -142],
  mrdSteps: [80, -150],
  mrdLoopNorth: [60, -190],
  bBlockRoad: [-61, -140],
  eastPromenade: [98, -40],
  eastLawn: [110, -60],
  lawTerraceFoot: [100, 10],
  pieRCube: [5, 30],
  westGateInside: [-66, -104],
  westGateOutside: [-100, -102],
  gateOutside: [192, -132],
  eastBreezeway: [72, -80],
  innerCourt: [4, 0],
};

/** Route-redundancy check: seal one Quad entrance at a time and verify the Quad is still reachable from the gate. */
function routeCheck(grid: NavGrid): Record<string, number | string> {
  const b = WORLD_BOUNDS;
  const seal: Record<string, [number, number, number, number][]> = {
    coveredPlazaNorth: [[16, 59.5, -121, -107]],
    eastBreezeway: [[59, 90, -84, -76]],
    innerCourtSW: [[-8, 20, -24, -19]],
  };
  const out: Record<string, number | string> = {};
  const combos: [string, string[]][] = [['all open', []], ['no covered plaza', ['coveredPlazaNorth']], ['no breezeway', ['eastBreezeway']], ['no inner court', ['innerCourtSW']], ['only inner court', ['coveredPlazaNorth', 'eastBreezeway']], ['only breezeway', ['coveredPlazaNorth', 'innerCourtSW']], ['only covered plaza', ['eastBreezeway', 'innerCourtSW']]];
  for (const [name, keys] of combos) {
    const g = grid.grid.slice();
    for (const k of keys) for (const [x0, x1, z0, z1] of seal[k]) {
      for (let z = Math.floor(z0 - b.minZ); z < Math.ceil(z1 - b.minZ); z++) for (let x = Math.floor(x0 - b.minX); x < Math.ceil(x1 - b.minX); x++) {
        // only seal cells inside the GJBC outline band (keep PES Univ Rd itself open when sealing the plaza)
        const wx = x + b.minX + 0.5, wz = z + b.minZ + 0.5;
        if (k === 'coveredPlazaNorth' && wz < (wx <= 55 ? -113.8 + (wx - 20) * -0.161 + 5.2 : -119.4 - 0.1355 * (wx - 55) + 3.8)) continue;
        g[z * grid.w + x] = 1;
      }
    }
    const f = new Uint32Array(grid.w * grid.h);
    const q = CHECK_POINTS.quad;
    computeFlowField(grid.w, grid.h, g, grid.gateIdx, grid.gateClosed, new Float32Array([q[0] - b.minX, q[1] - b.minZ]), f, 1e9);
    const e = CHECK_POINTS.entryRoad;
    const c = f[Math.floor(e[1] - b.minZ) * grid.w + Math.floor(e[0] - b.minX)];
    out[name] = c === INF ? 'SEALED' : Math.round(c / 10);
  }
  return out;
}

function navCheck(campus: CampusBuild): { ok: boolean; grid: NavGrid; field: Uint32Array } {
  const b = WORLD_BOUNDS;
  const t0 = performance.now();
  const grid = new NavGrid(b.minX, b.minZ, b.maxX, b.maxZ);
  // build without the worker: replicate NavGrid.build's cell marking (it also spawns a worker, harmless)
  grid.build(campus.collision, GATES);
  const field = new Uint32Array(grid.w * grid.h);
  const target = CHECK_POINTS.quad;
  computeFlowField(grid.w, grid.h, grid.grid, grid.gateIdx, grid.gateClosed, new Float32Array([target[0] - b.minX, target[1] - b.minZ]), field, 1e9);
  const costAt = (x: number, z: number) => {
    const i = Math.floor(x - b.minX), j = Math.floor(z - b.minZ);
    if (i < 0 || j < 0 || i >= grid.w || j >= grid.h) return INF;
    return field[j * grid.w + i];
  };
  const fails: string[] = [];
  const report: Record<string, number | string> = {};
  const test = (name: string, p: V2) => {
    const c = costAt(p[0], p[1]);
    const blocked = grid.isBlocked(p[0], p[1]);
    report[name] = c === INF ? (blocked ? 'BLOCKED' : 'UNREACHABLE') : Math.round(c / 10);
    if (c === INF) fails.push(name);
  };
  SPAWN_ZONES.forEach((z) => z.pts.forEach((p, i) => test(`spawn_${z.gate}_${i}`, p)));
  for (const [k, p] of Object.entries(CHECK_POINTS)) test(k, p);
  test('playerSpawn', PLAYER_SPAWN);
  NPC_SPAWNS.forEach((p, i) => test(`npc_${i}`, p));
  for (const s of STATIONS) {
    // stations must be in an open, reachable cell (a crate sits there; the player stands next to it). This flat grid
    // can't see storeys: stations on an upper floor or deck (StationDef.y) are left to the layered graph in game.
    if ((s.y ?? 0) > 1) continue;
    test(`station_${s.id}`, s.pos);
  }
  // sealed pockets: free cells inside the campus bounding box that are unreachable
  let free = 0, unreach = 0;
  for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
    const idx = j * grid.w + i;
    if (grid.grid[idx] === 1) continue;
    free++;
    if (field[idx] === INF) unreach++;
  }
  const routes = routeCheck(grid);
  console.log(`[navcheck] Quad→entry-road path length (m) with entrances sealed: ${JSON.stringify(routes)}`);
  const ok = fails.length === 0;
  console.log(`[navcheck] ${ok ? 'OK' : 'FAIL'} in ${(performance.now() - t0).toFixed(0)} ms; free cells ${free}, unreachable free cells ${unreach}; fails: ${JSON.stringify(fails)}; costs (m from Quad): ${JSON.stringify(report)}`);
  return { ok, grid, field, report, fails, unreach } as { ok: boolean; grid: NavGrid; field: Uint32Array };
}

function drawNavMap(grid: NavGrid, field: Uint32Array): void {
  const c = document.getElementById('nav') as HTMLCanvasElement;
  c.width = grid.w; c.height = grid.h;
  c.style.display = 'block';
  const g = c.getContext('2d')!;
  const img = g.createImageData(grid.w, grid.h);
  for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
    const idx = j * grid.w + i;
    const o = idx * 4;
    const cell = grid.grid[idx];
    let r = 0, gg = 0, bb = 0;
    if (cell === 1) { r = gg = bb = 30; }
    else if (cell === 2) { r = 255; gg = 60; bb = 200; }
    else if (field[idx] === INF) { r = 255; gg = 40; bb = 30; }
    else { const v = Math.min(1, field[idx] / 4000); r = 60 + 150 * v; gg = 200 - 100 * v; bb = 90; }
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:0;left:0;z-index:9;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`);
});
