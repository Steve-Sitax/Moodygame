# Godot movers

Worktree: `MoodyGame-godot-movers`, branch `godot/movers`. The shared town is read from the integration worktree; it is never baked here.

## Omnibuses (2026-10-04)

The earlier helper's omnibus port is finished: the three routes and timetable from `shared/omnibusLines.ts`, the stops, acceleration and braking from `omnibus.ts`, steering front axles, rolling wheels and the horse pool's walk/trot. The crew uses `People/Human.cs`. The carriage glass follows `Daylight.I.LampsLit`. The railway exposes its busy stretches and rail band for the omnibus to wait outside them.

Checked with Godot 4.7.2 and `dotnet build godot`: `godot/baked/omnibus-final/moverstest.json`, movement 9.112 m in three seconds, leaving the Rijnkaai stop after its dwell, held at the terminus until morning at 23:30. The close day pictures were inspected. The night camera was moved off a house front after inspection. The combined mover mean in the first six-probe run was 0.429 ms per frame (before the carts are added).

The shared bake contains 14 live clock-hand meshes: four at Carolus, two at Sint-Paulus, four at the cathedral, two under Node289, one at the Oostershuis and one on the prison front. All 14 report running; three representative hands were read from their mesh at 9:15, 16:54 and 21:30, then again a few seconds later. This does not claim that room and shop faces absent from the shared bake have been rebuilt; new room clocks must call `Clocks.AddDial`.

The self-test now supplies the camera used for mover culling, hides the HUD for close pictures and fails a readiness timeout. No shared Main, BakedWorld, Solid, Psx or shader file changed for this batch.

## Street carts and goods rounds (2026-10-04)

Three drays and three handcarts use the browser's sampled street loops, paces, stops, horse gait and wheel rolls. They yield to Jef, solids, queues and the quay train. The two goods rounds follow the six legs and the game-minute sums in `shared/cartRuns.ts`; Sunday is a rest day. Carters use live Human skeletons. The handcart model baked into the carter's hips mesh is hidden once in a shared mesh copy, so the actual cart follows his hands.

`dotnet build godot` passes. Four probes in `godot/baked/streets-final/moverstest.json` pass: the goods dray moved 3.254 m, the sack cart 3.269 m, the roaming dray 3.312 m and the handcart 3.200 m. Both pictures of each were inspected; the goods cameras were then centred on their loads. Combined movers averaged 0.577 ms per frame in that run. This is not the final Rijnkaai benchmark. No shared file changed for this batch. Goods loads are still supplied by the goods owner; `GoodsDrays.BedOf` exposes their live beds.

## People, lamps and map (2026-10-04)

Omnibus seats and boarding paths use live Human figures, including people walking from the stop. Six baked waiters are replaced by the clock-driven stop groups. Moving street people slow the omnibuses and carts. Five moored families use 15 live Humans following their decks. Their hull transforms follow the tide. Ships absent from the shared bake use ModelLibrary; frozen cap meshes are hidden.

Boat lanterns use the model library's lamp points and one pooled additive mesh. Omnibus lamps have moving spill sources. The only shared file changed in this batch is World/Lights.cs: AddMoving supplies the existing nearest-light pool with a moving position and brightness. No Godot lights, shaders or Psx changes were introduced. MoverMap supplies TownMap.SetMovers while the map is open; it reports the live vehicles without work when closed.

Build passes. The nine focused tie-in probes in godot/baked/tie-ins passed. The later 33-probe run in godot/baked/movers-verified passed boarding, passengers, families, lanterns and all 14 clocks, but found two contaminated self-test fixtures (the raised lock bridge and a crane reserved by an earlier train test). Those fixtures are being corrected separately. The warm Rijnkaai mean was 0.7262 ms per frame; the omnibus maximum was 1.131 ms, so this is an average budget measurement, not a guarantee for every frame.

The town's close midday pictures remain very dark: outside the mover port, tracked at https://github.com/Steve-Sitax/Moodygame/issues/42. Shutdown resource warnings are already tracked in issue 40. The boat and omnibus lamps can be inspected at night. Named resident trip ownership and Jef boarding remain integration work; BoardResident and ResidentOff expose the live omnibus seats, and GoodsDrays.BedOf exposes the goods beds.

