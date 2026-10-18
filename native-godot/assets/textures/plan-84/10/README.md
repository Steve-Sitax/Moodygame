# Issue 84, row 10: picture handoff

Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.
Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.

`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).
`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.
Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.
Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.

| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |
|---|---|---|---|---|
| `bronze_cast_*` | 512 x 512 | 0.5 x 0.5 | `places::pl_bronze` | `tiles/10/bronze_cast_3x3.jpg` |
| `stone_petit_granit_*` | 1024 x 1024 | 1 x 1 | `places::pl_stone` | `tiles/10/stone_petit_granit_3x3.jpg` |
| `wood_oak_*` | 512 x 512 | 1 x 1 | `places::pl_wood` | `tiles/10/wood_oak_3x3.jpg` |
| `iron_painted_*` | 512 x 512 | 0.5 x 0.5 | `places::pl_iron`, `churches::park_iron`, `prison::pr_iron` | `tiles/10/iron_painted_3x3.jpg` |
| `zinc_sheet_*` | 512 x 512 | 0.5 x 0.5 | `places::pl_zinc` | `tiles/10/zinc_sheet_3x3.jpg` |
| `earth_bare_*` | 512 x 512 | 1 x 1 | `places::pl_earth` | `tiles/10/earth_bare_3x3.jpg` |
| `water_base_*` | 512 x 512 | 1 x 1 | `places::pl_water` | `tiles/10/water_base_3x3.jpg` |

Sources and integration notes:
- `bronze_cast`: art-source/plan-84/generated/bronze.png. Licence: Original project artwork (generated/derived; project LICENSE). Patina changes roughness only. Use metalness mask for oxide when wiring; no raised ground plate.
  Native town: `pl_bronze` (`native-godot/world/town/resources/r001305.res`).
- `stone_petit_granit`: art-source/environment-20261013/stone.png. Licence: Original project artwork (generated/derived; project LICENSE).
  Native town: `pl_stone` (`native-godot/world/town/resources/r001299.res`).
- `wood_oak`: art-source/plan-84/reused/prop_wood_dark_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Five boards; grain runs horizontally. Rotate every map together for vertical members.
  Native town: `pl_wood` (`native-godot/world/town/resources/r001321.res`).
- `iron_painted`: art-source/plan-84/reused/wrought_iron_c.png. Licence: Original project artwork (generated/derived; project LICENSE).
  Native town: `park_iron` (`native-godot/world/town/resources/r000996.res`), `pr_iron` (`native-godot/world/town/resources/r001215.res`), `pl_iron` (`native-godot/world/town/resources/r001315.res`).
- `zinc_sheet`: art-source/plan-84/generated/lead.png. Licence: Original project artwork (generated/derived; project LICENSE). Period dull zinc sheet, no modern galvanized spangle. Lead seam excluded from this cut.
  Native town: `pl_zinc` (`native-godot/world/town/resources/r001327.res`).
- `earth_bare`: art-source/plan-84/reused/prop_market_mud_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Central continuous soil crop; no baked circular decal silhouette.
  Native town: `pl_earth` (`native-godot/world/town/resources/r001344.res`).
- `water_base`: Original constant physical base colour. Licence: Original project artwork (generated/derived; project LICENSE). Neutral absorption base only; existing native water animation/reflection must supply waves and light. Height deliberately flat; never bake ripples into water colour.
  Native town: `pl_water` (`native-godot/world/town/resources/r001309.res`).

Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.
Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.
