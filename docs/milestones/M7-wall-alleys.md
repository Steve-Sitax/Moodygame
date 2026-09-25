# M7 the town wall, the back alleys and the angled streets, 2026-09-25

Steve sent a painted map of the town and four pictures (a gate with its bridge, the stair up the inside
of the wall, the walk with a guard house, a bastion): "Map changes. This is the reference image for a map
change. Especially the back alleys and the wall around the city are the most work. Analyze and implement."
Then: "test, take pictures, evaluate. Goal is neat wall, no z fighting, good textures, no breaks."

## The wall (`tools/city/rampart.py`, read by `design.py`)
Round the three land sides of the compact map, outward from the house fronts:

| Part | Size | Notes |
|---|---|---|
| Wall street | 8 m | cobbles along the inside of the wall (x -348..-340, z 300..308, x 200..208) |
| Rampart | 7 m thick, walk at 6.5 m | brick on a grey stone plinth, stone coping; low parapet on the town side, breastwork with embrasures on the field side |
| Bastions | 4 | arrow-head bastions at the two land corners, half-bastions in the river at both ends of the quays; a guard house on each, a sentry turret at the land salients |
| Towers | 10 | small square towers out from the wall, a guard house (slate pyramid roof, lantern, bench) on each |
| Gates | 4 | Rode Poort (north, by the Eilandje), Keizerspoort and Kipdorppoort (east), Sint-Jorispoort (south): two square towers, arch, frontispiece with a lion, open leaves, lanterns, a sentry box; a stone bridge over the moat |
| Stairs | 11 | stone flights along the inside face, 36 steps, iron railing; by a gate the foot is at the gate and the flight climbs away from it |
| Berm | 14 m | grass, a row of trees |
| Moat | 20 m | water, open to the Schelde at both ends (tidal); ladders every 40 m (as all quays) |
| Far bank | 20 m walkable, then fields in the fog | grass, two rows of trees |

The map area grew to x -460..320, z -80..420 (walk map 1560 x 1000 cells). The Werf store now reaches back
to the wall (x -348), so the quay railway comes through the store unseen, as before.

