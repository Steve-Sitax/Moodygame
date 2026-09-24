# M7 - Rendering: leave out what cannot be seen (2026-09-24)

Why: Steve, 2026-09-24: "Do you also render like in real games? Invisible stuff: is it there and not rendered, or do they have clever ways for it? Investigate and implement."

Short answer: before this, the game drew almost everything in front of the camera out to 600 m, even in a 30 m fog, and it drew it three times each frame (the view and two mirrors). Now a culler leaves out what cannot be seen: things past the fog, things behind the houses, and most of the mirrors' extra work. Nothing visible is left out: that was checked pixel by pixel.

## 1. What the game did before (measured)
Test machine: RTX 5090, headless Chrome (ANGLE, Direct3D 11), 1280 x 720 window, the game's 480 x 270 picture. Test save only.

| Part | Before |
|---|---|
| The scene | 945 things drawn or drawable (732 meshes, 112 instanced, 22 skinned, 61 lines, 12 sprites, 6 point clouds), 993 hidden, 4,051 objects with 1,362 bones, 556k triangles, 11 lights. |
| Frustum culling | three.js per object, on bounding spheres. Camera far plane 600 m. 25 objects have it switched off (moving things with untrusted bounds). The start-up warm-up switched it back on for every mesh made before the city loaded (a bug: fixed, each mesh keeps its own setting). |
| Merged meshes | About 25 big merged meshes have spheres of 60 to 870 m (the ground zones, quay walls and steps, rails, ruts, litter, vegetation, the water sheet, the far bank, instanced omnibuses and railway). They are never culled; that is fine, they are one draw each. |
| Fog | By day the fog is fully thick at 30 m, at night 19 m, on a clear day 480 m. Only a few parts hid their far pieces: house chunks (fog + 10 m, `city.ts`), prop chunks (+10), street life (+8), quay furniture, litter, the drays (+15). Everything else was drawn out to 600 m. At the Rijnkaai in fog, 308 of 572 draws were things wholly past the fog. |
| Chunking | Houses in 100 m chunks per material (319 meshes, 145k faces). |
| Instancing, merging | Moored boats and vegetation instanced; crates, barrels and sacks batched; street life, quay furniture and litter merged per chunk. |
| LOD | Only the crowd's animation rate (every frame within 25 m, 15 fps to 45 m, 8 fps beyond). No mesh LOD. |
| Mirrors | Two planar mirrors (`mirror.ts`): the river (320 x 180) and the puddles (480 x 270, as many pixels as the whole view). Each renders the whole scene again: at the Rijnkaai in fog 576 draws for the view and 1,142 for the mirrors; on a clear day 959 + 1,909. The mirror camera's far plane is 160 m, but its oblique near plane skews the far plane, so it does not clip there. |
| CPU per frame (real frames, clear, Rijnkaai) | Rendering 24.5 ms (of which the two mirrors 15.7 ms); world.update 1.1 ms (omnibus 0.27, railway 0.24, traffic 0.23, boats 0.15); jobs 0.2; town 0.12; crowd 0.10; animals 0.10; everything else under 0.1 ms. three.js also updated all 4,051 matrices three times a frame (0.45 ms each). The world's drawing costs far more than the people. |

The biggest waste: in fog, everything past 30 m was drawn, three times. On a clear day in a street, the boats, cranes, stalls and people behind the houses were drawn, three times.

## 2. What real games do (short)
- **Frustum culling by cell or chunk**: test a whole block's box against the view first, then its parts (a tree of boxes). three.js does it per object only.
- **Occlusion culling**:
  - *Precomputed visible sets (PVS)* per cell: at build time, for each cell of the walkable ground, the list of cells and objects that can be seen from it (Quake, many open-world games for cities). Fast at run time, big to store, static only.
  - *Hardware occlusion queries*: draw each chunk's box, ask the GPU how many pixels passed, use the answer a frame later (WebGL2 has `ANY_SAMPLES_PASSED`). Costs a draw per box and pops by a frame when you turn a corner.
  - *Software occluders*: rasterise a few big walls into a small depth buffer on the CPU and test boxes against it (Frostbite, Umbra).
  - *Hierarchical Z*: a depth pyramid on the GPU from last frame, tested in a compute shader (not in WebGL).
  - *Occlusion horizons* for cities seen from the street (Downs, Moller, Sequin, I3D 2001): the city is a height map; from the eye, keep for each thin slice of the view the highest slope a house reaches; a thing under that line is hidden. Cheap, exact for 2.5D, no GPU round trip.
