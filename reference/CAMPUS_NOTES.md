# Pesident Evil: campus visual reference (Ring Road campus, 2026)

Source: "PES University - Campus Tour 2026" (`reference/video/tour.mp4`, 20:06, overcast monsoon day, wet ground).
Cross-checked against the OpenStreetMap extract (`reference/osm_main_campus.json` / `.png`).

**Coordinate frame used everywhere in this file:** metres, Y up, **+X = east, +Z = south (−Z = north)**,
**origin = centroid of the OSM "Golden Jubilee Block (GJBC)" outline** (lat 12.933977, lon 77.534549).
This supersedes the older satellite frame, where the origin was the basketball court. Footprints marked *OSM* are
exact. Everything else is estimated from the video, and each estimate carries a confidence (H / M / L).

Frames:
* `reference/frames/key_<mmss>_<slug>.jpg`: 59 full-res (1280×720) key frames. The index is in §9.
* `reference/frames/sheets/sheet_<mmss>.jpg`: 38 contact sheets. Each is 4×4 tiles, one tile every 2 s, read
  row-major, and covers 32 s starting at `<mmss>`.

---

## 0. The ten things that matter most

1. **GJBC is not the terracotta/cream building.** It is a brand-new (2024–26) white/cream stone and dark-glass
   mega-block (see §3.1). The terracotta + cream banded building in the old satellite notes is **F-Block**, to the
   south-east of GJBC (§3.5).
2. **There is no outdoor basketball court in the GJBC courtyard any more.** The central courtyard (the "Quad")
   is a **polished granite plaza** ≈35 × 80 m. It has double-height white colonnades on both long sides, black
   planters and blue banners. Basketball, badminton and volleyball are in an **indoor sports hall** inside GJBC.
   Confidence: M-H. The whole quad is shown at 11:12–11:56 and there are no hoops or court markings.
3. The north end of the Quad opens into a huge **covered plaza**: wood-look soffit, grey steel beams,
   yellow-wood columns and clusters of paper cone lamps. On its north side a **steel pergola terrace** looks down
   onto PES University Rd, the yellow buses and **B-Block**.
4. **B-Block** (14 levels, beige, stone base, crest tower with a Kannada "ಪಿಇಎಸ್" roof sign) is joined to GJBC's
   tall north-west part by **two steel-truss skybridges**, one low and one high, over PES University Rd.
5. **The "PES" signboard skybridge** crosses the road between GJBC's north wing and the south-east wing of the
   **MRD Block**. It is the landmark you see as you drive in from the gate. MRD is **under refurbishment**:
   scaffolding, buff stone cladding, a frosted glass curtain wall, and a navy canopy reading
   "DR. M.R. DORESWAMY SILVER JUBILEE COMPLEX" above grand white steps.
6. **The gold PES armillary globe** stands on a dark stone plinth in a landscaped bed at the **east plaza**.
   It is across the MRD loop road from MRD's east entrance, near the west tip of the PES Lawn.
