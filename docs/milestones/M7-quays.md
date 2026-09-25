# M7 - The quays, pass 2 (2026-09-25)

Why: Steve, 2026-09-25, with five pictures of the game made over into the look he wants: "Make the kaaien with
better graphics and more detail, more props. Remodel if needed. High quality is needed." Later: "If you need
textures you can use codex for it", and "you can use codex any way you want" (logged in `.claude/rule-overrides.md`).

## The ground of the working quays
Before: the working quays along the river and the dock were packed earth (a brown mud texture). The pictures show
granite setts. Now:

- A new ground kind, `quay` (`tools/city/plan.py ground_zones`): the part of the old earth within 24.5 m of the
  river and the dock (the first water; the moat keeps its earth). The yards, the park paths and the gate roads
  stay earth. Seams between `quay` and the other kinds get the granite edge stones like the rest.
- `python tools/city/plan.py --ground` writes only city.json's `ground`. A whole plan.py run does not give back the
  committed city (design.py must go first, and the wild trees come out different), so a paving change uses this.
  Checked: the land the zones cover is the same to 0.01 m2; the squares and streets did not change.
- The texture: a picture made with Codex (`client/public/textures/quay_setts.jpg`, 2.5 m a tile, seamless), with a
  height map and a stone map worked out from it (`tools/textures/setts_maps.py`: joints found as thin dark lines,
  each stone its convex hull). So the setts keep the relief light, the parallax and the per-stone dice (a stone's
  tone, a few sunk or gone) of the streets. `world/paving.ts quayPaving` is the painted stand-in that shows until
  the picture has loaded, or if it fails.
- The rail band (`tracks.ts`) uses the same picture, with its edge stones and flange grooves drawn over it
  (`paving.ts railSettsPictures`); the band now tiles every 2.5 m.
- The wheel ruts (`ruts.ts`) are softer and browner: on setts a rut is mud in the joints, not a black line.

## The quay walls and the coping
- The wall face (`city.ts`): a Codex picture of dressed bluestone with lime and wet streaks and moss
  (`quay_wall.jpg`, 4 x 4 m a tile). The slime and the wet band by the water still come from the vertex colours.
  The painted stand-in is `world/quayStone.ts quayWallTexture`.
- The coping: a Codex picture of long granite blocks (`quay_coping.jpg`, 3 m a tile), laid so the rounded edge is
  on the water side (the side is found per segment against the water outlines). New: a 34 cm front face under
  the coping's outer edge and its underside back to the wall (it was a flat band with nothing under its edge),
  15 mm behind quayfurniture's iron edge.

## The streets, not too clean (the lead, later the same day)
Steve, with picture 8 (a dirty back street at night): "make sure it is not too clean, more like it was back then".
- The street cobbles are a Codex picture of small worn cobbles with mud, dung and straw
  (`client/public/textures/street_cobble.jpg`, 3 m a tile, brightened and sharpened so the stones read). Its
  height map comes from its own light and dark (`street_cobble_h.png`): the joints are too muddy for the stone
  finder, so the streets have no stone map (no per-stone dice) once the picture is in. No anti-repeat blend and a
  shallow parallax on the streets: both turned the small stones into mush.
- `tools/textures/setts_maps.py` takes a name and a joint percentile now.
- The town wall's walk and bastion grass have no puddles: the puddles show the street mirror, whose plane is the
  street (y 0), so on the walk at 6.5 m they showed the wall upside down (`rampart.ts`).

## Bump maps checked (2026-09-26)
Steve: "you created new ground textures but the bump mapping of the old cobbles is still on there. Check everywhere
and fix." Every ground that uses the relief (`psx.ts relief`): the quays, the streets, the flags, the earth, the
grass (streets and town wall), the rail band and crane runways (`tracks.ts`), the town wall's walk and gate passages
(`rampart.ts`). Close shots at eye height, at 0.6 m and looking down from 1.2 m, 13:00 clear; then 16:00 mist, 22:00
under a gas lamp, and once with the default PS1 settings. What was wrong, and the fix:

- **The quay's height and stone maps missed stones.** `setts_maps.py` took the brown and mud-smeared stones for mud
  (a redness test) or cut them into rags: about 20 of the tile's stones lay sunk as joints under the picture, dark
  pits with the colour of a stone. Now a black-hat as wide as a joint (19 px) without the redness test, specks inside
  a stone are no joint, a ragged stone is its hull when that hull is no bigger than a big stone, and two stones that
  ran together are cut apart by a watershed. `quay_setts_h.png` and `quay_setts_id.png` made again (112 stones);
  the rail band and the walk use them too.
- **The quay's anti-repeat blend laid a second grid of setts.** `detile` mixed a copy turned 37 degrees into the
  colour on about half the quay, while the relief and the stone map stayed unturned: two grids of stones, one lit,
  one not. The quay has no `detile` now (setts are laid in rows; the per-stone tones, the patches and the dirt keep
  the tile from showing). On the earth and the grass, which keep `detile`, the relief light and the stone tones now
  follow the turned sample where it shows (`psxReliefLight`, `psxStoneTone` in psx.ts).
- **The relief's step was 4 texels on the pictures.** `e = 1/128` assumed 128 px maps; on the 512 px pictures it
  drew the lit edge and the dark joint 2 cm wider than the stones. Now 2 texels of a 512 px map (1 cm), one of a
  128 px map (the painted flags, cobbles and stand-ins look as before), from `textureSize`.
- **Stair steps along the joints at a slant.** The parallax now ends between its last two steps (the usual
  interpolation), so the stones' near sides no longer show bands.
- **The street's height map** came from the picture's light and dark alone: every wet speck on a stone was a pit and
  the mud joints half high. Now the stones the finder does find (mud colour weighed in, `setts_maps.py ... 50 0.6
  0.5`) are domes, with the picture's smoothed light and dark laid under them for the rest (`street_cobble_h.png`).
  Still no stone map on the streets: the finder gets about 60 % of the stones.
- **Pictures and painted maps mixed while loading.** Colour, height and stone map loaded one by one: a failed or late
  height left the painted stand-in's stones under the picture. `paving.ts withPictures` swaps all of a paving's maps
  at once or none (city.ts streets and quays, rampart.ts walk).
- Tiles: the zones' tiles and `relief.tile` agree (cobble 3, quay 2.5, flags, earth, grass 4); the band's relief tile
  said 2 for a 2.5 m band (no effect with no parallax; set right). The walk keeps its 2 m tile on purpose (smaller setts).
- Checked and right: the flags, the earth and the grass (painted colour and height from one layout), the rail band's
  composite. No relief (painted, no height map to disagree): the edge stones along the seams, the quay coping,
  the kerbs and steps of clutter.ts.

Frame time: the ground alone rendered 100 times from the Rijnkaai, the quay low and a street (the preview pane was
hidden and three other game tabs ran, so perf(60) was 50-58 ms before and 10-11 ms after, meaningless): 1.4-1.7 ms
a frame before, 1.0-1.6 ms after (the quay no longer blends two samples).
Pictures: `data/shots/bm0_*` (before), `bm1_*` (the new shader, old maps), `bm3_*` (after): quay_dt (a detile patch,
x -31 z 21), quay_plain, cobble, flags, earth, grassdt, band, each `_eye`, `_low`, `_down`; `bm3_mist16_*`,
`bm3_night_quay_lamp`, `bm3_night_street_lamp`, `bm3_ps1_*` (default settings), `bm3_walk_down`. `npm run build` passes.

## The air, darker and smokier (the lead, 2026-09-26)
Steve: "The pictures were wrong: it is a misty, darker, grimy atmosphere, a bit dangerous at all times. So rust, soot,
clutter, dirt."
- The day's air (`rijnkaai.ts DAYLIGHT`): a smoky grey with a little brown (0x51585a, was 0x5e6870) and less sky
  light (1.8, was 2.1). A clear day keeps the coal-smoke haze: fog far x7, about 200 m (was x16, 480 m), only 60 %
  of the clear sky's colour (0x8b9398, was a blue 0x9db0c2), and less gold in the golden hour (0.3, was 0.55).
- The streets' filth (`litter.ts FILTH`): 1.8 times the dung, straw, muck, ash and rubbish of M3j, the swept squares
  too; the flat marks dimmed a shade (the bright straw stood out in the mist). paths() gained nothing from it.
- Pictures: `data/shots/atm_clear_13.jpg`, `atm_mist_13.jpg`, `atm_mist16_street.jpg`, `atm3_street.jpg`.