## Mover self-test (2026-10-04)

--moverstest writes two close pictures and world positions for 33 cases, including a minute-hand mesh, tides, traffic, opening leaves, gates, wagon solids, crane clearance, boarding and lamps. --moversonly selects name prefixes. The final six seconds measure the movers at the Rijnkaai after warming the view; a mean at or above 1 ms fails. Clock reports read the actual mesh hands on all 14 faces.

Fixtures reset the raised lock bridge and clear train reservations before testing crane travel. The focused correction run godot/baked/fixtures-final passed all five cases: lock bridge 1.346 m and travelling crane 2.382 m. Both pictures of the bridge, crane, moored hull and Anna Maria were inspected. The quay train check queries each wagon's live physics body, and crane probes test the nine-part clearance sums.

## Goods beds and blocked omnibuses (2026-10-04)

After the incoming integration merge, Play/Goods.cs has a two-line ShowHeld hook for the mover. MoverGoods puts the server's held cart items on the two live beds in CART_RUNS order, using the cask positions and handcart slots, scale and stacked heights from goods.ts. Nothing is sent to the server. Merged sack heaps remain the goods owner's scenery; this hook does not split their baked meshes.

Omnibuses recheck the three lane points against live physics while excluding their own two bodies. They back 9 m at 0.9 m/s after 60 s blocked, or after 8 s caught in the railway band, only with the way behind clear. They wait outside the railway band as long as the train needs. Stops wait while passengers get down or people walk aboard. Timetable rounding now matches JavaScript's rounding at a half.

The eight focused probes in godot/baked/integrated-streets-final pass: cask and sack attachments travel with their beds, a stop completes its dwell after boarding, and the omnibus backs 2.683 m in three seconds. The attachment and backing pictures were inspected. Their mean at the Rijnkaai was 0.9251 ms per frame. The self-test now also records simultaneous mover time per frame (mean, 95th percentile and maximum), so occasional spikes are not hidden by separate means. These changes introduce no Main or BakedWorld edit; shared changes are Play/Goods.cs and the earlier World/Lights.cs and one-line Solid mover exclusion.

## Full verification and far updates (2026-10-04)

All 36 probes pass in `godot/baked/movers-proof/moverstest.json`. All 72 pictures were inspected. `godot/baked/canal-picture` has the two replacement canal-boat pictures: the fixture now starts inside the canal, clear of foreground moored ships. Train and gate cameras are closer. The crane travel fixture restores the initial runway positions before starting; earlier train and crane probes cannot strand it with no next berth.

Individual far moored boats update in eight turns, and far street vehicles reuse front-obstruction queries for four turns. Nearby vehicles and player/people/queue checks still run every frame. The warm Rijnkaai measurement is 0.7206 ms mean, 0.949 ms at the 95th percentile, 16.921 ms maximum over 1,138 frames. This meets the mean budget, not a strict every-frame 1 ms bound. Whole-tour mean is 0.7002 ms, with 37.378 ms peak. The report records peaks explicitly. No claim is made that the no-serverlink test verifies town resident journey ownership or network goods loading.

Build succeeds with the integration branch's two nullable warnings in Grime.cs and Townspeople.cs. The incoming merge is godot-port at 2edc812. There were no bake, shader, Psx, live checkout or integration worktree edits. Shutdown resource warnings remain issue 40; dark clear-day lighting remains issue 42.

## Crane clearance against ships and wagons (2026-10-04)

The browser's one-metre tall cells above 4 m are now collected once from moored model meshes. Each crane keeps only cells within reach of its runway, with tide and grounding floors applied at each trial step. Hold angles must be clear at the highest spring tide. Jibs keep the browser's 1 m margin from those cells. The other cranes' falls also keep that margin from the train's wagon and horse capsules; the booked working crane can lower its hook into a wagon.

`godot/baked/crane-margin-proof/moverstest.json` passes all four focused train/crane probes. The crane checks now include actual ship and passing-train clearance as well as mutual crane parts. Both pictures of every probe were inspected. Build passes. Warm Rijnkaai combined cost in that run: mean 0.5768 ms, p95 0.708 ms, peak 0.983 ms over 1,453 frames. No shared file changed.

