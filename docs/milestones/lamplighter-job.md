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
| The pay | 20 c and 10 c a lamp, within the board's tier band: 80 c for 6 lamps, 100 c for 8, 110 c for 9. Paid by the lamps lit, by the engine's count. All lit: trust +1 with the lamplighters; none: failed, -1, and he remembers. | `game.ts settle` (`lamps`) |
| The deadline | At `until` the game ends the job with what is lit (the lamplighter lights the rest himself, late). A job left in hand a quarter hour past it is settled by the server's tick. | `LampsRun.update`, `expireLampJobs` |
| The lamplighter | While the job holds, the stretch waits for Jef: his lamps burn once he lit them, for every player (world state `lamps_help`, on the payload). The lamplighter's own plan reaches the stretch only after the deadline (19:12 to 19:28), then he lights what Jef left and passes the lamps Jef lit. The witnesses' light (`lampLightAt`) follows the same lamps. | `lampround.ts` `helpHolds`, `lampLitHelped`; `game/lamplighter.ts` |

### Round sizes (Steve's save, test copy)

| Round | Lamps | Walk | At Jef's walk with the stops | Pay |
|---|---|---|---|---|
| west | 9 | 167 m | about 146 s (1.2 game hours) | 110 c |
| market | 8 | 158 m | about 136 s | 100 c |
| east | 6 | 167 m | about 136 s | 80 c |

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

## Left
- The wall lamps: issue #14.
- No sound for the gas catching (there is no hiss sound yet).
