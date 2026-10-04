# Godot G8 checks, 2026-10-04

Follow-up: [rooms and frame cost](godot-rooms-perf.md) wires the live room registry, tests real aperture views,
fixes hidden painted panes, and records three clean before/after measurements on the new shared bake.

Implemented and run on `godot/checks`, in `D:/Code/MoodyGame-godot-checks`, from `godot-port` at cbb53c5.
The checks are working; the milestone gates are not all green. Faults in the other parts are reported below,
not fixed here. The shared town and decoded models were read without rebaking. Every server used a new test
database, seed 1873, no AI, and a free port from 8980. No player database was read or copied.

## Results today

| Check | Result | Evidence |
|---|---|---|
| HUD arrow | Pass | Before: supplied `jobtest-merged/3-carrying.png`. After: local `godot/baked/g8-hud-after/3-carrying.png`. The 30 m arrow clears both clock and job cards. Carry test: six steps, ten inspected pictures, 90 c pay and +1 trust. |
| Development kit | Pass | Four of four steps: set hour/weather and place Jef, summon a resident, create/take a carry job, skip ten minutes through the server. Two pictures inspected. |
| Paths | Fail | 295 unreachable of 8,747 targets: 294 schedule anchors and one current resident. 1,599,424 quarter-metre cells reached. Fixed job spots and current job task targets pass. |
| Stuck | Fail | 895 residents watched, 737 moving, three Monday game hours. Six oscillation findings, zero overlaps, 56 solid contacts across 19 residents. Five pictures inspected. |
| Shaders | Pass | 62 psx kinds at start and finish; 63 scene material kinds in the first frame; 862 observed materials, 39 first observed later. Zero new kinds and zero problems across 527 samples. One directional and one omni light throughout, including night/rain and dawn/fog visits. |
| Performance | Pass | All five walking and turning means and p95 values below 5 ms; details below. Five pictures inspected. |
| Clocks | Fail | Zero of 14 marked clock faces change between 13:00 and 13:30. The movers helper's live clock port is absent from this base. |
| Interiors | Fail | 40 building groups, 1,461 opening markers, zero registered live rooms. Raw probes flag 765 blocked and 1,084 empty openings. These overlapping counts are diagnostic, not confirmed opening defects. The visibility gate fails until live room data is supplied. |

