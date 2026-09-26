# AI setup: pick an AI per kind of work, test it, or play with no AI

Steve, 2026-09-26: "setup of AI: make it changeable in config to connect to local Claude or Codex or any AI users
want. Different AI selectable for different types of work. And put a test button in it, plus guidance on how to use.
Or a button 'no AI' and just make it a walk-around game."

The server side is `server/src/ai/` (`setup.ts` the settings and the help texts, `http.ts` the HTTP adapters,
`router.ts` the route per hook, `claude.ts` the one call path, `routes.ts` the API). The menu screen is drawn by
the client from the JSON below. **The shapes on this page are the contract: they stay stable.**

## What it does
- **One call path** stays: every hook calls `callClaude(db, { hook, system, prompt, schema })`. The router looks up
  the hook's *kind*, the kind's *choice*, and runs it on that provider. Tools are always off, the answer is JSON that
  the hook's Zod schema checks, the 20 s limit and the day's 120 calls hold, and a failed call gives the hook's own
  hand-written fallback. Nothing in the game waits on a model.
- **Walk-around mode** (`mode: "walk"`): no model is called at all. `callClaude` returns at once with
  `{ ok: false, error: "no AI (walk-around mode)" }`, before the pause gate and before a budget row is booked, so
  every hook takes its fallback: the board's fixed jobs and twists, the director's templates (or a quiet hour), the
  hand-written talk lines and choices, the engine's paper, posters, ballads and sermon. The town's routines (people
  at their trades, stalls, carts, boats, the lamplighters) never needed a model and go on as before.
- **"No AI" for one kind** (`provider: "none"`): the same, for the hooks of that kind only.
- **The typed-lines wall** (CLAUDE.md: player text goes only to Claude): the hooks that can hold what the player
  typed (`PLAYER_TEXT_HOOKS` in `config.ts`) run only on a Claude provider (`claude_local`, `anthropic_api`). If their
  kind picks another AI, those hooks go to the default choice when that is Claude, else to Claude Opus 5.5 through
  the local login; with no Claude on the machine the call fails and the hand-written answer comes.
- **No file**: with no `ai-config.json` the game runs exactly as before this page: the recommended mix
  (`MODEL_ROUTE`: Opus 5.5 through the local login, GPT Luna through Codex for the paper, the posters, rumours,
  dreams, street talk and family news).

## Providers
| id | What | Needs | Runs as |
|---|---|---|---|
| `recommended` | The measured mix (docs/milestones/M6-models.md) | the Claude login; Codex for the cheap hooks | router table `MODEL_ROUTE` |
| `claude_local` | Claude through the Claude app login (Agent SDK) | Claude Code installed and logged in | `ai/claude.ts` `sdkRunner` |
| `anthropic_api` | Claude through an Anthropic API key | a key (paid per call) | `ai/http.ts` Messages API, `output_config.format` json_schema |
| `codex_cli` | GPT Luna / GPT Sol through the Codex CLI | Codex installed and logged in | `ai/codex.ts`, locked down |
| `openai_compat` | Any OpenAI-compatible server: OpenAI, OpenRouter, LM Studio, llama.cpp server, vLLM | base URL, model, key if the server wants one | `ai/http.ts` `/chat/completions`, `response_format` json_schema (strict) |
| `ollama` | Ollama on this PC | Ollama running, a model pulled | `ai/http.ts` `/api/chat`, `format` = the schema |
| `none` | No AI: the hand-written lines | nothing | no call |

The `ai_call` table logs the runner: `claude`, `anthropic`, `codex`, `openai`, `ollama`.

## Kinds of work (hook groups)
| id | Label | Hooks |
|---|---|---|
| `talk` | Conversations | dialogue, free_reply, resident_talk, resident_talkdown, resident_haggle, resident_police, resident_fortune, confession, clerk, home_remark, hands_lines, tavern_dice |
| `director` | The director and events | director_think, stranger_arrive, dream, epilogue |
| `jobs` | Jobs and twists | job_board, night_board, job_outcome, trouble |
| `press` | Newspaper, letters, posters | newspaper, poster, letter, letter_reply, diary |
| `ballads` | Ballads, sermons and plays | ballad, sermon, poesje_show |
| `town` | Townspeople's routines | routine_checkin, npc_convo, family_share, tavern_gossip, rumour_twist, hiring_call, persona |

A hook in no kind uses the default choice. A server test checks that every hook in the source is in a kind.

## Storage
`data/ai-config.json` (gitignored: `data/`) next to the save; a test save `data/test-<name>.sqlite` gets
`data/test-<name>.ai-config.json` (deleted by `teststack.mjs stop`). `SCHELDEMIST_AI_CONFIG` overrides the path.
Read at server start, written only by `PUT /api/ai/config` (atomic, owner-only on Linux and macOS).
API keys live only in this file: never sent back to the browser (only set or not, and the last 4 characters),
never logged, never in an error text (keys and `sk-...`-like strings are scrubbed from every error).

## API
All under the game's own origin rule (index.ts); bodies are JSON.

