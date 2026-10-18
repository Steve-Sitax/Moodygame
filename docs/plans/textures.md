# Textures at the quay wall's detail (plan, 2026-10-12)

## Native picture handoff, 2026-10-18 (#84)

The new picture bundle is `native-godot/assets/textures/plan-84/`: 71 colour/height/normal/roughness sets,
with per-row READMEs, metre scales, licences and exact native town material targets in `manifest.json`.
Rows 3, 7, 8, 9 and 10 have new picture sets; rows 2 and 6 reuse the useful photographic originals.
Row 13 is partial: seven native-layout atlases improve 128 material cells; their 230 retained cells are listed
individually in the cell manifests. Signs, food, figurative art and decals still need their own picture review.
Litter is supplied as separate named high-resolution marks, with the original atlas metadata retained for integration.
Originals, generation prompts, CC0 evidence and the offline picture builder are under `art-source/plan-84/`.
No town scene, material, geometry, placement or ID was changed. Native wiring and connected geometry/lighting
acceptance remain outstanding. The browser commands and sizes below are historical, not a native installation workflow.

Steve, 2026-10-11: "The texture detail is good and high; I want all textures with the same detail." The reference
is the quay wall (`client/public/textures/quay_wall.jpg`: 1024 px for 4 m, 2.56 px a cm, a photographic Codex picture).
Done in fx-tex: the bluestone flags (squares, pavements, door steps) and the kerbs, laid from Codex pictures by
`tools/textures/bluestone_maps.py` (colour, height and stone map from one layout); the shared wood planks and rope
(`world/textures.ts`). This file lists what is still low,
worst first, with a Codex prompt for each one worth doing.

## How to make one
- One picture at a time through `node tools/codexImage.mjs --model gpt-6.1-sol --out .scratch/<name>.png --prompt "..."`
  (game content only; no names, paths or code in the prompt). Keep the picture as generated in `tools/textures/src/`,
  a row in `assets/ATTRIBUTION.md` with its SHA-256.
- Codex draws grain about twice too coarse and its pixels are soft and crinkly at full size: lay it out at half size
  (as `bluestone_maps.py at_scale`), and cut each board, stone or brick from its own place in the picture.
