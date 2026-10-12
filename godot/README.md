# Native C# game core

This directory supplies the `Scheldemist` assembly used by the complete native game in
[`../native-godot`](../native-godot/README.md). Build the native project; its project reference builds
this core automatically. The active game, district resources, service rules, networking and export
presets live in `native-godot`. This directory is not a separate Node-backed game entry point.

```powershell
dotnet build ../native-godot/Scheldemist.Native.csproj
pwsh -File ../native-godot/scripts/open-native-town.ps1
pwsh -File ../native-godot/scripts/open-native-server.ps1 -Port 8800
```

Run these commands from this directory, or open the native project in Godot 4.7.2 Mono. F5 opens the
whole town. The game uses Forward+, native C# rules, SQLite and Godot resources. Installed packages
carry this assembly and their own .NET/ASP.NET dependencies; no source checkout, Node process or
whole-town bake is needed. See [standalone commands and proof](../native-godot/world/notes/standalone-export.md).

The native world supplies walking support, custom attributes, lights, rooms, model scenes, authored
object overlays and material metadata to these rendering/player/town systems. File-based auxiliary
data comes from the packaged native-static cache. Keep those native hooks when changing core code.
Object edits belong in native district scenes or their workshop layouts. Never overwrite edited
layouts while repairing geometry or resetting the game.

Old game-save compatibility was waived, and the identified legacy game saves were removed. Editor
layouts, preferences and provider credentials were retained. New game and dedicated-server data stay
in separate folders; test launchers must supply isolated data and layout roots.

The original port log was preserved as [historical notes](../docs/archive/godot-port-history.md).
Its browser, Node-server and bake commands are historical references, not current startup or release
instructions. Current service comparisons and gameplay proof are in
[the native service notes](../native-godot/services/README.md).