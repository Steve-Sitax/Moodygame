# Start-up

How the game gets from the icon to play, what each step costs, and how to keep it fast. Rules: AGENTS.md
"Adding to the start". Goal: under 60 s on a warm cache.

## Measure

```powershell
pwsh -File native-godot/scripts/measure-startup.ps1 -Name base -Runs 3
& native-godot/scripts/measure-startup.ps1 -Name ref -Extra @('--no-startup-cache','--ruien-in-order')  # from PowerShell: -File cannot pass a list
```

Each run writes `.scratch/startup-perf/<name>-<n>.json` (every `StartupTiming` stage) and `.log`. Compare medians of
three runs taken close together: the same build varies about 15% over a day on the test PC. The first run after a change to a
`StartupGeometrySource` file rebuilds the caches; time it separately. The old five-area sample took about 5 min;
the complete network's first installed launch took 37 min 31 s. Compare `town digest`, `map digest`, every
`ruien pieces` fingerprint row and the non-timing world report with the reference. A differing stored-resource
hash requires a full mesh-data comparison; counts and bounds alone cannot establish equivalence.

## Prepared caches in the package (2026-11-12)

A player's first start built every startup cache: 863.973 s on the test PC (one observation, taken while an
export also ran). The package now brings those caches along. `native-godot/scripts/seed-startup-cache.ps1` starts
the exported game once with an empty cache folder inside the package, names the result `startup-cache`, and then
starts the game again with empty user data: that start must reach play without building one entry and without
changing the package folder.

- The game reads a `startup-cache` folder beside its executable as a second, read-only cache
  (`StartupCachePrune.Seed`; `SCHELDEMIST_STARTUP_SEED` names another folder for a proof). A complete entry in the
  player's own folder wins; else the package's entry is used; else the entry is built in the player's own folder as
  before. Package entries have the same content keys and receipts, and every start checks their hashes the same way.
  They are never touched or pruned.
- Measured: 10.85 GB in 15,598 files (Ruien 10.05 GB, street cuts 0.79 GB). A start with empty user data and an empty
  own cache reached play in **147.017 s** and wrote only the copied dependency notes. That is the warm time: the
  prepared data removes the first-start build, it does not shorten a normal start.
- The keys hold no path, user or PC name: the Ruien entries built by the 0.3.0 package served the next package
  unchanged, from another folder. A start with the invariant number format (`DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`)
  is part of the proof, because the test PC writes decimals with a comma.
- Cost: the download grows by about 7.5 GB (the Ruien entries compress to about 73%, the pack itself hardly at all).
  The disk use after the first start is the same as before: the 10.85 GB lay in the user's cache folder then.
- A changed file in `StartupGeometrySource` gives new keys: build the package cache again for every release.
  The cache code itself (`StartupCachePrune.cs`, `RuienGeometryCache.cs`, `RuienCover.Cache.cs`) is outside that list.

## Exported Windows preview (2026-11-12)

The final package at source `2bd9167eacf09dad4abb36b4a7c99579b72489cf` reached actual playable gameplay in
**140.689, 137.751 and 142.824 s**, a **140.689 s median** and a **80.689 s gap** to the 60 s target.
These launches used the same relocated package, isolated save/layouts, Forward+ renderer, disabled VSync and
content-addressed cache. The 5.073 s range is normal run variation; the uncached reference and promotional captures
were started after this three-run measurement. These results do not establish a speedup over source-editor builds.

The export initially converted authored `.tscn` and `.tres` inputs into remapped binary resources, preventing the
street-cut cache from hashing its inputs. Keeping those small text resources addressable inside the PCK restores
the existing content checks and cache reuse. The package verifier rejects these remaps. Large binary geometry
resources remain unchanged. Warm runs reuse all 142 street-cut resources; the whole pass has a 3.795 s median.
The earlier cache-miss launch is a single diagnostic observation, not a three-run speedup baseline.

