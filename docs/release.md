# Godot downloads and Windows packaging

**WORK IN PROGRESS — an unfinished development preview, not a finished release.**
Expect bugs, incomplete features and long loading times.

The active game is `native-godot/project.godot`. The public download is the
[Windows Godot preview on itch.io](https://drstaf.itch.io/scheldemist).
Source, build tools and technical documentation stay on [GitHub](https://github.com/Steve-Sitax/Moodygame).
It includes the full native town and completed Ruien: 167 areas, 26 active street entrances and
918 surveyed drainage inlets, with repaired Poesje access and channel-following water distortion.
The v0.1.0/v0.2.0 browser downloads and GitHub Pages demo are retired. Their source remains in Git history;
[archived browser packaging notes](archive/release-web-history.md) are historical references only.

## Play the preview

Follow the release's asset instructions, extract the game, and open `Play Scheldemist.cmd`.
Keep the executable, PCK and runtime folder together. Windows x64 and a Vulkan-capable graphics device
are required by the supplied Forward+ launcher. No Godot editor, .NET installation, Node or browser is needed.
Native Linux and macOS exports have not been validated or published.

This is a development preview. The source build's three-run warm startup median is 175.740 seconds,
115.740 seconds above the target; the first full geometry-cache build took 37 minutes 31 seconds.
Do not mistake that first loading pass for a finished startup. See [measured delays](startup.md).
Antigoon's autonomous encounter routing remains on the street; underground AI navigation is not implemented.
User saves, edited district layouts, provider credentials and generated geometry caches are not shipped.

## Build from source

Godot 4.7.2 Mono exports a self-contained Windows x64 game and headless server. From the repository root:

```powershell
pwsh -File native-godot/scripts/export-native-windows.ps1 -Output D:/Code/ScheldemistPackages/client
pwsh -File native-godot/scripts/export-native-windows.ps1 -Server -Output D:/Code/ScheldemistPackages/server
pwsh -File native-godot/scripts/check-exported-native.ps1 -Package D:/Code/ScheldemistPackages/client
pwsh -File native-godot/scripts/check-exported-native.ps1 -Server -Package D:/Code/ScheldemistPackages/server
```

Use empty output directories. Keep the executable, PCK and self-contained runtime folder together. Run `Play Scheldemist.cmd` or `Start Server.cmd --port 8800`. Neither package needs a browser, Node, Godot editor, .NET installation, source checkout or runtime bake.

Preparation embeds exact static-data bytes and a deterministic resource/runtime-code fingerprint. Complete all coordinated content changes before exporting matching client/server packages. Export or launcher preparation must not race a multiplayer test. See [standalone details](../native-godot/world/notes/standalone-export.md).

The Windows workflow builds temporary Actions artifacts only; it does not publish to itch.io. A tag alone
does not make a playable download available. Publish only an exported package after package-content,
relocated gameplay and startup checks. Rendered proofs need a suitable Vulkan PC. The standalone notes' October
client/server receipts describe the earlier conversion export; they do not validate a later package.

`check-exported-native.ps1` uses isolated saves/layouts and unavailable source/.NET/Node paths. Its
`-StartupMinutes` parameter bounds the complete first-cache launch (default 60 minutes), including the in-game
proof deadline. The existing checks still require native services, actual menu entry, residents, navigation and
day/rain/night rendering. Keep raw timings and screenshots locally; commit a concise release receipt without
user paths or private data. Never include game saves, user layouts, provider setup, private keys or admin tokens.

## Publish to itch.io

The project belongs to `drstaf`, and the Windows channel is `windows-preview`.
Use itch.io's Butler uploader for the complete exported folder; GitHub keeps the matching source revision.
The generated `.itch.toml` chooses the native executable and Forward+ renderer in the itch app.

```powershell
butler push <verified-package-folder> drstaf/scheldemist:windows-preview --userversion <source-commit>
```

Butler accepts builds up to 30 GB uncompressed and uploads changes incrementally
([official upload documentation](https://itch.io/docs/butler/pushing.html)). Keep credentials in the local
password manager and pass them only to the publishing process. Exclude export logs and local proof reports.
