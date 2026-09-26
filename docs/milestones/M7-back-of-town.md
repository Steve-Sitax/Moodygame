# M7 the back of town, 2026-09-26

Steve (2026-09-26): "There are no people in the back of town: make sure appropriate people, groups
and gangs are there, bringing everything to life."

## Why it was empty

Measured on a copy of the save (day 1, a Normal town of 293 people):

- 678 of the 959 house doors stand in the back (inland of z 145, or west of x -300). Only 39 of the
  293 homes were there.
- Every workplace, market, play place and tavern lies by the river. The town was made before the
  angled streets, the alleys and the wall.
- So nobody had a reason to be in the back. The whole back had 8, 2, 1 and 0 people out at 8, 13, 18
  and 22 h. The draw cap (50) and the draw radius (55 m) were not the cause.

## What is in

All of it is made by the engine from the town's seed (its own random stream, ids `bk001`...). A
model writes none of it. `ensureBackTown` adds it to an older save in place, once, and adds rows
only.

| Part | What | Where |
|---|---|---|
| Hubs | The 17 court pumps (those in a court you can walk into), the street corners where three or more streets meet, and a point every 30 m of the back's streets | `server/src/town/backtown.ts` |
| Poor households | Round each hub: three at a pump, two at a corner, one at a street point. At most 135 households (30 in a Small town). Homes are in the alley cottages first, then in the narrow streets | same |
| The man | A docker or porter who walks to the quays at dawn and home at six. About 45% are not taken on: at the gate at dawn, then in a knot of men at a corner, the lanes, the estaminet's door, cards. About one in eight drinks his wage | same |
| The woman | A washerwoman at the court pump (five at most a pump), or a housewife or seamstress: errands, neighbours talking at a door, a walk in the lanes or the park | same |
| Children | They play before their own door in the morning and late afternoon, and in the court between. The town's tag works there (`game/town.ts`) | same |
| The lad | Out of work, one of a corner gang of three to five, from 10:00 till late at night | same |
| The old | A grandfather on a chair by his door, and at cards in the afternoon. A grandmother at her door; door life gives her the knitting or the lace (`doorlife.ts`) | same |
| Better streets | Ten households in wide streets: a clerk who walks to his office in the old town and home to dinner at noon, his wife on her errands and in the park, their maid, children in the park | same |
| Churches | The parish priests of Sint-Jacob and Sint-Paulus: mass at their church, then a round of the sick; they knock at the doors. Beggars at the doors of Sint-Jacob, Sint-Paulus and Carolus | same, `game/lively.ts` |
| A doctor | His round of patients, a black bag in his hand | same |
| The night watch | Three men, 21:00 to 5:00, a round of the back's corners with a lantern. At each corner he stops and calls the hour ("Ten o'clock, and a foggy night!") | same, `game/backlife.ts` |
| Estaminets | Four small taverns on back corners (In den Hoek, Het Pijpke, De Blauwe Hand, In de Zwaan), a publican at the door, the drinkers of about seven households before it. Their place ids are `kroeg:*`, not `tavern:*`: they have no inside | same |
| Drunks | They sway as they walk. They sit down with their back to a wall now and then, a bottle in hand, and mutter | same |
| Lovers | A lad and a girl of two households, by the pond in the Stadspark on fine evenings and on Sunday afternoon | same |
| Sunday | The back's families walk on the ramparts (the walk on the wall, 45 points, never at a gate) and in the Stadspark | same |
| Street sellers | A second knife grinder (toward Sint-Paulus) and a second rag-and-bone man (by the Stadspark), on lively rounds with their barrow, cart and cries | same, `lively.ts buildRound` |

What they do at each place is the place's kind: the prefix of its id (`server/src/town/backkind.ts`). The
client plays each kind (`client/src/game/backlife.ts`):

- **pump**: she stands at her wooden tub (staves, two hoops) on a stool, bent over the washboard (clip
  `wash`). A wicker basket with a heap of wrung linen stands at her side. The first to come hangs a
  washing line on two posts near by. Now and then one goes to the pump and works it, or stands up to talk.
