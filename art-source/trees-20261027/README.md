# The town's trees grown again · 27 October 2026

Steve: feel free to also make trees look better, some are still ugly.

## What was ugly

The bake's four tree kinds (lime, plane, elm, bare; 545 in the town's groups, more on the new squares) were one model
each of about 500 bark and 150 to 800 leaf faces:

- crowns of 0.6 to 1.5 m cards cut from a 256 x 128 pixel-art leaf picture: a few flat blobs with sky between, the PS1
  look; far off the cut-out leaves thinned to nothing (plain mipmaps lose the alpha cover);
- thick, straight, pale limbs (stick-like, white in shade), no twigs, the same few forks on every tree;
- the bare tree: pale sticks with a few leaf clumps.

## Repair

- `make_leaf_atlas.py`: a 2048 x 2048 leaf atlas drawn here (no outside picture): sprigs of lime (heart-shaped,
  toothed; yellow-green to butter yellow), plane (five-lobed; ochre and tan), elm (oval, double-toothed, lopsided base;
  clear yellow) and fine dark twig fans (two with a last few brown leaves). Each leaf folds along its midrib, with fine
  mottling and a rare brown blotch. Mipmaps keep the leaves' cut-out cover at every level (`atlas-mips.bin`).
- `native-godot/scripts/paving/trees.py`: each kind grown as a real tree (fixed seeds): lime with a central leader and
  a dome of rising laterals; plane parting at 3.3 m into four leaning limbs; elm with five steep limbs arching out to
  a vase; bare like a lime, longer and finer, its leaves down. Branches keep their heading round the trunk; a branch
  that would leave the kind's crown is shortened into it. Bark: tapered tubes (12 / 7 / 4 sides), UVs at true size on
  the town's bark atlas (plane: its flaking half), darker toward the twigs; a flared foot with five buttress roots sunk
  25 cm into the ground. The finest twigs are in the sprig cards. Leaves: 650 to 1200 sprig cards on the last two
  orders of branches, their fronts out of the crown, normals bent out of it (the crown shades as one mass), darker
  inside and low, warmer on the sunny top in patches.
- `promote-trees.gd`: writes the 16 tree mesh resources (each kind's two or three copies), keeping each bark mesh's own
  material; one new leaf material `native-godot/assets/materials/trees-20261027/tree-leaves.tres` on the town's tree-leaf
  shader kind (r009472: sway, flutter, wet darkening; no new kind). Collision: a plain 10-sided trunk to 2.6 m
  (`native_solid_stand_in`, the tube surface skipped), as solid as the trunks were. Scene nodes, transforms, ids and
  `squares.json` untouched; the squares' copies use the same meshes.
- `godot/src/World/Trees.cs`: each tree group is drawn in 120 m pieces of the town (the groups stay, undrawn, for
  collision, falling leaves and the squares' copies), so a piece goes to the card only when it is in view.

| kind | bark faces | leaf cards | before (bark / leaf faces) |
|---|---|---|---|
| lime | 3 298 | 1 159 | 494 / 800 |
| plane | 2 344 | 787 | 500 / 536 |
| elm | 3 320 | 1 203 | 492 / 584 |
| bare | 2 940 | 650 | 416 / 144 |

Frame time (same PC, same hour, old main and this branch back to back; mean ms a frame): the wall 14.6 / 12.7 / 13.5
before, 12.7 / 11.1 / 13.0 after (climbers included); the squares 22.9 / 18.6 / 17.5 / 14.9 before, 23.2 / 18.2 /
17.0 / 15.5 after.

Atlas sources: `tree-leaves.png`, `tree-leaves-height.png` (make_leaf_atlas.py writes them and `atlas-mips.bin`).

## Round 2 · 27 October 2026

Codex's review of round 1: compact solid lobes, lime leaves too large (coarse flakes in shelves), angular junctions,
repetition between copies, little colour variation inside a crown, pointed root skirts.

- `make_leaf_atlas.py`: the lime's leaves halved to 4 to 8 cm (heart-shaped, toothed), two at a node and one between,
  on finer, more branched sprigs; plane (12 to 22 cm) and elm unchanged.
- `trees.py`: each of a kind's meshes is its own tree (`VARIANTS`: lime 3, plane 2, elm 2, bare 1): own seed, crown
  height 0.9 to 1.07, width 0.88 to 1.1 and leaves held 0.8 to 1.12 of the first. Crowns have irregular openings
  (patches of a slow 3D wave hold a quarter of their sprigs); sprigs turn more freely (fewer flat shelves); the inside
  darker, sprays leaning olive, yellow or ochre by their own chance and by the sun. Branches swell into a collar where
  they leave their parent and start inside it (no abrupt joints); bark rounder: 14 sides on the trunk, 8 on limbs, 5 on
  branches. The root flare is rounded: five soft lobes running into the ground.
- `promote-trees.gd` writes each pair from its own variant (`<kind>-v<n>`), with that variant's collision trunk.

| kind | bark faces | leaf cards |
|---|---|---|
| lime v0 / v1 / v2 | 4 306 / 3 964 / 4 626 | 1 161 / 1 156 / 920 |
| plane v0 / v1 | 2 708 / 2 694 | 675 / 616 |
| elm v0 / v1 | 3 978 / 3 608 | 1 019 / 765 |
| bare | 3 164 | 650 |
