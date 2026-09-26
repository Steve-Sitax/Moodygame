import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { z } from "zod";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { callClaude, NO_AI, setProviderRunner } from "../src/ai/claude.ts";
import { setCodexBin } from "../src/ai/codex.ts";
import { anthropicRunner, apiSchema, ollamaRunner, openaiRunner, setAnthropicUrl } from "../src/ai/http.ts";
import { resolveRoute } from "../src/ai/router.ts";
import { mountAiSetup } from "../src/ai/routes.ts";
import { aiSetup, applyPatch, KIND_HOOKS, KIND_IDS, kindOf, loadAiSetup, scrubKeys, setAiSetupForTest, view } from "../src/ai/setup.ts";
import { CHECKIN_HOOK } from "../src/director/routines.ts";
import type { Provider } from "../src/config.ts";

// The AI setup (docs/ai-setup.md): an AI per kind of work, the connections, the test button and the
// walk-around mode. Stubs, fake keys and local stub servers only: no live model is called here.

const FAKE_ANTHROPIC = "sk-ant-FAKE-test-key-0000wxyz";
const FAKE_OPENAI = "sk-FAKE-openai-test-key-1111abcd";
const Schema = z.object({ line: z.string().min(1).max(80) });
const PROVIDERS: Provider[] = ["claude", "codex", "anthropic", "openai", "ollama"];
const avail = { claude_local: null, codex_cli: true };
const rows = (db: ReturnType<typeof openDb>) => db.prepare("SELECT hook, provider, model, ok, error FROM ai_call ORDER BY id").all() as { hook: string; provider: string; model: string; ok: number; error: string | null }[];

/** Every runner replaced by one that counts and answers. */
function counting(answer: unknown = { line: "Morning, stranger." }) {
  const seen: { provider: Provider; model?: string; effort?: string }[] = [];
  for (const p of PROVIDERS)
    setProviderRunner(p, async (r) => {
      seen.push({ provider: p, model: r.model, effort: r.effort });
      return { output: answer };
    });
  return seen;
}

afterEach(() => {
  for (const p of PROVIDERS) setProviderRunner(p, null);
  setAiSetupForTest(null);
  setCodexBin(undefined);
  setAnthropicUrl(null);
});

