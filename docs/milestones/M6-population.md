# M6 - Population settings, 2026-09-24

Why: Steve, 2026-09-24: "More people in game, and for big events not 20 but up to 100 people. Make it adjustable how many people we have in a game."

## What is in
| Part | Where | Notes |
|---|---|---|
| The panel | `client/src/game/settings.ts` | Esc, Settings, a new "Population" part with three choices. "People in the street" is kept in the browser with the other settings. "Biggest event" and "Town size for a new game" are kept on the server. The panel says how many people this week's town has and that a new size only starts after Restart. |
| People in the street | `settings.ts` `STREET_LEVELS`, `client/src/game/town.ts` `maxPuppets` | The most townspeople walking round Jef at once (within 55 m). Few 20, **Normal 50** (was 34), Many 75, Crowded 100. Event people come on top of this, as before. If the setting goes down, the farthest people out of sight go back to their schedule, four at a time. |
| Far figures | `client/src/game/crowd.ts` | Animation every frame within 25 m (was 30), 15 fps out to 45 m, 8 fps beyond (new). At 270 lines a person 45 m away is a few pixels high. No low-detail mesh was needed (see the numbers). |
| Event size | `server/src/town/popsettings.ts`, `config.ts` `EVENT_SIZES` | 20, 50 or 100 (default 100). `eventPeopleMax(db)` gives the smaller of this and `EVENT_PEOPLE_MAX` (still the hard limit). `clampEventCount(db, n)` for any other count. **The scheduler does not use it yet:** see "For main" below. |
| Town size | `config.ts` `TOWN_SIZES`, `server/src/town/population.ts`, `store.ts` | Small (about 150), Normal (about 240, the town as it was, the same people for the same seed), Large (about 350), Very large (about 500). Used by `ensureTown` when a new game makes a new town (Restart, or a save with no town). The current save keeps its town until Restart. |
| How a town grows | `population.ts` | The job list grows or shrinks with the size (more dockers, natie men, porters, carters, boatmen, sailors, fishwives, market women, maids, clerks, thieves, beggars). The one priest and the lamplighter stay one; police at least 4 (6 in Large, 9 in Very large). Families come round each worker as before, so children, wives and lodgers grow with it. A Small town first houses one of every trade and all the police, so nothing is missing. A bigger town gets two or three bands of street children (Vismarkt, Werf, Bassin). A big town leaves 90 house doors free for the people other parts add later (post office, rooms to let, visitors, the Logement); after that a household shares a house near its work (at most three households a house). A stall nobody took gets a widow from nearby (Small towns are short of wives). |
| Always there | `population.ts` step 6 | Any seed and any size now has its priest and at least four police agents. Some seeds used to miss the priest or have three agents. The missing ones are added from their own random stream, so a town that had them all stays exactly the same. |
| Special people | unchanged | The garrison and customs, the newsboys, the post clerk, the widow landlady, the dealer, the emigrants' keeper, the lamplighters, the police and the named quay four are added the same way at every size (tested). |
| Routes | `popsettings.ts` `mountPopulation`, one line in `index.ts` | `GET /api/settings/population`, and `POST` with `{ eventSize }` and/or `{ townSize }` (anything else: 400). The table `game_setting` is not cleared by a new week. |

## Frame times
Test save only (`data/test-pop.sqlite`, server 8921, vite 5311 with `data/vite-test-pop.config.mjs`). Wednesday 10:00 (both markets on), clear weather (the longest view, the worst case). Jef stands 15 m back from each place, facing it. The street was filled by turning round for 20 s at each level. "Out" = townspeople walking round Jef; "drawn" = figures in view, market sellers included. Frame = render (`perf()`, GPU finished) + all game logic for one frame (`step(1/60)`), the median of 4 runs. The machine was shared with other helpers, so expect about 1 ms of noise.

Very large town (500 people):
| Place | Few 20 | 34 (old Normal) | 60 | Crowded 100 |
|---|---|---|---|---|
| Vismarkt | 20 out, 24 drawn, 10.4 ms | 34, 36, 10.3 ms | 60, 58, 11.0 ms | 84, 73, 11.5 ms |
| Grote Markt | 20, 27, 6.3 ms | 34, 39, 7.1 ms | 55, 50, 6.7 ms | 54, 51, 7.2 ms |
| Rijnkaai | 20, 13, 10.1 ms | 34, 27, 13.0 ms (noise) | 60, 52, 10.5 ms | 76, 54, 11.4 ms |