## Checks
- `npm run build` passes.
- Z-fight check (`__scheldemist.zfight({ list: 300000 })`): no new pairs from the coping's front and underside. The
  quay ground overlaps its neighbours in 1-2 cm rounding slivers (quay x flags 0.012 m2, x grass 0.026 m2 at the
  river's east end, x cobble 0.010 m2), the same kind as the old earth had (earth x grass 0.68 m2, x flags 0.06 m2).
  The coping pairs the check lists (the moat corners at x -384 z 249 and x 190 z 346) and the Werf pontoon against
  the wall were there before.
- Pictures: `data/shots/q0_*` (before), `q7_*`, `q8_*` (after): the Rijnkaai, its edge and rails, the Werf wall,
  the Vismarkt and the Rijnkaai from above.

## Goods on the quays
Before: single props from props.glb stood in rows along the water and the storehouse walls (dressCity's port
goods). They were plain, and the rows at the water stood 0.5 m from the edge. The pictures show heaps of goods
set down together. Now:

- New models, made by script: `tools/blender/build_quaygoods.py` -> `client/public/models/quaygoods.glb` (47
  models, 31 k triangles, one painted atlas of 1024 x 512 and a decal atlas). Framed crates with iron corner caps,
  battened lids, rope handles and stencils (ANTWERPEN, LIVERPOOL, H&V RIO, MACHINES); an open crate with straw and
  its lid leaning on it; a tied stack and a column of three. Oak casks with sunk heads, four hoops, a bung and
  chalk tallies; a hogshead; blue petroleum casks; a keg; casks lying on chocks and in pyramids. Jute sacks
  (SANTOS, RIGA, BRAZIL) lying, slumped, heaped, and on pallets in layers. Cotton bales in iron bands. Two heaps
  under tarred tarpaulins roped to stones. A hawser coil, a loose rope, a cable drum, a rope walk (the jack,
  three trestles, three strands). Baskets, a hamper, handcarts (empty and loaded), a sack truck, planks drying
  on sticks, squared baulks, a decimal scale. Ground decals: straw, grain, coffee, oil, trodden dirt.
- The heaps: `client/src/world/quaygoods.ts`, called last in the rijnkaai.ts chain (after the clutter), so they
  keep off everything placed before them. About 30 composed heaps ("vignettes") of 3 to 6 things, a little
  askew, with straw and dirt on the setts round them. Four passes: rows at the water edge (backs to the water,
  1.7 m back, 3 m between rows), heaps against the storehouse walls between the loading gates, the rope walk,
  then heaps on the open quay and against house walls. Each quay has its own trade: wine and casks on the Werf,
  petroleum beyond the lock and at the Rijnkaai's north end, coffee, cotton and grain round the Petit Bassin.
  The Rijnkaai by the start gets fewer: against the storehouses, the rope walk, and at most three more.
- What they keep off: the rails, the traffic and omnibus lanes, the crane runways and 2 m round them, the lock,
  the bridge heads, the stone flights and ladders, house doors (3 m), loading gates (3.2 m either side, 5 m
  out), the landmarks' fronts (3.5 m), the shop doors where lively.ts sets its goods out, the lamps, the job
  spots and the notice board, the corner Madonnas' stands, the taverns' doors and the Hessenatie's hiring
  gate, the emigrants' camp and the brig's gangway. Every heap has 3 m of free ground round it (not behind it
  when it stands against a wall or the water). And a safety net: once the town's places are in (they come from
  the server), main.ts takes away any heap within 2 m of a place the paths() check knows.
- dressCity (props3d.ts) no longer shows the port goods (`goods: false`), but still lays them out and takes them
  away again, so its carts and square goods keep their old places. It now marks the traffic lanes whether or
  not the goods are laid out.
- Merged per 64 m chunk: two draw calls (solid, decal) per chunk in view; chunks past the fog are hidden.
- Dev: `__scheldemist.quayGoods.info()` (heaps by quay and kind, the reasons a heap did not fit),
  `.showroom(x, z)` (every model in a row, for close pictures), `.map(name, x0, z0, x1, z1)` (a plan of the
  heaps and what they keep off, as a shot). `localStorage "scheldemist.quaygoods" = "off"` brings the old
  goods back, to compare.

