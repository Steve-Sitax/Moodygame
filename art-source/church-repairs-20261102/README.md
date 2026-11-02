# Church model repairs and the bared walls' depth · 2 November 2026

Issues #224, #227 (church model faults), #236 and #226 (the bared walls), #228 (the churchyard). The church shells are
baked meshes of the retired bake; the repairs are made at load beside them (`native-godot/src/World/NativeChurchRepairs.cs`,
`NativeSquareDressing.cs`) or in the churchyard's own generator (`native-godot/scripts/churchyard*.py`).
`--no-church-repairs` leaves the churches as baked.

## Sint-Paulus' north door (#224)

The north portal's stone reveal was closed by a plain stone back, about 0.4 m out from a flat painted arch
(`church_stpaul_4`, triangles 20-26: 2.8 m wide on the face z 248.04, sill 0.15, springing 3.52, point 5.60, seven straight
pieces): from the street it read as a filled-in arch. A pair of oak leaves now hangs in the reveal 0.5 m out from the painted
face, in front of that stone back: seven vertical boards a leaf, each its own oak tone and a hair proud or back of its
neighbour, 4 mm chamfers on every front arris so each joint reads as a V, the boards' tops cut to the arch; three forged strap
hinges a leaf, 60 mm wide, ending in a spear, a nail head every 130 mm, a pintle's knuckle at the jamb; a beaded meeting
strip, an octagonal rose with a ring hanging flat, a lock plate with a dark keyhole. The town's oak door paint
(`shutter-paint-kept`, its colour in the vertex colours as the shop fronts' church doors) and wall iron: no new kind.
Collision: one box over the opening up to the springing, in the leaves' thickness.

Found on the way: the stone back in the reveal is not in any mesh the dev ray probe (`--razed-scan-ray`) reads, so leaves
hung at the painted face drew behind it; `--razed-scan-point x,y,z` (new) lists every drawn thing whose box holds a point.

## Sint-Jacob's churchyard wall (#224, #227)

`church_stjacob_6` is the blue-stone top course (y 2.25 to 2.50) of the 0.6 m wall round the church, its top flat with two
sharp arrises. It takes a coping: saddle-backed blue stones 50 mm over each face, upright faces 60 mm with a 12 mm worn
arris, the weathered top rising 50 mm to a softly rounded ridge, ends bevelled 8 mm, 0.75 to 1.1 m long with 7 mm mortar
joints, each its own tone, the top washed paler and the overhang's underside in shadow (the wall's own `carolus_blue`
material). The long sides run past the corners, the short sides stop against them; at the gate gaps the coping stops with
its own end. 209 stones; a box a run on the wall's collision.

## The bared walls' depth (#236, #226)

Codex on #236: breaking the painted lines left the wall flat. Real depth now:

- **Joist sockets cut into the brick** (`Socket`, `Sockets`, `CutSockets`): every floor line's sockets, 80 to 130 mm wide and
  210 to 240 mm high under the floor line, 0.35 to 0.5 m apart, one in seven bricked up. Where the wall's own facade
  triangles cover a socket whole, they are cut round it (a triangle over a socket split into the convex pieces round it,
  every attribute carried over by its place in the triangle, the winding kept) and the hole lined with its sides and back
  110 mm into the brick (half a brick, the joist's bearing), its floor lighter with dust, its roof and back dark, the back a
  little smaller and off true (knocked, not cut). 361 of 447 sockets are cut; the others (over a seam or another mesh) keep
  the drawn socket. The floor line's soot film stops at each hole; no anchor stands over one.
- **Broken brick ends** where the pulled-down house's front and back walls were bonded in: every other course, about one
  brick in three across the old wall's 0.33 m standing 12 to 70 mm proud, broken and sooted like the wall (a lump now and
  then), in the facade material.
