# Testing in the browser

How to check a change in the game quickly, and where and when to look. Steve's rule (CLAUDE.md): every
milestone and every batch of fixes ends with a run in the browser, not a backend check. This is the
routine for that run. The tools: `tools/teststack.mjs` (a copy of the save with its own server and vite)
and the test kit in the tab, `__scheldemist.t` (`client/src/dev/testkit.ts`).

## The rules
0. **Steve plays from his own copy** (2026-09-25): `D:\Code\MoodyGame-play`, a detached git worktree, on 5173 and 8787,
   with `SCHELDEMIST_DB` pointing at `D:\Code\MoodyGame\data\game.sqlite`. Work happens in `D:\Code\MoodyGame`;
   his game does not see it until a finished, committed batch is checked out there
   (`git -C D:/Code/MoodyGame-play checkout --detach <commit>`, and `npm run setup` there if a package.json changed).
   Tell him before a refresh. Never edit files in the play folder.
1. **Never on Steve's game.** His game runs on 5173 (vite) and 8787 (server) with `data/game.sqlite`. Tests run
   on a copy, on 5341 and 8941. The kit refuses to write to the save on 5173.
2. **A good view.** Midday, clear weather, needs full, the camera close to the thing under test and
   looking at it. Night, fog or rain only when that is what you test. Look at every picture before you
   trust it: a black or empty picture proves nothing.
3. **Don't wait: make it happen.** Start the job, the event or the person you need (below). Run the
   clock forward with `t.run()` instead of waiting in real time.
4. **Silent, and closed when not needed.** Test copies play to no speaker (the soundscape's `speaker` gain is 0 on
   any port but 5173); never unmute it. Keep one test tab, and close it as soon as the check is done: tabs in the
   Claude app's browser pane keep running (and once kept playing) after Steve closes his own browser.
5. **Look closely, fix, look again** (Steve, 2026-09-25). Every new or changed event, action, animation or held
   prop is checked in close shots (front and side, 1-3 m) and adjusted until it looks and behaves right: hands
   hold what they hold (use `holdInHands` in `game/wardrobe.ts` for a prop, `reachArm` in `game/reach.ts` to bring a
   hand to a thing: a crank, a fiddle's neck), feet on the ground, timing that reads. A passing test is not enough.
6. **Clean up.** `t.done()` in the tab (it closes the audio), then `node tools/teststack.mjs stop`. The
   copy, its logs and its vite config go; no stray servers stay on the ports.

## Start and stop
From the repo root:

    node tools/teststack.mjs start            copy the save, start server 8941 and vite 5341
    node tools/teststack.mjs status           what listens on 8941 and 5341
    node tools/teststack.mjs stop             stop both by port, delete the copy, the logs, the config

The name and ports can change, so that two checks can run at once:
`node tools/teststack.mjs start lock --server 8942 --vite 5342`, then stop it with the same name and ports.
The test vite has no hot reload: after a client edit, reload the tab. After a server edit, stop and start.
In a fresh git worktree, run `node client/scripts/copy-draco.mjs` once before the first start: the test vite does not run `predev`, and without `client/public/draco/` the city model does not load (no houses, `Unexpected token '<'` in the console).

Open `http://127.0.0.1:5341/` (the preview tab), then in the page:

    __scheldemist.free(true)      start the game without a mouse click (and the audio)
    const t = __scheldemist.t
    t.help()                      the list below
    await t.light()               13:00, clear, needs full

A hidden preview tab does not draw frames: the game only moves when you run it (`t.run`, `t.until`).
One call may take at most about 15 s in the preview tool, so `t.run()` does 30 real seconds a call at most:
15 game minutes. `t.run` and `t.until` run the client only; the server's clock ticks on in real time (5
game minutes every 10 s) while the game plays. To move an event through its stages, use `t.skip(min)`: it
jumps the server's clock on and ticks once, and the stages it passes are played.

