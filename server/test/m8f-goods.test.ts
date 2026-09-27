import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { blankSave } from "./blank-save.ts";
import { devJob, jobById } from "../src/hooks/jobBoard.ts";
import { takeJob } from "../src/game.ts";
import { asPlayer, setPositionSource, setWalkerSource } from "../src/player/current.ts";
import { ensurePlayerRow } from "../src/player/multi.ts";
import { GoodsStore, goods as theStore, goodsHooks, QUAY_CARGO } from "../src/goods/store.ts";
import { mountGoods, GOODS_RATE } from "../src/goods/routes.ts";
import { carryBackTick, installCarryBack, startBack } from "../src/goods/carryBack.ts";
import { activeRoutines, devRoutine, reportStep } from "../src/director/steps.ts";
import SPOTS_JSON from "../../shared/spots.json" with { type: "json" };
import { openDb } from "../src/db.ts";
import { buy } from "../src/trade.ts";
import { cartAt, holdCart, jefCarts, loadCart, unloadedGoods, unloadedJobGoods, unloadJob, unloadOne, WHEELWRIGHT_ID } from "../src/town/handcart.ts";
import { resetSync, syncFromClient } from "../src/director/actions.ts";
import { town } from "../src/town/store.ts";
import { CART_RUNS, CRATE_STACKS, DRAY_RUN, GOODS_BODY_MAX, PILES, pileSpot, placeAt, r3, rotFor, SACK_PILES, townGoods, type GoodsItem, type GoodsPush } from "../../shared/goods.ts";
import CITY from "../../shared/city.json" with { type: "json" };

// M8f shared goods (docs/milestones/M8f.md): the server owns every liftable item; the PCs ask. The ids and the turns
// are fixed; a lift of what another carries, a put down of what he does not hold, another man's job's goods, a
// townsperson reported by the wrong PC are refused; every change reaches every PC and a late one gets the list; the
// goods of a job go with it; a player who leaves sets down what he held; the requests are limited.

vi.setConfig({ testTimeout: 60_000 });
type Db = ReturnType<typeof blankSave>;
const SPOTS = SPOTS_JSON as unknown as Record<string, { x: number; z: number }>;
const doors = (CITY as unknown as { doors: Record<string, { x: number; z: number; out: [number, number] }> }).doors;

afterEach(() => {
  setPositionSource(null);
  setWalkerSource(null);
  resetSync();
});

function store(): { s: GoodsStore; pushes: GoodsPush[] } {
  const s = new GoodsStore();
  const pushes: GoodsPush[] = [];
  s.onPush((m) => pushes.push(m));
  return { s, pushes };
}
const ok = (r: ReturnType<GoodsStore["ask"]>) => {
  if (!r.ok) throw new Error(`refused: ${r.why}`);
  return r;
};

/** A job of the dev board in player p's hand. */
function jobFor(db: Db, p: number, spec: Parameters<typeof devJob>[1]): number {
  if (p !== 1) ensurePlayerRow(db, p, `P${p}`);
  const j = devJob(db, spec);
  asPlayer(p, () => takeJob(db, j.id));
  return j.id;
}

