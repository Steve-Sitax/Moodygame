import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDb, resetDb } from "../src/db.ts";
import { buy, pockets, waresOf } from "../src/trade.ts";
import { generateTown, type Resident } from "../src/town/population.ts";
import { activityAt } from "../src/town/schedule.ts";
import { town } from "../src/town/store.ts";
import { houseDoors, walkMap } from "../src/town/walkmap.ts";
import { walkPath } from "../src/town/lamplighters.ts";
import { offLanes } from "../src/town/possessions.ts";
import { doing } from "../src/town/talk.ts";
import { backStreet, CART_TRADES, CHURCH_STALLS, DOGCART_TRADES, ensureLively, generateLively, isLively, LIVELY_TRADES } from "../src/town/lively.ts";
import { LIVELY_WARES } from "../src/town/livelyWares.ts";
import { doorAt, doorPlan, gamesAt, type DoorPerson } from "../src/town/doorlife.ts";
import { livelyView } from "../src/town/livelyRoutes.ts";

// M6 lively (Steve 2026-09-24, "10 ideas are a go"): the back streets and the cathedral quarter.
// Dog carts, street sellers with their rounds, the stalls against the cathedral, nuns, beguines,
// beggars and English travellers, all townspeople of the engine; door life and the children's
// games by the clock; the sellers' wares at engine prices.

type DB = ReturnType<typeof openDb>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: DB) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: DB, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);

const T = generateTown(1873);
const L = generateLively(T.seed, T.places, T.residents);
const of = (t: string) => L.residents.filter((r) => r.trade === t);
const at = (r: Resident, day: number, h: number) => activityAt(r.sched, day, h);

