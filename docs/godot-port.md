# The Godot port

Steve, 2026-10-03: "we are going to port the game to godot. It keeps stuttering and in godot there is a much better
chance to run smoothly. The goal is to have everything working that works now and to be able to start it easily and
also let someone download and get it running with a simple install."

## Decisions
- **Engine**: Godot 4.7.2 with C# (.NET 8), Forward+ renderer. Steve picked C# (2026-10-03): the game's logic stays
  about as fast as it is now, and the TypeScript carries over nearly line by line. GDScript would be many times
  slower for 190 townspeople.
- **No web demo from the port**: Godot 4 does not export C# to a browser. The Three.js web demo stays as the old
  version (logged in `.claude/rule-overrides.md`).
- **The server stays**: `server/` (Node, the AI logins, the rules, the save, 1,391 tests) is not ported. The Godot
  game starts it in the background and talks to it over the same HTTP and WebSocket API as the browser does.
- **Where**: worktree `D:\Code\MoodyGame-godot`, branch `godot-port`, the Godot project in `godot/`. The browser
  game in `main` stays playable until the port can do what it does.
- **What changes for players**: someone who joins a shared game needs the download too (no browser tab). The look
  is rebuilt in Godot's shaders: close to the browser's, not the same pixel for pixel.

## The proof (2026-10-03)
The question before weeks of work: does Godot draw this town fast enough? `tools/godot/export-scene.mjs` runs the
browser game on a test stack in headless Chrome, measures five places (`frameProf`, 90 turning frames), and writes
the scene the game built to one glb (three's GLTFExporter; 300 MB, 2,303 visible meshes, 595 materials, 180
instanced kinds with 12,014 copies, 41 skinned people). `godot/spike/Spike.cs` loads it, puts the camera at the
same places and times 180 turning frames, 1600 x 900 window, 3D at 720 lines, no vsync, every person's bones moved
every frame. PCX, RTX 5090.

| Place | Browser: whole frame | Browser: drawing only | Godot, no mirrors | Godot, two mirror views | Godot p95 (mirrors) |
|---|---:|---:|---:|---:|---:|
| Vismarkt | 30.5 ms | 21.3 ms | 2.2 ms | 2.9 ms | 3.8 ms |
| Grote Markt | 27.7 ms | 18.3 ms | 1.6 ms | 2.8 ms | 4.2 ms |
| Cathedral | 29.5 ms | 19.3 ms | 1.5 ms | 2.6 ms | 3.8 ms |
| Handschoenmarkt | 29.3 ms | 19.0 ms | 1.5 ms | 2.6 ms | 3.9 ms |
| Rijnkaai | 31.3 ms | 21.7 ms | 1.5 ms | 2.6 ms | 3.7 ms |

Godot: 600-760 draw calls a frame without the mirror views, 1,400-1,790 with them. The whole 300 MB scene loads
in 2.8 s.

What the number does and does not say:
- It compares **drawing**. Godot draws the same meshes about seven times faster than the browser's drawing part.
- Godot's materials here are plain (lit per vertex, one sun, fog). The game's own shader does more per pixel
  (lamp spill, relief, wet, puddles), and the rooms behind windows are not drawn as extra passes. The real port
  will cost more than 3 ms; there is room for five times as much inside 16.7 ms.
- The game's logic (about 10 ms a frame in the browser) is not in the proof. In C# it can run beside the
  drawing on other cores; in the browser one core does all.
- The browser numbers are from headless Chrome and are higher than Steve's live game (16-20 ms, issue #32).
- The picture was looked at (`godot/spike/data/godot_*.png`): the town, the cathedral, the stalls and the paving
  are there. The house fronts show the whole atlas (the game's shader picks the tile; plain glTF cannot), and
  Jef's own head is in view. Both are look work for the port, not load.

Run it again: `node tools/godot/export-scene.mjs --root D:/Code/MoodyGame --out godot/spike/data/town`, then
`dotnet build godot`, then the Godot console program with `--path godot`. Use the real program in the WinGet
package folder: the `godot` link on the PATH does not find its .NET files ("Assemblies not found").
`godot/spike/data/` is not in git (300 MB).

## The steps
Each step ends with a run of the Godot game, pictures looked at, and the frame time at the five places.

| Step | What | From (browser client) |
|---|---|---|
| G0 | The proof above | done 2026-10-03 |
| G1 | The base: the game starts the server, loads the real models (Draco taken out at build time), the ground, quays and walk map from `shared/city.json`; Jef walks, collides, climbs, swims | `shared/`, `world/city.ts`, `world/rijnkaai.ts`, `player/` |
| G2 | The look: the psx shader (snap, affine, dither, 720 lines), fog, sky, day and night, weather, water, mirrors, lamps and spill, rooms behind real openings | `retro/`, `world/ambient.ts`, `mirror.ts`, `spill.ts`, the room files |
| G3 | The town alive: people, crowd, ways, animals, carts, boats, trains, cranes, the lock, omnibus | `game/town.ts`, `crowd.ts`, `lively.ts`, `world/boats.ts`, `railway.ts` ... |
| G4 | Play: jobs, goods, talk, shops, needs, map, book, menus, saves, the AI setup, events and the director's scenes | `game/`, `menu/`, `net/` |
| G5 | Sound | `audio/` |
| G6 | Play together | `net/mp/`, server `mp/` |
| G7 | The download: one file per system (Godot export with the server and Node inside), a double click starts it; the release Action | `tools/package.mjs`, `docs/release.md` |
| G8 | The checks: paths, shaders, stuck, props, perfcheck, the test kit, in Godot | `dev/` |

Size: the client is about 142,000 lines of TypeScript; `shared/` 12,000. The server (64,000) stays.
