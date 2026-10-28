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
| River and canal mud | `town/tide_mud` (tide_mud r001389, tide_bed r001390): 1024 px sand ripples, 4 m | tide-band relief ground (r001384), parallax | 16,200 + 3,180 m2; at low water a band at the walls' foot shows | tidal silt, 2048 px, hex-tiled, water in world space (#252; the deepened wet_mud was rejected) |
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

## Tidal silt on the river mud (#252)

The deepened wet_mud read as dry, dug earth on the foreshore (Codex's review), so main kept the sand ripples
(4f1d16422). Codex then made a tidal silt for it (`codex-silt/`: its README.txt, LICENCES.txt and generate.py; the
used maps only): a wet set and a drier set for the band by the quay wall, 2 m tiles, 2048 px, a few millimetres of
relief. Laid plainly, the wet set's pools repeat every 2 m like a camouflage print (its tiling_4x4 sheet).

- `build_silt.py` writes `maps/silt_wet.png` (the wet silt with its own pools filled from the drier set's ground,
  toned to the wet silt; gloss in alpha), `maps/silt_dry.png` (the drier silt, AO in, gloss in alpha) and
  `maps/silt_relief.png` (the drier set's normal x, y and height). `native-godot/scripts/store-dirt.gd --silt` stores
  them BC7 with mipmaps (sRGB colour; the relief linear).
- The mud's stored shader (`world/town/resources/r001384.res`, used by `town/tide_mud` alone) gets the silt lines
  (`Psx.SiltLines`, `scripts/SiltRepair.cs`): one kind changed in place, off unless a material sets `silt`. The maps are
  laid in world metres and hex-tiled, each hexagon turned and shifted its own way, blended by the higher ground. The
  water is laid in world space: a film along the river's level now (`silt_level`, set every frame the tide moves) that
  reaches up in inlets with shelves between, and pools on the flats from a broad noise, both filling the silt's hollows
  first and growing in the rain; flat, they mirror the river's picture and the lamps. A broad swell, the relief light
  and the river's picture broken by the silt's slopes give the wet silt its sheen. No parallax: the relief is millimetres.
- `NativeDirt.Mud` lays it on both surfaces of the mud (the foreshore and the canals' beds; the mesh's vertex colour is
  evened out by the tint) and drops the sand's pictures. `--keep-old-dirt` still draws the old ripples.
- The tree pits' soil (the same pass): water stands only in patches, where it rises higher, so the hollows join into a
  few pools (Codex: scattered metal flecks); the clods are trodden flat in places (Codex: too evenly knobbly).

| File | SHA-256 |
|---|---|
| `LICENCES.txt` | `c1ee7a70fa5636a91c613511486d667fa2226856252fa1c0b89673b56b1f411a` |
| `README.txt` | `be438ff21c9100ac18f83cb3a588b83df1dab1e9b4ff6ced64bbc906a159c3ab` |
| `generate.py` | `fcc406a68056128ebfeb19c5ae7ad63b0ffa20894c8964cebae2bf69e35e2082` |
| `tidal_silt_albedo.png` | `698b61644ea0422a82ed25090b8c491bac24fa85fe2c173f03ca1c98b6afd053` |
| `tidal_silt_drier_albedo.png` | `92f2d59d880a144a1927543679b3738188824be006ab69eab7477243f2c8bf91` |
| `tidal_silt_drier_ao.png` | `3a6e7d65c94f7082633f8df7ed2a0f998844fed4d5d8fbfc3b471eae43eed5b2` |
| `tidal_silt_drier_height.png` | `fd301f37871a78645a1aab8b008e6faf6240440dfb18e1630df2510a9aabcccd` |
| `tidal_silt_drier_normal.png` | `d97f4653b0388eebadbc77d679caf553c67540ecea2560885085cabe470f1b9f` |
| `tidal_silt_drier_roughness.png` | `c90285764daf5bf1e318b03c833fe9d222fbec113d7ce5a3e3abf6e7e7f6ce94` |
| `tidal_silt_roughness.png` | `fbee6cfdf3eb63402f259cfb0b568bc036c0a66d1b8ff71c6972fd34f0f51295` |
| `tidal_silt_water_mask.png` | `06486ae1702826c4afa43d11a991d4e927041c98debf058467a8bad55fb7519c` |
| `validation.json` | `741d8003308392bd4725a8d6056f04caffed57b27073795af7797179830942ce` |
