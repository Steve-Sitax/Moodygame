# Issue 84, row 2: picture handoff

Original/derived photographic maps, prepared 2026-10-18. No native scene, material, geometry, placement or ID was changed.
Native installation and connected-scene inspection in dry daylight, rain and darkness remain required. This is not environment acceptance.

`*_colour.png`: sRGB RGB/RGBA. `*_height.png`: linear R, white high. `*_normal.png`: linear RGB tangent OpenGL (+Y).
`*_roughness.png`: linear R, white rough. Separate maps, no ORM/alpha channel packing. Mipmaps and linear/aniso filtering on.
Use the same UV transform for every map. Do not import normal/height/roughness as sRGB. Normal Y must not be inverted.
Source file licences/checksums: `../manifest.json`; full provenance: `assets/ATTRIBUTION.md`, `art-source/plan-84/SOURCES.json`.

| Prefix: four PNG maps (colour, height, normal, roughness) | Pixels | Metres per tile/card | Target native scene::material | 3x3 test under K-textures proof folder |
|---|---|---|---|---|
| `wrought_iron_*` | 512 x 512 | 0.5 x 0.5 | `props::iron`, `stalls::iron`, `wall::wall_iron` | `tiles/2/wrought_iron_3x3.jpg` |

Sources and integration notes:
- `wrought_iron`: art-source/plan-84/reused/wrought_iron_c.png; art-source/plan-84/reused/wrought_iron_h.png. Licence: Original project artwork (generated/derived; project LICENSE). Photographic original from 042db687, matching height retained. Surface rust has no ground collision.
  Native town: `wall_iron` (`native-godot/world/town/resources/r000615.res`), `iron` (`native-godot/world/town/resources/r002509.res`), `iron` (`native-godot/world/town/resources/r004606.res`), `iron` (`native-godot/world/town/resources/r009272.res`).

Exposed stone, wood and metal edges still require material-appropriate geometric radii. Maps cannot repair silhouettes, junctions, drainage or collision.
Do not add opaque stain plates. Keep cast bodies/bases consistent. Check backs, tops, undersides, ends, mipmaps and low/grazing angles after wiring.
