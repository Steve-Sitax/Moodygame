# Godot net part: round two handoff

2026-10-04, branch `godot/net`. Work stays in its own worktree. Latest `godot-port` was merged into this branch
at the restart; nothing was pushed or merged back.

## What works

- The existing solo HUD, typed payloads, guest header and push hello, retry after HTTP 429, clock and movement
  calls are retained. Pause has one owner (`Menu.Pause`); pushes wait during pause and the server is told again
  after reconnection, also in runs without the menus.
- Night, waking, midnight, rent and the week's ending use `Scheldemist.Windows`, the game window stack.
  After integration, `Game/DaySheets.cs` is their only owner. `Play/Day.cs` keeps the chooser, active rest
  and fade; it sets `SleepShown` while resting and says that rest's wake lines itself. Midnight's words
  during a chosen sleep are kept for waking, as in the browser's `day.ts`.
- Godot hosts and guests use the unchanged server and protocol 5. Local walking is local; the received batches
  only position other players. Player profiles, money, needs and jobs come through each player's token.
- Other players have bodies from `people.glb`, motion and name tags. Each has the browser's jitter buffer:
  Hermite interpolation, a starting delay of 100 ms adapting within 80–250 ms, and at most 250 ms of guessing.
- Remote boats, velocipedes and handcarts use decoded models, with wheel motion and disposal when released or
  the player leaves. `Together.Gear` is the hook for the local transport parts; `GearModel` can replace the default.
- Menu and P do not pause together. The host's Pause all does. Its control push bypasses the held game pushes;
  a reconnect asks for the current pause state. The self-test waits for a real movement welcome.
- The Together handbill item uses the menu paper kit: host for the house, address and code, join, and guest leave.
- `--mptest` uses fresh databases, isolated test tokens, bounded waits and a child-process job. Both players walk
  by `Jef.SetKey`, take turns photographing the other's walking body, report their metres and timing, and quit.
  The guest is also checked after leaving: its own server, its own Jef, and no guest token on its calls.

## Checks and pictures

`dotnet build godot`, the headless import and `npm run build` passed. The build retains one existing nullable
warning in `Town/Townspeople.cs:230`. The Node dependencies are installed normally in this worktree.

All picture paths below are under `godot/baked/` in this worktree, ignored by git. Every saved picture was looked at.

| Check | Result | Evidence |
|---|---|---|
| Solo link and HUD | Passed: HTTP and push first state, tick, held pushes, server pause/unpause, 13 map reports | `net-final/nettest.json`, `net-final/nettest.png` |
| Day papers | Passed: collapse, waking, midnight, rent, week ending and Esc behaviour | `day-restart/daytest.json`; `day_night.png`, `day_morning.png`, `day_midnight.png`, `day_end.png` there |
| Together menu | Passed: handbill item, three join fields, LAN host, close, P, three gear models | `together-lan/togethertest.json`; `together-title.png`, `together-join.png`, `together-host.png` there |
| Two Godot processes | Passed: separate state, Pause all, no menu pause, walk, visible moving bodies, leave, home, exit | `mp-checked/mptest.json`, `mp-checked/mp_host.png`, `mp-checked/mp_guest.png` |
| Browser movement code against Godot host | Two existing harness players joined and exchanged frames using the browser codec and interpolation | `mp-browser-harness.json` |

The eight-second measured walk from the final run (host watching Anna, guest watching Jef):

| Meter | Host | Guest |
|---|---:|---:|
| Camera snaps | 0 | 0 |
| Drawn pace, m/s | 1.547 | 1.549 |
| Jitter p95, m | 0.0048 | 0.0030 |
| Delay, ms | 80 | 80 |
| States / dropped / starved | 160 / 0 / 0 | 160 / 0 / 0 |

The same run included two browser-code harness guests after the Godot pair joined. Their four-second check had
position error p95 0 m, jitter p95 0.0015 m and delay 98 ms. Its `correctionsToMover` counter also counts world
ownership text; it is not used as proof of camera correction. The actual Godot camera counters above are zero.

`--shots` on this shared bake measures only Vismarkt (the bake has one stored view): mean 2.398 ms, p95 3.687 ms.
Five additional clear-midday views were checked through `--snap`, without a server or live townspeople. These are
static-town frame checks, not a six-player or fully replicated moving-world benchmark. Pictures are in `net-five/`.

