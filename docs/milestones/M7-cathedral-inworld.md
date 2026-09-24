# M7 - The cathedral in the world, 2026-09-24

Why: Steve, 2026-09-24: "The world feels more alive when we can look in, walk in and out. Try it first with the cathedral. I could also not run in the cathedral. It should be the same, just maybe people shouting where running is inappropriate." And later: "In a cafe we should also be able to look through windows." So this is built as a system the taverns can use next.

The cathedral is no longer a room you are faded into. Its hall stands inside the Blender shell, at the shell's own place. The west door stands open by day. You walk in from the Handschoenmarkt, you see the nave through the door, and from inside you see the square. You run as you run outside. If you run near people, they hiss at you.

## What is in
| Part | Where | Notes |
|---|---|---|
| The plan | `shared/cathedralPlan.ts` | Pure numbers, no three.js. The hall's lines are fitted inside the shell of `build_landmarks.py`. The nave is 12 m wide and 28.5 m high, under the nave eaves at 30 m. There are three aisles each side, and the outer ones start behind the towers. The transept runs from u 68.2 to 81.0, with its ends at 33 m. The choir, the five-sided apse and the ten-sided ambulatory follow the shell's. Every wall stands at least 0.2 m inside the shell's faces. The frame is the shell's: local x = v (+ north = world +x), local z = u, and the nave floor is 0.3 m above the square (the portal's two steps). The plan also holds the floors, the solids (piers, chairs, altars, confessionals, the rail, the screens, the trumeau, the open leaves), the marks and sets where people go, the people's walking points, and the threshold blend. |
| The hall | `client/src/world/landmarkRooms.ts buildCathedral` | This is drawn from the plan. The west wall has the doorway under a pointed relieving arch, with the reveal and the back of the tympanum behind the doors. The side portals (towers) and the transept portals are shut doors inside, where the shell has them. The apse has a half dome, and the ambulatory has a flat ceiling. The aisle vaults spring at 12.4 m, over the nave arcades (the old room let you see over them). North is north now: the Elevation of the Cross and the Lady altar are on the north side. The triptychs hang on the transept arms' east walls. |
| The west door | `tools/blender/build_landmarks.py` (`_portal(..., leaves=False)`), `client/src/world/cathedralInWorld.ts` | The Blender portal has no leaves now: it is a real opening under the lintel. Two oak leaves with iron straps are hung in code, in the street's scene. They stand open 85 degrees into the nave by day, turn shut at seven, and open again at six. A wedding keeps them open, as before. Before the shut leaves, E reads "The west door is shut for the night". |
| Walking in | `client/src/world/rijnkaai.ts` (`WalkArea`, `addWalkArea`) | This overrides the walk map. Inside a building's area, its own floor, walls and solids count instead of the walk map (which marks the footprint as wall). It works for Jef, the crowd's isFree and the path check (`reachFrom`). The area covers the porch from 0.9 m before the portal, the splay, the doorway (either side of the trumeau) and the halls. Its floor is 0 on the square, 0.15 and 0.3 on the portal's steps, 0.3 in the nave, and the choir's steps above that. |
| Seeing in and out | `client/src/world/inworld.ts`, `client/src/retro/retroPass.ts` (the `inWorld` hook) | The hall is its own scene, with its own lights and fog. It is drawn after the street and keeps the street's depth, so it shows only where the shell has a hole. See "Rendering" below. |
| Threshold | `cathedralInWorld.ts air()`, `shared/cathedralPlan.ts insideness()` | The blend k runs from 0 on the square to 1 about 7 m in (smooth over the porch and the doorway). The hall's fog blends from exactly the street's to its own dark air (near 16 m, far 105 m). Its ambient light blends from 60 % by day (the eye coming from the bright square) to full. Its lamps go into the psx glow slots while it is drawn. |
| Glass | `buildCathedral setDaylight(day, sky)` | From inside, the glass glows with the hour (0 at night, 1 from 9:30 to 15:30) and the weather (clear 1, mist 0.8, fog 0.7, rain 0.6, storm 0.5). The light shafts show only on clearer days. From outside the Blender glass stays as it was. |
| The hall's life | `client/src/game/landmarks.ts` | This is the same life as the old room (the server's `landmarkNow`: masses, confession, candles, the beadle's round, the chair woman, the organ, the M4 wedding at the rail, the Sunday sermon from the pulpit). It runs while Jef is within 200 m of the west door and in no other room (the hall's flames, lights and glass follow the hour all the time). People come in from the step on the square, walk through either half of the door to their places, and go out the same way. When Jef comes near, those already inside are placed at once. The organ, the altar bell, the sermon's caption and the whisper are heard and seen only in the nave. The street's sound is muffled and the church echo is on while Jef is inside (the soundscape's `setInterior("church")`); footsteps echo there too. |
| Keys inside | `landmarks.ts keys()` | No E is needed to go in. E sits on the chair at a row's end (Jef is carried in the hall's frame and the chair money is paid at mass), and E stands up. E kneels at the curate's confessional during his hours (the panel as before; Esc absolves and stands you up). F lights a candle at the Lady altar, E looks at a painting, the pulpit, the organ, the font or a grave slab, and E talks to anyone. Jef is not let into the choir: the rail and the screens stop him, and the clergy's gate is theirs. |
| Running | `server/src/landmarks/hush.ts`, `POST /api/landmark/ran`; `landmarks.ts updateHush` | Running is exactly as outside (3.4 m/s; the old room capped you at 2.3). The client sees Jef run (over 2.5 m/s for half a second, in the nave) with people near: 14 m, or 22 m during mass. It sends how many. The engine decides the rest. See "Running in the church". |
| Being put out | `landmarks.ts putOut` | At seven the sexton rattles his keys and Jef stands on the step. On the third offence the beadle comes down the nave and walks him out. While the door is shut to him (60 game minutes, `barred` in the cathedral's `now`), the beadle stands in the doorway and he is turned back. |
| Path check | `landmarks.ts pathPoints()` | `paths()` also checks, through the west door, the nave, a chair at a row's end, the curate's confessional, the candle stand, the communion rail, both triptychs, the pulpit and the ambulatory. It checks these while the door stands open (by day). |

## Running in the church (the engine's rules, `HUSH` in hush.ts)
- A run counts only if someone is near, Jef is inside, and the church is open. At most one run counts per 15 game minutes (5 real seconds).
- Strike 1 gets a hiss from a small set of engine lines: "No running in the house of God!", "Shh! There is a mass on!", "Walk, young man. The Lord is not in a hurry." ... Outside mass the lines are "Slowly in here. This is a church." and so on.
- Strike 2 gets the beadle: "I told you once. Walk, or you go out."
- Strike 3 (in a day): the beadle says "That is enough. Out you go, and come back when you can walk like a Christian." He walks Jef out, and the door is shut to him for an hour. A line goes in the log.
- The kerk's trust: -1 for a run during mass, and -1 outside mass only if 3 or more are looking. It is capped at -2 a day. The cap counts what was really lost (the trust stops at -5). Each loss is a line in the log. A new day starts afresh.
- The client's count is data, not orders: it is clamped to 0..60, and anything that is not a number counts as nobody.
- The bubble goes over the beadle if he is within 30 m and the line is his, otherwise over the nearest churchgoer. Everyone within 16 m turns to look for 3.5 s (seated people turn in the chair). No model call.

## Rendering (portal culling)
- The street is drawn first. Then each in-world room that shows is drawn over it with `autoClear` off, so the street's depth hides the room everywhere but through the shell's holes.
- Outside: a room is drawn only when one of its open openings is in the view frustum, seen from its outer side, within the street's fog and at least a few pixels big. There is no reach threshold of its own, and from outside the hall is fogged by the street's own fog, so it fades in exactly as the shell round it does. It is drawn only in the part of the view that the opening's box covers (camera `setViewOffset` plus a scissor, so three.js's own frustum culling drops what the opening cannot show). Otherwise the hall costs nothing.
- Inside (k 0.5 or more): the hall is drawn in full. The street is drawn only when an opening's inside box (the doorway, the tympanum's back and the open leaves) is in view, and then only in that part of the view. When no door is in view, the street is not drawn at all, and the rendering helper's culler is not even asked (`RetroPass`).
- `inWorld.visibility()` gives the renderer what it needs: `{ outdoors, outdoorsRect, inside, rooms }` from the last frame.

