# M7 - The halls in the world, 2026-09-24

Why: Steve, 2026-09-24: "make the rest of the buildings' interiors in the building itself, like in the cathedral."

The town hall, the Vleeshuis, the Oostershuis and the Steen are no longer rooms you are faded into. Each hall stands inside its Blender shell, at the shell's own place, the way the cathedral does (`M7-cathedral-inworld.md`). Their street doors are real openings with oak leaves hung in code. The leaves stand open by day and shut at closing time. You walk in without pressing E, you run as outside, and you climb their stairs step by step. From the street you see into the hall through the door, and from inside you see the street. The fade path for landmarks is gone: all five landmarks are walked into now.

## What is in
| Part | Where | Notes |
|---|---|---|
| The shared plan | `shared/hallPlan.ts` | Pure numbers, no three.js. This is what the four plans share: storeys (a floor height, floors, solids), straight flights between them, street doors, the porch's steps, the people's graph, marks and sets. Walking picks the storey by the feet: of the floors under a point, the one within a step (0.36 m) of the feet. So you climb a flight step by step, walk on the floor you reached, and never walk under a flight or off a gallery. A floor up to 0.8 m below the feet is not a wall (the lower steps of a flight behind you); deeper is a drop and is kept off like a wall. On a flight its sides hold you. `insideness` runs from 0 on the step to over a half in the doorway's inner part, and to 1 in the hall. `flood` is the test's walker: a 0.25 m grid through floors, doorways and flights, body 0.3 m. |
| The four plans | `shared/townhallPlan.ts`, `vleeshuisPlan.ts`, `oostershuisPlan.ts`, `steenPlan.ts` | Each is fitted inside its shell from `build_landmarks.py`. Every wall and floor stands at least 0.2 m inside the shell's faces and inside the footprint in `shared/city.json`; the tests check this. The frame is the main door's plane at z 0, x across and z into the building. The town hall and the Steen are turned half round (yaw pi); the Vleeshuis and the Oostershuis are not turned. |
| The halls | `client/src/world/landmarkHalls.ts` (`buildTownhall`, `buildVleeshuis`, `buildOostershuis`, `buildSteen`, `hallsInWorld`) | These are rewritten from the plans at the shells' places. Everything the old rooms had is kept and moved to fit: the lodge, the board, the counter, the desks, the chimneypiece, the Leys paintings, the casks, the stage, the studio, the cases, the armour, the cell, the stacks, the scale and the hoist. Walls reach 0.12 m under the floor and into the ceiling, so the PS1 vertex snap never opens a seam there. Windows sit in real holes in the hall's walls. Their panes glow with the hour (0 at night, 1 by midday) and the weather (clear 1, mist 0.8, fog 0.7, rain 0.6, storm 0.5). |
| Doors, leaves, walking, drawing | `client/src/world/hallInWorld.ts` | This is the cathedral's pattern made general. The leaves are in the street's scene (seen from both sides). They turn open into the hall by day and shut at closing time. An arched head over them is a fixed oak board (the Vleeshuis's and the Steen's basket arches). The `WalkArea` answers only where the plan has floor. The building's walls are answered by the walk map, which marks the footprint as wall. The `InWorldRoom` has one door opening each, the fog and light blend over the threshold, and the lamps glow in the hall's air. `GlowPane` lays warm panes over the shell's windows at night when the hall is lit. |
| Storeys in the world | `client/src/world/rijnkaai.ts` | `WalkArea.walkable`, `floor` and `hits` take the feet (world) as an optional last argument. `baseAt`, `isWalkable`, `wallNear`, `isFree`, `floorAt`, the walk's `hits`, `walkFree`, `faceNear`, `groundAt` and `standFree` pass it on. Without feet (the crowd's grid, the path check) a building answers for its ground floor. |
| The life | `client/src/game/landmarks.ts` | The in-world code for the cathedral now serves every landmark. `iw()` gives one shape for the cathedral and the halls: the frame, the floor for Jef's feet, where Jef is put out, and where the dev puts him in. The life of the nearest building runs: the one Jef is in, or else the nearest. That is the cathedral within 200 m of its west door, or a hall within 150 m of a door. Another building takes over only when it is 15 m nearer. When Jef crosses a threshold, the server's `here` is set, the hall's own echo plays (`hall`, `vault`, `museum`, `store`) and the footsteps echo. At closing time Jef is put out on the step with the building's line ("The porter calls out: the offices are closing ..."). Chairs and benches work on their storey, and you stand up beside the seat on the same floor. Looks are shown only on their storey. The rehearsal's lines are heard upstairs (`jefLevel()`). The hush and putting out for running stay the cathedral's. `enter()` and `devEnter()` put Jef just inside a door. `roomFor` and the `enterOwn` call are gone. |
| The shells | `tools/blender/build_landmarks.py` (the stadhuis, vleeshuis2, hanzehuis and steen5 parts only) | Town hall: the body is built face by face. The front face has a doorway behind the main portal (the portal has `leaves=False`), and the back is open into the stair block where the landing is. Vleeshuis: the two doors of the long sides have no painted door at the back of their reveals (`VLEES_OPEN_DOORS`). Oostershuis: the dock wing is built face by face, with a gateway behind the gate's portal (`leaves=False`). Steen: the gatehouse and the prison range are built face by face. The museum door is a basket-arched opening in the gatehouse's lane face (no painted door). Where the two masses meet under the prison range's eaves, their walls are left out, because the hall's arch is there. The cathedral is unchanged: every other landmark hashes the same before and after each rebuild. |
| The Steen's doorway | `client/src/world/steenlife.ts` | The dark shape laid over the painted museum door is no longer added. |
| Dev | `client/src/dev/hallcheck.ts`, `main.ts` | `await __scheldemist.halls()` gives `shot(name, id, from, to, level)`, `walk(id, {from, to, turn})` (the pop check, below), `points(id, level, spacing)` and `gaps(id, level, points)` (holes in a hall). `landmarks.inWorldHalls`, `landmarks.devGo(x, z, y)`. |

