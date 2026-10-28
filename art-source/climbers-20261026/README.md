# Climbers on the town wall · 26 October 2026

Steve: the vines on the city walls looked very fake; make them realistic, high detail; natural, not square spots.

## Cause

The bake's climber was one flat card, 3 to 5 m wide and up to 6 m high, in a 128 x 256 picture: 144 of them on the
town wall in 13 `wall_climbers_*` meshes (288 triangles in all).

## Repair (`native-godot/scripts/paving/climbers.py`)

- Each card is replaced by a plant grown where it stood, its kind the card's: common ivy (73), Virginia creeper in
  autumn red (45) or turning orange (26).
- Roots in a clump or two; woody stems climb in a random walk about the upright, branching to the sides and thinning;
  each stem its own height, a few long runners; the plant's reach fans out as it climbs and wavers at its edge
  (no card outline). Every point sits on the wall's own face (a ray onto the wall: the plinth stands proud of the
  brick above it), stems 1 cm off it as bark ribbons.
- Along the stems, sprays of leaves (2048 x 2304 atlas drawn by `make_climber_atlas.py`: ivy in two greens, creeper
  red and orange, bark) standing 2 to 10 cm off the wall, tilted out and up, turned with the stem; ivy lighter above.
- Material `native-godot/assets/materials/climbers-20261026/climbers.tres` (made by `make-climber-material.gd`): the
  park plants' shader kind (cut out, both sides, wet, relief); no new kind. The plant foot (custom0) is set per corner
  so the leaves only shiver a little in the wind.
- The wall's faces are read with `scripts/paving/dump-near-box.gd` (by outline: the brick faces are long).
- 134 257 sprays, 401 478 triangles. Frame rate along a climber-hung wall about 65 fps.

## Long runs · 27 October 2026

Steve: vines can also stretch longer distances vertically; make them look more natural, do placement and see if it
looks good. They were 1 to 3 m bushes at the wall's foot.

- Each plant finds the wall's top straight behind its foot (7.5 m on the town wall) and takes a height from it: 52 of
  the 144 reach the coping, most stop between 0.6 and 0.9 of the wall, a few young ones at 2 to 3.5 m (median 6 m).
- Four to seven woody stems (ivy; three to six creeper) from one clump, their aims spread across the fan, so the
  stems part in a V from the root; the fan widens to 2 to 5 m in its lower half, its edge wavering and ragged (side
  shoots run past it before turning back); creeper runners arch sideways. The foot is bare of leaves for 0.25 to
  0.8 m; leaves are thickest mid-run and thin toward the top and edge, with thinner patches where brick shows.
- Plants at the coping spread along under it, and strands hang over it 0.3 to 1.1 m in front of the wall; a few
  creeper runners stand up into the air above it.
- Sprays lie flatter on the wall (ivy 5 to 20 degrees out, creeper 10 to 30), a little larger, spread between the
  stems. 144 182 sprays, 486 386 triangles (before: 134 257, 401 478). Placement: the bake's 144 places are kept (ids
  and nodes untouched); the varied heights and widths leave bare brick between plants.

## Wall-clinging growth · 27 October 2026 (round 2)

Codex's review of round 1: the plants still read as upright shrubs in front of the wall (bare stems holding oval
crowns, sprays tilted out), the leaves as tiny noise, the two kinds as separate colour blocks.

- `make_climber_atlas.py` redrawn at true size: ivy shoots (0.36 m cells) with alternate three-to-five-lobed leaves
  4 to 8 cm wide (#243B2A, #293D2D, #40543A, veins #788164), tips hanging down; ivy mats (0.6 m cells, a knot of
  shoots); Virginia creeper runners (0.45 m cells) with compound leaves of five separate serrated leaflets 5 to 10 cm
  long in burgundy #6B2531, crimson #8F3032, red #A64032, orange #BC6938, brown #70503A and a few dull green; branched
  tendrils with adhesive pads; moss for the root joint and fallen leaflets; the bark strip; a strip of aerial
  rootlets. Mipmaps keep the leaves' cut-out cover (`atlas-mips.bin`, read by `make-climber-material.gd`), so from
  20 m the ivy stays mats and the creeper tracery.
- `climbers.py` rewritten. The wall behind each colony is read once into a 5 cm depth grid (rays onto the
  `town_wall/` faces only), so every stem and leaf lies on the real plinth, brick, band and parapet and is carried over
  each step. Three to seven woody leaders (1.8 to 5 cm at the foot) rise as a bundle from the joint at the wall's foot,
  part low down and run 4 to 7.5 m up, each its own length; unequal side branches (the creeper's long and thin, the
  ivy's shorter and denser) and twigs. Stems are half-rounds of bark proud of the wall (three, two or one faces by
  thickness); under the ivy's a fringe of rootlets; along the creeper's tendril pads flat on the brick. Leaf cards lie
  nearly flat on the wall, 4 to 15 cm off it (ivy bulges to 25 cm), two layers where the ivy is thickest; density highest
  low and in the middle, thinning to ragged tips, with holes the size of a few bricks and larger gaps. Half the
  colonies carry leaders of the other kind (creeper threading through ivy, ivy at a creeper's foot). 62 % reach the
  coping; about 30 % of those leaders run over its top and trail 0.3 to 0.8 m down its far side (rays down onto the
  cap, then from behind onto its inner face). Each colony its own width (0.6 to 1.35); a young plant beside a
  colony now and then (54 recruits). At the root, moss in the joint and fallen leaves on the paving.
- 144 colonies plus 54 recruits, 116 905 leaf cards, 494 458 triangles (round 1: 144 182 sprays, 486 386). Bake places,
  ids and nodes untouched; the climbers are still no solid.
- Not changed here: the dark base of the wall's plinth (the town wall's own material) and the small weed tufts along the
  pavement (another asset). The colonies' roots now carry their own moss and leaf litter.
