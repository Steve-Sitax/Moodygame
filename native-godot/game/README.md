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
