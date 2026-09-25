# M7 lamps: gas lamps on the squares and main streets, 2026-09-25

Steve said yes to: "The Grote Markt, the Handschoenmarkt, the cathedral quarter and the lock bridge have no
street lamps; at night they are dark. Add gas lamps there and put them on the lamplighters' rounds."
(M7-walkthrough-west.md, bug 7.)

## What was wrong
- No lamps on the Grote Markt's edges, the Handschoenmarkt, the cathedral quarter or the lock bridge.
- Four of the old lamps could not be seen. d22 and d23 (Grote Markt, `(-230, 60)` and `(-280, 60)`) stood
  inside the town hall's walls, which end at z 61.9. d26 and d27 (`(-74, 60)`, `(-74, 160)`) stood in the
  canal (x -82 to -70).
- The 32 city lamps did not light the ground. Only the 6 Rijnkaai quay lamps had a point light and a psx
  slot (glow in the fog, streaks on wet stone and water). The city lamps had lit glass and a halo, nothing more.

## What is in

| Part | What | Where |
|---|---|---|
| New lamps | 34 new lamps (d32 to d65), 4 moved. The town now has 72: 6 on the quay, 66 in the city. | `tools/city/design.py` `DECOR["lamps"]`, `shared/city.json`, `shared/city_build.json` |
| Each spot checked | At least 0.8 m from a wall on the walk map. Clear of the solids as placed, the doors and their steps (2.2 m from a door, 1.7 m from its step), the markets, trades and landmark doorways (`doorKeep.ts`), the Steen's keep-outs, the drays' lanes, the path check's points (1.5 m) and the other lamps (7 m). Also clear of the omnibus lanes, with one exception: the two lamps in the Handschoenmarkt street stand between its two lanes, as d24 has since M3g (0.6 m clear of each body). | a script over the walk map and a dump of the placed world (not kept) |
| Every lamp lights the ground | The scene keeps its 6 gas-lamp point lights, which are the quay lamps' own. The light count never changes, so no shader is rebuilt. These 6 lights and 5 of the 6 psx lamp slots now go to the lit lamps nearest the eye (ahead counts more than behind). They move on as Jef walks, fading over half a second, and a lamp that has a light keeps it until another is clearly nearer. The 6th psx slot stays free for Jef's lantern (`lantern.ts` takes a free slot first). Every other lit lamp within 110 m throws a ground pool: one instanced decal, the light the point light would give flat stone. The pool is shifted away from a quay edge or steps so it never hangs over the water. The quay lamps keep their own flicker, the sputtering one too. | `client/src/world/gaslamps.ts`, `client/src/world/rijnkaai.ts` (the quay lights handed over) |
| Halos | Room for 160 lamps (was 64). | `gaslamps.ts` |
| Rounds | `LAMPS_VERSION` 5: a save rebuilds its two rounds on load. The west round now has 42 lamps and the east round 30. The split is the same as before (x < -145). Planned pace, unseen: west 1,121 m in 2.2 game hours, east 1,023 m. The last lamp of each round lights at 19:48 and 19:53. Since replaced by three rounds (below, "A third lamplighter"). | `server/src/town/lamplighters.ts` |
| Carts go round the posts | When a way is asked with room (`walkPath(..., clear)`: the hearse, the fire pump, the lively rounds with a cart), it keeps `clear` + 0.3 m from every lamp post, the simplified line too. The start and the end may lie by a post. A walker (`clear` 0) passes them as before. | `lamplighters.ts` `lampPostCells`, `walkPath`, `simplify` |
| Dev | `world.gasLamps.lightInfo()`: which lamps have the lights and the psx slots, and how many pools are drawn. | `gaslamps.ts` |

### Counts by area

