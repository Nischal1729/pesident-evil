import '../ui/style.css';
import * as THREE from 'three';
import { Assets } from '../core/Assets';
import { Engine } from '../core/Engine';
import { loadSettings, QUALITY } from '../core/Settings';
import { Post } from '../render/Post';
import { NavGrid } from '../sim/NavGrid';
import { computeFlowField, INF } from '../sim/flowfield';
import * as LAYOUT from './layout';
import { BUILDINGS, GATES, GLOBE_POS, NPC_SPAWNS, ORR, orrPoint, PLAYER_SPAWN, ROADS, SPAWN_ZONES, STATIONS, WALLS, WORLD_BOUNDS, type V2 } from './layout';
import { loadWorldTextures, worldUniforms } from './materials';
import { buildProps } from './Props';
import { Sky } from './Sky';
import { TreeSystem } from './trees';
import { StaticCollision } from '../sim/Collision';
import { polylineToStrip, samplePolyline } from './geom';

/**
 * Props viewer: builds the world like the game does, then adds buildProps().
 * URL: props-viewer.html?x=&y=&z=&yaw=&pitch= | look=fx,fy,fz,tx,ty,tz  &t=&q=(low|medium|high|ultra)
 *      &props=0 (world only) &nav=1 (nav-grid diff before/after props, logged) &markers=0 (hide station markers)
 *      &proxy=1 (force the stand-in world; used automatically if Campus.ts fails to load mid-edit)
 *      &debugmat=normal|basic|std (swap prop materials) &nopost=1 (render without the post chain)
 * Console: view(x,y,z,yaw,pitch,t?), look(fx,fy,fz,tx,ty,tz), goto(name), where(propName), renderInfo(),
 *          measure(x,y,z,yaw,pitch) → draw calls / triangles with vs without props (all passes), toggleProps()
 */
const VIEWS: Record<string, [number, number, number, number, number]> = {
  gate: [150, 4.5, -126, 1.55, -0.2],
  gateOut: [200, 5, -140, 1.05 - Math.PI, -0.18],
  forecourt: [186, 14, -150, 2.6, -0.55],
  median: [100, 5, -121, -1.8, -0.25],
  medianHigh: [128, 18, -112, 0.3, -0.75],
  food: [118, 5, -34, 2.7, -0.35],
  court: [34, 9, -28, 0, -0.35],
  bus: [175, 22, -200, 0.4, -0.55],
  orr: [120, 30, -150, -0.5, -0.45],
  globe: [GLOBE_POS[0] + 7, 3.2, GLOBE_POS[1] + 3, 1.2, -0.1],
  bblock: [-70, 10, -150, -1.3, -0.35],
  mrd: [100, 12, -160, 1.2, -0.3],
  hostel: [60, 12, 40, 3.14, -0.4],
  shed: [140, 8, -90, 2.8, -0.4],
};

