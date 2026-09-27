import { spawn } from "node:child_process";
import fs from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AI_CWD, CLAUDE, MODELS, ROUTE_DEFAULT, type Provider } from "../config.ts";
import type { DB } from "../db.ts";
import { codexRunner, killTree } from "./codex.ts";
import { anthropicRunner, ollamaRunner, openaiRunner } from "./http.ts";
import { resolveRoute, type Route } from "./router.ts";
import { scrubKeys } from "./setup.ts";
import { callBegan, callEnded, holdResult, waitToStart } from "../save/gate.ts";
import { playerIn, playerOut } from "../player/prompt.ts";
import { pid } from "../player/current.ts";
import { budgetStop, callSlot, isPlayerHook } from "./budget.ts";

// One way to call a model: no tools, our own system prompt, JSON schema output. docs/02 and docs/03.
// The router (router.ts, MODEL_ROUTE in config.ts) picks the model per hook: Claude through the
// local login and the Agent SDK, or GPT Sol through the Codex CLI (codex.ts). The AI setup
// (setup.ts, docs/ai-setup.md) can pick another provider per kind of work (an Anthropic API key, an
// OpenAI-compatible server, Ollama: http.ts), or no model at all: walk-around mode. Every call is
// logged in ai_call with its provider and model.

export interface CallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  ms: number;
}

export interface CallRequest<S extends z.ZodType> {
  hook: string;
  system: string;
  prompt: string;
  schema: S;
  /** Only tests shorten this. */
  timeoutMs?: number;
}

/** Test seam: replace the model with a stub. `model` and `effort` come from the router. */
export type Runner = (req: { system: string; prompt: string; jsonSchema: Record<string, unknown>; signal: AbortController; model?: string; effort?: string }) =>
  Promise<{ output: unknown; usage?: { in?: number; out?: number; cacheRead?: number } }>;

/** The runner per provider; tests swap them (setProviderRunner) to check the routing without a live call. */
// Under the tests there is no live model: a call without a stub fails at once and takes its
// fallback. (Background calls, like a hired hand's lines, used to reach the real Claude.)
const offline: Runner = async () => {
  throw new Error("no live model under the tests");
};
const LIVE: Record<Provider, Runner> = {
  claude: (x) => sdkRunner(x),
  codex: (x) => codexRunner(x),
  anthropic: (x) => anthropicRunner(x),
  openai: (x) => openaiRunner(x),
  ollama: (x) => ollamaRunner(x),
};
const liveRunner = (p: Provider): Runner => (process.env.VITEST ? offline : LIVE[p]);
const providers: Record<Provider, Runner> = {
  claude: liveRunner("claude"),
  codex: liveRunner("codex"),
  anthropic: liveRunner("anthropic"),
  openai: liveRunner("openai"),
  ollama: liveRunner("ollama"),
};
export function setProviderRunner(p: Provider, r: Runner | null): void {
  providers[p] = r ?? liveRunner(p);
}

const inFlight = new Map<string, Promise<void>>();

/** The error of a call that was never made: walk-around mode, or "no AI" for the hook's kind. */
export const NO_AI = "no AI (walk-around mode or hand-written for this kind)";

export async function callClaude<S extends z.ZodType>(
  db: DB,
  req: CallRequest<S>,
  runner?: Runner,
): Promise<CallResult<z.infer<S>>> {
  // AI setup (docs/ai-setup.md): no model for this hook, so no call at all. The caller has its
  // fallback at once: no wait for the pause gate, no row in the day's budget, no runner.
  if (resolveRoute(req.hook) === null) return { ok: false, error: NO_AI, ms: 0 };
  // M7 save and pause (save/gate.ts): no call starts while the game is paused, saving or loading;
  // it waits, and its limit only begins once it may start. A call in flight counts until its caller
  // has the answer; while paused the answer waits here, and the caller applies it after the unpause.
  await waitToStart();
  callBegan();
  try {
    // M7 character: the player's name, words and look go in; the name comes back as "Jef" (player/prompt.ts)
    const r = playerOut(db, await callModel(db, playerIn(db, req), runner));
    await holdResult();
    return r;
  } finally {
    callEnded();
  }
}

async function callModel<S extends z.ZodType>(db: DB, req: CallRequest<S>, runner?: Runner): Promise<CallResult<z.infer<S>>> {
  // The limit is hard (CLAUDE.md, QA 2026-09-24): it counts from the moment the caller asks,
  // waiting for the hook's last call included, and no caller may set it higher than 20 s.
  const started = Date.now();
  const timeoutMs = Math.min(req.timeoutMs ?? CLAUDE.timeoutMs, CLAUDE.timeoutMs);
  let deadline = started + timeoutMs;

  // One call in flight per hook, in the order asked: each caller waits for the one before it
  // (never past its own limit). The chain is set before any await, so two waiting callers
  // can never start together. M8d: a player's own hooks (his talk) chain per player, so two
  // players may talk at once; played alone every call is the host's, as before.
  const key = isPlayerHook(req.hook) ? `${req.hook}:${pid()}` : req.hook;
  const before = inFlight.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = before.then(() => mine);
  inFlight.set(key, tail);
  let slot: (() => void) | null = null;
  try {
    const free = await beforeDeadline(before.then(() => true), deadline);
    if (free === TIMED_OUT) return { ok: false, error: `timeout after ${timeoutMs} ms (the last ${req.hook} call was still running)`, ms: Date.now() - started };
    // M8d, the queue (ai/budget.ts): played together at most three calls run at once, talk first. The wait for a
    // place is bounded on its own and does not eat the call's 20 s: the limit counts from the start of the call.
    const queued = Date.now();
    slot = await callSlot(req.hook);
    if (!slot) return { ok: false, error: `no free place for a model call (${req.hook} waited in the queue)`, ms: Date.now() - started };
    deadline += Date.now() - queued;
    return await run(db, req, runner, started, deadline, timeoutMs);
  } finally {
    slot?.();
    release();
    if (inFlight.get(key) === tail) inFlight.delete(key);
  }
}

