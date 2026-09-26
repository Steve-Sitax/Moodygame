import { describe, expect, it, vi } from "vitest";
import { blankSave } from "./blank-save.ts";
import { setWeather } from "../src/day.ts";
import { finishJob, takeJob } from "../src/game.ts";
import { jobById, TIER_PAY } from "../src/hooks/jobBoard.ts";
import { walkDist } from "../src/hooks/loads.ts";
import { waresOf } from "../src/trade.ts";
import { town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { activityAt } from "../src/town/schedule.ts";
import { lentSpot } from "../src/town/handcart.ts";
import { buildMillJob, ensureMills, generateMillers, MILL_PEOPLE, millStocks, offerMillJobs } from "../src/town/mills.ts";
import {
  BAKE_USE,
  BAKE_USE_SUNDAY,
  BAKERY_CAP,
  breadExtra,
  CART_SACKS,
  freshStocks,
  GRAIN_SACKS,
  HELP_TURNS,
  legH,
  millPay,
  millTurning,
  MILLS,
  runNow,
  runsOf,
  stepStocks,
  absMin,
} from "../../shared/mills.ts";
import SPOTS from "../../shared/spots.json" with { type: "json" };

// M7 mills (Steve 2026-09-26: "millers and transport from mill to bakery or docks or from docks, and potential
// jobs"). The ENGINE's side: the people at the mills, the carts' timetable, the stocks, the bread's price, and
// the work for Jef with its pay. No model is called here.

type DB = ReturnType<typeof blankSave>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: DB) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const trust = (db: DB, f: string) => (db.prepare("SELECT trust FROM faction_trust WHERE faction = ?").get(f) as { trust: number }).trust;
const spot = (id: string) => (SPOTS as unknown as Record<string, { x: number; z: number }>)[id];
const noReport = { delivered: 0, lost: 0, sold: 0, pocketed: false, late: false, left_post_s: 0, thief: "none" as const, bribe_taken: false, seen_away: false };

vi.setConfig({ testTimeout: 60_000 });

describe("M7 mills: the people", () => {
  it("a miller and his man at each mill, once, with homes, the mill as a place, and the cart's hours in the man's day", () => {
    const db = blankSave();
    const t = town(db).town;
    for (const m of MILLS) {
      const [millerId, manId] = MILL_PEOPLE[m.id];
      const miller = t.residents.find((r) => r.id === millerId)!;
      const man = t.residents.find((r) => r.id === manId)!;
      expect(miller.trade).toBe("miller");
      expect(man.trade).toBe("miller_man");
      expect(t.places[m.id]?.label).toBe(m.label);
      expect(miller.work.kind).toBe("post");
      expect(miller.work.at?.slice(0, 2)).toEqual(m.door);
      expect(man.work.kind).toBe("haul");
      // the homes' doors are on the walk map, the mill's door and the store too (always a path)
      const wm = walkMap();
      for (const r of [miller, man]) expect(wm.reachable(r.home.sx, r.home.sz), `${r.name}'s door`).toBe(true);
      expect(wm.nearestOpen(m.door[0], m.door[1], 1.5), `${m.label}'s door`).not.toBeNull();
      // Monday: the man is out with the flour cart at dawn and the grain cart after dinner; the miller at his mill
      const [flour, grain] = runsOf(m, 1);
      expect(activityAt(man.sched, 1, flour.from + 0.1)).toMatchObject({ act: "work", place: "flour" });
      expect(activityAt(man.sched, 1, grain.from + 0.1)).toMatchObject({ act: "work", place: "grain" });
      expect(activityAt(man.sched, 1, 11.5)).toMatchObject({ act: "work", place: "work" });
      expect(activityAt(miller.sched, 1, 10).act).toBe("work");
      expect(activityAt(miller.sched, 7, 10).act).not.toBe("work"); // Sunday the sails stand
    }
    expect(ensureMills(db)).toBe(0);
    // pure: the same seed and residents give the same people
    const base = t.residents.filter((r) => !r.id.startsWith("ml"));
    expect(generateMillers(t.seed, t.places, base).residents.map((r) => r.name)).toEqual(t.residents.filter((r) => r.id.startsWith("ml")).map((r) => r.name));
  });

  it("the stores, the bakeries' doors and the docks are on the walk map; the ways the timetable uses are the walk map's", () => {
    const db = blankSave();
    const wm = walkMap();
    for (const m of MILLS) {
      for (const id of [m.yard, m.bakeryDoor, m.grain]) {
        const s = spot(id);
        expect(wm.reachable(s.x, s.z), id).toBe(true);
      }
      // the bakery's door in the town is the door the spot stands before
      const shop = town(db).town.shops.find((s) => s.id === m.bakery)!;
      const d = spot(m.bakeryDoor);
      expect(Math.hypot(shop.door[0] - d.x, shop.door[1] - d.z), m.bakery).toBeLessThan(2.5);
      expect(Math.abs(walkDist(m.yard, m.bakeryDoor) - m.way.bakery) / m.way.bakery, `${m.id} to the bakery`).toBeLessThan(0.1);
      expect(Math.abs(walkDist(m.yard, m.grain) - m.way.grain) / m.way.grain, `${m.id} to the grain`).toBeLessThan(0.1);
      // the miller's barrow has room by the store (cart work starts there)
      expect(lentSpot(m.yard), m.yard).not.toBeNull();
    }
  });
});

