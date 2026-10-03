# Scheldemist in Godot

The Godot game (Godot 4.7.2, C#, .NET 8). The plan and the decisions: `docs/godot-port.md`. The browser game in
`client/` is the model: a part is ported from its TypeScript, with the same numbers and the same words.

## Run it
1. Once: `npm run setup` in the repo root (the server and the bake need their packages), and a save
   (`data/game.sqlite`: start the server once).
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
  as a list, `Psx.SetSpill`; the six lamps whose glow hangs in the fog, `Psx.SetLamps`); `Rain.cs` the rain. A part
  that brings a real Godot light (Jef's lantern, a room's lamps) just adds it: the psx material takes it in `light()`.
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
- **The windows with people and things** (`src/Talk/`, from `game/talk.ts`, `pockets.ts`, `bubbles.ts`, `press.ts`,
  the bill and notebook of `ideas.ts`, the dice of `interiors.ts`). Other parts open them:
  `Talk.I.Open(id, name, title)` (E at someone; `shopOnly: true` for F at a seller), `Shop.I.Open(shopId)`,
  `Pockets.I.Toggle()` (I does it by itself), `Press.I.Read(item)`, `OpenBerg()`, `OpenPost()`, `OpenBill(id)`,
  `Dice.I.Sit(place, patron, first)`, `Bubbles.I.Show(convo)` and `Bubbles.I.Say(() => point, name, text)`. The
  hooks they leave for the parts not ported yet are named at the top of each file (`Talk.OnOpen`, `Work`,
  `OnTakeWork`, `OnReply`; `Bubbles.PositionOf`, `InfoOf`, `Speak`; `Dice.Sfx`).

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
