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
  net/               co-op: PeerJS transport (Net), wire format (protocol, snapshot), session logic (Coop)
public/
  models/characters/ GLBs from tools/blender/characters.py
  models/weapons/    GLBs from tools/blender/weapons.py
  models/props/      GLBs from tools/props/build.py (baked atlases, `_lod` variants)
  textures/          CC0 PBR sets from Poly Haven (1k jpg: diff.jpg, nor.jpg (OpenGL), arm.jpg (AO/Rough/Metal))
tools/blender/       Blender Python generators (run headless), each writes GLBs + preview PNGs
reference/           tour-video frames, CAMPUS_NOTES.md (layout + look reference)
```

## World conventions

* Units: metres. Y up. three.js right-handed: **+X = east, −Z = north, +Z = south**.
* Origin: centroid of the OpenStreetMap outline of the Golden Jubilee Block (lat 12.933977, lon 77.534549).
  Real footprints come from OSM (`tools/osm/extract.py` → `src/world/data/osm.json`, © OpenStreetMap contributors, ODbL);
  campus buildings are hand-authored in `src/world/layout.ts` from those outlines.
* The campus falls from the main gate towards GJB (`src/world/terrain.ts`, layout.ts `TERRAIN`): the entry
  corridor, the gate forecourt, the PES Lawn and the Ring Road near the gate stand 3.2 m up; the entry road slopes
  down to GJB level between x 118 and 92. The world is authored flat and lifted once after it is built (geometry per
  vertex with edge subdivision, instances and collision by position, trees and props through hooks), then the raised
  ground is added as solid 'terrain' prisms with retaining faces and parapets. The sim reads `terrainY` for spawns and
  stations. The campus is also multi-level: podiums, decks, ramps, stairs and tiers are walkable (see "Multi-level
  movement" below). Several buildings have explorable interiors (GJB, MRD, BE block, the 2-wheeler parking's labs).
* Outer Ring Road runs diagonally (WNW→ESE) along the north-east edge; the main gate opens onto its service road.
  Zombie hordes spawn out on the ring road and come in through the main gate (later waves: other breaches).

### World materials and lighting (`src/world/materials.ts`, `kit.ts`)

* Facades: `facadeMaterial(style)` draws windows, bands and joints in the shader from the `aFacade` attribute. Glass is
  a dielectric that reflects the PMREM sky with Fresnel; the room behind it is interior-mapped (ceiling, floor,
  walls, desks, blinds / curtains) and emissive (daylight by day, room lights at night). Punched windows have a
  parallax reveal (`reveal`, metres). Walls get rain streaks, splash-back grime and ground-contact darkening
  (`dirt`). `QualityProfile.materialDetail` (0/1/2) turns off the reveal / rooms / furniture on low / medium.
* Kit detail keys (`WorldKit.material(key)`, `DetailKey`): vertex colour is the albedo for every key; textures are
  normalised per channel and only add grain. `stone`, `plaster`, `paint` (white_stucco), `wood` (fine_grained_wood),
  `polished` / `granite` (granite_tile_03, polished vs honed), `concrete` (concrete_wall_008), `metal`, `glass`
  (tinted reflective glazing), `dark` (untextured). Boxes built with uv scale 0 get a world-space projection in
  `flush()`.
* Street lamps are baked into a 2D light map (`setLampLights` / `addLampLights`, 0.5 m texels) that every lit world
  material samples at night. `injectWorldLighting(shader)` adds it (plus the optional wet look, `worldUniforms.uWet`,
  or `?wet=1` in the URL) inside an `onBeforeCompile` hook. It is the default hook of every MeshStandardMaterial;
  a material with its own hook must call it at the end of that hook.

## Simulation and co-op

* Fixed-timestep simulation (60 Hz) in `sim/`, rendering interpolates. Sim never reads DOM input directly.
* Each player is driven by a `PlayerInput` struct (move x/z, yaw, pitch, fire, aim, reload, interact, jump,
  sprint, weaponSlot, …). Entities have numeric ids. Gameplay emits plain-data events (`shot`, `hit`, `death`,
  `waveStart`, …) on an event bus; audio/fx/UI subscribe.
* `World.role`: `solo` and `host` run everything; a co-op `client` World is a mirror. It builds no nav graph and runs
  no director or damage; it only moves its own player (`predictLocal` → `movePlayer`, zero-lag movement) and predicts
  its own shot FX (`predictShot`).

### Co-op (`src/net/`)

* Transport (`Net.ts`): PeerJS. The host registers the peer id `pesident-evil-v1-<ROOM>`; the public broker only
  introduces browsers. Each link has the reliable PeerJS data connection (raw: JSON control messages, batched events)
  and a pre-negotiated unordered, no-retransmit `RTCDataChannel` (id 100) for binary snapshots and inputs.
* Host (`CoopHost`): holds the room and roster; on start it adds a `Survivor` per member (no AI squad) and sends each
  client `start` (its survivor id + everyone's name/look). Every host tick `fillInputs` turns each client's latest
  input packet into a `PlayerInput` (one-shot actions are wrapping press counters, so a lost packet loses nothing);
  every 3rd tick (20 Hz) `writeSnapshot` goes to all clients with the tick's events (`EventBus.tap`).
* Remote players move on their own machine: the input carries their pose, and `World.applyPose` takes it as given,
  except when it predates the host's last teleport of that player (`Survivor.teleportSeq`: spawn, respawn), so a
  stale pose can't undo a respawn.
* Client (`CoopClient`): buffers snapshots and writes the host state at (newest − 100 ms) into its mirror World
  (`applySnapshot`: positions interpolated into both `pos` and `prev`; the local player keeps its own pose and
  locomotion), replays events into the mirror's bus, sends its input at 30 Hz, and pushes its player out of the
  zombies it draws. Gate collision follows the host's broken flag (`clientGateChanged`).
* Scaling (`coopDifficulty`): with f = players / 4, wave size × f^0.6, zombie health and gate damage × f^0.4.
  Snapshots are ~2.2 KB for 80 zombies; about 46 KB/s per client with events.
* A hidden host tab keeps simulating through a Worker timer (rAF stops in hidden tabs) and skips drawing.

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

Generated by `tools/props/build.py` (Blender 5.2 headless: `blender -b --factory-startup -P tools/props/build.py -- all
[--preview]`); pipeline in `tools/props/lib.py`. Models: `bike.glb` (Activa-class scooter), `motorbike.glb`
(Splendor-class commuter bike), `car_hatchback.glb` (Swift-class), `auto_rickshaw.glb` (Bengaluru green/yellow Bajaj RE),
`college_bus.glb` (yellow PES University bus), `bmtc_bus.glb` (BMTC city bus), `bench.glb` (granite block),
`cafe_table_set.glb` (table + 4 red monobloc chairs), `plastic_chair.glb`, `folding_barricade.glb`, `metro_barrier.glb`,
`trash_bin.glb`, `water_cooler.glb`, `ammo_crate.glb`, `medkit.glb`, `sandbags.glb`, `pes_globe.glb`, `street_lamp.glb`.
* Origin at the base centre, facing +Z (Blender −Y), real scale. Vehicles ≤ 6k tris, buses ≤ 10k.
* ONE mesh and ONE material per file: a baked atlas (WebP via `EXT_texture_webp`). Base colour RGBA: **alpha = paint
  mask** (1 where a per-instance colour may multiply, e.g. car / scooter paint; 1 everywhere on untinted props, which
  ignore it). ORM texture: R = baked AO (glTF occlusion), G = roughness, B = metalness. Shading detail (AO, grime,
  livery, glass, lamps, number plates) is in the atlas; no normal maps.
* Dense props ship `<name>_lod.glb` (a few hundred tris, own 128–512 px atlas, same origin/facing): `bike`,
  `motorbike`, `car_hatchback`, `auto_rickshaw`, `college_bus`, `bmtc_bus`, `folding_barricade`.
* Runtime (`src/world/Props.ts`): each prop type is one `InstancedProp` with per-instance distance bands (full model
  with shadows → without → `_lod` → culled), re-sorted when the camera moves; one draw call per band. Other modules
  can instance the same models with `createPropInstancer(assets, name, quality)` (e.g. the GJB two-wheeler parking).
  Viewer: `props-viewer.html` (in the campus) or `props-viewer.html?showroom=1` (all models + LODs in a row).

## Audio contract — `src/audio/AudioManager.ts`

```ts
audio.init(): Promise<void>              // call from a user gesture
audio.setListener(pos: Vector3, forward: Vector3, up: Vector3)
audio.play(name: SfxName, opts?: { position?: Vector3; volume?: number; pitch?: number }): void
audio.setAmbience(kind: 'day' | 'dusk' | 'night', intensity: number)
audio.setMusicIntensity(x: number)      // 0 calm … 1 full horde
audio.say(line: string, opts?: { voice?: 'male'|'female'; position?: Vector3 })  // NPC barks
```


## Multi-level movement (default on; `?flat` in the URL falls back to the old flat sim)

* **Collision is the source of truth** (`src/sim/Collision.ts`). A prism is a solid from `base` to `base + height`.
  Its top is walkable ground, its underside a ceiling. Register raised geometry the way it physically is:
  * podiums / raised floors: `addPolygon(poly, topY, surface, tag)`;
  * decks / slabs you can walk under: `addPolygon(poly, thickness, surface, tag, baseY)`;
  * ramps AND stair flights: `addRamp(poly, from, to, y0, y1, surface?, tag?, thickness?)` — a sloped top; draw the
    steps visually;
  * walls: prisms from their floor to the ceiling (`base` argument); props: `addCircle(..., base)`.
* **Walking** (`World.moveBody`): bodies collide with solids that occupy `[y + STEP_UP, y + AGENT_HEIGHT]`
  (`resolveBody`), so anything ≤ 0.45 m (kerbs, tiers, low planters) is stepped onto. Ground follows `groundAt()`
  (seam-tolerant), with gravity off ledges, head bumps under ceilings and fall damage above 4 m for survivors.
* **Climbing** (`ledgeAt`, `World.startClimb` / `stepClimb`): a timed climb onto a top more than STEP_UP and at most
  `CLIMB_MAX` (1.3 m) above the feet, on a solid whose tag passes `climbableTag` (props, planters, stair and tier
  sides, gate leaves, `'boundary'` compound walls). The player climbs on jump (0.45 s; a plain hop peaks at 0.74 m).
  Zombies (0.55-1.4 s by type) and NPCs (0.6 s) climb when their next nav node, or a chase target in sight, is a
  climb up ahead. Zombie reach is also 1.3 m, so no single climb leaves reach. Gate (2.4 m) and wall tops (2.62 /
  2.72 m) are reached by the sandbag `STEP_STACKS` in two climbs plus a step. NPCs stop on the tier below a gate or
  wall top.
* **Boundary lips** (`setLip`, `clampLip`): compound walls, gate leaves and the main-gate median carry an outward
  normal. They are climbable only from the inside, and a survivor on one is held back at its outer face, so nobody
  leaves the campus over the top.
* **Navigation** (`src/sim/LayeredNav.ts`): a 1 m grid where each cell holds one node per walkable surface with
  head-room. Neighbours link across steps ≤ STEP_UP, continuous slopes, or straight climbs ≤ CLIMB_MAX onto a
  climbable top (the `ledgeAt` rule, cost +30, never starting on a gate node). Wall, gate and scooter tops narrower
  than a cell get nodes on their centreline. Flow fields (Dial's algorithm) spread along reversed edges in the nav
  worker. The graph is built once per collision world (~200 ms for the campus with props, ~184k nodes).
* Sight lines, zombie reach, melee, interactions, pickups and NPC aim all use actor heights; separation only pushes
  bodies on the same level. `StationDef.y` gives a station's floor height.
* Doorways need ≥ 1.8 m and corridors ≥ 2.2 m so the 1 m nav grid (agent radius 0.38) routes through them.
* **Enterable interiors** (`InteriorKit` / `PlanFrame` in `src/world/buildings.ts`): the shell above is a BuildingDef
  with `base` = the ceiling, or a walls-only `shell`. The rooms are one distance-culled LOD per building (shared kit
  materials, no lights), and walls and slabs cast shadows so sunlight doesn't leak in. Floors, slabs and walls are
  prisms with a `base`, stairs are `addRamp`. Examples: `mrdInterior.ts`, `admissionHall.ts`, `gjb/interiors.ts`.
