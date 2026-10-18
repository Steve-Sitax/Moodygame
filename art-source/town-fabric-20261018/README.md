# Town fabric, step 1 · 18 October 2026

Issues #161 (Vleeshuis roof), #173 (ground-floor corner stones by wooden shop fronts) and #171 (the rest of the stone).

## #161 The Vleeshuis roof

- Cause of the dark blob: a recovered room object (`room-vleeshuis-source-9092-0`, kind `cask`) holds the whole hall's
  room furniture, 46 x 30 x 20 m. `FurnitureVisual` swapped every cask for the one shared keg and scaled it to the
  object's size: one keg over the whole roof. The same fault: two casks in the Oostershuis (63 m long), one 19 m row of
  casks in the Vleeshuis, a clock over the prison (26 x 15 x 56 m). A cask group over 2.2 m and a clock group over 3 m now
  keep their own authored models.
- The rooms' window glass (one baked shader, `r006245.res`, 39 materials) was unshaded: the leaded panes kept their
  midday grey all night. `native-godot/scripts/repair-room-glass.gd` gives it the sky's light (`psx_fill`) and a sky
  reflection at a glancing view. Original: `original-resources/r006245.res`.
- The slate roofs, stepped gables with copings, turret spires and tracery were already in the model; the keg hid them.

## #173 Ground-floor corner stones beside shop fronts

- Cause: a ground-floor quoin beside a wooden shop front runs 0.2 m into the wall (it lines the shop window's reveal).
  The #157 tool found each stone's wall from the stone's middle; for these stones that is nearer the reveal's plane, so
  the stone seemed 19 cm proud (the limit is 15 cm) and was left as an old box. Now a second try measures from the
  stone's own face. 247 more courses town-wide; the Braderijstraat corners (x -200, z 124 and 132) go from 16 and 21 to
  29 and 31 courses, down to the blue stone plinth, beside the shop front's frame.

## #171 The rest of the stone

`repair-stone-corners.py` pass 2 (STONE_157_ONLY=1 builds the first pass only), from the originals of #157:

- Bands, string courses, cornices, flat heads and thin sills: the section is read from the old piece and run as single
  stones with 10 mm joints, chamfered long arrises (660 bands, 105 cornices, 8031 heads or sills).
- Pilasters and strips: courses on the wall's brick beds, chamfered; a mullion or narrow jamb as long stones
  (139 pilasters, 3761 strips).
- Arched heads: the face's outline cut into voussoirs with radial joints round the arch's centre (31).
- Panels, blocks and fanlight bars: one bevelled stone each (1382 panels, 553 fanlight bars).
- Every other stone piece (scrolls, capitals, a cornice's return, reveal linings): its own shape on the dressed stone,
  sharp arrises chamfered 4 mm, smooth across shallow angles (23297 pieces). So a front never shows two
  stones side by side. Pavement aprons and kerbs stay on the old stone (its slab picture).
- Each stone keeps its old stone's colour (COLOR.gb in the dressed shader): warm sandstone stays warm, a black front
  stays dark.
- The walls' foot grime (`scripts/repair-wall-foot.gd`, original `original-resources/r000195.res`): it ignored the
  house's wear (`foot_wear` 0) and ran evenly along every wall. Now it rises with the wear, comes and goes along the
  wall, is mottled and ragged; the stone's damp line sits a little below it.

Totals: 73 meshes; 4,362,592 dressed-stone triangles (#157: 2,168,766), 1,043,216 old ones removed.
Installed with `stone-corners-promote.tscn -- --reuse-material --backup <outside git>`; `promotion.json` has the hashes.
The replaced meshes are #157's (in git at 5c951e26); its originals are in `../stone-corners-20261017/original-resources.zip`.

Checks (real town, disposable save, 2026-10-18):
- Frame time unchanged (8.33 ms, the 120 Hz cap) in three views; GPU -0.17 to +0.31 ms per view (mean about +0.1).
- Video memory +132 MB; mesh files 101 MB to 167 MB.
- Collision: 9,712,742 to 9,732,432 triangles (+0.2%), 3,006 shapes; build 7.7 s.

Not done:
- Stone outside the city chunks: the churches, the prison and the town places use their own landmark materials; the
  town wall had its own pass (`../environment-20261013/wall-circuit`). They need a landmark-by-landmark pass.
- The recoloured ornaments (scrolls, capitals) keep their old simple shapes; only their arrises are chamfered.
- An arched head's stepped soffit becomes one depth.
- The wall's foot band is softer and follows the house, but still reads as a band on some kept walls.