Placed on 2026-09-25 (seed 1873): 50 heaps, 166 models and 65 ground decals. The Rijnkaai by the start 9, the
Rijnkaai north 9, the Werf 5, beyond the lock 20, the Petit Bassin 7. The Werf and the Bassin quays are mostly
rails, crane runways and lanes, so few heaps fit there.

Checks (test stack `goods`, 8943/5343):
- `paths()`: [] after loading. After `t.light()` and a 12 s run it lists three corner Madonnas far from the quays
  (x -182 z 237, x -191 z 254, x 11 z 252); the same three show with the old goods (`quaygoods` off), so it is
  not the goods. routeClips(): the lock gate leaves (open at the time) and the omnibus at x -90 z 98, both also
  with the old goods.
- `perf(60)`, Jef at the Rijnkaai, the Rijnkaai north and beyond the lock: before 7.7, 6.6, 6.1 ms and 242, 201,
  195 draw calls; after 6.0, 6.2, 6.3 ms and 240, 196, 193.
- z-fight check (every goods chunk made visible first; the check skips hidden meshes): no pair with the goods
  in any list, fights, thin or close. It first found the pallet boards and the lid battens 3 cm over the boards
  under them, and the open crate's loose lid turned into the ground; the boards and battens are 5.5 to 6 cm now,
  and the lid leans the right way.
- A review of close shots of every heap found floating lying casks (they rested on their hoops: fixed), casks
  and crates inside the tarpaulins' drape (moved), heaps too near arched gates and shop doors (keep-outs above),
  a rope walk laid mirrored off its checked ground (heaps with an off-centre model are no longer mirrored).
- Pictures: `data/shots/qg_before_*` and `qg_after_*` (the same cameras: the Rijnkaai storehouse, the Rijnkaai
  north, the storehouse beyond the lock, the Werf, the Rijnkaai by the start), `qg_sr*` (the models close),
  `qg_fix_ropewalk_*` (the rope walk).
- Not done: the Werf's water edge is all crane runway and rails, and the Bassin's quays are lanes, so they got
  little. The old rows at the very edge of the water are gone with the 1.7 m rule.

### Pass 2 (the lead's review: "more props, often less than before")
- Bigger models (`build_quaygoods.py`, now 56 models, 61 k triangles): a pyramid of ten casks 4-3-2-1
  (oak and blue), a mountain of sacks five layers high without a pallet, bales stacked three high (one row
  and two rows deep), a block of crates two deep and three high, two big heaps under tarpaulins (2 m). Bales
  are lighter (3 bands, 408 triangles).
- New heaps: field heaps for the open quay (casks, petroleum, bales, coffee, grain, crates, tarpaulin,
  timber: 5 to 6 m, 1.5 to 2.3 m high, with a loose sack, a cask on its side, a basket, a coil and straw round
  them) and blocks for the storehouse walls (bales, crates, sacks, grain, casks, petroleum, tarpaulin, and a
  7 m long one where a wall has no gates). Items can now be lifted onto others (a small crate on a big one).
- Rows along the water again, 1.0 m from the edge line, one row against the next, a 2.6 m way through to the
  edge every 10 to 16 m; short rows (1 to 2 m) where a long one does not fit between bollards and berths.
  dressCity keeps its parked carts off the working quays now (`quayGoodsAreas()`), so they no longer break
  the rows. The railings along the edge (city decor `rails`) are kept 1 m clear.
- Passages: 3 m in front of the storehouse blocks, 1.5 m behind the rows at the water, 2 m round a heap on the
  open quay; two open heaps may stand 1.2 m apart (a way for one man), never in front of a block or a row.
  Loading gates keep 2.4 m either side and 5 m out. The Rijnkaai by the start gets field heaps between the
  rails, the lanes and the job places (x -52..60, z 5..36, at most 18).
- Dev: `__scheldemist.quayGoods.why(kind, x, z, yaw, mode)` (why a heap does not fit there),
  `.keepAt(x, z)` (the keep-out boxes over a point).

Placed (seed 1873): 113 heaps (pass 1: 50), about 330 models and 118 ground decals. The Rijnkaai by the start
24, the Rijnkaai north 24, the Werf 9, beyond the lock 37, the Petit Bassin 19. By kind: 24 rows at the
water, 30 blocks and heaps against walls, 16 field heaps and the rope walks, 43 smaller heaps in the open.
The lead asked for about 150: the rest of the quay ground is rails, crane runways, dray and omnibus lanes,
the lock, the rope makers' walk and the job places, and the Werf's water edge is all crane runway.