| Largest measured steps | Warm median, s |
|---|---:|
| Ruien collision/node attachment | 47.116 |
| Town load | 29.180 |
| Ruien entrance preparation | 24.278 |
| Ruien area preparation | 22.756 |
| Wait for remaining Ruien preparation | 17.944 |
| Ruien visual preparation | 16.334 |
| Town collision (`part.Solid`) | 7.533 |
| Town ready passes | 6.492 |

Stages overlap and nest. The largest remaining cost constructs collision for 78,543,196 triangles on the main
thread. Deferring it violates the requirement that all collision exist before play; reducing it needs validated
contact and clearance proxies across the network. That redesign is outside this packaging repair and cannot be
claimed safe from counts alone. The startup target remains unmet.

The first final-package launch with a missing street-cut cache took 251.643 s, but its Ruien geometry cache was
already populated. It is not a fresh-install timing. An earlier export with empty geometry caches reached the menu
in 901.590 s but then failed an obsolete smoke-test district count; that also is not an accepted playable timing.
Keep first-cache observations separate from the warm median. Raw evidence is under
`.scratch/startup-perf/export-fixed-*`.

The final uncached, in-order run reached play in **834.155 s** while promotional captures were also running;
its duration is not a clean performance baseline. Its town/map digests and non-timing world report match all
three warm runs. All **42,372 Ruien fingerprint rows** match after independently comparing **7,046** serialized
mesh pairs: every stored vertex/attribute/index/LOD buffer, format, bounds and effective material name agrees.
Raw serialized hashes differ and are retained; only those proven storage identities are normalized. The relocated
package passed all 28 gameplay/render checks, and `test-icons.ps1 -Full` passed all seven launcher checks.
The comparison receipt is `.scratch/startup-perf/export-fixed-result.json`; the mesh proof's SHA-256 is
`7edfafff4eb075b11454e38763e0f62bf75b9369479344b309a2bcbcdc010da3`.

## Earlier complete-network source build (2026-11-12)

Six interleaved actual playable launches of the same installed build, isolated save/layouts and Forward+ renderer,
with `--disable-vsync`: three normal launches and three with `--uncached-bridge-models`. The fixed bridge mesh cache
reduced the median from **187.152 s to 175.740 s**, saving **11.412 s (6.1%)**. Cached runs were 176.646, 175.740 and
173.892 s; comparison runs were 186.179, 187.152 and 188.115 s. The **gap to the 60 s target is 115.740 s**.

| Largest measured steps | Warm median, s | Notes |
|---|---:|---|
| Ruien collision/node attachment | 57.951 | Main thread; 78,543,196 collision triangles |
| Town load | 38.540 | Loading thread with prefetch workers |
| Ruien entrance preparation | 35.778 | Worker; overlaps town loading |
| Ruien area preparation | 17.878 | Worker; overlaps town loading |
| Wait for remaining Ruien preparation | 15.115 | After town load, with loading frames uncapped |
| Town collision (`part.Solid`) | 11.065 | Main thread |
| Town ready passes | 10.549 | Main thread |

Stages overlap and nest; do not sum this table. Attachment's processor time matches its elapsed time, with zero
collections in all three generations: this remaining delay is physics construction, rather than garbage collection
or a wait for disk. All collision must exist before play. Deferring it would change required remote ray tests;
reducing the detailed collision requires a separate validated proxy redesign to preserve contact and giant clearance.

All six runs kept the town/map/Ruien digests and non-timing world reports identical. A parallel film render was
active throughout; host snapshots record its process and memory usage. The cached range was 2.754 s. The first
installed cache build took 2250.803 s and also overlapped Git staging; it is excluded from the warm comparison.
The uncached, in-order reference reached play in 2162.838 s; the full desktop launcher check passed.

