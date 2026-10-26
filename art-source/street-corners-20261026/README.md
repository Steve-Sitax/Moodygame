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

## Second pass (#216)

The 27 corners left: 21 held a corner guard stone (0.66 m) or a cast-iron bollard (0.82 m), placed on purpose at the
corner, and one a crate; one was skipped because old map-aligned ground lay under part of its square. All stones and
bollards fit wholly on the round corner's flag, so every one got the round corner and its object was lifted onto the
flag (its triangles raised by the flag's height, the raised faces added to collision). `corner_kerbs.py --objects
<dump-near.gd> <dump-meshes.gd>` does this; flat litter and things hanging overhead are ignored. A corner needs the
square form only if its object does not fit the round flag: none here. 23 laid, 22 objects lifted (`corners-2.json`).
Left open, not street corners: inside a lean-to (-214.6, 298.9), the Carolus church's plinth (-126.7, 167.5), inside a
house (-104.2, 146.8), and a pavement width step (-128.2, 266.2). Rendered at 8 of the corners at 13:00 and two at 21:00
in rain; stretched street faces near them 0.004 m2.

## Third pass: skewed corners and a square form (26 October 2026)

Steve found two open corners (x 84, z 171 and x 40, z 152). Both were off square (73 and 105 degrees); the detector took
only 90 +- 12. `SKEW` is now 35 degrees: 31 corners found, 24 laid (`corners-3.json`). Where a guard stone did not fit on
the round flag, the corner is a rounded square instead (`SQUARE`: a superellipse of exponent 6 in place of the quarter
ellipse, its tip still rounded; the kerb, gutter, street fan and the fit test all follow it): 3 such, each stone lifted
onto its flag. Left: 4 not on the open street, 2 kerbs not measured (one a duplicate of a laid corner, one the pavement
width step), 1 the Carolus church base.

## The stones follow the curve (26 October 2026)

Steve: the texture in the corner must follow the curve, especially in the gutter. The corners' faces had taken the
nearest strip face's picture, a straight projection: the gutter's courses ran straight across the curve.
`native-godot/scripts/paving/corner_courses.py` gives every point of a corner's old-stone face its place measured round
the curve: the strip's own picture continued from the strip's end, the distance along the curve (at the point's offset
from the kerb) in place of the distance along the strip; each half of the turn continues its own strip, the halves
meeting in a joint at the middle. Flat faces (the gutter) carry the slab picture's place wholly in their uv, flagged by a
tangent standing steeply up (Psx `slab_uvm`; the slab kind r000204 rewritten in place by relief-repair, the shader
baseline updated); their tangent's level part turns with the curve so the stones' relief light turns too. The kerb's
face and arris take the strip's uv continued. The corner's flag takes the first strip's flags straight across (one
joint, on the house's corner line). 103 corners, 22 648 faces; 781 faces kept their old picture (no strip face found);
positions unchanged, collision identical (`courses-report.json`, `promotion-courses.json`).
