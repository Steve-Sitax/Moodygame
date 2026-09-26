import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { NIGHT_GIVER_IDS } from "../../shared/night.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRehomed, plainHome, staleIds } from "./oldSave.ts";
import Database from "better-sqlite3";
import { openDb } from "../src/db.ts";
import { buy } from "../src/trade.ts";
import { crimeOpen } from "../src/director/actions.ts";
import { RIDE_FARE_C } from "../src/ride.ts";
import { resident, town } from "../src/town/store.ts";
import { OUTSIDE, WALL, WATER, walkMap } from "../src/town/walkmap.ts";
import { stealables, takeThing, veloStates, leaveVelo, deedWorld } from "../src/town/deeds.ts";
import { rowBoats } from "../src/rowing.ts";
import { isLivelyId } from "../src/town/lively.ts";
import {
  ensureTransport,
  errandsFor,
  flightBerth,
  farFor,
  offLanes,
  ownerMissed,
  transportRecord,
  transportView,
  vehicleNow,
  makeTransport,
  keysOf,
} from "../src/town/possessions.ts";
import { bikeHour, busyAt, ensureBikeShop, jefSeen, jefVelos, SHOP_ID, veloShop } from "../src/town/bikeshop.ts";
import {
  chooseMode,
  omnibusPlan,
  planLoading,
  scheduleLoad,
  vehicleAt,
  waterPath,
  pathLength,
  VELO_FETCH_FEE_C,
  VELO_HIRE_HOURS,
  VELO_PRICE,
  WALK_MAX_M,
  type Pt,
  type Stop,
} from "../src/town/transport.ts";

type DB = ReturnType<typeof openDb>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: DB) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: DB, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const never = () => 0.999;
const always = () => 0;

function fresh(hour = 10, day = 2): DB {
  const db = openDb(":memory:");
  setClock(db, day, hour);
  return db;
}

/** The omnibus stops as world/omnibus.ts has them (id, line, x, z). */
const STOPS: Stop[] = [
  { id: "werf", line: "kaaien", x: -270, z: 8.3 },
  { id: "steenplein", line: "kaaien", x: -180, z: 8.3 },
  { id: "vismarkt", line: "kaaien", x: -112, z: 8.3 },
  { id: "rijnkaai", line: "kaaien", x: 30, z: 8.3 },
  { id: "bassin", line: "kaaien", x: 76, z: 31 },
  { id: "vismarkt", line: "markt", x: -96, z: 31 },
  { id: "vleeshuis", line: "markt", x: -118, z: 114 },
  { id: "grote_markt", line: "markt", x: -257, z: 70 },
  { id: "cathedral", line: "markt", x: -248, z: 129.8 },
  { id: "meir", line: "markt", x: -145, z: 198 },
  { id: "brouwersvliet", line: "markt", x: -84.5, z: 180 },
];

// ------------------------------------------------------------------ the migration

