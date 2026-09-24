import { ALL_CLAUDE, CODEX_PLAYER_TEXT, MODEL_ROUTE, MODELS, PLAYER_TEXT_HOOKS, ROUTE_DEFAULT, type ModelChoice, type ModelKey } from "../config.ts";
import { codexBin } from "./codex.ts";

// Which model writes a hook (docs/02, "Model router"). The table is MODEL_ROUTE in config.ts.
// Three walls keep GPT Sol off what it must not see: the "all Claude" switch, the hooks that
// can hold the player's typed words, and a machine with no codex on it. Each sends the call
// to ROUTE_DEFAULT (Claude) instead.

export interface Route extends ModelChoice {
  key: ModelKey;
  /** Why the table's pick was overruled, if it was. */
  overruled?: "all_claude" | "player_text" | "no_codex";
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
