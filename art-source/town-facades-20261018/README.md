# Town fronts, step 3 · 18 October 2026

Issues #188 (near detail never shown; stains ignore the light), #176 (shutters), #175 (name plates and shop signs) and
#28 (landmark windows with nothing behind them).

## #188 The near detail and the stains

- Cause: each town block has near-only meshes (`city_X_Z_d_1..5`: sills, heads, shutters, window boxes, shop fronts,
  fanlight bars, 2.58 million triangles of dressed stone, their grime). The browser showed them while the camera was within
  60 m of the block (city.ts `DETAIL_NEAR`); the bake froze that switch as it stood at the moment of export. Three blocks
  near the bake's camera (`city_-1_0`, `city_-2_0`, `city_-2_1`, Braderijstraat) showed their detail at every distance;
  the other 24 blocks (117 of 132 meshes) never did.
- Now `NativeNearDetail` (called from `NativeTown._Ready`) shows all 132 and gives each a GPU visibility range: its own
  radius plus 70 m, with a 12 m dithered fade. A block's detail appears while its nearest part is still 70 m or more away.
  `--no-near-detail` keeps the bake's state for comparisons.
- Collision: detail within 3 m of its block's lowest point (plinths, quoins, door surrounds, shop fronts, cellar hatches)
  is solid as drawn, the dressed stone by its plain stand-in boxes; detail higher up (sills, heads, bands, upper shutters)
  is out of reach and gets none. The grime decals and the window boxes' flowers get none.
- The grime decal shader (`r000218.res`, used by `r000221`) drew each stain unshaded in its own colour times the day's
  overall light: on a wall in shade or by a lamp at night a stain came out lighter or blacker than the wall around it. It is
  now multiplied over the lit wall (`blend_mul`, read against a 0.55 wall), so it darkens the wall's own light: sun, shade,
  rain, lamps. Same shader resource, code changed in place (`scripts/repair-decal-light.gd`; the GLB path's
  `Grime.DecalShader` has the same code). Original: see `promotion.json`.

Checks (real town, disposable saves):
- Frame time unchanged (6.94 ms, the 144 Hz cap) in seven views; GPU +0.05 to +0.20 ms per view; primitives +0.4 to
  +0.7 million per view; video memory unchanged (the meshes were loaded before, hidden). Measured with the PERF-LOCK held,
  detail toggled in one session (`--stone-corners-detail-toggle`).
- Collision: 9,641,466 to 10.1 million triangles; stuck check PASS (seed 1873, three hours).
- Shader check: 150 kinds before and after; the decal kind changed code in place (baseline updated).
- The razed houses (536, 537) show no detail: their detail vertices carry the house's alpha and are cut with the rest.

Pictures: `188-detail-before-after-day.jpg` (a street with hidden detail, before and after), `188-stains-*` (brightened
for viewing only; taken with a 0.45 reference wall, the installed shader reads against 0.55: the stains are a little
darker than shown).

## #176 The shutters

- The bake's shutters were flat boards in each block's `city_X_Z_d_1` mesh: a 64-pixel atlas cell (4,2 louvred, 5,2
  panelled) on a front quad, and two 30 mm side quads for an open leaf. 7,730 leaves in 25 blocks: 4,959 open (beside the
  window, 55-85 mm off the wall), 2,771 shut (in the opening, 35 mm back); two heights only (1.815 and 1.868 m).
- One model per kind (`scripts/build_shutters.py`, numpy/scipy; `build-shutters.gd` makes the meshes with the engine's
  LODs): stiles 72 mm and rails 125/90/85 mm as separate chamfered pieces (3 mm arrises), 42 mm thick louvred leaves with
  38 slats at 45 degrees (1.5 mm arrises, housed in the stiles), 34/30 mm panelled leaves with two fielded panels a side.
  Five width buckets (open 0.32/0.385, shut 0.45/0.56/0.70 m); a copy is stretched at most about 10 % across. The leaf
  looks the same from both edges, so a leaf hinged on the other side is the same model turned round, never mirrored.
