# M7 clock: one game hour is two real minutes

Steve (2026-09-24): "in-game time goes way too fast". His choice: **one game hour = two real minutes**.
Before, a game hour was 20 real seconds (six times faster). Now a game minute is two real seconds, the
day from 6:00 to midnight is 36 real minutes, and the week about four hours of play.

## One place for the rate

`shared/clock.ts` (no imports; the server and the client both read it):

| Name | Value | Meaning |
|---|---|---|
| `REAL_S_PER_GAME_MIN` | 2 | real seconds a game minute |
| `GAME_MIN_PER_REAL_S` | 0.5 | game minutes a real second |
| `REAL_S_PER_GAME_HOUR` | 120 | real seconds a game hour |
| `TICK_MINUTES` | 5 (was 15) | game minutes one server tick moves the clock |
| `TICK_EVERY_MS` | 10 000 (was 5 000) | how often the client asks for a tick; the server takes one per 9 s at most |
| `realS(min)`, `gameMin(s)` | | conversions |

Every place that turned real time into game time now reads these: the server tick (`server/src/day.ts`
re-exports `TICK_MINUTES` and `TICK_EVERY_MS`), the client's tick and clock display (`client/src/game/day.ts`),
the event stage clock and its sounds (`client/src/game/events.ts`), the house fire's alarm and pump
(`client/src/game/townlife.ts`), the hearse (`client/src/game/hearses.ts`), the walk deadlines
(`server/src/director/vocab.ts` and `routines.ts` `walkMinutes`), and the test kit (`t.rate`, `t.skip`).

The tick is 5 game minutes every 10 real seconds rather than 15 every 30 s (the same rate): whole minutes, twelve ticks an
hour, and the tick-driven work (events, actions, the director, routines) still runs every 10 s.

## The clock in the corner

It used to show the server's minute only, so it jumped 15 minutes every 5 s. Now `Day.renderClock()` runs
once a second and shows the server's time run on at half a game minute a real second (`hourF`), never past
the next tick: it moves one minute every two seconds.

## What stays on the game clock

The tide (`client/src/world/tide.ts`), the lamplighters' rounds (`lampround.ts`: 2.2 game hours at dusk,
1.4 at dawn), the masses and confession hours, the bells (the hour tune no longer overlaps: an hour is 120 s),
the needs per game hour (`applyHour`), the director's once-a-game-hour think, the townspeople's schedules,
the ballad singer's slots, the dawn hiring (5:00, the call about 6:20: kept), the boat and dray errands
(2.5 and 1.5 game hours), the tavern's hourly fire and gossip, a velocipede or handcart hire by the day,
the week's rent. They were already in game hours and read the same; each simply takes six times longer in
real time.

**The AI budget stays per game day** (`config.ts` `CALLS_PER_DAY` 120, and every share): the same calls
over a day that is now 36 real minutes, so the rate per real minute falls to a sixth. Events per day
(`EVENTS_PER_DAY` 4) are per game day too: fewer events per real minute, each one shorter in game time.

The needs per game hour are kept: food -1 every 6 game hours is now every 12 real minutes (it was 2).
A design call for Steve if he wants the needs to bite as before in real time.

## Durations re-tuned to game time (old -> new, game minutes)

Stage and action lengths had been stretched so that things lasted long enough in real seconds. Now they
are the time the thing would really take; most real durations stay about the same or grow a little.

### Event templates (`server/src/director/templates.ts`)