describe("M8f: the town's goods, the same on every PC", () => {
  it("stable ids and turns from the id (never random): two stores and the shared list agree to the millimetre", () => {
    const a = new GoodsStore().list();
    const b = new GoodsStore().list();
    expect(a).toEqual(b);
    expect(a.map((i) => i.id)).toEqual(townGoods(doors, QUAY_CARGO).map((i) => i.id));
    expect(a.filter((i) => i.id.startsWith("own:")).length).toBe(11);
    expect(a.filter((i) => i.id.startsWith("pile:")).length).toBe(PILES.reduce((n, p) => n + p.n, 0));
    for (const it of a.filter((i) => i.id.startsWith("own:"))) {
      expect(it.rot).toBe(rotFor(it.id, 0));
      expect(it.rot).toBeGreaterThanOrEqual(0);
      expect(it.rot).toBeLessThan(0.4);
    }
    // Sooi's third crate stands on the first (the same spot twice in the old table): a stack, as before
    const s0 = a.find((i) => i.id === "own:sooi:0")!;
    const s2 = a.find((i) => i.id === "own:sooi:2")!;
    expect(s2.on).toEqual(["own:sooi:0"]);
    expect(s2.y).toBeCloseTo(0.7, 5);
    expect([s2.x, s2.z]).toEqual([s0.x, s0.z]);
    // the quay's casks: where the static piles stood, at the same turns (i * 1.7)
    const w = PILES[0];
    const c3 = a.find((i) => i.id === `pile:${w.id}:3`)!;
    expect([c3.x, c3.z]).toEqual(pileSpot(w, 3));
    expect(c3.rot).toBeCloseTo(3 * 1.7, 3);
    expect(c3.look).toBe("cask");
  });

  it("a pyramid of barrels: between two of one row the third rests on both; three rows at most", () => {
    const base = new GoodsStore().list().filter((i) => i.id.startsWith("pile:w:"));
    const [a, b] = [base[0], base[1]];
    const mid = placeAt(base, "barrels", (a.x + b.x) / 2 + 0.1, (a.z + b.z) / 2)!;
    expect(mid.on.sort()).toEqual([a.id, b.id].sort());
    expect(mid.y).toBeCloseTo(0.95, 5);
    // a crate there goes on the nearer barrel (straight up), never between
    expect(placeAt(base, "crates", (a.x + b.x) / 2 + 0.1, (a.z + b.z) / 2)!.on.length).toBe(1);
    // straight up: three high, then full
    const list: GoodsItem[] = [{ ...a, on: [] }];
    for (let i = 1; i < 3; i++) {
      const p = placeAt(list, "crates", a.x, a.z)!;
      list.push({ ...a, id: `t${i}`, kind: "crates", look: undefined, ...p });
    }
    expect(placeAt(list, "crates", a.x, a.z)).toBeNull();
  });
});

