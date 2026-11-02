# Pit trees' root flare · 2 November 2026 (#248)

Since #239/#243 `NativeTreePits.RootModel` built each pit tree's root flare in code: a height field on rings round the
trunk with five to seven uneven roots. Its bark picture was laid by angle round the trunk and path length out from it,
so on the swell's flanks and the roots' steep sides one texel ran over several centimetres: the bark smeared near the
trunk's foot (Codex, jacobfoot2).

Now one authored model serves every pit tree:

- `make_root_flare.py` (Blender 5.2, headless) builds the same kind of shape for a round trunk of 0.32 m (fixed seed),
  starting inside the trunk's foot at 0.84 of its radius so a lumpy trunk shows no lip. The surface is cut into one wedge
  per root, the cuts in the lowest column between two main roots (mostly under the pit's earth); each wedge is
  unwrapped with Blender's minimum-stretch unwrap, scaled back to true size, then turned (Procrustes, fitted most closely
  near the trunk) so u runs round the trunk and v down the trunk and out along the root, and kept inside the bark's one
  turn of picture. Normals are the whole field's, smoothed before the cut, so the cuts show no light seam.
  Texel area against true area per face: p5 0.92, median 1.00, p95 1.14. 2,095 quads.
  `blender --background --factory-startup --python make_root_flare.py -- <out folder>` writes `root_flare.glb` (kept
  here) and `root_flare.blend`.
- `import_root_flare.gd` turns the glb into `native-godot/assets/models/root-flare-20261102/root_flare.res` (uv: turns
  round the trunk, metres down from the 0.2 m join; no material):
  `godot --headless --path native-godot --script <full path>/import_root_flare.gd -- <glb> res://assets/models/root-flare-20261102/root_flare.res`
- In the game `RootModel` scales it to each bark model's trunk radius (0.295-0.344 m), turns it to that bark's seam
  (mirrored if its picture runs the other way), lays the uv on the bark's own picture (u0-u1 a turn, v = va + vb y as up
  the trunk) and darkens it toward the earth. Same material and multimesh sets as before; not solid.

Edges: the roots are rounded wholly (no arris); the ends sink under the earth.