Checks: `paths()` [] after loading; routeClips() only the omnibus at x -90 z 98 (there before). z-fight (every
goods chunk visible): no goods pair in any list (it found a small crate standing inside a long one in three
heaps: they stand on top now). Frame time, one load, goods shown against hidden, Jef at the Rijnkaai, north
and beyond the lock: +5 to 7 draw calls, +50 to 70 k triangles in view, 0.5 to 1.5 ms (7.4-7.9 ms hidden,
7.7-9.4 shown; noisy, other sessions on the machine). A review of close shots of the new models and 16
heaps found casks and a handcart touching their neighbours and rows against a railing and a sign: fixed.
Pictures (t.light(13, "clear")): `data/shots/qg2_before_*` and `qg2_after_*`, same cameras: A_store,
B_north, C_lock, D_werf, E_start, F_ropewalk, and along the quays at eye height W1_rijnkaai (picture 1),
W2_lock_quay (picture 5), W5_bassin_south (picture 2). `qg2_sr_*`: the new big models close.

### Pass 3: rust, soot, dirt (2026-09-26)
Steve: "The pictures were wrong (the sunny ones): it is a misty, darker, grimy atmosphere, a bit dangerous at
all times. So rust, soot, clutter, dirt, goods that fit the style."
- The goods weathered (`build_quaygoods.py grime`, `weather_all`): every cell faded to the grey-brown of old wood
  and wet jute, darker (0.7 to 0.8), a wet green-black foot, mould blotches, mud splashed up; sacks and bales
  torn and patched; tarpaulins stained with puddles and tide rings in their folds; chalk half wiped and smeared.
  All iron (hoops, bands, straps, corner caps, nails) is rusted in scabs and runs, rust running down the posts
  from the caps. The rust is a dark brown on purpose: a first try in orange stood out in the fog.
- The quay iron (`build_quayfurniture.py`): bollards, bitts, capstans, anchors, rings and chains rusty and dark;
  a rust stain bled into the stone under the bollards, bitts, capstans and anchors (a flat decal); the huts,
  sheds, doors and window frames with the paint peeling to grey wood, soot streaks, damp at the foot.
- Debris (quaygoods.ts, the last pass; every keep-out as before): round each heap 2 to 4 things (torn slats,
  a rope end, rotten straw, muck, tar, oil, trodden dirt; now and then a rusty bucket, a stove-in cask, a dead
  rat); along the working quays muck, tar and straw on the setts and bits dropped; fish crates by the fish
  market. Only the bucket and the broken cask are solid, and they stand close by a heap, never in the walk in
  front of a row. New models: slats_broken, bucket_rusty, barrel_broken, fish_crates, rat_dead, rope_end;
  decals muck, tar, straw_rot, rust_stain. Same atlas: no new draw calls.
- Placed (seed 1873): the same 113 heaps; debris 124 things and 388 stains.

