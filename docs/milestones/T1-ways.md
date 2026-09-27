# T1: far townspeople keep going (2026-09-27)

Steve: "When I look at the map I see NPCs pop out of existence when far from a player, and if I run to that place I
never see the NPC again." The plan is `docs/trade-plan.md` part A. This note is what was built.

## What is in

| Part | Where | What it does |
|---|---|---|
| Ways on foot | `server/src/town/wayfind.ts` (pure) | A* on the walk map's reachable cells (0.5 m, a body fits, the start can be reached), a little greed (1.4), no corner cutting; then the string pulled tight with a grid walk that counts every cell a line touches. Points are cell centres (two decimals: a rounder point grazed a wall). A way takes 0.1-7 ms. |
| The server's ways | `server/src/town/ways.ts`, `walkmap.ts` (`pass`) | Kept in memory by key (both ends on a 1 m grid). `warmWays` finds every day plan's ways at start, one resident per turn of the event loop. `GET /api/town/ways` (all plan ways, about 2,900, 570 KB), `POST /api/town/ways {keys}` (60 at most; the kept map is capped at 20,000). |
| The sum | `server/src/town/whereabouts.ts` (pure; the client imports it like `schedule.ts`) | `whereAt(resident, town, day, hour, wayOf)`: the part of the day now and since when; he left the place of the part before at that hour and walks the way at 12 m a game minute (the old unseen 6 m/s); arrived, he is at the place (indoors at home, at an indoor trade, at mass), on his round, or shuttling on his haul. The mill's man goes by his cart's timetable (`shared/mills.ts runNow`, as `client/src/game/mills.ts`). `planLegs` lists every pair of places a plan walks between. |
| The game | `client/src/game/town.ts` | A resident whose goal is his plan's own (`plain`: no shop call, errand, mill, back-street or lively goal) is put by the sum while he is on the way, unseen, and at load. The last steps to the client's own goal are the old straight walk. Missing ways are asked for by key every 3 s. |
| Spawning | `town.ts spawn()` | Someone due in the street in Jef's view no longer waits for ever: beyond 40 m he steps in at once, at 20-40 m after 2.5 s, under 20 m after 8 s. |
| The town map | `server/src/mapview/model.ts plannedSpot`, `views.ts`, `public/map.js` | Every resident nobody walks live is drawn at the sum, on the street, moving. The list and the card say "on his way ... (N m to go)". The "Indoors" layer is on by default. |
| Checks | `server/test/ways.test.ts`, `__scheldemist.findcheck()` | Every plan way walkable on the walk map every 0.25 m; the sum walks door to work and stands there; the same sum after a JSON round trip; indoors at night at the step. `findcheck(near = 40)`: residents out in the street within 40 m, not drawn for over 3 s (must be empty). |
| Client types | `client/tsconfig.json` `allowImportingTsExtensions` | So a pure file both sides import may import another with `.ts` (the server's Node needs it; the client never emits). |

## Checks (2026-09-27)

- Server: 1243 of 1245 in the full run; the two that failed (`m8e-tls`, `m8e-limits`, real servers on ports) pass
  alone (25 of 25) and failed only while a test stack ran beside them. `ways.test.ts` 5 of 5, `mapview.test.ts`
  13 of 13 (its home spot is now the step before the door), `mills.test.ts` green.
- Client: `npm run build` clean; `node --test client/test/*.test.mjs` 32 pass, 2 skipped.
- Browser, test stack `t1` (8951/5351, a copy of the save, a new week in the copy because the copied Jef was dead):
  1147 residents, 1031 plain; the game's unseen positions equal the sum after a frame (0.0 m). Emma Van Gorp, a
  laundress 515 m away on her way to work: Jef put 22 m ahead of her on her way, and she was drawn within 3 s,
  walking toward him (picture taken). `findcheck()` empty at the Grote Markt, the Vismarkt, the Steenplein, the Werf
  and the Rijnkaai (49, 19, 44, 41 and 44 drawn). `popcheck()` pops `[]`. `shaders()` problems 0.
- The town map (port 9951) against the game, the same clock (13:15): four walkers, 0.03-0.07 m apart; the cards say
  "On the way: to the Petit Bassin, 133 m to go".
- `paths()` listed three spots in the Steen museum: not this work (issue #1,
  https://github.com/Steve-Sitax/Moodygame/issues/1).

## Open

- The map's clock has whole game minutes: a walking dot steps 12 m every 2 real seconds.
- Seen people still walk at their own pace, slower than the unseen 12 m a minute; when one leaves the ring, the sum
  has him further on (unseen, so nobody sees the jump). The plan's progress reports (the run's clock moved back by the
  time lost) come with the server-owned runs (T3).
- People on a trip (velocipede, omnibus, boat, a family dray), on an errand, or with a back-street, lively or mill goal
  still go by their own layers; the map shows them by the sum of their plan.
- The server-owned runs with goods and the dispatcher are T3 (`docs/trade-plan.md`).
