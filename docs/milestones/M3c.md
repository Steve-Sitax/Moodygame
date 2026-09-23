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
