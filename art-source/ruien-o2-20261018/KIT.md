# Ruien kit

Generators and reusable pieces to build the whole Ruien network from `docs/plans/ruien/ruien-routes.json`.
O2 (vliet sluice, giant gallery, Vleeshuis hall) is the first use. All scripts run headless in Blender 5.2:
`BL="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"`, from this folder.

## Shared conventions (the same for every piece and stretch)

- Coordinates: glTF +Y up, glTF (x, y, z) = game (x, y, z). In Blender: X = x, Y = -z, Z = y.
- Materials: one tiling set per family in `export/textures/` (2048 px PNG): `ruien_<family>_albedo`, `_normal`
  (OpenGL, +Y green up), `_height` (16 bit), `_roughness`, `_ao`. Families: `brick_flemish`, `brick_stretcher`,
  `brick_header` (4.8 x 2.4 m tiles, plus `_albedo_slime` and `_albedo_lime` variants), `bluestone` (2.4 m), `calcite`
  (1.8 m), `oak` (plank atlas), `iron` (0.9 m), `silt` (4 m), `sandstone` (1.6 m), `moss` (1.2 m). Tile sizes and relief
  depths are in `export/textures/texture_sets.json`. UVs: 1 unit = one tile.
- Vertex data on every mesh: `COLOR_0` masks (R wetness/slime, G lime/halo/runnel/efflorescence, B soot/grime,
  A moss), `_AO` (baked occlusion, 0.6 m), `_BAKECOL` (baked render base colour of masonry; alpha 0 = not baked).
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
| `scripts/build_stretch.py` | Builds one route of the network with `kit/sweep.py`, renders a check and a mood picture, exports GLBs (LOD0, LOD1) and a manifest. | `--route <id>` (from ruien-routes.json), `--out <dir>`, `--walkway 1/-1` (rui walkway side), `--start` and `--end` (`junction`, `open`, `cap`), `--lods 0,1`, `--no-render`, `--no-export` |
| `scripts/kit/sweep.py` | `build_stretch(route_id, pts, cls, ...)`: the section sweep along any polyline, bends filleted (radius 1.2 x width by default). | class `G` (giant: 6 m, ledges both sides at -3.6, bed -6.1, basket vault, crown -0.9, water -4.6) or `M` (rui: 3.6 m, one 0.8 m walkway at -3.9, bed -4.9, semicircular vault, crown -0.9, water -4.4); grates and lamps from the route data within 4 m; ends |
| `kit/sweep.py: Section` | Section numbers, wall and vault curves, profile. | add a class here for a new section |
| `kit/sweep.py: grate_shaft` | Parametric grate shaft for any section: vault hole, brick shaft to the street, cast-iron grate, step irons, ladder down to the walkway or ledge. | route u, offset s, street level |
| `scripts/kit/hall_gen.py` | `build_hall(room, ...)`: a hall from a room rectangle: pier grid with 6 to 7 m bays, free piers springing at -4.0 and wall corbels at -2.5, groins to the -0.9 crown, ribs with bluestone voussoirs, quoins, walkways round the walls broken at the mouths, stair and hatch, air shaft, calcite, lime halo. | `room` (rect from the routes file), `mouths` (list of `(wall, bay)`), `stair_corner`, `air`, `walkway` width |
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
"$BL" --background --factory-startup --python scripts/build_stretch.py -- --route L90 --out export/stretches/L90 --start junction --end junction
```

This writes `export/stretches/L90/`: `L90.blend` (editable), `L90_check.jpg`, `L90_mood.jpg`,
`ruien_L90_L90_lod0.glb`, `..._lod1.glb` and `manifest.json` (with the kit placements it used). For a hall:
`kit/hall_gen.build_hall(room, mats, coll, rng, mouths=[('z0', 1)])` (see `work/test_hall_gen.py`, which built C3).

Proof: `export/stretches/L105/` is the Kipdorprui (L105, 21.7 m, two bends of 4.1 m radius, one grate shaft with ladder, 1.23 M triangles at LOD0) built with these scripts;
`export/stretches/hall_C3_check.jpg` is the C3 hall from its rectangle.

## Known limits

- Junctions are simple: a junction end is an arch ring and a dark card; the opening into the other gallery is not cut
  yet. Junction rooms (blue patches) should use `hall_gen` with rui depth once its section heights are parameters.
- The hall generator and the gate end take their sizes through `spec` (module values), so build one hall or gate per
  Blender run (or reload `rlib.hall`).
- The network file gives the rui channel as 2.0 m with a 0.8 m walkway in a 3.6 m width; the kit uses one 0.8 m
  walkway and a 2.8 m channel (as briefed). Change `Section` if Steve wants a second ledge.
- Fixed pieces taken from O2 are sized for the giant gallery (the shaft, the drain, the penstock).