- **The coats cast their shadow**: the 20 mm plaster coats now cast shadows on the brick in the sun.
- **Bills** (#226, `scripts/bill_posters.py`, `build-bill-posters.gd`): eight printed bills of October 1873 (a public sale of
  the razed houses' materials, building ground for sale, the Red Star Line, the Theatre Royal, a lost dog, a police notice,
  labourers wanted, an old sale's scrap) in the town's Old Standard TT, aged: yellowed, soot-greyed, faded ink, rain runs,
  damp at the foot. Two to four are pasted by the street end of three walls in four, 0.95 to 2.4 m up, on the brick (3 mm
  proud) or on a coat that held, never across a coat's broken edge; each a torn outline (nibbled edge, a strip or corner torn
  away), a hair off square, overlapping. Material: the shutters' kept paint with the bills' picture (no new kind).

## The churchyard, round 3 (#228)

- **Gravel** (`scripts/churchyard_gravel.py`): the walks' own compacted gravel picture and relief, 1.3 m a tile: river gravel
  and crushed blue stone 5 to 20 mm (a few 25 mm) packed edge to edge in a matrix of grit and lime-sand dust, each stone its
  own colour, rounded or flat-sided, turned at random on a jittered grid (no rows, no direction), dust in the hollows and a
  film over every stone. Replaces the park's relief, which drew parallel ridges at a low look.
- **Leaves** (`fallen_leaf`): single leaves are now limes' (heart-shaped, notched and lopsided at the base, toothed, 50 to 90
  mm) and, one in three, planes' (five pointed lobes, 90 to 140 mm), curled 2 to 7 mm at the edge and folded on the midrib,
  with a pale midrib (and two veins on a plane leaf), a darker edge and a stalk. Fewer of them (45 a metre of drift, was 70).
- **Edge wear at walking distance** (`churchyard_kit.rbox`, `BAND`): a worn margin 45 mm wide beside every stone arris, paler
  in patches along it (the rounding alone, 8 to 15 mm, read only at 1 m); corner chips 20 to 45 mm (were 15 to 35).
- **The chapel door's lock plate** stands 32 mm proud (was 24) and is rubbed to bare metal by hands.

Triangles: the yard 462 000 (round 2: 398 000; groundcover 13 000 to 28 000, the worn margins the rest).

## Not done here

- Sint-Paulus' black wedge, Sint-Jacob's black strips and the cathedral's rough vaults (#227): see the issue report; they
  are faults in the interior shells (`ROOM_stpaul` gh_white/gh_vault, `ROOM_stjacob` gh_vault slabs, `ROOM_cathedral`
  ct_vault) that need a model rebuild, not a load-time patch.
- Sint-Carolus' gold strip (#225): the pilaster beside the left apse window (`church_carolus_7` triangles 60709/60713) has the
  same uv density as the wall round it (0.28 a metre both ways); the streaked look is not a stretched uv. Cause open.

# Round 2 · 2 November 2026 (helper C2-church)

## The vaults' webs (#227)

