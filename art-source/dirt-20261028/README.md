# Dirt: pit soil and wet mud · 28 October 2026 (#244)

Steve, with a picture of a quay tree pit (the soil a smooth flat brown sheet): "that is very low detail dirt where the tree
stands. Generate good looking dirt. Find more dirt in the game and change if new dirt is better. Wet dirt, dry dirt,..."
Then: "bump map the mud also", and "if tracks are going through mud, deeper grooves that must be really bump mapped".

## Survey: where bare earth and mud show

| Place | Mesh, material | Shader kind | How much | Now |
|---|---|---|---|---|
| Tree pits | `vegetation/INST166` (the quay's and the squares' pits), r004435: a 64 px picture, tinted | plain lit (r001161), no relief | 67 pits (23 quay, 44 squares), 1.6 m each | pit_soil, 2048 px |
| Planted beds | `place_lijnwaadmarkt/stjacob_yard/court_green_pl_earth`, r001344: 32 px with a bump map | bump (r000557) | 3 beds, 18 m2 | pit_soil (the same pictures) |
| Liberty tree | `liberty_tree/liberty_tree_earth`, r001367: one colour | untextured lit (r000585) | 1, 4.3 m2 | pit_soil |
| River and canal mud | `town/tide_mud` (tide_mud r001389, tide_bed r001390): 1024 px sand ripples, 4 m | tide-band relief ground (r001384), parallax | 16,200 + 3,180 m2; at low water a band at the walls' foot shows | wet_mud deepened, 1024 px (pictures and numbers only) |
| Back yards | `city/ground_earth`, r000007: 1254 px gravelly earth, parallax depth 0 | its own relief ground kind | 20,400 m2, nearly all closed yards inside the blocks | kept (not seen from where one walks) |
| Park mud, flower bed | `park_ground_mud` r001156, `park_ground_bed` r001159: a 1024 px photographic mud with its height | relief ground (r000002, r001158), parallax | 151 m2, 22 m2 | kept (already a real mud with height and parallax) |
| Market mud | `market_mud` r004631, stains laid on the flags | decal (r004626) | Grote Markt, Vismarkt, stalls: 164 m2 | kept (colour only; issue) |
| Paving's mud | the dirt mask (`world/town/maps/dirt.png`: red grime, mud and dung; green the cart roads' wear; a stone gone is a muddy hole) | every paving kind | all paved streets | kept (issue) |
| Cart ruts | `town/ruts` r004019, strips 2.4 m wide along the cart roads | decal (r004014) | 1,886 m2, 0 m2 of it on bare earth | kept: no track crosses mud |
| Churchyard | `assets/models/churchyard/ground.res` (grass, gravel), `groundcover.res` (soil collars at the stones' feet, the stone material in its vertex colour) | the town's grass and gravel; stone | collars 4-16 cm wide | kept (issue) |
| `assets/textures/plan-84/10/earth_bare_*` | listed for `places::pl_earth` in the plan-84 manifest | none | not used by any material | - |
| `assets/materials/environment-20261013/earth.png` | baked into the junctions' soil (CityJunctionRepair) and the wall circuit's foot (WallCircuitRepair) | those kinds | thin edges | kept |

## What was done

- Codex's sets (`codex/`, its README.txt and LICENCES.txt: procedural, no photographs) are 1 m tiles, 2048 px.
  `build_dirt.py` packs each used set into three maps (`maps/`): dry (albedo, AO in alpha), wet (wet albedo, gloss =
  1 - wet roughness in alpha) and height (stretched, from 0.25 up). `native-godot/scripts/store-dirt.gd` stores them
  BC7 / BC4 with mipmaps, and writes `pit-soil.tres`.
- pit_soil at 2048 px (a close-up: the pits are seen from a step away); wet_mud at 1024 px.
- The soil is drawn by the park's relief ground shader (r000002): parallax, the relief light from the height, the wet
  ground. `scripts/SoilWetRepair.cs` puts six soil lines into that stored shader (`Psx.SoilLines`): off unless a material
  sets `soil`, so the park and the churchyard gravel draw as before. With `soil` the dry picture's AO shades the hollows;
  the wet picture comes in with the rain (`psx_wet`) and stays while water lies (`psx_puddle`: about 0.1 dry, 0.6 to 0.7
  in and after rain); the stone's patchy wet is left out; water stands level in the height map's hollows up to
  `soil_pool` (0.42 of the stored height for the pits, more or less in patches) as the puddles rise, flat (no bumps for the
  lights there) and shiny, the clods out of it. The normal maps are not shipped: the shader takes the light's slope from
  the height map, which the normal maps were made from.
- wet_mud is deepened (Steve: "bump map the mud also"): 50 mm of relief instead of 11.5:
  ridges of pushed-up mud round the sole prints and the water pockets, smeared lumps, a raised crust with fine cracks
  where it stands highest; the tile's faint straight rut lines and its specks are taken out (ruts follow the cart roads,
  not a tile). The pockets stay level and lowest.
