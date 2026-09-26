// The AI setup sheet (Steve 2026-09-26: "make it changeable in config to connect to local Claude or
// Codex or any AI users want. Different AI selectable for different types of work. And put a test
// button in it, plus guidance on how to use. Or a button 'no AI' and just make it a walk-around game.").
// Drawn from the server's own description (GET /api/ai/config; the contract: docs/ai-setup.md). A key
// typed here goes to the server once (PUT) and never comes back: the sheet shows "set, ends in abcd".

import { real } from "../game/pause";

type ProviderId = "recommended" | "claude_local" | "anthropic_api" | "codex_cli" | "openai_compat" | "ollama" | "none";
type KindId = "talk" | "director" | "jobs" | "press" | "ballads" | "town";
type Effort = "low" | "medium" | "high";
interface Choice {
  provider: ProviderId;
  model?: string;
  effort?: Effort;
}
interface KeyState {
  set: boolean;
  last4: string | null;
}
interface Provider {
  id: ProviderId;
  label: string;
  short: string;
  needs: Array<"apiKey" | "baseUrl">;
  models: Array<{ id: string; label: string; effort: boolean }>;
  freeModel: boolean;
  modelHint: string | null;
  defaultModel: string | null;
  effort: boolean;
  cost: "plan" | "paid" | "local" | "none";
  help: { what: string; need: string; cost: string; privacy: string };
  typedLines: string;
}
interface AiView {
  mode: "ai" | "walk";
  /** Where the player's typed lines go (added to the contract 2026-09-26; absent on an older server). */
  typedLines?: "same" | "claude_only";
  status: { title: string; text: string };
  default: Choice;
  kinds: Record<KindId, "default" | Choice>;
  effective: Record<KindId, Choice & { label: string }>;
  connections: {
    anthropic_api: { apiKey: KeyState };
    openai_compat: { baseUrl: string; apiKey: KeyState };
    ollama: { baseUrl: string };
  };
  available: { claude_local: boolean | null; codex_cli: boolean };
  saved: boolean;
  options: {
    kinds: Array<{ id: KindId; label: string; what: string; recommended: string }>;
    providers: Provider[];
    efforts: Effort[];
    guide: { title: string; paragraphs: string[] };
    walk: { label: string; text: string };
    typedLines?: { label: string; what: string; privacy: string; values: Array<{ id: "same" | "claude_only"; label: string; text: string }> };
  };
}
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

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const COST: Record<Provider["cost"], string> = { plan: "on your plan", paid: "paid per call", local: "free, on this PC", none: "nothing" };

async function call<T>(method: string, url: string, body?: unknown, ms = 15_000): Promise<T> {
  const r = await real.fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: real.abortTimeout(ms),
  });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string; issues?: Array<{ path: string; message: string }> };
  if (!r.ok) throw new Error(d.issues?.length ? d.issues.map((i) => i.message).join("; ") : (d.error ?? `HTTP ${r.status}`));
  return d;
}

let view: AiView | null = null;
/** Test results by target ("default" for the default's own test), shown under each. */
const results = new Map<string, TestResult[] | "testing" | string>();
/** A provider whose help is open (the default's, or a kind's). */
let helpFor: ProviderId | null = null;
let msg = "";

/** On the title paper: a plain line when the game plays without AI. */
export async function aiMenuNote(el: HTMLElement | null): Promise<void> {
  if (!el) return;
  try {
    const v = await call<AiView>("GET", "/api/ai/config", undefined, 5000);
    view = v;
    el.innerHTML = v.mode === "walk" ? `<b>${esc(v.status.title)}.</b> ${esc(v.status.text)}` : "";
    el.hidden = v.mode !== "walk";
  } catch {
    el.hidden = true;
  }
}

function provider(id: ProviderId): Provider | undefined {
  return view?.options.providers.find((p) => p.id === id);
}

function resultHtml(key: string): string {
  const r = results.get(key);
  if (!r) return "";
  if (r === "testing") return `<p class="test-res wait">Asking... (20 seconds at most)</p>`;
  if (typeof r === "string") return `<p class="test-res bad">${esc(r)}</p>`;
  return r
    .map(
      (t) => `<p class="test-res ${t.ok ? "good" : "bad"}"><span class="mark" aria-hidden="true">${t.ok ? "&#10003;" : "&#10007;"}</span> <b>${esc(t.label)}</b>${t.model ? ` <span class="model">${esc(t.model)}</span>` : ""}: ${
        t.ok ? `answered in ${(t.ms / 1000).toFixed(1)} s${t.line ? `: <q>${esc(t.line)}</q>` : ""}` : esc(t.error ?? "no answer")
      }${t.note ? ` <i>${esc(t.note)}</i>` : ""}</p>`,
    )
    .join("");
}

