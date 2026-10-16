# Scheldemist: native world and authoring

The whole town now loads from editable Godot resources, with native C# gameplay rules and SQLite. Double-click
`Start Native Town Game.cmd` for the game, or `Start Workshop.cmd` for the object editor. The game uses Forward+
and its real title menu. Its native services run inside Godot, without a browser, Node process or runtime bake.
The browser, Node server and bake pipeline have been retired from the active project. Native multiplayer and all
four resident transport stages have passed rendered tests; standalone packages are checked in cold relocated folders.

The new people2 kit is on by default for dressed kinds (`--people2 off` compares the original kit). It uses a native stored scene and
checksummed shared rig data. Its authoring/intake commands and isolated day/rain/night, shader, timing and
multiplayer proofs are documented in [people2 notes](../docs/godot-people2.md).

The small pilot quay is a test fixture. The native town and library include the completed model/texture work
from main and the one-time 2026-10-12 intake. The conversion was developed on `godot/native-authoring`;
Steve authorized integration into `main` on 2026-10-12. Automated proofs do not imply manual acceptance.

Double-click `Start Recovered Quay.cmd` to edit the first recovered Rijnkaai section. Its native scenes, meshes,
materials, textures and collision are included in this branch; the original town GLB is not needed to run it.
The recovered bollards and gas lamps can be moved, copied and deleted. Other scenery is saved as ordinary Godot
nodes and can be edited in `recovered/rijnkaai-recovered/district.tscn`. Merged buildings and cargo remain chunks;
the export did not retain all individual object boundaries. New objects must have ground under their footprint.
`Open Recovered Quay Editor.cmd` opens that district in Godot. `Test Editor Changes.cmd` runs a saved editor scene
with a fresh temporary layout. The default main scene and F5 now open the full native town; workshop launchers
explicitly select their editing scene.

`Start Native Town Game.cmd` opens all eleven native districts, menus, residents, interiors and game systems.
The older `Start Native District Game.cmd` shortcut now opens this same town. Choose **Walk into town**.
WASD/Shift/Space move; E interacts, I opens pockets, J the quest book, M the map, P pauses and Esc opens the menu.
It reads saved workshop layouts, including Steve's lamp, without writing them. `Test Editor Changes In Game.cmd`
uses the saved district scenes instead of layout files. Save changes in the editor before launching that test.
Native game saves/settings are separate under `%APPDATA%/ScheldemistWorkshop/native-playtest`; these launchers
disable AI calls. The surface viewer and workshop remain available separately. See [native service notes](services/README.md)
for tested rules. Rendered native hosting/guest play, actor authority, a host bus ride and return to local play
have passed. Dedicated servers also expose the native HTTPS/WebSocket transport.
In the Godot editor, F5 runs the whole native game. Open a district and press F6 to run its editing scene.

The tested standalone Windows client is `D:/Code/ScheldemistPackages/final-client-20261012-portable`;
open `Play Scheldemist.cmd`. The matching server is `D:/Code/ScheldemistPackages/final-server-20261012-portable`;
open `Start Server.cmd`, optionally with `--port 8800`. Keep every file in each package together. Both include
their .NET/ASP.NET runtime and need no editor or source checkout. Their final exports passed 57,497/57,498
package checks; the client passed 28 relocated game/render checks and the server passed cold boot/API/data checks.
See [the exact receipts](world/notes/standalone-receipts.json) and [packaging procedure](world/notes/standalone-export.md).

Old game-save compatibility was explicitly waived by Steve. The thirteen identified legacy game database,
WAL/SHM and save-slot files were removed after the old game server stopped. Native play starts a new game.
Editor layouts, their backups, preferences and provider credentials were retained. Never clear the entire
`ScheldemistWorkshop` user folder when resetting a game: it also contains Steve's edited districts.

`Review Quay Surfaces.cmd` opens the scenery-only surface viewer next to the corrected bollard and coping.
Use B to compare surface relief, F6 for rain and F7 for evening/night. The opaque rust square is fixed; the bollard
has casting pits, corrosion and rope wear. Its base uses the same iron, with bevels and rounded plan corners.
Steve authorized the complete Godot conversion. The native game and all districts are present. Original artwork
and useful source references were checksum-archived in `../art-source`; historical tools are preserved as text.

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

The workshop's **Enter a room…** list opens the actual tavern, home, shop or hall in its town shell. Its object list
contains that room's furniture and fittings. The shared **Furniture** library supplies seats, tables, counters,
storage, beds, stoves, clocks, the existing keg model and lamps. Use the same Move, Copy, Delete, R and numeric
controls as on the quay. Full clearance must fit within the room, below its ceiling, on a supported floor; walls,
occupied space and newly blocked routes to reachable seats, beds and counters refuse placement.

