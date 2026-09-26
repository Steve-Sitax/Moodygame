# Work log

What went live, what is being worked on now and by whom, and what waits for Steve.
The coordinating Claude session keeps this file current: a line when a helper starts, when a
patch goes live (with its commit), and when Steve decides something. Newest first in each part.
Git history has the detail of each commit.

## Waiting for Steve

- Multiplayer plan (`docs/multiplayer-plan.md`), six open questions, each with a recommendation:
  trust guests' own movement; night passes only when all are in bed; a player who dies starts a
  new man off the ferry; plain http on the home network; show guests' typed lines as bubbles;
  AI calls: host pays, 120 a day + 60 per extra player. Then: go for M8a (walk together)?
- The clockmaker's pocket watches and the junk-stall clocks: live hands too? (Steve did not pick it: no for now.)

Decided 2026-09-26: licence AGPL-3.0 (being added, with a public-release check); picture-round
jobs 1, 4, 5 now (2 and 3 after light spill and props); yard windows 3D; stronger gutter streams
and foot-of-wall dirt.

## In progress (helpers, 2026-09-26)

| Work | Scope and files | Started |
|---|---|---|
| Codex: low-poly props and tight collisions | IN PROGRESS. Generated reference `assets/concepts/quay-props.png`; research and shared mesh-surface collision helper, `geom.ts`, `rijnkaai.ts`, prop loader collision functions. Overlaps with Props in walls: preserve its placements/registry/checks, compare current files before integrating. Own test stack tight-assets on 5357/8957; do not stop others. No play checkout until verified. | 2026-09-26 |
| Licence and public check | AGPL-3.0 LICENSE, package.json fields, README licence part, Source link in the game, `docs/public-release-check.md` (secrets in history, third-party files, dependencies) | 2026-09-26 |
| Picture round 1, 4, 5 + tuning | autumn ground (leaves, dung, straw), clouds, smoke and works chimneys; stronger gutter streams and foot-of-wall dirt; litter.ts, leaves, sky in rijnkaai.ts, ambient.ts, eaves.ts, footDirt constants | 2026-09-26 |
| Yard windows 3D | the 348 yard-side walls get real windows; build_city.py, city.glb; posters/props/gutters checks stay clean | 2026-09-26 |
| AI setup, round 2 | a setting: typed lines to any chosen AI (default) or only to Claude; server AI code, `docs/ai-setup.md` | 2026-09-26 |
| Character creator | name, sex, age, looks, clothes; profile per player id; prompts and lines follow it; `client/src/menu/character.ts`, server profile | 2026-09-26 |
| Menus, settings, fonts, design | new menu module, `settings.ts`, `style.css`, bundled OFL fonts, graphics presets, key rebinding, the AI setup screen | 2026-09-26 |
| Loading screen | a boot module, `client/index.html`: progress bar, shaders and textures warmed up front | 2026-09-26 |
| Empty shop fronts | every cut shop house opening onto a void gets a real use and a real room (Steve's spot next to the bakery) | 2026-09-26 |
| Job figures walk up | customs, police, thieves, foremen live in the town and walk or run up; no pop-in; `popcheck()` | 2026-09-26 |
| Prison made real | every room the outside shows built inside, seen through every window; a general `interiorcheck`; `docs/building-with-interior.md` | 2026-09-26 |
| All boats | detail on every boat and barge, 6+ kinds of small boats, take any boat ("take X's boat"), owner angry if he sees it | 2026-09-26 |
| Ferry arrival and pier | the gangway stays down until the last one is off; the arrival boat (own file) and the pier in detail; lights | 2026-09-26 |
| Light spill | light from windows, doors and lamps falls on the ground the same way everywhere; `spill()` check | 2026-09-26 |
| Props in walls | one town-wide `propcheck()`; barrels and crates out of walls | 2026-09-26 |
| Flaky talk-down test | a separate session Steve started (families.test.ts timeout under load) | 2026-09-26 |

## Live (2026-09-26, after the away batch)

| Commit | What |
|---|---|
| 26ef905 | The multiplayer plan (design only): `docs/multiplayer-plan.md` |
| 82cb0ed | This work log |
| 07063f9 | CLAUDE.md: typed lines only to Claude is Steve's own setup; players pick their AI |
| d460f20 | Dialogs work after leaving the window; ink-quill cursor, click answers and buttons |
| af48da3 | AI setup (server): six providers, per kind of work, test, walk-around mode with no AI |
| 24b75bc | Warmth: warm rooms warm, a lantern slows the cold |
| b858d1a | Eaves: faint drops; broken gutters stream on worn houses |
| c636947 | Rule: interiors are real, never instanced |
| d229296 | Talk: a goodbye closes the window by itself |
| a944258 | Cathedral houses: no part in the stone; check in every build; clock markers |
| 4358bf3 | Every clock shows the game's time (92 faces) |
| 73d7525 | Het Steen rebuilt in detail |
| e669da5 | Landmarks: doors list guard (a crash when the server did not answer) |
| c835df8 | The Stadspark planted, the suspension bridge |
| a14a073 | Rule: every clock shows the game's own time |
| 7acc1fd | The cathedral outside in full 3D |
| b82e31c | Stalls and goods; no shop table past a house corner |
| e81a461 | (another session) No stutter: shaders built ahead, one light setting, mouse spikes |
| 71e1881 | Wet hollows on clear days; amber gas globes |
| 65e4d81 | The Vleeshuis in full 3D |
| 516e837, 7ca7d33 | Posters: only on plain wall, by district, bigger |
| 18e4619 | The Stadhuis in full 3D |
| a50cbb5 | Church and prison bumps strong enough to see |
| b9c1300 | The cathedral inside rebuilt |
| 954dfd5 | House walls: no repeats, dirt at the foot, church bumps, alley windows |
| a1dbf4b | Shop walls: plaster that does not shimmer |

Earlier batches: the git log before f5291a4 and the milestone notes in `docs/milestones/`.

## Rules added today (in CLAUDE.md)

- Every clock shows the game's own time.
- Interiors are real, never instanced; new buildings with an inside follow `docs/building-with-interior.md`.
- Players choose their own AI; Steve's machine keeps typed lines on Claude.
- Quality: before a building or prop patch goes live, close shots of every changed part and an
  automatic clip/overlap check that lists nothing.