describe("the settings", () => {
  it("start as the recommended mix, AI on, nothing saved", () => {
    const v = view(avail);
    expect(v.mode).toBe("ai");
    expect(v.default).toEqual({ provider: "recommended" });
    expect(v.saved).toBe(false);
    for (const k of KIND_IDS) expect(v.kinds[k]).toBe("default");
    expect(v.options.kinds.map((k) => k.id)).toEqual([...KIND_IDS]);
    expect(v.options.providers.map((p) => p.id)).toEqual(["recommended", "claude_local", "anthropic_api", "codex_cli", "openai_compat", "ollama", "none"]);
    for (const p of v.options.providers) for (const t of Object.values(p.help)) expect(t.length).toBeGreaterThan(3);
  });

  it("refuse what is not allowed, in plain words, and change nothing", () => {
    const bad = [
      { mode: "sometimes" },
      { default: { provider: "skynet" } },
      { default: { provider: "ollama", model: "bad model; rm -rf" } },
      { kinds: { talk: { provider: "ollama" } } }, // Ollama needs a model name
      { kinds: { cooking: "default" } },
      { connections: { openai_compat: { baseUrl: "file:///C:/Windows" } } },
      { connections: { openai_compat: { baseUrl: "http://user:pw@example.com/v1" } } },
      { connections: { anthropic_api: { apiKey: "short" } } },
      { connections: { anthropic_api: { apiKey: "has a space in it" } } },
      { extra: 1 },
    ];
    for (const b of bad) {
      const r = applyPatch(b);
      expect(r.ok, JSON.stringify(b)).toBe(false);
      if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
    }
    expect(aiSetup().default).toEqual({ provider: "recommended" });
    expect(view(avail).saved).toBe(false);
  });

  it("fill in models and efforts where they apply", () => {
    expect(applyPatch({ default: { provider: "claude_local" }, kinds: { press: { provider: "claude_local", model: "claude-haiku-4-5-20251001", effort: "high" }, jobs: { provider: "codex_cli" }, town: { provider: "ollama", model: "qwen3:8b", effort: "low" }, ballads: "default" } }).ok).toBe(true);
    const s = aiSetup();
    expect(s.default).toEqual({ provider: "claude_local", model: "claude-opus-5-5", effort: "medium" });
    expect(s.kinds.press).toEqual({ provider: "claude_local", model: "claude-haiku-4-5-20251001" }); // Haiku takes no effort
    expect(s.kinds.jobs).toEqual({ provider: "codex_cli", model: "gpt-6-luna", effort: "medium" });
    expect(s.kinds.town).toEqual({ provider: "ollama", model: "qwen3:8b" });
    expect(s.kinds.ballads).toBe("default");
    expect(view(avail).effective.ballads).toMatchObject({ provider: "claude_local", model: "claude-opus-5-5" });
  });

  it("never give a key back: set or not and the last 4 characters", () => {
    expect(applyPatch({ connections: { anthropic_api: { apiKey: FAKE_ANTHROPIC }, openai_compat: { baseUrl: "http://127.0.0.1:1234/v1/", apiKey: FAKE_OPENAI } } }).ok).toBe(true);
    const v = view(avail);
    const text = JSON.stringify(v);
    expect(text).not.toContain(FAKE_ANTHROPIC);
    expect(text).not.toContain(FAKE_OPENAI);
    expect(v.connections.anthropic_api.apiKey).toEqual({ set: true, last4: "wxyz" });
    expect(v.connections.openai_compat).toEqual({ baseUrl: "http://127.0.0.1:1234/v1", apiKey: { set: true, last4: "abcd" } });
    // a patch without the key keeps it; null clears it
    expect(applyPatch({ connections: { openai_compat: { baseUrl: "https://openrouter.ai/api/v1" } } }).ok).toBe(true);
    expect(aiSetup().connections.openai_compat.apiKey).toBe(FAKE_OPENAI);
    expect(applyPatch({ connections: { openai_compat: { apiKey: null } } }).ok).toBe(true);
    expect(view(avail).connections.openai_compat.apiKey).toEqual({ set: false, last4: null });
  });

  it("scrub keys out of any text", () => {
    applyPatch({ connections: { anthropic_api: { apiKey: FAKE_ANTHROPIC } } });
    const s = scrubKeys(`401: invalid x-api-key ${FAKE_ANTHROPIC}; also sk-proj-abcdefghijk and Bearer abc.def.ghi, "api_key": "zzzzzzzzzz"`);
    expect(s).not.toContain(FAKE_ANTHROPIC);
    expect(s).not.toContain("sk-proj-abcdefghijk");
    expect(s).not.toContain("abc.def.ghi");
    expect(s).not.toContain("zzzzzzzzzz");
  });

  it("are written to their own file and read back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-ai-"));
    const f = path.join(dir, "ai-config.json");
    try {
      setAiSetupForTest(null, f);
      expect(applyPatch({ mode: "walk", connections: { anthropic_api: { apiKey: FAKE_ANTHROPIC } } }).ok).toBe(true);
      expect(JSON.parse(fs.readFileSync(f, "utf8"))).toMatchObject({ version: 1, mode: "walk" });
      setAiSetupForTest(null, f);
      expect(aiSetup().mode).toBe("ai");
      expect(loadAiSetup()).toMatchObject({ ok: true });
      expect(aiSetup().mode).toBe("walk");
      fs.writeFileSync(f, "{ not json");
      expect(loadAiSetup().ok).toBe(false);
      expect(aiSetup().mode).toBe("ai"); // a broken file: the defaults run
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("kinds of work", () => {
  it("every hook in the source belongs to a kind", () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
    const found = new Set<string>([CHECKIN_HOOK]);
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".ts")) for (const m of fs.readFileSync(p, "utf8").matchAll(/hook: "([a-z_]+)"/g)) found.add(m[1]);
      }
    };
    walk(src);
    found.add("free_reply"); // dialogue.ts passes it as a variable
    expect(found.size).toBeGreaterThan(30);
    const missing = [...found].filter((h) => kindOf(h) === null);
    expect(missing).toEqual([]);
    const all = KIND_IDS.flatMap((k) => KIND_HOOKS[k]);
    expect(new Set(all).size).toBe(all.length); // no hook in two kinds
  });
});

