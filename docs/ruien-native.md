# The Ruien in the native game

The sewers under the town (plan: [plans/ruien](plans/ruien/README.md)). Everything is data-driven, so the whole network
can follow area by area; the first area is O2: the vliet sluice outlet, the 38 m Vlietrui and the Vleeshuis hall C2.
Code: `godot/src/World/Ruien/`. Data and resources: `native-godot/world/ruien/`.

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
    B soot, A moss), baked AO in UV2.x, parallax occlusion near the eye on top of the real relief, wet gloss.
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
- **The river**: its sheet follows the eye at the tide's level and would cut through every gallery; an invisible lid
  over the zones' plans at the river's level (the boats' `Psx.Cap`) keeps it out. The water inside stays at the
  area's `waterMin` and is held, rising a little, while the river is higher.
- **Gates**: `RuienGates.Cut` cuts each gate's opening through the named town meshes in `NativeTown` before collision
  and navigation read them (`QuayNotch.CutConvex`); the installed town resources are untouched. `--no-ruien-gates` skips it.
- **Visibility**: an area is drawn only while the eye is in its box under the street, before one of its gates on the
  open water, or at one of its street openings. LOD per export key by the eye's distance to the key's box (16 m).

## Dev

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
  lead onto the ledge. The old small outfall in the head wall is cleared out of the opening (`clear`).
- **The street grate** over the ladder shaft (O2 x -146.9, z 92.5): the street is cut under it, a bevelled cast-iron
  grate (one shared model) stands over the hole, solid to walk on; E lifts it and climbs down the ladder, E at the
  ladder's foot climbs up and out (`Jef.ClimbTo`, the quay ladders' motion).
- **The hall's stair** under the open Vleeshuis hatch: the street is cut over it (15 cm further over the flight, for the
  head), the export's treads are walked.
- **Kit pieces** (`export/kit`, converted one by one with `--ruien-kit <kit> --pieces a,b`) are shared meshes placed
  by an area's `kit` list (O2 adds a second safety lamp on its bracket where the study lit v5 with a lantern).
