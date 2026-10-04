# Godot rooms and frame cost, 2026-10-04

Worktree `MoodyGame-godot-roomsperf`, branch `godot/rooms-perf`, from `4200b38`.
Godot 4.7.2 Mono, Debug C#, NVIDIA GeForce RTX 5090, normal population, midday clear.
Read the shared `baked/next/town.glb` and `baked/models`; no shared bake was changed and no new bake was made.
Every server used a fresh test database, seed 1873, verified no-AI walk mode, ports 8960–8969.

## What changed

- `Rooms` now registers its 45 actual world room groups and maps all 1,461 shell opening markers to them.
  The registry treats slits and roof lights as windows, matching the browser room metadata.
- The interior check visits each opening, pins its real room, removes its distant lining, opens live door leaves,
  and traces actual opaque triangles through the aperture in both directions. It checks angled views through
  louvres and light wells, includes each hit's place/material, and reports fixed closed doors separately.
  A local triangle BVH avoids repeatedly traversing large city chunks. These samples do not certify every pixel,
  floor access, shell containment, MultiMesh blockers, or unmarked painted windows.
- The browser had explicitly hidden six old landmark pane materials; the exporter had lost `Material.visible`.
  Those opaque painted panes covered real cathedral and church interiors in Godot. The exporter now carries
  visibility; the loader also recognizes those six legacy hidden names so this existing bake works immediately.
  This is a separate intentional visual bug fix, commit `84674b2`.
- Lamp ranking retains stable tie order while reusing lists, sets, spill/pool bytes and far-instance buffers.
  Ground lookup and capacities are prepared while loading. `Lights` and `Lights.Far` now allocate **0 B/frame**
  throughout all five profiled walking visits, including the first square.
- Exact typed uniform comparison avoids boxing Godot `Variant` values and creating temporary `StringName`s.
  Sky, mist, chimney smoke and blobs use these uploads. Main caches command-line arguments and its time uniform name.
  Daylight and mirror projection setters skip only identical values. Exactly black additive window glows with no
  depth writes are hidden. Room/light counts, mirror size and cadence, shaders, and visible effects are preserved.
- Idle Jobs checks happen before its closure-producing render method, eliminating 64 B/frame with no work in hand.
  Net, HUD, sound and menus were inspected: remaining small sampled allocations are polling, text or sound events,
  rather than a new every-frame container. Active-job HUD string construction remains a separate case.
- The performance sampler collects complete rendered frames through a persistent signal listener instead of
  allocating an awaiter/container every frame. Part timing/allocation measurement is opt-in and separate.

## Measurements

The active main-frame bracket starts at the first physics/process signal and ends at `FramePostDraw`, including
renderer submission. It is not an isolated profiler CPU counter and does not wait for GPU completion. Six seconds
of real walking follows standing and turning warm-up. Wall-frame p95/max and displacement are also in JSON.
Each baseline and final run started with no other Godot PID in `tasklist`; the shared lock serialized measurement
batches, each under 30 minutes. Final measurements have no part profiler enabled.

### Three clean runs before fixes

| Place | Mean, runs 1 / 2 / 3 (ms) | p95, runs 1 / 2 / 3 (ms) | Active max, runs 1 / 2 / 3 (ms) | Wall max, runs 1 / 2 / 3 (ms) | Wall frames >16 ms, runs 1 / 2 / 3 |
|---|---:|---:|---:|---:|---:|
| grote markt | 3.312 / 3.088 / 3.029 | 4.846 / 4.121 / 4.002 | 18.168 / 17.105 / 19.235 | 18.618 / 17.159 / 19.273 | 2 / 3 / 3 |
| cathedral | 4.189 / 3.56 / 3.694 | 5.977 / 4.846 / 5.096 | 20.588 / 16.911 / 17.526 | 20.365 / 16.956 / 17.432 | 2 / 2 / 2 |
| handschoenmarkt | 3.48 / 3.56 / 3.566 | 4.578 / 4.763 / 4.776 | 15.787 / 16.227 / 18.675 | 15.591 / 16.27 / 19.061 | 0 / 1 / 4 |
| vismarkt | 2.462 / 2.526 / 2.515 | 3.094 / 3.154 / 3.111 | 16.804 / 16.385 / 16.321 | 16.845 / 16.759 / 16.072 | 1 / 2 / 2 |
| rijnkaai | 2.27 / 2.232 / 2.188 | 2.974 / 2.835 / 2.741 | 22.05 / 25.254 / 20.182 | 22.441 / 25.609 / 20.6 | 3 / 4 / 4 |

