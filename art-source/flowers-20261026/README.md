# Window and door geraniums · 26 October 2026

Steve: the flowers in pots (x 58, z 170) were very low poly; make them better and replace all.

## Cause

`build_lively.py pots`: a 6-sided lathe of 28 triangles with five cube "flowers" on square stalks, in the lively
atlas. 288 in the town's 40 lively meshes (three on a sill board under shop windows, or one by a door).

## Repair (`native-godot/scripts/paving/flowers.py`)

- Each pot with its stalks and flowers is taken out of the lively surface (the sill board stays); a potted zonal
  geranium is laid in its place: a 16-sided terracotta pot with its rolled rim and soil, a rosette of 10 to 13
  scalloped leaves, 3 to 5 flower heads on stalks (each three crossed cards and one lying), scarlet (199) or pink and
  white (89); each its own turn, size and tone. About 360 triangles a pot (the old 148).
- Picture: `geranium.png` and `geranium-height.png`, drawn by `make_geranium_atlas.py` (no outside picture).
  `make-geranium-material.gd` makes the mipmapped textures and `geranium.tres` with the park plants' shader kind
  (r001171: cut out, both sides, wet in rain, relief); no new kind. The plant's foot (custom0, four floats: the
  promotion's new `custom0Rgba`) is set 1.86 m under the pot so the heads only stir a little in the wind.
- A new surface on the same meshes; collision unchanged (support hash identical).

## Checked

Game photos at Steve's window, noon, close and from the street, and in rain.
