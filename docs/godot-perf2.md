# Godot performance pass 2 — 2026-10-04

**The requested frame-time goal is not achieved.** The verified changes remove the measured route-learning GC hitch and substantially reduce temporary allocations. Every sampled place has a 0 B/frame allocation median, but busy-place averages and rendering time still exceed the requested limits. `perfcheck` and the job frame-budget step remain failures. The timing work remains incomplete.

Worktree `D:/Code/MoodyGame-godot-perf2`, branch `godot/perf2`, base `854a9fb`. At the coordinator's request, `godot-port` at `cc2f843` (paths and deeds) was merged in `47c7529` before the final measurements. Only CHANGELOG needed conflict resolution; the resident spawn change merged with the performance fixes. Godot 4.7.2 Mono, Debug C#, RTX 5090, normal population, midday clear, identical shared town/models, fresh seed 1873 server, no AI. Server packages were installed locally with `npm --prefix server install`; no junction was used.

## Method and limits

Each run waited for `tasklist` to contain no Godot process, acquired the shared `baked/PERF-LOCK`, ran one bounded Godot window, and deleted the lock in `finally`. Functional cases used 480 or 600 second limits; check cases used 240 seconds. The combined six-check batch also had a 27-minute process-tree deadline, below the 30-minute lock limit. Assigned loopback ports were 8960–8969. Databases were newly created for each run and deleted after the server stopped. No player save was read or copied.

Timing brackets the first physics/process signal through `RenderingServer.FramePostDraw`; wall frame time is reported separately. It includes native engine work and renderer submission, without forcing GPU completion. Baseline and diagnostic comparisons walk for six seconds, after the same 120-frame warm-up, and originally turn for 90 frames. The final clean check turns for six seconds too. Those turn durations are explicitly different; final walking therefore starts later. Native clocks and random moving figures make separate runs variable, so reduced allocation counts are stronger evidence than small differences between whole-frame means.

Whole-frame bytes use `GC.GetAllocatedBytesForCurrentThread()` around complete frames. Samples report allocation mean, p95, median, and Gen0/1/2 collection deltas. Initial probes covered process/physics bodies; UI draw/notification/minimum-size probes were later added. EventPipe allocation stacks exposed compiler-hoisted closure allocations before body probes. The final diagnostic uses outer entry wrappers (`profile-parts.mjs --ui --entry`), including those allocations. Probes were removed before clean final checks and commits.

The per-part appendix compares the first body-probe run with the final entry-probe run. Its before byte numbers omit 48 B/frame at Lights entry and 32 B/frame at Solid entry; both are explained below and included in whole-frame totals. Per-part B/frame values are the profiler's integer reports averaged by sample frame count, so very rare allocations can round down. Nested scopes and callbacks overlap their parent; do not sum both. `n/s` means no sample, not measured zero.

The full gate now requires means below 3 ms as the target, means below 5 ms as hard limits, p95 below 5 ms, no main/wall frame over 16 ms, managed means at most 512 B/frame (the explicit interpretation of “a few hundred”), and medians of 0, for walking and turning. It no longer labels a place passing solely because its walking mean is below 5 ms.

To reproduce source profiling, install `node tools/godot/profile-parts.mjs --ui --entry`, build, and run `checks.mjs --profile-parts`. Remove the probes with `node tools/godot/profile-parts.mjs --remove` and rebuild before a clean measurement. Diagnostic scope overhead belongs only to the profiled results.

The final clean combined command was:

```powershell
node tools/godot/checks.mjs --town D:/Code/MoodyGame-godot/godot/baked/next/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models --port 8960 --port-end 8969 --no-build --timeout 240 --only devtest,shaders,clocks,stuck,perfcheck,pixelcheck --out godot/baked/perf2/final2-required --perf-lock godot/baked/perf2/unused-lock
```

The measuring driver owns the real shared lock; its `--perf-lock` override prevents the checks it owns from waiting on that same lock. Other helpers continue to honor the real shared lock. Run the individual gameplay checks with `--only jobtest`, `placestest`, `eventtest`, `ridetest`, `playtest` or `deedstest`; all start disposable seed-1873 servers with AI disabled. Deeds uses the requested `--deedstest <dir> --db <dir>/test.sqlite` pair. Exact final test arguments, including both event batches, are retained in `godot/baked/perf2/final2-tests-batch.json`.

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

7. **Merged deeds:** iterating `Townspeople.Sims` through `IReadOnlyList` boxed its list enumerator (40 B/query). A read-only struct view retains the same version-checked List enumerator and resident order. Deeds prompts now read a resident's native node height only after the identical distance test; thief stepping uses the unboxed view. The original prompt enumeration/height order remains selectable for proof. Pure comparisons include key priority, text, positions, cones and callback identity, from both sides of visible residents. Deeds still polls every 2 s, pursues/watches/steps thieves every 0.4 s; gang rolls remain 10 s, ideas 15 s and helper routines 0.1 s with their original 1.5/8 s polling.

8. **Turning prompt scans:** the new turning breakdown showed 1,232 B/query in Doors, 384 in Ride, and 368 each in Rowing/Velocipedes even with no candidate near Jef. Compiler-generated callbacks were allocated before the reach checks. Borrowed walking offer buffers and cold action helpers now keep distant candidates out of those allocations. Door/rowboat/velocipede empty scans are 0 B/query; omnibus scans are 80 B/query (two boxed bus-list enumerations remain). Riding/busy branches keep their original code. Reach inequalities, candidate order, action text, coordinates and server actions are retained; original provider paths remain for pixel and descriptor comparisons.

## Paths/deeds follow-up measurements

The pre-deeds clean walking result is retained here so it is not mistaken for the final merged state:

