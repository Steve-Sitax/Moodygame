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