describe("routing per kind", () => {
  it("sends each kind to its choice, and the rest to the default", () => {
    setCodexBin("codex-stub");
    applyPatch({ default: { provider: "anthropic_api", model: "claude-sonnet-5" }, kinds: { press: { provider: "ollama", model: "llama3.1:8b" }, jobs: { provider: "codex_cli", model: "gpt-6-sol", effort: "low" } } });
    expect(resolveRoute("newspaper")).toMatchObject({ provider: "ollama", model: "llama3.1:8b", chosen: true });
    expect(resolveRoute("job_board")).toMatchObject({ provider: "codex", model: "gpt-6-sol", effort: "low" });
    expect(resolveRoute("director_think")).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5", effort: "medium" });
    expect(resolveRoute("not_a_hook")).toMatchObject({ provider: "anthropic" });
  });

  it("keeps what the player typed on Claude (the default if it is Claude, else the login)", () => {
    applyPatch({ kinds: { talk: { provider: "openai_compat", model: "gpt-5-mini" }, press: { provider: "ollama", model: "qwen3:8b" } } });
    expect(resolveRoute("clerk")).toMatchObject({ provider: "openai" }); // no typed words in it
    expect(resolveRoute("resident_talk")).toMatchObject({ provider: "claude", model: "claude-opus-5-5", overruled: "player_text" });
    expect(resolveRoute("letter_reply")).toMatchObject({ provider: "claude", overruled: "player_text" });
    applyPatch({ default: { provider: "anthropic_api", model: "claude-opus-5-5" } });
    expect(resolveRoute("free_reply")).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", overruled: "player_text" });
  });

  it("moves a Codex choice to Claude on a machine without codex", () => {
    setCodexBin(null);
    applyPatch({ kinds: { press: { provider: "codex_cli" } } });
    expect(resolveRoute("newspaper")).toMatchObject({ provider: "claude", overruled: "no_codex" });
  });

  it("the recommended mix is the router table, as before", () => {
    setCodexBin("codex-stub");
    expect(resolveRoute("newspaper")).toMatchObject({ key: "luna", provider: "codex" });
    expect(resolveRoute("resident_talk")).toMatchObject({ key: "opus", provider: "claude" });
  });

  it("logs the chosen provider and model in ai_call", async () => {
    const db = openDb(":memory:");
    const seen = counting();
    applyPatch({ default: { provider: "ollama", model: "qwen3:8b" } });
    const r = await callClaude(db, { hook: "newspaper", system: "s", prompt: "p", schema: Schema });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([{ provider: "ollama", model: "qwen3:8b", effort: undefined }]);
    expect(rows(db)).toMatchObject([{ hook: "newspaper", provider: "ollama", model: "qwen3:8b", ok: 1 }]);
  });

  it("a broken chosen provider is not moved to Claude, and its error holds no key", async () => {
    const db = openDb(":memory:");
    setCodexBin("codex-stub");
    applyPatch({ default: { provider: "codex_cli" }, connections: { anthropic_api: { apiKey: FAKE_ANTHROPIC } } });
    const seen: string[] = [];
    setProviderRunner("codex", async () => {
      seen.push("codex");
      throw new Error(`codex exit 1: bad key ${FAKE_ANTHROPIC}`);
    });
    setProviderRunner("claude", async () => {
      seen.push("claude");
      return { output: { line: "never" } };
    });
    const r = await callClaude(db, { hook: "newspaper", system: "s", prompt: "p", schema: Schema });
    expect(r.ok).toBe(false);
    expect(seen.every((p) => p === "codex")).toBe(true);
    expect(r.error).not.toContain(FAKE_ANTHROPIC);
    for (const row of rows(db)) expect(row.error ?? "").not.toContain(FAKE_ANTHROPIC);
  });
});