- **corner**: one lad leans back on the house wall with a foot up (clip `wall`). The others stand in a
  loose ring before him: one smokes a pipe (`smoke`), one has his hands in his pockets (`pockets`),
  one folds his arms. Their heads follow Jef as he passes (the head bone, up to 70 degrees). The one
  nearest him squares up when he comes within 3 m. They say something to him when he comes near
  (menacing, never a blow by day; the robbing is the night gangs'). Stand by them for five seconds
  and they tell him to move along.
- **cards**: four old men on stools round an upturned crate with the cards and a few coins on it.
  The others stand a step back and watch.
- **gossip, knot**: a knot of neighbours before a door, or of men at a corner, talking in turns.
- **step**: an old man on a rush chair by his door, a clay pipe in his hand. He greets Jef.
- **lovers**: the two stand close, turned to each other, at the water's edge.
- **park, walk, lanes**: a household walks together (the younger at the elder's side), now and then
  stopping to look out. In the lanes they go alone, out along a street and back past the hub.

Groups talk in bubbles (the M4 bubbles, one line at a time, the speaker's arms moving), only when Jef
is within 24 m. The lines are the engine's (`server/src/town/backtalk.ts`): washing, cards, the lads,
the men out of work, neighbours, lovers, strollers, the watch, drunks. No model call: the day's calls
stay for the talk, the board and the events. The talk prompt knows what they do there (`talk.ts doing`).

Props are made in code and exist only while the person is drawn: tub, stool, basket, washing line,
crate table with cards, stools, chair, pipe, doctor's bag.

## New clips in people.glb

`wash`, `wall`, `pockets`, `smoke` (`tools/blender/build_people.py`), appended at the end: every
older clip and figure hashes the same (checked). Rebuild:

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_people.py

## Small changes elsewhere

- `client/src/main.ts`: the hooks for `backlife.ts`, and the crowd now gets the ground's height
  (`baseAt`). Without it every person stood at street level: the strollers on the wall walked inside
  it, and people on stairs and bridges sank into them.
- `client/src/game/town.ts`: a `back` hook (goal, behave, spawned, lost) before lively's, and `simOf`.
- `client/src/game/lively.ts`: the parish priest and the doctor knock at doors on their rounds.
- `client/src/game/humans.ts`: the four new motions.
- `client/src/world/clutter.ts`: a crate or barrel against the wall of a narrow lane now leaves 1.5 m of open
  ground before it. With only the 0.5 m line it had, the path check (a body 0.45 m off a wall and 0.3 m off a
  thing) could not pass, and a court behind such a lane was shut off. And nothing of the clutter stands in the
  open passages from the streets into the alleys (`alleys.passages`, 2.2 m between two front houses): a crate
  there shut a whole court off (paths() found two courts shut this way once they had people in them).
- `server/test/gifts-hire.test.ts`: its docker is one at his work when there is one (the tests were written for
  a working docker; the back's idle men are free to follow Jef to a tavern).
- `server/src/town/places.ts`: six trades (washerwoman, loafer, watchman, parish_priest, doctor, drunkard).
- `server/src/db.ts`: `ensureBackTown` in openDb and resetDb, after the shops.
- `server/src/config.ts`: `BACK_ABOUT`, added to each town size's promise.
- `server/src/town/talk.ts`: what they are doing, and mass in the back's churches.
- `server/src/town/lamplighters.ts`: a bk docker never becomes a lamplighter.
- `server/src/town/lively.ts`: `ensureLively` ignores the bk grinder and rag man.
- Pumps: the washerwomen stand at a spot of free ground by the pump, not on its post.
- `server/src/town/population.ts`, `client/src/net/api.ts`: a place may have a `route`.
- Tests. `town.test` (the rumour among workmates): the workmates are taken from the save's town, so the
  back's dockers count. `families.test`: the couple chosen is one whose husband is within reach of his
  door at the test's hour (a man at work across the town does not come). `lively.test` and
  `transport.test`: the bk people are left out of their old-save counts.

## Numbers

A Normal town gets about 530-565 more people (a Small one about 160-180; the count moves a little with the map). The server's tick is still 4-5 ms;
`/api/town` is about 400 KB.

People out within 30 m of 60 random street points, weekday, the town's own people before (only the
non-bk residents) and everyone after:

| Hour | Back before | Back after | Middle after | Quays after |
|---|---|---|---|---|
| 8 | 0.4 | 5.6 | 7.8 | 7.1 |
| 13 | 0.1 | 6.5 | 5.9 | 8.4 |
| 18 | 0.1 | 5.7 | 9.0 | 10.4 |
| 22 | 0 | 2.2 | 2.8 | 4.2 |

People out anywhere in the back: 238, 289, 264, 122 (before: 16, 5, 4, 3).

The same on a clean export of HEAD 330a176 with this work, a copy of Steve's save: back 4.0, 5.7, 5.2, 1.7
(before 0.3, 0.1, 0, 0); quays 8.5, 8.7, 9.1, 2.6; middle 7.3, 6.3, 9.8, 3.8. People out in the back 183, 252,
232, 98 (the town's own: 14, 5, 6, 3). `__scheldemist.paths()` lists nothing. Picture: `pp_export_pump.jpg`.

Frame time (`perf(40)` render with the GPU finished, plus one frame of game logic; hidden pane, noisy):

| Where | Before | After |
|---|---|---|
| Rijnkaai | 12-13 ms + 2.3-2.8 ms, 26 drawn | 11.7-14.8 ms + 2.4-4.7 ms, 40 drawn |
| A back square | 8.0-9.5 ms + 1.4-1.7 ms, 0 drawn | 9.3-9.9 ms + 1.7-2.0 ms, 21 drawn |
| A pump court | - | 6.9-9.9 ms + 1.8-2.1 ms, 21-40 drawn |

The street setting still caps the load: at "Few" 20 are drawn, at "Normal" 41.

## Checks

- On a clean export of HEAD with this work: `npm run build` passes, `npm test` 904 of 904.
- `npm test`: the new `server/test/backtown.test.ts` (9 tests): made from the seed; every trade;
  homes, work spots, places and routes reachable; groups within their sizes; the back out at every
  hour; the talk; the migration in place and once; the lines. `npm run build` passes.
- Pictures in `data/shots`: before `pp_before_back_*.jpg`, after `pp_after_back_*.jpg`. Scenes:
  `pp_pump2_0/1` (washing), `pp_cards2_0/1`, `pp_corner4_front/side`, `pp_knot_0`, `pp_gossip_0`,
  `pp_step2_front/side`, `pp_drunk_0/1`, `pp_watch_0` (night), `pp_parish_priest`,
  `pp_doctor_side`, `pp_lovers_0_a/b`, `pp_walk2_a/b` (Sunday on the wall), `pp_kroeg` (evening).

## Open

- The estaminets have no sign and no inside; the drinkers stand before an ordinary door.
- Some courts with a pump cannot be walked into on the walk map; they get no washing.
- The doctor walks; there is no gig.
- The lads' menace is words only. Tying the night gangs (`night/gangs.ts`) to the corner lads could come later.
