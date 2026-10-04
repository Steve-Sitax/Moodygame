# Releases: the player's download

Steve, 2026-09-27: "how to best distribute the game if I open my GitHub project ... It should be very easy for
people." Picked: one repo, and a GitHub Release for each good version; a download per system with Node inside,
so a player installs nothing.

## How it works
- Work goes on in `main` as always. Players only see the Releases page; the README's first link points to
  `releases/latest`.
- A tag `v*` starts the Action `.github/workflows/release.yml`. It runs `tools/package.mjs` on Windows, macOS
  (Apple silicon) and Linux, and puts the three downloads on a new Release with `tools/release/notes.md` and
  GitHub's list of changes. A tag with a dash (`v0.2.0-beta1`) makes a pre-release.
- "Run workflow" on the Action's page (or `gh workflow run release.yml`) builds the three downloads as test
  files on the run's page only (kept 14 days), with no Release.

## Make a release
1. `npm run build` passes and the game plays well (the milestone's browser check).
2. In `CHANGELOG.md` the `## [Unreleased]` lines move under a new `## [0.2.0] - <date>` (and the compare links at
   the bottom get the new version). `version` in `client/package.json`, `server/package.json` and their lock files
   becomes the new number. Commit and push.
3. `git tag v0.2.0` then `git push origin v0.2.0`.
4. Wait for the Action (about 10 minutes). The Release is then on
   https://github.com/Steve-Sitax/Moodygame/releases. Its notes are the version's part of `CHANGELOG.md`
   (`tools/release/changelog.mjs`; the Action stops if that part is missing), then `tools/release/notes.md`
   (how to play), then GitHub's list of changes. Close the version's milestone on GitHub.

A bad release: delete it on GitHub (and the tag: `git push origin :refs/tags/v0.2.0`), fix, tag a new number.

## What is in a download
`Scheldemist-<version>-<system>-<cpu>` (zip, or tar.gz on Linux), about 160 MB packed, 275 MB unpacked:

| Part | What |
|---|---|
| `Start Scheldemist.bat` / `.command` / `start-scheldemist.sh` | the player's start file (`tools/release/start-*`) |
| `launch.mjs` | `tools/release/launch.mjs`: picks a free port from 8787, starts the server in production mode, waits, opens the browser; if the game already runs, only opens the browser |
| `runtime/` | the Node that built it (from setup-node, Node 24) |
| `server/` | `server/src` and its packages for that system (`npm ci --omit=dev`) |
| `client/dist` | the built game with its manifest |
| `shared/`, `LICENSE`, `README.md`, `CHANGELOG.md`, `ATTRIBUTION.md`, `PLAY.txt` | |
| `data/` | made at first start: the save and the settings, next to the game |

- **Play together is off** at first start (Steve, 2026-09-27); the player turns it on in the menu, Together.
- **No build on the player's PC**: `SCHELDEMIST_DIST` is set, so the server's autobuild stays off. The server
  reads its few files from `client/public` through `PUBLIC_DIR` (`config.ts`), which falls back to
  `client/dist` in the download.
- **No Claude Code copy inside**: the SDK's platform package (about 230 MB) is left out. `claudeExe()` in
  `server/src/ai/claude.ts` then uses the player's own Claude Code (`SCHELDEMIST_CLAUDE_PATH`, the PATH, or
  `~/.local/bin`). No Claude Code: the call fails and the hand-written line holds, as for every provider.
- **Never inside**: `data/`, saves, `ai-config.json`, keys, `.claude/`, dev tools. Checked 2026-09-27 on the
  Windows download: no key pattern, no save, no personal name or path.

## Known limits
- Not signed: Windows SmartScreen and macOS Gatekeeper warn once (the steps are in the README and PLAY.txt).
  Signing needs a paid certificate (Windows) and an Apple developer account (Mac).
- No Intel Mac download (GitHub's Intel Mac runners are going away). An Intel Mac player runs from source.
- Linux is built on Ubuntu 22.04 (glibc 2.35); older systems run from source.
- The first start of a new save takes a little longer: the town is made then.

## Godot download (G7)

The Godot port has its own packer: `node tools/godot/package.mjs --baked <shared-bake-folder>`.
Use Node 24, .NET 8, Godot 4.7.2 Mono and the matching Mono export templates. `--godot <console-exe>` selects the
editor, `--out <folder>` changes the ignored `godot/dist/` output folder and `--version <name>` names the zip.
Build on each target system: Windows x64, Linux x64, Apple silicon macOS. Never cross-package Windows SQLite
with a Linux or Mac Node. The packer verifies SQLite using the bundled Node before writing the zip.

The zip carries the exported Godot game with self-contained .NET, the shared baked town and decoded models,
audio and textures, compiled server JavaScript and production packages, portable Node, runtime licences,
`ATTRIBUTION.md`, `CHANGELOG.md` and `PLAY.txt`. It has no saved game, AI config, login, key, compiler, development
packages or Claude Code copy. The server reads its world files through the existing `PUBLIC_DIR` rule: this
package provides `client/public`, including the shared park JSON import and server wall/walk data.

Players unzip the whole folder, then double click the executable (Mac: open the app; Linux: run `Scheldemist`).
They install nothing else. The game starts its own server on a free port from 8800. Saves and all game settings
are made in the player's Scheldemist user folder, including when the game folder is read-only. Keep all the
unpacked files together. AI providers remain the player's own optional setup.

Measured Windows download: about 383 MB zipped, 1.14 GB unpacked. The town and decoded models take 749 MB
unpacked; the Godot executable, .NET, Node and server packages are the other main costs. Windows passed a real
unpacked launch and menu/save test. Linux and macOS game exports passed; full native packages and actual
launches still need validation on those systems. See `godot/README.md` and `docs/godot-download-check.md`.
The port download does not yet contain the browser multiplayer client or the game parts still being ported
in other worktrees. No AI account software or credentials are included. Downloads are unsigned.

`.github/workflows/godot-release.yml` is a draft, separate from the browser release Action. On a `v*` tag or
manual run it builds three zip artifacts (14-day retention), without creating or publishing a Release. Before
using it, set repository variables `GODOT_BAKE_URL` and `GODOT_BAKE_SHA256` to a trusted, publicly downloadable
zip of the agreed bake. Its root must hold the town files, `town_tex/` and decoded `models/`. The Action checks
the checksum and never bakes. A rendered smoke test must run on a Vulkan PC, not a hosted runner. This draft
has not been run; review the native packages before adding its artifacts to a player Release.
