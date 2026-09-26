# M7 sleep: beds at any hour, benches, no sleeping rough, 2026-09-26

Why: Steve: "'go lie down' text at night has got to go. We can sleep any time we want in a bed of a rented house
and must be able to choose how long. We can also sleep on benches, just worse sleep gain, and also warmth goes to 1."

## What the player does
- **E at a bed** opens a small paper chooser: sleep 1, 2, 4 or 8 hours, or until morning (6:00, with how long
  that is). Keys 1 to 5 or a click with the ink cursor (registered in `game/dialogs.ts` as "sleep chooser");
  E or Esc closes it. Any hour of the day.
  - his own rented room: "go to bed" at the bed (`game/homes.ts`);
  - the doss house: "sleep in the doss house" at its door (`game/jobs.ts`), paid by the week as before.
    Sunday with no rent the landlady will not open. The old "knock, beds from six" is gone.
- **E at a bench**: "sleep on the bench", the same chooser with a warning. A bench someone sits on shows
  "the bench is taken" (the sailor on the Steen's second bench by day, a townsperson).
- **Asleep**: the screen fades to black, one line says where, the time and how far ("On the bench · 23:35 ·
  30 min of 8 h"). Jef cannot move. Any key but Esc and P wakes him (Esc and P open the menu and the pause as
  ever; the sleep waits). The screen fades back and a line says how it went.
- **Gone**: G "lie down here and sleep rough" (at night or dead tired), the route `/api/night/sleep-rough`
  (now refused, 409), `/api/homes/sleep` and the whole-night `/api/sleep`. Only a man at sleep 0 still drops
  where he stands (the old night sheet, `day.ts` tick).

## The rules (engine: `server/src/rest.ts`, numbers in `SLEEP`)
| | Bed (own room, doss house) | Bench |
|---|---|---|
| Sleep | +1.25 an hour, up to 10 | +0.6 an hour, up to 6 (never lowers a higher sleep) |
| Warmth | no loss; + the room's night warmth over 8 h (a home: `homeNight`, by its comfort and stove; doss house +3) | at once down to 1, then the outside rule on foot (-1 every 5 h by day, every 3 h at night) |
| Food | -1 every 8 h asleep (awake: every 6 h) | the same |
| Health | + the night's health over 8 h (home: its own; doss house +1 if food 3 or more) | no gain |
| Any need at 0 | -1 health every 3 h, as awake | the same (warmth 0 on a bench costs health) |
| Woken | a key | a key; the police at night in the fine squares (Sint-Jansplein, Lijnwaadmarkt, the Stadspark: 30 % an hour, 22:00 to 5:00); hands in his coat half way through (`night/gangs.ts` robbedAsleep, its own chances) |

- Whole hours 1 to 12 (a forged 100 is 12, -3 is 1); "morning" is until the next 6:00 (at most a day).
- Half a game hour passes every 0.35 real seconds while all players sleep: 8 hours in about 6 s. The time goes
  through `passTime`, so the date turns at midnight (the rent notes, the new board), and each step is a real
  `/api/tick`: events, the director, the rowing, the emigrants and the other tick work run on as always.
- A sleep of 4 hours or more counts as a night (the dream). The log: `slept_home`, `slept`, `slept_rough` (bench).
- Nobody rides or rows asleep (`endRide`, `endRowNight` when he lies down).

## The checks (the engine believes what it can check)
- Home: a lease that is not locked out (`homes.ts homeBed`), and the tick's report says he is in that room.
- Doss house: within 4 m of its step; Sunday with no rent, refused.
- Bench: an id the server knows (`shared/sleep.ts fixedBenches`: the Sint-Jansplein, the greens, the omnibus
  stops once each, the Steen, the Stadspark from `park.json`, the wall walk from `wall.glb`'s dressing), or a
  bench by a house door named by where it stands (`door:x,z`, from `world/clutter.ts`); within 2 m of where he
  says he stands, his feet up on the wall walk for those; nobody else asleep on it.
- Where he says he stands must be near his last position report (sent with every tick; 40 m and 8 m more per
  second since). The client ticks just before lying down. Plausibility only (docs/multiplayer-plan.md: family
  players, no cheat-proofing).
- A tick without `asleep` while he sleeps (a reload, another tab) ends the sleep there.

## Multiplayer later
Sleep state is kept by player id (`rests` in `rest.ts`). `allAsleep()` is where the rule of
docs/multiplayer-plan.md 6.1 plugs in: the night passes fast only when every player online sleeps; otherwise
the sleeper's steps come at the ordinary tick's pace and size. Single player: he is everyone. One bench, one sleeper.

## Where
`server/src/rest.ts` (rules, state, steps), `server/src/restRoutes.ts` (`POST /api/sleep`, `POST /api/sleep/wake`,
`GET /api/sleep`, the position report on each tick), `day.ts` (`RESTING`: the tick is a sleep step while asleep),
`shared/sleep.ts` (the lengths, the benches and their ids), `client/src/game/sleep.ts` (the chooser, the benches in
reach, the fade, the loop), `game/day.ts` (the sleep's ticks), `world/rampart.ts` (`wallBenchSpots`),
`game/humans.ts` (people's roots are marked, for "taken").

## Checks (2026-09-26)
- `server/test/sleep.test.ts`, 16 tests: his bed at noon for 2 h (14:00, sleep 3 to 5, food the same, 4 steps);
  the doss house until morning from 22:00 (6:00 the next day, sleep 10, warmth +3, food -1, health +1, the date
  turned); a key after 90 min (only 90 min count); a tick without `asleep` ends it; Sunday without rent; a bench
  for 8 h (warmth 1 at once, then 0, sleep capped at 6, health lost); a 2 h nap on a bench (+1); the police at 22:00;
  hands in his coat half way; every kind of bench known; forged: no lease, not in his room, someone else's room, a
  bench 30 m off, no position, an unknown id, garbage, a wall bench from the street, the doss house from across
  town, a position far from his last report; hours clamped 1..12, garbage refused; one sleeper per bench, not
  asleep twice, `allAsleep` by player id; the routes, and the old sleep-rough route refused.
  All server tests pass.
- In the browser on a test stack (`teststack.mjs start sleep --server 8953 --vite 5353`): 256 benches found
  (4 on the Sint-Jansplein, 9 on the greens, 19 at stops, 2 on the Steen, 10 in the park, 31 on the wall, 179 by
  doors). At 22:10 and at 23:00 with sleep 2, no "lie down" anywhere (Vismarkt, Rijnkaai, Steenplein, Grote Markt,
  cathedral, Lijnwaadmarkt, Sint-Jansplein). Bench on the Sint-Jansplein at 13:05, 8 h: warmth 10 to 1 at once,
  0 by 15:00, health 10 to 7, woke 21:20 with the line. The garret: "go to bed", a click on "Sleep for 1 hour"
  (the mouse works the chooser), 13:35 to 14:35. The doss house at 23:00 "until morning": the pause (P) held the
  sleep (the line stood at 23:35), it ran on after, a key woke him at 0:35 Tuesday after 1 h 30 (sleep 2 to 3).
  The Steen: the second bench "taken" (the sailor), the first slept on for 1 h (warmth 1).
- Pictures: `sleep_bench_prompt`, `sleep_bench_chooser`, `sleep_fade`, `sleep_home_prompt`, `sleep_home_chooser`,
  `sleep_doss_prompt`, `sleep_night_street_no_prompt`, `sleep_steen_bench_taken`, `sleep_steen_bench_prompt`,
  `sleep_steen_bench_woke`.

## Open
- An event that needs Jef, or the landlord, does not wake him yet (only a key, the police and a robbery).
- The robbery's lines speak of "the night" also for a nap by day (`night/gangs.ts`).
- Church pews, tavern benches, the ferry's and the omnibus's benches are not for sleeping (indoors, or moving).
- `day.ts sleep()` keeps its bed and home branches (older tests pass a night through them); the player reaches
  only its collapse. `homes.ts sleepHome` has no route any more; its tests still run.
- A fraction of a point of sleep is lost on waking (1 h 30 in a bed gives +1, not +1.875).
