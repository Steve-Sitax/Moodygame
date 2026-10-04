# Godot performance pass 2 — 2026-10-04

**The requested frame-time goal is not achieved.** The verified changes remove the measured route-learning GC hitch and substantially reduce temporary allocations. Every sampled place has a 0 B/frame allocation median, but busy-place averages and rendering time still exceed the requested limits. `perfcheck` and the job frame-budget step remain failures. The timing work remains incomplete.

Worktree `D:/Code/MoodyGame-godot-perf2`, branch `godot/perf2`, base `854a9fb`. Godot 4.7.2 Mono, Debug C#, RTX 5090, normal population, midday clear, identical shared town/models, fresh seed 1873 server, no AI. Server packages were installed locally with `npm --prefix server install`; no junction was used.

## Method and limits

Each run waited for `tasklist` to contain no Godot process, acquired the shared `baked/PERF-LOCK`, ran one bounded Godot window, and deleted the lock in `finally`. Functional cases used 480 or 600 second limits; check cases used 240 seconds. The combined six-check batch also had a 27-minute process-tree deadline, below the 30-minute lock limit. Assigned loopback ports were 8960–8969. Databases were newly created for each run and deleted after the server stopped. No player save was read or copied.

Timing brackets the first physics/process signal through `RenderingServer.FramePostDraw`; wall frame time is reported separately. It includes native engine work and renderer submission, without forcing GPU completion. Baseline and diagnostic comparisons walk for six seconds, after the same 120-frame warm-up, and originally turn for 90 frames. The final clean check turns for six seconds too. Those turn durations are explicitly different; final walking therefore starts later. Native clocks and random moving figures make separate runs variable, so reduced allocation counts are stronger evidence than small differences between whole-frame means.

Whole-frame bytes use `GC.GetAllocatedBytesForCurrentThread()` around complete frames. Samples report allocation mean, p95, median, and Gen0/1/2 collection deltas. Initial probes covered process/physics bodies; UI draw/notification/minimum-size probes were later added. EventPipe allocation stacks exposed compiler-hoisted closure allocations before body probes. The final diagnostic uses outer entry wrappers (`profile-parts.mjs --ui --entry`), including those allocations. Probes were removed before clean final checks and commits.

The per-part appendix compares the first body-probe run with the final entry-probe run. Its before byte numbers omit 48 B/frame at Lights entry and 32 B/frame at Solid entry; both are explained below and included in whole-frame totals. Per-part B/frame values are the profiler's integer reports averaged by sample frame count, so very rare allocations can round down. Nested scopes and callbacks overlap their parent; do not sum both. `n/s` means no sample, not measured zero.

The full gate now requires means below 3 ms as the target, means below 5 ms as hard limits, p95 below 5 ms, no main/wall frame over 16 ms, managed means at most 512 B/frame (the explicit interpretation of “a few hundred”), and medians of 0, for walking and turning. It no longer labels a place passing solely because its walking mean is below 5 ms.

To reproduce source profiling, install `node tools/godot/profile-parts.mjs --ui --entry`, build, and run `checks.mjs --profile-parts`. Remove the probes with `node tools/godot/profile-parts.mjs --remove` and rebuild before a clean measurement. Diagnostic scope overhead belongs only to the profiled results.

The final clean combined command was:

```powershell
node tools/godot/checks.mjs --town D:/Code/MoodyGame-godot/godot/baked/next/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models --port 8960 --port-end 8969 --no-build --timeout 240 --only devtest,shaders,clocks,stuck,perfcheck,pixelcheck --out godot/baked/perf2/final-required --perf-lock godot/baked/perf2/unused-lock
```

The measuring driver owns the real shared lock; its `--perf-lock` override prevents the checks it owns from waiting on that same lock. Other helpers continue to honor the real shared lock. Run the individual gameplay checks with `--only jobtest`, `placestest`, `eventtest`, `ridetest` or `playtest`; all start disposable seed-1873 servers with AI disabled. The two event batches and their exact Godot arguments are retained in `godot/baked/perf2/final-tests-batch.json`.

## Clean baseline

| Place | Walk mean / p95 / max ms | Wall max ms | Mean B/frame | Gen0 collections |
|---|---|---|---|---|
| grote markt | 5.121 / 6.738 / 38.146 | 38.172 | 25070.9 | 1 |
| cathedral | 5.526 / 6.938 / 9.727 | 9.773 | 12097.2 | 0 |
| handschoenmarkt | 5.706 / 7.050 / 8.612 | 8.640 | 1946.6 | 0 |
| vismarkt | 4.181 / 5.180 / 12.216 | 12.241 | 926.6 | 0 |
| rijnkaai | 3.793 / 4.895 / 6.893 | 6.927 | 833.5 | 0 |

Evidence: [baseline/perfcheck/perfcheck.json](../godot/baked/perf2/baseline/perfcheck/perfcheck.json). The first profiled run separately reproduced a 37.482 ms Grote Markt frame and a 24.769 ms Handschoenmarkt frame, with Gen0 and Gen1 collections in those samples.

## Causes and committed fixes

