# Pesident Evil — architecture & asset contracts

Third-person (over-the-shoulder) zombie-survival shooter set on PES University, Ring Road campus (100 Feet Ring Rd, BSK III Stage, Bengaluru).
Single-player first, with NPC allies; designed so co-op can be added later.

Stack: Vite + TypeScript + three.js (r186). Blender 5.2 (headless Python) generates character,
weapon and prop GLBs. Everything else (campus buildings, ground, trees) is procedural in three.js.

## Folder layout

```
index.html
src/
  main.ts            entry
  core/              engine loop, input, events, settings, asset loader
  world/             campus layout data + procedural builders (buildings, ground, trees, props placement)
  sim/               gameplay simulation: entities, player, zombies, npcs, weapons, waves, flow field, collision
  render/            post-processing, character views, fx (muzzle flash, blood, decals, tracers)
  audio/             AudioManager (procedural WebAudio SFX + ambience)
  ui/                HUD, menus (HTML/CSS overlay)
  net/               (future) co-op transport; sim is input-driven so a host can run it
public/
  models/characters/ GLBs from tools/blender/characters.py
  models/weapons/    GLBs from tools/blender/weapons.py
  models/props/      GLBs from tools/blender/props.py
  textures/          CC0 PBR sets from Poly Haven (1k jpg: diff.jpg, nor.jpg (OpenGL), arm.jpg (AO/Rough/Metal))
tools/blender/       Blender Python generators (run headless), each writes GLBs + preview PNGs
reference/           tour-video frames, CAMPUS_NOTES.md (layout + look reference)
```

## World conventions

* Units: metres. Y up. three.js right-handed: **+X = east, −Z = north, +Z = south**.
* Origin: centroid of the OpenStreetMap outline of the Golden Jubilee Block (lat 12.933977, lon 77.534549).
  Real footprints come from OSM (`tools/osm/extract.py` → `src/world/data/osm.json`, © OpenStreetMap contributors, ODbL);
  campus buildings are hand-authored in `src/world/layout.ts` from those outlines.
* Ground is flat at y = 0 (campus is flat). Buildings are solid exteriors for v1.
* Outer Ring Road runs diagonally (WNW→ESE) along the north-east edge; the main gate opens onto its service road.
  Zombie hordes spawn out on the ring road and come in through the main gate (later waves: other breaches).

## Simulation / co-op readiness

* Fixed-timestep simulation (60 Hz) in `sim/`, rendering interpolates. Sim never reads DOM input directly.
* Each player is driven by a `PlayerInput` struct (move x/z, yaw, pitch, fire, aim, reload, interact, jump,
  sprint, crouch, weaponSlot). Local input builds it; a future net layer can send it to a host.
* Entities have numeric ids. Gameplay emits events (`shot`, `hit`, `death`, `waveStart`, ...) on an event bus;
  audio/fx/UI subscribe. Events are plain data so they can be networked later.

## Asset contracts (Blender → three.js)

All GLBs: glTF binary, Y-up (Blender exporter default `export_yup=True`), metres, apply transforms/modifiers,
no embedded cameras/lights. Keep them small: prefer flat colours / vertex colours over textures.
Materials: Principled BSDF with base colour, roughness, metallic only (maps allowed but optional and ≤ 512 px).

### Characters — `public/models/characters/`

* `male.glb`, `female.glb`: one armature each, **identical bone names and rest proportions close enough that
  animation clips are interchangeable** (three.js binds clips by bone name).
* Mesh: one skinned mesh per file, ≤ 5k triangles, height ≈ 1.75 m (male) / 1.62 m (female), feet at y = 0,
  facing **+Z** in glTF (i.e. Blender −Y), T-pose or A-pose rest.
* Body split into **material slots named exactly**: `skin`, `hair`, `shirt`, `pants`, `shoes`, plus optional
  `accessory` (belt, cap, glasses, ID-card lanyard) and `eyes`. three.js merges them and recolours per instance
  (students, security guard, zombies all reuse these two bodies).
