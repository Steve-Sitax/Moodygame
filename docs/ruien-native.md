# The Ruien in the native game

The sewers under the town (plan: [plans/ruien](plans/ruien/README.md)). Everything is data-driven, so the whole network
can follow area by area; the first area is O2: the vliet sluice outlet, the 38 m Vlietrui and the Vleeshuis hall C2.
Code: `godot/src/World/Ruien/`. Data and resources: `native-godot/world/ruien/`.

O2 access uses the existing house doorway at (-157.787, 132.000), an inward-opening leaf and a buried cellar stair.
A vaulted side passage and supported maintenance walk join the hall bridge; a barrel under the new stair keeps the
existing bridge route open. Both former road hatches are retired under continuous paving, and the street grate is
closed ventilation. Deep channel water uses Jef's existing swimming controls, with `E` at the escape irons. Ladder
spacing, local offsets, gate channel widths and keeper landing paths are area data. The water query follows the
rendered sheets, leaving the street navigation map dry.

The original [construction options](plans/ruien/ideas/README.md) were A1/B2/C1/D1. A1's road lids are now retired;
its underground flight and vaulted niche remain. B2's side drains cross the walkway in recessed grated gutters.
C1 is a continuous brick arch; D1 has a closed round street grate and flared brick lining. All treads are bluestone.

The historical `RuienSurround` kit supplies keeper, hall and grate frames: 30 cm deep reveals, 32 cm wide stair coping
(23 cm at grates), 6.5/3.5 cm raised tops, recessed bearing seats and mortared joints. The street cut includes
upright kerb faces and collision proxies; kerbs butt against the frame. The keeper aperture extends 40 cm farther
over the flight so the vault crown stays below the street without lowering its headroom. Exported lining repairs
apply to both LODs and collision. Retired ways omit the street frame and leaves; underground treads and handrails remain.

Asset edge notes: coping profiles use 8 mm curved arrises and 6 mm rounded ends; the machined rebate is eased
2 mm. Iron has 1–3 mm bevels; flat pin ends and hidden mating faces are intentional. Metric charts include narrow
faces. Mortar beds and perimeter packing close the joints below the paving; no extra shader kind or light is used.
Hatch commands queue behind an active poll, and action prompts are withheld during movement. Both leaves and
their collision rotate about the same pivots. Review evidence for #211 is in `_tmp_verify/ruien-o2-fix4/`.

Inside inspection repairs (#212), all reusable for the other areas:

- `RuienUnfold` gives every brick surface (export and native) one metric chart per connected surface: level courses
  on walls and vault webs, the frame carried round returns and soffits, ring courses at round shafts (`grates[].collar`).
  The baked colour is low-passed so the old mortar lines do not ghost; the shader lays a whole brick over the
  texture's black missing-brick slots, which no longer meet the geometry's recesses.
- B2: the exported lining darkens with depth and runs on round a bend (`RuienDrain.Throat`); `RuienDrain` adds two
  native rowlock header rings on a mortar bed (the decimated exported rings are dropped). The study's first drain,
  now behind the keeper landing, is bricked up.
- `RuienPipe` (areas.json `pipes`): beaded cast socket, open bore that darkens and holds silt, rough lime fillet,
  brick backing and a run-off film; the exported closed outlets are retired and the vertex stain fans over the walk.
- `RuienEnd` (`channelEnds`): bricked-up stub ends with an arched, barred culvert; the side channels carry water.
- `RuienKit.Collar`: D1's brick collar of three header rings and an outer stretcher ring over the trimmed crown.
- A1 leaves have riveted angle frames, T-ribs, a stiffener and a drop ring below; hinge straps run down the reveal.
- Calcite crusts and baked lime vary from bay to bay; their ends fade instead of stopping square.
- Walk setts are charted by arc length along the walk's own centre line (the export's swept key line offset to
  the walk and mitred at corners), so the rows stay at one scale through bends; their UV repair keeps the chart
  continuous and their relief is low-passed, which removed the striped setts at the gate seam.
- The old drain mouth behind the keeper landing is bricked up, and an open strip of the east side channel's mouth
  vault is closed.