1. **Schedule lookup and path learning:** `PartAt` constructed and sorted a temporary daily segment list during repeated path-learning route builds. Direct selection preserves boundary/tie behavior. A newly arrived path then invalidated every incomplete daily route, even residents who could not use it. Missing-path dependency sets now retain unrelated partial routes. Exact schedule and forced-rebuild route comparisons cover all residents, days and boundary points.

2. **Interaction selection and prompt text:** ten-Hz provider queries allocated lists/dictionaries, fresh entry actions and joined strings, while keyboard labels repeated string construction. Internal selection buffers and entry prompts are reused; public `Find()` still returns its own list. Key insertion order, E priority, ties, action delegates and live keyboard-layout queries are retained. Prompt text changes only when its components change. Reused prompt Self/Cone fields are explicitly reset.

3. **Floor queries, rooms and mirrors:** direct-space shape queries returned managed arrays, room selection used LINQ containers, and Projection-to-Variant reflection uploads boxed/copied a matrix each frame. Reusable ShapeCast/RayCast nodes return the identical floor fraction, room selection keeps exact stable ties, and four Vector4 matrix columns reconstruct the same reflection transform in both PSX shaders. Original paths remain for comparisons.

4. **Active job HUD:** carry/watch papers rebuilt lists, strings and rounded distances on every frame; `InHand()` boxed its enumerator and carry goals used a LINQ iterator. Exact display-state keys and reusable job/paper buffers avoid unchanged text work, cached HUD references retain validity checks, and lying goods use a struct enumerator in the same dictionary order. The paper-position closure is created only on an actual paper rebuild. Public `Hud()` and `Items` contracts retain their original owned-list/LINQ behavior. The night-run shared-list behavior was preserved.

5. **Mover uploads:** `Copies.Set` marked a MultiMesh dirty even when all twelve transform floats were unchanged. Exact component and colour comparisons skip redundant uploads after the mandatory first upload. Handschoenmarkt uploads fell from 27.03 to 14.28/frame; measured upload scope fell from 0.0270 to 0.0153 ms/frame. Whole-frame improvement was too variable to assign a reliable larger saving. Culling margins remain unchanged.

6. **Hidden closures and periodic names:** an inactive Lights diagnostic captured eye/look at method entry (48 B/frame), Solid's inactive lazy-sort path captured position (32 B/frame), and Sound.Wire captured Jef even before its one-second early return (32 B/frame inside Sound). Helpers now contain those captures. Sound volume bus names and home door names are retained; first-match door lookup uses a direct loop. Sound polling remains at its original 1 s/250 ms cadence. The steady median moved from 112 to 32 to 0 B/frame.

Net API response parsing already uses `ConfigureAwait(false)` after HTTP I/O; town loading and path-response parsing already run away from the main thread. They were not moved speculatively. Queued callbacks and synchronization-context continuations are separately timed; remaining main-thread decoded-data application and occasional nested task/round deserialization remain visible. TownWork recreates bucket-chain entries when an event poll supplies them, but idle samples show only a small occasional cost, so it was not a first-order fix.

## Per-place final clean result

| Place | Walk mean / p95 / max ms | Turn mean / p95 / max ms | Wall max walk / turn | >16 walk / turn | Target / hard gate |
|---|---|---|---|---|---|
| grote markt | 5.234 / 6.596 / 9.770 | 5.483 / 7.926 / 11.591 | 9.800 / 11.623 | 0 / 0 | false / false |
| cathedral | 6.008 / 7.821 / 10.506 | 5.287 / 7.993 / 10.746 | 10.546 / 10.811 | 0 / 0 | false / false |
| handschoenmarkt | 6.400 / 8.336 / 10.059 | 5.503 / 7.955 / 10.100 | 10.102 / 10.180 | 0 / 0 | false / false |
| vismarkt | 4.442 / 5.331 / 10.020 | 5.772 / 7.720 / 13.701 | 10.053 / 13.739 | 0 / 0 | false / false |
| rijnkaai | 3.797 / 4.657 / 5.863 | 5.222 / 7.875 / 10.387 | 5.930 / 10.429 | 0 / 0 | false / false |

| Place | Mean B/frame walk / turn | p95 B walk / turn | Median B walk / turn | GC0/1/2 walk; turn | Samples walk / turn | Walk distance m |
|---|---|---|---|---|---|---|
| grote markt | 991.6 / 1413.6 | 3424 / 3432 | 0 / 0 | 0/0/0; 0/0/0 | 1137 / 1086 | 9.04 |
| cathedral | 322.7 / 1384.9 | 3424 / 3080 | 0 / 0 | 0/0/0; 0/0/0 | 991 / 1126 | 8.96 |
| handschoenmarkt | 412.4 / 719.7 | 3032 / 3032 | 0 / 0 | 0/0/0; 0/0/0 | 931 / 1082 | 7.69 |
| vismarkt | 296.3 / 952.6 | 2720 / 3416 | 0 / 0 | 0/0/0; 0/0/0 | 1340 / 1032 | 9.04 |
| rijnkaai | 172.2 / 1038.9 | 720 / 4008 | 0 / 0 | 0/0/0; 0/0/0 | 1567 / 1140 | 9.04 |