- The tree pits' soil is real relief, not parallax: `NativeTreePits.EarthModel` builds its mesh on a 2.5 cm grid (64 x
  64 over the pit) and raises each point by the soil's own height map, low-passed to that grid (about 2.4 cm from hollow
  to clod), on top of the pit's lumps and its banks against the kerbs; the finer grains come from the relief light. A
  parallax of the same depth cost about 2 ms in close views of a pit (measured, see below); the mesh looks the same.
  Its uv is laid in metres with `pit-soil.tres`. `NativeDirt` gives the beds and the liberty tree the same material (one
  copy each, its uv laid in metres; flat, the relief light only) and the river mud its new pictures, parallax 5 cm (as
  before: 3 cm) and a lighter tint (the mud lies in the walls' shade). `--keep-old-dirt` draws all of these as before.
- Heights: pit_soil spans 30.6 mm, wet_mud 49.6 mm (`maps/maps.json`).
- dry_earth, yard_dirt and grave_soil were not used: the back yards are not seen, and no grave has bare soil.

## Ruts through mud

No cart track crosses bare earth or mud: the rut strips lie wholly on paving (checked cell by cell against
`city/ground_earth`), and no cart road crosses the park's mud or the river's. Deep grooves along real tracks in mud are an
issue for when such a track exists.

## Source checksums (SHA-256)

| File | SHA-256 |
|---|---|
| `LICENCES.txt` | `834f8a51299b25ed751949a4c22a753969b16ac862b152f532039bf7cbdf5bba` |
| `README.txt` | `9351b099d4df7688c7461bdcc531000373ddf25b4f7ba5efaace6fcfb5afe003` |
| `file_checks.json` | `6f5198db3923b8474a2bc339e189fcbaaeb05ddaec2941b4caf9cb7d03f185b4` |
| `finish.py` | `71445a6e50f2c97a314ec6ea9dd03e526ecd3ab9f0f0ff09a5c507a0d864ede0` |
| `generate.py` | `816b25e7a29d5819cf2f452d6aea482492570c3587245a15127c6d8b4155c0cd` |
| `pit_soil_albedo.png` | `1b2f914a519a5296c1940f8d0a25e0a3cbd862cd551259ba1fcbe3243cb9127e` |
| `pit_soil_ao.png` | `e46f8d5e079685af33ac0779b6a65d7820f17d368713341654a42b537fb3e06f` |
| `pit_soil_height.png` | `11adfa9ea5fedb0fc9b1bb60c14f058d95fc109eee115c346b002f82e5137dfd` |
| `pit_soil_normal.png` | `c36e37a81255ba19129e30bf1592344bf2396cc5bd2603096d9d26349b2fb0f3` |
| `pit_soil_roughness.png` | `9eaed46a24c232d9cc3d24ab83eab22547d8fdea435a66dfeaa06e2d1f361136` |
| `pit_soil_wet_albedo.png` | `f6d9a2a9cbd5b1c0973a7fc24fd9e488961452fd4f1e993e44fd88a96a94b80b` |
| `pit_soil_wet_roughness.png` | `bfb889d141118b3d7215a276bd8be62ecaeca719f09b4c73a6886a9e6812da57` |
| `validation.json` | `4983c62e4642fd0d19bdc12d54bb9dfa700a662a216a1da08bb20c69926b1dd2` |
| `wet_mud_albedo.png` | `5fd3f74dd6f88f24f924ef4e0a1a4a84716873807e55e58634f9e677eb36dfc6` |
| `wet_mud_ao.png` | `77c18f2f390208a5e80f2c0ef21fd67c1b086bd3cf67db19ff022a3dcc14f709` |
| `wet_mud_height.png` | `89ff7e9776033b67760f62f6ec690e5cdcb9f1d0cda99b0b914bd13493147438` |
| `wet_mud_normal.png` | `c72f0c5bf54611fbfcae5b6d7396783aa61276d625884904ce40fc9df74f37f0` |
| `wet_mud_roughness.png` | `6784116fe50ca4a2a7ced477d1bb7f92b42f27fb3b54b5456e232cdd0bb7db20` |
