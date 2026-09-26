# Work log

What went live, what is being worked on now and by whom, and what waits for Steve.
The coordinating Claude session keeps this file current: a line when a helper starts, when a
patch goes live (with its commit), and when Steve decides something. Newest first in each part.
Git history has the detail of each commit.

## Waiting for Steve

- Going public: the audit says safe. Steve flips the repo to public himself. Optional: an AGPL section 7 permission for the proprietary Claude Agent SDK (draft in `docs/public-release-check.md`). The commit email steve@sitax.be becomes public with the history.
- Multiplayer: the plan's questions are answered (see the plan's last part). Go for M8a (walk together) when the menus, character creator and loading screen are in?
- The clockmaker's pocket watches and the junk-stall clocks: live hands too? (Steve did not pick it: no for now.)

Decided 2026-09-26: licence AGPL-3.0 (being added, with a public-release check); picture-round
jobs 1, 4, 5 now (2 and 3 after light spill and props); yard windows 3D; stronger gutter streams
and foot-of-wall dirt.

## Order of work (Steve 2026-09-26: fewer at a time, a logical sequence)

At most 3-4 helpers at once, so tests and browser checks do not time out.

1. Wave 1: loading screen, character creator, empty shop fronts are live; prison made real still running.
   Why first: they are nearly done; multiplayer needs the loading screen and the character creator;
   the prison writes the interior check and template the shop fronts use; the shop fronts change the
   houses before the yard windows do.
2. Wave 2, paused until wave 1 is in: yard windows 3D, picture round 1/4/5 (+ tuning).
   Why: both touch houses, walls and the ground; yard windows after the shop fronts (both rebuild
   city.glb). (Props in walls finished early and goes live first: others build on its checks.)
3. Wave 3: all boats (big; its steamers get the picture round's smoke), then multiplayer M8a (walk
   together), which builds on the menus, the loading screen and the character creator.
4. Later: picture round 2 (wall lanterns, after the light spill) and 3 (goods along walls, after props).

## In progress (helpers, 2026-09-26)

| Work | Scope and files | Started |
|---|---|---|
| Codex: low-poly props and tight collisions | SAFE BATCH MERGED + PUSHED `abb6a21` (already live through `9aa9cd4`; reconciled main `98bdebe`): collision core, tree trunks and static stop benches; tree/vegetation design, matching bark bump/wet map. Seven collision tests, clean build, Chrome contact + dry/rain, paths/shaders empty. Test Chrome and isolated 5469/9069 stack cleaned up. HOLD barrels/crates/sacks and other prepared prop-loader changes until Props in walls/Picture round finishes; defer other active assets per Steve. Queue/scope and validation: `docs/milestones/M7-small-assets.md`; original cargo evidence `M7-tight-props.md`. Extra router check: 19 passed, two timeouts (first Codex stub and process-kill test); report to Flaky talk-down/AI owner, no edits to their files. | 2026-09-26 |
| Picture round 1, 4, 5 + tuning | PAUSED. autumn ground (leaves, dung, straw), clouds, smoke and works chimneys; stronger gutter streams and foot-of-wall dirt; litter.ts, leaves, sky in rijnkaai.ts, ambient.ts, eaves.ts, footDirt constants | 2026-09-26 |
| Yard windows 3D | PAUSED. the 348 yard-side walls get real windows; build_city.py, city.glb; posters/props/gutters checks stay clean | 2026-09-26 |
| Prison made real | every room the outside shows built inside, seen through every window; a general `interiorcheck`; `docs/building-with-interior.md` | 2026-09-26 |
| All boats | Done; the patch is being rebuilt on the newest version, then live. detail on every boat and barge, 6+ kinds of small boats, take any boat ("take X's boat"), owner angry if he sees it | 2026-09-26 |

## Live (2026-09-26, after the away batch)

| Commit | What |
|---|---|
| 5daf31c | Loading screen; every shader, texture and room ready before the menu |
| 8033055 | Empty shop fronts get their shops (barber by the bakery), shutters at night, a guard |
| 6726659 | Your character: name, sex, age, looks and clothes before a new week |
| b92eb5a | Props out of the walls: one town-wide prop check |
| abb6a21, ed6e6e2 | (other session) Small vegetation, model-shaped tree and bench collisions |
| e60ca44 | (other session) Tests: hostile-line loops copy one save; timed-out calls no longer wait |
| 9aa9cd4 | Light from windows, doors and lamps falls on the street the same way everywhere |
| 13f15d3 | Job figures walk up from the town; AI setup round 2 (typed lines, call cap, host-only) |
| c9acc1e | Ferry arrival: gangway stays down until all are off; the St. Anna and the landing stage |
| abb6a21 | Small trees/vegetation design pass, matching bark bump and rain response; model-shaped street/quay tree and static stop-bench collision. Active-session assets deferred. |
| 7d8a3ea | Menus: handbill title, settings (graphics presets, sound, controls rebinding, game, accessibility), AI setup screen, bundled OFL fonts |
| f1670b1 | Licence AGPL-3.0-or-later, README, `docs/public-release-check.md` (safe to go public) |
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
