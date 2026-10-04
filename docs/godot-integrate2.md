# Godot integration round two

Worktree: `D:/Code/MoodyGame-godot-integrate2`, branch `godot/integrate2`, from
`godot-port` at `280dcbd`. No push or merge. Checks use Godot 4.7.2 Mono, the shared
`baked/next/town.glb` and `baked/models`, fresh test databases, no AI, Dummy audio,
and ports 8940–8949. Every Godot launch checks the shared `PERF-LOCK`; runs are
sequential and bounded. Server dependencies were installed in this worktree with
`npm --prefix server install`, without junctions.

## Causes and changes

- Places was stopping at its first thrown assertion, rather than crashing or
  hanging. Calendar jumps did not tick the server to expire earlier street
  events, which still held the curate outside and prevented the indoor preacher
  from appearing. Indoor fixture ticks now apply the complete actor update. A
  service refresh could also retire the sermon's preacher after the day's sermon
  had latched; the sermon now retries with the live priest, restoring the timed
  spoken caption. The full places diagnostic run completed 287 checks.
- The ride run with 23 checks called the menu's real save loader while test
  startup had disabled that menu. Ride tests now include their menu dependency,
  and the general check runner preserves it. The cart push uses the same
  greater-than-0.3-metre assertion with a three-second input window instead of
  90 uncapped frames. Cart movement, household transfers and saved control
  restoration were observed working. Failure reports now include drive and
  control state. The initial crane fixture uses the same real idle-alignment
  queue as the dock fixture before testing live slew and runway travel.
- The event wrapper splits the original full selection into six fresh-world
  batches. All 16 event kinds and all supplementary checks remain. The default
  limit is 600 seconds per batch, configurable up to 3600; aggregate results
  preserve every batch report. A failed batch does not prevent later batches
  from being attempted. Log error detection remains enabled.
- The play telegram fixture rejected the assigned 8940–8949 ports. Its allowlist
  now includes that range; the loopback-host and exact fresh-database path guards
  are unchanged.

## Validation limits

Native graphics startup became unreliable on this machine. Vulkan crashed in
the NVIDIA driver before game code; explicit D3D12 reported
`D3D12CreateDevice failed` with `0x8007000e` (out of memory). Disabling implicit
Vulkan overlay layers did not resolve the driver failure. Two early runs did
start with the D3D12 Forward+ fallback. Later native attempts wrote no test
report. These are startup errors, not passing checks.

OpenGL compatibility was used to obtain diagnostic functional evidence. It
emits `global_shader_parameters_instance_allocate` errors and renders materials
incorrectly, so a completed functional report on that backend does not prove a
clean Forward+ launch, shader validation, visual parity or performance. Timing
failures are reported without speed work.

## Results

All artifact paths below are relative to `godot/baked/integrate2/`. PASS in the OpenGL column means the functional assertions passed on that diagnostic backend, subject to the graphics limits above.

| Required test | Native result | OpenGL diagnostic | Evidence / remaining failure | Artifact |
|---|---|---|---|---|
| job | ERROR: startup | FAIL: 22 steps | Watch did not settle; 15.57 ms vs 5 ms frame budget. | regressions-gl/jobtest |
| places | ERROR: startup | PASS: 287/287 | Full functional diagnostic completed in 367.75 s. | places-fixed-gl |
| deeds | ERROR: startup | PASS: 82/82 | Full functional diagnostic completed. | regressions-gl/deedstest |
| ride | ERROR: startup | FAIL: full run | 235 checks: ferry quay step; later 53 checks: crane alignment (fixture corrected); latest 143 checks: velocipede travel. No full passing run yet. | ride-fixed-gl; ride-fixed-gl2; ride-fixed-gl3 |
| play | ERROR: startup | FAIL: 28 steps | Telegram fixture port guard rejected 894x; guard corrected, full repeat pending. | regressions-gl/playtest |
| event | ERROR: 6/6 batches at startup | ERROR: 6/6 batches at startup | Both aggregate reports exist, but no event stage ran. Batching still needs a complete functional run. | events-native; events-gl |
| people | ERROR: startup | ERROR: no final report | 5370 reference answers produced; pictures written, process exited without peopletest.json. | regressions-gl/peopletest |
| sound | ERROR: startup | FAIL: 159 rows, 1 problem | Boot in a puddle: recorded level 4.6 dB above expected chain. | regressions-gl/soundtest |
| devtest | ERROR: startup | Not run | No completed report. | checks-native/devtest |
| shaders | ERROR: startup | Not run | No completed report; compatibility diagnostics do not prove shaders. | checks-native/shaders |
| clocks | ERROR: startup | Not run | No completed report. | checks-native/clocks |
| paths | ERROR: startup | Not run | No completed report. | checks-native/paths |
| stuck | ERROR: startup | Not run | No completed report. | checks-native/stuck |

| Focused check | Backend | Result | Artifact |
|---|---|---|---|
| Cart, before fixture changes | D3D12 Forward+ fallback | PASS: 53/53, 40.94 s | `cart-before-no-overlay` |
| Row | OpenGL | PASS: 24/24, 57.92 s | `row-diagnose` |
| Ferry | OpenGL | PASS: 22/22, 126.03 s | `ferry-diagnose-gl` |

| Build / repository check | Result |
|---|---|
| Local server dependency install | PASS; regular directory, no junction |
| `npm run build` | PASS |
| `dotnet build godot` | PASS; existing CS8604 in Grime and CS8601 in Deeds |
| JavaScript syntax checks | PASS: integration-check, events-check, checks, play-fixture |
| `git diff --check` | PASS |
| Pre-commit hooks on all six fix commits | PASS; no bypass or hook edits |

### Individual integration attempts

