# M3c - The city of 1873, 2026-09-23

Why: Steve, 2026-09-23: "I want visuals first and a better city. Use Blender ... Make well known buildings accurate. Make it map accurate. Most focus around the kaaien, Vleeshuis, cathedral, Grote Markt. Make it stunning." Also: take work straight from the person, not only at the board; lamps that go out showed as black boxes; an in-game map with landmarks and job places.

## Sources
| What | Source | Licence | Use |
|---|---|---|---|
| The city plan | "1853/1873: Vuillaume (1/5000)", FelixArchief 12#487, Wikimedia Commons, dated 30 September 1873, 13,404 x 15,851 px | CC0 1.0 | Traced into blocks, public buildings and water (`tools/city/extract.py`). Not stored in git: `data/refs/vuillaume_1873.jpg`, SHA-256 `55f3c7c039dcea733b0b55d18d74dc7f5dadda7149e16efa2ffaf1f9ed27b096`. |
| Landmark outlines, fit points | OpenStreetMap (today's city) | ODbL 1.0, "(c) OpenStreetMap contributors" | Outlines of the cathedral, town hall, Vleeshuis, Steen, St. Paul's, St. Charles Borromeo, St. James. Six of them fit the old map to metres. |

The map shows the city of 1853, copied in 1873. For our area (the quays, the Steen, Vleeshuis, Grote Markt, cathedral) that is the city of 1873: the Spanish walls on it were gone by then, but the river quays were only straightened in 1877-1885. The image Steve sent from Alamy is a stock photo of an old map: not used, not stored.

## What is in
| Part | Where | Notes |
|---|---|---|
| Georeference | `data/refs/georef.json`, `tools/city/extract.py` | Six landmarks that stand today, similarity fit: 0.42 m per map pixel, rms 6 m. |
| World frame | `shared/city.json` `frame` | The world is turned 23.5 degrees so the real Rijnkaai (Quai Tavernier and Quai Sud de l'Ecluse) runs along x with the river at -z, as the game expects. Origin on its river edge. |
| Trace | `tools/city/extract.py` | 198 blocks, 52 public buildings, 14 water bodies (river, Petit Bassin, Grand Bassin, the vlieten). |
| Houses | `tools/city/plan.py` -> `shared/city_build.json` | Each block cut in plots of 5-8.5 m along its streets, 9-14 m deep; 2-5 storeys; gable to the street (stepped, bell or plain) or eaves; brick, cream plaster, grey plaster, dark brick. About 4,700 houses. Which walls face a street (windows, one door) and which are blind. |
| Blender | `tools/blender/build_city.py`, `tools/blender/build_landmarks.py` | Run headless: `blender -b --factory-startup -P tools/blender/build_city.py`. Houses in 100 m chunks, Draco-compressed (`client/public/models/city.glb`, 4.6 MB, 145k faces). Landmarks: `landmarks.glb`. |
| Landmarks | `build_landmarks.py` | Cathedral: west front with portal and great window, north tower to 123 m (square stages, open octagons, spire, cross), the unfinished south tower with its cap, nave, transept, the row of chapel gables, apse with chapels, the baroque crossing lantern. Town hall: long front on the Grote Markt, frontispiece, loggia, hipped roof, dormers. Vleeshuis: striped brick and stone, stepped gables, stair turrets. Het Steen as before the 1889 restoration. Simple models for St. Paul's, St. Charles Borromeo, St. James. |
| Game side | `client/src/world/city.ts`, `cityTextures.ts` | Ground and quay walls from the trace; the houses swap to PS1 materials with a texture atlas (one cell per style and part); walk map `client/public/city/walk.png` (walls, water, outside) drives walking, water and the path check. Chunks beyond the fog are hidden. Landmarks show through fog 2.2 times further. A weak sun that follows time and weather. |
| The Rijnkaai | `world/rijnkaai.ts`, `shared/spots.json` | The invented warehouses are gone. The Hessenatie, the widow Peeters' shop, the Entrepot (Katoennatie work) and the doss house are doors of real houses (`plan.py` DOORS); the job spots follow the doors. The Anna Maria lies off the Quai Tavernier (a round jetty sticks out where she lay). A bridge over the lock of the Petit Bassin. The west sheds are now the Van Metter quay across the canal bridge. |
| Paper map | `client/src/game/map.ts` | M: the traced city north-up in the colours of the old map, landmark names, you, the job's goal, people with work, the board, the doss house, the shops. + and - zoom. |
| Take work from the person | `talk.ts` | W in the talk window lists their open work; a number takes it. |
| Lamps by day | `rijnkaai.ts` | Unlit glass takes the colour of the air instead of black. |
| Dev | `__scheldemist.shot(name)`, `shotFrom(name, from, to, fogFar)`, `POST /api/dev/shot` | Pictures to `data/shots/` for checks without a screen. |

## Rebuild the city
    python tools/city/extract.py      # needs data/refs/vuillaume_1873.jpg
    python tools/city/plan.py         # needs data/osm/antwerp.json (Overpass export, see plan.py)
    node tools/city/inworld.mts       # M7: doors and window holes of the taverns and homes in the world (M7-taverns-homes-inworld.md)
    blender -b --factory-startup -P tools/blender/build_city.py
    blender -b --factory-startup -P tools/blender/build_landmarks.py
Python tools: numpy, opencv-python-headless, shapely, Pillow (dev only, not shipped).

## Checks done (2026-09-23)
- `npm run build` passes; `npm test` 58 of 58.
- Path check in the browser: lists nothing (every spot, person, the board, the doss house door, the mate on deck).
- Browser, by script: city and landmarks load (319 house meshes, 356k triangles, landmark models replace their stand-ins); walked views of the Rijnkaai, the Grote Markt and the town hall, the Vleeshuis; overviews of the cathedral, the Grote Markt and the Rijnkaai; the paper map at two zooms; W at the widow took her job; unlit lamp glass takes the fog colour.
- Steve's save: the browser checks let the game clock run on it; it was put back to the copy taken at 18:00 before the checks.

## Not yet (next steps)
- The cathedral tower needs more lace (more pinnacles, thinner stages); the town hall's front more detail; guild houses on the Grote Markt with their own gables.
- Bridges are land, not decks over water; the canals have no boats; no street lamps in the city beyond the quay.
- Performance: 356k triangles and about 320 draw calls; fine on a desktop, not yet measured on the laptop.

## Pass 2, 2026-09-23 (after Steve played it)
Steve: "Textures are weird. Everything is stuttering. 1 sided walls. Water direct next to building and almost no way to go past. Direct dead from hunger. You did not do the people with Blender. Scale is probably way off, disconnected walkways. Do a thorough pass and use different agents to also create human models, carts."

| Problem | Cause | Fix |
|---|---|---|
| Swirling cobbles | The ground is a few huge triangles; the PS1 affine warp on a 100 m triangle | Ground and quay walls: no snap, no warp (world-space texture). Houses: warp 0.12 instead of 0.5. |
| Stutter | Coarse vertex snap (half the render size) made every edge jump; GPU uploads and shader builds the first time a chunk came into view | Snap grid = the render size. A warm-up after loading sends every chunk to the GPU and builds every shader. Frame time measured with the GPU finished: 1.0-1.4 ms, 13-128 draw calls, 70-90k triangles. The water sheet follows you (32k points instead of 130k). |
| One-sided walls | Faces seen from behind were culled | House, landmark and people materials are double-sided. |
| Water against the houses, no way past | Tracing: a 7x7 close on the water swallowed the narrow quays; the ink outline made blocks fat | 3x3 close only; blocks pulled back 0.5 m (streets 1 m wider); a house may not stick out of its block. Walkable city: 274,000 -> 306,000 m2; the canal quays and both canal bridges are back. Left-over islands are closed courtyards. |
| Scale | Real: fitted on six landmarks, rms 6 m; eye 1.62 m, walk 1.55 m/s. But bricks were 3 times too big (19 cm courses) | Brick courses 9 cm, bricks 23 cm; Vleeshuis bands 60 cm brick, 20 cm stone. Hurry 2.9 -> 3.4 m/s. |
| Starved in minutes | Health -1 every hour at any need 0; the save put back had warmth 1 | Food -1 per 6 h, sleep -1 per 3 h, warmth -1 per 5 h by day and per 3 h at night; health -1 per 3 h at a need 0, +1 per 4 h when all are 4 or more. New games start with food 7, warmth 7. A warning when a need drops to 2 and to 0. |
| Flat roofs | Odd corner plots | Hipped roofs with a cornice. |
| People | Code primitives | Agent: `tools/blender/build_people.py` -> `people.glb`: nine rigged characters (two base bodies, 860-940 triangles, 128 px textures painted by the script), idle, walk, talk, carry, arms folded. `client/src/game/humans.ts`; `people.ts` and `figures.ts` use them. |
| Carts | Code primitives | Agent: `tools/blender/build_props.py` -> `props.glb`: handcart (empty, loaded), dray (with a horse), wheelbarrow, sack truck, crates, barrels, sacks, rope coil, bollard, gas lamp, crane. `client/src/world/props3d.ts`: `dressCity` sets 65 of them along quays and squares, clear of doors, spots and passages; a loaded handcart and a dray with its horse on the Rijnkaai. |

Rebuild order now: extract.py, plan.py, then build_city.py, build_landmarks.py, build_props.py (it reads the house doors), build_people.py.

Checks: `npm run build` passes, `npm test` 58 of 58, path check lists nothing, pictures in `data/shots/p2_*`, `p3_*`, `people_*`, `props_preview.png`. Steve's save was not touched by these checks.

## Pass 3, 2026-09-23
Steve: many issues with the buildings (pictures: blank walls, a paper-thin house, lone towers on the quay), "does not seem to be correct with the map", "is there an in-game map?", a dev mode to fly without fog, and the camera slips into houses.

| Problem | Cause | Fix |
|---|---|---|
| Blank walls on streets | The street test looked 0.9 m out, but block outlines were smoothed by up to 1.2 m, so the test landed inside the block | Street test against the smoothed outlines themselves: 99% of fronts now face a street. |
| Paper-thin houses | Corner slivers kept as plots | Plots under 3.2 m deep stay part of the inner block. |
| Big windowless masses | The inner block was a blind box and sometimes met a street | The inner block is a house: windows where it meets a street, a hipped roof. |
| Lone towers on the quay | Small sheds got 3-5 storeys | Blocks under 260 m2 get 1-2 storeys. |
| Camera inside houses | Walking tested only the body's centre against the walk map | Walls must stay 0.45 m away (8 points on a ring); the path check grows walls by the same. Water still tests the centre, so the gangway works. |
| Correct with the map? | | Checked: `data/refs/overlay_markt.jpg` lays the planned houses over the 1873 map at the Grote Markt; blocks, streets, town hall and cathedral line up. |
| Dev fly mode | | F9 (dev builds): fly with WASD and the mouse, Space up, C down, Shift fast; no fog, noon light; a readout of x, y, z; F9 again lands you. |
| In-game map | Existed, key M | Named on the start screen now too. |

## Pass 4, 2026-09-24: house doors
Steve (screenshot of a street): the doors were flat dark plank rectangles, some as big as barn doors on ordinary houses; the stone surround was loose square blocks that floated and stuck up above the door like teeth.

| Before | Now (`build_city.py` `door_spec`, `gate_spec`, `door_run`, `doorway`, `loading_door`; cells in `cityTextures.ts` `facadeAtlas`) |
|---|---|
| The door was painted into a whole 3 m bay of the facade texture | A real doorway cut into the plain ground-storey wall, the door 20 cm back in a stone reveal |
| One door picture for every house | Panelled front door (four raised panels, a brass knob and keyhole plate), painted dark green, oxblood, brown or deep blue per house; 0.95 m on narrow fronts, 1.05-1.15 m, a double door (1.5 m) on some fronts of 7.5 m and more |
| No light over the door | A glazed transom under a flat stone lintel (half with a drip moulding), or a round fanlight with a sunburst of glazing bars under a stone arch (some with a keystone) |
| Carriage gate: a 2.7 x 3.5 m plank slab, an arch of seven loose blocks | Poortdeur: two panelled leaves with strap hinges and a wicket door, under a segmental arch; one flush ring of voussoirs from jamb to jamb; sized to the front (at most 2.5 m, less on narrow ones) |
| Storehouses: a plank slab up the whole front, another over the loading gate | Loading gates like the poortdeur (2.7 m) every 9 m; above each a loading door a storey (planks, Z brace, strap hinges) in a stone frame; the hoist beam stays |
| | A stone sill across every front door; the jambs are two or three dressed stones, flush, lying on the wall (no back faces) |

The door stays in the middle of the middle bay, so `build_props.py` (doorways kept clear) and `build_streetlife.py` (doorsteps, numbers) need no rebuild. The doors have their own dice (`seed * 31 + 1873`); the carriage-gate draw is the same as before, so every other house detail (gables, chimneys, dormers) is unchanged. The facade atlas is now 8 x 8 cells (512 px); city.ts `atlas: 8`.

Rebuild (Blender 5.2 on PCX):

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_city.py

Numbers: `city.glb` 805 KB -> 1,410 KB; 31,519 -> 55,327 faces (118,500 triangles for the whole city); no new material, so no new draw calls. `perf(60)` on the test stack after: Rijnkaai 12.0 ms, 258 calls, 371k triangles; the street at (56, 150) 14.4 ms, 259 calls, 439k; Grote Markt 10.9 ms, 385 calls, 448k (before, same spots, with the other sessions' code of that hour: 15.0 ms / 274 / 385k, 14.1 ms / 261 / 427k, 21.6 ms / 438 / 481k; the frame times move with the rest of the tree, the city's share is small). Path check lists nothing.

Pictures: `data/shots/doors_before_house.jpg`, `doors_before_gate.jpg`, `doors_before_street.jpg`; after: `doors_after_house.jpg` (two arched doors, one double), `doors_close_153.jpg`, `doors_close_147.jpg`, `doors_close_140.jpg` (flat lintel and transom), `doors_close_134.jpg`, `doors_after_gate.jpg` (carriage gate), `doors_after_warehouse.jpg`, `doors_after_warehouse_gate.jpg`, `doors_after_hessenatie.jpg`, `doors_after_street.jpg`, `doors_after_row.jpg`.

## Pass 5, 2026-09-25: z-fighting
Steve (screenshot on the Rijnkaai, by the HESSENATIE sign): where a brick house meets a white plaster one, a strip of the white front lies in the plane of the brick front and the two flicker in a stair-step edge. "Do a check for it."

The check: `await __scheldemist.zfight()` in the dev game (`client/src/dev/zfight.ts`). It reads the scene as placed (houses, landmarks, ground, quay walls, street life, quay furniture, clutter, bridges, the lock, stalls, props; instances too; people, boats, carts, cranes, traffic and water left out) and lists every pair of faces with normals within 1 degree that overlap by 0.01 m2 or more: `fights` one plane (within 5 mm, flicker at any distance, must be 0), `thin` a layer within 2 cm of a surface facing the same way, `close` within 5 cm. A pair settled by a polygonOffset, or two see-through decals that write no depth, does not count. Hidden pairs (inside the houses on the walk map, or closed in by what stands in front) are counted apart. Grouped by cause in `byCause`, with x, y, z, area, both objects and the plan's houses. Why thin layers matter: with the PS1 wobble a face's depth moves by up to half a pixel of its slope, about 7 cm at 30 m seen askew; the 24-bit depth itself is good to 0.7 mm there. Options: `list`, `hidden`, `noOffset` / `writeDepth` (see what a material fix settles), `debugAt`. It counts what is switched on at that moment (market stalls only on market days). About 7 s.

| Cause (visible fights, hidden) | Before | After | Fix |
|---|---|---|---|
| House fronts in one plane | 123, 523 | 1, 1 | `plan.py` `trim_rects`: a rect house was built as its plot's rectangle, up to a fifth bigger than the plot where a corner plot took a bite; it ran into the neighbour (the Hessenatie's #90 into the white #89). Now cut back to clear every other house, keeping the street front (192 houses cut, 3 too small became footprint houses with a hipped roof). Spiky footprints repaired (6). |
| Ground storey in one plane | 158, 78 | 0, 7 | same, and the kerbs below |
| Flat tops, copings | 176, 22 | 3, 5 | `build_city.py`: kerbs built in one pass (`build_kerbs`): no back on the wall, neighbours meet without end faces, a kerb that runs into another stops at its front; a side roof no longer puts two chimneys in one place; gable copings stay inside the house |
| Walls back to back | 62, 8,417 | 0, 3,718 | kerb backs gone; railing posts where two runs meet built once |
| Houses + street life (plates, boards, steps) | 61, 1,908; thin 1,181 | 0 | `streetlife.ts` solid material polygonOffset -1/-2 |
| Quay walls + quay furniture | 678 back to back; thin 396 | 0 | `quayfurniture.ts` solid material polygonOffset -1/-2 |
| Quay walls + quay steps | 148, 18 | 0 | `quaysteps.ts` stone polygonOffset -1/-2 |
| Paving zones and edge stones | 113 | 3 | `plan.py` `ground_zones` simplified before the zones are cut from each other; edge stones (`city.ts`) write no depth |
| Rail setts crossing | 88 | 11 | `tracks.ts` band writes no depth |
| All, whole world | 3,314 fights, 4,981 thin, 7,293 close | 1,764, 2,316, 5,940 | |

Left: the houses have 4 small visible pairs (three cornice tops where two cornices of a corner house meet, 0.03 m2 each; a 0.012 m2 sliver at the eaves between #197 and #198). The rest are faces inside other models (quay furniture 379, quay steps 120, the Steen 74, opening bridges and their quay walls 103, trades 112, clutter 127 and clutter items standing on kerbs 74, pontoon 42, cathedral 34, omnibus posts 24, lock 65, stalls 26); their fixes belong in their own build scripts. Close (2-5 cm): keystones 3 cm over their arch ring (523), loading doors 3 cm over the storehouse walls (130). Seen in the pictures: where a front now meets its neighbour exactly, the wobble can open a crack of single pixels on the seam that shows the party wall behind (a dotted light line at the Hessenatie corner, where the wall behind is white plaster); it is the same at every seam between neighbours of different height.

Side effects: the Hessenatie door moved 0.41 m east (`spots.json` hessenatie_door x 10.79 -> 11.2; `server/src/director/hiring.ts` and `server/src/town/places.ts` still say 10.79 / 10.8). The walk map, the ground zones and `city_build.json` changed with the plan; `lively.ts` rounds keep their stops 2.5 m from another round's (two neighbours' doors came that close); `ideas.test.ts` takes any of the seller's wares as the gift.

Rebuild:

    python tools/city/plan.py
    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_city.py
    (then build_streetlife.py, build_props.py, build_quayfurniture.py the same way: they read the house doors)

Checks: `zfight()` as above; `paths()`, `signs()`, `streetEnds()` list nothing; server tests 732 of 732. Pictures (13:00, clear): `data/shots/zfight_before_hessenatie.jpg`, `zfight_before_hessenatie_close.jpg`, `zfight_before_370.jpg`, `zfight_before_101.jpg` and the same names with `after`.

## Pass 6, 2026-09-25: seams and the other models' z-fights
**Seams.** The dotted light line on the seam between two fronts (the Hessenatie corner) was not a crack: the depth render has no hole there. It was the party wall. A house's side wall started exactly on the seam, in the fronts' plane, at the fronts' depth; where the PS1 snap stair-steps the seam's edge, its pixels won the depth test, and the lit plaster side (`facade` is two-sided) showed through, one pixel a step. Fix in `build_city.py` (`side_wall`, `seam_cover`, `FRONT_ENDS`): where a neighbour's front meets a house's front on one line (or a bend under 60 degrees, the neighbour not set back), the side wall (and a flat roof's parapet side) starts 15 cm behind the front, up to the lower of the two houses; above that it runs to the corner as before, since it is seen there. No new geometry, no layers. Measured with a normal-and-depth render (party-wall pixels on the seam line, within 25 cm of its depth) over 30 seams (white next to brick, 6.8 to 15.8 m, 4 to 16 m off, looking up, moving 3 cm a frame): 21,410 of 444,034 seam pixels before, 678 of 440,827 after (97 % fewer); what is left are gate jambs, lamp brackets and flag poles standing by a seam. Pictures: `data/shots/seam_before_*.jpg`, `seam_after_*.jpg` (Hessenatie close and moving, 78,172 mid, 155,172 far, -340,117 close), crops side by side in `seam_before_after_crops.jpg`.

Also in `build_city.py`: keystones 8 cm proud of the arch ring (were 3 cm: 523 close), loading doors 7 cm off the wall, just behind their jambs (were 3 cm: 130 close).

**Other models** (visible fights before, after): quay furniture 505, 8 (`build_quayfurniture.py`: the timber post's bands, the notice board between its posts, the customs booth's walls and roof boards, the harbour hut's floor and roof boards, the cable drum's flanges, the upturned boat's inside); clutter 280, 13 (`build_clutter.py`: no bottoms on things that stand on the stones, a kerb or a wall; the edge kerb's pale top is its top; the city gate's piers stop under the lintel; the barrier's rails without their own post, `barrier_post` stands at every joint); quay steps 120, 0 (`quaysteps.ts`: the parapet's pier stands on the landing, the edge stone starts past it); trades 136, 3 (`build_trades.py`: inside faces of two-sided hulls, roofs and staves 2 to 4 cm in; the basket's floor 1.5 cm up; the punt's sides inside its bottom); opening bridges 193, 0 (`build_bridges.py`: the leaf starts 6 cm off the hinge and a single leaf stops 6 cm short of the far quay, the nose beam carries the deck's end, the fixed deck lies on the quay, no balance tie over the pivot, the ballast in from the beams' ends); the lock 65, 0 (`build_lock.py`: the heel post 5 cm deeper, the balance heel narrower than the post, the mitre posts' tops slope). Whole world: 1,831 visible fights before, 550 after (left: the Steen 100, the Vismarkt stalls 106 and their frames 24, pontoon 52, streetlife 71, omnibus posts 24, the railway gate 27, landmarks, tracks 20, quay walls 30).

Rebuild (any order; city first if the plan changed):

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_city.py
    (and build_quayfurniture.py, build_clutter.py, build_trades.py, build_bridges.py, build_lock.py the same way)