How the game walks it: the walk map has the walk, the bastion tops and the stairs as open ground and the
parapets (0.8 m), stair railings (0.5 m), guard houses, gate towers and bridge parapets as walls, painted
cell by cell (a cell is wall when its middle is inside; ImageDraw made a 0.6 m parapet 1.5 m thick and the
stairs too narrow). `client/src/world/rampart.ts` gives the heights (`rijnkaai.ts baseAt`), as
`steenramp.ts` does for the Steen: the only way up is a stair. The crowd walks up too (the ramparts were
the town's promenade; places "Ramparts" and the four gates). Sentries: two at each gate, one on a round on
each side of the walk (drawn by `rampart.ts wallGuards`, not townspeople: an older save gets them too).

The model: `tools/blender/build_wall.py` -> `client/public/models/wall.glb` (Draco, 45k triangles, 1 MB),
built from `shared/city.json decor.rampart` and `decor.rampart_solids` (every solid part of the model
stays inside the walk map's walls). 15 chunks of 100 m (culled beyond the fog) and one object per gate.
Materials `wall_*` with small painted textures, mipmapped (long brick faces made moire rings without);
`wall_lamp_glow` is drawn bright.

## The back alleys (`tools/city/alleys.py`, run by `plan.py`)
The nine back masses of 500 m2 or more (the flat-roofed slabs inside the big blocks, up to 240 m long)
became gangen: alleys 2.4 m wide along the block, 341 cottages (one or two storeys, rows of one style),
yards of packed earth behind them, gardens with grass and 55 trees. 47 passages, 2.2 m wide, lead in from
the streets between two front houses, each of which gives up 1.1 m on that side.

Kept as it was, on purpose:
- every house index (saves, `shared/inworld_houses.json` and the homes point at houses by index): a back
  mass keeps its index as its alley's first cottage; the other cottages go on the end (720 -> 1053 houses).
- no house anyone lives in in Steve's save is trimmed (`alleys.py LIVED_IN`), nor an in-world house: their
  doors stay where they are. Only house 630 (the Werf store, longer) and the trimmed front houses changed.
- the plan's own dice: the alleys draw from their own seed.

Back walls of front houses on a yard get windows (city_build `yard` flags; never a door). The paper map
draws the lanes, yards and gardens, the wall, the gates and the grass.

## Also changed
- Street grids (dirt, ruts, litter, clutter) and the shore texture: `client/src/world/townBox.ts`, the
  town inside the wall, instead of numbers in each file.
- Grass: a new ground kind (`paving.ts grassPaving`, `plan.py ground_zones`).
- Clutter no longer closes "street ends at the map edge" (it put a fake wall in each gate's mouth).
- Quay furniture keeps off the moat's banks.
- Quay edge stones are mitred at their joints: every quay corner flickered (149 z-fights, now 0).
- Lively rounds with a cart keep out of the alleys: asking for a cart's way into a 2.4 m lane searched the
  whole town each time; a new game took 10 s instead of 1 s. (The fire pump and the hearse still ask, with
  fallbacks, once per event.)
- Tests: two tests picked "the first door within 3.6 m" or "a docker out at 22:00"; with the new houses and
  the town's new draws they now pick the right one.

## Rebuild
    python tools/city/design.py && python tools/city/plan.py && node tools/city/inworld.mts
    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_city.py
    ... -P tools/blender/build_wall.py        (-- --preview for pictures in data/shots/)
    ... -P tools/blender/build_props.py, build_streetlife.py, build_quayfurniture.py

## Checks (2026-09-25, test copy, midday, clear)
- `npm run build` passes; `npm test` 836 of 836; `__scheldemist.paths()` lists nothing.
- All 11 stairs climbed by script: up to 6.5 m, onto the walk; from the street the railing stops you.
- Pictures: each gate from the field and the town side, the walk, a stair, a bastion, the moat, the alleys.
- z-fight check: the wall 0 visible (its export now keeps 20-bit positions: Draco's 14 bits moved shared edges
  apart by millimetres, 29 slivers); quay corners 0 (were 149); no quay wall drawn over the river bastions' faces.

## Open
- Alleys: rows of one style; a pump, washing lines and sheds would give them life (asked Steve).
- Garrison: the gate sentries are drawn, not residents; wall rounds do not change guard.


## Part 2: angled streets, the bent wall, the countryside (same day)
Steve: "Too bad the streets all are in sort of a grid with 90 degree angles. Antwerp has more streets on angles."
Then, on plans drawn for him (proposals 1-5, map pictures): the save may go ("save can be removed, so no
issue"); the wall "less blocked", bent out on the inland side with a bastion in the middle, "the less straight
the better"; houses up to the wall, a park as the town had; no impossibly small houses; a straight road to every
gate; the vliet's quays wide enough for wagons; inner courts and alleys "like the Vlaeykensgang"; more
important buildings of the era; the gates shut ("we cannot leave the city") and the countryside finished,
since the walls can be climbed; moss on the wall where the park's pond meets it.

| Part | What | Where |
|---|---|---|
| Streets | Zones of the old rectangles and the new ground inside the wall, cut again by 23 angled and winding streets (letters A-Y as on the plans); no block narrower than 8 m; a lane from any landmark that would sit inside a block | `tools/city/streets.py`, `design.py` |
| Wall | One bent line (TRACE, ten pieces) round the three land sides; arrow-head bastions at five corners, the middle one with a tower mill (sails turn, `rampart.ts`); 9 towers, 4 gates (shut: the leaves across the arch are wall), 12 stairs, all in each piece's own frame | `tools/city/rampart.py`, `build_wall.py`, `world/rampart.ts` |
| Outside | Nobody walks beyond the wall (walk map: outside); the berm, moat and far bank are scenery; no ladders in the moat. Beyond the map: fields in strips, hedges, poplar-lined roads from the gates, farms, two windmills, the villages of Borgerhout, Berchem and Kiel with their spires | `world/countryside.ts` |
| Alleys | Rows of cottages in the big back masses; courts (small houses round a court, a pump) and gangs (a 1.8 m winding lane in under a front house by a covered passage, small courts with a pump at the bends) in the rest; a gang is one cobbled way wall to wall; no edge stones inside the alleys; back walls on yards have windows and no kerb | `tools/city/alleys.py`, `build_city.py` (passages: `poort`) |
| Churches | Sint-Carolus Borromeus (on the Conscienceplein), Sint-Pauluskerk, Sint-Jacobskerk, on OSM outlines scaled to fit | `design.py` LANDMARKS, `build_churches.py` -> `churches.glb`, `world/churches.ts` |
| Stadspark | Laid out 1867-69 on the old ramparts: grass, gravel paths, the pond (it reaches the wall, the wall mossy there: a decal), a footbridge (walkable, its deck's height), benches, lanterns, railing | `streets.py` PARK, `build_churches.py` -> `park.json`, `build_wall.py` moss |
| Pumps | A town pump in every court | `churches.glb` "pump", `world/churches.ts` |
| Vliet | 8-10 m quays both sides | `streets.py` zones |

Also: the in-world taverns and homes moved to houses of the new plan (`node tools/city/inworld.mts --repick`);
shut-in yards are wall in the walk map (nothing placed where nobody can go); the dray loop behind the Rijnkaai
follows the bent streets (client and server copy); cart rounds keep out of the alleys and stop only where a cart
fits; street sellers never take a house whose inside stands in the world; parked carts and dressed props keep
off the heads of the boat steps; the street grids (`world/townBox.ts`) in whole metres (a fractional size made
the ruts' search run for ever and froze the page).

Rebuild after a map change:

    python tools/city/design.py && python tools/city/plan.py
    node tools/city/inworld.mts --repick && node tools/city/inworld.mts
    blender ... build_city.py, build_props.py, build_streetlife.py, build_quayfurniture.py, build_wall.py, build_churches.py
    (build_churches.py writes park.json, which plan.py reads: run plan.py again after it if the park moved)

Checks (2026-09-25, test copy, a new game): `npm run build`, `npm test` 836 of 836, `__scheldemist.paths()` empty;
the 12 stairs climbed by script; the four gates stop a walker before their leaves; pictures of the gates, the
walk, the mill, stairs, gangs, courts, the passages, the churches, the park, the countryside.

Open:
- House facades show ring patterns (moire) at steep angles: their atlas has no smaller copies; for the planned
  graphics pass.
- The z-fight tool counts some party walls on the angled blocks as visible (neighbours 1-5 mm apart where a
  corner plot meets a straight one); the close pictures show nothing.
- The alley cottages have no lit windows at night yet (their windows differ from the painted panes'
  layout; `city_openings` in city.glb has the real ones).


## The town wall, pass 2 (2026-09-25)
Steve's picture 7: the rampart at night, a brick tower mill on a bastion, a wet cobbled walk with a stone-coped
parapet, a bench, gas lamps, a guard house with a lit door, autumn trees and fallen leaves, reeds and water
plants along the moat. Steve: "use returning assets and mix up".

| Part | What | Where |
|---|---|---|
| Mills | Two now. The first (middle bastion) got pale linen sails, two of them reefed (the lattice shows, the rest of the cloth rolled), a tail pole with two braces down to a capstan wheel on the grass, and two windows lit at night. The second, a stage mill on the north-east bastion: taller and slimmer, a timber gallery with a railing and struts at 2.9 m, the tail pole to the gallery, shorter sails. Each mill's sails are their own node (`mill_sails`, `mill2_sails`) with the axle in the node's extras; both turn, at their own pace | `build_wall.py MILLS, build_mill`; `rampart.ts loadWall` |
| Walk | The quays' setts (the Codex picture `quay_setts.jpg` and its height and stone maps, 2 m a tile), wet in the rain, puddles, each stone its own tone. No parallax: the walk's uvs follow each piece of the wall. The bastion tops in the town's grass (`paving.ts grassPaving`) | `rampart.ts matFor` |
| Benches | 31, three kinds mixed by seed: a park bench with iron ends and a back, a plank bench on trestles, a stone slab on two blocks. Against the breastwork looking into the town, now and then one by a lamp on the town side, two by each mill | `build_wall.py build_dressing` |
| Gas lamps | 34 of the town's own lamp (`props.glb gas_lamp`) on the walk, about every 27 m, on the town side; never at a gate or a stair's head. They are the town's gas lamps (`gaslamps.ts`): lit at dusk, halo, a pool of light on the stones, the nearest get the point lights and the wet streaks | `rampart.ts wallLamps`; `gaslamps.ts addDecor` takes a height now |
| Guard houses | The room inside is lit by an oil lamp: warm walls, bright at night, dark by day (`wall_room_glow`). The lanterns by the doors and at the gates (31) are gas lamps too, so they light the stones round them. All lantern glass is dull by day | `build_wall.py build_hut`; `rampart.ts update(camera, far, dark)` |
| Moat | Reed beds in stretches along the moat's walls: a bank of mud against the wall (covered at high water, bare at low) with reeds, bulrushes and sedge. Water lilies in patches, riding the tide. Sedge, long grass, a reed or a bush on the bank's edge. Never under a bridge or on a gate road | `world/rampartNature.ts` |
| Berm | Bushes and tufts in clumps at the foot of the wall; fallen leaves under every tree outside the wall | `rampartNature.ts` |
| Walk leaves | Leaves blown against the feet of both parapets, a few out on the walk, round the mills | `rampartNature.ts` |

How it hangs together: `build_wall.py` places the benches, lamps and mills and writes them into wall.glb as the
node `wall_dressing` (a JSON string in its extras: mills, benches, lamps, lanterns). `rampart.ts` reads it:
`wallColliders` (the second mill's tower, the capstan, the benches: Jef bumps into them; the walk map has only
the first mill), `wallLamps` (the lamps and lanterns into the town's gas lamps). `rijnkaai.ts` has three small
hooks for these and passes the clock's dark to `wall.update`. The plants and leaves are one small kit of painted
cards (4 plants, leaves, lily pads), mixed by seeded dice, merged per 60 m chunk and kind, and hidden past the fog
or past their own reach (leaves 55 m, reeds 150 m). The reeds sway in the wind. Nothing outside the wall is solid:
nobody walks there.

The walk map was not touched (no `plan.py`): the second mill stands on a bastion top the crowd does not use
(the Ramparts place is by the middle bastion); only Jef has its colliders.

Rebuild: `blender -b --factory-startup -P tools/blender/build_wall.py` (wall.glb, 61k triangles, 2 MB).

Checks (2026-09-25, test copy `wall`, 13:00 clear and 22:00):
- Pictures, same camera before and after: `data/shots/w2_before_*.jpg` and `w2_after_*.jpg` (mill, walk, moat,
  bastion, bank, bank2, night_walk, night_mill, night_tower); close shots `w2_close_*.jpg` (the iron bench, the
  capstan, the stage mill, reeds, lilies, low tide), `w2_after_mill2_*.jpg`, `w2_sails1_front.jpg`.
- `npm run build` passes. `paths()` lists only the three "before a corner Madonna" (known, another session).
- Colliders: the second mill, the capstan, a bench and a lamp post block Jef; the walk beside them is free.
- perf(60), same place and view, with and without: on the walk +0.5 ms for the plants and lamps and +0.5 ms for
  the setts shader on the walk (about 11 ms in all); at the Kipdorppoort +0.2 ms.
- z-fight check: no fights from the wall, its lamps or the plants and leaves. (The first run found the stage's
  underside in one plane with the string course, and leaf patches overlapping: the stage now starts past the
  course, and the leaves and lilies write no depth, so two that overlap blend. They are drawn after the ground,
  the lilies after the water.) The "thin" list still has the gate passages' floors 2 cm over the street (as
  built) and the sails' cloth close behind their lattice.
- Low water (16:00): the reed banks show as mud at the foot of the moat's walls, the lilies ride down with the water.

Open:
- Once in the test tab `landmarks.doors` went missing after its 12 s refresh, and the cathedral's update threw
  (`game/landmarks.ts updateCathedral`, not the wall); a reload fixed it.
- The walk map knows only the first mill: a crowd walker could cross the second mill's disc (the crowd does not
  go there now). A later `plan.py` run could paint it in (`rampart.py` mill disc).
