# Recovering editable Godot districts

Use the existing town export once to produce native Godot scenes and reusable assets. Runtime must load those
native resources without the browser, Node, the original GLB, or its JSON sidecars. Rijnkaai is the working example.
All eleven districts now have native resources, with whole-game gameplay and networking in Godot. Steve later
authorized completing the conversion and retiring the old runtime after validation. Keep this worktree separate
from main until his manual game/editor test; that review does not block the already authorized migration work.

## Current district and sources

The migration branch is `godot/native-authoring` in `D:/Code/MoodyGame-native-authoring`. Main through `6b447c1`
was merged into this branch. The finished town is `D:/Code/MoodyGame-godot/godot/baked/next/town.glb`, 977933624 bytes,
made on 2026-10-12; model packs are beside it in `../models/`. Treat both directories as read-only inputs.
The recovery reports retain SHA256 fingerprints and modification times. They are the authoritative import records.

`recovered/rijnkaai-recovered/district.tres` is the reviewed quay district. Its district id stays `rijnkaai-recovered` so
existing layouts still load. Its resources now reference the reviewed `rijnkaai-20261012` snapshot and three model
intakes. All 14 original object ids remain. Bench, crate and library lamp use detailed models; five harbour assets
are also placeable. The older resource files remain available while Steve reviews this update.

## Repair or extend a native district

Reuse the existing native district scenes and library first. No original GLB, browser export or bake is needed to
edit them or place props. The following one-time intake procedure is for genuinely new external source material;
it is not a game-startup or ordinary editing step. Current complete-town fragments live under `world/town` and
editor district descriptors under `world/districts`; their notes record ownership, shared roots and exceptions.

1. Work in an isolated branch/worktree. Check status and local instructions before editing. Coordinate ownership
   of `main.tscn`, the default launchers and shared recovery code; district work should normally add its own files.
2. Merge the finished main commits into that worktree. Confirm the town and model packs are complete snapshots.
   Record their paths, timestamps and associated source commit. Do not run an exporter or overwrite shared bakes.
3. Copy a recovery JSON plan and choose a new output `id`, title, X/Z `bounds`, clear walk spawn, and camera pose.
   `groups` selects intersecting direct children of named groups; `props` makes matching roots editable wrappers;
   `roots` selects fixed scenery by exact name. Selection uses world bounds, including nested parent transforms.
4. Inspect names and bounds before choosing a plan. Terrain can span the whole city. Intersecting meshes retain
   their complete geometry; a district boundary limits placement, not geometry. A merged tile is still a chunk,
   and its lost object boundaries require explicit recovery or later rebuilding in Godot.
5. Keep the output separate from an existing district. The importer refuses an existing directory because native
   edits may already exist. A failed partial output should be moved to ignored evidence only after verifying its
   resolved path is inside this worktree; never remove a shared bake or another session's directory.

From the worktree root, import a new district with:

```powershell
pwsh -File native-godot/scripts/recover-town.ps1 -Source D:/Code/MoodyGame-godot/godot/baked/next/town.glb -Plan res://recovery/your-district.json
```

Add an exception for the reviewed output in `native-godot/.gitignore`; fixture and partial outputs stay ignored.
Resource paths are relative to the Godot project root (`res://`), so another checkout can use the saved assets.

## Recover standalone models

Copy the small `bench-20261012.json`, `crate-20261012.json` or `quay-models-20261012.json` plans. Set `modelPack: true`
for standard glTF model packs, which have no town facts or browser material metadata. `modelAssets` assigns each
selected root a permanent library id, title and category. Do not assign a new id merely because its model changed.

The examples used for this update are:

```powershell
pwsh -File native-godot/scripts/recover-town.ps1 -Source D:/Code/MoodyGame-godot/godot/baked/models/clutter.glb -Plan res://recovery/bench-20261012.json
pwsh -File native-godot/scripts/recover-town.ps1 -Source D:/Code/MoodyGame-godot/godot/baked/models/crate.glb -Plan res://recovery/crate-20261012.json
pwsh -File native-godot/scripts/recover-town.ps1 -Source D:/Code/MoodyGame-godot/godot/baked/models/quayfurniture.glb -Plan res://recovery/quay-models-20261012.json
```

