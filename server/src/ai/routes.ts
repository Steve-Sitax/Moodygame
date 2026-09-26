import type { Context, Hono } from "hono";
import { z } from "zod";
import type { DB } from "../db.ts";
import { plainEnglish } from "../text.ts";
import { mpHostRule } from "../mp/auth.ts"; // M8a
import { testCall } from "./claude.ts";
import { codexBin } from "./codex.ts";
import { routeOfChoice, type Route } from "./router.ts";
import { aiSetup, applyPatch, ChoiceSchema, choiceLabel, effectiveChoice, KIND_HOOKS, KIND_IDS, normalChoice, view, type Choice, type KindId, type ProviderId } from "./setup.ts";

// The AI setup's API (docs/ai-setup.md): the settings for the menu, changing them, and the test
// button. The shapes are written in docs/ai-setup.md and stay stable.

/** The test: a townsperson's one-line greeting. Game text only; nothing about the player or the PC. */
const TEST_SYSTEM =
  "You write lines for townspeople in a game set in Antwerp, in the autumn of 1873. Plain English, in the voice of the time, no modern words. Answer only with the JSON asked for.";
const TEST_PROMPT = "A dock porter on the Rijnkaai greets a stranger on a grey morning, the fog still on the Scheldt. Write his greeting: one short line, at most 20 words.";
const TestSchema = z.object({ line: z.string().min(1).max(300) });

const TestBody = z.union([
  z.strictObject({ kind: z.enum(KIND_IDS) }),
  z.strictObject({ choice: ChoiceSchema }),
  z.strictObject({ all: z.literal(true) }),
]);

interface TestResult {
  target: KindId | "choice";
  label: string;
  provider: ProviderId;
  model: string | null;
  ok: boolean;
  ms: number;
  line?: string;
  error?: string;
  note?: string;
}

/** A hook name in no kind and not a typed-lines hook: a choice is tested as itself. */
const TEST_HOOK = "ai_setup_test";

/** The routes a choice runs on for one kind (the recommended mix may use two models for it), each once. */
function routesFor(kind: KindId | null, c: Choice): Route[] {
  const hooks = c.provider !== "recommended" ? [TEST_HOOK] : kind ? KIND_HOOKS[kind] : KIND_IDS.flatMap((k) => KIND_HOOKS[k]);
  const seen = new Map<string, Route>();
  for (const h of hooks) {
    const r = routeOfChoice(h, c);
    if (r) seen.set(`${r.provider}|${r.model}|${r.effort ?? ""}`, r);
  }
  return [...seen.values()];
}

const PROVIDER_OF: Record<string, ProviderId> = { claude: "claude_local", anthropic: "anthropic_api", codex: "codex_cli", openai: "openai_compat", ollama: "ollama" };

let testing = false;

/**
 * Only the host may change the AI setup or spend calls on a test (Steve, 2026-09-26): for now a
 * request from this machine (127.0.0.1 or ::1 on the socket). Once multiplayer exists, a player
 * marked admin too (docs/ai-setup.md). A proxy that says it forwards someone else is not the host.
 * Behind the vite proxy the socket is the proxy's (this machine); vite serves this machine only.
 */
const LOCAL_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export function fromHost(c: Context): boolean {
  const mp = mpHostRule(c); // M8a multiplayer: a guest's token is never the host; a player the host marked admin is
  if (mp !== null) return mp;
  const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  if (!addr || !LOCAL_ADDRESSES.has(addr)) return false;
  const fwd = c.req.header("x-forwarded-for") ?? c.req.header("forwarded");
  if (fwd && fwd.split(",").some((a) => !LOCAL_ADDRESSES.has(a.trim().replace(/^for=/i, "").replace(/^"?\[?|\]?"?$/g, "")))) return false;
  return true;
}
const HOST_ONLY = "Only the host may change the AI settings (a request from this computer).";