describe("no AI", () => {
  it("walk-around mode: every hook gets its fallback at once, no runner, no row", async () => {
    const db = openDb(":memory:");
    const seen = counting();
    applyPatch({ mode: "walk" });
    const t0 = Date.now();
    for (const h of [...KIND_IDS.flatMap((k) => KIND_HOOKS[k]), "not_a_hook"]) {
      const r = await callClaude(db, { hook: h, system: "s", prompt: "p", schema: Schema });
      expect(r).toEqual({ ok: false, error: NO_AI, ms: 0 });
    }
    expect(Date.now() - t0).toBeLessThan(500);
    expect(seen).toEqual([]);
    expect(rows(db)).toEqual([]);
  });

  it('"No AI" for one kind: only that kind is quiet', async () => {
    const db = openDb(":memory:");
    const seen = counting();
    applyPatch({ default: { provider: "claude_local" }, kinds: { press: { provider: "none" } } });
    expect((await callClaude(db, { hook: "newspaper", system: "s", prompt: "p", schema: Schema })).error).toBe(NO_AI);
    expect((await callClaude(db, { hook: "job_board", system: "s", prompt: "p", schema: Schema })).ok).toBe(true);
    expect(seen.map((s) => s.provider)).toEqual(["claude"]);
    expect(rows(db).map((r) => r.hook)).toEqual(["job_board"]);
  });
});

// ------------------------------------------------------------------ the HTTP adapters against a local stub server

interface Seen {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}
async function stubServer(reply: (s: Seen) => { status?: number; json?: unknown; hang?: boolean }) {
  const seen: Seen[] = [];
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      const s = { url: req.url ?? "", headers: req.headers, body: JSON.parse(b || "{}") };
      seen.push(s);
      const r = reply(s);
      if (r.hang) return; // never answers
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = (srv.address() as net.AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    seen,
    close: () => {
      srv.closeAllConnections();
      return new Promise<void>((ok) => srv.close(() => ok()));
    },
  };
}

const RichSchema = z.object({ line: z.string().min(1).max(120), mood: z.enum(["glad", "wary"]), note: z.string().optional(), n: z.number().int().min(0).max(3) });