| Area | Lamps | Where (x, z) |
|---|---|---|
| Grote Markt | 6 new, 2 moved | d22 and d23 moved to the town hall's front at z 65 (x -231 and -283). New: 2 more on that front either side of the porch (x -244, -270); 2 before the north guild fronts, 4.5 m out (-226.5, 87.6 and 105.2); 2 before the south guild fronts, 2.4 m out between two doors (-283.6, 84.6 and 108.2). The middle of the square is left free for the market and the omnibus. |
| Handschoenmarkt and the cathedral's west front | 4 new | Either side of the west portal (-243, 141.5) and (-280, 141.5); the two far corners (-212, 137) and (-300, 137). d24 and d25 were already there. |
| The street into the Handschoenmarkt from the east | 2 new | (-186, 128) and (-162, 128), between the omnibus lanes |
| Cathedral quarter | 8 new | The wide street north of the cathedral: (-218.5, 162), (-218.5, 186), (-212, 208). The lane along its south side, 2 m off the church wall, every 24 m: x -302.5 at z 162, 186, 210, 234 and 258. |
| Steenplein up to the Handschoenmarkt | 4 new | x -201.6 at z 57.5, 80.5 and 107, 1.6 m before the house fronts and between the doors; the cross street between the two Steenplein blocks (-178, 78) |
| Lock bridge | 2 new | One at each end, on the quay beside the deck: (102.4, 23.2) and (117.6, 23.2) |
| Other main streets | 8 new, 2 moved | The canal's west quay, where the omnibus runs: x -90.4 at z 141, 162.5 and 186.5. The street west of the Vleeshuis quarter: x -153.8 at z 142, 167 and 194. The street behind the Rijnkaai: (-12, 43.4) and (36, 43.4). d26 and d27 moved onto the canal's east quay by the middle and high bridges: (-68.4, 62) and (-68.4, 161). |

Left dark on purpose (the gangs' ground, M7 night): the lane behind the town hall (the Werf drays run
there), the 2 m lane along the cathedral's north side and the lane behind its choir, the back-street grid
behind the Rijnkaai, the Eilandje north of the lock, and the Vleeshuis street (z 114). That street's omnibus
lane leaves no room for a post.

## Rebuild
Lamps are placed from `city.json` when the game loads. No Blender model changes.

    python tools/city/design.py && python tools/city/plan.py

`plan.py` gives the same houses, walk map and ground as before. Checked: the only change in `city.json` and
`city_build.json` is `decor.lamps`, and `walk.png` is unchanged.

## Checks (test stack `lamps2`, 8975 / 5375, a copy of Steve's save, day 4, silent)
- `npm run build` passes. Server tests: 812 of 812 before the new test. `townlife.test.ts` then passed
  13 of 13 with it: a cart's way from (-226.5, 80) to (-226.5, 112) keeps 1.1 m from every post, while a
  walker's is a straight line.
- `paths()` lists nothing, including the 72 lamplighter stands. `signs()`: 0 problems. `streetEnds()` lists
  nothing. `routeClips()`: the same 4 clips as before (3 on the Eilandje dray loop, 1 on the omnibus at
  (-89.5, 97.5)); none are lamps.
- `zfight()` at 22:00: before 430 fights, 1,534 thin, 4,500 close; after 429, 1,533, 4,492.
- Frame time, `perf(60)`, median of three, night 22:00, clear, 960 x 540, other stacks running:

| View | Before | After |
|---|---|---|
| Grote Markt, from (-236, 118) toward the town hall | 10.2 ms, 613 calls, 417k tris | 8.6 ms, 611 calls, 415k tris |
| Handschoenmarkt, toward the west portal | 7.5 ms, 288 calls, 332k | 7.1 ms, 295 calls, 328k |
| The lane south of the cathedral | 7.0 ms, 210 calls, 285k | 7.1 ms, 220 calls, 285k |

  The frame time moves with the rest of the machine; the lamps add a few draw calls and one pool mesh.
- The lamplighter at dusk: at 18:20 the west lamplighter (Victor De Bock) came up the Grote Markt's north
  side, was seen and walked at 1.55 m/s. He stood at d35, raised his pole, and the lamp lit. It lit the
  guild fronts and the cobbles; the lamps ahead stayed dark (`lamps_lamplighter_pole_d35.jpg`,
  `lamps_lamplighter_lit_d35.jpg`). By the plan he reaches the Grote Markt at 18:23, the cathedral's south
  lane at 18:52 and the portal at 19:27.

