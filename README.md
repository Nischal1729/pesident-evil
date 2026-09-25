# Pesident Evil

A third-person zombie-survival shooter set on the **PES University Ring Road campus** (100 Feet Ring Road,
BSK III Stage, Bengaluru). You and three AI squad-mates (Rahul, Ananya and Manjunath the security guard) hold
the campus while hordes pour in from the Outer Ring Road through the main gate. Built with three.js for the browser.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://127.0.0.1:5173 and click **Play**. For a production build:

```bash
npm run build
```

## Controls

| Key | Action |
| --- | --- |
| W A S D / mouse | Move / look |
| Left click | Shoot (or swing the cricket bat) |
| Right click | Aim down sights |
| Shift / Space | Sprint / jump |
| R | Reload |
| E (hold) | Interact: buy at stations, revive squad-mates, repair the gate |
| 1–4 / wheel | Switch weapon |
| V or Q | Quick bat swing |
| F | Squad: hold position / follow me |
| C | Swap shoulder |
| T | Camera: near / far / high |
| N | Start the next wave now |
| Esc / P | Pause |

## Gameplay

- Waves spawn on the Outer Ring Road and bash the steel main gate. Bullets pass through the gate bars, so shoot them
  while they bash. Hold **E** at the gate between waves to repair or rebuild it.
- Later waves bring runners (wave 3+), crawlers, brutes (wave 5+), and a second front at the **west gate** on PES
  University Road (wave 4+).
- Points come from hits, kills, headshots and bat kills. Spend them at stations: ammo crates, first-aid kits, the
  security locker (shotgun), the canteen stash (SMG) and the NCC armoury (INSAS rifle).
- Downed survivors bleed out unless someone revives them. Your squad will come and revive you.
- The day runs from late afternoon to night as the waves go on: a physically based sky with drifting cumulus (and their
  shadows), a pink twilight, then stars, the moon and Bengaluru's orange skyglow. Street lamps and window lights come on.
- The campus is multi-level: walk up the front ramp to GJB's first floor and the Quad, climb the amphitheatre tiers,
  take the stair onto the two-wheeler parking deck, or duck into the GJB lobby and cafeteria. Zombies follow you up,
  and falls over 4 m hurt. Add `?flat` to the URL for the old flat movement.

## Architecture

See `docs/ARCHITECTURE.md` for the full contracts. In short:

- `src/sim/` is the authoritative simulation. It is fixed-timestep (60 Hz), driven only by `PlayerInput`
  snapshots, and emits plain-data events. That keeps co-op possible later: run the `World` on a host and feed it
  remote inputs.
  - Horde pathfinding uses Dial's-algorithm flow fields on a layered 1 m navigation graph (one node per walkable
    surface: terrain, podiums, decks, ramps, stairs), computed in a Web Worker (`LayeredNav.ts`, `navWorker.ts`).
  - Collision is a stacked 2.5D prism/ramp/cylinder grid (walkable tops, ceilings, sloped ramps), also used for
    bullets and line of sight.
- `src/world/` builds the procedural campus from **OpenStreetMap** footprints (`tools/osm/extract.py`) plus
  hand-authored campus data (`layout.ts`) and the 2026 tour-video reference (`reference/CAMPUS_NOTES.md`).
  Geometry is merged and chunked for culling. Facades come from a procedural window/band shader. Trees are procedural
  species models (rain tree, gulmohar, copperpod, ficus, Polyalthia, Terminalia, frangipani, areca palms, saplings) with
  two mesh LODs and runtime-baked impostors in 3 batched draw calls (`src/world/vegetation/`).
- `src/world/Sky.ts` is a physically based atmosphere (transmittance / multiple-scattering / sky-view LUTs) with a
  half-resolution raymarched cumulus layer, cirrus, stars, a phased moon and city skyglow; it also drives cloud shadows.
- `src/render/` holds the post chain (N8AO, bloom, ACES, SMAA), the third-person camera rig, characters (GLB or
  procedural fallback, walk/run speed-matched to their measured foot speed) and FX.
- `src/audio/` is fully procedural WebAudio: gunshots, zombie voices, Bengaluru ambience, an adaptive score, and NPC
  barks via speechSynthesis.
- `src/ui/` holds the HUD, minimap and menus.

Quality presets (low → ultra) scale resolution, shadows, AO, view distance, zombie cap and animation LOD.

## Asset pipeline

- `tools/blender/weapons.py` is a headless Blender generator that writes `public/models/weapons/*`.
- `tools/props/build.py` (Blender 5.2, `blender -b --factory-startup -P tools/props/build.py -- all [--preview]`) builds
  the realistic props in `public/models/props/`: vehicles, street furniture and pickups are modelled in code, textured
  with projected elevation drawings (ImageMagick; shaped Kannada text via `tools/props/render_text.swift`) and procedural
  materials, then baked by Cycles into one WebP atlas per prop (albedo + paint mask, AO/roughness/metalness) with
  `_lod` variants for dense props. It needs ImageMagick and cwebp (Homebrew) and the Poly Haven sources below in
  `tools/blender/_downloads/polyhaven/`. The old flat-colour `tools/blender/props.py` is kept for reference only.
- `tools/blender/characters.py` imports the Quaternius CC0 characters and animations from `tools/blender/_downloads/`
  and writes `public/models/characters/*`.
- `tools/osm/extract.py` converts raw OSM data into `src/world/data/osm.json`.
- `tools/trees/download.sh` + `tools/trees/build_atlas.py` build the vegetation atlases in `public/textures/foliage/`
  (leaf/grass cards, bark columns, lawn) from CC0 Poly Haven / ambientCG sources.

## Credits and licences

- Map data © OpenStreetMap contributors, licensed under ODbL.
- PBR textures from Poly Haven (CC0, https://polyhaven.com): asphalt_02, asphalt_04, aerial_asphalt_01,
  patterned_concrete_pavers, leafy_grass, red_dirt_mud_01, stone_wall_04, painted_plaster_wall, white_stucco,
  concrete_floor_02, concrete_wall_008, granite_tile_03, fine_grained_wood, bark_brown_02, brick_wall_02 (1K JPG).
- Vegetation textures (`public/textures/foliage/`, composited by `tools/trees/build_atlas.py`), all CC0:
  Poly Haven (https://polyhaven.com) leaf / blade textures from the jacaranda_tree, tree_small_02, island_tree_01,
  pachira_aquatica_01, grass_bermuda_01, grass_medium_02, shrub_04 and fern_02 models, and the chinese_hackberry_bark,
  palm_tree_bark and japanese_sycamore bark sets; ambientCG (https://ambientcg.com) Grass005 lawn.
- The tree generator's branching model is inspired by EZ-Tree by Dan Greenheck (MIT, https://github.com/dgreenheck/ez-tree);
  no EZ-Tree code or textures are shipped.
- Characters and animations: Quaternius, Universal Base Characters and Universal Animation Library 1 & 2 (CC0).
- Props from Poly Haven models (CC0, https://polyhaven.com), recoloured / decimated / re-baked by `tools/props`:
  Plastic Monobloc Chair 01 by Kuutti Siitonen (`plastic_chair.glb`, the chairs of `cafe_table_set.glb`) and
  Old Military Crate by Jack Mava (`ammo_crate.glb`); the sandbag hessian is Poly Haven's hessian_230 texture
  (colormass / Rico Cilliers, CC0). The granite bench and the stone of the globe plinth are procedural.
- Everything else (weapons, the other props, audio, code) was made for this project.
- The campus is a best-effort, non-official recreation made for fun. PES University names and signage belong to
  their owners.
