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
2. `git tag v0.2.0` then `git push origin v0.2.0`.
3. Wait for the Action (about 10 minutes). The Release is then on
   https://github.com/Steve-Sitax/Moodygame/releases.

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
| `shared/`, `LICENSE`, `README.md`, `ATTRIBUTION.md`, `PLAY.txt` | |
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