* Bones (Mixamo-like names, no prefix): `Hips, Spine, Spine1, Spine2, Neck, Head, LeftShoulder, LeftArm,
  LeftForeArm, LeftHand, RightShoulder, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, LeftFoot,
  LeftToeBase, RightUpLeg, RightLeg, RightFoot, RightToeBase`. Also an empty/bone `RightHandWeapon` socket
  (child of RightHand) where a rifle/pistol grip attaches (weapon forward along the hand's aim direction).
* Animation clips (names exact, in-place — no root motion, loops seamless where marked ⟳):
  `Idle⟳, Walk⟳, Run⟳, RifleIdle⟳, RifleWalk⟳, RifleRun⟳, RifleFire (short, 0.15 s recoil), PistolIdle⟳,
  HitReact, Death, ZombieIdle⟳, ZombieWalk⟳ (shamble, arms forward), ZombieRun⟳ (sprinter),
  ZombieAttack (swipe/lunge ~0.8 s), ZombieDeath, ZombieDeathForward, ZombieCrawl⟳, Wave (friendly NPC gesture)`.
  Third-person player extras: `RifleWalkBack⟳, RifleStrafeLeft⟳, RifleStrafeRight⟳, RifleReload (~2.0 s),
  PistolWalk⟳, PistolFire, PistolReload (~1.5 s), BatIdle⟳, BatSwing (~0.7 s, big horizontal cricket-bat swing),
  Jump (takeoff→air→land, ~0.9 s), Revive (kneeling, hands forward, loop⟳), Downed⟳ (sitting/lying, one arm up)`.
  In three.js the game splits clips by bone: legs/hips from locomotion clips, spine/arms/head from weapon clips,
  and adds procedural spine pitch for aiming — so weapon clips should keep the upper body stable and legs neutral.
  Walk ≈ 1.4 m/s stride, Run ≈ 4.5 m/s, ZombieWalk ≈ 0.9 m/s, ZombieRun ≈ 4.8 m/s — note actual speeds in the report.

### Weapons — `public/models/weapons/`

`pistol.glb, shotgun.glb, rifle.glb, cricket_bat.glb` (+ optional `smg.glb`).
* Origin at the grip (where the right hand holds), barrel pointing **−Z** (three.js forward), Y up, real scale.
* Named child nodes: `muzzle` (empty at barrel tip), `magazine` (separate mesh, for reload anim),
  `slide` or `bolt` (separate mesh that moves back on fire), `leftHandGrip` (empty where the support hand goes).
* The game is THIRD-PERSON: weapons are attached to the character's `RightHandWeapon` socket and must read
  well at 3–6 m camera distance (clear silhouette, a bit chunkier than realistic). No first-person viewmodels.
* ≤ 3k triangles each.

### Props — `public/models/props/`

`pes_globe.glb` (the gold armillary globe sculpture with "PES" at the main entrance, on a round plinth),
`auto_rickshaw.glb` (Bengaluru yellow-green), `car_hatchback.glb`, `bmtc_bus.glb` (optional), `street_lamp.glb`,
`bench.glb`, `cafe_table_set.glb` (food-court table + red plastic chairs), `folding_barricade.glb` (yellow/red),
`metro_barrier.glb` (construction barrier panel with green mesh), `trash_bin.glb` (blue), `water_cooler.glb`,
`ammo_crate.glb`, `medkit.glb`, `sandbags.glb`, `bike.glb` (parked motorcycle/scooter).
Origin at the base centre, facing +Z, real scale, ≤ 6k tris (bus ≤ 10k).

## Audio contract — `src/audio/AudioManager.ts`

```ts
audio.init(): Promise<void>              // call from a user gesture
audio.setListener(pos: Vector3, forward: Vector3, up: Vector3)
audio.play(name: SfxName, opts?: { position?: Vector3; volume?: number; pitch?: number }): void
audio.setAmbience(kind: 'day' | 'dusk' | 'night', intensity: number)
audio.setMusicIntensity(x: number)      // 0 calm … 1 full horde
audio.say(line: string, opts?: { voice?: 'male'|'female'; position?: Vector3 })  // NPC barks
```