## No pops at the door (Steve: "I see a wall popping away and more detail loaded in while walking in")
Found by recording the walk: the eye moved from 25 m out on the square to 15 m into the nave and back, 10 shots a metre from 5 m before the door to 10 m in, 2 a metre further out. It went straight and turned 63 degrees to the side, with the rendering helper's culler on and off. Each pair of frames was compared in the page (the mean change per pixel, 0..255, and against the neighbouring pairs; the grain was held still).

- **The wall** was the Blender shell's own faces standing inside the hall:
  - the towers' ground-stage faces toward the nave and to the east, and their east corner buttresses;
  - the nave and choir walls, which came down to the ground at 6.6 m just behind the arcades, and ran across the transept;
  - the transept's side walls over the aisles.
  They were drawn with the street, so from the square and in the doorway they stood behind the arcades. At 6.4 m in, the street stops being drawn, and they vanished. They are now cut in `build_landmarks.py` (cathedral part only): the tower's inner and east ground faces and its buttresses there, and the other walls from the aisle roofs up. None of them showed from outside (`m7c_shell_outside`). The hall's wall along the tower's outer side now runs to the tower's east face (`TOWER_E`), so that face stays behind it. The spike at 6.3 to 6.4 m is gone: `m7c_pop_before` against `m7c_pop_after`.
