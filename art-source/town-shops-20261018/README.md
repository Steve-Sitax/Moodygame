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
