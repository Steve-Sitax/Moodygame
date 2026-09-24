import { spawn } from "node:child_process";
import fs from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AI_CWD, CALLS_PER_DAY, CLAUDE, MODELS, ROUTE_DEFAULT, type Provider } from "../config.ts";
import type { DB } from "../db.ts";
import { codexRunner, killTree } from "./codex.ts";
import { routeFor, type Route } from "./router.ts";

// One way to call a model: no tools, our own system prompt, JSON schema output. docs/02 and docs/03.
// The router (router.ts, MODEL_ROUTE in config.ts) picks the model per hook: Claude through the
// local login and the Agent SDK, or GPT Sol through the Codex CLI (codex.ts). Every call is
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
const providers: Record<Provider, Runner> = { claude: (r) => sdkRunner(r), codex: (r) => codexRunner(r) };
export function setProviderRunner(p: Provider, r: Runner | null): void {
  providers[p] = r ?? (p === "claude" ? (x) => sdkRunner(x) : (x) => codexRunner(x));
}

const inFlight = new Map<string, Promise<unknown>>();

export async function callClaude<S extends z.ZodType>(
  db: DB,
  req: CallRequest<S>,
  runner?: Runner,
): Promise<CallResult<z.infer<S>>> {
  // The limit is hard (CLAUDE.md, QA 2026-09-24): it counts from the moment the caller asks,
  // waiting for the hook's last call included, and no caller may set it higher than 20 s.
  const started = Date.now();
  const timeoutMs = Math.min(req.timeoutMs ?? CLAUDE.timeoutMs, CLAUDE.timeoutMs);
  const deadline = started + timeoutMs;

  // one call in flight per hook: a second caller waits for the first, but never past its own limit
  const busy = inFlight.get(req.hook);
  if (busy) {
    const free = await beforeDeadline(busy.then(() => true, () => true), deadline);
    if (free === TIMED_OUT) return { ok: false, error: `timeout after ${timeoutMs} ms (the last ${req.hook} call was still running)`, ms: Date.now() - started };
  }

  const p = run(db, req, runner, started, deadline, timeoutMs);
  inFlight.set(req.hook, p);
  try {
    return await p;
  } finally {
    if (inFlight.get(req.hook) === p) inFlight.delete(req.hook);
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
  const used = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  if (used >= CALLS_PER_DAY) {
    return { ok: false, error: `call budget for day ${day} used up`, ms: 0 };
  }

  // the claude CLI rejects the draft 2020-12 "$schema" tag, so drop it
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema) as Record<string, unknown>;
  let lastError = "no attempt";
  // the model for this hook; a stub runner (tests) stands in for whatever it picks
  let route: Route = routeFor(req.hook);

  // schema failure gets one retry, if time is left (docs/03 guardrails)
  for (let attempt = 0; attempt < 2 && Date.now() < deadline - Math.min(2_000, timeoutMs / 10); attempt++) {
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
        logCall(db, day, hour, req.hook, route, Date.now() - t0, usage, true, null);
        return { ok: true, data: parsed.data, ms: Date.now() - started };
      }
      lastError = "schema: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ");
    } catch (e) {
      lastError = abort.signal.aborted ? `timeout after ${timeoutMs} ms` : errText(e);
    }
    logCall(db, day, hour, req.hook, route, Date.now() - t0, usage, false, lastError);
    if (abort.signal.aborted) break;
    // GPT Sol broke (not there, logged out, used a tool): the retry goes to Claude
    if (route.provider === "codex" && !lastError.startsWith("schema:")) route = { key: ROUTE_DEFAULT, ...MODELS[ROUTE_DEFAULT], overruled: "no_codex" };
  }
  return { ok: false, error: lastError, ms: Date.now() - started };
}

function logCall(
  db: DB,
  day: number,
  hour: number,
  hook: string,
  route: Route,
  ms: number,
  usage: { in?: number; out?: number; cacheRead?: number } | undefined,
  ok: boolean,
  error: string | null,
): void {
  db.prepare(
    `INSERT INTO ai_call (day, hour, hook, provider, model, ms, in_tokens, out_tokens, cache_read, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(day, hour, hook, route.provider, route.model, ms, usage?.in ?? null, usage?.out ?? null, usage?.cacheRead ?? null, ok ? 1 : 0, error);
}

function errText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.slice(0, 500);
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
        const kill = () => killTree(child.pid);
        if (signal.signal.aborted) kill();
        signal.signal.addEventListener("abort", kill, { once: true });
        sdkSignal?.addEventListener("abort", kill, { once: true });
        child.once("exit", () => signal.signal.removeEventListener("abort", kill));
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