| Place | Pre-deeds mean / p95 / max ms | Pre-deeds mean / median B/frame |
|---|---|---|
| grote markt | 5.234 / 6.596 / 9.770 | 991.6 / 0 |
| cathedral | 6.008 / 7.821 / 10.506 | 322.7 / 0 |
| handschoenmarkt | 6.400 / 8.336 / 10.059 | 412.4 / 0 |
| vismarkt | 4.442 / 5.331 / 10.020 | 296.3 / 0 |
| rijnkaai | 3.797 / 4.657 / 5.863 | 172.2 / 0 |

| Merged part / scope | Before ms/frame | Before B/frame | After ms/frame | After B/frame | After calls/frame |
|---|---|---|---|---|---|
| `Play/Deeds.cs:_Process` | 0.00889 | 6.75 | 0.00801 | 6.43 | 1.001 |
| `Play/Gangs.cs:_Process` | 0.00048 | 0.00 | 0.00050 | 0.00 | 1.001 |
| `Play/Ideas.cs:_Process` | 0.00024 | 0.37 | 0.00026 | 0.38 | 1.001 |
| `Play/Hands.cs:_Process` | 0.00056 | 1.96 | 0.00053 | 1.95 | 1.001 |
| `Callback:Scheldemist.Play.Deeds.Keys` | 0.00065 | 1.74 | 0.00057 | 0.22 | 0.050 |
| `Deeds.ThiefStep` | n/s | n/s | 0.00047 | 0.00 | 0.013 |

Both columns use entry probes after the merge, across five six-second walking samples. “Before” is before the deeds/prompt fixes; “after” includes both. Deeds.Keys includes occasional first-time action creation; its unchanged empty scan is 0 B/query. Poll/start allocations stay in the process row; asynchronous response applications stay in continuation scopes. Gangs/ideas/helpers are mostly idle at midday; these numbers do not claim costs for an active gang, following dog or hired crew.

| Post-merge profile sample | Place | Walk / turn mean B/frame | Walk / turn median | GC0/1/2 walk; turn |
|---|---|---|---|---|
| before | grote markt | 1051.4 / 1422.0 | 0 / 0 | 0/0/0; 0/0/0 |
| before | cathedral | 353.0 / 1350.2 | 0 / 0 | 0/0/0; 0/0/0 |
| before | handschoenmarkt | 423.3 / 736.7 | 0 / 0 | 0/0/0; 0/0/0 |
| before | vismarkt | 235.2 / 960.0 | 0 / 0 | 0/0/0; 0/0/0 |
| before | rijnkaai | 186.6 / 1066.2 | 0 / 0 | 0/0/0; 0/0/0 |
| after | grote markt | 883.8 / 993.1 | 0 / 0 | 0/0/0; 0/0/0 |
| after | cathedral | 195.6 / 942.0 | 0 / 0 | 0/0/0; 0/0/0 |
| after | handschoenmarkt | 280.4 / 270.3 | 0 / 0 | 0/0/0; 0/0/0 |
| after | vismarkt | 120.6 / 522.5 | 0 / 0 | 0/0/0; 0/0/0 |
| after | rijnkaai | 103.7 / 663.1 | 0 / 0 | 0/0/0; 0/0/0 |

The intermediary profile after the deeds fix introduced separate turning scopes; compare its callbacks against the final provider profile (frame-weighted over the five turning samples):

| Provider | Before ms/frame | Before B/frame | After ms/frame | After B/frame | Before / after B/query |
|---|---|---|---|---|---|
| Doors | 0.00085 | 246.4 | 0.00063 | 0.0 | 1232 / 0 |
| Ride | 0.00083 | 76.5 | 0.00072 | 15.6 | 384 / 80 |
| Rowing | 0.00054 | 73.1 | 0.00042 | 0.0 | 368 / 0 |
| Velocipedes | 0.00033 | 73.1 | 0.00024 | 0.0 | 368 / 0 |

Evidence: [profile-deeds-before/perfcheck/perfcheck.json](../godot/baked/perf2/profile-deeds-before/perfcheck/perfcheck.json), [profile-deeds-after/perfcheck/perfcheck.json](../godot/baked/perf2/profile-deeds-after/perfcheck/perfcheck.json), [profile-providers-after/perfcheck/perfcheck.json](../godot/baked/perf2/profile-providers-after/perfcheck/perfcheck.json). Overall timing differences between these runs remain variable; the deterministic allocation reductions are the established gain.

## Per-place final clean result

| Place | Walk mean / p95 / max ms | Turn mean / p95 / max ms | Wall max walk / turn | >16 walk / turn | Target / hard gate |
|---|---|---|---|---|---|
| grote markt | 5.899 / 7.350 / 9.247 | 5.906 / 8.191 / 10.016 | 9.308 / 10.063 | 0 / 0 | false / false |
| cathedral | 6.439 / 7.948 / 10.383 | 5.728 / 8.290 / 10.442 | 10.429 / 10.510 | 0 / 0 | false / false |
| handschoenmarkt | 6.635 / 7.868 / 9.740 | 5.759 / 8.096 / 11.503 | 9.799 / 11.572 | 0 / 0 | false / false |
| vismarkt | 5.198 / 6.230 / 9.931 | 6.390 / 8.078 / 16.268 | 9.962 / 16.320 | 0 / 1 | false / false |
| rijnkaai | 4.408 / 5.343 / 6.508 | 5.892 / 8.263 / 10.022 | 6.992 / 10.069 | 0 / 0 | false / false |

