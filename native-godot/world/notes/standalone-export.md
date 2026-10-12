# Standalone Windows game and server

Build from `D:/Code/MoodyGame-native-authoring/native-godot`. The game entry point is `town.tscn`; workshop
launchers explicitly open `main.tscn` or a district. Coordinate build/export with any running editor or proof:
Godot export publishes both C# projects, including the referenced `godot/Scheldemist.csproj` core.

```powershell
pwsh -File scripts/prepare-native-package.ps1
pwsh -File scripts/check-native-pack.ps1
pwsh -File scripts/check-native-aspnet.ps1
pwsh -File scripts/export-native-windows.ps1 -Output D:/Code/ScheldemistPackages/client
pwsh -File scripts/export-native-windows.ps1 -Server -Output D:/Code/ScheldemistPackages/server
pwsh -File scripts/check-exported-native.ps1 -Package D:/Code/ScheldemistPackages/client
pwsh -File scripts/check-exported-native.ps1 -Server -Package D:/Code/ScheldemistPackages/server
```

Use empty output folders. Godot 4.7.2 Mono Windows x64 templates are already installed in
`%APPDATA%/Godot/export_templates/4.7.2.stable.mono`. Package preparation can run without Godot or a shared build;
`export-native-windows.ps1 -PrepareOnly` also checks template availability. Development-only checks need .NET.
The shipped folder contains the executable, separate PCK and self-contained runtime directory; keep them together.
`Play Scheldemist.cmd` selects Forward+. `Start Server.cmd` runs headless with `--dedicated`; pass `--port 8800`
to choose a port. Development server launcher: `Start Native Server.cmd -Port 8800 [-DataDirectory <folder>]`.

## Runtime assets and fingerprint

All world geometry, materials, skeletons, clips, district catalogs, fonts, UI pictures and shaders are native
resources. Static service rules, ground-map images, audio and auxiliary texture/model facts need ordinary file
paths. Their exact original bytes are stored as SHA256-addressed `.bin` blobs in `world/data/pack`, then extracted
into the game's versioned `native-static` cache. This avoids relying on original images/audio omitted after
Godot import. A completion marker is written last; proof mode rechecks every extracted byte.

`NativeData` uses this packet in exported `native_standalone` builds. The editor keeps reading the current copied
data, so an unfinished package does not freeze development rules. `--native-pack-test` tests the packet with an
editor build; `--native-data-proof <absolute.json>` writes a checksum-verified extraction receipt.

Preparation writes `world/network-content.json`. Its deterministic SHA256 covers sorted native resource/shader/
static-data paths and content hashes plus runtime C# source and both build manifests. Code text normalizes BOM
and line endings, so the same sources share identity across Debug/ExportRelease and different checkout locations.
It excludes user layouts, saves, editor-only/proof/recovery source and output, including generated
`recovered/recovery-fixture-*` resources. Adding and changing a synthetic resource left the final identity
unchanged in three checks; only the five reviewed recovery directories supply shipped resources. Runtime
host overlays are authenticated separately and apply in memory; guests never overwrite their editor layouts.
The native game launcher refreshes this fingerprint before building. Refresh preparation after content edits.

