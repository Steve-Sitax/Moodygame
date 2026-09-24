# M6 - the overnight run (plan, 2026-09-24)

Steve, 2026-09-24: "Find fun ways to integrate AI to make the game unpredictable. Also implement
your 10 suggestions. I'll let you run overnight." Plus, earlier the same day: events should be
made by the AI on the fly; fights and robberies AI-made and engine-controlled; visible leads
(bride, groom, musicians).

Rules for the run: the engine owns every number, the model only words things (schema, 20 s,
fallback). Helpers test on copies of the save only. Main checks each part in the browser, then
commits and pushes it (a finished part = a milestone).

## Waves (helpers work in parallel only where their files do not meet)
| Wave | Part | Files it owns | Notes |
|---|---|---|---|
| running | Liner at anchor, lighters | anchorage.ts, river.ts, boats.ts, build_boats.py | fix: lighter route through the jetty |
| running | M4b: AI-first director, leads with looks (bride, groom, musicians...), scuffles and street robberies | server/src/director/*, game/actions.ts, events.ts, bubbles.ts, instruments.ts | no combat |
| 1 | Interiors: tavern (drink, dice or cards, overheard gossip) and the Poesje puppet theatre (AI play from the town's news) | new interior code | docs/milestones/M6-interiors.md |
| 1 | Newspaper and newsboys (AI paper from the event log), post and letters (AI letters to Jef), telegraph, the pawnshop | new server routes, pockets UI | docs/milestones/M6-paper-post-pawn.md |
| 2 (after the liner) | Tides (about 4 m twice a day): water, boats, stairs, ladders, swimming | water and boats | |
| 2 (after the liner) | Emigrants: families with chests on the quay, a lodging house, the liner's boarding day | with the M4 emigrant event | |
| 3 (after M4b) | Lamplighter at dusk; fire brigade event (smoke, horse pump, bucket chain); naties hiring at dawn | director templates, lamps, fire.ts | |
| 3 (after M4b) | AI unpredictability pack (below) | director | |

## Added by Steve later on 2026-09-24
| Wave | Part | Notes |
|---|---|---|
| running | Vleeshuis exterior upgrade (striped brick and stone, gables, stair tower) | own helper, build_landmarks.py |
| in M4b | Bubbles keep their size at the screen edge; events up to 100 people (config.ts) | sent to the M4b helper |
| 3 (after M4b) | Families who share what happens: rude to a wife, she tells her husband when he is near; he comes to talk, calls the police, or (narrated, no fighting system: docs/08 #10) knocks Jef down or mugs him (health, money). The AI chooses by the people's stats, leaning toward what involves Jef. | director, talk, memories |
| 3 | Population setting: how many townspeople the game has, how many in the street, how many at an event (up to 100); perf with 100 in view | config, crowd, settings |
| 4 (after interiors) | Rent a house (cheap to dear), go in, decorate it (buy and place furniture) | interior system |
| 4 (after interiors) | Very good interiors for the landmarks with fitting life: mass and confession in the cathedral, clerks and a wedding in the town hall, the butchers' hall in the Vleeshuis, the museum in the Steen, the Hanseatic House | interior system, build_landmarks.py |
| 5 | AI ideas list (Steve took all but "witnesses"): haggling in your own words, talking your way out with the police, street ballads, wall posters (wanted, lost dog, sailings), the Sunday sermon, your own letters with replies, jobs that go wrong, news from abroad moving prices a little, lost diaries | engine owns every number |

Homes: every townsperson already has a home and a daily schedule (M3e) and families share a household; what is new is that they pass on to each other what happened with Jef, and act on it.

## Next (Steve, 2026-09-24 afternoon)
- Gifts from Jef's pockets (anti-farming trust caps), a drink together at a tavern, paid hands and a crew: running (M6-gifts-hire.md), built on a small step executor.
- AI-composed routines: from Jef's request the model plans from engine primitives (walk, pick up, carry, buy, give, talk, wait, follow, sit, enter or leave); the engine checks and runs each step; the model checks in after each step or failure and steers until done (capped check-ins, a time limit, a budget share). After the gifts work.
- Livelier back streets and the cathedral area: 10 period ideas offered to Steve (street Madonnas, dog carts, doorstep scrubbing and lace makers, street sellers with cries, children's games, shops spilling out, lane life, the Quinten Matsys well, the shops against the cathedral, tourists, beggars and clergy). Waiting for his pick.

## AI unpredictability pack (fun ideas, wave 3)
- A fortune teller at the fair or the quay: her prophecy for Jef (AI words) is a hidden promise the director later tries to make come true.
- Strangers off the ships: now and then a visitor with an AI-made backstory, a goal and a secret, who stays a few days and leaves.
- Private schemes: each day the director gives two or three townspeople a small goal (a lost dog, a debt, a courtship, a grudge) that plays out through actions and conversations; Jef can stumble into them.
- Rumours that twist: a rumour's wording drifts a little at each telling (the facts stay the engine's).
- Dreams: when Jef sleeps, a short AI dream made from his day.

## Night log (main)
- Done and committed: the liner Kempenland and its lighters (72e83eb); the garrison and street musicians (0fb0178); the newspaper, post and pawnshop, the tavern and Poesje interiors (91bba79, a checkpoint that also holds work in progress of M4b, tides and the Vleeshuis).
- Running: M4b (AI-first director, leads, scuffles, robberies, bubbles, events up to 100), tides, Vleeshuis, homes to rent and decorate, emigrants.
- Still to start: landmark interiors (after the Vleeshuis), families who share and act, the population setting, the lamplighter, the fire brigade, the naties hiring, the AI unpredictability pack, the nine AI ideas.
- Later: tides (150566e), M4b (11322da), quay walls at low water (8f08abf), the Vleeshuis of 1873 (fa7e1ab; in 1873 a wine merchant's warehouse with a theatre hall upstairs, which its interior should show). Started: AI ideas part 1 (posters, your own letters, jobs that go wrong, news moving prices, lost diaries). Waiting: landmark interiors (after homes), population setting (after emigrants), haggling and talking your way out (after families), ballads and the sermon (after landmark interiors).
- Morning (after the usage limit, 00:00-03:30, stopped every helper): homes to rent and furnish, emigrants, AI ideas part 1 (posters, own letters, jobs that go wrong, news moving prices, lost diaries) done; checkpoint 444b297. Budget: 80 calls a day, shares now residents 30, director 12, conversations 10, paper 6, tavern 6, ideas 4, Poesje 2, homes 2: about 8 left for the board, outcomes, the named people and the epilogue. Asked Steve whether to raise the day's total to 120.

## Fixes 2026-09-24 (afternoon): the photographer's findings
A photographer ran long sessions on a big-town copy of the save (`data/shots/showcase/`). Checked on a test save only (a `.backup()` of `data/test-photo-big.sqlite`, server 9021, vite 5421, headless Chrome over its debug port, 1280x800). A game hour is 20 s of play, which was behind most of these.

| Finding | Fix | Files |
|---|---|---|
| The two liner tows stood for over 6 minutes, one "waits for room" by the liner, the other "waits for the fairway" by the quay (shot 23). | The strict lane rule (no ship over the crossing while the tow is in it, at full or half speed) stays for 20 s; then the tow takes the right of way: a ship far enough off to stop (28 m) must stop, and the tow holds its crossing (a soft obstacle river.ts stops for; a ship already too close carries on). A committed tow eases in behind a ship still going through. It never gives way to a ship that stopped for it (that was a deadlock), and a ship stopped for it right on its way makes it go astern 6 m and hold. The return crossing is split (the near lane, then the fairway: 35 m apart, room for a 21 m tow between). A tow at the liner goes on working while the quay berth is taken (up to 7 min), instead of waiting on the water. Room past a zone now allows for the 25 m gap (a tow once stopped with its stern in the near lane: a rowing boat stopped for it on the other tow's crossing, for good). Watchdog: stopped over 60 s, the tighter rule (14 m); a ship stopped near it: back off 14 m and hold 12 s; waiting for room: the other tow takes the right of way at once. Dev: `__anchorage.tows()` (waited, backs), `.traffic()`, `.blockers(i)`. | `world/anchorage.ts`, `world/river.ts` (soft obstacles) |
| Ballad listeners stayed "going" all through; at the Steenplein 8 of 11 stood 25 m off; the singing started late. | The singer and his crowd are called when the singing is planned (now 60 min ahead), topped up at the start. The routine (ballad, hiring) starts at the 15-minute tick nearest its hour (7 min early at most). A crowd member at their place reports it: phase "there". On the client, coming to an event: unseen they cross town in about 6 s of play; near an event Jef watches they step out of his sight on their own walk to it (6 to 40 m of walk before it, on the walk grid, not behind a block of houses); far from Jef they are simply there when he comes (at 30 m or more). A puppet out of sight and over 22 m from its place goes on unseen (`town.hideAway`). Someone stuck in a collider steps out; stuck 10 s (was 20): another way. The omnibus only for onlookers from far, waited 15 s at most (the dawn men waited at a stop at dawn). | `ballads/ballad.ts`, `director/scheduler.ts`, `director/actions.ts`; client `game/actions.ts`, `game/town.ts`, `game/crowd.ts` (`pathOn`) |
| The scuffle's two stood 3.3 m apart; no shove seen (shot 15). | They walk to a meeting point (a free spot by their middle, each to his side of it); face to face when both are there, within 1.9 m, or after 8 s (then they step in). Words 5 s, then shoving 14 s: a lunge of 0.5 m with the arms going and a stagger back of 0.65 m, bigger tilts; the agent parts them only after 8 s of it. | `game/actions.ts` |
| At dawn only 1 or 2 men reached the Hessenatie gate; the rest hid by the Petit Bassin. | The men gather from 5:00 (80 min), the call stays at 6:20. With the client fixes above: before the call 16 of 16 and a foreman at the Hessenatie gate, 16 of 16 at the Entrepot gate. | `director/hiring.ts`, `director/templates.ts` |
| Karel Van Loock waited over 100 s at the Steenplein; his boat (360 m off at the north steps) never came. | Out of Jef's sight he goes on unseen and is at his boat in about 6 s of play, then rows out; in Jef's sight for 45 s and not there, he gives up and walks where he was going (no rowing home then). Nobody on the water is walked off to an event (`moveHidden`), and the server takes nobody on the day's boat or dray errand for a crowd (`onErrand`: the ballad's crowd had taken him). | `game/journeys.ts`, `game/town.ts`, `director/scheduler.ts` |
| The far bank: flat pale boxes floating on the horizon (shots 22, 23). | A low dyke line settled on the water: the mud below the lowest tide, a stone foot, the grassed face in strips, the crest 3 m over the highest water; round crowns and rows of poplars (low-poly lumps, not boxes on sticks), 17 houses and inns with windows and chimneys showing over the dyke at the ferry landing, the fort's sloped ramparts, the mill, a far tree line. Everything stands on the polder behind the crest. Darker colours (the lights are bright), and the ordinary fog: it fades out on a grey day, never a pale silhouette. | `world/farbank.ts` |
| Clear weather at 16:40-17:00 stayed grey (shot 4). | A golden hour on clear days only (it follows the clear-sky weight): from 15:00, full 16:25-17:20, gone by 18:20, and a little at sunrise (7:00-9:00, 45 %). The air gold, the sun warm, lower from the west and a little stronger, the sky light warmer. Fog, mist and rain stay grey. | `world/rijnkaai.ts` |
| The house fire: a column of small puffs; the pump hard to see (shot 13). | Flames are drawn as tongues (wide root, flickering point, bent by the draught, white-yellow heart to deep red) and come out of the windows: the houses are built in 3 m bays with the door in the middle one, so a window either side of the door below and in every bay above (they were at 1.5 m, on the wall between); a band of four over the roof. The pump stands where the lane has most room, clear of the chain; brighter paint, a little light of its own and a lantern; it is solid when it stands, so the crowd keeps off it; set on the ground's height. | `world/fire.ts`, `game/townlife.ts`, `world/pumpcart.ts`, `director/fire.ts` |

**Numbers.** Tows, 6 h of river simulated with the real modules in the page, four seeds: before (seed 1873) the longest stop 740 and 1056 s, 37 round trips, "waits for room" 3000 to 4500 s; after, the longest stop 109 to 239 s (in thick traffic, waiting for ships, never for the other tow), 49 to 50 round trips, 0 s "waits for room", 2 back-offs, hulls touching ships 0 to 3 samples. Ballad (the Vismarkt, Jef there from 8:25): 10 of 11 round the singer by the start, all 11 soon after, 6 "there"; before: 7 of 11 an hour and a quarter after the start, the singer still walking from the Steenplein. Scuffle: met at 2 m, words, a shove (lean 0.26 to 0.38), parted by the agent.

**Checks.** `npm run build` passes; `npm test` 632 of 632 (new `server/test/fix2.test.ts`, 7 tests: the crowd called at planning, topped up not doubled, the singer cast once; the routine's early start and no other event early; "there" on arrival; the hiring from 5:00 with the call at 6:20 and every man placed; the pump open and clear of the chain; nobody on a boat errand taken for a crowd). `__scheldemist.paths()` lists nothing. Shots (`data/shots/`): `fix2_tows_before`, `_before_quay`, `_after`; `fix2_ballad_before`, `_after`, `_after_close`; `fix2_scuffle_before`, `_after`; `fix2_hiring_before`, `_after`, `_after_close` (dawn: dark); `fix2_boat_before`, `_after`; `fix2_farbank_before`, `_before_quay`, `_after`, `_after_quay`, `_after_near`; `fix2_golden_before`, `_after`; `fix2_fire_before`, `_before_pump`, `_after`, `_after_pump`. All test processes stopped; the test save and the scripts deleted.

**Open.** Watched all the way, a family boat rows at walking pace and may still be on the water after its errand's hours (it now stays in the boat). A tow can still wait up to about 4 minutes for a stream of slow boats on the fairway. The dawn shots are dark, as dawn is.
