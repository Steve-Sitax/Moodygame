# Issue 84, row 9: round 2 pictures

Picture-only handoff. Native materials, scenes, geometry, placement and IDs are untouched.
Native integration and close/grazing day, rain and night inspection remain required; this is not environment acceptance.

Separate PNGs: colour = sRGB RGB/RGBA; height = linear R, white high; normal = linear RGB OpenGL +Y; roughness = linear R, white rough.
No ORM packing. Preserve common UV transforms, enable mipmaps and linear/aniso filtering; never import data maps as sRGB.

Source/item licences, author and exact checksums: `art-source/plan-84/ROUND2-SOURCES.json` and `art-source/third_party/plan84-round2/`.

| Set | Pixels | Metres per tile/card | Target material | Decision |
|---|---|---|---|---|
| `bark_fissured` | 512 x 1024 | [1, 2] | trees::tree_bark (left half), park_plants::tree_bark (left half) | replaced |
| `bark_plane` | 512 x 1024 | [1.1, 2.2] | trees::tree_bark (right half), park_plants::tree_bark (right half) | replaced |
| `bark_atlas` | 1024 x 1024 | {'fissured': [1, 2], 'plane': [1.1, 2.2]} | trees::tree_bark, park_plants::tree_bark | replaced |
| `tree_leaves` | 1024 x 512 | [0.5, 0.5] | trees::tree_leaves | retained |
| `park_leaves` | 1024 x 1280 | [0.5, 0.5] | park_plants::tree_leaves | retained |

Per-set depth range, exact town resource targets, donor IDs and notes are in `../manifest.json`.
Comparisons: `D:/Code/_tmp_verify/K2-textures/comparisons/<row>/<set>.jpg`.
Four-map repeats: `D:/Code/_tmp_verify/K2-textures/tiles/<row>/<set>_3x3.jpg`.

Maps add surface detail only. Exposed bevels, real laps, connected drainage, underside normals and collision need native review.

The two bark halves now have different measured scan scales. Use `bark_atlas.cell_metres`; never repeat across the half-atlas boundary. Botanical lime and London-plane accuracy remains a review item.