Evidence: [final-required/perfcheck/perfcheck.json](../godot/baked/perf2/final-required/perfcheck/perfcheck.json). All temporary entry/UI probes and native viewport counters were absent from this clean run.

The comparable final diagnostic (six-second walks, original 90-frame turns, probes enabled) is retained separately:

| Place | Walk mean / p95 / max ms | Mean / median B/frame | Gen0/1/2 | Process+physics / render submission ms |
|---|---|---|---|---|
| grote markt | 6.191 / 7.793 / 10.533 | 1198.0 / 0 | 0/0/0 | 2.570 / 3.624 |
| cathedral | 7.016 / 10.277 / 16.025 | 1240.5 / 0 | 0/0/0 | 2.637 / 4.386 |
| handschoenmarkt | 6.278 / 8.022 / 9.550 | 653.7 / 0 | 0/0/0 | 2.260 / 4.021 |
| vismarkt | 4.514 / 5.421 / 13.697 | 347.1 / 0 | 0/0/0 | 2.148 / 2.369 |
| rijnkaai | 3.979 / 4.729 / 6.611 | 248.3 / 0 | 0/0/0 | 1.979 / 2.001 |

Evidence: [profile-final-entry/perfcheck/perfcheck.json](../godot/baked/perf2/profile-final-entry/perfcheck/perfcheck.json). Cathedral had a 16.025 ms main / 16.101 ms wall frame in this diagnostic with no GC; removing garbage therefore does not by itself prove the no-stutter target.

## Controlled job HUD allocation comparison

| Path | Job | Jobs ms/frame | Jobs B/frame | Whole mean B/frame | Whole median | GC0/1/2 |
|---|---|---|---|---|---|---|
| original | carry | 0.0816 | 1345 | 2445.3 | 1456 | 0/0/0 |
| cached | carry | 0.0868 | 0 | 955.1 | 0 | 0/0/0 |
| original | watch | 0.0217 | 1107 | 2219.6 | 1296 | 0/0/0 |
| cached | watch | 0.0135 | 18 | 1059.0 | 0 | 0/0/0 |

Original-HUD controls ran with earlier non-HUD fixes already present. Watch allocations include real countdown/paper changes; carry's unchanged HUD/goal path is 0 B/frame. Whole-frame totals also contain route learning, prompts, audio and server replies. These cases do not prove the allocation goal for three simultaneous jobs or every night/proof/post-office paper.

## Pixel proof

The last available pixel report has **14 comparisons, 0 differing pixels**, at 1600×900 RGBA8 including the HUD and retro grain. The deliberately wrong fog colour changes 3,962,242 pixels across the controls, so readback is live and nonempty. The scene is paused and grain time fixed; both paths replay uniforms, node and MultiMesh poses, reflection matrices, room visibility, prompts and job papers.

| Place / scenario | Hour / weather | Different pixels | Control pixels |
|---|---|---|---|
| grote markt / idle | 13 / clear | 0 | 33790 |
| cathedral / idle | 13 / clear | 0 | 197334 |
| handschoenmarkt / idle | 13 / clear | 0 | 191166 |
| vismarkt / idle | 13 / clear | 0 | 130817 |
| rijnkaai / idle | 13 / clear | 0 | 68109 |
| grote markt / idle | 22 / mist | 0 | 825415 |
| cathedral / idle | 22 / mist | 0 | 611155 |
| handschoenmarkt / idle | 22 / mist | 0 | 562661 |
| vismarkt / idle | 22 / mist | 0 | 281834 |
| rijnkaai / idle | 22 / mist | 0 | 229491 |
| vismarkt / carry | 13 / clear | 0 | 133473 |
| vismarkt / carry | 22 / mist | 0 | 281876 |
| vismarkt / watch | 13 / clear | 0 | 133221 |
| vismarkt / watch | 22 / mist | 0 | 281900 |

Pure comparisons: 660,583 schedule answers; 27,216 floor queries; 1,134 room selections; 12,530 forced-rebuild resident routes; 14 action lists; 14 HUD/goal cases — all zero differences. Door lookups are additionally checked against their original first-match path. Representative carry-job day/night images were visually inspected.

Every production fix batch was followed by a zero-difference pixel check before commit: schedule, interaction, native-query/reflection and route batches used ten day/night place pairs; HUD/mover/closure batches used the expanded fourteen-case suite. Evidence is in `schedule-after`, `interaction-after`, `native-after`, `routes-after`, `closure-pixels`, and `final-fixes-pixels`. Final suite evidence: [final-required/pixelcheck/pixelcheck.json](../godot/baked/perf2/final-required/pixelcheck/pixelcheck.json).

## Functional and build checks

