# Godot frame-time bisect — 2026-10-04

Worktree `D:/Code/MoodyGame-godot-bisect`, branch `godot/bisect`, starting at `7c0a12b`.
Status: six historical revisions measured three times; no performance fix made yet.
The next revision, `ee92f5b`, fails its unchanged C# build with seven errors: the
places code reads JSON properties from the typed `FireView` and `HiringView`.
Timing this revision requires exactly the subsequent `f2818f5` compile fix to
TownWork/PlacesTest, which will be labelled in the results. The original build
failure remains in the evidence. The unmodified revision cannot be timed.

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
| a292f31 | grote markt | 4.615 / 4.499 / 4.513 | 5.919 / 5.59 / 5.706 | 17.818 / 17.478 / 16.218 | 3.975,4.896,8.349 / 4.208,5.433,7.707 / 4.038,5.023,8.046 | 986 / 982 / 986 | 3273,4763 / 3273,4763 / 3273,4763 | 13174 / 13174 / 13174 | 6380 / 6380 / 6380 | 27 / 27 / 27 |
| a292f31 | cathedral | 5.234 / 5.174 / 5.347 | 6.686 / 6.803 / 7.06 | 10.98 / 8.667 / 9.046 | 3.919,5.538,6.521 / 3.957,5.529,6.389 / 3.915,5.323,5.668 | 1027 / 1025 / 1027 | 3272,4762 / 3272,4762 / 3272,4762 | 13162 / 13162 / 13162 | 6378 / 6378 / 6378 | 34 / 34 / 34 |
| a292f31 | handschoenmarkt | 5.531 / 5.414 / 5.266 | 7.334 / 6.892 / 6.542 | 9.667 / 8.943 / 8.614 | 4.185,5.491,24.062 / 4.232,5.289,26.311 / 4.465,5.992,25.791 | 1113 / 1112 / 1110 | 3272,4762 / 3272,4762 / 3272,4762 | 13162 / 13162 / 13162 | 6378 / 6378 / 6378 | 34 / 34 / 34 |
| a292f31 | vismarkt | 4.098 / 4.15 / 4.289 | 5.012 / 5.027 / 5.493 | 99.586 / 130.253 / 98.413 | 5.035,7.115,7.98 / 4.752,6.635,7.739 / 4.853,6.389,6.828 | 1525 / 1503 / 1523 | 3277,4767 / 3277,4767 / 3277,4767 | 13216 / 13216 / 13216 | 6385 / 6385 / 6385 | 26 / 26 / 26 |
| a292f31 | rijnkaai | 3.42 / 3.392 / 3.43 | 4.211 / 4.11 / 4.18 | 6.025 / 6.096 / 5.686 | 5.979,8.338,9.885 / 5.233,7.194,8.396 / 5.104,7.465,7.853 | 1779 / 1765 / 1757 | 3276,4766 / 3276,4766 / 3276,4766 | 13253 / 13253 / 13253 | 6398 / 6398 / 6398 | 9 / 9 / 9 |
| 577901c | grote markt | 4.656 / 4.507 / 4.499 | 5.892 / 5.786 / 5.743 | 13.85 / 12.151 / 10.64 | 3.821,4.645,4.858 / 3.894,4.969,8.102 / 4.099,5.205,7.883 | 978 / 984 / 985 | 3273,4763 / 3273,4763 / 3273,4763 | 13180 / 13180 / 13180 | 6383 / 6383 / 6383 | 27 / 27 / 27 |
| 577901c | cathedral | 5.357 / 5.096 / 5.294 | 7.036 / 6.536 / 7.004 | 23.737 / 20.31 / 20.34 | 4.074,5.958,6.746 / 3.821,5.265,6.472 / 3.992,5.469,7.937 | 1029 / 1027 / 1024 | 3272,4762 / 3272,4762 / 3272,4762 | 13168 / 13168 / 13168 | 6381 / 6381 / 6381 | 34 / 34 / 34 |
| 577901c | handschoenmarkt | 5.599 / 5.352 / 5.577 | 7.382 / 6.933 / 7.217 | 9.625 / 8.984 / 9.591 | 4.09,6.091,7.16 / 4.47,6.012,7.403 / 4.277,6.068,7.557 | 1115 / 1109 / 1112 | 3272,4762 / 3272,4762 / 3272,4762 | 13163 / 13168 / 13163 | 6380 / 6381 / 6380 | 34 / 34 / 34 |
| 577901c | vismarkt | 4.209 / 4.101 / 4.125 | 5.191 / 5.11 / 5.056 | 100.629 / 100.83 / 99.648 | 5.035,7.197,8.407 / 5.054,6.919,10.388 / 4.93,6.704,7.433 | 1512 / 1523 / 1522 | 3277,4767 / 3277,4767 / 3277,4767 | 13222 / 13222 / 13222 | 6388 / 6388 / 6388 | 26 / 26 / 26 |
| 577901c | rijnkaai | 3.428 / 3.527 / 3.432 | 4.191 / 4.415 / 4.242 | 5.339 / 6.213 / 6.361 | 5.181,7.206,8.17 / 5.248,6.534,7.242 / 5.48,7.8,8.377 | 1776 / 1785 / 1757 | 3276,4766 / 3276,4766 / 3276,4766 | 13259 / 13264 / 13259 | 6401 / 6402 / 6401 | 9 / 9 / 9 |
| 0d2ea27 | grote markt | 4.862 / 4.557 / 4.794 | 6.388 / 5.78 / 6.359 | 9.344 / 10.185 / 10.203 | 3.926,4.89,7.739 / 3.931,4.873,7.986 / 4.598,6.012,8.386 | 986 / 985 / 981 | 3273,4763 / 3273,4763 / 3273,4763 | 13193 / 13193 / 13193 | 6383 / 6383 / 6383 | 27 / 27 / 27 |
| 0d2ea27 | cathedral | 5.206 / 5.362 / 5.386 | 6.515 / 6.839 / 7.117 | 23.733 / 23.185 / 19.55 | 4,5.336,6.487 / 4.605,5.742,6.219 / 4.43,5.631,7.427 | 1028 / 1026 / 1025 | 3272,4762 / 3272,4762 / 3272,4762 | 13186 / 13181 / 13181 | 6382 / 6381 / 6381 | 34 / 34 / 34 |
| 0d2ea27 | handschoenmarkt | 5.418 / 5.414 / 5.514 | 6.967 / 6.983 / 7.117 | 8.752 / 9.514 / 10.317 | 4.144,5.479,7.187 / 4.624,6.636,7.604 / 4.131,5.278,7.551 | 1117 / 1102 / 1121 | 3272,4762 / 3272,4762 / 3272,4762 | 13186 / 13181 / 13181 | 6382 / 6381 / 6381 | 34 / 34 / 34 |
| 0d2ea27 | vismarkt | 4.14 / 4.058 / 4.073 | 5.127 / 4.838 / 4.881 | 100.48 / 99.116 / 97.536 | 4.951,6.826,7.829 / 5.049,6.361,7.36 / 4.992,7.005,8.504 | 1522 / 1531 / 1507 | 3277,4767 / 3277,4767 / 3277,4767 | 13235 / 13235 / 13235 | 6388 / 6388 / 6388 | 26 / 26 / 26 |
| 0d2ea27 | rijnkaai | 3.57 / 3.442 / 3.445 | 4.548 / 4.155 / 4.233 | 6.283 / 5.752 / 5.683 | 5.213,7.053,7.695 / 5.176,6.787,7.158 / 5.752,8.547,10.074 | 1767 / 1769 / 1764 | 3276,4766 / 3276,4766 / 3276,4766 | 13272 / 13272 / 13272 | 6401 / 6401 / 6401 | 9 / 9 / 9 |
| 1cd221a | grote markt | 4.769 / 4.915 / 4.596 | 6.136 / 6.538 / 5.796 | 26.536 / 23.102 / 26.427 | 4.13,5.261,8.252 / 4.243,5.963,8.012 / 3.943,4.74,8.508 | 981 / 976 / 986 | 3273,4763 / 3273,4763 / 3273,4763 | 13183 / 13183 / 13183 | 6381 / 6381 / 6381 | 27 / 27 / 27 |
| 1cd221a | cathedral | 5.342 / 5.256 / 5.204 | 6.898 / 6.924 / 6.713 | 9.789 / 9.329 / 9.83 | 4.532,6.426,7.855 / 3.891,5.153,6.173 / 4.142,5.798,6.858 | 1023 / 1032 / 1024 | 3272,4762 / 3272,4762 / 3272,4762 | 13176 / 13181 / 13181 | 6380 / 6381 / 6381 | 34 / 34 / 34 |
| 1cd221a | handschoenmarkt | 5.592 / 5.337 / 5.333 | 7.24 / 6.908 / 6.516 | 25.373 / 25.376 / 23.505 | 4.22,6.002,7.2 / 4.001,5.051,6.935 / 4.15,5.986,7.565 | 1112 / 1119 / 1115 | 3272,4762 / 3272,4762 / 3272,4762 | 13181 / 13181 / 13181 | 6381 / 6381 / 6381 | 34 / 34 / 34 |
| 1cd221a | vismarkt | 4.099 / 4.127 / 4.27 | 4.951 / 5.1 / 5.32 | 97.816 / 98.494 / 100.272 | 5.146,7.124,9.002 / 5.119,6.874,7.797 / 5.321,6.792,7.538 | 1525 / 1531 / 1537 | 3277,4767 / 3277,4767 / 3277,4767 | 13242 / 13242 / 13242 | 6390 / 6390 / 6390 | 26 / 26 / 26 |
| 1cd221a | rijnkaai | 3.484 / 3.631 / 3.6 | 4.166 / 4.696 / 4.456 | 4.868 / 7.882 / 6.596 | 5.774,7.98,8.693 / 5.288,7.516,8.968 / 5.28,7.068,7.626 | 1785 / 1769 / 1779 | 3276,4766 / 3276,4766 / 3276,4766 | 13280 / 13280 / 13280 | 6404 / 6404 / 6404 | 9 / 9 / 9 |
| 544752d | grote markt | 4.558 / 4.599 / 4.477 | 5.728 / 5.836 / 5.692 | 24.284 / 25.133 / 27.117 | 3.996,4.953,7.824 / 3.928,4.93,8.556 / 3.981,4.734,7.37 | 985 / 982 / 985 | 3273,4763 / 3273,4763 / 3273,4763 | 13247 / 13247 / 13247 | 6445 / 6445 / 6445 | 27 / 27 / 27 |
| 544752d | cathedral | 5.202 / 5.384 / 5.079 | 6.679 / 7.321 / 6.506 | 9.975 / 9.292 / 8.575 | 4.542,6.175,7.239 / 3.943,5.319,7.393 / 3.941,5.642,8.094 | 1034 / 1026 / 1022 | 3272,4762 / 3272,4762 / 3272,4762 | 13245 / 13240 / 13240 | 6445 / 6444 / 6444 | 34 / 34 / 34 |
| 544752d | handschoenmarkt | 5.192 / 5.376 / 5.249 | 6.374 / 7.007 / 6.632 | 8.686 / 8.42 / 9.271 | 4.131,5.768,6.409 / 4.101,5.48,5.906 / 4.411,6.123,7.452 | 1117 / 1114 / 1113 | 3272,4762 / 3272,4762 / 3272,4762 | 13245 / 13245 / 13250 | 6445 / 6445 / 6446 | 34 / 34 / 34 |
| 544752d | vismarkt | 3.948 / 4.009 / 3.962 | 4.785 / 5.106 / 4.942 | 13.021 / 12.897 / 12.421 | 4.932,6.806,7.457 / 5.213,7.474,9.532 / 5.05,6.354,7.313 | 1523 / 1524 / 1528 | 3277,4767 / 3277,4767 / 3277,4767 | 13306 / 13306 / 13306 | 6454 / 6454 / 6454 | 26 / 26 / 26 |
| 544752d | rijnkaai | 3.533 / 3.479 / 3.526 | 4.369 / 4.24 / 4.356 | 6.848 / 5.863 / 6.019 | 5.282,6.978,7.294 / 5.215,7.12,8.897 / 5.296,7.064,8.293 | 1777 / 1756 / 1782 | 3276,4766 / 3276,4766 / 3276,4766 | 13344 / 13344 / 13344 | 6468 / 6468 / 6468 | 9 / 9 / 9 |

Raw per-run JSON and logs: `godot/baked/bisect/<commit>/run-<n>/`. Inventory also records areas, rigid bodies, visible meshes, MultiMeshes, processing nodes, rays, casts, viewports, cameras, and counts by scene group. These diagnostic results do not replace the sustained six-second turning final gate.