- **Loading in**: the hall was drawn only within 95 m of the door, and its people and lights started there too. Now there is no reach (the street's fog fades it); the life starts at 200 m, and the lights and glass run all the time.
- **The culler** (world/cull.ts) does not hide the wall. With it on, there was one more spike before the fix (walking out, looking to the side, at -0.8 m: 14.6); after the fix it is gone with the culler on and off alike.
- **Light and fog** blend continuously with the eye's depth into the doorway; nothing switches at the change of mode.

| Walk (straight / turned; culler) | Worst change near the door, before | After | Worst spike (x its neighbours), before | After |
|---|---|---|---|---|
| In, straight, culler on | 7.48 (6.3 to 6.4 m) | 4.80 | 1.9 (6.3 to 6.4 m) | 1.5 (the step at 0.3 m) |
| In, straight, culler off | 7.31 | 5.26 | 1.9 (6.3 to 6.4 m) | 1.5 (the step) |
| Out, straight, culler on | 7.31 | 6.72 | 1.5 | 1.6 (the step at 1.2 m) |
| Out, straight, culler off | 6.93 | 6.77 | 1.8 | 1.6 (the step) |
| In, turned, culler on | 7.29 | 6.80 | 1.8 (8.5 to 8.6 m) | 1.3 |
| In, turned, culler off | 7.62 | 11.37 (a column passing close, 7.8 to 8.0 m: steady, not a spike) | 2.0 (8.5 to 8.6 m) | 1.4 |
| Out, turned, culler on | 14.62 (-0.7 to -0.8 m) | 6.86 | 1.5 | 1.3 |
| Out, turned, culler off | 6.55 | 6.40 | 1.3 | 1.4 |

The step-by-step change while walking is 4 to 10 on its own (the PS1 vertex snap moves everything a little each step). What is left above its neighbours is the eye climbing the portal's two 0.15 m steps, as on any step in the city.

## Frame time
`__scheldemist.perf(30)`, median of five, hidden headless Chrome at 1280x720 (render 480x270), clear weather at 10:00. Other helpers' servers were running, so the numbers are noisy by about 1 ms. "Before" is today's build at the start of this work: the instanced room, and the street with the shut door. "After" is with the rendering helper's culler off, which is fair against "before"; the culler-on numbers follow.

| View | Before | After | After, culler on |
|---|---|---|---|
| Outside at the west door, looking at it | 7.57 ms, 180 calls | 8.28 ms, 349 calls (7.64 ms, 260 calls with the hall not drawn: +0.6 ms for the nave through the door) | 10.4 ms, 292 calls |
| Outside, turned away from the door | - | hall not drawn: same calls as without it | - |
| Inside the nave, looking at the altar | 2.36 ms, 57 calls (the room) | 3.16 ms, 86 calls (the street not drawn; about 20 people inside) | 2.23 ms, 66 calls |
| Inside, looking out of the door | 1.69 ms, 27 calls (the shut door) | 9.87 ms, 544 calls | 11.67 ms, 510 calls |

Looking out of the door costs about what standing on the square costs: through the doorway you see the square and the houses round it. Only the doorway's part of the view is drawn, but that part still holds most of the Handschoenmarkt's chunks. Occlusion with the door's rectangle (the rendering helper's work) is the next saving. The hall itself is about 42k triangles in some 40 merged meshes; each person adds about 900.