| Run / check | Result | Evidence |
|---|---|---|
| final-job / jobtest | FAIL | 17 steps, Vismarkt frame 6.36 ms |
| final-places / placestest | FAIL | 39 steps; System.InvalidOperationException: stored or carried furniture prompt |
| final-events-a / eventtest | PASS | 36 stages, 0 failures |
| final-events-b / eventtest | PASS | 34 stages, 0 failures |
| final-rides / ridetest | PASS | 196 checks;  |
| final-play / playtest | PASS | 37 steps;  |
| final-required / devtest | PASS | 4/4 steps |
| final-required / shaders | PASS | 0 new kinds, 0 problems |
| final-required / clocks | PASS | 96/96 running |
| final-required / stuck | PASS | 0 stuck, 0 overlaps, 0 solid findings; 3 h |
| final-required / perfcheck | FAIL | grote markt 5.234/6.596 ms; cathedral 6.008/7.821 ms; handschoenmarkt 6.4/8.336 ms; vismarkt 4.442/5.331 ms; rijnkaai 3.797/4.657 ms |
| final-required / pixelcheck | PASS | 14 comparisons, 0 changed pixels; positive control 3962242 |
| places-retry / placestest | PASS | 192 steps;  |
| places-original-homes / placestest | PASS | 23 steps;  |

`npm run build` passes (client build and server typecheck). `dotnet build godot/Scheldemist.csproj --no-restore` passes with the existing Grime CS8604 warning. JavaScript syntax checks and `git diff --check` pass. The pre-commit privacy hook passed every commit; no hook was bypassed.

The first corrected places run passed 38 steps and stopped before the furniture prompt. Its fixed 30-frame wait can be shorter than HomeFurniture's 250 ms refresh on an uncapped machine. The test now waits up to ten seconds for the same prompt and also compares cached/original action selection. The full retry passes 192 steps; the original-path home control passes 23 steps. Their waits were 0 and 1 ms, so these retries verify the assertion paths rather than directly reproducing the earlier refresh delay. The original failure is retained. Event coverage was split into two eight-kind batches because the earlier sixteen-kind run hit its 480-second timeout. No gameplay assertion or frame budget was weakened.

## Remaining cost and rejected experiments

The final profiled main process/physics bracket averages 2.269 ms/frame; renderer submission averages 3.075 ms/frame. Individual C# source entry scopes total about 1.520 ms/frame (nested scopes excluded). The remaining gap is native physics/scene work plus renderer submission. The busy walking views submit about 1,400–2,050 draw calls, with the same real rooms, moving figures and reflection passes. Native per-viewport CPU/GPU counters support a CPU/submission cost; inactive mirror counters retain their last draw and must not be summed as current per-frame GPU work.

A diagnostic disabling mirrors lowered cathedral frame time, identifying their cost, but it changes pixels and was not shipped. Hiding human render layers did not meaningfully improve whole-frame time while their animation logic continued. A tighter mover culling-margin experiment passed the fourteen pixel cases but removed only a few dozen draw calls and did not establish a reliable timing gain; it was reverted. No resolution, visible light count, mirror cadence, shader quality or population reduction was shipped. A 60-second Rijnkaai walk reaches quieter scenery and averages about 3 ms; it is not substituted for the five-place six-second check.

A further pass needs native renderer/animation profiling and a pixel-preserving way to reduce submitted work in busy rooms and reflections. Normal route/path learning and real changed job papers also leave allocation spikes/averages above the all-place target. The current evidence supports zero median garbage and removal of the measured GC hitch, not the requested final timing guarantee.

## Process, database and checkout cleanup

Final verification found no Godot process, no listener on ports 8960–8969, no owned test SQLite/WAL/SHM files, no shared PERF-LOCK, no installed probe backup and no temporary source wrappers. All 49 generated untracked UID files were removed. The checkout contains only the committed changes. No push or merge was performed. Ignored measurement JSON, screenshots, allocation traces and diagnostic helpers are retained in this worktree for review. Automatic approval review blocked recursive deletion of the temporary trace-reader folder; it was moved into the ignored diagnostic artifact directory instead. An ignored pixel replay scratch file was also retained after cleanup rejection.

## Commits and tracked files

- 1edf916 Avoid temporary schedule lists while learning town walks
- a0a8a20 Reuse interaction lists and unchanged prompt text
- 0c96303 Remove temporary floor queries and reflection matrix boxing
- 83ce7e2 Invalidate partial daily routes only for paths they need
- 2ca76f8 Reuse unchanged job HUD text and carry-goal queries
- f9e0723 Skip identical mover instance buffer uploads
- d2e7290 Keep inactive collision and lighting closures out of frames
- 4eb35f8 Measure sustained frame budgets and isolated gameplay checks
- e650e70 Wait for furniture's timed refresh in the places check