Pictures in `data/shots`, 22:00:
- clear, before and after: `lamps_before_gm` / `lamps_after_gm` (the Grote Markt toward the town hall),
  `lamps_*_hsm` (the Handschoenmarkt and the west front), `lamps_*_cathfront`, `lamps_*_cath_s` (the lane
  south of the cathedral), `lamps_*_cath_n` (the street north of it), `lamps_*_lock` (the lock bridge)
- fog: `lamps_before_fog_gm`, `lamps_before_fog_cathfront`; `lamps_after_fog_gm`, `lamps_after_fog_cathfront`,
  `lamps_after_fog_cath_s`
- after only: `lamps_after_x153` (the street west of the Vleeshuis quarter), `lamps_after_cross_z78`,
  `lamps_after_werf_pools`

## A third lamplighter (2026-09-25)

The lamp agent's proposal (Left, below), Steve did not object. Followed, a lamplighter walks in real time
while the clock runs 30 times faster (a game hour is two real minutes): at Jef's walk (1.55 m/s, 3.2 s a
lamp) the west round of 42 lamps took 858 real seconds, 7.2 game hours, against a 2.2-hour window.

**Three men and three rounds would still not do it at the old windows.** The 72 lamps lie on about 1,960 m
of path. Split three ways, a round is 627 to 709 m and 17 to 28 lamps: 3.9 to 4.2 game hours at Jef's
walk. So the windows grew as well, and the lamplighter walks a little faster than Jef when he must.

| Part | What | Where |
|---|---|---|
| Three rounds | `ROUNDS` and `roundOf`: **west** old town (the Werf, the Steenplein up to the Grote Markt's corner, the quay road east of the vliet, the Rijnkaai's first two lamps), **market** (the Grote Markt, the Handschoenmarkt, the street into it from the east, the cathedral quarter, the street west of the Vleeshuis quarter), **east** quays (the Rijnkaai, the street behind it, the canal quays, the lock bridge, the basins). Every lamp is on one round (a round with nobody hands its lamps to the nearest that has a man). | `server/src/town/lamplighters.ts` |
| The tour | The shortest open tour over the round's lamps, every lamp tried as the first (straight lines), then 2-opt again with the walked lengths (`walked2opt`: the west round 20 m shorter). It is walked the way that crosses its opening bridges earlier, so that a wait for a boat comes while there is time to make it up (west: the canal mouth first, the vliet at 37% of the way; the market round has no bridge; east: the lock bridge first, the canal at 95% either way). Before, the tour began at the lamp nearest the man's door. | `buildRound`, `walked2opt`, `bridgeEnds` |
| The man | `LAMPS_VERSION` 9 (6 to 9 the same day while it was tuned; each rebuilt the rounds). Whoever walked a round keeps it (an older save: west and east); the town's other lamplighters take the rounds left; a round with nobody goes to a docker or a porter living nearest its start, who changes his trade. Name, family, home, stats, memories stay; only trade, work and day change. On Steve's save (copy): Victor De Bock west and Adriaan De Smet east as before, Hendrik De Smet (r056) takes the market round. | `ensureLamplighters` |
| The windows | Dusk from 16:45 (round i starts 3 minutes after round i-1: 16:45, 16:48, 16:51), 3.7 game hours; the windows close 20:27 to 20:33. Dawn from 5:00, 3.7 hours, to 8:42. Full dark is 21:00 (the sky's night level), full day 9:00. Was 17:36 + 2.2 h and 5:30 + 1.4 h. The lamplighter's day is at work from the round's start to full dark and from dawn to full day. | `server/src/town/lampround.ts` |
| His pace, seen | `seenPace`: the pace that ends his round `SEEN_SPARE_S` (12 s) before the window closes, from where he is and the path left (the leg in hand counted 15% longer than the straight line), never below Jef's walk (1.55 m/s). On a round that nothing holds up it is at most 1.81 m/s by the plan (a brisk walk; `SEEN_PACE_MAX` 1.9 is the test's limit); held up he hurries, at most 2.5 m/s (`SEEN_HURRY`; Jef hurries at 3.4). He stops 2.4 s a lamp (was 3.2). Jef, walking behind him, keeps up: the stops give him back what the brisker legs take. | `lampround.ts`, `client/src/game/lamplighter.ts` |
| Held up past the window | A lamplighter Jef follows who is still on his round when the window closes goes on until full dark (full day at dawn); the lamps ahead wait for him. At 21:00 (9:00) the plan takes over. | `inGrace`, `lamplighter.ts` |
| Talk | "Every lamp from the Werf to the basin, twice a day" (no longer true for any of them) is now "My round of lamps: lit at dusk, out again at dawn." | `server/src/town/talk.ts` |

