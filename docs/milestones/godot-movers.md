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
