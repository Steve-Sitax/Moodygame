# The Ruien in the native game

The sewers under the town (plan: [plans/ruien](plans/ruien/README.md)). Everything is data-driven, so the whole network
can follow area by area; the first area is O2: the vliet sluice outlet, the 38 m Vlietrui and the Vleeshuis hall C2.
Code: `godot/src/World/Ruien/`. Data and resources: `native-godot/world/ruien/`.

O2 access: the keeper hatch beside the outlet leads to the south winch; the hall hatch and grate shaft remain usable. Deep channel water uses Jef's existing swimming controls, with `E` at the escape irons. Ladder spacing, local offsets, gate channel widths and keeper landing paths are area data. The water query follows the rendered sheets, leaving the street navigation map dry.

The selected [construction options](plans/ruien/ideas/README.md) are A1/B2/C1/D1. A1's twin iron lids open and close with `E`; their native world state and the gate crew's route progress are included in ordinary saves. The flight lies behind the gallery wall and meets the ledge through a vaulted niche. B2's side drains cross the walkway in recessed grated gutters. C1 is a continuous brick arch; D1 has a round street grate and flared brick lining. The hall stair exits into the street on a supported route. All treads are bluestone.

`RuienSurround` supplies the keeper, hall and grate frames: 30 cm deep reveals, 32 cm wide stair coping
(23 cm at grates), 6.5/3.5 cm raised tops, recessed bearing seats and mortared joints. The street cut includes
upright kerb faces and collision proxies; kerbs butt against the frame. The keeper aperture extends 40 cm farther
over the flight so the vault crown stays below the street without lowering its headroom. Exported lining repairs
apply to both LODs and collision; the hall's last tread, open oak leaves and handrail remain.

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

The town's broad river sheet is excluded beneath the Ruien by a world-space cover texture, including masonry and side galleries. This replaces the old water-level stencil lid, which could be clipped out at particular camera heights. The air volumes clip against sampled scene depth themselves, so the hardware depth test must not discard their enclosing box at the shaft rim. Neither fix adds a shader kind or a real light.

## Data

| File | What |
|---|---|
| `network.json` | The plan's lines, rooms, gates, grates, stairs and lamps with the gallery classes' sections. Made by `python -I tools/ruien/godot_network.py` from `docs/plans/ruien`; the game never reads `docs/`. |
| `areas.json` | The areas the game draws: zones (lines with a path or a network line, rooms), gates (the opening cut through a quay wall), water, light sources, mist, the dev entry, and the underground air (colour, fog, haze, exposure, fill). |
| `materials.json` | Each material family's shader kind and numbers, shared by every area. |
| `textures/` | One tiling set per family (albedo, the brick's slimed and limed albedos, normal, packed height/roughness/AO), BPTC/RGTC with mipmaps. |
| `<area>/` | A converted Blender export: `area.json` (keys and their LOD meshes), `mesh_*.res`, `collision.res`, `markers.json`. Without it the game builds a stand-in from the zones. |

Conversion (headless, once per export; it writes under `res://world/ruien` and quits):

    godot --headless --path native-godot res://world/ruien/convert.tscn -- --ruien-textures <export>/textures
    godot --headless --path native-godot res://world/ruien/convert.tscn -- --ruien-area <export> --area o2

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
- **Cover**: `ruien_cover` is a top-down map of the zones (1 under a vault). Covered surfaces take no sky, no sun, no
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

**Route limit:** only O2/C2 is built. C1 under the Grote Markt and the connecting galleries are plan data, and
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
