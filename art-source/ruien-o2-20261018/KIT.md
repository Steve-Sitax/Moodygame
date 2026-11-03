# Ruien kit

Generators and reusable pieces to build the whole Ruien network from `docs/plans/ruien/ruien-routes.json`.
O2 (vliet sluice, giant gallery, Vleeshuis hall) is the first use. All scripts run headless in Blender 5.2:
`BL="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"`, from this folder.

## Shared conventions (the same for every piece and stretch)

- Native polish: `RuienPaving` reuses the town quay setts (`r000033` colour, `r000035` height, 2.5 m tile), with 16 mm geometric relief, dirty joints and shared `ruien_setts` masonry material. Dressed waterside coping stays separate. Run `convert.tscn -- --ruien-paving-textures` once to pack the normal/HRA maps; the colour resource is shared directly.
- Paving UVs follow each ledge centre line, using offset arc length through bends. Rectangular treads and landings use their own orthonormal chart. `pavingSeams` adds dressed stone bonds 10 mm above the sett crowns; the keeper path uses mitred slabs and one bond at each turn. Procedural stone UVs are measured in metres and divided by the family tile, including risers and bevels.
- `RuienUv` audits physical texture scale and repairs narrow-face charts while retaining their phase and direction. Repaired meshes keep full-precision attributes: quantized UVs collapse millimetre bevel charts. Severe repairs discard the streaked baked colour at those vertices; weather masks remain. Run `convert.tscn -- --ruien-uv-audit <resource folder> --report <outside-repo JSON>` for both LODs.
- Native `RuienStair` builds A1 from `keeperStairs`: dark bluestone treads, a lined inclined barrel behind the gallery wall, a vaulted side niche and a continuous ledge route. `RuienHatch` supplies two full-length cast lids, with 85-degree hinge travel and collision on the leaves; `NativeRuienAccess` saves their state and the maintenance crew's route progress. `channelLadderSpacing` adds staggered escape irons. All use existing material families and the fixed lamp pool.
- B2 is native `RuienDrain`: notched bluestone sill, recessed lined gutter, flush cast bars, connected trickle, two rowlock header rings on a mortar bed and the open throat that continues the exported lining round a bend (`Throat`). The decimated `rlib/drain_headers.py` rings are no longer used. Cut the host wall and walkway with the same profile before placing it; do not layer it over an uncut floor.
- Brick UVs in the export are only a starting point: `RuienUnfold` re-charts every brick surface in the native repair so courses continue across exported objects. Pipes (`RuienPipe`), stub ends (`RuienEnd`) and round-shaft collars (`RuienKit.Collar`) are native kit pieces placed from `areas.json`.
- C1's `rlib/chosen.py:arch` is one closed swept solid with metric arc/depth charts and 11 mm rounded arrises. D1's `light_shaft` has a closed brick shell and flared lower rim; `RuienKit` shares the circular cast frame and square grid. The street cut follows the circle. No detached arch bricks or extra water sheets are needed.
- Stone arrises are generally 8–12 mm, cast iron 2–3 mm. Hidden mating faces, internal sweep joins and machined hinge-pin ends stay sharp; close versions retain the bevel geometry. Source rib sides and soffits are welded before rounding. Bluestone belongs on stair treads; quay setts belong on level walks and landings.
- `rlib/drain_headers.py` makes radial wedge headers with a continuous mortar bed. `repair_headers.py --out <folder>` exports the corrected O2 fittings from the source blend; no original blend is required at runtime. The native `--ruien-repair <immutable export snapshot> --area <id> --headers <fittings.glb>` pass repairs an area's installed meshes and collision together (its data: docs/ruien-native.md, Data). Keep that snapshot outside source control; never use the repaired resources as its input.
- Coordinates: glTF +Y up, glTF (x, y, z) = game (x, y, z). In Blender: X = x, Y = -z, Z = y.
- Materials: one tiling set per family in `export/textures/` (2048 px PNG): `ruien_<family>_albedo`, `_normal`
  (OpenGL, +Y green up), `_height` (16 bit), `_roughness`, `_ao`. Families: `brick_flemish`, `brick_stretcher`,
  `brick_header` (4.8 x 2.4 m tiles, plus `_albedo_slime` and `_albedo_lime` variants), `bluestone` (2.4 m), `calcite`
  (1.8 m), `oak` (plank atlas), `iron` (0.9 m), `silt` (4 m), `sandstone` (1.6 m), `moss` (1.2 m). Tile sizes and relief
  depths are in `export/textures/texture_sets.json`. UVs: 1 unit = one tile.