## The kit (`__scheldemist.t`)
| Call | What it does |
|---|---|
| `light(hour = 13, weather = "clear")` | Sets the clock and the sky, fills the needs. Test save only. |
| `time(h, m)`, `weather(w)` | The clock or the sky alone. Test save only. |
| `places("quay")` | Named places: the Dev menu's jumps, the town's places, the job spots, the shops. |
| `go("vismarkt")`, `go([x, z])` | Jef on free ground there (never on the water), facing the middle of a square. |
| `find("Ward")`, `find("fishwife")`, `find("auctioneer")` | Townspeople by name, first name, trade, id, or an event lead's role; nearest first, with where they are and whether they are drawn. |
| `meet("Ward Cuypers")` | Jef 2.2 m in front of them, facing them. Only 50 people are drawn at once; if they are not, the kit draws them there. |
| `summon("tobacconist")` | Brings a townsperson 3 m in front of Jef. They wait there, facing him, until `clear()`. Not someone busy in an event: `meet` them there. |
| `spawn("thief", { walkTo: [x, z] })` | A job figure (thief, stranger, foreman, recipient) 5 m ahead on land. It walks the walk grid and never over the water. |
| `job({ type: "watch", twist: "thief" })` | Puts that job on today's board, takes it, puts Jef at its start. Types: carry, watch, deliver. M7 short jobs: `items` (1-2 by hand, the engine clamps) and `cart: true` (a cart job: the employer's handcart stands by the goods). Twists: carry (broken_goods, stranger_offer, foreman_watches, thick_fog, heavy_load), watch (thief, bribe, foreman_watches, thick_fog), deliver (stranger_offer, thick_fog). Also `goods`, `from`, `to`, `employer`, `urgent`. Test save only. |
| `event("fish_auction")`, `event("invent")` | Starts an event template now, or asks the director for its own. Jef goes to its place. The engine's rules still hold: no overlap with a running event nearby, so pick another place or wait for the other to end. Test save only. |
| `run(s)`, `until(() => cond, maxS)` | Runs the game now, even with the tab hidden. Figures you spawned move with it. 30 real s at most a call (15 game minutes). |
| `skip(min)`, `rate` | Moves the server's clock on by `min` game minutes the way the game does (M7 night: through midnight too; the date turns on the way, a new board goes up) and ticks once, so events, actions and the director move on. `rate` is the clock's rate. Test save only. |
| `gang(answer?)` | M7 night: a gang of three steps out where Jef stands (the engine's roll skipped). Without `answer` the panel waits for R, F, H, P (14 real s, then they rob him); with `"run"`, `"fight"`, `"shout"`, `"pay"` or `"stand"` it answers at once. `__scheldemist.night.info()` for the figures and the log. Test save only. |
| `nightWork(fallback?)`, `givers()` | M7 night: the night's work now (the model's, or with `true` the hand-written jobs); where the four givers stand and whether they are out (21:00 to 5:00). Test save only. |
| `boxes()` | M7 night: the employers' quest boxes, where they stand, and whose man is away now. |
| `shot("name", target)` | A picture from Jef's side of the target, 4 m off, eye height, fog pushed back to 120 m. Saved as `data/shots/name.jpg`. The target can be a person's id or name, a place, `[x, z]` or a spawned figure. |
| `state()` | The clock, where Jef is, the people near, the events, the job, spawned figures. |
| `clear()`, `done()` | Remove spawned figures and let summoned people go; `done()` also closes the audio and parks the tab. |
| `pause(on = true)`, `paused()` | M7: P's pause (the card, the server's pause, the sound suspended); the pause now: its reasons, the ms paused, the card, the audio. While paused `run`, `until` and `step` do nothing. |
| `focusTest({ trouble, only })`, `mouseTest(...)`, `snapTab(name)` | 2026-09-26: every dialog registers in `game/dialogs.ts`. `focusTest` opens each kind (a talk idle, waiting on its reply and typing, the shop list, a press page, the dice, the gang; with `trouble: true` a trouble card, one model call each), leaves the window (the lock lost, blur, no focus), by the menu (Esc, Esc) and by P, comes back and presses a key the dialog uses; `mouseTest` moves the ink cursor (`game/cursor.ts`) onto a line or key of each and clicks. `ok` must be true. `snapTab` saves the tab as seen (the picture and the papers on it) as `data/shots/<name>.jpg`. Test save only. |
| `save("slot1", name?)`, `load("slot1")`, `saves()`, `capture()` | M7: save into a slot (`slot1`..`slot5`, or `"auto"`): the game pauses while the server waits for the model calls on their way; load one (the page reloads: wait, then `free(true)` and `const t = __scheldemist.t` again); the list; the browser's part of a save as it would be written now. Test save only. |