/** The provider, model and effort pickers of one choice. */
function choiceHtml(key: string, c: Choice | "default", allowDefault: boolean): string {
  const opts = view!.options.providers;
  const cur = c === "default" ? "default" : c.provider;
  const sel = `<select data-ai="provider" data-key="${key}" aria-label="AI for ${esc(key)}">${allowDefault ? `<option value="default"${cur === "default" ? " selected" : ""}>Same as the default</option>` : ""}${opts
    .map((p) => `<option value="${p.id}"${p.id === cur ? " selected" : ""}>${esc(p.label)}${p.id === "claude_local" && view!.available.claude_local === false ? " (not found)" : p.id === "codex_cli" && !view!.available.codex_cli ? " (not found)" : ""}</option>`)
    .join("")}</select>`;
  if (c === "default") return sel;
  const p = provider(c.provider);
  if (!p) return sel;
  let model = "";
  if (p.models.length || p.freeModel) {
    const known = p.models.some((m) => m.id === c.model);
    const list = p.models.length
      ? `<select data-ai="model" data-key="${key}" aria-label="Model">${p.models.map((m) => `<option value="${esc(m.id)}"${m.id === c.model ? " selected" : ""}>${esc(m.label)}</option>`).join("")}${p.freeModel ? `<option value="__own"${!known ? " selected" : ""}>Another model...</option>` : ""}</select>`
      : "";
    const typed = p.freeModel && (!known || !p.models.length) ? `<input type="text" data-ai="modelText" data-key="${key}" value="${esc(c.model ?? "")}" placeholder="${esc(p.modelHint ?? "model name")}" spellcheck="false" aria-label="Model name">` : "";
    model = list + typed;
  }
  const m = p.models.find((q) => q.id === c.model);
  const effort = p.effort && m?.effort ? `<div class="seg small" role="radiogroup" aria-label="Effort">${view!.options.efforts.map((e) => `<button role="radio" class="${(c.effort ?? "medium") === e ? "on" : ""}" aria-checked="${(c.effort ?? "medium") === e}" data-ai="effort" data-key="${key}" data-val="${e}">${e}</button>`).join("")}</div>` : "";
  return `${sel}${model}${effort}`;
}

function helpHtml(p: Provider): string {
  return `<div class="ai-help"><h4>${esc(p.label)} <span class="cost">${esc(COST[p.cost])}</span></h4>
    <dl><dt>What</dt><dd>${esc(p.help.what)}</dd><dt>You need</dt><dd>${esc(p.help.need)}</dd><dt>Cost</dt><dd>${esc(p.help.cost)}</dd><dt>Privacy</dt><dd>${esc(p.help.privacy)}</dd><dt>Your typed lines</dt><dd>${esc(p.typedLines)}</dd></dl></div>`;
}

/** The switch for the player's typed lines: to the AI of their kind, or to Claude only. */
function typedHtml(v: AiView): string {
  const t = v.options.typedLines;
  if (!t || !v.typedLines) return "";
  return `<h3>${esc(t.label)}</h3>
    <div class="ai-mode typed" role="radiogroup" aria-label="${esc(t.label)}">${t.values
      .map((o) => `<button role="radio" class="mode-card${v.typedLines === o.id ? " on" : ""}" aria-checked="${v.typedLines === o.id}" data-ai="typed" data-val="${o.id}"><b>${esc(o.label)}</b><span>${esc(o.text)}</span></button>`)
      .join("")}</div>
    <p class="fine">${esc(t.what)} ${esc(t.privacy)}</p>`;
}

function keyField(name: string, label: string, st: KeyState): string {
  return `<div class="set-row"><div class="lbl">${esc(label)}<small>${st.set ? `Set, ends in <b>${esc(st.last4 ?? "????")}</b>. Type a new one to change it.` : "Not set."} Kept only on this PC, never shown again.</small></div>
    <div class="ctl"><input type="password" autocomplete="off" spellcheck="false" data-conn="${name}" placeholder="${st.set ? "(unchanged)" : "paste the key"}" aria-label="${esc(label)}">
    <button class="btn small" data-ai="saveKey" data-conn="${name}">Save</button>${st.set ? `<button class="btn small" data-ai="clearKey" data-conn="${name}">Remove</button>` : ""}</div></div>`;
}

