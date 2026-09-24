import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { openDb } from "../src/db.ts";
import { callClaude, setProviderRunner, type Runner } from "../src/ai/claude.ts";
import { codexRunner, setCodexBin, strictSchema, stripNulls } from "../src/ai/codex.ts";
import { routeFor } from "../src/ai/router.ts";
import { MODEL_ROUTE, MODELS, PLAYER_TEXT_HOOKS } from "../src/config.ts";

// M6 models: the router picks a model per hook (MODEL_ROUTE); GPT Sol never gets the player's
// typed words, the "all Claude" switch and a machine without codex send everything to Claude,
// and every ai_call row names its provider and model. Stubs only, no live call.

const Schema = z.object({ line: z.string().min(1), extra: z.string().optional() });
type Seen = { provider: string; model?: string; effort?: string };

function stub(provider: string, seen: Seen[], out: unknown | (() => unknown)): Runner {
  return async (r) => {
    seen.push({ provider, model: r.model, effort: r.effort });
    const v = typeof out === "function" ? (out as () => unknown)() : out;
    if (v instanceof Error) throw v;
    return { output: v };
  };
}
const rows = (db: ReturnType<typeof openDb>) => db.prepare("SELECT hook, provider, model, ok FROM ai_call ORDER BY id").all() as Array<{ hook: string; provider: string; model: string; ok: number }>;

afterEach(() => {
  setProviderRunner("claude", null);
  setProviderRunner("codex", null);
  setCodexBin(undefined);
  for (const k of Object.keys(MODEL_ROUTE)) if (k.startsWith("test_")) delete MODEL_ROUTE[k];
});

describe("routeFor", () => {
  const table = { cheap: "sol", mid: "sonnet", small: "haiku", free_reply: "sol" } as const;
  it("takes the table's model, and the default for a hook not in it", () => {
    expect(routeFor("nothing_here", { table })).toMatchObject({ key: "opus", provider: "claude", model: MODELS.opus.model, effort: "medium" });
    expect(routeFor("mid", { table })).toMatchObject({ key: "sonnet", provider: "claude", model: "claude-sonnet-5" });
    expect(routeFor("cheap", { table, allClaude: false, codexOk: true })).toMatchObject({ key: "sol", provider: "codex", model: "gpt-6-sol", effort: "medium" });
  });
  it("gives Haiku no effort setting", () => {
    expect(routeFor("small", { table }).effort).toBeUndefined();
  });
  it("the all-Claude switch sends GPT Sol's hooks to Claude, and leaves the Claude ones", () => {
    expect(routeFor("cheap", { table, allClaude: true, codexOk: true })).toMatchObject({ provider: "claude", model: MODELS.opus.model, overruled: "all_claude" });
    expect(routeFor("mid", { table, allClaude: true })).toMatchObject({ key: "sonnet" });
  });
  it("never sends a hook with the player's own words to GPT Sol unless allowed", () => {
    expect(PLAYER_TEXT_HOOKS.has("free_reply")).toBe(true);
    expect(routeFor("free_reply", { table, allClaude: false, codexOk: true })).toMatchObject({ provider: "claude", overruled: "player_text" });
    expect(routeFor("free_reply", { table, allClaude: false, codexOk: true, codexPlayerText: true })).toMatchObject({ provider: "codex" });
  });
  it("a machine without codex gets Claude", () => {
    expect(routeFor("cheap", { table, allClaude: false, codexOk: false })).toMatchObject({ provider: "claude", overruled: "no_codex" });
  });
  it("the live table keeps every player-text hook on Claude", () => {
    for (const h of PLAYER_TEXT_HOOKS) expect(routeFor(h).provider).toBe("claude");
  });
});

