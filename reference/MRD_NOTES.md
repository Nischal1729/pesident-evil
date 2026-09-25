# Prof. MRD Block + Open Air Theatre — reference notes (2026)

Frame: metres, +X east, +Z south, origin = GJBC OSM centroid (same as `CAMPUS_NOTES.md`). Confidence: H / M / L.
Code: `src/world/mrd.ts`, `src/world/oat.ts`, MRD wings in `src/world/layout.ts` (ids `mrd`, `mrd_fan`, `mrd_east`,
`mrd_ne`, `mrd_se`, `MRD_DRUM`).

## Sources

| Video (reference/video/) | Date | What it shows |
|---|---|---|
| `tour.mp4` ("PES University – Campus Tour 2026", uxqjCJBCP_g) | 2026 | MRD east entrance 3:12–4:10, atrium 4:10–5:28, OAT from the GJBC north colonnade 6:24–6:56 |
| `mrdbe_cWKYL-ruQ_E.mp4` ("Full Campus Tour, Ring Road, in 10 mins", Alemari Ganesha) | 2021-09 | "Block A (MRD Block)" 0:57, "The Amphitheatre" 2:24, "Block BE" 3:00, the 13th floor 5:12 |
| `mrdbe_SmHnHHxbpaE.mp4` (Nikhil Malankar campus tour) | 2025-09 | starts in the MRD atrium, exits to a road; mostly GJBC interiors |
| `gjb_tour.mp4` (GJB agent's download, UcDUlC0mBY4) | 2024/25 | 11:56–12:10: the OAT stage, tiers, rainbow rim, terrace and MRD plinth stair |

| `web_5bxHqmfj7bE.mp4` ("PES University Campus Tour 2021 Part 1", PES Blog) | 2021-08 | 1:04–1:28 "A Block": grand steps, "education for the real world" wall, atrium with red chairs, the **"ಸಭಾಂಗಣ / Auditorium" door** in a yellow wall off the atrium |
| Wikimedia Commons "PESIT" photos (`frames/mrd/wikimedia_pesit_ablock_2011.jpg`, `…_auditorium_2013.jpg`) | 2011–13 | A-Block before the refurb; the auditorium hall |

Also used: OSM (`osm_pes.json`: MRD way 199316438 "Prof.MRD Block", alt_name A-Block, 6 levels; "Open Air Theatre"
way 687910157; `highway=steps` way 691141393 = the grand steps; footways round the OAT), the satellite mosaic
(`sat_campus.jpg`; it is offset ≈ (+6, −3) m against OSM, roofs lean), and the existing key frames.

Frames extracted for this pass: `reference/frames/mrd/`
* `mrd21_00xx.jpg` 2021 east entrance (blue-painted, before the refurb), `sheets21/s21_*.jpg` 2021 contact sheets
  (0:50–5:38: MRD, atrium, library, auditorium, amphitheatre, BE block, food point).
* `mrd26_0186…0244.jpg` 2026 east entrance and forecourt, `mrd26_0312/0318.jpg` view from an MRD upper window
  down into the OAT through the scaffolding, `mrd26_0324…0354.jpg` GJBC east side.
* `oat21_0140…0176.jpg` 2021 amphitheatre (empty + during an event), `oat26_0390…0410.jpg` 2026 OAT from the GJBC
  north colonnade, `oat25_gjbtour_716…731.jpg` 2024/25 OAT stage, rim and MRD plinth stair.
* `sheets25/s25_*.jpg` 2025 contact sheets.

## 1. Massing and levels

The OSM outline (27 vertices, x 2…81, z −188…−126) is one building on the map but reads as five parts
(satellite + tours). Heights are estimates (old blocks ≈3.6–3.8 m per floor).

| Part (layout id) | Plan (OSM vertices) | Height | Skin | Conf. |
|---|---|---|---|---|
| NW auditorium hall (`mrd`) | x 2…33, z −188…−154; big faceted/hipped roof on the satellite; the 2021 tour's "MRD Block – The Auditorium" (raked seats, pink/yellow walls, stage) | walls ≈16 m + metal hip roof to ≈21 m | plain plaster, few windows | M (position/roof), L (height) |
| Central wings (`mrd_fan`) | between the hall and the east block; two long bars parallel to the east face, courtyard between (satellite); the south face looks down on the OAT | 6 floors ≈21.6 m | old cream plaster, regular windows, balconies, one projecting stair (OAT frames) | M |
| East entrance block (`mrd_east`) | east face V14 (59.9,−139.3) → V12 (73.5,−161.8), 26.3 m, faces ESE onto the MRD loop road; depth to the V7–V21 line | 6 floors ≈22.8 m | 2026 refurb: frosted/white glass curtain wall, navy top cornice with a diamond-perforated metal parapet | H (face), M (height) |
| NE block (`mrd_ne`) | x 59…81, z −180…−162 | ≈19 m | buff sandstone blocks, navy cantilever slab at ≈3rd floor, scaffolding | M |
| SE wing (`mrd_se`) | x 41…68, z −141…−126, along PES Univ Rd | ≈19 m | buff stone, navy slab on the east end (the "stone tower" left of the steps), scaffolding | M |

Atrium: behind the entrance ("education for the real world" wall → corridor → 4-storey atrium with an octagonal
skylight, cream walls, navy columns and lift cores, yellow wall panels, red plastic chairs on black tables). In the game
the octagonal skylight lantern (`MRD_DRUM`, centre (59.5,−153.5), r 4.2) pokes ≈2 m above the east block roof. (M/L)

**Levels:** the campus rises towards MRD. The east entrance forecourt is ≈+1.8 m above the loop road (12 risers). The
OAT tiers climb ≈3.2 m to a terrace at MRD's ground-floor level on the south/west side. The game world is flat, so the
MRD blocks start at y = 0 and the OAT terrace is a +3.2 m podium against their south and west faces.

## 2. Entrances

* **East entrance (main)** — H. Grand white granite steps (≈12 risers × 0.15 m, 0.38 m treads, ≈24 m wide, OSM
  `steps` line (77.5,−144.7)→(66.7,−150.5) = perpendicular to the face at its midpoint (66.7,−150.55)), a glossy green
  marble forecourt ≈4 m deep at +1.8 m, a glazed ground floor with blue-grey columns (#4F6D8C) every ≈3.2 m, a navy
  name band "DR. M.R. DORESWAMY SILVER JUBILEE COMPLEX" (Kannada either side) and a big sloping navy canopy (≈5.5 m
  deep, thick fascia). Handrails at the ends; a purple-heart planter + big tree at the north end; the south end runs
  into the SE stone tower. Steel handrail/ramp on the south side (2021/2026 frames).
* **OAT side** — M. The terrace behind the OAT rim is at MRD ground-floor level; a stair with a steel handrail climbs
  along a rubble-stone plinth to a covered entrance under an overhang on columns (GJB-tour frames 716–722).
* **West exit** — L. The 2025 tour walks out of the atrium through a side door onto a covered porch and a road.

## 3. Facade and the 2026 refurbishment

* 2021: the entrance block was blue-painted panels + glass with the same navy canopy and name band (so the canopy and
  steps predate the refurb). Old wings: cream/white plaster with balconies and blue glazing strips.
* 2026: **still under refurbishment** — bamboo/steel scaffolding with green safety nets on the SE wing, the NE block
  and the stone towers flanking the entrance; a green tarp hangs at the north end of the entrance glazing; material
  heaps at the base. New skin = buff sandstone blocks (#C8B89E), frosted glass curtain wall (#D8E3E8), navy (#1F2B45)
  canopies/cornices/cantilever slabs, perforated dark-grey roof screen. The OAT-facing wings are still old cream.
* **PES signboard skybridge (GJB agent's `buildPesBridge`)** — evidence from key frames 0152, 0208, 0230, 0306, 0316
  and 1928: the bridge spans between two buff-stone MRD blocks, the SE stone tower (≈(67,−136), navy slab) and the NE
  block (≈(74,−161), navy slab), running roughly along the MRD east face (NNE–SSW) a few metres in front of the frosted
  curtain wall, deck ≈+11–12 m (above the entrance canopy), railing on top, white sign on the EAST face. The ramp from
  the east plaza rises W to a landing by the SE tower. Confidence M. **Built** (follow-up task): `pesSignBridge` in
  `src/world/mrd.ts` spans the recess mouth from (68.0,−135.7) on the SE tower's north face to (80.2,−163.7) on the NE
  tower's south face, 4 m deep: dark soffit at 17 m, navy fascia to 18.8 m, glass balustrade + handrail, a white box
  (18.8–23.2 m) with the `pesBridge` board facing ESE and a thin roof slab. The towers are 20 m, the curtain-wall block
  (style `glass`) 20 m, so the white box is the highest element as in 0208/0230. The old sign box on the GJB ramp
  landing canopy was removed (ramp, landing, stair tower, statue and the 6 m bridge into MRD stay).

## 4. Open Air Theatre (amphitheatre)

OSM `amenity=theatre` polygon: a quarter disc with its corner at the PES Univ Rd / link road junction (≈(4,−120.5)),
radius ≈27–31 m, bounded W by the B/MRD link road (x≈4) and N/E by MRD. (H)

* **Stage** — a flat paved floor in the south-west corner, entered from PES Univ Rd (OSM footway (11.4,−112.3)→
  (10.4,−121.2)) and from the link road. A colourful abstract **mural panel** (≈6 × 2.5 m) stands on a **navy low wall**
  at the far (south-west) side, facing the tiers; speakers either side at events. (H)
* **Tiers** — 8 plain grey concrete steps (≈0.4 m risers, ≈0.9–1 m treads) on concentric arcs round the north and
  east, rising ≈3.2 m. They are NOT painted in stripes (the old notes misread the rim pattern). Thin steel rods stand
  on some tiers for bunting and lights. (H)
* **Rim** — a low white parapet painted with a **rainbow "teardrop arch" pattern** (each arch a different bright
  colour) along the top edge; potted plants on it; beyond it a wide paved **terrace** at MRD ground-floor level. (H)
* **Trees** — mature rain trees shade the tiers and terrace; one grows out of the tiers inside a raised planter box
  with ivy. (H)
* **Walls / east side** — rough-dressed grey granite retaining walls (the same rubble plinth continues along MRD's
  west face opposite the BE entrance), stone planter walls and a stair/ramp climbing NE from the road to the terrace
  and MRD (the OSM footway along x≈35). (M)
* **Bunting** — strings of bright triangular flags across the tiers (2021 and 2026). (H)

## 5. Enterable interiors (built 2026-09, `src/world/mrdInterior.ts`)

Plan frame `mrdAt(s, t)` (layout.ts): origin = midpoint of the east curtain wall, s along it (+NNE), t into the building
(+WSW). Levels `MRD_LV`: ground floor 1.8 (= forecourt), 1st floor 6.2, upper galleries 10.2 / 14.2 / 18.2 (visual),
roof 22. Sources: tour 2026 4:10–5:28 (lobby, corridor, atrium, lantern from below), 2021 tour 5bxHqmfj7bE 1:04–1:28,
2021 tour cWKYL-ruQ_E 1:40–2:10 (auditorium), MRD atrium key frame 0449. Layout confidence L–M; look M–H.

| Space | Where (local s, t) | What | Conf. |
|---|---|---|---|
| Lobby | s −12.7…12.5, t 0…8.8 | two open doorways in the glazing (s −1.2…1.2 and 5.2…7.6); "education for the real world" wall between cream columns facing the doors; photo-mosaic walls at both ends (PES UNIVERSITY letters N, compass emblem S) with black granite reception desks; white marble floor with charcoal bands | M |
| Office + passage | s 1.8…12.3 / s ±1.6, t 8.8…15.3 | "Administrative Office" door off the lobby; a 3.2 m passage straight into the atrium | L |
| Atrium | s −16…9.6, t 15.3…33.5 | 4 storeys; void = octagon (apothem 5 m) round (−3.2, 24.4) with 8 round white columns to the roof; white parapets + black handrails on every gallery; yellow wall panels, navy pilasters and a navy lift core (NE corner); black tables with red seats; octagonal lantern with frosted pyramid glazing on the roof | M–H (look) |
| Stair to 1st floor | s −15.8…−13.2, t 23…31.2 | straight 29-riser flight along the south wall, black railing; lands on the gallery | L (position) |
| 1st floor | gallery ring + corridor | gallery round the void; a classroom on the north side (black-framed windows onto the gallery, green board, desk-bench rows) | L |
| OAT-side exit | s −16…−21, t 19…22 | corridor with a 12-riser stair down to a ground-level door (navy hood) where the OAT footway meets MRD | L |
| Auditorium | the NW hall (`mrd`) | passage behind the "Auditorium" doors (atrium west wall, s −6.6…−4.2) → raked landing + 5 tiers of yellow seats down to a red court floor with basketball markings and wall-bracket backboards, a wooden stage with a yellow back wall and screen, magenta bands, steel trusses with banners | M (2021 video + Wikimedia) |

How it is built: `mrd_east` starts at the ground-floor ceiling (5.85 m), `mrd_fan` / `mrd_fan_w` / `mrd_fan_s` keep the
outer wings round the atrium, `mrd_up_*` fill the atrium's upper floors round the gallery ring, and `mrd` (auditorium)
is a walls-only shell (`BuildingDef.shell`). Floors are solid prisms and stairs `addRamp`. Collision tags use `mrd:*`,
none climbable. The interiors are distance-culled `InteriorKit` LODs (about 8 draw calls each, no lights).

Not seen / not built: the **Reference Library** (OSM node at ≈(61.4, −151.7), inside the entrance block, probably an
upper floor), the 2nd–4th floor rooms, the west exit porch (2025 tour), and the ornate wood-panelled library with a
spiral iron stair in the 2021 tour 4:16–4:40 (building uncertain: MRD or GJBC).

## 6. What was wrong in the game layout (and what changed)

| Before | Reference | Now |
|---|---|---|
| MRD = one 6-floor extrusion of the whole OSM outline, all 'mrd' refurb skin | 5 parts; only the east/SE/NE parts are refurbished; old cream wings face the OAT | split into 5 BuildingDefs with 16–22.8 m heights and two skins |
| 27 m **glass octagon drum** at (22,−168) | the NW part is a big auditorium hall with a faceted metal roof; the atrium has a small octagonal skylight | hall with metal hip roof; `MRD_DRUM` re-used as the atrium skylight lantern on the east block |
| Grand steps 17 m wide, 13 risers, 3.2 m forecourt | ≈24 m, 12 risers, ≈4 m green-marble forecourt, blue-grey columns, name band + canopy | rebuilt from the OSM steps line; canopy with soffit/fascia; handrails, planters, planted wedge by the SE wing |
| Scaffold on the curtain-wall face | curtain wall mostly clear; scaffolding on the stone wings, green tarp at the entrance | scaffolding on the SE wing (road face) and NE block; tarp at the north end of the glazing |
| OAT = rainbow-striped tiers (each tier a colour), one 3.4 m blocking prism, stone slab in the middle | grey tiers, rainbow arch parapet, stage + mural, terrace, trees, bunting | 8 tiers × 3 sectors, each its own prism at its real height; 2 aisle stairs (`addRamp`); +3.2 m terrace podium; stage floor, mural wall, rubble walls, stair from the road, 5 rain trees, poles + bunting |
| MRD west side bare | PES food point shops set into MRD's west face opposite the BE entrance (OSM: Nescafe, Food Corner, ice cream at x≈−2…−6, z −175…−185) | single-storey shop row with yellow fascias and a red "PES FOOD POINT" plate |

### 2026-09 pass (this agent)

| Before | Reference | Now |
|---|---|---|
| Entrance block, atrium and auditorium solid | tours walk in through the lobby, atrium and upstairs; the 2021 tour enters the auditorium | enterable (§5) |
| `glass` style: blue-mullion glass groups | frosted white curtain wall on a light grey grid (0316, 0332) | frosted curtain wall |
| `mrd` stone style: dense punched windows + glass groups | mostly blank buff block with sparse openings (0230, 0316) | sparse black-framed openings |
| Canopy: 1 m thick, black soffit | thin blade rising outward, navy-grey soffit (0316) | thinned |
| `MRD_DRUM`: 22.8 m prism from the ground inside the block | small octagonal lantern over the atrium void | lantern on the roof round the void |

## 7. Open questions

* Exact heights of the MRD parts and the auditorium roof form (satellite only). The central courtyard between the two
  bars is modelled as solid.
* The real atrium plan (where the stairs and lifts are, how many galleries face the void) is inferred from a few
  frames. The stair position and the OAT-side corridor are gameplay choices.
* Whether the OAT terrace continues all the way round to the link road at the MRD level (modelled so; the rubble wall
  opposite the BE entrance supports it).
* The PES sign bridge alignment (see §3).