- [CHANGELOG.md](../CHANGELOG.md)
- [docs/README.md](../docs/README.md)
- [docs/godot-perf2.md](../docs/godot-perf2.md)
- [godot/src/Audio/SoundMixer.cs](../godot/src/Audio/SoundMixer.cs)
- [godot/src/Audio/SoundWiring.cs](../godot/src/Audio/SoundWiring.cs)
- [godot/src/Audio/Soundscape.cs](../godot/src/Audio/Soundscape.cs)
- [godot/src/Dev/Checks.cs](../godot/src/Dev/Checks.cs)
- [godot/src/Dev/FrameCost.cs](../godot/src/Dev/FrameCost.cs)
- [godot/src/Dev/PixelComparison.cs](../godot/src/Dev/PixelComparison.cs)
- [godot/src/Dev/SpeedComparison.cs](../godot/src/Dev/SpeedComparison.cs)
- [godot/src/Main.cs](../godot/src/Main.cs)
- [godot/src/Menu/Keys.cs](../godot/src/Menu/Keys.cs)
- [godot/src/Movers/Horses.cs](../godot/src/Movers/Horses.cs)
- [godot/src/Net/Api.cs](../godot/src/Net/Api.cs)
- [godot/src/Play/Doors.cs](../godot/src/Play/Doors.cs)
- [godot/src/Play/Goods.cs](../godot/src/Play/Goods.cs)
- [godot/src/Play/HomeLife.cs](../godot/src/Play/HomeLife.cs)
- [godot/src/Play/Interact.cs](../godot/src/Play/Interact.cs)
- [godot/src/Play/Jobs.cs](../godot/src/Play/Jobs.cs)
- [godot/src/Play/PlacesTest.cs](../godot/src/Play/PlacesTest.cs)
- [godot/src/Play/Runs.cs](../godot/src/Play/Runs.cs)
- [godot/src/Player/Jef.cs](../godot/src/Player/Jef.cs)
- [godot/src/Render/Psx.cs](../godot/src/Render/Psx.cs)
- [godot/src/Render/UniformUpdates.cs](../godot/src/Render/UniformUpdates.cs)
- [godot/src/Town/Crowd.cs](../godot/src/Town/Crowd.cs)
- [godot/src/Town/Townspeople.cs](../godot/src/Town/Townspeople.cs)
- [godot/src/Town/Whereabouts.cs](../godot/src/Town/Whereabouts.cs)
- [godot/src/World/Daylight.cs](../godot/src/World/Daylight.cs)
- [godot/src/World/Lights.cs](../godot/src/World/Lights.cs)
- [godot/src/World/Mirrors.cs](../godot/src/World/Mirrors.cs)
- [godot/src/World/Rooms.cs](../godot/src/World/Rooms.cs)
- [godot/src/World/Solid.cs](../godot/src/World/Solid.cs)
- [tools/godot/checks.mjs](../tools/godot/checks.mjs)
- [tools/godot/play-fixture.mjs](../tools/godot/play-fixture.mjs)
- [tools/godot/profile-parts.mjs](../tools/godot/profile-parts.mjs)

## Appendix: every sampled process/physics/UI entry

Frame-weighted averages over all five six-second walking samples. Before uses body scopes; after uses outer entry scopes. Lights/Solid's previously hidden entry allocations are shown explicitly in the cause section rather than invented in the old probe data.

