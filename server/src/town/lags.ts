import { LAG_MAX_H, settleLag, type WayOf, type WhereResident, type WhereTown } from "./whereabouts.ts";

// The progress reports (the trade plan, docs/trade-plan.md part A; whereabouts.ts reportLag): how far behind his day
// each townsperson is whom a PC walked and a crowd held up. The server keeps them in memory (a new start: everyone on
// time again), so the town map and every PC put him at the same late place (whereLate). A PC sends the lags of the
// people it walks (POST /api/town/lags); the others fetch them (GET). The server checks each one: a lag grows no
// faster than the game's clock runs (he cannot fall further behind than the time that passed), never past LAG_MAX_H.

/** A report may add this much more than the clock ran (game hours): the PCs' clocks and the ticks are not in step. */
const LAG_GRACE_H = 0.05;
/** The most people one report may carry. */
export const LAGS_MAX_IN = 120;

export class Lags {
  private readonly m = new Map<string, { lag: number; at: number }>();

  /** His lag now (game hours, 0: on time). */
  get(id: string): number {
    return this.m.get(id)?.lag ?? 0;
  }

  /**
   * A PC's report for one person at `nowH` (the game's absolute hour: (day - 1) * 24 + hour). Clamped: 0 to LAG_MAX_H,
   * no more than the clock ran since the last report (plus a little), and a first report a quarter of the most.
   * Returns the lag kept.
   */
  report(id: string, lag: number, nowH: number): number {
    if (typeof id !== "string" || !/^[a-z0-9_]{1,24}$/i.test(id) || !Number.isFinite(lag) || !Number.isFinite(nowH)) return this.get(id);
    const old = this.m.get(id);
    let next = Math.max(0, Math.min(LAG_MAX_H, lag));
    if (old) next = Math.min(next, old.lag + Math.max(0, nowH - old.at) + LAG_GRACE_H);
    else next = Math.min(next, LAG_MAX_H / 4); // (a first report: the PCs send every 2 s, so a lag comes in small steps)
    if (next <= 0) this.m.delete(id);
    else this.m.set(id, { lag: next, at: nowH });
    return next;
  }

  /** Every lag now, by resident id (game hours, three decimals). */
  all(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, v] of this.m) out[id] = Math.round(v.lag * 1000) / 1000;
    return out;
  }

  get size(): number {
    return this.m.size;
  }

  /** Lags let go where the man is at a place of his day on time again (settleLag), and of people no longer in town. */
  sweep(town: WhereTown & { residents: ReadonlyArray<WhereResident> }, day: number, hour: number, way: WayOf): void {
    if (!this.m.size) return;
    const byId = new Map(town.residents.map((r) => [r.id, r]));
    for (const [id, v] of this.m) {
      const r = byId.get(id);
      const kept = r ? settleLag(r, town, day, hour, way, v.lag) : 0;
      if (kept <= 0) this.m.delete(id);
    }
  }

  clear(): void {
    this.m.clear();
  }
}

/** The server's one set of lags (the routes in index.ts write it; the town map reads it). */
export const townLags = new Lags();
