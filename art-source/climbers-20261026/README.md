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