| Source entry | Before ms/frame | Before B/frame | After ms/frame | After B/frame | After calls/frame |
|---|---|---|---|---|---|
| Audio/Soundscape.cs:_Process | 0.0202 | 55.7 | 0.0230 | 17.5 | 1.001 |
| Dev/Checks.cs:_Process | 0.0002 | 0.0 | 0.0003 | 0.0 | 1.001 |
| Dev/EventTest.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Dev/Kit.cs:_Process | 0.0003 | 0.0 | 0.0003 | 0.0 | 1.001 |
| Dev/Snap.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Game/Actors.cs:_Process | 0.0015 | 5.6 | 0.0018 | 6.0 | 1.001 |
| Game/Events.cs:_Process | 0.0008 | 0.0 | 0.0009 | 0.0 | 1.001 |
| Game/FamilyScenes.cs:_Process | 0.0004 | 0.0 | 0.0006 | 0.0 | 1.001 |
| Game/Hearses.cs:_Process | 0.0007 | 0.0 | 0.0010 | 0.0 | 1.001 |
| Game/Hud.cs:_Process | 0.0016 | 8.1 | 0.0021 | 9.1 | 1.001 |
| Game/MapTest.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Game/NeedsCard.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Game/PocketIcon.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Game/TownLife.cs:_Process | 0.0287 | 0.8 | 0.0329 | 1.1 | 1.001 |
| Game/TownMap.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Game/TownMap.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Game/Wiring.cs:_Process | 0.0005 | 0.0 | 0.0005 | 0.0 | 1.001 |
| Main.cs:_Process | 0.0025 | 0.0 | 0.0031 | 0.0 | 1.001 |
| Menu/AiSheet.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Menu/AiSheet.cs:_GetMinimumSize | n/s | n/s | n/s | n/s | n/s |
| Menu/CharacterSheet.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Menu/Loading.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Menu/Loading.cs:_GetMinimumSize | n/s | n/s | n/s | n/s | n/s |
| Menu/Loading.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Menu/MainMenu.cs:_Notification | n/s | n/s | n/s | n/s | n/s |
| Menu/MainMenu.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Menu/Saves.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Menu/SettingsSheet.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Movers/BoatLamps.cs:_Process | 0.0007 | 0.0 | 0.0007 | 0.0 | 1.001 |
| Movers/Boats.cs:_Process | 0.0991 | 0.0 | 0.1089 | 0.0 | 1.001 |
| Movers/Bridges.cs:_Process | 0.0033 | 0.0 | 0.0038 | 0.0 | 1.001 |
| Movers/Clocks.cs:_Process | 0.0007 | 0.0 | 0.0008 | 0.0 | 1.001 |
| Movers/GoodsDrays.cs:_Process | 0.0162 | 0.0 | 0.0169 | 0.0 | 1.001 |
| Movers/Horses.cs:_Process | 0.0068 | 0.0 | 0.0081 | 0.0 | 1.001 |
| Movers/Lock.cs:_Process | 0.0099 | 0.0 | 0.0116 | 0.0 | 1.001 |
| Movers/MoverClock.cs:_Process | 0.0015 | 0.0 | 0.0019 | 0.0 | 1.001 |
| Movers/MoverMap.cs:_Process | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| Movers/MoversTest.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Movers/Omnibus.cs:_Process | 0.2106 | 27.0 | 0.2296 | 17.2 | 1.001 |
| Movers/Railway.cs:_Process | 0.1011 | 0.4 | 0.1029 | 0.0 | 1.001 |
| Movers/River.cs:_Process | 0.0565 | 0.0 | 0.0621 | 0.0 | 1.001 |
| Movers/ShipLife.cs:_Process | 0.0026 | 0.0 | 0.0030 | 0.0 | 1.001 |
| Movers/Traffic.cs:_Process | 0.0751 | 0.0 | 0.0811 | 0.0 | 1.001 |
| Movers/WaterSheets.cs:_Process | 0.0029 | 0.0 | 0.0033 | 0.0 | 1.001 |
| Net/Mp/MpTest.cs:_Process | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| Net/Mp/Together.cs:_Process | 0.0011 | 0.0 | 0.0013 | 0.0 | 1.001 |
| Net/NetTest.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Net/ServerLink.cs:_Notification | n/s | n/s | 0.0000 | 0.0 | 1.001 |
| Net/ServerLink.cs:_Process | 0.0021 | 50.7 | 0.0026 | 54.5 | 1.001 |
| People/Animals.cs:_Process | 0.0276 | 0.5 | 0.0271 | 1.0 | 1.001 |
| People/HallPeople.cs:_Process | 0.0294 | 2.5 | 0.0329 | 2.1 | 1.001 |
| People/HomeVisitors.cs:_Process | 0.0004 | 0.0 | 0.0005 | 0.0 | 1.001 |
| People/MarketStalls.cs:_Process | 0.0003 | 0.0 | 0.0003 | 0.0 | 1.001 |
| People/Parade.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| People/ParkWildlife.cs:_Process | 0.0491 | 0.0 | 0.0556 | 0.0 | 1.001 |
| People/PostedPeople.cs:_Process | 0.0417 | 0.2 | 0.0460 | 0.5 | 1.001 |
| Play/Ballads.cs:_Process | 0.0007 | 1.3 | 0.0009 | 1.4 | 1.001 |
| Play/CathedralComfort.cs:_Process | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| Play/CraneClimb.cs:_Process | 0.0038 | 0.0 | 0.0039 | 0.0 | 1.001 |
| Play/Dashes.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Play/Day.cs:_Process | 0.0003 | 0.0 | 0.0003 | 0.0 | 1.001 |
| Play/DockWork.cs:_Process | 0.0008 | 0.8 | 0.0009 | 0.8 | 1.001 |
| Play/Doors.cs:_Process | 0.0072 | 2.5 | 0.0082 | 2.7 | 1.001 |
| Play/Emigrants.cs:_Process | 0.0013 | 1.7 | 0.0017 | 1.9 | 1.001 |
| Play/FerryArrival.cs:_Process | 0.0380 | 0.0 | 0.0403 | 0.0 | 1.001 |
| Play/Handcarts.cs:_Process | 0.0007 | 0.6 | 0.0007 | 0.3 | 1.001 |
| Play/HomeFurniture.cs:_Process | 0.0002 | 0.0 | 0.0003 | 0.0 | 1.001 |
| Play/HomeLife.cs:_Process | 0.0003 | 29.3 | 0.0004 | 1.4 | 1.001 |
| Play/InsideCounters.cs:_Process | 0.0001 | 0.8 | 0.0002 | 0.9 | 1.001 |
| Play/Interact.cs:_Process | 0.0118 | 261.0 | 0.0123 | 177.8 | 1.001 |
| Play/JobTest.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Play/Jobs.cs:_Process | 0.0038 | 0.0 | 0.0045 | 0.0 | 1.001 |
| Play/LandmarkLife.cs:_Process | 0.0008 | 0.6 | 0.0009 | 0.3 | 1.001 |
| Play/NightBoxes.cs:_Process | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| Play/ParkWork.cs:_Process | 0.0008 | 3.7 | 0.0009 | 4.0 | 1.001 |
| Play/PlacesTest.cs:_Process | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| Play/Poesje.cs:_Process | 0.0033 | 0.0 | 0.0037 | 0.0 | 1.001 |
| Play/PressWorld.cs:_Process | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| Play/Ride.cs:_Process | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| Play/Rowing.cs:_Process | 0.0293 | 0.8 | 0.0347 | 1.1 | 1.001 |
| Play/ShipWalk.cs:_Process | 0.0184 | 0.0 | 0.0202 | 0.0 | 1.001 |
| Play/TavernSeats.cs:_Process | 0.0003 | 0.5 | 0.0004 | 0.5 | 1.001 |
| Play/Tick.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Play/TownWork.cs:_Process | 0.0007 | 6.2 | 0.0010 | 6.9 | 1.001 |
| Play/Trouble.cs:_Process | 0.0003 | 0.0 | 0.0004 | 0.0 | 1.001 |
| Play/Velocipedes.cs:_Process | 0.0024 | 0.6 | 0.0030 | 0.9 | 1.001 |
| Play/WorkWall.cs:_Process | 0.0006 | 0.0 | 0.0008 | 0.0 | 1.001 |
| Player/FlyCam.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Player/Jef.cs:_Process | 0.0826 | 88.4 | 0.0876 | 16.7 | 1.001 |
| Player/WalkTest.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Talk/Bubbles.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Talk/Bubbles.cs:_Process | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| Talk/Dice.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Talk/Dice.cs:_Process | 0.0000 | 0.0 | 0.0001 | 0.0 | 1.001 |
| Talk/Talk.cs:_Process | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| Town/FamilyPeople.cs:_Process | 0.0004 | 0.0 | 0.0005 | 0.0 | 1.001 |
| Town/PeopleTest.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Town/Townspeople.cs:_Process | 0.2564 | 6536.5 | 0.2831 | 317.8 | 1.001 |
| Ui/Controls.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Ui/Controls.cs:_GetMinimumSize | n/s | n/s | n/s | n/s | n/s |
| Ui/InkButton.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Ui/InkButton.cs:_GetMinimumSize | n/s | n/s | n/s | n/s | n/s |
| Ui/InkButton.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Ui/InkCursor.cs:_Process | n/s | n/s | n/s | n/s | n/s |
| Ui/KeyedText.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Ui/KeyedText.cs:_Notification | n/s | n/s | n/s | n/s | n/s |
| Ui/Kit.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Ui/PaperCard.cs:_GetMinimumSize | n/s | n/s | n/s | n/s | n/s |
| Ui/PaperCard.cs:_Notification | n/s | n/s | n/s | n/s | n/s |
| Windows/Paper.cs:_Draw | n/s | n/s | n/s | n/s | n/s |
| Windows/Paper.cs:_GetMinimumSize | n/s | n/s | n/s | n/s | n/s |
| Windows/Paper.cs:_Notification | n/s | n/s | n/s | n/s | n/s |
| World/Blobs.cs:_Process | 0.0010 | 0.0 | 0.0012 | 0.0 | 1.001 |
| World/ChimneySmoke.cs:_Process | 0.0021 | 0.0 | 0.0026 | 0.0 | 1.001 |
| World/Daylight.cs:_Process | n/s | n/s | 0.0106 | 0.0 | 1.001 |
| World/Lights.cs:_Process | 0.0643 | 0.0 | 0.0736 | 0.0 | 1.001 |
| World/Mirrors.cs:_Process | 0.0159 | 168.0 | 0.0165 | 0.0 | 1.001 |
| World/Mist.cs:_Process | 0.0013 | 0.0 | 0.0015 | 0.0 | 1.001 |
| World/Rain.cs:_Process | 0.0009 | 0.0 | 0.0011 | 0.0 | 1.001 |
| World/RainSheets.cs:_Process | 0.0004 | 0.0 | 0.0005 | 0.0 | 1.001 |
| World/Rooms.cs:_Process | 0.0204 | 85.8 | 0.0221 | 0.9 | 1.001 |
| World/Sky.cs:_Process | 0.0059 | 0.0 | 0.0063 | 0.0 | 1.001 |
| World/Solid.cs:_Process | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| World/Waters.cs:_Process | 0.0025 | 0.0 | 0.0028 | 0.0 | 1.001 |