| Event | Old stages | New stages | Total old -> new |
|---|---|---|---|
| Wedding | 120, 150, 60, 60, 150, 60 | 30, 45 (vows inside), 15, 15, 40 (procession), 30 | 600 -> 175 |
| Funeral | 90, 150, 180, 180 | 30, 40 (procession), 60 (requiem), 40 (hearse out) | 600 -> 170 (2 h 50, about 6 real min) |
| Street musicians | 60, 180 | 15, 90 | 240 -> 105 |
| Emigrant ship | 5, 150, 5, 150 | 5, 90, 5, 60 | 310 -> 160 |
| Fish auction | 5, 120, 150 | 5, 45, 60 | 275 -> 110 |
| Quarrel | 60, 90, 90, 90 | 15, 20, 20, 20 | 330 -> 75 |
| Scuffle | 60, 150, 90 | 15, 30, 20 | 300 -> 65 |
| Purse snatched | 60, 150, 90 | 15, 30, 20 | 300 -> 65 |
| House fire | 45, 60, 150, 120 | 15 (alarm), 20 (pump), 60 (chain), 40 (dies down) | 375 -> 135 |
| Dawn hiring | 80, 60 | kept | 140 |
| Ballad singer | 180 | kept (his slot is 9:30 to 12:30) | 180 |

### The engine's clamps and the model's words (`vocab.ts`, `scheduler.ts`)

