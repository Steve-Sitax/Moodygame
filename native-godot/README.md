# Scheldemist: native world and authoring

This is the first slice of the move to a fully Godot-owned game. Open `project.godot` in Godot Mono, build C#, and
press F6 on `main.tscn` (or F5). On Steve's Windows PC, double-click `Start Workshop.cmd`. No Node, browser, bake,
existing game database, or existing game settings are used. Workshop data goes to its own `ScheldemistWorkshop`
user folder.

The quay and three simple assets are migration fixtures, not replacements for the models and textures currently
being improved in the other session. The entire implementation is additive in `native-godot/`, on
`godot/native-authoring`, in `D:/Code/MoodyGame-native-authoring`. Nothing has been merged into the running game.

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

## Asset intake after the helpers finish

Each asset in `assets/library/` has a stable id, a display name, a reusable PackedScene, and a conservative clearance
box. Model improvements belong inside the referenced scene in `assets/props/`; keep that scene's collision and
behavior. Existing placements then receive the new appearance without changing their ids or positions. A lamp's
scene includes its day/night behavior. New library resources require no editing code changes: add them to
`catalog.tres`. Use Godot's normal model import and scene wrappers, not the browser's whole-town exporter.

Import the helpers' finished commits into this worktree only after they are ready. Their source branches and
shared bake directories remain untouched. Stable ids and external resource references are the integration boundary.

## Migration ledger

| Part | State / next evidence |
|---|---|
| Native startup, asset catalog, editable district seed | Working without Node or a bake. |
| In-game placement, selection, ground snapping, exact transforms | Working for simple static assets; occupied and off-quay placements refused. |
| Undo/redo, persistent layout, editable Godot scene export | Working; checked across separate Godot processes. |
| Model/texture intake | Wrappers ready; final helper assets deliberately not copied yet. |
| Existing town | Pending one-time recovery into district scenes; retain the old game as a reference until reviewed. |
| Navigation | Pending scene-derived navigation and moving-bridge links. The pilot has player collision, not NPC pathfinding. |
| Game services | Pending C# ports of rules, SQLite persistence, AI providers, and multiplayer. The old server is not part of this pilot. |
| Retiring the browser and Node game | Pending parity checks and save migration; remove only once the native game covers those behaviors. |

The existing town's bake also contains custom material metadata, instance transforms, rooms, openings, lights,
and navigation facts. One-time recovery must preserve those dependencies; importing its bare GLB as a new level
does not complete the migration. Move district by district, replace fragile mesh-name lookups with permanent
object/anchor ids, and derive gameplay coordinates from the native scene. Port offline game rules before provider
and LAN integrations. Preserve existing saves and compare the current tests' outcomes when moving each service.

## Checks

On Windows with PowerShell 7: `pwsh -File scripts/check-workshop.ps1 [-Godot <console exe>]`.
The runner builds this project, imports it in a headless editor, and runs write/reload proofs in two bounded Godot
processes with a fresh layout directory. It rejects engine ERROR logs as well as nonzero exits. Reports remain in
ignored `proof/` directories. It never reads a player save, launches a Node server, writes the shared bake, or
runs a GPU performance measurement. `--author-shot <absolute png>` gives a short rendered picture run for visual QA.
