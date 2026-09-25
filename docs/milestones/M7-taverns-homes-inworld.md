# M7 - The taverns, the Poesje and the homes in the world, 2026-09-25

Why: Steve, 2026-09-25: "make the rest of the buildings' interiors in the building itself, like in the cathedral." And on 2026-09-24: "In a cafe we should also be able to look through windows."

The five taverns, the Poesje's cellar and the five homes to let are no longer rooms you are faded into. Each stands inside its own city house, at the house's own place, the way the halls stand in their shells (`M7-cathedral-inworld.md`, `M7-halls-inworld.md`). The street door is a real opening with a leaf hung in code. It stands open in opening hours. You walk in without pressing E. From the street you see the lit taproom, the keeper and the drinkers through the door and the ground-floor windows. From inside you see the street. The fade path, `enterOwn`, and the old landmark hooks in `interiors.ts` are gone.

## Per building
| Building | House (city_build) | Done | What is inside |
|---|---|---|---|
| In de Ankere | 75, 6.8 x 11.7 m, a corner | yes | The taproom on the ground floor. Its front window and three windows on the side street are cut through. |
| Het Schipke | 480, 7.4 x 11.6 m | yes | The taproom. Its front window is cut through. |
| De Vliet | 319, 6.1 x 10.1 m | yes | The taproom. Its front window is cut through. |
| Den Engel | 465, 5.8 x 13.4 m | yes | The taproom. Its front window is cut through. |
| Het Bassin | 10, 5.9 x 13.5 m, a corner | yes | The taproom. Its front window and three side windows are cut through. |
| The Poesje | 329, 5.0 x 11.0 m | yes | A landing inside the door, then a flight of 13 steps down to the brick cellar at -2.2 m. Benches in three rows, the booth, the puppets. |
| Cellar room | 343 (an L-shaped house) | yes | Down a flight to -2.2 m, then along the other lane to the room's door in its back wall. The window is painted and glows at night. |
| Garret | 337, 5 storeys | yes | Five flights up a switchback stair, 15.8 m, to the garret under the roof. The gable window glows at night. |
| Widow's room | 432 | yes | The front room on the ground floor, behind the street door. Its window is cut through beside the door. |
| Alley house | 676 | yes | The one room on the ground floor. Its window is cut through beside the door. |
| Merchant's floor | 106 | yes | One flight up to the first floor. Its two windows on the Rijnkaai are cut through the painted ones. |
| Doss house | - | not in scope | It has no room: sleeping there is E at its door, as before. |
| Families' own homes | - | not built | The game has no family room. A supper is still the veil and a line (`families.ts`). |