async function boot() {
  const params = new URLSearchParams(location.search);
  const settings = loadSettings();
  const qName = (params.get('q') as keyof typeof QUALITY) || settings.quality;
  const q = QUALITY[qName] ?? QUALITY.high;
  const engine = new Engine(document.getElementById('app')!, q, settings.fov);
  engine.renderer.info.autoReset = false; // count every pass of the frame (reset manually below)
  const assets = new Assets();
  assets.maxAnisotropy = engine.renderer.capabilities.getMaxAnisotropy();
  const tex = await loadWorldTextures(assets);
  const trees = new TreeSystem(tex.bark);
  const t0 = performance.now();
  // The campus modules are being rewritten by another agent; if they don't load, fall back to a proxy world.
  let campus: WorldLike;
  let medianPts: V2[] = [];
  let builder: unknown = null;
  try {
    if (params.get('proxy') === '1') throw new Error('proxy requested');
    const mod = await import('./Campus');
    const b = new mod.CampusBuilder(tex, trees, q);
    campus = b.build();
    medianPts = b.medianPts;
    builder = b;
    console.log(`[campus] built in ${(performance.now() - t0).toFixed(0)} ms, trees=${trees.count()}, prisms=${campus.collision.prisms.length}, cyls=${campus.collision.cyls.length}`);
  } catch (err) {
    console.warn('[props-viewer] campus unavailable, using proxy world', err);
    const px = proxyWorld();
    campus = px.world;
    medianPts = px.medianPts;
    document.getElementById('hud')!.dataset.proxy = '1';
  }
  engine.scene.add(campus.group);

  const doNav = params.get('nav') === '1';
  const navBefore = doNav ? navField(campus.collision) : null;

  let propsGroup: THREE.Group | null = null;
  let anchors = new Map<string, THREE.Object3D>();
  if (params.get('props') !== '0') {
    const pb = await buildProps(assets, campus.collision, { quality: q, medianPts });
    propsGroup = pb.group;
    anchors = pb.stationAnchors;
    engine.scene.add(pb.group);
    const dm = params.get('debugmat');
    if (dm) {
      const mat = dm === 'normal' ? new THREE.MeshNormalMaterial() : dm === 'basic' ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
      pb.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.name.includes(':flat:') || m.name === 'prop:static')) m.material = mat; });
    }
    if (params.get('markers') !== '0') {
      const mGeo = new THREE.OctahedronGeometry(0.18);
      const mMat = new THREE.MeshBasicMaterial({ color: 0x55ffcc });
      for (const a of anchors.values()) {
        const m = new THREE.Mesh(mGeo, mMat);
        m.position.copy(a.position);
        engine.scene.add(m);
      }
    }
  }
  const navAfter = doNav ? navField(campus.collision) : null;
  if (navBefore && navAfter) navDiff(navBefore, navAfter);

  const sky = new Sky(engine.renderer, engine.scene, q.shadowMapSize, q.shadowDistance);
  let tod = Number(params.get('t') ?? 0.15);
  sky.setTime(tod);
  const post = new Post(engine.renderer, engine.scene, engine.camera, q);
  engine.onResize = (w, h) => post.setSize(w, h);
  engine.resize();

  const cam = engine.camera;
  const pos = new THREE.Vector3(Number(params.get('x') ?? 150), Number(params.get('y') ?? 1.7), Number(params.get('z') ?? -126));
  let yaw = Number(params.get('yaw') ?? 1.6), pitch = Number(params.get('pitch') ?? 0.05);
  const lk = params.get('look')?.split(',').map(Number);
  if (lk && lk.length === 6 && lk.every((v) => Number.isFinite(v))) {
    const [fx, fy, fz, tx, ty, tz] = lk;
    pos.set(fx, fy, fz);
    yaw = Math.atan2(-(tx - fx), -(tz - fz));
    pitch = Math.atan2(ty - fy, Math.hypot(tx - fx, tz - fz));
  }
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  engine.renderer.domElement.addEventListener('click', () => engine.renderer.domElement.requestPointerLock());
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== engine.renderer.domElement) return;
    yaw -= e.movementX * 0.0025; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0025));
  });
  const W = window as unknown as Record<string, unknown>;
  const view = (x: number, y: number, z: number, yw: number, pt: number, t?: number) => { pos.set(x, y, z); yaw = yw; pitch = pt; if (t !== undefined) { tod = t; sky.setTime(t); } };
  W.view = view;
  W.look = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number) => {
    const dx = tx - fx, dy = ty - fy, dz = tz - fz;
    view(fx, fy, fz, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  };
  /** World positions of all instances of a prop type. */
  W.where = (name: string) => {
    const out: number[][] = [];
    const m = new THREE.Matrix4();
    propsGroup?.updateMatrixWorld(true);
    propsGroup?.traverse((c) => {
      const im = c as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !c.name.startsWith(`prop:${name}:`) || c.name.split(':')[2] !== 'flat' || c.name.endsWith(':noshadow') || c.name.endsWith(':far')) return;
      for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); m.premultiply(im.matrixWorld); out.push([+m.elements[12].toFixed(1), +m.elements[13].toFixed(2), +m.elements[14].toFixed(1)]); }
    });
    return out;
  };
  W.goto = (name: string) => { const v = VIEWS[name]; if (v) view(...v); return Object.keys(VIEWS); };
  W.dbg = { engine, sky, campus, post, THREE, builder, props: propsGroup, anchors };
  void builder;
  let lastInfo = { calls: 0, tris: 0 };
  W.renderInfo = () => ({ ...lastInfo, geos: engine.renderer.info.memory.geometries, tex: engine.renderer.info.memory.textures, props: propsGroup?.userData.stats });
  const renderAt = () => {
    cam.position.copy(pos); cam.rotation.set(pitch, yaw, 0, 'YXZ'); cam.updateMatrixWorld();
    sky.follow(pos);
    engine.renderer.info.reset();
    post.render(0.016, 0);
    return { calls: engine.renderer.info.render.calls, tris: engine.renderer.info.render.triangles };
  };
  /** Render one frame from a pose with and without props → draw calls / triangles. */
  W.measure = (x: number, y: number, z: number, yw: number, pt: number) => {
    view(x, y, z, yw, pt);
    const w = renderAt();
    if (propsGroup) propsGroup.visible = false;
    const wo = renderAt();
    if (propsGroup) propsGroup.visible = true;
    return { with: w, without: wo, added: { calls: w.calls - wo.calls, tris: w.tris - wo.tris } };
  };
  W.toggleProps = () => { if (propsGroup) propsGroup.visible = !propsGroup.visible; };
  W.navDiff = () => { const b = navField(campus.collision); return b; };

  const noPost = params.get('nopost') === '1';
  const hud = document.getElementById('hud')!;
  let hudT = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    fpsAcc += now - last; fpsN++;
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
    engine.renderer.info.reset();
    if (noPost) engine.renderer.render(engine.scene, cam); else post.render(dt, 0);
    lastInfo = { calls: engine.renderer.info.render.calls, tris: engine.renderer.info.render.triangles };
    hudT += dt;
    if (hudT > 0.4) {
      fps = 1000 / (fpsAcc / fpsN); fpsAcc = 0; fpsN = 0; hudT = 0;
      hud.textContent = `${hud.dataset.proxy ? '[PROXY WORLD] ' : ''}pos ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}  yaw ${yaw.toFixed(2)} pitch ${pitch.toFixed(2)}  t ${tod.toFixed(2)}\ncalls ${lastInfo.calls}  tris ${(lastInfo.tris / 1000).toFixed(0)}k  fps ${fps.toFixed(0)}`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

interface WorldLike { group: THREE.Group; collision: StaticCollision; updatables: ((dt: number, t: number) => void)[] }

/** Minimal stand-in world built straight from layout.ts (buildings, walls, gates, roads, ORR piers + collision). */
function proxyWorld(): { world: WorldLike; medianPts: V2[] } {
  const group = new THREE.Group();
  const col = new StaticCollision();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 1 }));
  ground.position.set(60, 0, -40); ground.receiveShadow = true; group.add(ground);
  const flat = (poly: V2[], y: number, color: number) => {
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 - y * 10, polygonOffsetUnits: -1 }));
    m.receiveShadow = true; group.add(m);
  };
  for (const a of LAYOUT.AREAS) flat(a.poly, 0.03, a.kind === 'lawn' ? 0x6f8a4a : a.kind === 'concrete' ? 0xb8b2a8 : 0xa8a298);
  const strip = (pts: V2[], w: number) => { const s = polylineToStrip(pts, w); return [...s.left, ...s.right.slice().reverse()] as V2[]; };
  for (const r of ROADS) flat(strip(r.pts, r.width), 0.06, 0x3a3a3c);
  const line = (off: number) => { const p: V2[] = []; for (let t = -430; t <= 330; t += 40) p.push(orrPoint(t, off)); return p; };
  const halfMain = (ORR.width - ORR.median) / 2;
  for (const off of [ORR.median / 2 + halfMain / 2, -(ORR.median / 2 + halfMain / 2)]) flat(strip(line(off), halfMain), 0.05, 0x333335);
  for (const off of [ORR.serviceOffset, -ORR.serviceOffset]) flat(strip(line(off), ORR.serviceWidth), 0.05, 0x333335);
  const bmat = new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.9 });
  for (const b of BUILDINGS) {
    const base = b.base ?? 0;
    const h = b.top ?? (b.floorH ?? 3.7) * b.floors;
    const shape = new THREE.Shape(b.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h - base, bevelEnabled: false }).rotateX(-Math.PI / 2);
    g.translate(0, base, 0);
    const m = new THREE.Mesh(g, bmat); m.castShadow = m.receiveShadow = true; group.add(m);
    if (b.collide !== false) col.addPolygon(b.poly, h, 'concrete', `bld:${b.id}`, base);
  }
  const wmat = new THREE.MeshStandardMaterial({ color: 0x9a948c, roughness: 0.9 });
  for (const w of WALLS) for (let i = 1; i < w.pts.length; i++) {
    const a = w.pts[i - 1], b = w.pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, w.height, 0.4), wmat);
    m.position.set((a[0] + b[0]) / 2, w.height / 2, (a[1] + b[1]) / 2);
    m.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    m.castShadow = true; group.add(m);
    col.addSegment(a, b, 0.4, w.height + 0.2, 'concrete', 'wall');
  }
  const gmat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.6, roughness: 0.4 });
  for (const g of GATES) {
    const len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 0.1), gmat);
    m.position.set((g.a[0] + g.b[0]) / 2, 1.1, (g.a[1] + g.b[1]) / 2);
    m.rotation.y = Math.atan2(-(g.b[1] - g.a[1]), g.b[0] - g.a[0]);
    group.add(m);
    col.addSegment(g.a, g.b, 0.5, 2.4, 'metal', `gate:${g.id}`);
  }
  const pmat = new THREE.MeshStandardMaterial({ color: 0xc8c4bc, roughness: 0.9 });
  for (let t = -420; t < 330; t += 28) {
    const [x, z] = orrPoint(t, 0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 10.5, 12), pmat);
    m.position.set(x, 5.25, z); m.castShadow = true; group.add(m);
    col.addCircle(x, z, 1.0, 12, 'concrete', 'pier');
  }
  // median points along the entry-road divider (ENTRY_DIVIDER if exported, else x 97..160 of the divided road)
  const div = (LAYOUT as unknown as { ENTRY_DIVIDER?: { x0: number; x1: number } }).ENTRY_DIVIDER;
  const road = ROADS.find((r) => r.median);
  const medianPts = road ? samplePolyline(road.pts, 1, 0, 0.5).map((s) => s.p).filter(([x]) => (div ? x >= div.x0 && x <= div.x1 : x >= 97 && x <= 160)) : [];
  return { world: { group, collision: col, updatables: [] }, medianPts };
}