- Frame time (same PC, round 1 and round 2 back to back, mean ms a frame; round 1 three runs, round 2 two, one
  hitched run left out): the wall close 14.5 / 14.0, the wall front 14.3 / 13.4, along the wall 16.9 / 15.5; the
  squares 26.1 / 24.8, 24.6 / 21.3, 22.4 / 18.7, 18.6 / 16.8 (trees included). A first, denser cut (135 433 cards,
  16-sided trunks) cost 2 to 3 ms at the wall and 3.5 ms on a square; it was thinned to this.

## Fuller columns, red creeper · 27 October 2026 (round 3)

Review of round 2: the wall was 65 to 75 % bare and the plants read as thin streaks; the creeper had gone dull brown-red;
the ivy read nearly black in shade; from the front some plants still stood as upright bushes.

- Cover. Leaves were piling up on the stems at the wall's foot (a bush there, thin above). Now fewer leaves at the
  foot and more up the middle of the run; mats chosen for cover; more leaders (five to eight ivy, four to six creeper)
  rooted along a joint 1 to 3 m wide; the leaves of a strand spread a little across it. Straight on, the leaves
  now hide about 35 % of the wall face where plants grow (round 2: 15 %, same measure, 0 to 7.5 m up); in the eye-level
  views about 45 to 60 % of the wall stays bare brick.
- Shape. Side runners level or slanting up at any height, the low ones sending up shoots of their own; tall bare lanes
  between strands (noise stretched up the wall); the colony's edge eaten away unevenly and its mass wandering off the
  root's line as it climbs; leaders of unequal reach, so the top ends in several tips; ivy bulging off the wall only
  mid-run. A colony now reads as a ragged column, not a crown on a narrow foot.
- Creeper. Scarlet #B8322A added beside crimson #8F3032 and burgundy #6B2531; orange #BC6938 in patches (spatial
  noise), little brown; a creeper colony takes an ivy companion one time in five (was one in two), so whole red runs
  show from 20 m. Two atlas cells now carry two runners in full leaf (more cover per card); each creeper cell is drawn
  in its own picture so no leaf reaches into the cell above.
- Ivy. The vertex shade no longer darkens it (0.75 to 0.85 before, now 0.94 to 1.02); young leaves near a shoot's tip
  a little lighter with a pale margin #808E5C; the lit half of a leaf brighter. Base colours unchanged (#243B2A,
  #40543A).
- Cheaper stems: bark points every 24 cm (was 16), three faces only on stems over 4.4 cm, rootlets on every fourth
  segment, fewer tendril cards. 144 colonies plus 43 recruits, 329 837 cards, 923 366 triangles (round 2: 116 905 cards,
  494 458 triangles). Bake places, ids and nodes untouched; the climbers are still no solid.
- Frame time (same PC, rounds 1, 2 and 3 in turns, two passes, mean ms a frame; other test sessions shared the PC, so
  only the comparison counts): the wall close 13.6 / 12.4 / 13.2, the wall front 13.5 / 13.5 / 12.4, along the wall
  14.5 / 14.0 / 13.3; the squares 25.3 / 23.7 / 21.5, 20.9 / 18.7 / 18.7, 17.5 / 17.7 / 16.2, 15.6 / 15.7 / 15.2 (trees
  included). At or under round 1 everywhere; the wall close about 0.8 ms over round 2.

## Uneven placement · 28 October 2026 (round 4, #231)

Codex's review of the cleared squares' photos: the ivy and creeper colonies repeated at very regular spacing (the awning
and Sint-Jacob wall views). Each colony still stood at one of the bake's 144 card places, evenly spaced along the wall,
and was about as wide as the next: a row of planted shrubs.

- Each card's place now has its own dice, apart from the plant's: one in five is left bare brick; the others root up to
  1.5 m along the joint from the card's middle and spread 0.55 to 1.6 times as wide. Runs of plants, gaps and single
  columns alternate unevenly; the young plants beside a colony follow its new root.
- 114 colonies plus 22 recruits, 257 587 cards, 725 146 triangles (round 3: 144 plus 43, 329 837 cards, 923 366
  triangles). Promoted with `scripts/stone-corners-promote.tscn` from the saved card dump; support faces identical
  before and after reload; ids and nodes untouched; the climbers are still no solid.
- Frame time in the two wall views (same PC, mean ms a frame, before / after; the before run shared the PC with
  another test, so only "not worse" is claimed): the awning view 12.4 / 11.8, the Sint-Jacob wall 12.6 / 11.7.