| View | Mean, ms | p95, ms |
|---|---:|---:|
| Vismarkt | 1.77 | 2.62 |
| Grote Markt | 1.33 | 1.77 |
| Cathedral | 1.05 | 1.29 |
| Handschoenmarkt | 1.17 | 1.48 |
| Rijnkaai | 2.45 | 3.29 |

The corrected Handschoenmarkt view is at (-235, 1.62, 128), facing west, from `net-handschoen.log`;
its first attempted point was inside the cathedral wall and is not used for the measurement.

## Assets and browser compatibility

A Godot guest uses its installed baked town and decoded models. It does not use `/manifest.json`, `/a/<sha256>`,
the browser's IndexedDB hash store, SHA worker, asset download queue or gzip asset transfer. Those server paths
remain for browser guests. The HTTP and movement protocols were not changed; the existing browser movement
harness joined this Godot-owned server. A full browser can still join when the host serves the browser build;
this restart checked protocol compatibility, not a browser rendering session.

## Remaining integration

The later M8 townspeople, animals, job figures and moving-world ownership adapters are not ported here.
`OtherBatch`, `OtherText`, `SendBinary`, `SendText`, `PlayerAt`, `Positions` and `FigureOf` expose their connection.
Until those owning parts attach their adapters, PCs walk their own townspeople from the shared clock; the world
is not fully identical on both screens. Local transport still needs to supply `Together.Gear`. Platform-frame
reconstruction and carried-goods placement need the owning transport/goods parts too.

Bodies currently choose a man or woman from the appearance code; the full browser clothing palette is not yet
applied. This run checked a LAN-capable menu and loopback joining; another physical PC and bad-line Godot
movement were not exercised. The original exits retained Godot native resource-leak notices; the fixes
branch traced these to the reusable talk input kept outside the tree and frees it at exit.

Returning home reloads the scene. `Folk` kept the old town and resident index: `Interact._Process` called
`Folk.Near`, which read a freed street body's position. `Townspeople._ExitTree` now clears that cache before
disposing the crowd, and also clears the `Humans` body/animation cache before freeing the model library:
otherwise a later `Humans.Make` duplicates a disposed source node. The two-player test fills and rereads the
resident cache across the reload, and creates and animates a fresh body after returning home. Its guest port
follows the host test's port, and its settings and engine log stay in the test folder.
`Paths.Initialize` now selects the same disposable host/guest database as `ServerLink`: the merged download
paths had otherwise ignored that test choice. The home check also requires solo play and the fresh player's
50 centimes, so sharing the host's database cannot pass.

The post-merge fixes run on 2026-10-04 passed `mptest`, `nettest`, all 67 `menutest` checks,
`daytest` and all 17 `jobtest` steps on the same build. Evidence is in the ignored
`godot/baked/fixes-proof/<test>/` folders. The multiplayer host used 8944; the guest returned to its own
server on 8945, read the new residents and animated a fresh body. Both camera-snap counters were zero.
Net checked first state by call and push, pause holding, resumed pushes and 14 town-map reports.
Day checked one night paper, closing it, rent, midnight and an ending that stays open on Esc.
All final logs, including the guest engine log, had no ERROR lines, disposed-object exceptions or leaks.
Each run had a timeout and ran alone. `SCHELDEMIST_MAP_PORT=8948` kept the map inside the test port range;
the guest's map stayed off while that port was taken. Test databases were deleted and all test processes stopped.

## Shared files

Only `godot/src/Net/Api.cs` from the shared-file list was edited: pause holding delegates to the menus' single
pause owner, the duplicate gate DTO/call was removed, and Pause all uses the immediate control-push channel.
`Main.cs`, `BakedWorld.cs`, `Solid.cs`, `Jef.cs`, `Wiring.cs`, `Render/Psx.cs` and shaders were not edited.
`ServerLink.cs` wires the guest join before the first API call, pause retry, test database and cleanup.
`Menu/MainMenu.cs` adds Together and prevents the solo P card appearing together.

All test databases, test tokens and test host configuration files were removed after the checks. No Node or
Godot process started for these checks was left running; the test HTTP and map ports had no remaining listeners.