// ---- nav connectivity: flow field from the player spawn over the 1 m grid (agent r 0.38), before vs after props
interface NavSnap { grid: NavGrid; field: Uint32Array }
function navField(col: StaticCollision): NavSnap {
  const b = WORLD_BOUNDS;
  const grid = new NavGrid(b.minX, b.minZ, b.maxX, b.maxZ);
  grid.build(col, GATES);
  grid.gateClosed.fill(0); // gates open: everything outside must connect through them
  const field = new Uint32Array(grid.w * grid.h);
  computeFlowField(grid.w, grid.h, grid.grid, grid.gateIdx, grid.gateClosed, new Float32Array([PLAYER_SPAWN[0] - b.minX, PLAYER_SPAWN[1] - b.minZ]), field, 1e9);
  return { grid, field };
}

function navDiff(a: NavSnap, b: NavSnap): void {
  const g = b.grid;
  const minX = WORLD_BOUNDS.minX, minZ = WORLD_BOUNDS.minZ;
  let lost = 0, newlyBlocked = 0, detourSum = 0, detourN = 0, worst = 0;
  const lostCells: V2[] = [];
  for (let i = 0; i < g.w * g.h; i++) {
    if (b.grid.grid[i] === 1 && a.grid.grid[i] !== 1) newlyBlocked++;
    if (b.grid.grid[i] === 1) continue;
    if (a.field[i] !== INF && b.field[i] === INF) { lost++; if (lostCells.length < 40) lostCells.push([minX + (i % g.w) + 0.5, minZ + Math.floor(i / g.w) + 0.5]); }
    if (a.field[i] !== INF && b.field[i] !== INF) { const d = b.field[i] - a.field[i]; detourSum += d; detourN++; if (d > worst) worst = d; }
  }
  const pts: Record<string, V2> = { playerSpawn: PLAYER_SPAWN, entryRoad: [130, -124], gateOutside: [192, -132], foodCourt: [127, -16], quad: [37, -55], mrdLoopNorth: [60, -190], bBlockRoad: [-61, -140], westGateOutside: [-100, -102] };
  SPAWN_ZONES.forEach((z) => z.pts.forEach((p, i) => (pts[`spawn_${z.gate}_${i}`] = p)));
  NPC_SPAWNS.forEach((p, i) => (pts[`npc_${i}`] = p));
  for (const s of STATIONS) pts[`st_${s.id}`] = s.pos;
  const cost = (s: NavSnap, p: V2) => { const i = Math.floor(p[0] - minX), j = Math.floor(p[1] - minZ); const c = s.field[j * g.w + i]; return c === INF ? (s.grid.grid[j * g.w + i] === 1 ? 'BLOCKED' : 'UNREACH') : Math.round(c / 10); };
  const table: Record<string, string> = {};
  const fails: string[] = [];
  for (const [k, p] of Object.entries(pts)) {
    const ca = cost(a, p), cb = cost(b, p);
    table[k] = `${ca} → ${cb}`;
    if (typeof ca === 'number' && typeof cb !== 'number') fails.push(k);
  }
  console.log(`[navdiff] newly blocked cells ${newlyBlocked}, free cells cut off by props ${lost}, mean detour ${(detourSum / Math.max(1, detourN) / 10).toFixed(2)} m, worst detour ${(worst / 10).toFixed(1)} m; key points lost: ${fails.length ? fails.join(', ') : 'none'}`);
  console.log('[navdiff] costs (m) before → after ' + JSON.stringify(table));
  if (lostCells.length) console.log('[navdiff] sample cut-off cells', JSON.stringify(lostCells));
  (window as unknown as Record<string, unknown>).navSnaps = { before: a, after: b };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:0;left:0;z-index:9;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`);
});
