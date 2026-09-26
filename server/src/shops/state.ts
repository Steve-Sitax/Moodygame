import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { activityAt } from "../town/schedule.ts";
import { atWork } from "../trade.ts";
import { town } from "../town/store.ts";
import type { Resident } from "../town/population.ts";
import { SHOP_LOOK, shopCallers, shopTrade, VISIT_FROM_MIN, type OpenShop, type Shopper, type ShopTrade } from "../../../shared/shops.ts";

// M7 shops: who is in a shop now (engine). The keeper and his wife while their hours run (trade.atWork: the
// schedule, and not shut by an event); the customers are townspeople out on their errands whom the engine's
// roll sends in (shared/shops.ts shopCallers, the same roll the client's town walks them to the door by): fixed for
// the game hour by the schedules and the shops' hours at its start, inside from 20 minutes past.

export interface ShopPerson {
  id: string;
  name: string;
  first: string;
  kind: string;
  sex: "m" | "f";
  age: number;
}

export interface ShopNow {
  place: string;
  label: string;
  trade: ShopTrade | null;
  open: boolean;
  keeper: ShopPerson | null;
  /** The keeper's wife or another who serves (at the counter's other end). */
  helpers: ShopPerson[];
  customers: ShopPerson[];
  smell: string;
}

const person = (r: Resident): ShopPerson => ({ id: r.id, name: r.name, first: r.first, kind: r.kind, sex: r.sex, age: r.age });

/** Every shop's door and whether it is open now (its keeper at work, not shut by an event). */
export function openShops(db: DB): OpenShop[] {
  const t = town(db).town;
  return t.shops.map((s) => ({ id: s.id, door: s.door, open: atWork(db, s.keeper) }));
}

/** The shops as the callers' roll sees them at the hour's start: open by the keeper's schedule then. */
function shopsAtHour(db: DB, day: number, hr: number): OpenShop[] {
  const t = town(db).town;
  return t.shops.map((s) => {
    const k = t.residents.find((r) => r.id === s.keeper);
    return { id: s.id, door: s.door, open: !!k && activityAt(k.sched, day, hr).act === "work" };
  });
}

let memo: { key: string; db: DB; map: Map<string, string> } | null = null;

/** Who calls at which shop this game hour (shared/shops.ts shopCallers), once per hour. */
export function callersNow(db: DB): Map<string, string> {
  const c = clock(db);
  const key = `${c.day}:${c.hour}:${town(db).town.residents.length}`;
  if (memo && memo.db === db && memo.key === key) return memo.map;
  const t = town(db).town;
  const people: Shopper[] = t.residents.map((r) => {
    const now = activityAt(r.sched, c.day, c.hour);
    const pl = t.places[now.act === "work" ? r.work.place : now.place];
    return { id: r.id, sex: r.sex, age: r.age, trade: r.trade, act: now.act, left: now.left, pos: pl ? [pl.x, pl.z] : [r.home.sx, r.home.sz] };
  });
  const map = shopCallers(people, c.day, c.hour, shopsAtHour(db, c.day, c.hour));
  memo = { key, db, map };
  return map;
}

export function shopNow(db: DB, place: string): ShopNow | null {
  const t = town(db).town;
  const s = t.shops.find((q) => q.id === place);
  if (!s) return null;
  const keeper = t.residents.find((r) => r.id === s.keeper);
  const isOpen = !!keeper && atWork(db, keeper.id);
  const trade = shopTrade(place);
  const helpers = isOpen ? t.residents.filter((r) => r.id !== s.keeper && r.work.shop === place && atWork(db, r.id)) : [];
  const customers: Resident[] = [];
  // inside from 20 minutes past the hour (the walk there first), while the shop is open now
  if (isOpen && clock(db).minute >= VISIT_FROM_MIN) {
    for (const [id, shop] of callersNow(db)) {
      if (shop !== place) continue;
      const r = t.residents.find((q) => q.id === id);
      if (r) customers.push(r);
    }
  }
  return {
    place,
    label: s.label,
    trade,
    open: isOpen,
    keeper: keeper && isOpen ? person(keeper) : null,
    helpers: helpers.map(person),
    customers: customers.map(person),
    smell: trade ? SHOP_LOOK[trade].smell : "",
  };
}
