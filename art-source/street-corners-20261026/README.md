# Rounded pavement corners · 26 October 2026

Steve: at house corners the pavement did not look finished (#199, footpath corners).

## Cause

At an outer house corner both raised pavement strips (flags r000016 on top, kerb arris, face and gutter in r000209) ended at
the house's line. The square between them, about 0.7 m, was street: setts ran into the notch, and the edge course fanned
round its ends.

## Repair (`native-godot/scripts/paving/corner_kerbs.py`)

- Finds every open corner from the pavement tops (`dump-pavements.gd`): 83. Lays 56. Skips 22 with crates, barrels or
  sacks standing in the gap, 4 not on the open street and 1 whose kerb could not be measured (`corners.json`).
- Measures each strip's kerb from its own cross-section (top, kerb face, gutter width and heights) and sweeps the profile
  round a quarter ellipse through both strips' lines (16 pieces): flag top, three-step arris, face, gutter in 4 stones
  (each its own slab way), gutter arris. Attributes come from the nearest strip face; the strips' gutters past the
  house's line are clipped.
- The new faces are appended to the strip's own surfaces (r000209 with tangents); the flag and kerb go into the
  collision stand-in (`stone-corners-promote.tscn`, new `solid` and `tangent` manifest options).
- The street: each side's edge course runs on to the curve, a fan round it measured along the curve (24 sectors), and
  the street field beyond. Stretched street faces near the corners after: 0.07 m2 in total, all mild.

## Checks

Rendered at 12 corners spread through town at 13:00 and three of them at 21:00 in rain; the reported corner from Steve's
view at 13:00, 18:42 and low down. Promotion support hashes: old faces kept, plus the new solid faces.
