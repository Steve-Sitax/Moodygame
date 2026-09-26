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

### Bump maps on the house walls (2026-09-26)
Steve: "Also do bump mapping on all buildings and take pictures to see if it is right and adapt if needed."
- Every wall picture of the texture array (houseGrime.ts WALL_PICS, all 13 final) has a height map made from it:
  `tools/textures/wall_heights.py` writes `client/public/textures/wall_<name>_h.png` (512 px, the array's size) and
  records the picture's SHA-256 and its kind in `wall_heights.json`. Brick and stone: the joints found where the colour
  leaves the brick's own (Lab, against a median about a brick wide), kept only as horizontal and vertical lines; the
  faces domed with 1 cm arrises and a little of the picture's own grain. Ashlar with a wider look (big blocks, thin
  joints), the sooty old yellow brick with a looser one. Plaster, render and the limewashed brick: fine lumps and cracks,
  and where the skin has come off to the red brick (Lab a* over 139) the brick lies lower. Roughcast: its small lumps
  from the picture's light. `--check` lists height maps missing or made from another picture.
- The game (`retro/psx.ts wallRelief`, hooked by one marked `#ifdef WALL_RELIEF` line and one call in houseGrime.ts)
  loads a height map only if the json's hash is the picture's own (checked in the browser): a picture replaced without
  running the tool again gets a flat wall, never the old bricks. The height tilts the wall's normal (the sky light, the
  sun and the gas lamps pick out the courses as real light would), darkens the joints a little, and adds a little sky
  light on the tops, so it reads in any light; it fades out from 10 to 28 m. Strength by kind: brick and stone 1,
  roughcast 0.18, plaster and render 0.12 (houseGrime.ts flattens the plaster pictures' colour, so their relief is flat too).
- Tuned from pictures and two reviews by a fresh agent: the first plaster and roughcast relief (0.45, 0.8, with big waves)
  looked like hammered metal where the colour is flat, and the brick at 2.6 was pillowy close up (speklagen at night
  had black outlines): now 2.0, plaster only fine lumps.
- Frame time: no difference to measure (house meshes alone, 20 renders, bump on and off: 3.3-4.2 ms either way;
  perf(60) with the hidden pane 45 ms either way).
- The lead's review of all 13: the yellow brick embossed close up and striped like corrugated sheet at 6 m, the light
  mortar of the speklagen and the yellow brick went dark, the smooth plaster was orange peel and the roughcast hammered
  metal. Now each picture has its own strength (`wall_heights.py` KINDS, into the json: fine brick 0.8, yellow 0.4,
  limewashed 0.4, smooth plaster 0.04, roughcast 0.1 with lumps of its grain only); light-mortar walls get shallow
  joints (found by the tool: joints lighter than the bricks), so the shade in them stays a little under the mortar's own
  tone; and the relief's step grows with the pixel's footprint on the map and fades where the joints get smaller than
  two or three pixels, so small courses never stripe (also with the default PS1 settings). Pictures: `wc2_L<n>_*`,
  `wc3_L6_*`, `wn3_spek_*`, `wc3_ps1_*`.
- Not done: the plaster that houseGrime.ts knocks off in its own shader (worn houses) shows the brick picture's colour
  but keeps the plaster's (faint) relief.
Pictures: `data/shots/wc0_L<n>_*` (no bump) and `wc1_L<n>_*` (bump), n = the array layer 0..12, `_close` (1 m) and
`_street` (6 m), 13:00 clear; at night under a gas lamp (22:00) `wn0_*` (no bump), `wn1_*` (first strength), `wn2_*`
(now), for the clinker and the speklagen; `wb2_ps1_brick_*` the default PS1 settings; `wallh_<name>.jpg` what the tool
found (the picture, the joints in red, the height).

### Bump maps on every floor (2026-09-26)
Steve, with a picture of a lane in grey squares: "The floor over all of town is not all bump-mapped: do all."
- His lane was the street cobbles' painted stand-in, not a floor without relief: three.js keeps a texture's GPU storage
  from its first upload (texStorage2D), so when a frame was drawn before the pictures had loaded, the bigger picture did
  not fit (GL_INVALID_VALUE) and the painted stand-in stayed for good. Every picture swap now disposes the texture first
  (`paving.ts swapped`, used by `withPictures` and the rail band; `quayStone.ts withPicture`). Reproduced in the test
  stack (a small texture drawn once, then the picture: magenta stayed; with the fix, the picture).
- Inventory of the walkable floors (up-facing faces near the walk, in the running game): the ground zones, rail band, wall
  walk and gate passages had relief. Without: the pavements, kerbs and door steps (the house trim, about 6,100 m2 at
  0.12 m), the edge stones along the seams (1,600 m2), the landmarks' steps and terraces, the quay flights, the pier deck,
  the landmark halls' floors. Now: the pavements, kerbs and door steps (flat, below 0.8 m) are bluestone slabs laid in
  world metres with the ground's relief light (`psx.ts` option `slabs`; their own uv stretched the stone texture flat);
  the others get three.js's bumpMap made from their own colour (`psx.ts bumpFromMap`: light stone high, dark joints low),
  so the bump always matches the picture: edge stones, landmark stone, quay flights, pier deck, the halls' slabs, stone,
  oak and marble (`landmarkKit.ts lmMat` takes the depth as a fourth value).
- Left to their owners (same approach): the churches' floors and park paths (churches.ts, carolusHall.ts), the in-world
  shop, tavern and home interiors (rooms.ts, homeRooms.ts, houseInWorld.ts), the bridges' and pontoons' decks (the boats'
  atlas material: bumpMap does not follow psx's atlas cells).
- Checks: `paths()` [], `npm run build` passes, frame time within the noise (perf(60) in the lane 9.5 ms with, 12.6 ms
  without: the pane's noise); no geometry changed, so the z-fight check has nothing new to find (its full run did not
  finish in the preview tool's time). Pictures: Steve's `images/11.webp` (before) and `data/shots/fl2_steve_view.jpg`,
  `fl2_steve_view_ps1.jpg` (14:30, mist; the default PS1 settings); `fl0_pave2..4` / `fl2_pave2..4` (pavements),
  `fl0_pier` / `fl2_pier`, `fl2_night_lamp` (22:00), `fl_bug_swap` / `fl_bug_fixed` (the swap).

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

### Fourth pass: rust, soot, darker (2026-09-26)
Steve, after the grime pass: "The pictures were wrong (the sunny ones): it is a misty, darker, grimy atmosphere, a
bit dangerous at all times. So rust, soot, clutter, dirt."

- A fault found on the way: `city.glb` carries two vertex colour sets, a blank white one first (the exporter's)
  and `build_city.py`'s own (tints, the shading of reveals and soffits, darker near the ground, the house's wear)
  second. The game read the white one, so none of that ever showed. `city.ts` now takes the second. The fronts are
  darker for it, and the wear per house works (the grime pass read 1 everywhere).
- Decals (`build_city.py` MAT_GRIME, material `grime`; `houseGrime.ts grimeDecalMaterial`, cells in
  `cityTextures.ts grimeDecals`): see-through, no depth written, polygon offset, 6 mm off the wall, washed out by
  the fog far off, as strong as the house's wear. Rust runs under every wall anchor, under the downpipes' brackets
  and the shutters' hinges; damp round the foot of every downpipe and under its hopper; grime down both corners
  of every front (not where a doorway is near); soot rising up the piers of the bakers', smiths' and
  wheelwright's fronts and the taverns in the world; soot on the roofs round every chimney. The corner and
  roof decals are in the chunk's own mesh (seen far), the rest near-only.
- Chimneys: stacks, caps and pots black with soot.
- Darker: the wear raised (the alley cottages 0.9 to 1, back streets 0.7 to 1, quays and squares 0.55 to 0.9, one
  house in fifteen decent at 0.3 to 0.45); more soot the higher up the front (from 4.5 m to 14 m).
- The poorest houses (wear over 0.86): now and then a window boarded up (three planks and one aslant in the
  opening) or a sash with a pane gone and a crack (atlas cell 6, 2). Worn houses: now and then a shutter leaf
  gone, or one hanging from its top hinge, tipped.
- Not changed: the geometry of the fronts, the openings, the sign band, the ground, the town wall.

Numbers: `city.glb` 9.7 MB to 9.9 MB; 794,902 to 829,207 triangles (the decals, 34,305).
Checks: `npm run build` (client) passes; `paths()` 29 entries, the same 29 as the committed city on the same test
stack; `signs()` the same as that baseline; the z-fight check 259 visible house fights against 264 before.
Pictures: the same cameras as the grime pass, `data/shots/b12_*.jpg` (before) and `b13_*.jpg` (now, 13:00 clear, and
`b13_row6_night`, `b13_back_night` at 22:00); in the mist as the game has it: `b13_mist16_*` (16:00) and
`b13_mist21_*` (21:00): the row of gables, the back street, the Hessenatie, the Grote Markt, the Werf gables, the
storehouse.
Not done: rust under the hoist beams (the loft's door is under them, no wall to run down).

### Fifth pass: the districts (2026-09-26)
The lead, after the fourth pass: not every street equally dirty. The fine squares kept, the back streets worst.

**The rule** (`build_city.py class_of`, from where the house stands and what it looks onto). The fine places, from
`city.json`, each with a reach: the Grote Markt with the town hall and the guild houses (-254, 94; 48 m), the square
north of it (-262, 132; 32 m), the Handschoenmarkt and the cathedral's square (-262, 175; 50 m and -116, 160; 30 m),
the Stadspark's fronts (-300, 318; 45 m). The street's width is measured from each house's front.
- alley: a cottage in a court or gang. store: a storehouse.
- fine: near a fine place and on the open square, or on a street 12 m wide or more there.
- good: near a fine place on a street 8 m wide or more; or anywhere on a street 22 m wide or more.
- merchant: on a quay or an open square. poor: a street under 6 m, away from the fine places. middle: the rest.

Wear (0 clean to 1 black): fine 0.05 to 0.25, good 0.2 to 0.4, merchant 0.3 to 0.5, middle 0.45 to 0.72, store
0.55 to 0.8, poor 0.75 to 1, alley 0.9 to 1. The grungy wall pictures (old brick, flaking whitewash, rough and
stained plaster) only in the poor streets and the courts. Houses by class: alley 154, fine 38, good 260, merchant
22, middle 406, poor 215, store 7.

**The fine fronts** (index in `city_build.json`, where): the Grote Markt east row #17 to #25 and #27 (x -218 to
-210, z 68 to 118); its west row #49 to #55 (x -289, z 72 to 121); by the Stadspark #613 to #615 and #699 to #702
(z 274 to 283); the Handschoenmarkt and the cathedral's square #872, #876 to #878, #880 to #882, #895, #896, #898
to #902 (x -138 to -94, z 137 to 166). Pilasters on 24 of them (#18, 20, 25, 27, 49, 51 to 54, 613 to 615, 699 to
701, 876, 877, 880 to 882, 895, 899, 900, 902).

**Wall pictures** (`client/public/textures/wall_*.jpg`, one texture array in `houseGrime.ts`, 13 layers of 512 px):
red brick four ways (fine machine brick, old brick, dark clinker, speklagen), yellow brick two (clean, old),
whitewashed brick, plaster three (smooth, roughcast, old stained) and grey render, ashlar two (sandstone,
bluestone). Each class has its own set to pick from, each house picks by its own seed, and a painted wall picks a
colour from a palette (fine: cream, ochre, pale grey, pale green, pale pink, white; worn: dingier). The
picture's index and the paint ride in a UV layer (`Mat`, in the game `gmat`), as a second colour layer broke the
export. GPU memory: 13 x 512 x 512 x 4 bytes = 13.6 MB, about 18 MB with mipmaps.
Codex made the clinker, the roughcast and the speklagen; the other seven stood in from a script while Codex was
out of reach, and Codex made them the same day (below, "Codex wall pictures").

**More in 3D** (near-only):
- fine and good fronts: taller rusticated quoins (9 cm proud), a stone plinth on the piers, a bluestone step before
  each front door (from the pavement to the sill; the door itself as it was);
- fine fronts: a drip hood and a keystone on every door, stone consoles under a flat door's lintel, a gilded finial
  on the top step of a stepped gable, a stone balcony with an iron railing before the middle window of the first
  floor on some, and on some flat stone pilasters with a base and a capital at the corners in place of quoins.
- Not done: chamfered corners (they would change the footprints) and corner niches (the Madonnas in `streetlife`
  are there already).

Numbers: `city.glb` 9.9 MB to 10.1 MB; 829,207 to 849,301 triangles.
Checks: `signs()` 1,557 things, 1,315 checked, 0 problems; `paths()` 29 (as before); the z-fight check 273 visible
house fights (259 before): the new ones where two fine houses' plots overlap and both draw their door dress in one
plane (#896 and #900 on the Handschoenmarkt). `npm run build` passes.
Pictures (before `b13_*`, now `b14_*`, 13:00 clear; `b14_mist16_*` in the mist at 16:00), side by side in
`data/shots/pair_*.jpg`: the Grote Markt (`pair_markt`: the guild fronts clean, cream and ochre, where they were as
dirty as a back street), a middling street (`pair_row6`), a poor back street (`pair_back`: still dark, the corner
house's plaster now old and stained), a corner close up (`pair_quoin_b`); the fine fronts close: `d4_*.jpg`.

## The churches freed (2026-09-26)
Steve: two of the new churches stood shut in by houses, no way to their doors. St Paul's west door (x 140, facing
east) had houses 1 m before it; St James' tower door (x -56, facing east) the same. Carolus was fine.

**The rule.** A house is never deleted from `shared/city_build.json` and the order never changes (homes, taverns,
shops and saves hold house numbers). A house pulled down gets `"gone": true`, and every reader skips it:
`build_city.py` (not built; not counted for the neighbours' walls and fronts), `plan.py` `walk_map` and
`ground_zones`, `server/src/town/walkmap.ts` (no door; `goneHouses()`), `client/src/world/ambient.ts` (no lit
windows, not in the flat-wall test), `occlusion.ts`, `houses.ts` and `tools/city/inworld.mts` (an in-world house
there is an error), `shared/housePlan.ts` (the field), `dev/zfight.ts`, `build_props.py`, `build_streetlife.py`,
`build_quayfurniture.py`. On load (`store.ts rehomeLost`), anyone whose home is in a house pulled down moves to the
nearest free house with the rest of the household, though the old step now lies on open ground. Steve's save had
nobody there.

**Pulled down** (14 of 1,102):
- St Paul's: #194 to #199 (the row before the west door: a square about 9 m deep to the street, 13 m to the
  houses across it, across the whole front); #184 and #185 (a small square before the north transept door, open
  to the street north of the church).
- St James': #465, #493, #464 (the row before the tower: a square 12 m deep and 27 m across the tower and the
  aisles), #449 behind it (the square's mouth onto the street at x -30, 9 m wide, in line with the door); #484
  and #485 (the south transept door onto the street south of the church).
- Kept: the lanes along the other sides. St James' north side and most of St Paul's south side have houses built
  against the church, as they had in 1873; nothing there needs a door.

**What changed with them.** The walk map (`walk_only.py`: only round the two churches; 9 cells near the Stadspark
differ too, from its own newer data, not this). `city.glb` and `streetlife.glb` rebuilt: 38 walls of the pulled-down
houses gone from the street life, 10 blind walls of their neighbours now open to the air (posters, bills; no
windows: their flags as they were). The ground under them was the cobbles already (the ground covers the land
under the houses). The neighbours' street widths changed their class (17 poor fronts now middle or good:
alley 154, fine 38, good 259, merchant 22, middle 410, poor 198, store 7).