### `GET /api/ai/config` -> `AiConfigView`
```ts
type ProviderId = "recommended" | "claude_local" | "anthropic_api" | "codex_cli" | "openai_compat" | "ollama" | "none";
type KindId = "talk" | "director" | "jobs" | "press" | "ballads" | "town";
type Effort = "low" | "medium" | "high";
type Choice = { provider: ProviderId; model?: string; effort?: Effort };   // model/effort only where they apply
type KeyState = { set: boolean; last4: string | null };

interface AiConfigView {
  mode: "ai" | "walk";
  status: { title: string; text: string };          // ready to show on the menu, e.g. "Walk-around mode"
  default: Choice;                                  // never "default"
  kinds: Record<KindId, "default" | Choice>;        // "default" = same as default
  effective: Record<KindId, Choice & { label: string }>;   // what runs now, "same as default" resolved
  connections: {
    anthropic_api: { apiKey: KeyState };
    openai_compat: { baseUrl: string; apiKey: KeyState };
    ollama: { baseUrl: string };
  };
  available: { claude_local: boolean | null; codex_cli: boolean };   // null = not known until tested
  saved: boolean;                                   // false: no file yet, the built-in defaults
  options: AiOptions;
}

interface AiOptions {
  kinds: { id: KindId; label: string; what: string; recommended: string }[];
  providers: {
    id: ProviderId;
    label: string;                 // "Claude (your Claude login)"
    short: string;                 // one line for a list
    needs: ("apiKey" | "baseUrl")[];
    models: { id: string; label: string; effort: boolean }[];   // suggestions; empty for recommended/none
    freeModel: boolean;            // the player may type any model name
    modelHint: string | null;      // placeholder text for a typed model name
    defaultModel: string | null;
    effort: boolean;               // an effort setting may apply (per model: models[].effort)
    cost: "plan" | "paid" | "local" | "none";
    help: { what: string; need: string; cost: string; privacy: string };
    typedLines: string;            // what happens to lines the player types
  }[];
  efforts: Effort[];
  guide: { title: string; paragraphs: string[] };
  walk: { label: string; text: string };
}
```

### `PUT /api/ai/config` (body `AiConfigPatch`) -> `AiConfigView`, or 400 `{ error, issues: [{ path, message }] }`
Every field optional; what is left out stays.
```ts
interface AiConfigPatch {
  mode?: "ai" | "walk";
  default?: Choice;                                          // not "default"
  kinds?: Partial<Record<KindId, "default" | Choice>>;
  connections?: {
    anthropic_api?: { apiKey?: string | null };               // string sets it, null clears it
    openai_compat?: { baseUrl?: string; apiKey?: string | null };
    ollama?: { baseUrl?: string };
  };
}
```
Checks: unknown keys refused; `model` 1-100 characters of `A-Z a-z 0-9 . _ : / @ -`; `baseUrl` an http(s) URL
of at most 300 characters; `apiKey` 8-300 printable characters, no spaces. A model left out gets the provider's
default; an effort on a model that takes none is dropped; a Claude model that needs one gets `medium`.

### `POST /api/ai/test` -> `{ results: TestResult[] }`, or 409 `{ error }` while another test runs
Body, one of: `{ kind: KindId }` (that kind's choice; for `recommended` each model its hooks use),
`{ choice: Choice }` (a choice before it is saved; the saved connections are used), `{ all: true }` (every kind's
choice; the same model is tested once). One tiny call per model: a townsperson's one-line greeting, schema-checked,
20 s at most, all models of `all` at once. The test works in walk-around mode too (the player pressed it), costs
no game budget and books no `ai_call` row.
```ts
interface TestResult {
  target: KindId | "choice";
  label: string;            // the kind's label, or "Your choice"
  provider: ProviderId;
  model: string | null;
  ok: boolean;
  ms: number;
  line?: string;            // the model's greeting when ok
  error?: string;           // plain words, never a key: "The key was refused (401).", "Nothing answers at http://127.0.0.1:11434."
  note?: string;            // e.g. "No AI: the game uses its hand-written lines."
}
```

## The menu (client, drawn by the menu helper)
- A switch at the top: **AI on** / **Walk around (no AI)** (`PUT { mode }`). In walk mode show `status.title` and
  `status.text` plainly on the main menu too.
- **Default**: provider list (`options.providers`), model (list or typed), effort where `models[].effort`. **Per kind**: "Same as default" or its own choice. A **Test** button per kind and a
  **Test all**.
- **Connections**: the Anthropic key, the OpenAI-compatible base URL and key, the Ollama address. Show a key as
  "set, ends in abcd"; the field is empty and write-only.
- **Help** per provider: `help.what`, `help.need`, `help.cost`, `help.privacy`, `typedLines`; and `options.guide`.

## Tests
`server/test/ai-setup.test.ts` (stubs and fake keys only, no live call): the settings' checks and clamps; the key
never in a view, a log line or an error; the route per kind and the typed-lines wall; each HTTP adapter against a
local stub server (request shape, no tools, schema, timeout); walk-around mode books no call and never reaches a
runner; and a real server on a temp save driven through a whole game day of ticks: calls attempted with AI on,
none in walk-around mode.
