import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CALLS_PER_DAY_DEFAULT, DB_FILE, MODELS, setCallsPerDay } from "../config.ts";

// The AI setup (docs/ai-setup.md): which AI writes which kind of work, the connections, and the
// walk-around mode (no AI at all). Kept in a local file next to the save (data/ai-config.json,
// gitignored), read at server start and changed only through PUT /api/ai/config (routes.ts).
// API keys live only in that file: a view never holds one (set or not, and the last 4 characters),
// and scrubKeys() takes them out of every error text before it is logged or shown.
// With no file the game runs as before: the recommended mix of MODEL_ROUTE.

export const PROVIDER_IDS = ["recommended", "claude_local", "anthropic_api", "codex_cli", "openai_compat", "ollama", "none"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const KIND_IDS = ["talk", "director", "jobs", "press", "ballads", "town"] as const;
export type KindId = (typeof KIND_IDS)[number];
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];
/**
 * Where the player's typed lines go (Steve, 2026-09-26: "People should be able to let everything go
 * to Codex or any AI. Not everyone has Claude."): "same" = to the AI of the hook's kind, like any
 * other game text; "claude_only" = only to Claude (Steve's own rule for his machine). The Recommended
 * mix keeps them on Claude either way (MODEL_ROUTE, PLAYER_TEXT_HOOKS).
 */
export const TYPED_LINES = ["same", "claude_only"] as const;
/** The daily call cap the player may set: 0 = no limit, else 1 to this many (Steve, 2026-09-26, multiplayer answers). */
export const CALLS_PER_DAY_MAX = 10_000;
const CallsPerDay = z.number().int("a whole number").min(0, "0 (no limit) or more").max(CALLS_PER_DAY_MAX, `at most ${CALLS_PER_DAY_MAX}`);
export type TypedLines = (typeof TYPED_LINES)[number];

/** The providers that are Claude: the only ones that may read what the player typed (CLAUDE.md). */
export const CLAUDE_PROVIDERS: ReadonlySet<ProviderId> = new Set(["claude_local", "anthropic_api"]);

/** Hook -> kind. A hook in no kind uses the default choice (a test checks every hook in the source is here). */
export const KIND_HOOKS: Record<KindId, readonly string[]> = {
  talk: ["dialogue", "free_reply", "resident_talk", "resident_talkdown", "resident_haggle", "resident_police", "resident_fortune", "confession", "clerk", "home_remark", "hands_lines", "tavern_dice"],
  director: ["director_think", "stranger_arrive", "dream", "epilogue"],
  jobs: ["job_board", "night_board", "job_outcome", "trouble"],
  press: ["newspaper", "poster", "letter", "letter_reply", "diary"],
  ballads: ["ballad", "sermon", "poesje_show"],
  town: ["routine_checkin", "npc_convo", "family_share", "tavern_gossip", "rumour_twist", "hiring_call", "persona"],
};
const KIND_OF = new Map<string, KindId>(KIND_IDS.flatMap((k) => KIND_HOOKS[k].map((h) => [h, k] as [string, KindId])));
export function kindOf(hook: string): KindId | null {
  return KIND_OF.get(hook) ?? null;
}

// ------------------------------------------------------------------ the file and its checks

const MODEL_RE = /^[A-Za-z0-9._:/@-]{1,100}$/;
const Model = z.string().trim().regex(MODEL_RE, "a model name: 1-100 letters, digits or . _ : / @ -");
const Url = z
  .string()
  .trim()
  .max(300)
  .refine((s) => {
    try {
      const u = new URL(s);
      return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "an http:// or https:// address, without a user name or password in it")
  .transform((s) => s.replace(/\/+$/, ""));
const Key = z.string().trim().min(8, "at least 8 characters").max(300).regex(/^[\x21-\x7e]+$/, "printable characters, no spaces");

export const ChoiceSchema = z.strictObject({ provider: z.enum(PROVIDER_IDS), model: Model.optional(), effort: z.enum(EFFORTS).optional() });
export type Choice = z.infer<typeof ChoiceSchema>;
const KindValue = z.union([z.literal("default"), ChoiceSchema]);

const FileSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["ai", "walk"]),
  // a file from before the setting has none: "same"
  typedLines: z.enum(TYPED_LINES).default("same"),
  // a file from before the setting has none: today's 120
  callsPerDay: CallsPerDay.default(CALLS_PER_DAY_DEFAULT),
  default: ChoiceSchema,
  kinds: z.partialRecord(z.enum(KIND_IDS), KindValue),
  connections: z.object({
    anthropic_api: z.object({ apiKey: Key.optional() }),
    openai_compat: z.object({ baseUrl: Url, apiKey: Key.optional() }),
    ollama: z.object({ baseUrl: Url }),
  }),
});
export type AiFile = z.infer<typeof FileSchema>;