## How it works
| Part | Where | Notes |
|---|---|---|
| Which houses | `shared/inworld_houses.json` | The house index and door of each building. These are the doors the town picks: the taverns by the nearest door to their anchor, the Poesje and the homes as Steve's save has them. A new town prefers these doors for the homes (`server/src/homes/town.ts`) and the Poesje (`server/src/interiors/poesje.ts`), when they are free. |
| The plan | `shared/housePlan.ts` | Pure numbers, as `hallPlan.ts`. The frame has the house door's middle on the front face at the origin, with +z into the house. It holds: the room fitted 0.2 m inside the house's faces; the door (w 1.2 for a tavern, 1.1 otherwise; the sill 0.18; the leaf to 2.35; the transom to 2.85); the holes the build cuts, which are the painted glass of the facade atlas, so the house looks the same by day; and a `HallPlan` to walk. For the homes that is the room frame on the grid (`roomFrame`), the corridor, the landings, and the flights in two lanes of 1.1 m. The flights are 4.0 m, the landings 1.2 m, and each flight reaches 0.4 to 0.5 m onto its landings (see "What is left"). |
| The Blender build | `tools/city/inworld.mts` writes `shared/inworld_build.json`, and `tools/blender/build_city.py` reads it | Only in the listed houses: the door has no leaf and no transom (`inworld_door`); the window holes are cut out of the wall faces with the texture kept in place (`holed`); and there are stone reveals 0.2 m deep (`hole_reveals`). Every other house is built as before. |
| The house in the world | `client/src/world/houseInWorld.ts` | The `WalkArea` comes from the plan, with the room's furniture as solids and Jef kept out from behind the counter. The leaf, the transom and a dark lining are in the street's scene. The leaf, the transom, the reveals, the sill, the panes with their bars and the "punch" are in the room's scene. The `InWorldRoom` has the door and every cut window as openings. A home gets a candle when someone is home at night. Glow panes cover the painted windows of the garret and the cellar room. |
| The punch | `houseInWorld.ts` `PUNCH` | The paving runs under the houses, and the lining stands behind the facade. Both would hide a cellar's stair seen through its door. So the first thing drawn in a room's pass is its openings, writing the far depth (`gl_FragDepth = 1`, no colour). The room then draws freely behind them and draws its own reveals, sill, leaf and transom there. |
| The taproom | `client/src/world/rooms.ts buildTavern` | This is parametric in the house's size. The counter runs along the side wall nearer the door, from 2.1 m in, with the keeper behind it and a return to the wall. The shelves and the tavern's name are on that wall wherever no window is. The barrel rack is in the back corner and the fireplace in the back wall. The tables with benches run along the far wall, the first by the front window. There are stools at the counter, a vogelpik board, and two lamps over the aisle. Walls are single inner faces with the house's holes. Everything that stands still is merged by material. A shut tavern's lamps are out, with the fire down to embers (`setLamps`). |
| The Poesje | `rooms.ts buildCellar` | The landing behind the door, then the flight in a brick tunnel with a sloping soffit and a rail on the hall side. The cellar hall has a flat brick ceiling on arches, benches in rows with an aisle along the near wall, and the booth at the far end. |
| Homes | `client/src/world/homeRooms.ts buildHome`, `buildStairwell` | The room of its class (`shared/homes.ts`) sits in its room frame, mirrored across when the ground-floor window would fall outside the house. It has single-face walls, the house's window holes, or the painted view where none is cut. Rooms up or down a stair have their door in the back wall onto the landing. The stairwell has the corridor from the street door, the well's walls, the landings, the thick treads with a soffit, and a rail between the lanes. |
| The rules | `shared/homes.ts` | New: `doorWall` (0 or 2). The garret, the merchant's floor and the cellar room have their door in the back wall. `canPlace` and the "bed stays reachable" walk now start from the door's wall. The merchant's desk moved under the windows, and the bookcase moved beside the wardrobe. Steve's save had no leases and no pieces, so nothing placed moved. |
| The life | `client/src/game/interiors.ts` | The life of the tavern or the Poesje nearest Jef runs (within 70 m; another takes over when 10 m nearer). The keeper and the drinkers come from the server every 4 s, as before, and they show through the windows. Crossing the threshold starts the room sound and the welcome line. Chatter and gossip happen only with Jef inside. In the Poesje you pay as you cross the threshold onto the landing; if you cannot pay you are turned back to the step. Carrying goods puts you back on the step. At closing time the keeper puts you out, and the door shuts. Sitting uses the carriage mode in the house's frame. E works only on what you face, as before. `setHome` lets a visitor at Jef's home work as before. |
| Homes | `client/src/game/homes.ts` | Your door opens as you come with the key (within 4.5 m) and stays open while you are in. The room's keys work only in the room itself: the bed, the fire, and putting up and moving pieces (the room frame from `toLocal`). A piece carried in both arms goes straight to placing it once you are in the room. Waking at home puts you beside your bed. The window glows at night when you are in your room, and at the widow's when she is home. |
| Town | `client/src/game/town.ts` `tavernInside` | While a tavern is open, its keeper and its drinkers go in at the door. They no longer stand before it, so nobody is shown twice. |
| Occlusion | `client/src/world/cull.ts` `noOcclusion` | While the eye is inside a city house, its own cells in the occlusion map would hide the street seen out of its windows. So occlusion is off there. |
| Lit windows | `client/src/world/ambient.ts` | The painted windows that are lit at random at night are not lit over the listed houses' own windows. The room lights those itself. |

