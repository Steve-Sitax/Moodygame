# Testing native districts in the Godot game

## Current full-town test

Use `Start Native Town Game.cmd` in the parent folder. It launches `town.tscn -- --native-services --no-ai` with
Forward+, the real menu and all eleven districts. `Start Native District Game.cmd` now points to the same game.
Native C# rules and SQLite run inside Godot. Test saves/settings use `%APPDATA%/ScheldemistWorkshop/native-playtest`;
saved workshop placements are read separately, including the added lamp. `Test Editor Changes In Game.cmd`
uses scene seeds instead of saved layouts. Neither launcher writes workshop layouts or starts Node.

Whole-town integration and remaining server work are recorded in [native service notes](../services/README.md).
Multiplayer is still being ported; the native test does not enable Together. The older district-only test below
remains useful for surface diagnosis and is invoked directly with `scripts/open-native-game.ps1`.

## Earlier Rijnkaai slice and recovery reference

The Rijnkaai playtest connects the existing Godot menus, HUD, residents, conversations, pockets and hiring board
to the editable district. It loads saved workshop placements, including Steve's added lamp. It is a partial game
slice: interiors, movers, full mission routes and multiplayer remain. Jobs whose required spots/systems are absent
are marked unavailable. Review this slice before expanding other districts or retiring the web version.

## Run and edit

`scripts/open-native-game.ps1` starts the earlier `game.tscn` slice with Forward+, the saved workshop layout and the title menu.
Choose Walk into town; WASD/Shift/Space move, E interacts, I opens pockets, J the quest book, M the map and Esc the
pause menu. Game saves/settings are separate under `%APPDATA%/ScheldemistWorkshop/playtest`; launch uses no AI.
Install the checkout's existing server dependencies once with `npm --prefix server ci` if missing.

`Review Quay Surfaces.cmd` is the scenery-only viewer: click to capture the mouse, WASD/Shift/Space move and Esc
releases it. F6 cycles clear/mist/fog/rain/storm; F7
cycles 13/18/21/5 hours; F9 switches fly/walk; Space/Ctrl rise/descend while flying. B toggles bumps/relief and M
toggles the two reflection passes. The controls do not change saved player settings.

`Test Editor Changes In Game.cmd` passes `--scene-seed`: save the edited district in Godot first. A normal launch
uses a complete saved workshop layout when present, so it preserves deletions and can override an edited seed.
Exports remain separate object scenes until explicitly integrated. Neither game test writes or promotes a layout.

The surface viewer opens a close view of the corrected quay surfaces with the game's visual systems. It starts flying;
click and use WASD/Space/Ctrl to inspect them. F9 returns to walking. Restart an already-open game to load new
native resources. Save editor changes before reopening the district; never force a live editor reload.

## Runtime connection

`Scheldemist.Native.csproj` references the existing `godot/Scheldemist.csproj`; there is one implementation of Jef,
Daylight, Sky, Lights, Rain, RainSheets, Lightning, Waters and Mirrors. `NativeGame` selects district-supported
parts before constructing them; the surface viewer selects only visuals/player and starts no server. The playtest
temporarily uses `ServerLink` and the existing Node gameplay service (rules, saves, routines, hand-written talk).
There is no web client or whole-town GLB at runtime. Full server removal is still pending. `Main` exposes world/parts/menu hooks; its original defaults
remain the full bake-based game. `NativeGameWorld.Load` overrides the legacy loader with PackedScene loading.

Native colliders supply physics; the legacy Solid service must skip those meshes and the water template.
The native root restores semantic node names and extras for existing game queries. Lamp light records are built
from actual authored objects and flame/light anchors, rather than old baked positions. Gameplay lamp identifiers
and route anchors still need durable scene-based mappings before lamplighter/full-route systems are enabled.