const TIMED_OUT = Symbol("timed out");

/**
 * Wait for p, but never past the deadline: at the deadline the answer is TIMED_OUT at once,
 * whatever p does later. A late rejection of p is swallowed.
 */
function beforeDeadline<T>(p: Promise<T>, deadline: number, onTimeout?: () => void): Promise<T | typeof TIMED_OUT> {
  p.catch(() => {});
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(TIMED_OUT);
      onTimeout?.();
    }, Math.max(0, deadline - Date.now()));
    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function run<S extends z.ZodType>(
  db: DB,
  req: CallRequest<S>,
  stub: Runner | undefined,
  started: number,
  deadline: number,
  timeoutMs: number,
): Promise<CallResult<z.infer<S>>> {
  const { day, hour } = db.prepare("SELECT day, hour FROM player WHERE id = 1").get() as { day: number; hour: number };

  // the claude CLI rejects the draft 2020-12 "$schema" tag, so drop it
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema) as Record<string, unknown>;
  let lastError = "no attempt";
  // the model for this hook; a stub runner (tests) stands in for whatever it picks. Resolved again
  // here: the settings may have turned the AI off while this call waited for the pause.
  const picked = resolveRoute(req.hook);
  if (picked === null) return { ok: false, error: NO_AI, ms: Date.now() - started };
  let route: Route = picked;

  // schema failure gets one retry, if time is left (docs/03 guardrails)
  for (let attempt = 0; attempt < 2 && Date.now() < deadline - Math.min(2_000, timeoutMs / 10); attempt++) {
    // Check the budget and book the attempt in one step, before any await: calls from other
    // hooks that start in the same moment then see this one, and the retry is counted too.
    const booked = book(db, day, hour, req.hook, route);
    if (typeof booked !== "number") {
      if (attempt === 0) return { ok: false, error: booked === "share" ? `this player's share of calls for day ${day} used up` : `call budget for day ${day} used up`, ms: 0 };
      break;
    }
    const t0 = Date.now();
    const abort = new AbortController();
    let usage: { in?: number; out?: number; cacheRead?: number } | undefined;
    try {
      const runner = stub ?? providers[route.provider];
      // Hard limit: at the deadline the caller has its timeout at once, the process is killed
      // (the abort), and an answer that comes later is thrown away.
      const res = await beforeDeadline(
        Promise.resolve().then(() => runner({ system: req.system, prompt: req.prompt, jsonSchema, signal: abort, model: route.model, effort: route.effort })),
        deadline,
        () => abort.abort(),
      );
      if (res === TIMED_OUT || Date.now() > deadline) {
        if (!abort.signal.aborted) abort.abort();
        throw new Error("late");
      }
      usage = res.usage;
      const parsed = req.schema.safeParse(res.output);
      if (parsed.success) {
        logCall(db, booked, route, Date.now() - t0, usage, true, null);
        return { ok: true, data: parsed.data, ms: Date.now() - started };
      }
      lastError = "schema: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ");
    } catch (e) {
      lastError = abort.signal.aborted ? `timeout after ${timeoutMs} ms` : errText(e);
    }
    logCall(db, booked, route, Date.now() - t0, usage, false, lastError);
    if (abort.signal.aborted) break;
    // GPT Sol broke (not there, logged out, used a tool): the retry goes to Claude. Only in the
    // recommended mix: a provider the player chose keeps its calls (it may have no Claude at all).
    if (route.provider === "codex" && !route.chosen && !lastError.startsWith("schema:")) route = { key: ROUTE_DEFAULT, ...MODELS[ROUTE_DEFAULT], overruled: "no_codex" };
  }
  return { ok: false, error: lastError, ms: Date.now() - started };
}

/**
 * Books one attempt if the day's budget allows it: the row id, or why not ("day": the day's calls are used up;
 * "share": M8d, played together, this player's own share of the day is).
 */
function book(db: DB, day: number, hour: number, hook: string, route: Route): number | "day" | "share" {
  const stop = budgetStop(db, day, hook);
  if (stop) return stop;
  const r = db
    .prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok, error, player_id) VALUES (?, ?, ?, ?, ?, 0, 0, 'running', ?)")
    .run(day, hour, hook, route.provider, route.model, pid());
  return Number(r.lastInsertRowid);
}