These output ids already exist here. Reuse their native resources, or choose new ids for another intake.
Collision comes from solid mesh faces; transparent decals do not become obstacles. Clearance uses the model's
local bounds and origin offset. Preserve the behavior in the wrapper, especially a lamp's light and flame toggle.

`street-props-20261015.json` took eight props from the Antwerp 1870 Blender kit (2026-10-15). The kit exports one GLB
per prop with a `-convcolonly` collision proxy and normal/ORM maps. The recovery tool would draw the proxy as a
visible mesh, and the game's shaders read only the base colour, so the pack was combined in Blender first. That step
dropped the proxies and the unused maps, put each prop under an empty named for its plan node, and centred the
wheel guard on its own origin. It also halved the pissoir lantern's cream pane texels, because at dusk the game's
grade showed them as a lit white box that casts no light. The cellar hatch is a narrower build of the kit's hatch: a 0.44 m opening in a
0.10 m frame. The original is 1.16 m deep and does not fit the town's 0.7 to 0.85 m raised pavements. The boot
scraper niche, iron wheel guard, kerb kit, downpipe, and the interior pieces (crucifix, holy water font, clogs,
coffee grinder, box bed) were left out. The placements are in the `north-canal`, `north-vismarkt`,
`north-werf-steen`, `centre-landmarks` and `outer-park-prison` seeds. Pavements stand 0.12 m above the street, and
props on them are placed at that height.

## Keep identities when updating a district

GLB node numbers are snapshot indices. They are not durable identities: six Rijnkaai lamps moved from indices
5920–5975 to 5193–5248 in this update. `refreshFrom` points to the previous recovery report; `RecoveryRefresh`
matches editable props by semantic name and complete transform, then retains their previous object and asset ids.
Ambiguous matches fail. A relocated, renamed or missing object needs an explicit correspondence rule.

The eight old bollards disappeared as independent roots because the completed art merged their new cannon
models into quay furniture tiles. The Rijnkaai refresh explicitly loads `bollard_cannon`, finds triangles wholly
inside each known anchor's transformed model bounds, and removes those triangles from the merged scenery.
It regenerates collision for changed meshes, disables empty mesh collision, then adds native wrappers with the
old ids and transforms. Exactly 1106 triangles were removed at each of the eight anchors. This count is evidence
for this model and snapshot; it is not a rule for other districts or models.

`RecoveryRefresh` currently handles that bollard case. Do not apply it blindly to benches, cranes, other merged
objects, or unrelated scenery. Confirm the canonical model, placement transform, material surfaces and removal
bounds. Require evidence for every anchor and check that neighboring geometry survives. Missing anchors fail
before promotion, leaving the active district unchanged.

Saved layouts are complete object documents and use permanent asset ids. Refreshing art does not rewrite a
player's positions, rotations, scale or deletions. Old exported scenes also need their asset descriptor paths
updated to the new scenes; promoting updates the canonical `.tres` aliases as well as the district catalog.

## Validate and promote

Run `check-recovery.ps1 -District <new snapshot id>` before changing the active district. It checks a synthetic
fixture and the chosen district in separate write/reload Godot processes, rejecting engine errors. Then verify
the pilot with `check-workshop.ps1` if shared code or library assets changed. Check a saved layout from the previous
version too, using a copied layout under `proof/`; never use a player's save as a test file.

```powershell
pwsh -File native-godot/scripts/check-recovery.ps1 -District rijnkaai-20261012
pwsh -File native-godot/scripts/check-workshop.ps1
```

Capture actual rendered views of the scenery, placed assets and lit lamps. Headless success cannot show incorrect
UVs, missing material effects, clipping, or an obstructed camera spawn. Check the district in the Godot editor:
its meshes must be visible and its authored wrappers editable, with no source exporter running.

Promotion uses `recovery/recover.tscn` with user arguments `--promote <snapshot id> --target-district <active id>`.
Use `Invoke-WorkshopEngine` from `scripts/engine-tools.ps1` for a bounded engine process and a log. Promotion verifies
that every current seed object's id survives, backs up control files and descriptors under `proof/`, copies the
new aliases, and retains the active district id. It does not touch user layouts. Before calling it, inspect any
native scene/asset edits and reconcile them explicitly; matching ids alone does not preserve edited scenery.