### Round sizes and times (planned; `followedFinish`: Jef follows from the first lamp)

| Round | Lamps | Path | At Jef's walk | Dusk window | Last lamp, unseen | Last lamp, followed | Pace followed | Dawn: last out, unseen / followed |
|---|---|---|---|---|---|---|---|---|
| west (q1 to d0) | 28 | 627 m | 472 s, 3.93 h | 16:45 to 20:27 | 20:26 | 20:20 (431 s) | 1.72 m/s | 8:41 / 8:35 |
| market (d42 to d51) | 27 | 627 m | 469 s, 3.91 h | 16:48 to 20:30 | 20:29 | 20:23 (431 s) | 1.71 m/s | 8:41 / 8:35 |
| east (d56 to d60) | 17 | 709 m | 498 s, 4.15 h | 16:51 to 20:33 | 20:32 | 20:26 (431 s) | 1.81 m/s | 8:41 / 8:35 |

Unseen, the town is now lit from 16:45 to about 20:30 (before: 17:36 to 19:53); the last lamps burn at
dawn until about 8:40 (before: 6:55).

### Tests
- `townlife.test.ts`: three rounds, three different men, every lamp on the round `roundOf` names; the
  three within a fifth of each other at Jef's walk; followed from the first lamp, each ends inside its
  window at dusk and at dawn, before 21:00 and 9:00, at 1.9 m/s at most; at least 50 real seconds from
  the window's close to full dark (30 to full day); `seenPace` is Jef's walk with time to spare and a
  hurry when late; `REAL_S_PER_GAME_HOUR` matches `shared/clock.ts`. A version-5 save (two rounds, the
  market's man still a docker) keeps its west and east men, and the one docker nearest the market becomes
  the third: only his trade, work and day change, no memory goes.
- `lively.test.ts`, `transport.test.ts` (the older saves `data/test-*-old.sqlite`, each with two
  lamplighters): a lamplighter's trade, faction, work and day may change, nothing else of anyone; three
  lamplighters after; at most one new, and he was a docker or a porter. `population.test.ts`: at least 3.
- `npm run build` passes; server tests 819 of 819.

### Browser check

Test stack `lamps3` (8977 / 5377), a copy of Steve's save (day 4), silent, clear. The pane was hidden, so
the tab ran on a worker's timer at real time: the game stepped by the real seconds that passed, the
server's clock ticked every 10 real seconds (5 game minutes), and Jef was kept 3.5 m behind the
lamplighter the whole way. The clock set to 16:44, each lamplighter followed from his first lamps to his last.

| Round (who) | Seen from | Last lamp lit | Window closes | Real time | His pace | Held up |
|---|---|---|---|---|---|---|
| west (Victor De Bock), version 9 | 16:49, lamp 1 | 20:19 | 20:27 | 428 s | 1.55 to 1.77 m/s | never |
| market (Hendrik De Smet), version 8 | 16:53, lamp 1 | 20:22 | 20:30 | 419 s | 1.55 to 1.86 m/s | never |
| east (Adriaan De Smet), version 8 | 16:55, lamp 1 | 20:25 | 20:33 | 421 s | 1.55 to 1.95 m/s | never |

Every lamp lit when he raised his pole to it, 20 to 40 minutes before full dark; nobody lost sight of him
(no drops). The market and east rounds of version 8 are the same as version 9's; the west round of
version 8 (647 m, before `walked2opt`) also finished, at 20:15. The paces over 1.8 m/s came at the start,
while the clock ran a tick ahead of the setting. At dawn (5:00) the market lamplighter put out his first
three lamps by 5:24 at 1.8 m/s. `paths()` lists nothing.

Why the bridges: in the first runs (version 7, dusk from 17:00 and the west round ending with the canal
mouth) the west lamplighter had 26 lamps lit by 20:00 and then stood at the canal mouth while a boat went
through: the bridge stayed open from about 20:00 to 20:55, 100 real seconds. His window closed and the last
two lamps (q0, q1, across the canal) lit by the plan. Hence the grace until full dark, the hurry, and the
west round now crossing the canal mouth first.

## Left
- (Done 2026-09-25, "A third lamplighter" above.) ~~Two lamplighters for 72 lamps: followed, a round took
  longer than the dusk window.~~
- The east round must cross the canal near its end (d58 to d60 stand on the west quay; 95% of the way
  either way round), and its quay path by d26 and d27 runs through the canal bridges' landings. A boat at
  the wrong moment holds him up to 100 real seconds; with the hurry and the 25 to 30 minutes of grace
  (50 to 60 real seconds) he may still end after 21:00, and then the plan lights his last lamps. Not seen in
  the check. Moving d58 to d60 to the market round makes that round too long (790 m).
- The canal-mouth bridge stays open about 100 real seconds for one boat (the boat creeps near the start of
  its route). That holds Jef and every walker too; it is the bridges' pace, not the lamps'.
- Followed, a lamplighter walks at 1.7 to 1.8 m/s, a brisk walk: a little faster than Jef (1.55). Jef keeps
  up because of the stops. At exactly Jef's pace no three-way split fits before full dark (3.9 to 4.2 game
  hours a round); that would take five or six lamplighters.
