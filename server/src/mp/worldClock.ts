import type { DB } from "../db.ts";

// M8a multiplayer (docs/multiplayer-plan.md 5.3): the world's clock lives in world_state ('clock'), not on
// player 1's row. It is one clock for every player; the server moves it itself in multiplayer
// (mp/index.ts serverTick) and on the host's tick in single player, as before.
//
// Until the player id refactor (M8c) about forty engine queries still read day, hour and minute from the
// player row. So the row keeps a copy: setWorldClock writes both, and a trigger copies any other write of
// the row's clock (older code, the tests, a dev route) into world_state, so the two never part. In M8c the
// row loses its clock and the copy goes.

/** The trigger that keeps world_state's clock in step with the player row (db.ts migrate runs it). */
export const WORLD_CLOCK_SQL = /* sql */ `
CREATE TRIGGER IF NOT EXISTS world_clock_follow AFTER UPDATE OF day, hour, minute ON player WHEN NEW.id = 1
BEGIN
  INSERT OR REPLACE INTO world_state (key, value_json) VALUES ('clock', json_object('day', NEW.day, 'hour', NEW.hour, 'minute', NEW.minute));
END;
CREATE TRIGGER IF NOT EXISTS world_clock_seed AFTER INSERT ON player WHEN NEW.id = 1
BEGIN
  INSERT OR REPLACE INTO world_state (key, value_json) VALUES ('clock', json_object('day', NEW.day, 'hour', NEW.hour, 'minute', NEW.minute));
END;
`;

export interface WorldTime {
  day: number;
  hour: number;
  minute: number;
}

const ok = (n: unknown, lo: number, hi: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

/** The world's clock. A save from before M8a has none in world_state: it is taken from the player row once. */
export function worldClock(db: DB): WorldTime {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'clock'").get() as { value_json: string } | undefined;
  if (row) {
    try {
      const c = JSON.parse(row.value_json) as Partial<WorldTime>;
      if (ok(c.day, 1, 9999) && ok(c.hour, 0, 23) && ok(c.minute, 0, 59)) return { day: c.day, hour: c.hour, minute: c.minute };
    } catch {
      /* a broken record: from the row below */
    }
  }
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as WorldTime | undefined;
  const c = p ? { day: p.day, hour: p.hour, minute: p.minute ?? 0 } : { day: 1, hour: 6, minute: 0 };
  db.prepare("INSERT OR REPLACE INTO world_state (key, value_json) VALUES ('clock', ?)").run(JSON.stringify(c));
  return c;
}

/** Set the world's clock (and player 1's copy of it, until M8c). */
export function setWorldClock(db: DB, c: WorldTime): void {
  db.prepare("INSERT OR REPLACE INTO world_state (key, value_json) VALUES ('clock', ?)").run(JSON.stringify({ day: c.day, hour: c.hour, minute: c.minute }));
  db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(c.day, c.hour, c.minute);
}
