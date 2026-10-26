# Barrels, kegs and water butts · 26 October 2026

Steve: the barrel at x 84, z 170 was very low poly.

## Cause

`build_clutter.py barrel_at`: an 8-sided lathe of 64 triangles, two 8-sided hoops and an 8-sided lid in the clutter
atlas's 256 x 128 picture. 603 in the town's 28 `clutter/clutter_solid*` meshes: 298 barrels (0.8 m), 231 kegs
(0.52 m), 74 water butts (0.92 m, water 8 cm under the rim).

## Repair (`native-godot/scripts/paving/barrels.py`)

- Each old barrel (body, hoops, lid) is taken out of the clutter's surface 0 and laid again in its place and size:
  16 staves bulging to the belly, each stave its own board of the town's weathered timber (grain along the stave) and
  its own tone, a joint between staves (edges darker than the middle); four iron hoops 4 mm proud; the chime with the
  head sunk 2.5 cm (barrels, kegs) or the water 8 cm down (butts, in the old water face's picture); dirt at the foot;
  a slight lean. 672 triangles a barrel (the old 102).
- Materials `native-godot/assets/materials/barrels-20261026/`: `barrel-wood.tres` (the clutter's shader kind r000211,
  `wood-texture.res` = `environment-20261013/wall-wood.png` with mipmaps, `wood-height-texture.res` = its own grain as
  height; made by `make-wood-textures.gd`), `barrel-iron.tres` (the town's iron and its height). Both wet in rain.
- New surfaces on the same meshes; collision unchanged (support hash identical).

## Checked

Photos close (barrel, water butt) at noon. Frame rate over the whole town from 160 m up with old and new barrels,
same run settings: 55.8 and 55.2 fps (top-half mean of 16 samples): no measurable cost.
