# Public release check (2026-09-26)

**Verdict: safe to make public once the licence patch is committed.** No real secret, key, token,
password, private key, save file, log or `.claude/` file is anywhere in the git history, and no
reference photo was ever committed. No history rewrite and no key rotation is needed.

A few small things are worth doing before or soon after flipping the switch; they are listed under
"Before you flip" at the end. None of them needs a history rewrite.

## What was checked

Everything reachable from every ref: the three branches on GitHub (`main`, `m4`, `review`), the
three local `claude/*` branches, and 167 local T3 Code checkpoint commits under `refs/t3/checkpoints`
(308 commits, 5,541 objects). Each blob in every version was searched, not only the current files.
gitleaks is not installed, so the search was a script with the usual gitleaks patterns
(`scratchpad` only, not in the repo). Commit messages and author lines were searched too.

## 1. Secrets and personal data

| Looked for | Found |
|---|---|
| Anthropic keys (`sk-ant-`), OpenAI keys (`sk-`, `sk-proj-`), GitHub tokens (`ghp_`, `github_pat_`), AWS (`AKIA`), Google (`AIza`), Slack, JWTs, `Bearer` tokens | Only made-up test values in `server/test/ai-setup.test.ts` (`FAKE_ANTHROPIC = "sk-ant-F..."`, `FAKE_OPENAI = "sk-FAKE-..."`, `sk-proj-abcdefghijk`, `Bearer abc.def.ghi`, `user:pw@example...`). They test that the key scrubber works. Not real. |
| `password`, `passwd`, `secret`, `token`, `apikey` assigned to a value; connection strings; Azure keys; `-----BEGIN ... PRIVATE KEY` | Nothing real (the same test file only). |
| `.env`, KeePass (`.kdbx`), `.claude/`, `rule-overrides.md`, `data/`, `*.sqlite`, `*.db`, logs, saves, backups | Never committed. `.gitignore` covers all of them. API keys typed into the game's AI setup live in `data/ai-config.json`, which is ignored. |
| Email addresses | Only the commit author `steve@sitax.be` (on all of Steve's commits), `t3code@users.noreply.github.com` (T3 checkpoints, local only) and `noreply@anthropic.com` (co-author lines). No other address in any file. |
| Phone numbers, home addresses | None. |
| Steve's jobs: Sitax customers, ITW, ValWeb, VALBEL, AI-DC, PlastiFab, Licquid | None. "Sitax" appears only as the GitHub owner name (`Steve-Sitax/Moodygame`) and "Steve (Sitax)" in the credits. |
| Machine names, NetBird, KeePass, private IPs | The two machine names **PCX** and **STX-PCX01** in `docs/multiplayer-plan.md` (4 lines) and `docs/milestones/M3c.md` ("Blender 5.2 on PCX"). The only IP is the placeholder `192.168.1.x`. No NetBird or KeePass mention. Low risk: they are names on a home network, not reachable from outside. |
| Personal paths | `C:\Users\...\Documents` only inside the hostile-line tests (a line a player might type); `OneDrive` only in a `.gitignore` comment. |
| Binary files (models, pictures, sounds) | No personal strings. `assets/concepts/quay-props.png` (not yet committed) carries OpenAI's content-credential stamp; that only says it was made with OpenAI's image tool. |

Also in history, harmless: seven `tools/blender/__pycache__/*.pyc` files (compiled copies of our own
Blender scripts) were committed once and removed again in `207f0ae`. They hold nothing private.

## 2. Third-party content

Every picture, sound, model and font ever committed (250 files over the whole history, plus the new
files not yet committed) was checked against `assets/ATTRIBUTION.md`.

- **Sounds:** all CC0 (Kenney Impact Sounds, BigSoundBank, Freesound), each with its source and hash.
- **Fonts:** five faces under the SIL OFL 1.1, as npm packages (Fontsource); not copied into our source.
- **Pictures made with Codex:** made from our own prompts, no third-party images in; OpenAI's terms
  give the output to the user. Fine to publish.
- **Models:** all built by our own Blender scripts in `tools/blender/` (each `.glb` has its
  `build_*.py`). Blender's GPL does not cover what it makes.
- **Map:** traced from the 1873 Vuillaume plan (CC0); the scan itself is not in git.
- **Reference photos and scraped pictures:** never committed. `data/refs/` (Vuillaume scan, Steen
  references) is covered by the `data/` ignore rule, and no path under `data/` exists in any commit.
  Steve's period photos and the concept paintings stayed out of the repo. The Sketchfab scan of the
  Steen (all rights reserved) was never downloaded.
- **OpenStreetMap (ODbL):** the landmark outlines in `shared/city.json` (and what is built from it)
  come from OpenStreetMap. ODbL allows this in public, but the derived data must stay available
  under the ODbL and carry the credit "© OpenStreetMap contributors". The credit is in the game's
  Credits and now in `README.md`. The note in `assets/ATTRIBUTION.md` still says "The repo is
  private; if the derived data is ever shared publicly, it must be under ODbL": update it to say
  that it is public now and the outlines are under ODbL 1.0.

Not yet listed in `assets/ATTRIBUTION.md` (all uncommitted work of other helpers; add a row before
each is committed):

| File | What it is | Needs |
|---|---|---|
| `client/public/boot/loading.jpg` | loading screen picture (loading-screen helper) | Its origin is not written down anywhere and nothing refers to it yet. **Find out where it came from before it is committed.** |
| `assets/concepts/quay-props.png` | a Codex/OpenAI concept sheet; `assets/concepts/README.md` has its prompt | a row in `ATTRIBUTION.md` like the other Codex pictures |
| `client/public/models/player.glb`, `player_base.png`, `player_shade.png`, `player_slot.png`, `player_atlas.json` | the player's body, made by `tools/blender/build_player.py` | a line that they are our own |
| `client/public/models/ferry.glb`, `quaygoods_surface.png` | made by `build_ferry.py`, `build_quaygoods.py` | a line that they are our own |

Already committed and covered by the general line "all models are our own ... by our Blender
scripts", but not named one by one: `clutter.glb`, `places.glb`, `prison.glb`, `stadhuis.glb`,
`steen.glb`, `vleeshuis.glb`, `wall.glb`, and the height maps `wall_*_h.png` (made by script from the
listed Codex wall pictures). Naming them is tidier but not required.

## 3. Dependencies

Read from each installed package's `package.json` (root, `client`, `server`; 186 packages including
dev tools):

