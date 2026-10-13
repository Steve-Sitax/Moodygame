# MakeHuman tools for people2

The people2 bodies, faces and sliders start from MakeHuman's CC0 core assets (the owner's decision, 2026-10-13: our
own heads looked odd and alike). This note says which MakeHuman tools we use, under which licence, how to install
them without touching anybody's Blender settings, and how to rebuild everything from scratch. How the kit uses the
assets (bodies, sliders, faces, hair, clothes) is in [people.md](people.md) "Bodies from MakeHuman"; the project-wide
rule for CC0 and public-domain assets is `docs/cc0-assets.md` (main, 3a48e23c).

**The game never needs MakeHuman or MPFB.** Godot loads only our `people2.glb` (imported into
`native-godot/assets/game-models/people2.scn`), our pictures and our JSON. MakeHuman's code never enters the repo,
the build or the game.

## Licences: code and assets are separate

| Part | Licence | In our repo? |
|---|---|---|
| MakeHuman application code (Python, shaders, UI) | AGPL-3.0 | No. Never run, never copied. |
| MPFB 2 add-on code | GPL-3.0-or-later | No. Installed outside the repo (`.scratch/blender-user`), called as a tool at build time. |
| MakeHuman assets: base mesh, targets, rig and weights, skins, eyes, brows, lashes, proxies, clothes | CC0 1.0 | Only the files the build reads, in `art-source/third_party/makehuman/` with `LICENSE.ASSETS.md` and `SOURCES.json`. |
| What MakeHuman or MPFB output (exported meshes, renders) | the user's own (MakeHuman `LICENSE.md` part D) | Our glb, pictures, JSON. |

MakeHuman's `LICENSE.md` (part C) puts "the base mesh and proxies, targets and modifiers, textures, clothes, poses and
expressions" under CC0. Assets from the MakeHuman community site's user uploads carry their own licences (often CC-BY):
we use none of them.

## The tools

| Tool | What it is | Version | Used for | Not used for |
|---|---|---|---|---|
| MakeHuman | The standalone character app (1.x, Python/Qt) and its CC0 asset set | assets: system asset pack (CC0), repo master 2026-10-13 | Its assets only: base mesh hm08, targets, default rig weights, skins, eye, brow and lash pictures | The app itself (never installed or run) |
| MPFB 2 | MakeHuman's Blender add-on: the same assets plus services (targets, macros, rigs, MakeClothes, MakeSkin, MakeTarget) | 2.0.18 (extensions.blender.org) | Required authoring tool: its `TargetService` computes the macro target stack (how gender, age, weight, muscle, height, proportions and origin mix MakeHuman's macro targets); its `LocationService` finds its data; the build compares our copies of the base files with its own | Its human, rig, skin material and clothes library (we keep our 64-bone skeleton, our painters and our export path) |
| MakeClothes | Fitting a mesh to the body (`.mhclo`: every vertex on a base-mesh triangle with three weights and an offset) | the method, as MPFB 2 documents it | The way every mesh follows the base body: our reduced near and far copies, eyes, hair pieces and clothes (`mh.Binding`, our own code) | Its tool and `.mhclo` files (our bindings live in the build, not in files) |
| MakeTarget | Authoring new targets as shape keys on the base mesh | MPFB 2.0.18 | Not used yet: the CC0 target set covered the 22 face types; broken noses, pox, stubble and ruddy noses are in the face painter | A later broken-nose or toothless-mouth target would be authored here and kept as our own work |
| MakeSkin | MPFB's material editor (`.mhmat`) | MPFB 2.0.18 | Not used | Our face and body pictures are painted by `mhskin.py`/`mhface.py` over MakeHuman's CC0 skin pictures |

Other CC0 sources (Poly Haven, ambientCG, Texture Ninja; `docs/cc0-assets.md`) may serve as skin, hair or cloth
detail later; the current grain pictures are still our own painters (`pictures.py`).

## MPFB: install it the isolated way

MPFB is installed into a private Blender user folder inside the worktree (`.scratch/blender-user`, not in git), so the
owner's Blender settings, add-ons and preferences stay untouched. Blender 5.2 (MPFB needs 4.2 or newer) works.