## Integration handoff

The incoming checks/sound integration is now merged through godot-port at 4200b38. Mover parts register themselves through GamePart; Main.cs and BakedWorld.cs have no mover-branch changes against that integration head. The complete shared-file delta is:

- World/Solid.cs: skip a claimed mover's baked collider, because its owner supplies the moving physics body.
- World/Lights.cs: register moving lantern sources in the existing spill pool and preserve their supplied level.
- Play/Goods.cs: offer held goods to the cart-display callback before hiding them.

Pictures and JSON are local ignored artifacts, not committed images. The full 36-case evidence is in `godot/baked/movers-proof`, clearer canal pictures in `godot/baked/canal-picture`, and the later ship/train crane-clearance evidence in `godot/baked/crane-margin-proof`. These runs used the shared town and model directory, `--no-ai --no-serverlink`, clear weather and no new server process.

Still outside the completed movement core: named town resident journey ownership and Jef riding the omnibus; rowing-player boat avoidance and the anchorage tow watchdog; the railway shunter/gatekeeper and horse harness detail; cooperative requests between blocked cranes, real docker pile feeds and the walkable crane cabin; rail stops for loose goods; interior/shop clocks absent from this bake. `Omnibus.BoardResident` / `ResidentOff`, `GoodsDrays.BedOf`, `Clocks.AddDial` and the existing mover map list are the integration points. Ships, moored hulls, opening bridges, lock gates/water/bridge, train/wagons/gate, cranes, street vehicles and all 14 baked clock faces already move. These limitations must not be read as complete browser feature parity.

There were no outgoing merges or pushes. Unrelated untracked `.cs.uid` files generated by imports have been left alone; all mover source and its own metadata are committed by explicit paths. The performance lock at the shared baked directory is checked before every further Godot invocation.

## Live rail obstruction checks (2026-10-04)

The train now reads StreetPeople.Walking and applies railway.ts's last-resort stop for a person within 1.1 m of its next three metres. Travelling cranes check people against the four leading bogie points. Idle hooks stay above the rail band at the browser's travel height, rather than sagging into a passing wagon's clearance. A new `train_yields_to_a_person` self-test puts a live Human/Puppet ahead of the horses through the same street-person input and requires a stationary train with wait reason `people`. This is a controlled no-server fixture, not a test of the server's population schedules. It takes the default self-test to 37 cases.

After PERF-LOCK cleared, the guarded headless import succeeded and the full 37-case run in `godot/baked/movers-handoff/moverstest.json` passed. All 74 pictures were inspected. The live-person fixture stops the train; wagon physics and crane clearance also pass while the train moves and loads. No new source files, shared files or packages were added by this change.

To repeat all cases after integration, use the full console executable named in godot/README.md, after checking that `D:/Code/MoodyGame-godot/godot/baked/PERF-LOCK` is absent:

```powershell
dotnet build godot
# Console executable, not the broken godot link on PATH:
& $godotConsole --path godot -- --town D:/Code/MoodyGame-godot/godot/baked/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models --no-ai --no-serverlink --hour 13.5 --weather clear --moverstest D:/Code/MoodyGame-godot-movers/godot/baked/movers-repeat
```

Use a bounded launch and one window at a time. `--moversonly train,crane` narrows the runtime check; the model/human/goods test fixtures do not write server state or touch saved games. `moverstest.json` records both samples, picture names, assertions, all clock faces and per-frame simultaneous costs.

Final warm Rijnkaai cost: **0.6186 ms mean, 0.752 ms p95, 1.281 ms peak**, 1,351 frames. The complete tour mean is 0.6623 ms, peak 31.892 ms; those longer-run stalls are recorded, not dropped. This meets the mean budget, not the strict every-frame bound. The final report contains all 14 running clock faces and 25 live map markers. The benchmark measures the C# mover updates on the main thread; it is not the renderer or whole-engine frame cost. The two build warnings and the shutdown resource warnings are unchanged from integration. No own Godot or Node process remains.