- Every picture with relief gets its height map from the same layout (not from the colour's light and dark, which
  makes moss and stains into dents): a script per family, as `bluestone_maps.py`, `setts_synth.py`, `townwall_maps.py`.
  The game uses height maps (three's bumpMap, psx relief), not normal maps: no green-channel convention, no tangents
  needed; the height map is linear (never `SRGBColorSpace`), the colour map is sRGB.
- Mipmaps on (`generateMipmaps`, `LinearMipmapLinearFilter`; Godot: `BakedWorld.Mipmapped`), linear mag filter
  (the PS1 nearest pixels went with the art direction of 2026-10-11).
- Memory on the GPU (RGBA8 with mips): 2048 px 22 MB, 1024 px 5.6 MB, 512 px 1.4 MB, 512 x 128 0.35 MB. A picture
  shared by every user (one texture object) is paid once; `makeTextures()` makes new canvases per call, so a picture
  swapped into it must be cached first.
- Still world: the browser first, then the bake for Godot. Moving parts (people, carts) load their glb at run time.

## The list, worst first

Seen = how much of the game it covers. Bad = how it looks next to the quay wall (5 worst).

| # | Texture | Size now | Where it shows | Seen | Bad | Codex? |
|---|---|---|---|---|---|---|
| 1 | Wood planks, `makeTextures().planks` (`world/textures.ts`), nearest, no mips | 64 px, 5 boards a tile | Every house's shutters and doors (159 meshes), bridges, piers, the quay staging, rooms' furniture and floors | very much | 5 | done 2026-10-12: `wood_planks.jpg` 512 px (prompt 1) |
| 2 | Iron, `makeTextures().iron` and `iron_tex` in props, stalls, bridges, lock, velocipede, ferry glb | 64 px | Bollards, quay iron, railings, hoops, rails (53+ meshes) | much | 5 | yes (prompt 2) |
| 3 | Town wall colours, `wall.glb` (`tools/blender/build_wall.py`) | brick 224 x 192, quoin 146 x 192, plinth, stone, cobble, slate, wood 64, window 32, iron 16, canvas 32 x 64, coping 512 x 64 | The whole rampart, gates, guard houses | much (the walk round town) | 5 | yes (prompts 3a-3d), then `townwall_maps.py` again |
| 4 | People, `people.glb` (51 atlases) | 128 px each | Every townsperson; close up in every talk | very much | 4 | no: the cloth sits on each body's UV layout; repaint in Blender at 512 px (cloth, wool, leather pictures from Codex as sources) |
| 5 | Rope, `makeTextures().rope`, `rope_tex` | 32 / 64 px | Staging ropes, rope coils (13), boats, cranes | medium | 5 | done 2026-10-12: `rope_hemp.jpg` 256 px (prompt 5) |
| 6 | Props and stalls shared cells (`props.glb`, `stalls.glb`: wood_dark, barrel, leather, sackcloth, awnings red and blue, tarpaulin, canvas_patched, market_mud, stall_sign) | 64 px (signs 64 x 32) | Market stalls, barrels, goods, carts | much on market days | 4 | yes (prompts 6a-6e) |
| 7 | Litter's flat marks (`tools/blender/build_litter.py`, `litter.glb`): leaves 32, dung_flat, muck, straw, ash, coal dust, slop, urine, tar, oil, soot, grain, shell grit 32, gutter 64 x 16, drain, glass, guts 16 | 16-64 px cells | Underfoot on every street and quay | very much (looked down at) | 4 | yes (prompt 7, one sheet of cut-out marks, then the atlas from it) |
| 8 | Churches and prison outside (`churches.glb`, `prison.glb`): church_stone 128, church_brick 128 x 96, slate 64, lead 32; pr_brick 128 x 96, pr_blue 128, pr_slate 64 | 64-128 px | Sint-Paulus, Sint-Jacobs and Carolus outside, the prison | medium | 4 | yes (prompts 8a-8c; the landmark passes made the same kind for the Steen and the Vleeshuis) |
| 9 | Trees (`trees.glb`, `park_plants.glb`): bark 128, leaves 256 x 128 and 256 x 320 | 128-320 px | Every tree in town and the park | much | 3 | bark yes (prompt 9); leaves are cut-out cards: a sheet of leaf clusters (prompt 9b) |
| 10 | Places (`places.glb`): stone 64, wood 32, earth 32, bronze 32, iron and zinc 16, water 32 | 16-64 px | Pumps, fountains, monuments, benches on the squares | medium | 5 | yes (stone from the bluestone pictures; prompt 10 bronze) |
| 11 | Railway gate and pier timber (CANVAS 64 px, shared) | 64 px | Level crossings, pier decks | little | 4 | with 1 |
| 12 | Animals (`animals.glb`) | 128 px | Cats, dogs, pigs | little | 3 | no (UV layout; Blender) |
| 13 | Omnibus, wagons, trades, quay furniture, clutter, lively, streetlife atlases | 256 px (clutter, lively 256 x 128) | Carts, stalls' goods, the quays' furniture | much | 3 | partly: the wood and iron cells follow 1 and 2 |
| 14 | Rooms: cafe_* (512), carolus_floor, plaster, oak, marble (512), cath_dome (512), shop_* (768 x 256), stadhuis_oak and glass (512) | 512 px | Inside the taverns, churches, shops | medium | 2 | when a room is redone; 1024 px each |
| 15 | Quay coping (1024 x 342, bump 512 x 171 from its colour), quay wall bump (512 px from its colour), tide mud (32 px), boats (64 px cells), ground earth and grass (256 px canvas) | | | | | being redone on next-update (D1, D2, B0, S4): not here |

The landmark pictures (Steen, Vleeshuis, Stadhuis, cathedral, Carolus, Sint-Paulus inside, the park, the house walls,
the street cobbles, the quay and wall-walk setts) are 1024 px and photographic already. Their height maps are 512 px
(made from the colour): fine for now; 1024 px when a landmark is next touched.

## Prompts

Every prompt ends with: "Realistic photographic detail, muted natural colours, even brightness across the frame so it
tiles in both directions, no text, no vignette." (said once here, written in full in each run).

1. **Wood planks** (1024 px for 1 m, 5 boards): "A seamless tileable texture in a straight front view with flat even
   overcast light, no shadows and no perspective: exactly five old wooden planks running vertically side by side, each
   exactly one fifth of the width, filling the square frame from edge to edge, with a thin dark gap between them and
   at the left edge. Old unpainted oak and pine boards from a harbour town in Flanders around 1873: grey-brown,
   weathered so the grain stands out silvery, a few small knots, nail holes with small rust stains, one butt joint
   straight across each plank at a different height, dirt and soot in the gaps." Then: each board cut from its own
   place, the gaps' height low, the grain's high-pass in the height; swap into `planks` once (cached), the material
   colours (the shutters' 0xdec3a5) tint it as now.
2. **Wrought iron** (512 px for 0.5 m): "... a flat surface of old black-painted wrought iron plate from 1873, the paint
   worn through to dark metal at the edges, orange-brown rust blooms and streaks, pitting, a faint hammered texture, no
   rivets, no holes, filling the whole frame." The rivets stay where the model has them (bollards have none).
3. **Town wall** (each 1024 px):
   a. brick, 2 m: "... a wall of old Belgian red-brown brick laid in English bond around 1860, lime mortar joints worn
      back, soot and green damp near the foot, spalled bricks, filling the frame straight on."
   b. quoins and plinth, 2 m: "... large dressed blocks of Belgian bluestone (petit granit) in level courses, tooled
      faces with fine parallel chisel strokes, crinoid fossil flecks, soot, rain streaks."
   c. slate, 2 m: "... a roof of small grey-blue Ardennes slates in overlapping rows, lichen and soot, a few cracked ones."
   d. coping, 3 m strip (1024 x 256): "... a row of long bluestone coping blocks seen from the front, rounded top edge,
      lime joints, weathered."
   Then `tools/textures/townwall_maps.py` makes the height maps from the new pictures (it checks the source).
5. **Rope** (512 px): "... a close view of thick hemp ship's rope, the twisted strands lying in parallel diagonal rows
   from lower left to upper right and filling the whole square frame with no background. Brown-grey hemp fibre darkened
   with tar, frayed fibres, salt and dirt, as used in a harbour in 1873."
6. **Stalls and props** (512 px each): a. "old dark oak boards, oiled and dirty, five boards vertical" (as 1);
   b. "a cask's oak staves with iron hoops, front view, staves vertical"; c. "worn brown saddle leather, creased";
   d. "coarse jute sacking, loose weave, dusty"; e. "faded striped awning canvas, red and off-white (and blue and
   off-white) stripes of 10 cm, stained, weathered".
7. **Litter marks** (2048 px sheet, then cut to the atlas at 64-128 px a cell): "A top-down photograph on a plain
   flat mid-grey background, evenly lit, of separate small things lying apart from each other in a 4 by 4 grid, each
   isolated with background around it: trodden horse dung with straw, a splat of brown muck, loose straw, a wet patch of
   coal dust, wood ash, a puddle of dark slop, a tar stain, an oil stain, fallen brown and yellow plane-tree leaves,
   a few cabbage leaves, spilt grain, crushed mussel shell grit, soot, broken green bottle glass, fish scales, a torn
   scrap of newspaper." The background keyed out to alpha in `build_litter.py`.
8. **Churches and prison** (1024 px): a. "the wall of a Flemish baroque church of grey-white sandstone ashlar, soot";
   b. "old Brabant red brick with lime mortar"; c. "lead sheet roofing with rolled seams, dull grey, white oxide streaks".
9. **Bark** (512 x 1024): "the bark of an old London plane tree, flaking in patches of olive, cream and grey";
   9b leaves: "a sheet of separate autumn plane-tree leaf clusters on plain flat green background, 4 by 4".
10. **Bronze** (512 px): "weathered cast bronze of a 19th-century statue, brown with green verdigris runs".