- **Portals and cells** for interiors: a room is drawn only through the openings in view, in the part of the screen they cover (the cathedral helper did this: `world/inworld.ts`).
- **Distance and fog culling, LOD**: past the fog, nothing; far houses and trees as simple meshes or impostors (flat pictures).
- **Batching and instancing**: fewer, bigger draws.
- **GPU-driven culling**: compute shaders cull and build the draw lists (WebGPU, not WebGL).

For a WebGL city seen from the street, with streets like canyons: fog culling, occlusion horizons (the houses are closed boxes up to their eaves, `build_city.py`) and a cheaper mirror fit best. They need no GPU read-back, so nothing pops.

## 3. What was built
| Part | Where | What it does |
|---|---|---|
| Culler | `client/src/world/cull.ts` (new) | Before each frame decides, per thing and per pass (view, puddle mirror, river mirror), what cannot be seen. It never touches `visible`: for the length of the render a hidden thing sits on a layer no camera looks at, and after the frame every layer is put back. It runs as the last hook on the scene's `onBeforeRender` and puts the view's layers back after each mirror (`onAfterRender`), because three.js tests layers again while it draws. |
| Past the fog | `cull.ts` | A thing whose nearest point lies past the fog's far end (plus 3 m and 3 %) is the fog colour and nothing else: left out. Landmarks count 2.2 times further (their `fogReach`). But a fully fogged thing still hides what stands behind it, so it stays when something that shows past the fog is behind it: unfogged lamp glass, additive glows (halos, flames, lit windows), a landmark within its reach, the glow of a lit lamp (the fog shader adds a lamp's glow along each ray up to the surface it meets; plain three.js fog has none). Shader materials count as showing past the fog unless they say how far they show (`userData.fogReach`; the chimney, fire and funnel smoke say it). The gas lamp halos name their per-point lit attribute (`userData.litAttr`): unlit halos do not count. |
| Behind the houses | `client/src/world/occlusion.ts` (new) | Occlusion horizons. The height map comes from the city plan (`shared/city_build.json`, 720 houses, eaves 6.8 to 20 m), 1 m cells, shrunk by a cell so a cell counts only when wholly inside a house. From the eye, 1,024 slices round the circle; for each, the highest slope any house reaches so far. Each sample takes the lowest height in a window as wide as the slice there, so a gap between two houses is never bridged. A thing whose top stays under that line in every slice it covers, and lies behind those houses, is hidden. Margins for the PS1 vertex snap (two snap cells). Only houses the game surely draws count (up to the fog's far end + 8 m: `city.ts` drops house chunks past fog + 10 m). Landmarks, sheds, boats and trees never occlude. The same march tells whether any water can be seen. An early stop: once a slice is steeper than anything up to 130 m could climb, the rest of it is hidden. |
| Mirrors | `cull.ts`, `mirror.ts`, `city.ts` | In a mirror pass, also left out: what lies wholly under the mirror's plane, what is under a quarter of a pixel in its picture, and (puddles) what is behind the houses seen from the mirrored eye (exact while the eye is lower than the lowest eave). The river mirror and the water sheets are not drawn at all when no water can be seen. The puddle mirror is now 320 x 180 like the river's (was 480 x 270). |
| The view through a door | `cull.ts`, `retroPass.ts` | From inside the cathedral the street is drawn only in the door's part of the view (`inworld.ts`). The culler takes that part: things outside it are left out of every pass, the mirrors too (a puddle pixel reads the mirror at about its own place on screen). |
| Cheap per frame | `cull.ts` | A full evaluation holds for any eye within 0.5 m and a turn up to 17 degrees (the houses shrunk and the things grown by that slack), so it is made again only when the eye or view leaves that, the fog, the mirrors or the lit lamps change, or every 30 frames. In between, a hidden thing that moves more than 0.15 m is drawn again. The culler updates the scene's matrices once and the three passes skip theirs. It never throws: on an error it draws the frame whole and logs once. |
| Bounds | `cull.ts` | Its own sphere for instanced meshes (three.js works it out once, moving instances leave it behind), made again when the instances change; a geometry's sphere made again when its positions are rewritten. Objects with `frustumCulled = false` and anything drawn without depth test are never culled. |
| Warm-up | `main.ts` | The culler stands aside for the start-up warm-up (it must upload everything); each mesh gets its own `frustumCulled` back. |
| Dev | `main.ts`, `cull.ts` | Dev menu (Esc, Dev): "Culling on/off", "Occlusion on/off", "Culling view on/off". The view draws the hidden things through the walls in wireframe (red behind the houses, amber past the fog) and a line of numbers at the bottom. `__scheldemist.cull` (`.enabled`, `.occlusion`, `.view`, `.stats`), `__scheldemist.renderer`, `.retro`. The culler is off in the F9 fly mode. |

Not built: LOD or impostors. They do not help here: the GPU needs 2 to 8 ms at 480 x 270 on this machine and triangles are not the limit (draw calls and CPU are). The laptop was not measured.

## 4. The numbers
Test save, 11:00, each spot 15 m back from the place looking at it, the culler off then on in the same session. Draws and triangles: the view + the mirrors, one frame. Render: CPU per real frame for the whole render (view, mirrors, retro pass), averaged over 3 s. FPS: real frames (headless Chrome caps near 144). Culler: its own CPU per frame (included in nothing else; it saves the three matrix updates, about 1.35 ms).

Fog (fully thick at 30 m):
| Spot | Draws off -> on | Triangles off -> on | Render ms off -> on | FPS off -> on | Culler ms |
|---|---|---|---|---|---|
| Rijnkaai | 585+1163 -> 393+773 | 436k+757k -> 407k+567k | 10.4 -> 5.9 | 84 -> 123 | 0.85 |
| Vismarkt | 465+926 -> 356+752 | 397k+677k -> 384k+534k | 9.9 -> 6.8 | 88 -> 108 | 0.90 |
| Grote Markt | 212+422 -> 203+196 | 292k+468k -> 180k+174k | 10.5 -> 3.9 | 81 -> 144 | 0.82 |
| Back street | 453+888 -> 227+505 | 386k+656k -> 340k+445k | 8.8 -> 4.7 | 99 -> 143 | 0.71 |
| Cathedral square | 131+262 -> 131+125 | 247k+382k -> 132k+128k | 5.5 -> 3.2 | 140 -> 144 | 0.84 |
| Petit Bassin | 422+824 -> 252+490 | 377k+637k -> 335k+432k | 8.3 -> 4.6 | 106 -> 144 | 0.70 |
| Inside the cathedral, looking out | 232+1001 -> 167+235 | 286k+652k -> 148k+180k | 8.4 -> 4.7 | 103 -> 140 | 0.80 |

Clear (fog at 480 m, the far view):
| Spot | Draws off -> on | Triangles off -> on | Render ms off -> on | FPS off -> on | Culler ms |
|---|---|---|---|---|---|
| Rijnkaai | 967+1928 -> 870+1798 | 648k+1181k -> 631k+1023k | 16.3 -> 14.8 | 57 -> 59 | 0.66 |
| Vismarkt | 753+1502 -> 631+1391 | 571k+1026k -> 569k+914k | 15.7 -> 14.0 | 58 -> 60 | 0.86 |
| Grote Markt | 267+532 -> 273+534 | 333k+550k -> 337k+435k | 9.1 -> 7.9 | 95 -> 97 | 0.74 |
| Back street | 660+1302 -> 337+951 | 573k+1030k -> 459k+772k | 14.1 -> 10.2 | 65 -> 82 | 0.64 |
| Cathedral square | 213+426 -> 217+427 | 320k+528k -> 322k+410k | 8.5 -> 7.8 | 100 -> 98 | 0.82 |
| Petit Bassin | 520+1020 -> 486+965 | 478k+838k -> 477k+707k | 11.2 -> 10.1 | 80 -> 82 | 0.69 |
| Inside the cathedral, looking out | 372+795 -> 374+568 | 360k+409k -> 362k+325k | 8.6 -> 7.4 | 101 -> 106 | 0.65 |

GPU time (`EXT_disjoint_timer_query_webgl2`, whole frame) stayed 2 to 8 ms and is noisy on this card; it follows the CPU (the GPU waits for draws). The first measurements of the day (before any change) matched the "off" columns within noise (Rijnkaai fog 576 + 1,142 draws). A small spread between off and on at open spots (Grote Markt, cathedral square) is people and boats moving between the two measurements.

**Where it helps**: every place in fog (the common weather: fog, mist and rain are 80 % of days): render time down 30 to 60 %. On clear days in streets and squares with houses round them (the back street -28 %). **Where it does not yet**: the open quays on a clear day. There the river mirror still draws almost everything within its view (1,800 draws at the Rijnkaai): the next step is a precomputed "seen from the water" height per ground cell, so the river mirror can leave out what no water can see.

## 5. Checks that nothing visible disappeared
- **Pixel test** (`__scheldemist.cull`, a test script): at random places on the walkable ground, random headings, the same instant drawn with the culler off and on, compared pixel by pixel in 8-bit colour (the PS1 5-bit colour off). Also the cached path: evaluated from a pose up to 0.45 m and 16 degrees away, then drawn from the test pose. Final code: fog by day 40 views, clear 40, night fog 80, rain 40, inside the cathedral 6 per weather: no pixel differs by more than 8/255, and only one rain view reached 8 (the game's own colour step is 8/255, its film grain moves more every twelfth of a second); all others stay at 7 or less. These are fogged things in front of fog-coloured sky: rounding and the lamp glow term, not objects. Clear weather: no pixel differs at all.
- **Walks** (Steve's pop report): three walks at 10 frames a metre, the culler off and on each frame (its cached state kept): a street corner (91 m), along the Rijnkaai (92 m), into the Vismarkt (66 m); by day in fog, clear, and at night in fog. Clear: no pixel differs. Fog: the most in any frame is one 5-bit colour step in scattered pixels (at most 1,479 of 921,600), never an object. The worst frame-to-frame spike was the same with the culler on as off in 8 of 9 walks; in the ninth (Rijnkaai at night) it was 25 pixels of one colour step higher out of 863,000.
- **Pictures**: `data/shots/m7_<spot>_<fog|clear>_off.jpg` and `_on.jpg` (the six spots; live frames a moment apart, so birds, ripples and swaying rigging differ), `_cullview.jpg` (the dev view), `m7_puddles_480x270.jpg` and `m7_puddles_320x180.jpg`.
- `npm run build` passes. `npm test`: 679 of 681 in the full run; the two others (a ballad and a town-size test) timed out just over 5 s while the test browser ran, and pass on their own (34 of 34). No server code was changed. `__scheldemist.paths()` returns `[]`.

## 6. Found on the way (not changed, for main)
- Unlit gas lamp glass has fog switched off, so by day it shows as dark specks far out in the fog, also through houses `city.ts` has already dropped past the fog. The culler keeps them exactly as they were.
- Street life and quay furniture hide their far chunks from whichever camera drew them last (a sentinel's `onBeforeRender`), so a frame uses the previous render's camera, often a mirror's. Harmless in fog; it made the test harness need a second render per mode.
- `city.ts` culls house chunks with the geometry's own sphere; fine now (the chunks have no transform), but it would break if they ever get one.

## Files
New: `client/src/world/cull.ts`, `client/src/world/occlusion.ts`, this note.
Changed: `client/src/main.ts` (the culler, the warm-up, the Dev menu buttons, the dev hook), `client/src/retro/retroPass.ts` (prepare and finish round the world's render, the door's part of the view, one matrix update), `client/src/retro/psx.ts` (materials say their fog reach), `client/src/world/mirror.ts` (each mirror's pass for the culler, a name), `client/src/world/city.ts` (the puddle mirror 320 x 180, named), `client/src/world/ambient.ts`, `fire.ts`, `boats.ts` (the smokes say their fog reach), `client/src/world/gaslamps.ts` (the halos name their lit attribute).