## Bounded timing samples (2026-10-04)

The mover timing recorder now stores a fixed 65,536-frame percentile window, plus lifetime sum/count/maximum. Ordinary play cannot grow an unbounded list of timing samples. JSON `combined.samples` reports the percentile sample count; `combined.frames`, mean and maximum still include all measured frames. The railway reuses its drawing index dictionary rather than allocating it every frame.

The final 37-case tour exercised the ring past its capacity: 71,582 total frames and 65,537 percentile samples including the current frame. The separate warm benchmark used all 1,351 of its frames. Both reports preserve their full-period means and peaks.

## New bake: all clocks and collection pauses (2026-10-04)

Merged `godot-port` at `5f2589a` before this batch. All runs use the shared `baked/next/town.glb` and `baked/models`, no AI, disposable test databases, bounded timeouts and ports 8915–8917. The shared `baked/PERF-LOCK` was checked before every Godot launch; no launch occurred while it existed. The checks runner now enforces the same guard, checking again every 60 seconds.

The new bake contains 96 real clock-hand meshes, including the room/shop clocks and clockmaker's window absent from the older 14-face inventory. The clocks check changed the server's time while `--hour` still held `MoverClock` at its launch hour. `Kit.Light` now resets that held clock too. Both checks read `Clocks.Dials`/`Report`, and an independent marker scan fails for any omitted face. Actual hand transforms are read, rather than trusting the cached displayed minute. The shared browser minute/hour formulas and hand shape are retained. Each dial's two hands and hub are built once; game-minute changes rotate immutable hands instead of rebuilding surfaces.

The reported 31.892 ms tour peak was reproduced with allocation/collection counters on the new bake. Its 62,289-frame baseline peaked at 44.217 ms; every one of its twelve update spikes above 8 ms coincided with a generation-0 and generation-1 collection. This identifies collection pauses, rather than an unmeasured guess about JIT or collider creation. The recurring allocations included lamp-registration closures, boxed bridge/street enumerators, captured bus/anchorage predicates, physics-result wrappers, temporary arrays, bone-name/path lookups and minute-by-minute clock meshes. Ship/lock/bridge variants, boat dimensions and horse curves now prepare during loading; their original motion dice are consumed on first use. Immediate native overlap casts reuse their shapes and results. Human hands still follow current bone poses, with their skeleton and bone indices cached.

| Measurement | Baseline, new bake | Final, new bake |
|---|---:|---:|
| Whole-tour combined mover mean / p95 / peak, ms | 0.6987 / 0.902 / 44.217 | 0.6219 / 0.802 / 14.243 |
| Whole-tour measured frames | 62,289 | 67,851 |
| Managed bytes per mover frame, mean | approximately 6,715.93 (sum of per-part means) | 8.19 |
| Managed bytes per mover frame, median / p95 | not recorded by the baseline | 0 / 0 |
| Frames with zero mover allocations | not recorded by the baseline | 67,469 / 67,851 (99.44%) |
| Warm Rijnkaai mean / p95 / peak, ms | 0.7189 / 0.967 / 2.234 | 0.7101 / 0.881 / 1.707 |
| Warm managed bytes/frame, mean / median / p95 | approximately 4,065 mean | 15.79 / 0 / 0 |

Final artifacts: `godot/baked/movers-final/moverstest.json` and `godot/baked/clocks-movers-final/clocks/clocks.json`. The 37 mover cases pass and all 96 clocks run. The test now fails a tour or warm combined mover update above 16 ms, as well as the existing 1 ms warm mean budget. Allocation measurement brackets each update with `GC.GetAllocatedBytesForCurrentThread`; JSON includes per-part bytes and bounded frame percentiles. Rare boarding/route transitions still allocate (tour maximum 22,704 B); steady updates have zero allocations. These timings cover the combined mover updates, including startup and spawn/switch work inside them, not renderer/GPU time or unrelated game systems.

`dotnet build godot`, `npm run build`, JavaScript syntax and whitespace checks pass. Close tower pictures show the advancing hands. No shared Main, BakedWorld, Solid, Psx or shader file changed. Test databases and own processes are removed after the checks. No push or outgoing merge.