/** At server start no call can still run: a row left 'running' was cut off by a restart. It keeps its place in the day's budget. */
export function closeStaleCalls(db: DB): number {
  return db.prepare("UPDATE ai_call SET error = 'stopped by server restart' WHERE error = 'running'").run().changes;
}

function logCall(
  db: DB,
  id: number,
  route: Route,
  ms: number,
  usage: { in?: number; out?: number; cacheRead?: number } | undefined,
  ok: boolean,
  error: string | null,
): void {
  db.prepare(
    `UPDATE ai_call SET provider = ?, model = ?, ms = ?, in_tokens = ?, out_tokens = ?, cache_read = ?, ok = ?, error = ? WHERE id = ?`,
  ).run(route.provider, route.model, ms, usage?.in ?? null, usage?.out ?? null, usage?.cacheRead ?? null, ok ? 1 : 0, error, id);
}

function errText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  // never a key in the log or on screen (an HTTP provider may echo it back in an error)
  return scrubKeys(s).slice(0, 500);
}

/**
 * The AI setup's test button (ai/routes.ts): one call on a route, schema-checked, within the limit,
 * aborted at it. Not a game call: it does not wait for the pause (the menu pauses the game), books no
 * row in the day's budget, and takes no retry.
 */
export async function testCall<S extends z.ZodType>(route: Route, req: { system: string; prompt: string; schema: S }, timeoutMs = CLAUDE.timeoutMs): Promise<CallResult<z.infer<S>>> {
  const started = Date.now();
  const limit = Math.min(timeoutMs, CLAUDE.timeoutMs);
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema) as Record<string, unknown>;
  const abort = new AbortController();
  try {
    const res = await beforeDeadline(
      Promise.resolve().then(() => providers[route.provider]({ system: req.system, prompt: req.prompt, jsonSchema, signal: abort, model: route.model, effort: route.effort })),
      started + limit,
      () => abort.abort(),
    );
    if (res === TIMED_OUT) return { ok: false, error: `No answer within ${Math.round(limit / 1000)} seconds.`, ms: Date.now() - started };
    const parsed = req.schema.safeParse(res.output);
    if (!parsed.success) return { ok: false, error: "The answer did not fit the game's format: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ").slice(0, 200), ms: Date.now() - started };
    return { ok: true, data: parsed.data, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: abort.signal.aborted ? `No answer within ${Math.round(limit / 1000)} seconds.` : errText(e), ms: Date.now() - started };
  }
}

/** The real call: local claude binary via the Agent SDK. */
export const sdkRunner: Runner = async ({ system, prompt, jsonSchema, signal, model, effort }) => {
  fs.mkdirSync(AI_CWD, { recursive: true });
  const q = query({
    prompt,
    options: {
      model: model ?? CLAUDE.model,
      // Haiku 4.5 takes no effort setting: its route leaves effort out, and thinking goes off
      // (the CLI's default thinking budget made Haiku take 40-60 s a call, M6-models.md)
      ...(model && !effort ? { thinking: { type: "disabled" as const } } : { effort: (effort ?? CLAUDE.effort) as typeof CLAUDE.effort }),
      tools: [], // no hands: no file, shell or web tool
      mcpServers: {},
      strictMcpConfig: true,
      systemPrompt: system, // replaces the Claude Code prompt
      outputFormat: { type: "json_schema", schema: jsonSchema },
      maxTurns: 3, // room for the CLI to correct its own JSON against the schema
      persistSession: false, // no session files on disk
      settingSources: [], // ignore user and project settings and CLAUDE.md
      cwd: AI_CWD, // an empty folder, no project files near the model
      abortController: signal,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "scheldemist/0.1" },
      // The SDK's own abort closes stdin and waits a grace of a few seconds before it kills; a
      // timed-out call must not linger, so our abort kills the process tree at once.
      spawnClaudeCodeProcess: ({ command, args, cwd, env, signal: sdkSignal }) => {
        const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
        // only a live child: after exit its process id may already belong to another program
        const kill = () => {
          if (child.exitCode === null && child.signalCode === null) killTree(child.pid);
        };
        if (signal.signal.aborted) kill();
        signal.signal.addEventListener("abort", kill, { once: true });
        sdkSignal?.addEventListener("abort", kill, { once: true });
        child.once("exit", () => {
          signal.signal.removeEventListener("abort", kill);
          sdkSignal?.removeEventListener("abort", kill);
        });
        return child;
      },
    },
  });
  for await (const msg of q) {
    if (msg.type !== "result") continue;
    if (msg.subtype !== "success" || msg.is_error) {
      const errs = "errors" in msg ? msg.errors.join("; ") : "";
      throw new Error(`claude result ${msg.subtype}${errs ? ": " + errs : ""}`);
    }
    return {
      output: msg.structured_output,
      usage: {
        in: msg.usage.input_tokens,
        out: msg.usage.output_tokens,
        cacheRead: msg.usage.cache_read_input_tokens,
      },
    };
  }
  throw new Error("claude gave no result");
};