describe("the lively streets' people", () => {
  it("are made by the engine from the town's seed, after the town, without changing it", () => {
    const again = generateLively(T.seed, T.places, T.residents);
    expect(again.residents).toEqual(L.residents);
    expect(generateTown(1873).residents).toEqual(T.residents); // the town itself is as it was
    // ids of their own: the ids the other parts add in place after the last "r..." stay as they were
    for (const r of L.residents) expect(r.id).toMatch(/^lv\d{3}$/);
    const all = [...T.residents, ...L.residents];
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(new Set(all.map((r) => r.name)).size).toBe(all.length);
  });

  it("has every trade: dog carts, street sellers, stall keepers, nuns, beguines, beggars, travellers", () => {
    expect(of("milk_woman").length).toBe(2);
    expect(of("baker_boy").length).toBe(2);
    for (const t of ["grinder", "ragman", "coalman", "mussel_seller", "broom_seller"]) expect(of(t).length, t).toBe(1);
    expect(of("sweep").length).toBe(2); // the master and his boy
    expect(of("devotion_seller").length).toBe(CHURCH_STALLS.length);
    expect(of("nun").length).toBe(2);
    expect(of("beguine").length).toBe(2);
    expect(of("tourist").length).toBe(3);
    expect(of("beggar").length).toBe(2);
    for (const t of LIVELY_TRADES) expect(L.residents.some((r) => r.trade === t), t).toBe(true);
    // the baker's boys live over the bakeries, with the baker's household
    for (const b of of("baker_boy")) {
      const baker = T.residents.find((r) => r.household === b.household && r.trade === "baker");
      expect(baker, b.name).toBeTruthy();
      expect(b.home.house).toBe(baker!.home.house);
      expect(b.age).toBeLessThan(16);
    }
    // pairs keep one day: the Black Sisters, the sweep and his boy, the English couple
    for (const r of L.residents.filter((r) => r.mate)) {
      const m = L.residents.find((o) => o.id === r.mate)!;
      expect(m.mate).toBe(r.id);
      expect(m.sched).toEqual(r.sched);
    }
  });

  it("every home, stop, post and place is on ground you can walk to", () => {
    const wm = walkMap();
    for (const r of L.residents) {
      expect(wm.reachable(r.home.sx, r.home.sz), `${r.name} home`).toBe(true);
      if (r.work.at) expect(wm.reachable(r.work.at[0], r.work.at[1]), `${r.name} post`).toBe(true);
      for (const [x, z] of r.work.route ?? []) expect(wm.reachable(x, z), `${r.name} stop ${x},${z}`).toBe(true);
    }
    for (const [id, p] of Object.entries(L.places)) expect(wm.nearestOpen(p.x, p.z, 3), id).toBeTruthy();
    // nobody new moves in on top of a house another household lives in (the boys and the sweep's boy excepted)
    const lived = new Map(T.residents.map((r) => [r.home.house, r.household]));
    for (const r of L.residents) if (r.trade !== "baker_boy") expect(lived.has(r.home.house), r.name).toBe(false);
  });

  it("rounds: stops beside the doors of the back streets, never on a step, each leg a path on the walk map", () => {
    const doors = houseDoors();
    const rounds = L.residents.filter((r) => r.work.kind === "round" && r.trade !== "tourist");
    expect(rounds.length).toBe(13);
    for (const r of rounds) {
      const route = r.work.route!;
      expect(route.length, r.name).toBeGreaterThanOrEqual(6);
      expect(r.work.faces!.length).toBe(route.length);
      const room = CART_TRADES.has(r.trade) || DOGCART_TRADES.has(r.trade) ? 1.1 : 0;
      for (let i = 0; i < route.length; i++) {
        const [x, z] = route[i];
        expect(offLanes(x, z, 0.3), `${r.name} stop on a lane`).toBe(true);
        // beside a door, never on one: the nearest door step is at least 1.1 m away, and a door is within 3.5 m
        const dd = doors.map((d) => Math.hypot(d.sx - x, d.sz - z)).sort((a, b) => a - b);
        expect(dd[0], `${r.name} stop ${i} on a step`).toBeGreaterThanOrEqual(1.05);
        const door = doors.find((d) => Math.hypot(d.x - x, d.z - z) < 3.6);
        expect(door, `${r.name} stop ${i} by a door`).toBeTruthy();
        expect(backStreet(door!), `${r.name} stop ${i} in a back street`).toBe(true);
        const next = route[(i + 1) % route.length];
        expect(walkPath(x, z, next[0], next[1], 400_000, room > 0.6 ? room : 0), `${r.name} leg ${i}`).toBeTruthy();
      }
      // they face the door they stop at
      const [x0, z0] = route[0];
      const yaw = r.work.faces![0];
      const d = doors.find((q) => Math.hypot(q.x - x0, q.z - z0) < 3.6)!;
      expect(Math.abs(Math.atan2(Math.sin(Math.atan2(d.x - x0, d.z - z0) - yaw), Math.cos(Math.atan2(d.x - x0, d.z - z0) - yaw)))).toBeLessThan(0.05);
    }
    // two rounds never stop at the same spot (each has its own doors)
    const firsts = rounds.filter((r) => !r.mate || r.mate > r.id);
    for (let a = 0; a < firsts.length; a++)
      for (let b = a + 1; b < firsts.length; b++)
        for (const p of firsts[a].work.route!) for (const q of firsts[b].work.route!) expect(Math.hypot(p[0] - q[0], p[1] - q[1]), `${firsts[a].name} and ${firsts[b].name}`).toBeGreaterThan(2);
  });

  it("the travellers' sights and the beggars' places are on open ground, off the omnibus and dray lanes", () => {
    const wm = walkMap();
    for (const t of of("tourist")) for (const [x, z] of t.work.route!) {
      expect(wm.reachable(x, z), `${x},${z}`).toBe(true);
      expect(offLanes(x, z, 0.3), `sight ${x},${z} on a lane`).toBe(true);
    }
    for (const b of of("beggar")) {
      expect(wm.reachable(b.work.at![0], b.work.at![1])).toBe(true);
      expect(b.work.place).toBe("cathedral");
    }
  });

  it("schedules: milk and bread in the morning, sellers by day, mussels at dusk, stalls on Sunday morning, the Rubens at noon", () => {
    for (const r of L.residents) {
      for (const segs of [r.sched.day, r.sched.sunday]) for (let i = 1; i < segs.length; i++) expect(segs[i][0], r.name).toBeGreaterThanOrEqual(segs[i - 1][1]);
    }
    for (const m of of("milk_woman")) {
      expect(at(m, 2, 7).act).toBe("work");
      expect(at(m, 7, 7).act).toBe("work"); // milk on Sundays too
      expect(at(m, 2, 16.75).act).toBe("work"); // the evening round
      expect(at(m, 2, 22).act).toBe("home");
    }
    for (const b of of("baker_boy")) {
      expect(at(b, 3, 7.5).act).toBe("work");
      expect(at(b, 3, 17.5).act).toBe("play"); // then he plays with the others
    }
    for (const t of ["grinder", "ragman", "coalman", "sweep", "broom_seller"]) for (const r of of(t)) {
      expect(at(r, 2, 10.5).act, t).toBe("work");
      expect(at(r, 7, 10.5).act, `${t} on Sunday`).not.toBe("work");
      expect(at(r, 2, 23).act, t).not.toBe("work");
    }
    expect(at(of("mussel_seller")[0], 4, 18.5).act).toBe("work"); // at dusk, with a lantern
    for (const s of of("devotion_seller")) {
      expect(at(s, 7, 9).act).toBe("work");
      expect(at(s, 2, 10).act).toBe("work");
      expect(at(s, 2, 21).act).toBe("home");
    }
    for (const t of of("tourist")) {
      expect(at(t, 3, 12.5).act).toBe("church"); // the paintings are shown from noon to four
      expect(at(t, 3, 10.5).act).toBe("work");
    }
    for (const b of of("beguine")) expect(at(b, 2, 9).act).toBe("church");
    for (const n of of("nun")) {
      expect(at(n, 2, 10).act).toBe("work");
      expect(n.name.startsWith("Sister ")).toBe(true);
    }
  });

  it("the stalls against the cathedral stand on the Groenplaats and Blauwmoezelstraat sides, not the Handschoenmarkt", () => {
    // in 1873 the houses on the Handschoenmarkt were being pulled down (1865-75); the Groenplaats
    // side (west of the church in this map) and the Blauwmoezelstraat side (east) still stood
    for (const s of CHURCH_STALLS) {
      expect(s.z).toBeGreaterThan(150); // beyond the west front and its square
      expect(s.x < -300 || s.x > -224, s.id).toBe(true);
    }
    expect(CHURCH_STALLS.filter((s) => s.side === "groenplaats").length).toBeGreaterThanOrEqual(3);
    for (const s of of("devotion_seller")) {
      expect(s.work.kind).toBe("post");
      expect(s.faction).toBe("kerk");
    }
  });
});