describe("M7 mills: the carts' ways", () => {
  it("from the stand to the bakery and the dock through open streets; no leg of no length (the dray NaN of db527ee); stops and the stair on the walk map", () => {
    const wm = walkMap();
    for (const m of MILLS) {
      for (const [name, way] of Object.entries(m.routes)) {
        const stop = name === "bakery" ? m.stops.bakery : m.stops.dock;
        expect(way[0], `${m.id} ${name} starts at the stand`).toEqual([m.park[0], m.park[1]]);
        expect(way[way.length - 1], `${m.id} ${name} ends at the stop`).toEqual(stop);
        for (let i = 1; i < way.length; i++) {
          const [ax, az] = way[i - 1];
          const [bx, bz] = way[i];
          const L = Math.hypot(bx - ax, bz - az);
          expect(L, `${m.id} ${name} leg ${i}`).toBeGreaterThanOrEqual(2.5);
          expect(L, `${m.id} ${name} leg ${i}`).toBeLessThanOrEqual(20);
          for (let s = 0; s <= L; s += 0.5) expect(wm.open(ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L, 0.6), `${m.id} ${name} leg ${i} at ${s} m`).toBe(true);
        }
      }
      for (const p of [m.stops.bakery, m.stops.dock, [m.park[0], m.park[1]] as [number, number]]) {
        expect(wm.open(p[0], p[1], 1.2), `${m.id} ${p}`).toBe(true);
        expect(wm.reachable(p[0], p[1]), `${m.id} ${p}`).toBe(true);
      }
      for (const p of [m.stair.out, m.stair.top]) expect(wm.nearestOpen(p[0], p[1], 1), `${m.id} stair ${p}`).not.toBeNull();
    }
  });
});

