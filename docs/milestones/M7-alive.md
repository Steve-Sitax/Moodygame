# M7 alive: the town's small life (not people), 2026-09-26

Steve (2026-09-26, away, carte blanche): "Research more good ideas to add to make it all feel more
alive, and implement." This part: the life of the town that is not people, shops, interiors, the prison
and squares, the omnibus or the churches (other helpers had those the same day).

## Research (reference only; nothing copied)
What was read, in short (web, 2026-09-26):
- Baedeker, *Belgium and Holland*, c.1871 (archive.org full text): Napoleon's quays a popular walk, the
  fish auction 7-9, the steam ferry to the Tete de Flandre every quarter hour, drawbridges over the inner
  canals, shops by the docks with English, Spanish and French signs, the carillon at each quarter.
  https://archive.org/stream/belgiumhollandha00karl/belgiumhollandha00karl_djvu.txt
- The quays before 1877: still the old broken line of walls, inlets and landing places.
  https://nl.wikipedia.org/wiki/Scheldekaaien
- Horses in 19th-century Antwerp: the naties' Brabant draught horses, dog carts, the horse tram opened
  May 1873 ("the American"), cab stands. https://oudedokken.gilbertus.com/pdf/010.pdf
- Pigeon racing: Antwerp was one of its cradles (a society in a tavern from 1825); by about 1870 some
  10,000 lofts in Belgium; lofts in attics and on roofs; autumn is the end of the season.
  https://faro.be/sites/default/files/pdf/pagina/2000_3_adellijkevleug.pdf , https://london-overlooked.com/pigeons/
- Jackdaws nest in chimneys and church lofts. https://www.natuurpunt.be/soorten/vogels/kauw
- Gulls: black-headed gulls over the river in winter plumage; roof-nesting gulls are a 20th-century habit.
  https://www.ecopedia.be/dieren/kokmeeuw
- The Scheldt's fairway was marked with buoys carrying bells or horns for centuries; lightships downriver.
  https://magazine.antwerpen.be/open-monumentendag-2024/en-route-via-de-schelde