| Place | Mean B/frame walk / turn | p95 B walk / turn | Median B walk / turn | GC0/1/2 walk; turn | Samples walk / turn | Walk distance m |
|---|---|---|---|---|---|---|
| grote markt | 991.0 / 1011.2 | 1520 / 1280 | 0 / 0 | 0/0/0; 0/0/0 | 1008 / 1007 | 9.05 |
| cathedral | 210.0 / 971.5 | 1152 / 1152 | 0 / 0 | 0/0/0; 0/0/0 | 924 / 1039 | 8.95 |
| handschoenmarkt | 287.1 / 287.7 | 760 / 760 | 0 / 0 | 0/0/0; 0/0/0 | 897 / 1032 | 7.69 |
| vismarkt | 144.6 / 539.8 | 760 / 1448 | 0 / 0 | 0/0/0; 0/0/0 | 1145 / 931 | 9.06 |
| rijnkaai | 164.8 / 666.7 | 760 / 2096 | 0 / 0 | 0/0/0; 0/0/0 | 1350 / 1010 | 9.04 |

Evidence: [final2-required/perfcheck/perfcheck.json](../godot/baked/perf2/final2-required/perfcheck/perfcheck.json). All temporary entry/UI probes and native viewport counters were absent from this clean run.

The final diagnostic (six-second walks and turns, probes enabled) is retained separately:

| Place | Walk mean / p95 / max ms | Mean / median B/frame | Gen0/1/2 | Process+physics / render submission ms |
|---|---|---|---|---|
| grote markt | 5.293 / 6.681 / 8.380 | 883.8 / 0 | 0/0/0 | 2.154 / 3.143 |
| cathedral | 5.951 / 7.585 / 11.451 | 195.6 / 0 | 0/0/0 | 2.221 / 3.733 |
| handschoenmarkt | 6.270 / 7.605 / 9.339 | 280.4 / 0 | 0/0/0 | 2.279 / 3.993 |
| vismarkt | 4.597 / 5.527 / 9.955 | 120.6 / 0 | 0/0/0 | 2.188 / 2.413 |
| rijnkaai | 3.977 / 4.919 / 7.506 | 103.7 / 0 | 0/0/0 | 1.992 / 1.988 |

Evidence: [profile-providers-after/perfcheck/perfcheck.json](../godot/baked/perf2/profile-providers-after/perfcheck/perfcheck.json). An earlier pre-deeds entry diagnostic had a 16.025 ms main / 16.101 ms wall cathedral frame with no GC; the post-merge before-fix profile had a 16.381 ms turning Vismarkt frame. Removing garbage therefore does not by itself prove the no-stutter target.

## Controlled job HUD allocation comparison

| Path | Job | Jobs ms/frame | Jobs B/frame | Whole mean B/frame | Whole median | GC0/1/2 |
|---|---|---|---|---|---|---|
| original | carry | 0.0816 | 1345 | 2445.3 | 1456 | 0/0/0 |
| cached | carry | 0.0868 | 0 | 955.1 | 0 | 0/0/0 |
| original | watch | 0.0217 | 1107 | 2219.6 | 1296 | 0/0/0 |
| cached | watch | 0.0135 | 18 | 1059.0 | 0 | 0/0/0 |

Original-HUD controls ran with earlier non-HUD fixes already present. Watch allocations include real countdown/paper changes; carry's unchanged HUD/goal path is 0 B/frame. Whole-frame totals also contain route learning, prompts, audio and server replies. These cases do not prove the allocation goal for three simultaneous jobs or every night/proof/post-office paper.

## Pixel proof

The last available pixel report has **14 comparisons, 0 differing pixels**, at 1600×900 RGBA8 including the HUD and retro grain. The deliberately wrong fog colour changes 3,895,509 pixels across the controls, so readback is live and nonempty. The scene is paused and grain time fixed; both paths replay uniforms, node and MultiMesh poses, reflection matrices, room visibility, prompts and job papers.

| Place / scenario | Hour / weather | Different pixels | Control pixels |
|---|---|---|---|
| grote markt / idle | 13 / clear | 0 | 34220 |
| cathedral / idle | 13 / clear | 0 | 197272 |
| handschoenmarkt / idle | 13 / clear | 0 | 191281 |
| vismarkt / idle | 13 / clear | 0 | 130899 |
| rijnkaai / idle | 13 / clear | 0 | 69176 |
| grote markt / idle | 22 / mist | 0 | 822397 |
| cathedral / idle | 22 / mist | 0 | 586797 |
| handschoenmarkt / idle | 22 / mist | 0 | 562569 |
| vismarkt / idle | 22 / mist | 0 | 270449 |
| rijnkaai / idle | 22 / mist | 0 | 229550 |
| vismarkt / carry | 13 / clear | 0 | 131888 |
| vismarkt / carry | 22 / mist | 0 | 268172 |
| vismarkt / watch | 13 / clear | 0 | 131547 |
| vismarkt / watch | 22 / mist | 0 | 269292 |

Pure comparisons: 660,583 schedule answers; 27,216 floor queries; 1,134 room selections; 12,530 forced-rebuild resident routes; 14 action lists; 14 HUD/goal cases — all zero differences. Door lookups are additionally checked against their original first-match path. Representative carry-job day/night images were visually inspected.

The merged-code proof also checks 12,980 resident-order/deeds action cases and 1,624 door/ride provider descriptors, all zero differences. Provider descriptors cover candidate order, priorities, labels, positions, Only/First/Options/Extra and cones; real callbacks are exercised by job/places/ride/deeds tests.

Every production fix batch was followed by a zero-difference pixel check before commit: schedule, interaction, native-query/reflection and route batches used ten day/night place pairs; HUD/mover/closure/deeds/provider batches used the expanded fourteen-case suite. Evidence is in `schedule-after`, `interaction-after`, `native-after`, `routes-after`, `closure-pixels`, and `final-fixes-pixels`. Final merged suite evidence: [final2-required/pixelcheck/pixelcheck.json](../godot/baked/perf2/final2-required/pixelcheck/pixelcheck.json).

## Functional and build checks

