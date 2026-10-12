# Scheldemist: native world and authoring

This is the first slice of the move to a fully Godot-owned game. Open `project.godot` in Godot Mono, build C#, and
press F6 on `main.tscn` (or F5). On Steve's Windows PC, double-click `Start Workshop.cmd`. No Node, browser, bake,
existing game database, or existing game settings are used. Workshop data goes to its own `ScheldemistWorkshop`
user folder.

The small pilot quay is a test fixture. The active quay and library now use the completed model/texture work from
main and the 2026-10-12 bake. The native implementation is additive in `native-godot/`, on
`godot/native-authoring`, in `D:/Code/MoodyGame-native-authoring`. Nothing has been merged into the running game.

Double-click `Start Recovered Quay.cmd` to edit the first recovered Rijnkaai section. Its native scenes, meshes,
materials, textures and collision are included in this branch; the original town GLB is not needed to run it.
The recovered bollards and gas lamps can be moved, copied and deleted. Other scenery is saved as ordinary Godot
nodes and can be edited in `recovered/rijnkaai-recovered/district.tscn`. Merged buildings and cargo remain chunks;
the export did not retain all individual object boundaries. New objects must have ground under their footprint.
`Open Recovered Quay Editor.cmd` opens that district in Godot. `Test Editor Changes.cmd` runs a saved editor scene
with a fresh temporary layout. The default main scene and F5 now use the updated recovered quay.

`Start Native District Game.cmd` runs the same district through the existing Godot game's player, weather, sky,
lighting, water and reflection systems. It reads your saved workshop layout, including added/moved lamps, without
writing that layout. Click to take the mouse, use WASD/Shift/Space to walk, and Esc to release it. F6 cycles weather,
F7 changes the hour, F9 switches fly/walk, B compares bump/relief, and M compares reflections. Flying uses Space
to rise and Ctrl to descend. `Test Editor Changes In Game.cmd` uses the saved district scene instead of a workshop
layout. This is a district game test: NPCs, missions, interiors and moving ships/bridges are still outside its scope.

`Review Quay Surfaces.cmd` starts the actual game next to the corrected bollard and coping in free-camera mode.
Use B to compare surface relief, F6 for rain and F7 for evening/night. The opaque rust square is fixed; the bollard
has casting pits, corrosion and rope wear. Its base uses the same iron, with bevels and rounded plan corners.
Steve requested full Godot conversion after his test. Complete the remaining world/game systems and district
resources, then verify a standalone Godot export before removing the web/server/bake runtime dependencies.

Follow the [model edge rule](../AGENTS.md) for every asset converted or authored in Godot. The coping now also
has a worn paving-side arris, rounded lower lip and bevelled exposed vertical corners. Its underside receives
environment-driven indirect light so the stone remains visible in shadow and darkens at night.

## Place objects yourself

Choose a bench, crate, or lamp and click clear quay ground. R turns the preview by 15 degrees; Shift+R turns it back.
Esc cancels. Click an existing object or select it in the list, then Move, Copy, or Delete. Numeric X, Z, and Turn
fields allow exact placement. Snap is optional. Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes; Ctrl+S saves. Hold the
right mouse button and use WASD to fly, Q/E to descend/rise, Shift to go faster. F2 switches between editing and a
walk with real collision; Space jumps. Day/night switches the placed lamps. Closing with unsaved changes asks
whether to save, discard, or stay.

`layout.json` saves the district's complete object layout, with permanent object ids and library asset ids.
Writes are atomic and keep the previous file as `.bak`. An unreadable or incompatible saved layout is preserved;
saving is disabled until the file is repaired or moved aside. Normal game saves are separate. `--author-dir <dir>`
isolates a workshop's layout, including checks.

Export scene writes `objects-export.tscn` beside the layout. It contains editable `AuthoredObject` wrappers with
asset references and transforms. Copy that file into this Godot project to use it as a district's Objects scene.
The Godot editor can also directly change `districts/quay-pilot.tscn`. A saved workshop layout overrides that seed
when running; use a fresh `--author-dir` to check changes to the seed itself.

Each district resource supplies its own boundary, camera/walk spawns, scene and asset catalog. The recovered quay
has a separate layout directory from the pilot; saving one does not replace the other.

## Asset intake

