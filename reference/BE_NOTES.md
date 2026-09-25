# BE block (= B-Block) — reference notes (2026)

Frame: metres, +X east, +Z south, origin = GJBC OSM centroid (same as `CAMPUS_NOTES.md`). Confidence: H / M / L.
Code: `src/world/bblock.ts`. Layout ids: `bblock` (notched footprint), `bblock_tower` (shaft with the recess, 10.65–42 m),
`bblock_tower_head` (42–57 m), `bblock_core` (over the enterable core, 10.65–50.15 m). BE frame helpers in
`layout.ts`: `BE_FRAME`, `bePt(s, d)` (s runs south along the east facade, d runs west into the block, (0, 0) = the
entrance axis on the facade line, world (−10.455, −159.5)), `BE_LEVELS` (floor tops G 0.45, 1st 3.95, 2nd 7.45; solid
block above 10.65).

## What "BE block" is — H

"BE block" is the building the code calls **B-Block** (OSM way 424687846 "B-Block", 14 levels, x −55…−8,
z −197…−111, north-west of GJBC across PES University Rd). Evidence:
* The 2021 campus tour (`mrdbe_cWKYL-ruQ_E.mp4`) labels it "Block BE" and "BE-BLOCK" and goes on to "The 13th Floor".
* The 2023 "PES UNIVERSITY BE BLOCK TOUR" (`mrdbe_rYvZomXiFkI.mp4`) shows the entrance, the "be BLOCK" logo on the glass
  and the Department of Computer Science and Engineering floors.
* Google Maps labels the building "BE Block PES University" (Department of Computer Science and Engineering) and has a
  "BE Block 13th floor Canteen" pin.

## The "two centres" (fixed 2026-09-25) — H

The east face read as two centres: the crest tower stood at z −124…−139 (the old CAMPUS_NOTES guess was marked L,
"towards the south end") while the entrance was 30 m further north under `bblock_portico`, a 14×13 m block that
bridged the link road from 14 m to 49 m and projected like a second tower. Evidence that the tower stands **over the
entrance**:
* Satellite (`reference/tiles/`, `reference/sat_campus.jpg`): the buff-stone roof block sits at z ≈ −168…−150 on the east
  face, i.e. on the entrance axis; a lower weathered roof continues east of it over the link road (the portico).
* 2026 tour key 1406: about nine window bays between the SE corner and the tower (old layout: three).
* Key 1928 / 0002 (from the east): the tower is in the middle of the facade.
* 2021 tour be21_0186: looking up from just south of the entrance, the tower is right above / north of the camera.
Now: one centre — tower, recess, glass entrance and portico on one axis; the portico is a low deck (14–16.2 m) on four
columns, not a full-height block; the 10th-floor balcony band and the top cornice stop at the tower's sides.

## Sources

| Video (reference/video/) | Date | What it shows |
|---|---|---|
| `mrdbe_cWKYL-ruQ_E.mp4` | 2021-09 | 2:50–3:30 east face, walkway, drive under the portico, entrance, food point; 3:30–6:00 lobby, atrium with floating timber stairs, CSE classrooms, design floors, 11th-floor map (4:58), mechanical horse, 13th floor |
| `mrdbe_rYvZomXiFkI.mp4` ("PES UNIVERSITY BE BLOCK TOUR") | 2023-08 | 0:41–2:40 entrance crowd, glass wall + logo, food point; lobby (frieze, orange wall, lifts + TV); CSE corridors (orange room plates, red department sign, TVs), lift lobbies (granite), atrium stairs, wave relief wall, hanging TVs, Formula-student cars |
| `tour.mp4` | 2026 | tower + skybridges from GJBC (1332–1406), skyline from the east (0002, 1928) |
| `mrdbe_SmHnHHxbpaE.mp4` | 2025 | GJBC tour (no BE block content) |
| `be_UOVuw2QUp6g.mp4` ("ECE Branch Tour", Vaibhaw Siddharth) | 2023-06 | 0:52–5:40 food point, portico, entrance, lobby (frieze, lifts + TV), the ECE department sign, a gallery with a "Carpe Diem" quote wall |
| `gjbx_ZyeLAVjgiYk.mp4` ("PES University 2024 full campus tour") | 2024-03 | 8:08–8:44 lobby lift bank under the frieze, entrance at dusk, stalls under the portico; 11:44–11:48 both skybridges |
| `gjbx_cFQAKKwyeWY.mp4` ("PES University Bangalore Campus Tour") | 2026-03 | 3:36–4:52 entrance from the drive (paved), glass wall, CSE sign on a gallery parapet, atrium from a gallery |
| `be_uxqjCJBCP_g.mp4` (duplicate of `gjbx_uxqjCJBCP_g.mp4`), `campus_5bxHqmfj7bE.mp4`, `campus_soQwdkL9G0w.mp4`, `campus_9sKwG8IcfE0.mp4` | 2021–26 | scanned: no BE block content |

Frames: `reference/frames/be/` — `be21_*`, `be23_*`, `sheets23/` (2023, incl. `s23b_*` for 6:24–17:36),
`sheetsS/` (SmHnHHxbpaE), `v21/` (2021 exterior at 1 s steps `ext_*`, the 11th-floor map `map11_297/299`),
`scan/` (frames and 4 s contact sheets from the other tours: `UOVu_*`, `ZyeL_*`, `cFQA_*`). Satellite zoom-19 tiles:
`reference/tiles/`.

## 1. Massing and levels

* 14 storeys × 3.5 m ≈ 49 m slab, projecting 10th-floor balcony band (35 m) with railing, top cornice, 2-storey
  pink-grey stone base (7 m). Beige stone cladding panels, pilaster fins every bay, near-square dark-framed windows,
  louvre vents. (H)