## Rendering and the budget
This works as for the halls. The street is drawn first, and each room is drawn over it through its openings' part of the view, with the street's depth kept. From inside, the street is drawn only through the openings in view. New for the many small rooms (`world/inworld.ts`):
- `InWorldRoom.budgeted`: a house is drawn from outside only within its `reach` (90 m, less in fog) and only among the nearest `InWorld.budget` (4) of them. Past that, its openings show the dark lining. `inWorld.lastBudget` gives what was seen and what was drawn.
- A room whose door is shut and whose windows are out of view costs nothing.
- The life's people are drawn only while their room is drawn.

## Checks (2026-09-25)
- `server/test/houses-inworld.test.ts`, 10 tests:
  - every listed door is its house's door, as `houseDoors()` finds it, and faces the same way;
  - `inworld_build.json` is what the plan says now;
  - every tavern has its front window cut; the rooms, landings and flights stand 0.2 m inside the house's faces;
  - the merchant's floor is on the first storey; the garret is at the eaves after five flights; the cellars are below -2 m; the ground-floor homes' windows are in their own house's front;
  - the walk in to the middle and the back corner of each taproom, and nothing past a shut door;
  - down the Poesje's flight to the far end of the hall, and never under the flight;
  - up or down every flight to each home's room through its back-wall door, and nothing past a shut door;
  - the merchant's flight is climbed a step at a time.
- `server/test/homes.test.ts`: the rules tests follow the doors in the back wall (26 of 26). `houses-inworld`, `homes`, `interiors`, `halls-inworld` and `cathedral-inworld` pass: 106 of 106.
- The full server run is 780 of 782. The 2 failures are `lively.test.ts` and `transport.test.ts`, "on a copy of a real older save". Both fail with `EPERM, Permission denied` on a temp folder under `AppData\Local\Temp`. I did not touch these files.
- `npm run build` passes.
- In the browser, on a test save only (`node tools/teststack.mjs start taverns --server 8969 --vite 5369`), in one tab, stopped after:
  - **Paths.** `__scheldemist.paths()` lists nothing by day. The 1.2 m doors are too narrow for the city's 0.5 m path grid, so the inside of each house is checked by its own plan (`insidePathProblems`): the counter, the fire and a table in each tavern; the benches in the Poesje; the door and the bed of Jef's home. `signs()` has 0 problems, and `streetEnds()` lists nothing. No floor of a plan lies under an open street cell of the walk map.
  - **Walked in with W.** At In de Ankere, from 2.5 m out: the step up to 0.18, then inside to the counter's end. At the Poesje: down the flight from 0.18 to -2.2, and on to the first bench. At the merchant's (with the key): up 3.62 m to the back landing, back along the corridor, and into the room, where `inRoom` became true. At the garret: five flights to 15.8 m, and into the room.
  - **Sat down and stood up** at an Ankere table. The eye was at 1.37, and Jef stood up beside the table on the floor.
  - **At 20:30 in the Ankere**: the keeper and 9 drinkers. The keeper was not drawn in the street; a drinker's town mode was "inside".
  - **The Poesje at 20:30**: 14 in the audience, and the play "The Lantern That Walked Off" was on.
  - **The door walk** (`await __scheldemist.houses()` then `.walk`, 10 frames a metre, from 7 m out to 5 m in, then out, then turned 1.1 rad): Den Engel and the Poesje had no spikes, in, out or turned. In de Ankere had no spikes at the door. It had two inside, at 2.7 m and 4.8 m in: the straight line at x 0 runs past the counter's end, so the counter top sweeps under the eye. That is not a pop. The worst change near a door was 10.9 to 16.0 (the halls: 6.0 to 14.4); 17.2 in the Ankere's turned walk, inside by the counter. Inside mode starts at 0.1 to 0.2 m past the door plane.
  - **Z-fighting** (`await __scheldemist.zfight()`): no visible fight with a house or with my objects. The houses keep their 4 small ones (3 copings, 1 front). The leaf's panels and straps were first thin layers on the leaf, so they now stand 3 to 4 cm proud. The whole world: 547 fights; M3c pass 6 gave 550. The count moves with what else is switched on, such as market stalls.

