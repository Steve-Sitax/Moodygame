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
