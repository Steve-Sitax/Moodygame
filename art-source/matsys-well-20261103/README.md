# Matsijs well — 3 November 2026

Built and integrated; **environment acceptance remains unfinished**.

- Native position retained: (-248, 0, 137.5), Handschoenmarkt by the cathedral.
- `native-godot/scripts/matsys_well.py` builds the mesh; `build-matsys-well.gd` stores it in
  `assets/models/matsys-well/well.res` and replaces 1,602 well triangles in `world/town/resources/r004940.res`.
  Other street triangles, resource references, scene nodes and placements remain intact. No editor layouts were written.
- Original shared mesh retained here as `r004940-original.res`; rebuilds always read that copy.
- 221,864 triangles: hollow square masonry base, recessed mortar, rounded coping, paired tracery relief,
  clustered rods, collars, pinnacles, scrolls, forged leaves, four small figures, Brabo, pulley and stranded rope.
- Existing native stone and iron colour/relief textures are mapped in metres, with vertex wear, splash/damp,
  restrained ferrous corrosion and separate bronze patina. This is original procedural geometry, not a copied scan.
- Stone radii 8–14 mm; rods have 2 mm chamfers; scrolls are round sections. Thin forged leaf margins remain sharp
  intentionally. Buried mortar contacts are mating surfaces. Shaft bottom is closed; no underground network is claimed.
- The square base follows the 1873 setting. Today's cylindrical basin was installed in 1901:
  https://inventaris.onroerenderfgoed.be/erfgoedobjecten/83723
  Canopy photograph consulted: https://beeldbank.onroerenderfgoed.be/images/278469/content/full
  Period photograph catalogue: https://id.rijksmuseum.nl/200620260
- Dimensions and small sculptures are interpretations, not surveyed reproductions. The base's tracery is relief;
  a faithful reconstruction of the documented pierced historic frieze remains an accuracy limitation.

Rebuild from the repository root:
`python native-godot/scripts/matsys_well.py .scratch/matsys/build`, then
`godot --headless --path native-godot --script res://scripts/build-matsys-well.gd -- ../.scratch/matsys/build`.

Checks: native resource build succeeded. Godot diagnostic front, rear, coping and low views inspected;
coping overlaps, open mortar joints and zero-length leaf-tip normals corrected. Mesh checks found no nonfinite
values, degenerate triangles or reversed winding; normal error below 0.000001 after the leaf fix.
Diagnostic pictures use StandardMaterial3D substitutes, not the game's shaders. Evidence: `.scratch/matsys/`.

Outstanding: full-town runs never reached capture (only engine/Vulkan startup in `review.log`); only this task's
test processes were stopped. Dry/rain/night gameplay, ground and neighbouring drainage junctions, generated
collision and frame cost still need verification. No overall environment pass or performance claim is made.
