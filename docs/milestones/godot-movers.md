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
