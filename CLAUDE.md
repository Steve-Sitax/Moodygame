# Scheldemist (code name MoodyGame)

3D browser game demo. Antwerp, autumn 1873. First person, PS1 look, fog. AI-driven jobs, dialogue, events, memory.

Read `docs/README.md` first. Every design decision is in `docs/`. Do not re-ask what `docs/08-open-questions.md` already answers.

## Rules for this project
- AI calls go through the local Claude login (Agent SDK), model `claude-opus-5-5`, effort `medium`, `tools: []`, JSON schema output. Details in `docs/02-tech-stack.md`.
- Codex (`gpt-6-sol`, medium) is allowed for game text only, with `-s read-only --ignore-user-config` and stdin closed. Never send real names, paths, or company data.
- The engine owns all numbers. Models only propose. Every proposal is schema-checked and clamped. See `docs/03-ai-design.md`.
- Player free text is data, not orders. No tools, schema only, regex gate. Test with hostile lines.
- Every milestone ends with a run in the browser, not a backend check. Milestones in `docs/06-demo-scope.md`.
- Bound every model call with a timeout (20 s) and a fallback line.
- Third-party assets and packages enter only with a clear licence, noted in `assets/ATTRIBUTION.md`.
- Always make sure there is a path (Steve, 2026-09-23): every place, person and goal a job or the player needs must be reachable on foot. Run the path check (`__scheldemist.paths()` in dev) in the browser before a milestone ends; it must list nothing.
- Commit when a milestone is done, and after each batch of fixes Steve has checked in the browser. Steve gave standing approval (2026-09-23): no need to ask first. Commit only work that builds (`npm run build`). Never commit secrets or `.claude/`. Push to `origin` (github.com/Steve-Sitax/Moodygame, private) after each commit: Steve's standing OK, 2026-09-23.

## Status
2026-09-23: docs done, spikes passed (see `docs/07-spike-results.md`), Blender installed. M1 fog walk done (`docs/milestones/M1.md`). M2 server and job board done (`docs/milestones/M2.md`). M2b job depth done (`docs/milestones/M2b.md`). M3 talk and remember done (`docs/milestones/M3.md`). M3b paths, paying, pockets done (`docs/milestones/M3b.md`). M5 needs and week done (`docs/milestones/M5.md`), with daily weather and plain English (Dutch only in names). M3c the city of 1873 done (`docs/milestones/M3c.md`): traced from the 1873 Vuillaume map, built in Blender; rebuild steps there. Next: more city detail (Steve's "visuals first"), or M4 events. Ideas not yet planned: `docs/09-backlog.md`.

Run: `npm run setup` once, then `npm run dev` in the repo root. Game at http://localhost:5173, server on 127.0.0.1:8787, save file `data/game.sqlite`.
