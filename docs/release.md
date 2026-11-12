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

This is a development preview. The exported Windows build's three-run warm startup median is 140.689 seconds,
80.689 seconds above the target. The package brings its prepared geometry along (the `startup-cache` folder):
a first launch with empty user data reached play in 147.017 seconds. Without that folder the first launch prepares
the geometry itself (863.973 seconds, one observation). Hardware and background work affect these times.
See [measured delays](startup.md).
Antigoon's autonomous encounter routing remains on the street; underground AI navigation is not implemented.
User saves, edited district layouts and provider credentials are not shipped.

## Windows preview receipt — 2026-11-12

The `windows-preview` channel contains **0.3.0-wip+2bd9167ea**, built from source
`2bd9167eacf09dad4abb36b4a7c99579b72489cf`. Later documentation and screenshot updates do not change that binary.
The 11,360,824,691-byte PCK contains 27,800 packed resources; its static-data pack contains 324 files.
The content verifier passed 168,095 checks. A relocated copy, with the source checkout and external .NET paths
unavailable, passed all 28 gameplay/render checks. All seven full desktop-launcher checks passed.

Three warm launches and the uncached, in-order reference preserve the town/map digests and non-timing report.
All 42,372 Ruien fingerprint rows agree after full data comparison of 7,046 differently serialized mesh pairs.
See [startup evidence](startup.md#exported-windows-preview-2026-11-12) and the
[machine-readable receipt](releases/0.3.0-wip.json). The startup target remains unmet.

The new surface screenshots are captured from this Windows package; the Ruien images show the completed native
network from its construction review. The old browser-era cathedral picture
and other historical README screenshots are no longer used to present the current build. Camera/time controls and
the game's own resident/lock commands stage the views; the images are unretouched game renders.

### Package with prepared geometry: 2026-11-12

The `windows-preview` channel now contains **0.3.0-wip+90f385c53**, built from source
`90f385c53`. Its game content equals the receipt above; the code adds the read-only `startup-cache` folder
beside the executable, and the package holds that folder: 10.85 GB in 15,598 files. The download grows by about
7.5 GB. Package fingerprint `19c862072af785cd40e3f6c2a7cbc6182f84e6b3772877968ee18fb6d37e7c95`; the content
verifier passed 168,095 checks; the relocated copy passed all 28 gameplay/render checks; all seven desktop-launcher
checks passed. Starts with empty user data and an empty own cache reached play in 147.017 s and, with the invariant
number format, in 136.298 s; each built no cache entry and left the package folder unchanged.
The warm three-run median above was measured on the earlier binary and was not repeated.

## Build from source

Godot 4.7.2 Mono exports a self-contained Windows x64 game and headless server. From the repository root:

```powershell
pwsh -File native-godot/scripts/export-native-windows.ps1 -Output D:/Code/ScheldemistPackages/client
pwsh -File native-godot/scripts/export-native-windows.ps1 -Server -Output D:/Code/ScheldemistPackages/server
pwsh -File native-godot/scripts/seed-startup-cache.ps1 -Package D:/Code/ScheldemistPackages/client
pwsh -File native-godot/scripts/check-exported-native.ps1 -Package D:/Code/ScheldemistPackages/client
pwsh -File native-godot/scripts/check-exported-native.ps1 -Server -Package D:/Code/ScheldemistPackages/server
```

`seed-startup-cache.ps1` puts the prepared start-up geometry into the client package (a `startup-cache` folder,
about 11 GB): it starts the game once to build it and once more to prove that a new player's start builds
nothing. Without that folder a player's first start takes about a quarter of an hour longer. See
[startup](startup.md#prepared-caches-in-the-package-2026-11-12).

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
Public descriptions use the game name and Steve's first name, without company names. GitHub account names in
source links may remain visible. Keep the work-in-progress label prominent.

```powershell
butler push <verified-package-folder> drstaf/scheldemist:windows-preview --userversion <source-commit>
```

Butler accepts builds up to 30 GB uncompressed and uploads changes incrementally
([official upload documentation](https://itch.io/docs/butler/pushing.html)). Keep credentials in the local
password manager and pass them only to the publishing process. Exclude export logs and local proof reports.