describe("who owns what (the migration)", () => {
  it("a town gets velocipedes, handcarts, drays and boats by trade and wealth, on open ground off the lanes", () => {
    const db = fresh();
    const rec = transportRecord(db)!;
    expect(rec).toBeTruthy();
    const t = town(db);
    const kinds = (k: string) => rec.vehicles.filter((v) => v.kind === k);
    // velocipedes: the six of M3h and a few more, one to a man
    const velos = kinds("velocipede");
    expect(velos.length).toBeGreaterThanOrEqual(7);
    expect(velos.length).toBeLessThanOrEqual(12);
    expect(new Set(velos.map((v) => v.owner)).size).toBe(velos.length);
    for (const v of rec.extraVelos) {
      const r = t.byId.get(v.owner)!;
      expect(r.sex).toBe("m");
      expect(r.age).toBeGreaterThanOrEqual(17);
    }
    // someone of them goes far in his day (so a velocipede is ridden)
    expect(velos.some((v) => Object.keys(v.parks).length > 1)).toBe(true);
    // handcarts: one per household, of the trades that use one
    const carts = kinds("handcart");
    expect(carts.length).toBeGreaterThanOrEqual(8);
    expect(new Set(carts.map((v) => v.household)).size).toBe(carts.length);
    for (const c of carts) expect(["carter", "market_woman", "fishwife", "grocer", "dealer", "chandler"]).toContain(t.byId.get(c.owner)!.trade);
    // drays: the three of the quay traffic, carters and a merchant
    const drays = kinds("dray");
    expect(drays.map((d) => d.route).sort()).toEqual(["eilandje", "rijnkaai_back", "werf"]);
    for (const d of drays) expect(["carter", "merchant"]).toContain(t.byId.get(d.owner)!.trade);
    // boats: the boats tied up at the steps, and their owners
    expect(kinds("boat").map((b) => b.id).sort()).toEqual(rowBoats(db).map((b) => b.id).sort());
    // every spot on open, reachable ground with room round it, off the omnibus, the drays and the rails
    const wm = walkMap();
    for (const v of [...velos, ...carts]) {
      for (const [key, s] of Object.entries(v.parks)) {
        expect(wm.open(s[0], s[1], v.kind === "handcart" ? 1.2 : 0.4), `${v.id} ${key} open`).toBe(true);
        expect(wm.reachable(s[0], s[1]), `${v.id} ${key} reachable`).toBe(true);
        if (!(v.kind === "velocipede" && key === "home" && !rec.extraVelos.some((e) => e.id === v.id))) expect(offLanes(s[0], s[1], 0.5), `${v.id} ${key} off the lanes`).toBe(true);
      }
    }
  });

  it("the same town always gets the same things", () => {
    const a = fresh();
    const b = fresh();
    expect(makeTransport(a)).toEqual(makeTransport(b));
  });

  it("an older save gets its vehicles and the velocipede maker in place; nothing else changes", () => {
    const db = fresh();
    // make it a save from before M6 transport
    db.prepare("DELETE FROM world_state WHERE key IN ('transport', 'veloshop')").run();
    for (const t of ["npc_relationship WHERE npc_id", "resident WHERE id", "npc WHERE id"]) db.prepare(`DELETE FROM ${t} = ?`).run(SHOP_ID);
    const rows = new Map((db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json]));
    const mem = (db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n;
    const jef = db.prepare("SELECT * FROM player WHERE id = 1").get();
    const velos = db.prepare("SELECT value_json FROM world_state WHERE key = 'velos'").get();
    expect(ensureBikeShop(db)).toBe(true);
    expect(ensureTransport(db).made).toBe(true);
    const after = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
    expect(after.length).toBe(rows.size + 1);
    for (const r of after) if (r.id !== SHOP_ID) expect(r.data_json).toBe(rows.get(r.id));
    expect((db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n).toBe(mem);
    expect(db.prepare("SELECT * FROM player WHERE id = 1").get()).toEqual(jef);
    expect(db.prepare("SELECT value_json FROM world_state WHERE key = 'velos'").get()).toEqual(velos);
    // once: a second start changes nothing
    expect(ensureTransport(db).made).toBe(false);
    expect(ensureBikeShop(db)).toBe(false);
  });

  it("on a copy of a real older save (data/test-transport-old.sqlite): made in place, residents and memories kept", () => {
    const src = join(import.meta.dirname, "..", "..", "data", "test-transport-old.sqlite");
    if (!existsSync(src)) return; // the copy is made by hand for the milestone check
    const dir = mkdtempSync(join(tmpdir(), "transport-"));
    const file = join(dir, "old.sqlite");
    copyFileSync(src, file);
    try {
      // read the old save first, untouched (no migration)
      const raw = new Database(file, { readonly: true });
      const before = new Map((raw.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json]));
      const mem = (raw.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n;
      const hadTransport = !!raw.prepare("SELECT 1 FROM world_state WHERE key = 'transport'").get();
      raw.close();
      expect(hadTransport).toBe(false);
      const db = openDb(file);
      expect(transportRecord(db)!.vehicles.length).toBeGreaterThan(20);
      expect(veloShop(db)).toBeTruthy();
      const after = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
      // a lamplighter's round follows the lamps (town/lamplighters.ts, versioned): a moved lamp may change it, and
      // M7 lamps (LAMPS_VERSION 6 to 9) gives the market quarter a third lamplighter: a docker or a porter takes the
      // trade. The lamp migration owns a lamplighter's trade, work and day; the rest of him stays.
      const lit = (j: string) => (JSON.parse(j) as { trade?: string }).trade === "lamplighter";
      // a home of the older map whose house has no door at its step now: the load repairs (store.ts rehomeLost,
      // emigrants.ts rehouseEmigrants) own its home and a work door there; checked on their own (test/oldSave.ts)
      const moved = staleIds(before);
      const plain = (j: string, lamps: boolean, id: string) => {
        const o = JSON.parse(j) as Record<string, unknown>;
        if (lamps) for (const k of ["trade", "faction", "work", "sched"]) delete o[k];
        // (a map change moves a round's point off new walls: repairTown owns work.route; 2026-09-25 angled streets)
        if (o.work && typeof o.work === "object") delete (o.work as Record<string, unknown>).route;
        if (moved.has(id)) plainHome(o, before.get(id)!);
        return JSON.stringify(o);
      };
      for (const r of after) if (before.has(r.id)) expect(plain(r.data_json, lit(r.data_json), r.id), r.id).toBe(plain(before.get(r.id)!, lit(r.data_json), r.id));
      checkRehomed(before, after, moved);
      expect(after.filter((r) => lit(r.data_json)).length).toBe(3);
      const newLighters = after.filter((r) => before.has(r.id) && lit(r.data_json) && !lit(before.get(r.id)!));
      expect(newLighters.length).toBeLessThanOrEqual(1);
      for (const r of newLighters) expect(["docker", "porter"]).toContain((JSON.parse(before.get(r.id)!) as { trade: string }).trade);
      // the velocipede maker, and the wheelwright (M6 handcart, town/handcart.ts); M6 lively adds its own people after them,
      // and M7 night the four givers of night work (night/givers.ts)
      expect(after.filter((r) => !isLivelyId(r.id) && !(NIGHT_GIVER_IDS as readonly string[]).includes(r.id)).length).toBe(before.size + 2);
      expect((db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n).toBe(mem);
      db.close();
    } finally {
      // Windows may still hold the save a moment after close: retry, and a leftover temp folder is harmless
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // left for the OS to clear
      }
    }
  });
});

// ------------------------------------------------------------------ the mode

describe("how they go: by distance, load and what they own", () => {
  const A: Pt = [0, 0];
  const near: Pt = [120, 50];
  const far: Pt = [380, 90];
  it("a short trip is walked, whatever they own", () => {
    expect(chooseMode({ from: A, to: near, has: { velocipede: true, handcart: true } }).mode).toBe("walk");
  });
  it("a long trip with the velocipede at hand is ridden; without it, walked", () => {
    expect(chooseMode({ from: A, to: far, has: { velocipede: true }, age: 30 }).mode).toBe("velocipede");
    expect(chooseMode({ from: A, to: far, has: {}, age: 30 }).mode).toBe("walk");
    // a child or an old man does not ride
    expect(chooseMode({ from: A, to: far, has: { velocipede: true }, age: 11 }).mode).toBe("walk");
    expect(chooseMode({ from: A, to: far, has: { velocipede: true }, age: 70 }).mode).toBe("walk");
    expect(Math.hypot(far[0], far[1])).toBeGreaterThan(WALK_MAX_M);
  });
  it("a load takes the cart, a big load the dray, water both ends the boat; nothing to put it on: by hand", () => {
    const load = { what: "goods" as const, items: 2 };
    expect(chooseMode({ from: A, to: near, load, has: { handcart: true } }).mode).toBe("handcart");
    expect(chooseMode({ from: A, to: near, load: { what: "sacks", items: 4 }, has: { handcart: true, dray: true } }).mode).toBe("dray");
    expect(chooseMode({ from: A, to: near, load, has: { handcart: true, dray: true } }).mode).toBe("handcart");
    expect(chooseMode({ from: A, to: near, load, has: { handcart: true, boat: true }, water: { from: [5, 0], to: [118, 45] } }).mode).toBe("boat");
    expect(chooseMode({ from: A, to: near, load, has: { boat: true }, water: null }).mode).toBe("walk");
    // a load beats the velocipede on a long trip
    expect(chooseMode({ from: A, to: far, load, has: { velocipede: true, handcart: true } }).mode).toBe("handcart");
  });
  it("a family going along the water rows; one alone walks", () => {
    const water = { from: [5, 0] as Pt, to: [150, 0] as Pt };
    expect(chooseMode({ from: A, to: [160, 10], group: 3, has: { boat: true }, water }).mode).toBe("boat");
    expect(chooseMode({ from: A, to: [160, 10], group: 1, has: { boat: true }, water }).mode).toBe("walk");
  });
  it("the day says where there is a load: sellers to the stall in the morning, the rest home at night", () => {
    expect(scheduleLoad("market_woman", 3, "home", "work:work")).toEqual({ what: "goods", items: 3 });
    expect(scheduleLoad("fishwife", 1, "home", "work:work")?.what).toBe("fish");
    expect(scheduleLoad("market_woman", 3, "work:work", "home")?.items).toBe(1);
    expect(scheduleLoad("docker", 3, "home", "work:work")).toBeNull();
    expect(scheduleLoad("market_woman", 3, "work:work", "tavern:tavern:engel")).toBeNull();
  });
  it("an owner's velocipede leaves the house for a long trip and comes home with him", () => {
    const r = { sched: { day: [[8, 12, "work"], [12, 13, "tavern", "tavern:x"], [13, 18, "work"]] as Array<[number, number, "work" | "tavern", string?]>, sunday: [] } };
    const far = (a: string, b: string) => (a === "home" && b === "work:work") || (a === "work:work" && b === "home");
    const parks = { home: 1, "work:work": 1, "tavern:tavern:x": 1 };
    expect(vehicleAt(r, 2, 7, far, parks).at).toBe("home");
    expect(vehicleAt(r, 2, 9, far, parks).at).toBe("work:work");
    expect(vehicleAt(r, 2, 12.5, far, parks).at).toBe("tavern:tavern:x"); // once out it goes where he goes
    expect(vehicleAt(r, 2, 19, far, parks).at).toBe("home");
    // a short day: it stays in the house
    expect(vehicleAt(r, 2, 9, () => false, parks).at).toBe("home");
  });
});

// ------------------------------------------------------------------ family help

describe("family help with a load", () => {
  it("several things: those at home old enough come out and carry one each a round", () => {
    const fam = [
      { id: "wife", age: 40, home: true },
      { id: "son", age: 14, home: true },
      { id: "small", age: 6, home: true },
      { id: "daughter", age: 16, home: false },
      { id: "gran", age: 70, home: true },
    ];
    const l = planLoading(4, "me", fam);
    expect(l.carriers).toEqual(["me", "wife", "son", "gran"]);
    expect(l.rounds.length).toBe(1);
    expect(l.rounds.flat().map((c) => c.item).sort()).toEqual([0, 1, 2, 3]);
    // five things: two rounds; one thing: nobody needs to help
    expect(planLoading(5, "me", fam).rounds.length).toBe(2);
    expect(planLoading(1, "me", fam).carriers).toEqual(["me"]);
    // alone at home: every thing is carried by the one who goes
    const solo = planLoading(3, "me", []);
    expect(solo.rounds.length).toBe(3);
    expect(solo.secs).toBeGreaterThan(planLoading(3, "me", fam).secs);
  });

  it("a market woman with a handcart takes her goods out in the morning, her family at home helps load", () => {
    const db = fresh(6);
    const rec = transportRecord(db)!;
    const t = town(db);
    const cart = rec.vehicles.find((v) => v.kind === "handcart" && t.byId.get(v.owner)!.trade === "market_woman" && v.parks["work:work"])!;
    expect(cart).toBeTruthy();
    const r = t.byId.get(cart.owner)!;
    const load = scheduleLoad(r.trade, r.stats.wealth, "home", "work:work")!;
    expect(load.items).toBeGreaterThanOrEqual(2);
    const from: Pt = [r.home.sx, r.home.sz];
    const to: Pt = [cart.parks["work:work"][0], cart.parks["work:work"][1]];
    expect(chooseMode({ from, to, load, has: { handcart: true } }).mode).toBe("handcart");
    const fam = t.town.residents.filter((q) => q.household === r.household).map((q) => ({ id: q.id, age: q.age, home: true }));
    const l = planLoading(load.items, r.id, fam);
    expect(l.carriers[0]).toBe(r.id);
    expect(l.rounds.flat().length).toBe(load.items);
    for (const c of l.carriers.slice(1)) expect(t.byId.get(c)!.household).toBe(r.household);
    // the cart stands at the stall while she works, and is home again at night
    const workHour = r.sched.day.find((s) => s[2] === "work")!;
    expect(vehicleNow(db, cart, 2, workHour[0] + 0.5).key).toBe("work:work");
    expect(vehicleNow(db, cart, 2, 23.5).key).toBe("home");
  });
});

// ------------------------------------------------------------------ the omnibus

describe("the omnibus for residents", () => {
  it("a long trip with stops at both ends goes by omnibus, and a resident pays nothing", () => {
    const from: Pt = [-282, 16]; // behind the Werf
    const to: Pt = [62, 26]; // by the Petit Bassin
    const p = chooseMode({ from, to, has: {}, stops: STOPS, age: 50 });
    expect(p.mode).toBe("omnibus");
    expect(p.bus?.board.line).toBe(p.bus?.alight.line);
    expect(p.bus?.board.id).toBe("werf");
    expect(p.fare_c).toBe(0);
    expect(RIDE_FARE_C).toBeGreaterThan(0); // the fare is Jef's alone
    // a short hop is walked; no stop near the goal: walked
    expect(chooseMode({ from: [-250, 120], to: [-90, 175], has: {}, stops: STOPS }).mode).toBe("walk"); // under WALK_MAX_M
    expect(omnibusPlan([-250, 120], [-240, 100], STOPS)).toBeNull();
    expect(chooseMode({ from, to: [190, 300], has: {}, stops: STOPS }).mode).toBe("walk");
    // with a velocipede he rides instead
    expect(chooseMode({ from, to, has: { velocipede: true }, stops: STOPS, age: 30 }).mode).toBe("velocipede");
  });

  it("a trip by omnibus leaves Jef's purse alone", () => {
    const db = fresh();
    const before = money(db);
    const p = chooseMode({ from: [-282, 16], to: [62, 26], has: {}, stops: STOPS });
    expect(p.mode).toBe("omnibus");
    expect(money(db)).toBe(before);
  });
});

// ------------------------------------------------------------------ boats

describe("a family boat keeps to open water", () => {
  const wm = walkMap();
  const water = (x: number, z: number) => {
    const f = wm.flags(x, z);
    return (f & WATER) !== 0 && (f & (WALL | OUTSIDE)) === 0;
  };
  const free = (x: number, z: number) => {
    if (!water(x, z)) return false;
    for (let i = 0; i < 8; i++) if (!water(x + Math.cos((i * Math.PI) / 4) * 1.1, z + Math.sin((i * Math.PI) / 4) * 1.1)) return false;
    return true;
  };

  it("from the steps by the cart stand to the Vismarkt steps: every stretch on open water", () => {
    const a = flightBerth("cartstand")!;
    const b = flightBerth("vismarkt")!;
    const path = waterPath(free, [a.x, a.z], [b.x, b.z]);
    expect(path).not.toBeNull();
    for (let i = 1; i < path!.length; i++) {
      const [p, q] = [path![i - 1], path![i]];
      const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5);
      for (let k = 0; k <= n; k++) expect(free(p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n)).toBe(true);
    }
    expect(pathLength(path!)).toBeGreaterThan(Math.hypot(a.x - b.x, a.z - b.z) * 0.95);
  });

  it("no way from the river into the Petit Bassin while the lock is shut; none over land", () => {
    const a = flightBerth("cartstand")!;
    const b = flightBerth("bassin")!;
    expect(waterPath(free, [a.x, a.z], [b.x, b.z])).toBeNull();
    expect(waterPath(free, [a.x, a.z], [-150, 60])).toBeNull();
  });

  it("each family boat rows two sacks to another flight on its own water once a working day", () => {
    const db = fresh();
    const errands = errandsFor(db, 2).filter((e) => e.kind === "boat");
    expect(errands.length).toBeGreaterThanOrEqual(1);
    for (const e of errands) {
      expect(e.load.items).toBe(2);
      const v = transportRecord(db)!.vehicles.find((x) => x.id === e.vehicle)!;
      expect(v.kind).toBe("boat");
      expect(e.who[0]).toBe(v.owner);
      for (const w of e.who) expect(resident(db, w)!.household).toBe(v.household);
    }
    expect(errandsFor(db, 7)).toEqual([]);
    expect(errandsFor(db, 2)).toEqual(errandsFor(db, 2));
  });
});

