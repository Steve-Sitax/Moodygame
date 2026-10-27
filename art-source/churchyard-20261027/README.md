# St James's churchyard made larger · 27 October 2026

Steve: "You could make the cemetery a bit bigger on one side and put premium graves in for important people, maybe even
sort of cellars like there were in the time."

## Where

The yard (`townplaces.json` "stjacob_yard": two small railed plots against the church) grows over the plots of the razed
houses 459 to 461 (church-squares-20261027), from the old east plot's rail (x -94.6) to x -76.0, z 334.4 to 343.4:
167 m², twice the old plots together. The old east plot's rail on that side is taken out of the baked railing, so the old
plot and the new ground are one yard. Kerbed railings like the old ones (the same heights and bar spacing, the same dark
green paint) close it; a blue-stone kerb now runs under the old plots' railings too.
The keizer omnibus passes 2.7 m beyond the south railing; route audit 0 hits.

A gravel walk runs from the old plot's west gap through both, edged with small stones; a second walk runs to a new gate in
the south railing (two blue-stone piers with caps and balls, iron leaves standing open into the yard).

## The graves (scripts/churchyard.py, churchyard_kit.py; models assets/models/churchyard)

The churchyards took their last burials before the Emperor's edict of 1784; Kiel and Stuivenberg opened in 1786 (Sint-Jacob's parish buried at Stuivenberg), and Kiel became the town's cemetery on 1 January 1875. So all are old, weathered blue
stone (the town stairs' stone; the vaults' walls the town plinths' coursed ashlar), with soil splash and damp at the
foot, moss on level and low faces, pale lichen spots, rain runs under the tops. Every stone arris is rounded 8 to 15 mm,
iron 2 to 4 mm. Invented families; Latin formulas cut into the stone's own picture (Old Standard TT, SIL OFL):

- **Vault chapel, Moens** (`vault_chapel`): plinth, coursed walls with corner pilasters, cornice, gables and a roof of
  stone slabs with their joints, a ridge roll and a stone cross; a plated iron door with straps, rivets, ring and keyhole
  up two steps; "SEPULTURA FAMILIAE MOENS" on the lintel; an epitaph tablet on a corbel on its side.
- **Stair vault, Van Ertvelde** (`vault_stairs`): four worn steps down between coped parapets to a plated iron door in a
  pedimented portal (1742), the vault's barrel hood of three stone courses behind; a locked gate with spear heads and a
  padlock across the top step. The ground is cut away under the stair (NativeChurchyard).
- **Vault ledger, De Pauw** (`vault_ledger`): a raised ledger on a stone curb over a vault, four lifting rings in iron
  plates, a carved shield of arms (chevron, three stars), 1738.
- **Chest tomb, Verstraeten** (`chest_tomb`), merchant, 1758: plinth, corner pilasters, raised panel frames, moulded lid.
- **Obelisk, Van Loon** (`obelisk`), doctor of medicine, 1783, and his wife: stepped base, inscribed die, tapering shaft.
- **Family plot, Claes** (`family_plot`): stone kerb and cast-iron railing with spear heads and urn finials round a cross
  on its pedestal and two ledgers (1767, 1780).
- Six headstones (round, segmental and gabled tops), a stone cross, two ledger slabs worn into the grass, the oldest
  inscriptions nearly gone.

Collision: boxes round every grave, vault, pier and railing run (31). The gate's leaves are solid; the plots are closed.

## Also

- `squares.py` keeps its trees and benches out of the yard and 1.2 m round it (3 trees, 2 benches left out after the draw:
  every other tree and bench stays where it stood). `squares.json` regenerated.
- The cleared ground: the street's litter, leaves, the razed houses' raised flags and kerbs and their plinth tops left
  floating at 0.71 m are taken out of the new ground; the paving's drawn faces under the grass are cut (they showed through
  it), its collision and walk support kept.
- The sky map still held the razed houses' roofs, so the cleared squares round all three churches lay in their shadow at
  noon: `Psx.ClearRoofs` takes them out at load, with the yard's.

## Checked

Game pictures at 10:00 and 13:00 clear, 13:00 rain and 22:00, close and wide (D:/Code/ScheldemistWork/churchyard). At
13:00 the church's own shadow lies over the yard (the sun is south-south-west, the church west of it): the morning is when
it is in the sun.

## Round 2 · 27 October 2026 (Codex review: REWORK)

A designed reconstruction: invented families and arms, no dated plan of these monuments. Codex's eight points and
round 1's leftovers:

1. **Light and material in shade.** The yard lies in the church's shadow most of the day, where the town shader gives every
   upright face the same sky light. The colour now carries the form: `churchyard_kit.bake_ao` casts 40 rays from every
   vertex against the yard's solids (oriented boxes, across models) and the ground, and the tint darkens recesses, joints
   and feet with dirt, and lifts worn arrises. Own materials `churchyard-stone`, `-iron` and `-bright` (and letters and
   ashlar) are the guard stone's and barrel iron's with their albedo raised in linear light (x4, x8, x10: same shader and
   pictures, no new kind), so a vertex colour can also lighten: dry blue stone `#596168`, worn arris `#737A7D`, recess
   `#3B4447`, iron paint `#292B2B`, worn iron `#555650`. Night: the sexton's lantern (the game's one lantern model,
   `NativeChurchyardLantern`) on an iron bracket on the gate's east pier, 2.1 m up, lit with the gas lamps, in one of the
   fixed spill slots (`Lights.AddMoving`: no Godot light, the light count unchanged): a pool on the gate, the path and the
   nearest stones; the far plots stay dark.
