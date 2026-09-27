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

## Round 2 (Steve's check, 2026-09-27)

Steve on the town map: his player flashed, the townspeople were no longer blue with a heading, dots ran through houses
and over canals at speeds no one walks, and none of them were in the game where the map had them. Then: real walking
("A"), no slowing for a load, the young may run, the old are slower and more often take carts with more goods.

| Found | Fixed |
|---|---|
| Played alone, the relay fed the map an empty player list four times a second: it wiped the player the game had just reported (`mp/index.ts feedMapPlayers`) | The relay feeds the map only while played together; the last seat going clears it once |
| Played alone, the game sent no townspeople to the map | The solo report (`net/mp/together.ts soloMap`, `POST /api/map/me`) carries the people it draws, 4 times a second: live, blue, with their heading |
| The world clock moves in 5-minute ticks: dots jumped 60 m | The map runs the clock on between ticks by real time (`mapview/index.ts`, `MapClock.frac`) |
| Rounds (hauls, patrols, customs, sellers, roamers) went straight from point to point, 342 of 849 legs through houses or water, at 10 m/s; the game walked them elsewhere | Rounds follow the ways leg by leg (`roundWay`), at the person's walk; the game uses the sum on rounds too and walks on to the next point |
| 36 walks had no way: straight lines | Ends are looked for 20 m round (was 8); a walk with no way is none: he is simply there (3 left) |
| At the cap of 50, people 5-20 m away were not drawn while farther ones were | Full: the nearest due person takes the place of the farthest drawn one out of sight (`SWAP_GAP` 12 m) |
| People crossed town at 6 m/s | Each his own pace (`paceOf`: children 1.25, young 1.4, men 1.35, women 1.25, 50+ 1.15, 65+ 0.95 m/s, plus or minus 8%; soldiers 1.3; a load changes nothing). On a leg, children run 45% of the time, under-30s 30%, under-45s 10% (2.3-2.7 m/s); a young one late for a part runs for it |
| A real walk in a day 30 times faster than life: a 500 m walk is 3 game hours, and the day plans were made for the old pace | The day as kept (`dayRoute`): he sets off early enough to be there at the hour; a part he would reach with less than half an hour (or half the part) to stay is skipped and he goes on to the next. On a copy of the save: 86% of work shifts and 79% of all parts kept, 12% of the day on the way, 12% of walks run. The game sets his goal by the part he is at or walking to (`planNow`) |

Checks: `ways.test.ts` 7 (every point out in the street on walkable ground over a whole day for every resident; no
round faster than the fastest walk; paces), `mapview.test.ts`; the feed (`feedwatch`/`feedspeed` scripts): the
player on the map 20 of 20 s, about 24 live townspeople round him; map walkers median 1.13 m/s, 95% under 1.6,
runners to 2.72. In the game: 115 unseen walkers at 7:19, 10 running, median 1.28 m/s; all 33 people within 25 m at
the Rijnkaai drawn; `findcheck()` empty. Seen runners hurry at 2 m/s at most until there is a run cycle.

## Round 3 (Steve's check, 2026-09-27): vehicles, and the dockers' loads

Steve: workers get in the way of the train, the omnibus and carts ("smaller will get out of the way of the bigger ones;
omnibus and train should not be blocked"); dockers take loads at a crane with nothing on the ground and drop them in
the middle of the street, where the goods vanish ("make sure that happens nowhere").

| Found | Fixed |
|---|---|
| Vehicles stopped for every walker (a docker in the road held up the train); walkers did nothing to get out of the way | `crowd.ts giveWay`: every vehicle going at a pace has a lane (its box and 3-12 s ahead, from how the box moves each frame: `CrowdGround.vehicles`, main.ts: the train rank 3, an omnibus 2.5, a dray 2; a townsperson's dray 2, handcart or velocipede 1, a walker 0). Smaller steps out sideways to the free side (1.7 m/s), waits at a lane's edge, goes back to his place when it has passed. The omnibus, the train and the drays stop for a walker only right before the horses (0-3 m, 1.1 m across), still for the player as before. Measured on a copy: walkers in a vehicle's path 0.19 on average without it, 0 with it; no omnibus waited for people |
| The 21 quay routes (`HAULS`, set in M3e) ended 6-80 m from any goods and 3-30 m from any wall | `shared/hauls.ts`: 18 routes, each from beside its own pile of shared goods (5 sacks or crates, a low heap, laid out by `townGoods`, the server's) to a door's step (`houseDoors({ stores: true })`: warehouses included), a pile of its own, or the back of a fish bank. Two Bassin routes with no room on their quay are given up (their men to the next route). Old saves: `town/hauls.ts rerouteHauls`, in place (131 dockers on a copy of Steve's save) |
| Quay heaps as pickups were pruned at run time (jobs, emigrants) | Every route has its own pile, off the quay's heaps |
| The dockers took a sack at the start of a walk back and put it away on leaving the door | At the start he faces the pile, bends and takes the load up; at the end he faces the door (in it goes) or bends to the pile; a crate pile gives a crate held before him (`crowd.puppetLoad(p, on, "crate")`); coming from home he comes empty-handed |
| The shared sack was a box: a heap of them read as a stone post | A lumpy tied sack (`props.ts makeGoods`, the same material) |
| The sum sent tavern-goers to (0, -1), in the river: `out` is a direction, not a point (the old plannedSpot's mistake); a shop too | Before the tavern's door (door + out x 2); a shop's door step |
| Places of the back town (corners, courts, lanes) have their middle in a block: the map drew people inside houses | Arrived, he stands at the end of his way (on walkable ground, within 20 m) |
| The server's walk map had water under the opening bridges: the far banks of the canals and the vliet were unreachable for the ways | The ways' own copy of the walk map with the bridges (`ways.ts theGrid`); 3 walks left with no way (children's play places up on the town wall by the Kipdorp mill: no stair in the walk map; he is simply there) |

Checks: `hauls.test.ts` (every route from a spot a body reaches, beside its pile, to a real door's step, with a way;
the piles laid out, off the stand spots; an old save's dockers moved once), `ways.test.ts` (every walk of every plan
has a way but the three on the wall; everyone out in the street on walkable ground, bridges included), the old-save
tests leave a haul's ends to `rerouteHauls`. Browser, a copy of the save: `carrycheck()` 18 routes, 150 dockers, no
problems; `findcheck()` 0 at the Rijnkaai, the Grote Markt, the Werf, the Vismarkt; `popcheck()` pops 0; `shaders()`
0; `paths()` empty. Close shots: the sack heap by the Rijnkaai (sacks, not a post), a docker bent at his pile, a
docker with a crate on his way to the door.

## Open

- A run cycle for people.glb (seen runners now hurry with the walk cycle, 2 m/s at most).
- Older carriers taking carts and bigger loads: the dispatcher's choice (T3, `docs/trade-plan.md`).
- Seen people still walk at their own pace, slower than the unseen 12 m a minute; when one leaves the ring, the sum
  has him further on (unseen, so nobody sees the jump). The plan's progress reports (the run's clock moved back by the
  time lost) come with the server-owned runs (T3).
- People on a trip (velocipede, omnibus, boat, a family dray), on an errand, or with a back-street, lively or mill goal
  still go by their own layers; the map shows them by the sum of their plan.
- The server-owned runs with goods and the dispatcher are T3 (`docs/trade-plan.md`).
