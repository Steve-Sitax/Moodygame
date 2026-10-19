# Town fronts, step 4 · 18 October 2026

Issues #193 (street plates, wet paint), #174 (shop fronts) and #28 (the Carolus doors, dome and dormers).

## #193 Street name plates

- Cause: the bake named a plate by a hash of its wall's line (the browser's streetlife.ts `streetName`), wrapping round 20
  street names: 9 of 26 names were on the town's 244 plates, Braderijstraat on 50 corners. The town had no street data.
- Streets (`native-godot/scripts/town_streets.py`, written to `native-godot/world/town/facades/streets.json`): the walk
  map's open ground (`world/data/public/city/walk.png`) is thinned to its centre lines and cut at the junctions; pieces that
  run straight on through a junction, or jog at one, are one street. A plate's street is the one whose centre line runs
  along its wall in front of it; a plate opening on a square or quay names the square. 94 streets have plates; names: the
  bake's 20 streets, then 73 more old Antwerp street names (`MORE` in the script). The Braderijstraat corner (x -207,
  z 130) keeps Braderijstraat and Vlasmarkt; the quay road is the Rijnkaai.
- Each plate is as long as its name (the bake's rule: 6 letter cells of 22 mm and 7 for the margins), its end by the corner
  kept; where that runs into a shop board, painted lettering, a hanging sign, a neighbour's front standing forward or a
  downpipe (`pipes-193.json`: the wall iron's columns 3.6-4.4 m up, taken from the city's meshes), the plate slides on
  away from the corner (8 plates) or, failing that, its letters are condensed to at most 85 % (3 plates).
- Pictures: `sign_art.py <art> streets.json` adds the 73 new names after every #175 cell (the #175 cells keep their places,
  so the boards keep their pictures), at 370 texels a metre (the room left in the 4096 atlas). `repair-signs.py <audit>
  <art> <candidate> streets.json` rebuilds the plates from #175's originals (H3's streetlife audit; without streets.json it
  rebuilds the installed #175 meshes byte for byte); `promotion-193-plates.json`: 74 streetlife meshes, sources checked
  against #175's installed hashes. 231 plates renamed, 217 resized.
- Not changed: a few plates sit on the bake's own wall where a grime decal draws over part of them (Repenstraat, x -189
  z 252); see the shop-front step below.

## #193 Painted wood in the rain