Uninvoked rows include disabled test parts, closed menus and UI methods not called during steady walking. There is no claim of measured zero for those rows. Daylight was expression-bodied in the first probe and has its own manual scope later. Source rows can contain multiple instances/classes in one file.

## Appendix: callback, timer, polling and internal scopes

| Scope (overlaps parent) | Before ms/frame | Before B/frame | After ms/frame | After B/frame | After calls/frame |
|---|---|---|---|---|---|
| Blobs | 0.0008 | 0.0 | 0.0010 | 0.0 | 1.001 |
| Callback:Scheldemist.Play.CathedralComfort.<_Ready>b__32_2 | n/s | n/s | 0.0000 | 0.0 | 0.053 |
| Callback:Scheldemist.Play.CraneClimb.Keys | n/s | n/s | 0.0002 | 1.2 | 0.053 |
| Callback:Scheldemist.Play.Day.Keys | n/s | n/s | 0.0001 | 5.4 | 0.053 |
| Callback:Scheldemist.Play.Doors.Keys | n/s | n/s | 0.0002 | 64.3 | 0.053 |
| Callback:Scheldemist.Play.Handcarts.Keys | n/s | n/s | 0.0000 | 1.2 | 0.053 |
| Callback:Scheldemist.Play.HomeFurniture.Keys | n/s | n/s | 0.0001 | 0.0 | 0.053 |
| Callback:Scheldemist.Play.Jobs.Keys | n/s | n/s | 0.0043 | 36.2 | 0.053 |
| Callback:Scheldemist.Play.Ride.Keys | n/s | n/s | 0.0002 | 19.6 | 0.053 |
| Callback:Scheldemist.Play.Rowing.Keys | n/s | n/s | 0.0001 | 18.9 | 0.053 |
| Callback:Scheldemist.Play.ShipWalk.Keys | n/s | n/s | 0.0009 | 1.5 | 0.053 |
| Callback:Scheldemist.Play.TavernSeats.<_Ready>b__24_0 | n/s | n/s | 0.0000 | 0.0 | 0.053 |
| Callback:Scheldemist.Play.TownWork.HiringOffers | n/s | n/s | 0.0000 | 0.0 | 0.053 |
| Callback:Scheldemist.Play.Trouble.Keys | n/s | n/s | 0.0000 | 1.2 | 0.053 |
| Callback:Scheldemist.Play.Velocipedes.Keys | n/s | n/s | 0.0001 | 18.9 | 0.053 |
| ChimneySmoke | 0.0020 | 0.0 | 0.0024 | 0.0 | 1.001 |
| Continuation:System.Action | 0.0012 | 15.3 | 0.0010 | 14.4 | 0.011 |
| Engine.process-and-physics | n/s | n/s | 2.2689 | 896.0 | 1.001 |
| Engine.render-submission | n/s | n/s | 3.0750 | 0.0 | 1.001 |
| Game.TownLife | 0.0285 | 0.8 | 0.0327 | 1.1 | 1.001 |
| HUD | 0.0015 | 8.1 | 0.0019 | 9.1 | 1.001 |
| Interact.Find | n/s | n/s | 0.0075 | 173.7 | 0.053 |
| Jobs | 0.0036 | 0.0 | 0.0043 | 0.0 | 1.001 |
| Lights | 0.0642 | 0.0 | 0.0733 | 0.0 | 1.001 |
| Lights.Far | 0.0010 | 0.0 | 0.0011 | 0.0 | 1.001 |
| Mirrors | 0.0157 | 168.0 | 0.0164 | 0.0 | 1.001 |
| Mist | 0.0011 | 0.0 | 0.0013 | 0.0 | 1.001 |
| Movers.Copies.Upload | n/s | n/s | 0.0221 | 0.0 | 22.514 |
| Movers.Omnibus | 0.2104 | 27.0 | 0.2293 | 17.0 | 1.001 |
| Net | 0.0019 | 50.7 | 0.0023 | 54.5 | 1.001 |
| Play.Emigrants | 0.0011 | 1.7 | 0.0015 | 1.9 | 1.001 |
| Play.FerryArrival | 0.0378 | 0.0 | 0.0400 | 0.0 | 1.001 |
| Play.Handcarts | 0.0006 | 0.6 | 0.0005 | 0.3 | 1.001 |
| Play.Poesje | 0.0032 | 0.0 | 0.0034 | 0.0 | 1.001 |
| Play.Rowing | 0.0292 | 0.8 | 0.0345 | 0.8 | 1.001 |
| Play.ShipWalk | 0.0182 | 0.0 | 0.0200 | 0.0 | 1.001 |
| Play.TownWork | 0.0006 | 6.2 | 0.0008 | 6.9 | 1.001 |
| Player.Jef | 0.0824 | 88.4 | 0.0874 | 16.7 | 1.001 |
| Rain | 0.0008 | 0.0 | 0.0009 | 0.0 | 1.001 |
| Rooms | 0.0203 | 85.8 | 0.0219 | 0.9 | 1.001 |
| Sky | 0.0057 | 0.0 | 0.0061 | 0.0 | 1.001 |
| Sound | 0.0200 | 55.7 | 0.0228 | 17.5 | 1.001 |
| Sound.StatePoll | n/s | n/s | 0.0017 | 15.2 | 0.021 |
| Sound.WirePoll | n/s | n/s | 0.0000 | 0.0 | 0.005 |
| Town.Crowd | n/s | n/s | 0.1217 | 0.0 | 1.001 |
| Town.DayRoute | n/s | n/s | 0.0147 | 251.0 | 104.544 |
| Town.PartAt | n/s | n/s | 0.0002 | 0.0 | 0.653 |
| Town.Townspeople | 0.2562 | 6536.5 | 0.2829 | 317.8 | 1.001 |
| World.Daylight | n/s | n/s | 0.0104 | 0.0 | 1.001 |

Generated API callback names are retained in the raw JSON: they apply decoded server data, on the main thread. Generated audio timer/ready callbacks are likewise retained there when they fire. Their names depend on compiler closure numbering, so they are not mistaken for different gameplay parts between builds. No audible timer fired in some short samples; that is absence of a sample, not a zero-cost assertion. Context continuations, server queue callbacks and sound wire/state timers are separate nested scopes. Input signals were not exercised by physical keyboard input in the walking benchmark; the scripted gameplay tests exercise the same action paths.
