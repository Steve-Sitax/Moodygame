# Issue 84, row 8: round 2 pictures

Picture-only handoff. Native materials, scenes, geometry, placement and IDs are untouched.
Native integration and close/grazing day, rain and night inspection remain required; this is not environment acceptance.

Separate PNGs: colour = sRGB RGB/RGBA; height = linear R, white high; normal = linear RGB OpenGL +Y; roughness = linear R, white rough.
No ORM packing. Preserve common UV transforms, enable mipmaps and linear/aniso filtering; never import data maps as sRGB.

Source/item licences, author and exact checksums: `art-source/plan-84/ROUND2-SOURCES.json` and `art-source/third_party/plan84-round2/`.

| Set | Pixels | Metres per tile/card | Target material | Decision |
|---|---|---|---|---|
| `brick_brabant` | 1024 x 878 | [2.4, 1.2] | churches::church_brick, churches::pj_brick, prison::pr_brick | replaced |
| `sandstone_ashlar` | 1024 x 1024 | [2, 2] | churches::church_stone, churches::carolus_sand, churches::pj_white, churches::pj_brabant | replaced |
| `prison_bluestone` | 1024 x 1024 | [2, 2] | prison::pr_blue | replaced |
| `slate_ardennes` | 1024 x 1024 | [3, 3] | churches::church_slate, prison::pr_slate | replaced |
| `lead_roof` | 1024 x 1024 | [1, 1] | churches::church_lead, prison::pr_lead | retained |
| `sandstone_plain` | 1024 x 1024 | [1, 1] | churches::carolus_pale, row 13 carved pale-stone cells | replaced |

Per-set depth range, exact town resource targets, donor IDs and notes are in `../manifest.json`.
Comparisons: `D:/Code/_tmp_verify/K2-textures/comparisons/<row>/<set>.jpg`.
Four-map repeats: `D:/Code/_tmp_verify/K2-textures/tiles/<row>/<set>_3x3.jpg`.

Maps add surface detail only. Exposed bevels, real laps, connected drainage, underside normals and collision need native review.
