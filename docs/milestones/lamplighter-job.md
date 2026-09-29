# The lamplighter's job (2026-09-28)

Steve: "does the street lamp lighters still work good after all the changes we did? + also add a job as lamp
lighter for the player and get paid. But you can only start lighting when needed and need to be done in a
manageable amount of time."

## The lamplighters now

Checked on a test copy of Steve's save (day 1, 16:44 to 17:33, clear):
- Four rounds, four men: west (Hendrik Dierckx, 24 lamps), market (Florent Dierckx, 24), east (Remi Hendrickx, 16),
  north (Jan Michiels, 12). Every round's dusk window opened at its time.
- Followed from 50 m, Florent walked at 1.55 to 1.67 m/s, stopped at each lamp, raised his pole, and the lamp
  lit; the lamps ahead waited. Server tests for the rounds (`townlife.test.ts`, `population.test.ts`): 30 of 30.
- Found: the 65 lamps of the town wall (34 on the walk, 31 at the guard houses and gates, `d1000` to `d1064`)
  are on no round and light by the clock alone. Needs a decision: issue
  [#14](https://github.com/Steve-Sitax/Moodygame/issues/14).

## The job

| Part | What | Where |
|---|---|---|
| The offer | Once a day, from 5:00, one lamplighter puts the last lamps of his round on the board ("Lamps at dusk", "Light my last lamps"); the rounds take turns by the day. Not on a day that began in fog (the lamps burn all day). He pitches it in talk too (he is the employer). | `server/src/town/lampjob.ts` `offerLampJob`, `buildLampJob` |
| The stretch | The most lamps from the round's end that Jef walks and lights in 150 real seconds (1.25 game hours) at his walk, 5 to 10 lamps, never more than half the round. The north round ends on the Sint-Jansplein 228 m from the lamp before: its end does not fit, so it is not offered. | `stretchOf` |
| Only when needed | Lighting from the round's dusk (16:45 to 16:50, on whole minutes), all by 2.25 game hours later (about 19:00). Before dusk, E at a lamp says "Too early: the lamps are lit from 16:48, when the light goes." The job can be taken until 45 game minutes after dusk. | `open`, `until`, `take_by` |
| Doing it | The spare pole leans against the first lamp's post: E takes it (Jef carries it upright in his right hand, its wick lit from dusk). At each lamp's foot E raises the pole into the lantern, the gas catches, the pole comes down. The server checks the hour, the pole and the place (3.2 m) for every lamp and counts them. The task card, the ink arrow and the map show the next lamp. | `client/src/game/lampjob.ts`, `POST /api/lamps/pole`, `/api/lamps/light` |
| The pay | 20 c, 10 c a lamp and 5 c for every 50 m of the stretch's walk (since #14, 2026-09-29), within the board's tier band: 95 c for 6 lamps and 167 m, 115 c for 8 and 158 m, 125 c for 9 and 167 m. Paid by the lamps lit, by the engine's count. All lit: trust +1 with the lamplighters; none: failed, -1, and he remembers. | `game.ts settle` (`lamps`) |
| The deadline | At `until` the game ends the job with what is lit (the lamplighter lights the rest himself, late). A job left in hand a quarter hour past it is settled by the server's tick. | `LampsRun.update`, `expireLampJobs` |
| The lamplighter | While the job holds, the stretch waits for Jef: his lamps burn once he lit them, for every player (world state `lamps_help`, on the payload). The lamplighter's own plan reaches the stretch only after the deadline (19:12 to 19:28), then he lights what Jef left and passes the lamps Jef lit. The witnesses' light (`lampLightAt`) follows the same lamps. | `lampround.ts` `helpHolds`, `lampLitHelped`; `game/lamplighter.ts` |

### Round sizes (Steve's save, test copy)

| Round | Lamps | Walk | At Jef's walk with the stops | Pay |
|---|---|---|---|---|
| west | 9 | 167 m | about 146 s (1.2 game hours) | 125 c (110 c before #14) |
| market | 8 | 158 m | about 136 s | 115 c (100 c) |
| east | 6 | 167 m | about 136 s | 95 c (80 c) |

The window is 270 real seconds, so there is about two real minutes to spare, and the pole can be fetched
before dusk.

## Checks
- Server tests: `lampjob.test.ts` 8 of 8 (the stretch, the board, too early and too late, the pole, the place,
  the lamps that wait, the witnesses' light, the pay by the count, the deadline).
- Browser, test stack `lampjob` (8951 / 5351), a copy of Steve's save: the market job taken at 16:30; the pole
  leaning on the first lamp (`data/shots/lampjob_pole_leaning_side2.jpg`); E before 16:48 refused; the pole up
  into the lantern (`lampjob_lift_side.jpg`); 8 of 8 lit, "Florent Dierckx pays 100 c"; the lane south of the
  cathedral lit (`lampjob_lane_lit.jpg`). The east job with 1 of 6 lit at the deadline: 15 c, and Remi's words
  on it. A page reload in the middle kept the job and the lamps lit. `paths()` lists nothing; `shaders()`
  problems empty.
- Test kit: `t.lampJob("market")` puts the job up, takes it and puts Jef by the pole.

## Not in the web demo
The demo has no jobs, so the job does not fit it. The lamplighters in the demo are unchanged.

## The town wall's rounds (issue #14, 2026-09-29)

Steve: "lamp lighter can do it, maybe more lighters needed and possibility for more quest routes as lighter".
The 65 lamps of the town wall (34 on the walk, 31 lanterns at the guard houses and gates, `d1000` to `d1064`) are
on five rounds of their own now, each walked by a man of the town (a docker or a porter who takes the trade, as the
market and north rounds' men did; `LAMPS_VERSION` 11 gives an older save its five). Nine lamplighters in all.

| Round | Lamps | Walk | At Jef's walk with the stops | Job: lamps, walk, pay |
|---|---|---|---|---|
| `wall_rode`: the river to the Rode Poort, and the gate | 11 | 322 m | about 234 s | 5, 130 m, 85 c |
| `wall_north`: the walk from the Rode Poort round the north-east bastion to the Keizerspoort | 16 | 327 m | about 249 s | 8, 158 m, 115 c |
| `wall_keizer`: the Keizerspoort and the walk to the Kipdorppoort | 10 | 216 m | about 164 s | 5, 101 m, 80 c |
| `wall_kipdorp`: the Kipdorppoort and the walk round the south-east bastion to the Sint-Jorispoort | 19 | 464 m | about 345 s | 7, 172 m, 105 c |
| `wall_joris`: the Sint-Jorispoort and the walk down to the river | 9 | 246 m | about 180 s | 5, 108 m, 80 c |

(A new save's numbers, seed of the test town; each round ends its dusk walk by 18:15 to 19:45, the window by 20:34.)

- **One source for the spots.** The lamps stand where `tools/blender/build_wall.py` put them: the node `wall_dressing`
  in `wall.glb`. The client reads it with the model (`world/rampart.ts wallLamps`), the server from the same file's JSON
  chunk (`server/src/town/wallDressing.ts`, which the wall benches use too), and both number them with
  `shared/wallLamps.ts`. A lamp moved in Blender moves on both sides.
- **Gate to gate.** The walk on top is cut at each gate (the gate house stands across it) and the stair by a gate climbs
  from its far side. So a round with a gate begins at the gate in the street, climbs that stair and walks the top
  to the next gate's near side; the lamps are walked in their order along the wall (`buildRound(..., inOrder)`), the
  tour search stranded a lamp and walked the wall twice.
- **Outside a shut gate.** The lanterns on a gate's field face and the lamp at its bridge's far end (12 lamps) lie
  past the gate's shut leaves, where the walk map ends. The lamplighter lights them from the wicket in the leaves
  (`RoundLamp.wicket`, the foot at the leaves on the lamp's side). They are never part of a player's stretch.
- **Light on the way.** Where the way to the next lamp passes a lamp still to come (1.5 m), that lamp is lit as he
  passes (`onTheWay`): the market round no longer walks past d42 to light d43 first.
- **Seen on the wall.** Followed, a lamplighter walks his round's own way in 20 m marks (`game/lamplighter.ts
  nextMark`: the walk grid round Jef does not reach a far stair) and steps out on that way, out of sight, not in the
  street below (`claimOnWay`). The crowd's view test now counts the ground a person stands on (`crowd.ts inFrustum`):
  someone on the walk beside Jef was hidden as if he stood in the street.
- **The job.** Every wall round's last lamps on the walk go on the board in turn with the town's rounds (the stretch
  may be 5 lamps on a round of 9: the lamplighter keeps 4). The pay counts the walk too: 20 c, 10 c a lamp and 5 c for
  every 50 m, within the board's band.

Checked 2026-09-29 on a test copy of Steve's save (stack `w`, 8961/5361): the save got its five new men; at dusk the
Rode Poort's man lit the gate's four from the gate and the wicket, climbed the stair and lit d1001 at 1.7 m; the north
wall's man lit d1004, d1035, d1005, d1006, d1007 in order, each within 1.5 m of him, the lamps ahead dark
(`data/shots/wall_rode_lighting.jpg`, `wall_lamplighter3.jpg`). Jef took `t.lampJob("wall_north")`, the pole on the
tower, lit d1044 to d1015 and was paid 115 c. `paths()` empty with 141 lamplighter's stands, `shaders()` problems
empty. Server tests: `townlife`, `lampjob`, `lively` (the older save gets nine).

## Left
- No sound for the gas catching (there is no hiss sound yet).
- A lamp outside a shut gate is lit from the wicket, not walked to: the gates are shut and nobody walks past them.
- When a lamplighter is taken up in front of Jef during a stop, the lamp of that stop goes out and lights again when
  he gets there (older than this work, every round).
