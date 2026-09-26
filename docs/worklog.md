# Work log

What went live, what is being worked on now and by whom, and what waits for Steve.
The coordinating Claude session keeps this file current: a line when a helper starts, when a
patch goes live (with its commit), and when Steve decides something. Newest first in each part.
Git history has the detail of each commit.

## Waiting for Steve

- Licence before the repo goes public: 1) PolyForm Noncommercial 1.0.0 for code + CC BY-NC 4.0
  for our art, text and sound (recommended; no one may sell it), or 2) AGPL-3.0 (open source,
  others may sell). Before going public: scan the whole git history for secrets, check every
  third-party file has its licence in `assets/ATTRIBUTION.md`.
- Picture round jobs 1-5 (autumn ground litter, wall lanterns, goods along walls, clouds, smoke):
  start 1, 4, 5 now? (2 waits for the light spill, 3 for the prop check.) Plan:
  scratchpad `round/plan.md` (to be copied into docs when started).
- The 348 painted yard-side windows: make them 3D (recommended, after the posters) or leave them.
- The clockmaker's pocket watches and the junk-stall clocks: live hands too?
- The gutter streams are thin on purpose: stronger?

## In progress (helpers, 2026-09-26)

| Work | Scope and files | Started |
|---|---|---|
| Multiplayer plan (no code) | `docs/multiplayer-plan.md`: LAN co-op, assets cached by hash, no pause, per-player saves, client prediction | 2026-09-26 |
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