describe("the save: in place, once", () => {
  it("a new game has them; an older save gets the same people in place and nothing else changes", () => {
    const db = openDb(":memory:");
    const inGame = town(db).town.residents.filter((r) => isLively(r.trade) || (r.trade === "beggar" && r.work.place === "cathedral"));
    expect(inGame.filter((r) => isLively(r.trade)).length).toBe(L.residents.filter((r) => isLively(r.trade)).length);
    // make it an older save: take them out
    const ids = town(db).town.residents.filter((r) => isLively(r.trade) || L.residents.some((l) => l.id === r.id)).map((r) => r.id);
    for (const t of ["npc_relationship WHERE npc_id", "resident WHERE id", "npc WHERE id"]) for (const id of ids) db.prepare(`DELETE FROM ${t} = ?`).run(id);
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string };
    const tw = JSON.parse(row.value_json);
    for (const k of Object.keys(tw.places)) if (k.startsWith("round:") || k.startsWith("stall:")) delete tw.places[k];
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(tw));
    const before = new Map((db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json]));
    const mem = (db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n;
    const jef = db.prepare("SELECT * FROM player WHERE id = 1").get();
    const added = ensureLively(db);
    expect(added).toBe(ids.length);
    const after = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
    expect(after.length).toBe(before.size + added);
    for (const r of after) if (before.has(r.id)) expect(r.data_json).toBe(before.get(r.id));
    expect((db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n).toBe(mem);
    expect(db.prepare("SELECT * FROM player WHERE id = 1").get()).toEqual(jef);
    // every new one is an npc too (talk, memories and rumours work for them)
    for (const r of after.filter((r) => !before.has(r.id))) expect(db.prepare("SELECT 1 FROM npc WHERE id = ?").get(r.id), r.id).toBeTruthy();
    // the places are back
    const places = town(db).town.places;
    expect(Object.keys(places).filter((k) => k.startsWith("round:")).length).toBe(12);
    // once: a second start changes nothing
    expect(ensureLively(db)).toBe(0);
    // a new week makes a new town, and it has them again
    resetDb(db);
    expect(town(db).town.residents.filter((r) => r.trade === "milk_woman").length).toBe(2);
  });

  it("on a copy of a real older save (data/test-lively-old.sqlite): added in place, residents and memories kept", () => {
    const src = join(import.meta.dirname, "..", "..", "data", "test-lively-old.sqlite");
    if (!existsSync(src)) return; // the copy is made by hand for the milestone check
    const dir = mkdtempSync(join(tmpdir(), "lively-"));
    const file = join(dir, "old.sqlite");
    copyFileSync(src, file);
    try {
      const raw = new Database(file, { readonly: true });
      const before = new Map((raw.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json]));
      const mem = (raw.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n;
      const jef = raw.prepare("SELECT * FROM player WHERE id = 1").get();
      const had = (raw.prepare("SELECT COUNT(*) n FROM resident WHERE trade = 'milk_woman'").get() as { n: number }).n;
      raw.close();
      expect(had).toBe(0);
      const db = openDb(file);
      const after = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
      // a lamplighter's round follows the lamps (town/lamplighters.ts, versioned): a moved lamp may change it, and
      // M7 lamps (LAMPS_VERSION 6 to 9) gives the market quarter a third lamplighter: a docker or a porter takes the
      // trade. The lamp migration owns a lamplighter's trade, work and day; the rest of him stays.
      const lit = (j: string) => (JSON.parse(j) as { trade?: string }).trade === "lamplighter";
      const plain = (j: string, lamps: boolean) => {
        const o = JSON.parse(j) as Record<string, unknown>;
        if (lamps) for (const k of ["trade", "faction", "work", "sched"]) delete o[k];
        return JSON.stringify(o);
      };
      for (const r of after) if (before.has(r.id)) expect(plain(r.data_json, lit(r.data_json)), r.id).toBe(plain(before.get(r.id)!, lit(r.data_json)));
      expect(after.filter((r) => lit(r.data_json)).length).toBe(3);
      const newLighters = after.filter((r) => before.has(r.id) && lit(r.data_json) && !lit(before.get(r.id)!));
      expect(newLighters.length).toBeLessThanOrEqual(1);
      for (const r of newLighters) expect(["docker", "porter"]).toContain((JSON.parse(before.get(r.id)!) as { trade: string }).trade);
      expect(after.length - before.size).toBeGreaterThanOrEqual(24);
      expect((db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n).toBe(mem);
      expect(db.prepare("SELECT * FROM player WHERE id = 1").get()).toEqual(jef);
      const wm = walkMap();
      for (const r of town(db).town.residents.filter((r) => isLively(r.trade))) {
        expect(wm.reachable(r.home.sx, r.home.sz), r.name).toBe(true);
        for (const [x, z] of r.work.route ?? []) expect(wm.reachable(x, z), r.name).toBe(true);
      }
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

describe("buying from the street sellers (engine prices)", () => {
  const fresh = (day: number, hour: number) => {
    const db = openDb(":memory:");
    setClock(db, day, hour);
    setMoney(db, 200);
    return db;
  };
  const who = (db: DB, t: string) => town(db).town.residents.find((r) => r.trade === t)!;

  it("every seller's wares are the engine's list, at the engine's prices", () => {
    const db = fresh(2, 10);
    for (const [trade, list] of Object.entries(LIVELY_WARES)) {
      const r = who(db, trade);
      expect(waresOf(db, r.id), trade).toEqual(list);
      for (const w of list) {
        expect(Number.isInteger(w.price_c) && w.price_c > 0).toBe(true);
        expect(w.price_c).toBeLessThanOrEqual(40); // street goods: never more than a job's third
      }
    }
    // in proportion to the town's own prices: milk and a roll under a loaf, mussels like a herring
    const price = (t: string, k: string) => LIVELY_WARES[t].find((w) => w.kind === k)!.price_c;
    expect(price("milk_woman", "milk")).toBeLessThan(6);
    expect(price("baker_boy", "bread")).toBe(6);
    expect(price("mussel_seller", "mussels")).toBe(5);
    // the nuns, the sweep, the travellers and the beguines sell nothing
    for (const t of ["nun", "sweep", "tourist", "beguine"]) expect(waresOf(db, who(db, t).id), t).toEqual([]);
  });

  it("milk is drunk at the cart; mussels go in the pocket; the money moves by the price exactly", () => {
    const db = fresh(2, 7);
    const milk = who(db, "milk_woman");
    const m0 = money(db);
    const r = buy(db, milk.id, "milk");
    expect(r.price_c).toBe(3);
    expect(money(db)).toBe(m0 - 3);
    expect(pockets(db).some((p) => p.kind === "milk")).toBe(false);
    setClock(db, 2, 11);
    const mus = who(db, "mussel_seller");
    buy(db, mus.id, "mussels");
    expect(money(db)).toBe(m0 - 3 - 5);
    expect(pockets(db).some((p) => p.kind === "mussels")).toBe(true);
  });

  it("only while they are on their round: the milk woman at noon, the stalls at night", () => {
    const db = fresh(2, 13);
    expect(() => buy(db, who(db, "milk_woman").id, "milk")).toThrow(/shut/);
    setClock(db, 2, 22);
    expect(() => buy(db, who(db, "devotion_seller").id, "candle")).toThrow(/shut/);
    setClock(db, 7, 9);
    const m0 = money(db);
    buy(db, who(db, "devotion_seller").id, "candle");
    expect(money(db)).toBe(m0 - 3);
    setMoney(db, 2);
    setClock(db, 2, 10);
    expect(() => buy(db, who(db, "broom_seller").id, "broom")).toThrow(/not enough money/);
  });

  it("the talk says what they are about", () => {
    const db = fresh(2, 10);
    expect(doing(db, who(db, "grinder"))).toMatch(/grinding barrow/);
    expect(doing(db, who(db, "ragman"))).toMatch(/rags, bones/);
    expect(doing(db, who(db, "nun"))).toMatch(/nursing/);
  });
});

describe("door life and the children's games (engine plans, read by the clock)", () => {
  const people = T.residents.map((r): DoorPerson & { sched: Resident["sched"] } => ({ id: r.id, sex: r.sex, age: r.age, trade: r.trade, sched: r.sched, act: (d, h) => activityAt(r.sched, d, h).act, home: r.home, stats: r.stats }));
  const plans = new Map(people.map((p) => [p.id, doorPlan(p)]));

  it("only in time the person's own day has them at home (a maid at her master's door)", () => {
    let n = 0;
    for (const p of people) {
      for (const [day, a, b, act, where] of plans.get(p.id)!) {
        n++;
        for (let t = a; t < b; t += 0.25) expect(activityAt(p.sched, day, t).act, `${p.id} ${act} ${day} ${t}`).toBe(where === "home" ? "home" : "work");
        if (act === "scrub" || act === "lace" || act === "knit" || act === "flowers" || act === "flowers_church") expect(p.sex).toBe("f");
      }
    }
    expect(n).toBeGreaterThan(40);
    expect(doorPlan(people[0])).toEqual(plans.get(people[0].id)); // the same person, the same week
  });

  it("Saturday is the big scrub; nobody scrubs on Sunday; the pious take flowers", () => {
    const scrubs = (day: number) => [...plans.values()].flat().filter((s) => s[0] === day && s[3] === "scrub").length;
    expect(scrubs(6)).toBeGreaterThan(scrubs(2) * 2);
    expect(scrubs(7)).toBe(0);
    for (const p of people) for (const s of plans.get(p.id)!) if (s[3].startsWith("flowers")) expect(p.stats.piety).toBeGreaterThanOrEqual(7);
    expect([...plans.values()].flat().some((s) => s[3] === "lace")).toBe(true);
    expect([...plans.values()].flat().some((s) => s[3] === "window")).toBe(true);
  });

  it("rain drives the scrubbing and the lace indoors; the window stays", () => {
    const seg = [...plans.values()].flat().find((s) => s[3] === "scrub")!;
    const plan = [seg];
    const mid = (seg[1] + seg[2]) / 2;
    expect(doorAt(plan, seg[0], mid, "fog")?.act).toBe("scrub");
    expect(doorAt(plan, seg[0], mid, "rain")).toBeNull();
    expect(doorAt(plan, seg[0], seg[2] + 0.1, "fog")).toBeNull();
    const win = [...plans.values()].flat().find((s) => s[3] === "window")!;
    expect(doorAt([win], win[0], (win[1] + win[2]) / 2, "storm")?.act).toBe("window");
  });

  it("the children's games: the same square and hour, the same game; they change over the day", () => {
    expect(gamesAt("play:back_lane", 3, 10)).toEqual(gamesAt("play:back_lane", 3, 10.5));
    const seen = new Set<string>();
    for (let h = 8; h < 18; h += 2) for (const d of [1, 2, 3, 4, 5, 6, 7]) {
      const g = gamesAt("play:vismarkt", d, h);
      seen.add(g.boys);
      seen.add(g.girls);
    }
    for (const g of ["tag", "hoops", "tops", "marbles", "hopscotch", "rope"]) expect(seen.has(g), g).toBe(true);
  });

  it("the client's view: plans for the town, the stalls and the beggars' places", () => {
    const db = openDb(":memory:");
    const v = livelyView(db);
    expect(Object.keys(v.door).length).toBeGreaterThan(20);
    expect(v.stalls.length).toBe(CHURCH_STALLS.length);
    expect(v.dogcarts).toContain("milk_woman");
  });
});