Also still there: `__scheldemist.paths()` (must be `[]` before a milestone ends), `__scheldemist.popcheck()` (M7 walk-up: job and quest people who became visible within 20 m without walking in; `pops` must be `[]`; `popcheck(true)` resets; `walkup.come("police", "crime")` calls someone up as a job would), `await __scheldemist.stallcheck()`
(every market stall, town stall, shop table and awning, cathedral stall and goods set out before a shop against the
house walls, corners, doorways, the walk map and each other; `problems` must be 0; build the lively streets and put
the markets up first: a market day, 10:00), `await __scheldemist.zfight()`
(faces in one plane that flicker, by cause; the houses list 4 small ones, see M3c pass 5),
`__scheldemist.shaders()` (the shaders and their light settings; `problems` must be empty, see rendering.md),
`__scheldemist.spill()` (night: every lit window, open door, lamp and lantern in view range, whether it glows and throws
its light per pixel, as a ground pool or by its own real light, and where its pool starts against its wall; `problems`
must be empty; `spillInfo()` the counts, `spillBudget(n, bars)` the graphics knob; world/spill.ts), `perf(n)`,
`step(s)`, `shotFrom(name, from, to, fogFar)`, and each part's `info()` (`events`, `ballads`, `actions` ...).
Server dev routes: `POST /api/dev/set {day, hour, minute, weather, food ...}` (sets the hands only: no date
turns), `/api/dev/advance {minutes}` (M7 night: as the game moves the clock, midnight included), `/api/dev/job`,
`/api/dev/director {template | invent | think}`, `/api/dev/ballad {corner}`, `/api/dev/new-board`,
`/api/dev/gang`, `/api/dev/gang-chance`, `/api/dev/night-work {fallback}`.

## Pause and saves (M7 save and pause)
`docs/milestones/M7-save-pause.md`. What a check must know:

- **Paused, nothing runs**: not the frames, not `t.run`, and not the page's own `setTimeout` (it waits for
  the unpause) or `performance.now()` (it stands still). To wait through a pause in a script use the
  untouched timers: `await new Promise(r => __scheldemist.real.setTimeout(r, 2000))`, `__scheldemist.real.now()`.
- **The menu pauses** once the game has been entered (also with `free(true)`); `free(true)` again goes on.
  Keys sent by script while paused go only to the menu (`Escape`, `P`, `W`).
