# M6 - The Vleeshuis in detail, 2026-09-24

Why: Steve, 2026-09-24: "Give Vleeshuis an upgrade, more detail." Same treatment as the cathedral and the Steen: research, its own atlas, shading, checked in the game.

## What the sources say

### Sources (reference only; nothing copied into the game)
- J. Linnig, etching "Het Vleeschhuis", 1849 (Rijksmuseum RP-P-1890-A-15650 and -15651, CC0): the east front and the south side, with the stepped wall dormers at the eaves.
- J. Linnig, drawing of 7 July 1855 (FelixArchief 12#2994, CC0): the same view in colour, with the Madonna and her gilt glory on the south-east tower.
- J.-E. Durand, photographs "Vieilles-Boucheries, Pignon" and "Passage" (Mediatheque de l'architecture et du patrimoine APMH00011275/6, CC BY-SA 4.0), before the restoration: the bands, a corner tower, washing hung out against the south side.
- Heritage inventory, Onroerend Erfgoed 4678 "Vleeshuis" (description and history).
- English Wikipedia "Vleeshuis"; today's photographs on Wikimedia Commons (2007, 2022, 2023) for proportions and details.

### History
| When | What |
|---|---|
| 1501-1504 | Built for the butchers' guild by Herman de Waghemakere the Elder, after his death in 1502 probably finished by his son Domien. Brick fired on site from Rupel clay, white sandstone from Balegem, bluestone for doors and stairs, slate roofs. |
| 1796-1799 | The French abolish the guilds; the hall is sold as national property. 29 former guild members buy it back and trade meat there on a smaller scale; the rest is let (painters' studios: Nicaise De Keyser, Gustave Wappers). |
| 1841 | The butchers sell it to the wine merchant Jean Daniel Peyrot-Van Bommel (owner of "Den Wolsack" next door). He alters it in 1841-43 and uses the hall as a warehouse; a theatre hall (used by the society Liefde en Eendragt) and studios upstairs. |
| **1873** | **Not the butchers' hall any more: Peyrot's wine warehouse, a theatre hall and studios, in poor repair.** |
| 1899 | The city buys it for 300,000 francs. |
| 1900-1922 | Restoration by Alexis Van Mechelen: roofs and dormers renewed (1905), iron vanes, the facades largely refaced (1905-08), the west side dug out to the old Burchtgracht level (1908-10). Jules Weyns's statues of a butcher and a cattle dealer on the east buttress (1912). Museum of applied arts from 1913; since 2006 the music museum. |

### The building (and what we built for 1873)
- **The bands** ("speklagen"): red brick with regular courses of white sandstone. From the photographs about four or five courses of brick to one of stone; we use 0.36 m of brick and 0.12 m of stone (a band every 0.48 m).
- **Plan**: a long rectangle, seven bays of buttresses on each long side, two bays on each gable. A **hexagonal stair turret at each corner**, corbelled out near the top ("uitkragend"), and a **tall octagonal stair tower** out of the south side. All under **kinked slate spires** with iron vanes.
- **Gables**: stepped east and west gables with sandstone copings, small cross windows in rows up the steps. A middle buttress up each gable.
- **Windows**: two storeys. The ground floor (the meat hall) has great **pointed windows with late-Gothic tracery**, all different. The storey above has **cross windows** with a relieving arch and a sandstone frame and jamb stones.
- **Doors**: under **basket arches** in bluestone frames: two on the east front below the great windows, and doors in the long sides.
- **Plinth**: a profiled sandstone plinth, dark and worn at the foot.
- **Roof**: steep slate. In 1849-55 there were **stepped wall dormers at the eaves** and a few small dormers higher up. The "four rows of dormers" of today date from 1905.
- **Not in 1873**: Weyns's statues (1912), the dug-out west cellar front (1908-10), today's clean stone.

## What was built (`tools/blender/build_landmarks.py`, `vleeshuis2`, 5,200 triangles)
- **Its own atlas** (`vleeshuis_atlas`, 256 x 256, 25 px to the metre, painted in `paint_vleeshuis_atlas`): the bands (a 5.12 x 3.84 m wall cell), two great hall windows with different tracery, cross windows (glazed, or with the lower lights shuttered as in a warehouse), small gable windows (glazed or shuttered), a stair slit, the oak doors, the Madonna with her gilt glory, a barred cellar window. The game picks it up by name (`*_atlas`, `world/city.ts`); no client change.
- **Level stripes everywhere**: every wall, buttress, tower face and gable step is tiled with the wall cell, cut at world heights. The window cells paint the same bands round their frames and sit on whole bands, so the stripes run level round the whole building.
- The long sides: seven bays; great pointed windows, cross windows above, cellar grilles in the plinth; stepped buttresses (dark plinth, striped stages, sandstone water tables, the drip course round them); the drip course between the storeys, the eaves cornice.
- The two doors in the long sides as before (same places), now basket-arched doorways 0.9 m deep with bluestone frames, hoods and steps.
- The east front: two basket-arched doors under the great windows, cross windows, the middle buttress with a pinnacle, the stepped gable (nine steps, coped) with small windows. The west gable: the same without doors (great windows and cellar grilles).
- Fourteen stepped wall dormers at the eaves (one a bay, both sides) with their own slate roofs; two rows of small slate dormers; lead on the ridge.
- Four hexagonal corbelled corner turrets (the south-east one bigger and taller, with the Madonna), the octagonal stair tower to 34 m with slit windows up its face; corbel rings, white quoins, cornices, kinked spires, vanes.
- The mesh's vertex shading reaches the game (`use_shading`), with a little per-face weathering and the usual darkening towards the ground.

### Doors (printed by the build)
| Door | World x, z |
|---|---|
| Vleeshuis, main door (south side) | -122.0, 92.4 (unchanged) |
| Vleeshuis, north door | -115.7, 107.1 (unchanged) |
| Vleeshuis, east front, left door | -137.6, 96.3 (new) |
| Vleeshuis, east front, right door | -137.6, 103.4 (new) |

No door moved. The game reads no landmark door positions (the dev menu's "Vleeshuis" go-to is (-122, 84), in the street), so nothing else changed.

## Checks
- **Other landmarks unchanged**: every object in `landmarks.glb` hashed before and after (the compressed geometry, its attributes and materials, and the images). The cathedral, town hall, Steen, Hanseatic House, `cath_atlas` and `steen_atlas` are identical; only `landmark_vleeshuis` changed, and `vleeshuis_atlas` is new. The build is deterministic (an unchanged rebuild hashes the same).
- **Walk map**: unchanged (it comes from the outline, not the model). `__scheldemist.paths()` = `[]`.
- `npm run build` passes.
- In the browser, in my own tab, daylight (`setTimeOfDay(12)`, clear) and fog: the shots below.

## Shots (`data/shots/`)
- Street, clear: `m6_vh_southeast_street`, `m6_vh_southeast_corner` (the Madonna), `m6_vh_east_front`, `m6_vh_south_street`, `m6_vh_door_near`, `m6_vh_north_street`, `m6_vh_west_gable`.
- Far, clear: `m6_vh_far_north_street`, `m6_vh_far_canal`.
- Fog: `m6_vh_fog_southeast`, `m6_vh_fog_north_far`, `m6_vh_fog_east_front`.
- From above, to check: `m6_vh_oblique_air`, `m6_vh_oblique_air_nw`, `m6_vh_inspect_stairtower`, `m6_vh_inspect_east_gable`.
- (`m6_vh_east_far` and `m6_vh_far_vliet` are misses: a house and the drawbridge are in the way.)

## Problems and open points
- **Wobble on the bands**: the game's PS1 vertex snap (the "wobble" setting, a 240 x 135 grid) moves every vertex a few screen pixels, so the level stripes bend a little between tile corners, most at 5-15 m. Bigger wall tiles (5.12 x 3.84 m) halved it. It is the look every building has; the horizontal bands just show it most.
- The orientation follows the outline: the compact map turns the building, so the real east front (on the Vleeshouwersstraat) faces the wide street by the Sint-Pietersvliet (world x -138), and the south side with the stair tower faces the street at z 84.
- The small roof dormers use the cathedral atlas's `dormer` cell and read as small marks from far off.
- The old `vleeshuis` function stays in the file, unused (like `steen3`/`steen4`).
- No interior yet (M6 plan, step 4). The two long-side doorways are real recesses 0.9 m deep, and the east doors 0.6 m deep, if an interior wants them.

## Rerun
    blender -b --factory-startup -P tools/blender/build_landmarks.py