function draw(box: HTMLElement): void {
  const v = view!;
  const walk = v.mode === "walk";
  const kinds = v.options.kinds;
  const defP = provider(v.default.provider);
  const shownHelp = provider(helpFor ?? v.default.provider) ?? defP;
  box.innerHTML = `
    <div class="ai-mode" role="radiogroup" aria-label="AI or walk around">
      <button role="radio" class="mode-card${walk ? "" : " on"}" aria-checked="${!walk}" data-ai="mode" data-val="ai"><b>AI on</b><span>The townspeople answer in their own words; the director plans the day.</span></button>
      <button role="radio" class="mode-card${walk ? " on" : ""}" aria-checked="${walk}" data-ai="mode" data-val="walk"><b>${esc(v.options.walk.label)}</b><span>${esc(v.options.walk.text)}</span></button>
    </div>
    <p class="ai-status"><b>${esc(v.status.title)}.</b> ${esc(v.status.text)}</p>
    ${msg ? `<p class="msg" aria-live="polite">${esc(msg)}</p>` : ""}
    <fieldset class="ai-kinds"${walk ? " disabled" : ""}>
      <h3>The default</h3>
      <div class="set-row"><div class="lbl">Every kind of work, unless set below<small>${esc(defP?.short ?? "")}</small></div>
        <div class="ctl">${choiceHtml("default", v.default, false)}<button class="btn small" data-ai="test" data-key="default">Test</button></div></div>
      ${resultHtml("default")}
      <h3>By kind of work</h3>
      ${kinds
        .map(
          (k) => `<div class="set-row kind"><div class="lbl">${esc(k.label)}<small>${esc(k.what)} Now: ${esc(v.effective[k.id]?.label ?? "")}.</small></div>
        <div class="ctl">${choiceHtml(k.id, v.kinds[k.id] ?? "default", true)}<button class="btn small" data-ai="test" data-key="${k.id}">Test</button></div></div>${resultHtml(k.id)}`,
        )
        .join("")}
      ${typedHtml(v)}
      <div class="row-btns"><button class="btn" data-ai="testAll">Test all</button><button class="btn" data-ai="recommended">Use the recommended mix</button></div>
      ${resultHtml("all")}
      <h3>Connections</h3>
      ${keyField("anthropic_api", "Anthropic API key", v.connections.anthropic_api.apiKey)}
      <div class="set-row"><div class="lbl">OpenAI-compatible server<small>OpenAI, OpenRouter, LM Studio, llama.cpp or vLLM: its address, ending in /v1.</small></div>
        <div class="ctl"><input type="url" data-conn="openai_url" value="${esc(v.connections.openai_compat.baseUrl)}" spellcheck="false" aria-label="OpenAI-compatible address"><button class="btn small" data-ai="saveUrl" data-conn="openai_url">Save</button></div></div>
      ${keyField("openai_compat", "Its key (if it wants one)", v.connections.openai_compat.apiKey)}
      <div class="set-row"><div class="lbl">Ollama on this PC<small>Where Ollama listens.</small></div>
        <div class="ctl"><input type="url" data-conn="ollama_url" value="${esc(v.connections.ollama.baseUrl)}" spellcheck="false" aria-label="Ollama address"><button class="btn small" data-ai="saveUrl" data-conn="ollama_url">Save</button></div></div>
    </fieldset>
    <details class="ai-guide"${v.saved ? "" : " open"}><summary>${esc(v.options.guide.title)}</summary>${v.options.guide.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
      <div class="ai-help-pick">About: ${v.options.providers.map((p) => `<button class="chip${p.id === shownHelp?.id ? " on" : ""}" data-ai="help" data-val="${p.id}">${esc(p.label)}</button>`).join("")}</div>
      ${shownHelp ? helpHtml(shownHelp) : ""}
    </details>`;
}

async function put(box: HTMLElement, patch: unknown, done = ""): Promise<void> {
  try {
    view = await call<AiView>("PUT", "/api/ai/config", patch);
    msg = done;
  } catch (e) {
    msg = `Not saved: ${(e as Error).message}`;
  }
  draw(box);
}