describe("M7 mills: the carts and the stocks", () => {
  it("the timetable: flour out at dawn and back before noon, grain after dinner; none on Sunday; phases in order", () => {
    for (const m of MILLS) {
      const [flour, grain] = runsOf(m, 2);
      expect(flour.kind).toBe("flour");
      expect(flour.phases.map((p) => p.phase)).toEqual(["load", "go", "unload", "back"]);
      expect(flour.phases[2].from).toBeCloseTo(4.5 + 1 / 3 + legH(m.way.bakery));
      expect(flour.to).toBeLessThan(12);
      expect(grain.phases.map((p) => p.phase)).toEqual(["go", "load", "back", "store"]);
      expect(grain.to).toBeLessThan(19);
      expect(runsOf(m, 7)).toEqual([]);
      expect(runNow(m, 2, flour.phases[1].from + 0.01)?.phase).toBe("go");
      expect(runNow(m, 2, 12.5)).toBeNull();
    }
  });

  it("the wind: still in fog, braked in a gale, stopped at night and on Sunday", () => {
    expect(millTurning("clear", 2, 10)).toBe(1);
    expect(millTurning("mist", 2, 10)).toBe(0.5);
    expect(millTurning("fog", 2, 10)).toBe(0);
    expect(millTurning("storm", 2, 10)).toBe(0);
    expect(millTurning("clear", 2, 22)).toBe(0);
    expect(millTurning("clear", 7, 10)).toBe(0);
  });

  it("a clear Tuesday: the bake at three, the flour cart brings what the loft lacks, the grain run fills the store, the stones grind", () => {
    const s = freshStocks(absMin(2, 0));
    const m = MILLS[0];
    s.mills[m.id] = { grain: 4, flour: 5, ground: 0 };
    s.bakeries[m.bakery] = { flour: 4 };
    const ev = stepStocks(s, absMin(2, 3, 10), () => "clear");
    expect(ev.some((e) => e.mill === m.id && e.what === "bake" && e.n === BAKE_USE)).toBe(true);
    expect(s.bakeries[m.bakery].flour).toBe(4 - BAKE_USE);
    const [flour] = runsOf(m, 2);
    stepStocks(s, absMin(2, 0, Math.ceil(flour.phases[0].to * 60) + 5), () => "clear");
    expect(s.carts[m.id]).toBe(CART_SACKS);
    expect(s.mills[m.id].flour).toBe(5 - CART_SACKS);
    stepStocks(s, absMin(2, 0, Math.ceil(flour.to * 60)), () => "clear");
    expect(s.bakeries[m.bakery].flour).toBe(4 - BAKE_USE + CART_SACKS);
    expect(s.carts[m.id]).toBe(0);
    const before = s.mills[m.id].grain + s.mills[m.id].flour;
    stepStocks(s, absMin(2, 23), () => "clear");
    // grain came in, and the stones ground grain into flour (the sum only grows by the grain run)
    expect(s.mills[m.id].grain + s.mills[m.id].flour).toBe(before + GRAIN_SACKS);
    expect(s.mills[m.id].flour).toBeGreaterThan(5 - CART_SACKS);
  });

  it("fog: no grinding; Sunday: no carts and a small bake; the cart never overfills the loft; three days at most are worked through", () => {
    const s = freshStocks(absMin(1, 4));
    const m = MILLS[1];
    s.mills[m.id] = { grain: 5, flour: 2, ground: 0 };
    s.bakeries[m.bakery] = { flour: BAKERY_CAP };
    stepStocks(s, absMin(1, 23), () => "fog");
    expect(s.mills[m.id].flour).toBe(2); // the loft was full: nothing loaded, nothing ground
    expect(s.mills[m.id].grain).toBe(5 + GRAIN_SACKS);
    const sun = freshStocks(absMin(7, 0));
    sun.bakeries[m.bakery] = { flour: 5 };
    stepStocks(sun, absMin(7, 23), () => "clear");
    expect(sun.bakeries[m.bakery].flour).toBe(5 - BAKE_USE_SUNDAY);
    expect(sun.carts[m.id]).toBe(0);
    const far = freshStocks(absMin(1, 0));
    stepStocks(far, absMin(40, 0), () => "clear");
    expect(far.at).toBe(absMin(40, 0));
  });

  it("the bread's price: a centime more when the loft is near empty, two when it is empty, never more", () => {
    expect([breadExtra(5), breadExtra(2), breadExtra(1), breadExtra(0), breadExtra(-3)]).toEqual([0, 0, 1, 2, 2]);
    const db = blankSave();
    setClock(db, 2, 10);
    const m = MILLS[0];
    const baker = town(db).town.shops.find((s) => s.id === m.bakery)!.keeper;
    const s = millStocks(db);
    s.bakeries[m.bakery].flour = 0;
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'mills'").run(JSON.stringify(s));
    const bread = () => waresOf(db, baker).find((w) => w.kind === "bread")!.price_c;
    expect(bread()).toBe(8);
    s.bakeries[m.bakery].flour = 1;
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'mills'").run(JSON.stringify(s));
    expect(bread()).toBe(7);
    s.bakeries[m.bakery].flour = 6;
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'mills'").run(JSON.stringify(s));
    expect(bread()).toBe(6);
    // the other bakery's bread is not moved by this one's loft
    const other = town(db).town.shops.find((q) => q.id === MILLS[1].bakery)!.keeper;
    expect(waresOf(db, other).find((w) => w.kind === "bread")!.price_c).toBe(6 + breadExtra(s.bakeries[MILLS[1].bakery].flour));
  });
});