### Three final runs after fixes

| Place | Mean, runs 1 / 2 / 3 (ms) | p95, runs 1 / 2 / 3 (ms) | Active max, runs 1 / 2 / 3 (ms) | Wall max, runs 1 / 2 / 3 (ms) | Wall frames >16 ms, runs 1 / 2 / 3 |
|---|---:|---:|---:|---:|---:|
| grote markt | 2.693 / 2.706 / 2.69 | 3.542 / 3.628 / 3.545 | 6.168 / 6.492 / 7.851 | 8.524 / 8.962 / 9.346 | 0 / 0 / 0 |
| cathedral | 3.094 / 3.208 / 3.163 | 4.143 / 4.395 / 4.31 | 7.85 / 8.659 / 8.918 | 7.875 / 8.689 / 8.937 | 0 / 0 / 0 |
| handschoenmarkt | 3.389 / 3.165 / 3.107 | 4.898 / 4.3 / 4.219 | 10.193 / 9.512 / 10.516 | 10.217 / 9.532 / 10.539 | 0 / 0 / 0 |
| vismarkt | 2.188 / 2.189 / 2.175 | 2.759 / 2.718 / 2.745 | 8.841 / 9.558 / 9.45 | 8.862 / 9.582 / 9.474 | 0 / 0 / 0 |
| rijnkaai | 1.933 / 1.94 / 1.939 | 2.432 / 2.465 / 2.465 | 9.124 / 8.336 / 5.656 | 9.146 / 8.391 / 5.682 | 0 / 0 / 0 |



The mean below 5 ms gate passes everywhere. **Cathedral and Handschoenmarkt still exceed the requested 3 ms target.**
No final steady-walking frame exceeded 16 ms, on either the active bracket or wall interval. Initial clean runs had
15.8–25.3 ms active peaks and 16.1–25.6 ms wall peaks. Allocation profiles show GC-sized 13–20 ms peaks in Town and
Lights; avoiding lamp/uniform and sampler garbage removed the measured stutters, while Town's remaining work is
owned by the people helper.

Cathedral diagnostic means (not visual-preserving changes): mirrors off 2.464 ms, room meshes off 3.355, far lights
off 3.589, room lamps off 3.656, grime/bump off 3.520, shade off 3.485, spill off 3.526, mist/smoke/blobs/trees off
3.664, sky off 3.218. These isolate mirrors as the largest new rendering cost, around 1.1 ms. Turning them off,
shrinking them or reducing their cadence would change pixels and was not shipped. A native occlusion experiment
using 280,057 existing city triangles did not improve cathedral cost (3.291 ms) and was removed.

Town code was **not edited**. Baseline Town allocations, GM/cathedral/Hands/Vis/Rijn: 51,552 / 44,467 / 36,611 /
33,416 / 33,525 B/frame; means .231 / .221 / .213 / .256 / .214 ms, peaks 15.69 / 14.40 / 13.11 / 14.24 / 17.77 ms.
The reported call sites are `Crowd.cs:305` (`GetFrustum` makes a Godot array), `Townspeople.cs:868` (`PlanNow`),
`:535` (schedule key), `:426` (`WhereNow`), and `Whereabouts.cs:500` (new `Where`) / `:528` (round key).
The coordinator has assigned these to the people helper; a merged run must validate that helper's results.

## Pictures and material gate

`godot/baked/roomsperf/final-visual/pixelcheck/pixelcheck.json`: **10 comparisons, 0 differing pixels**.
Five places at 13:00 clear and 22:00 mist, full RGBA8 frame, paused scene, frozen screen grain, original uploads
versus cached uploads, including live spill/far buffers and original stable lamp selection. A deliberately wrong
fog colour changed **3,141,170 pixels**, proving the same readback/diff detects a visual change.
This compares pure speed edits after the separate painted-pane bug fix; that bug fix intentionally changes pixels.

`final-visual/shaders/shaders.json`: **0 new runtime kinds, 0 problems**, 100 shader programs and 1,587 material
resources constant; one sun and 125 Omni lights constant. Build and pre-commit hook pass; existing nullable warnings
in Grime and Townspeople remain.