`NativeModelRecovery` is one-time intake for people/props/player/crate/clutter/quaygoods/lively from the completed
model folder. Run `recovery/recover-game-models.tscn -- --source-models <folder>` in a rendered process. It stores
PackedScenes under `assets/game-models`, preserving skeletons and animations, with source hashes in `intake.json`.
Default intake refuses an existing output; `--resume-intake yes` adds missing files after checking source hashes
and never replaces a stored scene. `ModelLibrary.NativeScene` supplies these native scenes and never falls back
to runtime GLB loading. New model edits belong in the stored Godot scene/resources.

`Main.PrepareWorld` waits for native colliders to reach physics before attaching game parts. `WalkMap.FromNative`
samples ground and body clearance across district bounds; residents use this grid instead of the bake's walk dump.
This first grid supports ground-level quay terrain, not roofs/deep steps. It includes authored objects at startup;
live moving actors use the existing body registration. Whole-city server schedules/routes still supply resident
plans; the local crowd can stand only on its native grid. Posted actors outside the district are omitted.

The enabled `native_game_globals` editor plugin registers game shader globals for resource previews. Runtime
registers the same globals before loading its native materials. Keep this plugin enabled when inspecting the
stored game shader library in Godot; the workshop's basic materials do not depend on the game globals.

The workshop keeps basic editor materials. The game applies the native material library in `rijnkaai/` using
retained source material indices; edit that library to change game effects. Its intake fingerprint must match the
district recovery report. A refreshed source snapshot requires a new visual intake, because indices can change.

## One-time visual intake for another district

Complete and validate static district recovery first. Keep the original town and its adjacent `town.json`,
`town_lights.json` and `town_tex` as read-only intake inputs. Choose a fresh visual output id and the recovered
snapshot's material resource directory. Run a rendered Godot process, not `--headless`: texture-array image data
cannot be serialized correctly from the dummy renderer. Invoke this scene through `Invoke-WorkshopEngine` from
`scripts/engine-tools.ps1`, with arguments equivalent to:

```text
--rendering-method forward_plus --path <native-godot>
res://recovery/recover-game-visuals.tscn --
--source <completed-town.glb> --district <active-district-id>
--material-source res://recovered/<snapshot-id>/resources
--visuals res://game/<new-visual-id>
```

`NativeVisualRecovery` refuses an existing visual output. It reuses the game's material conversion, saves auxiliary
textures and texture arrays once, and copies native shared shadow/dirt/shore/fouling maps. Rijnkaai has 40 game
materials and 29 auxiliary texture resources. It also preserves independent clamp axes in game shaders. Sparse or
unsupported source/custom vertex data still needs an explicit recovery path; a material import alone proves no parity.

Match the material source directory and town snapshot to the active recovery report before intake. Keep native
material edits when making another intake. The generated facts/light metadata are native runtime configuration;
the game reads no original town GLB or bake folder. The existing river generator is reused, while other water
regions may need explicit native sheets and region data. Runtime still reads this repository's shared city water
outlines; packaging them into Godot resources is later work.

Run another district with `scripts/open-native-game.ps1 -District <id> -Visuals res://game/<visual-id>`.
Review its spawn, collision, boundaries, shader maps, lamp anchors and reflection planes. Keep test layouts and
screenshots under ignored `proof/`; never exercise save/export tests against a player's live files.

## Verification

`--native-play-proof <absolute-directory>` runs with real menus and isolated `--db`, `--prefs`, `--author-dir` and
`SCHELDEMIST_USER_DATA`. It checks native collision navigation, saved placements, live server state, visible crowd
actors/two posted people, 36 animation clips/skeletons, unavailable out-of-district jobs, hiring-board interaction,
conversation, pause/resume and an isolated game save/load restoring Jef's position. Keep `IndoorSave`/`RideSaves`:
menus alone save the camera but those adapters capture feet and restore the walking player.
It captures five UI/game screenshots under ignored `proof/playtest`; use no AI and a free isolated server port.
This proves the connected slice, not completion of all jobs or the remaining service migration.

