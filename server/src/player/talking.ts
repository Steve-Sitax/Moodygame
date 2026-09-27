import type { DB } from "../db.ts";
import { GameError } from "../game.ts";
import { pid } from "./current.ts";
import { nameOf } from "./names.ts";

// M8c multiplayer: one conversation at a time per townsperson (docs/multiplayer-plan.md 4.5: "Busy: Maria is
// talking with Anna."). A player's talk with someone holds him for the player until a while after their last
// words (a talk has no closing call the server can trust: a tab may simply go); another player who walks up
// meanwhile is told who has him. Played alone there is nobody else to be told.

/** How long after their last words a townsperson is still the player's. */
export const TALK_HOLD_MS = 30_000;

const held = new Map<string, { pid: number; at: number }>();

/**
 * This player talks with this townsperson now (every line of the talk says so again). Throws "X is talking with
 * Y." (409) while another player has him.
 */
export function holdTalk(db: DB, npcId: string, npcName: string, now = Date.now()): void {
  const me = pid();
  const h = held.get(npcId);
  if (h && h.pid !== me && now - h.at < TALK_HOLD_MS) throw new GameError(`${npcName} is talking with ${nameOf(db, h.pid)}.`, 409);
  held.set(npcId, { pid: me, at: now });
}

/** The talk ended (a goodbye): the townsperson is free for anyone. */
export function freeTalk(npcId: string): void {
  const h = held.get(npcId);
  if (h && h.pid === pid()) held.delete(npcId);
}

/** A new week, a loaded save. */
export function resetTalkHolds(): void {
  held.clear();
}