describe("HTTP adapters", () => {
  it("apiSchema drops the limits the APIs refuse and closes every object", () => {
    const s = apiSchema(z.toJSONSchema(RichSchema)) as { properties: Record<string, Record<string, unknown>>; additionalProperties: boolean };
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.line).toEqual({ type: "string" });
    expect(s.properties.n).toEqual({ type: "integer" });
    expect(JSON.stringify(s)).not.toMatch(/minLength|maxLength|maximum|\$schema/);
  });

  it("OpenAI-compatible: a strict JSON schema, the key as Bearer, no tools; nulls dropped; Zod checks", async () => {
    const srv = await stubServer(() => ({ json: { choices: [{ message: { content: '```json\n{"line":"Morning.","mood":"wary","note":null,"n":2}\n```' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } }));
    try {
      applyPatch({ default: { provider: "openai_compat", model: "local-model", effort: "low" }, connections: { openai_compat: { baseUrl: `${srv.base}/v1`, apiKey: FAKE_OPENAI } } });
      setProviderRunner("openai", openaiRunner);
      const db = openDb(":memory:");
      const r = await callClaude(db, { hook: "newspaper", system: "SYSTEM TEXT", prompt: "PROMPT", schema: RichSchema });
      expect(r).toMatchObject({ ok: true, data: { line: "Morning.", mood: "wary", n: 2 } });
      expect(r.data).not.toHaveProperty("note");
      const s = srv.seen[0];
      expect(s.url).toBe("/v1/chat/completions");
      expect(s.headers.authorization).toBe(`Bearer ${FAKE_OPENAI}`);
      expect(s.body).not.toHaveProperty("tools");
      expect(s.body).toMatchObject({ model: "local-model", reasoning_effort: "low", messages: [{ role: "system", content: "SYSTEM TEXT" }, { role: "user", content: "PROMPT" }] });
      const rf = s.body.response_format as { type: string; json_schema: { strict: boolean; schema: { required: string[]; additionalProperties: boolean } } };
      expect(rf.type).toBe("json_schema");
      expect(rf.json_schema.strict).toBe(true);
      expect(rf.json_schema.schema.required).toEqual(["line", "mood", "note", "n"]);
      expect(rf.json_schema.schema.additionalProperties).toBe(false);
      expect(rows(db)[0]).toMatchObject({ provider: "openai", model: "local-model", ok: 1 });
    } finally {
      await srv.close();
    }
  });

  it("OpenAI-compatible: a refused key is a plain error without the key", async () => {
    const srv = await stubServer(() => ({ status: 401, json: { error: { message: `Incorrect API key provided: ${FAKE_OPENAI}` } } }));
    try {
      applyPatch({ default: { provider: "openai_compat", model: "gpt-5-mini" }, connections: { openai_compat: { baseUrl: srv.base, apiKey: FAKE_OPENAI } } });
      setProviderRunner("openai", openaiRunner);
      const db = openDb(":memory:");
      const r = await callClaude(db, { hook: "newspaper", system: "s", prompt: "p", schema: Schema });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/^The key was refused \(401\)/);
      expect(r.error).not.toContain(FAKE_OPENAI);
      for (const row of rows(db)) expect(row.error).not.toContain(FAKE_OPENAI);
    } finally {
      await srv.close();
    }
  });

  it("Anthropic API: the Messages API with output_config.format, x-api-key, no tools", async () => {
    const srv = await stubServer(() => ({ json: { content: [{ type: "text", text: '{"line":"Good day to you."}' }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 8 } } }));
    try {
      setAnthropicUrl(`${srv.base}/v1/messages`);
      applyPatch({ default: { provider: "anthropic_api" }, connections: { anthropic_api: { apiKey: FAKE_ANTHROPIC } } });
      setProviderRunner("anthropic", anthropicRunner);
      const db = openDb(":memory:");
      const r = await callClaude(db, { hook: "job_board", system: "SYS", prompt: "P", schema: Schema });
      expect(r).toMatchObject({ ok: true, data: { line: "Good day to you." } });
      const s = srv.seen[0];
      expect(s.headers["x-api-key"]).toBe(FAKE_ANTHROPIC);
      expect(s.headers["anthropic-version"]).toBe("2023-06-01");
      expect(s.body).not.toHaveProperty("tools");
      expect(s.body).toMatchObject({ model: "claude-opus-5-5", system: "SYS", messages: [{ role: "user", content: "P" }], output_config: { effort: "medium", format: { type: "json_schema" } } });
    } finally {
      await srv.close();
    }
  });

  it("Anthropic API: no key set is a plain error, and no request is sent", async () => {
    const srv = await stubServer(() => ({ json: {} }));
    try {
      setAnthropicUrl(`${srv.base}/v1/messages`);
      applyPatch({ default: { provider: "anthropic_api" } });
      setProviderRunner("anthropic", anthropicRunner);
      const r = await callClaude(openDb(":memory:"), { hook: "job_board", system: "s", prompt: "p", schema: Schema });
      expect(r).toMatchObject({ ok: false, error: "No Anthropic API key is set." });
      expect(srv.seen).toEqual([]);
    } finally {
      await srv.close();
    }
  });

  it("Ollama: /api/chat with the schema as the format, no stream, no tools", async () => {
    const srv = await stubServer(() => ({ json: { message: { role: "assistant", content: '{"line":"Fog again."}' }, prompt_eval_count: 30, eval_count: 6 } }));
    try {
      applyPatch({ default: { provider: "ollama", model: "qwen3:8b" }, connections: { ollama: { baseUrl: srv.base } } });
      setProviderRunner("ollama", ollamaRunner);
      const r = await callClaude(openDb(":memory:"), { hook: "poster", system: "s", prompt: "p", schema: Schema });
      expect(r).toMatchObject({ ok: true, data: { line: "Fog again." } });
      const s = srv.seen[0];
      expect(s.url).toBe("/api/chat");
      expect(s.body).toMatchObject({ model: "qwen3:8b", stream: false, format: { type: "object", additionalProperties: false } });
      expect(s.body).not.toHaveProperty("tools");
    } finally {
      await srv.close();
    }
  });

  it("a server that never answers ends at the limit, and one that is not there says so", async () => {
    const srv = await stubServer(() => ({ hang: true }));
    try {
      applyPatch({ default: { provider: "ollama", model: "slow" }, connections: { ollama: { baseUrl: srv.base } } });
      setProviderRunner("ollama", ollamaRunner);
      const db = openDb(":memory:");
      const t0 = Date.now();
      const r = await callClaude(db, { hook: "poster", system: "s", prompt: "p", schema: Schema, timeoutMs: 600 });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/timeout/);
      expect(Date.now() - t0).toBeLessThan(1_500); // the limit, not the hung server's pace
    } finally {
      await srv.close();
    }
    const port = await freePort();
    applyPatch({ connections: { ollama: { baseUrl: `http://127.0.0.1:${port}` } } });
    const r2 = await callClaude(openDb(":memory:"), { hook: "poster", system: "s", prompt: "p", schema: Schema, timeoutMs: 3_000 });
    expect(r2.error).toMatch(/Nothing answers at http:\/\/127\.0\.0\.1:\d+/);
  });
});