- The wood, shutter, shop board and future shop-front materials share the town's solid lit shader (`r000211`), which is
  also the shader the game generates for that kind (goods, models, people2's sack truck). Psx (`Psx.WetPaint`) now adds a
  wet term to that one kind and `scripts/WoodWetRepair.cs` writes the generated code into the resource: one kind changed
  in place (shader check: 150 kinds, `8BBBF7104D0B9BC7` became `39CE47A6510CE729`; baseline updated).
- The term is off unless a material sets `wet_paint`: city_wood 1, kept shutter paint 1, worn (grey) shutter paint 1.35,
  signs 0.8. In rain the paint darkens (40 % linear, 10 % more on faces to the sky) and gives back a thin sheen of the sky
  at a glancing view. Measured on a shutter against the plaster beside it: 0.78 dry, 0.65 in rain (plaster does not darken).
- `promotion-193-wood-signs.json`: originals and installed hashes; originals kept outside the repository.

Pictures: `193-plates-before-after-day.jpg`, `193-plates-before-after-rain-night.jpg` (Braderijstraat, rain and night),
`193-wet-paint-day-rain.jpg`, `193-streets-map.png` (the named streets and the plates).

## #174 Shop fronts, shop windows and front doors

- Cause: the bake drew a shop window as one painted quad (a picture of a shelf of jars, 12 cm back in the wall), a front
  door as one painted quad, and 893 wooden fronts as plain boxes; round them 18,563 pairs of faces lay in one plane (the
  old stone boxes under the stone pass's dressed stone, reveals under wood, wall iron drawn twice): they flicker.
- The kit (`native-godot/scripts/build_shopfronts.py`, 91 parts): pilasters with base and capital, a fascia with a
  moulded cornice, a panelled stall riser and sill, a sash with glazing bars and a transom row, shop glass (a faint dust),
  the display inside (bed, two shelves, back boards, a cloth and a valance), panelled front doors in six sizes (single and
  double, 4 or 6 fielded panels) with a brass knob and letter plate. Every edge is bevelled; wood parts carry the town's
  wood grain. Paint: the bake's own door and sash colours (dark green, oxblood, brown, deep blue, cream), a worn house's
  copy faded and on the worn shutter paint.
- The goods (`native-godot/scripts/shop_goods.py`, 58 models on one 2048 picture): loaves, tarts, cheeses, sugar loaves,
  tea and coffee canisters, open sacks of beans and grain, globes and albarelli for the chemist, bottles, kegs, cigar
  boxes and pipe racks, clocks and watches, boots, hats, bolts and folded cloth, hams, sausages and joints, lanterns,
  rope, keys and padlocks, price cards ("4 c." to "2 fr. 50"), and a display lamp. The fishmonger shows the market's own
  cod, plaice and herring models (one model per good).
- `native-godot/scripts/repair-shopfronts.py <city audit> <streetlife audit> <kit> <goods> <candidate> <churches audit>
  <Carolus room audit>`: finds the 1,758 windows and 977 door leaves by their atlas cells, takes out the painted quads and
  the 33,934 triangles of the old wooden fronts, gives each window its trade (its shop board's words, else its
  neighbours' and street's mix: 18 trades), lays out its display (bed, low and high shelf; price cards; hanging goods) and
  its lamp hours (718 windows lit in the evening, from the bake's lit panes), and adds plain collision boxes to the
  blocks' stand-ins. `native-godot/scripts/zfight_fix.py` cuts the lower of each pair of faces in one plane (within
  1.2 mm, overlap over 2 cm2) round every window and door: 17,329 pairs, 10,792 triangles cut (every attribute read from
  the old triangle), 2,330 dropped; again until none: 27, then 10 (10 pairs that cutting does not part are left).
- In the game (`native-godot/src/World/NativeShopFronts.cs`, `world/town/facades/shopfronts.json`): the outside parts
  merged into one mesh a town block (27 meshes, no collision of their own), the displays and goods as MultiMeshes a 30 m
  cell (shadows off, shown within 20 m); 1,750 windows and 975 leaves (8 windows on razed houses left out). After dark,
  in a shop's hours, its display is lit: lit copies of the materials give back the lamp's warm light times each part's
  own colour, the lamp's chimney glows (same shader kinds). The bake's lit pane over a shop window now gives only a faint
  glow and no glazing-bar shade (`Lights.cs` PaneCode: one kind changed in place, `E2C22237C9AA2E72` became
  `411466874F248060`; baseline updated).
- Promotion (`promotion-174-shops.json`): 138 meshes (98 city, 40 street life) and shopfronts.json; originals and hashes
  kept outside the repository. `FacadesPromote.cs` takes several roots (`--root city,streetlife`) and now keeps each
  surface's box and puts each corner in the middle of its packing step: Godot packs positions in 16 bits in the box and
  cuts off, so a re-saved mesh moved 17-37 % of its corners one step (1.5 mm) and brought cut faces together again. Now
  99.7 % of corners are stored to the bit; only new cut corners snap to the grid (under 0.9 mm).
- After the bake (meshes exported again and scanned round every shop window and door): before 18,563 pairs, 102.5 m2
  overlapping, 6,285 pairs over 50 cm2; after 907 slivers along cut edges, 0.52 m2 in all, none over 50 cm2 (thinner
  than 1 mm); 134 more where one face lies outside the shop-front zone (2.6 m round a window or door, under 4.3 m).
- Frame time (PERF-LOCK, same run, fronts hidden and shown twice each): Braderijstraat GPU 2.62 -> 2.92 ms, draw calls
  +306; busiest shop street (x 39 z 244) GPU 2.44 -> 2.50 ms, +379 draws; Carolus square GPU 2.81 -> 2.90 ms, +146 draws.
  The merged block meshes have no LODs yet (later speed pass).
- Checks: shader check 150 kinds, baseline matched; stuck check (seed 1873) 907 watched, 0 stuck, 0 overlaps, 0 inside
  solids.

## #28 The Carolus doors, dome and dormers

- The Carolus's painted doors (church_carolus_5 and _9 door cells): oak double doors (`church_door_l` / `_r`: three rows
  of fielded panels, a proud meeting stile, wrought-iron ring pulls) over both side doors and the front's east door; the
  Jesuit house's arched doorway a panelled double door under an arched fanlight with glazing bars. The dome's four dark
  discs: a moulded stone ring round each, a cross of glazing bars and dark glass. The four nave dormers: louvres
  (slats tipped to shed the rain) in a frame.
- The Carolus room's shell stands 5-11 cm in front of the painted doors: what showed as a flat grey slab was the room's
  wall. Each door stands 1 cm in front of that shell's face in its opening (the room is not changed).

Pictures: `174-braderijstraat-before-after.jpg` (the Braderijstraat corner at x -207 z 130: day, rain, evening 19:45, night 22:00;
the day "after" is from the first install, the same parts, as the omnibus stood in the final day shot),
`174-shop-window-door-before-after.jpg`, `28-carolus-before-after.jpg`, `28-carolus-rain-night.jpg`.
