# Testing native districts in the Godot game

The native district test uses the existing Godot C# player and visual systems with editable native scenes.
Rijnkaai is ready for Steve's review. It loads saved workshop placements, including the added street lamp.
NPCs, missions, interiors, navigation and movers remain separate migration work; do not enable every game part
against this partial district or expand to other districts before Steve reviews it.

## Run and edit

`Start Native District Game.cmd` starts `game.tscn` with Forward+ and the saved workshop layout. Click to capture
the mouse, WASD to walk, Shift to hurry, Space to jump, Esc to release. F6 cycles clear/mist/fog/rain/storm; F7
cycles 13/18/21/5 hours; F9 switches fly/walk; Space/Ctrl rise/descend while flying. B toggles bumps/relief and M
toggles the two reflection passes. The controls do not change saved player settings.

`Test Editor Changes In Game.cmd` passes `--scene-seed`: save the edited district in Godot first. A normal launch
uses a complete saved workshop layout when present, so it preserves deletions and can override an edited seed.
Exports remain separate object scenes until explicitly integrated. Neither game test writes or promotes a layout.

`Review Quay Surfaces.cmd` opens a close view of the corrected quay surfaces in the real game. It starts flying;
click and use WASD/Space/Ctrl to inspect them. F9 returns to walking. Restart an already-open game to load new
native resources. Save editor changes before reopening the district; never force a live editor reload.

## Runtime connection

`Scheldemist.Native.csproj` references the existing `godot/Scheldemist.csproj`; there is one implementation of Jef,
Daylight, Sky, Lights, Rain, RainSheets, Lightning, Waters and Mirrors. `NativeGame` selects only those parts and
Solid's movement queries. It starts no Node server. `Main` exposes world/parts/menu hooks; its original defaults
remain the full bake-based game. `NativeGameWorld.Load` overrides the legacy loader with PackedScene loading.

Native colliders supply physics; the legacy Solid service must skip those meshes and the water template.
The native root restores semantic node names and extras for existing game queries. Lamp light records are built
from actual authored objects and flame/light anchors, rather than old baked positions. Gameplay lamp identifiers
and route anchors still need durable scene-based mappings before lamplighter/NPC systems are enabled.

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