Switching rooms preserves each room's unsaved document and undo history. Save writes all changed rooms to
`layouts/room-<id>/layout.json`, atomically with backups; the game reads them without writing. `--author-root`
isolates these working copies. **Save into game map** promotes all opened rooms to committed `.objects.tscn` seeds; review and commit them, then run `prepare-native-package.ps1`. Player builds read the committed seeds and exclude the owner workshop/UI. Native room furniture supplies sitting, sleep and serving anchors after a restart.
Host layouts take precedence during a guest visit, including removals, without touching the guest's local files.
See [conversion, kit intake and proof notes](../docs/furniture-editor.md).

Each asset in `assets/library/` has a stable id, a display name, a reusable PackedScene, and a conservative clearance
box. Model improvements belong inside the referenced scene in `assets/props/`; keep that scene's collision and
behavior. Existing placements then receive the new appearance without changing their ids or positions. A lamp's
scene includes its day/night behavior. New library resources require no editing code changes: add them to
`catalog.tres`. Use Godot's normal model import and scene wrappers, not the browser's whole-town exporter.

The finished main commits through `6b447c1` are merged into this branch. External art worktrees remain untouched.
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
| Existing town | All eleven districts and dynamic model libraries stored as native resources; authored IDs and saved layouts retained. |
| Game rendering and player in Rijnkaai | Existing C# player, weather, wetness, bump/relief, sky, lamps, animated river and planar mirrors connected to native resources. |
| Menus and people | Whole-town title/pause, HUD, conversations, board, interiors and residents connected; actor skeletons and animation clips retained. |
| Navigation | Whole-town native geometry supplies walking support, stairs, collision and authored obstacles. Actual hired-worker pickup/delivery and 26 navigation fixture checks passed. |
| Game services | Native C# rules/SQLite run in process; retained original comparisons and actual gameplay tests are recorded in service notes. |
| Multiplayer server | Native headless Kestrel, TLS and rendered host/guest play passed; actor authority, host bus ride and guest return to local play checked. |
| Transport | Rendered bicycle, handcart, dray and multi-person boat journey passed 37 checks; a fresh seed's cart/dray scenario passed 28. |
| Opening ferry, landing stage and quay bridge | Rebuilt on branch `worktree-arrival-pier` (2026-10-16), not merged and not seen by Steve. `scripts/check-arrival-pier.ps1` passed 15 checks and took the pictures: a floor from the pier over the bridge to the quay at high, mid and low water (largest step 6.6 cm), and the ferry's gangway stays on her side until she is gone. Frame time was not measured; the stage is now 50k triangles and the ferry 28k (they were 19k and 15k). |
| Retiring the browser and Node game | Completed in this worktree; 493 source/art files checksum-archived, legacy entrypoints/dependencies removed, user layouts retained. |

The existing town's bake also contains custom material metadata, instance transforms, rooms, openings, lights,
and navigation facts. One-time recovery must preserve those dependencies; importing its bare GLB as a new level
does not complete the migration. Move district by district, replace fragile mesh-name lookups with permanent
object/anchor ids, and derive gameplay coordinates from the native scene. Port offline game rules before provider
and LAN integrations. Compare current test outcomes; old game saves need no migration. Preserve editor layouts,
settings and provider credentials.

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
Other sessions should use the recovery notes for resource repair and preserve the native scenes and saved layouts.
Continue native development on `main`; keep the conversion worktree's proof receipts as migration evidence.

## Checks

On Windows with PowerShell 7: `pwsh -File scripts/check-workshop.ps1 [-Godot <console exe>]`.
The runner builds this project, imports it in a headless editor, and runs write/reload proofs in two bounded Godot
processes with a fresh layout directory. It rejects engine ERROR logs as well as nonzero exits. Reports remain in
ignored `proof/` directories. It never reads a player save, launches a Node server, writes the shared bake, or
runs a GPU performance measurement. `--author-shot <absolute png>` gives a short rendered picture run for visual QA.

`pwsh -File scripts/check-recovery.ps1` checks a generated fixture with nested transforms, hidden geometry,
coloured instances and an unused invalid image, then checks the real quay. Both run write and reload in separate
Godot processes with isolated layouts. After legacy retirement the pilot passed 39 checks and recovery passed 56;
both explicitly select the editor scene, independent of the full game's default scene. Recovery also checks
native resource references and source preservation. The fixture's invalid unused image is pruned before import.
