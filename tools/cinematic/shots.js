// Shot list for the Pesident Evil showcase. keys: [u, camX, camY, camZ, lookX, lookY, lookZ].
const RED = '#e5484d', INK = '#f4efe6', GOLD = '#f2b233';

// Night set-piece at the main gate: the horde piles against the leaves while the squad fires through the bars.
function hordeSetup(C, g, w) {
  if (C.hordeReady) return;
  C.hordeReady = true;
  w.zombies.length = 0;
  w.wave = 6; w.state = 'active'; w.toSpawn = 0; w.spawnCd = 1e9;
  const gate = w.gates.find((x) => x.id === 'main');
  gate.hp = gate.maxHp * 0.9;
  const npcs = w.survivors.filter((s) => s.kind === 'npc');
  const spots = [[164.0, -124.6], [163.6, -127.6], [164.6, -137.6]];
  npcs.forEach((n, i) => { n.pos.set(spots[i][0], 0, spots[i][1]); n.prev.copy(n.pos); n.yaw = -Math.PI / 2; n.health = n.maxHealth; const b = w.brains.get(n.id); b.mode = 'hold'; b.holdPos.copy(n.pos); });
  const p = w.player; p.pos.set(150, 0, -127); p.prev.copy(p.pos);
  const types = ['walker', 'walker', 'walker', 'runner', 'walker', 'walker', 'brute', 'walker', 'runner', 'walker', 'walker', 'walker', 'crawler', 'walker', 'walker', 'runner', 'walker', 'walker', 'walker', 'walker', 'walker', 'walker', 'runner', 'walker', 'walker', 'walker', 'walker', 'walker'];
  for (let i = 0; i < types.length; i++) {
    w.spawnZombie();
    const z = w.zombies[w.zombies.length - 1];
    if (!z) continue;
    z.type = types[i];
    z.scale = z.type === 'brute' ? 1.3 : 0.92 + ((i * 37) % 17) / 100;
    z.radius = z.type === 'brute' ? 0.55 : 0.36;
    const row = Math.floor(i / 7), col = i % 7;
    z.pos.set(178.2 + row * 2.4 + (col % 2) * 0.8, 0, -140 + col * 2.6 + row * 0.5);
    z.prev.copy(z.pos);
    z.health = z.maxHealth = z.type === 'brute' ? 900 : 260;
    if (z.type === 'runner') z.speed = 4.5;
    if (z.type === 'brute') { z.scale = 1.3; z.radius = 0.55; z.speed = 1.5; }
  }
}
function keepSquadAlive(w) { for (const s of w.survivors) { if (s.kind === 'npc') { s.health = s.maxHealth; s.downed = false; } } }

