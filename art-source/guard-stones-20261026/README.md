# Guard stones at the house corners · 26 October 2026

Steve: the corner poles were very low poly; find how they looked and replace them with a detailed, textured model.

## What they are

A guard stone (Dutch *schampsteen*, French *chasse-roue*): a stone set at a house corner or a gateway so cart wheels
hit it, not the wall. In Belgium they were blue stone (petit granit), round or cone-shaped with a rounded head; some had
an iron ring against wear. Sources: [Guard stone](https://en.wikipedia.org/wiki/Guard_stone),
[OSM man_made=guard_stone](https://wiki.openstreetmap.org/Tag:man_made=guard_stone).

## Cause

The bake's guard stone (`art-source/tools/blender/build_clutter.py`, `guard_stone()`) was a 6-sided lathe of 48
triangles, 0.66 m high, painted from the clutter atlas's 256 x 128 picture. 56 stood in the town, merged into 21
`clutter/clutter_solid*` meshes.

## Repair (`native-godot/scripts/paving/guard_stones.py`)

- Finds each old stone in the clutter (a 48-triangle part 0.66 m high and about 0.34 m across) and takes it out of the
  clutter's surface 0.
- Lays a new stone in its place on a new surface 1 of the same mesh (1652 triangles): a round tapering shaft sunk 4 cm
  into the paving, a chiselled groove under a rounded shoulder, a low domed head. Each stone has its own small
  irregularity (2 mm), lean (up to 1 degree), size and tone, from a seed of its position; no stone is bigger than the old
  one.
- Vertex colour: dirt at the foot and in the groove, a worn band at wheel height on the street side, a washed head.
- Material `native-godot/assets/materials/guard-stones-20261026/guard-stone.tres`: the clutter's own shader kind
  (r000211, no new kind), the town stairs' jointless blue stone (`environment-20261013/stair-stone`, 1254 px) and its
  height map as the bump, wet in rain (`wet_paint` 0.6).
- Texture without stretch: shaft and shoulder in a conformal unroll (no shear, scale 0.84 to 1.24), the picture exactly
  once round so there is no seam; the head mapped from its top outwards (1.0 to 1.11 round). Worst face 1.17
  (67 of 92 512 over 1.15).
- The wall side of each stone (nearest upright house face) sets where the texture wraps.
- Collision unchanged: the promotion keeps the old surface's faces as the collision stand-in (support hash identical).

## Promotion

`stone-corners-promote.tscn -- --candidate <out> --record <record> --backup <backup>` (surfaceRepairs). The first
promotion's hashes (from the originals) are in `promotion-first.json`, the final one in `promotion.json`; two
intermediate shape passes were promoted over each other while the shape was tuned. Originals: work folder backup1.

## Checked

Game photos at Steve's corner (x -134, z 49) close, side, back, at noon, in rain and at night, and at a second corner
(x -27, z 344): round silhouette, no seam, no stretch, darker when wet.