describe("callClaude through the router", () => {
  it("runs a GPT Sol hook on the codex runner and logs provider and model", async () => {
    const db = openDb(":memory:");
    setCodexBin("codex-stub");
    MODEL_ROUTE.test_cheap = "sol";
    const seen: Seen[] = [];
    setProviderRunner("claude", stub("claude", seen, { line: "no" }));
    setProviderRunner("codex", stub("codex", seen, { line: "A fine grey morning." }));
    const res = await callClaude(db, { hook: "test_cheap", system: "s", prompt: "p", schema: Schema });
    expect(res).toMatchObject({ ok: true, data: { line: "A fine grey morning." } });
    expect(seen).toEqual([{ provider: "codex", model: "gpt-6-sol", effort: "medium" }]);
    expect(rows(db)).toEqual([{ hook: "test_cheap", provider: "codex", model: "gpt-6-sol", ok: 1 }]);
  });

  it("a hook not in the table goes to Opus 5.5 at medium effort", async () => {
    const db = openDb(":memory:");
    const seen: Seen[] = [];
    setProviderRunner("claude", stub("claude", seen, { line: "Aye." }));
    await callClaude(db, { hook: "test_unrouted", system: "s", prompt: "p", schema: Schema });
    expect(seen).toEqual([{ provider: "claude", model: "claude-opus-5-5", effort: "medium" }]);
    expect(rows(db)[0]).toMatchObject({ provider: "claude", model: "claude-opus-5-5" });
  });

  it("a Haiku hook reaches the Claude runner without an effort", async () => {
    const db = openDb(":memory:");
    MODEL_ROUTE.test_small = "haiku";
    const seen: Seen[] = [];
    setProviderRunner("claude", stub("claude", seen, { line: "Aye." }));
    await callClaude(db, { hook: "test_small", system: "s", prompt: "p", schema: Schema });
    expect(seen).toEqual([{ provider: "claude", model: "claude-haiku-4-5-20251001", effort: undefined }]);
  });

  it("when GPT Sol breaks, the retry goes to Claude", async () => {
    const db = openDb(":memory:");
    setCodexBin("codex-stub");
    MODEL_ROUTE.test_cheap = "sol";
    const seen: Seen[] = [];
    setProviderRunner("codex", stub("codex", seen, new Error("codex exit 1: not logged in")));
    setProviderRunner("claude", stub("claude", seen, { line: "Claude stepped in." }));
    const res = await callClaude(db, { hook: "test_cheap", system: "s", prompt: "p", schema: Schema });
    expect(res.data?.line).toBe("Claude stepped in.");
    expect(seen.map((s) => s.provider)).toEqual(["codex", "claude"]);
    expect(rows(db).map((r) => [r.provider, r.ok])).toEqual([["codex", 0], ["claude", 1]]);
  });

  it("a schema miss from GPT Sol is retried on GPT Sol, then the engine falls back", async () => {
    const db = openDb(":memory:");
    setCodexBin("codex-stub");
    MODEL_ROUTE.test_cheap = "sol";
    const seen: Seen[] = [];
    setProviderRunner("codex", stub("codex", seen, { wrong: 1 }));
    setProviderRunner("claude", stub("claude", seen, { line: "never" }));
    const res = await callClaude(db, { hook: "test_cheap", system: "s", prompt: "p", schema: Schema });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^schema:/);
    expect(seen.map((s) => s.provider)).toEqual(["codex", "codex"]);
  });

  it("player text routed to GPT Sol by mistake still goes to Claude", async () => {
    const db = openDb(":memory:");
    setCodexBin("codex-stub");
    const had = MODEL_ROUTE.resident_talk;
    MODEL_ROUTE.resident_talk = "sol";
    try {
      const seen: Seen[] = [];
      setProviderRunner("codex", stub("codex", seen, { line: "never" }));
      setProviderRunner("claude", stub("claude", seen, { line: "Claude only." }));
      await callClaude(db, { hook: "resident_talk", system: "s", prompt: "p", schema: Schema });
      expect(seen.map((s) => s.provider)).toEqual(["claude"]);
      expect(rows(db)[0].provider).toBe("claude");
    } finally {
      if (had) MODEL_ROUTE.resident_talk = had;
      else delete MODEL_ROUTE.resident_talk;
    }
  });

  it("no codex on this machine: GPT Sol's hooks run on Claude", async () => {
    const db = openDb(":memory:");
    setCodexBin(null);
    MODEL_ROUTE.test_cheap = "sol";
    const seen: Seen[] = [];
    setProviderRunner("codex", stub("codex", seen, { line: "never" }));
    setProviderRunner("claude", stub("claude", seen, { line: "Claude." }));
    await callClaude(db, { hook: "test_cheap", system: "s", prompt: "p", schema: Schema });
    expect(seen.map((s) => s.provider)).toEqual(["claude"]);
  });

  it("a broken codex binary (it exits with an error) falls back to Claude in the same call", async () => {
    const db = openDb(":memory:");
    // node itself as the "codex" binary: `node exec ...` fails at once, with stdin closed
    setCodexBin(process.execPath);
    MODEL_ROUTE.test_cheap = "sol";
    setProviderRunner("codex", codexRunner);
    const seen: Seen[] = [];
    setProviderRunner("claude", stub("claude", seen, { line: "Claude." }));
    const res = await callClaude(db, { hook: "test_cheap", system: "s", prompt: "p", schema: Schema });
    expect(res.ok).toBe(true);
    expect(rows(db).map((r) => [r.provider, r.ok])).toEqual([["codex", 0], ["claude", 1]]);
  });
});