describe("M7 mills: the work", () => {
  const stock = (db: DB, f: (s: ReturnType<typeof millStocks>) => void) => {
    const s = millStocks(db);
    f(s);
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'mills'").run(JSON.stringify(s));
  };

  it("pay by the way and the weight, in the tier's band; a barrow load in the cart band", () => {
    const band = TIER_PAY[0] as [number, number];
    expect(millPay(1, 50, false, band)).toBe(50);
    expect(millPay(1, 337, false, band)).toBe(120);
    expect(millPay(1, 200, false, band)).toBeLessThan(millPay(1, 337, false, band));
    expect(millPay(2, 337, false, band)).toBe(150);
    expect(millPay(3, 150, true, band)).toBeGreaterThanOrEqual(100);
    expect(millPay(3, 400, true, band)).toBe(150);
  });

  it("the loft runs low: the baker wants a sack from the store; taken, it is set aside; brought, it is in the loft, paid, and trusted", () => {
    const db = blankSave();
    setClock(db, 2, 8);
    setWeather(db, "fog");
    const m = MILLS[0];
    stock(db, (s) => {
      s.bakeries[m.bakery].flour = 1;
      s.mills[m.id].flour = 4;
      s.mills[m.id].grain = 8;
    });
    const ids = offerMillJobs(db);
    expect(ids.length).toBeGreaterThan(0);
    const jobs = ids.map((id) => jobById(db, id)!);
    const flour = jobs.find((j) => j.task?.kind === "carry" && j.task.from === m.yard)!;
    expect(flour).toBeTruthy();
    expect(flour.employer_npc).toBe(town(db).town.shops.find((s) => s.id === m.bakery)!.keeper);
    expect(flour.task).toMatchObject({ kind: "carry", goods: "sacks", from: m.yard, to: m.bakeryDoor });
    expect(flour.pay_c).toBeGreaterThanOrEqual(50);
    expect(flour.pay_c).toBeLessThanOrEqual(150);
    expect(flour.pitch).toMatch(/flour/);
    // fog: no help at a still mill; the grain is plenty: no grain job
    expect(jobs.some((j) => j.task?.kind === "mill")).toBe(false);
    expect(jobs.some((j) => j.employer_npc === MILL_PEOPLE[m.id][0])).toBe(false);
    // once a day
    expect(offerMillJobs(db).filter((id) => jobById(db, id)!.employer_npc === flour.employer_npc)).toEqual([]);
    const count = flour.task!.kind === "carry" ? flour.task!.count : 0;
    takeJob(db, flour.id);
    expect(millStocks(db).mills[m.id].flour).toBe(4 - count);
    const m0 = money(db);
    const t0 = trust(db, "burgerij");
    const r = finishJob(db, flour.id, { ...noReport, delivered: count });
    expect(r.settlement.status).toBe("done");
    expect(money(db)).toBe(m0 + flour.pay_c);
    expect(trust(db, "burgerij")).toBe(t0 + 1);
    expect(millStocks(db).bakeries[m.bakery].flour).toBe(1 + count);
  });

  it("the mill runs low on grain: the miller wants grain from the dock; brought, it is in the store", () => {
    const db = blankSave();
    setClock(db, 3, 9);
    setWeather(db, "fog");
    const m = MILLS[1];
    stock(db, (s) => {
      s.mills[m.id].grain = 1;
      s.bakeries[m.bakery].flour = 7;
    });
    const j = offerMillJobs(db).map((id) => jobById(db, id)!).find((q) => q.employer_npc === MILL_PEOPLE[m.id][0])!;
    expect(j.task).toMatchObject({ kind: "carry", from: m.grain, to: m.yard, goods: "sacks" });
    takeJob(db, j.id);
    const n = j.task!.kind === "carry" ? j.task!.count : 0;
    finishJob(db, j.id, { ...noReport, delivered: n });
    expect(millStocks(db).mills[m.id].grain).toBe(1 + n);
  });

  it("an hour's help on a windy working day: the pay by the turns of the cap; a turned cap grinds a sack more", () => {
    const db = blankSave();
    setClock(db, 2, 9);
    setWeather(db, "clear");
    const m = MILLS[0];
    stock(db, (s) => {
      s.mills[m.id].grain = 6;
      s.mills[m.id].flour = 2;
      s.bakeries[m.bakery].flour = 7;
    });
    const help = offerMillJobs(db).map((id) => jobById(db, id)!).find((q) => q.task?.kind === "mill")!;
    expect(help.employer_npc).toBe(MILL_PEOPLE[m.id][0]);
    expect(help.task).toMatchObject({ kind: "mill", mill: m.id, turns: HELP_TURNS });
    takeJob(db, help.id);
    const m0 = money(db);
    const r = finishJob(db, help.id, { ...noReport, turns: HELP_TURNS });
    expect(r.settlement.pay_c).toBe(help.pay_c);
    expect(money(db)).toBe(m0 + help.pay_c);
    expect(millStocks(db).mills[m.id].flour).toBe(3);
    // half turned: three quarters of the pay; nothing and away: failed
    const again = buildMillJob(db, m, "help")!;
    const db2 = blankSave();
    setClock(db2, 2, 9);
    setWeather(db2, "clear");
    const h2 = offerMillJobs(db2).map((id) => jobById(db2, id)!).find((q) => q.task?.kind === "mill")!;
    takeJob(db2, h2.id);
    expect(finishJob(db2, h2.id, { ...noReport, turns: 1 }).settlement.pay_c).toBe(Math.round((again.pay_c * 0.75) / 5) * 5);
    const db3 = blankSave();
    setClock(db3, 2, 9);
    setWeather(db3, "clear");
    const h3 = offerMillJobs(db3).map((id) => jobById(db3, id)!).find((q) => q.task?.kind === "mill")!;
    takeJob(db3, h3.id);
    expect(finishJob(db3, h3.id, { ...noReport, turns: 0, left_post_s: 300 }).settlement.status).toBe("failed");
  });

  it("with the miller's barrow: three sacks from the store, the cart lent there; the twists are the carry twists", () => {
    const db = blankSave();
    setClock(db, 2, 8);
    const j = buildMillJob(db, MILLS[0], "flour", { cart: true, twist: "broken_goods" })!;
    expect(j.task).toMatchObject({ kind: "carry", count: 3, cart: true, twist: "broken_goods", from: "mill_yard" });
    expect(j.pay_c).toBeGreaterThanOrEqual(100);
    const heavy = buildMillJob(db, MILLS[0], "flour", { cart: true, twist: "heavy_load" })!;
    expect(heavy.task.twist).toBe("none");
  });
});