## The four halls
| Hall | Shell (world) | What is where |
|---|---|---|
| Town hall | The body is 67.8 m by 24.5 m, 20.8 m to the lead. The stair block is 16.2 m wide at the back. The main door is at (-257, 60.69), behind Floris's portal; the ground floor is 0.3 m up (the portal's two steps). | Ground floor: the vestibule with the porter's glazed lodge (its door at the back) and the notice board; the two side doors of the frontispiece, shut, on the inside. Then the old courtyard under a glass roof at 19.2 m, the great stair (34 steps, 6.7 m) up the middle to the landing in the stair block, and Floris's arcade shafts carrying galleries on three sides. To the right is the clerks' office: the registry's counter (Jef stays on the callers' side), five desks, the registers, and the callers' bench. The first floor is at the ground storey's string course, 7.0 m. The wedding hall is over the office, with five windows on the Grote Markt, the chimneypiece with the caryatids and its fire, the green table, three rows of chairs and the crown of candles. Behind it is the aldermen's room, and on the left the Leys hall with its paintings. |
| Vleeshuis | 44.4 m by 16.5 m, 16.8 m to the eaves. The south door is at (-121.95, 92.4) and the north door at (-115.65, 107.1), each 0.9 m deep in the wall. The floor is at the doorstep's 0.16 m. | Ground floor: three aisles under brick vaults on two rows of columns, and stillages of casks along the walls and the column lines, with a bay open every other bay to cross. The tasting table, the bottle racks on the east wall between its two shut doors, the cellar master's desk by the south door, and the skids and hoist by the north door. The great windows have their lower lights shuttered. A 50-step stair rises east along the north wall to the landing at 10.0 m, over the drip course. The north aisle is vaulted only east of it, with a timber ceiling over it. Upstairs: the theatre (stage at the east end, backcloth, curtains, footlights, 13 rows of benches) and the painter's studio at the west gable. |
| Oostershuis | The dock wing is 64 m by 10 m, with a 4.4 m ground storey. The gate is at (120, 123.9), behind its portal; the floor is 0.3 m up. | A vaulted gate passage runs through the wing to the court, and the court gate is barred. On either side is a long timber hall on posts under the joists. The west hall has sacks, bales and crates, and the hoist through a hatch. The east hall has bales, crates, a row of casks, the scale and the storekeeper's desk by the passage. The arched warehouse doors of the front are shut on the inside, with glazed fanlights. |
| Steen | The gatehouse is 5.8 m wide and the prison range 11.6 m, both 8.2 m deep. The museum door is at (-183.5, -23.25), on the raised courtyard at 2.2 m. | The door leads into Charles V's gatehouse with its arms and armour: two suits, a rack of halberds and pikes, a case of swords, the bronze gun. A wide pointed arch leads to the hall of antiquities in the prison range: cases under the three barred windows and along the back, two tall cabinets, carved stones. A 12-step stair at its end goes down along the back wall to the old cell, 2.4 m lower (just under the street), with rings, chains, a bench, straw and a slit of grey light. |

## Rendering
This works as for the cathedral (portal culling, `world/inworld.ts`): the street is drawn first, and each hall is drawn over it through its doors' part of the view, with the street's depth kept. From inside, the street is drawn only through the doors in view, and not at all when none is. Each door's opening box from outside covers the porch, the doorway and the leaves, because the people on the step are in the hall's scene. From inside it covers the doorway and the open leaves. The mode turns at 0.3 to 0.7 m past the door's plane, inside the doorway. At night the Vleeshuis theatre's six cross windows over the vaults glow to both streets while the society plays. They are warm panes over the Blender windows, visible only when dark (`nightGlow`). The other halls are shut at night.

## No pops at the door, no holes in a hall
- **The walk through each door** (`halls().walk`): the eye walked from about 8 m out to 5 to 8 m in, and back out, 10 frames a metre. It went straight, and turned 63 degrees to the side. The frames were compared in the page with the grain held still. A spike is a change more than 1.8 times the mean of its two neighbours. None of the 20 walks has one. The biggest steady changes are the eye climbing the portals' steps and a lamp post passing close.

| Walk | In, straight | Out, straight | In, turned | Out, turned |
|---|---|---|---|---|
| Town hall | 9.9 (the lower step, -2.7 m) | 10.5 (the step, -1.2 m) | 9.9 | 13.5 (-2.1 m) |
| Vleeshuis, south door | 6.0 | 13.0 (the doorstep, -1.3 m) | 11.0 | 11.1 |
| Vleeshuis, north door | 9.2 | 10.0 | 11.9 | 11.0 |
| Oostershuis | 8.7 | 14.1 (the lower step, -2.0 m) | 9.0 | 10.8 |
| Steen | 11.4 (the arch, 4.2 m in) | 14.4 | 7.9 | 6.6 |

The worst change per frame near the door is the mean per pixel and channel, 0 to 255, and there are 0 spikes in every walk. The town hall and the Vleeshuis were walked with the rendering helper's culler on and off: the numbers are the same.
- **No shell face stands inside a hall.** The faces that did (the town hall's back face and the stair block's inner face, the Steen's two faces where the gatehouse meets the prison range) are cut in `build_landmarks.py`. The others are above the halls' ceilings or outside their walls.
- **Holes** (`halls().gaps`): from points 2 to 3 m apart on every storey, 8 views each, the cleared background was made magenta. Any magenta seen where no door is in view is a hole. Before the fixes there were seams at the floor's edge, a slot over the aldermen's room's recess, and the Oostershuis passage's vault ends. After the fixes: town hall 191 points and 1,209 views, Vleeshuis 128 points and 778 views, Oostershuis 66 points and 402 views, Steen 28 points and 158 views. No pixel of a hole in any of them.

## Frame time
`__scheldemist.perf(30)`, median of three, hidden pane, 13:00 clear, culler on. "Street only" is the same view with the halls not drawn (`inWorld.enabled = false`). Other helpers' work ran on the machine, so the timings are noisy by about 1 ms. Late in the session every reading stood at a floor of about 6.8 ms (a sync in the pane), so use the calls and triangles there.

| View | Town hall | Vleeshuis | Oostershuis | Steen |
|---|---|---|---|---|
| Outside at the door, looking in | 7.69 ms, 355 calls, 383k tris | 7.37 ms, 347, 459k | 6.68 ms, 214, 279k | 7.27 ms, 203, 284k |
| The same, street only | 7.66 ms, 314, 376k | 6.81 ms, 324, 425k | 7.27 ms, 205, 276k | 7.29 ms, 186, 282k |
| Inside, looking in | 1.46 ms, 47, 15k (the vestibule to the stair) | 1.81 ms, 71, 77k (the south aisle, east) | 2.58 ms, 77, 78k (the west hall) | 43 calls, 13k (the hall); the gatehouse 12 calls, 4k |
| Inside, looking out of the door | 8.68 ms, 434, 447k | 7.41 ms, 277, 390k | 9.67 ms, 439, 428k | 12.87 ms, 568, 613k |

A hall seen through its door costs 9 to 41 draw calls. Inside, with no door in view, the street is not drawn and a hall costs what the old room did. Looking out of a door costs about what standing in the street costs, as with the cathedral.

## Checks (2026-09-24)
- `server/test/halls-inworld.test.ts`, 27 tests, one block per hall:
  - the plan fits the shell: walls and floors 0.2 m inside the faces, and the ceilings under the lead or the eaves. The town hall's first floor is at its string course, and the Vleeshuis's upper floor is over its drip course. The Steen's cell is over the shell's foot;
  - every wall corner is inside the footprint in `city.json`;
  - the doorway is the shell's door: the place that `build_landmarks.py` prints, the width, the leaves' height, and the street step of `LANDMARK_DOORS` on the plan's porch;
  - the walk in: from the step to every mark and set of the hall's life (the people's graph also behind the counter and in the lodge), and to every room. That includes up the stairs (the town hall's landing, galleries, wedding hall, aldermen's room and Leys hall; the Vleeshuis's theatre and studio) and down to the Steen's cell. Through the Vleeshuis's north door as through its south door;
  - nothing past a shut door, never under a flight, never off a gallery, and not behind the counter. The flight is climbed a step at a time; the feet pick the storey over the office;
  - the threshold runs from 0 on the step to over a half at the doorway's inner face, and to 1 in the hall.
- `npm run build` passes. `halls-inworld`, `cathedral-inworld` and `landmarks` pass: 62 of 62. The full server run has 747 of 751. The 4 failures are in `day.test.ts` (3) and `transport.test.ts` (1). I did not touch these files or the code they test (`server/src/day.ts` is being changed by another helper).
- In the browser, on a test save only (`node tools/teststack.mjs start halls --server 8962 --vite 5362`, day 2 = a Tuesday), in my own tab, never on 5173/8787:
  - `__scheldemist.paths()` lists nothing, with the halls' 18 inside points and the cathedral's, by day;
  - walked in with W, as a player does, through all five doors. The town hall's portal steps went 0, 0.15 and 0.3. The great stair went up to the landing at 7.0 m. The Vleeshuis's long stair went from 0.16 to 9.6 m, 15 m in 9 s at a walk;
  - town hall, 15:57: Jef upstairs in the wedding hall. At 16:01: "The porter calls out: the offices are closing. You go out, and the door shuts behind you." Jef was on the step, the leaves shut, and walking in stopped 1.2 m before them with E "try the door of the town hall";
  - "talk to Paulina Nijs" at the counter. Sat on the callers' bench and on a wedding chair upstairs (eye at 8.18 m), and stood up beside it on the same floor;
  - the civil wedding at 11:10: Petrus Verhoeven and Coleta Verbiest before the alderman and the registrar, with two witnesses, in the wedding hall;
  - Vleeshuis, 19:30, the rehearsal: the prompter and five actors on the stage, and the lines heard upstairs ("From the top of the second act, please. ..."). At 20:00 the theatre's windows glow on the south side;
  - the cellar master, the cellarmen, the painter; the Steen's attendant and six visitors; the Oostershuis storekeeper and four porters with their sacks.
- Pictures (`data/shots/`, 1024x768):
  - town hall: `m7h_th_square`, `m7h_th_porch`, `m7h_th_vestibule`, `m7h_th_court` (from the landing, the glass roof), `m7h_th_office`, `m7h_th_wedding_hall`, `m7h_th_civil_wedding`, `m7h_th_leys_hall`, `m7h_th_lookout` (the Grote Markt through the door), `m7h_th_bench_sit`, `m7h_th_wedding_chair`, `m7h_th_door_shut` (16:40);
  - Vleeshuis: `m7h_vh_south_street`, `m7h_vh_hall`, `m7h_vh_hall_east`, `m7h_vh_stair`, `m7h_vh_rehearsal`, `m7h_vh_studio`, `m7h_vh_night_theatre_windows`;
  - Oostershuis: `m7h_oh_quay_day`, `m7h_oh_passage`, `m7h_oh_west_hall`, `m7h_oh_east_hall`, `m7h_oh_lookout` (the liner through the gate);
  - Steen: `m7h_st_courtyard`, `m7h_st_gatehouse`, `m7h_st_hall`, `m7h_st_cell`.
- After the check the audio was closed (`t.done()`), the tab was closed and the stack was stopped.

## What is left
- **Windows you see through.** The windows glow with the day and the weather from inside, as the cathedral's glass does, but you cannot see the street through them. The shells' windows are painted atlas cells on solid faces. Real see-through windows need holes in those faces, the cells cut round them, clear panes, and a `window` opening each (`inworld.ts` has the kind). The town hall's office and wedding hall windows on the Grote Markt would come first.
- **Lit windows at night** only for the Vleeshuis theatre. The other halls are shut and dark at night.
- **Only what the old rooms had.** The Oostershuis's court and other wings, the Steen's river range and its 1890 north wing, and the town hall's second storey and its left wing downstairs are shell only.
- **Upstairs people appear** in their places rather than climbing, as before.
- `game/interiors.ts` still has the M6 "landmark" room kind and its hooks. Nothing uses them now; I left them for the helper who moves the homes and taverns.
- Not mine, seen on the way: a handcart parked on the town hall's step, and a lamp post right before the Oostershuis's gate, narrow the way in. The walk map keeps a 3 m strip of wall before the Vleeshuis's south face (the porch is a way through it at the door). There is a 0.25 m slit between the Steen's courtyard terrace and its lane face (a sill covers it at the door).
  Fixed 2026-09-25 (the doors pass):
  - Nothing parks or stands before a doorway. `doorKeepOut` (`shared/hallPlan.ts`, and one for the cathedral's west door in `shared/cathedralPlan.ts`) gives a box per door: the doorway's width and 1 m each side, from the door's plane out over the porch's steps and 2.5 m of street beyond (4 m before the cathedral), and each porch step with 1 m round it. The client's placers take these boxes (`world/doorKeep.ts`, `world/rijnkaai.ts`): the carts, casks and crates, the street life, the quay furniture, the litter and the clutter. So do the quest boxes (`game/questboxes.ts`). The server's velocipede and handcart spots keep off them too, and off the lamp posts and 3 m from a tavern's door (`town/possessions.ts`, `TRANSPORT_V` 4, so a save gets its spots again on its next start).
  - The Oostershuis lamp stands on the pier beside the gate's frontispiece, at (124.3, 121.5) (`tools/city/design.py`, `shared/city.json`). `LAMPS_VERSION` 4 moves the lamplighter's stand with it.
  - Vleeshuis: `plan.py` filled every landmark's outline rectangle into the walk map. The Vleeshuis's rectangle reached out to its south stair tower, which gave a 3 m strip of wall along the whole south front. The Vleeshuis is built on its outline (`OUTLINE_BUILT`), so now only the outline is wall: the buttresses and the tower. Only the wall layer of `walk.png` was written again; its water layer was kept as it was. Jef walks along the front at z 88.9 from the west end to the tower.
  - Steen: a bluestone kerb at the foot of the lane face fills the slit from x -190.6 to -168.9 (`world/steenlife.ts`). Downward rays at z -23.07 hit the ground (y 0) from x -190 to -169 before the fix, and y 2.22 after.
- The portals' steps lift the eye 0.15 m at once, as every step in the game does.

## Files
- New: `shared/hallPlan.ts`, `shared/townhallPlan.ts`, `shared/vleeshuisPlan.ts`, `shared/oostershuisPlan.ts`, `shared/steenPlan.ts`, `client/src/world/hallInWorld.ts`, `client/src/dev/hallcheck.ts`, `server/test/halls-inworld.test.ts`, this note.
- Changed:
  - `client/src/world/landmarkHalls.ts`: the four halls rewritten in the world; `hallsInWorld`, `holed`, `windowIn`;
  - `client/src/game/landmarks.ts`: the in-world halls, `iw()`, `jefLevel()`, the fade path removed;
  - `client/src/world/rijnkaai.ts`: the feet through `WalkArea`;
  - `client/src/world/landmarkRooms.ts`: `Lookable.y`, `LandmarkRoom.nightGlow`;
  - `client/src/world/steenlife.ts`: the dark doorway shape not added;
  - `client/src/main.ts`: `landmarks.indoors` for the footsteps, `__scheldemist.halls`;
  - `tools/blender/build_landmarks.py`: the stadhuis, vleeshuis2, hanzehuis and steen5 parts;
  - `client/public/models/landmarks.glb` rebuilt.

## Rerun
    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_landmarks.py
    cd server && npx vitest run test/halls-inworld.test.ts test/cathedral-inworld.test.ts test/landmarks.test.ts
    npm run build
    node tools/teststack.mjs start halls --server 8962 --vite 5362

In the tab: `__scheldemist.free(true); await __scheldemist.t.light(); const H = await __scheldemist.halls()`, then `H.walk("townhall", { from: [0.6, -10], to: [0.6, 8] })`, `H.gaps("steen", 0, H.points("steen", 0))`, `__scheldemist.landmarks.devEnter("vleeshuis")`, `__scheldemist.paths()`.
