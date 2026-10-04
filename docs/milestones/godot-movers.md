# Godot movers

Worktree: `MoodyGame-godot-movers`, branch `godot/movers`. The shared town is read from the integration worktree; it is never baked here.

## Omnibuses (2026-10-04)

The earlier helper's omnibus port is finished: the three routes and timetable from `shared/omnibusLines.ts`, the stops, acceleration and braking from `omnibus.ts`, steering front axles, rolling wheels and the horse pool's walk/trot. The crew uses `People/Human.cs`. The carriage glass follows `Daylight.I.LampsLit`. The railway exposes its busy stretches and rail band for the omnibus to wait outside them.

Checked with Godot 4.7.2 and `dotnet build godot`: `godot/baked/omnibus-final/moverstest.json`, movement 9.112 m in three seconds, leaving the Rijnkaai stop after its dwell, held at the terminus until morning at 23:30. The close day pictures were inspected. The night camera was moved off a house front after inspection. The combined mover mean in the first six-probe run was 0.429 ms per frame (before the carts are added).

The shared bake contains 14 live clock-hand meshes: four at Carolus, two at Sint-Paulus, four at the cathedral, two under Node289, one at the Oostershuis and one on the prison front. All 14 report running; three representative hands were read from their mesh at 9:15, 16:54 and 21:30, then again a few seconds later. This does not claim that room and shop faces absent from the shared bake have been rebuilt; new room clocks must call `Clocks.AddDial`.

The self-test now supplies the camera used for mover culling, hides the HUD for close pictures and fails a readiness timeout. No shared Main, BakedWorld, Solid, Psx or shader file changed for this batch.
