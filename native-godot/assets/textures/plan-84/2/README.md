# Issue 84, row 2: round 2 pictures

Picture-only handoff. Native materials, scenes, geometry, placement and IDs are untouched.
Native integration and close/grazing day, rain and night inspection remain required; this is not environment acceptance.

Separate PNGs: colour = sRGB RGB/RGBA; height = linear R, white high; normal = linear RGB OpenGL +Y; roughness = linear R, white rough.
No ORM packing. Preserve common UV transforms, enable mipmaps and linear/aniso filtering; never import data maps as sRGB.

Source/item licences, author and exact checksums: `art-source/plan-84/ROUND2-SOURCES.json` and `art-source/third_party/plan84-round2/`.

| Set | Pixels | Metres per tile/card | Target material | Decision |
|---|---|---|---|---|
| `wrought_iron` | 512 x 512 | [0.5, 0.5] | props::iron, stalls::iron, wall::wall_iron | retained |

Per-set depth range, exact town resource targets, donor IDs and notes are in `../manifest.json`.
Comparisons: `D:/Code/_tmp_verify/K2-textures/comparisons/<row>/<set>.jpg`.
Four-map repeats: `D:/Code/_tmp_verify/K2-textures/tiles/<row>/<set>_3x3.jpg`.

Maps add surface detail only. Exposed bevels, real laps, connected drainage, underside normals and collision need native review.
