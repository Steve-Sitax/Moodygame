import { ALL_CLAUDE, CODEX_PLAYER_TEXT, MODEL_ROUTE, MODELS, PLAYER_TEXT_HOOKS, ROUTE_DEFAULT, type ModelChoice, type ModelKey, type Provider } from "../config.ts";
import { codexBin } from "./codex.ts";
import { aiSetup, choiceForHook, CLAUDE_PROVIDERS, type Choice, type ProviderId } from "./setup.ts";

// Which model writes a hook (docs/02, "Model router"). The table is MODEL_ROUTE in config.ts.
// Three walls keep GPT Sol off what it must not see: the "all Claude" switch, the hooks that
// can hold the player's typed words, and a machine with no codex on it. Each sends the call
// to ROUTE_DEFAULT (Claude) instead.

export interface Route extends Omit<ModelChoice, "provider"> {
  provider: Provider;
  /** A MODELS key for the recommended mix; "<provider>:<model>" for a choice from the AI setup. */
  key: ModelKey | string;
  /** Why the pick was overruled, if it was. */
  overruled?: "all_claude" | "player_text" | "no_codex";
  /** Chosen in the AI setup (docs/ai-setup.md), not the recommended mix: a broken call is not moved to Claude. */
  chosen?: true;
}

export function routeFor(
  hook: string,
  o: { table?: Record<string, ModelKey>; allClaude?: boolean; codexPlayerText?: boolean; codexOk?: boolean } = {},
): Route {
  const key = (o.table ?? MODEL_ROUTE)[hook] ?? ROUTE_DEFAULT;
  const m = MODELS[key];
  if (m.provider !== "codex") return { key, ...m };
  const back = (why: Route["overruled"]): Route => ({ key: ROUTE_DEFAULT, ...MODELS[ROUTE_DEFAULT], overruled: why });
  if (o.allClaude ?? ALL_CLAUDE) return back("all_claude");
  if (PLAYER_TEXT_HOOKS.has(hook) && !(o.codexPlayerText ?? CODEX_PLAYER_TEXT)) return back("player_text");
  if (!(o.codexOk ?? codexBin() !== null)) return back("no_codex");
  return { key, ...m };
}

// ------------------------------------------------------------------ the AI setup (docs/ai-setup.md)

/** The runner behind each provider of the AI setup. */
export const RUNNER_OF: Record<Exclude<ProviderId, "recommended" | "none">, Provider> = {
  claude_local: "claude",
  anthropic_api: "anthropic",
  codex_cli: "codex",
  openai_compat: "openai",
  ollama: "ollama",
};

/**
 * The model for a hook under the AI setup: null when no model may be called (walk-around mode, or
 * "no AI" for the hook's kind: the caller takes its fallback at once). The recommended mix is
 * routeFor above. A choice of the player's own keeps the same walls: what the player typed goes only
 * to Claude (CLAUDE.md), the "all Claude" switch and a machine without codex move a Codex choice to Claude.
 */
export function resolveRoute(hook: string, o: { codexOk?: boolean } = {}): Route | null {
  const c = choiceForHook(hook);
  if (c === null) return null;
  return routeOfChoice(hook, c, o);
}

/** A choice made into a route for one hook, with the walls. Also used by the test button. */
export function routeOfChoice(hook: string, c: Choice, o: { codexOk?: boolean } = {}): Route | null {
  if (c.provider === "none") return null;
  if (c.provider === "recommended") return routeFor(hook, { codexOk: o.codexOk });
  const r: Route = { key: `${c.provider}:${c.model}`, provider: RUNNER_OF[c.provider], model: c.model ?? "", ...(c.effort ? { effort: c.effort } : {}), chosen: true };
  if (PLAYER_TEXT_HOOKS.has(hook) && !CLAUDE_PROVIDERS.has(c.provider) && !(c.provider === "codex_cli" && CODEX_PLAYER_TEXT)) return typedLinesRoute();
  if (c.provider === "codex_cli") {
    if (ALL_CLAUDE) return { ...claudeDefault(), overruled: "all_claude" };
    if (!(o.codexOk ?? codexBin() !== null)) return { ...claudeDefault(), overruled: "no_codex" };
  }
  return r;
}

const claudeDefault = (): Route => ({ key: ROUTE_DEFAULT, ...MODELS[ROUTE_DEFAULT] });

/** Where a typed line goes when its kind picked another AI: the default choice if that is Claude, else Opus 5.5 through the login. */
function typedLinesRoute(): Route {
  const d = aiSetup().default;
  if (CLAUDE_PROVIDERS.has(d.provider)) return { key: `${d.provider}:${d.model}`, provider: RUNNER_OF[d.provider as "claude_local"], model: d.model ?? MODELS.opus.model, ...(d.effort ? { effort: d.effort } : {}), chosen: true, overruled: "player_text" };
  return { ...claudeDefault(), overruled: "player_text" };
}
