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
(game parts off), `--hour 21 --weather fog|mist|clear|rain|storm` (the clock and the weather of the run),
`--snap <dir> --views "name:x,y,z,yaw,pitch,hour,weather;..."` (test pictures from chosen views, hours and weathers
in one run, with the frame time: `src/Dev/Snap.cs`), `--psx-off relief,ground,wall,shade,spill` (a psx feature left
out, to measure its cost).

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
- **Game parts** (`src/GamePart.cs`): a Node class with `[GamePart(order)]` is made and added under Main when the
  town is in. A new part is a new file under `src/<Area>/`; it reaches the rest through `Main.I` (`View`, `World`,
  `Cam`, `Ui`, `Arg`). No edits to `Main.cs` for a new part.
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