Twenty close room pictures, both sides by day and night, are in
`godot/baked/roomsperf/windows-after-glass/windows`, with matched before pictures in `windows-before/windows`.
Inspected cathedral day/night, Carolus day, chandler day, bakery inside by day, and Ankere by night: real arches,
pews/chandeliers, furniture and the opposite street are visible. Example files:

- `cathedral_day_street.png`, `cathedral_night_street.png`
- `carolus_day_street.png`, `shop_chandler_werf_day_street.png`
- `shop_bakery_steen_day_inside.png`, `tavern_ankere_night_street.png`

## Interior result and remaining places

Final full audit: **FAIL**, 45 live room groups, 1,461 uniquely assigned openings, 0 wall-blocked,
0 empty, 1,409 showing the room and the street, 51 deliberately closed leaves, **1 remaining street-view finding**.
Evidence: `godot/baked/roomsperf/interiors-final/interiors/interiors.json`.

Remaining finding: `home:cellar`, window 1 at **(-104.848, -0.600, 146.372)**.
The straight outward ray hits `house_home_cellar_light_well`, material `house_well_brick`, 0.870 m from its start.
Upward probes hit `house_bars`, the `h_beam` timber immediately inside the opening, or `h_cellarbrick` foundation;
lower slopes still meet the outer well wall. The room itself is visible through the window (12/12 inward samples).
The narrow upward view remains unverified; these sampled directions do not prove every possible view is blocked.
No cellar geometry was altered or finding suppressed. Changing its window/reveal/well plan would require a separate
geometry fix and a bake into this worktree, not the shared folder. Detailed rays are in
`cellar-final/interiors/interiors.json`; the earlier 120-second diagnostic timed out before BVHs were restricted
to the selected room's bounds. The final full audit finished within its timeout beside the other helpers, as instructed.

The 51 deliberately closed doors are not counted as open views. `building-with-interior.md` explicitly allows
"A door that never opens: its leaves in the street's scene, and an opening with `open: () => false`."
Most are Oostershuis warehouse leaves; others are the town hall, Steen museum and prison. Their exact places follow.
Opening them would be a design/door-plan change, not removing a mistaken wall or pane.

| Room / opening | World x, y, z (m) | Cause |
|---|---|---|
| townhall: town hall, main door | -257.000, 1.790, 61.890 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 1 of 16, its warehouse door (shut) | 90.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 2 of 16, its warehouse door (shut) | 94.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 3 of 16, its warehouse door (shut) | 98.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 4 of 16, its warehouse door (shut) | 102.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 5 of 16, its warehouse door (shut) | 106.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 6 of 16, its warehouse door (shut) | 110.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 7 of 16, its warehouse door (shut) | 114.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 10 of 16, its warehouse door (shut) | 126.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 11 of 16, its warehouse door (shut) | 130.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 12 of 16, its warehouse door (shut) | 134.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 13 of 16, its warehouse door (shut) | 138.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 14 of 16, its warehouse door (shut) | 142.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 15 of 16, its warehouse door (shut) | 146.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the dock front, bay 16 of 16, its warehouse door (shut) | 150.000, 1.550, 124.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 1 of 16, its warehouse door (shut) | 90.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 2 of 16, its warehouse door (shut) | 94.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 3 of 16, its warehouse door (shut) | 98.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 4 of 16, its warehouse door (shut) | 102.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 5 of 16, its warehouse door (shut) | 106.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 6 of 16, its warehouse door (shut) | 110.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 7 of 16, its warehouse door (shut) | 114.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 8 of 16, its warehouse door (shut) | 118.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 9 of 16, its warehouse door (shut) | 122.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 10 of 16, its warehouse door (shut) | 126.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 11 of 16, its warehouse door (shut) | 130.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 12 of 16, its warehouse door (shut) | 134.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 13 of 16, its warehouse door (shut) | 138.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 14 of 16, its warehouse door (shut) | 142.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 15 of 16, its warehouse door (shut) | 146.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the north front, bay 16 of 16, its warehouse door (shut) | 150.000, 1.550, 162.000 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the west end, bay 1 of 8, its warehouse door (shut) | 88.000, 1.550, 126.500 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the west end, bay 2 of 8, its warehouse door (shut) | 88.000, 1.550, 131.500 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the west end, bay 3 of 8, its warehouse door (shut) | 88.000, 1.550, 136.250 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the west end, bay 4 of 8, its warehouse door (shut) | 88.000, 1.550, 140.750 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the west end, bay 5 of 8, its warehouse door (shut) | 88.000, 1.550, 145.250 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the west end, bay 6 of 8, its warehouse door (shut) | 88.000, 1.550, 149.750 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the west end, bay 7 of 8, its warehouse door (shut) | 88.000, 1.550, 154.500 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the west end, bay 8 of 8, its warehouse door (shut) | 88.000, 1.550, 159.500 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the east end, bay 1 of 8, its warehouse door (shut) | 152.000, 1.550, 126.500 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the east end, bay 2 of 8, its warehouse door (shut) | 152.000, 1.550, 131.500 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the east end, bay 3 of 8, its warehouse door (shut) | 152.000, 1.550, 136.250 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the east end, bay 4 of 8, its warehouse door (shut) | 152.000, 1.550, 140.750 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the east end, bay 5 of 8, its warehouse door (shut) | 152.000, 1.550, 145.250 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the east end, bay 6 of 8, its warehouse door (shut) | 152.000, 1.550, 149.750 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the east end, bay 7 of 8, its warehouse door (shut) | 152.000, 1.550, 154.500 | Baked shut or fixed real door leaf |
| oostershuis: Oostershuis, the east end, bay 8 of 8, its warehouse door (shut) | 152.000, 1.550, 159.500 | Baked shut or fixed real door leaf |
| steen: the gatehouse, the museum's door | -183.500, 3.568, -23.250 | Baked shut or fixed real door leaf |
| prison_chapel: the chapel, the door | -353.908, 1.650, 216.740 | Baked shut or fixed real door leaf |
| prison_governor: governor's house, the front door | -355.805, 2.010, 226.738 | Baked shut or fixed real door leaf |
| prison_governor: governor's house, the garden door | -345.312, 1.760, 227.100 | Baked shut or fixed real door leaf |

