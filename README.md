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
- The day runs from late afternoon to night as the waves go on. Street lamps and window lights come on.

## Architecture

See `docs/ARCHITECTURE.md` for the full contracts. In short:

- `src/sim/` is the authoritative simulation. It is fixed-timestep (60 Hz), driven only by `PlayerInput`
  snapshots, and emits plain-data events. That keeps co-op possible later: run the `World` on a host and feed it
  remote inputs.
  - Horde pathfinding uses Dial's-algorithm flow fields on a 1 m grid, computed in a Web Worker (`navWorker.ts`).
  - Collision is a 2.5D prism/cylinder grid, also used for bullets and line of sight.
- `src/world/` builds the procedural campus from **OpenStreetMap** footprints (`tools/osm/extract.py`) plus
  hand-authored campus data (`layout.ts`) and the 2026 tour-video reference (`reference/CAMPUS_NOTES.md`).
  Geometry is merged and chunked for culling. Facades come from a procedural window/band shader. Trees are instanced
  alpha-card trees.
- `src/render/` holds the post chain (N8AO, bloom, ACES, SMAA), the third-person camera rig, characters (GLB or
  procedural fallback) and FX.
- `src/audio/` is fully procedural WebAudio: gunshots, zombie voices, Bengaluru ambience, an adaptive score, and NPC
  barks via speechSynthesis.
- `src/ui/` holds the HUD, minimap and menus.

Quality presets (low → ultra) scale resolution, shadows, AO, view distance, zombie cap and animation LOD.

## Asset pipeline

- `tools/blender/weapons.py` and `props.py` are headless Blender generators that write `public/models/*`.
- `tools/blender/characters.py` imports the Quaternius CC0 characters and animations from `tools/blender/_downloads/`
  and writes `public/models/characters/*`.
- `tools/osm/extract.py` converts raw OSM data into `src/world/data/osm.json`.

## Credits and licences

- Map data © OpenStreetMap contributors, licensed under ODbL.
- PBR textures from Poly Haven (CC0).
- Characters and animations: Quaternius, Universal Base Characters and Universal Animation Library 1 & 2 (CC0).
- Everything else (weapons, props, audio, code) was made for this project.
- The campus is a best-effort, non-official recreation made for fun. PES University names and signage belong to
  their owners.
