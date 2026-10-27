# The church squares' mood · 27 October 2026

Steve: "Make the squares look time-appropriate with a bit of moody, grimy atmosphere." The squares round Sint-Paulus,
Sint-Jacob and Sint-Carolus are new (`../church-squares-20261027`): houses pressed against the churches were razed at
load (`NativeRazedHouses.Cut`), trees and benches planted (`squares.json`). They looked clean, empty and modern.
Codex judged them and painted targets (work folder `ScheldemistWork/mood/codex`: `critique.md` with 22 ranked changes,
`paulus_s-concept.png`, `jacob_e-concept.png`).

## What was built (`native-godot/src/World/NativeSquareDressing.cs`, `native-godot/world/town/square-dressing.json`)

Called in `NativeTown` right after `NativeRazedHouses.Dress`; `--no-square-dressing` leaves the squares as before.

- **Ground** (Codex 1, 4, 5, 12). The paving reads a dirt mask (`maps/dirt.png`: red mud and grime, green wear). It was
  baked with the houses standing, so every razed plot was "inside a block", full mud: the squares were near black. On
  the cut plots the mask is drawn again at load: a low base with noise, grime and mud along the foot of every standing
  wall and church (0.9 m), eight swept paths worn smooth and cleaner, mud where the carts stand and the pump runs. The
  street edge fades into the old mask over 1.2 m. The church plans come from `../church-squares-20261027/foot-*.json`,
  simplified to 0.25 m.
