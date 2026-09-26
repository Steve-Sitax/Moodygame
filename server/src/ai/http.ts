import type { Runner } from "./claude.ts";
import { strictSchema, stripNulls } from "./codex.ts";
import { aiSetup, scrubKeys } from "./setup.ts";

// The HTTP adapters behind the one call path (docs/ai-setup.md): Claude through an Anthropic API
// key, any OpenAI-compatible server (OpenAI, OpenRouter, LM Studio, llama.cpp server, vLLM), and
// Ollama. The same rules as the Claude login and Codex: no tools in any request, the game's system
// text and one user message, a JSON answer against the hook's schema (the Zod check in claude.ts
// has the last word), the caller's abort ends the request at the 20 s limit. Keys come from the
// settings at call time and go only into the request's header; every error text is scrubbed.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 8_000;

/** Test seam: the Anthropic endpoint (a local stub server in the tests). */
let anthropicUrl = ANTHROPIC_URL;
export function setAnthropicUrl(u: string | null): void {
  anthropicUrl = u ?? ANTHROPIC_URL;
}

/**
 * The schema as the providers' structured output takes it: no length, size or pattern limits
 * (the Anthropic API refuses them, small local servers choke on them; Zod still checks them on the
 * way back) and every object closed.
 */
export function apiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(apiSchema);
  if (!s || typeof s !== "object") return s;
  const DROP = new Set(["$schema", "minLength", "maxLength", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "default"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, apiSchema(pv)]));
    } else out[k] = typeof v === "object" ? apiSchema(v) : v;
  }
  if (out.type === "object" && out.properties) out.additionalProperties = false;
  return out;
}

/** A model's text answer as JSON: a ```json fence or words around the object are tolerated. */
export function parseJsonText(text: string, who: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(`${who}: the answer was not JSON`);
  }
}

/** One POST with the caller's abort; a plain error on any failure, never a key. */
async function post(who: string, url: string, headers: Record<string, string>, body: unknown, signal: AbortController): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: signal.signal });
  } catch (e) {
    if (signal.signal.aborted) throw new Error(`${who}: stopped at the time limit`);
    const code = (e as { cause?: { code?: string } }).cause?.code;
    const where = safeOrigin(url);
    if (code === "ECONNREFUSED") throw new Error(`Nothing answers at ${where}. Is the server running?`);
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") throw new Error(`The address ${where} was not found.`);
    throw new Error(scrubKeys(`${who}: could not reach ${where} (${code ?? (e instanceof Error ? e.message : String(e))})`).slice(0, 300));
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = "";
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      msg = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? "");
    } catch {
      msg = text.slice(0, 200);
    }
    const plain =
      res.status === 401 || res.status === 403
        ? `The key was refused (${res.status}).`
        : res.status === 404
          ? `Not found (404): check the address and the model name.`
          : res.status === 429
            ? `Too many requests or out of credit (429).`
            : `${who} error ${res.status}.`;
    throw new Error(scrubKeys(`${plain}${msg ? " " + msg : ""}`).slice(0, 300));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${who}: the server's reply was not JSON`);
  }
}

function safeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "that address";
  }
}

/** Claude through an Anthropic API key: the Messages API with structured output, no tools. */
export const anthropicRunner: Runner = async ({ system, prompt, jsonSchema, signal, model, effort }) => {
  const key = aiSetup().connections.anthropic_api.apiKey;
  if (!key) throw new Error("No Anthropic API key is set.");
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: apiSchema(jsonSchema) }, ...(effort ? { effort } : {}) },
  };
  const r = (await post("Anthropic API", anthropicUrl, { "x-api-key": key, "anthropic-version": "2023-06-01" }, body, signal)) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  };
  if (r.stop_reason === "refusal") throw new Error("Anthropic API: the model declined this one");
  if (r.stop_reason === "max_tokens") throw new Error("Anthropic API: the answer was cut off");
  if (r.content?.some((b) => b.type === "tool_use" || b.type === "server_tool_use")) throw new Error("Anthropic API: the model used a tool; answer thrown away");
  const text = r.content?.find((b) => b.type === "text")?.text ?? "";
  if (!text.trim()) throw new Error("Anthropic API gave no answer");
  return { output: parseJsonText(text, "Anthropic API"), usage: { in: r.usage?.input_tokens, out: r.usage?.output_tokens, cacheRead: r.usage?.cache_read_input_tokens } };
};

/** Any OpenAI-compatible server: /chat/completions with a strict JSON schema, no tools. */
export const openaiRunner: Runner = async ({ system, prompt, jsonSchema, signal, model, effort }) => {
  const c = aiSetup().connections.openai_compat;
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: strictSchema(apiSchema(jsonSchema)) } },
    ...(effort ? { reasoning_effort: effort } : {}),
  };
  const r = (await post("The server", `${c.baseUrl}/chat/completions`, c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}, body, signal)) as {
    choices?: { message?: { content?: string | null; refusal?: string | null; tool_calls?: unknown[] }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  const m = r.choices?.[0]?.message;
  if (m?.tool_calls && m.tool_calls.length) throw new Error("The model used a tool; answer thrown away");
  if (m?.refusal) throw new Error("The model declined this one");
  if (r.choices?.[0]?.finish_reason === "length") throw new Error("The answer was cut off");
  const text = m?.content ?? "";
  if (!text.trim()) throw new Error("The server gave no answer");
  return {
    output: stripNulls(parseJsonText(text, "The server")),
    usage: { in: r.usage?.prompt_tokens, out: r.usage?.completion_tokens, cacheRead: r.usage?.prompt_tokens_details?.cached_tokens },
  };
};

/** Ollama on this PC: /api/chat, the schema as the format, no tools, no streaming. */
export const ollamaRunner: Runner = async ({ system, prompt, jsonSchema, signal, model }) => {
  const c = aiSetup().connections.ollama;
  const body = {
    model,
    stream: false,
    format: apiSchema(jsonSchema),
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };
  const r = (await post("Ollama", `${c.baseUrl}/api/chat`, {}, body, signal)) as {
    message?: { content?: string; tool_calls?: unknown[] };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  if (r.message?.tool_calls && r.message.tool_calls.length) throw new Error("Ollama: the model used a tool; answer thrown away");
  const text = r.message?.content ?? "";
  if (!text.trim()) throw new Error("Ollama gave no answer");
  return { output: parseJsonText(text, "Ollama"), usage: { in: r.prompt_eval_count, out: r.eval_count } };
};