1. Download `add-on-mpfb-v2.0.18.zip` from https://extensions.blender.org/add-ons/mpfb/ into a new empty folder
   (`.scratch/mpfb-src`). SHA-256 `c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad`.
2. Install and enable it (bash; PowerShell: `$env:BLENDER_USER_RESOURCES = ...`):

   ```
   export BLENDER_USER_RESOURCES="<worktree>/.scratch/blender-user"
   blender -b --factory-startup --command extension install-file -r user_default --enable .scratch/mpfb-src/add-on-mpfb-v2.0.18.zip
   ```

3. Every people2 build runs with the same `BLENDER_USER_RESOURCES`. The build (`mh.ensure_mpfb`) enables MPFB after
   Blender's factory start (with `default_set`, since a factory start has no MPFB preferences) and stops with these
   instructions if MPFB is missing.

Headless use: only MPFB's Python services are called (`bl_ext.user_default.mpfb.services.targetservice`,
`locationservice`); no operator, panel or MakeHuman socket. Each build prints `MakeHuman files: N read, M compared
with MPFB 2.0.18's own, 0 differ`.

## What is in `art-source/third_party/makehuman/`

| Folder | From | Files |
|---|---|---|
| `base/3dobjs/base.obj` | MPFB 2.0.18 data (`data/3dobjs`), the same file as MakeHuman master `makehuman/data/3dobjs/base.obj` (SHA-256 `8e761e66...`) | hm08 base mesh: 19,158 vertices (13,380 body, the rest helpers and joint cubes) |
| `base/targets/<group>/*.target.gz` | MPFB data (`data/targets`) | the targets the sliders, face types and macro mixes read |
| `base/rigs/rig.default.json`, `weights.default.json` | MPFB data (`data/rigs/standard`) | the default rig's joints and CC0 skin weights (summed onto our 64 bones) |
| `system/skins/<skin>/*_diffuse.png` | MakeHuman system asset pack (CC0) | the nine skins under the face and body pictures |
| `system/eyes/materials/*_eye.png` | asset pack | iris pictures |
| `system/eyebrows/<name>/`, `system/eyelashes/<name>/` | asset pack | brow and lash cards and pictures (baked into the face pictures) |
| `LICENSE.ASSETS.md` | MakeHuman repo (`makehuman-master`) | CC0 1.0, the full text |
| `SOURCES.json` | written by us | every kept file: where it came from and its SHA-256; the downloads' URLs and SHA-256 |
| `USED.json` | the last full build | the files the build read; nothing else is kept |

Downloads (all into new empty `.scratch` folders, read as data by our own Python with `-I`; none of their scripts run):

| Download | URL | SHA-256 |
|---|---|---|
| MakeHuman system asset pack (CC0) | http://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip | `b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107` |
| MakeHuman repo master (licence texts, file comparison) | https://codeload.github.com/makehumancommunity/makehuman/tar.gz/refs/heads/master | `f0019bf6f717c1c30fb9d123ed760c9d39c3453beead3e8685566fca09d00171` |
| MPFB 2.0.18 | https://extensions.blender.org/add-ons/mpfb/ | `c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad` |

## Rebuild from scratch

1. Install MPFB as above.
2. The asset files are in git (`art-source/third_party/makehuman/`); to fetch them again: download the asset pack and
   MPFB, unpack with Python's `zipfile` into new folders, copy the files `USED.json` names (`base/...` from MPFB's
   `data/`, `system/...` from the pack), and compare with `SOURCES.json`.
3. Build (about 13 minutes for everything with the clips; see [people.md](people.md) "Build"):

   ```
   export BLENDER_USER_RESOURCES="<worktree>/.scratch/blender-user"
   blender -b --factory-startup --python-exit-code 1 -P art-source/tools/blender/build_people2.py -- --plain .scratch/people2-plain/people2.glb
   ```

4. Bring it into the game: `pwsh -File native-godot/scripts/replace-people2.ps1` ([godot-people2.md](godot-people2.md)).