| Run / check | Result | Evidence |
|---|---|---|
| final2-job / jobtest | FAIL | 17 steps, Vismarkt frame 7.37 ms |
| final2-places / placestest | PASS | 192 steps;  |
| final2-events-a / eventtest | PASS | 36 stages, 0 failures |
| final2-events-b / eventtest | PASS | 34 stages, 0 failures |
| final2-rides / ridetest | PASS | 196 checks;  |
| final2-play / playtest | PASS | 37 steps;  |
| final2-deeds / deedstest | PASS | 67 checks;  |
| final2-required / devtest | PASS | 4/4 steps |
| final2-required / shaders | PASS | 0 new kinds, 0 problems |
| final2-required / clocks | PASS | 96/96 running |
| final2-required / stuck | PASS | 0 stuck, 0 overlaps, 0 solid findings; 3 h |
| final2-required / perfcheck | FAIL | grote markt 5.899/7.35 ms; cathedral 6.439/7.948 ms; handschoenmarkt 6.635/7.868 ms; vismarkt 5.198/6.23 ms; rijnkaai 4.408/5.343 ms |
| final2-required / pixelcheck | PASS | 14 comparisons, 0 changed pixels; positive control 3895509 |

`npm run build` passes (client build and server typecheck). `dotnet build godot/Scheldemist.csproj --no-restore` passes with Grime CS8604 and the inherited Deeds CS8601 warning. JavaScript syntax checks and `git diff --check` pass. The pre-commit privacy hook passed every commit; no hook was bypassed.

Before the deeds merge, the first corrected places run passed 38 steps and stopped before the furniture prompt. Its fixed 30-frame wait can be shorter than HomeFurniture's 250 ms refresh on an uncapped machine. The test now waits up to ten seconds for the same prompt and also compares cached/original action selection. The earlier full retry passes 192 steps; the original-path home control passes 23 steps. Their waits were 0 and 1 ms, so they verify the assertion paths rather than directly reproducing the earlier refresh delay. The original failure and retries remain in `final-places`, `places-retry` and `places-original-homes`; the table above is the post-merge rerun. Event coverage was split into two eight-kind batches because the earlier sixteen-kind run hit its 480-second timeout. No gameplay assertion or frame budget was weakened.

The job run has 16/17 passing steps. Its remaining failure is the frame-budget step (7.37 ms mean, 9.64 ms p95); the functional work/door/carry/deliver/watch/food/drink/home/sleep checks pass.

## Remaining cost and rejected experiments

The final profiled main process/physics bracket averages 2.152 ms/frame; renderer submission averages 2.926 ms/frame. Individual C# source entry scopes total about 1.437 ms/frame (nested scopes excluded). The remaining gap is native physics/scene work plus renderer submission. The busy walking views submit about 1,400–2,050 draw calls, with the same real rooms, moving figures and reflection passes. Native per-viewport CPU/GPU counters support a CPU/submission cost; inactive mirror counters retain their last draw and must not be summed as current per-frame GPU work.

A diagnostic disabling mirrors lowered cathedral frame time, identifying their cost, but it changes pixels and was not shipped. Hiding human render layers did not meaningfully improve whole-frame time while their animation logic continued. A tighter mover culling-margin experiment passed the fourteen pixel cases but removed only a few dozen draw calls and did not establish a reliable timing gain; it was reverted. No resolution, visible light count, mirror cadence, shader quality or population reduction was shipped. A 60-second Rijnkaai walk reaches quieter scenery and averages about 3 ms; it is not substituted for the five-place six-second check.

A further pass needs native renderer/animation profiling and a pixel-preserving way to reduce submitted work in busy rooms and reflections. Normal route/path learning and real changed job papers also leave allocation spikes/averages above the all-place target. The current evidence supports zero median garbage and removal of the measured GC hitch, not the requested final timing guarantee.

## Process, database and checkout cleanup

Final verification found no Godot process, no listener on ports 8960–8969, no owned test SQLite/WAL/SHM files, no shared PERF-LOCK, no installed probe backup and no temporary source wrappers. The 49 generated untracked UID files were removed. The checkout contains only the committed changes. The coordinator-requested merge of `cc2f843` is the only merge performed; nothing was pushed. Ignored measurement JSON, screenshots, allocation traces and diagnostic helpers are retained in this worktree for review. Automatic approval review rejected recursive deletion of the temporary trace-reader folder as blocked by policy; it is retained at `server/node_modules/.cache/perf2-trace-reader`, outside Godot's source glob. An ignored pixel replay scratch file is also retained after cleanup rejection.

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
- 3d433a8 Record allocation fixes and remaining frame-budget failures
- 47c7529 Merge paths and street deeds into the performance worktree
- e6939e5 Avoid boxed resident scans for street deeds
- e84117f Keep distant door and ride prompts out of allocation scans
- da66620 Profile turning continuations and run isolated deeds checks

Own tracked changes relative to the merged `cc2f843` state are listed below. Incoming paths/deeds files and their UID records were carried by the requested merge; unchanged incoming files are not attributed to this performance pass.

