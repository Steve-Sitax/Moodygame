# Godot player rides

Worktree `MoodyGame-godot-play4`, branch `godot/play4`. The shared bake is read only.

## Falls

`Play/Falls.cs` listens to Jef's existing measured landing event and calls the typed `Api.Transport.cs` method. Health and injury words come from the unchanged server. Both stone and water landings are reported once at landing. No shared file is needed for this hook.

The initial `--ridetest` batch checks the real server at 2.99, 3, 5, 8 and 12 metres. All 11 checks pass: stone harm is 0/1/2/3/4, water harm is zero. Pictures `godot/baked/ride-falls/fall-3.png`, `fall-5.png`, `fall-8.png`, `fall-12.png` were inspected, at 13:45/clear. The test calls the same reporting owner; these threshold checks do not yet prove a physical fall from every height.

`node tools/godot/ride-check.mjs` imports once, checks PERF-LOCK, runs a real window with seed 1873, port 8985 and map port 8986, enforces a four-minute timeout and removes its test database. Soundscape is disabled: the first sound-enabled run passed the assertions but hit the existing shutdown audio resource problem (issue 40) and crashed at exit. The sound-disabled run exits normally. C# builds with the existing Grime nullable warning.

The self-test explicitly lists unimplemented rides. A successful fall batch does not mean complete ride parity.
