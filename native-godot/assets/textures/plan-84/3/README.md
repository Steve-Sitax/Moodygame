# Issue 84, row 3: picture handoff

Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.
Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.

`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).
`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.
Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.
Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.

| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |
|---|---|---|---|---|
| `brick_english_*` | 1024 x 878 | 1.84 x 1.56 | `wall::wall_brick` | `tiles/3/brick_english_3x3.jpg` |
| `bluestone_ashlar_*` | 1024 x 1024 | 2 x 2 | `wall::wall_quoin`, `wall::wall_plinth`, `wall::wall_stone` | `tiles/3/bluestone_ashlar_3x3.jpg` |
| `coping_bluestone_*` | 1024 x 256 | 3 x 0.75 | `wall::wall_coping` | `tiles/3/coping_bluestone_3x3.jpg` |
| `slate_ardennes_*` | 1024 x 1024 | 2 x 2 | `wall::wall_slate` | `tiles/3/slate_ardennes_3x3.jpg` |

Sources and integration notes:
- `brick_english`: art-source/environment-20261013/wall-brick-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Photographic faces reassembled in 24-course English bond, 8 stretchers/16 headers, 6 mm lime joints. Colour/height share the same layout. Check quoin junctions in town.
  Native town: `wall_brick` (`native-godot/world/town/resources/r000630.res`).
- `bluestone_ashlar`: art-source/environment-20261013/stone.png. Licence: Original project artwork (generated/derived; project LICENSE). 50 cm courses, alternating half-block joints, 6 mm mortar. Arrises are relief only; exposed silhouette bevels require geometry at integration.
  Native town: `wall_quoin` (`native-godot/world/town/resources/r000636.res`), `wall_plinth` (`native-godot/world/town/resources/r000642.res`), `wall_stone` (`native-godot/world/town/resources/r000648.res`), `wall_stone` (`native-godot/world/town/resources/r000729.res`).
- `coping_bluestone`: art-source/environment-20261013/stone.png. Licence: Original project artwork (generated/derived; project LICENSE). Four 0.75 m caps across. Top edge and lower lip must be modelled; no painted bevel highlight. A 3 m by 0.75 m front-face strip, not a ground stain.
  Native town: `wall_coping` (`native-godot/world/town/resources/r000735.res`).
- `slate_ardennes`: art-source/environment-20261013/slate-v3.png. Licence: Original project artwork (generated/derived; project LICENSE). Six slates across, eight 25 cm exposures; image top is ridgeward. 4-6 mm split slate; near-visible roof laps need actual geometry.
  Native town: `wall_slate` (`native-godot/world/town/resources/r000663.res`).

Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.
Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.