// ------------------------------------------------------------------ theft: the owner walks

describe("a stolen velocipede: the owner walks", () => {
  it("where an owner's machine stands follows his day; taken by Jef, it is gone, he walks and remembers once", () => {
    const db = fresh(6, 2);
    const rec = transportRecord(db)!;
    // an owner whose weekday takes him far from home (the first such move of his day)
    // (the town is small: most go further than WALK_MAX_M only on Sunday, to mass)
    let found: { v: (typeof rec.vehicles)[number]; key: string; at: number; day: number } | null = null;
    for (const day of [2, 7])
      for (const q of rec.vehicles.filter((q) => q.kind === "velocipede")) {
        const far = farFor(resident(db, q.owner)!, town(db).town.places);
        const move = keysOf(resident(db, q.owner)!, day).find((k) => k.key !== "home" && far("home", k.key) && q.parks[k.key]);
        if (move && !found) found = { v: q, key: move.key, at: move.from, day };
      }
    expect(found).toBeTruthy();
    const { v, key, at, day } = found!;
    const r = resident(db, v.owner)!;
    // at home before he goes
    setClock(db, day, Math.max(0, Math.floor(at) - 1));
    expect(veloStates(db)[v.id]).toMatchObject({ x: v.home[0], z: v.home[1] });
    // there: he rode it
    setClock(db, day, Math.floor(at + 0.5), Math.round(((at + 0.5) % 1) * 60));
    const st = veloStates(db)[v.id];
    expect([st.x, st.z]).toEqual([v.parks[key][0], v.parks[key][1]]);
    // Jef takes it from there, unseen
    const res = takeThing(db, { ref: v.id, x: st.x, z: st.z }, never);
    expect(res.deed).toBeTruthy();
    leaveVelo(db, v.id, st.x + 40, st.z, 0);
    const view = transportView(db, veloStates(db));
    expect(view.vehicles.find((q) => q.id === v.id)!.gone).toBe(true);
    // going home tonight: nothing at hand, so he walks (or takes the omnibus), never rides
    const plan = chooseMode({ from: [st.x, st.z], to: [r.home.sx, r.home.sz], has: { velocipede: false }, stops: STOPS, age: r.age });
    expect(plan.mode).not.toBe("velocipede");
    // he finds it gone: a memory, once
    const mem = () => (db.prepare("SELECT COUNT(*) n FROM npc_memory WHERE npc_id = ?").get(r.id) as { n: number }).n;
    const m0 = mem();
    expect(ownerMissed(db, v.id, veloStates(db))).toBe(true);
    expect(mem()).toBe(m0 + 1);
    expect(ownerMissed(db, v.id, veloStates(db))).toBe(false);
    // and the machine stays where Jef left it, whatever the owner's day says
    setClock(db, day, 22);
    expect(veloStates(db)[v.id].x).toBeCloseTo(st.x + 40, 0);
  });

  it("the M3h list keeps its six, and the new ones follow; all can be taken as before", () => {
    const db = fresh();
    const s = stealables(db);
    expect(s.velos.slice(0, 6).every((v) => /^velo:\d$/.test(v.id))).toBe(true);
    expect(s.velos.some((v) => v.id.startsWith("velo:x"))).toBe(true);
  });
});

