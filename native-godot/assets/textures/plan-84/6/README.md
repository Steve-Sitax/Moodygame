# Issue 84, row 6: picture handoff

Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.
Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.

`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).
`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.
Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.
Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.

| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |
|---|---|---|---|---|
| `wood_dark_*` | 512 x 512 | 1 x 1 | `stalls::wood_dark`, `props::wood_dark` | `tiles/6/wood_dark_3x3.jpg` |
| `barrel_*` | 512 x 512 | 1 x 1 | `stalls::barrel`, `props::barrel` | `tiles/6/barrel_3x3.jpg` |
| `leather_*` | 512 x 512 | 0.5 x 0.5 | `stalls::leather`, `props::leather` | `tiles/6/leather_3x3.jpg` |
| `sackcloth_*` | 512 x 512 | 0.5 x 0.5 | `stalls::sackcloth`, `props::sackcloth` | `tiles/6/sackcloth_3x3.jpg` |
| `awning_blue_*` | 512 x 512 | 1 x 1 | `stalls::awning_blue` | `tiles/6/awning_blue_3x3.jpg` |
| `awning_red_*` | 512 x 512 | 1 x 1 | `stalls::awning_red` | `tiles/6/awning_red_3x3.jpg` |
| `tarpaulin_*` | 512 x 512 | 1 x 1 | `stalls::tarpaulin` | `tiles/6/tarpaulin_3x3.jpg` |
| `canvas_patched_*` | 512 x 512 | 1 x 1 | `stalls::canvas_patched` | `tiles/6/canvas_patched_3x3.jpg` |
| `wood_single_*` | 512 x 128 | 1 x 0.17 | `props::wood`, `stalls::wood`, `row 13 solid-timber cells` | `tiles/6/wood_single_3x3.jpg` |

Sources and integration notes:
- `wood_dark`: art-source/plan-84/reused/prop_wood_dark_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.
  Native town: `wood_dark` (`native-godot/world/town/resources/r003232.res`), `wood_dark` (`native-godot/world/town/resources/r004584.res`).
- `barrel`: art-source/plan-84/reused/prop_barrel_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.
  Native town: `barrel` (`native-godot/world/town/resources/r003588.res`), `barrel` (`native-godot/world/town/resources/r004618.res`), `barrel` (`native-godot/world/town/resources/r006377.res`).
- `leather`: art-source/plan-84/reused/prop_leather_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.
  Native town: `leather` (`native-godot/world/town/resources/r003245.res`), `leather` (`native-godot/world/town/resources/r004656.res`).
- `sackcloth`: art-source/plan-84/reused/prop_sackcloth_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.
- `awning_blue`: art-source/plan-84/reused/prop_awning_blue_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.
  Native town: `awning_blue` (`native-godot/world/town/resources/r004594.res`).
- `awning_red`: art-source/plan-84/reused/prop_awning_red_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.
  Native town: `awning_red` (`native-godot/world/town/resources/r004649.res`).
- `tarpaulin`: art-source/plan-84/reused/prop_tarpaulin_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.
  Native town: `tarpaulin` (`native-godot/world/town/resources/r004643.res`).
- `canvas_patched`: art-source/plan-84/reused/prop_canvas_patched_c.png. Licence: Original project artwork (generated/derived; project LICENSE). Retained photographic row 6 source, commit 73a5fb50; matched structural height. No retired scene/builder is used.
  Native town: `canvas_patched` (`native-godot/world/town/resources/r004637.res`).
- `wood_single`: art-source/plan-84/reused/prop_wood_dark_c.png; art-source/plan-84/reused/prop_wood_dark_h.png. Licence: Original project artwork (generated/derived; project LICENSE). Single continuous board cut between the inherited plank joints. Use on beams, spokes and solid painted panels so plank gaps are not painted across solid timber. Grain runs horizontally.
  Native town: `wood` (`native-godot/world/town/resources/r003226.res`), `wood` (`native-godot/world/town/resources/r004578.res`), `wood` (`native-godot/world/town/resources/r009270.res`).

Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.
Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.
