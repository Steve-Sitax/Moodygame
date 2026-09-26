# Scheldemist (working title) - design docs

A 3D browser game demo. Antwerp, autumn 1873. You are a poor workman.
You find jobs, earn money, buy food and medicine, and build a name.
Claude runs the jobs, events, dialogue and memory.

Status: documentation phase. No game code yet. Written 2026-09-23.

| File | What it holds |
|---|---|
| [01-game-design.md](01-game-design.md) | Setting, player, needs, jobs, trust, NPCs, events |
| [02-tech-stack.md](02-tech-stack.md) | Engine, server, database, why each one |
| [03-ai-design.md](03-ai-design.md) | Where Claude is called, prompts, schemas, memory, pacing, cost |
| [04-data-model.md](04-data-model.md) | SQLite tables |
| [05-art-direction.md](05-art-direction.md) | The look: retro low-poly, fog, gas light |
| [06-demo-scope.md](06-demo-scope.md) | What is in the demo, milestones |
| [07-spike-results.md](07-spike-results.md) | Tests done today with local Claude |
| [08-open-questions.md](08-open-questions.md) | Decisions, all answered 2026-09-23 |
| [09-backlog.md](09-backlog.md) | Ideas not yet in a milestone (job interaction, ...) |
| [testing.md](testing.md) | How to check a change in the browser: the test stack, the test kit, where and when things happen |
| [ai-setup.md](ai-setup.md) | The AI setup: an AI per kind of work (Claude login or key, Codex, OpenAI-compatible, Ollama), the test button, walk-around mode with no AI; the API the menu uses |
| [rendering.md](rendering.md) | No stutter: the shader warm-up, fixed light counts, the rules for anything that draws |
| [milestones/](milestones/) | One note per finished milestone; [milestones/M6.md](milestones/M6.md) is the index of the M6 parts |

Reference game: Foghorns Drown (Studio Laaya, 2026). First person, PS1-style, foggy lake town, a ferryman.
We copy the mood and the look. We do not copy assets, code or story.
