# Issue 84, row 3: round 2 pictures

Picture-only handoff. Native materials, scenes, geometry, placement and IDs are untouched.
Native integration and close/grazing day, rain and night inspection remain required; this is not environment acceptance.

Separate PNGs: colour = sRGB RGB/RGBA; height = linear R, white high; normal = linear RGB OpenGL +Y; roughness = linear R, white rough.
No ORM packing. Preserve common UV transforms, enable mipmaps and linear/aniso filtering; never import data maps as sRGB.

Source/item licences, author and exact checksums: `art-source/plan-84/ROUND2-SOURCES.json` and `art-source/third_party/plan84-round2/`.

| Set | Pixels | Metres per tile/card | Target material | Decision |
|---|---|---|---|---|
| `brick_english` | 1024 x 878 | [2.4, 1.2] | wall::wall_brick | replaced |
| `bluestone_ashlar` | 1024 x 1024 | [2, 2] | wall::wall_quoin, wall::wall_plinth, wall::wall_stone | replaced |
| `coping_bluestone` | 1024 x 256 | [3, 0.75] | wall::wall_coping | replaced |
| `slate_ardennes` | 1024 x 1024 | [3, 3] | wall::wall_slate | replaced |

Per-set depth range, exact town resource targets, donor IDs and notes are in `../manifest.json`.
Comparisons: `D:/Code/_tmp_verify/K2-textures/comparisons/<row>/<set>.jpg`.
Four-map repeats: `D:/Code/_tmp_verify/K2-textures/tiles/<row>/<set>_3x3.jpg`.

Maps add surface detail only. Exposed bevels, real laps, connected drainage, underside normals and collision need native review.
