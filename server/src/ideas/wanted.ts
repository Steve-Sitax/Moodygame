import type { DB } from "../db.ts";
import { pid } from "../player/current.ts";

// A wanted bill with Jef's name on a wall (ideas/posters.ts) makes the next theft
// riskier: the town has read it and watches him. No other imports (but the player context), so deeds.ts can
// use it without a cycle.

/** How much more likely a witness sees Jef steal while a bill naming him is up. */
export const WANTED_EYES = 1.35;

/** M8c: a bill naming the player the work is for (poster.names_jef keeps the named player's id; 1 the host). */
export function wantedFactor(db: DB): number {
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'poster'").get();
  if (!t) return 1;
  return db.prepare("SELECT 1 FROM poster WHERE status = 'up' AND names_jef = ?").get(pid()) ? WANTED_EYES : 1;
}
