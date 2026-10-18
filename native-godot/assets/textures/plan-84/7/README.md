# Issue 84, row 7: picture handoff

Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.
Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.

`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).
`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.
Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.
Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.

| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |
|---|---|---|---|---|
| `muck_0_*` | 512 x 512 | 1.6 x 1.3 | `litter::lt_decal` | `tiles/7/muck_0_3x3.jpg` |
| `muck_1_*` | 512 x 512 | 2.2 x 1.4 | `litter::lt_decal` | `tiles/7/muck_1_3x3.jpg` |
| `muck_2_*` | 512 x 512 | 1.1 x 1.0 | `litter::lt_decal` | `tiles/7/muck_2_3x3.jpg` |
| `dungflat_0_*` | 512 x 512 | 0.45 x 0.4 | `litter::lt_decal` | `tiles/7/dungflat_0_3x3.jpg` |
| `dungflat_1_*` | 512 x 512 | 0.6 x 0.45 | `litter::lt_decal` | `tiles/7/dungflat_1_3x3.jpg` |
| `straw_0_*` | 512 x 512 | 0.8 x 0.8 | `litter::lt_decal` | `tiles/7/straw_0_3x3.jpg` |
| `straw_1_*` | 512 x 512 | 1.1 x 0.7 | `litter::lt_decal` | `tiles/7/straw_1_3x3.jpg` |
| `urine_0_*` | 512 x 512 | 0.9 x 1.3 | `litter::lt_decal` | `tiles/7/urine_0_3x3.jpg` |
| `urine_wall_*` | 512 x 512 | 0.6 x 0.55 | `litter::lt_decal` | `tiles/7/urine_wall_3x3.jpg` |
| `oil_0_*` | 512 x 512 | 1.4 x 1.1 | `litter::lt_decal` | `tiles/7/oil_0_3x3.jpg` |
| `tar_0_*` | 512 x 512 | 1.0 x 0.8 | `litter::lt_decal` | `tiles/7/tar_0_3x3.jpg` |
| `tar_1_*` | 512 x 512 | 0.7 x 0.7 | `litter::lt_decal` | `tiles/7/tar_1_3x3.jpg` |
| `soot_0_*` | 512 x 512 | 1.6 x 1.4 | `litter::lt_decal` | `tiles/7/soot_0_3x3.jpg` |
| `coaldust_0_*` | 512 x 512 | 3.0 x 2.4 | `litter::lt_decal` | `tiles/7/coaldust_0_3x3.jpg` |
| `coaldust_1_*` | 512 x 512 | 1.4 x 1.1 | `litter::lt_decal` | `tiles/7/coaldust_1_3x3.jpg` |
| `slop_0_*` | 512 x 512 | 1.5 x 1.7 | `litter::lt_decal` | `tiles/7/slop_0_3x3.jpg` |
| `scales_0_*` | 512 x 512 | 0.9 x 0.8 | `litter::lt_decal` | `tiles/7/scales_0_3x3.jpg` |
| `guts_0_*` | 512 x 512 | 0.35 x 0.3 | `litter::lt_decal` | `tiles/7/guts_0_3x3.jpg` |
| `leafmush_0_*` | 512 x 512 | 0.7 x 0.6 | `litter::lt_decal` | `tiles/7/leafmush_0_3x3.jpg` |
| `paper_0_*` | 512 x 512 | 0.38 x 0.5 | `litter::lt_decal` | `tiles/7/paper_0_3x3.jpg` |
| `grain_0_*` | 512 x 512 | 1.2 x 0.9 | `litter::lt_decal` | `tiles/7/grain_0_3x3.jpg` |
| `ash_0_*` | 512 x 512 | 0.9 x 0.8 | `litter::lt_decal` | `tiles/7/ash_0_3x3.jpg` |
| `glass_0_*` | 512 x 512 | 0.45 x 0.45 | `litter::lt_decal` | `tiles/7/glass_0_3x3.jpg` |
| `shells_0_*` | 512 x 512 | 0.8 x 0.7 | `litter::lt_decal` | `tiles/7/shells_0_3x3.jpg` |
| `drain_*` | 512 x 512 | 0.5 x 0.5 | `litter::lt_decal` | `tiles/7/drain_3x3.jpg` |
| `gutter_*` | 512 x 512 | 1.6 x 0.5 | `litter::lt_decal` | `tiles/7/gutter_3x3.jpg` |
| `leafdrift_0_*` | 512 x 512 | 1.75 x 0.6 | `litter::lt_decal` | `tiles/7/leafdrift_0_3x3.jpg` |
| `leafdrift_1_*` | 512 x 512 | 1.3 x 0.62 | `litter::lt_decal` | `tiles/7/leafdrift_1_3x3.jpg` |
| `leafpatch_0_*` | 512 x 512 | 1.1 x 1.1 | `litter::lt_decal` | `tiles/7/leafpatch_0_3x3.jpg` |
| `leafpatch_1_*` | 512 x 512 | 0.85 x 0.85 | `litter::lt_decal` | `tiles/7/leafpatch_1_3x3.jpg` |
| `leafscatter_0_*` | 512 x 512 | 1.6 x 1.6 | `litter::lt_decal` | `tiles/7/leafscatter_0_3x3.jpg` |
| `leafscatter_1_*` | 512 x 512 | 1.6 x 1.6 | `litter::lt_decal` | `tiles/7/leafscatter_1_3x3.jpg` |

Sources and integration notes:
- `muck_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `muck_1`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `muck_2`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `dungflat_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `dungflat_1`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `straw_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `straw_1`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `urine_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `urine_wall`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `oil_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `tar_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `tar_1`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `soot_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `coaldust_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `coaldust_1`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `slop_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `scales_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `guts_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `leafmush_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `paper_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `grain_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `ash_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `glass_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `shells_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `drain`: Original analytic mask; art-source/plan-84/reused/wrought_iron_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `gutter`: Original analytic mask; art-source/plan-84/reused/wrought_iron_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `leafdrift_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `leafdrift_1`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `leafpatch_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `leafpatch_1`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `leafscatter_0`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).
- `leafscatter_1`: art-source/plan-84/generated/litter-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Transparent isolated mark; 3x3 tests its empty boundary, not a continuous ground material. Leaves use 29 cm three-leaf cluster cuts; grain 10 cm patch cuts; grit/cinders 13-22 cm patch cuts. Stains have zero relief. Keep ground/collision and real drain bars in geometry.
  Native town: `litter_flat` (`native-godot/world/town/resources/r005577.res`).

Separate high-resolution marks are deliberate: the original 1024 px atlas gives many marks only 16–32 pixels.
`native-cells.json` records every native name, cell and physical size. The installer must bind the separate maps or repack/update the metadata atomically; do not replace the old atlas with one mark.
The geometric `lt_solid` models remain unchanged; torn rags, food and other solid litter need their own contextual review.

Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.
Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.