## The reusable API (for the taverns next)
A building in the world is three things.

1. **An `InWorldRoom`** (`client/src/world/inworld.ts`), added with `inWorld.add(room)`:
   ```ts
   interface Opening {
     kind: "door" | "window";   // a window is seen through both ways and never walked through
     label: string;
     box: THREE.Box3;           // world: the opening and what shows through it from outside (porch, leaves, people on the step)
     inBox?: THREE.Box3;        // world: from inside, the part through which the street shows (the opening itself, open leaves)
     centre: THREE.Vector3;     // its middle
     out: THREE.Vector3;        // unit, horizontal, out of the building
     open(): boolean;           // a shut door or a shuttered window shows nothing
   }
   interface InWorldRoom {
     id: string;
     scene: THREE.Scene;        // the room's own scene: its group in world place, its lights, its fog; background null
     openings: Opening[];
     insideness(eye: THREE.Vector3): number;   // 0 outside .. 1 inside (the threshold blend)
     reach: number;             // metres from an opening beyond which it is not drawn from outside
     air(k: number, street: THREE.Fog): void;  // set the room's fog and light for this frame
     lamps(): Array<{ p: THREE.Vector3; w: number }>;  // its lamps for the psx glow
     scatter: number;           // psx in-scatter inside
   }
   ```
   `inWorld.plan(camera)` and `drawPlan(...)` do the rest. `RetroPass.inWorld` is set in `main.ts`, so every picture of the street includes the room: the frame, `shot`, `shotFrom` and `perf`.
