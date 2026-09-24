import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CODEX } from "../config.ts";
import type { Runner } from "./claude.ts";

// GPT Sol through the local Codex CLI (docs/02, "Model router"). Locked down on every call:
// an empty working folder, a read-only sandbox, no user config (Steve's config has full disk
// access and a notify hook), every tool feature off, stdin closed, no session files. The game's
// system text goes in as developer instructions, the prompt as the one user message, the answer
// comes back against our JSON schema. If the model uses any tool at all, the call fails.

/** Every Codex feature that could give the model hands or reach: all off. */
const NO_TOOLS = ["shell_tool", "unified_exec", "apps", "browser_use", "computer_use", "image_generation", "multi_agent", "memories", "plugins", "hooks", "view_image", "goals"];

/** The Windows command line holds 32k characters; past this the prompt goes in on stdin, which is then closed. */
const ARGV_MAX = 24_000;

let binCache: string | null | undefined;

/** Where the native codex binary is, or null when this machine has none (then the router sends Claude). */
export function codexBin(): string | null {
  if (binCache !== undefined) return binCache;
  const env = process.env.SCHELDEMIST_CODEX_BIN;
  const candidates: string[] = env ? [env] : [];
  if (process.platform === "win32") {
    const npm = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@openai", "codex");
    candidates.push(path.join(npm, "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"));
  } else {
    const which = spawnSync("which", ["codex"], { encoding: "utf8", timeout: 3_000 });
    if (which.status === 0 && which.stdout.trim()) candidates.push(which.stdout.trim());
  }
  binCache = candidates.find((c) => fs.existsSync(c)) ?? null;
  return binCache;
}

/** Test seam. */
export function setCodexBin(bin: string | null | undefined): void {
  binCache = bin;
}

/**
 * OpenAI's structured output wants every object closed and every key required. An optional key
 * becomes "this type or null", and the null is dropped again on the way back (stripNulls), so
 * the game's own Zod schema sees the same shape Claude gives it.
 */
export function strictSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(strictSchema);
  if (!s || typeof s !== "object") return s;
  const o = { ...(s as Record<string, unknown>) };
  delete o.$schema;
  for (const k of ["items", "anyOf", "oneOf", "allOf", "not", "additionalItems", "prefixItems"]) if (k in o) o[k] = strictSchema(o[k]);
  if (o.properties && typeof o.properties === "object") {
    const props = o.properties as Record<string, unknown>;
    const req = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) out[k] = req.has(k) ? strictSchema(v) : { anyOf: [strictSchema(v), { type: "null" }] };
    o.properties = out;
    o.required = Object.keys(props);
    o.additionalProperties = false;
  }
  return o;
}

/** Undo strictSchema's nulls: a key that came back null was an optional key left out. */
export function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== null) out[k] = stripNulls(x);
  return out;
}

/** Only these event items may appear: the model's text and its reasoning. Anything else is a tool. */
const ALLOWED_ITEMS = new Set(["agent_message", "reasoning"]);

/**
 * Kill a model process and its children at once. Never blocks: the kill runs beside the game,
 * so the caller of a timed-out call gets its fallback without waiting for the process to die.
 */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      const k = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      k.on("error", () => {});
      k.unref();
    } else process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/** The real call: codex exec, locked down, one JSON answer. */
export const codexRunner: Runner = async ({ system, prompt, jsonSchema, signal, model, effort }) => {
  const bin = codexBin();
  if (!bin) throw new Error("codex unavailable: no codex binary on this machine");
  fs.mkdirSync(CODEX.cwd, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-codex-"));
  const schemaFile = path.join(tmp, "schema.json");
  const outFile = path.join(tmp, "out.json");
  fs.writeFileSync(schemaFile, JSON.stringify(strictSchema(jsonSchema)));
  const args = [
    "exec",
    "-C", CODEX.cwd,
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--ephemeral",
    "-s", "read-only",
    "-m", model ?? CODEX.model,
    "-c", `model_reasoning_effort="${effort ?? CODEX.effort}"`,
    "-c", 'web_search="disabled"',
    // JSON string escapes are valid TOML basic-string escapes
    "-c", `developer_instructions=${JSON.stringify(system)}`,
    ...NO_TOOLS.flatMap((f) => ["--disable", f]),
    "--json",
    "--output-schema", schemaFile,
    "-o", outFile,
  ];
  const long = args.join(" ").length + prompt.length > ARGV_MAX;
  args.push(long ? "-" : prompt);
  try {
    const events = await new Promise<string>((resolve, reject) => {
      const child = spawn(bin, args, {
        cwd: CODEX.cwd,
        // stdin closed (or, for a long prompt, the prompt and then EOF): an open stdin hangs codex
        stdio: [long ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, CODEX_MANAGED_BY_NPM: "1" },
      });
      if (long && child.stdin) child.stdin.end(prompt);
      let out = "";
      let err = "";
      child.stdout?.on("data", (d) => (out += d));
      child.stderr?.on("data", (d) => (err += d));
      const onAbort = () => killTree(child.pid);
      signal.signal.addEventListener("abort", onAbort, { once: true });
      child.on("error", (e) => {
        signal.signal.removeEventListener("abort", onAbort);
        reject(new Error(`codex unavailable: ${e.message}`));
      });
      child.on("close", (code) => {
        signal.signal.removeEventListener("abort", onAbort);
        if (signal.signal.aborted) return reject(new Error("codex aborted"));
        if (code !== 0) return reject(new Error(`codex exit ${code}: ${err.trim().split("\n").slice(-3).join(" ").slice(0, 300)}`));
        resolve(out);
      });
    });
    let usage: { in?: number; out?: number; cacheRead?: number } | undefined;
    let last = "";
    for (const line of events.split("\n")) {
      if (!line.trim().startsWith("{")) continue;
      let ev: { type?: string; item?: { type?: string; text?: string }; usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number }; error?: { message?: string }; message?: string };
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.item?.type && !ALLOWED_ITEMS.has(ev.item.type)) throw new Error(`codex used a tool (${ev.item.type}); answer thrown away`);
      if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) last = ev.item.text;
      if (ev.type === "turn.completed" && ev.usage) usage = { in: ev.usage.input_tokens, out: ev.usage.output_tokens, cacheRead: ev.usage.cached_input_tokens };
      if (ev.type === "turn.failed" || ev.type === "error") throw new Error(`codex ${ev.type}: ${(ev.error?.message ?? ev.message ?? "").slice(0, 300)}`);
    }
    const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : last;
    if (!text.trim()) throw new Error("codex gave no answer");
    let output: unknown;
    try {
      output = JSON.parse(text);
    } catch {
      throw new Error("codex answer is not JSON");
    }
    return { output: stripNulls(output), usage };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