`NativeGameProof` checks the real player on native collision, native bump/relief maps, all seven lamps in Steve's
copied 15-object layout, weather state, animated water and both reflection passes. It captures day, rain, no-bump,
night rain, fog, water-facing and reflections-off views. Rendered and headless runs reject engine errors. Logs and
images are under `proof/native-game-check`. The fixture currently targets this Rijnkaai review layout; adapt its
counts and resource assertions deliberately when testing another district.

## Quay surface repair and future intakes

The coping colour and height images already agree and have straight joints. Mitred sweep ends used equal U at
both width corners, causing a diagonal texture seam through each quad. `RecoveryCoping` projects U along the
quay normal's perpendicular, rebases each short patch by an integer repeat, and saves uncompressed positions
and UVs. It refines the existing 50 mm nose from four to twelve strips. Mitre displacement must affect positions
only; derive normals from the original outward normal or the rounded edge gets incorrect shading. The paving-side
top arris has a 12 mm radius and the exposed underside lip has a 10 mm radius. `RecoveryCopingCorners` clips
convex vertical corners with an 8 mm bevel and caps the cut through the entire profile. Inside/mating junctions
stay fitted. Preserve the underside's contact with the wall at Y = -0.28; the former black band was a surface,
not a gap. The game compensates its painted shadow in linear colour and adds indirect light scaled by the live
sky, weather and night, leaving mortar dark. No constant emissive wash is added.

The native sampler now accepts a metric height texture. Rijnkaai's coping uses the game's existing height map
with 8 mm depth in both workshop and game. Colour/height are both flipped vertically by the source export;
keep them aligned. `NativeSurfaceMaterials.Coping` replaces the old screen-scaled bump with metric derivatives.
For a new visual intake, attach its matching height texture to the recovered coping material and apply this
game helper to that snapshot's coping shader. Source material/resource numbers can differ in another district.

`RecoveryIron` replaces the imported bluestone pedestal with a cast mounting flange, following Steve's requested
matching finish. Base and body share one iron material. The flange keeps the source dimensions, with 2 mm edge
bevels, 6 mm rounded plan corners and a chamfered shoulder. Its collider is rebuilt from solid surfaces; the
transparent paving stain adds no raised collision plane. Iron uses
model-space casting pits (about 1 mm), larger corrosion dents (about 3 mm), rust patches and a worn rope band.
The shader fades subpixel detail with distance. The ground stain sits 2 mm above the paving. Game conversion
must preserve AlphaDepthPrePass as blending without depth writing; treating only Alpha as blended produced
the giant opaque brown square. The editor uses native PBR; the game adapts the same detail to its sun, sky,
spill lights, fog and wetness. B toggles the iron height as well as the existing bump and relief maps.

Static intake invokes both geometry helpers by semantic source name. `recovery/repair-surfaces.tscn` repaired
the existing Rijnkaai snapshot only: it checks the recorded source hash, backs up changed resources under
`proof/surface-backup-*`, and never saves the district scene, catalogue or player layout. Its resource paths are
specific to this snapshot; do not reuse them against another district. Once Godot assets are authored directly,
no GLB/bake intake is needed for surface or placement edits.

`NativeSurfaceProof` checks straight top joints across both triangles, a 50 mm round profile and normals, height
maps, transparency, saved object count and B toggling. `--surface-test <proof-directory>` on `game.tscn` captures
day/rain/no-bump close views; `--surface-shot <proof-directory>` on `main.tscn` captures the native workshop in
Compatibility. It also verifies all three coping radii, the vertical corner bevel, shared base/body materials,
wall contact and a ray through the stain reaching the actual paving. Views cover the land edge, underside,
quay corner and night. Use copied layouts with `--author-dir`. Current evidence is under `proof/edge-after`.
The project-wide [edge rule](../../AGENTS.md) applies to future districts and direct Godot modelling.