export const PatchSchema = z.strictObject({
  mode: z.enum(["ai", "walk"]).optional(),
  typedLines: z.enum(TYPED_LINES).optional(),
  callsPerDay: CallsPerDay.optional(),
  default: ChoiceSchema.optional(),
  kinds: z.partialRecord(z.enum(KIND_IDS), KindValue).optional(),
  connections: z
    .strictObject({
      anthropic_api: z.strictObject({ apiKey: Key.nullable().optional() }).optional(),
      openai_compat: z.strictObject({ baseUrl: Url.optional(), apiKey: Key.nullable().optional() }).optional(),
      ollama: z.strictObject({ baseUrl: Url.optional() }).optional(),
    })
    .optional(),
});
export type AiPatch = z.infer<typeof PatchSchema>;

export const OPENAI_URL = "https://api.openai.com/v1";
export const OLLAMA_URL = "http://127.0.0.1:11434";

export function defaults(): AiFile {
  return {
    version: 1,
    mode: "ai",
    typedLines: "same",
    callsPerDay: CALLS_PER_DAY_DEFAULT,
    default: { provider: "recommended" },
    kinds: {},
    connections: { anthropic_api: {}, openai_compat: { baseUrl: OPENAI_URL }, ollama: { baseUrl: OLLAMA_URL } },
  };
}

// ------------------------------------------------------------------ models per provider

interface ModelInfo {
  id: string;
  label: string;
  effort: boolean;
}
const CLAUDE_MODELS: ModelInfo[] = [
  { id: MODELS.opus.model, label: "Claude Opus 5.5 (best writer)", effort: true },
  { id: MODELS.sonnet.model, label: "Claude Sonnet 5", effort: true },
  { id: MODELS.haiku.model, label: "Claude Haiku 4.5 (fast, plainer)", effort: false },
];
const API_MODELS: ModelInfo[] = [
  { id: MODELS.opus.model, label: "Claude Opus 5.5 (best writer)", effort: true },
  { id: MODELS.sonnet.model, label: "Claude Sonnet 5 (cheaper)", effort: true },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheapest, plainer)", effort: false },
];
const CODEX_MODELS: ModelInfo[] = [
  { id: MODELS.luna.model, label: "GPT Luna (fast)", effort: true },
  { id: MODELS.sol.model, label: "GPT Sol (slower here)", effort: true },
];
const DEFAULT_MODEL: Partial<Record<ProviderId, string>> = {
  claude_local: MODELS.opus.model,
  anthropic_api: MODELS.opus.model,
  codex_cli: MODELS.luna.model,
};
const KNOWN_MODELS: Partial<Record<ProviderId, ModelInfo[]>> = { claude_local: CLAUDE_MODELS, anthropic_api: API_MODELS, codex_cli: CODEX_MODELS };
/** A Claude model without an effort setting (Haiku 4.5): the call runs with thinking off. */
const noEffort = (model: string) => /haiku/i.test(model);

/**
 * A choice made whole: a model where one is needed (the provider's default), an effort only where it
 * applies. Claude models that take effort get "medium" when none is given (docs/02: Opus 5.5's own
 * default, set anyway). Returns an error text when the choice cannot run (a typed model is missing).
 */
