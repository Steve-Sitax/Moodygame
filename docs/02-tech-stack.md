# 02 - Tech stack

## Shape
Two parts. A browser client for the 3D world. A small local Node server that talks to the AI models and holds the database.

```
Browser (Vite + TypeScript + Three.js)
   |  WebSocket + HTTP (localhost)
Node 24 server (TypeScript, Hono, ws)
   |  model router: picks a provider per hook
   |-- Claude Agent SDK  -> local claude binary -> claude-opus-5-5, effort medium
   |-- Codex CLI (opt-in) -> local codex binary  -> GPT-6, effort medium
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
| AI, second | codex-cli 0.155.1 (installed) | Local Codex login. Only after Steve says yes. See below. |
| DB | better-sqlite3 | Sync, fast, one file. Easy to back up and reset. |
| Schemas | Zod | One schema is both the TypeScript type and the JSON schema for the models. |
| Tests | Vitest | Schema tests, memory recall tests, latency budget tests. |

## Claude call settings (fixed for every call)
```
model: "claude-opus-5-5"
effort: "medium"            // Opus 5.5 default is medium. We set it anyway.
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
One interface: `generate(hook, input, schema) -> typed result`.
One table maps each hook to a provider. Change the table, not the game.

| Hook | Provider | Why |
|---|---|---|
| dialogue, free_reply, job_board, job_outcome, event, epilogue | Claude Opus 5.5, medium | Memory-heavy. Quality matters. Tested today. |
| rumour, newspaper, memory consolidation | GPT-6 via Codex, medium | Cheap bulk text. A second voice makes rumours sound like other people. |
| NPC voice split (option) | Per NPC | Give some NPCs to GPT-6 so their voices differ. Fientje and Tuur are good candidates. |
| event seeds, prop descriptions, wall notices (option) | GPT-6 via Codex, medium | Stateless. Good fit for a second model. |
| textures, portraits, posters (asset phase, not run time) | GPT image model | See 03-ai-design, Images and textures. |

Codex rules, from Steve's global instructions:
- OpenAI may train on input. Steve must approve before the first call. What goes out: only game text, NPC cards, and in-game memory. No real names, no company data, no keys.
- The router logs the provider on every call. A switch turns Codex off and sends all hooks to Claude.
- Both providers must return the same JSON schema. The game code never knows which model wrote the line.
- Codex must run with no shell and a read-only sandbox. The game prompt must never be able to run a command on the PC. If the CLI cannot guarantee that, Codex gets only stateless hooks and never player free text.
- Codex CLI non-interactive mode, tested 2026-09-23 (see 07-spike-results):
  `codex exec -C <empty dir> --ignore-user-config --skip-git-repo-check --ephemeral -s read-only -m gpt-6-sol -c 'model_reasoning_effort="medium"' --json --output-schema <schema.json> -o <out.json> "<prompt>" < /dev/null`
- Model id is `gpt-6-sol`. Effort `medium`. Close stdin or the call hangs.
- `-s read-only` and `--ignore-user-config` are mandatory. Steve's user config defaults to full disk access and a notify hook. The game must never inherit that.

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
