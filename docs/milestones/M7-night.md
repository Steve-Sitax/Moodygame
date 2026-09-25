# M7 night: work through the night

Steve (2026-09-25): "Do not do the wake-at-dawn forcing. We must be able to work through the night.
Many quest givers will be at their homes asleep, so we can only fulfil at a sign. Nights are good for
robbers and other shady events, so no skipping." And: "i.e. Sooi is not standing there but went home.
We can still get paid by completing a quest and going to a quest sign/box at their door. Other quest
givers come out at night: shady ones with night jobs. And a risk of gangs that steal."

## What is in

| Part | What | Where |
|---|---|---|
| No forced night | The tick no longer sends Jef to bed at midnight. The clock runs on; at midnight `turnDay` turns the date: the night's other work (the rent of a room), memories fade, three rounds of rumours, the day's money mark, the weather, and (index.ts `afterNight`) a new board. After Sunday there is no day 8: the week ends at Sunday's midnight, asleep or awake, and the epilogue is written. | `server/src/day.ts` `tick`, `turnDay`, `passTime`, `newDayOf` |
| Sleep is Jef's choice | `sleep()` passes 7 to 8 game hours from when he lies down (`shared/night.ts` `sleepMinutes`: 420 + 6 a missing point of the sleep need, in fives), the date turning on the way; the needs as before (M5). Doss house bed from 18:00 until 6:00 (or dead tired), his own room the same, rough anywhere (G, 22:00 to 5:00 or sleep 3 or less; `POST /api/night/sleep-rough`). He wakes where he lay (the doss house: at its step). The sheet: "You lie down at 0:50 ... You wake at 7:55, Thursday, after 7 hours and 5 minutes." | `day.ts` `sleep`; `index.ts /api/sleep`; `homes/homes.ts sleepHome`; `night/routes.ts`; client `game/day.ts` |
| Tired | Sleep need 2 or less: slower (0.75, at 1 0.6) and the view swims (a CSS blur of the canvas, the lids dropping now and then). At 0 he drops where he stands and sleeps 8 hours there (a gang may find him). | `day.ts` `tick`; client `day.ts tiredness()`, `player/firstPerson.ts fatigue` |
| A job stays in hand | The carry-over-one-night rule is gone: a job in hand stays in hand through any night; only its own deadline counts. `listJobs` keeps it; `job()` finds a job by id, whatever its day (a job taken before midnight settles after it). | `day.ts`, `game.ts job`, `hooks/jobBoard.ts listJobs, jobById` |
| The cell | Held until the next 6:00 whatever the hour; the date turns on the way. | `town/police.ts cellNight` |
| The dream | After a sleep (a count of nights slept), not at the date's turn. | `director/familyRoutes.ts`, `day.ts nightsSlept` |
| Employers go home | Sooi 5:00 to 20:00, the widow 7:00 to 19:00, Fientje 6:00 to 18:00, Tuur 7:00 to 2:00 (`shared/night.ts POST_HOURS`); the town's employers by their schedule (6:00 to 22:00, Sunday from 11:00). They no longer wait at their post for a job Jef has in hand. | client `game/town.ts postEmployers` |
| Quest boxes | A box on a post by each of the 8 day employers' posts (Sooi, the widow, Tuur, and the 5 town employers), against the house front where there is one, a painted sign with his name ("work done: proof here") and a lamp he leaves burning when he is away after dark (a lantern light). A job whose work is done while he is away is held (`POST /api/jobs/:id/hold`: the facts wait on the job, nothing paid); E at his box ("drop the proof in Sooi's box and take your pay") settles it as always and pays at once (`finishJob` with `box`); the employer remembers it (weight 4, a rumour line) and the outcome writer sees "abed ... box". Back at his post in the morning he takes the proof in his hand instead. A parcel to deliver waits in the box (F "take the parcel from Sooi's box"). They are in `paths()`. | client `game/questboxes.ts`, `game/jobs.ts`, `game/runs.ts`; server `game.ts holdJob, finishJob` |
| Night givers | Four townspeople added in place to every town (an older save too): a fence behind De Vliet at the Vliet landing, a night lighterman on the Werf, a carter on the west canal quay, a man by the Petit Bassin who wants a lookout. Out 21:00 to 5:00 with a shaded lantern, at home by day. Their own greeting, their own "what do you do", a line for the talk prompt. Never cast in events. | `town/places.ts NIGHT_GIVERS`, `night/givers.ts`, `night/talk.ts`, `town/store.ts TOWN_EMPLOYER_IDS` |
| Night work | Once a night at 21:00 the model writes 2 to 4 jobs for the givers (hook `night_board`, 20 s, schema); the engine keeps each giver to his places (`taskFor`), clamps the pay into the night band (1.5 to 2 times the day tier's, at least 120 c), drops a job with violent words, and fills in hand-written jobs when the model is late or out of budget (share `NIGHT_BOARD_CALLS_PER_DAY` 2). Offered in talk only (never on the hiring board), open past midnight, gone at 5:00 (a taken one fails; the giver remembers). At the settling the engine rolls the watch (15 %: the pay is lost) and rivals (12 %: half); else smugglers' trust +1. | `night/nightwork.ts`, `config.ts` |
| Gangs | From 21:00 to 5:00, once a tick while Jef is out (not indoors), the client says what he sees (a lit lamp within 8 m, the water within 6 m, goods in his hands, the people near); the engine rolls: 0.12 an hour alone in the dark, x0.35 by a lamp, x1.3 on a quay, x1.8 carrying goods or a job parcel, x1.5 tipsy (x2 drunk), x0.1 an agent within 35 m, x1.3 alone / x0.8 one or two / x0.3 three or more people within 15 m, x1.2 a purse of 150 c; 0.55 at most; two a night, an hour apart. Three men close in (the first with a lantern); R run (0.6, less carrying, tipsy, tired, weak; he drops what he holds), F fight them off (0.3, +0.1 in health; health -1), H shout for the watch (0.85 with an agent near, else 0.2 +0.15 by a lamp +0.3 with people about), P pay (half the purse, 20 to 200 c); nothing in 14 s: robbed. Robbed: 70 % of the purse (at least the demand, 500 c at most), one thing from the pockets, a job's parcel (the job fails), a blow (health never below 1). Asleep rough at night: 35 % (+10 % dropped; far less with police or people near), 60 % of the purse. | `night/gangs.ts`, `night/routes.ts`, client `game/nightlife.ts` |
| The director's night | Room for an event from 22:00 to 5:00 (none 5:00 to 6:00). An event that starts then must be a night kind (burglary, smugglers, a tavern scuffle, the watch, a fire ... `NIGHT_KIND_RE`), over by 5:00, its gatherings at most 8 (the police and the fire keep theirs). New templates `tavern_brawl`, `burglary`, `smuggling`, `night_watch`; the house fire also 22:00 to 3:00; a lead `smuggler`. The engine's own pick also at night (22:00 to 4:00). Within the day's four events (the day is the date). | `director/director.ts`, `scheduler.ts`, `templates.ts`, `vocab.ts`, `leads.ts` |
| Test kit | `skip()` now runs through midnight (`POST /api/dev/advance`); `gang(answer?)`, `nightWork(fallback?)`, `givers()`, `boxes()`. | `client/src/dev/testkit.ts`, docs/testing.md "The night" |

The shared numbers (post hours, the givers' hours, the gang hours, the director's night, the sleep
length) are in `shared/night.ts`.

## Checks

- `npm test`: 772 of 772 (new: `test/night.test.ts` 18, `test/day.test.ts` reworked: midnight turns
  the date with no sheet, a collapse at sleep 0 sleeps 480 min, the week ends at Sunday's midnight,
  a bed at 20:00 with sleep 2 sleeps 470 min to Tuesday 3:50, a sleep by day does not turn the date,
  a job in hand stays through two nights). Fixed for the new night: `rowing.test.ts` (the debt goes to
  the police after a night: he lies down at 22:00), `m4.test.ts` (at 3:00 a night template fits, at
  5:00 none), `m4b.test.ts` (no call from 5:00 to 6:00), `transport.test.ts` (four more residents in an
  older save). One run showed `lively.test.ts`'s older-save test failing; it passed alone and in the
  next full run (flaky under load, not this change).
- `npm run build` passes. `__scheldemist.paths()` lists nothing (the 8 boxes are in it).
- Browser, test stack `night` (8968 / 5368), a copy of Steve's save (day 3), sound silent:
  - 19:50 Sooi at his post; `skip(20)`: 20:15, Sooi gone, his box `away: true`.
  - Skip to 22:00: the night board was written by the model in 10.9 s: 3 jobs (smuggler 240 c carry, fence 150 c deliver, cracksman 280 c watch), shady pitches in plain English.
  - Sooi's carry job (3 sacks, carried over from Steve's day) finished at 22:10: "The work is done. Sooi has gone home for the night: drop the proof in the box by Sooi's door". At the box: E "drop the proof in Sooi's box and take your pay"; paid 80 c (1870 -> 1950). Sooi's memory: "Jef finished my job ... at night while I was abed, left the proof in my box ... took his 80 centimes from it." The outcome: "Chalked on the pay box in his heavy hand: 'Take your 80. Count true.'"
  - The fence (Lowie De Kat) at the Vliet: "You're out late. Looking to earn, or looking to buy?"; W: "A parcel for Staf, 150 c"; took it, took the parcel from him (F), gave it at the Vleeshuis (E): "Lowie De Kat pays 75 c" (the rivals' roll hit: "Men from a rival crew were waiting at the corner and took their share").
  - Gangs (`t.gang`), each answer: run: escaped; F fight: fought off, health 10 -> 9; H shout: failed (no one near), robbed of 70 % and the hand lantern; P pay: 200 c, "Sensible lad."; nothing for 14 s: robbed 285 c. The natural roll (`/api/night/roll`) went out each tick; the chance where Jef stood: 0.187 an hour. After the cap was added: robbed 500 of 2000.
  - Midnight passed while playing: no sheet, "Thursday 0:27", a new board by Claude for day 4, the two open night jobs still offered, the weather rolled to fog.
  - The director (Claude) planned "Crates landed by night on the Petit Bassin" (smuggling) at 23:05; its day event "The herring auction on the Vismarkt" at 22:00 was refused by the engine ("the town is abed").
  - The doss house at 0:50 (sleep 9): woke Thursday 7:55, "after 7 hours and 5 minutes", at the doss house step; Sooi back, the givers gone; the night jobs expired at 5:00.
  - Tired: sleep 1 -> fatigue 0.6, the canvas `blur(1.78px) brightness(0.97)`; sleep 8 -> none.
  - A second run to 1:05 on day 5: 7 of 8 employers away (Tuur till 2:00), all 4 givers out, no console errors, no server errors.

Pictures (night, with lanterns), in `data/shots`:
- `m7night_questbox.jpg`: Sooi's box on its post by the Hessenatie front, the lamp lit, the sign "SOOI".
- `m7night_fence.jpg`: the fence at the Vliet landing with his lantern, among the fish stalls.
- `m7night_gang.jpg`: the gang of three closing in in a dark lane, the first with a lantern.

## Design choices

- Weather is rolled at midnight with the date (one roll a day, as before).
- The doss house lets its beds from 18:00 until 6:00; a sleep at 18:00 wakes about 1:00: Jef then
  has the night. Rough sleep is offered from 22:00, not all evening, to keep the key line quiet.
- The box pays from the held facts (the report at the time the work was done), so a box cannot be
  used to change what happened; the client says only where it was paid.
- Night work has its own deadline (5:00) and is paid by the giver at once; it never goes to a box.
- The gang's odds and losses are the engine's constants in `night/gangs.ts`; no model call.
- What a gang takes is capped at 500 c (a man's coat, not his savings); the check took 1420 c before the cap.

## What is left

- The director cannot yet send the police after a gang robbery (its follow-up knows only a resident
  thief); it asked twice for a follow-up with nothing open.
- The town's schedules are as they were: the night people are the police night shift, the publicans
  till 2:00, sailors in the taverns till about 23:30, thieves and the lamplighters at dawn. No extra
  drunks or watchmen were added (an older save keeps its stored schedules anyway).
- The post office's letter rounds, the emigrants' errands and hired hands were not looked at by night.
- Running from a gang is a roll, not a chase; the gang's first man uses the same model as the fence.
- Only Sooi's box was looked at in a picture; the others were checked by `paths()` and `t.boxes()`.