export function normalChoice(c: Choice): { choice: Choice } | { error: string } {
  const p = c.provider;
  if (p === "recommended" || p === "none") return { choice: { provider: p } };
  const model = c.model ?? DEFAULT_MODEL[p];
  if (!model) return { error: `name a model for ${PROVIDER_TEXT[p].label}` };
  if (p === "ollama") return { choice: { provider: p, model } };
  if (p === "claude_local" || p === "anthropic_api") {
    if (noEffort(model)) return { choice: { provider: p, model } };
    return { choice: { provider: p, model, effort: c.effort ?? "medium" } };
  }
  if (p === "codex_cli") return { choice: { provider: p, model, effort: c.effort ?? "medium" } };
  return { choice: c.effort ? { provider: p, model, effort: c.effort } : { provider: p, model } };
}

// ------------------------------------------------------------------ the state, the file

/** Where the settings live: next to the save (a test save gets its own), or SCHELDEMIST_AI_CONFIG. */
export function configFileFor(dbFile: string): string {
  if (process.env.SCHELDEMIST_AI_CONFIG) return path.resolve(process.env.SCHELDEMIST_AI_CONFIG);
  const base = path.basename(dbFile);
  if (base === "game.sqlite") return path.join(path.dirname(dbFile), "ai-config.json");
  return path.join(path.dirname(dbFile), base.replace(/\.sqlite$/i, "") + ".ai-config.json");
}

let current: AiFile = defaults();
let saved = false;
/** Under the tests no file is read or written unless SCHELDEMIST_AI_CONFIG names one. */
let file: string | null = process.env.VITEST && !process.env.SCHELDEMIST_AI_CONFIG ? null : configFileFor(DB_FILE);

export function aiSetup(): AiFile {
  return current;
}
export function isSaved(): boolean {
  return saved;
}

/** Read the file at server start. A broken file is reported and left alone; the defaults run until a PUT. */
/** The game's daily call cap follows the setting (config.ts CALLS_PER_DAY, a live binding every budget check reads). */
function applyCap(): void {
  setCallsPerDay(current.callsPerDay);
}

export function loadAiSetup(): { ok: boolean; note: string } {
  current = defaults();
  saved = false;
  applyCap();
  if (!file || !fs.existsSync(file)) return { ok: true, note: "no AI settings file: the recommended mix" };
  try {
    const parsed = FileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (!parsed.success) return { ok: false, note: `AI settings file not valid (${parsed.error.issues.length} problem(s)); the recommended mix until the settings are saved again` };
    current = cleanFile(parsed.data);
    saved = true;
    applyCap();
    return { ok: true, note: current.mode === "walk" ? "walk-around mode: no AI calls" : "AI settings loaded" };
  } catch {
    return { ok: false, note: "AI settings file could not be read; the recommended mix until the settings are saved again" };
  }
}

/** Drop what cannot run (a choice with no model) back to its default. */
function cleanFile(f: AiFile): AiFile {
  const one = (c: Choice, fb: Choice): Choice => {
    const n = normalChoice(c);
    return "choice" in n ? n.choice : fb;
  };
  const kinds: AiFile["kinds"] = {};
  for (const k of KIND_IDS) {
    const v = f.kinds[k];
    if (v !== undefined) kinds[k] = v === "default" ? "default" : one(v, { provider: "recommended" });
  }
  return { ...f, default: one(f.default, { provider: "recommended" }), kinds };
}