- Unseen, the town is lit later than before (last lamps about 20:30, was 19:53), and the dawn lamps burn
  until about 8:40.
- The Werf's lamps (z 9.5) stand 1.2 m from the omnibus lane's middle, inside its 1.9 m keep-out. They
  do not clip (`routeClips()`), and they were not moved.
- Townspeople who move to the nearest lamp at night with open work now find one in more places. The
  sexton stands under the portal lamp at (-280, 141.5), 18 m from his door.
- Not checked in a picture: Jef's lantern halo in the fog with 5 lamps near. The slot is kept free for it.

## Fog lamps and lamps in the fog (2026-09-25)

Steve, with a picture of a foggy day (a street, a gas lamp, trees): "Street lamps are dark in the fog when
off. Maybe when all also, test it." And small lantern shapes hung in the air in the middle of the street.

### Why
- **No fog lamps.** A lamp's light was `level x dark` (the clock's dark, 0 from 9:00 to 15:00), and the
  rounds knew only dusk and dawn. In thick fog by day every lamp was out.
- **Shapes in the air.** The lamp glass was drawn without fog (`fog: false`) so a flame would show through
  it. The post, the box and the carrier behind it fogged away; the glass did not, and the culler
  (`world/cull.ts`) never hid a material without fog. So an unlit gas lamp hung in the grey as a dark box
  (its glass texture has a dark frame, so colouring it with the fog did not help), a quest box's unlit
  lamp (0x3a3228) hung at 1.44 m, and after dark a carried lantern and its halo showed to 1.8 fog-fars
  with no one under it. The same held for the omnibus lamps, the Madonna and step lanterns, the tar fires
  and the forge glow.

### What is in