- [CHANGELOG.md](../CHANGELOG.md)
- [docs/README.md](../docs/README.md)
- [docs/godot-perf2.md](../docs/godot-perf2.md)
- [godot/src/Audio/SoundMixer.cs](../godot/src/Audio/SoundMixer.cs)
- [godot/src/Audio/SoundWiring.cs](../godot/src/Audio/SoundWiring.cs)
- [godot/src/Audio/Soundscape.cs](../godot/src/Audio/Soundscape.cs)
- [godot/src/Dev/Checks.cs](../godot/src/Dev/Checks.cs)
- [godot/src/Dev/FrameCost.cs](../godot/src/Dev/FrameCost.cs)
- [godot/src/Dev/OfferComparison.cs](../godot/src/Dev/OfferComparison.cs)
- [godot/src/Dev/PixelComparison.cs](../godot/src/Dev/PixelComparison.cs)
- [godot/src/Dev/SpeedComparison.cs](../godot/src/Dev/SpeedComparison.cs)
- [godot/src/Main.cs](../godot/src/Main.cs)
- [godot/src/Menu/Keys.cs](../godot/src/Menu/Keys.cs)
- [godot/src/Movers/Horses.cs](../godot/src/Movers/Horses.cs)
- [godot/src/Net/Api.cs](../godot/src/Net/Api.cs)
- [godot/src/Play/Deeds.Thieves.cs](../godot/src/Play/Deeds.Thieves.cs)
- [godot/src/Play/Deeds.cs](../godot/src/Play/Deeds.cs)
- [godot/src/Play/DeedsTest.cs](../godot/src/Play/DeedsTest.cs)
- [godot/src/Play/Doors.cs](../godot/src/Play/Doors.cs)
- [godot/src/Play/Goods.cs](../godot/src/Play/Goods.cs)
- [godot/src/Play/HomeLife.cs](../godot/src/Play/HomeLife.cs)
- [godot/src/Play/Interact.cs](../godot/src/Play/Interact.cs)
- [godot/src/Play/Jobs.cs](../godot/src/Play/Jobs.cs)
- [godot/src/Play/PlacesTest.cs](../godot/src/Play/PlacesTest.cs)
- [godot/src/Play/Ride.cs](../godot/src/Play/Ride.cs)
- [godot/src/Play/Rowing.cs](../godot/src/Play/Rowing.cs)
- [godot/src/Play/Runs.cs](../godot/src/Play/Runs.cs)
- [godot/src/Play/Velocipedes.cs](../godot/src/Play/Velocipedes.cs)
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
| `Audio/Soundscape.cs:_Process` | 0.0202 | 55.7 | 0.0216 | 17.1 | 1.001 |
| `Dev/Checks.cs:_Process` | 0.0002 | 0.0 | 0.0003 | 0.0 | 1.001 |
| `Dev/EventTest.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Dev/Kit.cs:_Process` | 0.0003 | 0.0 | 0.0003 | 0.0 | 1.001 |
| `Dev/Snap.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Game/Actors.cs:_Process` | 0.0015 | 5.6 | 0.0021 | 5.6 | 1.001 |
| `Game/Events.cs:_Process` | 0.0008 | 0.0 | 0.0007 | 0.0 | 1.001 |
| `Game/FamilyScenes.cs:_Process` | 0.0004 | 0.0 | 0.0004 | 0.0 | 1.001 |
| `Game/Hearses.cs:_Process` | 0.0007 | 0.0 | 0.0006 | 0.0 | 1.001 |
| `Game/Hud.cs:_Process` | 0.0016 | 8.1 | 0.0018 | 8.5 | 1.001 |
| `Game/MapTest.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Game/NeedsCard.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Game/PocketIcon.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Game/TownLife.cs:_Process` | 0.0287 | 0.8 | 0.0303 | 0.7 | 1.001 |
| `Game/TownMap.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Game/TownMap.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Game/Wiring.cs:_Process` | 0.0005 | 0.0 | 0.0006 | 0.0 | 1.001 |
| `Main.cs:_Process` | 0.0025 | 0.0 | 0.0027 | 0.0 | 1.001 |
| `Menu/AiSheet.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Menu/AiSheet.cs:_GetMinimumSize` | n/s | n/s | n/s | n/s | n/s |
| `Menu/CharacterSheet.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Menu/Loading.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Menu/Loading.cs:_GetMinimumSize` | n/s | n/s | n/s | n/s | n/s |
| `Menu/Loading.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Menu/MainMenu.cs:_Notification` | n/s | n/s | n/s | n/s | n/s |
| `Menu/MainMenu.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Menu/Saves.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Menu/SettingsSheet.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Movers/BoatLamps.cs:_Process` | 0.0007 | 0.0 | 0.0008 | 0.0 | 1.001 |
| `Movers/Boats.cs:_Process` | 0.0991 | 0.0 | 0.1022 | 0.0 | 1.001 |
| `Movers/Bridges.cs:_Process` | 0.0033 | 0.0 | 0.0045 | 0.0 | 1.001 |
| `Movers/Clocks.cs:_Process` | 0.0007 | 0.0 | 0.0008 | 0.0 | 1.001 |
| `Movers/GoodsDrays.cs:_Process` | 0.0162 | 0.0 | 0.0160 | 0.0 | 1.001 |
| `Movers/Horses.cs:_Process` | 0.0068 | 0.0 | 0.0059 | 0.0 | 1.001 |
| `Movers/Lock.cs:_Process` | 0.0099 | 0.0 | 0.0110 | 0.0 | 1.001 |
| `Movers/MoverClock.cs:_Process` | 0.0015 | 0.0 | 0.0017 | 0.0 | 1.001 |
| `Movers/MoverMap.cs:_Process` | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| `Movers/MoversTest.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Movers/Omnibus.cs:_Process` | 0.2106 | 27.0 | 0.2188 | 14.0 | 1.001 |
| `Movers/Railway.cs:_Process` | 0.1011 | 0.4 | 0.1057 | 0.0 | 1.001 |
| `Movers/River.cs:_Process` | 0.0565 | 0.0 | 0.0596 | 0.0 | 1.001 |
| `Movers/ShipLife.cs:_Process` | 0.0026 | 0.0 | 0.0029 | 0.0 | 1.001 |
| `Movers/Traffic.cs:_Process` | 0.0751 | 0.0 | 0.0811 | 0.0 | 1.001 |
| `Movers/WaterSheets.cs:_Process` | 0.0029 | 0.0 | 0.0030 | 0.0 | 1.001 |
| `Net/Mp/MpTest.cs:_Process` | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| `Net/Mp/Together.cs:_Process` | 0.0011 | 0.0 | 0.0013 | 0.0 | 1.001 |
| `Net/NetTest.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Net/ServerLink.cs:_Notification` | n/s | n/s | 0.0000 | 0.0 | 1.001 |
| `Net/ServerLink.cs:_Process` | 0.0021 | 50.7 | 0.0022 | 23.9 | 1.001 |
| `People/Animals.cs:_Process` | 0.0276 | 0.5 | 0.0276 | 0.6 | 1.001 |
| `People/HallPeople.cs:_Process` | 0.0294 | 2.5 | 0.0302 | 2.4 | 1.001 |
| `People/HomeVisitors.cs:_Process` | 0.0004 | 0.0 | 0.0006 | 0.0 | 1.001 |
| `People/MarketStalls.cs:_Process` | 0.0003 | 0.0 | 0.0003 | 0.0 | 1.001 |
| `People/Parade.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `People/ParkWildlife.cs:_Process` | 0.0491 | 0.0 | 0.0528 | 0.0 | 1.001 |
| `People/PostedPeople.cs:_Process` | 0.0417 | 0.2 | 0.0428 | 0.2 | 1.001 |
| `Play/Ballads.cs:_Process` | 0.0007 | 1.3 | 0.0007 | 0.7 | 1.001 |
| `Play/CathedralComfort.cs:_Process` | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| `Play/CraneClimb.cs:_Process` | 0.0038 | 0.0 | 0.0037 | 0.0 | 1.001 |
| `Play/Dashes.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Play/Day.cs:_Process` | 0.0003 | 0.0 | 0.0003 | 0.0 | 1.001 |
| `Play/Deeds.cs:_Process` | n/s | n/s | 0.0080 | 6.4 | 1.001 |
| `Play/DockWork.cs:_Process` | 0.0008 | 0.8 | 0.0009 | 0.7 | 1.001 |
| `Play/Doors.cs:_Process` | 0.0072 | 2.5 | 0.0074 | 1.0 | 1.001 |
| `Play/Emigrants.cs:_Process` | 0.0013 | 1.7 | 0.0016 | 1.7 | 1.001 |
| `Play/FerryArrival.cs:_Process` | 0.0380 | 0.0 | 0.0223 | 0.0 | 1.001 |
| `Play/Gangs.cs:_Process` | n/s | n/s | 0.0005 | 0.0 | 1.001 |
| `Play/Handcarts.cs:_Process` | 0.0007 | 0.6 | 0.0008 | 0.7 | 1.001 |
| `Play/Hands.cs:_Process` | n/s | n/s | 0.0005 | 1.9 | 1.001 |
| `Play/HomeFurniture.cs:_Process` | 0.0002 | 0.0 | 0.0003 | 0.0 | 1.001 |
| `Play/HomeLife.cs:_Process` | 0.0003 | 29.3 | 0.0004 | 0.7 | 1.001 |
| `Play/Ideas.cs:_Process` | n/s | n/s | 0.0003 | 0.4 | 1.001 |
| `Play/InsideCounters.cs:_Process` | 0.0001 | 0.8 | 0.0001 | 0.4 | 1.001 |
| `Play/Interact.cs:_Process` | 0.0118 | 261.0 | 0.0102 | 49.8 | 1.001 |
| `Play/JobTest.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Play/Jobs.cs:_Process` | 0.0038 | 0.0 | 0.0047 | 0.0 | 1.001 |
| `Play/LandmarkLife.cs:_Process` | 0.0008 | 0.6 | 0.0010 | 0.7 | 1.001 |
| `Play/NightBoxes.cs:_Process` | 0.0001 | 0.0 | 0.0003 | 0.0 | 1.001 |
| `Play/ParkWork.cs:_Process` | 0.0008 | 3.7 | 0.0009 | 3.9 | 1.001 |
| `Play/PlacesTest.cs:_Process` | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| `Play/Poesje.cs:_Process` | 0.0033 | 0.0 | 0.0035 | 0.0 | 1.001 |
| `Play/PressWorld.cs:_Process` | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| `Play/Ride.cs:_Process` | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| `Play/Rowing.cs:_Process` | 0.0293 | 0.8 | 0.0312 | 0.9 | 1.001 |
| `Play/ShipWalk.cs:_Process` | 0.0184 | 0.0 | 0.0186 | 0.0 | 1.001 |
| `Play/TavernSeats.cs:_Process` | 0.0003 | 0.5 | 0.0003 | 0.4 | 1.001 |
| `Play/Tick.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Play/TownWork.cs:_Process` | 0.0007 | 6.2 | 0.0008 | 6.8 | 1.001 |
| `Play/Trouble.cs:_Process` | 0.0003 | 0.0 | 0.0004 | 0.0 | 1.001 |
| `Play/Velocipedes.cs:_Process` | 0.0024 | 0.6 | 0.0029 | 0.4 | 1.001 |
| `Play/WorkWall.cs:_Process` | 0.0006 | 0.0 | 0.0007 | 0.0 | 1.001 |
| `Player/FlyCam.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Player/Jef.cs:_Process` | 0.0826 | 88.4 | 0.0829 | 16.2 | 1.001 |
| `Player/WalkTest.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Talk/Bubbles.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Talk/Bubbles.cs:_Process` | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| `Talk/Dice.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Talk/Dice.cs:_Process` | 0.0000 | 0.0 | 0.0001 | 0.0 | 1.001 |
| `Talk/Talk.cs:_Process` | 0.0001 | 0.0 | 0.0001 | 0.0 | 1.001 |
| `Town/FamilyPeople.cs:_Process` | 0.0004 | 0.0 | 0.0005 | 0.0 | 1.001 |
| `Town/PeopleTest.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Town/Townspeople.cs:_Process` | 0.2564 | 6536.5 | 0.2651 | 124.8 | 1.001 |
| `Ui/Controls.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Ui/Controls.cs:_GetMinimumSize` | n/s | n/s | n/s | n/s | n/s |
| `Ui/InkButton.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Ui/InkButton.cs:_GetMinimumSize` | n/s | n/s | n/s | n/s | n/s |
| `Ui/InkButton.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Ui/InkCursor.cs:_Process` | n/s | n/s | n/s | n/s | n/s |
| `Ui/KeyedText.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Ui/KeyedText.cs:_Notification` | n/s | n/s | n/s | n/s | n/s |
| `Ui/Kit.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Ui/PaperCard.cs:_GetMinimumSize` | n/s | n/s | n/s | n/s | n/s |
| `Ui/PaperCard.cs:_Notification` | n/s | n/s | n/s | n/s | n/s |
| `Windows/Paper.cs:_Draw` | n/s | n/s | n/s | n/s | n/s |
| `Windows/Paper.cs:_GetMinimumSize` | n/s | n/s | n/s | n/s | n/s |
| `Windows/Paper.cs:_Notification` | n/s | n/s | n/s | n/s | n/s |
| `World/Blobs.cs:_Process` | 0.0010 | 0.0 | 0.0010 | 0.0 | 1.001 |
| `World/ChimneySmoke.cs:_Process` | 0.0021 | 0.0 | 0.0025 | 0.0 | 1.001 |
| `World/Daylight.cs:_Process` | n/s | n/s | 0.0101 | 0.0 | 1.001 |
| `World/Lights.cs:_Process` | 0.0643 | 0.0 | 0.0682 | 0.0 | 1.001 |
| `World/Mirrors.cs:_Process` | 0.0159 | 168.0 | 0.0154 | 0.0 | 1.001 |
| `World/Mist.cs:_Process` | 0.0013 | 0.0 | 0.0015 | 0.0 | 1.001 |
| `World/Rain.cs:_Process` | 0.0009 | 0.0 | 0.0011 | 0.0 | 1.001 |
| `World/RainSheets.cs:_Process` | 0.0004 | 0.0 | 0.0005 | 0.0 | 1.001 |
| `World/Rooms.cs:_Process` | 0.0204 | 85.8 | 0.0219 | 0.0 | 1.001 |
| `World/Sky.cs:_Process` | 0.0059 | 0.0 | 0.0061 | 0.0 | 1.001 |
| `World/Solid.cs:_Process` | 0.0001 | 0.0 | 0.0002 | 0.0 | 1.001 |
| `World/Waters.cs:_Process` | 0.0025 | 0.0 | 0.0025 | 0.0 | 1.001 |

Uninvoked rows include disabled test parts, closed menus and UI methods not called during steady walking. There is no claim of measured zero for those rows. Daylight was expression-bodied in the first probe and has its own manual scope later. Source rows can contain multiple instances/classes in one file.

## Appendix: callback, timer, polling and internal scopes

| Scope (overlaps parent) | Before ms/frame | Before B/frame | After ms/frame | After B/frame | After calls/frame |
|---|---|---|---|---|---|
| `Blobs` | 0.0008 | 0.0 | 0.0008 | 0.0 | 1.001 |
| `Callback:Scheldemist.Play.CathedralComfort.<_Ready>b__32_2` | n/s | n/s | 0.0000 | 0.0 | 0.050 |
| `Callback:Scheldemist.Play.CraneClimb.Keys` | n/s | n/s | 0.0002 | 1.0 | 0.050 |
| `Callback:Scheldemist.Play.Day.Keys` | n/s | n/s | 0.0001 | 5.1 | 0.050 |
| `Callback:Scheldemist.Play.Deeds.Keys` | n/s | n/s | 0.0006 | 0.2 | 0.050 |
| `Callback:Scheldemist.Play.Doors.Keys` | n/s | n/s | 0.0002 | 0.0 | 0.050 |
| `Callback:Scheldemist.Play.Handcarts.Keys` | n/s | n/s | 0.0000 | 1.0 | 0.050 |
| `Callback:Scheldemist.Play.HomeFurniture.Keys` | n/s | n/s | 0.0000 | 0.0 | 0.050 |
| `Callback:Scheldemist.Play.Jobs.Keys` | n/s | n/s | 0.0036 | 32.1 | 0.050 |
| `Callback:Scheldemist.Play.Ride.Keys` | n/s | n/s | 0.0002 | 3.5 | 0.050 |
| `Callback:Scheldemist.Play.Rowing.Keys` | n/s | n/s | 0.0001 | 0.0 | 0.050 |
| `Callback:Scheldemist.Play.ShipWalk.Keys` | n/s | n/s | 0.0006 | 1.5 | 0.050 |
| `Callback:Scheldemist.Play.TavernSeats.SeatedKeys` | n/s | n/s | 0.0000 | 0.0 | 0.050 |
| `Callback:Scheldemist.Play.TownWork.HiringOffers` | n/s | n/s | 0.0000 | 0.0 | 0.050 |
| `Callback:Scheldemist.Play.Trouble.Keys` | n/s | n/s | 0.0000 | 1.0 | 0.050 |
| `Callback:Scheldemist.Play.Velocipedes.Keys` | n/s | n/s | 0.0001 | 0.0 | 0.050 |
| `ChimneySmoke` | 0.0020 | 0.0 | 0.0023 | 0.0 | 1.001 |
| `Continuation:System.Action` | 0.0012 | 15.3 | n/s | n/s | n/s |
| `Continuation:Play.Ballads_Load` | n/s | n/s | 0.0000 | 0.0 | 0.000 |
| `Continuation:Play.Deeds_Poll` | n/s | n/s | 0.0000 | 0.0 | 0.003 |
| `Continuation:Play.DockWork_Load` | n/s | n/s | 0.0000 | 0.0 | 0.000 |
| `Continuation:Play.Emigrants_Load` | n/s | n/s | 0.0001 | 1.0 | 0.001 |
| `Continuation:Play.Handcarts_Load` | n/s | n/s | 0.0000 | 0.0 | 0.000 |
| `Continuation:Play.Hands_Poll` | n/s | n/s | 0.0000 | 0.0 | 0.001 |
| `Continuation:Play.HomeLife_Load` | n/s | n/s | 0.0000 | 0.0 | 0.000 |
| `Continuation:Play.Ideas_Load` | n/s | n/s | 0.0000 | 0.2 | 0.000 |
| `Continuation:Play.InsideCounters_Load` | n/s | n/s | 0.0001 | 2.5 | 0.000 |
| `Continuation:Play.LandmarkLife_Load` | n/s | n/s | 0.0006 | 5.8 | 0.002 |
| `Continuation:Play.ParkWork_Load` | n/s | n/s | 0.0001 | 1.0 | 0.002 |
| `Continuation:Play.Rowing_Load` | n/s | n/s | 0.0000 | 0.0 | 0.000 |
| `Continuation:Play.TavernSeats_Load` | n/s | n/s | 0.0000 | 0.0 | 0.000 |
| `Continuation:Play.TownWork_Load` | n/s | n/s | 0.0000 | 0.0 | 0.003 |
| `Continuation:Play.Velocipedes_Load` | n/s | n/s | 0.0001 | 0.4 | 0.000 |
| `Deeds.ThiefStep` | n/s | n/s | 0.0005 | 0.0 | 0.013 |
| `Engine.process-and-physics` | n/s | n/s | 2.1518 | 530.2 | 1.001 |
| `Engine.render-submission` | n/s | n/s | 2.9257 | 0.0 | 1.001 |
| `Game.TownLife` | 0.0285 | 0.8 | 0.0301 | 0.7 | 1.001 |
| `HUD` | 0.0015 | 8.1 | 0.0016 | 8.5 | 1.001 |
| `Interact.Find` | n/s | n/s | 0.0067 | 49.8 | 0.050 |
| `Jobs` | 0.0036 | 0.0 | 0.0044 | 0.0 | 1.001 |
| `Lights` | 0.0642 | 0.0 | 0.0681 | 0.0 | 1.001 |
| `Lights.Far` | 0.0010 | 0.0 | 0.0010 | 0.0 | 1.001 |
| `Mirrors` | 0.0157 | 168.0 | 0.0152 | 0.0 | 1.001 |
| `Mist` | 0.0011 | 0.0 | 0.0013 | 0.0 | 1.001 |
| `Movers.Copies.Upload` | n/s | n/s | 0.0197 | 0.0 | 22.157 |
| `Movers.Omnibus` | 0.2104 | 27.0 | 0.2186 | 14.0 | 1.001 |
| `Net` | 0.0019 | 50.7 | 0.0020 | 23.9 | 1.001 |
| `Play.Emigrants` | 0.0011 | 1.7 | 0.0013 | 1.7 | 1.001 |
| `Play.FerryArrival` | 0.0378 | 0.0 | 0.0221 | 0.0 | 1.001 |
| `Play.Handcarts` | 0.0006 | 0.6 | 0.0006 | 0.7 | 1.001 |
| `Play.Poesje` | 0.0032 | 0.0 | 0.0032 | 0.0 | 1.001 |
| `Play.Rowing` | 0.0292 | 0.8 | 0.0311 | 0.9 | 1.001 |
| `Play.ShipWalk` | 0.0182 | 0.0 | 0.0184 | 0.0 | 1.001 |
| `Play.TownWork` | 0.0006 | 6.2 | 0.0006 | 6.8 | 1.001 |
| `Player.Jef` | 0.0824 | 88.4 | 0.0827 | 16.2 | 1.001 |
| `Rain` | 0.0008 | 0.0 | 0.0009 | 0.0 | 1.001 |
| `Rooms` | 0.0203 | 85.8 | 0.0216 | 0.0 | 1.001 |
| `Sky` | 0.0057 | 0.0 | 0.0059 | 0.0 | 1.001 |
| `Sound` | 0.0200 | 55.7 | 0.0214 | 17.1 | 1.001 |
| `Sound.StatePoll` | n/s | n/s | 0.0016 | 14.4 | 0.020 |
| `Sound.WirePoll` | n/s | n/s | 0.0000 | 0.0 | 0.005 |
| `Town.Crowd` | n/s | n/s | 0.1123 | 0.0 | 1.001 |
| `Town.DayRoute` | n/s | n/s | 0.0148 | 114.4 | 103.723 |
| `Town.PartAt` | n/s | n/s | 0.0001 | 0.0 | 0.298 |
| `Town.Townspeople` | 0.2562 | 6536.5 | 0.2649 | 124.8 | 1.001 |
| `World.Daylight` | n/s | n/s | 0.0099 | 0.0 | 1.001 |

Generated API callback names are retained in the raw JSON: they apply decoded server data, on the main thread. Generated audio timer/ready callbacks are likewise retained there when they fire. Their names depend on compiler closure numbering, so they are not mistaken for different gameplay parts between builds. No audible timer fired in some short samples; that is absence of a sample, not a zero-cost assertion. Context continuations, server queue callbacks and sound wire/state timers are separate nested scopes. Input signals were not exercised by physical keyboard input in the walking benchmark; the scripted gameplay tests exercise the same action paths.

The original profiler reported async returns together as `Continuation:System.Action`; the final profiler resolves and caches the actual state-machine type. Separate Deeds.Poll, Ideas.Load and other main-thread application rows therefore have `n/s` before. The expanded raw names, including compiler IDs, remain in JSON; the table abbreviates them to their source class/method. Night gang/following-dog/hired-crew timing is not certified by the midday profile.