| Constant | Old | New |
|---|---|---|
| `EVENT_MAX_MIN` (an event in all) | 600 | 240 |
| `STAGE_MAX_MIN` | 180 | 180 (the ballad's slot) |
| a scene's own walk-up stage (`cleanStages`) | 60 | 15 |
| `ENTER_ALL_IN_MIN` (all counted in a hall) | 60 | 15 |
| `ROUTINE_EARLY_MIN` (a routine event starts early) | 7 | 2 (half a tick) |
| `DEPART_SEATED_MIN` (`landmarks/life.ts`) | 40 | 8 |
| `PRIMITIVES_FOR_MODEL` | "a game hour is 20 real seconds ... a gathering 120-180 minutes" | "a game hour is two real minutes; give each stage the time it would really take: a gathering 15-30, a talk 15-20, a procession 30-45, a mass 45-60, a scuffle 20-30; an event one to three game hours" |

### Actions asked of townspeople (`vocab.ts`, `actions.ts`)

| Constant | Old | New |
|---|---|---|
| `STORY_MINUTE_FACTOR` (model's minutes -> game minutes) | 12 | 1 |
| `FOLLOW_MAX_MIN` police, water bailiff | 720 | 120 |
| `FOLLOW_MAX_MIN` children, errand boys | 240 | 45 |
| `FOLLOW_DEFAULT_MIN` | 480 | 90 |
| `FOLLOW_MIN_MIN` | 240 | 40 |
| `WAIT_MAX_MIN` / its floor (`WAIT_MIN_MIN`) | 180 / 60 | 60 / 15 |
| `LOOK_FOR_MIN` | 240 | 40 |
| `TALK_TO_MIN` | 240 | 40 |
| `ERRAND_HARD_MIN` (hard cap on an errand) | 1800 (10 real min) | 360 (6 game h, 12 real min) |
| an errand's extension a step (`ERRAND_MORE_MIN`) | 60 | 10 |
| `walkMinutes(d, stand)` | `d*1.4/1.5*3 + 30` | `gameMin(d*1.4/1.5) + 10` |
| `POLICE_LOOK_MIN` | 120 | 30 |
| police word seek (complaint) | 360 | 60 |
| `walkMinutes` stand for a fetched agent | 20 | 5 |

The engine's limit lines ("I'll give it two hours") are worked out from the minutes and the factor, so they
now name the real game span (police follow: "two hours"; others: "an hour"; children: "half an hour").

### Routines, families, the town

| Constant | Old | New |
|---|---|---|
| `ROUTINE_MIN_MIN` / `ROUTINE_MAX_MIN` | 240 / 900 | 40 / 180 |
| `WAIT_ROUTINE_MAX_MIN` | 480 | 120 |
| `RETRY_WAIT_MIN` / `CHECKIN_STALE_MIN` | 45 / 90 | 10 / 15 |
| routines `walkMinutes(m)` | `m*1.5*2.4` | `gameMin(m*1.5*1.2)` |
| a routine's slack / extension | +120 / +30 | +20 / +10 |
| routine wait floor | 30 | 15 |
| `MENACE_MIN` / `AT_JEF_MIN` (families) | 150 / 120 | 25 / 20 |
| a visitor's seek (`SEEK_MIN`) / a teller's walk (`SHARE_MIN`) | 300 / 240 | 50 / 40 |
| a scheme's talk (surprises) | 300 | 50 |
| `ASK_WAIT_MIN` (a hired hand waits for an answer) | 120 | 20 |
| `TREAT_WALK_MIN` / `TREAT_STAY_MIN` | 480 / 720 | 90 / 180 |
| `VISIT_DELAY_MIN` / `RETRY_MIN` (police) | 45 / 60 | 20 / 30 |
| haggle refusal | 180 + 20 x temper | 60 + 10 x temper |
| `ROW_HIRE_HOURS` (boat hire) | 6 | 2 |
| `RIDE_MAX_HOURS` (omnibus ticket) | 20 | 4 |
| `CHAIN_PAY_PER_30_MIN_C` (bucket chain) | 5 | 10 (the chain is an hour now; a full chain pays 20 c, it was 25 c for 150 minutes) |

Kept on purpose: the hired hand's day (`HIRE_MIN_MIN` 240, until 20:00), the tavern's tipsiness (three game
hours), the cathedral's hush (15 and 60 game minutes), the emigrant runner (4 game hours), the hired hand's
watch (240 game minutes), the unseen walking pace (`HIDDEN_SPEED` 6 m/s: a 600 m
walk is 50 game minutes) and `ATTEND_HIDDEN_S` (6 real s, three game minutes: crowds still form in a few
game minutes), and every real-second timer on the client (scuffle choreography, omnibus waits, job bells).

### Client

| Where | Old | New |
|---|---|---|
| `day.ts` tick / interpolation | 5 s, 15/5/60 h a second, cap 0.25 h | `TICK_EVERY_MS`, `GAME_MIN_PER_REAL_S/60`, cap `TICK_MINUTES/60`; clock redrawn every second |
| `events.ts` stage clock | 3 game min a second | `GAME_MIN_PER_REAL_S` |
| `events.ts` stage sound and cues | `stage_left / 3` s, 120 s at most, once a stage | `realS(stage_left)`, 180 s at most, started again while the stage lasts |
| `townlife.ts` fire | `REAL_S_PER_GAME_MIN = 1/3` | shared, 2 |
| `hearses.ts` | 3 game min a second | shared, 0.5 |

## Tests

`day.test.ts` (a tick is 5 minutes, one per 9 s; the hour turns from :55), `ride.test.ts`, `m4.test.ts`
(the follow floor, the walk time, four hours in all), `m4b.test.ts` (the scuffle plays at 14:25, after the
agents' midday: with the 15-minute walk-up it would fall at 13:25 when they eat), `routines.test.ts`,
`townlife.test.ts`, `funeral.test.ts` follow the new numbers.

## Browser check (2026-09-25, test stack `clock`, 8965 / 5365)

- **The clock display**: sampled once a second for 60 real seconds (tab playing, `free(true)`): 13:05 at
  2 s, 13:35 at 62 s: 30 game minutes in 60 real seconds, never more than one minute a step. `t.rate`
  says 2 real s a game minute.
- **A street at midday**: `light(13)`, the Grote Markt: lit, clear, the stalls up (`m7clock_street_midday`).
- **An event from start to end** (the funeral, day 2, planned 9:00, started 9:01, stepped with `t.skip`
  and read from `/api/events`): gather 30, procession 40, the requiem 60 (stage 3 began 11:11), the hearse
  out 40; gone at 11:55 (ended 11:51): 170 game minutes as planned.
- **The stage clock in real time**: street musicians on the Steenplein: the client's `stage_left` fell
  4.1 game minutes in 8 s of `t.run(8)`; the server's clock 10 minutes in 20 s. The crowd stood round the
  barrel organ inside the 15-minute first stage (`m7clock_musicians`). No console errors.
- **`__scheldemist.paths()`**: lists five places inside the town hall (vestibule, notice board, great
  stair, registry counter, callers' bench). These come from the town-hall-in-the-world work going on in
  the same tree at the time (landmarkHalls, inworld), not from the clock; nothing else is listed.

The pictures were looked at and removed with the test stack.