The reference's town/map digests and world report match. Raw Ruien storage digests differ after serialization:
independent Godot checks verified all stored vertex, attribute, index and LOD buffers, formats, bounds and effective
material names for 7,202 staged/installed and 7,046 cached/reference mesh pairs. All 42,372 fingerprint rows then
match exactly, with only those proven storage identities and known staged/installed source paths normalized.
Original logs and raw hashes are retained. Normal validation runs exited successfully with the same two ObjectDB
teardown warnings; the separate water-layer diagnostic's teardown errors are excluded from acceptance.

Evidence: `.scratch/startup-perf/ruien-installed33-result.json`, `ruien-installed33-bridge-cache-comparison.json`,
the two `ruien-installed33-*mesh-equivalence.json` records, per-run JSON and host snapshots
under `.scratch/ruien-complete/runs`. The bridge geometry/cache proof covers 138 bridges, 25 shared shapes, and
cold, warm and corrupt-cache recovery. Live hinges, collision and state remain per bridge.

## Earlier five-area sample (2026-11-07, warm, about 87 s)

| Step | Thread | s | Notes |
|---|---|---|---|
| Town, district and declared files read | loader workers | 9-11 | `NativeTownPrefetch`, level by level |
| Town passes (cuts, razed, shop fronts, squares, benches...) | loading thread | 12 | cut cache hit 1.4 s |
| Ruien entrances and areas built | Ruien worker | 7 | hidden behind the passes |
| Town enters the tree, ready passes | main | 9 | about 4.5 s is collision and furniture |
| Solid (town collision) | main | 8.5 | 5.6 s Jolt shape building, 2 s mesh reads |
| Other parts (walk map 4, Ruien lay-in 4.5, railway 2, sound floors 2.3...) | main | 25 | |
| Game rules, first state, shader settle and fade | main + workers | 8 | rules start after the walk map |

## Decided

- All collision is built at start (Steve, 2026-11-07). Building far collision later, near the player, was
  offered (about 6-8 s faster) and declined: far ray tests and start-up ray checks could give other results.
  Do not propose it again without a new reason.

## Traps

- A mesh read (`SurfaceGetArrays`, `GetFaces`) from the loading thread waits for a main-thread frame. Keep the loading
  card's frames unthrottled: drawing it less often made the town load 4.6 s slower.
- Resources loaded on two threads at once can fail in Godot's C# glue (`Handle is not initialized`) or leave an
  uninitialized RID. Workers that load run only beside the town's loading thread; Main joins the Ruien worker first.
- A C# wrapper of a Godot resource is shared: never `Dispose` one you did not create.
- Editing a file listed in `StartupGeometrySource` invalidates every cache of that project.
- `user://startup-cache` keeps entries by content key; entries unused for 3 days are deleted after start-up.

## Dev switches

`--no-startup-cache`, `--ruien-in-order`, `--serial-town`, `--serial-districts`, `--serial-stamps`,
`--backend-after-load`, `--load-on-main`: each restores the old way of one step, for a before-and-after.

## Geometry pass, option A (13 November 2026)

The whole-city 3D cobble prototype is removed from runtime and from the construction-source list. Paving uses the
existing ground and collision with texture relief. Embedded rails retain their crowned/bevelled section and closed
undersides/ends, but omit buried joint hardware and share identical full vertex attributes: 160,772 to 53,764 triangles
and 482,316 to 80,780 vertices. These are geometry counts, not a measured frame-rate or startup speedup.

One final source-project warm launch reached actual gameplay in **181.866 s**, a **121.866 s gap** to the 60 s target.
It used Forward+, disabled VSync, the existing isolated settings/save/layouts and the rebuilt content-addressed caches.
The uncached in-order reference was running concurrently on a SQLite-backup clone and separate port. Automatic cache
pruning also ran during this warm launch (1,924 MB removed). These conditions and one observation do not establish a
regression or a speedup against the exported or earlier source medians. The final cache-building launch took 779.737 s;
keep it separate from warm timings. The first warm launch reused all 141 current street-cut resources in 2.768 s.

