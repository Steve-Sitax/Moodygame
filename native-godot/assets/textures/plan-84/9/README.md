# Issue 84, row 9: picture handoff

Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.
Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.

`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).
`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.
Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.
Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.

| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |
|---|---|---|---|---|
| `bark_fissured_*` | 512 x 1024 | 0.5 x 1 | `trees::tree_bark (left half)`, `park_plants::tree_bark (left half)` | `tiles/9/bark_fissured_3x3.jpg` |
| `bark_plane_*` | 512 x 1024 | 0.5 x 1 | `trees::tree_bark (right half)`, `park_plants::tree_bark (right half)` | `tiles/9/bark_plane_3x3.jpg` |
| `bark_atlas_*` | 1024 x 1024 | 1 x 1 | `trees::tree_bark`, `park_plants::tree_bark` | `tiles/9/bark_atlas_3x3.jpg` |
| `tree_leaves_*` | 1024 x 512 | 0.5 x 0.5 | `trees::tree_leaves` | `tiles/9/tree_leaves_3x3.jpg` |
| `park_leaves_*` | 1024 x 1280 | 0.5 x 0.5 | `park_plants::tree_leaves` | `tiles/9/park_leaves_3x3.jpg` |

Sources and integration notes:
- `bark_fissured`: art-source/third_party/ambientcg-bark012/Bark012_1K-PNG.zip. Licence: CC0-1.0, ambientCG Bark012; original adaptation. CC0 oak fissures, also a generic fissured-bark donor for elm/lime/willow; species-specific form remains model geometry.
  Native town: `park_bark` (`native-godot/world/town/resources/r001169.res`), `trees_bark` (`native-godot/world/town/resources/r009469.res`), `trees_bark` (`native-godot/world/town/resources/r009495.res`), `trees_bark` (`native-godot/world/town/resources/r009512.res`).
- `bark_plane`: art-source/plan-84/generated/bark.png. Licence: Original project artwork (generated/derived; project LICENSE). Exfoliating plane pigmentation stays flat; only fine flake grain enters relief.
  Native town: `park_bark` (`native-godot/world/town/resources/r001169.res`), `trees_bark` (`native-godot/world/town/resources/r009469.res`), `trees_bark` (`native-godot/world/town/resources/r009495.res`), `trees_bark` (`native-godot/world/town/resources/r009512.res`).
- `bark_atlas`: 9/bark_fissured; 9/bark_plane. Licence: CC0-1.0 fissured-bark donor plus original generated plane bark. Do not repeat across the half-atlas boundary. Use existing native half-cell UVs; each half tiles independently. Plane normal strength already baked at 6 mm, fissured at 18 mm.
  Native town: `park_bark` (`native-godot/world/town/resources/r001169.res`), `trees_bark` (`native-godot/world/town/resources/r009469.res`), `trees_bark` (`native-godot/world/town/resources/r009495.res`), `trees_bark` (`native-godot/world/town/resources/r009512.res`).
- `tree_leaves`: art-source/plan-84/generated/leaves.png; art-source/plan-84/generated/park.png. Licence: Original project artwork (generated/derived; project LICENSE). Each 256 px cell is a 0.5 m square card. Preserve species indices and native cell UVs. Leaf veins remain pigment; no invented raised outline. Flat normal appropriate to thin two-sided leaves; real branch thickness is geometry.
  Native town: `trees_leaves` (`native-godot/world/town/resources/r009477.res`), `trees_leaves` (`native-godot/world/town/resources/r009502.res`), `trees_leaves` (`native-godot/world/town/resources/r009519.res`).
- `park_leaves`: art-source/plan-84/generated/park.png. Licence: Original project artwork (generated/derived; project LICENSE). Each 256 px cell is a 0.5 m square card. Preserve species indices and native cell UVs. Leaf veins remain pigment; no invented raised outline. Flat normal appropriate to thin two-sided leaves; real branch thickness is geometry.
  Native town: `park_leaves` (`native-godot/world/town/resources/r001176.res`).

Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.
Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.