async function test(box: HTMLElement, key: string): Promise<void> {
  const body = key === "all" ? { all: true } : key === "default" ? { choice: view!.default } : { kind: key };
  results.set(key, "testing");
  draw(box);
  try {
    const r = await call<{ results: TestResult[] }>("POST", "/api/ai/test", body, 60_000);
    results.set(key, r.results);
  } catch (e) {
    results.set(key, `The test did not run: ${(e as Error).message}`);
  }
  draw(box);
}

/** The choice now at `key` ("default" or a kind), as the server has it. */
function choiceAt(key: string): Choice | "default" {
  return key === "default" ? view!.default : (view!.kinds[key as KindId] ?? "default");
}
function patchChoice(key: string, c: Choice | "default"): unknown {
  return key === "default" ? { default: c } : { kinds: { [key]: c } };
}

let wired: HTMLElement | null = null;
export async function drawAi(box: HTMLElement): Promise<void> {
  msg = "";
  try {
    view = await call<AiView>("GET", "/api/ai/config");
  } catch (e) {
    box.innerHTML = `<p class="fine">The AI settings cannot be reached just now (${esc((e as Error).message)}). Is the game's server running?</p>`;
    return;
  }
  draw(box);
  if (wired === box) return;
  wired = box;
  box.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-ai]");
    if (!t || !view) return;
    const key = t.dataset.key ?? "";
    switch (t.dataset.ai) {
      case "mode":
        void put(box, { mode: t.dataset.val }, t.dataset.val === "walk" ? "Walk-around mode: no AI is called." : "AI on.");
        break;
      case "typed":
        void put(box, { typedLines: t.dataset.val });
        break;
      case "test":
        void test(box, key);
        break;
      case "testAll":
        void test(box, "all");
        break;
      case "recommended":
        void put(box, { default: { provider: "recommended" }, kinds: Object.fromEntries(view.options.kinds.map((k) => [k.id, "default"])) }, "The recommended mix, for every kind.");
        break;
      case "effort": {
        const c = choiceAt(key);
        if (c !== "default") void put(box, patchChoice(key, { ...c, effort: t.dataset.val as Effort }));
        break;
      }
      case "help":
        helpFor = t.dataset.val as ProviderId;
        draw(box);
        break;
      case "saveKey": {
        const input = box.querySelector<HTMLInputElement>(`input[data-conn="${t.dataset.conn}"]`);
        const k = input?.value.trim() ?? "";
        if (!k) return;
        if (input) input.value = "";
        void put(box, { connections: { [t.dataset.conn!]: { apiKey: k } } }, "The key is saved on this PC.");
        break;
      }
      case "clearKey":
        void put(box, { connections: { [t.dataset.conn!]: { apiKey: null } } }, "The key is removed.");
        break;
      case "saveUrl": {
        const which = t.dataset.conn === "openai_url" ? "openai_compat" : "ollama";
        const url = box.querySelector<HTMLInputElement>(`input[data-conn="${t.dataset.conn}"]`)?.value.trim() ?? "";
        void put(box, { connections: { [which]: { baseUrl: url } } }, "The address is saved.");
        break;
      }
    }
  });
  box.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    if (!view || !t.dataset.ai) return;
    const key = t.dataset.key ?? "";
    const val = (t as HTMLInputElement).value;
    if (t.dataset.ai === "provider") {
      if (val === "default") return void put(box, patchChoice(key, "default"));
      const p = provider(val as ProviderId);
      helpFor = val as ProviderId;
      void put(box, patchChoice(key, { provider: val as ProviderId, ...(p?.defaultModel ? { model: p.defaultModel } : {}) }));
    } else if (t.dataset.ai === "model") {
      const c = choiceAt(key);
      if (c === "default") return;
      if (val === "__own") {
        // an own model name: the text box comes, the choice is saved when it is typed
        const input = document.createElement("input");
        input.type = "text";
        input.dataset.ai = "modelText";
        input.dataset.key = key;
        input.placeholder = provider(c.provider)?.modelHint ?? "model name";
        t.after(input);
        input.focus();
        return;
      }
      void put(box, patchChoice(key, { provider: c.provider, model: val, ...(c.effort ? { effort: c.effort } : {}) }));
    } else if (t.dataset.ai === "modelText") {
      const c = choiceAt(key);
      if (c === "default" || !val.trim()) return;
      void put(box, patchChoice(key, { provider: c.provider, model: val.trim() }));
    }
  });
}
