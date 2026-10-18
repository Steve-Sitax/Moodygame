# Issue 84, row 8: picture handoff

Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.
Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.

`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).
`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.
Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.
Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.

| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |
|---|---|---|---|---|
| `sandstone_ashlar_*` | 1024 x 1024 | 2 x 2 | `churches::church_stone`, `churches::carolus_sand`, `churches::pj_white`, `churches::pj_brabant` | `tiles/8/sandstone_ashlar_3x3.jpg` |
| `prison_bluestone_*` | 1024 x 1024 | 2 x 2 | `prison::pr_blue` | `tiles/8/prison_bluestone_3x3.jpg` |
| `slate_ardennes_*` | 1024 x 1024 | 2 x 2 | `churches::church_slate`, `prison::pr_slate` | `tiles/8/slate_ardennes_3x3.jpg` |
| `brick_brabant_*` | 1024 x 878 | 1.84 x 1.56 | `churches::church_brick`, `churches::pj_brick`, `prison::pr_brick` | `tiles/8/brick_brabant_3x3.jpg` |
| `lead_roof_*` | 1024 x 1024 | 1 x 1 | `churches::church_lead`, `prison::pr_lead` | `tiles/8/lead_roof_3x3.jpg` |
| `sandstone_plain_*` | 1024 x 1024 | 1 x 1 | `churches::carolus_pale`, `row 13 carved pale-stone cells` | `tiles/8/sandstone_plain_3x3.jpg` |

Sources and integration notes:
- `sandstone_ashlar`: art-source/plan-84/generated/sandstone.png. Licence: Original project artwork (generated/derived; project LICENSE). 50 cm courses, alternating half-block joints, 6 mm mortar. Arrises are relief only; exposed silhouette bevels require geometry at integration.
  Native town: `church_stone` (`native-godot/world/town/resources/r000966.res`), `carolus_sand` (`native-godot/world/town/resources/r001002.res`), `pj_white` (`native-godot/world/town/resources/r001054.res`), `pj_brabant` (`native-godot/world/town/resources/r001060.res`).
- `prison_bluestone`: art-source/environment-20261013/stone.png. Licence: Original project artwork (generated/derived; project LICENSE). 50 cm courses, alternating half-block joints, 6 mm mortar. Arrises are relief only; exposed silhouette bevels require geometry at integration.
  Native town: `pr_blue` (`native-godot/world/town/resources/r001196.res`).
- `slate_ardennes`: art-source/environment-20261013/slate-v3.png. Licence: Original project artwork (generated/derived; project LICENSE).
  Native town: `church_slate` (`native-godot/world/town/resources/r000978.res`), `pr_slate` (`native-godot/world/town/resources/r001203.res`).
- `brick_brabant`: art-source/environment-20261013/wall-brick-v2.png. Licence: Original project artwork (generated/derived; project LICENSE). Same local brick sizes as row 3; remap UV scale rather than stretch 128x96 legacy cells.
  Native town: `church_brick` (`native-godot/world/town/resources/r000972.res`), `pj_brick` (`native-godot/world/town/resources/r001089.res`), `pr_brick` (`native-godot/world/town/resources/r001190.res`).
- `lead_roof`: art-source/plan-84/generated/lead.png. Licence: Original project artwork (generated/derived; project LICENSE). Rolled seams each 0.5 m. Metallic 1 for exposed lead; no orange iron rust. Build exposed sheet edges and prominent rolls in geometry.
  Native town: `church_lead` (`native-godot/world/town/resources/r000984.res`), `pr_lead` (`native-godot/world/town/resources/r001209.res`).
- `sandstone_plain`: art-source/plan-84/generated/sandstone.png. Licence: Original project artwork (generated/derived; project LICENSE). Continuous mineral surface for carved stone and plaster; never paint masonry joints across a statue or moulding.
  Native town: `carolus_pale` (`native-godot/world/town/resources/r001030.res`).

Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.
Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.
