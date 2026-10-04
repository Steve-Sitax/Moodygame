# The Godot port: where it stands (2026-10-05)

Start here in a new session about the Godot game. The plan and decisions are in [godot-port.md](godot-port.md); how to
build, run and test is in [godot/README.md](../godot/README.md).

## Where things are

- The port is in `main` (merged 2026-10-05). The Godot project is `godot/`; the server in `server/` is shared with the
  browser game. The browser game still works (all 1,395 tests pass; [godot-browsercheck.md](godot-browsercheck.md)).
- The checkout `D:\Code\MoodyGame-godot` (branch `godot-port`) is the same code. New work: branch from `main`.
- The bake (the browser's world exported for Godot) is `godot/baked/next/` (town.glb, its side files) with the decoded
  models in `godot/baked/models/`; not in git. Bake again with `node tools/godot/export-scene.mjs` when the browser's
  world code changes (about 10 minutes).
- Godot 4.7.2 Mono: use the console exe in the WinGet package folder, not the `godot` link on the PATH.

## How to test it

- The player download: `node tools/godot/package.mjs --baked <folder with the next bake and models/>` writes a zip to
  `godot/dist/`. Unzip, double click `Scheldemist.exe`. Saves and settings go to `%APPDATA%\Scheldemist`; the server
  starts on port 8800 or the next free one.
- The checks: `node tools/godot/checks.mjs --town godot/baked/next/town.glb --models godot/baked/models`
  (devtest, paths, stuck, shaders, perfcheck, clocks, interiors). Each part has its own self-test (`--jobtest`,
  `--placestest`, `--deedstest`, `--ridetest`, `--eventtest`, `--peopletest`, `--soundtest`, `--mptest`, ...);
  godot/README.md lists them.

## What works

Everything in the browser game has a Godot part: the town and its look (sky, light, weather, water, mirrors, rooms
behind real openings, lamps, smoke, storm), Jef (walk, swim, climb, vault, fall), townspeople and animals, movers
(ships, bridges, lock, railway, cranes, omnibuses, carts, clocks), jobs and the day, talk and shops, deeds (police,
thieves, gang, gifts, hire), places (homes, taverns, landmarks, emigrants), rides (handcart, boats, ships, omnibus,
velocipede, crane ladders, ferry), events and the director's scenes, sound, menus and saves, play together, the
download. Per part, what is done and what is still open: [godot-play-inventory.md](godot-play-inventory.md) and the
handoffs below.

## Known open work

- Steve's own test of the zip (2026-10-05) found many issues: they go to new sessions, one issue each.
- Speed: features first, speed passes later (Steve, 2026-10-04). Frame time is about 4.5-8 ms at the five places
  (browser: about 30 ms). Where the time went, per merge: [godot-bisect.md](godot-bisect.md); allocations and method:
  [godot-perf2.md](godot-perf2.md), [godot-rooms-perf.md](godot-rooms-perf.md). Issues #32, #47, #49.
- Open GitHub issues for the port: #57 (handcart push in the ride check), #40 (resources leaked at test shutdown).
- Per part, the open lists at the end of each handoff: [godot-jobs.md](godot-jobs.md), [godot-net.md](godot-net.md),
  [godot-events.md](godot-events.md), [godot-places.md](godot-places.md), [godot-gaps-life.md](godot-gaps-life.md),
  [milestones/godot-movers.md](milestones/godot-movers.md), [milestones/godot-rides.md](milestones/godot-rides.md),
  [godot-port-sound.md](godot-port-sound.md), [godot-download-check.md](godot-download-check.md) (Linux and macOS
  packages not launch-tested), [godot-G8-checks.md](godot-G8-checks.md), [godot-integrate2.md](godot-integrate2.md).

## Traps met on the way

- Godot reads light colours as sRGB: give a Light3D `color.LinearToSrgb()` when the browser's value is linear (#42, #48).
- `fract(sin(x))` hashes go flat on large numbers on this graphics card: use the sin-free hash in the shaders (#55, #58).
- Materials made after the first frame are a new shader kind: make them at load (the shaders check catches it).
- C# allocations per frame cause GC hitches: no LINQ, lambdas, new lists or strings in per-frame code.
- Godot cannot read Draco or EXT_mesh_gpu_instancing: the bake and `tools/godot/models.mjs` decode them.
- If Godot crashes at start, check free commit memory first: leaked tool servers once filled it (#59). The Overwolf
  overlay's Vulkan layer can also crash it at start.
- Helpers in parallel: one Godot timing run at a time (`godot/baked/PERF-LOCK`), own ports from 8800 up, never 8787,
  5173, 8080, 8088, 8090.