Commit only the reviewed scenes, native resources, plans, source changes and notes. Run `git diff --cached --check`
and the repository's commit check. Keep logs, screenshots, temporary GLBs, layouts and fixture runs out of git.
Steve's later authorization permitted retiring the browser/server runtime after native validation; it is now
removed from this worktree, with original art and references checksum-archived. The retained
original-oracle fixtures and checksum-verified artwork archive preserve the necessary evidence and inputs.
Keep the branch separate from main until his manual review. Editor layouts, preferences and credentials remain
outside game-save cleanup and source retirement.

## Rendering and format limits

The selective GLB reader copies only referenced mesh, accessor, image and buffer data before Godot imports it.
Nested transforms, hidden flags, selected instance transforms/colours and material metadata are preserved.
This selective static tool refuses sparse accessors, skinned actors, morph targets, compressed mesh/texture
extensions and external image paths. These limits do not describe the separate complete-town/model intake,
which already preserved actor skeletons, animations and rooms. Use the appropriate tested intake for new assets.

Meshes, textures, materials and collision shapes are saved as shared native `.res` files. Set their resource
paths explicitly after saving. Relative binary resource references failed on a cold load, even though cached
resources made the first process appear correct; use full `res://` paths and verify separate processes.
Textures receive mipmaps. The native atlas shader reads UV2 cells; ordinary materials show the entire facade
atlas on every wall if this custom coordinate rule is omitted.

Preserve glTF sampler axes separately. The quay wall and coping repeat U but clamp V; Godot's ordinary material
import disables repeating on both axes for that combination, stretching one texture column across the wall.
`RecoverySampler` and `recovered_sampler.gdshader` preserve repeat, clamp and mirrored axes. Three existing quay
materials were repaired; their original resources are backed up under ignored `proof/wall-mapping/material-backup`.
The [Godot sampler implementation](https://github.com/godotengine/godot/blob/master/modules/gltf/structures/gltf_texture_sampler.h)
documents the ordinary material limitation.

Static recovery alone leaves PSX auxiliary map references as metadata. Rijnkaai's separate native game intake now
stores those maps and the existing Godot game shaders as native resources; it reuses the actual player, weather,
wetness, relief, sky, lamps, river and planar mirror systems. See [game integration notes](../game/README.md).
Interiors, openings, moving bridges/boats, NPC navigation and services are outside the older isolated surface
fixture. They are present in the full native `town.tscn` game; use its current service/gameplay/transport proofs.

## Steve testing lamps

`Start Recovered Quay.cmd` opens the updated playable workshop. Choose **Street lamp**, click clear ground,
press R to turn it, and Ctrl+S to save. Select an existing lamp to Move, Copy or Delete it. F2 switches to walking;
hold right mouse to look/move with WASD, and press Space to jump. Day/night toggles actual model flames and lights.

`Open Recovered Quay Editor.cmd` opens the native district scene. Expand **Objects**, select a lamp wrapper such
as `object_town-node-5970`, and press Ctrl+D. Rename the new node and set its exported **Object Id** to a unique
value such as `my-lamp-001`; duplicating a wrapper also duplicates this id unless changed. Move it with the Godot
gizmo or Inspector transform fields, keeping Y at zero for quay placement, then Ctrl+S.

Launch `Test Editor Changes.cmd` to run the saved scene with a fresh layout, because an existing workshop layout
overrides the scene seed. This preview saves only to its own new directory under `proof/`. F5 in the editor runs
the full native town with saved layouts; F6 runs the currently edited district. Edit the authored wrapper, not its generated Asset
child. Every scene in `Objects` must have a unique id and a library asset reference.

Use `Start Native Town Game.cmd` to test your saved workshop layout in the complete game, or
`Test Editor Changes In Game.cmd` to test the saved editor seed. The game's lamp sources are rebuilt from authored
objects, so added, moved and deleted lamps affect illumination and reflections. Neither launcher promotes an
export into the source scene or writes the workshop layout.