// ------------------------------------------------------------------ the API

describe("the API", () => {
  const app = () => {
    const a = new Hono();
    mountAiSetup(a, { db: openDb(":memory:") });
    const send = (method: string, url: string, body?: unknown) =>
      a.request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return send;
  };

  it("GET, PUT and a bad PUT", async () => {
    const send = app();
    const v = (await (await send("GET", "/api/ai/config")).json()) as { mode: string; options: { guide: { paragraphs: string[] } } };
    expect(v.mode).toBe("ai");
    expect(v.options.guide.paragraphs.length).toBeGreaterThan(2);
    const put = await send("PUT", "/api/ai/config", { mode: "walk", connections: { anthropic_api: { apiKey: FAKE_ANTHROPIC } } });
    expect(put.status).toBe(200);
    const pv = (await put.json()) as { mode: string; status: { title: string } };
    expect(pv).toMatchObject({ mode: "walk", status: { title: "Walk-around mode" } });
    expect(JSON.stringify(pv)).not.toContain(FAKE_ANTHROPIC);
    const bad = await send("PUT", "/api/ai/config", { default: { provider: "ollama", model: "x y" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  it("test all: each model once, results per kind, no game budget", async () => {
    const send = app();
    setCodexBin("codex-stub");
    const seen = counting({ line: "Morning to you, friend." });
    applyPatch({ kinds: { press: { provider: "none" }, jobs: { provider: "ollama", model: "qwen3:8b" } } });
    const res = await send("POST", "/api/ai/test", { all: true });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { target: string; provider: string; model: string | null; ok: boolean; line?: string; note?: string }[] };
    // recommended: Opus and GPT Luna; Ollama for jobs; press has no AI
    expect(new Set(seen.map((s) => `${s.provider}:${s.model}`))).toEqual(new Set(["claude:claude-opus-5-5", "codex:gpt-6-luna", "ollama:qwen3:8b"]));
    expect(seen.length).toBe(3);
    expect(results.find((r) => r.target === "press")).toMatchObject({ ok: true, provider: "none", note: expect.stringMatching(/hand-written/) });
    expect(results.find((r) => r.target === "jobs")).toMatchObject({ ok: true, provider: "ollama", model: "qwen3:8b", line: "Morning to you, friend." });
    expect(results.filter((r) => r.target === "town").map((r) => r.model).sort()).toEqual(["claude-opus-5-5", "gpt-6-luna"]);
  });

  it("test one choice, a failure in plain words, and a bad body", async () => {
    const send = app();
    setProviderRunner("openai", async () => {
      throw new Error("Nothing answers at http://127.0.0.1:1234. Is the server running?");
    });
    const r = (await (await send("POST", "/api/ai/test", { choice: { provider: "openai_compat", model: "m" } })).json()) as { results: { ok: boolean; error: string }[] };
    expect(r.results).toEqual([expect.objectContaining({ ok: false, error: "Nothing answers at http://127.0.0.1:1234. Is the server running?" })]);
    expect((await send("POST", "/api/ai/test", { kind: "cooking" })).status).toBe(400);
  });
});

// ------------------------------------------------------------------ a whole game day on a real server

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return p;
}

const kids: ChildProcess[] = [];
afterAll(() => {
  for (const k of kids) k.kill();
});

/** A real server (src/index.ts) on a new save in a temp folder. VITEST is set, so no live model is ever reached. */
async function realServer(mode: "ai" | "walk") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-day-"));
  const cfg = path.join(dir, "ai.json");
  if (mode === "walk") fs.writeFileSync(cfg, JSON.stringify({ version: 1, mode: "walk", default: { provider: "recommended" }, kinds: {}, connections: { anthropic_api: {}, openai_compat: { baseUrl: "https://api.openai.com/v1" }, ollama: { baseUrl: "http://127.0.0.1:11434" } } }));
  const port = await freePort();
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let log = "";
  const child = spawn(process.execPath, ["src/index.ts"], {
    cwd: serverDir,
    env: { ...process.env, VITEST: "true", SCHELDEMIST_DB: path.join(dir, "day.sqlite"), SCHELDEMIST_PORT: String(port), SCHELDEMIST_AI_CONFIG: cfg, SCHELDEMIST_SAVES: path.join(dir, "saves"), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  kids.push(child);
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await r.json()) as Record<string, unknown>;
  };
  for (let i = 0; i < 100; i++) {
    try {
      await call("GET", "/api/ai/config");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const calls = () => {
    const db = new Database(path.join(dir, "day.sqlite"), { readonly: true, fileMustExist: true });
    try {
      return (db.prepare("SELECT COUNT(*) AS n FROM ai_call").get() as { n: number }).n;
    } finally {
      db.close();
    }
  };
  /** One tick of the game with every feature's after-tick step: the tick limit reset first (dev route). */
  const tick = async () => {
    await call("POST", "/api/dev/advance", { minutes: 0 });
    return call("POST", "/api/tick", {});
  };
  const stop = async () => {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { call, calls, tick, stop, log: () => log };
}

describe("a whole game day", () => {
  it("with AI on, the game asks for calls (the control)", async () => {
    const s = await realServer("ai");
    try {
      for (let i = 0; i < 12; i++) await s.tick();
      await new Promise((r) => setTimeout(r, 500));
      expect(s.calls()).toBeGreaterThan(0);
    } finally {
      await s.stop();
    }
  }, 60_000);

  it("in walk-around mode: a day from dawn past midnight makes zero calls, and the game goes on", async () => {
    const s = await realServer("walk");
    try {
      const cfg = await s.call("GET", "/api/ai/config");
      expect(cfg).toMatchObject({ mode: "walk", status: { title: "Walk-around mode" } });
      const start = (await s.call("GET", "/api/state")) as { clock: { day: number; hour: number } };
      let last = start;
      // 5 game minutes a tick: 24 game hours and a little more
      for (let i = 0; i < 300; i++) last = (await s.tick()) as typeof start;
      await new Promise((r) => setTimeout(r, 500));
      expect(last.clock.day).toBe(start.clock.day + 1);
      expect(s.calls()).toBe(0);
      const jobs = (await s.call("GET", "/api/jobs")) as { jobs: unknown[]; board: { state: string } };
      expect(jobs.jobs.length).toBeGreaterThan(0); // the new day's board, hand-written
      expect(jobs.board.state).toBe("ready");
      expect(s.log()).toMatch(/\[ai\] walk-around mode/);
    } finally {
      await s.stop();
    }
  }, 240_000);
});
