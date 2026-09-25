# M7 the town wall and the back alleys, 2026-09-25

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
