// Pesident Evil — cinematic capture harness (dev only, injected into the preview build).
export async function setup() {
  for (let i = 0; i < 120 && !(window.game && window.game.menu && window.game.menu.current === 'main'); i++) await new Promise((r) => setTimeout(r, 500));
  const g = window.game;
  g.engine.resize();
  await g.startGame();
  await document.fonts.load('120px "Bebas Neue"');
  await document.fonts.load('600 40px Inter');
  const w = g.world;
  document.getElementById('ui').style.display = 'none';
  w.updateTimeOfDay = () => {};
  w.zombies.length = 0;
  const C = (window.C = { time: 0, audio: [], shadowFocus: null, recordAudio: false, cam: { p: [0, 10, 0], l: [0, 0, -1], fov: 55 } });
  const V3 = g.engine.camera.position.constructor;
  // deterministic clock; we drive the loop ourselves
  const realNow = performance.now.bind(performance);
  C.clock = realNow();
  performance.now = () => C.clock;
  window.requestAnimationFrame = () => 0;
  // capture quality (above 'high')
  try { g.post.ao.configuration.halfRes = false; g.post.ao.configuration.aoSamples = 16; } catch { /* */ }
  g.sky.lowScale = 0.75;
  for (const m of [g.sky.mesh.material, g.sky.lowMat]) { m.defines.CLOUD_STEPS = 12; m.needsUpdate = true; }
  // camera + shadow focus overrides
  g.rig.update = () => {
    const c = g.engine.camera;
    c.position.set(...C.cam.p);
    c.lookAt(...C.cam.l);
    if (Math.abs(c.fov - C.cam.fov) > 0.01) { c.fov = C.cam.fov; c.updateProjectionMatrix(); }
  };
  const of = g.sky.follow.bind(g.sky);
  g.sky.follow = (focus) => of(C.shadowFocus || focus);
  C.showSquad = (on) => { for (const [id, v] of g.chars.views) { const s = w.survivors.find((x) => x.id === id); if (s) v.root.visible = on && s.kind === 'npc'; } };
  // compositor
  C.cv = document.createElement('canvas');
  C.cv.width = 1920; C.cv.height = 1080;
  C.ctx = C.cv.getContext('2d');
  C.titles = [];
  C.fade = [];
  const lerp = (a, b, t) => a + (b - a) * t;
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
  C.evalKeys = (keys, u) => {
    let i = 0;
    while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
    const k1 = keys[i], k2 = keys[i + 1], k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(keys.length - 1, i + 2)];
    const t = Math.min(1, Math.max(0, (u - k1[0]) / ((k2[0] - k1[0]) || 1)));
    const out = [];
    for (let j = 1; j <= 6; j++) out.push(cr(k0[j], k1[j], k2[j], k3[j], t));
    return out;
  };
  C.ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  C.drawOverlay = (t) => {
    const x = C.ctx;
    for (const f of C.fade) if (t >= f.t0 && t <= f.t1) { x.fillStyle = `rgba(0,0,0,${lerp(f.from, f.to, (t - f.t0) / (f.t1 - f.t0))})`; x.fillRect(0, 0, 1920, 1080); }
    for (const ti of C.titles) {
      if (t < ti.t0 || t > ti.t1) continue;
      const a = Math.min(1, (t - ti.t0) / (ti.fin ?? 0.8), (ti.t1 - t) / (ti.fout ?? 0.8));
      x.save();
      x.globalAlpha = Math.max(0, a);
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.shadowColor = 'rgba(0,0,0,0.6)';
      x.shadowBlur = 28;
      for (const L of ti.lines) {
        x.font = L.font;
        if ('letterSpacing' in x) x.letterSpacing = L.spacing || '0px';
        if (L.parts) {
          // multi-colour line (e.g. red PES + white IDENT EVIL), centred as a whole
          const widths = L.parts.map((pt) => x.measureText(pt.text).width);
          let px = 960 - widths.reduce((a, b) => a + b, 0) / 2;
          x.textAlign = 'left';
          L.parts.forEach((pt, i) => { x.fillStyle = pt.color; x.fillText(pt.text, px, L.y); px += widths[i]; });
          x.textAlign = 'center';
        } else {
          x.fillStyle = L.color || '#f4efe6';
          x.fillText(L.text, 960 + (L.dx || 0), L.y);
        }
      }
      x.restore();
    }
  };
  C.renderFrame = (dtSec = 1 / 30) => { C.clock += dtSec * 1000; g.loop(); C.time += dtSec; };
  C.grab = async (port, name) => {
    C.ctx.drawImage(g.engine.renderer.domElement, 0, 0, 1920, 1080);
    C.drawOverlay(C.time);
    const blob = await new Promise((res) => C.cv.toBlob(res, 'image/jpeg', 0.93));
    await fetch(`http://127.0.0.1:${port}/${name}`, { method: 'POST', body: blob });
  };
  const ev = [
    ['shot', (e) => ({ n: 'shot:' + e.weapon, x: e.origin.x, y: e.origin.y, z: e.origin.z })],
    ['zombieGroan', (e) => ({ n: 'groan:' + e.kind, x: e.position.x, y: e.position.y, z: e.position.z })],
    ['gateHit', (e) => ({ n: 'gateHit', x: e.position.x, y: 0, z: e.position.z })],
    ['gateBroken', (e) => ({ n: 'gateBroken', x: e.position.x, y: 0, z: e.position.z })],
    ['death', (e) => ({ n: 'death:' + e.kind, x: e.position.x, y: e.position.y, z: e.position.z })],
    ['hit', (e) => ({ n: 'hit', x: e.point.x, y: e.point.y, z: e.point.z })],
  ];
  for (const [name, fn] of ev) w.events.on(name, (e) => { if (C.recordAudio) C.audio.push({ t: +C.time.toFixed(3), ...fn(e), cx: C.cam.p[0], cy: C.cam.p[1], cz: C.cam.p[2] }); });
  // shot state
  C.setShotState = (sh, u) => {
    const k = C.evalKeys(sh.keys, sh.linear ? u : C.ease(u));
    C.cam.p = [k[0], k[1], k[2]];
    C.cam.l = [k[3], k[4], k[5]];
    C.cam.fov = sh.fov;
    C.shadowFocus = new V3(k[3] * 0.6 + k[0] * 0.4, 0, k[5] * 0.6 + k[2] * 0.4);
    w.timeOfDay = Array.isArray(sh.tod) ? sh.tod[0] + (sh.tod[1] - sh.tod[0]) * u : sh.tod;
  };
  // storyboard stills
  C.board = async (shots, port = 5198) => {
    const names = [];
    for (const sh of shots) {
      g.sky.setShadowDistance(sh.shadow);
      sh.setup?.(C, g, w);
      for (const u of [0, 0.33, 0.66, 1]) {
        C.setShotState(sh, u);
        for (let i = 0; i < 3; i++) C.renderFrame(0);
        C.showSquad(!!sh.squad);
        C.renderFrame(0);
        const n = `${sh.name}_${Math.round(u * 100)}.jpg`;
        await C.grab(port, n);
        names.push(n);
      }
    }
    return names;
  };
  // capture a shot: frames [from, to) of its own timeline, global frame numbering from `base`
  C.capture = async (sh, base, from, to, port = 5197) => {
    const n = Math.round(sh.dur * 30);
    g.sky.setShadowDistance(sh.shadow);
    for (let f = from; f < Math.min(to, n); f++) {
      const u = f / (n - 1);
      C.setShotState(sh, u);
      sh.perFrame?.(C, g, w, u, f);
      C.renderFrame(sh.dt ?? 1 / 30);
      C.showSquad(!!sh.squad);
      await C.grab(port, `f${String(base + f).padStart(5, '0')}.jpg`);
    }
    return Math.min(to, n);
  };
  C.showSquad(false);
  return 'ok';
}

