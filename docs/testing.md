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

Also still there: `__scheldemist.paths()` (must be `[]` before a milestone ends), `await __scheldemist.zfight()`
(faces in one plane that flicker, by cause; the houses list 4 small ones, see M3c pass 5), `perf(n)`,
`step(s)`, `shotFrom(name, from, to, fogFar)`, and each part's `info()` (`events`, `ballads`, `actions` ...).
Server dev routes: `POST /api/dev/set {day, hour, minute, weather, food ...}` (sets the hands only: no date
turns), `/api/dev/advance {minutes}` (M7 night: as the game moves the clock, midnight included), `/api/dev/job`,
`/api/dev/director {template | invent | think}`, `/api/dev/ballad {corner}`, `/api/dev/new-board`,
`/api/dev/gang`, `/api/dev/gang-chance`, `/api/dev/night-work {fallback}`.

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
- To sleep: stand at the doss house step facing the door (E "go to bed", from 18:00 until 6:00); G "lie
  down here and sleep rough" from 22:00 to 5:00 or when dead tired. Sleep lasts 7 to 8 game hours.

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