describe("M8f: lift and put down, checked by the server", () => {
  it("a lift of what another carries is refused ('Someone was quicker'); only the holder puts it down; the turn from the id and a count", () => {
    const db = blankSave();
    const { s, pushes } = store();
    const id = "own:peeters:0";
    ok(s.ask(db, 1, { op: "lift", id }));
    expect(s.get(id)!.by).toEqual({ p: 1 });
    const second = s.ask(db, 2, { op: "lift", id });
    expect(second.ok).toBe(false);
    expect(second.ok ? "" : second.why).toMatch(/quicker/);
    // the refusal carries the item as it is (his PC puts it back where the server has it)
    expect(!second.ok && second.items[0].by).toEqual({ p: 1 });
    expect(s.ask(db, 2, { op: "put", id, x: 5, z: 5 }).ok).toBe(false);
    // one thing at a time
    expect(s.ask(db, 1, { op: "lift", id: "own:peeters:1" }).ok).toBe(false);
    const it0 = s.get(id)!;
    const put = ok(s.ask(db, 1, { op: "put", id, x: it0.x + 3, z: it0.z }));
    expect(put.items[0]).toMatchObject({ by: null, n: 1, rot: rotFor(id, 1), y: 0 });
    // and now the other may have it
    ok(s.ask(db, 2, { op: "lift", id }));
    // every change went to every PC, numbered
    expect(pushes.map((p) => p.why)).toEqual(["lift", "put", "lift"]);
    expect(pushes.map((p) => p.v)).toEqual([1, 2, 3]);
  });

  it("the lower of a stack cannot be lifted; a put on a stack rests on it; a full stack is refused", () => {
    const db = blankSave();
    const { s } = store();
    expect(s.ask(db, 1, { op: "lift", id: "own:sooi:0" }).ok).toBe(false); // (the third crate is on it)
    ok(s.ask(db, 1, { op: "lift", id: "own:sooi:1" }));
    const top = s.get("own:sooi:2")!;
    const r = ok(s.ask(db, 1, { op: "put", id: "own:sooi:1", x: top.x + 0.1, z: top.z }));
    expect(r.items[0].on).toEqual(["own:sooi:2"]);
    expect(r.items[0].y).toBeCloseTo(1.4, 5);
    ok(s.ask(db, 1, { op: "lift", id: "own:sooi:3" }));
    expect(s.ask(db, 1, { op: "put", id: "own:sooi:3", x: top.x, z: top.z }).ok).toBe(false);
  });

  it("played together, a lift or a put further than 4 m from where his movement socket has him is refused", () => {
    const db = blankSave();
    const { s } = store();
    const it = s.get("own:tuur:0")!;
    setPositionSource((id) => (id === 2 ? { x: it.x + 10, z: it.z } : null));
    expect(s.ask(db, 2, { op: "lift", id: it.id }).ok).toBe(false);
    setPositionSource((id) => (id === 2 ? { x: it.x + 1, z: it.z } : null));
    ok(s.ask(db, 2, { op: "lift", id: it.id }));
    expect(s.ask(db, 2, { op: "put", id: it.id, x: it.x + 9, z: it.z }).ok).toBe(false);
    ok(s.ask(db, 2, { op: "put", id: it.id, x: it.x + 2, z: it.z }));
  });

  it("a job's goods: laid out by the server once, only its holder lifts them; owned goods anyone (a theft is a deed)", () => {
    const db = blankSave();
    const { s } = store();
    const job = jobFor(db, 2, { type: "carry", goods: "crates", from: "crane_foot", to: "hessenatie_door", items: 2 });
    const laid = ok(s.ask(db, 2, { op: "job", job, lay: true })).items;
    const count = (jobById(db, job)!.task as { count: number }).count;
    expect(count).toBeGreaterThan(0);
    expect(laid.map((i) => i.id)).toEqual(Array.from({ length: count }, (_, i) => `job:${job}:${i}`));
    // asked again (a reload): the same goods, none made twice
    expect(ok(s.ask(db, 2, { op: "job", job, lay: true })).items.map((i) => i.id)).toEqual(laid.map((i) => i.id));
    // another player: not his work, and not his to lay out
    expect(s.ask(db, 1, { op: "lift", id: laid[0].id })).toMatchObject({ ok: false, why: "That is another man's work." });
    expect(s.ask(db, 1, { op: "job", job, lay: true }).ok).toBe(false);
    ok(s.ask(db, 2, { op: "lift", id: laid[0].id }));
    // set down at the goal: delivered, the employer's
    const to = SPOTS.hessenatie_door;
    const put = ok(s.ask(db, 2, { op: "put", id: laid[0].id, x: to.x, z: to.z }));
    expect(put.items[0].job).toBeNull();
    // the host may take Tuur's cask (a theft is a deed, not the goods' business)
    ok(s.ask(db, 1, { op: "lift", id: "own:tuur:1" }));
  });

  it("a job's end takes its goods away (in hands too); a watch's pile stays the employer's", () => {
    const db = blankSave();
    const { s } = store();
    const carry = jobFor(db, 1, { type: "carry", goods: "sacks", from: "crane_foot", to: "hessenatie_door", items: 2 });
    const laid = ok(s.ask(db, 1, { op: "job", job: carry, lay: true })).items;
    ok(s.ask(db, 1, { op: "lift", id: laid[0].id }));
    ok(s.ask(db, 1, { op: "end", job: carry }));
    expect(s.list().some((i) => i.job === carry)).toBe(false);
    expect(s.carriedBy(1)).toBeNull();
    const watch = jobFor(db, 2, { type: "watch" });
    const pile = ok(s.ask(db, 2, { op: "job", job: watch, lay: true })).items;
    expect(pile.length).toBe(3);
    expect(pile.map((i) => i.rot)).toEqual([0, 0.4, 0.8]);
    s.endJob(watch);
    for (const it of pile) expect(s.get(it.id)).toMatchObject({ job: null, owner: pile[0].owner });
    // the sweep ends a job the server closed without its PC (a deadline, the cell)
    const other = jobFor(db, 3, { type: "carry", goods: "crates", items: 1 });
    ok(s.ask(db, 3, { op: "job", job: other, lay: true }));
    db.prepare("UPDATE job SET status = 'failed' WHERE id = ?").run(other);
    s.sweep(db);
    expect(s.list().some((i) => i.job === other)).toBe(false);
  });

  it("a thief at the watch takes the top of the pile; into the Schelde: gone for everyone, with where", () => {
    const db = blankSave();
    const { s, pushes } = store();
    const watch = jobFor(db, 1, { type: "watch" });
    const pile = ok(s.ask(db, 1, { op: "job", job: watch, lay: true })).items;
    ok(s.ask(db, 1, { op: "take", id: pile[2].id }));
    expect(s.get(pile[2].id)).toBeNull();
    expect(s.ask(db, 2, { op: "take", id: pile[1].id }).ok).toBe(false);
    ok(s.ask(db, 1, { op: "lift", id: "own:fientje:0" }));
    ok(s.ask(db, 1, { op: "drop", id: "own:fientje:0", why: "sunk", at: [44, 9] }));
    expect(pushes.at(-1)).toMatchObject({ why: "sunk", gone: ["own:fientje:0"], at: [44, 9] });
  });

  it("a player who leaves sets down what he held where he last stood; unknown place: where it came from", () => {
    const db = blankSave();
    const { s } = store();
    const it = s.get("own:tuur:0")!;
    ok(s.ask(db, 2, { op: "lift", id: it.id }));
    s.playerLeft(2, { x: it.x + 5, z: it.z + 1 }, db);
    expect(s.get(it.id)).toMatchObject({ by: null, x: it.x + 5, z: it.z + 1 });
    ok(s.ask(db, 3, { op: "lift", id: it.id }));
    s.playerLeft(3, null, db);
    expect(s.get(it.id)).toMatchObject({ by: null, x: it.x + 5, z: it.z + 1 });
  });

  it("after a save is loaded: the job's goods as they lay, and what he held", () => {
    const db = blankSave();
    const { s } = store();
    const job = jobFor(db, 1, { type: "carry", goods: "crates", from: "crane_foot", to: "hessenatie_door", items: 3 });
    ok(s.ask(db, 1, { op: "job", job, lay: true }));
    const r = ok(s.ask(db, 1, { op: "restore", job, lying: [{ kind: "crates", x: 3, z: 9, rot: 0.2 }], carried: { kind: "crates", job, owner: null } }));
    const mine = s.list().filter((i) => i.job === job);
    expect(mine.length).toBe(2);
    expect(mine.find((i) => !i.by)).toMatchObject({ x: 3, z: 9, rot: 0.2 });
    expect(s.carriedBy(1)?.job).toBe(job);
    expect(r.items.length).toBe(2);
  });
});

