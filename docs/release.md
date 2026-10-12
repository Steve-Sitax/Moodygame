# Native Windows packages

The active game is `native-godot/project.godot`. Godot 4.7.2 Mono exports a self-contained Windows x64 game and headless server. The original Node/browser release procedure is retained in [release-web-history.md](archive/release-web-history.md).

```powershell
pwsh -File native-godot/scripts/export-native-windows.ps1 -Output D:/Code/ScheldemistPackages/client
pwsh -File native-godot/scripts/export-native-windows.ps1 -Server -Output D:/Code/ScheldemistPackages/server
pwsh -File native-godot/scripts/check-exported-native.ps1 -Package D:/Code/ScheldemistPackages/client
pwsh -File native-godot/scripts/check-exported-native.ps1 -Server -Package D:/Code/ScheldemistPackages/server
```

Use empty output directories. Keep the executable, PCK and self-contained runtime folder together. Run `Play Scheldemist.cmd` or `Start Server.cmd --port 8800`. Neither package needs a browser, Node, Godot editor, .NET installation, source checkout or runtime bake.

Preparation embeds exact static-data bytes and a deterministic resource/runtime-code fingerprint. Complete all coordinated content changes before exporting matching client/server packages. Export or launcher preparation must not race a multiplayer test. See [standalone details](../native-godot/world/notes/standalone-export.md).

The Windows workflow builds artifacts only; it does not publish a release. It is configured to verify native rule fixtures and package contents; this workflow has not been run remotely during the migration. Rendered gameplay and multiplayer relocation checks require a suitable Vulkan PC. The local final client/server packages passed relocated runtime checks, with receipts in the standalone notes. Never include game saves, user layouts, provider setup, private keys or admin tokens in an artifact.
