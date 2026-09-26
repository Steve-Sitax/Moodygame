import { activityAt } from "../../../server/src/town/schedule";
import { shopCallers, type OpenShop, type Shopper } from "../../../shared/shops";
import type { Pt, TownData, TownResident } from "../net/api";

// M7 shops (docs/milestones/M7-shops.md): the client's side of the engine's roll of who calls at which shop in
// a game hour (shared/shops.ts shopCallers, the same roll the server's shops/state.ts lists the customers by).
// The town (game/town.ts shopCall) walks each caller to the shop's door at the hour's start and in; the shop's
// life (game/interiors.ts) shows them inside once the server says so, 20 minutes past the hour.

export function shopCaller(data: () => TownData | null): (r: TownResident, day: number, hour: number) => Pt | null {
  let memo: { key: string; map: Map<string, string>; doors: Map<string, Pt> } | null = null;
  const callers = (d: TownData, day: number, hr: number) => {
    const key = `${day}:${hr}:${d.residents.length}:${d.shops.length}`;
    if (memo?.key === key) return memo;
    const people: Shopper[] = d.residents.map((r) => {
      const now = activityAt(r.sched, day, hr);
      const pl = d.places[now.act === "work" ? r.work.place : now.place];
      return { id: r.id, sex: r.sex, age: r.age, trade: r.trade, act: now.act, left: now.left, pos: pl ? [pl.x, pl.z] : [r.home.sx, r.home.sz] };
    });
    const shops: OpenShop[] = d.shops.map((s) => {
      const k = d.residents.find((r) => r.id === s.keeper);
      return { id: s.id, door: s.door, open: !!k && activityAt(k.sched, day, hr).act === "work" };
    });
    memo = { key, map: shopCallers(people, day, hr, shops), doors: new Map(d.shops.map((s) => [s.id, s.door])) };
    return memo;
  };
  return (r, day, hour) => {
    const d = data();
    if (!d) return null;
    const m = callers(d, day, Math.floor(hour));
    const shop = m.map.get(r.id);
    return shop ? (m.doors.get(shop) ?? null) : null;
  };
}