**Lamps.** Four gas lamps on the two squares made the lamplighters' east round 1.86 times the shortest (the test
allows 1.2); taken out again. Instead an iron lantern on a bracket beside each of the four church doors, 3.5 m up
(`build_city.py CHURCH_LANTERNS`, the door lantern raised), lit from dusk by `ambient.ts` like the house door
lanterns (`city_gable_windows.json` lamps). The rounds and their tests are as they were. No bench or tree added
(the clutter puts its own by the walls). The church models have no steps before their doors.

Checks: `paths()` lists nothing (0); the church doors reached from the start on the client's map (`reachFrom`);
`signs()` 1,554 things, 1,314 checked, 0 problems (1,557 and 1,315 before: the signs of the pulled-down fronts,
some of them offset by bills on the new blind walls); server tests: `test/churches-freed.test.ts` (no door in a
gone house, the four church doors and the squares reachable, a home in a gone house moves); the whole server suite
passes (845 of 845; the two old-save tests, `lively` and `transport`, now leave the homes the load repair owns
to the repair and check them on their own, `server/test/oldSave.ts`: a home of an older map whose house has no
door at its step; one with no path must move, and a moved one is at a door of this city, reachable, the
household together; everything else must stay as it was); `npm run
build` passes.
Pictures: from above, before and after, `data/shots/pair_ch_paul_top.jpg`, `pair_ch_jacob_top.jpg`; at eye level
`ch3_mist16_*` (16:00, mist: St Paul's west door and square, the square seen from the street, the north transept
door, the north lane; St James' tower door through the square's mouth, the square, the south transept door) and
`ch3_mist21_*` (21:00: dark; the squares have no lamp).