/** Apply a checked patch: the new settings, or the problems in plain words. Written at once. */
export function applyPatch(body: unknown): { ok: true } | { ok: false; error: string; issues: { path: string; message: string }[] } {
  const p = PatchSchema.safeParse(body);
  if (!p.success) return { ok: false, error: "those settings were not accepted", issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: scrubKeys(i.message) })) };
  const d = p.data;
  const next: AiFile = structuredClone(current);
  const issues: { path: string; message: string }[] = [];
  const take = (c: Choice, where: string): Choice | null => {
    const n = normalChoice(c);
    if ("error" in n) {
      issues.push({ path: where, message: n.error });
      return null;
    }
    return n.choice;
  };
  if (d.mode) next.mode = d.mode;
  if (d.typedLines) next.typedLines = d.typedLines;
  if (d.callsPerDay !== undefined) next.callsPerDay = d.callsPerDay;
  if (d.default) {
    const c = take(d.default, "default");
    if (c) next.default = c;
  }
  for (const [k, v] of Object.entries(d.kinds ?? {}) as [KindId, "default" | Choice][]) {
    if (v === "default") next.kinds[k] = "default";
    else {
      const c = take(v, `kinds.${k}`);
      if (c) next.kinds[k] = c;
    }
  }
  const cn = d.connections;
  if (cn?.anthropic_api && "apiKey" in cn.anthropic_api) {
    if (cn.anthropic_api.apiKey === null) delete next.connections.anthropic_api.apiKey;
    else if (cn.anthropic_api.apiKey !== undefined) next.connections.anthropic_api.apiKey = cn.anthropic_api.apiKey;
  }
  if (cn?.openai_compat) {
    if (cn.openai_compat.baseUrl !== undefined) next.connections.openai_compat.baseUrl = cn.openai_compat.baseUrl;
    if (cn.openai_compat.apiKey === null) delete next.connections.openai_compat.apiKey;
    else if (cn.openai_compat.apiKey !== undefined) next.connections.openai_compat.apiKey = cn.openai_compat.apiKey;
  }
  if (cn?.ollama?.baseUrl !== undefined) next.connections.ollama.baseUrl = cn.ollama.baseUrl;
  if (issues.length) return { ok: false, error: "those settings were not accepted", issues };
  current = next;
  applyCap();
  write();
  return { ok: true };
}

