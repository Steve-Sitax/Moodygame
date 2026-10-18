# Issue 84, row 13: picture handoff

Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.
Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.

`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).
`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.
Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.
Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.

| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |
|---|---|---|---|---|
| `clutter_*` | 2048 x 1024 | per-cell manifest | `clutter::cl_solid` | `tiles/13/clutter_3x3.jpg` |
| `lively_*` | 2048 x 1024 | per-cell manifest | `lively::lv_solid` | `tiles/13/lively_3x3.jpg` |
| `trades_*` | 2048 x 2048 | per-cell manifest | `trades::tr_solid` | `tiles/13/trades_3x3.jpg` |
| `quayfurniture_*` | 2048 x 2048 | per-cell manifest | `quayfurniture::qf_solid` | `tiles/13/quayfurniture_3x3.jpg` |
| `streetlife_*` | 1024 x 2048 | per-cell manifest | `streetlife::sl_solid` | `tiles/13/streetlife_3x3.jpg` |
| `omnibus_*` | 2048 x 2048 | per-cell manifest | `omnibus::omnibus` | `tiles/13/omnibus_3x3.jpg` |
| `wagons_*` | 2048 x 2048 | per-cell manifest | `wagons::wagons` | `tiles/13/wagons_3x3.jpg` |

Sources and integration notes:
- `clutter`: art-source/plan-84/native-originals/clutter.png; art-source/plan-84/recovered-cells.json. Licence: Original project artwork (generated/derived; project LICENSE). Native normalized cell rectangles preserved. Repeat within cells only; whole-atlas 3x3 is a layout check. Height amplitude is 18 mm for all cells; fine materials are encoded with proportionally smaller ranges. Per-cell metre scales and tests below. Authored lettering, food, figurative ornaments and unsupported cells retained; these are not claimed upgraded.
  Native town: `clutter_solid` (`native-godot/world/town/resources/r003027.res`).
- `lively`: art-source/plan-84/native-originals/lively.png; art-source/plan-84/recovered-cells.json. Licence: Original project artwork (generated/derived; project LICENSE). Native normalized cell rectangles preserved. Repeat within cells only; whole-atlas 3x3 is a layout check. Height amplitude is 18 mm for all cells; fine materials are encoded with proportionally smaller ranges. Per-cell metre scales and tests below. Authored lettering, food, figurative ornaments and unsupported cells retained; these are not claimed upgraded.
  Native town: `lively_solid` (`native-godot/world/town/resources/r002310.res`).
- `trades`: art-source/plan-84/native-originals/trades.png; art-source/plan-84/recovered-cells.json. Licence: Original project artwork (generated/derived; project LICENSE). Native normalized cell rectangles preserved. Repeat within cells only; whole-atlas 3x3 is a layout check. Height amplitude is 18 mm for all cells; fine materials are encoded with proportionally smaller ranges. Per-cell metre scales and tests below. Authored lettering, food, figurative ornaments and unsupported cells retained; these are not claimed upgraded.
  Native town: `trades_solid` (`native-godot/world/town/resources/r001532.res`).
- `quayfurniture`: art-source/plan-84/native-originals/quayfurniture.png; art-source/plan-84/recovered-cells.json. Licence: Original project artwork (generated/derived; project LICENSE). Native normalized cell rectangles preserved. Repeat within cells only; whole-atlas 3x3 is a layout check. Height amplitude is 18 mm for all cells; fine materials are encoded with proportionally smaller ranges. Per-cell metre scales and tests below. Authored lettering, food, figurative ornaments and unsupported cells retained; these are not claimed upgraded.
  Native town: `quay_solid` (`native-godot/world/town/resources/r005196.res`).
- `streetlife`: art-source/plan-84/native-originals/streetlife.png; art-source/plan-84/recovered-cells.json. Licence: Original project artwork (generated/derived; project LICENSE). Native normalized cell rectangles preserved. Repeat within cells only; whole-atlas 3x3 is a layout check. Height amplitude is 18 mm for all cells; fine materials are encoded with proportionally smaller ranges. Per-cell metre scales and tests below. Authored lettering, food, figurative ornaments and unsupported cells retained; these are not claimed upgraded.
  Native town: `streetlife_solid` (`native-godot/world/town/resources/r004924.res`).
- `omnibus`: art-source/plan-84/native-originals/omnibus.png; art-source/plan-84/recovered-cells.json. Licence: Original project artwork (generated/derived; project LICENSE). Native normalized cell rectangles preserved. Repeat within cells only; whole-atlas 3x3 is a layout check. Height amplitude is 18 mm for all cells; fine materials are encoded with proportionally smaller ranges. Per-cell metre scales and tests below. Authored lettering, food, figurative ornaments and unsupported cells retained; these are not claimed upgraded.
  Native town: `omnibus` (`native-godot/world/town/resources/r004895.res`), `omnibus` (`native-godot/world/town/resources/r004898.res`).
- `wagons`: art-source/plan-84/native-originals/wagons.png; art-source/plan-84/recovered-cells.json. Licence: Original project artwork (generated/derived; project LICENSE). Native normalized cell rectangles preserved. Repeat within cells only; whole-atlas 3x3 is a layout check. Height amplitude is 18 mm for all cells; fine materials are encoded with proportionally smaller ranges. Per-cell metre scales and tests below. Authored lettering, food, figurative ornaments and unsupported cells retained; these are not claimed upgraded.
  Native town: `wagons` (`native-godot/world/town/resources/r004815.res`).

`*_cells.json` records every changed rectangle and its metre scale. Normalized UV rectangles remain at their original positions.
Each changed cell also has a four-map 3x3 test under `cells/13/<atlas>/<cell>_3x3.jpg`.
Retained cells are explicitly listed. Food/animal/lettering/decal content was not repainted; row 13 remains partial until those pictures are reviewed and the native installation is accepted.
Do not treat atlas outside borders as a seamless material; repeat each cell independently using the existing atlas sampler.

Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.
Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.
