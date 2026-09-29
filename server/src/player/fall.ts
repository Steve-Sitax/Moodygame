import type { DB } from "../db.ts";
import { pid } from "./current.ts";
import { HEALTH_FLOOR } from "../night/gangs.ts";

// Falls (Steve 2026-09-29: "if we jump off things higher than 3m, we get fall damage. i.e. jumping of a quay
// crane"). The browser says how far Jef fell and whether he came down in water; the engine owns the harm.
// Water takes the fall. A fall never ends the game on its own: health stays at the floor a blow leaves.

/** Metres from which a fall onto stone hurts, and the harm (health points of 10) at each step up. */
export const FALL = { from: 3, steps: [[3, 1], [5, 2], [8, 3], [12, 4]] as Array<[number, number]>, most: 60 };

export function fallHarm(height: number): number {
  let harm = 0;
  for (const [m, h] of FALL.steps) if (height >= m) harm = h;
  return harm;
}

export function fall(db: DB, body: unknown): { hurt: number; text: string | null } {
  const b = (body ?? {}) as { height?: unknown; water?: unknown };
  const height = Math.max(0, Math.min(FALL.most, Number(b.height) || 0));
  if (b.water === true || height < FALL.from) return { hurt: 0, text: null };
  const p = db.prepare("SELECT health FROM player WHERE id = ?").get(pid()) as { health: number } | undefined;
  if (!p) return { hurt: 0, text: null };
  const hurt = Math.max(0, Math.min(fallHarm(height), p.health - HEALTH_FLOOR));
  if (hurt > 0) db.prepare("UPDATE player SET health = MAX(?, health - ?) WHERE id = ?").run(HEALTH_FLOOR, hurt, pid());
  const text =
    height >= 12
      ? "You hit the stones hard. Everything goes white for a moment. Something in you is badly hurt."
      : height >= 8
        ? "You land badly. Pain shoots up through your legs and back."
        : height >= 5
          ? "You come down hard and your ankle turns under you."
          : "You land heavily. Your knees jar and your ankles ache.";
  return { hurt, text };
}
