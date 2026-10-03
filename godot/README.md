# Scheldemist in Godot

The Godot game (Godot 4.7.2, C#, .NET 8). The plan and the decisions: `docs/godot-port.md`. The browser game in
`client/` is the model: a part is ported from its TypeScript, with the same numbers and the same words.

## Run it
1. Once: `npm run setup` in the repo root (the server and the bake need their packages), and a save
   (`data/game.sqlite`: start the server once).
2. Bake the town: `node tools/godot/export-scene.mjs` (about 2 minutes; writes `godot/baked/town.glb`, `town.json`,
   `town_tex/`, 500 MB, not in git). Bake again when the browser's world code changes.
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
