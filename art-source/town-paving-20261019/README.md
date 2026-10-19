# Town paving · 19 October 2026

Issues #170 (the paving does not follow the street) and #91 (setts smear and shear seen from low down).

## Cause

The bake laid every ground mesh with one world-mapped picture: `ground_cobble` (2,042 triangles over 146,000 m2, the
setts' picture at 3 m a tile), `ground_quay` (190 triangles, 2.5 m) and `ground_flags` (437 triangles, 4 m) all had
uv = world x, z over the tile, so the rows of setts ran along the world's x in every street; a street at an angle or
round a bend had its rows across it on the slant, and one pattern ran on through every junction. The pavements (the town
blocks' old stone, `r000209`, slab path) laid their flags on the world's x, z in the shader. The relief lit each stone
from one direction in the picture's own frame and stepped the parallax along the world's x, z: both are wrong once the
picture turns. Seen from low down the parallax drew the stones' sides with their tops' picture, stretched, and took each
sample's mip from the parallax's stepped uv, which jumps at a stone's edge: the streaks and sheared edges of #91.

## The layout (`native-godot/scripts/paving/`, `PAVE_WORK=<folder> python pave_town.py`)

- The visible paving of each ground mesh at 5 cm: the mesh's area less every permanent structure standing on it (house
  walls, raised pavements and kerbs, town wall, churches, rooms, the lock; posts and bits under 0.6 m2 left out) and
  inside the walk map's open ground.
- Its centre lines: the skeleton at 0.25 m, cut at its junctions, short spurs and junction clusters merged, the pieces that
  run straight on through a junction (within 40 degrees) joined into one street; a street that turns a corner (over 35
  degrees on its simplified line) is two streets. Each street's line is simplified (its wobbles out), smoothed over three
  half-widths, its ends run on straight past the junction along a line fitted over five widths short of it; each side's
  half width is measured on the 5 cm map (an opening bridged).
- Its rows: across the street, a conformal fan (u = -ln(1 - k t) / k across, the arc length along), so round a bend a
  stone grows a little on the outside but is never stretched one way or sheared (curvature limited to 0.35 over the
  half width plus 1 m).
- Junctions: a wide or long street claims the junction (its corridor, half width plus 0.3 m); a side street stops at the
  through street's kerb line, a straight joint. A stub of the skeleton under 4 m or 1.5 half widths is no street.
- The edge course: one row of setts (13 rows to the 3 m tile: 0.23 m; the quay's 12 to 2.5 m: 0.21 m) laid lengthwise
  along the street's general line (a step, a pilaster's foot or a post under 90 cm across filled; a recess under 60 cm
  left out; straight pieces under 6 degrees and 5 cm joined), its joints on the kerb and on its inner edge; round a kerb's
  corner it fans, in an inside corner it is mitred. It runs on under the kerb (0.5 m) so no seam shows at a kerb's foot.
- Squares: the flags' wide parts (what a 12 m box along the main frontage still covers) keep straight courses along that
  frontage, of its two right-angled ways the one nearer the old picture's (the Grote Markt along the town hall, the
  Vismarkt along the quay); the strips round them (the paths round the cathedral, the quays' pavements) run their
  courses along their line. The flags have no edge course.
- The mesh: per 16 m tile, every joint line (the edge course's inner edge and mitre lines, the corridors' edges, the
  squares' edges, a grid where a street's rows fan, at most 4 m elsewhere) is noded with the ground's own outline and
  holes; each face is triangulated (constrained Delaunay) and its corners get its patch's uv. The ground stays flat at its
  height (y 0) and keeps its exact outline and holes; out of sight under the houses it keeps the old picture.
  `ground_cobble` 286,689 triangles, `ground_quay` 25,852, `ground_flags` 9,609 (uncompressed, as the bake's).
- The pavements: each flat low triangle of the old stone (13,087; 12,615 of them within 6 m of a street edge, the rest along the world's x as before) takes the way of
  the nearest street edge in its tangent (a corner shared by triangles running two ways is split: 3,892 corners); the
  slab path turns its flags to it where the material sets `slab_turn` (r000209). The flags' joints are not set on the kerb
  (the tangent carries a way, no phase).

## Shaders (no new kind; nine kinds changed code in place)

- `Psx.ReliefGlsl`: every relief sample (height, stone map, colour after the parallax) takes the surface's own uv
  derivatives (`textureGrad`), the relief light's one world direction is turned into the uv's frame, the parallax steps
  along the view ray in uv (the world derivatives of the view-space point, so the frame holds far from the origin).
- #91: the parallax flattens as the eye comes below 1 m over the ground (`smoothstep(0.2, 1.0, eye height)`) and at a
  grazing look (`smoothstep(0.04, 0.2, view y)`); from eye height (1.62 m) it is unchanged to its 14 m reach.
- The slab path turns its flags to the tangent (`slab_turn`, off by default: every other material as before), its relief
  light and tilt in the same frame.
- `scripts/relief-repair.tscn --list` finds the town's relief and slab shaders: eight are the generator's old code and get
  its new code; three (the street setts and flags, which share one kind, and the wall gates' setts) carry the junction and
  wall-circuit repairs' weather and were merged three ways (old generator, stored, new generator: the repairs' edits put
  onto the new code). The earth, grass and town-wall grass shaders (their relief taken from the picture by the
  environment pass) are left as they were. Shader check: 150 kinds, nine replaced (baseline updated).

## Collision and walking

The ground meshes' collision is their old triangles, to the bit: the stand-in (`native_solid_stand_in`, in the old
surface's own corner order: `GetFaces` turns them and the stair-hole cut then splits them another way) with the new surface
skipped. The walk map and the quay ladders read the same stand-in (`NativeWorldNavigation.SupportFaces`): the walk map
skips faces under 5 cm2, of which the new ground has many. Before and after: Solid 3,044 shapes, 10,143,425 triangles; walk
map 583,426 support triangles, 4,986,100 free quarter cells. The town blocks' faces are unchanged to the bit (only the
old stone's surface stored again, in its old box; the others copied as stored).

## Install

`scripts/paving-promote.tscn -- --candidate <c> --record <r> --backup <outside git>` in Forward+ (`promote.json` in the
candidate lists every source file's SHA-256 and the shaders); `promotion.json` here has every original and installed hash;
the originals (42 files) are kept outside the repository and in git at the commit before this one. Never rebuild from
installed meshes: dump the originals (`dump-ground.gd`, `dump-slabs.gd`) from that commit.

## Checks

Real town, disposable saves, 2026-10-19:
- Shader check: PASS, 150 kinds (nine replaced in place, baseline updated).
- Stuck check (seed 1873, three hours): PASS, 927 watched, 0 stuck, 0 overlaps, 0 inside solids.
- Collision and walk map: identical before and after (numbers above).
- Frame time (PERF-LOCK held; another helper's game window was open, so frame times are contended and only roughly
  comparable): installed against the original ground and shaders in one session, two passes each, five views: GPU +0.09
  to +0.36 ms per view (2.82 -> 3.09, 2.40 -> 2.67, 1.39 -> 1.48, 2.75 -> 2.90, 1.90 -> 2.26), primitives +1.2 M per view
  (the ground in the depth and shadow passes), draw calls unchanged; whole frames 19-25 ms in both states (set by the
  CPU); video memory unchanged (within 6 MB).
- The generator rebuilt the installed meshes and the pavements' ways byte for byte from the original dumps.

Pictures (before: the original town; after: installed; some brightened for viewing only):
`170-close-day-brightened.jpg` (a straight, a diagonal and a bent street, a junction, a wide street, from 3 m),
`170-eye-day-rain-night.jpg`, `170-junction-wide-rain-night.jpg`, `170-squares-quay-day.jpg` (Grote Markt, Vismarkt,
Steenplein, where the setts meet the flags, the quay), `91-low-before-after.jpg` (0.3 m over the street, the quay and the
Vismarkt).

## Not done

- The dressed stone's flat low faces (steps, plinth tops, 917 m2) keep the world's grid.
- The pavements' flags are turned but not set out from the kerb (no phase), and a pavement's corner turns on its own
  triangles' edges, not on a mitre line.
- The wall gates' setts, the track setts, the Sint-Jansplein's road and the park keep their own uv (only their shaders'
  relief changed).
- A side street's rows are not phased so a row joint falls on its joint line (its first row is cut there).
