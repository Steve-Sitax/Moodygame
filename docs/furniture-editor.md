# Owner furniture workshop and the player map

The owner workshop opens 45 real rooms in their town shells. It exposes 3,847 recovered furniture/fitting groups and
242 promoted hall/prison chairs through permanent authored IDs. The public library adds 26 reviewed furniture models,
13 general aliases and the shared carried keg. Use the category filter, object list, Move, Copy, Delete, R, undo/redo
and Save. Switching rooms retains unsaved documents and histories. Whole-object clearance checks floors, room bounds,
ceilings, walls and other furniture. Floor anchors preserve source offsets and placements.

## Save an edit for every player

1. Open `Start Workshop.cmd`, choose **Enter a room…**, and edit the objects.
2. **Save** writes the owner's working copies under `user://layouts/<district>/layout.json`, with backups.
3. **Save into game map** saves all opened room documents into the repository's canonical object scenes:
   `native-godot/world/interiors/<room-id>.objects.tscn` or `native-godot/world/districts/<district>.objects.tscn`.
   Previous map scenes go under `.scratch/map-backups`. IDs, assets and exact position/rotation/scale values are retained.
4. Review and commit those object scenes. Run `native-godot/scripts/prepare-native-package.ps1`, then the usual export.

Player builds read committed scene seeds. They ignore per-user editor layouts. Development tests can explicitly use
`--author-root` or `--author-dir`; `--scene-seed` forces the committed map. Guests receive authenticated host layouts
for that visit, never writes to their local map. Seed deltas keep the existing world packet version and 512 KiB bound.
The game checks the content fingerprint and layout hash, reconstructs all 56 complete layouts, and validates their IDs.

The workshop, camera/UI, promotion and intake code are excluded from Release compilation. Both player export presets
exclude the workshop entry scene, 56 owner preview scenes and tool resources. Runtime descriptors reference only object
seeds; owner preview paths are strings. Package verification rejects editor resources and editor type names in the DLL.

## Conversion and art

Original recovered `.res` meshes are unchanged. `world/interiors/conversion.json` lists the exact old mesh/node indices
hidden by each room. Retained architectural triangles live in `.structure.tscn`; `structure-repair.json` records 22,402
triangles moved out of furniture batches. Empty historical markers retain their original IDs. Cast mounting materials,
bevels and UVs follow the kit contract in `docs/furniture.md`. Unreplaced recovered fittings keep their original edges as
a reference-preservation exception; they are not a new geometry-quality sign-off. Architectural shells stay fixed.

`FurnitureVisual` upgrades the original aliases using native kit scenes, preserving transforms and gameplay anchors. A recovered piece can also draw stored models: `ModelScene` in its place, `ModelParts` beside it (#196, #198). The
cathedral's confessionals, pulpit and side-altar fittings are such models (`assets/game-models/church.scn`, built by
`art-source/tools/blender/build_church.py`); their coarse recovered triangles were cut from the batch with
`native-godot/recovery/cut-recovered.py` and the plans `recovery/cathedral-198*.json` (a re-intake of the batch would bring
them back: apply the plans again). A model with a `<name>_hull` child gives the piece's collision from that hull of plain
solids instead of every carved triangle.
Oversized racks/fixture groups retain their construction. Source sprites retain conservative fallback collision;
ordinary geometry uses nondegenerate triangle collision. Replaced bodies are removed rather than consuming physics
slots. The global shader-variable instance buffer is 262,144 entries because of the additional separate instances.

The 1024/2048 px production textures have linear mipmaps. Meshes and textures are shared compressed native resources.
`assets/furniture/intake.json` records the source family/manifest SHA-256 values. Runtime reads no GLB or Blender files.
Furniture materials use the town's existing `NativeTownMaterials` / `BakedWorld.PsxMaterial` path, with snap disabled and
no affine warp. That path carries fog, wetness, darkness, world lamps and room lighting. Dynamic home furniture uses it
as well. Room stoves/lamps reuse existing light slots; the scene keeps 116 room lights. Clock hands use the shared clock.

Seats, beds, counters and keeper positions follow authored objects. Deleting them removes their hooks. Seat bindings
record 480 hall/prison destinations and suppress the old actor-attached chairs. Native home occupancy comes from the
current geometry. Editing refuses newly blocked routes; recovered baseline route gaps remain visible in the audit and
do not lock every editing tool. Existing reachable interactions must remain reachable after an edit.

## Evidence and remaining shell findings

AI-off fixtures use `.scratch`, bounded processes and ports 9180–9199. `.scratch/furniture-owner-final` contains the
51 editing/promotion checks, 17 separate-process restart checks and 104 game checks, including a live patron on a moved
chair, Jef's sitting and sleep in the moved bed, exact host/guest layouts, and indoor/outdoor day, rain, fog, 19:30 and
night pictures. Before/after/restart pictures were inspected, including close back and underside views. The original
quay proof adds 33 write and 6 reload checks, including committing a copy through a viewport click.

Route audit (issue 139, 2026-10-18): the 3,847 room asset files listed `GeometryClearance` and `PlacementAnchor` before
their `script` line, so Godot dropped both and the workshop's floor graph treated every recovered group as one solid box
(three taverns and the governor's rooms looked blocked). They now load. The route that counts is the game's own
`--room-route-audit` (docs/testing.md): Jef's ground and body tests from the street through every door. It found and this
pass fixed: green marker sheets left standing in the doorways of the rented homes (widow, alley, cellar, garret, and one on
the merchant's desk, now architecture markers or gone), the merchant's gilt rail running across his back doorway at 0.9 m,
and the town hall's main door, which never opened. Its hall and prison seats where the game sets people down without a walk
are listed as placed. The workshop graph still fails the garret and the cathedral's upper rooms (roof tops read as floor,
no town stair holes); the game audit passes them. The outdoor path check's five unreachable street residents were rounds
walked straight across water and closed yards while their ways were still being worked out; they now wait at the round's
point instead. No speed or owner-acceptance claim is made.

Final checks: shader audit passed with 133 inventory kinds, zero new kinds after the baseline and zero problems;
all visible placed furniture uses the town ShaderMaterial path. Lights stayed at 121 OmniLight3D and one sun
(116 room lamps; preview-only lights excluded). The real network test passed 26 checks, content identity passed
7 checks, and the owner shortcut fixtures passed test-icons.ps1 -Full. The Windows player export passed 158,776
package checks over 31,510 resources, including absence of workshop resources and UI/promotion type names.