Checks (stack 8943/5343): z-fight (every goods chunk shown): no pair with the goods; the quay furniture pairs it lists (the harbour hut's windows, 1 cm layers) are in geometry this pass did not touch (its new faces are only the flat rust stains, on the decal material with its polygon offset). `paths()` lists 28 homes and the Logement (the
Hartmann, Baumgartner, Becker, Mols ... families): the same list with the goods switched off, so not the goods
(it came with the house changes of the same day). routeClips(): the omnibus at x -90 z 98, as before. Frame
time, one load, goods shown against hidden: 44.2, 43.8, 43.9 ms against 43.9, 43.9, 43.5 ms (the whole scene
was near 44 ms on this machine that hour), +3 to 7 draw calls. `npm run build` passes.
Pictures: `data/shots/qg3_*` (the cameras of `qg2_after_*`, t.light(13, "clear")), `qg3_fog16_*` and
`qg3_fog21_*` (the default fog at 16:00 and 21:00), `qg3_sr_*` (the goods and the debris close),
`qg3_qf_capstan`, `qg3_qf_harbour_hut` (the quay iron and a hut).
- Cloth fix (the lead's review: the sacks and bales "look like cheese or leopard skin close up"): the round
  dots came from mud specks, round tears, mould thresholds and single dark pixels in the weave. Sacks, bales
  and tarpaulins now weather as cloth (`cloth_grime`): soft uneven stains in a few blotches, damp soaked up
  from the underside, 0 to 2 tears as slits with a dark inside and pale frayed threads (a bale 1 to 2), now and
  then a square patch of another cloth stitched on; the tarpaulins keep two soft wet patches in their folds, no
  rings. The bale's cotton shows only at its ends, as soft bands. Pictures, 1 to 2 m, front and side:
  `qg4_before_*` and `qg4_after_*` (sacks_pallet, bale, tarp_crates, sacks_heap).

## Buildings on the quays
Why: Steve, 2026-09-25, after the first quay pictures: "also more detail in models, complexity of buildings". His
pictures show deep windows with stone sills and lintels, shutters, bands and anchors, gutters and downpipes,
chimney pots, dormers, and hoists on the storehouses. The houses had their windows painted on flat walls.

What changed (`tools/blender/build_city.py`, rebuilt `client/public/models/city.glb`):
- Every window of a street front is cut into the wall now. The sash stands 16 cm back (a shop window 12 cm), with
  the reveal round it. The sashes have atlas cells of their own (`cityTextures.ts`: four upper sashes with lace or
  curtains, three shop windows, one with wares, a dormer window, two shutter leaves). Not in the gables, not in
  the alley cottages, not on back walls on a yard (street life counts those blind and pastes bills there).
- The fronts that look onto a quay, a square or the water get the whole dress (`prime_front`: a ray over the walk
  map reaches the water or quay or square paving before a house; 297 of 1,663 street walls). Stone sills, a head
  over each window (a flat lintel, one with a keystone, a stone arch, or a hood), shutters on most plastered
  houses, bands at the floor lines or iron anchors on the piers, a downpipe, a gutter, a moulded cornice. The
  other fronts keep their painted lintels, sills and shutters round the set-in windows.
- The small things go into a second mesh per chunk, `city_<i>_<j>_d`. The game draws it only near: within 60 m
  of the chunk (`city.ts`, `DETAIL_NEAR`). No new material.
- All houses: brick chimneys with a stone cap and one to three clay pots; mitred cornices on hipped and flat
  roofs, a coping on the parapets; more dormers on wide fronts, with a set-in window, lead cheeks and a pitched or
  flat roof.
- Storehouses: the loading doors stand at the back of an opening in the wall. Over each column a hoist loft
  with its own loading door, a slate gable roof, the beam, a pulley, the rope and a hook (the Entrepot, the
  Petit Bassin). Cross anchors over the first floor (the quay names are painted there).
- Nothing moved: footprints, heights, doors, gates, passages. Nothing new stands out of a front in the sign band
  (3.47 to 4.19 m) or out of a window's box in `facadeOpenings`. No downpipe by a named door (its sign runs
  along the front). Where two plan houses overlap (30 walls), the fronts stay flat: cut, they only fight more.
- A wall of the same brick stands 0.4 m behind every cut front, so a crack at a T-junction of the vertex snap
  shows wall, not the inside of the house. The houses with rooms in the world (`inworld_build.json`) have none.
- `ambient.ts`: the lit panes at night stand in the recess now (the shop window 9.5 cm back, the upper sash
  13.5 cm), none over a storehouse's loading door or gate, and at the old place on the walls left flat
  (`flatWalls`, the same test as `overlapped`).
- The storey's foot showed as a light line (the texel row at v = 0 flipped to a mortar row): the uv stops short.

Numbers: `city.glb` 2.9 MB to 5.8 MB; 204,164 to 459,440 triangles, 109,034 of them near-only.

Checks (test stack, 960 x 540, 13:00, clear):
- `perf(60)` with `t.go()`, before and after on the same stack (the milliseconds wander by a millisecond run to run):
  default settings Rijnkaai 7.8-9.2 ms, 311 calls, 1,004,413 triangles before; 7.1-8.1 ms, 314 calls, 1,006,063
  after. Vismarkt 7.8-8.2 ms, 385, 1,034,926 before; 7.0-7.1 ms, 387, 1,045,504 after. Full window, no PS1
  colour or wobble: Rijnkaai 8.3-9.0 ms, 310, 1,002,487 before; 6.6-7.1 ms, 314, 1,042,917 after. Vismarkt
  7.5-8.2 ms, 384, 1,033,990 before; 7.5-7.7 ms, 395, 1,049,229 after.
