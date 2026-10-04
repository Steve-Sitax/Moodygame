# Godot download check, 2026-10-04

Work was done on `godot/download`. The shared town was copied without baking. No changes were made to the live game or the shared bake.

The source build passed `dotnet build godot`, the headless import and `npm run build`. The two targeted AI-setup/save-pause files passed all 52 tests. The broad suite was stopped after it made no progress; no full-suite pass is claimed. A source run loaded the shared town and started its own server on 8860, with a fresh save in an isolated user folder. Its net test passed HTTP state, WebSocket state and a clock tick. The compiled JavaScript server also answered on 8862 and made a fresh SQLite save using the bundled Node 24.12.0.

The Windows zip was unpacked into a fresh temporary folder with spaces in its name. The exported program started with no asset, Node or database override. Its own server answered on 8864, the town loaded (4,018 meshes, 709 materials), a default `game.sqlite` was made in the test user folder and the net test passed. The program and server both stopped. The screenshot in `godot/dist/windows-proof/nettest.png` was opened and inspected: the town and HUD rendered correctly.

A separate run of the same unpacked Windows zip passed every menu test on 8866, including settings, key bindings, manual save/load, autosaves and Continue. Settings were made in the test user folder. The title picture in `godot/dist/windows-menu-proof/02-title.png` was opened and inspected. Both checks removed their unpacked game and user data afterwards. The proof JSON, logs and pictures are local ignored output, not git files. Repeat them with:

```powershell
node tools/godot/test-download.mjs <windows.zip> godot/dist/windows-proof
node tools/godot/test-download.mjs <windows.zip> godot/dist/windows-menu-proof --menus
```

The Windows archive is about 383 MB packed and 1.14 GB unpacked. Largest unpacked parts: the baked town and decoded models (749 MB), Godot executable (111 MB), Node (90 MB), .NET runtime (81 MB), production server packages and code (66 MB), and public audio, textures and server world files (45 MB). All decoded models are kept so later port parts can use them; the largest, `city.glb`, is 117 MB. No saved games, AI setup, login or key files are copied into a download. The Claude Agent SDK's large platform CLI copies and development dependencies are excluded.

The installed templates also produced a Linux x64 game export (75 MB executable plus its .NET folder) and a macOS universal app export (129 MB zip). macOS needed ASTC texture imports enabled and the universal preset to match its universal template. These are game exports, not tested Linux/macOS player downloads: those packages must install Node dependencies on their own systems. The script deliberately refuses an incompatible host CPU. The macOS download carries Apple silicon Node, even though the Godot app itself is universal.

Shared files touched: `Main.cs` initializes Paths and reads the town, test output and retro shader from it; `BakedWorld.cs` gets the town facts and textures beside the chosen bake through Paths; `ServerLink.cs` gets its launch paths from Paths. `Wiring.cs`, the Soundscape path setting, `Render/Psx.cs` and all shaders were left unchanged. The renderer's existing texture fallback paths remain because changing Psx was excluded from this task; the download always supplies the correct town texture directory to it. Other callers changed: models, lights, walk map, water, town map, settings, keys, font/UI resource names and test output directories. `ServerProcess.cs` consumes the resolved locations and passes user-data paths into Node; `server/src/config.ts` accepts that writable data folder for AI working directories.

Still outside this check: a real Linux/macOS launch, multiplayer downloads, installed AI providers and the unfinished game parts assigned to the other port worktrees. The Godot exports report font/CanvasItem leaks while exiting (already tracked in [issue #40](https://github.com/Steve-Sitax/Moodygame/issues/40)); those do not prevent these tests passing. This does not claim the full browser game has been ported. The release Action is a draft that builds tag artifacts only, does not bake and does not publish a Release. No workflow was run, and nothing was pushed or tagged.