| Part | What | Where |
|---|---|---|
| The day's fog | The engine keeps `fog_day` (world_state): did the day begin in fog, and the hours the fog came or lifted since. The midnight roll and the dev menu set the day's weather from midnight; the director's weather change turns it at the hour (`setWeather(db, w, at)`). Only `fog` counts (mist, rain, a storm do not). Sent with every payload (`lamps_fog`) and with `/api/townlife` (`fog`). | `server/src/day.ts` `setWeather`, `fogDay`; `director/scheduler.ts changeWeather`; `index.ts` |
| The rounds with fog | `windowsOf(round, fog)`: fog at 5:00, no dawn round (the lamps burn on all day); fog that comes by day, a fog round lights them from that hour in the round's order; fog that lifts by day with time before dusk (3.7 h), a round puts them out, later than that they burn on into the evening; the dusk round only after a round has put them out. Every lamp's state is still the clock's function (`lampLit(r, k, h, fog)`); without fog it is the same as before. A fog round is walked like the others (seen: `seenPace`, grace half an hour). | `server/src/town/lampround.ts`, `client/src/game/lamplighter.ts` |
| By day in the fog | A lamp lit by day glows at 0.8 of its night glow in fog (glass, halo, the glow in the air: in proportion to how thick the air is), and lights the ground at 0.3. | `gaslamps.ts` `FOG_DAY_GLOW`, `FOG_DAY_GROUND`; `rijnkaai.ts` (the quay lamps) |
| Glass that fogs | `lampFog(mat, reach, maxReach)`: the material fogs like its post, a lit one a little further (a gas lamp 1.6 fog-fars, a lantern 1.2); `userData.fogReach` tells the culler where to hide it. On the gas lamps (city and quay), the doss house lantern, every carried lantern (crowd, employers, the gang, Jef's), the quest boxes, the omnibus lamps, the street and quay lanterns, the tar fires, the forge glow, and props' glass. The halos of the gas lamps sit 0.45 m in front of the glass, so the fogged glass never cuts a dark lamp shape out of its glow. | `client/src/world/lampFog.ts` and those files |
| Lanterns with their carrier | A crowd lantern is drawn only while its carrier is (it hung in the fog on its own where he was past the fog or culled); its light on the ground still carries. By day its horn is dull and its halo out (`lanternDarkAt`). | `game/crowd.ts` `placeLantern` |
| Found on the way | A resident drawn again (lost and redrawn as Jef walked) never took up his lantern again (`s.lamp` stayed true); the test kit's `step()` never set the crowd's hour (a hidden tab's crowd stayed at 9:00: few people, no lanterns). | `game/town.ts lose`, `main.ts step` |

Dev: `POST /api/dev/set {"weather": "fog", "weather_turn": true}` turns the weather at the present hour
(the director's way); without `weather_turn` it is the day's weather from midnight.

### Checks
- `npm run build` passes. Server tests 821 of 821 (new in `townlife.test.ts`: the rounds with fog, and the
  engine's record of the day's fog).
- `paths()` lists nothing. No console errors. `perf(60)` fog day 13:00, street west of the Vleeshuis
  quarter: 9.8 ms, 569 calls.
- Browser, test stack `foglamps` (8980 / 5380), a copy of Steve's save, silent. The "before" pictures from
  the old client (HEAD, served from a temporary copy against the same test server).
  - Fog 13:00: before 0 of 72 lamps lit, after 72. Opaque meshes drawn without fog: before 83 to 123,
    after 0.
  - Fog 22:00, the Rijnkaai: before one crowd lantern drawn with its carrier not drawn (warm dots hanging
    over the quay), after none. A police lantern seen from 10, 20, 31 and 51 m (fog far 19 m): drawn with
    him at 10 and 20 m, hidden with him at 31 and 51 m.
  - Fog comes at 10:00 (turn): the fog round lit 0 -> 12 -> 25 -> 38 -> 72 lamps by 14:20 (the market
    lamplighter was seen and walked it). Fog lifts at 11:00: 72 -> 59 -> 46 -> 34 -> 0 by 15:20; by 17:25 the
    dusk round had lit 13 again.
  - Unlit glass: a pale grey glass by day (clear), amber at dusk; never black. (`foglamps_glass_day_fog_unlit`
    was taken 3 s after the fog came: the air had hardly thickened yet.)

Pictures in `data/shots`: `foglamps_{before,after}_{fogday,fognight,clearnight}_{street,crowdA,crowdB,box}`,
`foglamps_after_lantern_fognight_{10,20,30,50}m`, `foglamps_glass_{day_clear_unlit,day_fog_unlit,day_fog_lit,dusk_clear_unlit,night_fog_lit,night_clear_lit}`.

### Left
- Lit house windows still show through the night fog on their own (the wall behind them is as dark as
  the fog). They are light, and a lit window does show through fog; not changed.
- The lamplighter's schedule (server) still has him at work at dawn on a fog day, when no dawn round is
  walked; he walks his route as a patrol then. His talk line does not mention fog.
- Mist (and rain) days leave the lamps to the clock; only `fog` lights them by day.
