import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { GameError, log, player } from "../game.ts";
import { getState, setState } from "../interiors/state.ts";
import { pid } from "../player/current.ts";
import { CANDLE_C, CHAIR_C, landmarkOpen, massAt } from "../../../shared/landmarks.ts";

// The small deeds inside the cathedral (M6 landmark interiors), engine prices only: a candle
// at the Lady altar, and the chair woman's centime for a chair during mass.

/** A candle at the Lady altar: the engine's price; a line in the log (a candle, not a secret). */
export function lightCandle(db: DB): { paid_c: number; text: string } {
  const c = clock(db);
  if (!landmarkOpen("cathedral", c.day, c.hour + c.minute / 60)) throw new GameError("the cathedral is shut", 409);
  if (player(db).money_c < CANDLE_C) throw new GameError(`not enough money: a candle is ${CANDLE_C} centimes`, 409);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(CANDLE_C, pid());
    log(db, "lit_candle", "cathedral", `Jef lit a candle at the Lady altar in the cathedral.`);
  })();
  return { paid_c: CANDLE_C, text: `You drop ${CANDLE_C} centimes in the box, light a candle from another and set it on the iron stand. The small flame leans and settles.` };
}

/** Sitting during mass: the chair woman comes for her centime, once a service. Without it, she lets it go. */
export function payChair(db: DB): { paid_c: number; text: string } {
  const c = clock(db);
  const hour = c.hour + c.minute / 60;
  const m = massAt(c.day, hour);
  if (!m) return { paid_c: 0, text: "" };
  // (M8c: each player pays for his own chair; the host keeps the older key)
  const key = `chair:${c.day}:${m.from}${pid() === 1 ? "" : `:p${pid()}`}`;
  if (getState(db, key, false)) return { paid_c: 0, text: "" };
  setState(db, key, true);
  if (player(db).money_c < CHAIR_C) return { paid_c: 0, text: "The chair woman holds out her hand, looks at your coat, and moves on without a word." };
  db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(CHAIR_C, pid());
  return { paid_c: CHAIR_C, text: `The chair woman comes along the row with her bag. You give her ${CHAIR_C} centime for the chair.` };
}