function write(): void {
  saved = true;
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Tests: settings in memory (no file), or a file of their own. */
export function setAiSetupForTest(f: Partial<AiFile> | null, filePath: string | null = null): void {
  file = filePath;
  current = f ? { ...defaults(), ...structuredClone(f) } : defaults();
  saved = f !== null;
  applyCap();
}

// ------------------------------------------------------------------ the choice for a hook

/** The choice that writes a hook now: null when no model may be called (walk-around, or "none" for its kind). */
export function choiceForHook(hook: string): Choice | null {
  if (current.mode === "walk") return null;
  const k = kindOf(hook);
  const v = k ? (current.kinds[k] ?? "default") : "default";
  const c = v === "default" ? current.default : v;
  return c.provider === "none" ? null : c;
}

/** A kind's choice with "same as default" resolved. */
export function effectiveChoice(k: KindId): Choice {
  const v = current.kinds[k] ?? "default";
  return v === "default" ? current.default : v;
}

// ------------------------------------------------------------------ keys never leave

const lastFour = (k: string | undefined) => ({ set: !!k, last4: k ? k.slice(-4) : null });

/** Take every key (and anything that looks like one) out of a text before it is logged or shown. */
export function scrubKeys(s: string): string {
  let out = s;
  for (const k of [current.connections.anthropic_api.apiKey, current.connections.openai_compat.apiKey]) {
    if (k && k.length >= 8) out = out.split(k).join("[key]");
  }
  return out
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_\-*.]{6,}/g, "[key]")
    .replace(/\b(Bearer|x-api-key:?)\s+[^\s"',}]+/gi, "$1 [key]")
    .replace(/(api[_-]?key|token|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, "$1$2[key]");
}

// ------------------------------------------------------------------ help texts (data the menu shows)

const PRIVACY =
  "What is sent: the game's own text only (the scene, the made-up townsperson's character and memories, the day's events in the town). Nothing about you or your computer: no name, no files, no paths.";
const TYPED_HERE =
  "What you type to people goes to this AI, fenced as a line of dialogue (never as orders), unless \"Typed lines only to Claude\" is on: then typed lines go to Claude, or get the hand-written answers if there is no Claude on this PC.";

/** The daily call cap (data the menu shows). */
export const CALLS_PER_DAY_OPTION = {
  label: "AI calls per game day",
  what: "The most AI calls the game makes in one game day (midnight to midnight). When they are used up, people and events use the game's hand-written lines until the next day. Each part of the game also keeps to its own share (the director, conversations, the paper), so a higher number is not used up all at once.",
  cost: "With a paid AI (an API key, OpenAI, OpenRouter) every call costs money: 120 calls with Claude Opus 5.5 is roughly 1 to 3 US dollars a game day. 0 means no limit: then only each part's own share holds, so set a spending limit with the AI service too.",
  default: CALLS_PER_DAY_DEFAULT,
  min: 0,
  max: CALLS_PER_DAY_MAX,
  zeroMeans: "no limit",
};

/** The switch for typed lines (data the menu shows). */
export const TYPED_LINES_OPTION = {
  label: "Where your typed lines go",
  what: "When you type your own words to someone (a line, a letter, a confession, haggling, the police), those words are sent to an AI so the person can answer. The game checks them first: lines that try to give the AI orders are stopped before any AI sees them, the rest go in as a line of dialogue only, and whatever comes back is checked and clamped by the game.",
  privacy: "Your typed words are sent to the AI you choose. With a paid or online AI they leave this PC; with Ollama or a local server they stay on it. Type nothing personal.",
  values: [
    { id: "same" as TypedLines, label: "Same AI as the rest", text: "Typed lines go to the AI chosen for that kind of work (Conversations for most of them)." },
    { id: "claude_only" as TypedLines, label: "Only to Claude", text: "Typed lines go only to Claude (your login or your API key), whatever AI the rest uses. Without Claude, people answer typed lines with hand-written lines." },
  ],
};

export const PROVIDER_TEXT: Record<ProviderId, { label: string; short: string; help: { what: string; need: string; cost: string; privacy: string }; cost: "plan" | "paid" | "local" | "none" }> = {
  recommended: {
    label: "Recommended mix",
    short: "Claude Opus 5.5 for most things, GPT Luna for the paper, posters and gossip.",
    cost: "plan",
    help: {
      what: "The mix the game was tuned with: Claude Opus 5.5 writes the talk, the jobs and the director; GPT Luna (through Codex) writes the morning paper, wall posters, rumours, dreams, street talk and family news.",
      need: "Claude Code installed and logged in on this PC. Codex installed and logged in for the GPT Luna parts; without Codex those parts go to Claude too.",
      cost: "Runs on your Claude and ChatGPT plans, not paid per call. A game day makes at most 120 calls.",
      privacy: PRIVACY,
    },
  },
  claude_local: {
    label: "Claude (your Claude login)",
    short: "Claude through the Claude Code login on this PC. No key needed.",
    cost: "plan",
    help: {
      what: "Claude runs through Claude Code on this PC, the same way the game has always worked. Opus 5.5 writes best; Sonnet 5 is close for talk between people; Haiku 4.5 is quick and plainer.",
      need: "Claude Code installed and logged in (run `claude` once in a terminal and log in).",
      cost: "Counts against your Claude plan's limits, not paid per call. A game day makes at most 120 calls.",
      privacy: PRIVACY + " It goes to Anthropic.",
    },
  },
  anthropic_api: {
    label: "Claude (Anthropic API key)",
    short: "Claude through an API key from console.anthropic.com. Paid per call.",
    cost: "paid",
    help: {
      what: "Claude called directly with your own API key. Same models, often a little faster than the login.",
      need: "An API key from console.anthropic.com (Settings, API keys). Paste it below; it is kept only in data/ai-config.json on this PC and never shown again.",
      cost: "Paid per call. A game day makes at most 120 calls; with Opus 5.5 that is roughly 1 to 3 US dollars a game day, less with Sonnet or Haiku. Set a spending limit in the Anthropic console.",
      privacy: PRIVACY + " It goes to Anthropic.",
    },
  },
  codex_cli: {
    label: "GPT (Codex login)",
    short: "GPT Luna or GPT Sol through the Codex CLI on this PC.",
    cost: "plan",
    help: {
      what: "OpenAI's GPT models through the Codex command-line tool, locked down: read-only, no tools, no web, an empty folder. GPT Luna is fast and plain; GPT Sol was slower in our tests.",
      need: "Codex installed (npm install -g @openai/codex) and logged in (run `codex` once).",
      cost: "Counts against your ChatGPT plan, not paid per call.",
      privacy: PRIVACY + " It goes to OpenAI.",
    },
  },
  openai_compat: {
    label: "OpenAI-compatible server",
    short: "OpenAI, OpenRouter, LM Studio, llama.cpp server, vLLM: any server that speaks the OpenAI chat API.",
    cost: "paid",
    help: {
      what: "Any server with an OpenAI-style /chat/completions endpoint and JSON-schema answers. Examples: OpenAI (https://api.openai.com/v1), OpenRouter (https://openrouter.ai/api/v1), LM Studio (http://127.0.0.1:1234/v1), llama.cpp server (http://127.0.0.1:8080/v1), vLLM (http://127.0.0.1:8000/v1).",
      need: "The server's base address, a model name it knows, and an API key if it wants one (OpenAI and OpenRouter do; local servers usually not). Small local models may miss the 20-second limit or the answer format; then the game uses its hand-written lines.",
      cost: "OpenAI and OpenRouter charge per call: set a spending limit there. A server on your own PC is free but needs a strong graphics card.",
      privacy: PRIVACY + " It goes to whoever runs the server: nobody else if it runs on this PC.",
    },
  },
  ollama: {
    label: "Ollama (on this PC)",
    short: "A model you run yourself with Ollama. Free, private, slower.",
    cost: "local",
    help: {
      what: "Ollama runs open models on your own PC. Nothing leaves the machine.",
      need: "Ollama installed and running, and a model pulled (for example `ollama pull qwen3:8b`). Type the model's name below. The first call after a start loads the model and may miss the 20-second limit; press Test twice.",
      cost: "Free. Needs a good graphics card; on a weak PC many answers come too late and the game uses its hand-written lines.",
      privacy: "Nothing leaves this PC. " + PRIVACY,
    },
  },
  none: {
    label: "No AI (hand-written)",
    short: "No model at all for this: the game's own hand-written lines.",
    cost: "none",
    help: {
      what: "This kind of work uses the game's hand-written lines, jobs and events. Nothing is sent anywhere.",
      need: "Nothing.",
      cost: "Free.",
      privacy: "Nothing is sent.",
    },
  },
};

const KIND_TEXT: Record<KindId, { label: string; what: string; recommended: string }> = {
  talk: {
    label: "Conversations",
    what: "What people say to Jef: townspeople, named people, the police, haggling, the confessional, clerks, the landlady, hired hands, dice players.",
    recommended: "Claude Opus 5.5",
  },
  director: {
    label: "The director and events",
    what: "The director who plans the town's events each hour, strangers who arrive, Jef's dreams, and the story of the week at its end.",
    recommended: "Claude Opus 5.5; dreams GPT Luna",
  },
  jobs: {
    label: "Jobs and twists",
    what: "The job board, the night's work, how a job turns out, and jobs that go wrong.",
    recommended: "Claude Opus 5.5",
  },
  press: {
    label: "Newspaper, letters, posters",
    what: "The morning paper, wall posters, letters for Jef and replies to his, lost diaries.",
    recommended: "GPT Luna for the paper and posters; Claude Opus 5.5 for letters and diaries",
  },
  ballads: {
    label: "Ballads, sermons and plays",
    what: "The street singer's ballad, the Sunday sermon, the puppet play at the Poesje.",
    recommended: "Claude Opus 5.5",
  },
  town: {
    label: "Townspeople's routines",
    what: "Errands people run for Jef, talk between townspeople in the street, family news, tavern gossip, rumours, the dawn hiring, new people's characters.",
    recommended: "GPT Luna for street talk, family news and rumours; Claude Opus 5.5 for the rest",
  },
};

export const GUIDE = {
  title: "How the AI works in Scheldemist",
  paragraphs: [
    "The game engine owns every number: money, needs, trust, time. The AI only writes: what people say, the jobs on the board, the paper, the events. Whatever it writes is checked and clamped before the game uses it.",
    "Pick one AI as the default, then change single kinds of work if you like: a cheap fast model for the paper and gossip, the best one for conversations. \"Same as default\" follows the default.",
    "Press Test to check a choice: one short greeting, at most 20 seconds. If a call fails in play, the game uses its hand-written line and goes on; it never waits for the AI.",
    "A game day makes at most 120 AI calls. Paid services charge per call: set a spending limit with them.",
    "No AI at all? Choose \"Walk around (no AI)\": the town lives by its own routines, people go about their trades, and talk, jobs and events use the game's hand-written lines. Good for exploring the city.",
  ],
};

export const WALK = {
  label: "Walk around (no AI)",
  text: "No AI is used. The town goes about its business by its own routines; conversations, jobs, the paper and events use the game's hand-written lines. Nothing is sent anywhere.",
};

export function options() {
  return {
    kinds: KIND_IDS.map((id) => ({ id, ...KIND_TEXT[id] })),
    providers: PROVIDER_IDS.map((id) => {
      const t = PROVIDER_TEXT[id];
      const models = KNOWN_MODELS[id] ?? [];
      return {
        id,
        label: t.label,
        short: t.short,
        needs: (id === "anthropic_api" ? ["apiKey"] : id === "openai_compat" ? ["baseUrl", "apiKey"] : id === "ollama" ? ["baseUrl"] : []) as ("apiKey" | "baseUrl")[],
        models,
        freeModel: id === "openai_compat" || id === "ollama" || id === "anthropic_api",
        modelHint: id === "openai_compat" ? "for example gpt-5-mini, or the name LM Studio shows" : id === "ollama" ? "for example qwen3:8b" : id === "anthropic_api" ? "for example claude-opus-5-5" : null,
        defaultModel: DEFAULT_MODEL[id] ?? null,
        effort: id === "claude_local" || id === "anthropic_api" || id === "codex_cli" || id === "openai_compat",
        cost: t.cost,
        help: t.help,
        typedLines: CLAUDE_PROVIDERS.has(id) ? "What you type to people goes to this AI (Claude), fenced as a line of dialogue." : id === "recommended" ? "The mix sends what you type to Claude Opus 5.5 only." : id === "none" ? "What you type gets the hand-written answers." : TYPED_HERE,
      };
    }),
    efforts: [...EFFORTS],
    guide: GUIDE,
    walk: WALK,
    typedLines: TYPED_LINES_OPTION,
    callsPerDay: CALLS_PER_DAY_OPTION,
  };
}

/** A plain label for a choice: "Claude Opus 5.5 (your Claude login)". */
export function choiceLabel(c: Choice): string {
  const t = PROVIDER_TEXT[c.provider];
  if (!c.model) return t.label;
  const known = (KNOWN_MODELS[c.provider] ?? []).find((m) => m.id === c.model);
  const name = known ? known.label.replace(/ \(.*\)$/, "") : c.model;
  return `${name}${c.effort ? `, ${c.effort} effort` : ""} (${t.label})`;
}

/** What the menu gets: the settings without the keys, what runs per kind, the options and help. */
export function view(available: { claude_local: boolean | null; codex_cli: boolean }) {
  const kinds = {} as Record<KindId, "default" | Choice>;
  const effective = {} as Record<KindId, Choice & { label: string }>;
  for (const k of KIND_IDS) {
    kinds[k] = current.kinds[k] ?? "default";
    const c = effectiveChoice(k);
    effective[k] = { ...c, label: current.mode === "walk" ? WALK.label : choiceLabel(c) };
  }
  const offKinds = KIND_IDS.filter((k) => effectiveChoice(k).provider === "none").map((k) => KIND_TEXT[k].label);
  const status =
    current.mode === "walk"
      ? { title: "Walk-around mode", text: WALK.text }
      : offKinds.length === KIND_IDS.length
        ? { title: "No AI chosen", text: "Every kind of work is set to the hand-written lines." }
        : { title: "AI on", text: `Default: ${choiceLabel(current.default)}.${offKinds.length ? ` Hand-written: ${offKinds.join(", ")}.` : ""}` };
  return {
    mode: current.mode,
    typedLines: current.typedLines,
    callsPerDay: current.callsPerDay,
    status,
    default: current.default,
    kinds,
    effective,
    connections: {
      anthropic_api: { apiKey: lastFour(current.connections.anthropic_api.apiKey) },
      openai_compat: { baseUrl: current.connections.openai_compat.baseUrl, apiKey: lastFour(current.connections.openai_compat.apiKey) },
      ollama: { baseUrl: current.connections.ollama.baseUrl },
    },
    available,
    saved,
    options: options(),
  };
}

