# Scheldemist native Godot development

Open `native-godot/project.godot`, the sole active Godot project. F5 runs the complete game; district scenes run with F6. `godot/src` is its referenced C# core, not a separate game project. Start with `README.md`, `native-godot/README.md` and `native-godot/services/README.md`. Original browser development instructions are historical in `docs/archive/claude-web-history.md`.

## Project rules

- Keep gameplay, saves, navigation and multiplayer inside Godot/C#. Game startup and export must not require Node, a browser, a bake, Blender or the original checkout.
- Follow `AGENTS.md` for material-appropriate geometric bevels, grain, relief, corrosion and consistent collision. Preserve permanent object IDs, authored placement and unsaved editor work.
- The engine owns every number. AI proposes schema-checked, clamped words/plans without tools. Player text is data, not instructions; retain hostile-text checks, timeouts and written fallbacks.
- Keep real names, personal paths, company data, saves and credentials out of AI prompts and source control. Provider choice belongs in native AI setup; do not change the user's configured provider as a side effect of testing.
- Inspect actual gameplay for rendering/gameplay changes. Use isolated data/layout directories and bounded native proofs; retain their logs/screenshots outside source control. A rule fixture alone does not prove rendered behavior.
- Keep shader kinds and light counts stable. Check day, rain and night after material/light changes. Measure performance before claiming an improvement.
- Every required job/person/place must have a native route, including stairs and vehicle approaches. Interiors occupy their actual world shells; clocks show authoritative game time.
- Use one reusable model for an object across stock, carried loads, vehicles, stalls and rooms. Keep a goods item's look and label consistent everywhere.
- Record third-party licences in `assets/ATTRIBUTION.md`. Preserve unique original artwork outside the active app when retiring a runtime.
- CC0 and public-domain models, textures, sounds and other assets may be used (Steve, 2026-10-13): check the licence on the item's own page, check usefulness, adapt to our detail level and period before use. Rules and sources: `docs/cc0-assets.md`.
- Old game-save compatibility was explicitly waived during the Godot migration. Do not preserve obsolete saves. Never delete editor layouts, their backups, preferences or provider credentials when resetting gameplay.
- Coordinate shared builds/export and fingerprint preparation with running native tests. A fingerprint change between host and guest correctly rejects the connection.
- Add player-visible changes to `CHANGELOG.md`. Build and run relevant native checks before committing. Review staged files with `pwsh -File tools/commit-check.ps1`; fix findings rather than skipping the privacy guard.

## Commands

```powershell
dotnet build native-godot/Scheldemist.Native.csproj
pwsh -File native-godot/scripts/open-native-town.ps1
pwsh -File native-godot/services/check-market.ps1
pwsh -File native-godot/scripts/export-native-windows.ps1 -Output D:/Code/ScheldemistPackages/client
pwsh -File native-godot/scripts/test-icons.ps1 -Full
```

The game is started from the desktop icons (the `native-godot/*.cmd` launchers). After every build of main, run `test-icons.ps1 -Full`: it must pass before you hand the build over. Launcher logs: `%LOCALAPPDATA%` under `ScheldemistWorkshop/launch-logs`.

The native README records current evidence and worktree status. Do not infer that this branch is merged or that Steve has tested it from automated proofs.