The bake drew every vault web as a height grid over the plan (cells 0.6 to 1.2 m), each cell cut into two triangles on
one diagonal. Every block of the grid is a groin vault: its height is max(A(z), B(x)), two pointed barrels crossing,
each profile a run of circle arcs from the piers and walls. The groins run across the cells, so the cells cut their
corners: the steps and saw teeth along every rib. `native-godot/scripts/vault_webs.py` reads the shells
(`ChurchShellDump.cs`, `church-shell-dump.tscn`), finds each rectangular block, fits its two profiles (circle arcs,
residual under 12 mm, else a monotone cubic through the samples; the bake's samples kept exactly), refines them to
8 degrees or 0.8 m a step and builds every cell cut along its own groin, so the groin is an edge with both sides exact;
runs of cells on one barrel are merged into strips; where two blocks meet with different breaks every open edge takes
its neighbour's corners (no crack). Normals from the arcs (smooth along a barrel, sharp at the groin), uv along the
barrel at the bake's 0.333 a metre. `VaultWebRepair.cs` (`vault-web-repair.tscn`) lays the result into the stored
meshes; it refuses a surface whose triangle count is not the plan's source.

| Mesh | Before | After |
|---|---|---|
| Sint-Jacob `r007002` (gh_vault) | 5 712 | 15 817 |
| Sint-Paulus `r006899` (gh_vault) | 4 968 | 11 442 |
| Cathedral `r005901` (ct_vault) | 6 285 | 42 434 |
| Cathedral `r006056` (ct_vault) | 432 | 3 992 |

To make it again: `godot --headless --path native-godot res://scripts/church-shell-dump.tscn -- --out <dir> --roots
node-09897,node-09812,node-08900`, then `python scripts/vault_webs.py <dir>/node-09897.txt <plan> Node643/Mesh1617` (and
`Node626/Mesh1564` for node-09812, `Node451/Mesh1140,Node451/Mesh1178,Node451/Mesh1181` for node-08900), then
`res://scripts/vault-web-repair.tscn -- --root node-09897 --plan <plan> --record <dir>`.

Note: the church halls' walls and furniture are drawn from `world/interiors/room-*.structure.tscn` and
`room-*.objects.tscn` (the room meshes listed in a room's ReplacedMeshes are hidden); the vaults are still the rooms'
own meshes.

## Sint-Carolus' gold strip (#225)

Not a stretched uv on the strip (round 1 was right): two faults together.
- The relief (bump) pictures of 37 town materials were stored upside down against their colour pictures (the joints
  of the relief matched the colour's only when flipped: edge correlation 0.71 to 0.99 flipped, -0.26 to 0.69 as
  stored): all church exteriors, the cathedral's, the Steen's, the Vleeshuis', the town hall's, the park's stone and a
  few house materials. `ReliefFlipRepair.cs` (`recovery/relief-flip-20261102.json`) turns them.
- In a low sun the relief a pixel cannot resolve sparkled far off: the sunlit pilaster beside the left apse window read
  as gold streaks from 25 m. The churches' 13 reliefs have their smaller mip levels flattened toward their mean (1, 1,
  0.6, 0.35, 0.2, then 0.1): up close the relief is as drawn, far off it no longer sparkles. No shader changed.
- The parish churches' rounded arrises and narrow faces had their picture squeezed up to 170 times (a bevel's corners
  took the uv of the two faces it joins): `SqueezedUvRepair.cs` maps 339 000 such triangles again flat at their surface's
  own scale (geometry unchanged).

## Sint-Paulus' black wedge (#227)

Not a hole and not a normal: the outside aisle roof (`church_stpaul_2`, slate) dips up to 0.44 m into the first aisle
bay by the transept (x 100.8 to 102.7), under the aisle vault; from the nave its dark underside showed through the
arcade's arch as a black wedge. `vault_webs.py` takes the exterior dump and holds every web point 5 cm under any outside
face that cuts into the web by up to 0.6 m (346 corners in that bay); the vault then hides the roof.

## Sint-Jacob's black strips (#227)

The side chapels' flat ceilings carry oak joists (46 `room-st*-source-9906/98xx` fittings at 7.5 m) in the darkest oak
(`cb_oak_plain`): under the white ceiling they read as black strips. They take the town's carved oak (`cb_oak`, a third
lighter, the same shader kind).

## Sint-Paulus' north door (#224)

The plain stone back round 1 could not trace is the church hall's own north wall: its outer face (ROOM_stpaul `gh_wash`,
z 247.56), with the Lady altar's marble back right behind it; the painted door arch (z 248.04) stands inside the hall
behind that wall. So the doors already hang at the back of the real reveal (brick face 247.14 to the wall 247.56), 2 cm
off it; only the notes in `NativeChurchRepairs.cs` changed.

## Leftovers of round 1