The server preset intentionally keeps full mesh resources: native navigation rasterizes floor triangles, so
automatic dedicated-server Mesh placeholders would break routes. Its `dedicated_server` feature and launcher
select headless operation. [Godot's server export guide](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_dedicated_servers.html)
describes these resource options; raw JSON/SQL/BIN are included explicitly per the
[export guide](https://docs.godotengine.org/en/latest/tutorials/export/exporting_projects.html).

## .NET dependencies and checks

The standard Godot C# exporter publishes self-contained outputs. The release verifier requires local CoreCLR,
hostfxr, hostpolicy, ASP.NET/Kestrel, SQLite and both game assemblies. It rejects editor DLLs, PDB/source content,
Node/web/bake assets and user credentials; it reads the actual PCK index and checks every raw-data blob hash.
See the [Godot exporter source](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/mono/editor/GodotTools/GodotTools/Export/ExportPlugin.cs).

The editor loads game assemblies through an isolated dependency resolver and does not activate the extra ASP.NET
shared framework from the game's runtimeconfig. Debug builds download the ASP.NET 8.0.31 runtime pack through
NuGet `PackageDownload`, then mark its actual managed assemblies as private references. This supplies copied
DLLs and explicit `.deps.json` entries. Export configurations use normal self-contained framework publication.
The isolated check uses the real csproj target with a stream-loading context, starts Kestrel and requests a page.
It passed with 49 private dependencies; the raw-data proof passed 339 checks over the earlier 318-file packet. The current packet contains 319 files / 70,820,986 bytes; the relocated candidate checksum-verified its cold extraction.

Relocation proof copies only the exported folder into a fresh path, gives it isolated game/layout data, points
legacy root/bake and .NET paths at nonexistent folders and removes Node/.NET from the child PATH. The client must
enter its real menu, load eleven districts and residents, finish routes and render clear/rain/night views.
The server must boot its own authoritative backend and answer its native multiplayer endpoint. All proof files
stay under ignored `proof/`; no player save, layout or provider setup is used. Runtime/export results are recorded
after the coordinated engine tests rather than inferred from the source checks.

The final client export passed 57,497 checks against its actual format-4 PCK: 14,075 resources, all 319 raw files,
licence/attribution and self-contained dependencies. Its runtime includes the corrected native vehicle routing,
supported handcart loading and bicycle pose. Earlier export attempts caught resource enumeration using physical
`.tres.remap` names; `NativeDistrictLayouts` now uses `ResourceLoader.ListDirectory`. Those earlier attempts are
historical evidence, rather than the final downloadable package.

The final portable identity is `58dd5812d2b9b777f71736c2046210bdb2f8b7bf421032be55d5c20469c558db`,
from 14,069 content/code inputs. Client: `D:/Code/ScheldemistPackages/final-client-20261012-portable`.
Server: `D:/Code/ScheldemistPackages/final-server-20261012-portable` (57,498 package checks).
The portable client passed 28 relocated checks with clean shutdown and no engine/API errors in
`standalone-94b490f5e11945508de09b2b76e98275`: eleven districts, residents, real menu, native rules,
floor routing, clear/rain/night captures and actual bright pump lantern. It checksum-verified all 319
cold-extracted files with unavailable Node, .NET-installation and old source paths.
The portable server passed cold relocated boot/API/data checks in
`standalone-b6fa0c97929a4f05a15dc913edc43647`, with three native addresses, initialized TLS,
and all 319 checksum-verified extracted files. This bounded relocation check ends the process after readiness;
clean native server shutdown and authenticated HTTP/WebSocket state are covered by the separate 25-check
`native-network-421f71d4c4064384bd4d69fb6bb7510f` runtime proof.

Prepare once before a coordinated multiplayer test, then freeze `network-content.json` until both clients have
connected and the test finishes. Updating that file between host/guest startup correctly rejects the guest as
different content. Export also regenerates it, so avoid concurrent preparation during multiplayer identity proof.

## Retirement boundaries

Retirement completed after standalone, two-client and full transport tests passed. The browser `client` runtime,
Node `server` runtime, root npm/Vite launch/package scripts, dependency directories and whole-town bake tools
were removed from this worktree. The native packet copied the required authored JSON and audio/texture/model
facts. Source artwork and useful historical references were SHA256 archived in `art-source` and `docs/archive`.
`legacy-retired.json` records 493 archived files, 12 removed trees and 208 removed entry/source files. Original
GLBs are one-time conversion evidence, rather than runtime inputs. `godot/src` remains the native C# core project
and must stay available when building; its assembly is shipped, so installed games need no source checkout.
The exact tracked-file inventory is [legacy-retirement-files.json](legacy-retirement-files.json); its groups
separate retired web/Node code from original media and artwork helpers. The checksum archive manifest is
`art-source/retirement-manifest.json`. Main and external art worktrees were left intact.

After retirement, a clean native build passed; the retained market fixture passed 32 layout, 1,340 item,
1,200 NPC-browsing and 2,400 calendar comparisons without original source or Node. The editor pilot passed
39 save/reload checks (`run-97a88a4dde36444f9d0cbfd467b399e9`), and the real quay plus synthetic recovery
fixture passed 56 (`recovery-check-24b2201ad91b4aa3b6380832292360a7`). Both runners now explicitly select
`main.tscn`, so changing the default game scene cannot bypass their proof dispatch.

Steve waived old game-save compatibility. Root stopped verified legacy Node listener PID 60952 and watcher
73000, then exclusively opened and deleted the thirteen identified game SQLite/WAL/SHM and slot files from
the original main/art checkout and old workshop playtest. Editor layouts, preferences and provider credentials
were retained. No wholesale user-data deletion belongs in this package pipeline.