2. **A `WalkArea`** (`client/src/world/rijnkaai.ts`), added with `world.addWalkArea(area)`:
   ```ts
   interface WalkArea {
     box: Rect;                                  // world box round it
     has(x, z): boolean;                         // is (x, z) the building's to answer (porch, doorway, rooms with their walls)?
     walkable(x, z): boolean;                    // floor, not a wall
     floor(x, z): number;                        // world height
     hits(x, z, r): boolean;                     // a body of radius r touches one of its solids
   }
   ```
   `has` must cover only the building's own footprint and porch, never the street. For a turned building, convert (x, z) into the room's frame inside these functions (the cathedral's frame is not turned).
3. **The life**: the people, the keys and the sound, as `game/landmarks.ts` does for the cathedral. It needs a "near" test to start and stop it, a "crossed the threshold" hook (the server's `here`, the room sound, a welcome), and sitting through the player's carriage mode (`rideStart` with a still anchor at the room's origin, and `rideSeat`).

For a tavern:
- Give its door an `Opening` like the cathedral's. Give each front window an `Opening` of kind "window": its box is the pane with a little depth, `inBox` the same, and `open()` true unless shuttered.
- The Blender or city house needs a hole where the door and the panes are, or clear glass.
- The taproom (`world/rooms.ts buildTavern`) is framed at the door already. It needs the house's real depth and width, and a plan like `shared/cathedralPlan.ts` so that walking and tests share it.
- Warm light through the windows at night comes from the room's own lamps; the street sees them through the glass.
- The street is drawn through the windows from inside only in the panes' part of the view.

## Checks (2026-09-24)
- `npm test`: 681 tests. The full run under load had two old tests time out at 5 s (`ballads.test.ts`, `population.test.ts`); run alone, both files pass (34 of 34). The new `server/test/cathedral-inworld.test.ts` has 15 tests:
  - the hall fits the shell: every wall corner lies inside the cathedral's footprint in `shared/city.json`; heights under the eaves; walls inside the aisle walls, the transept and the apse; the west wall behind the side portals' doors; the aisles' vaults over the arcades;
  - the doorway is the shell's door (x -262, z 149.5, 5.1 m wide, 6.08 m high); the side and transept portals lie where the hall's walls are;
  - the walk in: the porch joins the square across the portal's whole width. Jef reaches the nave, both halves of the door, the confessional's kneeler, the candle stand, the rail, the pulpit, both triptychs, the font, the ambulatory, both outer aisles, the transept's end, and every chair at a row's end. He does not reach the choir. The townspeople reach every mark and set of their parts, the clergy through the gate, and every point of their walking graph stands on free floor. At night nobody gets past the leaves. The threshold blend runs from 0 to 1;
  - running: nothing with nobody near, Jef outside or the church shut; -1 at mass, and not twice within the cooldown; the day's cap of 2; the beadle's second line; put out on the third with the door shut for an hour, then open again; a new day afresh; never below -5; outside mass one onlooker costs nothing and three cost 1; nonsense counts change nothing.
- `npm run build` passes.
- In the browser, on a test save only (`data/test-cathedral.sqlite`, a `.backup()` of `data/game.sqlite`; server on 9091, vite on 5491 with `data/vite-test-cathedral.config.mjs`, HMR off; my own headless Chrome over CDP), never on `data/game.sqlite`:
  - `__scheldemist.paths()` lists nothing, by day with the cathedral's inside points and at night without them;
  - walked in from the square with W: up the 0.15 m and 0.3 m steps, through the left half of the door, into the nave (a beggar stands before the right half: M6 lively's beggars' place);
  - ran down the nave during the low mass: 3.1 m/s after 1.8 s (the same run as outside). The bubbles read from the page: "Virginie Nijs: Shh! There is a mass on!", then "Pieter Dierckx, the beadle: I told you once. Walk, or you go out." The third time: "That is enough. Out you go ...", and Jef stood on the step, barred. The kerk's trust went from 0 to -2 and stopped there. The log had "ran_in_church" twice and "put_out" once;
  - a candle (300 to 298 c), a chair at a row's end (eye 1.48 m), the confessional (kneeling, eye 1.28 m, the panel; Esc stood him up), a look at the Elevation;
  - Sunday high mass: 41 people, the front rows full, the organ on. The model's sermon was preached from the pulpit line by line ("It has been a quiet week in our town ...");
  - at 18:30 the lit nave glows through the door on the dark square. At 19:01, with Jef inside: "The sexton rattles his keys: the church is closing ...", and Jef was on the step. The leaves closed, walking in stopped in the porch, and E read the shut door;
  - the town hall still opens as a room (`devEnter("townhall")`).
- Pictures (`data/shots/`, 1280x720): `m7c_square_day` (from the square, the nave through the door), `m7c_square_night` and `m7c_square_night_close` (the lit nave at dusk), `m7c_porch` (walking through the doorway: the leaves, the trumeau, the nave), `m7c_nave` (the nave from inside), `m7c_lookout` (the square through the door, under the organ gallery), `m7c_highmass` and `m7c_highmass_rows`, `m7c_sermon`, `m7c_run_bubble_page` (the beadle's bubble; a page screenshot, since bubbles are HTML), `m7c_door_shut` (the leaves shut at night), `m7c_pop_before` and `m7c_pop_after` (6.3 and 6.4 m into the doorway, before and after the pop fix), `m7c_shell_outside` (the trimmed shell from outside).

## Files
- New: `shared/cathedralPlan.ts`, `client/src/world/inworld.ts`, `client/src/world/cathedralInWorld.ts`, `server/src/landmarks/hush.ts`, `server/test/cathedral-inworld.test.ts`, `data/vite-test-cathedral.config.mjs`.
- Changed:
  - `tools/blender/build_landmarks.py`: `_portal(leaves=False)` for the central west portal; the shell's faces inside the hall cut (the pop fix); `client/public/models/landmarks.glb` rebuilt;
  - `client/src/world/landmarkRooms.ts`: `buildCathedral` rewritten from the plan; `LandmarkRoom.setDaylight(k, sky)` and `setAmbient`;
  - `client/src/game/landmarks.ts`: the cathedral in the world (its life near it, the keys, sitting and kneeling, the running reaction, putting out, dev);
  - `client/src/world/rijnkaai.ts`: `WalkArea` and `addWalkArea` (baseAt, isWalkable, wallNear, isFree, the walk's hits, the path check);
  - `client/src/retro/retroPass.ts`: the `inWorld` hook, and no culling when the street is not drawn;
  - `client/src/main.ts`: the InWorld, `attachWorld`, the room sound, the daylight for the glass, the footsteps' echo in the nave, `__scheldemist.inWorld`;
  - `client/src/net/landmarksApi.ts`: `ran`, `HushResult`, `barred`;
  - `server/src/landmarks/routes.ts`: `POST /api/landmark/ran`, `barred` on the cathedral's `now`.

## For the other buildings
Each needs:
1. A hole in its shell: a door with leaves hung in code, and clear or open panes for windows.
2. A plan fitted inside the shell, from the Blender numbers.
3. Its room built from that plan at the building's real place.
4. An `InWorldRoom` and a `WalkArea`.
5. Its life moved from "inside the room" to "near the building", as `landmarks.ts` now does for the cathedral.

The town hall, the Vleeshuis and the Steen have more than one storey (`Levels`). Their walk area needs the level Jef is on (the stairs' state), so `floor` and `walkable` would read it; the stairs work already. A turned building converts world points to its frame in the area's functions. The taverns are small and one-storeyed, but they need their house's real size and, for the windows, see-through panes in `city.glb`. Rough cost: a day per landmark, and the taverns together another day once the windows are open in the city model.

## Problems and open points
- **Main's commit 29d8fc9 took in my Blender change and the rebuilt glb** (the west door's hole) before the rest of this work was in. Until this work is committed, the committed game shows the hole with nothing behind it.
- **The rendering helper's culler** (world/cull.ts, their work in progress) threw errors in my tab for a while, and it costs 2 to 5 ms of CPU a frame. My checks ran with it off, and the table has both. Its `addCell(root, seen)` expects the room's things in the street's scene; the hall is in its own scene instead, so no cell is needed. The culler can read `inWorld.visibility()` (the street's rectangle through the door) to cull the street harder when Jef is inside.
- **Looking out of the door** draws the street through the doorway at the cost of standing on the square. The next saving is occlusion within the door's rectangle.
- The door leaves are dark oak in the portal's shade. Seen from a step away they are nearly black; they are lighter than the Blender doors of the other portals.
- **The instanced rooms are unchanged** for the town hall, the Vleeshuis, the Steen, the Oostershuis, the taverns and homes (checked: the town hall).
- **Townspeople in the street** vanish at the step and their inside figure appears there. Both are the same person, but a different model object; a brief overlap can show.
- **The porch's two steps** lift the eye 0.15 m at once each, as every step in the game does (player/firstPerson.ts, not changed).
- **The two houses at the west front** that were gone by 1873 are still in the Blender model, and they stand in front of the outer aisles' west walls (not my part).
- Not browser-checked: the M4 wedding at the rail in the world (the same roles and marks as before), vespers, and the organist's practice.

## Rerun
    npm test
    SCHELDEMIST_DB=data/test-cathedral.sqlite SCHELDEMIST_PORT=9091 node server/src/index.ts
    npx vite --config ../data/vite-test-cathedral.config.mjs   (from client/)

Take the test save as a `.backup()` of `data/game.sqlite`. Dev: `__scheldemist.landmarks.devEnter("cathedral")` puts Jef in the nave; `landmarks.hushInfo`, `landmarks.debug()` (`inWorld`, `jefIn`, `doorOpen`, `barred`); `inWorld.visibility()`, `inWorld.enabled`.