7. **The main gate** is a white portal. The beam carries the PES logo and "ಪಿಇಎಸ್ ವಿಶ್ವವಿದ್ಯಾಲಯ". The south
   pillar has vertical **"PES UNIVERSITY" in maroon**, not navy. There are two dark-grey sliding gate leaves
   (entry and exit) with a median between them. The gate is attached to the **mural building (OSM "Admission
   Enquiry")**. Its outer face has a colourful "Community Development" relief mural. Its campus-facing side has a
   blue pixel-tile mural with a compass rose and graduates in gowns.
8. **The entry road** (gate → west) is a ≈12 m asphalt dual carriageway with **black-and-white painted kerbs**
   (not yellow), yellow folding barricades and parked yellow college buses. On its north side a striped-paver
   promenade runs through the PES Lawn, with ornamental-grass beds.
9. The **east side of GJBC** has a long paved **promenade**, a big **lawn with young trees**, and a
   **corten-steel + green-panel boundary wall**. Colourful 4–6 storey apartment blocks stand behind that wall.
   A raised **Faculty of Law terrace** overlooks all of this from GJBC's south-east.
10. Materials palette: cream stone panels, dark grey glass, polished grey granite with charcoal bands, wood-look
    soffits, yellow-wood column cladding, terracotta (F-Block and the porte-cochère frame), navy accents (MRD,
    Law). Sky: overcast. Wet reflective floors are very characteristic.

---

## 1. Tour map (timestamp → place → world position)

| Time | What is shown | World position (OSM frame) | Conf. |
|---|---|---|---|
| 0:00–0:14 | Host intro on the PES Lawn promenade; GJBC NE corner left, B-Block crest tower on the skyline | ≈(130,−135) looking W | H |
| 0:14–1:04 | "Coming up" teaser montage: gate from outside, entry road, globe, GJBC interiors, Quad, B-Block skybridges, Law terrace, F-Block, promenade, cafeteria, statue, porte-cochère | various | – |
| 1:04–2:08 | Walk W along the PES Lawn promenade. Entry road + parked buses + GJBC north facade on the LEFT (south), lawn/grass beds on the right. Caption "*F BLOCK" at 1:52 while pointing left/south (F-Block itself is not in frame; it is behind GJBC to the SE) | x 165→95, z≈−135 | H |
| 2:08–2:56 | **East plaza**: striped pavers, trench drain, pedestrian ramp with dark-grey parapets rising W, **PES signboard skybridge**, MRD SE wing in scaffolding (right), **globe**, a wide granite stair up to a white pavilion (right/N) | x 85–115, z −150…−128 | M |
| 2:56–3:12 | Frangipani garden (grass, Plumeria, purple Tradescantia beds), then out onto the MRD loop road | x 77–91, z −149…−129 | M |
| 3:12–4:10 | **MRD east entrance**: grand white steps, green-marble forecourt, navy canopy "Dr. M.R. Doreswamy Silver Jubilee Complex". At 4:00 the view back E across the road to the globe garden | ≈(70,−148) | H |
| 4:10–5:28 | MRD interior: "education for the real world" wall, PES photo-mosaic wall, cream corridors with notice boards, a 4-storey atrium (navy columns, yellow walls, red plastic chairs, octagonal skylight), scaffolding outside the windows | inside MRD | H |
| 5:28–5:32 | Entry road looking E to the gate portal, bus parked on the right | ≈(90,−122) looking E | H |
| 5:32–5:52 | **GJBC east forecourt**: bus on pavers, east colonnade, F-Block terracotta tower far to the S, **NE porte-cochère** (terracotta frame + planter), **drive-through under the north wing**, east entrance granite steps | x 84–100, z −120…−70 | M-H |
| 5:52–6:24 | GJBC east lobby: glass doors, walnut-slat wall with gold PES logo, white granite reception desk | GJBC E wing | H |
| 6:24–6:56 | Granite corridors and stairs; a window view through the **north ground-floor colonnade** across PES Univ Rd (ambulance) to the Open Air Theatre steps and old cream buildings | GJBC N edge ≈(20,−115) | M |
| 6:56–7:28 | Admission hall: timber-slat ceiling, yellow-wood columns, red feature wall with a gold tree sculpture, "ADMISSION" counters, black waiting chairs | GJBC interior | H |
| 7:28–8:40 | Red-floored gallery overlooking the **indoor sports hall** (maple floor, red border, 3–4 courts, trophies) | GJBC interior, N-centre (L) | H (content) / L (position) |
| 8:40–9:36 | Granite stairs down; café/restaurant with a maroon wall | GJBC interior | H |
| 9:36–9:56 | Lobby with a geometric metal wall sculpture; glass doors out to the covered plaza | GJBC N-centre | H |
| 9:56–11:12 | **Covered plaza**: reception desks, "PEOPLES EDUCATION SOCIETY" glass entrance, grey steel pergola edge with a hedge (N), cone-lamp clusters, big opening S into the Quad | x 20–55, z −117…−95 | M |
| 11:12–11:56 | **The Quad** (colonnades, planters, banners, granite pattern) | x 20–55, z −95…−15 | M |
| 11:56–12:48 | **Yellow-column hall** (coffered wood/red ceiling), counters behind glass, white draped round tables, standee banners, **Central Library** shelves behind glass | GJBC NW | M |
| 12:48–13:04 | Back through the covered plaza | – | – |
| 13:04–14:06 | Pergola edge: looking down on treetops and buses on PES Univ Rd. **B-Block** straight ahead, **two skybridges** GJBC↔B-Block, the street continuing W past a construction strip | ≈(20,−110) looking N/W | H |
| 14:06–14:32 | Covered plaza → Quad colonnade (red-tile-look soffits, dark grey walls with louvres) | – | – |
| 14:32–14:56 | Faculty of Law level interior (white metal-slat ceilings, navy trim, granite walls) | GJBC SE upper level | M |
| 14:56–16:14 | **Law terrace** (upper-level colonnade on the E side): views down to the promenade and lawn, the terraced garden, **F-Block** terracotta tower + beige banded wings, the food-point shed and a neighbouring white apartment block | terrace ≈x 88–94, z −10…40, +8 m | M |
| 16:14–16:30 | Faculty of Law entrance (navy sign plate) | GJBC SE | M |
| 16:30–16:52 | **GJBC cafeteria**: glass wall facing the lawn, long wood tables, grey chairs, LED ring lights | GJBC E wing, ground floor, S part | M |
| 16:52–17:56 | Lawn and corten boundary; granite stair from the terrace down to the promenade; promenade looking N (bus at the far end) and S (F-Block at the far end) | x 90–155, z −110…40 | H |
| 17:56–18:40 | Lawn with young trees, lamp posts, corten wall, **bronze reading-student statue** | x 100–150, z −60…−10 | M |
| 18:40–19:10 | Walk N along the promenade; bus pulls out; porte-cochère; PES skybridge and the long grey ramp seen from the east | x 90–110, z −130…−100 | H |
| 19:10–19:30 | South-side walkway along the entry road to the gate: steel-mesh shelter, **bike parking canopy**, white-flowering hedge | x 120–175, z −122…−95 | M |
| 19:30–19:44 | View W over the hedge: GJBC, PES skybridge, B-Block, bus | ≈(150,−115) looking W | H |
| 19:44–19:52 | **Gate from inside**: compass/graduates mural, rough granite compound wall, entry road | ≈(165,−125) | H |
| 19:52–20:06 | End card | – | – |

Places **not** shown in the video: boys' hostel, G-Block, Pie R Cube, the cricket ground, the Mechanical Lab
Complex, the ORR metro works (except glimpses), food-court tensile canopies, and any GJBC rooftop. Use OSM plus
generic styling for these.

---

## 2. Corrections to the old satellite/Street View notes

| Old note | What the 2026 video shows | Conf. |
|---|---|---|
| Origin = GJB basketball court | New origin = GJBC outline centroid (see the header). The courtyard centre is ≈(37,−55) | – |
| Open-air basketball court in the GJB courtyard | The courtyard is a paved granite **Quad** (no hoops). The courts are **indoors** (sports hall inside GJBC) | M-H |
| GJB courtyard buildings: terracotta/orange + cream bands, balcony railings | That describes **F-Block** (SE, outside GJBC). GJBC courtyard facades are **white granite colonnades + cream plaster + blue-grey glass**, with glass-railed balconies on one level | H |
| Gate pillar: navy "PES UNIVERSITY" | The vertical text is **maroon/dark red** (#8C1D2C). The beam text is dark maroon/black Kannada + an orange PES logo. There is a small "PESU" wordmark at the far end of the beam | M |
| Mural "tree with blue birds, Community Development" left of the gate | Correct. It is on the **outer (east) face of the mural building south of the gate** (OSM "Admission Enquiry"), shaped as a relief with protruding wooden cubes. The **campus-facing (west) face** has a blue pixel-tile mural: compass rose, "Perseverance, Excellence, Service through …" text and life-size graduates in gowns | H |
| Globe "on a lawn in front of the main building" | It is on a **dark green-grey stone plinth at the end of a planted bed** at the east plaza, beside a short stair and white wall, across the road from MRD's east entrance | H |
| "Navy fascia band with PES logo" main building | That is **MRD's navy entrance canopy** (with the Doreswamy name) and the **PES signboard skybridge**. GJBC uses dark-grey fascia bands, not navy | H |
| Food court: red chairs under a white tensile canopy | Not seen. Red plastic chairs appear in the **MRD atrium**. The GJBC cafeteria uses grey chairs. The **South Thindies food point** is a white curved-roof shed (seen from above) | M |
| Main gate at (88,−62) in the old frame | = (176,−131) in the new frame (OSM entry road end). **Superseded 2026-09-25: the portal is at x ≈ 164** (§10) | H |

---

## 3. Buildings

Floor heights: new blocks (GJBC) ≈ 4.2–4.5 m floor-to-floor; old blocks (B, MRD, F) ≈ 3.5 m.
Hex colours are estimates from overcast footage; lighten them ~10% for a sunny scene.

### 3.1 GJBC: Golden Jubilee Block (new main complex)
*OSM outline x −60…94, z −123…52 (≈154 × 175 m). Key frames: 0141, 0152, 0532, 0538, 0540, 0546, 0552, 1000–1210, 1500, 1636, 1730, 1756.*

**Overall massing (M):** a ring of 5–6 storey wings (≈22–26 m) around the Quad. The north-west part (Central
Library block) is a **tall ≈10-storey (≈42 m) white block** linked to B-Block by skybridges. The south part
(Tech Park = SW, Electrical = SE, with the big skylit hall roof) is lower (≈16–18 m). The Faculty of Law sits
on the SE upper levels with an **east-facing terrace at ≈ +8 m**.

**External facade ("gjbc_modern"), north and east faces:**
* **Base (ground + mezzanine, ≈9 m):** a colonnade of slender square cream columns (0.6 m, spacing ≈4 m, 2 storeys
  tall). Behind them, set back 2–3 m, is full-height dark tinted glazing. On the south part of the east face the
  columns become tall **fins** (0.4 × 1.2 m) in front of a dark glass curtain wall (1756, 1730).
* **Upper floors (3–4 levels):** alternating horizontal bands of **cream stone panels** (#E8E1D3, large 1.2 × 0.6 m
  panels with fine joints) and **continuous ribbon windows** of dark blue-grey glass (#3E4A55) with thin mullions
  every 1.5 m. **Dark charcoal metal fascia bands** (#44484E, ≈0.8 m) wrap the corners. There are window-unit AC
  boxes on some ledges.
* **Top:** a recessed glass penthouse floor with a thin projecting roof slab. Flat roof with parapet.
* **Plinth:** ≈0.9 m raised podium along the east face, with speckled grey granite steps (#9C9C9A) and black
  granite skirting. Long planters with small trees in black-granite troughs.
* **NE porte-cochère (0538, 0152):** a rectangular portal ≈14 m wide × 9 m tall clad in **terracotta-brown**
  (#7F4432) panels around a dark recess. A dark grey concrete **planter band** (≈1.5 m tall) spans the opening at
  ≈5 m height, planted with lime/yellow shrubs. An orange + white "PES University" banner hangs on it.
* **Drive-through (0540):** PES University Rd runs **under/along the north wing**. It is a long covered roadway
  (clear height ≈5.5 m) with a footpath on the building side (white wall, red fire extinguishers), black-and-white
  kerbs, and daylight + skybridges at the far west end. The north side of this ground level is an open colonnade
  (square granite-clad columns, dark brown wood-look soffit, dark-green slatted fence) facing the Open Air
  Theatre (0636).

**East entrance (0546, 0552):** a two-storey cream portal box projecting from the colonnade. There are 6–7
speckled granite steps flanked by granite cheek walls and a hanging creeper. Tall frameless glass doors lead to a
lobby with a vertical-slat walnut wall and a gold compass "PES University" logo.

**The Quad ("gjbc_quad") (1136, 1150, 1156):**
* ≈35 m wide × 80 m long, running N–S. Centre ≈(37,−55). Floor at plaza level.
* Floor: polished light-grey speckled granite (#C4C5C2) with **charcoal granite bands** (#3E4143, 1–2 m wide).
  The bands form a longitudinal stripe down the middle with diamond/chevron crossings every ≈15 m.
* Both long sides: **colonnade of square white-granite columns** (0.9 m, #D8D8D4) with a **dark granite base**
  (1.2 m, #3A3C3E). Spacing ≈4.5 m (about 18 bays per side). Double height (≈9 m). The arcade behind is ≈4 m deep,
  with a red-brown soffit and dark-glass shopfronts. **Blue vertical banners** (#2D59A8, white graphics) hang on
  every 2nd–3rd column. There are 2–3 granite steps up into the arcade.
* Above the colonnade: 3–4 floors of cream plaster (#E9E2D2). One level has a **continuous balcony with glass or
  steel railing**. Long ribbon windows, a **blue-grey glass curtain band** near the top, and a cream parapet.
* South end: a lower block (2-storey dark glazed base + a glass bridge/gallery above), then 3 cream storeys
  behind.
* Planters: a row of **black square pots** (0.8 m cubes) with cycads/dracaena along each colonnade edge,
  ≈5 m apart.

**Covered plaza (1000, 1034, 1100, 1136):** at the north end of the Quad, ≈35 × 18 m, roof at ≈13 m.
* Ceiling of **reddish-brown wood-look panels** (#8B4A2B) between **slate-grey steel beams** (#6E7F8E).
  **Yellow-wood-veneer clad columns** (#D9A441) with dark grey bases. Dark charcoal walls (#4A4F55).
* **Clusters of hanging paper cone lamps**, white and tan (#F2EEE6 / #B07A45), about 40 per cluster, at 4–7 m.
* White granite reception desks with a maroon-brown top. Black steel waiting chairs.
* "**PEOPLES EDUCATION SOCIETY**" in red letters (#B3261E) on a white fascia over a glass entrance in
  granite-clad walls (1020).
* North edge: open-sky **grey steel pergola** (portal frames of 0.5 m box beams with diagonal knee braces)
  above a **planter parapet with a dense hedge** (Heliconia/peace lily). It overlooks PES University Rd, treetops,
  parked buses and B-Block (1034, 1332).

**Yellow-column hall + Central Library (1210):** a big double-height hall NW of the Quad. It has rows of
**yellow-wood columns** with dark grey bases and a **coffered ceiling** (wood grid with red/brown and white
squares). Glass-fronted counters and offices, white draped round tables with standee banners. The library
bookshelves are behind a glass wall.

**Other interiors (for later or for props):** the admission hall (0724: timber-slat ceiling, yellow-wood columns,
red wall + gold tree sculpture, "ADMISSION" counters); the **indoor sports hall** (0744: maple floor, red border
strip, 3–4 basketball/badminton/volleyball courts in a row, white walls with vertical fins, dark steel roof trusses,
a red-floored spectator gallery above one long side); the cafeteria (1636); the Law level (navy trim, metal-slat
ceilings).

**Faculty of Law terrace (1500, 1506, 0050, 1614):** an upper-level (≈ +8 m) east-facing terrace ≈6–8 m deep
along the SE of GJBC. A colonnade of big cream stone-clad square columns (1 m) stands in front of a glass-walled
corridor. The floor is coarse speckled grey-white granite. The **parapet** (1.1 m) has cream panels, dark granite
skirting and a black granite coping. Recessed step lights. A granite stair (≈3 m wide, 20 risers) runs between
cream walls with dark granite skirting down to the promenade (1736, 1056). The entrance is a cream portal with a
small navy sign "Faculty of Law / ಕಾನೂನು ವಿಭಾಗ".

**Cafeteria (1636):** ground floor of the E wing, south part, under the Law terrace. A full-height glass wall
faces the lawn. Inside: long light-oak tables, grey plastic chairs, square LED ring lights, an exposed black
ceiling, a brick-red wall.

### 3.2 B-Block (CSE; 14 levels)
*OSM x −55…−8, z −197…−111 (slab ≈45 × 85 m). Key frames: 0034, 1332, 1352, 1406, and the skyline in 0002/0141/1952.*
* **Height:** 14 levels × 3.6 m ≈ 50 m. The **crest tower** rises ≈6–8 m above the roof. It carries a white box
  sign: orange PES logo + red Kannada "ಪಿಇಎಸ್" facing E/SE, visible from the gate.
* **Facade ("b_block_beige"):** beige plaster (#D9CBB6) with vertical pilaster strips every 2 bays. There is a
  regular grid of near-square windows (1.3 × 1.4 m, dark frames #2F3A40, ≈3.5 m bays). Small horizontal louvre
  vents sit between some windows. The **bottom 2 floors are clad in pinkish-grey stone** (#A89484). A thin
  projecting cornice sits at the top.
* **Crest tower:** a darker buff stone block (#C2AE93) with a deep full-height recessed slot and tiny square
  windows. It stands on the east side, towards the south end (L).
* **Skybridges to GJBC NW:** two dark-grey steel **Warren-truss** bridges (≈3 m wide, ≈3.5 m tall, glazed in
  between). The low one is at ≈4th floor (+14 m); the high one is at ≈9th floor (+32 m). They cross PES Univ Rd
  (≈10–15 m span).

### 3.3 Prof. MRD Block (A-Block / "Dr. M.R. Doreswamy Silver Jubilee Complex"; 6 levels)
*OSM fan/wedge polygon x 2…81, z −188…−126. Key frames: 0208, 0216, 0230, 0306, 0316, 0332, 0401, 0449.*
* **State in 2026:** under **refurbishment**. There is full-height **steel-tube/bamboo scaffolding** on several
  faces, **green safety nets** and building material at the base.
* **New skin ("mrd_refurb"):** buff sandstone cladding blocks (#C8B89E) on solid parts. Upper floors have a large
  **frosted/white glass curtain wall** (#D8E3E8). Deep **navy canopies/cornices** (#1F2B45) with thin cantilevered
  slabs sit over the entrances and at the top. The roof parapet is a **perforated metal screen** (dark grey,
  diamond pattern).
* **East entrance (0316, 0332):** faces E onto the loop road at ≈(72,−148). There are **12–14 white granite steps**
  about 20 m wide, then a forecourt of glossy **green-grey marble** slabs (Indian green marble, #5F7468).
  A glazed ground floor has **blue-grey painted mullions/columns** (#4F6D8C). Above it is a navy canopy fascia
  with silver letters: "DR. M.R. DORESWAMY SILVER JUBILEE COMPLEX".
* **Older wings:** cream/white plaster (#EFE7D6) with a terracotta panel (#9C5A45) and a grey flat canopy over a
  ground-floor parking bay (0316, left).
* **Interior atrium (0449):** 4 storeys, octagonal skylight, cream walls, **navy-blue columns and lift cores**,
  yellow wall panels, red plastic chairs around black tables.
* **Open Air Theatre** (OSM x 4…32, z −150…−120): stepped seating tiers painted in bright stripes, colourful
  bunting and mature trees. It lies in MRD's concave south side, directly N across the road from GJBC's north
  colonnade (0636).

### 3.4 PES signboard skybridge + ramp (landmark over PES University Rd)
*Key frames: 0141, 0152, 0208, 0216, 0230, 1912, 1928.*
* A steel-and-glass bridge ≈5 m wide, deck at ≈ +8 m. It spans N–S between GJBC's north wing (≈(55,−117)) and
  MRD's SE wing (≈(55,−129)). Position: M-L.
* It carries a **large white signboard** (≈18 × 3.5 m) on its east face: orange-red circular PES logo + navy
  "PES UNIVERSITY". A dark grey soffit and handrail are visible above.
* A long **pedestrian ramp** with **dark-grey solid parapet walls** (1.1 m) rises W from the east plaza towards a
  landing below the bridge (0208). It is paved in the striped pavers. Position: L. See the JSON note.

### 3.5 F-Block (Panini Block, oldest; 8 floors)
*OSM V-shape x 75…127, z 7…84. Key frames: 0050, 0532 (far), 1512, 1534, 1736, 1756, 1922.*
* **Identification:** the terracotta tower seen straight S along GJBC's east colonnade, with a "PES" sign on top.
  Confidence M-H. The beige banded wings in 1534 may partly belong to the boys' hostel behind it (M).
* **Look ("f_block_terracotta"):**
  * The **tower** (≈9–10 levels, ≈34 m) is terracotta/red-ochre textured render (#B45A45). It has a grid of deep
    recessed windows, each paired with a beige vertical panel (#E3D2B0), a heavy cornice and a roof sign.
  * The **wings** (8 levels, ≈28 m) are cream/beige (#E6D8BC) with **continuous horizontal balcony bands**:
    open corridors with solid parapets and dark recessed walls behind (a strong striped look).
  * A **3-storey terracotta podium block** has small square punched windows.
  * Rooftop water tanks and dish antennas.
* **Terraced garden (1512):** in front of F-Block, below the Law terrace. Stepped **granite planter boxes**
  (charcoal coping), fishtail/areca palms, small trees, granite benches and a paved path.

### 3.6 Main gate + mural building (OSM "Admission Enquiry")
*Key frames: 0020, 0022, 1160 (1920), 1946, 1952.*
* **Portal (gate centre ≈(164,−131), facing E towards the ORR service road; was (176,−131) before §10):**
  * White plastered **beam** ≈26 m span, ≈2.6 m deep (vertical), ≈4 m thick (E–W). Underside at ≈8 m, top at
    ≈10.6 m. The underside is light grey.
  * **South pillar:** a white box ≈4 × 4 m, merged with the mural building's NE corner. It carries **vertical
    maroon "PES UNIVERSITY"** and has a small pedestrian door with a dark slatted gate plus a red sign plate at its
    foot.
  * **North pillar:** a white box ≈3.5 × 3.5 m, often hung with a large event banner (≈6 × 4 m).
  * Beam text (E face): orange PES logo + "ಪಿಇಎಸ್ ವಿಶ್ವವಿದ್ಯಾಲಯ" (dark maroon) at the south end, and a small
    "PESU" wordmark at the north end.
* **Gates:** two **dark-grey sliding steel gates** (#3A3D40, vertical slats, ≈2.2 m tall, each leaf ≈7 m) for the
  IN and OUT carriageways, separated by a narrow median island where the guard stands. Yellow folding barricades
  stand in front. A red/white boom pole is on the inside (1160).
* **Mural building** (OSM x 156…184, z −120…−107, 4 floors ≈14 m; plus a 1-storey strip to x 214):
  * White plaster with a few small windows.
  * **East/outer face:** a large painted mural (warm yellows, greens and teal; a tree with birds; "Community
    Development" text) with **protruding wooden cubes** as relief.
  * **West/inner face:** a blue pixel-tile mural (#4A90C8 / #9CC7E8 squares), a big red-navy compass rose with a
    globe, "Perseverance, Excellence, Service through …" text, and grey life-size graduates in caps and gowns
    along the bottom.
* **Compound wall** next to it: **rough-dressed grey granite blocks** (#8D8A83), ≈2.4 m, with thick mortar and a
  top course.
* North of the gate (outside view): a low white building with a curved white planter wall; beyond it the brief
  mentions blue perforated jali panels (not clearly seen). Planters, grey interlocking pavers outside the gate.

### 3.7 Small buildings
* **Security cabin** (from the brief): white 3 × 3 × 2.8 m box with a blue door, just inside the gate on the north
  side. The video only shows guards at the gate median.
* **Steel mesh shelter** (1160, right): ≈12 × 6 m on the south side of the walkway near the gate. Steel frame,
  flat metal roof, chain-link panels, on a raised plinth.
* **Bike parking canopy** (1922): a white single-storey flat-roofed open shed (≈18 × 10 m, ≈3.5 m) on a concrete
  yard with painted white parking bays. Motorcycles and a steel bike rack. Position ≈(146,−102) (L).
* **South Thindies food point** (OSM x 133…151, z −22…−2): a white shed with a curved/arched metal roof and a
  grey frieze. Potted plants and bikes in front, a sand pile and construction debris nearby (1556).
* **HPC Lab** (OSM x 123…151, z −2…10): 2-storey plain white block (generic).
* **Outside the east boundary:** colourful residential apartment blocks, 4–6 storeys, flat roofs with black water
  tanks. Colours: white #F2F2EE, pale yellow #E9D38C, mint green #5FC18E, sky blue #9CCFE0, salmon #E39A7E.
  A white 5-storey block with balconies stands right behind the food point (1556).

---

## 4. Ground and landscape

**Roads**
* Asphalt, dark grey (#4B4B4B), heavily weathered to #6C6B67 with sandy dust, tyre marks and patches.
* Entry road ≈12 m (two one-way carriageways of 5–6 m). The others are 6–8 m. No lane markings seen.
* **Kerbs:** 150–200 mm high, **painted alternating black and white** in ≈0.5 m blocks along every road (0022,
  0530, 1920). Walkways use plain grey granite kerbs/edging.

**Paving types**

| Where | Paving |
|---|---|
| PES Lawn promenade, east plaza, entry walkway (0141, 0208, 1920) | Large rectangular pavers (≈600 × 300 mm) in running bond across the path. Mixed **buff/sand #D8C3A5, light grey #C9C6C0, mid grey #9A9894**, with random **charcoal stripes** (#6E6E6C) a few pavers long ("barcode" look). There is a linear steel trench-drain grating across the plaza |
| East promenade (1730, 1756) | Grey rectangular concrete pavers (≈300 × 150), two greys, with a darker border band. Low grey concrete kerb to the lawn |
| Quad, covered plaza (1150) | Polished light granite with charcoal bands and diamonds |
| MRD forecourt (0332) | Glossy green-grey marble slabs |
| Terraces and steps | Coarse speckled grey-white granite |
| Outside the gate | Grey interlocking pavers |

**Lawns:** well-kept Bermuda grass (#6E8B3D). In 2026 they are freshly laid, with young trees in square steel
tree grates or soil pits. The east lawn (Student Lounge + garden) is huge and flat. A **white low wall** (≈1.2 m,
#EDEDEA) and the **corten boundary** close it to the east (1654, 1812).

**Corten boundary (east, 1812):** ≈3–3.5 m tall. **Rust-brown corten panels** (#7A3B22, 3 m wide) alternate
with **dark-green mesh panels** covered in creepers. Some corten panels have leaf-shaped perforations.

**Planting palette**
* **Ornamental fountain grass** (Pennisetum, straw-green #A7B25A) is the signature. It fills long raised beds
  along walkways and the road.
* **Purple heart** (Tradescantia pallida, #5A2E4A) and **maroon Iresine/Acalypha** (#6B1F2E) as ground cover.
* Red ginger / Heliconia and bird-of-paradise in planters (orange flowers); peace lily and Dracaena in the
  covered-plaza hedges.
* **Frangipani** (Plumeria) with white flowers in the east plaza gardens (0256).
* **White-flowering Murraya/jasmine hedges** near the gate (1928).
* **Tiered "cloud" trees** (Terminalia mantaly, flat layered canopy) near the entry road and east plaza (1902).
* **Young street trees** on the lawns: Tabebuia/Pongamia saplings 3–5 m, plus a few **maroon-leaved** small
  trees (1808).
* **Mature canopy trees:** rain trees / Peltophorum (yellow flowers) along the ORR boundary wall. Big dense ficus
  at the gate (1160 right). Tall mature trees along PES Univ Rd between GJBC and B-Block and around the Open Air
  Theatre (1332, 0636).
* **Palms** (areca, fishtail) near F-Block and the terraced garden.

**Street furniture**
* **Lamp posts:** charcoal steel poles ≈6–7 m with a single short arm at the top ("Γ" shape) and a flat LED head.
  Some have a double arm. About every 20 m along the promenade and lawn paths.
* **Benches:** long **monolithic grey granite blocks** (≈2.4 × 0.5 × 0.45 m) along the walkways. Planter walls with
  granite coping also serve as seats.
* **Raised planters:** grey concrete or granite planters, 0.4–0.6 m tall, with charcoal coping.
* Drains: trench gratings; no open drains seen on campus.

**Parking:** yellow college buses park along the south side of the entry road and in the GJBC east forecourt.
There is a motorcycle yard under the canopy near the gate (1922) and motorcycles along the entry road (OSM
motorcycle_parking strips x 95…144, z −127…−119).

---

## 5. Props and life details worth recreating

* **PES college bus:** ≈11 m, yellow #F2C200 with a **green stripe** #1E8C3A under the windows and a dark window
  band. "PES UNIVERSITY" in navy, orange logo, "COLLEGE BUS" in green on the front, Kannada name on the side,
  KA 51 plates (1902, 0532). Great cover object.
* **Ambulance:** white Force Traveller type with red/yellow Battenburg checks, "BASIC LIFE SUPPORT AMBULANCE"
  (0636).
* **Gold PES armillary globe** ≈3 m, gold meridian rings + gold continents + bold "PES" letters, on a dark
  green-grey (#4E5A55) stone plinth ≈1.2 m. Position ≈(84,−140).
* **Bronze reading-student statue:** a seated student with a laptop on a polished black granite block, beside
  the promenade (1826).
* Yellow folding barricades (gate, entry road). Red/white boom barrier at the gate. Red fire extinguishers and
  fire buckets in the drive-through.
* **Scaffolding + green nets + construction material** at MRD. Sand piles, rubble and white bags near the food
  point and the east lawn edge. Metro-construction green-mesh barriers on the ORR service road (from the brief).
* Blue vertical column banners (Quad). **Black cube planters** with cycads. **Standee banners** (BBA/MBA,
  orange/navy). White draped round tables. Black steel 3-seat waiting chairs. White granite reception desks with a
  maroon top.
* **Cone pendant lamp clusters** (covered plaza): an iconic ceiling prop.
* Red plastic chairs + black tables (MRD atrium). Long oak tables + grey chairs (cafeteria).
* Notice boards in cream corridors, water can/dispenser, trophies on a skirted table (sports hall).
* Motorcycles/scooters in rows, steel bike rack.
* Event banner on the gate's north pillar ("International Staff Tournament: Cricket, Badminton, Volleyball,
  Throwball, Table Tennis, Squash"). Good for flavour text.

---

## 6. Set-piece spots for a zombie game

| Spot | Why | Where |
|---|---|---|
| **Main gate** | 2 lanes, ≈7 m each, between the mural building and the north pillar. The natural horde entry point. The median island and guard cabin make a last-stand spot. Sliding gates can be closed or breached | (164,−131) |
| **Entry road kill-zone** | A straight 80 m road lined with buses, barricades and grass beds. Promenade on one side, walkway and shelters on the other | x 83…164, z −124 |
| **East plaza + globe** | An open paved arena with planters, a ramp (high ground) and the PES skybridge overhead | x 85…115, z −150…−128 |
| **MRD grand steps + scaffolding** | Wide stairs as high ground; scaffolding is a climbable vertical route and a sniper nest | (72,−148) |
| **GJBC drive-through** | A long covered road under the north wing. A tunnel chokepoint with bad light | x 20…82, z −118 |
| **Covered plaza** | Roofed, pillared, open on two sides. The pergola edge overlooks the road (drop-down/ambush) | x 20…55, z −117…−95 |
| **The Quad** | A 35 × 80 m open arena ringed by colonnades. Players can kite zombies around the columns. Horde-wave arena | x 20…55, z −95…−15 |
| **B-Block skybridges** | Elevated corridors across the street; sniper platform above PES Univ Rd | x −40 / −22, z −112…−101 |
| **Law terrace** | A long elevated balcony overlooking the promenade and lawn, reached by one granite stair (chokepoint) | x 88…94, z −10…40, +8 m |
| **East promenade** | A long straight lane between the building and an open lawn. A flanking route | x 90…102, z −118…45 |
| **East lawn + corten wall** | A wide-open field. A later-wave breach point is the corten boundary (zombies climb over from the apartments) | x 100…155, z −110…−20 |
| **Bike shed / food point** | Small cover clusters and loot spots | (146,−102), (142,−12) |

---

## 7. Proposed simplified game layout (summary)

Everything uses the OSM frame. The builder can simplify polygons to 4–8 vertices.

* **Playable zone:** between the Outer Ring Road service road (NE) and GJBC's south edge (z≈55), from B-Block's
  west road (x≈−65) to the east boundary (x≈155) and the gate (x≈180). The ORR itself lies beyond the NE wall.
  It is the zombie spawn strip, running from (3,−250) to (200,−144) and on to (328,−82) (direction ≈(0.88, 0.47)).
* **GJBC:** extrude the OSM outline to 22 m. Cut out the Quad (open) and the covered plaza (open at ground, roof
  slab at 13 m). Raise the NW library block to 42 m, the east wing to 26 m, and lower the south hall to 16 m.
  Add the Law terrace (a slab at +8 m along the SE of the east facade) and the NE porte-cochère.
* **Old blocks:** B-Block 50 m, MRD 24 m, F-Block 28 m (tower 34 m). Mural building 14 m. Sheds 3.5–4 m.
* **Roads:** entry road 12 m. PES Univ Rd (west part) 8 m, running just outside GJBC's north edge; model the
  drive-through as the north wing overhanging it on columns. MRD loop road 6 m, B/MRD link 6 m, B-Block west
  road 6 m, ORR service road 8 m.
* **Paths:** PES Lawn promenade 6 m; east promenade 9 m; entry-road south walkway 3.5 m.
* **Green:** PES Lawn, frangipani garden, east lawn, OAT trees, terraced garden.

### 7.1 Layout JSON (paste into `src/world/…`)

Conventions: `poly` = array of `[x, z]` (metres, +X east, +Z south, origin = GJBC centroid). Heights in metres.
`conf` = H/M/L confidence. `style` ids are described in §3 and in the `styles` block.

```json
{
  "frame": {
    "units": "m",
    "axes": "+X east, +Z south, Y up",
    "origin": "centroid of OSM 'Golden Jubilee Block (GJBC)' outline",
    "originLatLon": [12.933977, 77.534549]
  },
  "playArea": [[-68, -205], [-4, -212], [70, -200], [178, -143], [186, -118], [158, -104], [158, -20], [132, 62], [100, 70], [20, 62], [-68, 62]],
  "zombieSpawns": [
    {"id": "orr_nw", "pos": [30, -236], "note": "ORR near the B-Block end"},
    {"id": "orr_mid", "pos": [110, -200]},
    {"id": "orr_gate", "pos": [205, -148], "note": "the main horde lane comes in through the gate"},
    {"id": "east_apartments", "pos": [175, -60], "note": "later waves climb the corten wall"},
    {"id": "west_construction", "pos": [-100, -60], "note": "later waves: construction site west of GJBC"}
  ],
  "styles": {
    "gjbc_modern": {"wall": "#E8E1D3", "glass": "#3E4A55", "fascia": "#44484E", "column": "#EDE7DA", "plinth": "#9C9C9A", "note": "2-storey slender colonnade base; alternating cream panel bands + dark ribbon windows; recessed glass top floor"},
    "gjbc_quad": {"column": "#D8D8D4", "columnBase": "#3A3C3E", "wall": "#E9E2D2", "glass": "#5E7384", "banner": "#2D59A8", "floor": "#C4C5C2", "floorBand": "#3E4143"},
    "gjbc_library_tower": {"wall": "#EFEDE7", "glass": "#2F3A44", "note": "white plaster, horizontal punched strip windows, projecting glass bays, ~10 floors"},
    "gjbc_covered_plaza": {"soffit": "#8B4A2B", "beam": "#6E7F8E", "column": "#D9A441", "wall": "#4A4F55", "lampWhite": "#F2EEE6", "lampTan": "#B07A45"},
    "porte_cochere": {"frame": "#7F4432", "planterBand": "#55595E", "planting": "#B9C44A"},
    "b_block_beige": {"wall": "#D9CBB6", "base": "#A89484", "tower": "#C2AE93", "window": "#2F3A40", "floorHeight": 3.6},
    "mrd_refurb": {"stone": "#C8B89E", "curtainWall": "#D8E3E8", "canopy": "#1F2B45", "mullion": "#4F6D8C", "oldWall": "#EFE7D6", "oldAccent": "#9C5A45", "forecourt": "#5F7468", "scaffold": true},
    "f_block_terracotta": {"tower": "#B45A45", "towerPanel": "#E3D2B0", "wing": "#E6D8BC", "corridorShadow": "#3B3531", "floorHeight": 3.5},
    "gate_white": {"wall": "#F4F4F2", "text": "#8C1D2C", "logo": "#E8622A", "gateSteel": "#3A3D40"},
    "mural_building": {"wall": "#F2F1EE", "muralOuter": ["#E2B24A", "#5E8F3A", "#2E8C8C", "#C8452E"], "muralInner": ["#4A90C8", "#9CC7E8", "#1F2B45", "#C8342E", "#8A8A8A"]},
    "service_shed": {"wall": "#F1F1EE", "roof": "#D9DADB"},
    "old_cream_generic": {"wall": "#EFE7D6", "window": "#394249"},
    "residential_colourful": {"palette": ["#F2F2EE", "#E9D38C", "#5FC18E", "#9CCFE0", "#E39A7E"], "roofTanks": "#1C1C1C"},
    "granite_wall": {"stone": "#8D8A83", "mortar": "#B7B2A6"},
    "corten_wall": {"corten": "#7A3B22", "greenPanel": "#2F4A2E", "lowWall": "#EDEDEA"}
  },
  "buildings": [
    {
      "id": "gjbc", "name": "Golden Jubilee Block (GJBC)", "style": "gjbc_modern", "conf": "H",
      "poly": [[-60, -99], [9, -108], [82, -123], [94, 38], [86, 47], [78, 52], [58, 40], [20, 39], [18, 16], [-13, 18], [-43, 20], [-55, 20], [-56, 17], [-56, -5], [-60, -99]],
      "height": 22, "floors": 5, "floorHeight": 4.4,
      "voids": [
        {"id": "quad", "poly": [[20, -95], [55, -95], [55, -15], [20, -15]], "type": "open_courtyard", "style": "gjbc_quad", "conf": "M",
         "colonnade": {"sides": ["west", "east"], "columnSize": 0.9, "spacing": 4.5, "height": 9, "depth": 4}},
        {"id": "covered_plaza", "poly": [[20, -110.3], [55, -117.5], [55, -95], [20, -95]], "type": "roofed_open", "roofHeight": 13, "style": "gjbc_covered_plaza", "conf": "M",
         "openSides": ["north (steel pergola + planter parapet over PES Univ Rd)", "south (into quad)"]}
      ],
      "heightZones": [
        {"id": "gjbc_nw_library", "poly": [[-60, -99], [-8, -105.5], [-8, -52], [-57.5, -50]], "height": 42, "floors": 10, "style": "gjbc_library_tower", "conf": "M"},
        {"id": "gjbc_east_wing", "poly": [[57, -117.9], [82, -123], [92.7, 20], [57, 20]], "height": 26, "floors": 6, "conf": "M"},
        {"id": "gjbc_south_hall", "poly": [[20, -10], [57, -10], [57, 20], [92.7, 20], [94, 38], [86, 47], [78, 52], [58, 40], [20, 39]], "height": 16, "floors": 3, "roof": "long skylight strips (Electrical block hall)", "conf": "L"}
      ],
      "features": [
        {"id": "porte_cochere", "type": "portal", "style": "porte_cochere", "pos": [84, -114], "width": 14, "height": 9, "facing": "east", "conf": "M"},
        {"id": "east_entrance", "type": "entrance_steps", "pos": [88, -80], "facing": "east", "width": 10, "steps": 7, "conf": "M"},
        {"id": "north_overhang", "type": "overhang_on_columns", "note": "north wing upper floors overhang PES Univ Rd from x 20 to 82 (drive-through), clear height 5.5 m, columns along north kerb every 8 m", "fromX": 20, "toX": 82, "depth": 12, "conf": "L"},
        {"id": "law_terrace", "type": "terrace", "poly": [[86.5, -10], [93, -10], [94.5, 38], [88, 38]], "elevation": 8, "parapet": 1.1, "colonnade": true, "stair": {"pos": [91, 5], "width": 3, "down": "east to promenade"}, "conf": "M"},
        {"id": "cafeteria_glass", "type": "glass_frontage", "fromZ": -10, "toZ": 20, "side": "east", "note": "full-height glass at ground under the law terrace", "conf": "M"},
        {"id": "roof_parapet", "type": "parapet", "height": 1.2}
      ]
    },
    {"id": "b_block", "name": "B-Block (CSE)", "style": "b_block_beige", "conf": "H",
     "poly": [[-55, -177], [-41, -178], [-42, -195], [-13, -197], [-11, -171], [-8, -114], [-51, -111]],
     "height": 50, "floors": 14, "floorHeight": 3.6,
     "heightZones": [{"id": "crest_tower", "poly": [[-20, -125], [-9, -125], [-9.6, -140], [-20, -140]], "height": 57, "roofSign": {"text": "ಪಿಇಎಸ್ + PES logo", "facing": "east", "size": [9, 3]}, "conf": "L"}]},
    {"id": "mrd_block", "name": "Prof. MRD Block (Dr. M.R. Doreswamy Silver Jubilee Complex)", "style": "mrd_refurb", "conf": "H",
     "poly": [[2, -180], [9, -182], [21, -187], [30, -188], [35, -181], [59, -170], [63, -176], [74, -180], [81, -164], [74, -162], [67, -150], [60, -139], [59, -136], [68, -136], [67, -132], [45, -126], [41, -138], [44, -141], [38, -144], [15, -154], [10, -152], [9, -157], [3, -168]],
     "height": 24, "floors": 6, "floorHeight": 4.0,
     "features": [
       {"id": "mrd_east_entrance", "type": "grand_steps", "from": [78, -145], "to": [67, -150], "width": 20, "steps": 13, "canopy": {"color": "#1F2B45", "text": "DR. M.R. DORESWAMY SILVER JUBILEE COMPLEX"}, "conf": "M"},
       {"id": "scaffold", "type": "scaffolding", "faces": ["east", "south-east"], "note": "steel tube + bamboo, green nets"}
     ]},
    {"id": "open_air_theatre", "name": "Open Air Theatre", "style": "old_cream_generic", "conf": "H",
     "poly": [[4, -120], [4, -150], [12, -150], [21, -146], [28, -139], [32, -124], [10, -121]],
     "height": 0, "type": "stepped_seating", "tiers": 8, "tierHeight": 0.4, "tierColors": ["#E94B3C", "#F2C200", "#2D9CDB", "#27AE60"]},
    {"id": "f_block", "name": "F-Block (Panini Block)", "style": "f_block_terracotta", "conf": "H",
     "poly": [[75, 70], [107, 56], [111, 54], [102, 10], [118, 7], [127, 61], [83, 84]],
     "height": 28, "floors": 8, "floorHeight": 3.5,
     "heightZones": [{"id": "f_tower", "poly": [[108, 44], [124, 42], [127, 61], [111, 54]], "height": 34, "roofSign": {"text": "PES", "facing": "north"}, "conf": "L"}]},
    {"id": "mural_building", "name": "Admission Enquiry / gate mural building", "style": "mural_building", "conf": "H",
     "poly": [[156, -120], [184, -120.5], [184, -107], [156, -107]], "height": 14, "floors": 4,
     "murals": [{"face": "east", "theme": "tree with birds, 'Community Development', protruding wooden cubes"}, {"face": "west", "theme": "blue pixel tiles, compass rose, graduates in gowns"}]},
    {"id": "gate_annex_strip", "name": "gate annex / wall strip", "style": "service_shed", "conf": "M",
     "poly": [[184, -120.5], [214, -122], [214, -117], [184, -116]], "height": 4},
    {"id": "food_point", "name": "South Thindies (Food Point)", "style": "service_shed", "conf": "H",
     "poly": [[133, -22], [151, -22], [151, -2], [143, -2], [143, -6], [134, -6]], "height": 4.5, "roof": "curved metal, white"},
    {"id": "hpc_lab", "name": "High Performance Computing Lab", "style": "old_cream_generic", "conf": "H",
     "poly": [[123, -1], [151, -2], [150, 10], [124, 10]], "height": 8, "floors": 2},
    {"id": "g_block", "name": "G-Block", "style": "old_cream_generic", "conf": "H",
     "poly": [[-67, 33], [-48, 32], [-46, 61], [-65, 62]], "height": 18, "floors": 5, "note": "not in video; generic"},
    {"id": "gjbc_sw_shelter", "name": "shelter (OSM)", "style": "service_shed", "conf": "H",
     "poly": [[-55, -4], [-31, -5], [-31, 15], [-54, 19]], "height": 5},
    {"id": "bike_shed", "name": "bike parking canopy", "style": "service_shed", "conf": "L",
     "poly": [[137, -108], [155, -108], [155, -97], [137, -97]], "height": 3.5, "type": "open_canopy"},
    {"id": "walkway_shelter", "name": "steel mesh shelter near gate", "style": "service_shed", "conf": "L",
     "poly": [[146, -116], [158, -116], [158, -110], [146, -110]], "height": 3.2, "type": "open_canopy"},
    {"id": "security_cabin", "name": "gate security cabin", "style": "gate_white", "conf": "L",
     "poly": [[167, -140], [170, -140], [170, -137], [167, -137]], "height": 2.8, "door": "#2D59A8"}
  ],
  "skybridges": [
    {"id": "sb_pes_sign", "from": [55, -117.5], "to": [55, -129], "deck": 8, "width": 5, "height": 3.5, "style": "steel_glass",
     "sign": {"face": "east", "size": [18, 3.5], "text": "PES UNIVERSITY", "logo": "#E8622A", "textColor": "#1F2B45", "bg": "#FFFFFF"}, "conf": "M-L"},
    {"id": "sb_b_low", "from": [-40, -101], "to": [-40, -112], "deck": 14, "width": 3, "height": 3.5, "style": "warren_truss_dark", "conf": "M"},
    {"id": "sb_b_high", "from": [-22, -103.5], "to": [-22, -113], "deck": 32, "width": 3, "height": 3.5, "style": "warren_truss_dark", "conf": "M"}
  ],
  "gate": {
    "center": [176, -131], "facing": "east", "conf": "H",
    "portal": {"southPillar": {"pos": [176, -120], "size": [4, 4], "height": 10.6, "text": "PES UNIVERSITY (vertical, maroon)"},
               "northPillar": {"pos": [176, -143], "size": [3.5, 3.5], "height": 10.6, "banner": true},
               "beam": {"bottom": 8.0, "top": 10.6, "thickness": 4, "textEast": "PES logo + ಪಿಇಎಸ್ ವಿಶ್ವವಿದ್ಯಾಲಯ", "wordmark": "PESU"}},
    "leaves": [{"lane": "in", "centerZ": -127, "width": 7}, {"lane": "out", "centerZ": -136, "width": 7}],
    "leafHeight": 2.2, "leafColor": "#3A3D40", "medianIsland": {"centerZ": -131.5, "width": 1.5, "length": 8},
    "extras": ["yellow folding barricades x4 outside", "red/white boom barrier inside south lane", "security cabin"]
  },
  "roads": [
    {"id": "orr_nw_carriageway", "name": "Outer Ring Road (NW-bound)", "pts": [[328, -82], [269, -117], [200, -144], [93, -201], [61, -218], [42, -228], [16, -242], [3, -250]], "width": 11, "surface": "asphalt", "outOfBounds": true},
    {"id": "orr_se_carriageway", "name": "Outer Ring Road (SE-bound)", "pts": [[46, -238], [107, -206], [161, -177], [180, -167], [204, -154], [269, -117], [328, -82]], "width": 11, "surface": "asphalt", "outOfBounds": true},
    {"id": "orr_service", "name": "ORR service road (metro works)", "pts": [[196, -135], [76, -198], [40, -217], [19, -229], [-4, -242]], "width": 8, "surface": "asphalt_dusty", "props": "green-mesh metro barriers, pipes, JCB"},
    {"id": "gate_link", "name": "gate to service road", "pts": [[176, -131], [190, -128], [196, -135]], "width": 12, "surface": "asphalt"},
    {"id": "entry_road", "name": "PES University Rd (entry)", "pts": [[176, -128], [156, -126], [96, -124], [83, -123]], "width": 12, "surface": "asphalt", "kerb": "black_white", "note": "two one-way carriageways"},
    {"id": "pes_univ_rd_west", "name": "PES University Rd (along GJBC north, under overhang)", "pts": [[83, -123], [72, -122], [38, -117], [11, -112], [0, -111], [-60, -105], [-191, -108]], "width": 8, "surface": "asphalt", "kerb": "black_white"},
    {"id": "mrd_loop", "name": "MRD loop road", "pts": [[72, -122], [72, -133], [78, -145], [80, -149], [92, -172], [80, -179], [67, -186], [40, -200], [25, -204], [9, -206], [-4, -204]], "width": 6, "surface": "asphalt", "kerb": "black_white"},
    {"id": "b_mrd_link", "name": "road between B-Block and MRD", "pts": [[-4, -204], [0, -111]], "width": 6, "surface": "asphalt"},
    {"id": "b_west_road", "name": "road west of B-Block", "pts": [[-60, -105], [-61, -116], [-61, -153], [-57, -178], [-49, -197], [-38, -199], [-4, -204]], "width": 6, "surface": "asphalt"},
    {"id": "lawn_service", "name": "lawn service lane", "pts": [[156, -123], [155, -118], [152, -112], [129, -111], [132, -76]], "width": 5, "surface": "asphalt"},
    {"id": "south_service", "name": "service road south of GJBC", "pts": [[102, 45], [98, 48], [88, 54], [74, 61], [67, 53], [57, 47], [45, 44], [30, 43], [21, 44]], "width": 6, "surface": "asphalt"},
    {"id": "west_service", "name": "service road SW of GJBC", "pts": [[-124, -38], [-99, -17], [-91, -4], [-81, 24], [-56, 22], [-43, 21], [-14, 19], [0, 18]], "width": 6, "surface": "asphalt"}
  ],
  "paths": [
    {"id": "pes_lawn_promenade", "pts": [[168, -136], [130, -135], [100, -136], [90, -136]], "width": 6, "surface": "pavers_striped_buff_grey", "edges": "granite kerb + fountain-grass beds 3 m each side, granite block benches every 15 m", "conf": "M"},
    {"id": "entry_south_walkway", "pts": [[175, -121], [156, -121], [151, -119], [148, -117], [118, -115], [92, -114], [88, -117], [83, -121]], "width": 3.5, "surface": "pavers_striped_buff_grey", "edges": "fountain-grass bed to road, raised planter wall on the other side", "conf": "H"},
    {"id": "east_promenade", "pts": [[90, -118], [95, -60], [101, 20], [102, 45]], "width": 9, "surface": "pavers_grey_two_tone", "note": "pedestrian; buses reach the north end; lamp posts every 20 m on lawn side", "conf": "H"},
    {"id": "east_ramp", "pts": [[100, -132], [74, -132]], "width": 6, "rise": [0, 3.5], "surface": "pavers_striped_buff_grey", "parapet": {"height": 1.1, "color": "#55595E"}, "note": "rises W to a landing under sb_pes_sign; its real alignment vs the MRD loop road is uncertain, so end it at a landing + short stair", "conf": "L"},
    {"id": "oat_footway", "pts": [[38, -117], [37, -123], [35, -130], [34, -137], [35, -141], [38, -144]], "width": 2.5, "surface": "pavers_grey"},
    {"id": "lawn_diagonal", "pts": [[102, -40], [125, -55], [150, -60]], "width": 3, "surface": "pavers_grey", "conf": "L"}
  ],
  "plazas": [
    {"id": "east_plaza", "poly": [[88, -150], [114, -150], [114, -130], [88, -130]], "surface": "pavers_striped_buff_grey", "features": ["trench drain across at z -131", "raised planters with frangipani", "wide granite stair up N at x 95..110 (to a white pavilion, L)"], "conf": "M"},
    {"id": "gjbc_east_forecourt", "poly": [[83, -122], [104, -122], [104, -95], [87, -95]], "surface": "pavers_grey_two_tone", "note": "bus drop-off", "conf": "M"},
    {"id": "mrd_forecourt", "poly": [[60, -156], [70, -152], [67, -143], [58, -146]], "surface": "green_marble", "conf": "M"},
    {"id": "terraced_garden", "poly": [[60, 44], [95, 42], [99, 50], [76, 66], [62, 58]], "surface": "granite_terraces", "features": ["3-4 stepped planter tiers, 0.6 m each", "palms", "granite benches"], "conf": "L"},
    {"id": "pie_r_cube", "poly": [[-10, 21], [18, 21], [18, 45], [3, 49], [-6, 49]], "surface": "pavers_grey", "features": ["fountain at (13.5, 26.5)"], "note": "not in video", "conf": "H"}
  ],
  "lawns": [
    {"id": "pes_lawn", "poly": [[86, -130], [173, -138], [172, -144], [106, -178], [101, -169], [90, -149], [89, -141]], "conf": "H"},
    {"id": "frangipani_garden", "poly": [[77, -149], [88, -149], [88, -129], [77, -129]], "type": "garden_bed", "conf": "M"},
    {"id": "east_lawn", "poly": [[106, -110], [153, -107], [153, -24], [122, -24], [122, -4], [104, -4]], "note": "Student Lounge + garden merged; young trees; white low wall + corten at east edge", "conf": "H"},
    {"id": "oat_green", "poly": [[32, -124], [45, -126], [41, -138], [34, -142]], "conf": "L"}
  ],
  "walls": [
    {"id": "ne_boundary_granite", "pts": [[178, -143], [172, -147], [106, -181], [76, -197], [40, -215], [-4, -238]], "height": 2.4, "style": "granite_wall", "note": "last ~25 m next to the gate is white plaster", "conf": "M"},
    {"id": "east_boundary_corten", "pts": [[155, -106], [155, -24]], "height": 3.2, "style": "corten_wall", "lowWallInFront": {"offset": 3, "height": 1.2, "segments": [[-95, -80], [-60, -40]]}, "conf": "M"},
    {"id": "gate_south_compound", "pts": [[184, -107], [184, -100], [157, -100]], "height": 2.4, "style": "granite_wall", "conf": "L"}
  ],
  "treeClusters": [
    {"id": "ring_road_boundary", "line": [[102, -176], [172, -145]], "spacing": 9, "species": "peltophorum_yellow", "height": [9, 12], "conf": "M"},
    {"id": "gate_big_trees", "center": [163, -148], "radius": 8, "count": 3, "species": "ficus_raintree", "height": [12, 15], "conf": "M"},
    {"id": "frangipani", "center": [83, -139], "radius": 7, "count": 8, "species": "frangipani", "height": [3, 5], "conf": "M"},
    {"id": "east_plaza_garden", "center": [102, -143], "radius": 8, "count": 5, "species": "mixed_small", "height": [3, 6], "conf": "L"},
    {"id": "pes_lawn_scatter", "center": [135, -155], "radius": 25, "count": 10, "species": "tabebuia_pongamia", "height": [5, 9], "conf": "L"},
    {"id": "entry_walkway_tiered", "line": [[100, -117], [150, -118]], "spacing": 12, "species": "terminalia_mantaly", "height": [5, 7], "conf": "M"},
    {"id": "east_lawn_saplings", "grid": {"min": [108, -100], "max": [150, -30], "step": [14, 12]}, "species": "tabebuia_pongamia_young", "height": [3, 5], "maroonLeafFraction": 0.25, "conf": "H"},
    {"id": "pes_univ_rd_trees", "line": [[-55, -108], [0, -113]], "spacing": 9, "species": "raintree_mature", "height": [10, 14], "conf": "M"},
    {"id": "oat_trees", "center": [22, -135], "radius": 12, "count": 7, "species": "raintree_mature", "height": [10, 14], "conf": "M"},
    {"id": "f_block_palms", "center": [80, 52], "radius": 10, "count": 7, "species": "palm_areca_fishtail", "height": [4, 7], "conf": "L"}
  ],
  "planting": [
    {"id": "grass_beds_entry", "along": "entry_south_walkway", "type": "fountain_grass", "width": 3},
    {"id": "grass_beds_promenade", "along": "pes_lawn_promenade", "type": "fountain_grass", "width": 3},
    {"id": "hedge_gate", "center": [150, -112], "size": [20, 3], "type": "murraya_white_flower"},
    {"id": "pergola_hedge", "along": "covered_plaza north edge", "type": "heliconia_peace_lily"}
  ],
  "props": [
    {"type": "pes_globe", "pos": [84, -140], "plinth": {"height": 1.2, "color": "#4E5A55"}},
    {"type": "reading_statue", "pos": [104, -45]},
    {"type": "bmtc_bus", "variant": "pes_college_bus", "positions": [[110, -119, 90], [128, -119, 90], [92, -104, 0], [-30, -108, 90]], "note": "yaw deg; 0 = facing +Z"},
    {"type": "folding_barricade", "positions": [[182, -126], [182, -128], [182, -134], [182, -137], [168, -124]]},
    {"type": "bike", "cluster": {"center": [146, -102], "count": 14}},
    {"type": "bike", "cluster": {"center": [120, -121], "count": 10}},
    {"type": "street_lamp", "along": ["east_promenade", "pes_lawn_promenade", "entry_south_walkway"], "spacing": 20},
    {"type": "bench", "variant": "granite_block", "along": ["pes_lawn_promenade", "east_promenade"], "spacing": 15},
    {"type": "planter_cube_black", "along": "quad colonnade edges", "spacing": 5},
    {"type": "metro_barrier", "along": "orr_service", "spacing": 2.5},
    {"type": "scaffolding", "target": "mrd_block east + south-east faces"},
    {"type": "ambulance", "pos": [30, -118, 90], "note": "optional; seen parked on PES Univ Rd"},
    {"type": "cone_lamp_cluster", "positions": [[30, -105], [45, -105]], "hang": [4, 7]}
  ]
}
```

---

## 8. Open questions / low-confidence items (for the builder)

* **Levels:** the real campus has grade changes. The covered-plaza pergola looks *down* onto PES Univ Rd and the
  buses, and the Law terrace is ≈8 m above the promenade. The world is flat for v1, so: keep the Quad and covered
  plaza at y=0, treat the road edge as a planter parapet, and keep the Law terrace as a raised slab reached by
  stairs.
* **GJBC internal split** (wing heights, Quad size and position, library tower) is inferred. The Quad centre
  matches the satellite courtyard label ≈(37,−57). The Quad's N–S orientation comes from the covered plaza sitting
  at its north end (the pergola overlooks PES Univ Rd and B-Block).
* **PES signboard skybridge + ramp:** exact alignment is unknown (see the JSON note).
* **The indoor sports hall's position** inside GJBC is unknown. The satellite hints at the north-centre
  ("Mechanical block + badminton court").
* The terracotta tower = F-Block is M-H confidence. Beige balcony wings behind it may be the boys' hostel.

---

## 9. Key-frame index (`reference/frames/`)

| File | Shows |
|---|---|
| key_0002_intro_walkway_gjbc_ne_bblock | PES Lawn promenade, red ginger beds, GJBC NE, B-Block crest tower |
| key_0020_main_gate_outside_mural | **Gate from outside**: portal, maroon vertical text, Kannada beam, sliding gates, mural relief |
| key_0022_entry_road_view_from_gate | Entry road from just inside the gate: black/white kerbs, barricades, GJBC + skybridge far |
| key_0024_pes_globe_closeup | **Gold PES globe** detail |
| key_0034_bblock_tower_skybridge | B-Block beige tower + skybridge to the white GJBC NW block |
| key_0050_law_terrace_over_terraced_garden | F-Block terracotta + beige wings from the Law terrace |
| key_0141_lawn_walkway_west_gjbc_ne | Promenade paving, granite benches, grass beds; GJBC north facade across the road |
| key_0152_fblock_caption_gjbc_ne | Same walkway: porte-cochère, PES skybridge, MRD scaffold (caption "*F BLOCK") |
| key_0208_ramp_under_pes_skybridge | **Ramp with grey parapets**, trench drain, PES skybridge, globe, MRD scaffold |
| key_0216_plaza_globe_mrd_scaffold | East plaza, grand stair on the right, globe |
| key_0230_garden_pes_skybridge_mrd | Garden beds, PES skybridge close, MRD SE wing in scaffolding |
| key_0256_frangipani_garden_gjbc_ne | Frangipani + purple Tradescantia garden |
| key_0306_road_to_mrd_front | MRD loop road, MRD refurbished facade |
| key_0316_mrd_front_steps | **MRD grand steps**, navy canopy, scaffolding, old wing left |
| key_0332_mrd_entrance_canopy_sign | "DR. M.R. DORESWAMY SILVER JUBILEE COMPLEX", green marble forecourt |
| key_0401_mrd_forecourt_view_to_lawn | From MRD looking E: globe garden across the road, black/white kerbs |
| key_0449_mrd_atrium_red_chairs | MRD atrium: navy columns, yellow walls, red chairs |
| key_0530_entry_road_to_gate_inside | Entry road looking E to the portal, parked bus |
| key_0532_gjbc_east_plaza_bus_fblock | GJBC east forecourt, bus, colonnade, F-Block tower far S |
| key_0538_gjbc_ne_porte_cochere | **Porte-cochère**: terracotta frame, planter band, PES banner |
| key_0540_gjbc_drive_through_underpass | **Drive-through** under GJBC north wing, skybridge at far end |
| key_0546_gjbc_colonnade_entrance | GJBC east colonnade + entrance portal |
| key_0552_gjbc_entrance_granite_steps | Speckled granite steps, glass doors |
| key_0636_gjbc_north_arcade_view_oat | GJBC north ground colonnade looking N: road, OAT seating, trees |
| key_0724_admission_counters_hall | Admission counters, timber ceiling |
| key_0744_indoor_sports_hall | **Indoor sports hall** |
| key_0940_gjbc_lobby_mural | Lobby with metal mural, granite floor pattern |
| key_1000_covered_plaza_pergola | **Covered plaza**: wood soffit, grey pergola, desks |
| key_1020_peoples_education_society_entrance | "PEOPLES EDUCATION SOCIETY" entrance, yellow-wood columns |
| key_1034_pergola_terrace_north | Pergola edge, hedge, B-Block beyond |
| key_1100_covered_plaza_cone_lamps | Cone-lamp clusters, view into the Quad |
| key_1136_quad_from_covered_plaza | **Quad** seen from under the covered plaza |
| key_1150_quad_colonnade_full | **Quad full view**: colonnades, floor pattern, planters |
| key_1156_quad_colonnade_banners | Colonnade with blue banners |
| key_1210_yellow_column_hall | Yellow-column hall, coffered ceiling |
| key_1332_bblock_facade_skybridge | B-Block facade close, skybridge |
| key_1352_skybridges_gjbc_bblock_street | **Two skybridges** over PES Univ Rd (GJBC left, B-Block right) |
| key_1406_bblock_stone_tower_skybridges | B-Block crest/stone tower + skybridges |
| key_1500_law_colonnade_terrace_view | Law terrace colonnade, parapet, view E |
| key_1506_east_promenade_from_terrace | **East promenade + lawn** from above; corten wall; apartments |
| key_1512_fblock_terraced_garden | Terraced garden, F-Block terracotta |
| key_1534_fblock_courtyard_wings | F-Block tower + beige banded wings |
| key_1556_food_point_shed_residential | Food-point curved-roof shed, white apartment block, construction sand |
| key_1614_faculty_of_law_entrance | Faculty of Law entrance portal |
| key_1636_gjbc_cafeteria | GJBC cafeteria interior |
| key_1654_lawn_corten_boundary | East lawn, lamp posts, corten + white low wall |
| key_1730_promenade_north_from_stairs | Promenade looking N, fins + glass, bus far |
| key_1736_law_terrace_stairs_fblock | Granite stair between cream walls, F-Block behind |
| key_1756_promenade_south_fblock | Promenade looking S toward F-Block |
| key_1808_student_lounge_lawn_trees | East lawn saplings, maroon-leaf tree, corten wall |
| key_1812_corten_boundary_wall | Corten + green panel boundary close-up |
| key_1826_reading_student_statue | Bronze reading-student statue |
| key_1902_college_bus | PES college bus livery |
| key_1912_entry_road_skybridge_from_east | Porte-cochère + long grey ramp + PES skybridge from the E |
| key_1920_main_gate_inside_view | Walkway to the gate, steel shelter, portal from inside |
| key_1922_bike_parking_shed | Bike parking canopy, F-Block + GJBC behind |
| key_1928_view_west_hedge_gjbc_bblock | Skyline W: GJBC, PES skybridge, B-Block |
| key_1946_gate_compass_mural_building | **Inner mural** (compass + graduates), granite wall, portal |
| key_1952_entry_road_from_gate_inside | Entry road W from the gate |

---

## 10. Campus-wide layout review (2026-09-25)

A second pass over everything outside the buildings, comparing matching in-game viewpoints with the frames on
every pass. Before/after screenshots: `media/shots/campus/` (gitignored).

**New sources**

| Source | Where | Use |
|---|---|---|
| Google satellite tiles, z19–z21 (stitched and georeferenced to this frame by `.claude`-local tooling) | `reference/frames/campus/gsat_{gate,gate21,plaza21,east,west,nw,south}.jpg` + `.json` extents | Positions of the gate portal, the mural tower, the entry-road band, the PES Lawn canopy and paths |
| User's Google Maps screenshot | `reference/sat_user_parking_gmaps.webp` (a jpg copy is in `reference/frames/campus/`) | Gate pin at x ≈ 157–163 (scale from GJBC's east face and the parking) |
| GJB tour 0:00–0:36, 1:36–2:08 (`reference/frames/gjb/sheets`) | existing | The walk from outside the gate through the south-pillar door; the pool opposite MRD |
| 2026 tour sheets 1:04, 2:08, 2:40 and `mrd26_*` | existing | Promenade planting, the east-plaza stair, the frangipani garden, the loop-road kerb planting |
| "PES University CAMPUS TOUR 2021 Part 1" (`5bxHqmfj7bE`), "Quick campus tour" (`9sKwG8IcfE0`, 2021 drone at dusk) | `reference/video/campus_*.mp4`, frames in `reference/frames/campus/<id>/` | Construction-era context, the OAT mural stage. Mostly superseded by the 2026 material |
| `soQwdkL9G0w` ("Walking Through PES University", 2026) | sheets only | **Not the Ring Road campus** (EC campus: lake, hospital block). Do not use |
| `WOe504a-pt8` | – | Talking head, no campus footage |
| Wikimedia Commons `Category:PES_University` | `reference/frames/campus/photos/` + `SOURCES.txt` | Pre-2013 "PESIT" era, historical only |

**Findings and what changed in the game**

| Area | Finding | Evidence | Conf. |
|---|---|---|---|
| Main gate | The portal is at **x ≈ 164**, at the west end of the "Admission Enquiry" block. Its south pillar merges with the NE corner of the 4-storey mural tower (satellite roof x ≈ 155–168, z −122…−114). The block's outer (north) face east of the pillar carries the Community Development mural (the key_0020 camera stands beside it); the blue pixel mural wraps the tower's campus-side faces (north face along the walkway and west face). Now `MAIN_GATE_X` in layout.ts; everything gate-relative follows it | satellite N–S portal structure x 160–167; curved white planter wall outside at x 170–178; Google Maps pin; GJB tour 0:02–0:30 | H (x), M (exact z span) |
| Entry road | One undivided carriageway with black/white kerbs, **no lane divider and no scooter rows**. Buses wait at the south kerb | 0022, 0530, 1952, GJB 0:24 | H |
| Entry road band | The satellite band suggests ≈10 m and ≈3 m further south near the gate than the game's road (not changed) | gsat_gate | L |
| South walkway | Fountain grass with maroon / purple-heart clumps between the kerb and the walkway, and on the other side a raised grey concrete trough (charcoal coping) of fountain grass. The mesh shelter is a light white-framed chain-link cage | 1920, GJB 2:02 | H |
| East plaza | Open paving. A ≈6 m granite stair climbs **north** from the plaza between white cheek walls to a raised terrace with a white pavilion; the satellite's paved strip continues north from there as the PES Lawn path. The trench drain runs N–S across the promenade just east of the ramp foot | 0216, sheet 2:08, gsat_plaza21 | M (terrace size and height L) |
| Reflecting pool | A black-granite pool in the garden east of the MRD loop road, facing MRD's steps, with a planted bed between it and the kerb | GJB 1:44–1:52, OSM amenity=fountain | M |
| Globe | Stands on a raised drum in its ring bed beside the white stair tower of the front-ramp landing (the "white wall" in 0216 / 0401) | 0216, 0401, mrd26_0240 | M |
| Loop road east kerb | Dense colourful planting band along the frangipani garden | mrd26_0240 | H |
| PES Lawn | A **garden grove under a near-closed canopy**, not an open lawn. There is no fountain in it (the only mapped fountain is at Pie R Cube, now at its OSM position (13.5, 26.5)) | gsat_gate, gsat_plaza21 | H |
| East lawn | The lawn meets the promenade's lawn-side kerb. Saplings stand in square soil pits. The lamps stand on the lawn side | 1506, 1654, 1808 | H |
| OAT | More mature rain trees on the terrace and in the verge by PES University Rd | 0636, satellite canopy | M |

**Still open**
* The terrain: the garden east of the loop road rises towards the plaza (0401), and the parking is sunk below the
  walkway. The game stays flat there (the parking is being rebuilt separately).
* The exact z extent of the gate portal and whether both lanes run through it (the satellite shows planting inside
  the northern half).
* The OSM `amenity=parking` under trees at x 82–103, z −174…−148, along the loop road, is not modelled.
