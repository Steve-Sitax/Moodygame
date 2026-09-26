# 02 - Tech stack

## Shape
Two parts. A browser client for the 3D world. A small local Node server that talks to the AI models and holds the database.

```
Browser (Vite + TypeScript + Three.js)
   |  WebSocket + HTTP (localhost)
Node 24 server (TypeScript, Hono, ws)
   |  model router: picks a model per hook (MODEL_ROUTE in server/src/config.ts)
   |-- Claude Agent SDK -> local claude binary -> claude-opus-5-5 (default), claude-sonnet-5, claude-haiku-4-5
   |-- Codex CLI        -> local codex binary  -> gpt-6-luna, gpt-6-sol (locked down, no player text)
   |
SQLite (better-sqlite3)  =  game memory
```

Why a server: both AI SDKs run a local binary as a subprocess. A browser cannot do that. The server also keeps the database and the game log in one place.

## Client
| Part | Choice | Why |
|---|---|---|
| Build | Vite 7 + TypeScript | Fast reload. One command to run. |
| 3D | Three.js r186 | Biggest ecosystem. Easy custom shaders for the retro look. |
| Retro look | Own post-process pass | Render at 480x270, upscale, dither, vertex snap. See 05-art-direction. |
| Assets | glTF, low poly, 64-128 px textures | Small, fast, fits the look. |
| Controls | First person, WASD + mouse, pointer lock | Same as the reference game. |
| UI | Plain HTML/CSS over the canvas | Dialogue, needs, job board, money. No UI framework needed. |
| Audio | Web Audio API | Foghorn, bells, gulls, rain, footsteps. |
| State | Small typed store (own code) | Needs, money, time, position. No Redux. |

Alternative: Babylon.js 9. Good too, more built in. Three.js wins on shader freedom and examples.

## Server
| Part | Choice | Why |
|---|---|---|
| Runtime | Node 24 (installed: v24.12.0) | Already on the machine. |
| HTTP | Hono | Tiny, typed. |
| Push | ws (WebSocket) | The server pushes AI results when ready. The game never waits. |
| AI, main | @anthropic-ai/claude-agent-sdk 0.3.280 | Uses the local Claude login. No API key. Tested today. |
| AI, second | codex-cli 0.155.1 (installed) | Local Codex login. GPT Luna and GPT Sol, Steve's standing OK (2026-09-24). See the router below. |
| DB | better-sqlite3 | Sync, fast, one file. Easy to back up and reset. |
| Schemas | Zod | One schema is both the TypeScript type and the JSON schema for the models. |
| Tests | Vitest | Schema tests, memory recall tests, latency budget tests. |

## Claude call settings (every Claude call)
```
model: from the router      // default "claude-opus-5-5"; also claude-sonnet-5, claude-haiku-4-5-20251001
effort: "medium"            // Opus 5.5 default is medium. We set it anyway. Haiku 4.5: no effort, thinking off.
tools: []                   // no file or bash tools. Pure text in, JSON out.
systemPrompt: <our string>  // replaces the Claude Code prompt
outputFormat: { type: "json_schema", schema }   // typed answer
maxTurns: 1
persistSession: false       // no session files on disk
settingSources: []          // ignore user and project settings
```
Notes from the API skill:
- Opus 5.5 thinking is always on. Effort is the only control.
- Forced tool choice is not supported on Opus 5.5. We do not need it. JSON schema output covers it.
- The Claude Code base prompt is about 42k tokens. It is cached. A warm call costs about 1 cent at list price. On a subscription it counts against the plan limits, not money.

## Model router (Claude + Codex mix)
Built in M6, measured 2026-09-24 on 43 real prompts of 11 hooks: `docs/milestones/M6-models.md`.
One call path: `callClaude(db, { hook, system, prompt, schema })` in `server/src/ai/claude.ts`. The router
(`server/src/ai/router.ts`) looks the hook up in `MODEL_ROUTE` (`server/src/config.ts`) and runs it on that model.
Change the table, not the game. Every `ai_call` row records the provider and the model.

| Hook | Model | Why (vs Opus 5.5, blind judge, 5 = best) |
|---|---|---|
| newspaper, poster | GPT Luna (`gpt-6-luna`), medium, via Codex | Good enough (-0.35, -0.60), no rule breaks, as fast; off the Claude plan |
| rumour_twist, dream, npc_convo, family_share | GPT Luna | Steve, 2026-09-24: "do not use sonnet or haiku, use luna instead"; a failed call falls back to Opus 5.5 |
| every other hook (talk, typed lines, letters, director, Poesje, job board, outcomes, epilogue, ...) | Claude Opus 5.5, medium | Best on every hook, median 7.4 s, and the one tested on the hostile lines |
| textures, portraits, posters (asset phase, not run time) | GPT image model | See 03-ai-design, Images and textures. |