Reports and logs are local, ignored artifacts under `godot/baked/g8/<check>/`. Each JSON includes its date,
town seed and coverage limits. `summary.json` covers the most recent runner invocation; `--only` runs do not
replace reports for checks they did not execute. All seven modes completed together in the final full run,
with no cleanup errors. An early runner settings file omitted required connection
fields, so the server fell back to AI despite the client flag. That mistake was corrected; the final full
run verifies walk-around mode through `/api/ai/config` before starting each game. Early reports are superseded.
Build and headless import pass. The existing nullable
warning is in `Townspeople.cs:230`; shutdown resource warnings remain [issue #40](https://github.com/Steve-Sitax/Moodygame/issues/40).

## Frame budget

Godot 4.7.2 Mono, Debug C# build, NVIDIA GeForce RTX 5090, midday clear, normal population. Each camera uses
the browser test kit's point, six-metre setback and facing direction: 90 standing frames, 90 turning frames
at two degrees per frame, and six seconds of real walking. The active main-frame timer runs from the first
physics/process signal to `RenderingServer.FramePostDraw`, including renderer submission. Separate wall
frame times are in JSON. This measures an active-frame bracket, not a profiler's isolated main-thread CPU
counter, and does not wait for GPU completion. The gate uses walking mean below 5 ms.

| Place | Walking mean / p95 (ms) | Turning mean / p95 (ms) | Turning draw calls, mean | Walk displacement (m) |
|---|---:|---:|---:|---:|
| Grote Markt | 1.761 / 2.391 | 1.940 / 2.342 | 445 | 9.05 |
| Cathedral | 2.135 / 3.155 | 2.035 / 3.198 | 494 | 8.92 |
| Handschoenmarkt | 1.935 / 2.452 | 1.530 / 2.322 | 542 | 7.69 |
| Vismarkt | 1.480 / 1.841 | 1.864 / 2.522 | 714 | 9.04 |
| Rijnkaai | 1.321 / 1.617 | 2.148 / 3.148 | 1,000 | 9.04 |

## Findings for the owning helpers

- [Paths, issue #43](https://github.com/Steve-Sitax/Moodygame/issues/43): compare server plan anchors with
  `godot/src/Town/WalkMap.cs`, `Townspeople.cs` and `Whereabouts.cs`. Examples: bk012's stroll anchor at
  (137.83,309.22), bk015 at (133.99,304.22), bk022 at (-106.30,382.85), and wu09 at (-270.04,23.16).
  The flood uses the game's baked walk dump, with target reach tolerances, rather than certifying a Jef route.
- [Crowd, issue #46](https://github.com/Steve-Sitax/Moodygame/issues/46): `godot/src/Town/Crowd.cs` and
  `Townspeople.cs`. Cathedral: r060 oscillates at (-267.64,96.68), destination (-268.07,96.14).
  Vismarkt: lv011 oscillates at (-93.13,89.23), destination (-92.81,113.83). Rijnkaai: lv001
  oscillates at (-6.51,69.17), destination (2.15,103.13). No overlaps in this final run.
  bk181's body hits a solid near (-80.09,9.73)
  at Vismarkt; compare `godot/src/World/Solid.cs` and the crowd grid. These are sampled findings;
  oscillation during play and brief contacts need inspection. Crowd randomness makes exact counts vary.
- [Clocks, issue #44](https://github.com/Steve-Sitax/Moodygame/issues/44): baked markers at Carolus (four),
  St Paul's (two), prison front (one), cathedral (four), Oostershuis (one), and two unnamed Node288/Node289
  markers. `BuildingAudit.Clocks` reads public extras and mesh/transform motion; the clock-owning port
  must animate them before this check can pass.
- [Interior registry, issue #45](https://github.com/Steve-Sitax/Moodygame/issues/45): the room-owning part
  can implement `Dev.IInteriorAuditSource`, exposing each room, shell and opening nodes. Current raw
  probes include cathedral and Oostershuis opening markers, but cannot evaluate shader aperture clipping
  or all glazing. Do not fix geometry merely because a diagnostic ray flags it.

## Coverage still missing

Paths do not certify Jef's physical passage, moving geometry, or goal systems not yet ported. The crowd run
is Monday 13:00–16:00 near five places; other days, nights, hidden-body contacts, animals, vehicles and
job figures are outside it. Hidden planned rounds are excluded from oscillation because short repeated
rounds are intentional. Wall-clock route and replan waits remain wall-clock based during accelerated
simulation. Shader kinds cover attached scene resources and psx counts, not transient detached resources,
driver compilation, or every future action. Performance has no browser per-part breakdown, GPU fence,
night/rain or stress population run. Clock checks cover marked faces and motion, not hand-angle accuracy,
unmarked painted faces or GPU-only animation. Interior fallback omits floor connectivity, seams,
containment, shader-only cutouts, unmarked painted windows and MultiMesh geometry. F9 console keyboard
and mouse interaction was not automated; the command path was tested.

## Files and handoff

The only file from Steve's shared-file list touched is `godot/src/Play/Jobs.cs`: `UpdateGoal` moves the
way arrow and distance clear of the actual clock/job card bounds. `godot/src/Menu/MainMenu.cs` also has
two lines to bypass menus for check options. No changes to Main, BakedWorld, Solid, Jef, Wiring, TownMap,
Psx or shaders. The rest is new `godot/src/Dev` check code, the Node runner, and documentation.

Run again after merging the owning helpers:

```powershell
node tools/godot/checks.mjs --town D:/Code/MoodyGame-godot/godot/baked/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models --out godot/baked/g8 --seed 1873
```

The runner builds/imports, uses separate ports and new test saves, opens one bounded window at a time,
reports every mode even after a failure, and returns nonzero if any gate fails. No new packages. Commits
passed the pre-commit hook. Nothing pushed or merged.
