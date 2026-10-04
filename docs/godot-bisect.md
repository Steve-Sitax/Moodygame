# Godot frame-time bisect — 2026-10-04

Worktree `D:/Code/MoodyGame-godot-bisect`, branch `godot/bisect`, starting at `7c0a12b`.
Status: measurement preparation; no performance fix has been made yet.

## Method

Read `godot/README.md`, `docs/performance.md`, `docs/godot-rooms-perf.md`, and
`docs/godot-perf2.md` before work. Server packages are installed in this checkout,
without junctions. Every run uses the identical shared `baked/next/town.glb` and
`baked/models`, Godot 4.7.2 Mono, a fresh seed-1873 test town, no AI, and ports
8960–8969. No player save or private configuration is read or copied.

Historical revisions are checked out in this worktree only. The report and runner
are preserved while checking out revisions; the branch is restored before fixes.
Each revision is built and imported, then measured three times, one Godot process
at a time, with process deadlines. A batch waits for no Godot process, takes the
shared `PERF-LOCK`, lasts less than 30 minutes, and removes the lock in `finally`.
Lock removal failure stops measurements immediately.

The timer brackets the first physics/process signal through `FramePostDraw` and
includes native scene/physics work and renderer submission. Walking, turning,
wall intervals and draw calls are reported separately. Scene inventory is taken
outside timing samples. Static physics created directly through the physics
server is counted separately from scene-tree bodies and shapes.

## Historical measurements

Pending: `a1001d2`, `a292f31`, `577901c`, `0d2ea27`, `1cd221a`, `544752d`,
`ee92f5b`, `f2818f5`, `3840687`, `854a9fb`, `dfb1e21`, `cc2f843`, `7c0a12b`.
No unmeasured result is inferred from the earlier reports.

## Causes and fixes

Pending measurement. Perf2 established about 1.4 ms in C# scopes and 2.9 ms in
renderer submission, with 1,400–2,050 draws in busy views. Its disabled-mirror,
human-layer and tighter-mover-culling experiments are diagnostic or rejected;
they are not assumed to be valid speed fixes.

Every production speed fix must preserve behavior and show zero differing pixels
against its original implementation with a nonempty positive control. The target
is below 3 ms mean per place, with hard limits below 5 ms mean/p95 and no active
or wall walking/turning frame over 16 ms. Existing allocation gates are retained.

## Verification and cleanup

Pending: job, places, both event batches, ride, play, deeds, and
`devtest,shaders,clocks,stuck,perfcheck,pixelcheck`. No push or merge is authorized.
Each commit runs the repository pre-commit hook and stages explicit paths only.

## Measured results

Three independent runs; each cell lists run 1 / 2 / 3. Walking is six seconds after 90 standing and 90 turning frames for every revision, including latest. The temporary historical probe only adds inventory outside sampled frames and standardizes the turn duration. Draw calls are the mean during turning; scene counts are after walking. Physics bodies/shapes include Solid’s directly created static bodies plus the scene tree.

| Commit | Place | Walk mean ms | Walk p95 ms | Walk max ms | Turn mean / p95 / max ms | Draw calls | Bodies / shapes | Nodes | MeshInstances | Active lights |
|---|---|---|---|---|---|---|---|---|---|---|
| a1001d2 | grote markt | 4.466 / 4.359 / 4.506 | 5.72 / 5.523 / 5.672 | 22.404 / 19.972 / 21.879 | 4.193,5.265,10.311 / 4.195,5.072,9.957 / 4.05,5.041,9.209 | 947 / 948 / 947 | 3273,4763 / 3273,4763 / 3273,4763 | 12604 / 12604 / 12604 | 5917 / 5917 / 5917 | 27 / 27 / 27 |
| a1001d2 | cathedral | 5.088 / 5.131 / 4.984 | 6.506 / 6.842 / 6.515 | 8.635 / 9.264 / 8.957 | 3.999,5.458,6.74 / 4.645,5.998,6.939 / 4.002,5.862,7.342 | 990 / 992 / 987 | 3272,4762 / 3272,4762 / 3272,4762 | 12612 / 12612 / 12612 | 5919 / 5919 / 5919 | 34 / 34 / 34 |
| a1001d2 | handschoenmarkt | 5.414 / 5.031 / 5.012 | 7.13 / 6.55 / 6.532 | 8.897 / 9.084 / 8.502 | 4.038,5.383,5.765 / 4.081,5.366,6.041 / 4.005,5.271,6.281 | 1076 / 1076 / 1076 | 3272,4762 / 3272,4762 / 3272,4762 | 12617 / 12612 / 12612 | 5920 / 5919 / 5919 | 34 / 34 / 34 |
| a1001d2 | vismarkt | 4.08 / 3.953 / 3.991 | 5.144 / 4.758 / 4.845 | 98.927 / 98.351 / 99.785 | 5.168,6.982,8.051 / 4.954,6.793,7.372 / 4.79,6.247,6.773 | 1454 / 1448 / 1443 | 3277,4767 / 3277,4767 / 3277,4767 | 12671 / 12671 / 12673 | 5927 / 5927 / 5928 | 26 / 26 / 26 |
| a1001d2 | rijnkaai | 3.386 / 3.414 / 3.422 | 4.126 / 4.267 / 4.266 | 5.907 / 6.748 / 6.035 | 4.916,7.552,8.169 / 5.262,7.54,8.007 / 5.228,7.585,9.081 | 1655 / 1694 / 1675 | 3276,4766 / 3276,4766 / 3276,4766 | 12703 / 12703 / 12705 | 5939 / 5939 / 5940 | 9 / 9 / 9 |

Raw per-run JSON and logs: `godot/baked/bisect/<commit>/run-<n>/`. Inventory also records areas, rigid bodies, visible meshes, MultiMeshes, processing nodes, rays, casts, viewports, cameras, and counts by scene group. These diagnostic results do not replace the sustained six-second turning final gate.