- Vertex data on every mesh: `COLOR_0` masks (R wetness/slime, G lime/halo/runnel/efflorescence, B soot/grime,
  A moss), `_AO` (baked occlusion, 0.6 m), `_BAKECOL` (baked render base colour of masonry). Native CUSTOM0 stores square-root colour in RGB (black = no bake) and occlusion in alpha.
- Relief: the render-time displacement is baked into the mesh by `scripts/export_game.py` (about 2 to 3 cm vertex
  spacing up to 2 m above the ledges, 5 to 8 cm higher and under water), then edge-collapse decimated (relief 55
  percent, props 70 percent): silhouettes (chips, broken corners, missing bricks, arris joints, curtains, coping, arch
  rings) stay in the geometry, relief under about 1 cm stays in the normal and height maps (the game adds parallax).
  LOD1: one subdivision level less, same decimation, props 30 percent.
- Moving parts are separate objects with their pivot as the object origin; `manifest.json` "movers" gives the pivot,
  the axis and the open angle or travel (tide door leaves: rest shut, open = rotate about +Y; penstock door and racks:
  translate along +Y).
- Markers: lamps, one flame marker per lamp, daylight openings (grate, air shaft, hatch: centre, size, the point
  where the shaft opens into the vault), mist boxes, water areas, ladder and stair ends, the outlet outline.
- Seeds: everything random in a stretch comes from `crc32("<route>/<10 m segment>")`, so a rebuild is identical and
  every segment differs.

## Generators

