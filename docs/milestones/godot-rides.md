# Godot player rides

Worktree `MoodyGame-godot-play4`, branch `godot/play4`. The shared bake is read only.

## Falls

`Play/Falls.cs` listens to Jef's existing measured landing event and calls the typed `Api.Transport.cs` method. Health and injury words come from the unchanged server. Both stone and water landings are reported once at landing. No shared file is needed for this hook.

The initial `--ridetest` batch checks the real server at 2.99, 3, 5, 8 and 12 metres. All 11 checks pass: stone harm is 0/1/2/3/4, water harm is zero. Pictures `godot/baked/ride-falls/fall-3.png`, `fall-5.png`, `fall-8.png`, `fall-12.png` were inspected, at 13:45/clear. The test calls the same reporting owner; these threshold checks do not yet prove a physical fall from every height.

`node tools/godot/ride-check.mjs` imports once, checks PERF-LOCK, runs a real window with seed 1873, port 8985 and map port 8986, enforces a four-minute timeout and removes its test database. Soundscape is disabled: the first sound-enabled run passed the assertions but hit the existing shutdown audio resource problem (issue 40) and crashed at exit. The sound-disabled run exits normally. C# builds with the existing Grime nullable warning.

The self-test explicitly lists unimplemented rides. A successful fall batch does not mean complete ride parity.

## Omnibus

`Play/Ride.cs` owns the browser's boarding and walking rules: E within 2.8 m of a stopped back step, E or Space within 2 m of a rolling step, no goods aboard, a bounded platform/door/aisle, occupied seats respected, F by the roof ladder and E back down. Jef follows the live frame, including turns. Moving alighting checks three landing positions against ground, water and bodies. The conductor comes after 1.8 seconds, accepts 1 to pay through server hopOn, or 2/Esc/15 seconds without an answer to put Jef off where there is room. All fares, changes, needs and tickets remain server-owned. Stop timetable requests have their own typed reply and real post prompts.

The conductor paper is cached between uses, as the browser keeps its fare element: replacing it immediately produced an empty second paper on this renderer. Both pay and refusal papers now have visible ink. Numbered rows and key hints work through the normal dialog stack. A replacement save clears local riding and alights any restored server ticket, as the browser does. Load races and remote-world holds still need dedicated multiplayer tests.

`godot/baked/ride-omnibus-proof/ridetest.json`: 41 checks pass (fall thresholds plus an actual 5.2 m landing reported once, stopped boarding, moving E/Space hopping, fare payment/refusal, roof/inside, moving-platform following, safe alighting and real timetable). Boarding costs the server's 5 c; paying another hop costs another 5 c; refusal costs zero. 10,000 omnibus drive calls allocate zero managed bytes. The test uses the live route but positions Jef and the bus near the Rijnkaai stop; it does not claim a full continuous ride round every line. Close pictures are `omnibus-step`, `omnibus-platform`, `omnibus-roof`, `omnibus-moving`, `omnibus-inside`, `conductor-pay`, `conductor-refuse`, `stop-timetable` in that directory. Midday lighting remains the existing issue 42.

Shared edits for this feature: `Player/Jef.cs` has two hooks (external translation and jump interception); its companion partial file owns transport helpers. `Movers/Omnibus.cs` has one hold check during boarding. `Movers/OmnibusPeople.cs` excludes the player's occupied seat from resident boarding. Their implementations live in `Movers/Omnibus.Player.cs`. No Main, BakedWorld, Solid, Mantle, Wiring, Jobs or Interact change. No new materials, shaders or lights.