- **A talk reply during a pause**: type a line (`T`, then the talk input's value and an `Enter` keydown on it),
  `t.pause()`, wait with `real.setTimeout`; `GET /api/pause` shows `in_flight: 1`; `t.pause(false)` and the
  reply shows. Choices are picked with `key: "3"` (the talk reads `e.key`).
- **A save that waits**: `fetch("/api/dev/director", {method: "POST", ..., body: '{"think":true}'})` while
  playing, then `t.save("slot2")`: the server log says `[save] slot2 ... in 14471 ms`.
- **Load**: `t.load("slot1")` reloads the page; the kit's variables are gone. A test stack's saves live in
  `data/saves/test-<name>/` and go with `teststack.mjs stop`. Never load or save on Steve's game (5173).
- **Pictures of the cards**: the "Paused" card, the menu and the save list are HTML, not in `shot()`: give
  the tab a size (`resize_window` 960 x 540) and take the browser's own screenshot.

## The night (M7 night)
There is no night sheet at midnight any more: the clock runs through the night and the date turns
at midnight (milestones/M7-night.md). To test the night:

    await t.light(19, "clear")        needs full, the light still on; then t.time(21) or t.skip(120)
    t.time(23)                        the hands only (no date turn); t.skip(90) from 23:00 passes midnight
    t.boxes(), t.givers()             who is away, who is out
    await t.nightWork(true)           the night's work without waiting for 21:00 (the tick writes it at 21:00)
    await t.gang()                    a gang now; R, F, H, P, or t.gang("pay")

- **A hidden pane draws at 300 x 150.** Before a picture, give the tab a size with the browser's
  `resize_window` (960 x 540), send a `resize` event, and set it back (`preset: "desktop"`) at the end.
- **Night pictures need light**: `shotFrom(name, from, to, 60)` close to the thing (1.5 to 3 m); the
  box has its lamp, the givers and the gang's first man carry lanterns, Jef's own lantern shows at
  the bottom right. Far off it is black; a black picture proves nothing.
- **Keys sent by script stay down**: a `keydown` for W (the talk window's "take work") also walks Jef
  on for good. Send the `keyup` too (`__scheldemist.key("KeyW", false)`).
- **The preview pane is shared**: another agent may open a tab in it. Pass your own `tabId` to every
  browser call, or your script runs in their game.
- To sleep (M7 sleep, milestones/M7-sleep.md): E at the doss house door ("sleep in the doss house"), at the bed in
  a rented room ("go to bed") or at a bench ("sleep on the bench") opens the chooser at any hour: keys 1-4 for
  1, 2, 4, 8 hours, 5 until 6:00. The fade runs the time (half a game hour every 0.35 real s); any key but Esc
  and P wakes him. No more lying down in the street; only a man at sleep 0 drops where he stands.
  `__scheldemist.jobs.day.rest.info()`: the sleep's state and the five nearest benches (taken or free).

## Where and when
Day 1 is a Monday; day 7 and 14 are Sundays. A game hour is two real minutes (a game minute two real
seconds; `shared/clock.ts`, M7). Jump the clock with `t.skip(min)` rather than waiting.

| What | Where | When | Quick way |
|---|---|---|---|
| The naties hire day men | Rijnkaai, the naties' gates | weekdays 5:00 to about 6:20 | `time(5)`, `go("rijnkaai")` |
| Fish auction | Vismarkt | weekdays 6:00 to 9:00 | `event("fish_auction")` |
| Low mass, high mass with the sermon, vespers | Cathedral | 7:00; Sunday 9:00 to 11:00 (sermon); 15:00 | set a Sunday, `time(9)`, `go("cathedral")` |
| Wedding | Cathedral west front, the vows inside at the rail, then Den Engel | weekdays 9:00 to 13:00 | `event("wedding")` |
| Funeral | a house, the procession to the cathedral, the requiem inside, the hearse out along the Kiel road | weekdays 8:00 to 12:00 (2 h 50 in all: 30, 40, 60, 40 game minutes) | `event("funeral")`; `hearses.info()`, `landmarks.debug().funeral` |
| Ballad singer | Grote Markt, Vismarkt, Handschoenmarkt or Steenplein | 9:30 to 12:30 and 14:00 to 17:00; in a tavern 19:30 to 21:30 | `POST /api/dev/ballad {"corner":"steenplein"}`, then `go("steenplein")` |
| Street musicians | Steenplein | 11:00 to 19:00 | `event("musicians")` |
| Children's games (rope, hopscotch, hoops, tops, marbles; tag) | the pitches on the Steenplein, Grote Markt, Handschoenmarkt | 8:30 to 12:00, 13:30 to 17:30 | `lively.devGames("play:steenplein", { boys: "marbles", girls: "rope" }, 5)` sends five girls there; `meet()` them if they are not drawn; `lively.games()` for the pitches, the rope's lane and who plays |
| Quarrel, scuffle, purse snatched | Grote Markt, Vismarkt | late morning to evening | `event("quarrel")`, `event("scuffle")`, `event("street_robbery")` |
| Emigrant ship | Rijnkaai | ship days (days 2, 4, 6, 8, 10, 12) 8:00 to 16:00 | `event("emigrant_ship")` |
| House fire | a house in town | 9:00 to 20:00, at most once in three days | `event("house_fire")` |
| Lamplighters | every lamp round | dusk from 17:36, dawn from 5:30 | `time(17, 30)`, `find("lamplighter")` |
| The lock and its chamber | Lock, x 104 to 116, gates at z 7 and 42 | any tide: a tug, a paddle tug, a sailing hengst or sloop every few minutes (tows never: they do not fit); rowing boats any time | `__scheldemist.world.lock().passNow("in", ["tug"])`, `run()`; `.traffic()` for the log and its waits, `.fitTable()` for what fits. A rowing boat: `.request(true, () => ({ x: 110, z: 0 }))`, move the point into the chamber (z 25), `run()` |
| High or low water | the whole river | by the clock | Dev menu, Tide: high water or low water |
| Jobs with a twist | the job's spots | any time | `job({ type, twist })` |
| Anyone in town | wherever their day takes them | their schedule | `find(...)`, then `meet(...)` or `summon(...)` |
| The ferry opening (M7) | the ferry at the Werf pontoon's end | a new game only, until Jef steps ashore | on the test stack only: `curl -X POST http://127.0.0.1:<server>/api/new-game`, reload the tab; `__scheldemist.ferry.info(true)`, `ferry.devIdle(40)` for the ferryman's lines |
| Employers go home, quest boxes (M7 night) | a box on a post by each day employer's door | Sooi 20:00 to 5:00, the widow 19:00 to 7:00, Tuur 2:00 to 7:00, the town's employers 22:00 to 6:00 | `t.time(21)`, `t.boxes()`; a job done while he is away holds its proof: E at the box pays |
| Night work and its givers (M7 night) | the Vliet landing (fence), the Werf (smuggler), the west canal quay (carter), the Petit Bassin south quay (lookout) | 21:00 to 5:00; the board at 21:00, gone at 5:00 | `t.skip()` past 21:00 or `t.nightWork(true)`; `t.givers()`, walk up, E, W, 1 |
| Gangs (M7 night) | dark streets and quays | 21:00 to 5:00, at most two a night an hour apart | `t.gang()` |
| Night events (M7 night) | a tavern (brawl), the back lane (burglary), the Werf (smuggling), Vismarkt to Steenplein (the watch) | 22:00 to 5:00 | `event("burglary")`, `event("tavern_brawl")`, `event("smuggling")`, `event("night_watch")` |

## A check, start to end (example: the watch job's thief)

    node tools/teststack.mjs start
    // in the tab
    __scheldemist.free(true); const t = __scheldemist.t
    await t.light()
    await t.job({ type: "watch", twist: "thief" })   // Jef at the post, the barrels there
    t.run(29)                                         // the thief comes at 30% of the watch
    t.state()                                         // who is near, the job's clock
    await t.shot("watch_thief", [x, z])               // then look at data/shots/watch_thief.jpg
    await t.done()
    // back in the shell
    node tools/teststack.mjs stop

Write what you saw into the milestone note: the numbers the kit gave, the pictures' names, and what you
could not check.

`await __scheldemist.propcheck()` (dev/propcheck.ts): every solid prop of the town (clutter, litter, quay goods and furniture, pumps, lamps, benches, trades, sill pots) against the buildings as built (walls, sills, plinths, steps, kerbs), doorways, passages, bills, each other and the ground; `problems` must be 0 (a new placer lists its props in world/propSpots.ts; `{ only: "clutter" }`, `{ near: [x, z, r] }`).

## Together (M8a multiplayer, 2026-09-26)
`docs/milestones/M8a.md`. The test stack plays alone until it is told: `curl -X POST -H "content-type: application/json" -d '{"multiplayer":true}' http://127.0.0.1:<server>/api/mp/config`
(host-only; the setting lives in `data/test-<name>.mp-config.json` and goes with `stop`).

- **A second player in the same browser**: `?seat=2` (in a dev build it joins by itself with the host's code).
  A tab that is not the active one runs its timers once a second, so it cannot walk in real time: put the
  second seat in an iframe of the active tab (`iframe.src = "/?seat=2"`) and drive both with `step(1/60)`
  from one timer. Its kit is `iframe.contentWindow.__scheldemist`. A guest's `/api/dev/*` is refused: take
  its pictures by rendering its canvas and posting the picture from the host's window.
- **The numbers**: `__scheldemist.mp.report()`: `camSnaps` (the own camera jumped: must be 0), each other
  player's drawn pace, largest step a frame, jitter, delay and buffer (`starved` should stay 0); `resetMeter()`.
  The server's side: `GET /api/mp/stats` (refused moves per player; `corrections` is always 0).
- **Headless players and a bad line**: `node tools/mp-harness.mjs` (`smooth`, `bot`, `crowd`, `proxy`, `vite`,
  `stop`): a walker and a watcher measured against the true path; a TCP proxy with delay, jitter and stalls;
  a second vite through the proxy.
- **The built game and its file store**: `npm run host -- --alone` (or the server with `NODE_ENV=production`)
  serves `client/dist` with its manifest; `window.__scheldemistCache` says what the page downloaded.

## The start: the loading screen (2026-09-26)
The page opens on the loading screen (`client/src/boot/loader.ts`); the menu comes up when the town is built and
every shader is ready. Keys and clicks wait until then. `__scheldemist.free(true)` takes the screen away at once
(the work goes on behind the game), so checks that start with it are not held up.

- `__scheldemistBoot.marks`: when each step ended (ms from the page's start): `city`, `boot:files`,
  `boot:textures`, `boot:shaders`, `boot:lights`, `boot:doors`, `menu`.
- `__scheldemistBoot.report(60)`: after entering, the frames over 50 ms in the first minute, what came with each
  (new shaders, textures, files), the worst, and `playableAt` (from then on a whole second without a frame over 100 ms).
- `__scheldemistBoot.files()`: every file the loading counted, with its start and end.
- In a production build the probe is there with `?probe` in the address (`enter()`, `walk(s)`, `report()`).