export const SHOTS = [
  { name: 's1_arrival', dur: 7, tod: 0.02, shadow: 220, fov: 50,
    keys: [[0, 262, 62, -214, 176, 4, -131], [0.5, 232, 36, -176, 170, 5, -130], [1, 204, 16, -146, 150, 5, -128]] },
  { name: 's2_gate', dur: 7, tod: 0.03, shadow: 120, fov: 55,
    keys: [[0, 196, 5.5, -132, 150, 5, -129], [0.4, 176, 5.2, -131, 120, 6, -126], [1, 128, 6.5, -126, 70, 10, -128]] },
  { name: 's3_ramp', dur: 7, tod: 0.04, shadow: 110, fov: 55,
    keys: [[0, 118, 2.0, -134.1, 80, 8, -140], [0.5, 104, 4.8, -134.1, 72, 13, -146], [1, 92, 9.5, -135, 70, 17, -150]] },
  { name: 's4_quad_reveal', dur: 7, tod: 0.05, shadow: 200, fov: 55,
    keys: [[0, 124, 32, -64, 60, 14, -60], [0.5, 96, 46, -60, 42, 8, -57], [1, 68, 56, -56, 37, 6, -55]] },
  { name: 's5_colonnade', dur: 6, tod: 0.06, shadow: 110, fov: 58,
    keys: [[0, 26.5, 7.7, -92, 38, 7.8, -78], [0.5, 26.5, 7.7, -64, 38, 7.8, -50], [1, 26.5, 7.7, -36, 38, 7.8, -22]] },
  { name: 's6_parking', dur: 6, tod: 0.07, shadow: 110, fov: 55,
    keys: [[0, 108, 4.5, -104, 128, 3.5, -92], [0.5, 108, 5, -76, 128, 3.5, -66], [1, 108, 5.5, -48, 128, 3.5, -40]] },
  { name: 's7_mrd', dur: 6, tod: 0.08, shadow: 140, fov: 52,
    keys: [[0, 106, 12, -162, 70, 6, -151], [0.5, 96, 12.5, -156, 68, 7, -151], [1, 88, 14, -151, 66, 9, -151]] },
  { name: 's8_timelapse', dur: 7, tod: [0.05, 0.97], shadow: 260, fov: 50, linear: true,
    keys: [[0, 158, 34, -92, 20, 22, -118], [1, 150, 36, -98, 20, 22, -118]],
    perFrame: (C, g) => { g.sky.uniforms.uTime.value += 1.4; } },
  { name: 's9a_horde', dur: 6, tod: 0.86, shadow: 90, fov: 50, squad: true, linear: true,
    keys: [[0, 197, 2.3, -125.5, 172, 1.6, -131.5], [1, 192.5, 2.0, -127.5, 170, 1.5, -131.5]],
    setup: hordeSetup,
    perFrame: (C, g, w) => keepSquadAlive(w) },
  { name: 's9b_breach', dur: 6, tod: 0.86, shadow: 90, fov: 55, squad: true, linear: true,
    keys: [[0, 168.5, 2.4, -118.5, 178, 1.2, -133], [0.55, 167.5, 2.8, -119.5, 170, 1.2, -131], [1, 166, 3.4, -120, 161, 1.2, -129]],
    perFrame: (C, g, w, u, f) => {
      keepSquadAlive(w);
      if (f === 8) { const gate = w.gates.find((x) => x.id === 'main'); const V3 = g.engine.camera.position.constructor; w.damageGate(gate, 1e6, new V3(176, 0, -131)); }
    } },
  { name: 's10_outro', dur: 9, tod: 0.92, shadow: 260, fov: 50,
    keys: [[0, 142, 5, -124, 100, 8, -122], [0.45, 150, 40, -110, 70, 6, -100], [1, 175, 95, -60, 50, 0, -95]],
    perFrame: (C, g, w) => keepSquadAlive(w) },
];

export function titles(C, starts) {
  const T = (i) => starts[i];
  C.fade = [
    { t0: 0, t1: 1.0, from: 1, to: 0 },
    { t0: T(10) + 8.0, t1: T(10) + 9.0, from: 0, to: 1 },
  ];
  C.titles = [
    { t0: 1.2, t1: 6.2, lines: [
      { text: 'PES UNIVERSITY', font: '112px "Bebas Neue"', y: 500, spacing: '6px' },
      { text: 'RING ROAD CAMPUS  ·  BENGALURU', font: '600 26px Inter', y: 575, spacing: '8px', color: '#e8e2d6' },
    ] },
    { t0: T(7) + 0.6, t1: T(7) + 6.4, lines: [
      { text: 'THE EVENING BELL NEVER RANG', font: '84px "Bebas Neue"', y: 540, spacing: '5px' },
    ] },
    { t0: T(9) + 1.2, t1: T(9) + 5.4, fin: 0.25, lines: [
      { text: 'HOLD THE CAMPUS', font: '96px "Bebas Neue"', y: 880, spacing: '6px' },
    ] },
    { t0: T(10) + 3.4, t1: T(10) + 9.0, fout: 1.0, lines: [
      { parts: [{ text: 'PES', color: RED }, { text: 'IDENT EVIL', color: INK }], font: '200px "Bebas Neue"', y: 470, spacing: '6px' },
      { text: 'A zombie-survival shooter on the PES University RR campus', font: '600 30px Inter', y: 610, color: '#e8e2d6' },
      { text: 'PLAY FREE IN YOUR BROWSER', font: '44px "Bebas Neue"', y: 690, spacing: '4px', color: INK },
      { text: 'nischal1729.github.io/pesident-evil', font: '600 30px Inter', y: 745, color: GOLD },
    ] },
  ];
}