Each asset in `assets/library/` has a stable id, a display name, a reusable PackedScene, and a conservative clearance
box. Model improvements belong inside the referenced scene in `assets/props/`; keep that scene's collision and
behavior. Existing placements then receive the new appearance without changing their ids or positions. A lamp's
scene includes its day/night behavior. New library resources require no editing code changes: add them to
`catalog.tres`. Use Godot's normal model import and scene wrappers, not the browser's whole-town exporter.

The finished main commits through `6b447c1` are merged into this branch. Shared bake directories remain untouched.
The latest quay snapshot preserves all 14 object ids and replaces the library bench, crate and lamp models.
Cannon/mushroom bollards, a capstan, a hand barrow and a coiled hawser are also available. See
[district recovery notes](recovery/README.md) for import commands, identity preservation, promotion and editor lamp steps.

## Migration ledger

| Part | State / next evidence |
|---|---|
| Native startup, asset catalog, editable district seed | Working without Node or a bake. |
| In-game placement, selection, ground snapping, exact transforms | Working for simple static assets; occupied and off-quay placements refused. |
| Undo/redo, persistent layout, editable Godot scene export | Working; checked across separate Godot processes. |
| Model/texture intake | Finished main art and current bake used in Rijnkaai; detailed library assets imported as native resources. |
| Existing town | Static Rijnkaai updated from the 2026-10-12 bake; 14 original object ids preserved. Other districts and dynamic parts remain. |
| Game rendering and player in Rijnkaai | Existing C# player, weather, wetness, bump/relief, sky, lamps, animated river and planar mirrors connected to native resources. |
| Navigation | Pending scene-derived navigation and moving-bridge links. The pilot has player collision, not NPC pathfinding. |
| Game services | Pending C# ports of rules, SQLite persistence, AI providers, and multiplayer. The old server is not part of this pilot. |
| Retiring the browser and Node game | Pending parity checks and save migration; remove only once the native game covers those behaviors. |

The existing town's bake also contains custom material metadata, instance transforms, rooms, openings, lights,
and navigation facts. One-time recovery must preserve those dependencies; importing its bare GLB as a new level
does not complete the migration. Move district by district, replace fragile mesh-name lookups with permanent
object/anchor ids, and derive gameplay coordinates from the native scene. Port offline game rules before provider
and LAN integrations. Preserve existing saves and compare the current tests' outcomes when moving each service.

## One-time recovery

`pwsh -File scripts/recover-town.ps1 -Source <existing town.glb> -Plan <plan.json>` reads a snapshot and its adjacent
`town.json`; it does not run a browser, start Node or write the source files. The default plan is `recovery/rijnkaai.json`.
It selects static geometry and embedded textures, keeps nested transforms and hidden-node/material metadata,
expands in-bound instances with their colours, and saves native resources shared between editable scenes.
UV2 atlas cells use `shaders/recovered_atlas.gdshader`; recovered textures have mipmaps. Independent texture sampler
axes use `recovered_sampler.gdshader`, fixing horizontal quay-wall/coping stretching. The workshop uses these basic
materials. The separate game test uses native game materials and auxiliary maps from `game/rijnkaai/`; its runtime
loads no original GLB or bake directory. See [game integration notes](game/README.md) for that one-time intake.

The tool refuses an existing output district to protect native edits. Give another snapshot a new plan id.
`recovery-report.json` records the source fingerprint, plan, source node ids, material/instance metadata, checks,
and remaining work. Scenery intersecting the boundary retains its whole mesh; editing limits apply to placement.
Reviewed Rijnkaai and its dated model intakes are tracked; fixture runs and other recovery attempts are ignored.
Other sessions should use the recovery notes and wait for Steve's test of this district before expanding the migration.

## Checks

On Windows with PowerShell 7: `pwsh -File scripts/check-workshop.ps1 [-Godot <console exe>]`.
The runner builds this project, imports it in a headless editor, and runs write/reload proofs in two bounded Godot
processes with a fresh layout directory. It rejects engine ERROR logs as well as nonzero exits. Reports remain in
ignored `proof/` directories. It never reads a player save, launches a Node server, writes the shared bake, or
runs a GPU performance measurement. `--author-shot <absolute png>` gives a short rendered picture run for visual QA.

`pwsh -File scripts/check-recovery.ps1` checks a generated fixture with nested transforms, hidden geometry,
coloured instances and an unused invalid image, then checks the real quay. Both run write and reload in separate
Godot processes with isolated layouts. Together with the pilot, 95 runtime assertions pass; recovery also checks
native resource references and source preservation. The fixture's invalid unused image is pruned before import.