- `zfight({ list: 300000 })`: the houses' visible fights 329 before, 272 after (back to back 134 to 135, flat tops
  and copings 70 to 28, ground storey 71 to 69, fronts in one plane 39 to 27, roofs 13 to 13). They sit where
  plan houses overlap in the new streets to the north (x -160 z 340, x 120 z 300, x -100 z 165, x 0 z 230).
- `signs()`: no problems; every kind as many as before (341 bills, 217 boards, 3 quay names, 27 quay notices).
  Chimneys found for the smoke: 769, as before. `paths()`: "before a corner Madonna" (the quay goods, not the
  houses). `npm run build` passes.
- Pictures, the same cameras before and after: `data/shots/b0x_*.jpg` and `b9_*.jpg` (the Rijnkaai wide, close,
  by the Hessenatie, the storehouse by the lock close and from below, the Vismarkt, the Werf). Blender:
  `-- --no-export --preview "quay*"` writes `data/shots/city_quay_*.png`.

### Second pass: every street front, the gables, shopfronts, quoins, night (2026-09-25)
Steve, after the first pictures: shopfronts, the gable windows, quoins, a plinth on the storehouses; then, with a
picture of a street of houses at night: "do all the houses here an example. Try to use returning assets and mix up."

- Every street front has the whole dress now (1,663 walls), not only those on the quays; `prime_front` is no
  longer asked. The same kit of parts on every house, mixed by the house's own dice: the head over the windows
  (flat lintel, keystone, stone arch, hood; the first floor may wear another), shutters on most plastered houses
  and some brick ones (open, one closed, both closed; green, grey, white, blue, brown, red), flower boxes on some
  first and second floor sills (geraniums, pinks, greens, marigolds), a lantern by some front doors, bands or
  anchors, downpipes. A few windows in a house have their shutters shut.
- Shopfronts on six houses in ten, round each shop window: pilasters, a stall riser with its sill, a fascia and a
  cornice, painted (green, oxblood, black, ochre, blue). The cornice stops at 3.44 m: the sign band (3.47 to
  4.19 m) stays flat for the painted boards. Pilasters no wider than the window's box of `facadeOpenings`. The
  other houses have a stone sill and lintel.
- The front gables (stepped, spout and plain, 425 of them) have their windows cut in: a sash, a stone sill and a
  relieving arch; the gable's face is cut round them (`gable_front`). 703 windows, 560 of them small attic
  windows where a full one does not fit under the outline. The step copings were there already.
- Quoins, long and short stones in turn, up the outer corners of plastered fronts of 4 m and more (on a shorter
  front a street's name plate would find no room). A plinth of blue stone along the storehouse fronts.
- The far view: the piers between the windows show the painted lintels and sills of a new atlas row
  (`cityTextures.ts`, row 7, `FARPIER_ROW`); near, the 3D sills and heads cover them exactly.
- Night: the lanterns (277) light from dusk to dawn (`ambient.ts`, from `shared/city_gable_windows.json`, which also
  lists the gable windows for their lit panes). The lit panes have curtains drawn to the sides in most rooms.
- Rules kept: nothing in the sign band or past a window's box; no cut on back walls on yards, where bills go; the
  in-world houses keep their rooms; walls where plan houses overlap stay flat (29).

Numbers: `city.glb` 2.9 MB before pass 1, 5.8 MB after it, 9.4 MB now; 204,164 triangles before, 794,902 now
(412,904 of them near-only, drawn within 60 m).

Checks:
- `signs()`: no problems; every kind as many as before the first pass (359 house numbers, 217 boards, 245 name
  plates, 341 bills, 3 quay names, 27 quay notices, 2 weigh doors, 5 door signs, 5 tavern signs).
- `zfight({ list: 300000 })`: the houses' visible fights 329 before the first pass, 260 now (back to back 134 to
  130, flat tops and copings 70 to 29, ground storey 71 to 63, fronts in one plane 39 to 25, roofs 13 to 13). Four
  of them touch the new parts, all under 0.02 m2: three gutter mitres on odd corners of hipped roofs, one shop
  cornice where two plan houses almost overlap (x 67 z 331).
