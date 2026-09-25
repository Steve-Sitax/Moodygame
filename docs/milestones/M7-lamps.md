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
| Rounds | `LAMPS_VERSION` 5: a save rebuilds its two rounds on load. The west round now has 42 lamps and the east round 30. The split is the same as before (x < -145). Planned pace, unseen: west 1,121 m in 2.2 game hours, east 1,023 m. The last lamp of each round lights at 19:48 and 19:53. | `server/src/town/lamplighters.ts` |
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

## Left
- Two lamplighters for 72 lamps. Seen, a lamplighter walks at 1.55 m/s and stops 3.2 s at each lamp. At
  that pace a whole round would take him longer than the 2.2-hour dusk window, and the lamps ahead wait
  for him, as they did before (unseen, the plan's pace is kept). A third lamplighter for the market
  quarter (Grote Markt, Handschoenmarkt, cathedral) would halve that. It means one more docker changing
  trade, and the older-save tests in `lively.test.ts` and `transport.test.ts` would have to allow for him.
- The Werf's lamps (z 9.5) stand 1.2 m from the omnibus lane's middle, inside its 1.9 m keep-out. They
  do not clip (`routeClips()`), and they were not moved.
- Townspeople who move to the nearest lamp at night with open work now find one in more places. The
  sexton stands under the portal lamp at (-280, 141.5), 18 m from his door.
- Not checked in a picture: Jef's lantern halo in the fog with 5 lamps near. The slot is kept free for it.