export async function runTests(targets: { target: KindId | "choice"; label: string; choice: Choice }[]): Promise<TestResult[]> {
  // the same model is asked once, and all at once: "test all" takes 20 s at most
  const calls = new Map<string, Promise<{ ok: boolean; ms: number; line?: string; error?: string }>>();
  const plan: { t: (typeof targets)[number]; route: Route | null }[] = [];
  for (const t of targets) {
    const rs = routesFor(t.target === "choice" ? null : t.target, t.choice);
    if (rs.length === 0) plan.push({ t, route: null });
    for (const r of rs) {
      plan.push({ t, route: r });
      const key = `${r.provider}|${r.model}|${r.effort ?? ""}`;
      if (!calls.has(key))
        calls.set(
          key,
          testCall(r, { system: TEST_SYSTEM, prompt: TEST_PROMPT, schema: TestSchema }).then((res) => ({ ok: res.ok, ms: res.ms, line: res.data ? plainEnglish(res.data.line).slice(0, 200) : undefined, error: res.error })),
        );
    }
  }
  const out: TestResult[] = [];
  for (const { t, route } of plan) {
    if (!route) {
      out.push({ target: t.target, label: t.label, provider: t.choice.provider, model: null, ok: true, ms: 0, note: "No AI: the game uses its hand-written lines." });
      continue;
    }
    const r = await calls.get(`${route.provider}|${route.model}|${route.effort ?? ""}`)!;
    out.push({
      target: t.target,
      label: t.label,
      provider: PROVIDER_OF[route.provider] ?? t.choice.provider,
      model: route.model,
      ok: r.ok,
      ms: r.ms,
      ...(r.line ? { line: r.line } : {}),
      ...(r.error ? { error: r.error } : {}),
      ...(route.overruled === "no_codex" ? { note: "Codex was not found on this PC: this runs on Claude instead." } : route.overruled === "all_claude" ? { note: "The all-Claude switch is on: this runs on Claude." } : {}),
    });
  }
  return out;
}

export function mountAiSetup(app: Hono, _o: { db: DB }): void {
  const available = () => ({ claude_local: null, codex_cli: codexBin() !== null });

  app.get("/api/ai/config", (c) => c.json(view(available())));

  app.put("/api/ai/config", async (c) => {
    if (!fromHost(c)) return c.json({ error: HOST_ONLY, issues: [] }, 403);
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: "send the settings as JSON", issues: [] }, 400);
    const r = applyPatch(body);
    if (!r.ok) return c.json({ error: r.error, issues: r.issues }, 400);
    const s = aiSetup();
    console.log(`[ai] settings saved: ${s.mode === "walk" ? "walk-around mode (no AI)" : `default ${choiceLabel(s.default)}`}; ${s.callsPerDay === 0 ? "no daily call limit" : `${s.callsPerDay} calls a day`}`);
    return c.json(view(available()));
  });

  app.post("/api/ai/test", async (c) => {
    if (!fromHost(c)) return c.json({ error: HOST_ONLY }, 403);
    const parsed = TestBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'send { "kind": ... }, { "choice": ... } or { "all": true }' }, 400);
    if (testing) return c.json({ error: "a test is already running" }, 409);
    const b = parsed.data;
    let targets: { target: KindId | "choice"; label: string; choice: Choice }[];
    if ("choice" in b) {
      const n = normalChoice(b.choice);
      if ("error" in n) return c.json({ error: n.error }, 400);
      targets = [{ target: "choice", label: "Your choice", choice: n.choice }];
    } else {
      const kinds = "kind" in b ? [b.kind] : [...KIND_IDS];
      const opts = view(available()).options.kinds;
      targets = kinds.map((k) => ({ target: k, label: opts.find((o) => o.id === k)!.label, choice: effectiveChoice(k) }));
    }
    testing = true;
    try {
      const results = await runTests(targets);
      console.log(`[ai] test: ${results.map((r) => `${r.label} ${r.ok ? "ok" : "failed"}${r.model ? " (" + r.model + ")" : ""}`).join(", ")}`);
      return c.json({ results });
    } finally {
      testing = false;
    }
  });
}