2. **Weathering by cause** (`weather_stone`): the stone's tone drifting over 0.3 to 1 m; damp and soil splash 100 to 250 mm
   at the foot, uneven; rain runs from under the top's edge to the ground; moss (`#414D32`) in the damp joints the AO
   finds and on low level faces; lichen in colonies (`#8B9180`, a few `#A59C78`) on the open upper faces of some stones
   only. Bare damp soil round the free-standing stones' feet where the grass will not grow (`groundcover`).
3. **Ironwork and carving.** Lifting rings of 15 mm iron, 130 mm across, lying in their eyes on riveted plates, their tops
   rubbed back to dark metal; the vault doors with a raised border, two 55 mm hinge straps ending in spears, knuckles on
   pintles, a lock plate with a swinging keyhole cover and a drop ring, the raised iron worn lighter than the plate; the
   gate leaves with knuckles and a drop bolt. Arms in relief (12 to 14 mm proud), their field dirty and their charges
   rubbed pale: De Pauw a chevron between three roundels on the ledger, Moens a fess and three lozenges in the chapel's
   gable, Van Ertvelde a saltire in the stair vault's pediment.
4. **Edges.** Every stone arris worn back unevenly by 0 to 10 mm over its 8 to 15 mm radius, nearly half the block corners
   chipped 15 to 35 mm (`rbox` wear and chips; iron keeps its even edge); kerb joints 8 mm.
5. **The stair vault** (moved 0.15 m south): a threshold at the ground and four worn treads (166 mm rise, 280 mm going)
   down to a landing that falls 1.5 % to a 200 x 150 mm iron grate over a soakaway; treads swept paler, risers damp; moss below the ground
   only in its true corners (round 1's mottle on the steps was the weathering treating the whole well as a damp joint). A
   shadow-only lid over the well was tried and dropped: it blackened the lower flight at 10:00. Gravel drip strips along both eaves of the chapel's roof and the vault's hood.
6. **Ground.** Gravel at 1.3 m (5 to 20 mm stones, not clods), the yard's own copy of the park's gravel with its relief halved
   (`churchyard-gravel.tres`); gravel approaches from the walk to the chapel's steps and the
   stair's head; the walks' edging laid by hand (a little out of line, height and turn); the grass cut round every stone's
   foot; ledger 1 sunk 35 mm at its head, ledger 2 30 mm on one side; the old leaning headstones kept.
7. **Families.** Each composition its own: Verstraeten's chest tomb with his wife's lines, his merchant's mark on its east
   end and MEMENTO MORI on its west; Van Loon's VIXIT AEGRIS NON SIBI over the staff of Aesculapius; De Pauw's NOBILIS
   FAMILIAE ... ET HAEREDUM; Moens's widow 1783. Every date before the closing (latest 1783). Letters filled by place:
   dirt on upright faces, moss and silt in level ones, soot under the lintels.
8. **Remembrance and autumn.** A wreath of dried immortelles with a dark ribbon against the Claes cross; an old faded wreath,
   half fallen apart, on the gravel under the Moens epitaph; wet leaves in clumps against the north and east kerbs and the
   windward feet of the chest tomb, the Claes plot and the chapel (the wind mostly south-westerly), single leaves of 40 to
   100 mm over them and a few blown onto the grass; the walks swept. The soil collars' outer edges lie under the grass's
   bumps, so the grass grows over them raggedly.

Also: the razed houses' plinth tops of raised flags left floating at 0.71 m on the cleared plots round all three churches
(about 360 places, found by a probe of level faces 0.4 to 1.2 m high on razed ground) are cut by `NativeRazedHouses.Cut`
(material `r000016`, 0.5 to 1.0 m, nearer a razed house than a standing one).

Triangles: 397 000 (round 1: 258 000); the graves and vaults keep their engine LODs.

### Round 2 checked

Game pictures at 10:00, 13:00 clear, 13:00 rain and 22:00, round 1's camera places and new close views
(D:/Code/ScheldemistWork/churchyard2: final/, f2/, pairs/ round 1 against round 2). Route audit 0 hits; ideas, homes and
night, courtyards, shop population and market proofs pass; shader check PASS (41 psx shader kinds, as before); desktop
icons 7 PASS. Frame: about 20 ms warm at the yard's corner and over it from 9 m (+30 draws); the round 1 run measured
alongside came out slower on a busier machine, so no fair difference is claimed. Codex's second look: still REWORK, point 1
(shade and night light) accepted, the others improved.

### Round 2 open

- The walks' gravel still shows parallel ridges at low angles (the park gravel's relief picture; halving it was not enough):
  an own compacted-gravel picture is needed.
- Edge wear and chips read at 1 m but not at walking distance; the stones' feet are cleaner than their soil.
- The chapel door's lock plate merges into the door at 10:00; the single leaves are flat four-sided pieces, not leaf shapes.
- At 10:00 the low sun lights a soft patch on the stair's landing (true to the sun's angle, softer than round 1's).
- Night views from inside the yard by the gate render a wall in the snap tool (camera placement), so the lantern was checked
  from the street (gate_n) and by day.

## Not yet

- Mourners or a sexton visiting the yard: the native places and routes have no visit kind for a churchyard yet.
