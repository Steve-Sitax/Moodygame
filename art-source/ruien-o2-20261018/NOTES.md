# Ruien O2 piece, round 1 (2026-10-18)

Native polish (#207): drain headers use radial wedge geometry and 4 mm arrises; keeper stair blocks have 6–10 mm arrises, iron rails 3 mm, hatch boards 2 mm. Setts carry 16 mm geometric relief from the shared quay height map. Coping remains dressed stone. Hidden mating faces stay sharp; the drying net's cord ends terminate inside ties. The coarse red panels above the gate belonged to the town drying rack; its frame and placement remain, with woven rope replacing the panels.

One small part of the Ruien, built in Blender 5.2 from scripts: the vliet sluice outlet (gate O2), the giant
gallery from the gate to the Vleeshuis hall, and the hall (room C2) with the first metres of its three other
galleries. Nothing here touches the game.

## Files

| Path | What |
|---|---|
| `ruien-o2.blend` | The result, 20.5 MB, compressed. Textures are linked from `textures/`, not packed. |
| `scripts/textures.py` | Makes the Codex textures seamless and derives height, normal and roughness. Builds the brick tile, jointless bluestone, the oak plank atlas and the door stain mask. |
| `scripts/build.py` | Builds the whole scene from an empty file: geometry, materials, lights, fog, cameras. |
| `scripts/render.py` | Renders the six views, a mood and a check picture each. |
| `scripts/spec.py` | All key sizes and levels in one place. |
| `scripts/rlib/` | Modules: `gallery` (section sweep), `gfeat` (gallery fittings), `vliet`, `hall`, `props`, `debris`, `figures`, `backdrop`, `mats`, `mats2`, `scene`, `util`. |
| `renders/round-1/` | `v1_outlet`, `v2_gate`, `v3_shaft`, `v4_hall`, `v5_close`, `v6_stair`, each `_mood.jpg` and `_check.jpg`. |
| `work/` | Test renders and scratch files. Not needed to rebuild. |

## How to rebuild

From this folder, with `BL="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"`:

```
python -I scripts/textures.py                                   # about 2 minutes; only after new Codex textures
"$BL" --background --factory-startup --python scripts/build.py   # about 25 s, writes ruien-o2.blend
"$BL" --background ruien-o2.blend --python scripts/render.py -- --out renders/round-1
```

`render.py` options: `--views v2_gate,v4_hall`, `--modes mood` or `check`, `--scale 50`, `--samples 128`.
A full set of 12 pictures takes about 4 minutes on the RTX 5090 (OptiX, adaptive sampling, OpenImageDenoise).
The build is seeded (`1873`), so it gives the same result every time.

## Coordinates

Built at true world positions. Blender X = game x (north), Blender Y = minus game z (east), Blender Z = game y (up).
The glTF exporter turns this back into game coordinates. All script geometry is written in game coordinates and
converted once, in `util.g2b`.

## What is built

### Vliet and outlet (gate O2)
- Open vliet between game x -150 and -142, modelled from z 47 to the head wall face at z 72. Quay tops y 0.
- Quay walls and head wall in brick, bluestone coping blocks at y 0 (0.3 m thick, 0.6 m deep, 5 cm overhang).
- Outlet arch in the head wall, centred on x -146.1: 15 bluestone voussoirs with a proud keystone, springers,
  jamb and ledge-end blocks in alternating bond, a three-stone sill at y -5.05, and an apron of bluestone slabs
  that the doors sweep.
- Two oak tide doors, 3.1 m leaves of vertical planks (24 cm x 9 cm), oak ledgers inside, five iron straps with
  rivets, hinge eyes on iron pintles leaded into the jamb stones. North leaf 40 degrees open, south leaf 33 degrees.
  The leaves hang on the river face, so the rising river presses them shut against the stone.
- Bed: a silt heightfield with mud banks along the walls (above the low water at y -4.6), an outflow channel down the
  middle and a scour pit in front of the apron. Debris: bricks, planks, branches, a barrel, a crate, bones, weed.
- Weed strands in the tide band below high water (y -0.65), slime and tide marks on walls and doors.
- Street paving on the quays, one gas lamp and a row of stepped-gable houses (render only).

### Giant gallery
- Centre line: straight through the head wall from (-146.1, 72.0) to (-146.1, 75.0), an S bend to (-149.1, 82.5),
  the long leg to (-149.51, 109.3). Length 38.0 m. Tightest centre-line radius 4.5 m.
- Section: 6.0 m wide, basket (elliptical) brick vault springing at y -3.1, crown inside at y -0.9, floor y -6.1,
  3.0 m channel, 1.5 m ledges at y -3.6 with bluestone coping (0.5 m deep, 0.3 m thick, 4 cm overhang, chipped).
  Water at y -4.6, silt banks along the channel walls, more on the inside of the bend.
- Penstock 3 m inside the doors: cast-iron door in iron guides, raised with its foot 25 cm under the water. Two racks,
  a headstock beam on pedestals at ledge working height, cross shaft with two pinions and a 0.54 m spoked wheel, a
  small drive pinion, crank and wooden handle for the keeper on the north ledge, and a pawl chain.
- Oil safety lamp (brass pot, glass, gauze, cap) on a wrought-iron wall bracket by the penstock. Soot above it.
- Four egg-shaped side drains (1.0 x 1.6 m) with brick linings and two header rings, three of them dribbling over
  the ledge into the channel. Three cast-iron pipe ends with sockets, trickling. Rust stains below the pipes.
- Grate shaft at z 92.5: 0.66 m square brick shaft to a cast-iron street grate, staggered step irons in the shaft
  wall, a wrought-iron ladder with wall stays down to the ledge, a cold daylight beam.
- Three stretches of older sandstone masonry low in the walls, one later brick repair, lime crust and straw
  stalactites at seeps and along a crown crack, holes where bricks fell out, fallen bricks on the ledges, mooring
  rings on the coping, floating planks, branches, rags, a half-sunk barrel and a crate.

### Vleeshuis hall (C2)
- Game x -159.5 to -140.5, z 110.5 to 138.0. Floor y -6.1, water y -4.6, vault crown y -0.9.
- 3 x 4 bays of groin vaults on six free brick piers (1.4 m square) and the walls. Piers stand on two courses of
  bluestone plinth with a weathered top, and carry a moulded bluestone cap at the springing (y -2.5). Brick
  transverse arches (18 cm proud) on all pier lines, bluestone corbels where they land on the walls.
- Raised walkways at y -3.6 along the walls and down one pier line, brick sides, bluestone coping, brick paving.
- Four gallery mouths, each a throat arch through the 1.2 m wall with two header rings and bluestone imposts:
  the main gallery (south), and 8 m of gallery to the north-east, south-west and east, ending in darkness.
- Stair in the south-east corner: 19 worn bluestone steps on a brick base along the south wall, an iron handrail,
  a stairwell up through the vault to a double hatch in the street, standing open. Daylight falls down it.
- Bone pile on a silt bank at the stair foot, where butchers' waste comes down the hatch: long bones, ribs, cattle
  and pig skulls, offal sacks, offal, broken crates and planks.
- Round air shaft with a grate in one bay crown, with a thin grey daylight beam. Two oil lamps on brackets.

### Render only (collection `RENDER_ONLY`, every object has `ruien_export = False`)
- Scale figures: a 1.8 m worker with a lantern and a 4.4 m gaunt giant. Placed per view by `render.py`.
- Mood lights, check lights, fog volumes, cameras, backdrop houses, gas lamp.

## Sizes that differ from the brief, and why

- **Hall bays are 6.3 to 6.9 m, not about 5 m, with six free piers.** A 6 m gallery mouth has to sit at a bay centre
  between pier lines. With 5 m bays the main gallery (x -149.5) and the east gallery would both land on a pier line.
  Pier lines: x -152.75 and -146.25; z 117.375, 124.25 and 131.125.
- **Gallery mouths narrow to throat arches**, 4.6 m (main, east), 5.0 m (south-west) and 5.7 m (north-east) wide,
  crown y -1.12. The hall wall carries the vault, so the gallery breaks through it as a smaller arch. Antigoon fits.
- **East gallery leaves at x -143.0, not -146** (2.5 m shift), north-east at z 113.6, south-west at z 127.7, to sit
  at bay centres.
- **The S bend is smoothed.** It reaches the long leg at z 82.5, not at the plan corner (-149.0, 75.5). A 6 m vault
  cannot turn 40 degrees in 3 m.
- **The grate shaft sits over the north ledge** (2.35 m off the centre line at z 92.5), not over the channel, so the
  step irons and ladder come down onto the ledge, not into 1.5 m of water.
- **The penstock is inside the gallery**, 3 m behind the doors, as Latham advises (a penstock backs up the tide valve).
  The head wall has no room for one beside or above the 6 m arch.
- Vault: basket arch (rise 2.2 m over 6 m) instead of a semicircle. A semicircle with its crown at y -0.9 would spring
  below the ledges and leave no head room on them.

## Construction notes (AGENTS.md)

- Stone blocks are real geometry with rounded arrises (6 to 16 mm on bluestone, 4 to 11 mm on brick) and chips
  carved into the mesh. Treads and coping tops are dished by wear. Iron gears, racks and the penstock have a 2 to 3 mm
  bevel modifier. Planks 4 mm, eaten away at the foot.
- The brick relief is **true displacement at render time** (Cycles adaptive subdivision at 1 pixel) from a 16-bit
  height map: rounded arrises, recessed and crumbling mortar, chipped and spalled bricks, missing bricks.
  Bump adds the finer grain. Silhouettes of openings, rings, coping, steps, piers and caps are mesh geometry.
- Weathering follows causes: slime below the water and tide line; a tide band on the vliet walls below high water;
  lime crust and straws under seeps and the crown crack; rust runs under pintles, pipes and door straps; soot over
  the lamp and under the crown; silt on ledges near the coping and at the wall foot; wet stains below drains and pipes.
- Seams: the groin vault fades displacement to zero along the groins, so the two barrels meet without a crack.

## Triangle counts (base meshes, before render-time subdivision)

Total 2.43 million triangles in 3,366 mesh objects. Objects marked "adaptive" get far more at render time.

| Group | Objects | Triangles | Notes |
|---|---:|---:|---|
| Hall (vault, ribs, walls, piers, walkways, stair, rings, straws) | 1,598 | 1,126,102 | `hall_vault` 100,994 adaptive; mouth ring bricks 360,240 (948 instances of 8 meshes) |
| Main gallery | 1,151 | 542,074 | `gal_vault` 38,008 adaptive; coping 116,144 (77 blocks); drain rings 209,760 (552 instances) |
| Vliet and outlet | 185 | 367,794 | quay coping 64,016; apron 43,472; jambs 43,352; voussoirs 34,332; door planks 54,024 |
| Debris and bones | 383 | 221,818 | hall rubble 70,080 (instances); bones 18,768 |
| Side galleries and throats | 199 | 159,506 | |
| Scale figures (render only) | 4 | 14,896 | |
| Backdrop (render only) | 113 | 2,162 | |

Largest single meshes: `hall_vault` 100,994; `hall_silt` 26,496; `hall_wall_x0` 18,122; `vliet_bed` 17,930;
`hall_wall_x1` 17,486; `vliet_quaywall_e` and `_w` 15,052 each. The full list is in `work/tris.json`.

## Materials

| Material | Used on | Sources |
|---|---|---|
| Brick_* (six variants: gallery vault, ledge paving, channel, quay, hall vault, hall wall) | all brick | brick tile (dry, slime, lime colour; height; masks), t07 sandstone, t04 silt; weather from vertex colours `wxA`, `wxB`, `wxC` |
| Brick_loose | rubble, ring bricks | palette per brick, t01 grain |
| Bluestone, _wet, _tidal, _street, _step | coping, dressing, caps, plinths, steps | jointless bluestone from t03 |
| Paving_setts | street | t03 |
| Oak_tide_door, Wood_debris | doors, hatch, planks, crates, barrels | oak plank atlas from t05, door stain mask |
| Iron_cast, Iron_wet, Brass_lamp, Lamp_gauze, Lamp_glass, Lamp_flame | iron work, lamps | t06 rust |
| Silt, Silt_vliet | beds and banks (displaced) | t04 |
| Water_sewer, Water_river, Water_film | water, dribbles | procedural |
| Lime_straw, Bone, Offal, Sacking, Weed_slime | details | procedural |
| Fog_low, Fog_beam, Fog_stair | volumes | procedural |

Brick tile: 4.8 x 2.4 m, 3840 x 1920 px (1.25 mm per pixel), 1,280 hand-irregular bricks in Flemish bond, about
19 x 9 x 5 cm with 8 to 15 mm joints. Every brick is filled with a tone-matched crop of a real brick from t01 (dry),
t02 (slime) and t08 (lime), so the three colour variants share one layout and one height map, and the shader can
blend them without two brick grids clashing. Per-brick ID drives tint and the fallen-out brick clusters.

### Codex texture sources (albedo, 1254 x 1254, SHA-256)

| File | SHA-256 |
|---|---|
| t01-brick-old.png | c1883a2aa8cba3d7cada0adbe36fe9d26e2347ceb1d575c92a44d8f9249fdf20 |
| t02-brick-wet-slime.png | 3cd240353941a3b36e4090b2e94e7d61a5b7bdf0476991f5c4317b3e3b0dc825 |
| t03-bluestone.png | ab65e03d7649eca9d94ed62d9e3bc391181c4e181ee099d37f352323989331a7 |
| t04-silt-mud.png | a7b0b50b01fc903fad983d4c189a852824af902c435b700328ee6fe2963ac1b3 |
| t05-oak-iron.png | 63bea53341f2c2473f43466f6d2015ef3258f331cf75acf42ceddd14d47f7238 |
| t06-rust-iron.png | fbd879ac88bc454e6571214b9e9075dcaf523dfdd11267967425fbf72e043b6d |
| t07-sandstone.png | 6b1ddda8aa0d049822f8d0c293e9fce04a7d17fc58d5a333b15afc301d8b0d88 |
| t08-brick-lime-crust.png | dd69b18395320a950bbcdd190f3cc48565bca622aae94fafa060ab7f8444e3b2 |

Each has `_seamless`, `_height` (16 bit), `_normal` (OpenGL) and `_rough` beside it in `textures/`. Seams are
closed with a minimum-error cut, which keeps stone and joint shapes intact. Generated maps are in `textures/gen/`.

## Lighting

- Mood: dusk sky, oil lamps (warm), the street gas lamp, cold daylight spots through the grate, the air shaft and
  the hatch, a low fog layer over the water and denser dust in the three shafts.
- Lighting cheats, on purpose: practical lamps use a linear falloff so their light reaches down the tunnels; very
  faint shadowless fill lights (not seen in reflections or in the fog) keep far shapes from going pure black; lamp
  glass and flames let shadow rays through.
- The sky lights only the vliet view. Inside, the world is black, so a seam can only show dark, never sky.
- Check: shadowless fill lights all along the spaces, a soft headlight on the camera, no fog, no mood lights.
- Render times on the RTX 5090: 20 to 32 s per mood picture (384 samples max), 7 to 12 s per check picture.

## Known defects (not fixed in round 1)

1. The fine brick relief exists only at render time. A glTF export carries the 10 to 20 cm base meshes with UVs and
   vertex colours, without the relief. The game needs a baked normal and height set or a mid-poly version.
2. Oak atlas: t05 has only one long strap-free run, so planks show mirrored repeats of the same knots about every
   0.8 m. Close views of the doors show it.
3. One brick tile for all brick (Flemish bond). Barrel vaults were more often laid in stretcher or rowlock courses.
   The tile damage repeats every 4.8 m; the weather masks hide most of it, a long straight wall still shows it.
4. Groins have no real cut-brick bond; the brick pattern changes direction along a smooth mortar line.
5. Weather masks live on the base mesh vertices (10 to 20 cm), so slime, lime and soot edges are soft at large scale.
   Fine detail comes from the textures.
6. Straw stalactites are simple lathe shapes. No flowstone curtains or rimstone.
7. Water is a reflective surface with procedural ripples. No flow direction, foam at the drains or splash rings.
8. Vliet weed is flat ribbons. No barnacles or mussels. The mud banks look grey and gravelly in the check light.
9. Backdrop houses are a flat stage set and the gables leave the frame. Render only.
10. Scale figures are skin-modifier mannequins. Render only.
11. Penstock: rack and pinion meshing is approximate; no bearings, counterweight or wedges.
12. Drain and pipe holes are cut on the base grid; ring bricks and pipe sockets hide the ragged edge in all six views.
    Close views from the side, inside the drain mouths, may show gaps.
13. Hatch leaves are plain boards without ironwork. The street above the stair, the grate and the air shaft is only
    a slab or a small paving patch.
14. The barrel staves are crude and catch too much light in the close-up.
15. No collision meshes yet.
16. Stair treads are separate blocks without a nosing profile. The stair is only seen from the hall.
17. Brick face pitting reads too strong at grazing light very close to the camera (v2, right-hand vault).
18. The sides of fallen-out brick holes are displacement walls, so their texture is stretched (v5, close up).
19. The giant proxy reads pale and ghostly inside the air-shaft beam (v4).
20. Channel walls: the tide band and slime read in the check light, but only faintly in the mood light (v5).

## Round 2 (2026-10-18)

Inputs: the lead's review, Steve's notes (dirtier, moss, a rot mist on the water) and Steve's photo of the real
Ruien (look reference only, not stored here). Renders: `renders/round-2/`, seven views, mood and check each.
The new view `v7_crown` is a close study of the gallery crown crack with lime crust and flowstone.
Rebuild as before; `render.py` now writes to `round-2` by default. Build 30 s, full set about 10 minutes.

What changed:
- Brick: three bond tiles (irregular Flemish for walls, stretcher for vaults, headers for ribs and arch rings),
  courses 5.2 to 6.8 cm, joints 6 to 20 mm, bats and drift. Displacement down to 65 percent; shallower pits.
  Mortar washed out in patches, nearly flush in others. Brick base regraded to a clearer red under the dirt.
- Damage: holes are whole bricks by brick ID inside noisy clusters, with half-broken neighbours, eroded joints
  and the next course showing behind. Fallen fragments lie on the ledges and in the silt below each cluster.
- Leaks: lime crust and long dark runoff trails down from every seep, the crack, drains, pipes and wall drains.
  White speckled efflorescence over the vaults, salt bloom in the joints above the tide band.
  Calcite: real-geometry curtains down piers, hall walls and gallery walls, draperies under the ribs,
  and rows of knobbly flowstone fingers along the crown joints (dozens, mostly short, some long).
- Wetness by zone: saturated, glossy and slimed below y -3.9; damp runoff trails above; dry, dull and sooty
  higher. Puddles on ledges and walkways. Moss and algae in damp joints, at the tide fringe, along leaks, on the
  lower door planks and the low stone. A grime gradient toward the water.
- Water: closed volumes with brown-green absorption, broad ripples plus fine stir, scum and grease films, drip
  rings, floating straw, sticks, rags, corks and a drowned rat. Silt banks break the surface.
- Light and haze: a rot mist 0.3 to 0.8 m thick on the water, drifting, thickest in the hall, thin in the vliet,
  clear air above. Daylight spots are small sources high above the grates, so the bars cast shadows in broken-up
  dust. Two distant lamps in the gallery, four more in the hall and side galleries. Brown fill removed.
- Stone: bluestone quoins (long and short, toothed in) on every pier corner and gallery mouth, bluestone voussoirs
  at intervals in the brick ribs and mouth arches. Coping, caps, plinths, jambs and voussoirs have more chips,
  broken-off corners, wavier arrises, hollowed tops and silt packed in the joints.
- Hall: piers slimmed to 1.1 m; the vault stays at y -0.9. New long view across the bays to the lit far side.
  Square wall drains with stone frames and wet streaks, a stone corbel shelf with a bottle, more silt against piers.
- Clutter: rafts of rubbish against the piers, the gate and the bend; rope coil and hanging rope; broken wicker
  baskets; chained rings; stave barrels with end grain, split tops and rusted hoops; femurs, vertebrae, jaws and
  cattle skulls in the bone pile.
- Outlet: the houses are dark fog silhouettes with two dim windows; the bed is darker wet silt with puddles,
  erosion rivulets, weed and broken brick; dense weed and slime below high water; slime on the lower door planks.
- Build speed: `util.join` now merges mesh data directly (the operator version took minutes in a big scene).

Size: `ruien-o2.blend` 24.1 MB. Base geometry 3.28 million triangles in 4,946 mesh objects (render-time
displacement comes on top).

Remaining defects after round 2:
1. Coping blocks and the barrel in v5 still read too glossy and plasticky up close.
2. The vliet bed still reads as grey gravel in the mood light; the erosion rivulets hardly show.
3. Calcite curtains are smooth sheets; they lack the photo's stacked, fluted texture at close range.
4. Moss is a colour and height mask only, with no geometry tufts.
5. Drip rings are static decals; the water has no flow direction or foam at the spouts.
6. The hall far side is lit faintly but the depth falls off quickly; the long view could use one more distant lamp.
7. Backdrop houses are flat cut-outs (the town will replace them).
8. Figures are still mannequins; the man has no separate coat shape.
9. Round-1 defects 1, 4, 5, 9, 11, 13, 15 and 16 still stand (bake for export, groin bond, vertex-mask
   softness, backdrop, penstock detail, hatch ironwork, collision, stair nosings).

## Round 3 (2026-10-18)

Renders: `renders/round-3/`, seven views. Mood pictures have no scale figures; check pictures keep them.
`render.py` writes to `round-3` by default.

What changed:
- Hall vaults: springing set per corner. Free piers spring at y -4.0 (bluestone caps just above the water) with
  tall half-ellipse arches and groins (rise 3.1 m to the crown at -0.9). Wall corbels stay at -2.5, so the wall
  walkways keep head room and the gallery mouths still fit. The groin is still the higher of two barrels; each
  barrel's springing varies linearly between its corners. Channel centres clear Antigoon (crown -0.9 at bay centres).
- Piers: bluestone base in the water up to -4.9, short brick shaft with quoins, chamfered cap -4.28 to -4.0.
  Arch rings offset along the curve normal, so they keep their depth down to the caps.
  Bluestone voussoirs set radially into the rings every 1.0 to 1.3 m of arc, flush with the ring faces.
- Removed the walkway along the free pier line (the low arches cross it). Wall corbels are now stepped
  three-course bluestone corbels. The vault hole at the stairwell keeps its edge cells, so no light slit shows.
- Brick UVs: courses measured as arc length from each barrel's crown line, so spacing stays even and courses
  follow the curve into the groins.
- Calcite: most icicles removed (crown crack keeps a few short fingers). Fluted sheets on arch faces from crown
  leaks down the haunches, short curtains over pier caps, wall curtains, broad sheets below gallery leaks.
- Colour: clearer red-orange brick, grey lime mortar, grime only in cavities, low near the water and below leaks.
  Moss cushions (geometry) in wet joints just above the water on channel walls and pier bases.
- Water: small isotropic ripples (the stretched streaks are gone); drip rings smaller and duller.
- Placeholders: far fewer loose bricks; 24 varied fragment shapes, some with mortar on; fewer rags and offal;
  darker, wetter bone and sacking.
- Light: seven warm wall lamps in the hall (the far side lit through the arches), cool light from the three
  side-gallery openings.
- Outlet: dusk sky, town haze in front of the houses, pitched roofs and chimneys in silhouette, darker wet mud.

Size: `ruien-o2.blend` 24.0 MB.

Remaining defects after round 3:
1. Calcite is now too faint in the hall views; the photo's thick white sheets need more volume and brightness.
2. Mood pictures in the gallery (v2, v3, v5) still read brown-orange from the warm lamps; the brick reads as red
   only in the check light and the hall.
3. The bluestone voussoirs and quoins have a fuzzy, felt-like surface up close (v6); bluestone needs its own
   dressed tooling texture.
4. v1 is very dark; the doors and mud read only faintly. The houses are still plain silhouettes (as asked).
5. The v5 barrel still reads plasticky; the gallery water has a glossy band near the barrel.
6. The groins still have no cut-brick bond along the groin line.
7. Wall springing at -2.5 against piers at -4.0 makes the bays next to the walls asymmetric.
8. Round-1 and round-2 open items still stand: export bake, collision, stair nosings, hatch ironwork, figures.

## Round 4 (2026-10-18)

Renders: `renders/round-4/`, seven views (mood without figures, check with figures). Size 25.4 MB.

Water smears, root cause: not the ripples. Tests with the bump off still showed them (`work/wt_sheet.jpg`,
`work/iso_sheet.jpg`). Two causes:
1. The silt material projected its texture flat from above, so it smeared down the steep banks and showed through
   the clear water. Fixed with box (tri-planar) projection on silt and mud.
2. The water was a perfect black mirror with refraction: the streaked, weed-hung walls and the uneven bed came back
   as long vertical bands. The water surface is now a Fresnel mix of a dull glossy reflection (roughness 0.2) and
   straight-through transparency with no refraction. The brown murk absorbs, so the silt shows only in shallow places.
   Distorted noise (the oily swirls) and the grease thin film are removed. Ripples are small and isotropic.

Other changes:
- Dirt by cause, clearly heavier: dark slime and damp to the tide band, black grime streaks from the vault, dark
  runoff below leaks and drains, dirt packed in cavities, a dark film over old brick. 700 moss cushions on the
  channel walls, 30 per pier base.
- Mortar dark and dirty, washed lighter only in patches. Per-brick fired colour: about 1 in 9 overfired
  purple-black, some pale. Softer brick arrises in all three bond tiles.
- Calcite: small pier pieces and all drip fingers removed. New fluted curtains along the groin lines from near the
  crown down to the free piers (0.55 to 1.0 m wide at the top, about 3 m long), continuing as sheets down the pier
  caps into the water. Larger arch-face sheets with a hanging lip, more and longer wall curtains, up to 16 broad
  sheets in the gallery. Material darker and streaked.
- Bluestone: arch-ring voussoirs are now pairs at the two ring edges, long and short alternating, not full-width
  belts. Much finer stone bump. Stair nosings rounded 20 to 30 mm with worn hollows. Coping joints 3 mm.
- Massing: arch rings 0.3 m deep; pier bases broader and splayed; transverse pier lines moved a little
  (z 117.55, 124.05, 131.3) so the bays differ.
- Light: lamps use inverse-square falloff (local pools, darker vaults between them), a less orange flame colour,
  rot mist kept, general haze cut to a third.
- Outlet: lower camera; dense dusk haze hides the houses; sky glow on the wet walls and water.

Remaining defects:
1. The groin curtains show a thin dark line where their top edge meets the vault; the curtains still read a little
   like sheets close up, without the photo's stacked lumps.
2. The gallery mood views stay warm and dim; the red brick reads best in the hall.
3. v1 still reads dark and the mud banks look gravelly in the dusk light.
4. The v5 barrel still reads plasticky.
5. Earlier open items stand: export bake, collision, groin cut-brick bond, hatch ironwork, figures.

## Round 5 (2026-10-18)

Renders: `renders/round-5/`. New Codex textures t09-flowstone (SHA-256 6aeb49e38acfc66d91b9f7c86c44b83a0f328ce888fd3f6a6e8362e994bc910c)
and t10-moss (5d6abfc48148ecbbe973d3b31160ed8062174c6a2916eda0f82d0f0090b7286a), made seamless with derived maps.
Size 25.5 MB.

- Calcite: one thickness profile for every curtain (`stonework.flow_thick`): fluted lobes up to 7 + 13 cm by width,
  thickest near the leak, stacked tiers, breaking into separate runnels lower down. Every edge goes to zero and then
  1.6 cm into the masonry, so no boundary line or seam shows. Material from t09, desaturated to dull grey-cream with
  brown dirt and slime low down, 3 cm displacement. Flat pier-side sheets removed.
- Moss: t10 moss only near daylight (grate shaft, air shaft, stair hatch, outlet; `mats.DAYLIGHT`), as a masonry
  layer and as low displaced cushions on lit upward faces. Elsewhere black-green slime and brown bacterial mats.
- Bluestone quoins and ring voussoirs: dark wet blue-grey, slimed low; ring voussoirs fewer (every 1.7 to 2.3 m) and
  larger, at the ring edges only.
- Exposure raised per view (+0.8 to +1.4).
- Outlet mud: flat dark wet silt with a gentle swell, sheen and puddles; fewer stones and weed piles.
- Barrel: matte oak (roughness 0.8), slime band, rot patches, wider stave gaps.

Remaining defects:
1. Moss cushions at the stair foot still read as pale discs in the hatch daylight.
2. Ring voussoirs on the near pier in v6 look like boxes set on the face, not flush stone.
3. Calcite still needs more volume where it hangs from the groins in v4; up close it reads lumpy but brownish.
4. Gallery mood views stay warm; the brick reads redder in the hall.
5. Open from earlier rounds: export bake, collision, groin brick bond, hatch ironwork, figures.

## Round 6 (2026-10-18)

Renders: `renders/round-6/`, views v1 to v7 plus `v8_curtain_test` (a 2 m close-up of one curtain on a hall ring
underside); `curtain_test.jpg` is its even-light render. The side-by-side with the crop of Steve's photo is kept
outside the repo (`%TEMP%/curtain_test_vs_photo.jpg`), because the photo is third-party.

Method changes:
- Calcite (`rlib/wax.py`): each curtain is one continuous lofted sheet over its host surface (ring underside,
  groin line, gallery wall or flat wall), offset up to 4 + 13 cm by width, thickest near the top, tapering to a lobed
  lower edge, with a ragged patchy outline that dips into the wall. All edges sit 1.8 cm inside the masonry. Fine relief
  is t09 height in the sheet's own UVs (flutes run straight down), 7 mm, faded to zero at the outline by the `wxF`
  attribute; smooth shading, no strands or particles. Colour dull grey-cream with olive, brown and rust streaks, satin.
  Recipe tuned on the test curtain over three iterations against the photo crop.
- Bluestone: no stone boxes any more. Voussoirs and quoins are zones of the brick surface itself
  (`mats.stone_zone`): radial voussoirs every 0.9 m of arc on the arch ring intrados, long and short alternating
  across the ring underside and wrapping onto both ring faces; quoins on the pier corners, long and short by course.
  Stone has its own slight relief, a dark mortar groove round it, and the same dirt and runoff as the brick.
- Moss cushions removed from the stair foot. Mood exposure raised one stop.

Size: 26.2 MB (over the 25 MB target: the curtain grids are denser).

Remaining defects:
1. Gallery curtains on the haunch (v3) look draped and their patchy holes read as dark holes.
2. The groin curtain in v4 hangs like a tongue; it should hug the groin more closely.
3. Moss cushions on the gallery ledge under the grate (v3) read as flat pale stones.
4. Earlier items still open: export bake, collision, groin brick bond, hatch ironwork, figures.

## Round 7 (2026-10-18)

Renders: `renders/round-7/` (v1 to v8, `curtain_test.jpg`; comparison with the photo crop in `%TEMP%`). Size 26.2 MB.

- Rot mist: half density, 0.6 m layer, darker grey, forward scattering; the water and its reflections show through.
- Calcite material: matte (roughness 0.78, satin only in the wet bands), fine vertical striations and fibres in
  colour, bump and height, yellow-grey to ochre variation, darker brown wet bands running down, translucent thin edges.
- Calcite placement: gaps inside a curtain are now a 5 mm crust over the wall, not holes into it; only the outline
  sinks in. Folds flattened. Gallery and wall curtains thinner (2 to 7 cm). Groin curtains are wide low ridges
  (1.1 to 1.6 m, 5 cm, peaked on the groin line) that stay wide down the groin.
- Moss under the grate and at the gate: clusters of small dark-green fuzzy cushions at the wall foot and ledge edge.
  The pale discs were the old flat cushions lit by the grate beam (checked by rendering v3 with and without them).

Remaining defects:
1. The gallery wall curtain in v3 still reads as hanging cloth from this angle.
2. The groin ridge in v4 still reads as a hanging triangle; it needs to be built from the two vault faces,
   not from a plan-space strip.
3. v5 left edge still washes out from the close lantern in the mist.

## Round 8 (2026-10-18), last Blender round before the game

Renders: `renders/round-8/` (v1 to v8, `curtain_test.jpg`). Size 27.7 MB (over the 25 MB target).

- Groin curtains rebuilt from the two vault faces (`wax.host_groin_faces`): the deposit follows the groin arris
  from the haunch to the pier, with its two halves lying on the x face and the z face. Gallery wall curtains are
  thin, low-relief crusts laid onto the wall (1 to 2.5 cm, relief at 35 percent); measured offset from the wall
  stays under 10 cm everywhere, so there is no sag.
- Lime halo (`wax.apply_halo`): every masonry vertex within 1 m of a deposit gets lime wash and efflorescence
  bloom, strongest at the deposit edge, fading over 0.3 to 1 m; the masonry shader puts bloom in the joints first.
- Run-off story (`wax.build_runoff`): from the lower edge of each deposit to where its host surface ends:
  2 to 4 runnels per deposit following wavy drip paths, each with a pale lime runnel (crusty ridge on the
  strongest), a wider dark wet trail, and on about one in four a brown iron streak; lime splash crusts where they
  land on pier caps and walkways. The masonry under every run-off path also gets damp trails and lime stain.

Remaining defects (for the game conversion):
1. All render-time detail (displacement, run-off decals) must be baked for Godot.
2. The groin deposits read best in the check light; in mood light they are still pale triangles from the v4 angle.
3. Run-off decals are thin strips; their alpha is noise based and can look striped close up.
4. Earlier open items: collision, groin cut-brick bond, hatch ironwork, figures, .blend over 25 MB.

## Round 9 (2026-10-18)

Renders: `renders/round-9/` (v1 to v8, `curtain_test.jpg`). Checked on full-resolution crops of the v3 and v4 mood renders.

- Lime halo: its own attribute `wxH` (from `wax.apply_halo`, reach 0.3 to 1 m, mottled) and its own shader layer
  after the wet darkening: solid white mortar near the deposit edge, mottled white wash on the brick faces,
  grading out; drier and less glossy there.
- Deposit colour pale grey-white with grey-brown streaks; the edge (`wxF.G`) thins to a translucent white crust.
- Runnels: flat matte stains 4 to 10 cm wide with branches and a crust bump only (no raised strip). The masonry
  relief under each path is flattened to 20 percent (lime fills the joints), so the stain lies on the wall.
- Voussoir grid marks: caused by mortar-driven lime crust mixed into the stone zones; the stone now takes only a
  mortar-free lime crust.

Remaining: render-time detail must be baked for Godot; collision; .blend 27.7 MB (over 25 MB).

## Game export (2026-10-19)

Folder `export/` (see `manifest.json`, and `KIT.md` for the kit and generators). Rebuild:
`python -I scripts/export_textures.py`, then `"$BL" --background ruien-o2.blend --python scripts/export_game.py -- --lod 0,1`
(about 15 minutes), `scripts/kit_export.py`, and `scripts/check_export.py` for the reimport check.

- Relief: every displaced surface (brick, silt, calcite) is subdivided and the exact shader height is baked per
  vertex with Cycles and applied: about 2 to 3 cm spacing from the water to 2 m above the ledges, 5 to 8 cm on the crowns
  and under water. Seams between the dense and coarse parts fade the relief to zero (no cracks).
- Totals: LOD0 10.19 M triangles (outlet 1.08 M, gallery 3.06 M, hall 6.05 M) in 80 chunks of at most 200k;
  LOD1 2.81 M (28 percent). GLBs 520 MB at LOD0, 118 MB at LOD1, images not embedded.
- Vertex data: `COLOR_0` masks (R wet/slime, G lime/halo/runnel, B soot/grime, A moss), `_AO`, `_BAKECOL`.
- Materials: `ruien_<family>`; face families inside brick (bluestone voussoirs and quoins, sandstone patches) are
  separate material slots. Textures: 10 families, 2048 px, OpenGL normals.
- Collision `ruien_o2_collision.glb`: 15 `col_*` meshes, 3,410 triangles. Markers `ruien_o2_markers.glb` plus
  `manifest.json` markers: 14 lamps, 5 beams, 7 mist boxes, 3 water areas at -4.6, ladder and stair ends, outlet
  opening and dressing outlines (head wall plane z 72).
- Check: `export/check/*_compare.jpg` (round-9 render left, reimported GLB right): geometry lines up in all views.
- Compromises: run-off and drip decals export with a constant alpha (their noise alpha is a shader effect); the
  baked masks replace the shader layers, so the game shader must rebuild slime, lime and moss from them; render-only
  items (figures, backdrop, fog) are not exported; LOD1 props are decimated to 30 percent.

### Export revision for the game (2026-10-19, requests from the Godot side)

- Tide door leaves: separate objects `outlet_door_n` and `outlet_door_s`, rest pose shut, origin on the pintle line
  at sill height; `manifest.json` "movers" gives the open angle (-40.0 and +32.8 degrees about glTF +Y). Pintles stay
  in `outlet_gate`.
- Penstock: door, ribs and racks are `gallery_penstock_door` (origin at the door foot), travel -1.25 to +1.25 m on +Y
  (shut on the bed at -6.10, fully raised to -3.60).
- LOD0: relief and props are edge-collapse decimated after the bake (55 and 70 percent); total 5.53 M triangles
  (gallery 1.86 M, hall 3.44 M, outlet 0.22 M, head wall 0.01 M), 58 percent of before for the same areas.
  LOD1 1.84 M. GLB LOD0 222 MB uncompressed float data; at the game's earlier ratio (120 MB for 10.19 M triangles)
  about 65 MB of resources plus 73 MB textures.
- Outlet: the vliet quay walls, bed, quay coping and vliet debris are no longer exported; `outlet_gate` holds the
  dressing, apron, pintles, head-wall weed and apron rubbish; the brick head wall is optional in
  `ruien_o2_outlet_headwall_*.glb`. Collision for the vliet bed and walls removed; door collision split per leaf (shut).
- Markers: 12 lamp flames (`mk_flame_*`), daylight openings for the grate, the air shaft and the hatch (centre, size,
  vault opening point; `mk_daylight_*`). The old 30 m sun-spot positions remain under "beams" for reference.
- Kit: `tide_door_leaf_n/s` (shut, hinge pivots), `tide_door_pintles`, `penstock_frame` and `penstock_door`.
- Check: `export/check/*_compare.jpg` with the leaves swung to the manifest angles: lines up in all four views.
