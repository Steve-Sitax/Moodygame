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