// ------------------------------------------------------------------ the velocipede maker

describe("the velocipede maker: buy, hire, own", () => {
  it("his door is real and reachable; he sells a second-hand and a new machine and hires one by the day", () => {
    const db = fresh(10);
    const shop = veloShop(db)!;
    expect(shop).toBeTruthy();
    expect(walkMap().reachable(shop.step[0], shop.step[1])).toBe(true);
    for (const s of shop.show) expect(walkMap().open(s[0], s[1], 0.3)).toBe(true);
    expect(resident(db, SHOP_ID)!.trade).toBe("velo_maker");
    expect(town(db).town.places.velo_shop).toBeTruthy();
    // the prices: a week's saving for a second-hand one, more for a new one, a day's hire cheap
    expect(VELO_PRICE.used_c).toBeGreaterThanOrEqual(400);
    expect(VELO_PRICE.new_c).toBeGreaterThan(VELO_PRICE.used_c);
    expect(VELO_PRICE.hire_c).toBeLessThan(50);
  });

  it("buying: the money goes, the machine is his and stands at the door; no pocket slot; no second one", () => {
    const db = fresh(10);
    setMoney(db, 700);
    expect(() => buy(db, SHOP_ID, "velocipede_new")).toThrow(/not enough money/);
    const r = buy(db, SHOP_ID, "velocipede_used");
    expect(r.price_c).toBe(VELO_PRICE.used_c);
    expect(money(db)).toBe(700 - VELO_PRICE.used_c);
    expect((db.prepare("SELECT COUNT(*) n FROM item").get() as { n: number }).n).toBe(0);
    const mine = jefVelos(db).list;
    expect(mine.length).toBe(1);
    const st = veloStates(db)[mine[0].id];
    expect(st).toMatchObject({ own: true, deed: null, ridden: false });
    expect(Math.hypot(st.x - veloShop(db)!.show[0][0], st.z - veloShop(db)!.show[0][1])).toBeLessThan(0.1);
    expect(deedWorld(db).velos.find((v) => v.id === mine[0].id)?.mine).toBe(true);
    setMoney(db, 5000);
    expect(() => buy(db, SHOP_ID, "velocipede_new")).toThrow(/of your own already/);
    // riding his own: no deed, no witnesses, nobody cries thief
    const take = takeThing(db, { ref: mine[0].id, x: st.x, z: st.z }, always);
    expect(take.again).toBe(true);
    expect(take.deed).toBeNull();
    expect(take.seen).toBe(false);
    const left = leaveVelo(db, mine[0].id, st.x + 3, st.z, 0.5);
    expect(left.own).toBe(true);
    // shut after hours
    setClock(db, 2, 21);
    expect(() => buy(db, SHOP_ID, "velocipede_hire")).toThrow(/shut/);
  });

  it("owning survives a reload: it stands where he left it", () => {
    const dir = mkdtempSync(join(tmpdir(), "velo-"));
    const file = join(dir, "save.sqlite");
    try {
      let db = openDb(file);
      setClock(db, 2, 10);
      setMoney(db, 2000);
      buy(db, SHOP_ID, "velocipede_new");
      const id = jefVelos(db).list[0].id;
      const st = veloStates(db)[id];
      takeThing(db, { ref: id, x: st.x, z: st.z }, never);
      const left = leaveVelo(db, id, st.x + 5, st.z + 1, 1);
      db.close();
      db = openDb(file);
      expect(jefVelos(db).list.map((v) => v.id)).toEqual([id]);
      expect(veloStates(db)[id]).toMatchObject({ x: left.x, z: left.z, own: true, ridden: false });
      db.close();
    } finally {
      // Windows may still hold the save a moment after close: retry, and a leftover temp folder is harmless
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // left for the OS to clear
      }
    }
  });

  it("hire by the day: back at his door, it is simply done; left elsewhere, his boy fetches it for a fee", () => {
    const db = fresh(10);
    setMoney(db, 100);
    buy(db, SHOP_ID, "velocipede_hire");
    expect(money(db)).toBe(100 - VELO_PRICE.hire_c);
    const v = jefVelos(db).list[0];
    expect(v.kind).toBe("hire");
    expect(() => buy(db, SHOP_ID, "velocipede_hire")).toThrow(/hire machine already/);
    const st = veloStates(db)[v.id];
    takeThing(db, { ref: v.id, x: st.x, z: st.z }, never);
    const shop = veloShop(db)!;
    // left far from the shop, in a quiet spot (no thief), the day runs out
    const wm = walkMap();
    const quiet = [...Array(400).keys()].map((i) => wm.nearestOpen(-300 + (i % 20) * 25, -10 + Math.floor(i / 20) * 16, 4)).find((q) => q && !busyAt(db, q.x, q.z) && Math.hypot(q.x - shop.step[0], q.z - shop.step[1]) > 20)!;
    leaveVelo(db, v.id, quiet.x, quiet.z, 0);
    setClock(db, 2, 10 + VELO_HIRE_HOURS, 5);
    const before = money(db);
    expect(bikeHour(db, never)).toEqual(["fetched"]);
    expect(money(db)).toBe(before - VELO_FETCH_FEE_C);
    expect(jefVelos(db).list).toEqual([]);
    expect(veloStates(db)[v.id]).toBeUndefined();
    expect(jefVelos(db).notice?.text).toMatch(/boy fetched/);
  });

  it("left unwatched in a busy place, someone rides off on it: gone, a robbery the police can take up, the town talks", () => {
    const db = fresh(10);
    setMoney(db, 1000);
    buy(db, SHOP_ID, "velocipede_used");
    const v = jefVelos(db).list[0];
    const st = veloStates(db)[v.id];
    takeThing(db, { ref: v.id, x: st.x, z: st.z }, never);
    const vis = town(db).town.places.vismarkt;
    leaveVelo(db, v.id, vis.x, vis.z, 0);
    expect(busyAt(db, vis.x, vis.z)).toBe(true);
    // Jef stands by it: watched, nothing happens
    jefSeen(db, vis.x + 2, vis.z);
    setClock(db, 2, 11);
    expect(bikeHour(db, always)).toEqual([]);
    // Jef walks off; an hour later it is gone
    jefSeen(db, vis.x + 200, vis.z, Date.now() - 60_000);
    setClock(db, 2, 12);
    expect(bikeHour(db, always)).toEqual(["stolen"]);
    expect(jefVelos(db).list).toEqual([]);
    expect(deedWorld(db).velos.some((x) => x.id === v.id)).toBe(false);
    const crime = crimeOpen(db);
    expect(crime).toBeTruthy();
    expect(crime!.amount_c).toBe(VELO_PRICE.used_c);
    expect(resident(db, crime!.thief)!.trade).toBe("thief");
    const talk = db.prepare("SELECT gist FROM npc_memory WHERE gist LIKE '%velocipede was stolen%'").all();
    expect(talk.length).toBeGreaterThanOrEqual(1);
    // his money never moved
    expect(money(db)).toBe(1000 - VELO_PRICE.used_c);
  });

  it("at the maker's door and in a quiet street it is safe; a roll that fails leaves it be", () => {
    const db = fresh(10);
    setMoney(db, 1000);
    buy(db, SHOP_ID, "velocipede_used");
    setClock(db, 2, 11);
    expect(bikeHour(db, always)).toEqual([]); // at the maker's door
    expect(jefVelos(db).list.length).toBe(1);
  });

  it("a fall does no harm: there is no damage and nothing to mend", () => {
    const db = fresh(10);
    setMoney(db, 1000);
    buy(db, SHOP_ID, "velocipede_used");
    const v = jefVelos(db).list[0];
    const st = veloStates(db)[v.id];
    takeThing(db, { ref: v.id, x: st.x, z: st.z }, never);
    const down = leaveVelo(db, v.id, st.x + 2, st.z, 0, true);
    expect(down.down).toBe(true);
    expect(Object.keys(down)).not.toContain("damage");
    const again = takeThing(db, { ref: v.id, x: down.x, z: down.z }, never);
    expect(again.again).toBe(true);
    expect(() => buy(db, SHOP_ID, "velocipede_repair" as string)).toThrow(/do not sell/);
  });
});