describe("M8f: townspeople and carts move goods through the same store", () => {
  it("a hired hand's lift is taken only from the PC that walks him (or, nobody walking him, his hirer's)", () => {
    const db = blankSave();
    const { s } = store();
    installCarryBack();
    const job = jobFor(db, 2, { type: "carry", goods: "crates", from: "crane_foot", to: "hessenatie_door", items: 2 });
    const laid = ok(s.ask(db, 2, { op: "job", job, lay: true })).items;
    const hand = town(db).town.residents.find((r) => r.trade === "docker")!.id;
    // no errand: nobody may report him lifting
    expect(s.ask(db, 2, { op: "npc_lift", npc: hand, ids: [laid[0].id] }).ok).toBe(false);
    // his errand for player 2 (a bare routine as the hire makes)
    asPlayer(2, () => devRoutine(db, hand, [{ kind: "pick_up", job, x: laid[0].x, z: laid[0].z }], "hire", 60, { player: 2 }));
    // together: player 1's PC walks him, so player 2's word is not taken; player 1's is
    setWalkerSource((npc) => (npc === hand ? 1 : 0));
    expect(s.ask(db, 2, { op: "npc_lift", npc: hand, ids: [laid[0].id] })).toMatchObject({ ok: false, why: "That townsperson is walked by another PC." });
    ok(s.ask(db, 1, { op: "npc_lift", npc: hand, ids: [laid[0].id] }));
    expect(s.get(laid[0].id)!.by).toEqual({ npc: hand });
    // nobody walks him (out of every street): his hirer's PC
    setWalkerSource(() => 0);
    ok(s.ask(db, 2, { op: "npc_put", npc: hand, id: laid[0].id, x: laid[0].x + 2, z: laid[0].z }));
    // not his job's goods: Tuur's cask is not his to lift
    expect(s.ask(db, 2, { op: "npc_lift", npc: hand, ids: ["own:tuur:0"] }).ok).toBe(false);
  });

  it("the carry-back: an owned crate left off its place for 20 game minutes is carried home by a man of the quay", () => {
    const db = blankSave();
    const s = theStore;
    s.reset(false);
    installCarryBack();
    const id = "own:peeters:1";
    const it = s.get(id)!;
    s.moveGoods({ world: true }, id, it.x + 6, it.z, db);
    // a docker seen in the street near it (the client's word)
    const hand = town(db).town.residents.find((r) => r.trade === "docker")!;
    db.prepare("UPDATE player SET hour = 10, minute = 0 WHERE id = 1").run();
    syncFromClient({ x: it.x + 4, z: it.z, people: [{ id: hand.id, x: it.x + 8, z: it.z }] }, Date.now(), db);
    expect(carryBackTick(db)).toBeNull(); // (just moved: not yet)
    db.prepare("UPDATE player SET minute = 25 WHERE id = 1").run();
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('clock', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify({ day: 1, hour: 10, minute: 25 }));
    const who = carryBackTick(db) ?? startBack(db, hand.id, id);
    expect(who).toBeTruthy();
    const x = activeRoutines(db, "goods_back")[0];
    expect(x.r.steps.map((q) => q.kind)).toEqual(["pick_up", "carry"]);
    // his PC reports the lift: the crate is in his arms on every PC
    ok(s.ask(db, 1, { op: "npc_lift", npc: x.row.npc_id, ids: [id] }));
    reportStep(db, x.row.id, 0, true, "picked up", (r) => (r.state.holding = 1));
    // and the put down: where it belongs, whatever point the PC said
    ok(s.ask(db, 1, { op: "npc_put", npc: x.row.npc_id, id, x: 0, z: 0 }));
    expect(s.get(id)).toMatchObject({ by: null, x: it.home![0], z: it.home![1] });
    reportStep(db, x.row.id, 1, true, "delivered");
    expect(activeRoutines(db, "goods_back").length).toBe(0);
  });

  it("the dray takes the whole pile, sets it down as a pyramid elsewhere, and brings it home at five", () => {
    const db = blankSave();
    const { s, pushes } = store();
    const ids = [0, 1, 2].map((i) => `pile:${DRAY_RUN.pile}:${i}`);
    expect(s.drayTick(2, DRAY_RUN.out - 5, db)).toBeNull();
    expect(s.drayTick(2, DRAY_RUN.out + 1, db)).toBe("out");
    for (const id of ids) expect(s.get(id)!.by).toEqual({ cart: DRAY_RUN.cart });
    expect(s.drayTick(2, DRAY_RUN.down, db)).toBe("down");
    const top = ids.map((id) => s.get(id)!).find((i) => i.on.length === 2)!;
    expect(top).toBeTruthy();
    expect(top.y).toBeCloseTo(0.95, 5);
    expect(Math.hypot(top.x - DRAY_RUN.to[0], top.z - DRAY_RUN.to[1])).toBeLessThan(0.01);
    expect(s.drayTick(2, DRAY_RUN.back, db)).toBe("back");
    expect(s.drayTick(2, DRAY_RUN.home, db)).toBe("home");
    const pile = PILES.find((p) => p.id === DRAY_RUN.pile)!;
    ids.forEach((id, i) => expect(s.get(id)).toMatchObject({ by: null, x: pileSpot(pile, i)[0], z: pileSpot(pile, i)[1], y: 0 }));
    expect(pushes.filter((p) => p.who && "cart" in p.who).length).toBe(4);
    // a pile a player has touched is not taken; Sundays the dray stays in
    const t = new GoodsStore();
    ok(t.ask(db, 1, { op: "lift", id: ids[0] }));
    expect(t.drayTick(3, DRAY_RUN.out + 1, db)).toBe("skip");
    expect(new GoodsStore().drayTick(7, DRAY_RUN.out + 1, db)).toBeNull();
  });

  it("spawn, move and remove for the town's own work, each pushed with who did it", () => {
    const { s, pushes } = store();
    const made = s.spawnGoods({ npc: "karel" }, [{ kind: "crates", owner: "sooi", x: 10, z: 10 }, { id: "delivery:1", kind: "sacks", owner: null, x: 12, z: 10 }]);
    expect(made.map((i) => i.id)).toEqual(["spawn:1", "delivery:1"]);
    expect(s.moveGoods({ npc: "karel" }, "spawn:1", 11, 11)).toMatchObject({ x: 11, z: 11 });
    expect(s.removeGoods({ cart: "dray:x" }, ["delivery:1"], "shipped")).toEqual(["delivery:1"]);
    expect(pushes.map((p) => [p.why, p.who])).toEqual([
      ["spawn", { npc: "karel" }],
      ["put", { npc: "karel" }],
      ["shipped", { cart: "dray:x" }],
    ]);
  });
});