Normal town (238 people):
| Place | Few 20 | 34 | Normal 50 | Many 75 | Crowded 100 |
|---|---|---|---|---|---|
| Vismarkt | 20, 29, 10.4 ms | 34, 35, 9.1 ms | 44, 36, 9.4 ms | 44, 39, 8.9 ms | 43, 37, 10.0 ms |
| Grote Markt | 20, 29, 6.0 ms | 33, 32, 7.3 ms | 33, 33, 6.7 ms | 33, 25, 6.1 ms | 33, 25, 7.5 ms |
| Rijnkaai | 20, 16, 9.1 ms | 30, 20, 10.3 ms | 30, 21, 10.1 ms | 30, 20, 9.5 ms | 29, 20, 9.3 ms |

Worst case: 100 extra walking figures placed in view on the Vismarkt (122 drawn): 12.1-12.2 ms a frame before the far-figure change (the crowd's own update 1.4 ms), 10.5-11.6 ms after (crowd 1.0-1.2 ms); 9.0 ms with none of them. Every level stays well under 16.7 ms (60 fps). The world costs far more than the people.

What limits the street is how many people are out near Jef, not the cap. A Normal town has about 30-45 people out round the busiest places at 10:00, so its street fills up at Normal 50. Crowded only looks crowded with a Large or Very large town. People only appear out of sight (or out of their own door), so after a jump they fill in as Jef turns about.

**Normal cap: 34 -> 50.** It costs about 1 ms a frame at worst and lets a Normal town show everyone who is out.

Pictures of the Vismarkt: `data/shots/pop_vismarkt_{few,normal,many,crowded}.jpg` (Very large town, levels 20, 34, 60, 100) and `pop_vismarkt_{few,normal,many,crowded}_normaltown.jpg` (Normal town, 20, 50, 75, 100).

## Checks (2026-09-24)
- `npm run build` passes.
- `npm test`: the new `server/test/population.test.ts` (12 tests + 1 waiting for main): Normal is the old town to the person; at every size and three seeds every trade is there, one priest, at least 4 police, every stall kept, unique names and ids, every home, work door, post and round on reachable ground, families on one door, children with a grown-up; a bigger town has more dockers, sellers and children; at most three households in a house. A new game at each size keeps the garrison, customs, 3 newsboys, the post clerk, the widow landlady, the dealer, the emigrants' keeper, 2 lamplighters, 4+ police and the named quay four, all homes reachable, and comes within 35 of the size the panel promises. The save's town does not change until a new week; both choices outlive the new week; bad values are refused. Event size: 100 by default, clamps to 20 or 50, never over `EVENT_PEOPLE_MAX`. The wedding test (a 20 and a 50 event never go over) runs once the scheduler uses `eventPeopleMax`; it passed on a copy of scheduler.ts with the change below.
- Two other tests time out just over 5 s (deeds "hostile lines at the police talk", families "talk-down"). They are in the police talk-down work of another helper; `openDb` costs the same as before (181 ms).
- In the browser, on the test save: `__scheldemist.paths()` returns `[]` for Small (152 people, 372 town points), Normal (238, 504), Large (355, 673) and Very large (501, 1014). The panel shows the three choices; changing the street level sets the cap at once and is kept in localStorage; the event size and town size go to the server; a bad value gets a 400.
- The week backups the test server made in `data/backups` (copies of the test save) were hashed and deleted.

## For main: the scheduler change
In `server/src/director/scheduler.ts`, `gather()` (about line 688). Add the import at the top:
```ts
import { eventPeopleMax } from "../town/popsettings.ts";
```
and replace
```ts
  // M4b: one event never takes more than EVENT_PEOPLE_MAX of the town, leads included
  const room = Math.max(0, EVENT_PEOPLE_MAX - have.length);
  const picked = pool.slice(0, Math.min(room, Math.max(GATHER_MIN, Math.min(GATHER_MAX, count))));
```
with
```ts
  // M4b: one event never takes more than EVENT_PEOPLE_MAX of the town, leads included;
  // M6 population: nor more than the player's event size (Settings; popsettings.ts)
  const cap = eventPeopleMax(db);
  const room = Math.max(0, cap - have.length);
  const picked = pool.slice(0, Math.min(room, Math.max(GATHER_MIN, Math.min(GATHER_MAX, cap, count))));
```
Then the waiting wedding test in `population.test.ts` runs by itself (it looks for `eventPeopleMax` in scheduler.ts). If `EVENT_PEOPLE_MAX` is no longer used in scheduler.ts after this, keep the import only if the linter wants it. Optional: the director's prompt in `vocab.ts` still says 100; the engine's clamp is what counts.

## Not yet
- No low-detail mesh or fewer bones for far figures: not needed at these numbers. If a weaker machine (the laptop) struggles, that is the next step.
- A townsperson walking unseen in plain view is not drawn until Jef looks away or they reach a door (as before). With Crowded and a big town, a jump by the Dev menu fills in slowly.
- Bigger towns get no new shops or stalls: the extra fishwives and market women walk about their market without a stall of their own (as sellers without a stall already did).
- The director's prompt still offers up to 100 people; with a smaller event size the engine quietly takes fewer.