Largest measured warm stages: Ruien collision/node attachment 61.329 s, town load 36.389 s, entrance preparation
34.487 s, area preparation 18.028 s, remaining preparation wait 16.125 s and town collision 10.765 s. Stages overlap.
The 78,543,196 underground collision triangles remain unchanged. A read-only audit of the largest exported collider
(C1, 1,947,651 triangles) found zero exact duplicate triangles, only 2,302 zero-area triangles and 88.5% non-axis-aligned
faces. Removing trivial redundancy cannot yield the required reduction. A smaller proxy needs independent tests of
vault clearances, openings, stairs and remote contact/ray behavior; blindly decimating this pass would not preserve them.

Cold/warm non-timing reports and all 42,372 fingerprint rows match exactly. The uncached, in-order reference reached
play in 2,040.380 s. Its non-timing report and town/map digests match;
all 42,372 Ruien rows agree after independently verifying 7,046 actual mesh pairs (every stored buffer, format,
name and bound). Raw storage hashes remain in the evidence. Result: `.scratch/startup-perf/paving-a-result.json`.
The final geometry/cache fixtures, 32 rail top/bottom probes, 36 exposed-end checks and all seven desktop launcher
checks passed. Evidence: `.scratch/quay-paving/option-a-*`, `rail-underside.log`, and `.scratch/startup-perf/paving-a-*`.
A 31-frame live review under the concurrent reference load averaged 26.95 ms; it is a diagnostic, not an A/B benchmark.

## Collision proxies

`CollisionProxy` simplifies only physics triangles; the rendered meshes, bevels, materials and placements stay intact.
A proxy triangle must be certified within 25 mm of the original surface. Original triangles not certified within
20 mm of the proxy are restored with their neighbours. Coverage subdivides a triangle until each patch lies in the
convex tolerance neighbourhood of one target triangle. Exhausting its work/depth limit rejects coverage; samples
alone never establish it. This replaces the capped sampling grid, which could accept a face spanning a 6 cm opening.

Fixed street-opening surrounds use a content-addressed packed scene keyed by the entire authored way and the
construction revision. Live shared materials are rebound on load. Repeated kit pieces share their collision shape,
so each source mesh is read and hashed once per run. `--no-surround-cache` compares surround construction alone;
`--no-startup-cache --ruien-in-order` remains the complete reference. Use `--full-collision` together with
`--no-startup-cache` for the unsimplified physics reference.

Managed regression checks: `dotnet run --project tools/collision/tests/CoverageProof.csproj` (requires the existing
GodotSharp assembly from a native build). `startup-cache-proof.tscn` verifies surround mesh/collision round trips,
placement invalidation, and recovery from corrupt receipts and bytes. `test-startup-revisions.ps1` verifies content
invalidation without timestamps and cache reuse across unrelated code changes. The startup runner rejects failed
processes, engine errors and missing/stale gameplay reports.

## Source startup pass (17 November 2026)

Three repeat launches used the same isolated save, layouts and Forward+ renderer. The warm median fell from
**116.138 s to 102.441 s**, a **13.697 s (11.8%)** reduction. The **gap to the 60 s target is 42.441 s**.
Baseline runs: 131.345, 115.316, 116.138 s; final runs: 105.815, 102.441, 100.550 s. The first baseline was slower;
the third also pruned 18,970 MB of old caches. Final warm spread was 5.265 s. Small fixture compilation overlapped
the first baseline; the final timed launches ran without another Godot validation process. Do not treat the savings
as an exact hardware-independent constant. The final cache-building launch took 2,422.150 s while the uncached
reference also ran; this single competing-load observation is excluded from the warm comparison.

