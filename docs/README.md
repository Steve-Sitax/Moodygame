# Scheldemist (working title) - design docs

A native Godot game. Antwerp, autumn 1873. You are a poor workman.
You find jobs, earn money, buy food and medicine, and build a name.
Claude runs the jobs, events, dialogue and memory.

Start with the [native game/editor instructions](../native-godot/README.md), [native services and proofs](../native-godot/services/README.md) and [Windows packaging](release.md). The design documents below record the original September 2026 decisions and later milestones; browser commands inside historical notes do not describe the active runtime.

| File | What it holds |
|---|---|
| [Native game/editor](../native-godot/README.md) | Current launch, editing, native resources and worktree status |
| [Native checks](../native-godot/services/README.md) | Current rule, gameplay and multiplayer evidence; workshop checks are in the native project README |
| [Native packages](release.md) | Current standalone Windows client/server export and relocation checks |
| [01-game-design.md](01-game-design.md) | Setting, player, needs, jobs, trust, NPCs, events |
| [Antigoon story and quests](antigoon-story.md) | Refined six-quest script, pacing, dialogue, failure rules and required gameplay support; [Opus and Astra review](antigoon-story-review.md) |
| [02-tech-stack.md](02-tech-stack.md) | Engine, server, database, why each one |
| [03-ai-design.md](03-ai-design.md) | Where Claude is called, prompts, schemas, memory, pacing, cost |
| [04-data-model.md](04-data-model.md) | SQLite tables |
| [05-art-direction.md](05-art-direction.md) | The look: retro low-poly, fog, gas light |
| [06-demo-scope.md](06-demo-scope.md) | What is in the demo, milestones |
| [07-spike-results.md](07-spike-results.md) | Tests done today with local Claude |
| [08-open-questions.md](08-open-questions.md) | Decisions, all answered 2026-09-23 |
| [09-backlog.md](09-backlog.md) | Ideas not yet in a milestone (job interaction, ...) |
| [testing.md](testing.md) | Historical browser test stack and kit; use the native checks above for current testing |
| [ai-setup.md](ai-setup.md) | The AI setup: an AI per kind of work (Claude login or key, Codex, OpenAI-compatible, Ollama), the test button, walk-around mode with no AI; the API the menu uses |
| [multiplayer-plan.md](multiplayer-plan.md) | Historical multiplayer design and phases; hosting/joining now run in Godot, described in the native instructions |
| [trade-plan.md](trade-plan.md) | Historical trade and transport design: stocks, dispatch, town ways and goods chains |
| [rendering.md](rendering.md) | No stutter: the shader warm-up, fixed light counts, the rules for anything that draws |
| [people.md](people.md) | The people2 kit: skeleton, MakeHuman bodies, sliders, faces, hair, kinds and clothes, clips |
| [makehuman.md](makehuman.md) | The MakeHuman tools behind the people2 bodies (MakeHuman, MPFB, MakeClothes, MakeTarget, MakeSkin): licences, the isolated MPFB install, rebuilding from scratch |
| [performance.md](performance.md) | The frame budget: where the time goes, rules for new models, textures, mirrors and every-frame logic, proving a speed change |
| [godot-status.md](godot-status.md) | Historical hybrid-port status and traps; start with the native game/editor instructions above |
| [godot-perf2.md](godot-perf2.md) | Godot allocation and timing pass: per-part measurements, exact pixel proof, functional checks and remaining frame-budget failures |
| [godot-bisect.md](godot-bisect.md) | Three-run Godot history bisect, scene/physics inventories, measured causes and subsequent speed experiments |
| [building-with-interior.md](building-with-interior.md) | Construction rules for real shells/rooms and openings; the original template is preserved under `art-source/tools/templates/interior/` after archival |
| [cc0-assets.md](cc0-assets.md) | Free assets: CC0 and public domain may be used; the rules (check, adapt, record) and the sources |
| [learnings-for-next-game.md](learnings-for-next-game.md) | Rules and lessons from this project for the next game: process, AI, rendering, world building, testing, saves, multiplayer, releases |
| [milestones/](milestones/) | One note per finished milestone; [milestones/M6.md](milestones/M6.md) is the index of the M6 parts |

Reference game: Foghorns Drown (Studio Laaya, 2026). First person, foggy lake town, a ferryman.
We take its mood: the fog and the grain. Not its PS1 style (Steve, 2026-10-11: high detail and good looking; see
05-art-direction.md). We do not copy assets, code or story.
