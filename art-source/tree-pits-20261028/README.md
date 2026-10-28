# Tree pits · 28 October 2026 (#222)

Codex's review of the tree pits (2026-10-27): rigid flat weed cards, confetti leaves in an even ring, a machined frame,
the earth a flat insert, the trunks ending flat on it.

## Cause and repair

- Leaves. The bake's leaf patch (`vegetation/INST168`, one 4.2 m quad round each pit tree) was a 512 px picture of
  round blobs scattered in a ring. `make_leaf_patch.py` draws a new one (1024 px, 4.1 mm a pixel, fixed seed): lime
  leaves (heart-shaped, lopsided base, drawn-out point, toothed edge, 6-11 cm, stalk), five-lobed plane leaves (10-17 cm)
  and broken pieces (1-4 cm), each with midrib and side veins, a lit and a shaded half where it curls and a darker
  lifted rim; ochre #A17A32, brown #765035, damp brown #49372A, a little fresh yellow #B49842. About 22 % cover in the
  earth, thicker against two sides of the frame; outside, drifts along the frame's foot (45 % in the first 0.4 m)
  tapering out over 0.5-1.5 m, 3 % beyond 1.6 m. The pits are turned a quarter at a time from tree to tree, so the
  drifts lie another way at each. The picture is stored as a mipmapped S3TC texture,
  `native-godot/assets/materials/tree-pits-20261028/leaf-patch.res`, and set on the patch's own material (r004444).
- Weeds. The town's weed copies (`INST169`, 2293, and `INST170`, 426: in the joints, on the quay and in the pits) were
  three crossed cards 0.6 m wide and 0.45 m high. `NativeTreePits.WeedModel` builds each kind once at start: 7-9 bent,
  tapering grass blades 3-7 mm wide and 4-12 cm high in the weed picture's opaque olive, green and straw columns, a low
  rosette of five or six broad leaves, and (INST170) a dead stem 15-22 cm with a seed head and a tiny pale flower or two.
  Same material and picture; the blades are drawn on both sides (the material culls the back).
- Frame. The long kerbs are now two bedded lengths each; every joint is 5 mm, open to the bed; the earth side's dirt
  lies in patches.
- Earth. The flat card is now a 10 cm grid in its own material: lumps 4-16 mm up, lower along the frame, heaped a
  little round the trunk. It cannot sink under the paving: the setts' plane runs on under it.
- Roots. Each pit tree (quay and squares, 90) gets a root collar: four or five half-round roots 15-35 cm long and 2-5 cm
  proud, tapering into the earth, copies in the tree's own bark at the tree's own place.

## Not done here

- Wet matching (Codex point 5): the earth, leaf and weed materials have no wet input; making them darken in rain needs
  a shader kind change. Logged as an issue.
- The earth cannot be recessed under the paving's level without cutting the setts' plane under each pit.
