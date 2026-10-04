# Scheldemist in Godot

The Godot game (Godot 4.7.2, C#, .NET 8). The plan and the decisions: `docs/godot-port.md`. The browser game in
`client/` is the model: a part is ported from its TypeScript, with the same numbers and the same words.

## Run it
1. Once: `npm --prefix server install` (or `npm run setup` if you also need the browser and bake tools).
   The game starts the server and makes a fresh save in your user folder on first run.
2. Bake the town: `node tools/godot/export-scene.mjs` (about 3 minutes; writes `godot/baked/town.glb`, `town.json`,
   `town_tex/` (with the dirt map and the sky map), `town_lights.json` (the lamps, the lit windows and their light on
   the street), 500 MB, not in git). Bake again when the browser's world code changes. `--ref-only --hour 21
   --weather rain` writes only the browser's picture and light numbers at that hour (and, with `--lights`, the lights).
3. Build: `dotnet build godot`.
4. Run: the Godot console program with `--path godot`. Use the real program in the WinGet package folder
   (`...\WinGet\Packages\GodotEngine.GodotEngine.Mono_...\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe`);
   the `godot` link on the PATH fails with ".NET: Assemblies not found".

Options after `--`: `--town <glb>` (or the environment variable `SCHELDEMIST_BAKE`) for a bake somewhere else,
`--shots <dir>` (a picture and the frame time at each baked place, then quit), `--no-<part>` and `--only a,b`
(game parts off).
Sound: `--audio <dir>` (or `SCHELDEMIST_AUDIO`) picks the existing recordings' folder; by default it is
`client/public/audio` beside this project. `--soundtest <absolute dir>` records every sound trigger and the
layers at three hours, in rain and in the great storm; writes `soundtest.wav` and `soundtest.json`, then quits
(1 if a check failed). The speakers stay muted after the recorder. Allow about eight minutes for the full run.
`--soundtest-only wiring,jef,rooms,life,layers` selects a shorter check. Always give tests their own `--db` and
`--prefs` files. Use absolute output paths: Godot's working folder is the project folder.
The server's options: `--server http://127.0.0.1:PORT` (use a server that runs already, start none), `--port N`
(the first port to try; default 8800), `--db <file>` (another save), `--no-ai` (the server makes no model calls:
walk-around mode), `--nettest <dir>` (the net part's own test: start the server with no AI, wait for the first
state, one tick, a picture with the HUD and `nettest.json` in `<dir>`, quit; the server is gone afterwards).
(game parts off), `--walktest <dir>` (Jef is walked along a few routes by script; what happened goes to
`<dir>/walktest.json` with two pictures a route, then quit; `--walkspeed 2` runs it faster, `--walkonly a,b` picks
routes), `--solidlazy` (make the walls near the camera only), `--city <json>` (`shared/city.json` somewhere else).
(game parts off). The townspeople: `--server http://127.0.0.1:PORT` (a running game server: the town comes from
it), `--hour 13.5` and `--day 1` (the clock), `--models <dir>`, `--walk <town_walk.json>`, `--peopletest <dir>` and
`--parade <dir>` (their checks, below).
(game parts off), `--hour 21 --weather fog|mist|clear|rain|storm` (the clock and the weather of the run),
`--snap <dir> --views "name:x,y,z,yaw,pitch,hour,weather;..."` (test pictures from chosen views, hours and weathers
in one run, with the frame time: `src/Dev/Snap.cs`), `--psx-off relief,ground,wall,shade,spill` (a psx feature left
out, to measure its cost).
state, one tick, a picture with the HUD and `nettest.json` in `<dir>`, quit; the server is gone afterwards),
`--talktest <dir> --no-ai` (the talk part's own test: every window opened and worked by script through the real
keys, a picture of each and `talktest.json` in `<dir>`, quit; `--talktest <dir> --talktest-ai` instead is one talk
with a typed line and a model's answer, two model calls). The browser's pictures of the same windows:
`node tools/godot/talk-refs.mjs --out godot/baked/talkref` (a test stack with no AI on 8954 and 5354).
The menus' options: `--prefs <file>` (the settings kept somewhere else than the player's own folder; the keys go
beside it), `--no-mainmenu` (no loading screen and no menus: the town at once, as before), `--menutest <dir>` (the
menus' own test, below). A run with `--shots` or another part's `--...test` has no menus either, and keeps the
picture as it was (720 lines, wobble on) whatever the player's settings say.

## Godot milestone checks (G8)

Run from the checkout, with its own installed server packages (`npm --prefix server install`):

```powershell
node tools/godot/checks.mjs --town D:/Code/MoodyGame-godot/godot/baked/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models
```

The runner builds C#, runs the console program once with `--headless --path godot --import`, then opens one game
window at a time. Each check gets a fresh town (seed 1873), no AI, a free port from 8980, and a four-minute timeout.
It removes its temporary save and stops its own processes even after a failure. It never copies a player's save
or bakes a town. Reports, logs and pictures stay under `godot/baked/checks/`, outside git. `summary.json` and the
short console table show PASS, FAIL or ERROR; any failure makes the runner exit 1.

Options: `--only paths,stuck`, `--out <dir>`, `--port 8990`, `--seed 1873`, `--timeout 240`, `--godot <console exe>`.
`--no-build` uses the last build and import. The Godot checks can also run directly, as options after `--`:

| Option | Report and coverage |
|---|---|
| `--devtest <dir>` | Four server-backed kit steps: time/weather/place, summon, take a chosen job, advance time. |
| `--paths <dir>` | `paths.json`: all job spots and current jobs' task points, server places/routes, home/work points, weekday/Sunday anchors, shop/stall fronts, current outside residents and city doors. Floods the baked 0.25 m body map from (10,12), with 0.36 m steps. `unreachable` must be empty. |
| `--stuck <dir>` | `stuck.json`: three Monday game hours (13:00–16:00), across the five perf places. Steps the real town/crowd part at 0.05 s per rendered frame. Samples every 0.25 s: 3 s within 0.3 m, or crowd bodies walking 8 s with over 3 m travelled but under 0.8 m net; also drawn bodies within 0.45 m and a 0.25 m body against Godot solids. Hidden planned rounds may legitimately repeat, so only their stationary test applies. |
| `--shaders <dir>` | `shaders.json`: first-frame material/shader kinds, later scene resources and kinds, psx shader count, total and hidden real lights. Visits five places at midday/clear, night/rain and dawn/fog. `problems` must be empty and light counts unchanged. |
| `--perfcheck <dir>` | `perfcheck.json`: the browser's five places, 90 standing frames, 90 turning frames (2 degrees/frame), six seconds walking per place. Mean, p95, draw calls, wall-frame time and walking displacement. The mean active main frame must be under 5 ms at every place. |
| `--clocks` | `clocks.json` under `--check-out <dir>` (or `--clocks <dir>`): every `liveClock`/`clock_face`/`clock_hands` marker; compare transforms and mesh vertices at 13:00 and 13:30. |
| `--interiors` | `interiors.json` under `--check-out <dir>` (or `--interiors <dir>`): every baked opening marker, three rays from outside through each opening, forced-open working door leaves. A room part can expose `Dev.IInteriorAuditSource` to identify its real room geometry. Missing room data fails the check, and triangle probes are marked diagnostic. |

The main-frame timer spans the first physics/process signal to `RenderingServer.FramePostDraw`, including
renderer submission and excluding the frame limiter. It is an elapsed-time bracket, not a CPU profiler or a GPU
finish fence. The wall-frame numbers record the entire interval between frames. Reports keep the browser's
`at`, `gpu`, `budget`, `rows` and per-place `liveMean`, `liveP95`, `stillMean`, `turnMean`, `turnP95`, `calls`, `ok`;
browser-only render-pass breakdowns are not invented.

For a manual test on a fresh save of your own, use `--no-ai --port 8980 --db <absolute test.sqlite> --dev
--no-mainmenu`. F9 opens a one-line console. `--dev-command` runs the same semicolon-separated commands at start:

```text
hour 13.5 clear; go vismarkt; summon fishwife
weather rain; go -118 36; clear
job {"type":"carry","items":2,"from":"pier_head","to":"crane_foot","goods":"crates"}
skip 10
```

`hour` and `weather` call `/api/dev/set`, `job` calls `/api/dev/job` and takes it through the normal jobs part,
and `skip` calls `/api/dev/advance`. `go` places Jef on nearby free physical ground; `summon` brings an existing
resident onto the crowd grid, facing Jef; `clear` releases summoned residents. The checks set midday/clear and
full needs before running. Each report lists its limitations under `notCovered`; a passing report does not cover
unported features. In particular, the fallback clock check proves motion, not correct hand angles. The interior
fallback cannot certify room floors, containment, seams, shader-only cutouts, or an unnamed pane of glass.

## How it is built
- **The baked town** (`src/World/BakedWorld.cs`). The browser game builds its world in code (67,000 lines). The bake
  runs that code and writes the scene it made: every node with its name and place, hidden ones marked, the copies
  of every InstancedMesh, each material's three.js kind and its psx options. Godot loads it at run time. A part
  finds its nodes by the names the TypeScript gave them (`Main.I.World.FindChild("omnibuses", true, false)`).
  What stands still needs no port; what moves or changes is ported and takes its nodes over.
- **The psx material** (`src/Render/Psx.cs`): the browser's `retro/psx.ts`. One shader per set of switches
  (`Psx.Kind`), shared; the rest are uniforms. The values every material reads are global shader uniforms
  (`psx_*` in `project.godot`), set once a frame, like the browser's `psxUniforms`. A new feature is a switch in
  `Kind` or a uniform, not a new shader file.
- **The light over the day** (`src/World/`): `Daylight.cs` is the clock's and the weather's light (the fog, the sky's
  two colours, the sun's way, the rain, the wet, the puddles: `Daylight.I.SetTime(hour)`, `SetWeather(name)`; the
  other parts read `Hour`, `Night`, `LampsLit`, `FogColor` ...); `Sky.cs` the cloud dome; `Lights.cs` the gas lamps,
  the lit windows and their light on the street (no Godot light: the nearest 48 sources go to every lit psx material
  as a list, `Psx.SetSpill`; the six lamps whose glow hangs in the fog, `Psx.SetLamps`; past the 48 the ground pools
  and the far glow, `Lights.Far.cs`; the lamplighter's word, `Lights.I.SetLampLit("d12", true)`); `Rain.cs` the rain
  (none under a roof) and `RainSheets.cs` the great storm's far rain; the great storm itself
  `Daylight.I.SetStorm(0..1)` (world/tempest.ts's look: the air, the rain, the river, the clouds, the trees' lean).
  A part that brings a real Godot light (Jef's lantern, a room's lamps) just adds it: the psx material takes it in
  `light()`.
- **Water, mirrors, rooms** (`src/World/`): `Waters.cs` the river's sheet at the tide, the docks and the lock at
  theirs; `Mirrors.cs` the river's and the puddles' mirror (the pond's in the park); `Rooms.cs` every room inside its
  shell, lit by its own hours (asked of the server every 15 s; `Rooms.I.SetOpen(id, open)` for a part that knows
  sooner), its glass and its door's transom by the hour.
- **The town's look and life in the air** (`src/Render/Grime.cs`, `src/World/`): the houses' wall pictures, grime,
  wall bumps and grime decals; the bump maps; `Trees.cs` the falling leaves (the sway and the gale are the psx
  material's); `Fires.cs` the open fires (`Fires.I.Create(spots, smoke)` for a burning house); `ChimneySmoke.cs`;
  `Mist.cs` the river mist; `Blobs.cs` the soft shadows under walkers and carts (`Blobs.I.Set("people", spots)`, a
  part's spots once a frame).
- **The screen** (`src/Main.cs`, `shaders/retro.gdshader`): the world is drawn at 720 lines into `Main.I.View`,
  then full screen through the retro pass (grade, grain, dither).
- **What is solid** (`src/World/Solid.cs`): Jef walks on Godot's physics (Jolt) over the baked meshes themselves.
  Left out, as the browser leaves them out: hidden nodes, glows, decals, leaves, the water's sheets, litter, and the
  frozen copies of what moves (people, animals, boats, vehicles: their parts bring their own). A part that puts a
  solid thing in the world gives it a body on `Solid.Layer`. The whole town is made solid while loading (1.9 s).
- **Jef** (`src/Player/Jef.cs`): the browser's `player/firstPerson.ts` with the same numbers. His body is solid
  from a step (0.36 m) over his feet up to 1.75 m; his feet stand on the highest thing under them that is no more
  than a step up, so kerbs and stairs are walked and anything higher is a wall. Water is where
  `shared/city.json` says (`src/World/Water.cs`), at the tide's level (`src/World/Tide.cs`, the browser's
  `world/tide.ts`); the ways out of it are in `src/World/QuayExits.cs`; vaulting is `shared/mantle.ts`
  (`src/Player/Mantle.cs`). F is the free camera. Other parts read `Jef.I` (X, Y, Z, Yaw, Swimming, the events).
- **Game parts** (`src/GamePart.cs`): a Node class with `[GamePart(order)]` is made and added under Main when the
  town is in. A new part is a new file under `src/<Area>/`; it reaches the rest through `Main.I` (`View`, `World`,
  `Cam`, `Ui`, `Arg`). No edits to `Main.cs` for a new part.
- **The models** (`src/Models/ModelLibrary.cs`). Godot 4.7 does not read Draco, and every glb in
  `client/public/models/` has it: `node tools/godot/models.mjs` writes them plain into `godot/baked/models/` (not
  in git). `ModelLibrary.Get("people", look)` reads a file once, makes its materials psx materials the way that
  model's loader does in the browser (`Look`), keeps it and hands out copies that share meshes, skins and materials.
- **The townspeople** (`src/People/`, `src/Town/`). `Human` is `game/humans.ts` (a copy of a kind of people.glb with
  its own skeleton, the shared clips by bone name). `Townspeople` (a game part) is `game/town.ts`: every resident
  lives by the clock; at most 50 near the camera are walked by `Crowd` (`game/crowd.ts`: the walk grid, A*, keep
  right, bodies keep apart). `Whereabouts` is the server's `town/whereabouts.ts` and `schedule.ts` in C#: the same
  sum as the server's town map and the browser, so no frame waits on the network; the town (`/api/town`) and the
  ways on foot (`/api/town/ways`) are fetched once in the background. The clock is `--hour` until the game state
  part calls `Townspeople.SetClock(day, hour)`; the player's body comes through `Townspeople.PlayerBody`.
  `WalkMap` is where a body can walk and how high the ground is: the browser world's own answers, dumped by the
  bake (`town_walk.bin`, `town_walk.json`; `node tools/godot/export-scene.mjs --walk-only` for these alone).
  Checks: `--parade <dir>` (every kind in rows, each row a clip), `--peopletest <dir>` (the Vismarkt and the Grote
  Markt at a busy hour: pictures, counts, the frame time with and without the people; with
  `node tools/godot/wherecheck.mjs --server ... --out <dir>/where_expected.json` first, the C# sum against the
  server's own for every resident).
  Round two adds doorstep cats and dogs (`Animals`), birds and squirrels (`ParkWildlife`), the server's
  `/api/lively` door routines, children's games and market browsing (`StreetLife`). `HallPeople` polls each
  nearby landmark's server roster and uses its shared room marks, seats and walking graph. `HallFloors` supplies
  plain supporting floors and stair treads absent from the static bake; disable it with `--no-hallfloors` when
  the full rooms part supplies them. `tools/godot/peopledata.mjs` copies these plans without rebaking.
  Hooks: `HomeVisitors.I.Visit(homeId, serverPerson)` shows a home visitor for fourteen seconds; passing null
  dismisses them. `HomeVisitors.SpotFree` lets the homes part account for placed furniture. `Townspeople.DoorAt`
  belongs to the doors part; `MadonnaAt` supplies the street scenery's prayer spots. `ParkWildlife.Feed`,
  `HuntTarget` and `Boats` connect feeding, cats and passing boats. Bubble and map positions include room figures.
  `--peoplechecks reference` waits for the server comparison file. Read the game's printed server URL before
  generating that file: another helper may already occupy the requested port. The file must have the same town
  seed. `--peopleadvance` sets the test's server to Monday 13:00 through its dev route. `--peoplechecks halls`
  checks the five landmark rosters and a home visitor; `homevisit` checks the visitor alone, `wildlife` the birds,
  `marketstalls` the open and covered displays, `families` the server's strangers and Zelie's table, and `crowds`
  the two squares alone. `games` takes a close picture of each of the six children's games and checks a home
  visitor's clearance from Jef. A walker waiting at the first four-second check gets twelve seconds to complete a
  detour, arrive or leave the view; the report names anyone still blocked. For isolated test towns pass
  `--db <test-directory>/people.sqlite` so checks use their own database.
  The complete test checks all 50 drawn bodies and fails for overlaps, a missed bird flight, mismatched sums or
  people-and-animal frame cost of 1.5 ms or more. Unrelated live route requests may still be pending after every
  comparison answer matches.
  Checked 2026-10-04 after merging the current parts: 5,364 of 5,364 server answers matched, including seven
  cart-run answers; 50 drawn at both squares, zero overlaps and blocked walkers. With active hall rosters,
  people and animals cost 1.033 ms at the Grote Markt and 1.083 ms at Vismarkt. The five halls drew 2, 4, 7, 5
  and 4 people respectively (town hall,
  Vleeshuis, Steen, Oostershuis, cathedral). Wildlife: 74 animals, the pressed duck walked off then flew.
  Remaining: complete game and street props, window gossip, menace and dream presentation,
  home-remark wiring, dressed and lit rooms, higher-floor/event cathedral
  roles, capture ecology, dog mess, market scraps and multiplayer animal states. Homes have visitor support
  and floor plans, but their full interior shells still need drawing. Horses and people aboard vehicles stay
  with the movers part. Thief routes exist; theft outcomes, event scenes and director actions await their parts.
  `MarketStalls` now replaces the frozen `town_stalls` group. Keepers' schedules open and cover each display;
  the shop-front layout follows `shared/shopFront.ts`, and copies of each model are batched. The close day/night
  test (`--peoplechecks marketstalls`) found 25 tables, 20 open at 13:30 and none open at 22:00; rebuild 0.253 ms.
  Open sacks currently use the common sack's closed shape; awning cloth variants still need their full palette.
  `FamilyPeople` patches the server's strangers' names and schedules, draws Zelie's table and cards, and opens
  a visiting relative's talk when Jef is nearby and free. `ActionReceived` passes family director messages to
  later presentation work. The close family test patched five visitors and drew the table. The table and all
  stall displays have solid bodies and close their footprints in `WalkMap`; the local crowd grid is rebuilt.
  `--peopletest` measures allocations with `GC.GetAllocatedBytesForCurrentThread()` around each people part,
  over 600 frames per square after the requested day-plan ways have arrived. `townBytesPerFrame` covers the
  schedule, crowd, lantern pool, indoor figures and lantern materials; `allPeopleBytesPerFrame` also covers
  posted figures, animals, wildlife, halls, home visitors, stalls and families. The report includes mean,
  median, p95, maximum and the count of zero-allocation frames; collection counts cover the whole managed game.
  In the complete run the town averaged 6.893 B/frame at Grote Markt and 6.947 at Vismarkt, with zero median and
  p95 in both places. All people and animals averaged 17.373 and 12.480 B/frame respectively; 562 and 565 of
  600 frames allocated nothing. One Gen 0 and one Gen 1 collection occurred per sample across the game; the
  maximum town update was 2.924 ms at Grote Markt and 1.127 ms at Vismarkt. First-use models and new server replies can
  still allocate when the roster changes. `townAllocationPartsMean` orders the schedule, crowd, lights, rooms and
  lantern materials. Route searches, roster selection, frustum planes and stall batches reuse their buffers.
  `WhereNow` returns a resident's reused result; copy its fields when retaining them across another query.
  Crowd positions and collision checks run every frame; bone animation runs at 120 Hz within eight metres,
  60 Hz within 25 metres, then 15 and 8 Hz farther away. Home visitors leave at least 0.9 m around Jef.
  `Game/Actors.cs` reserves residents and sends them to the server's event rings and columns;
  `Game/Events.cs` presents stage props, sound cues, map marks and stall closures. Hearses, lead dress,
  fire and hiring scenes, and family menace choices use the existing people and paper hooks.
  Remaining parity work and the bounded `--eventtest <dir>` check: [events handoff](../docs/godot-events.md).
- **The server stays in Node** (`server/`): the game talks to it over the same HTTP and WebSocket API as the
  browser (`client/src/net/api.ts`).
  - `src/Net/ServerProcess.cs` starts it with the game (`node src/index.ts` in `server/`, a free port from 8800,
    never 8787 or 5173: Steve's own game) and stops it with the game, its whole process tree (on Windows a job
    object: the server ends even when the game is ended by force). Where Node and the server are is in one place,
    `ServerPaths`: a checkout, or later the download's `runtime/` and `server/` beside the program. Its log:
    `data/godot-server.log`. It does not come up in 90 s: the reason shows on screen.
  - `src/Net/Api.cs` is the client: every call of `api.ts` with a time limit, and the push channel (`/ws`) that
    comes back by itself. `await ServerLink.I.Api.Jobs()` from the main thread goes on on the main thread; the
    push events and `Api.Run(call, ok, fail)` are handed over there too. The payloads are records in
    `src/Net/Payloads.cs` (the server's snake_case names).
  - `src/Net/ServerLink.cs` is the part that holds both (`ServerLink.I.Api`, `ServerLink.I.WhenUp(...)`), feeds
    the store, and asks for the clock's tick every 10 s while Jef plays.
- **The store** (`src/Game/GameState.cs`): what the server last said, for every part: `GameState.I.HourF` (the
  running clock), `.Day`, `.Weekday`, `.Weather`, `.Food` ..., `.Money`, `.Pockets`, with events
  (`ClockChanged`, `WeatherChanged`, `NeedsChanged`, `MoneyChanged`, `Message` ...). `GameState.I` is never null:
  before the server has spoken it holds 13:00 on a clear Monday and `Live` is false. The player's part sets
  `PlayingWhen` (time runs only while Jef plays), the rooms' part `Where` (the cold).
- **The HUD** (`src/Game/Hud.cs`): the browser's papers as Controls under `Main.I.Ui`, the CSS sizes times the
  browser's `--ui`. A line in the middle of the screen: `GameState.I.Say("...")`. Fonts: `Fonts.Hand`,
  `Fonts.Print` (`godot/fonts/`, the browser's own faces).
- **The town map** (`src/Game/TownMap.cs`, `MapIcons.cs`, `MapBase.cs`): the browser's paper map (`game/map.ts`,
  `mapIcons.ts`). M opens it; M, E or Esc close it. The city's picture is drawn once from `shared/city.json` on
  another thread; the badges are drawn once into one picture. Closed it costs nothing; open, a drawing takes about
  0.5 ms, twice a second and while the map moves. The kinds turned off are kept in `user://map.json`.
  - `TownMap.I.Open`, `.Toggle()`, `.Show()`, `.Close()`, `.OpenChanged`: the window. `CanOpen = () => ...` says
    whether M may open it now. A window stack that sends the keys itself sets `OwnKeys = false`.
  - `TownMap.I.AddMarks(() => marks)`: more marks (events, the employers' boxes, people with work).
    `JobMarks = () => marks` and `WayGoal = () => where`: the job's step and where the dotted way leads, from the
    part that runs the job (until then a guess from the store's jobs). `PersonAt = id => where` for people with
    work. `SetMovers(list)`: omnibuses, ships, trains (the browser's map shows none; here a small dart each).
- **Finding the way** (`src/World/Ways.cs`): `Ways.Path(from, to)` gives the corners of the way on foot between two
  places, (x, z) in world metres, or null; `Ways.Length(path)`, `Ways.PointAlong(path, d)`, `Ways.Flags(x, z)`
  (Wall, Water, Outside), `Ways.Open`, `Ways.Reachable`, `Ways.NearestOpen`. It reads the walk map picture
  (`client/public/city/walk.png`) and searches as the server does (`server/src/town/wayfind.ts`, `ways.ts`,
  `walkmap.ts`): the same ways, with no call to the server. Safe from any thread; `Ways.Warm()` reads the map ahead.
- **The map's test**: `-- --no-ai --maptest <dir>` opens the map with the M key, moves and zooms it, points at
  places, clicks a kind off and on, shows a way, closes it, and writes pictures and `maptest.json` to `<dir>`.
  `--mapat x,z,yawDeg` stands where the browser's picture was taken: `node tools/godot/map-ref.mjs` makes that
  picture (a test stack and headless Chrome) and prints the place.

- **The dialogs** (`src/Ui/Dialogs/`): the browser's `game/dialogs.ts` and `game/cursor.ts`. `Dialogs.I` is a
  stack: the keys go to the dialog on top and to nothing under it, each dialog closes on its own keys (E and Esc
  for most), the mouse is free as the quill while one is up and taken again after. A dialog is a class with
  `IDialog` that calls `Dialogs.I.Open(this)` and `Close(this)`; its paper is a `Sheet` (`Paper.cs`): CSS sizes,
  the sepia filter, lines with a number badge and keys in a keys line that can be clicked. The player's part reads
  `Dialogs.I.Any` (Jef stands still, and the game still plays); the menus' part sets `KeyLabel` and `Remap`
  (changeable keys) and asks `Escapable` before Esc opens the menu.
- **Jobs and the day by hand** (`src/Play/`, from `game/jobs.ts`, `goods.ts`, `runs.ts`, `day.ts`,
  `sleep.ts` and the trouble card in `ideas.ts`): the prompt registry (`Interact.I.Add`), automatic doors,
  carry/watch/deliver jobs, the job board, task card and quest book on the shared paper kit. E talks to a
  townsperson; the talk and press offer work through `Jobs.I.TakeJob`. The map gets the followed job's marks
  and way. `MainMenu.WorldReplaced` restores the run and goods. Pockets belong to `Talk/Pockets.cs`; bought
  drinks are taken at the counter, as the server decides. `Play/Day.cs` owns the sleep chooser, fade and chosen
  rest; `Game/DaySheets.cs` owns the tick's collapse, midnight, waking and week-ending papers, and rent.
  The chosen rest sets `DaySheets.SleepShown`, so its wake lines are said once. `Day.I.AddBench` and `WakeHome` serve the places' parts; `Jobs.I.Sfx`
  serves sound. The trouble speaker's walk-up uses `Trouble.I.Present` / `Show(view)` when before Jef.
  Run `-- --jobtest <dir> --no-ai --port 8965 --db <dir>/test.sqlite` against a fresh test database,
  with `--town` and `--models` pointing at the shared bake. It writes pictures, server replies and
  `jobtest.json`, then quits (1 on failure). `--jobonly prompt,door,carry,deliver,watch,trouble,day` narrows it;
  trouble is exercised during watch. Results and remaining work: [jobs report](../docs/godot-jobs.md).
- **The windows with people and things** (`src/Talk/`, from `game/talk.ts`, `pockets.ts`, `bubbles.ts`, `press.ts`,
  the bill and notebook of `ideas.ts`, the dice of `interiors.ts`). Other parts open them:
  `Talk.I.Open(id, name, title)` (E at someone; `shopOnly: true` for F at a seller), `Shop.I.Open(shopId)`,
  `Pockets.I.Toggle()` (I does it by itself), `Press.I.Read(item)`, `OpenBerg()`, `OpenPost()`, `OpenBill(id)`,
  `Dice.I.Sit(place, patron, first)`, `Bubbles.I.Show(convo)` and `Bubbles.I.Say(() => point, name, text)`. The
  hooks they leave for the parts not ported yet are named at the top of each file (`Talk.OnOpen`, `Work`,
  `OnTakeWork`, `OnReply`; `Bubbles.PositionOf`, `InfoOf`, `Speak`; `Dice.Sfx`).
  `Fonts.Print`, `Fonts.PrintItalic`, `Fonts.Slab`, `Fonts.Mono` (`godot/fonts/`, the browser's own faces).
- **The paper kit** (`src/Ui/`): what every screen of paper and ink is built from, the browser's `menu/menu.css`
  carried over. Sizes are CSS pixels: `Kit.Px(16)` is 16 CSS px at the window's scale (the CSS `--ui`, times the
  Text size setting); a screen builds itself in real pixels and builds again on `Kit.LookChanged`.
  - `Kit` (`Kit.cs`): the colours (`Kit.Paper`, `Kit.Ink`, `Kit.Rust` ...), and the makers of small parts:
    `Kit.Text(...)` a line, `Kit.Rich(...)` a paragraph with bold and italics, `Kit.Para(...)`, `Kit.Heading(...)`,
    `Kit.Row(label, control, note)` a setting's row, `Kit.Side(a, b)` controls side by side, `Kit.Input(...)` a
    text box, `Kit.Rule(width)` the printer's rule, `Kit.DrawCaps(...)` small caps, `Kit.Picture("res://ui/x.jpg")`.
  - `PaperCard`: a piece of paper with its content (kinds: `Plain` the old cards, `Title`, `Sheet`, `Boot`), with
    `Pad(left, top, right, bottom)` and `Tilt`. A Godot container takes a child's turn away: centre a tilted paper
    with `new Centred(card)`, not a CenterContainer.
  - `InkButton`: every button (`Look.Btn`, `Primary`, `Seg`, `Tab`, `MenuItem`, `MenuPlay`, `KeyCap`, `Chip`,
    `ModeCard`, `Swatch`, `Plain`); `Seg` a row of choices; `Tick` on and off; `InkSlider`; `Select` a list to
    pick from; `KeyedText` a paragraph with keys drawn in it (`"{E} use"`).
  - `Sheet`: a paper in the middle with a head, a scrolling `Body` and a `Foot`; `AddBack()` gives "Back [Esc]".
  - `Dialogs`: the stack (`Dialogs.Open(sheet)`, Esc closes the top one, the keys move in it: Up and Down from
    control to control, Left and Right change a choice) and the list of the game's own dialogs
    (`Dialogs.Register("talk", () => open, close: Close)`): while one is up in play the mouse moves the ink quill
    (`InkCursor`) instead of the view, it cannot leave the window, and Esc closes the dialog, not the game.
- **The menus** (`src/Menu/`, the browser's `menu/`, `boot/loader.ts`, `game/pause.ts`, `saves.ts`, `prefs.ts`):
  - `Loading`: the loading screen. Main shows it first, reads the town beside the main thread, and the card follows
    the real steps (the town's file, the scene, the materials counted, the server's first state, the first frames).
  - `MainMenu` (a game part): the handbill, into the game and out of it. `MainMenu.I.Entered`, `.InPlay`, the
    events `WalkedIn` and `WorldReplaced(how, client)` (a save loaded, a new week: every part starts again from
    the server). A part that takes pictures of the bare town runs with `--no-mainmenu`.
  - `Pause`: reasons to be paused ("menu", "key", "saving", "loading"). Paused: the scene tree stands still and the
    server's gate is shut (`POST /api/pause`). A node that must go on sets `ProcessMode = Always`.
  - `Prefs` (the settings, `user://settings.json`), `Keys` (the bindings, `user://keys.json`), `Apply` (what each
    setting does: the list is at the top of `Apply.cs`), `Tuning` (mouse speed, head bob, view distance, bubble
    size, for the parts that use them). Ask for a key by its action: `Keys.Is(e, "use")`, `Keys.Down("forward")`,
    `Keys.Label("use")`.
  - `Saves` (the list, save, load, Continue, autosaves; `Saves.Capture` is the walking part's hook for what a save
    keeps of Jef), `SettingsSheet`, `AiSheet`, `Sheets` (Help, Credits, New game, Quit), `CharacterSheet` with
    `Character.cs` (the port of `shared/character.ts`: keep the two in step). `CharacterSheet.MakePreview` is the
    people's part's hook for the turning figure; until then a flat dummy in the chosen colours stands there.
  - The test: `-- --no-ai --port 8953 --db <dir>/menutest.sqlite --prefs <dir>/settings.json --menutest <dir>`
    walks through every screen by script, checks what each step did, saves a picture of each and `menutest.json`,
    and quits (1 when a check failed). The browser's pictures to lay beside them:
    `node tools/godot/menu-refs.mjs --out godot/baked/menu-ref`.

## Rules
- The engine owns all numbers; the Godot game shows them and asks the server, as the browser does.
- Colour: three.js gives a matt face `colour x intensity / pi`; Godot gives `colour x energy`. A three.js light of
  intensity I is a Godot light of energy I / pi. Hex colours are sRGB: `.SrgbToLinear()` before a shader gets them.
- three.js and Godot share the axes (y up, -z ahead, metres): positions and quaternions carry over as they are.
- Light counts do not change at run time (dim with energy 0), as in `docs/rendering.md`.
- Every step ends with a run: a picture looked at, and the frame time at the baked places (`--shots`). The budget
  is 16.7 ms a frame on PCX with everything on.
- Comments say what the code is for, in the plain English of the rest of the repo; name the TypeScript file a part
  comes from.

## Together (net part, round two)

The handbill's Together paper hosts a game for the house, shows the address and code, joins another host,
and lets a guest go home. Each PC needs the Godot download; no models are fetched from the host.
The first join needs the address and code; a remembered guest token lets later visits use the address alone.
`Together.I.Host()`, `Join(address, code, name)` and `Leave()` are the other parts' public calls.
A code alone passed to `Join(code)` applies to the server this game already knows; it cannot locate another PC.

Test with the console program (all paths after `--`):

```
-- --town D:/Code/MoodyGame-godot/godot/baked/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models --no-ai --port 8974 --mptest <absolute-output-dir>
```

It starts a Godot host and a second Godot guest, walks both by `Jef.SetKey`, checks the pause and separate
player state, saves `mp_host.png`, `mp_guest.png` and `mptest.json`, returns the guest to its own game, and
quits both. The databases and test token are disposable and deleted; no existing player save is opened.
The guest's own server after leaving starts at the host test's port plus one (or the next free port).
The test also makes and animates a fresh body after returning home, to check that no model from the old scene is reused.
`--host` and `--join <address> --seat 2 [--code CODE --name Anna]` also work outside the test.

The menu check is `--togethertest <dir> --db <fresh-test.sqlite> --prefs <dir>/settings.json --port 8980 --no-ai`.
It checks the handbill, join fields, hosting, no pause together and all three remote gear models.
Details, measurements and remaining hooks: [net part handoff](../docs/godot-net.md).
## Make a player download

Use Node 24, .NET 8 and Godot 4.7.2 Mono with its export templates installed. Work from this checkout:

```powershell
node tools/godot/package.mjs --baked <shared-bake-folder> --godot <Godot-console-exe>
```

The bake folder holds `town.glb`, `town.json`, `town_tex/`, `town_lights.json`, `town_walk.json`, `town_walk.bin`
and decoded `models/`. The script never bakes. `--baked` defaults to `godot/baked`; `--godot` defaults to `GODOT`,
then the WinGet Mono console program on Windows, then `godot` on other systems. It exports, compiles the existing
server to JavaScript, installs production packages and bundles the same Node that installed SQLite. It writes a
zip and a component size report under ignored `godot/dist/` (`--out <folder>` changes that; `--version <name>`
names it). Run on Windows x64, Linux x64 or Apple silicon macOS so native packages match the bundled Node.

A player unzips the whole folder and double clicks `Scheldemist.exe` on Windows, opens `Scheldemist.app` on macOS,
or runs `Scheldemist` on Linux. No Godot, .NET or Node install is needed. Keep its companion folders together.
The server starts and stops with the game. Saves, slots, settings, keys, map preferences, AI setup and server logs
live in the player's own Scheldemist user folder (`%APPDATA%/Scheldemist` on Windows), never beside the executable.
`Paths.cs` resolves source, exported and user files. `--town`, `--models`, `--city`, `--db`, `--prefs` and `--port`
still work; `SCHELDEMIST_USER_DATA=<folder>` isolates all game-owned writable files for a check. Godot's own
engine log uses `user://logs/godot.log`; its native `--log-file <file>` option isolates that too.
`SCHELDEMIST_MAP_PORT=<port>` picks the host's town-map port for an isolated run (normally the game port plus 1000).

Windows packaging and a real unpacked launch, server, save and menu check passed on this PC. The zip is about
383 MB, 1.14 GB unpacked; the bake and models take most of it. Linux and macOS game exports passed, but full
player packages and launches still need checks on those systems. The Mac preset uses the universal template;
its package's Node is Apple silicon. Proof and repeatable commands: `docs/godot-download-check.md`.

The download has no browser client, multiplayer download helper, AI software, logins or keys. Sound files are
included; the G5 sound code and other G3/G4/G6 game parts arrive when their worktrees merge. This is the current
port, not yet the full browser game. The draft `.github/workflows/godot-release.yml` builds zip artifacts on `v*`
tags, with an agreed shared bake supplied by URL and SHA-256; it does not bake or publish a Release.