- **Bared walls** (Codex 2, 5, 13). 29 stretches of standing walls the cut houses stood against (city_build outlines;
  only houses that were really cut). The bake's own rule for September's cleared houses (`build_city.py side_wall`,
  `ghost_marks`), at runtime:
  - their facade triangles take the old brick picture (CUSTOM0 = picture 1, paint 0); corners shared with other walls
    are copied, so a neighbouring face keeps its own picture;
  - each room of the house that stood there leaves its plaster coat: 15 mm proud, a 4 mm lip, its floor and ceiling
    edges chopped ragged where the joists and ceiling came away, its ends straight where the front and back walls
    stood, split where a partition met the wall; the facade's rough plaster picture in a faded limewash per room, worn
    (kept under the wear at which the shader knocks holes: at this size they read as a black stipple); most coats broke
    off ragged at one end too; a room in six lost all of it, the ground floor's lower part is gone;
  - decals in the town's grime decal material and cells (no new shader): a thin lime film over the old house's outline
    and gable, dark bands along its roof line and every floor, the flue's soot and a fireplace's on every floor (once per
    house per neighbour), the joists' pockets every 0.4 m along each floor line, a washed scrap of wallpaper in most
    rooms, damp at the foot, one or two rain runs from the top;
  - the iron anchors of its beams at every floor line, two a stretch (a forged bar 0.55 m x 50 x 20 mm and a round boss,
    3-4 mm chamfers, the town's wall iron) with a rust run under each.
- **Things** (Codex 7, 8, 12, 15-18). One model per object, the town's own:
  - Paulus: the street kit's cast-iron pump on its stone with a pail (lively pack) and a wet patch; a handcart (the
    game's `tr_handcart`, loaded) by a heap of rubble and a stack of reclaimed bricks; a sack, straw, dung on the street
    edge; leaves against the church; the two barrels that stood on the north door's threshold (`props_dressing`
    Mesh984/985) moved to the cart as its delivery; a horse trough (laundry pack, as the streets') with the kit's
    hitching post; a guard stone at an exposed corner.
  - Jacob: rubble, bricks, a handcart, a sack pile and straw against the bared wall of house 439; a vegetable barrow
    with a basket and cabbage leaves on the north side; leaves; three guard stones.
  - Carolus: a guard stone.
  - The bricks: single bricks 0.22 x 0.105 x 0.065 m with 2 mm chamfered arrises, in courses crossing course by course,
    some crusted with old mortar, a few knocked off at the foot. The rubble: broken bricks and lime lumps on a low mound
    of lime dust and earth, its edge sunk 2 cm. Both in the facade material (smooth and rough plaster pictures in fired
    brick and lime colours), so no new shader kind; each has one box as its collision.
  - The guard stone is a copy of the town's own (`guard_stones.py`), taken from the clutter at load.

## Not built, and why

- 1 reclaimed-sett repair patches as their own stones: the mask makes the plots read as worn ground, but no laid patch
  of different setts exists. Needs a paving mesh repair (follow-up).
- 3 a connected roof-to-street drain: the pump's run-off is only drawn in the mud mask; no new gully.
- 4 puddles in real hollows: the puddles are the ground shader's noise; placing them needs a shader change.
- 6 light and coal smoke, 11 gas lamps: lighting and weather systems, not this pass.
- 9 benches: their model and places belong to `squares.json` / `NativeBenches` (another helper's file).
- 10 people at the pump and the cart: needs places in the town's population data, not a small change.
- 14 notices, 19 railings (churchyard helper's area), 20 scaffold, 21 pissoir, 22 hut: left out (optional or conditional).

## Faults found on the way

- The coats first glowed orange at night: wound counter-clockwise, Godot's two-sided shader turned their normals into
  the wall and the lit rooms behind it lit them. All new triangles now wind clockwise as seen from outside.
- Sampled at a wall cell's corner, the atlas filtering reached a lit-window cell: the coats now sample the cell's middle.

## Codex's review of the after photos (and what was done)

Done: rougher coat edges and ragged ends, no black stipple, joist pockets; the Paulus salvage bay drawn together by the
cart; the Jacob basket and leaves at the barrow; a fringe of chips round the rubble, denser rubble; the trough moved off
a shop's front. Left (other owners or a bigger job): daytime light about a stop too dark; real sett repair patches; a
drain and gully at the pump; the pump's own stone and edges (the street kit's model); Jacob's churchyard wall coping;
the Paulus north door's flat infill; a red-brown leftover behind the tree in the Paulus wall view (there before, too);
the translucent bands in the Jacob south-west sky.

## Round 2 (27 October 2026): the walls, the paving, the water

The coordinator's review of round 1: the plaster patches read as flat pale cloud-shaped stickers. Rebuilt
(`NativeSquareDressing.Room`, `Coat`), and Codex's #1, #3 and #4 added.

- **Bared walls.** The brick is worn 0.82 (the shader's own soot, streaks and damp: darker and blotched, a party wall never
  meant to be seen). Each room's coat is a field on the wall (`Room.Field`): straight along the floor (a hand over it, where
  the skirting came off), the ceiling (under the joists), the front and back walls, a partition's chase and the chimney
  breast; cut by a warped three-octave noise where it fell (more at its edges and under the ground floor's damp line). It is
  drawn by marching squares on an 8 cm grid: the face 20 mm proud, a 4 mm lip at the break, the broken face slanting 6 mm
  out to the brick (the lip a paler fresh lime, the break in its own shadow). Its picture is the town's dirty render (a room
  in four the ochre plaster), in a limewash or distemper per room (grey-ochre, faded blue-green, dirty pink, lime grey, buff,
  green-grey), low against the brick; every vertex its own grime: blotches, rain runs, the stove's smoke under the ceiling,
  the flue's soot beside the breast, dirt at its foot; over it the ghost cell's mottle multiplied dark. A gabled house's attic
  is limewashed now and then, its top the rafters' slope. The chimney breast is a sooted band of bare brick 1.2 m wide with
  the flue up its middle and a fireplace's soot on every floor. Wallpaper scraps lie only where the coat is whole round them.
- **Paving** (`square-dressing.json` `paving`, `Lay`, `Pave`). The cut houses' free edges are their old fronts. The street's
  pavement often still runs along them, so the stones go behind it, inside the plot (`GroundHeight` reads the street's own
  upward faces: setts, pavement and kerb slabs): a blue-grey plinth of blocks 0.45-0.95 m on the front's line, 12-16 mm
  proud, an 8 mm arris, one in ten taken; and up to six mended patches by each church of reclaimed setts (16-26 x 12-18 cm,
  1-2 cm earth joints, running bond along the old front, stepped course ends, each a hair turned, its top crowned 4-8 mm and
  worn round, a worn grey, warm grey, dark or sandy tone). Both in the facade material (the render picture's grain), one mesh
  per 60 m of town, no collision (stepped over). They keep clear of trees, benches and things, and of `keepOut` (the Sint-Jacob
  churchyard's south side, another helper's).
- **Water.** Hollows in the dirt mask's alpha (1 - how deep; it was 1 everywhere): half the patches have one beside them where
  the trench's fill settled, plus the pump's gully, a cart rut by the trough, the Jacob salvage and the Jacob lane. The ground
  shader's puddles fill them first, deeper with the rain, their edges broken by noise and by the stones (Psx.cs, the ground
  kind's own puddle code: no new kind; elsewhere the alpha is 1 and nothing changes). The pump's run-off goes to the street
  kit's gutter grate (`kit:gutter-grate`, lifted 12 mm: level with the street it was hidden).
- **Fault found.** A mesh's visibility range is measured to its middle: the paving, as one mesh over all the squares, had its
  middle far from every square and never showed. The paving and the walls' ghosts, coats and anchors are now one set of meshes
  per 60 m of town.

Not built: notices on the walls (#14) and a scaffold or hoarding (#20-22). Load: the dressing takes about 3 s (1 s round 1;
the street's height read takes 1 s of it).

## Checked

Game photos of every before view (13:00) and at 13:00 in rain and 22:00, before (`--no-square-dressing`) and after, in
`ScheldemistWork/mood/after` (before in `before-final`, side by side in `pairs`). Night: the new work stays dark, as the
walls before it. Route audit 0 hits. Proofs: ideas (50), homes/night (96), courtyards, shop population (96), market
pass. Shader inventory: PASS, baseline matched, no new kind. Load: the dressing takes 0.6-1.1 s. Frame rate: other
sessions were rendering at the same time, so before and after were run side by side under the same load (12 views
each): 12.2 fps before, 22.6 fps after: no cost to see (noisy). Desktop icons: 7 PASS.