- `paths()`: "before a corner Madonna" only (the quay goods). `npm run build` passes.
- `perf(60)`, the original city against this one on the same stack, the places warmed first. The preview pane was
  hidden, so every frame took about 45 ms (the browser holds a hidden page back); the difference is in the
  noise. Default settings: Rijnkaai 42-45 to 42 ms, 285 to 270 calls, 989,203 to 875,922 triangles; Vismarkt 44 to
  45-46 ms, 386 to 362, 1,030,588 to 921,128; Grote Markt 49 to 48-49 ms, 598 to 567, 1,095,120 to 1,029,338; the
  back lane 44-46 to 43-46 ms, 293 to 275, 1,038,344 to 950,279. Full window: Rijnkaai 43-45 to 45-46 ms, 289 to 294,
  1,019,677 to 1,026,033; Vismarkt 49 to 49 ms, 396 to 399, 1,039,850 to 1,052,426; Grote Markt 49 to 47 ms, 615 to
  626, 1,149,238 to 1,220,677; back lane 44-45 to 43-44 ms, 300 to 311, 1,127,705 to 1,183,967. (The counts move with
  the townspeople drawn at the moment.)
- Pictures, the same cameras: `data/shots/b0x_*.jpg` (before the first pass) and `b11_*.jpg` (now); new cameras
  `row6` (a row of gables on the Rijnkaai, like Steve's picture), `back` (a back street), `markt`, `werf_gables`,
  `rk_gables`, `quoin`, `quoin_b`; at night `b11_row6_night.jpg`, `b11_back_night.jpg` (22:00, clear). Pass 2 on its
  own: `b10_*.jpg`. Blender: `city_quay_*.png` (`--preview "quay*"`).

Not done: a Codex brick or plaster picture (the painted atlas holds up next to the 3D at the game's resolution);
door steps (street life lays them); the kit is baked per chunk, not instanced (the file stays under 12 MB).

### Third pass: the grime (2026-09-25)
Steve, with a picture of a back street at night: "make sure it is not too clean, more like it was back then".

- The plain wall is drawn from pictures now: weathered dark brick, stained ochre lime plaster flaking to the brick,
  grey render over stone (Codex, `client/public/textures/wall_brick.jpg`, `wall_plaster.jpg`, `wall_render.jpg`,
  rows in `assets/ATTRIBUTION.md`), laid along each wall in metres (brick 1.9 m a tile, plaster 3 m). The facade
  atlas marks its plain-wall texels (alpha 0.5, `cityTextures.ts maskFill`); only those take the picture, so the
  painted lintels, sills, plinths and windows stay where they were and the window cells still line up. Until the
  pictures have loaded the painted wall shows.
- Over it, in the house material (`client/src/world/houseGrime.ts`, hooked in `city.ts`): dark runs under every
  window sill and soot over every window head, big blotches, streaks down the wall, green-black damp rising
  0.4 to 1.1 m at the foot with a ragged edge, a brown-black film of coal smoke (never grey), and on the doors,
  gates, loading doors and shutters the paint worn off in flakes, most at the edges and low down. The stone
  (sills, heads, cornices, quoins, kerbs) darker and streaked too.
- How worn, per house (`build_city.py wear_of`, in the alpha of the vertex colour): the alley cottages worst
  (0.85 to 1), a house on a back street 0.5 to 0.95, one on a quay, a square or the water 0.35 to 0.75, one in
  eight kept well (0.12 to 0.27).
- The palette stays: brown-red brick, ochre and grey plaster, dark green shutters; darker and dirtier.
- Not changed: the ground, the streets and the town wall; the geometry (city.glb only carries the wear now).

Checks: `signs()` no problems, every kind as before; `paths()` only "before a corner Madonna" (the quay goods);
`npm run build` passes; `zfight()`: the houses' visible fights 265 (260 after the second pass: the geometry
is the same, the count moves with the other models in the scene; four touch the near-only parts, as before). Pictures, the same cameras: `data/shots/b11_*.jpg` (before) and `b12_*.jpg`
(now), at night `b11_row6_night.jpg` / `b12_row6_night.jpg`, `b11_back_night.jpg` / `b12_back_night.jpg` (22:00).
Not done: rust runs under the anchors and soot over the chimneys (no place for them in the atlas; a job for
decals); the frame time was not measured (the preview pane was hidden: it holds every frame at about 45 ms).
