# BE block (= B-Block) — reference notes (2026)

Frame: metres, +X east, +Z south, origin = GJBC OSM centroid (same as `CAMPUS_NOTES.md`). Confidence: H / M / L.
Code: `src/world/bblock.ts`; layout ids `bblock`, `bblock_lobby_over`, `bblock_portico`, `bblock_tower`.

## What "BE block" is — H

"BE block" is the building the code calls **B-Block** (OSM way 424687846 "B-Block", 14 levels, x −55…−8,
z −197…−111, north-west of GJBC across PES University Rd). Evidence:
* The 2021 campus tour (`mrdbe_cWKYL-ruQ_E.mp4`) labels it "Block BE" and "BE-BLOCK" and goes on to "The 13th Floor".
  Its facade in those frames (beige stone cladding with vertical pilaster fins, near-square windows, horizontal louvre
  vents, pink-grey stone base) is the same building as the 14-storey beige block with the crest tower and the two
  steel-truss skybridges in the 2026 tour (key frames 0034, 1332, 1352, 1406).
* The 2023 "PES UNIVERSITY BE BLOCK TOUR" (`mrdbe_rYvZomXiFkI.mp4`) shows the same entrance and the "be BLOCK" logo on
  its glass, then the Department of Computer Science and Engineering floors (the existing sign says CSE).
* The 2021 tour's "PESSAT test centre 'BE' block" standee stands at that entrance.

## Sources

| Video (reference/video/) | Date | What it shows |
|---|---|---|
| `mrdbe_cWKYL-ruQ_E.mp4` | 2021-09 | 3:00–3:30 walk north along the east face, the drive under the portico, the entrance, the food point opposite; lobby, atrium with floating timber stairs, upper floors |
| `mrdbe_rYvZomXiFkI.mp4` ("PES UNIVERSITY BE BLOCK TOUR", BRuHaHa) | 2023-08 | 0:41–6:30 crowds at the entrance and the food point, the glass wall, the lobby (Mahatma Gandhi frieze, orange wall, mezzanine), lifts, CSE department |
| `tour.mp4` | 2026 | crest tower + skybridges from GJBC (1332–1406); skyline from the east (0002, 1928); B-block across the road from the OAT (0636 / frames oat26_0398) |

Frames: `reference/frames/be/` — `be21_0180…0208.jpg` (2021: east facade, drive, portico, entrance, food point),
`be23_0064…0168.jpg` (2023: entrance crowd, glass wall + logo, lobby), `sheets23/s23_*.jpg`. The 2021 contact sheets
are in `reference/frames/mrd/sheets21/` (s21_0178 = BE exterior, s21_0210–0274 = BE interiors).

OSM points on the link road east of B-block: "Nescafe" (−2.0,−175.5), "Food Corner" (−5.9,−180.3), ice cream
(−1.7,−185.3): the food point the 2021 tour calls "in front of the BE block".

## 1. Massing and levels

* 14 storeys × ≈3.5 m ≈ 49 m; a projecting balcony/cornice band at ≈10th floor (35 m) with railing, a top cornice,
  a 2-storey pink-grey stone base (≈7 m). Crest tower of buff stone with a deep full-height slot on the east side
  (z ≈ −124…−139) carrying the white PES/Kannada box sign. (H, as before)
* Beige stone cladding panels (#D9CBB6-ish), tall vertical pilaster fins every bay, near-square dark-framed windows,
  horizontal louvre vents between some windows. (H)
* The satellite shows the tall slab along the east side and lower wings with dark roofs to the west, plus a broad
  block at z ≈ −150…−165 whose roof reaches out over the link road — the entrance portico. (M)

## 2. Entrance — east face, facing the B/MRD link road (M-H)

Location: the east facade, z ≈ −153.5…−165.5 (centre ≈(−10.5,−159.5)). The 2021 tour walks **north** along the east
face (building on the left, raised walkway with potted palms and vent boxes), reaches the entrance, and the drive
passes **under the upper floors**, which bridge the road on tall columns standing against a rough granite retaining
wall on the far (MRD / OAT) side; at the far end the green corrugated metro-works hoardings on the ORR. The food point
shops are across the drive (in MRD's west face).

* **Plinth + steps:** a granite-paved plinth ≈0.45 m above the drive with 3 steps along its full length, potted
  palms on the edge; handrail at one end. (H)
* **Glass wall:** a double-height (≈7 m) frameless spider-glass curtain wall ≈11 m wide with auto sliding doors in
  the middle and the white **"be BLOCK"** logo high on the glass; set in a recess between beige stone piers carrying
  white louvre panels; a stone band above; louvred glazing on the floors above. (H)
* **Portico:** the upper floors (from ≈4th floor, ≈14 m) span the drive; columns ≈1.3 m square, pink granite
  cladding to ≈6 m, beige above; two at the plinth edge, two at the road's far edge against the rubble wall. (M)
* **Lobby (seen through the glass, 2021/2023):** double height; a white sketch frieze "MAHATMA GANDHI" (with the
  Ashoka chakra) above an orange-yellow wall along a mezzanine with a black railing; lifts with TV screens; polished
  floor; a reception counter; beyond it the full-height atrium with floating timber-clad stairs and a wave-pattern
  white sculpture wall (upper floors). (H content, M layout)

## 3. 2026 state

No scaffolding seen on BE block in 2026 (the 2021/2023 tours show a small ladder scaffold on the east face only).
Skybridges to the GJBC library block are complete (two dark steel Warren trusses, +14 m and +32 m). (M)

## 4. Interiors that could be enterable at ground level

The lobby floor is the plinth level (+0.45 m), not y = 0, so it is not playable in the flat sim. It is now built
physically: the B-block footprint has a 12 × 9 m notch (`bblock` poly), `bblock_lobby_over` covers it from 7 m up,
the glass wall has a real 3.2 m door opening (collision segments either side), the plinth + lobby floor are one
0.45 m podium (`be:plinth`) and the steps an `addRamp` (`be:steps`). With STEP_UP = 0.45 it becomes walkable as soon
as multi-level movement lands. The interior detail is a 2-mesh THREE.LOD group culled beyond 90 m.

## 5. What was wrong in the game layout (and what changed)

| Before | Reference | Now |
|---|---|---|
| No entrance at all; plain facade all round | main entrance on the east face with plinth, steps, glass wall + logo, portico | added (see §2); lobby interior visible through transparent glass |
| East strip = lawn + street trees | raised walkway / drop-off apron; drive runs along the building | lawn split around the entrance; granite plinth + paved apron |
| Link road open to the sky | upper floors bridge the link road at the entrance | `bblock_portico` (base 14 m, walk-under) + 4 columns |
| Opposite side of the link road bare | rubble granite plinth wall (MRD / OAT level) and the food point | OAT terrace podium ends in a rubble wall along x≈1.9; food point shops in MRD's west face |
| Roof-level "B BLOCK" sign | the building is called BE block | sign text "BE BLOCK" (west face, as before) |

## 6. Open questions

* Exact z of the entrance and portico (from the satellite broad block + the walk in the 2021 tour): ±5 m.
* Whether the portico carries the full 14 storeys or fewer (modelled full height, matching the satellite roof).
* The B-block footprint stays one big OSM block; the lower western wings seen on the satellite are not split out.