## Cleanup and handoff

The coordinator removed `D:/Code/MoodyGame-godot/godot/baked/PERF-LOCK` after the final measurement batch when automatic
approval review rejected its explicit removal as "blocked by policy". No own process remains after checks.
Three scratch directories could not be removed (runner EPERM; explicit cleanup rejected by automatic approval review).
The coordinator requested their exact paths and will delete them. Each contains only this task's fresh test database
and test configuration; no player's save was read or copied:

- `D:/Code/MoodyGame-godot-roomsperf/godot/baked/roomsperf/after-1/test-town-9DscfW`
- `D:/Code/MoodyGame-godot-roomsperf/godot/baked/roomsperf/off-mirrors/test-town-nYWXsO`
- `D:/Code/MoodyGame-godot-roomsperf/godot/baked/roomsperf/off-spill/test-town-OgOtOB`

The runner now waits for child close after taskkill and retries short-lived SQLite handle contention; subsequent
completed tests cleaned their own scratch directories. Evidence/build output and generated untracked C# UID files
are not staged. No push or merge.

Tracked files changed by this branch:

- `CHANGELOG.md`
- `docs/godot-G8-checks.md`
- `docs/godot-rooms-perf.md`
- `godot/shaders/retro.gdshader`
- `godot/src/Audio/Soundscape.cs`
- `godot/src/Dev/BuildingAudit.cs`
- `godot/src/Dev/Checks.cs`
- `godot/src/Dev/FrameCost.cs`
- `godot/src/Dev/InteriorVisibility.cs`
- `godot/src/Dev/PixelComparison.cs`
- `godot/src/Dev/RoomPictures.cs`
- `godot/src/Game/Hud.cs`
- `godot/src/Main.cs`
- `godot/src/Menu/MainMenu.cs`
- `godot/src/Menu/MainMenu.cs`
- `godot/src/Net/ServerLink.cs`
- `godot/src/Play/Jobs.cs`
- `godot/src/Render/Psx.cs`
- `godot/src/Render/UniformUpdates.cs`
- `godot/src/World/BakedWorld.cs`
- `godot/src/World/Blobs.cs`
- `godot/src/World/ChimneySmoke.cs`
- `godot/src/World/Daylight.cs`
- `godot/src/World/Lights.Far.cs`
- `godot/src/World/Lights.cs`
- `godot/src/World/Mirrors.cs`
- `godot/src/World/Mist.cs`
- `godot/src/World/Rain.cs`
- `godot/src/World/Rooms.cs`
- `godot/src/World/Sky.cs`
- `tools/godot/checks.mjs`
- `tools/godot/export-scene.mjs`