The early successful native starts used the D3D12 fallback after Vulkan initialization failed. Later startup errors exited with `3221225477` (`0xC0000005`) in under a second. No test database was reused.

| Output directory | Mode | Exit | Seconds | Report |
|---|---|---:|---:|---|
| `cart-before` | import | 0 | 3.63 | PASS |
| `cart-before` | ridetest | 3221225477 | 0.49 | Startup error; no report |
| `cart-before-d3d12` | ridetest | 3221225477 | 0.54 | Startup error; no report |
| `cart-before-no-overlay` | ridetest | 0 | 40.94 | PASS: 53 |
| `cart-before-repeat` | ridetest | 3221225477 | 0.43 | Startup error; no report |
| `ferry-diagnose` | ridetest | 3221225477 | 0.48 | Startup error; no report |
| `ferry-diagnose-gl` | ridetest | 0 | 126.03 | PASS: 22 |
| `places-before` | placestest | 1 | 175.10 | FAIL: 61; cathedral physical preacher |
| `places-diagnose` | placestest | 3221225477 | 0.36 | Startup error; no report |
| `places-diagnose-gl` | placestest | 1 | 200.69 | FAIL: 61; cathedral physical preacher |
| `places-diagnose2` | placestest | 3221225477 | 0.35 | Startup error; no report |
| `places-diagnose3` | placestest | 3221225477 | 0.53 | Startup error; no report |
| `places-diagnose4` | placestest | 3221225477 | 0.48 | Startup error; no report |
| `places-fixed-gl` | placestest | 0 | 367.75 | PASS: 287 |
| `places-fixed1` | placestest | 3221225477 | 0.66 | Startup error; no report |
| `places-fixed2` | placestest | 3221225477 | 0.41 | Startup error; no report |
| `places-fixed3` | placestest | 3221225477 | 0.52 | Startup error; no report |
| `ride-before` | ridetest | 1 | 106.35 | FAIL: 173; W rows hired boat one metre |
| `ride-diagnose-gl4` | ridetest | 3221225477 | 0.63 | Startup error; no report |
| `ride-diagnose-gl5` | ridetest | 3221225477 | 0.63 | Startup error; no report |
| `ride-fixed-gl` | ridetest | 1 | 206.05 | FAIL: 235; walk ferry route to (-249, 0.2) |
| `ride-fixed-gl2` | ridetest | 1 | 99.50 | FAIL: 53; W climbs onto working crane gallery (-2,9601085 rad) |
| `ride-fixed-gl3` | ridetest | 1 | 98.40 | FAIL: 143; velocipede travels two metres |
| `ride-fixed1` | ridetest | 3221225477 | 0.64 | Startup error; no report |
| `ride-fixed2` | ridetest | 3221225477 | 0.43 | Startup error; no report |
| `ride-native-retry` | ridetest | 3221225477 | 0.41 | Startup error; no report |
| `ride-native-retry-d3d12` | ridetest | 3221225477 | 0.54 | Startup error; no report |
| `row-diagnose` | ridetest | 0 | 57.92 | PASS: 24 |

For the five native regression attempts see `regressions-native/summary.json`; all five failed during startup. The corresponding diagnostic results are in `regressions-gl/summary.json`. The five requested native milestone attempts are in `checks-native/summary.json`; each failed during startup. Both event aggregates retain all six per-batch runtime records and missing-report failures. No assertion or engine-log error was waived.

### Remaining work

The full ride and event passing runs are **not achieved**. The play port fix needs a full repeat; people needs a completed report. Job and sound have the failures listed above. Native graphics remains blocked even after the user reported other sessions clear; the subsequent Vulkan, D3D12 and OpenGL starts still crashed. At the last system check the RTX 5090 had 26.2 GiB free VRAM and Windows had about 20 GiB of commit headroom. This does not establish the driver crash cause. A graphics-driver restart or more system commit headroom was requested before another run.

At 22:11 Brussels time, Windows commit headroom had dropped to about 8 GiB.
No further game launch was attempted while waiting for graphics recovery. All
test SQLite files and their sidecars were verified removed. No Godot process
remains; generated untracked C# UID files from import were removed from this
worktree. Existing tracked UIDs and shared bake files were not changed.

Fix commits: `10e472e` (sermon and actor fixture synchronization), `e61fae4` (ride menus/cart timing/crane fixture, fixes #57), `b866a76` (event batches), `0d62d88` (play fixture port range), `b374e4a` (ride failure diagnostics), `00e5679` (discard stale event reports). Each carries the requested co-author trailer. No push or merge.


## Repeat commands

Run from this worktree. Omit `--driver opengl3` for native validation. Use fresh
output directories. The wrappers remove their test databases and terminate the
process tree on timeout.

```powershell
node tools/godot/integration-check.mjs --mode placestest --out integrate2/places-repeat --port 8944 --timeout 1200
node tools/godot/integration-check.mjs --mode ridetest --out integrate2/ride-repeat --port 8944 --timeout 1200
node tools/godot/events-check.mjs --town D:/Code/MoodyGame-godot/godot/baked/next/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models --port 8944 --map-port 8949 --out godot/baked/integrate2/events-repeat
node tools/godot/checks.mjs --town D:/Code/MoodyGame-godot/godot/baked/next/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models --port 8941 --port-end 8949 --only jobtest,deedstest,playtest,peopletest,soundtest --timeout 600 --out godot/baked/integrate2/regressions-repeat
node tools/godot/checks.mjs --town D:/Code/MoodyGame-godot/godot/baked/next/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models --port 8941 --port-end 8949 --only devtest,shaders,clocks,paths,stuck --timeout 600 --out godot/baked/integrate2/checks-repeat
```
