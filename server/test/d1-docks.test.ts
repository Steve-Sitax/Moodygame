import { describe, expect, it, vi } from "vitest";
import { blankSave } from "./blank-save.ts";
import { GoodsStore } from "../src/goods/store.ts";
import { installHaulFlow, haulRouteFor } from "../src/goods/haulFlow.ts";
import { town } from "../src/town/store.ts";
import { CRANE_FED, HAUL_PILE_N, HAUL_ROUTES } from "../../shared/hauls.ts";

// D1 docks (docs/milestones/D1-docks.md): the dockers' piles are real goods. A docker lifts the top load of his own
// route's pile and sets it down at the route's other end; a crane refills the piles it reaches, one swing at a time;
// dawn lays every pile whole again.

vi.setConfig({ testTimeout: 60_000 });
installHaulFlow();

function dockerOn(db: ReturnType<typeof blankSave>, route: string): string {
  const r = town(db).town.residents.find((q) => haulRouteFor(db, q.id)?.id === route);
  if (!r) throw new Error(`no docker on ${route}`);
  return r.id;
}
const pileOf = (s: GoodsStore, route: string, tag: "a" | "b") => s.list().filter((it) => it.id.startsWith(`haul:${route}${tag}:`) && !it.by);

describe("D1: the dockers' piles for real", () => {
  it("a docker lifts only the top load of his own route's pile, and sets it in at the other end", () => {
    const db = blankSave();
    const s = new GoodsStore();
    const route = HAUL_ROUTES.find((r) => CRANE_FED.has(r.id) && town(db).town.residents.some((q) => haulRouteFor(db, q.id)?.id === r.id))!;
    const npc = dockerOn(db, route.id);
    expect(pileOf(s, route.id, "a").length).toBe(HAUL_PILE_N);
    // the bottom one has loads on it
    const bottom = `haul:${route.id}a:0`;
    expect(s.ask(db, 1, { op: "npc_lift", npc, ids: [bottom] })).toMatchObject({ ok: false });
    const top = `haul:${route.id}a:${HAUL_PILE_N - 1}`;
    expect(s.ask(db, 1, { op: "npc_lift", npc, ids: [top] }).ok).toBe(true);
    expect(pileOf(s, route.id, "a").length).toBe(HAUL_PILE_N - 1);
    // another route's docker may not lift from this pile
    const other = HAUL_ROUTES.find((r) => r.id !== route.id && town(db).town.residents.some((q) => haulRouteFor(db, q.id)?.id === r.id))!;
    const npc2 = dockerOn(db, other.id);
    expect(s.ask(db, 1, { op: "npc_lift", npc: npc2, ids: [`haul:${route.id}a:3`] })).toMatchObject({ ok: false });
    // in at the other end: gone from his hands (onto the drop pile when it has room)
    const r = s.ask(db, 1, { op: "haul_in", npc, id: top });
    expect(r.ok).toBe(true);
    expect(s.get(top)).toBeNull();
    // not his to set in twice
    expect(s.ask(db, 1, { op: "haul_in", npc, id: top }).ok).toBe(false);
  });

  it("a crane refills a pile it reaches, one swing at a time; a whole pile or a pile no crane reaches is refused", () => {
    vi.useFakeTimers();
    try {
      const db = blankSave();
      const s = new GoodsStore();
      const route = HAUL_ROUTES.find((r) => CRANE_FED.has(r.id) && town(db).town.residents.some((q) => haulRouteFor(db, q.id)?.id === r.id))!;
      expect(s.ask(db, 1, { op: "crane_put", route: route.id })).toMatchObject({ ok: false, why: "The pile is whole." });
      const npc = dockerOn(db, route.id);
      const top = `haul:${route.id}a:${HAUL_PILE_N - 1}`;
      expect(s.ask(db, 1, { op: "npc_lift", npc, ids: [top] }).ok).toBe(true);
      expect(s.ask(db, 1, { op: "haul_in", npc, id: top }).ok).toBe(true);
      vi.advanceTimersByTime(10_000);
      const put = s.ask(db, 1, { op: "crane_put", route: route.id });
      expect(put.ok).toBe(true);
      expect(s.get(top)).not.toBeNull();
      expect(pileOf(s, route.id, "a").length).toBe(HAUL_PILE_N);
      const unfed = HAUL_ROUTES.find((q) => !CRANE_FED.has(q.id))!;
      expect(s.ask(db, 1, { op: "crane_put", route: unfed.id })).toMatchObject({ ok: false, why: "No crane reaches that pile." });
      // two swings closer than a crane can make them
      const npc3 = npc;
      expect(s.ask(db, 1, { op: "npc_lift", npc: npc3, ids: [top] }).ok).toBe(true);
      expect(s.ask(db, 1, { op: "haul_in", npc: npc3, id: top }).ok).toBe(true);
      expect(s.ask(db, 1, { op: "crane_put", route: route.id })).toMatchObject({ ok: false, why: "The crane is still swinging." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("dawn lays every pile whole again; a load in someone's hands stays there", () => {
    const db = blankSave();
    const s = new GoodsStore();
    const route = HAUL_ROUTES.find((r) => town(db).town.residents.some((q) => haulRouteFor(db, q.id)?.id === r.id))!;
    const npc = dockerOn(db, route.id);
    const top = `haul:${route.id}a:${HAUL_PILE_N - 1}`;
    const next = `haul:${route.id}a:${HAUL_PILE_N - 2}`;
    expect(s.ask(db, 1, { op: "npc_lift", npc, ids: [top] }).ok).toBe(true);
    expect(s.ask(db, 1, { op: "haul_in", npc, id: top }).ok).toBe(true);
    expect(s.ask(db, 1, { op: "npc_lift", npc, ids: [next] }).ok).toBe(true);
    s.haulDawn();
    expect(s.get(top)?.by).toBeNull();
    expect(s.get(next)?.by).toEqual({ npc });
    // the lying pile: whole but for the load he holds
    expect(pileOf(s, route.id, "a").length).toBe(HAUL_PILE_N - 1);
  });
});

describe("D1: the boats fill the piles nobody watches", () => {
  it("a pile that lacks loads gets one every few minutes on a weekday, never while a player stands near it", async () => {
    const { goods } = await import("../src/goods/store.ts");
    const { haulSupplyTick, SUPPLY_EVERY_MIN, SUPPLY_UNSEEN_M } = await import("../src/goods/haulFlow.ts");
    goods.reset(false);
    const db = blankSave();
    const route = HAUL_ROUTES.find((r) => town(db).town.residents.some((q) => haulRouteFor(db, q.id)?.id === r.id))!;
    const npc = dockerOn(db, route.id);
    const top = `haul:${route.id}a:${HAUL_PILE_N - 1}`;
    expect(goods.ask(db, 1, { op: "npc_lift", npc, ids: [top] }).ok).toBe(true);
    expect(goods.ask(db, 1, { op: "haul_in", npc, id: top }).ok).toBe(true);
    const near = [{ x: route.pile.x + 5, z: route.pile.z }];
    const far = [{ x: route.pile.x + SUPPLY_UNSEEN_M + 5, z: route.pile.z }];
    // day 2 (a Monday), 10:00: watched, nothing comes
    haulSupplyTick(2, 600, near);
    expect(goods.get(top)).toBeNull();
    // out of sight, after the interval: one load
    haulSupplyTick(2, 600 + SUPPLY_EVERY_MIN, far);
    expect(goods.get(top)).not.toBeNull();
    // a Sunday: nothing
    expect(goods.ask(db, 1, { op: "npc_lift", npc, ids: [top] }).ok).toBe(true);
    expect(goods.ask(db, 1, { op: "haul_in", npc, id: top }).ok).toBe(true);
    haulSupplyTick(7, 600, far);
    expect(goods.get(top)).toBeNull();
    goods.reset(false);
  });
});

describe("D1: the foreman's book, paid by the piece", () => {
  it("without the book the natie's loads are not his; in the book he lifts, sets in at the end and is paid by the piece", async () => {
    const { askBook, hasBook } = await import("../src/goods/haulFlow.ts");
    const { haulPay } = await import("../../shared/hauls.ts");
    const { setPositionSource } = await import("../src/player/current.ts");
    const db = blankSave();
    const s = new GoodsStore();
    const route = HAUL_ROUTES[0];
    const top = `haul:${route.id}a:${HAUL_PILE_N - 1}`;
    setPositionSource(() => ({ x: route.pile.x, z: route.pile.z + 1 }));
    try {
      expect(s.ask(db, 1, { op: "lift", id: top })).toMatchObject({ ok: false });
      expect(hasBook(db, 1)).toBe(false);
      // a Sunday or at night: no book
      expect(askBook(db, 1, 7, 10).ok).toBe(false);
      expect(askBook(db, 1, 2, 22).ok).toBe(false);
      // a Monday morning: written in
      expect(askBook(db, 1, 2, 9).ok).toBe(true);
      expect(hasBook(db, 1)).toBe(true);
      expect(s.ask(db, 1, { op: "lift", id: top }).ok).toBe(true);
      // not at the end yet: too far to set it in
      expect(s.ask(db, 1, { op: "haul_deliver", id: top }).ok).toBe(false);
      setPositionSource(() => ({ x: route.b[0], z: route.b[1] }));
      const before = (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
      expect(s.ask(db, 1, { op: "haul_deliver", id: top }).ok).toBe(true);
      const after = (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
      expect(after - before).toBe(haulPay(route));
      expect(s.get(top)).toBeNull();
    } finally {
      setPositionSource(null);
    }
  });

  it("a piece pays less than any job: 2 to 12 c by the way and the load", async () => {
    const { haulPay } = await import("../../shared/hauls.ts");
    for (const r of HAUL_ROUTES) {
      const c = haulPay(r);
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(12);
    }
  });
});