- Iron (the town's wall iron `r000615`, no shader change): strap hinges with a rolled eye, a round end and three domed
  nails on the bottom and top rails; pintles with a cap on a square arm leaded 40 mm into the wall; a pivoting shutter dog
  in the wall over the free edge. A tipped leaf on a worn house hangs from its top hinge only and has no dog. The iron
  casts no shadow (a few centimetres across; it saves the shadow pass's draws).
- Paint (`scripts/shutter_paint.py`): a 2048 x 1024 painted-wood picture with its height map: lead white with brush marks
  and the wood's figure, the left half a kept house's paint, the right half a worn house's flaking to grey weathered wood
  with primer round the flakes. Two copies of the town's wood material (`city_wood`, same shader: no new kind) read the
  halves; a house over alpha 0.6 gets the worn one and its colour fades a quarter toward grey. Each copy carries its house's
  paint (the bake's vertex colour, brought to the old tone: measured in the game by day and at night).
- `NativeShutters` places them from `world/town/facades/shutters.json` (`repair-shutters.py`): MultiMeshes per block and
  model (307 for the leaves, 75 for the iron), each with its block's near range. A razed house's leaves go with it.
- The flat boards were taken out of the 25 `d_1` meshes (35,296 triangles; 2,264 left: other small fronts' pieces) with
  `facades-promote.tscn`; each leaf's plain collision box was added to the mesh's stand-in (92,760 triangles; only those
  within 3 m of the block's foot are used, see #188). `promotion-176.json` has every original and installed hash; the
  originals are kept outside the repository and in git at the commit before this one.

Checks (real town, disposable saves):
- Pictures: `176-*` (before and after, day; rain and night installed). The tone matches the old boards by day (84.6 against
  81.6 grey on the leaf) and at night (12.2 against 10.6). Rain does not darken the paint (the wood shader has no wet
  term; the old boards on the wall shader did).
- Timing with the PERF-LOCK held, but two other helpers' game windows were running, so frame times are not comparable
  (about 20 ms in both states): GPU +0.04 to +0.22 ms per view, draw calls +43 to +141 (shadow passes included).

## #175 Street name plates and shop signs

- The bake drew them from the street-life atlas (256 x 512, nearest-looking 5 x 7 pixel letters): a plate as a 16 mm box
  with an 11-texel picture of its name, a shop board as a 50 mm box with two trims, lettering on plaster as one decal quad,
  a bracket sign as a few boxes and tubes. Each is found by its front's atlas cell (the bake's streetlife meta,
  `assets/game-models/streetlife.extras.json`), taken out with its box, and built again at the same place and size
  (`scripts/repair-signs.py`): 244 plates, 245 boards, 24 painted letterings, 121 bracket signs in 74 street-life meshes.
- Pictures (`scripts/sign_art.py`, 4096 x 4096 compressed, its height, and a 2048 x 1024 picture for the painted
  lettering): every street and square name in Old Standard TT Bold on white enamel with a blue line, chipped to rust at
  the rim and the screw holes; every board in its trade's colours with a fine line, the trade in Alfa Slab One and the
  owner's or house's name in Old Standard, gilt letters shading down, a dark shadow to the lower right (sign-writer's
  relief). Both fonts are SIL Open Font License fonts already in `native-godot/fonts`. Texts unchanged: trades in
  English, names Dutch.
- A plate: pressed enamelled iron, a rim rolled 8.5 mm proud with rounded corners, the face 5 mm off the wall, two domed
  screws. A board: a lettered panel 60 mm off the wall, a cornice over it with a sloping top and a drip, a bead under it
  (gilt on a gilt-lettered board), returned ends, in the board's own colour.
- A bracket sign (`scripts/build_signs.py`): a flat wall plate with two bolts, a 22 mm square arm 1.04 m out with a gilt
  ball, a round stay and two C-scrolls of flat bar, rings and chains, in the town's wall iron (rain glosses it); under
  it the trade's sign, kind read from the old one's colours: pretzel (a gilt rope knot twisted once), key (bow, collars,
  warded bit), lidded pewter tankard, boot (black, gilt band and welt), top hat with a red band, the barber's brass basin.
- Materials: copies of the street-life materials (`streetlife_solid`, `streetlife_walldecal`) with the new pictures, the
  wall iron for the brackets: same shaders, no new kind. The new surfaces are skipped by collision (all over head height).
- Lit at night by the lamp spill like the rest of the street (a board over a wall lantern is lit, one far from a lamp
  stays dark).
- Triangles in the 74 meshes: 202,511 to 509,013 (the bracket signs are about 2,500 each, half of it iron: scrolls,
  chains). `promotion-175.json` has every original and installed hash; `signs-175.json` lists every sign and place.

Found, not changed: the plates use 9 of the 26 names (the browser's street index wrapped round): BRADERIJSTRAAT is on
50 corners, ZAKSTRAAT on 54, KUIPERSSTRAAT on 47, MAALDERIJSTRAAT on 46; the names do not follow the real streets.

Pictures: `175-plate-board-before-after-day.jpg`, `175-night-rain-before-after.jpg`, `175-hanging-signs-installed.jpg`.

## #28 Landmark windows with nothing behind them

What was still open (the issue's comments): the Steen (its big room build was stopped by Steve on 2026-09-29: a cheap
outside fix instead), and at the Carolus painted doors, the dome's four dark discs and the nave roof's four louvred
dormers. The Vleeshuis attic, the town hall's dormers, the Oostershuis, the cellar and the three churches were done in
the browser game (2026-09-29) and are in the native town.

The Steen (`scripts/repair-steen-windows.py`, `build-steen-glass.gd`):
- Its windows over parts with no inside (79 panes in `steen_glass`: the gatehouse's upper storeys and gable, the river
  range's great hall, the towers and turrets, the barred windows) were opaque leaded glass flush with the wall's face,
  their picture painted with reflections. Each pane now sits back in a real reveal: 66 move into the wall, 11.7 cm on average (12 cm, less
  where a wall behind leaves less room: rays inward stop 5 cm short of the building's own surfaces), the reveal's sides
  in the Steen's sandstone in shade; 13 in walls too thin stay where they were. The iron grilles stay in front.
- The glass picture is clean dark crown glass in diamond cames, each quarry its own shade, no painted reflection, on a
  copy of the Steen's own glass material (same shader: no new kind). It is as dark at night as before.
- Tried and dropped: see-through glass (the rooms' window-glass shader) with a dim room behind. That shader adds its own
  sky and fog tone, so the panes came out lighter than the wall at night; the rule is glass dark at night.
- Its two museum boards (5 x 7 pixel letters in its 256-texel atlas) are drawn again in Old Standard TT at 2048 texels;
  the rest of the atlas is the old picture enlarged (a copy of its atlas material).
- `promotion-28.json`: the two meshes' original and installed hashes; originals outside the repository.

Not done (the Carolus): the "painted doors" at its side and the Jesuit house draw as plain grey slabs in the native game
(the painted door picture is not what shows; something draws a flat grey leaf over it); the cells I found for "windows"
on its front are the backs of statue niches; setting them back changed nothing that shows. The nave roof's louvred
dormers have the roof right behind them (no room for a reveal); the dome's discs are about 20 cm across. None changed.

## Final checks (all four issues installed, disposable saves, 2026-10-18)

- Shader check PASS: 150 kinds, the same as the baseline after #188's decal change; no new kind.
- Stuck check (seed 1873, three hours): PASS on the third of three runs. Run 1: one walker paced on the spot on the
  Rijnkaai (x -2, z 69; nothing of this work within 1.9 m or under 4.4 m); run 2: two people inside a market stall's body
  at the Handschoenmarkt (`street_trade_lv005`, not part of this work). Both look like the known random failures.
- Frame time with the PERF-LOCK held, near detail and shutters toggled in one session (another helper's game window ran
  meanwhile; frames 13-17 ms in both states): frame time unchanged within noise (-0.3 to +0.5 ms), GPU +0.11 to +0.26 ms
  per view, render CPU +0.03 to +0.17 ms, draw calls +88 to +186, video memory +51 MB against the session before the
  shutters and signs. Collision 9,641,466 to 10,076,679 triangles.
- Steve's Braderijstraat view (x -207, z 130): `braderijstraat-shutter-before-after-day-night.jpg` (a shutter there,
  before and after), `braderijstraat-installed-rain-night-plate.jpg` (the street in rain and at night, the plate).
