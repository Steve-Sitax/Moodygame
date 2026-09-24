# Testing in the browser

How to check a change in the game quickly, and where and when to look. Steve's rule (CLAUDE.md): every
milestone and every batch of fixes ends with a run in the browser, not a backend check. This is the
routine for that run. The tools: `tools/teststack.mjs` (a copy of the save with its own server and vite)
and the test kit in the tab, `__scheldemist.t` (`client/src/dev/testkit.ts`).

## The rules
1. **Never on Steve's game.** His game runs on 5173 (vite) and 8787 (server) with `data/game.sqlite`. Tests run
   on a copy, on 5341 and 8941. The kit refuses to write to the save on 5173.
2. **A good view.** Midday, clear weather, needs full, the camera close to the thing under test and
   looking at it. Night, fog or rain only when that is what you test. Look at every picture before you
   trust it: a black or empty picture proves nothing.
3. **Don't wait: make it happen.** Start the job, the event or the person you need (below). Run the
   clock forward with `t.run()` instead of waiting in real time.
4. **Clean up.** `t.done()` in the tab (it closes the audio), then `node tools/teststack.mjs stop`. The
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
One call may take at most about 15 s in the preview tool, so `t.run()` does 30 game seconds a call at most.

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
| `job({ type: "watch", twist: "thief" })` | Puts that job on today's board, takes it, puts Jef at its start. Types: carry, watch, deliver. Twists: carry (broken_goods, stranger_offer, foreman_watches, thick_fog, heavy_load), watch (thief, bribe, foreman_watches, thick_fog), deliver (stranger_offer, thick_fog). Also `goods`, `from`, `to`, `employer`, `urgent`. Test save only. |
| `event("fish_auction")`, `event("invent")` | Starts an event template now, or asks the director for its own. Jef goes to its place. The engine's rules still hold: no overlap with a running event nearby, so pick another place or wait for the other to end. Test save only. |
| `run(s)`, `until(() => cond, maxS)` | Runs the game now, even with the tab hidden. Figures you spawned move with it. |
| `shot("name", target)` | A picture from Jef's side of the target, 4 m off, eye height, fog pushed back to 120 m. Saved as `data/shots/name.jpg`. The target can be a person's id or name, a place, `[x, z]` or a spawned figure. |
| `state()` | The clock, where Jef is, the people near, the events, the job, spawned figures. |
| `clear()`, `done()` | Remove spawned figures and let summoned people go; `done()` also closes the audio and parks the tab. |

Also still there: `__scheldemist.paths()` (must be `[]` before a milestone ends), `perf(n)`,
`step(s)`, `shotFrom(name, from, to, fogFar)`, and each part's `info()` (`events`, `ballads`, `actions` ...).
Server dev routes: `POST /api/dev/set {day, hour, minute, weather, food ...}`, `/api/dev/job`,
`/api/dev/director {template | invent | think}`, `/api/dev/ballad {corner}`, `/api/dev/new-board`.

## Where and when
Day 1 is a Monday; day 7 and 14 are Sundays. A game hour is 20 real seconds.

| What | Where | When | Quick way |
|---|---|---|---|
| The naties hire day men | Rijnkaai, the naties' gates | weekdays 5:00 to about 6:20 | `time(5)`, `go("rijnkaai")` |
| Fish auction | Vismarkt | weekdays 6:00 to 9:00 | `event("fish_auction")` |
| Low mass, high mass with the sermon, vespers | Cathedral | 7:00; Sunday 9:00 to 11:00 (sermon); 15:00 | set a Sunday, `time(9)`, `go("cathedral")` |
| Wedding | Cathedral west front, then Den Engel | weekdays 9:00 to 13:00 | `event("wedding")` |
| Funeral | a house, then the cathedral | weekdays 8:00 to 12:00 | `event("funeral")` |
| Ballad singer | Grote Markt, Vismarkt, Handschoenmarkt or Steenplein | 9:30 to 12:30 and 14:00 to 17:00; in a tavern 19:30 to 21:30 | `POST /api/dev/ballad {"corner":"steenplein"}`, then `go("steenplein")` |
| Street musicians | Steenplein | 11:00 to 19:00 | `event("musicians")` |
| Quarrel, scuffle, purse snatched | Grote Markt, Vismarkt | late morning to evening | `event("quarrel")`, `event("scuffle")`, `event("street_robbery")` |
| Emigrant ship | Rijnkaai | ship days (days 2, 4, 6, 8, 10, 12) 8:00 to 16:00 | `event("emigrant_ship")` |
| House fire | a house in town | 9:00 to 20:00, at most once in three days | `event("house_fire")` |
| Lamplighters | every lamp round | dusk from 17:36, dawn from 5:30 | `time(17, 30)`, `find("lamplighter")` |
| The lock and its chamber | Lock, x 104 to 116, gates at z 7 and 42 | tows at high water; rowing boats any time | `__scheldemist.world.lock().request(true, () => ({ x: 110, z: 0 }))`, move the point into the chamber (z 25), `run()` |
| High or low water | the whole river | by the clock | Dev menu, Tide: high water or low water |
| Jobs with a twist | the job's spots | any time | `job({ type, twist })` |
| Anyone in town | wherever their day takes them | their schedule | `find(...)`, then `meet(...)` or `summon(...)` |

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