| Script | What | Parameters |
|---|---|---|
| `scripts/build_stretch.py` | Builds one route of the network with `kit/sweep.py`, renders a check and a mood picture, exports GLBs (LOD0, LOD1) and a manifest. | `--route <id>` (from ruien-routes.json), `--out <dir>`, `--walkway 1/-1` (rui walkway side), `--walkways L79=1,...` (the other ruien at its tees), `--start` and `--end` (`auto` from the plan: `tee`, `reducer`, `through`, else `open`; or `junction`, `open`, `cap`), `--clip a,b` (metres along the route, proof pieces), `--lods 0,1`, `--no-render`, `--no-export` |
| `scripts/kit/meet.py` | `Tee`: a rui (M) ends in the side of a giant gallery (G). `Throat`: a G ends where an M begins (up to 15 degrees off line). Both builds make the same object from the plan (`find_tees`, `find_throats`); the gallery cuts itself, the rui builds the meeting pieces. | node, gallery direction, sections, rui path and end |
| `scripts/kit/throat.py` | `annulus` (end wall round a smaller opening), `throat`, `side_gallery`: moved from `build.py`, which passes O2's sizes (mesh-identical). | sizes, profile, rays |
| `scripts/kit/sweep.py` | `build_stretch(route_id, pts, cls, ...)`: the section sweep along any polyline, bends filleted (radius 1.2 x width by default). | class `G` (giant: 6 m, ledges both sides at -3.6, bed -6.1, basket vault, crown -0.9, water -4.6) or `M` (rui: 3.6 m, one 0.8 m walkway at -3.9, bed -4.9, semicircular vault, crown -0.9, water -4.4); grates and lamps from the route data within 4 m; ends |
| `kit/sweep.py: Section` | Section numbers, wall and vault curves, profile. | add a class here for a new section |
| `kit/sweep.py: grate_shaft` | Parametric grate shaft for any section: vault hole, brick shaft to the street, cast-iron grate, step irons, ladder down to the walkway or ledge. | route u, offset s, street level |
| `scripts/kit/hall_gen.py` | `build_hall(room, ...)`: a hall from a room rectangle: pier grid with 6 to 7 m bays, free piers springing at -4.0 and wall corbels at -2.5, groins to the -0.9 crown, ribs with bluestone voussoirs, quoins, walkways round the walls broken at the mouths, stair and hatch, air shaft, calcite, lime halo. | `room` (rect from the routes file), `mouths` (list of `(wall, bay)`), `stair_corner`, `air`, `walkway` width |
| `scripts/kit/junction_gen.py` | `plan_room(room, routes, on_street, over)` and `build_room(...)`: a junction room (J1) from a room rectangle at rui depth. See "Junction rooms" below. | `over`: per route `t` (along its wall) and `side` (walkway, +1 = towards +t), `stair` `{wall, end}`, `crown_grate` |
| `scripts/build_junction.py` | Export driver: builds a room, check pictures, LOD0/LOD1 GLBs, collision, markers, manifest (`uvRepair`, `layout` with each mouth's stub end, direction and walkway side for the stretch that joins it). | `--room R1`, `--out <dir>`, `--over <json>`, `--lods`, `--no-render`, `--no-export` |
| `scripts/kit/rail.py` | R2 (#272): the rui walkway's iron edge rail. Round posts in cast shoes bolted to the coping's channel face (the 0.8 m stays clear), two rails through knuckles on the bend's offset line, dome caps; ball-topped dressed end posts at the mouths and at each shaft ladder gap, escape irons down the channel face in the gap; at a drain crossing two posts flank the lip stone and the rails run on. Rust stains from every shoe. Collision: one 5 cm slab per run (gaps only at ladders); the bars carry none. | `kit/fittings.json` `rail` (spacing, heights, radii, shoe, gaps) |
| `scripts/kit/drain_crossing.py` | R3 (#272): finds the plan's side drains at the route (`sideDrains`). Walkway side: the egg drain through the wall in two rowlock header rings (15 mm proud) on a flush lime mortar bed with a skirt, a lined barrel that bends towards the drain's run and ends dark, a notched bluestone sill at the mouth and a notched, rebated kerb across the walk with a flush cast grate (bars, frame, ties), a trickle and a pour over the lip, wet/lime stains below. Far wall: the same mouth just above the water. The vault, the walk and the coping are cut or re-laid with the pieces' own outlines (exact boolean, `fitlib.boolean_cut`); plan lamps move off the rings. | `kit/fittings.json` `drainCrossing` (match distance, spacing from ends/shafts, egg, sill, notch, rebate) |
| `scripts/kit/fitlib.py` | Shared: route frame `W(du, y, d)`, chamfered rods, bevelled boxes, notched stones with rounded arrises and metric UVs, boolean cuts that keep UVs, masks and the host's subdivision level (`ruien_level_edge`), mask edits, transparent stains (`runoff_*`, no collision). | |
| `scripts/check_fittings.py`, `scripts/review_fittings.py` | Headless checks (rail clear of the walk, closed solids, no collision on bars/headers/stains, collision gaps only at ladders, post spacing, smooth rails, host cut open, walk cut, coping re-laid, grate plate) and close Cycles review renders of a built stretch's `.blend`. | `--route`, `--walkway`, `--report`; `--out`, `--only` |
| `scripts/build.py` | The O2 piece itself (vliet, gate, giant gallery, Vleeshuis hall) with hand-tuned features. | none |
| `rlib/vliet.py` | Gate end: outlet arch in a quay head wall, tide doors, sluice gear, quay walls, bed. | spec values (`GATE_X`, `VLIET_*`); faces -z only, for other gates rotate the `tide_doors` and `gate_dressing` pieces |
| `rlib/wax.py` | Calcite: `wax_curtain(host, width, length)` on any host surface, groin ridges from the two vault faces, run-off (runnels, wet and iron trails, splash crusts), lime halo on the masonry. | host function, size, thickness, taper, landing |
| `scripts/export_game.py` | The game export: relief bake, masks, AO, family UVs and materials, area chunks of at most 200k triangles, collision, markers, manifest. Also a library (`build_lod`, `export_chunks`). | `--lod 0,1`, `--dry` |
| `scripts/kit_export.py` | Exports the kit pieces below. | none |

## Kit pieces (`export/kit/`, `kit.json` lists files, triangle counts, pivots, SHA-256)

Each piece is one model with its own pivot, LOD0 and LOD1, the shared materials and vertex data.

| Piece | Pivot | Notes |
|---|---|---|
| `grate_shaft_giant` | ladder foot on the ledge | the O2 shaft; other sections use the parametric shaft |
| `stair_down` | foot of the stair | 19 treads, -3.6 to street level, handrail, stairwell, open hatch |
| `drain_mouth_egg` | invert at the wall face | 1.0 x 1.6 m egg drain with lining and header rings |
| `pipe_end` | socket mouth | cast-iron pipe end with trickle |
| `lamp_bracket_safety_lamp` | wall plate | bracket and brass safety lamp; the light itself is a marker |
| `tide_door_leaf_n`, `tide_door_leaf_s` | on the pintle (hinge) line at sill height | one oak leaf each, rest pose shut; open angle in the piece note |
| `tide_door_pintles`, `gate_dressing` | sill centre | iron pintles; outlet arch voussoirs, jambs, sill, apron |
| `penstock_frame` | channel centre at ledge height | fixed part: guides, pedestals, headstock, gears, crank, chain |
| `penstock_door` | door foot centre | moving part: door with ribs and racks; travel in the piece note |
| `mooring_ring`, `wall_ring_chain` | centre | iron rings |
| `corbel_shelf` | underside centre | bluestone shelf with a bottle |
| `calcite_curtain_small/medium/large` | leak point, wall plane z = 0 | 0.4 x 0.8 m, 0.75 x 1.6 m, 1.0 x 2.6 m |
| `bone_pile` | ground centre | the Vleeshuis bone bank |
| `rubble_pile`, `floating_debris` | ground or water centre | brick heap; planks, sticks, rags, straw, corks |

## O2 outlet scope

`outlet_gate` holds only what belongs to the outlet: the arch dressing, jambs, sill, apron, pintles, weed and slime
on the head wall face, rubbish on the apron. The town keeps its own vliet, so our quay walls, bed, quay coping and
vliet debris are not exported. Our brick head wall round the arch is optional (`ruien_o2_outlet_headwall_*.glb`);
the game cuts its own quay wall along `markers.outlet` (opening and dressing outlines in the plane z = 72).

## How to build another stretch

```
"$BL" --background --factory-startup --python scripts/build_stretch.py -- --route L90 --out export/stretches/L90
```

This writes `export/stretches/L90/`: `L90.blend` (editable), `L90_check.jpg`, `L90_mood.jpg`,
`ruien_L90_L90_lod0.glb`, `..._lod1.glb` and `manifest.json` (kit placements, section water, collision, lamp/flame and daylight markers, ladder ends,
water and mist, empty movers). Collision follows the generated section, including shaft holes and end caps;
void cards and water have no collision. End fans close the shell profile down to the bed; the shell
profile alone leaves a triangular opening below the fan centre (#274). Void-card edges and the cap
base beneath the bed stay sharp as hidden mating surfaces. `check_stretch_ends.py` checks end coverage
for both classes, both rui walkway sides and all end kinds. Mask heights follow `Section`; O2 retains its original defaults.
`check_stretch_export.py` checks G and both M walkway sides in headless Blender without textures or a render.
`check_meet.py` checks a tee and a throat on synthetic routes for both walkway sides: closed ring, walk risers, the
giant's steps and head room, water and film.

### Where galleries meet (#272 stage 1d)

- **Tee** (rui into a gallery side). The gallery cuts its shell round the opening and its ledge paving, coping and
  channel wall across the rui's channel. The rui ends its barrel inside a brick ring of two header rowlocks (0.28 m
  thick, 0.24 m deep, face 2 cm proud of the gallery face, soffit 5 cm inside the barrel, 18 mm worn arrises; thinner
  over the crown, where the vaults are nearly level). Its far wall runs on through the ledge as a culvert with dressed
  bluestone return copings (1 cm proud: seam stones where the directions meet), bluestone quoins at the mouth, a
  bluestone sill at the rui bed (-4.9) with its nose 6 cm proud, and a step at -5.5 on the gallery bed for Antigoon.
  The walkway climbs a bluestone step (-3.75) and threshold (-3.59) onto the gallery ledge. The rui water starts at the
  sill lip and a film carries it 0.2 m down into the gallery water. No bridge crosses the mouth: Antigoon passes
  upright, and the gallery ledge beyond the mouth ends on its return coping (a crossing is Steve's choice).
- **Throat** (gallery ends, rui begins). The end wall stands square to the rui; the gallery runs on 0.6 m and is cut
  at its plane (exact u knots on the channel walls). The rui builds the same ring on the flat wall, the step and
  threshold from the walkway-side ledge, a dressed end coping where its walkway overhangs the gallery channel, the face
  where the far ledge stops, the quoins, sill, giant's step and film; the gallery builds the wall round the ring and
  the wall below the sill.
- Routes that run on (`through`) meet on a shared bed and without relief bake within 0.3 m of the seam plane
  (`export_game.SEAMS`), so separately built routes close without a crack. Coping joints are packed with silt and the
  channel faces run 6 cm up behind the coping; the parametric grate's lining is one closed ring in an exact vault cut
  and open-end cards stand 2 cm past the end, 15 cm larger than the section (#276).
`build_stretch.py` adds the R2 rail and R3 drains to every class M route from `kit/fittings.json` (`--no-fittings` leaves them out); `check_fittings.py` checks them.
For an external native intake and review, see `docs/ruien-native.md` (`--out`, `--ruien-areas`). For a hall:
`kit/hall_gen.build_hall(room, mats, coll, rng, mouths=[('z0', 1)])` (see `work/test_hall_gen.py`, which built C3).

Proof: `export/stretches/L105/` is the Kipdorprui (L105, 21.7 m, two bends of 4.1 m radius, one grate shaft with ladder, 1.23 M triangles at LOD0) built with these scripts;
`export/stretches/hall_C3_check.jpg` is the C3 hall from its rectangle.

## Known limits

- Tees need a G host straight within about 3 m of the node and a rui within 25 degrees of square; throats a rui within
  15 degrees of the gallery's line. Other meetings (two galleries meeting at an angle, ruien meeting each other, the
  junction rooms) end `open`. A rui that meets a junction room starts at the room's stub end: `build_junction.py`
  writes each mouth's stub end, direction and walkway side in its manifest `layout` (J1, "Junction rooms" below).
- The hall generator and the gate end take their sizes through `spec` (module values), so build one hall or gate per
  Blender run (or reload `rlib.hall`).
- The native network matches the kit's rui: one 0.8 m walkway, 2.8 m channel and semicircular spring at -2.7 m.
  `walkwaySide` selects the side; change `Section` if Steve wants a second ledge.
- Fixed pieces taken from O2 are sized for the giant gallery (the shaft, the drain, the penstock).

## Junction rooms (J1, #272 stage 1d)

`kit/junction_gen.py` builds a junction room from its rectangle in `ruien-routes.json` at rui depth (bed -4.9, water
-4.4, walkway -3.9, crown -0.9). Run `"$BL" --background --factory-startup --python scripts/build_junction.py -- --room R1 --out <dir>`;
convert the folder with `--ruien-area <dir> --area R1 --out <resource folder> --lods 0,1` like a stretch.

- **Vault.** A sail vault: one sphere through the four corners (springing -2.1, apex -0.9), so pendentives and cap are
  one surface and any rectangle fits; the four wall arches are segmental arches of their own rise. Squinches would need
  an octagonal drum, and the 0.9 m street cover leaves no height for one. The rui vaults reach -0.9 too, so a dome can
  never stand on the mouth arches (as the J1 picture draws it): each mouth is a lunette, an elliptic barrel (crown -0.93)
  cut into the dome, which leaves a dome cap of about 1.5 m round the crown. Groins are rounded (smooth maximum, about
  1 cm) and lie on mesh edges; relief fades to nothing along groins and joints so they stay closed after the bake.
- **Courses.** Each surface has its own chart: ring courses round the crown on the dome (in 20 gores), barrel courses
  along each lunette, level courses on the walls, metric everywhere.
- **Long rooms.** Equal bays along the long side, the fewest for which a bay's full diagonal is at most 14 times the
  1.2 m rise and the transverse arch rises at least 1/12.5 of its span. Each bay is its own sail vault; a header
  transverse arch on bluestone pad stones covers the crease. R1 (7.5 x 5.5) is one dome; R8 (10 x 21) three.
  A bay's wall arch on its boundary is lower than Antigoon's head (about -1.3), so a mouth on a short wall of a
  several-bay room runs on as one lunette barrel through every bay and the transverse arches stop at it; he crosses
  from one end barrel to the other under a dome cap. A long room with mouths only on its long walls has no giant
  route along it.
- **Mouths.** Every M line that ends in the room gives a mouth where it leaves the rectangle, clamped clear of corners
  and bay boundaries. Each is one solid header ring (intrados crown -0.945, 6 cm proud) on bluestone imposts,
  bluestone jambs with 8-12 mm arrises, and the rui's first 1.7 m with its walkway and a dark end card.
- **Walkway.** Each rui's walkway side and the fewest cast-iron footbridges are chosen so one walkway joins every rui
  walkway and the stair. Setts in rows along each run (0.11 m courses), bluestone coping, raised dressed seam stones
  on every mitre (room corners, rui junctions, stair landing). Room walls run down to the bed behind the walkways,
  so no hollow opens under the setts. A footbridge closes its channel to Antigoon; the manifest says which (R1: L100, #283; the crossing is Steve's choice, #286).
- **Head room.** 2 m over the walkway beside the corners (vault springing -2.1); springing stones, pad stones and
  imposts stay outside a 0.32 m walker on the walkway's centre line; lanterns hang from -2.0. The stair's inclined
  barrel is 2.4 m over the nosings: Jef's 0.32 m disk rests on the next step and reaches back under the slope.
- **Stair.** A corner arch, setts landing, dark worn bluestone flight (risers <= 0.18 m, going 0.27), lined inclined
  barrel, an open stairwell under a hatch whose street opening must be street in `walk.png` (checked over its frame);
  a mouth on the same wall moves up to 3 m to make room. Optional D1 crown shaft per bay.
- **Export.** `manifest.json` asks for `uvRepair` (RuienImport repairs narrow and collapsed charts at full precision,
  as RuienRepair does for O2). Collision is the construction surfaces (dome on a 0.15 m grid, walls, shells, walkway
  tops and faces, bed, stair) plus the solid stone, brick and iron pieces.