describe("M8f: Jef's handcart carries the same items", () => {
  it("onto the cart by id (the store's word on what it is), off into his hands the same item; tipped off at the goal on its slots, delivered", () => {
    const db = openDb(":memory:");
    db.prepare("UPDATE player SET day = 2, hour = 10, minute = 0 WHERE id = 1").run();
    db.prepare("UPDATE player SET money_c = 1000 WHERE id = 1").run();
    buy(db, WHEELWRIGHT_ID, "handcart_used");
    const c = jefCarts(db).list[0];
    const s = theStore;
    s.reset(false);
    const job = jobFor(db as unknown as Db, 1, { type: "carry", goods: "crates", from: "crane_foot", to: "hessenatie_door", items: 2 });
    const laid = ok(s.ask(db, 1, { op: "job", job, lay: true })).items;
    // a PC that says "a barrel of no job" for a job's crate: the store's word counts
    ok(s.ask(db, 1, { op: "lift", id: laid[0].id }));
    const put = loadCart(db, c.id, { kind: "barrels", job: null, gid: laid[0].id }, c.x, c.z);
    expect(put.item).toMatchObject({ kind: "crates", job, gid: laid[0].id });
    expect(s.get(laid[0].id)!.by).toEqual({ cart: `hc:1:${c.id}` });
    // not his to load: an item he does not hold
    expect(() => loadCart(db, c.id, { kind: "crates", gid: "own:tuur:0" }, c.x, c.z)).toThrow(/not carrying/);
    // off again: the same item in his hands
    const off = unloadOne(db, c.id, c.x, c.z);
    expect(unloadedGoods(db, c.id, off.item)!.id).toBe(laid[0].id);
    expect(s.get(laid[0].id)!.by).toEqual({ p: 1 });
    loadCart(db, c.id, { gid: laid[0].id }, c.x, c.z);
    if (laid[1]) {
      ok(s.ask(db, 1, { op: "lift", id: laid[1].id }));
      loadCart(db, c.id, { gid: laid[1].id }, c.x, c.z);
    }
    // wheeled to the goal and tipped off: on its slots there, the employer's (delivered), the same ids
    const to = SPOTS.hessenatie_door;
    holdCart(db, c.id, c.x, c.z);
    let [cx, cz] = [c.x, c.z];
    while (Math.hypot(to.x + 1.5 - cx, to.z + 1.5 - cz) > 40) {
      const k = 40 / Math.hypot(to.x + 1.5 - cx, to.z + 1.5 - cz);
      cx += (to.x + 1.5 - cx) * k;
      cz += (to.z + 1.5 - cz) * k;
      cartAt(db, c.id, cx, cz, 0, true);
    }
    cartAt(db, c.id, to.x + 1.5, to.z + 1.5, 0, false);
    const r = unloadJob(db, c.id, job, to.x + 1, to.z);
    const placed = unloadedJobGoods(db, c.id, job, r.items);
    expect(placed.map((i) => i.id).sort()).toEqual(laid.map((i) => i.id).sort());
    for (const it of placed) {
      expect(it).toMatchObject({ by: null, job: null });
      expect(Math.hypot(it.x - to.x, it.z - to.z)).toBeLessThan(2.2);
    }
  });
});