### Frame time
`__scheldemist.perf(30)`, median of three. Hidden pane, 1280 x 720, culler on, with other helpers' servers running (noisy by about 1 ms). "Street only" is the same view with `inWorld.enabled = false`.

| View | With the rooms | Street only |
|---|---|---|
| In de Ankere from the street, 13:00 (its room and the merchant's next door, 2 in the budget) | 9.63 ms, 669 calls, 524k tris | 9.25 ms, 579 calls, 513k |
| The same, 20:30, 10 in the taproom | 9.39 ms, 693 calls, 545k | 8.94 ms, 599 calls, 531k |
| Den Engel from the street | 8.14 ms, 406 calls, 503k | 7.02 ms, 343 calls, 465k |
| De Vliet from the street | 11.4 ms, 384 calls, 527k | 8.72 ms, 313 calls, 485k |
| The merchant's house from the street | 6.26 ms, 294 calls, 426k | 6.09 ms, 258 calls, 424k |
| The garret's house from the street (door shut, no window cut) | 6.70 ms, 231 calls | 6.87 ms, 231 calls |
| In the Ankere, looking out of the front window | 10.99 ms, 948 calls | (street whole) 9.64 ms, 1,012 calls |
| In the Ankere, looking in (side windows in view) | 8.82 ms, 861 calls | 8.29 ms, 773 calls |

Before merging, a taproom cost about 177 draw calls through its door and window. After merging its still geometry by material, and each leaf and transom, it costs 45 to 90. The old faded room drew 119 calls on its own (M6-interiors); it now costs its share of the street view. With the door shut and no window in view, a room costs nothing.

## Pictures (`data/shots/`, 1280 x 720)
- **Taverns:** `m7t_ankere_street` (13:00, the lit door, the window), `m7t_ankere_door_close`, `m7t_ankere_window_close`, `m7t_ankere_night` (20:30, the drinkers through the window, the warm transom), `m7t_ankere_in_counter`, `m7t_ankere_in_back`, `m7t_ankere_in_lookout` (the street through the front window and the door), `m7t_ankere_drinkers`, `m7t_ankere_counter_night`, `m7t_ankere_seated`, `m7t_schipke_night`, `m7t_vliet_night`, `m7t_engel_night`, `m7t_bassin_night`.
- **Poesje:** `m7t_poesje_street_night`, `m7t_poesje_stair` (down from the landing), `m7t_poesje_stair_up`, `m7t_poesje_hall` (the audience, the booth and the puppets), `m7t_poesje_back`.
- **Homes:** `m7t_home_widow`, `m7t_home_alley`, `m7t_home_merchant`, `m7t_home_garret`, `m7t_home_cellar` (each room as let), `m7t_merchant_room_walked` (the two cut windows on the quay, after walking up), `m7t_garret_walked`, `m7t_widow_day`, `m7t_widow_night` (her window lit, the painted one beside it dark), `m7t_alley_night_empty`.
- Bubbles and prompts are HTML and are not in the pictures.

## What is left
- **Upstairs see-through is limited.** The merchant's windows are cut through. The garret's gable window and the cellar room's window are painted and glow at night. The glow panes lie on the painted gable window nearest the room's, not exactly where its grid puts it.
- **The ground-floor homes.** The widow's and the alley room are centred on the house's street door, because the rules have the door in the middle of the front row. So each room reaches under its neighbour's footprint by 0.4 to 0.8 m. Nothing shows of that from outside. Their window is a new small one beside the door, next to the painted shop window of the other bay.
- **Steep stairs.** The ground storey's flight rises 3.62 m in 4.0 m (20 steps of 0.18 m on 0.2 m treads). Each flight reaches 0.4 to 0.5 m onto its landings (`onto`). Without that, a body with the walk's 0.45 m ring round it would take the landing ahead for a wall from the second-last step. In the world Jef walks it smoothly. The plan's own flood needs a 0.15 m grid for it.
- **Taverns only by their door.** Only the nearest tavern has its drinkers. Another tavern seen at the same time is lit but empty. The budget draws the nearest 4 small rooms; past it, and past 90 m, windows show the dark lining.
- **The Poesje's stair is dark** apart from the lamp at the landing and the candle at the foot.
- **Other saves.** The cut houses are fixed at build time. A save whose Poesje or homes were picked from other doors (an older town, a different seed, the doors taken) would have its rooms stand in the listed houses while the town uses other doors. A new town prefers the listed doors when they are free. Steve's save uses exactly these doors (read from the test copy of the save). Plan: warn in the log when a town's door is not a listed one.
- **Other code.** `landmarks.ts leaveBy` still calls `interiors.leave` for the old instanced halls, which no longer occur. I left it to the landmarks' owner. The night helper's sleep hooks are unchanged: `onWakeHome` puts Jef by his bed in the world, and the night sheet stands him up from a bench.
- The M4 conversation's prompt still says "in the street" for tavern chatter (as in M6).

## Files
- **New:** `shared/housePlan.ts`, `shared/inworld_houses.json`, `shared/inworld_build.json` (written), `tools/city/inworld.mts`, `client/src/world/houseInWorld.ts`, `client/src/world/houses.ts`, `server/test/houses-inworld.test.ts`, and this note.
- **Changed:**
  - `tools/blender/build_city.py` (the listed houses only): `inworld_door`, `holed`, `hole_reveals`;
  - `client/public/models/city.glb` rebuilt;
  - `client/src/world/rooms.ts`: `buildTavern` and `buildCellar` rewritten for the world, `wallFace`, `mergeStatic` (moved here), `Room.toLocal/solids/level/jefOnly/setAmbient/setLamps`;
  - `client/src/world/homeRooms.ts`: `buildHome` in the world, and `buildStairwell`;
  - `client/src/game/interiors.ts`: rewritten for the world; the fade and the landmark hooks are gone;
  - `client/src/game/homes.ts`: the homes in the world;
  - `client/src/game/interiors.css`: the fade's style is gone;
  - `client/src/world/inworld.ts`: `budgeted`, `budget`, `lastBudget`;
  - `client/src/world/cull.ts`: `noOcclusion`;
  - `client/src/world/ambient.ts`: no lit painted pane over a listed house's own windows;
  - `client/src/game/town.ts`: `tavernInside`;
  - `client/src/game/landmarks.ts`: the three old hooks on `interiors` removed;
  - `client/src/main.ts`: the plans, `attachWorld`, daylight, `tavernInside`, `noOcclusion`, the render without `prepareRender`, the inside path checks, `__scheldemist.houses()`;
  - `shared/homes.ts`: `doorWall`, and the merchant's desk and bookcase;
  - `server/src/homes/town.ts` and `server/src/interiors/poesje.ts`: prefer the listed doors;
  - `server/test/homes.test.ts`: the back-wall doors;
  - `docs/milestones/M3c.md`: the rebuild step.

## Rebuild
    python tools/city/plan.py            (only if the plan changes; then fix shared/inworld_houses.json: node tools/city/inworld.mts --check)
    node tools/city/inworld.mts
    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_city.py
    cd server && npx vitest run test/houses-inworld.test.ts test/homes.test.ts
    npm run build

The doors did not move, so `build_streetlife.py`, `build_props.py` and `build_quayfurniture.py` need no rebuild.

In the tab: `__scheldemist.interiors.devEnter("ankere")`, `__scheldemist.homes.devView("garret")`, `__scheldemist.interiors.inWorldHouses`, `__scheldemist.inWorld.lastBudget`, and `const H = await __scheldemist.houses()`, then `H.walk("tavern:engel", { from: [0, -7], to: [0, 5] })`.
