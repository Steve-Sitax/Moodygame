# Godot jobs and day by hand

Restart completed on `godot/jobs`, 2026-10-04, with `godot-port` merged through `11c2ca5`.

The prompt registry, automatic doors, carry/watch/deliver jobs and server settlement work. The jobs' board,
task card and quest book use the shared paper kit. E at a person opens talk; F buys. Talk and press take work
through the jobs part. The map has the job's marks and way goal. A world replacement clears the old run and
restores the server's job and progress. The decoded prop models travel from the ground to the hands;
normal job goods keep the browser's dimensions, speed penalty and no-jump rule. Baked goods survive a reset.
The payment line shows the server's trust change as well as the money.

Pockets are the talk part's existing window. A herring is pocketed and eaten there. Bought drinks are drunk
at the counter: `server/src/trade.ts` decides this, as in the browser. There is no drinking pump. Benches,
the doss house chooser, rent, four hours' sleep, low needs and collapse follow server replies. The chooser,
night sheet and trouble card belong to the dialog stack; the sleep fade lies below the menus.

The trouble card fetches the server's scene, lines and choices. A choice may leave an extra E errand at the
place the server names. Its step is reported with Jef's position; the server changes pay and trust.

## Checks

`dotnet build godot`, Godot's headless import and `npm run build` pass. The C# build retains the existing
nullable warning at `Town/Townspeople.cs:230`.

The full `--jobtest` run on a fresh test database and port 8965 passed 17 steps in 223.3 seconds, saved 35
pictures and recorded 11 goods request/reply pairs. Both crates reached the goal on foot without the test's
placement fallback. Carry paid 90 c, delivery 100 c, watch with the tarpaulin errand 90 c; each gave +1 trust.
Rent cost 150 c. The server reported 240 minutes slept. Needs at zero led to collapse and a night sheet.
The midday clear Vismarkt measured 2.95 ms mean and 4.28 ms p95 over 240 frames.

Evidence, local and outside git: `godot/baked/jobtest-proof/jobtest.json` and the 35 PNGs beside it, all viewed.
Close checks include `3-carrying.png`, `3-quest-book.png`, `3-job-map.png`, `5-trouble.png`, `6-sleep-chooser.png`.
A focused carry/delivery run after the payment-note layering correction passed 7 steps and saved 14 pictures,
including the talk window with the payment note underneath. It is in `godot/baked/jobtest-layers/`.
Its Vismarkt mean was 3.39 ms and p95 6.34 ms: the mean passed the 5 ms check, but that run's tail exceeded 5 ms.
Test databases are removed after their processes exit; JSON, logs and pictures remain.

## Hooks

- `Interact.I.Add(place or node, reach, label, action)` returns an entry to dispose when a thing goes away.
  Providers can offer exclusive keys, job keys, candidates or extra choices; facing and distance pick the winner.
- `Jobs.I.TakeJob`, `InHand`, `JobInHand`, `Tally` and `RestoreWorld`: work from talk or press, jobs set aside,
  mixed goods and a world replacement. `Sfx` takes the sound name and optional position.
- `Talk.Work`, `WorkLater`, `OnTakeWork`, `OnBought` and `Press.TakeJob` are connected here.
- `TownMap.JobMarks`, `WayGoal` and `PersonAt` are connected here. `Daylight.SetThickFog` follows job twists.
- `Day.I.AddBench`, `WakeHome`: extra benches and the home part's wake position.
- `Folk.LookAt`: the person's part can turn an employer toward Jef for a handover or an owner's protest.
- `Trouble.I.Present` and `Show(view)`: the walk-up's speaker has arrived. `View` is the current server trouble.
- `Goods.Answered`: goods request/reply evidence for tests.

## Still to port

The walk-up executor for trouble speakers and the stranger, foreman and thief twists is not in this part yet.
The card waits for a nearby speaker or the browser's ninety-second fallback when no walk-up is connected;
the self-test calls the arrival hook to test the card and real server choices. NPC routines/hired hands,
handcarts, dockers' piecework and night boxes still need their parts. The merged quay heaps and their sacks
remain scenery. The broader deeds layer (food theft, picking pockets, lanterns, velocipedes and police pursuit)
is not ported here; lifting and promptly returning an owner's goods already report the witness to the server.
A persistent numerical trust HUD is not added: settlement shows its delta, and pockets show the server's
words about Jef's good name.

Godot reports shutdown RID/ObjectDB leaks after the report is written: [issue #40](https://github.com/Steve-Sitax/Moodygame/issues/40).
One full run also logged WASAPI output-device invalidation at shutdown.

## Shared files

This restart edits none of `Main.cs`, `BakedWorld.cs`, `Solid.cs`, `Jef.cs`, `Api.cs` or `Wiring.cs`.
The earlier jobs branch added `Solid.Leave` in `Solid.cs` so doors and movable goods own their collision,
and the two goods API calls plus 409-as-answer handling in `Api.cs`. Other shared-file changes came from
merging the integration branch, not from this task. No render shaders, packages or assets were added.