| Remaining measured stage | Final warm median, s |
|---|---:|
| Town load | 32.784 |
| Ruien preparation through entrances (overlaps town loading) | 29.870 |
| Remaining Ruien preparation wait | 9.508 |
| Town collision | 9.424 |
| Town ready passes | 8.966 |
| Ruien collision/node attachment | 6.059 |

Stages overlap and nest. The 35.852 s `ruien.prepare.finish` interval runs from worker completion through later
Ruien setup, including intervening town work and attachment. Cached surrounds take 0.639 s in total;
Ruien area preparation takes 12.324 s.
The stricter collision certificate retains 11,417,647 triangles, compared with 8,567,963 under the unsafe sampler.
Town loading still resolves native resources, placements and content-sensitive preparation. Streaming or skipping
those resources needs a separate split of visible geometry from collision and authored layout data; this pass does
not establish that safe split. Town collision remains synchronous and complete before play. Applying the Ruien
proxy to town/room colliders requires independent support, doorway and contact proofs beyond the underground
network checks; it was not applied blindly to reduce the remaining time.

Eight coverage regression checks, content-revision tests, cache round trips/edit invalidation/corruption recovery,
the geometry fixture (40,401 ownership comparisons), all seven full launcher checks, and 1,085,148 assembled
physics samples across 167 areas and 53 connected rooms passed. Warm runs preserved the town/map digests,
all 42,372 Ruien fingerprint rows and non-timing world reports. Evidence is `.scratch/startup-perf/review-*`.

The accepted uncached, in-order reference reached gameplay in 2,263.095 s and passed the same 1,085,148 physics
samples. Its town/map digests and non-timing report match. All 42,372 Ruien rows agree after independently comparing
7,046 actual mesh pairs: every stored buffer, format, name and bound matches. Raw serialization hashes remain in
the evidence. The six previously edited town resources retain their original hashes. Final receipt:
`.scratch/startup-perf/review-result.json`; buffer proof: `review-mesh-equivalence.json` in that directory.

The first uncached reference was rejected for shader-cleanup errors at exit. The accepted repeat completed the
physics traversal before exiting without engine errors. The same error classes occur in the earlier
`quay-before-1.log` and `s60/b14-miss.log`; this pass does not fix that shutdown issue. Existing ObjectDB exit and
deprecated SurfaceTool warnings remain. Antigoon code is unchanged.

## Town collision sharing and resource lifetime

`Solid` shares a collision shape for each mesh and exact transform basis. Rotation, scale, mirroring and shear
are baked into its vertices; each body's translation places it in the world. Ground and lining meshes with
placement-dependent stair openings keep the original world-space cut. Owned shapes are disposed after their
bodies at shutdown. `--solid-world-space` retains the previous construction path for comparison.

Town prefetch loads C# and GDScript classes and shader sources serially before requesting their dependent resources
in parallel. Shader includes are absent from Godot's dependency list; loading their parent shader on a worker
reproduced two leaked load tokens. Serial shader loading fixes that hidden nested load too.
The headless dummy renderer loads each level serially after intermittent shader RID errors.
Each batch finishes before its results are collected, avoiding Godot 4.7's unfinished-load assistance path
([LoadToken leak](https://github.com/godotengine/godot/issues/120661)). Native references retain the results until
the prefetch phase completes; C# wrappers are created afterward.
`--serial-script-prefetch` defers the entire scripted dependency branch to its owning loader for comparison.

`solid-sharing-proof.tscn` compares world vertices and 15,000 physics ray contacts, including mirrored, scaled,
sheared and stair-cut placements. `prefetch-order-proof.tscn` checks the dependency graph;
`prefetch-lifetime-proof.tscn` loads all 3,847 interior assets and exercises ordinary resource release and exit.
`--persistence-proof <isolated directory> --persistence-phase write|read` checks menu save/load across two game
processes, including money, stable inventory IDs, job state and supported player position. Its database must be
inside the proof directory. Runtime evidence for this follow-up is kept under `.scratch/startup-perf/next-*`.
