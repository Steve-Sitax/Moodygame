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
(game parts off). The townspeople: `--server http://127.0.0.1:PORT` (a running game server: the town comes from
it), `--hour 13.5` and `--day 1` (the clock), `--models <dir>`, `--walk <town_walk.json>`, `--peopletest <dir>` and
`--parade <dir>` (their checks, below).

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
