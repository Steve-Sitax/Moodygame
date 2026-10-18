# Issue 84, row 13: round 2 pictures

Picture-only handoff. Native materials, scenes, geometry, placement and IDs are untouched.
Native integration and close/grazing day, rain and night inspection remain required; this is not environment acceptance.

Separate PNGs: colour = sRGB RGB/RGBA; height = linear R, white high; normal = linear RGB OpenGL +Y; roughness = linear R, white rough.
No ORM packing. Preserve common UV transforms, enable mipmaps and linear/aniso filtering; never import data maps as sRGB.

Source/item licences, author and exact checksums: `art-source/plan-84/ROUND2-SOURCES.json` and `art-source/third_party/plan84-round2/`.

| Set | Pixels | Metres per tile/card | Target material | Decision |
|---|---|---|---|---|
| `clutter` | 2048 x 1024 | per cell | clutter::cl_solid | photographic cells and lettering rebuilt; special cells retained |
| `lively` | 2048 x 1024 | per cell | lively::lv_solid | photographic cells and lettering rebuilt; special cells retained |
| `trades` | 2048 x 2048 | per cell | trades::tr_solid | photographic cells and lettering rebuilt; special cells retained |
| `quayfurniture` | 2048 x 2048 | per cell | quayfurniture::qf_solid | photographic cells and lettering rebuilt; special cells retained |
| `streetlife` | 1024 x 2048 | per cell | streetlife::sl_solid | photographic cells and lettering rebuilt; special cells retained |
| `omnibus` | 2048 x 2048 | per cell | omnibus::omnibus | photographic cells and lettering rebuilt; special cells retained |
| `wagons` | 2048 x 2048 | per cell | wagons::wagons | photographic cells and lettering rebuilt; special cells retained |

Per-set depth range, exact town resource targets, donor IDs and notes are in `../manifest.json`.
Comparisons: `D:/Code/_tmp_verify/K2-textures/comparisons/<row>/<set>.jpg`.
Four-map repeats: `D:/Code/_tmp_verify/K2-textures/tiles/<row>/<set>_3x3.jpg`.

Maps add surface detail only. Exposed bevels, real laps, connected drainage, underside normals and collision need native review.

INCOMPLETE: retained lettering, goods, figurative/animal art and unsupported cells are listed individually in `*_cells.json`. They are not accepted by this texture pass. Per-cell repeat tests are under `cells/13/<atlas>/`.