- The pale strip on the churchyard grass by the chest tomb: two pieces of `pavement-mends.json` (a flag and a kerb face) laid
  inside the paving plan's keep-out box (the churchyard's south side). `NativeSquareDressing.Mend` now skips the keep-out
  boxes (a small change in A2-ground's area).
- Coping corners: the short sides' copings run on into the long ones to their ridge, so the two saddle tops meet in one
  seam (they stopped 5 mm short, the end bevel standing over the long stone's edge).
- Bills: 1.55 times larger (0.53 to 0.68 m wide, 0.74 to 1.09 m tall; the lost-dog handbill 1.15 times), the same
  pictures.
- Dev: `--whatpick fx,fy;...` in a snap run lists the nearest drawn triangles on that pixel's ray (node, material, triangle,
  front or back, layers).

# Round 3 · 2 November 2026 (helper C3-squares)

## Life on the church squares (#221)

- **Markets**: three new fields in `services/data/native-extras.json` (`sint_paulusplaats`, `sint_jacobsmarkt`,
  `conscienceplein`), each with its own pitches like the Grote Markt's: 5, 4 and 2 stalls, sellers `pp_seller_N`,
  `jm_seller_N`, `cp_seller_N` (NativeTownMarketPopulation: a woman from a house nearby, her handcart, her own dice per
  market), hours 6:30 set-up, 8 open, 12:30 packing, 13:00 packed, Monday to Saturday (`NativeMarketCalendar`, and the
  engine refuses a sale outside each market's own hours: `NativeTradeLedger`). Planned with the pitch planner on rows
  between the square trees (`--market-proof-only pitchplan@<place>`, `pitchspots@<place>`: a stage may now name its
  market after `@`, so one run plans several), the sellers' and carts' places corrected by `pitchspots`.
- **Gathering places**: `NativeTownSquaresPopulation` adds the three squares (and `market:<id>`) to the town's places
  once (new game and old saves: world key `church-squares-v1`; the original town generation and its fixtures are
  unchanged) and moves the gossip, loitering, Sunday strolls and play of up to 12 neighbours a square, and the morning
  marketing of up to 10, from a farther old square to the church square.
- **Events**: a template may list other places (`places` in `native-director.json`): street musicians (Steenplein,
  Sint-Jacobsmarkt or Conscienceplein) and the market quarrel (Grote Markt or Sint-Jacobsmarkt) are played at one of
  them by the dice when the engine plans them; their stages, title, notice and rumour name that place. The director's
  own choice stays. Dev: `--eventtest <dir> --eventonly musicians --eventplace sint_jacobsmarkt`. Not the
  Sint-Paulusplaats: its strip between the church and the houses opens only at its two ends, and the event check's
  crowd (from up to 45 m round) was still walking there when it looked (1 of 30 arrived; 10 on the Steenplein).

## The gully sunk (#226)

`NativeGully.cs`, square-dressing kind `gully`: the street's ground (drawn and its solid stand-in) is cut over a square
0.8 m round the kit's gully grate and laid again in 8 cm cells, each corner taking the cut ground's own uv, colour and
custom channels at its place (no seam, the ground's material), lowered 40 mm at the grate and rising to the street over
0.8 m (steepest by the grate). The kit grate (one model everywhere, its gully pot below) sits at the bottom; the ground
no longer runs under its bars. Collision: the dish's triangles and the grate's top.

## The builder's scaffold (#226)

`scripts/scaffold.py` + `scripts/build-scaffold.gd` → `assets/models/scaffold-20261102/scaffold.tscn` (one model; kind
`scene:` in square-dressing.json), against the bared wall 210/187 at the Sint-Paulusplaats' west end: three fir
standards on sole boards 1.3 m out, ledgers at 1.95, 3.75, 5.55 m and a tie at 7.1 m, squared putlogs into putlog holes
in the brick, boarded second and third lifts (deals butted over a putlog, staggered), two loose boards on the first, a
guard rail, a long brace and a pole ladder; square lashings of hemp rope at every crossing. Edges: sawn pole ends eased
12 mm, deals and putlogs chamfered 2 to 3 mm. The town's board wood (barrel-wood.tres) and the rope picture in the same
material (scaffold-rope.tres: no new kind). 20 252 triangles. Collision: a cylinder a standard, boxes for the sole
boards, the boarded lifts and the ladder.

## Climbers (#219)

`world/town/wall-climbers.json`, `scripts/paving/wall_climbers.py` (climbers.py's own `grow()`; the faces dumped by
`scripts/paving/dump-near-any.gd ... city`; no run over a coping: a house's top is its eaves), built by
`scripts/build-wall-climbers.gd` into `assets/models/wall-climbers-20261102/` (the town wall's climbers material).
Three bared walls by the squares, at their far end from the street (the bills stay clear): Sint-Jacob's east party
wall (447/446: ivy and red creeper), the one north-east of it (444/445: creeper turning orange) and the Conscienceplein's
(899/900: ivy); 31 514 triangles. The stems stand 30 mm off the dumped brick (the coats drawn at load are 20 mm proud).
Found on the way: the plan's non-street edges are not blank walls (the first three picks had shop fronts and windows):
choose walls from pictures.


# The cathedral towers' openings (#260) · 2 November 2026 (helper T-towers)

Steve's photo of the west front: the towers are not see-through. The shell (the retired bake's `_real_stage` and the
octagon in build_landmarks.py) cut every tall opening through with a reveal, 1.0 m deep on the square stages and 0.6 m on
the octagon; the native shell has no stone mullions or transoms in them (the bake's `m.d` detail did not come over).
`native-godot/src/World/NativeCathedralTowers.cs` fills them at load, from the bake's own numbers (world x = -262 + v,
z = 145.53 + u; cells `tower_lancets` (17/69, 30, 42, 222 of 128 x 256, springing 0.8) and `openwork` (9, 20, 46, 106 of
64 x 128, springing 0.76)). `--open-cathedral-towers` leaves them open, as baked.

| Level | Openings | Fill |
|---|---|---|
| North tower, stage 1 (18-35.3 m) | 3 faces x 2 lancets (the face to the nave is inside the west bay) | grating |
| North tower, stage 2 (36-54.8 m) | 4 faces x 2 (the face to the nave over the west roof's eaves, 40.15 m) | grating |
| North tower, bell stage (55.5-73.3 m) | 4 x 2 | louvres |
| North octagon (74-93.5 m) | 4 over the clocks, 4 on the diagonals | louvres |
| South tower, stages 1 and 2 | 3 x 2 and 4 x 2 | grating (the photo: the pale grid at the same height as the north tower's) |
| Open upper octagon, crowns, south lantern | | open |

- **Grating**: in the reveal 0.61-0.70 m back: a 60 mm flat round the outline (inset from the reveal), upright flats
  45 x 70 mm about 0.5 m apart, cross flats 45 x 50 mm about 0.68 m apart (the photo's tall panes) 15 mm behind the
  uprights' faces, 3 mm chamfers on the front arrises. The shutters' kept paint in a pale grey (vertex colours), each flat
  its own tone, darker toward the sill. Behind it at 0.93 m the tower's wall in the cathedral's ashlar at its own scale
  (0.3125 a metre), 6 cm into the reveal's sides; small windows 0.40 x 0.72 m low in each light and 0.42 x 0.66 m in the
  arch head: a 12 mm chamfer, carved-stone reveals 0.13 m deep at their own scale, a sill weathered out, the houses' glass,
  an iron cross of glazing bars.
- **Louvres (abat-sons)**: a frame just behind where the mullion would stand (stiles 0.10 m along the outline and over the
  arch, one in the middle), boards 28 mm thick at 42 degrees reaching 0.30 m back (0.19 m on the octagon), each over the
  next (no sight line through), cut to the arch at their tops; the shutters' paint in weathered dark oak, each board its
  own tone, tops bleached, undersides dark. The bake's lead louvres (308 triangles of `landmark_cathedral_3`) are taken
  out where the new fills stand.
- 50 580 triangles; six surfaces in five existing materials, no new shader kind, no light, no collision (none in the shell).