describe("the Codex schema", () => {
  it("closes every object and makes optional keys nullable", () => {
    const { $schema: _d, ...js } = z.toJSONSchema(z.object({ a: z.string(), b: z.object({ c: z.number() }).optional(), d: z.array(z.object({ e: z.boolean() })) })) as Record<string, unknown>;
    const s = strictSchema(js) as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["a", "b", "d"]);
    expect(s.properties.b.anyOf[1]).toEqual({ type: "null" });
    expect(s.properties.b.anyOf[0].additionalProperties).toBe(false);
    expect(s.properties.d.items.additionalProperties).toBe(false);
  });
  it("drops the nulls again, so the game's schema sees an optional key left out", () => {
    const back = stripNulls({ a: "x", b: null, d: [{ e: true, f: null }] });
    expect(back).toEqual({ a: "x", d: [{ e: true }] });
    expect(z.object({ a: z.string(), b: z.string().optional() }).safeParse(back).success).toBe(true);
  });
});

// QA 2026-09-24: the ballad hook took 27 s on a 20 s limit, and once a 22.1 s answer was taken as
// a success. The limit is hard now: at the deadline the caller has the timeout, the process is
// killed, and a late answer is thrown away.
describe("the hard time limit", () => {
  it("a slow model that ignores the abort: the caller has the timeout at the limit, not when the model is done", async () => {
    const db = openDb(":memory:");
    let aborted = false;
    const slow: Runner = (r) =>
      new Promise((res) => {
        r.signal.signal.addEventListener("abort", () => (aborted = true));
        setTimeout(() => res({ output: { line: "Too late." } }), 1_500); // ignores the abort
      });
    const t0 = Date.now();
    const res = await callClaude(db, { hook: "test_slow", system: "s", prompt: "p", schema: Schema, timeoutMs: 300 }, slow);
    const took = Date.now() - t0;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout after 300 ms/);
    expect(took).toBeLessThan(600);
    expect(aborted).toBe(true);
    const row = db.prepare("SELECT ms, ok FROM ai_call").get() as { ms: number; ok: number };
    expect(row.ok).toBe(0);
    expect(row.ms).toBeLessThan(600);
  });

  it("an answer that comes just after the limit is never accepted", async () => {
    const db = openDb(":memory:");
    const late: Runner = () => new Promise((res) => setTimeout(() => res({ output: { line: "Just late." } }), 380));
    const res = await callClaude(db, { hook: "test_late", system: "s", prompt: "p", schema: Schema, timeoutMs: 300 }, late);
    expect(res.ok).toBe(false);
    expect(res.data).toBeUndefined();
    await new Promise((r) => setTimeout(r, 150)); // the late answer arrives now, and changes nothing
    expect((db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE ok = 1").get() as { n: number }).n).toBe(0);
  });

  it("no caller can set the limit past 20 s", async () => {
    const db = openDb(":memory:");
    vi.useFakeTimers();
    try {
      const stuck: Runner = () => new Promise(() => {}); // never answers
      let res: Awaited<ReturnType<typeof callClaude>> | null = null;
      void callClaude(db, { hook: "test_cap", system: "s", prompt: "p", schema: Schema, timeoutMs: 60_000 }, stuck).then((r) => (res = r));
      await vi.advanceTimersByTimeAsync(19_900);
      expect(res).toBeNull();
      await vi.advanceTimersByTimeAsync(200);
      expect(res).toMatchObject({ ok: false, error: "timeout after 20000 ms" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second call on the same hook waits for the first only until its own limit", async () => {
    const db = openDb(":memory:");
    const stuck: Runner = () => new Promise(() => {}); // never answers
    const t0 = Date.now();
    const first = callClaude(db, { hook: "test_busy", system: "s", prompt: "p", schema: Schema, timeoutMs: 400 }, stuck);
    await new Promise((r) => setTimeout(r, 50));
    const second = await callClaude(db, { hook: "test_busy", system: "s", prompt: "p", schema: Schema, timeoutMs: 200 }, stuck);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/timeout/);
    expect(Date.now() - t0).toBeLessThan(450);
    expect((await first).error).toMatch(/timeout after 400 ms/);
  });

  it("the timed-out model process is killed", async () => {
    const { spawn } = await import("node:child_process");
    const { killTree } = await import("../src/ai/codex.ts");
    const db = openDb(":memory:");
    let exited: Promise<number | null> | null = null;
    // a stand-in model: a real process that would run for 30 s and never answer
    const proc: Runner = (r) =>
      new Promise((_res, rej) => {
        const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore", windowsHide: true });
        exited = new Promise((done) => child.once("exit", (code) => done(code)));
        r.signal.signal.addEventListener("abort", () => killTree(child.pid), { once: true });
        child.once("exit", () => rej(new Error("killed")));
      });
    const t0 = Date.now();
    const res = await callClaude(db, { hook: "test_proc", system: "s", prompt: "p", schema: Schema, timeoutMs: 500 }, proc);
    expect(res.error).toMatch(/timeout after 500 ms/);
    expect(Date.now() - t0).toBeLessThan(800);
    const t1 = Date.now();
    await exited;
    expect(Date.now() - t1).toBeLessThan(5_000);
  }, 10_000);
});