* **Crest tower** (H): 18 m wide (s −9…9) on the entrance axis, projecting 0.8 m from the slab face, buff stone panels
  with small **paired** windows in a grid (≈ 5 bays of 3.6 m), 57 m high with the white box sign (orange PES logo + red
  Kannada) on its roof. Its east face has a **deep portal-like recess** ≈ 5 m wide (≈ 28 % of the face, centred) with
  glazing at its back, from above the portico up to a **solid stone head about two floors above the balcony band**
  (≈ 42 m) — not a slot open to the roof (keys 0002, 1406, 1928).
* The satellite's dark rectangle behind the tower's roof edge is more likely a roof light over the atrium than the
  recess. (L)
* North of the tower, key 1928 shows a lower roof line with a glass balustrade, but it lies on the bearing of MRD's
  east block (nearer, ≈ 20 m tall), so it may not be the BE block at all. The 2021 tour's "13th floor" is a rooftop
  cafeteria under a steel diamond-lattice canopy with open terraces and railings (v21/int_01). Not modelled. (L)

## 2. Entrance and east face — H

* **Walkway**: along the whole east face a 0.3 m raised granite walkway (≈ 2.4 m) with potted palms against the wall,
  low white ventilation boxes and a red hose cabinet; no trees against the facade (be21_0180 / 0190 / 0194).
* **Plinth + steps**: granite plinth 0.45 m with 3 steps along the drive, potted palms on its edge.
* **Glass wall**: double-height (≈ 7 m) frameless spider glass ≈ 11 m wide with auto sliding doors in the middle and the
  white "be BLOCK" logo high on the glass, between beige stone piers with tall white louvre panels; a stone lintel and
  recessed louvred glazing above, up to the tower.
* **Portico**: a deep slab at ≈ 14 m (fascia ≈ 2 m) on four columns (pink granite to ≈ 6 m, beige above), north-biased:
  the southern near column stands in front of the glass's middle; the far pair against the rough granite retaining wall
  of the OAT / MRD side.
* **Drive surface**: asphalt with white lane lines in 2021; grey interlocking pavers in front of the entrance and under
  the portico by 2024–26 (cFQA_0232, ZyeL_0504), where event stalls are set up. The link road itself is campus-wide
  (`ROADS` in layout.ts), not changed here.
* **Food point opposite**: the PES FOOD POINT shop row (red plate, yellow fascias, rolling shutters, "Campus Book Mart")
  in MRD's west face across the drive (`mrd.ts`, MRD agent).

## 3. Interior (enterable core, `buildBEInterior`) — content H, layout M

Built from the 2021 / 2023 interior shots; plausible Indian-college fill where footage is missing.
* **Lobby** (s −6…6, d 0.6…10, G): triple height; a bank of three steel lifts on the north wall — light-grey granite
  panels with dark joints under a dark band with a TV (ZyeL_0500, UOVu_0094) — plus the lift core's granite wall with
  two lifts and a TV facing the entrance (under the mezzanine); the **orange wall** above the mezzanine; the **"MAHATMA GANDHI" frieze** (sketched Dandi-march
  figures, Ashoka chakra, tricolour swoosh, "150") on the bulkhead of the 2nd-floor gallery facing the doors; black
  horizontal-bar railings; a granite stair to the mezzanine along the south wall; reception counter, benches, plants.
* **Atrium** (void s ±4.8, d 15…25 through the 1st and 2nd floors) behind the lift core: two **floating golden-timber
  stairs** (G→1st rising west, 1st→2nd rising east — an X in elevation), white gallery bands with black railings,
  skylight diffusers, a hanging TV, the white stacked-block sculpture and pin boards of student work on the ground
  floor, the **wave relief wall** on the lift core.
* **Rooms** off the galleries (north and south wings, two per wing per floor): G01 CSE office, classrooms (wooden
  3-seater benches, green board on a dais, ceiling fans, tube lights, notice board), CSE labs (rows of monitors),
  glazed panels with black bars onto the galleries (2021 lab view), orange room plates, the red CSE department sign
  (1st floor) and the ECE department sign (2nd floor; ECE shares the block, UOVu_0124).
* **Stair core** (west end): dog-leg flights with mid landings, floor numbers, WC block.

Physical model: floors are prisms (G podium, 0.3 m slabs at 3.65 / 7.15), flights are segmented `addRamp`s (flat
undersides per segment so flights stack), doorways 2 m, galleries ≥ 2.4 m, headroom 3.2 m, railings as 'wall' prisms.

## 4. Skybridges — M-H

Two dark steel Warren-truss bridges (3 m wide, 3.5 m tall, glazed) to the GJBC library at **the same x ≈ −42**, one at
+14 m (≈ 4th floor) and one at +32 m (just under the balcony band): in keys 1352 / 1406 and sheet_1320 both have the
same apparent span and position, so they are stacked (they were at x −40 and −22 before).

## 5. Open questions

* The lower roof north of the tower (terrace with glass balustrade — BE or MRD?), the 13th-floor rooftop cafeteria and
  the "lower western wings" on the satellite. A frame showing the whole east face from the north would settle it.
* A 2025 scan claimed "ordinary floors ride on the portico" (cFQA_0232), but that frame is cut at the soffit; the
  window bands in it belong to the facade behind.
* The exact floor plan behind the lobby (the 11th-floor map shows a ring of rooms round an elongated central void with
  lift banks on the east side; the lower floors are modelled on that pattern).
* Whether the portico carries anything above its slab (the satellite shows a lower weathered roof, modelled as a deck).
