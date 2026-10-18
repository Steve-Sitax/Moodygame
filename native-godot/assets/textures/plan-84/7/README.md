# Issue 84, row 7: round 2 pictures

Picture-only handoff. Native materials, scenes, geometry, placement and IDs are untouched.
Native integration and close/grazing day, rain and night inspection remain required; this is not environment acceptance.

Separate PNGs: colour = sRGB RGB/RGBA; height = linear R, white high; normal = linear RGB OpenGL +Y; roughness = linear R, white rough.
No ORM packing. Preserve common UV transforms, enable mipmaps and linear/aniso filtering; never import data maps as sRGB.

Source/item licences, author and exact checksums: `art-source/plan-84/ROUND2-SOURCES.json` and `art-source/third_party/plan84-round2/`.

| Set | Pixels | Metres per tile/card | Target material | Decision |
|---|---|---|---|---|
| `muck_0` | 512 x 512 | [1.6, 1.3] | litter::lt_decal | replaced |
| `muck_1` | 512 x 512 | [2.2, 1.4] | litter::lt_decal | replaced |
| `muck_2` | 512 x 512 | [1.1, 1.0] | litter::lt_decal | replaced |
| `dungflat_0` | 512 x 512 | [0.45, 0.4] | litter::lt_decal | matte repaired / retained photograph |
| `dungflat_1` | 512 x 512 | [0.6, 0.45] | litter::lt_decal | matte repaired / retained photograph |
| `straw_0` | 512 x 512 | [0.8, 0.8] | litter::lt_decal | matte repaired / retained photograph |
| `straw_1` | 512 x 512 | [1.1, 0.7] | litter::lt_decal | matte repaired / retained photograph |
| `urine_0` | 512 x 512 | [0.9, 1.3] | litter::lt_decal | matte repaired / retained photograph |
| `urine_wall` | 512 x 512 | [0.6, 0.55] | litter::lt_decal | matte repaired / retained photograph |
| `oil_0` | 512 x 512 | [1.4, 1.1] | litter::lt_decal | matte repaired / retained photograph |
| `tar_0` | 512 x 512 | [1.0, 0.8] | litter::lt_decal | matte repaired / retained photograph |
| `tar_1` | 512 x 512 | [0.7, 0.7] | litter::lt_decal | matte repaired / retained photograph |
| `soot_0` | 512 x 512 | [1.6, 1.4] | litter::lt_decal | matte repaired / retained photograph |
| `coaldust_0` | 512 x 512 | [3.0, 2.4] | litter::lt_decal | matte repaired / retained photograph |
| `coaldust_1` | 512 x 512 | [1.4, 1.1] | litter::lt_decal | matte repaired / retained photograph |
| `slop_0` | 512 x 512 | [1.5, 1.7] | litter::lt_decal | matte repaired / retained photograph |
| `scales_0` | 512 x 512 | [0.9, 0.8] | litter::lt_decal | matte repaired / retained photograph |
| `guts_0` | 512 x 512 | [0.35, 0.3] | litter::lt_decal | matte repaired / retained photograph |
| `leafmush_0` | 512 x 512 | [0.7, 0.6] | litter::lt_decal | replaced |
| `paper_0` | 512 x 512 | [0.38, 0.5] | litter::lt_decal | matte repaired / retained photograph |
| `grain_0` | 512 x 512 | [1.2, 0.9] | litter::lt_decal | matte repaired / retained photograph |
| `ash_0` | 512 x 512 | [0.9, 0.8] | litter::lt_decal | matte repaired / retained photograph |
| `glass_0` | 512 x 512 | [0.45, 0.45] | litter::lt_decal | matte repaired / retained photograph |
| `shells_0` | 512 x 512 | [0.8, 0.7] | litter::lt_decal | matte repaired / retained photograph |
| `drain` | 512 x 512 | [0.5, 0.5] | litter::lt_decal | matte repaired / retained photograph |
| `gutter` | 512 x 512 | [1.6, 0.5] | litter::lt_decal | matte repaired / retained photograph |
| `leafdrift_0` | 512 x 512 | [1.75, 0.6] | litter::lt_decal | replaced |
| `leafdrift_1` | 512 x 512 | [1.3, 0.62] | litter::lt_decal | replaced |
| `leafpatch_0` | 512 x 512 | [1.1, 1.1] | litter::lt_decal | replaced |
| `leafpatch_1` | 512 x 512 | [0.85, 0.85] | litter::lt_decal | replaced |
| `leafscatter_0` | 512 x 512 | [1.6, 1.6] | litter::lt_decal | replaced |
| `leafscatter_1` | 512 x 512 | [1.6, 1.6] | litter::lt_decal | replaced |

Per-set depth range, exact town resource targets, donor IDs and notes are in `../manifest.json`.
Comparisons: `D:/Code/_tmp_verify/K2-textures/comparisons/<row>/<set>.jpg`.
Four-map repeats: `D:/Code/_tmp_verify/K2-textures/tiles/<row>/<set>_3x3.jpg`.

Maps add surface detail only. Exposed bevels, real laps, connected drainage, underside normals and collision need native review.