GPT Sol (`gpt-6-sol`) is wired in (`MODELS.sol`) but routes no hook: it was slower than Opus here (median 12.8 s) and
flatter. It held all 35 hostile lines.

The AI setup (2026-09-26, `docs/ai-setup.md`) sits above this table: the player picks an AI per kind of work
(Claude through the login or an API key, Codex, any OpenAI-compatible server, Ollama, or none) or walk-around mode
with no AI at all. Its default, "Recommended mix", is this table; with no `data/ai-config.json` nothing changes.

Router rules:
- Hooks that can hold the player's typed words (`PLAYER_TEXT_HOOKS`) go only to Claude, whatever the table says, unless
  `CODEX_PLAYER_TEXT` is turned on. It is off. (This is the Recommended mix. A player's own choice in the AI setup
  sends typed lines to the kind's AI unless its `typedLines` setting is "claude_only"; docs/ai-setup.md.)
- The "all Claude" switch: `SCHELDEMIST_ALL_CLAUDE=1` sends every GPT route to Opus 5.5.
- A machine without the codex binary (the laptop may not have it) sends GPT routes to Opus 5.5.
- If a GPT call breaks (not logged in, a tool used, a crash), the retry in the same call goes to Opus 5.5. A schema miss
  retries on the same model. A late call ends at 20 s like any other; then the engine's fallback words.
- Haiku 4.5 takes no effort setting; the router runs it with thinking off (with the CLI's default thinking it took 40 to 60 s).
- Both providers answer the same JSON schema. The game code never knows which model wrote the line.

Codex rules (Steve's standing OK for GPT Sol and GPT Luna in this project, 2026-09-24, logged in `.claude/rule-overrides.md`):
- What goes out: only the game's fictional prompts. No real names, paths, code or company data.
- Codex runs locked down on every call (`server/src/ai/codex.ts`):
  `codex exec -C data/ai-cwd-codex --ignore-user-config --ignore-rules --skip-git-repo-check --ephemeral -s read-only -m <model> -c 'model_reasoning_effort="medium"' -c 'web_search="disabled"' -c developer_instructions=<system text> --disable shell_tool --disable unified_exec --disable apps --disable browser_use --disable computer_use --disable image_generation --disable multi_agent --disable memories --disable plugins --disable hooks --disable view_image --disable goals --json --output-schema <schema.json> -o <out.json> "<prompt>"`,
  spawned directly (no shell) with stdin closed. A prompt too long for the Windows command line goes in on stdin, which
  is then closed at once.
- Any event but the model's text and reasoning fails the call: no shell command, no tool, ever.
- `-s read-only` and `--ignore-user-config` are mandatory. Steve's user config defaults to full disk access and a notify hook. The game must never inherit that.
- The schema is made strict for OpenAI (every key required, optional keys nullable, the nulls dropped on the way back).
- Tested first 2026-09-23 (07-spike-results): close stdin or the call hangs.

## Tools on this PC (checked 2026-09-23)
| Tool | Version | Use |
|---|---|---|
| Node | 24.12.0 | client build, server |
| npm | 11.11.1 | packages |
| claude CLI | 2.1.280 | local Claude, Opus 5.5 |
| codex CLI | 0.155.1 | gpt-6-sol |
| Blender | 5.2.1 LTS, installed today at `C:\Program Files\Blender Foundation\Blender 5.2\` | low-poly asset kit, glTF export |
| git | 2.42 | repo, not yet initialised |

npm packages (three, vite, hono, ws, better-sqlite3, zod, vitest, @anthropic-ai/claude-agent-sdk) get installed at milestone M1 and M2 when the project is scaffolded.

## Hosting
The demo runs on localhost only. A public build would need a hosted server with API keys.
That is a later step. Nothing in the design blocks it. The AI module is one file to swap.

## Not chosen
- Unity or Godot web export. Heavier, slower to iterate, and the AI plumbing is easier in TypeScript.
- Direct Anthropic API SDK with an API key. Faster and leaner per call. Steve asked for local Claude. Kept as plan B. See 08-open-questions.
  Since 2026-09-26 a player can choose Claude with an API key in the AI setup (`docs/ai-setup.md`); it is a plain
  `fetch` to the Messages API in `server/src/ai/http.ts` (no new package), like the OpenAI-compatible and Ollama adapters.
