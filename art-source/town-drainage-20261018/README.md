# Town drainage · 18 October 2026

Issue #163 (town fabric step 2). The town's houses had no drainage: no downpipes, brackets, shoes, gullies or street
channels, and the gutters were flat stone boxes in the near-detail meshes (`city_*_d_*`), which the native game never
draws. The dark box under each eave that reads as a gutter is the eaves moulding; it stays.

## What each house got

`houses.json` lists all 1053 standing houses and what each got. 1028 drain somewhere. The other 25 have no eave on a
street or yard: backs inside a block, or their only street wall is a gable end or a short cut corner. Three walls of
houses that drain elsewhere had no eave the tool could measure (`notes` in `houses.json`).

- Gutters (1117): half-round cast iron, 125 mm (100 mm on alley cottages, 150 mm on storehouses), 4 mm shell, a rolled
  bead on the front lip, a rounded back rim, sockets every 1.83 m, stop ends, a strap hanger about every metre hooked over
  the bead, falling 1:250 to the outlet. Under a roof's eave the eave's edge laps a third of the gutter (667); on a
  cornice the gutter hangs on its front edge, below its top (314, mitred where two cornice gutters meet: 40 corners); on
  an eave with no overhang it stands just off the wall top (136). Where a loft, dormer or taller wall stands on the line,
  the gutter stops and each free stretch is its own gutter.
- Downpipes (1526): 75 mm, hollow at the mouth, a swan neck from the outlet back to the wall, sockets with cast lugs on
  spacers every 1.5-2 m, a shoe at the foot. 531 of them come from rainwater heads: the valley between two gables drains
  through the wall at the gable's foot into one head and pipe for both houses. A pipe line must be clear wall from the
  eaves to the pavement (rays against every mesh near the block: no window, door, sign bracket, lamp arm or moulding over
  6 cm), at least 0.9 m from another pipe (0.5 m between two alley cottages), and 1 m off a gable neighbour's party line.
- At the foot: on a raised pavement (607) a ribbed cast-iron channel plate across the pavement, a grated receiver under
  the shoe and a mouth in the kerb's face into the street gutter; one grated street gully every 10 m along a street
  gutter takes it. Elsewhere a grated gully under the shoe (279), or the shoe onto the ground (109) where the ground is not
  level. 868 gullies are new Ruien inlets in `native-godot/world/town/drainage/ruien-inlets.json`.
- 74 gutters run on into their neighbour's gutter and pipe (a row of equal eaves). 44 gutters with no clear wall for a pipe
  have a spout that throws the water clear, and 11 gable valleys a bare lead spout.
- The game's broken-gutter streams (Gutters.cs, 50 in town) now fall from 31 broken gaps in gutters and from bare spouts.
- Stains: two thin rust streaks from each pair of lugs, a damp streak down the wall behind the pipe and splash at its
  foot, all on the town's grime decals, as strong as the house's own grime.
- The house by the 2026-10-13 junction keeps that repair's gutter and pipe on its east eave; nothing is added there.

## Materials, collision, the meshes

The iron is the junction repair's iron material (`r000615`): rain darkens and glosses it; no new shader, no lights.
Vertex colour varies it per house and rusts the sockets, lugs and joints with the house's wear; each vertex carries the
house's colour alpha, so a razed house loses its drainage (`NativeRazedHouses`). The new iron is one surface added to each
block's visible stone mesh; Solid skips it and takes plain boxes instead (each pipe a column, each gutter its old box,
heads and receivers); plates and gullies are flat and walkable. The old gutter boxes and their collision boxes are taken
out of the hidden near-detail stone meshes. Scene nodes, transforms and permanent ids are unchanged.

The decal shader is unshaded (its colour does not follow the wall's light), so the stains are darker than any wall in
shade; a lighter stain glowed in a shaded street. This holds for the town's older grime decals too (not changed here).

## Checks (real town, disposable save, 2026-10-18)

- Whole-town candidate in memory against the installed town, same session: GPU +0.12 to +0.42 ms per view with 4.8 M
  triangles; the installed version has 3.6 M. Frame time unchanged (the frame is set by the CPU, about 14-19 ms in the
  measured views). `run-011` in the proof folder.
- Installed against main (two sessions): video memory +165 MB; mesh files 166.8 MB to 228.6 MB (+62 MB).
- Collision: 9,732,432 triangles to 9,692,998, 3,006 shapes, built in 8.0-9.5 s. Two load-time cuts dropped a mesh's
  collision lists when they rebuilt it, so its fine stone counted whole: the razed-house cut (`NativeRazedHouses`, which
  now also drops a razed house's collision boxes) and the Werf steps cut (`QuayNotch`, which also cut everything above
  the steps, a gutter 13 m up included; it cuts below 1.5 m now). Both keep the lists now.
- Pictures: `before-after-*.jpg` (candidate against main, day, rain, night), `installed-werf-rain-night.jpg` (installed),
  `candidate-feet-day-brightened.jpg` (pavement feet at 13:00, brightened for viewing only: the streets are dark there).

## Rebuild

`audit-gutters.gd -- <folder>/<chunk> <chunk>` for each `city_*` chunk, Blender `repair-gutters.py -- <audit> <chunk>
<candidate>` for each chunk in turn into one candidate folder (`shared-state.json` carries pipes, heads and gullies across
block edges), `merge-gutters.py <candidate>`, review with `check-stone-corners.ps1 -Candidate`, then
`gutters-promote.tscn -- --candidate <c> --record <r> --backup <outside git>` in Forward+. The promotion refuses changed
sources and existing backups. `promotion.json` has every original and installed SHA-256; the originals (82 files,
167 MB) are kept outside the repository and in git at the commit before this one. Never rebuild from installed meshes.

## Not done

- Pipes keep one standoff from eaves to foot; a band or sill over 6 cm makes the line unusable, they do not crank round it.
- Weeds and goods copies at a wall foot are not seen by the foot check; a gully can sit in a tuft.
- No zinc flashing over a cornice top; the water runs over the stone into the gutter.
- The near-detail meshes (`city_*_d_*`: sills, shutters, bands, a third of the dressed stone) are hidden in the native
  game; nothing re-shows them (found here, not changed). In block city_-1_2 that is 202,000 of its 343,000 dressed-stone
  triangles.
