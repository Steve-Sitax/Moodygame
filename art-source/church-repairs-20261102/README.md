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