// Drive the whole shot list: renders global frames [from, from + count) and returns the next frame index.
export async function run(SHOTS, titlesFn, from, count, port = 5197) {
  const C = window.C, g = window.game, w = g.world;
  if (!C.plan) {
    let acc = 0;
    C.plan = SHOTS.map((sh) => { const n = Math.round(sh.dur * 30); const p = { sh, base: acc, n }; acc += n; return p; });
    C.totalFrames = acc;
    titlesFn(C, C.plan.map((p) => p.base / 30));
    w.updateDirector = () => {};           // no stray waves; the horde is staged by the s9 shots
    C.time = 0;
  }
  const end = Math.min(C.totalFrames, from + count);
  for (let gf = from; gf < end; gf++) {
    const p = C.plan.find((q) => gf >= q.base && gf < q.base + q.n);
    const f = gf - p.base;
    if (f === 0) { g.sky.setShadowDistance(p.sh.shadow); p.sh.setup?.(C, g, w); }
    C.recordAudio = /^s9|^s10/.test(p.sh.name);
    const u = p.n > 1 ? f / (p.n - 1) : 0;
    C.setShotState(p.sh, u);
    p.sh.perFrame?.(C, g, w, u, f);
    C.time = gf / 30;
    C.clock += 1000 / 30;
    g.loop();
    C.showSquad(!!p.sh.squad);
    await C.grab(port, `f${String(gf).padStart(5, '0')}.jpg`);
  }
  return end;
}
