# Plants on the bare earth · 27 October 2026

Steve: the sandy patches (the bare earth along the town wall and the houses) must have plants and trees, high detail.

## Repair (`native-godot/scripts/paving/earth_plants.py`)

- The earth is `city/ground_earth` (60 patches, 20 400 m2, mostly narrow lanes at walls). Its edges: 4.1 km against
  an upright face (walls, house fronts: `scripts/paving/dump-uprights-box.gd`, by outline; not the climbers),
  4.1 km against paving.
- At a wall's foot: a fringe two or three plants deep, the tallest against the wall, with plume grass and small box
  and privet shrubs where the earth is wide enough. At the paving: tufts in the joint. In the open: clumps where a slow
  noise says the ground is little trodden.
- Each plant is crossed cards of the park plants' atlas (grass, plume grass, daisies, blades, box and privet sprigs),
  most grasses tinted green, each its own size and tone, darker at its foot; the park plants' material (r001176), so no
  new shader kind; its foot (custom0) under the ground, so it stirs in the wind by its height.
- A new surface on each district's pavement mesh (24 city_*_3 meshes). No solid. 34 093 plants, 206 804 triangles.

## Not yet

Trees on the wide patches: the trees are instance lists filled in a rendered run (headless reads zeros); they come
with the church squares.
