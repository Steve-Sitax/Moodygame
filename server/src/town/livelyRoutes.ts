import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { town } from "./store.ts";
import { doorPlan, type DoorSeg } from "./doorlife.ts";
import { activityAt } from "./schedule.ts";
import { CHURCH_BEGGARS, CHURCH_STALLS, CART_TRADES, CRIER_TRADES, DOGCART_TRADES } from "./lively.ts";

// The HTTP side of M6 lively: each resident's week of door life (the engine's plan: who scrubs
// the step, sits at the door with her lace, leans out of the window, takes flowers to the
// Madonna, and when), and the fixed things of the cathedral quarter (the stalls against the
// church, the beggars' places). The client reads the plan by the clock (doorlife.ts doorAt).

export interface LivelyView {
  door: Record<string, DoorSeg[]>;
  stalls: typeof CHURCH_STALLS;
  beggars: typeof CHURCH_BEGGARS;
  carts: string[];
  dogcarts: string[];
  criers: string[];
}

export function livelyView(db: DB): LivelyView {
  const door: Record<string, DoorSeg[]> = {};
  for (const r of town(db).town.residents) {
    const plan = doorPlan({ id: r.id, sex: r.sex, age: r.age, trade: r.trade, act: (d, h) => activityAt(r.sched, d, h).act, home: r.home, stats: r.stats });
    if (plan.length) door[r.id] = plan;
  }
  return { door, stalls: CHURCH_STALLS, beggars: CHURCH_BEGGARS, carts: [...CART_TRADES], dogcarts: [...DOGCART_TRADES], criers: [...CRIER_TRADES] };
}

export function mountLively(app: Hono, deps: { db: DB }): void {
  app.get("/api/lively", (c) => c.json(livelyView(deps.db)));
}