Follow-ups (#217, #213, #202): the keeper niche meets the gallery with a 3 cm rounded brick arris (`RuienStair.ArrisCut`: the exported lining is trimmed offline by RuienRepair, the native reveal at load, and `ArrisStrip` lays the rounded brick). Native kit bricks are charted before any trim, and `RuienUnfold.Apply(carrySmooth)` carries the frame across smooth edges of sloped faces, so an inclined barrel's crown no longer turns its courses into the level vault (the crown band). `throatFills` in areas.json put hidden brick behind the C1 backing's right extrados. The ambient rain skips drops below the street under the cover map. Down the street grate's ladder Jef turns to face its rungs (`Jef.FaceDuringClimb`).

The town's broad river sheet is excluded beneath the Ruien by a world-space cover texture, including masonry and side galleries. This replaces the old water-level stencil lid, which could be clipped out at particular camera heights. The air volumes clip against sampled scene depth themselves, so the hardware depth test must not discard their enclosing box at the shaft rim. Neither fix adds a shader kind or a real light.

Street entrance, lamps and wall repairs (RU-ruien2, 2026-11-02): the hall hatch's leaves are native
(`RuienSurround.Leaves`): two ledged and braced oak leaves of four 42 mm planks with 3 mm eased arrises and joints,
standing open at 85 degrees on the cap's hinge pins, forged strap hinges with knuckles and dome-headed bolts, and a
lifting ring; collision follows the leaves. The export's 15 cm thick leaves and their collision are dropped at load
(`DropExportLeaves`); the handrail stays. Lamps listed in `lampHooks` (and kit pieces with `"hook": true`) hang from
`RuienHook`: an 18 mm round bar leaded 50 mm into the brick, a 75 mm plate laid on the wall's own normal with two
dome-headed bolts and a lead collar, a level arm with a knobbed upturn and a ring; the lantern hangs plumb under it.
The export's straight bracket, its collision and the kit's iron bracket go; a lantern the curved wall comes closer to
than 0.22 m at the arm or 0.12 m at the glass moves out with its light (the side gallery NE lamp sat in the wall).
Flat hall walls keep the straight bracket. The keeper landing stops 4 cm past the jamb line. The setts' chart runs on
straight past its line's ends (the hall throat had a smeared strip). `RuienRepair.MendSealed` evens the bake and
masks round the bricked-up first drain mouth (the ghost ring right of the niche) and drops its leftover header ring;
`ClearDarkBake` drops bluestone bakes darker than 0.07 linear (the hall's near-black quoins and plinths). In the niche
the flight's side wall ends where the near jamb starts (they shared a face) and a brick lintel at the landing
ceiling's free edge closes the slot under the niche's sloping vault (no lower than that edge: the headroom stays). The keeper crew face the way they walk.


## The R1 sample (#272)

The first playable piece of the full network, installed next to O2: junction room R1 by Sint-Pauluskerk and the first
22-26 m of the three ruien that meet in it (L65 22 m, L100 26 m, L114 25 m). Each shows a street grate with its ladder,
plan lamps and the plan's side-drain crossings, and ends at a bricked-up stub (`RuienEnd`, barred culvert) where the
next area joins. Reach it through the neighbouring house's existing doorway at (162.714, 301.475), whose inward-opening
leaf leads to a facade-parallel cellar stair and a vaulted passage into the room, or with the kit command `ruien r1`.
The former road hatch is retired: the town's paving and collision remain whole there. The three street grates are
ventilation only (`streetGrates: "ventilation"`), with no climb prompt or moving lid in the carriageway.

`art-source/ruien-o2-20261018/config/R1.json` fixes the surveyed doorway connection and keeps the three mouths in their
authored positions. The room generator requires a facade-door connection or an explicitly reviewed square footprint;
the walk mask cannot approve an entrance site. End faces at the shared passage/reveal joints are hidden mating surfaces.

- **Areas.** `r1` (the room), `r1_l65`, `r1_l100`, `r1_l114`, one converted export each. `group` (default the area's
  id) draws a group whole while the eye is underground in any of its boxes (the room and its ruien see one another);
  at a street opening only that area is drawn (the whole group at a grate cost some 700 more draw calls).
- **Build.** `build_junction.py --room R1 --joined L65,L100,L114`, then `build_stretch.py --route <id> --from-room
  <R1 manifest> --clip 0,<length> --end stub` (KIT.md "A rui from a room"); L65 adds `--drain-match 1.6`. The
  areas.json entries come from the manifests: zones (the swept path, walkway side), `channelEnds` (`water` true: the
  channel runs on into the culvert), `spills` (each crossing's and far-wall mouth's pour, reach 7 and 6 m) and `drips`
  (each grate's shaft, reach 5 m), `lampHooks` (the stretch lamps on the curved walls).
- **Light.** The plan's rule (every point within 20 m of a grate, room, gate or lamp) held, yet the crossings and stub
  ends were black at midday: in the game a grate lights its rui about 7 m each way and a lamp about 6 m. Four lamps are
  placed by hand in the plan (`ruien-network.json` `lamps.placed`, kept by `plan.py`): L65 u 15.5, L100 u 8, L114 u 2.5
  and 20.5; every walkway point is now within 0.55 of some source's game range. Lamps are named `<route>_lamp_<k>` and
  grates `<route>_grate_<k>` (ids are unique across areas).
- **Antigoon.** Every rui keeps its silt a skim along the channel's middle, so the 3.85 m giant stands upright on the
  -4.9 bed with 0.135 m to spare (49 points along the three ruien); floating planks carry no collision. The L100
  footbridge leaves lie down in normal play; the bridge proof raises them for the giant.
- **Cost.** About O2's: room landing 23.7 ms, a rui walkway 18.3, O2's gallery 21.1 in the same runs (`--profile-parts`,
  contended; worklog 2026-11-04). `WaterAt` skips each water sheet by its bounds: every walker, gull and cart asks it,
  and the streets over a rui lie inside its area's box (before, O2's own views ran 5-7 ms slower with the sample).
- `--ruien-proof-town-clear <area prefix>` checks that no drawn town triangle lies inside the areas' masonry (the
  river's sheet is skipped: its shader discards it under the cover map). `--ruien-proof-walk` points may be
  `{"ladder": id, "dir": "up"|"down"}` (the E prompts at a street grate's ladder) or `{"shot": name}`.

## Sound

The Ruien are a room of the soundscape ("ruien" in `Soundscape.Halls`, `RuienSound.cs`): a 3.4 s brick echo, the
street at 0.14 gain under a 300 Hz lowpass. `Ruien.OpenAt` dries the echo towards an opening (1 within 1.5 m of a
grate, shaft, hatch or the outlet, 0 nine metres in): the decay shortens by up to 45 percent and the send by up to 55.
Steps underground are room sounds, so they ring too. Placed water sounds (`Soundscape.RuienPoints`, built by
`Ruien.SoundPoints`), each at its own place with its own reach (3D distance, so the street above does not hear them):
a spout's pour where it meets the channel (`ruien-spill-381418-loop.ogg`, reach 7 m), a drop now and then from each
pipe mouth (reach 5 m) and from the area's `drips` (vault joints over the channel, the niche's seep; reach 5-6 m, an
interval each), cut from `ruien-drips-402929.ogg`. The game reads recordings from the data pack: new files reach it when
`prepare-native-package.ps1` rebuilds the pack (with the fingerprint); until then `--audio <source audio folder>` plays them. The side drains' spouts (`RuienDrain.Spout`) are a falling sheet
of the existing wall film (water kind): lip speed 0.62 m/s from the gutter's end, widening as it breaks up, running
on under the water at its lowest level. `--ruien-proof-path <json>` flies the camera along keyed paths for a review
film (with `--write-movie` and `--fixed-fps`); `solo` and `probe` measure one source's reach.

## Data

| File | What |
|---|---|
| `network.json` | The plan's lines, rooms, gates, grates, stairs and lamps with the gallery classes' sections. Made by `python -I tools/ruien/godot_network.py` from `docs/plans/ruien`; the game never reads `docs/`. |
| `areas.json` | The areas the game draws: zones (lines with a path or a network line, rooms), gates (the opening cut through a quay wall), water, light sources, mist, the dev entry, and the underground air (colour, fog, haze, exposure, fill). |
| `materials.json` | Each material family's shader kind and numbers, shared by every area. |
| `textures/` | One tiling set per family (albedo, the brick's slimed and limed albedos, normal, packed height/roughness/AO), BPTC/RGTC with mipmaps. |
| `<area>/` | A converted Blender export: `area.json` (keys and their LOD meshes), `mesh_*.res`, `collision.res`, `markers.json`. Without it the game builds a stand-in from the zones. |

Conversion (headless, once per export; it writes under `res://world/ruien` and quits):

Generated manifests with `cls` receive brick unfolding and narrow-face UV repair automatically, across each LOD's
exported objects. Stretch `surfaceLayout` supplies the swept path and walkway side for native setts and their
collision; older exports use the selected area's zones. Use `--lods 0,1` to convert both LODs and audit both.
The original O2 study still uses its separate immutable-snapshot repair and unchanged import path.

    godot --headless --path native-godot res://world/ruien/convert.tscn -- --ruien-textures <export>/textures
    godot --headless --path native-godot res://world/ruien/convert.tscn -- --ruien-area <export> --area o2
    godot --headless --path native-godot res://world/ruien/convert.tscn -- --ruien-repair <immutable export snapshot> --area o2 --headers <fittings.glb>

`--area` is required (no default). The repair (`RuienRepair.Convert`, #272 stage 1a) works for any area: an area
with only rooms runs too. Generic passes run on every chunk: brick charts (`RuienUnfold`), narrow-face UVs
(`RuienUv`), calcite and lime variation, dark bluestone bakes, round-shaft collars, the run-off ribbons and the keeper
stair cuts (`keeperStairs[].repairChunks`). Every line zone is repaired on its own chunks (`repairChunks`, parts of
the mesh file name; none = all) along its `repairPath` (the export's own sweep, smoothed with the zone's `curve` and
`handle`, or `repairCurve`/`repairHandle`). The area's data drives the rest:

- `drains`: B2 side drain mouths `{zone, u, side}` on a line zone: the native drain, its spout sound, the gutter cut
  in meshes and collision, the open throat behind the exported end card.
- `sealedDrains`: retired mouths, bricked up and their ghost evened.
- `repair.headersPiece`: the kit piece the `--headers` fittings go to (`res://world/ruien/kit/<piece>.res`, placed by
  the area's `kit` list; default `drain_headers_<area>`, O2 keeps `drain_headers`).
- `repair.fixes`: the area's own export defects, each `{action, chunks, families}` (families exact, `prefix*`,
  `*suffix`, `*part*`): `dropFamily` (retire a surface), `keepBelow` (keep triangles whose centre is below `y`),
  `splay` (a gate apron rising to the outlet bed with splayed walls; meshes and collision), `dropBox` (triangles
  strictly inside `min`..`max`), `addBox` (bevelled blocks at `at`), `vaultStrip` (an elliptical vault patch),
  `mouthRings` (backing rings behind loose mouth headers), `cutCollision` (a box out of the collision),
  `addCollisionFaces` (source LOD faces in a box that the collision export left out). Numbers and notes: O2 in
  `areas.json`; code `RuienRepairFix.cs`.

A family name ending in `_rim` (`RuienTextures.OwnChart`, the kit's arch rims) is drawn, tiled and audited as its
base family but keeps its exported radial charts: `RuienUnfold` skips it.

For an isolated stretch intake, add `--out <absolute resource folder>` to `--ruien-area`; the folder gets
`area.json`, meshes, collision and markers without changing the installed world. `--area` names the area;
stretch mesh prefixes come from the manifest's route ID. Empty or absent movers and absent outlets are valid.
Daylight beam fall uses the manifest's `waterMin` (or the installed area's value for older exports).

A junction room (`build_junction.py`, art-source KIT.md "Junction rooms") converts the same way; its manifest asks
for `uvRepair`, so RuienImport runs `RuienUv.Repair` on every surface at full precision (older exports are unchanged).
`--ruien-proof <dir> --ruien-proof-walk <json>` walks Jef along listed points (grounded and dry at each) and tests an
upright 3.85 m giant capsule on the bed at listed points, for any area.

A native review can use `--ruien-areas <absolute JSON>` to replace the area list for that process. Keep the usual
area-list schema, set its area's `export` to the external resource folder, `waterMin` to the section's water,
and its line zone to the stretch's path/class. `--ruien-always` forces visibility; it is a flag, not a folder argument.
Isolate `SCHELDEMIST_USER_DATA`, `--db`, `--prefs`, `--author-root` and `--port` for this run as for other proofs.
Convert both LODs with `--lods 0,1` (the default is LOD0 only). `--ruien-proof-walks <json>` walks Jef on a stretch:
`walk` entries go through waypoints and must stay grounded at the walk level (`y`, `tol`); `push` entries hold W
along `dir` and must stay on the walkway (`blocked`: the rail holds) or leave it (a ladder gap).

Every class M stretch carries R2 and R3 (Steve, #272, 2026-11-03), built in the generator (`kit/rail.py`,
`kit/drain_crossing.py`, numbers in `kit/fittings.json`): the iron edge rail on the walkway's water edge, with
collision as one slab per run broken only at ladder gaps, and at each plan side drain on the walkway side the
covered crossing (egg mouth in two rowlock rings, notched bluestone sill, flush grate over the recessed gutter, pour
into the channel); on the far wall the drain opens just above the water. The export cuts the vault and walk for
them, so no native repair is needed. `check_fittings.py` checks the built `.blend`.

Section classes carry `spring`, `water`, `channelWidth` and `walkwaySide` (0 = both, +1/-1 = one side of the
path normal `(tangent.z, -tangent.x)`). A zone can override these and `walk`. M matches the kit: spring -2.7,
walk -3.9, water -4.4, one 0.8 m ledge and a 2.8 m channel. Paving, runoff, drains, escape irons and stand-in
sections use those bounds. Authored pipe `front` coordinates remain explicit; `zone` selects its runoff floor.
`keeperStairs[].zone` selects the lining for both repair and native arris/reveal; omission keeps the first-line
fallback, while an unknown explicit zone is an error. Flight orientation is still the separate #272 stage 1c task.
`stairSurrounds` accepts an id or `{id, steps, going}`; its support bed follows the section. A repair `keepBelow`
can use `{zone, walkOffset}` instead of absolute `y`.

`--ruien-repair ... --out <absolute folder>` copies the immutable source and repairs that external copy; any
headers piece is written beside it. This permits comparisons without replacing installed resources. The headless
`--ruien-section-proof <report folder>` checks both M sides, paving relief, drain impact and keeper-zone selection.

Meetings (#272 stage 1d): a rui that ends in a gallery's side (tee) or where a gallery ends (throat) is built in
Blender by both stretches from the plan (`art-source/ruien-o2-20261018/scripts/kit/meet.py`, KIT.md "Where galleries
meet"). Each stretch is its own area with its own water level; the rui's water starts at its sill lip and an exported
water film (`ruien_misc_Water_film`, no collision) carries it down to the gallery water. No native code is involved.

## Rendering

- Three shader kinds (`native-godot/shaders/ruien_*`, shared parts in `ruien_common.gdshaderinc`), added once with
  Steve's approval of 2026-10-18 and recorded in `assets/shader-baseline.json`:
  - **masonry**: every solid surface. The family's set blended by the vertex colour (R wet/slime, G lime/halo/runnels,
    B soot, A moss), baked AO in UV2.x, parallax occlusion near the eye on top of the real relief, wet gloss. The
    study's baked colour (CUSTOM0) sets the base. The lime halo, bloom and salt flecks are drawn over it from G
    (`halo_k` per family), because the bake's vertices sample them too sparsely. Runoff stains (`cover` < 1) break up
    in world space, not per pixel.
  - **water**: murk with depth absorption over the bed seen through it, drifting ripples, drip rings, scum, screen-space
    reflections of the vault and lamps, and the walls' thin films.
  - **air** (premultiplied): daylight beams down shafts, the low rot mist (lit by the lamps), flames and lamp glass.
- **Light**: a list of the 32 sources nearest the eye (`ruien_lights`, 4 texels each): oil lamps (flicker, soft core) and
  openings (outlet, grates, shafts, hatches) whose light is the day's sky, cold, or at night a trace of street glow.
  No Godot light lights the stone, so the network can have any number of lamps. A fixed pool of 4 OmniLights
  (`LampPool`) follows the nearest lamps for the player's arms and body only (their cull mask).
- **Cover**: `ruien_cover` is a top-down map of the zones (red: 1 under a vault; green: a closed way in, see Entrances). Covered surfaces take no sky, no sun, no
  street spill; the eye's cover is `Daylight.Below`, which brings in the underground air (fog, no lamp glow, sky light
  and sun on people and loose things off, the eye's adaptation as exposure).
- **The river**: the town's broad sheet changes height with the tide. Its existing water shader discards fragments
  inside the Ruien cover map, so camera height, near-plane clipping and tide cannot expose it underground.
  The separate water inside stays at the area's `waterMin` and is held, rising a little, while the river is higher.
- **Gates**: `RuienGates.Cut` cuts each gate's opening through the named town meshes in `NativeTown` before collision
  and navigation read them (`QuayNotch.CutConvex`); the installed town resources are untouched. `--no-ruien-gates` skips it.
- **Visibility**: an area is drawn only while the eye is in its box under the street, before one of its gates on the
  open water, or at one of its street openings. LOD per export key by the eye's distance to the key's box (16 m).

## Dev

Antigoon is 3.85 m tall (#189, decision 2026-10-19). His model is uniformly scaled from the authored 5.4 m rig;
collision, clearance, reach and world-space pose offsets use `AntigoonSize`. His feet stand on the channel bed:
0.5 m of water surrounds his legs, leaving 0.15 m below a 4 m crown. The raised human walkway is too low for him.
The red gallery gives 1.35 m above his head on its bed; its maximum 2.4 m water is now above his waist.

**Route limit:** only O2/C2 and the R1 sample are built. C1 under the Grote Markt and the connecting galleries are plan data, and
Antigoon's live encounter still uses a street-only X/Z route map that excludes water. A complete refuge-to-Ruien
route is not implemented or accepted. It needs separate underground footing/navigation and the missing areas.
The selected C1 arch clears a 3.86 m tall, 0.928 m wide capsule over the actual channel bed at all four throat
samples (x -149.5, z 109.5–111). This checks the local opening, not an autonomous underground route.
`--antigoon-size-proof <output>` captures him in daylight and on O2's bed, measures the model/collision, checks a
street route and records blocked upright samples in the installed gallery in `size.json`. Supply isolated `--db`,
`--prefs`, `--author-root`, `SCHELDEMIST_USER_DATA`, an unused `--port`, and `--no-ai`. Its O2 witness is a placement
for inspection, not proof of an autonomous underground route.

- Kit command `ruien [area]`: Jef on the area's dev entry (a gallery ledge).
- `--ruien-live`: `areas.json` and `materials.json` are read again when they change (light, air, material numbers).
- `--ruien-lod 0|1`: every key at one level (for measuring). `--ruien-always`: always drawn. `--no-ruien` turns the
  part off; `--no-ruien-gates` leaves the walls whole.
- Snap views take `fov=N` (vertical degrees) to match a Blender lens.

### Start-up

The entrances and areas are built on a worker thread beside the town's load (`Ruien.StartBeside`, started once the
street cuts are made; the globals and cover are set before the load starts). Main waits for the worker before the town
enters the tree, so it never runs beside the main thread's own loads; the part then lays the finished nodes into the
view at its own place in the start, and later parts see the same Ruien as before. A new area, entrance or kit piece needs no extra step:

- Builder code (anything called from `BuildPieces`) runs off the main thread. It must not touch the scene tree,
  `Ruien.I`, physics queries or other parts; add nodes through `place(...)`, never `Main.I.View.AddChild`.
- Fixed geometry goes through `RuienGeometryCache` (or `RuienEntrance.Cached` for a Spec-built node tree). Keys hash
  the content of `world/ruien/**/*.json`, the source export and the build's code revision, so an edit rebuilds only
  on the next start; an edit to any Ruien JSON rebuilds every Ruien entry once.
- Proofs: `--startup-proof` prints `ruien pieces: ... <digest>`; it must match a `--ruien-in-order --no-startup-cache`
  run. `--ruien-in-order` builds on the main thread at the part's place, as before.
- Cost now (2026-11-07, 5 areas, 26 entrances): about 7 s on the worker, hidden behind the town's load, plus about
  4.5 s on the main thread to lay the pieces in (mostly collision shapes). Lay-in time grows with the network; past
  roughly twice today's size, lay far areas in by distance instead of all at the start.

### Frame costs per view

Use `--profile-parts` with `--ruien-proof-views <json>` or `--ruien-proof-path <json>`.
`frames.json` keeps the existing wall mean/p95 and adds `parts`: complete rendered-frame wall time,
engine process/submission and named CPU scopes, total draw calls, scene counts and town-group mesh paths.
Paths write `<segment>-parts.json` after each segment. Fixed-fps/movie paths are diagnostic, not speed tests.
CPU scopes nest; do not add their times. Counts named `visibleMeshes` mean scene visibility flags, not occlusion
or frustum results. MultiMesh nodes count once; draw calls include all active viewports and passes.

`--ruien-proof-audit-parts town/city,town/churches` measures selected groups after the timing window:
eight frames before, hidden and restored, averaging the last four draw counts in each phase. The per-group
removed-draw estimate uses the mean of the two visible phases minus the hidden phase; it includes shadows and
mirrors and can drift as people move. `<view>-draw-audit.json` records both phases and visibility counts.
A view can set `"audit": false` to skip this work during matched timing. Before/hidden/restored PNGs and changed-pixel counts accompany it; `controlPixels` compares the two visible
pictures. The scene is paused with fixed grain, and mirrors refresh explicitly.
`positiveControlPixels` hides the camera geometry deliberately and must be nonzero; `controlPixels` must be zero.
The diagnostic restores render layers in `finally`
and never changes collision or enables production culling. Use the emitted group names to select candidates.

A view may explicitly set `"hideParts": ["town/city"]` for a candidate B sample; layers restore after that view.
This is a proof-only experiment, not a gameplay culling option.

The outer runner must exclusively create `D:/Code/_locks/TOWN-ART-RENDER` before launching and release its own
lease on exit, so initialization and image capture also serialize with art reviews.
The proof acquires the shared performance lease and writes `isolation.json`; concurrent windows mean diagnostic
numbers only. Alternate matched A/B runs, discard initial samples, report run ranges and overlapping ranges.
A culling change still needs zero differing pixels in Ruien and street views at midday, rain and night.

## Moving parts and ways in

- **Tide doors** (the export's movers, `markers.json` movers): each leaf turns on its hinge, shut while the river stands
  above the water inside, swinging open over about a minute once it falls below it; its own collision turns with it.
  A held tide (the dev kit, a test picture) puts them there at once. The **penstock** stands raised by the area's
  `penstockRaise` (its travel's top), so the channel can be waded under it.
- **The outlet** at low water: the vliet bed, the apron and the sill (-5.05) lead down into the channel (-6.1, the water
  about chest deep); **step irons** up the north channel wall past the penstock (`rungs` in areas.json, E to climb)
  lead onto the ledge; the 40 cm step back up onto the sill is a climb too (`irons`: false). The old small outfall
  in the head wall is cleared out of the opening (`clear`), and the study's own brick head wall (`outlet_headwall`)
  takes the place of the town's head wall face below the coping (the gate's `opening` is its rectangle).
- **The street grate** over the ladder shaft (O2 x -146.9, z 92.5): the street is cut under it (its drawn faces and the collision stand-in faces the laid paving brings), a bevelled cast-iron
  grate (one shared model) stands over the hole, solid to walk on; E lifts it and climbs down the ladder, E at the
  ladder's foot climbs up and out (`Jef.ClimbTo`, the quay ladders' motion).
- **The hall's stair** under the open Vleeshuis hatch: the street is cut over it (15 cm further over the flight, for the
  head), the export's treads are walked.
- **Kit pieces** (`export/kit`, converted one by one with `--ruien-kit <kit> --pieces a,b`) are shared meshes placed
  by an area's `kit` list (O2 adds a second safety lamp on its bracket where the study lit v5 with a lantern).

### Fold bridges

Where a rui channel cuts a walkway (every tee mouth in a gallery's ledge, R1's crossing of the L100 mouth) people cross
on a folding iron footbridge (#286, #283; the kit: `art-source/ruien-o2-20261018/KIT.md`, "Fold bridge"). Code:
`RuienFoldBridge.cs` (the shared model, its collision, the drawn phase), `NativeRuienBridges.cs` (the server's state).
Data: an area's `bridges` (in areas.json or the export's markers: `id`, pivots `a` and `b`, `gear`) and the shared
engine numbers in areas.json `foldBridge` (timing, angle, distances, sweep zone).

- **The engine owns it.** Rest is down. Both leaves rise (90 degrees in 14 s) when Antigoon comes nearer than
  `giantRaise` (9 m) to the bridge's middle at its level (`giantHeight` 3.5 m: a giant on the street above does not
  count), and come down when he is further than `giantLower` (10.5 m). He waits `giantHold` (4.5 m) short of the
  bridge until both stand. Each leaf's collision is part of its hinge node and turns with it, as the tide doors' does.
- **Nobody is trapped or swept.** A leaf never moves while anyone (a player; any person who walks the Ruien) is in the
  zone it sweeps: the deck, and 1.15 m behind each hinge where its rails swing, 0.55 m either side of the deck's line,
  up to 2.2 m over it. So the rule is: the leaf waits for Jef, and Antigoon waits for the leaf. A standing leaf closes
  the walk at its hinge; Jef walking at it stops on the walk. People and routes may cross only while both leaves are
  down (`OpenToPeople`); a giant only while both stand (`OpenToGiant`). No crew or townspeople route crosses a bridge
  yet; the O2 crew's route does not meet one.
- **Multiplayer.** The server is the authority: `GET api/ruien/bridges` gives every leaf's phase, direction and hold
  (and a proof giant); every player's client draws that phase and its collision. Players' feet (with height) come from
  the multiplayer seats; the live giant from `NativeAntigoon.Live`. The phase is not saved: after a load it is derived
  from where the giants are and stands there at once.
- **Route limit.** Antigoon's live routes are still street-only (see Dev), so in play the leaves stay down until his
  underground routes exist; `POST api/dev/ruien/giant` (host only) walks a proof giant along a path by the same rules.
- **Proof.** `--ruien-bridge-proof <out> --ruien-bridge-spec <json>` (`NativeRuienBridgeProof`) with isolated data and
  an external `--ruien-areas`: kit checks, Jef crosses, the leaf waits for him, the giant waits, the leaves rise,
  collision follows part way and standing, a standing leaf stops Jef and clears the masonry, the giant wades through
  upright, the leaves come down, Jef crosses again; views down, part way and up in inspection light, midday, rain and
  night; a short shown/hidden frame-cost sample.

## Entrances

Ways down from the street, built before the network they will join (Steve chose 25 from the RE-entrances survey,
2026-11-02; 25 survey entries were built: nine wall doors, four gateway side doors, four house side doors, eight stair-houses).
RE29 is now retired in favour of R1. With the connected R1 and O2 facade doors there are 26 active entries (19 wall/house doors and seven stair-houses). Each entrance is a
street door in a wall that is already there, one straight
bluestone flight down to the level of its Ruien line, and a small landing that ends at a locked iron grille or a
bricked-up arch ("closed for works") where the Ruien join later. Nothing leads nowhere and there is nothing to fall
into. Code: `RuienEntrance.cs` (data, frames, town cuts, model), `RuienEntranceDoor.cs` (the door and the closure's
prompt). Data: `native-godot/world/ruien/entrances.json`.

**One entry is one entrance.** The kit builds everything from it, so a stair is moved, turned or deepened by editing
the entry. Fields (defaults in the file's `defaults`):

| Field | Meaning |
|---|---|
| `id`, `name`, `survey` | Permanent id (the door's saved state is `entrance_<id>`), a name, the survey's number. |
| `host` | `rampart` (a door into the bank behind the rampart's inner wall), `gate_house` (a gate house's drawn door), `passage` (a side door in a gateway's passage, the stair inside the house beside it) or `house` (a door in a house wall, the stair inside the house). |
| `door`, `out`, `street` | The doorway's middle on the wall's face (x, z), the face's normal to the street, street level. |
| `depth`, `line` | Landing level: gallery ledge -3.6, rui walkway -3.9; the Ruien line it will join. |
| `layout`, `flight` | `L`: door in the tunnel's side, the tunnel along the wall (`flight` `right` or `left` as seen from the street). `I`: door in its end, the tunnel straight in. |
| `closure`, `closureSide` | `grille` (locked gate), `bricked` (fresh brick) or `open` (a built, walked connection to another area); `street` (L), `right`/`left` (I), `back` or `end`. An open connection has no works prompt. |
| `wall`, `width` | The host wall's thickness (the reveal), the tunnel's clear width (1.3 m; 1.5 m in gate houses). |
| `doorWidth`, `doorHeight`, `post`, `head`, `frame` | The opening in the wall, the leaf's clear height, the oak posts, `arch` (brick ring and iron fanlight) or `flat` (oak transom), the surround: `bluestone` jambs and a rowlock ring (rampart), the gate house's `oak` frame, `passage` (a dressed bluestone frame with an eared lintel on plinth blocks) or `house` (an oak casing, a bluestone lintel and a bluestone doorstep). |
| `riser`, `pitchDeg`, `topLanding`, `bottomLanding`, `lining`, `spring`, `vaultRise` | Steps of at most 18 cm at 35 degrees (about 5.1 m for 3.6 m), 1.5 m landings, 28 cm brick lining, the barrel vault's springing over the treads and its rise. |
| `approach`, `from`, `openDeg` | Where the walk test stands before the door (1.6 m out; 0.9 m, the middle of a passage), the street points it walks from first (world x, z), and how far the leaf opens (86 degrees; 96 in the cottages, so it clears the narrow landing). The leaf hangs on the post away from the flight. |
| `house` | (notes only) the building or buildings the stair stands in, for the fit check. |
| `cut`, `clear`, `foliage`, `foliageMaterials`, `keepAbove` | Town meshes the doorway is cut through; a gate house's drawn door dropped below `keepAbove` (its hood stays); plants and climbers removed before the door (whole leaves; the `vegetation` group's copies are folded away). |

**What the kit makes.** Bluestone flags on a lime bed for the landings and one solid block a step for the flight (as
the O2 keeper stair), brick lining walls with their courses run round every corner (`RuienUnfold`), one barrel vault
over landing, flight and landing (level, inclined, level), iron handrails on posts, the reveal through the host wall
with its arch ring, an oak frame and a ledged and braced oak leaf on strap hinges (one model, sized by the entry) that
opens inward, a wrought-iron fanlight over an arched door, a bluestone sill, and the closure. Everything is solid where
it looks solid: the leaf's collision turns with it, the grille has a slab of collision in its plane.

**The town gives way at load** (`RuienEntrance.Cut`, from `RuienGates.Cut`, before collision reads the meshes): the
doorway through the named wall meshes (drawn faces and collision stand-ins, `QuayNotch.CutRegion`), the floor under
the wall and every hidden face in the tunnel's air, the plants and climbers before the door, and a gate house's drawn
door. `--no-ruien-entrances` leaves the town whole and builds nothing (before pictures).

The stair-air regions visit each mesh once and reuse CPU arrays across misses. Distant triangles are rejected before
copying vertex channels; unchanged meshes keep their resources. Actual cuts retain Godot's packing between regions,
so later cuts see the same rounded coordinates as separate calls. Entrance cuts run once
per town, independently of `--ruien-areas`. `pwsh -File native-godot/scripts/check-ruien-cuts.ps1` checks clipping,
UVs, collision-only changes, source preservation and batch/sequential equivalence in a bounded headless fixture.

**Light and air.** No Godot light. The open door is an opening in the Ruien's light list (`entrance_<id>_door`,
daylight in by day, a trace of street glow at night, a little through an arched door's fanlight when shut); deeper
down it is dark and Jef's own lantern lights the way (a carried lantern burns below the street whatever the hour:
`LanternPool` takes `Ruien.Below` as dark). No rain falls round an eye inside an entrance (`RuienEntrance.Shelter`, the
rain's room box). The cover map has a second channel (green): a closed way in,
covered at every height, so the stair inside the bank takes no sky or sun even above street level, and the eye there
takes the underground air. The masonry, water and air kinds read it in `ruien_covered` (code changed in place, no new
kind). Blue holds the height the closed way reaches (-8 to +8 m): every height in a bank or a gate house, the
masonry's top for a buried stair, so the street over a buried stair's lower end keeps its sky and its air.

**Buried stairs** (`passage` and `house`): a building is not a bank, so only the part of the stair above the street may
stand inside the building, and the lower end runs on under the street, a yard or the next house. Its brick walls, its
cut in the town and its cover are made in short pieces along the run (`RuienEntrance.Steps`) that follow the vault
down (`Spec.Ceiling`): nothing of it stands above the street outside the building, the street's paving over it is not
cut, and an eye on that street is not "below". Small cottages take a steep cellar stair (45 degrees, a 0.8 m top
landing, a lower vault) straight in from the gable, between its two windows.

**The door** opens and shuts with E from the street or the top landing (not while Jef stands in its swing). Its state
is the world's: the hatches' service (`api/ruien/hatches/entrance_<id>`, `NativeRuienAccess`) keeps it in saves and
shares it. At the landing E at the closure says why the way on is shut.

**Siting.** Entrances must be behind a doorway or on a reviewed square footprint, aligned with the adjoining facade,
boundary and paving. Include the surround, approach and open leaves in the clearance check. No stairwell, hatch,
moving grate or access house may occupy a cart or tram route. `frame: "existing"` keeps a surveyed town surround
and fanlight while replacing its recessed oak frame and leaf. Review findings: [entrance audit](ruien-entrance-audit.md).

**Connected/retired access.** `connectArea` and `connectLength` link a native bottom arch to an imported area: the
stair’s air and passage are clipped from copies of both imported LODs and collision. The passage cut follows the
barrel's inner facets, leaving masonry over its crown and beside the lining; its far end overlaps the cut. O2’s new facade door uses this
connection, with `lowerSill` replacing the projecting threshold inside the retained surround. `retiredWays` in
`areas.json` preserves an old underground flight/niche under a solid stone closure, restores the street by leaving
its original paving/collision whole, removes exported material above the closure, and disables lids and their service.
Disable its opening sources as well. O2’s street grate is ventilation-only. Historical source exports retain their
markers; the native retirement configuration is mandatory and survives reconversion. The stone closure bears beyond
the lid rectangle onto the flared lining, closing the sky sightlines visible from the hall walk below.

O2's `walkConnections` have jointed stone decks on iron I-girders, bearing plates, crossheads and masonry piers down
to the bed. Rail spans open where another deck joins. `trimImported` replaces the joining bank/coping strip in both
LODs and collision. The entrance's optional `underpass` describes a world-space brick barrel beneath its lower
retaining wall, preserving the existing hall walk. Neither repair modifies the authored import resources.

**Adding an entrance** (the next rounds: gateways, house side doors, small stair-houses):

1. Copy an entry of the same kind and give it a new permanent `id`. Put `door` on the wall's face (measure the face: a
   ray from the street at 0.3 m and 2.2 m height), `out` the face's normal, `depth` from its line's class.
2. Choose `layout`/`flight` so the tunnel stays inside the host (the bank is 7 m thick; a gate house about 12 m deep)
   and clear of passages, stairs and other ways down. `L` needs about 8.7 m along the wall at 3.6 m depth, `I` about
   9.9 m straight in. A buried stair needs only its part above the street inside the building: about 5.8 m at 35
   degrees, 3.7 m for the cottages' 45-degree cellar stair (from the face).
3. Name the host's wall meshes in `cut` (and a drawn door in `clear`), the plants in `foliage`.
4. A new host kind (a stair-house) is a new `host` value: the frame, opening and surround choices are in
   `Kit.DoorWall`; everything below the door is shared. A host that is a building sets `Spec.Buried`.
5. Check it: `--ruien-proof <dir> --ruien-proof-entrances [--ruien-proof-entrance-ids id]` walks Jef from the street
   through the door to the landing and back (E prompts, depth, room for his body every 20 cm, the closure holds, the
   door shuts and stays solid, saved state); review cameras take `"doorsOpen": true`.

### Stair-houses

Host `stair_house` (survey 24, 27-33): a small free-standing city-works house intended for a square, green or quay
over a straight `I` stair. Code: `RuienStairHouse.cs` (the shell), the rest is the kit.

The [5 November repairs](ruien-entrance-audit.md) retire RE29’s street house, align RE28 to the quay and replace the
shared roof slabs with individually lapped slates over timber boarding and lead soakers. Wall relief follows the
existing cross-bond image/height chart. Gutters fall to open outlets and hollow downpipes/shoes; sloped stone channels
feed grated gullies. Ground damp is a conforming transparent film without collision.

`surface-reservations.json` records full footprints, including the roof, gullies and 1.6 m door approaches.
`surface-drainage.json` records all 14 inlets, -0.95 m inverts, 100 mm diameters and unique onward connection IDs.
The roof-to-gully path is built; the onward Ruien connections remain reserved. Preserve these strips when adding traffic.

- **One model.** The shell is one mesh and one collision shape, built once and shared by every stair-house: brick in
  the town's own wall brick on a bluestone plinth in stones with real joints, parapet gables under bluestone coping
  with kneelers, a projecting band under the eaves, a lapped slate roof with a lead ridge roll, half-round iron gutters on
  brackets, hollow downpipes with shoes into sloped channels and grated gullies, tie anchors. All in the town's materials
  (`environment-20261013`: brick, stair stone, slate, iron), so no new shader kind; they take sky, sun and rain like a
  town wall and cast a shadow. The front gable carries the kit's own bluestone jambs, rowlock arch, wrought-iron
  fanlight and oak door (`doorWidth` 1.1: Jef's 0.64 m body passes the open leaf).
- **Length.** The house runs from the door wall back to where the flight's vault is under the paving
  (`HouseBack`: the top landing plus the run in which the flight drops the vault's height, its thickness and 0.2 m of
  bed), about 6.2 m with a 1.2 m top landing; inside you only see the kit's lined, vaulted stair. Beyond the back wall
  the stair runs on under the street: the kit's lining is trimmed under the paving there, and only the tunnel's air
  under the paving is cut.
- **The town gives way** inside the plinth's outline (ground, plants, decals, leaves): the crowd's walk map has no
  ground there, so people and carts go round the house, and the street's collision stops at the plinth.
- **Drawn when seen.** The stair inside (its landings, flight, lining, vault and closure) is drawn only while the door is
  open or the eye is in the tunnel; the door wall and its arch, seen in the doorway, always. Its collision always stays.
- **Cover.** A stair-house's closed (green) footprint starts at its door wall's inner face, so the door, its surround
  and the house's outside stay in the open.
- **Placing one.** Run the tunnel parallel to its Ruien line, its line-side wall just clear of the vault's outer face
  (rui: 3.28 m from the line's centre, gallery 4.63 m), the closure on the line's side; a `grille` needs 1.5 m more for
  its niche. Keep the house and a 1.6 m apron before the door clear of lanes, hauls, stalls, goods, doors and trees
  (canopies reach the roof). `--no-stair-house-shell` leaves the shell out (to look at the stair inside).

Mouth bearing stones and hall hatch (#267): `scripts/ruien-mouth-repair.tscn` patches current O2 resources
after checking source hashes and making external `--backup` copies. Paired 20 cm stones have 8 mm recessed
mortar joints and 10–13 mm arrises; both LODs and collision share the replacement. The hatch uses owned
timber artwork through `oak_hatch`, with aligned grain and relief. Native access/tide/state checks passed
143/143; captures cover day, rain and night. Diagnostic fill exposes the stone joints; normal underground
views limit fine underside inspection. Upper quoins/corbels, coping and material junctions remain unfinished.
This is a partial repair, not overall Ruien or connected-environment acceptance.
