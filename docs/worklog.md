# Work log

What went live, what is being worked on now and by whom, and what waits for Steve.
The coordinating Claude session keeps this file current: a line when a helper starts, when a
patch goes live (with its commit), and when Steve decides something. Newest first in each part.
Git history has the detail of each commit.

## Waiting for Steve

- Day fog, rain and storm: the skyline is still a little lighter than the cloud deck (18-35% at 13:00). A one-line sky.ts change would use the night rule by day too, at the cost of flatter fog-day skies. Steve's call.
- Going public: the audit says safe. Steve flips the repo to public himself. Optional: an AGPL section 7 permission for the proprietary Claude Agent SDK (draft in `docs/public-release-check.md`). The commit email steve@sitax.be becomes public with the history.
- The clockmaker's pocket watches and the junk-stall clocks: live hands too? (Steve did not pick it: no for now.)

Decided 2026-09-26: licence AGPL-3.0 (being added, with a public-release check); picture-round
jobs 1, 4, 5 now (2 and 3 after light spill and props); yard windows 3D; stronger gutter streams
and foot-of-wall dirt.

## Order of work (Steve 2026-09-26: fewer at a time, a logical sequence)

At most 3-4 helpers at once, so tests and browser checks do not time out.

1. Wave 1: done and live (loading screen, character creator, empty shop fronts, prison, boats).
   Why first: they are nearly done; multiplayer needs the loading screen and the character creator;
   the prison writes the interior check and template the shop fronts use; the shop fronts change the
   houses before the yard windows do.
2. Wave 2: done and live (yard windows 3D, picture round 1/4/5 + tuning).
   Why: both touch houses, walls and the ground; yard windows after the shop fronts (both rebuild
   city.glb). (Props in walls finished early and goes live first: others build on its checks.)
3. Wave 3: multiplayer M8a is live and tried on the laptop (2026-09-27: they see each other). M8b (one street for all) started 2026-09-27.
   Note: Edge 154 (auto-update 2026-09-26 23:27) makes the game a slideshow on PCX; Chrome is fast. The desktop icon opens Chrome.
   together), which builds on the menus, the loading screen and the character creator.
4. Later: picture round 2 (wall lanterns, after the light spill) and 3 (goods along walls, after props).

## In progress (helpers, 2026-09-26)

| Work | Scope and files | Started |
|---|---|---|
| Relief that lights, on every texture | first try gave no measurable gain (checked at full resolution): redo the ground, then every textured surface: relief always changes the lighting normal for all lights; measured per surface | 2026-09-27 |
| Soft window light on the street | the window light on the cobbles showed as hard blocky diamonds: soft bars, smooth falloff | 2026-09-27 |
| Multiplayer M8b: one street for all | the same townspeople (owner per 64 m cell, remote puppets, handover), omnibus, river traffic, bridges, lock, cranes and drays (the world PC), platforms in their frame, shared doors; branch `m8b` in the worktree `D:\Code\MoodyGame-m8b`, merged when done | 2026-09-27 |
| People walking against walls | townspeople walking in place against walls in the alleys: a `stuck()` detector, root cause, fix | 2026-09-27 |
| Codex: low-poly props and tight collisions | SAFE BATCH MERGED + PUSHED `abb6a21` (already live through `9aa9cd4`; reconciled main `98bdebe`): collision core, tree trunks and static stop benches; tree/vegetation design, matching bark bump/wet map. Seven collision tests, clean build, Chrome contact + dry/rain, paths/shaders empty. Test Chrome and isolated 5469/9069 stack cleaned up. HOLD barrels/crates/sacks and other prepared prop-loader changes until Props in walls/Picture round finishes; defer other active assets per Steve. Queue/scope and validation: `docs/milestones/M7-small-assets.md`; original cargo evidence `M7-tight-props.md`. Extra router check: 19 passed, two timeouts (first Codex stub and process-kill test); report to Flaky talk-down/AI owner, no edits to their files. | 2026-09-26 |

## Live (2026-09-26, after the away batch)

| Commit | What |
|---|---|
| 6f346c9 | Dry cobbles are matte: no plastic sheen toward the sun or a lamp |
| af87e6e | The town wall walk: real setts, 1873 brick, bluestone coping, lawns, demolition works, guards and wall folk |
| 223c486 | The mills at work: millers, flour and grain carts, three mill jobs |
| 362e03c | Bumps on every textured surface (383 flat -> 8 on purpose); the town wall's own height maps |
| 5c0d603 | Night fog: no pale outlines; every light seen from far |
| 5243b63 | Multiplayer M8a: walk together on the home network (docs/milestones/M8a.md) |
| 2c028f3 | Sleep: a bed at any hour for as long as you choose, benches for worse, no sleeping rough |
| db527ee | Night sounds and the frame loop: no NaN can stop the game; the dray route fixed |
| 99dbc5d | Yard walls: real 3D windows instead of painted ones, lit at night |
| b77dc69 | Autumn ground (leaves, dung, straw), clouds, smoke and works chimneys; stronger gutter streams and wall-foot dirt |
| 81b5c10 | Boats: detail on all, seven new small kinds, take any boat by its owner's name |
| e989164 | The prison made real; interiorcheck; the template for buildings with an inside |
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