describe("M8f: the route, a late joiner, the limits", () => {
  it("GET gives a late joiner the list as it is now; POST answers 409 with the item on a refusal; 413 too large; 429 over the rate", async () => {
    const db = blankSave();
    const app = new Hono();
    const pushed: unknown[] = [];
    theStore.reset(false);
    mountGoods(app, { db, broadcast: (m) => pushed.push(m) });
    const post = (b: unknown) => app.request("/api/goods", { method: "POST", headers: { "content-type": "application/json" }, body: typeof b === "string" ? b : JSON.stringify(b) });
    expect((await post({ op: "lift", id: "own:tuur:0" })).status).toBe(200);
    const late = (await (await app.request("/api/goods")).json()) as { v: number; you: number; items: GoodsItem[] };
    expect(late.you).toBe(1);
    expect(late.items.find((i) => i.id === "own:tuur:0")!.by).toEqual({ p: 1 });
    expect(pushed.length).toBe(1);
    const again = await post({ op: "lift", id: "own:tuur:1" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { items: GoodsItem[] }).items[0].id).toBe("own:tuur:1");
    expect((await post({ op: "nonsense" })).status).toBe(400);
    expect((await post("{bad")).status).toBe(400);
    expect((await post({ op: "put", id: "x".repeat(GOODS_BODY_MAX) })).status).toBe(413);
    let limited = 0;
    for (let i = 0; i < GOODS_RATE.burst + 5; i++) if ((await post({ op: "lift", id: "own:tuur:0" })).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });

  it("a new week (a reset) sends the whole list, marked full", () => {
    const { s, pushes } = store();
    s.reset();
    expect(pushes[0]).toMatchObject({ why: "reset", full: true });
    expect(pushes[0].items.length).toBe(s.list().length);
    expect(goodsHooks).toBeTruthy();
  });
});

describe("M8f goods pass 2: the rest of the quay's cargo, and the carts' rounds", () => {
  const byId = (s: GoodsStore) => new Map(s.list().map((i) => [i.id, i]));

  it("the heaps' casks, crates and sacks are the server's items, laid as the bake has them (ids, places, turns, what rests on what)", () => {
    const s = new GoodsStore();
    const m = byId(s);
    const rows = QUAY_CARGO;
    expect(rows.length).toBeGreaterThan(500);
    for (const [id, node, kind, x, y, z, rot, h, on, heavy] of rows) {
      const it = m.get(id)!;
      expect(it).toMatchObject({ kind, look: `q:${node}`, x, y, z, rot, h, on, by: null, owner: null, job: null });
      expect(!!it.heavy).toBe(heavy === 1);
      for (const u of on) expect(m.get(u)!.y).toBeLessThan(y);
    }
    // every kind is there, and some of each rests on another (a pyramid's upper casks on two, a layer of sacks, a crate on a crate)
    for (const k of ["barrels", "crates", "sacks"]) {
      expect(rows.filter((r) => r[2] === k).length).toBeGreaterThan(20);
      expect(rows.filter((r) => r[2] === k && r[8].length).length).toBeGreaterThan(5);
    }
    expect(rows.some((r) => r[1].startsWith("casks_pyramid") && r[8].length === 2)).toBe(true);
  });

  it("taken top down: what something rests on is refused until that is off; a heavy one goes into both arms", () => {
    const db = blankSave();
    const s = new GoodsStore();
    const upper = QUAY_CARGO.find((r) => r[1].startsWith("casks_pyramid") && r[8].length === 2 && !QUAY_CARGO.some((q) => q[8].includes(r[0])))!;
    const [below] = upper[8];
    const refused = s.ask(db, 1, { op: "lift", id: below });
    expect(refused.ok ? "" : refused.why).toMatch(/on top/);
    ok(s.ask(db, 1, { op: "lift", id: upper[0] }));
    ok(s.ask(db, 1, { op: "put", id: upper[0], x: upper[3] + 3, z: upper[5] }));
    // (the one below: free now, unless another upper cask still rests on it)
    const still = s.list().some((o) => !o.by && o.on.includes(below));
    expect(s.ask(db, 1, { op: "lift", id: below }).ok).toBe(!still);
    const heavy = QUAY_CARGO.find((r) => r[9] === 1 && !QUAY_CARGO.some((q) => q[8].includes(r[0])))!;
    expect(s.get(heavy[0])!.heavy).toBe(true);
  });

  it("the Rijnkaai's big crates: the same places and turns as the props were, one across two, too big to lift by hand (a cart's work); the sacks one on another", () => {
    const db = blankSave();
    const s = new GoodsStore();
    const m = byId(s);
    CRATE_STACKS.forEach(([x, z, n], k) => {
      const g = 1.1 * 1.18 + 0.1;
      for (let i = 0; i < n; i++) {
        const it = m.get(`crate:${k}:${i}`)!;
        expect([it.x, it.z, it.y]).toEqual([r3(x + (i % 2) * g), r3(z + Math.floor(i / 2) * g), 0]);
        expect(it.rot).toBeCloseTo(Math.sin(x * 3 + i) * 0.08, 3);
        expect(it).toMatchObject({ cartOnly: true, sc: 1.1 });
      }
      if (n >= 2) expect(m.get(`crate:${k}:${n}`)).toMatchObject({ y: 1.1, on: [`crate:${k}:0`, `crate:${k}:1`], rot: 0.2 });
    });
    const top = s.ask(db, 1, { op: "lift", id: "crate:0:3" });
    expect(top.ok ? "" : top.why).toMatch(/cart's work/);
    expect(s.ask(db, 1, { op: "npc_lift", npc: "karel", ids: ["crate:4:0"] }).ok).toBe(false);
    SACK_PILES.forEach(([x, z], k) => {
      for (let i = 0; i < 6; i++) expect(m.get(`sack:${k}:${i}`)).toMatchObject({ x: r3(x + (i % 3) * 1.04), z, y: i < 3 ? 0 : 0.25, on: i < 3 ? [] : [`sack:${k}:${i - 3}`], look: "p:sack" });
    });
    // a sack taken off the top and put back: it lies on the one below again
    ok(s.ask(db, 1, { op: "lift", id: "sack:0:4" }));
    ok(s.ask(db, 1, { op: "put", id: "sack:0:4", x: 15.04, z: 19.5 }));
    expect(s.get("sack:0:4")).toMatchObject({ on: ["sack:0:1"], y: 0.25 });
  });

  it("the handcart's round with the sacks: the whole pile on at ten, down in the same shape by the berth at eleven, back at two, home at three", () => {
    const db = blankSave();
    const { s, pushes } = store();
    const R = CART_RUNS.find((r) => r.id === "sacks")!;
    const home = new Map(R.items.map((id) => [id, s.get(id)!]));
    expect(s.runTick("sacks", 2, R.out - 5, db)).toBeNull();
    expect(s.runTick("sacks", 2, R.out, db)).toBe("out");
    for (const id of R.items) expect(s.get(id)!.by).toEqual({ cart: R.cart });
    expect(s.onCart(R.cart).length).toBe(6);
    expect(s.runTick("sacks", 2, R.down + 2, db)).toBe("down");
    const dx = R.to[0] - home.get(R.items[0])!.x;
    const dz = R.to[1] - home.get(R.items[0])!.z;
    for (const id of R.items) {
      const h = home.get(id)!;
      expect(s.get(id)).toMatchObject({ by: null, x: r3(h.x + dx), z: r3(h.z + dz), y: h.y, on: h.on });
    }
    expect(s.runTick("sacks", 2, R.back, db)).toBe("back");
    expect(s.runTick("sacks", 2, R.home, db)).toBe("home");
    for (const id of R.items) {
      const h = home.get(id)!;
      expect(s.get(id)).toMatchObject({ by: null, x: h.x, z: h.z, y: h.y, on: h.on });
    }
    expect(pushes.filter((p) => p.who && "cart" in p.who && p.who.cart === R.cart).length).toBe(4);
    // the casks' dray and the sacks' handcart on one tick of the world's clock
    const t = new GoodsStore();
    expect(t.cartRunsTick(3, 8 * 60, db)).toEqual({ casks: "out", sacks: null });
    expect(t.cartRunsTick(3, 10 * 60, db)).toEqual({ casks: "down", sacks: "out" });
  });

  it("a pile touched, or with something of someone else's on it, stays; what is left on a cart comes home with the new day", () => {
    const db = blankSave();
    const R = CART_RUNS.find((r) => r.id === "sacks")!;
    const a = new GoodsStore();
    ok(a.ask(db, 1, { op: "lift", id: "sack:0:5" }));
    expect(a.runTick("sacks", 2, R.out, db)).toBe("skip");
    // someone's crate set on the pile: not taken with it
    const b = new GoodsStore();
    ok(b.ask(db, 1, { op: "lift", id: "own:sooi:3" }));
    ok(b.ask(db, 1, { op: "put", id: "own:sooi:3", x: 14, z: 19.5 }));
    expect(b.get("own:sooi:3")!.on).toEqual(["sack:0:3"]);
    expect(b.runTick("sacks", 2, R.out, db)).toBe("skip");
    // the day ends with the load still on the cart (a stage missed): the next day it is set down at home first
    const c = new GoodsStore();
    expect(c.runTick("sacks", 2, R.out, db)).toBe("out");
    c.runs.get("sacks")!.state = "skip";
    c.runTick("sacks", 3, 6 * 60, db);
    expect(c.onCart(R.cart)).toEqual([]);
    expect(c.get("sack:0:4")).toMatchObject({ by: null, y: 0.25, on: ["sack:0:1"] });
  });

  it("the drawn rounds: each leg starts where the last ended (the cart never jumps), the stages in order, the casks' place by the berth", () => {
    const R = CART_RUNS.find((r) => r.id === "casks")!;
    expect(R.to).toEqual(DRAY_RUN.to);
    for (const r of CART_RUNS) {
      const L = r.legs;
      const chain: Array<keyof typeof L> = ["out", "deliver", "back", "fetch", "bring", "home"];
      chain.forEach((k, i) => {
        const prev = L[chain[(i + chain.length - 1) % chain.length]];
        expect(L[k][0]).toEqual(prev[prev.length - 1]);
      });
      expect(r.out < r.down && r.down < r.back && r.back < r.home).toBe(true);
    }
  });
});
