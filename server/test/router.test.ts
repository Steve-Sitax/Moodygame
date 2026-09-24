import { afterEach, describe, expect, it } from "vitest";
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