| Licence | Count | Notes |
|---|---|---|
| MIT | 152 | three, vite, hono, ws, better-sqlite3, zod, vitest, concurrently, ... |
| ISC | 13 | |
| Apache-2.0 | 6 | typescript, rxjs, detect-libc, expect-type; `@dimforge/rapier3d-compat` sits in `client/node_modules` but is not declared or used |
| OFL-1.1 | 5 | the Fontsource fonts |
| BSD-3-Clause, BSD-2-Clause, 0BSD, Unlicense | 6 | |
| MPL-2.0 | 2 | lightningcss (a build tool, not shipped); GPL-compatible anyway |
| Proprietary | 2 | `@anthropic-ai/claude-agent-sdk` and its Windows binary: "© Anthropic PBC. All rights reserved", use under Anthropic's legal agreements |

All the free ones are compatible with the AGPL. The Claude Agent SDK is not free software. It is
fine as a declared dependency that npm installs: it is not in the repo and we never copy it. The
catch is for other people: the AGPL asks anyone who passes on the game to pass on the source of
everything it needs, and they cannot do that for the SDK. The usual fix is an extra permission
from the copyright holder (AGPL section 7), for example:

> As an additional permission under GNU AGPL version 3 section 7, you may combine this program
> with the Claude Agent SDK (or a modified version of it), and with other AI provider client
> libraries under non-free licences, and convey the combination, provided that the parts of the
> combination that are not those libraries are conveyed under the terms of this licence.

This would go into `README.md` (and at the top of the source files if Steve wants to be thorough).
It is Steve's choice as the copyright holder; it was **not** added. The game also runs with no AI
at all, so the SDK is optional, which makes this a small point.

Blender (GPL), numpy, opencv, shapely and Pillow are tools on Steve's machine; nothing of theirs is
in the repo.

## 4. Size

- Biggest file ever committed: `client/public/models/city.glb`, 9.2 to 9.7 MB, in 6 versions. No
  other file in history is over 5 MB. Nothing near GitHub's 50 MB warning or 100 MB limit.
- The current tree: 80 MB. Everything reachable from GitHub's branches: 256 MB before compression.
  GitHub reports the repo at about 118 MB. No clean-up is needed.

## 5. The licence itself

- `LICENSE`: the GNU AGPL v3 text exactly as served at https://www.gnu.org/licenses/agpl-3.0.txt
  (SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`); checked word for
  word against the SPDX copy (the only differences are `http` against `https` in two links).
- `"license": "AGPL-3.0-or-later"` in `package.json`, `client/package.json`, `server/package.json`
  and `shared/package.json`. "Or later" was picked: nothing in the docs asks for "only".
- `README.md` (new): what the game is, how to run it, and the licence: "Copyright (C) 2026 Steve
  (Sitax)". The docs name Steve only as "Steve"; the GitHub owner is Steve-Sitax and the credits
  already say "Steve (Sitax)", so that name is used.
- The game offers its source (AGPL section 13): a link to the GitHub repo in the menu's Credits,
  under "Code" (`client/src/menu/menu.ts`, marked `HOOK (licence 2026-09-26)`). The link only works
  for players once the repo is public.
- A side note: much of the code and all Codex pictures were made with AI. The law on who owns
  AI-made work is unsettled; the licence still covers everything that is Steve's. Nothing to do.

## Before you flip

Must:

1. Commit the licence patch (`LICENSE`, `README.md`, the `license` fields, this file) and the
   Source link in the Credits.
2. In `assets/ATTRIBUTION.md`, change the OpenStreetMap note from "the repo is private" to "public;
   the outlines are under ODbL 1.0".
3. Before `client/public/boot/loading.jpg` is committed, find out where it came from and list it.

Should:

4. Decide on the extra permission for the Claude Agent SDK (text above).
5. Replace the machine names PCX and STX-PCX01 in `docs/multiplayer-plan.md` and
   `docs/milestones/M3c.md` with "the host PC" and "the laptop". They stay in old commits; that is
   harmless and not worth a rewrite.
6. Add the `ATTRIBUTION.md` rows for the other new files in the table in part 2 as they are committed.

Know:

7. `steve@sitax.be` is the author address on every commit and becomes public with the repo. Hiding
   it would mean rewriting all history; not recommended. For new commits, GitHub's no-reply address
   is an option.
8. Only `main`, `m4` and `review` are on GitHub. The local `claude/*` branches and the 167 T3 Code
   checkpoints are local only (and clean). Do not `git push --mirror` or `--all`, or they go up too.
9. Making the repo public is a GitHub setting that only Steve changes.