- Screw steam tugs from 1870 (Gerling's towing company). https://nl.wikipedia.org/wiki/Unie_van_Redding-_en_Sleepdienst
- Facades: plastered, wood or iron shutters, hoisting beams in the gables. https://inventaris.onroerenderfgoed.be/themas/14754
- Breweries round the Brouwersvliet (the Brouwershuis pumped their water), sugar refineries round the
  Suikerrui: steam and smells. https://nl.wikipedia.org/wiki/Brouwershuis_(Antwerpen) , https://fabriekofiel.com/antwerpen-2/
- Open sewers (ruien) until 1882, pumps and wells until piped water in 1881.
  https://nl.wikipedia.org/wiki/Antwerpse_ruien , https://etwie.be/nl/kennisbank/nieuws/135-jaar-antwerpse-waterwerken
- Ship lights: the 1863 international rules (white masthead light for steamers, red port and green
  starboard side lights, a white riding light at anchor): general maritime history, not Antwerp-specific.
- Period photos: https://commons.wikimedia.org/wiki/Category:Antwerp_in_the_1870s

## The list (22 ideas), what is done and why not
Checked first against what exists (ambient.ts pigeons on the squares, gulls, smoke by the hour and wind,
rain and puddles, lit windows; animals.ts dogs and cats; litter.ts rats; trees3d.ts falling leaves;
lively.ts knife grinder, cats on sills; trades.ts forge; boats.ts funnel smoke; the foghorn and bells).

| # | Idea | Done? |
|---|---|---|
| 1 | Wind gusts sweeping across the town, and autumn leaves and paper blown along the streets | yes |
| 2 | Racing-pigeon lofts on the roofs of the gangen, the flock's rounds over the roofs | yes |
| 3 | Jackdaws on the ridges and cold chimney pots, tumbling round the roofs | yes |
| 4 | Sparrows in the street, flitting off when you come near | yes |
| 5 | Ships' bilge pumps: water gushing from the hull in time with the pump | yes |
| 6 | Buoys along the fairway, two bell buoys ringing as they roll; two mooring buoys off the Werf | yes |
| 7 | Ships' lights at night: riding lights, masthead and red/green side lights on ships under way | yes |
| 8 | Mist lying on the water at dawn and dusk | yes |
| 9 | Water dripping off the eaves in the rain and after it | yes |
| 10 | Thunder and lightning on a storm day | yes |
| 11 | Breath in the cold: Jef's own, the horses' (and a horse blowing out) | yes |
| 12 | Cats' eyes shining in the dark lanes, gone when you come close | yes |
| 13 | Bats at dusk over the water and the trees | yes |
| 14 | Moths round the lit lamps on a still night | yes |
| 15 | A tawny owl in the trees at night (heard only) | yes |
| 16 | House shutters closed at night, opened in the morning | no: the shutters are baked into the city model (build_city.py, always open); needs a city rebuild; shop fronts are another helper's |
| 17 | Washing that sways in the wind, and is taken in before the rain | no: the washing lines are merged into street life and clutter chunks; needs their merge split (a later pass, with the owners of those files) |
| 18 | Weather vanes turning with the wind | no: a few pixels at roof height at 480x270; no Antwerp source found |
| 19 | Posters peeling, new ones pasted | no: the bills belong to game/ideas.ts and street life |
| 20 | Hanging signs swinging and creaking in a gust | no: shop signs (another helper), merged in street life |
| 21 | Steam from the breweries by the Brouwersvliet and the sugar refineries | no, time: a good next one (vents on those blocks at work hours) |
| 22 | The steam ferry to the Tete de Flandre every quarter hour | no: river traffic and the Steenplein landing are bigger work |

Also noted, not mine: in one test load the first dray of the quay traffic reported x and z NaN
(`world.traffic().sounds()` and its horse's matrix), perhaps a dray away on an errand; the breath skips
NaN horses. The research says gulls did not sit on the town's roofs in 1873 (ambient.ts puts
seven on cold chimneys by the river); the omnibus helper may want the 1873 horse tram.

## What was added
All in new files: `client/src/world/alive/` (one per theme) and `client/src/audio/aliveSounds.ts`.
Hooks, each marked "M7 alive (hook)": `main.ts` (create, the frame, the kit's `step()`, the view
height, `__scheldemist.alive`), `audio/soundscape.ts` (`placed()`: a code-made sound at a place with
its own reach; `ear`), `world/ambient.ts` (`chimneys()`, `smokeLevel()`).

| Part | File | What it does | Time and weather | Sound (made in code), its reach |
|---|---|---|---|---|
| Wind | `alive/wind.ts` | The steady wind is ambient.ts's (same formula: the leaves go the way the smoke goes). Gusts: a front sweeps across the town along the wind, 2-6 s, passing Jef as it goes | every 70-160 s in fog, 30-70 s mist, 14-40 s clear, 8-22 s rain, 3-9 s storm | none of its own |
| Leaves and paper | `alive/leaves.ts` | 96 leaves and 8 scraps of paper within 26 m, more near the trees; a gust lifts them one after another, they tumble with it, pile against the walls, settle; laid again ahead of Jef as he walks. 1 draw call | wet ground: they stick (a gale moves them) and go dark | a dry scrape where 3+ move within 8 m: ref 1.5 m, reach 6, silent past 8 m |
| Pigeon lofts | `alive/lofts.ts`, `alive/roofs.ts` | 12 plank lofts (landing board, two flight holes, a pole) on the back slopes of cottages in the gangen and on flat roofs; 16-24 birds each. Two rounds a day per loft (about 7:40-9:20 and 14:50-16:30, each its own): the flock goes up off the board, circles 25-50 m round at 18-25 m up for half a game hour, wheeling and swooping, then lands and goes in. Only lofts within 220 m fly. Huts: one mesh | dry days only (no fog, rain, storm), daylight; at night all inside | wings clapping as the flock goes up: ref 3, reach 30, silent past 60 m |
| Jackdaws | `alive/jackdaws.ts` | Up to 26 on ridges and cold chimney pots (a chimney that smokes has none) within 70 m; they turn, hop along the ridge; every 12-40 s a few go up, tumble round and land elsewhere | by day; roost from dusk; in rain fewer flights | "tchak" in flight, now and then from a roof: ref 3, reach 60, silent past 120 m |
| Sparrows | `alive/sparrows.ts` | Three flocks of 5-9 on open ground by a wall, 12-30 m off; hop, peck, turn; within 4 m (6.5 running) they flit together 8-15 m away from you | day, not heavy rain or storm | chirps: ref 1.5, reach 10, silent past 18 m; a small wing flutter on flushing |
| Cats' eyes | `alive/night.ts` | Up to 6 pairs of green-gold points by a wall (mostly in narrow lanes and yards, never within 11 m of a gas lamp), 7-21 m off, blinking; within 5 m they are gone and turn up elsewhere | night (dark > 0.75), not storm or heavy rain | a hiss (one time in three) when you come close: reach 5, silent past 7 m |
| Bats | `alive/night.ts` | Up to 6, hunting over water or trees near Jef at 3-8 m up, jinking | 17:24-19:54 and 4:54-6:24; not rain, storm or wind; half in fog | none (their calls are too high to hear) |
| Moths | `alive/night.ts` | 5 per lamp at the 10 nearest lit lamps within 28 m, orbiting the glass, flickering | still dry nights; fewer on a cold one | none |
| Owl | `alive/night.ts` | A tawny owl in a tree 60-180 m off (the squares, the ramparts): the long hoot and the wavering "hu-hu-hoooo", or the female's "ke-wick", every 35-115 s | 19:30-5:30, not rain or storm | ref 5, reach 120, silent past 260 m (owls carry) |
| Buoys | `alive/water.ts` | 7 on the far edge of the fairway (z -117..-121, clear of the lanes at -84/-100 and the liner), red cans, black cones, two bell buoys with a cage and bell; 2 mooring buoys off the Werf. They ride the waves (heave, roll, pitch from the water's slope) | sea state: more rolling and ringing in a storm | the bell as it rolls, 1-4 strokes (inharmonic partials): ref 8, reach 250, silent past 650 m, no house occlusion (over water) |
| Ships' lights | `alive/water.ts` | A white riding light forward on the 8 ships lying in the stream; on ships under way (world.boats().moving()) a white masthead light (steamers and big ships) and red port / green starboard side lights; the anchored liner two white. Glows seen through three fog lengths | from dusk (and on fog days from the late afternoon) | none |
| Bilge pumps | `alive/water.ts` | 5 moored ships (the brig at the Rijnkaai, the barques, the steamer) pump now and then (14-33 strokes, every few minutes when Jef is within 90 m): water arcs out of the hull side under the rail into the river on each down stroke; the outlet rides the tide with the hull | not deep night | the brake's clank, a creak and the gush, in runs of six strokes: ref 2, reach 25, silent past 45 m |
| River mist | `alive/water.ts` | 70 low wisps on open water (clear of hulls) within 70 m, drifting with the wind, fading in and out; faded close to the eye | dawn 4:18-9:48 (full from 6:06), a little at dusk, all day on a fog day; none in rain, storm or wind | none |
| Drips | `alive/eaves.ts` | Drops off the street eaves (side roofs, flat roofs' cornices, the front corners of gabled houses) within 16 m: thin short streaks the colour of the air a little lighter (by a gas lamp its glow; nothing in the dark), fewer off a kept house, a few flecks where they land. Broken gutters (2026-09-26, Steve: "drops from gutters but they were really white ... make it more a 'stream' from one side for badly maintained buildings"): a worn house (its wear from the city's vertex colours, build_city.py wear_of) has by its own dice (about 1 in 4 of the poor lanes and alley cottages, 1 in 5 worn storehouses, 1 in 10 worn middle houses, never the fine squares) one leak near one end of its eave: a thin wobbling stream of fast streaks with a lit and a shadow thread, splashes at its foot, a damp streak down the wall under it and a wet patch on the ground (stains stay when dry, darker when wet), clear of windows, doors, passages, stalls and street life's signs. 1 draw call for all the water, 1 for the stains; `__scheldemist.alive.gutters()` (dev/guttercheck.ts) checks every stream's top against its eave and its foot against the ground, walls, doors and stalls: must list nothing | drops in rain and 4 real minutes after it while the ground is wet; streams full in a shower, a trickle for 8 minutes after | a plink when a drop lands within 5 m: ref 0.8, reach 3, silent past 5 m; a soft splatter at the nearest stream's foot within 5 m (same reach) |
| Thunder and lightning | `alive/air.ts` | A strike 0.8-6 km off: two or three flickers of the air and the sky (the fog colour and the sky light), then thunder after d / 343 s: a crack when near, a long low roll when far | storm days every 15-55 s; now and then (150-400 s) in a heavy shower | the thunder is heard anywhere (from the air, 300 m out that way) |
| Breath | `alive/air.ts` | Jef's own: a small cloud at the bottom of the view every 3.4 s (1.6 s hurrying). The horses (traffic drays, the goods train, the omnibus; found by their instanced meshes) blow bigger clouds from the nose every 2.6-4.2 s within 25 m | cold: 20:00-9:30 (easing), most under a clear sky and in fog | a horse blowing out now and then within 12 m: ref 1.5, reach 8 |

### Dev
`__scheldemist.alive`: `info()` (every part: counts, where, levels; `errors`), `setOn(false[, name])`
(all or one part), `wind.force = true` (a gust now), `parts.find(p => p.name === "lofts").fly(eye)` (a
round now at the nearest loft), `...("bilge").pumpNow()`, `...("storm").strike(km)`.
Test tip: the kit's `run()` updates the world without a camera, so the ambient rain does not move
there; to test rain, run `world.update(t, dt, camera)` in a loop (or use the real frame).

## Checks (test stack "ideas", 8955/5355)
Pictures in `data/shots/`, prefix `id_`:
- Leaves: `id_leaves_on.jpg` / `id_leaves_off.jpg` (same view, part on and off), `id_leaves_gust.jpg`. In a
  forced gust 15 of the leaves within 8 m moved at once, settled after it.
- Pigeons: `id_flock_1.jpg` (the flock over the roofs from the lane, 8 s into a round), `id_loft_2.jpg`
  (a loft on a cottage roof: planks, board, birds on it). First version read as a pale chimney: colours
  were linear; now sRGB-converted and planked.
- Jackdaws: `id_daw_1.jpg` (small and black on the roofs, as they are).
- Sparrows: subtle at their size (0.26 m span, a 10 cm body) on dark stones: specks that hop, as they are.
  A scaled test showed the wing fold was made for a gull's size (fixed thresholds in metres): a sitting
  sparrow's wings stood up like blades. The fold now works in each bird's own size (`Flight` span,
  `uBirdK`), and the small birds have fuller bodies (`birdShape` plump). `id_sparrow_inst.jpg` (before),
  `id_sparrow_fix3.jpg`/`fix4` (after).
- Bilge: `id_bilge_1.jpg` (the brig's side at the quay), `id_bilge_3.jpg` (a barque from the water). First
  version poured from under the waterline at low tide (the table's freeboard over the water); now the
  outlet rides the hull's own height (measured on boats.glb: the widest point under the rail).
- Night: `id_shiplights.jpg` (the brig's riding light), `id_moths2.jpg` (specks round a quay lamp),
  `id_eyes.jpg` (a pair by a wall; now kept to narrow lanes and yards).
- Storm: `id_storm_b.jpg` and `id_storm_f.jpg` (the same view, before and in a flash).
- Dawn: `id_mist_dawn.jpg` / `id_mist_off.jpg` (the Werf quay at 7:10 in mist); round domes by the hull
  in the first version: now spawned clear of hulls, softer, faded near the eye.
- Breath: `id_breath_jef.jpg` (first version: a big round blob: now a third the size, fainter, low in the
  view), `id_breath_horse2.jpg` (the dray horse's cloud at its nose, 7:05 clear).
- Bats: `id_bats.jpg` (small dark shapes over the canal at 18:40).
- Buoys: `id_buoy_bell.jpg`, `id_buoy_can.jpg` (from the water, midday). From the quay they are past the
  fog most days: they are heard (the bell) more than seen.
- Drips: `id_drips*.jpg`; in the rain they are lost among the rain streaks; after the rain they show near
  the walls; mostly heard. Broken gutters (2026-09-26): 51 streams in town, the gutter check lists nothing (with
  the markets up at 10:00 too); both parts together 2 draw calls, 0.05 ms of script a frame in a back alley in rain.
- Leaves in a gust, a short clip: `id_leaves_clip0..3.jpg` (0.35 s apart): a scrap of paper tumbles across
  the Steenplein, leaves lift by the tree pits. Paper made a duller, yellowed white after the clip.
- Lofts after the fixes: `id_loft_v0..2.jpg` (planked hut, flight holes, the board; birds on it).
- `paths()`: `[]` (nothing here walks or blocks: no colliders are added).
- `zfight({ list: 40 })` (5.6 min, the whole scene): nothing new from these parts but 2 pairs "alive_leaves +
  streetlife: back to back" (0.08 m2): leaves lying on the flat street decals. Now drawn with a
  polygonOffset and 2.5 cm up. "alive_lofts: layer on" 119 close pairs, all hidden (inside the roofs).
  The hut's roof had a second face on the same plane and the board an underside 1 mm under it: removed.
- Sound, measured (OfflineAudioContext, each maker's peak at the source, i.e. at `ref`): leaves -16 dBFS
  (then halved: -22), wings -20, chirp -20, jackdaw -23, drip -21, hiss -15, bell -11, bilge -25, owl -20,
  snort -32, thunder near -15 (x1.4), far -26. In the game at distance (analyser on the spot's output,
  clear weather): leaves -32 at 2 m, -58 at 7 m, silent past 8; chirp -34 at 3 m, -44 at 12, -53 at 15,
  silent past 18; drip -42 at 1 m, -56 at 4; bell -42 at 100 m, -46 at 300, -68 at 600; jackdaw -48 at
  20 m, -55 at 60, -76 at 110; owl -48 at 60 m, -60 at 150, -81 at 250; bilge -39 at 5 m, -52 at 20,
  -103 at 40; snort -52 at 4 m. (A hidden tab's timers run once a second, so short sounds were missed
  now and then; those were measured offline.)
- `npm run build` passes. The server was not touched.
- Perf, one load, alive on vs off (`__scheldemist.perf(60)`, 960x540): Grote Markt 13:00 clear 11.2 vs
  10.3 ms, then 8.6 vs 8.4 and 9.7 vs 10.2 (noise); Rijnkaai 7.5 vs 7.6/8.7. +5 to +12 draw calls. CPU of
  `alive.update`: 0.16-0.24 ms a frame (Grote Markt, Rijnkaai, Vismarkt at night, a storm on the quay).