### Review fixes (2026-09-26)
- The old-save tests (`lively`, `transport`, on `data/test-*-old.sqlite`): they failed on the committed code too
  once the copy is there (the load repair of c362aa5 moves a home of an older map; the committed tree without
  the copies skips them). `store.ts` gives `homeLost` and `homeStands` to them; `server/test/oldSave.ts` checks the
  repaired homes on their own. 845 of 845 pass.
- Plaster (Steve's review: "leopard blotches"): on the plaster and limewash pictures the picture's own patches
  are flattened (60 % of it a far mip), and `houseGrime.ts` draws the weathering: soft stains, long and ragged,
  running down; the existing runs under the sills and streaks, the damp rising at the foot; and on a worn house
  (wear over 0.55) plaster fallen off in a few ragged holes with a hard edge, a light broken rim and a shadow under
  the lip, most of them low on the wall. The limewash picture of that day kept its wash but for a few small places
  (since replaced by Codex's, below). Before `b14_back`, `ch3_mist16_j_in`; now `f2_back`, `f2_back_close`, `f4_mist16_back`.
- The bared party walls: old brick (the brick picture, unpainted) and the ghost of the house pulled down
  (`build_city.py ghost_marks`, `gone_along`): a thin film of its rooms' plaster up to its eaves and gable, a dark
  line along its roof and each floor, the soot of its flue and a fireplace's on every floor, scraps of wallpaper
  (a colour to a room), the iron anchors of its beams; bills from the street life as before. New cells in
  `cityTextures.ts grimeDecals` (GHOST, LINE, SCRAP). The decal material now takes the day's light from the fog's
  colour, so a light decal darkens at dusk. Before `ch3_mist16_*`; now `f4_*` (13:00), `f5_n21_*` (21:00).
- Church lanterns: above. Night shots `f4_n21_*`.
Checks: `signs()` 1,554 things, 0 problems; `paths()` lists only 10 places inside the Carolus (its interior,
another part's work in progress, not these squares); z-fight 272 visible house fights (269 before), none by the ghosts or lanterns (round the churches only the old plot overlaps); `npm run build` passes.

### Codex wall pictures (2026-09-26)
Codex back: the seven stand-ins made by Codex, one run at a time (parallel starts had broken its login), from the
same prompts; each checked (the picture asked for, square, 1254 px) and tiled 2 x 2 (seamless: no seam to see; the
brick bond and the ashlar courses run on). Saved at 1024 px under their old names, so the texture array keeps its
order; the script that made the stand-ins is gone. Each tile's size in metres from its own courses (a brick course
about 6.5 cm, a stone course 35 to 40 cm), in `houseGrime.ts WALL_PICS`. Rows in `assets/ATTRIBUTION.md`.

The texture array's layers (`houseGrime.ts WALL_PICS`, `build_city.py WALL_LAYERS`; `client/public/textures/wall_<name>.jpg`),
with the metres of one tile:

| Layer | Picture | Tile | Made |
|---|---|---|---|
| 0 | brick_fine | 2.1 m | Codex, 2026-09-26 (this) |
| 1 | brick | 1.9 m | Codex, the grime pass |
| 2 | brick_clinker | 2.2 m | Codex, the districts pass |
| 3 | speklagen | 2.5 m | Codex, the districts pass |
| 4 | brick_yellow | 1.7 m | Codex (this) |
| 5 | brick_yellow_old | 1.1 m | Codex (this) |
| 6 | brick_white | 1.2 m | Codex (this) |
| 7 | plaster_smooth | 3.0 m | Codex (this) |
| 8 | plaster_rough | 2.5 m | Codex, the districts pass |
| 9 | plaster | 3.0 m | Codex, the grime pass |
| 10 | render | 3.0 m | Codex, the grime pass |
| 11 | ashlar_sand | 2.7 m | Codex (this) |
| 12 | ashlar_blue | 3.2 m | Codex (this) |

Checks: `signs()` 1,554 things, 0 problems; `paths()` lists nothing; server tests 852 of 852; `npm run build`
passes; no geometry changed (the z-fight check as before). Pictures, before (the stand-ins) and after, 13:00 clear,
side by side: `data/shots/pair_codex_markt.jpg` and `pair_codex_markt_e.jpg` (the Grote Markt, both rows),
`pair_codex_pil.jpg` (its fine fronts close), `pair_codex_row6.jpg` (a middling street), `pair_codex_hand.jpg`;
in the mist `g1_mist16_markt`, `g1_mist16_row6`.
