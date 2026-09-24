import type { DB } from "../db.ts";

// The news from abroad moves prices (ideas/abroad.ts). This file has no other
// imports, so trade.ts can read the factor without pulling the paper in.
// A news row holds its factors per item and the days it lasts; the factor of an
// item is the product of the rows that run today, kept within 0.5x to 3x.

export function newsFactor(db: DB, item: string): number {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number } | undefined)?.day ?? 1;
  let f = 1;
  const rows = db.prepare("SELECT prices_json FROM news_abroad WHERE day <= ? AND until_day >= ?").all(day, day) as Array<{ prices_json: string }>;
  for (const r of rows) {
    const p = (JSON.parse(r.prices_json) as Record<string, { factor: number }>)[item];
    if (p && Number.isFinite(p.factor) && p.factor > 0) f *= p.factor;
  }
  return Math.max(0.5, Math.min(3, f));
}
