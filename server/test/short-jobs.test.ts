import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { finishJob, ReportSchema, takeJob } from "../src/game.ts";
import {
  ALL_EMPLOYERS,
  clampBoard,
  devJob,
  FALLBACK_BOARD,
  FALLBACK_CART_JOB,
  fitCarry,
  gateCarts,
  listJobs,
  makeBoard,
  shortenOffered,
  SPOTS,
  taskFor,
  TIER_PAY,
  type Board,
  type CarryTask,
} from "../src/hooks/jobBoard.ts";
import {
  CART_AFTER_DONE,
  CART_LEFT_FEE_C,
  CART_LOST_C,
  CART_MAX,
  CART_MAX_MIN,
  CART_MIN,
  CART_RETURN_MIN,
  carryBand,
  cartCap,
  cartMinutes,
  cartWorkOpen,
  HAND_MAX,
  HAND_MAX_MIN,
  handMinutes,
  NO_CART_FROM,
  sayCount,
  walkDist,
} from "../src/hooks/loads.ts";
import { clampNight, FALLBACK_NIGHT, insertNightJobs, nightBand } from "../src/night/nightwork.ts";
import { postJob, type EventRow, type StoredStage } from "../src/director/scheduler.ts";
import { cartAt, cartHour, holdCart, jefCarts, lentSpot, loadCart, offRails, placeLent, unloadJob } from "../src/town/handcart.ts";
import { offLanes } from "../src/town/possessions.ts";
import { busyAt } from "../src/town/bikeshop.ts";
import { topMemories } from "../src/npcs.ts";

// M7 short jobs (Steve 2026-09-25): "Shorter jobs if it is fetching stuff. Fetching is boring, so no more
// than 2 items. Maybe sometimes a job with more, further in the game, if we own a cart or if we can use
// the owner's cart for it." docs/milestones/M7-short-jobs.md.

type DB = ReturnType<typeof openDb>;
type Job = Board["jobs"][number];
const reply = (output: unknown): Runner => async () => ({ output, usage: { in: 10, out: 20, cacheRead: 5 } });
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: DB) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const trust = (db: DB, f: string) => (db.prepare("SELECT trust FROM faction_trust WHERE faction = ?").get(f) as { trust: number }).trust;
const d = (a: string, b: string) => Math.hypot(SPOTS[a as "pier_head"].x - SPOTS[b as "pier_head"].x, SPOTS[a as "pier_head"].z - SPOTS[b as "pier_head"].z);
const never = () => 0.999;
const always = () => 0;

const carry = (over: Partial<Job> = {}): Job => ({
  title: "Sacks to the door",
  employer: "sooi",
  task_type: "carry",
  goods: "sacks",
  from: "crane_foot",
  to: "pier_head",
  twist: "none",
  urgent: false,
  recipient: "",
  pay_c: 120,
  risk: "low",
  pitch: "Sacks from the crane to the pier head.",
  ...over,
});
const other: Job[] = [
  { ...carry(), title: "Watch the tar", task_type: "watch", goods: "barrels", to: "west_sheds", pay_c: 80, pitch: "Stand by my tar till the bell." },
  { ...carry(), title: "A letter", employer: "tuur", task_type: "deliver", goods: "parcel", from: "pier_head", to: "ship_gangway", recipient: "the mate", pay_c: 100, pitch: "Don't open it." },
];
/** Three jobs done: cart work opens (CART_AFTER_DONE). */
function doneJobs(db: DB, n = CART_AFTER_DONE): void {
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, pitch, task_json, source, status) VALUES (1, 'old', 'sooi', 'rijnkaai', 'carry', 50, 'low', 0, 'x', '{}', 'test', 'done')").run();
}
const carryTask = (j: Job) => taskFor(j) as CarryTask;

describe("M7 short jobs: by hand at most two things, and about an hour's work", () => {
  it("whatever the model proposes: five, fifty, none or less than none become one or two", () => {
    for (const items of [5, 50, 3, 0, -4, 2, 1]) {
      const j = fitCarry(carry({ items }), TIER_PAY[0]);
      const t = carryTask(j);
      expect(t.count).toBeGreaterThanOrEqual(1);
      expect(t.count).toBeLessThanOrEqual(HAND_MAX);
      expect(t.cart).toBeUndefined();
      expect(j.items).toBe(t.count);
    }
    // no number given: from where the pay lies in the band
    expect(carryTask(fitCarry(carry({ pay_c: 150 }), TIER_PAY[0])).count).toBe(2);
    expect(carryTask(fitCarry(carry({ pay_c: 55 }), TIER_PAY[0])).count).toBe(1);
  });

  it("two that would take over the hour at a walk become one; one that still would, a nearer goal", () => {
    // pier head to the Hessenatie door, 55 m: two crates 86 game minutes, one 33
    expect(handMinutes("crates", 2, walkDist("pier_head", "hessenatie_door"))).toBeGreaterThan(HAND_MAX_MIN);
    const t = carryTask(fitCarry(carry({ goods: "crates", from: "pier_head", to: "hessenatie_door", items: 2 }), TIER_PAY[0]));
    expect(t).toMatchObject({ count: 1, from: "pier_head", to: "hessenatie_door" });
    // the crane to the Katoennatie's door, 170 m: even one is too long; the goal comes nearer
    const far = carryTask(fitCarry(carry({ goods: "barrels", from: "crane_foot", to: "katoen_door", items: 2 }), TIER_PAY[0]));
    expect(far.to).not.toBe("katoen_door");
    expect(handMinutes("barrels", far.count, walkDist(far.from, far.to))).toBeLessThanOrEqual(HAND_MAX_MIN);
    // the heavy one slows him (0.4): counted in
    expect(handMinutes("sacks", 2, 30, true)).toBeGreaterThan(handMinutes("sacks", 2, 30));
  });

  it("the way on foot, not the straight line: over the canal bridge the brewery to the west quay is far longer", () => {
    expect(d("brewery_yard", "canal_west")).toBeLessThan(35);
    expect(walkDist("brewery_yard", "canal_west")).toBeGreaterThan(70);
    // on the open quay the way is about the straight line
    expect(walkDist("crane_foot", "hessenatie_door")).toBeLessThan(d("crane_foot", "hessenatie_door") * 1.3);
    expect(walkDist("crane_foot", "hessenatie_door")).toBeGreaterThanOrEqual(d("crane_foot", "hessenatie_door"));
  });

  it("pay: the lower part of the tier's band by hand (tier 0: 50-90, one thing 50-70); other kinds keep the whole band", () => {
    expect(carryBand(TIER_PAY[0], false)).toEqual([50, 90]);
    expect(carryBand(TIER_PAY[0], false, true)).toEqual([50, 70]);
    expect(carryBand(TIER_PAY[0], true)).toEqual([100, 150]);
    expect(carryBand(TIER_PAY[1], false)).toEqual([150, 210]);
    const b = clampBoard({ jobs: [carry({ pay_c: 99999, items: 2 }), carry({ goods: "crates", from: "pier_head", to: "hessenatie_door", pay_c: 99999, items: 2 }), ...other.map((o) => ({ ...o, pay_c: 99999 }))] }, 0);
    expect(b.jobs.map((j) => j.pay_c)).toEqual([90, 70, 150, 150]);
  });

  it("every hand-written job keeps the rule: the day's fallback board, the night's, an event's work", () => {
    for (const j of clampBoard(FALLBACK_BOARD, 0).jobs.filter((x) => x.task_type === "carry")) {
      const t = carryTask(j);
      expect(t.count).toBeLessThanOrEqual(HAND_MAX);
      expect(t.count).toBe(j.items);
      expect(handMinutes(t.goods, t.count, walkDist(t.from, t.to))).toBeLessThanOrEqual(HAND_MAX_MIN);
      if (t.count === 2) expect(j.pitch).toMatch(/^Two /);
    }
    const db = openDb(":memory:");
    setClock(db, 1, 22);
    const ids = insertNightJobs(db, clampNight({ jobs: [...FALLBACK_NIGHT.jobs, { ...FALLBACK_NIGHT.jobs[2], items: 6, pay_c: 9999 }] }, 0), 0, "fallback");
    const [nlo, nhi] = carryBand(nightBand(0), false);
    for (const id of ids) {
      const j = listJobs(db, 1).find((x) => x.id === id)!;
      if (j.task?.kind !== "carry") continue;
      expect(j.task.count).toBeLessThanOrEqual(HAND_MAX);
      expect(j.task.cart).toBeUndefined();
      expect(j.pay_c).toBeGreaterThanOrEqual(nlo);
      expect(j.pay_c).toBeLessThanOrEqual(nhi);
    }
    // an event's work (the director's "job" stage)
    setClock(db, 1, 9);
    postJob(db, { id: 1, title: "The fish auction", x: -116, z: 24 } as unknown as EventRow, { op: "job", text: "Barrels to the carts" } as unknown as StoredStage);
    const ev = listJobs(db, 1).find((x) => x.source === "event")!;
    expect((ev.task as CarryTask).count).toBeLessThanOrEqual(HAND_MAX);
  });
});

describe("M7 short jobs: an older save's open work", () => {
  it("offered carry jobs of 3 to 5 by hand go to the new sizes, once: count, pay by the share, the words", () => {
    const db = openDb(":memory:");
    const ins = (task: object, pay: number, pitch: string, status = "offered") =>
      Number(db.prepare("INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, pitch, task_json, source, status) VALUES (1, 'Four sacks for the natie', 'sooi', 'rijnkaai', 'carry', ?, 'low', 0, ?, ?, 'claude', ?)").run(pay, pitch, JSON.stringify(task), status).lastInsertRowid);
    const a = ins({ kind: "carry", goods: "sacks", count: 4, from: "crane_foot", to: "pier_head", twist: "none", limit_s: null }, 120, "Four sacks from the crane to the pier head.");
    const b = ins({ kind: "carry", goods: "sacks", count: 4, from: "crane_foot", to: "pier_head", twist: "none", limit_s: null }, 120, "Four sacks.", "taken");
    expect(shortenOffered(db)).toBe(1);
    const ja = listJobs(db, 1).find((j) => j.id === a)!;
    expect(ja.task).toMatchObject({ count: 2, from: "crane_foot", to: "pier_head" });
    expect(ja.pay_c).toBe(60);
    expect(ja.pitch).toBe("Two sacks from the crane to the pier head.");
    expect(ja.title).toBe("Two sacks for the natie");
    // a job in hand stays as it was taken; a second run changes nothing
    expect((listJobs(db, 1).find((j) => j.id === b)!.task as CarryTask).count).toBe(4);
    expect(shortenOffered(db)).toBe(0);
  });
});

describe("M7 short jobs: the words name the engine's count", () => {
  it("'Two sacks' for one sack becomes 'A sack'; five crates on a cart of four, 'four crates'; hours and men untouched", () => {
    expect(sayCount("Two sacks of coffee from the end of the pier. Stack them straight.", 1)).toBe("A sack of coffee from the end of the pier. Stack them straight.");
    expect(sayCount("Bring two big sacks round.", 1)).toBe("Bring a big sack round.");
    expect(sayCount("Five crates off the crane", 4)).toBe("Four crates off the crane");
    expect(sayCount("Take 3 old barrels", 1)).toBe("Take an old barrel");
    expect(sayCount("Two men waited two hours for two crates.", 2)).toBe("Two men waited two hours for two crates.");
    // one named, more to carry (the model's "a barrel" on a cart of three)
    expect(sayCount("Take my handcart and run a barrel from the brewery door.", 3)).toBe("Take my handcart and run three barrels from the brewery door.");
    expect(sayCount("A crate of tea, and mind the box of nails.", 2)).toBe("Two crates of tea, and mind the two boxes of nails.".replace("the two boxes", "the box"));
    // a board the model wrote with "Two sacks" on work the engine made one (pier head to the Hessenatie door)
    const j = fitCarry(carry({ goods: "sacks", from: "pier_head", to: "hessenatie_door", items: 2, title: "Two sacks for the natie", pitch: "Two sacks of coffee from the end of the pier to the big door." }), TIER_PAY[0]);
    expect(j.items).toBe(1);
    expect(j.title).toBe("A sack for the natie");
    expect(j.pitch).toMatch(/^A sack of coffee/);
  });
});

describe("M7 short jobs: cart work, 3 to 8 things, one load, one to two game hours", () => {
  it("a cart takes what fits in one load: five crates or sacks, three barrels, eight coils of rope; a heavy barrel leaves too few", () => {
    expect(cartCap("crates")).toBe(5);
    expect(cartCap("sacks")).toBe(5);
    expect(cartCap("barrels")).toBe(3);
    expect(cartCap("rope")).toBe(CART_MAX);
    expect(cartCap("barrels", true)).toBeLessThan(CART_MIN);
    // the model asked for a cart with a heavy barrel: the cart stands (three barrels), the twist goes
    const heavy = carryTask(fitCarry(carry({ goods: "barrels", twist: "heavy_load", cart: true, items: 3 }), TIER_PAY[0]));
    expect(heavy).toMatchObject({ cart: true, count: 3, twist: "none" });
    // a heavy crate still leaves room for four
    expect(carryTask(fitCarry(carry({ goods: "crates", twist: "heavy_load", cart: true, items: 5 }), TIER_PAY[0]))).toMatchObject({ cart: true, count: 4, twist: "heavy_load" });
  });

  it("the model's count clamped to 3..one load; the cart job pays the band's upper half; its time fits two hours", () => {
    for (const [items, want] of [[1, 3], [4, 4], [50, 5]] as const) {
      const j = fitCarry(carry({ goods: "crates", from: "crane_foot", to: "hessenatie_door", cart: true, items }), TIER_PAY[0]);
      const t = carryTask(j);
      expect(t).toMatchObject({ cart: true, count: want });
      expect(j.pay_c).toBeGreaterThanOrEqual(100);
      expect(j.pay_c).toBeLessThanOrEqual(150);
      expect(cartMinutes("crates", t.count, walkDist(t.from, t.to))).toBeLessThanOrEqual(CART_MAX_MIN);
    }
    const t = carryTask(fitCarry(FALLBACK_CART_JOB, TIER_PAY[0]));
    const m = cartMinutes(t.goods, t.count, walkDist(t.from, t.to));
    expect(m).toBeGreaterThanOrEqual(60);
    expect(m).toBeLessThanOrEqual(120);
  });

  it("never on the pier or at the gangway: another of the employer's places, else by hand", () => {
    const t = carryTask(fitCarry(carry({ goods: "crates", from: "pier_head", to: "hessenatie_door", cart: true, items: 5 }), TIER_PAY[0]));
    expect(t.cart).toBe(true);
    expect(["pier_head", "ship_gangway"]).not.toContain(t.from);
    expect(["pier_head", "ship_gangway"]).not.toContain(t.to);
  });

  it("the gate: closed in a new game (every job by hand); open after three jobs done, or with a cart of his own; one cart job a board", async () => {
    const two = { jobs: [carry({ cart: true, items: 6 }), carry({ cart: true, items: 6, goods: "crates" }), ...other] };
    const db = openDb(":memory:");
    expect(cartWorkOpen(db)).toBe(false);
    await makeBoard(db, reply(two));
    const shut = listJobs(db, 1).filter((j) => j.task?.kind === "carry");
    expect(shut.every((j) => (j.task as CarryTask).count <= HAND_MAX && !(j.task as CarryTask).cart)).toBe(true);
    expect(shut.every((j) => j.pay_c <= 90)).toBe(true);

    const db2 = openDb(":memory:");
    doneJobs(db2, CART_AFTER_DONE - 1);
    expect(cartWorkOpen(db2)).toBe(false);
    doneJobs(db2, 1);
    expect(cartWorkOpen(db2)).toBe(true);
    await makeBoard(db2, reply(two));
    const open = listJobs(db2, 1).filter((j) => j.task?.kind === "carry");
    expect(open.filter((j) => (j.task as CarryTask).cart).length).toBe(1);
    expect(gateCarts(two, true).jobs.filter((j) => j.cart).length).toBe(1);

    // a cart of his own opens it at once
    const db3 = openDb(":memory:");
    db3.prepare("INSERT INTO world_state (key, value_json) VALUES ('jef_carts', ?)").run(JSON.stringify({ n: 1, list: [{ id: "cart:jef1", kind: "used", x: 0, z: 0, yaw: 0, held: false, load: [] }] }));
    expect(cartWorkOpen(db3)).toBe(true);
  });

  it("the fallback board carries the hand-written cart job only when the gate is open", async () => {
    const late: Runner = async () => {
      throw new Error("down");
    };
    const db = openDb(":memory:");
    await makeBoard(db, late, 200);
    expect(listJobs(db, 1).some((j) => (j.task as CarryTask | null)?.cart)).toBe(false);
    const db2 = openDb(":memory:");
    doneJobs(db2);
    await makeBoard(db2, late, 200);
    const cartJob = listJobs(db2, 1).find((j) => (j.task as CarryTask | null)?.cart)!;
    expect(cartJob.title).toBe(FALLBACK_CART_JOB.title);
    expect(cartJob.task).toMatchObject({ kind: "carry", goods: "crates", count: 5, from: "crane_foot", to: "hessenatie_door", cart: true });
  });
});

describe("M7 short jobs: the employer's handcart, lent at the start and back at the end", () => {
  /** A cart job taken: the lent cart stands by the goods at the foot of the crane. */
  function cartJob() {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const { id } = devJob(db, { type: "carry", cart: true });
    takeJob(db, id);
    const c = jefCarts(db).list.find((q) => q.kind === "lent")!;
    return { db, id, c };
  }
  const push = (db: DB, cid: string, x: number, z: number) => {
    const c = jefCarts(db).list.find((q) => q.id === cid)!;
    if (!c.held) holdCart(db, cid, c.x, c.z);
    let [cx, cz] = [c.x, c.z];
    while (Math.hypot(x - cx, z - cz) > 40) {
      const k = 40 / Math.hypot(x - cx, z - cz);
      cx += (x - cx) * k;
      cz += (z - cz) * k;
      cartAt(db, cid, cx, cz, 0, true);
    }
    cartAt(db, cid, x, z, 0, false);
  };

  it("taken: Sooi's handcart stands by the goods (not on them), empty, lent; a second take does not lend twice", () => {
    const { db, id, c } = cartJob();
    expect(c).toMatchObject({ kind: "lent", job: id, lender: "sooi", label: "Sooi's handcart", held: false, load: [] });
    const from = SPOTS.crane_foot;
    const dd = Math.hypot(c.x - from.x, c.z - from.z);
    expect(dd).toBeGreaterThan(1.5);
    expect(dd).toBeLessThan(12);
    // off the quay railway and the lanes (the goods train would wait for it)
    expect(offLanes(c.x, c.z, 0.9)).toBe(true);
    expect(offRails(c.x, c.z, 0.9)).toBe(true);
    expect(jefCarts(db).notice?.text).toMatch(/Sooi's handcart stands by the goods/);
    expect(jefCarts(db).list.filter((q) => q.kind === "lent").length).toBe(1);
  });

  it("loaded, pushed, tipped off at the goal: paid the job's pay; brought back where it stood: taken in, nothing to pay", () => {
    const { db, id, c } = cartJob();
    const t = listJobs(db, 2).find((j) => j.id === id)!.task as CarryTask;
    for (let i = 0; i < t.count; i++) loadCart(db, c.id, { kind: "crates", job: id }, c.x, c.z);
    const to = SPOTS[t.to];
    push(db, c.id, to.x, to.z);
    const at = jefCarts(db).list.find((q) => q.id === c.id)!;
    expect(unloadJob(db, c.id, id, to.x, to.z).items.length).toBe(t.count);
    const m0 = money(db);
    const r = finishJob(db, id, ReportSchema.parse({ delivered: t.count }), never);
    expect(r.settlement.pay_c).toBe(listJobs(db, 2).find((j) => j.id === id)!.pay_c);
    expect(money(db)).toBe(m0 + r.settlement.pay_c);
    // the tick: the hour to bring it back starts
    expect(cartHour(db, never)).toContain("due");
    expect(jefCarts(db).notice?.text).toMatch(/goes back to the foot of the crane within the hour/);
    void at;
    push(db, c.id, c.x, c.z);
    expect(jefCarts(db).list.some((q) => q.id === c.id)).toBe(false);
    expect(jefCarts(db).notice?.text).toMatch(/where it stood/);
    expect(money(db)).toBe(m0 + r.settlement.pay_c);
  });

  it("left lying past the hour: his man fetches it, 20 c off the purse and naties trust -1; Sooi remembers", () => {
    const { db, id, c } = cartJob();
    const t = listJobs(db, 2).find((j) => j.id === id)!.task as CarryTask;
    push(db, c.id, SPOTS[t.to].x - 3, SPOTS[t.to].z);
    finishJob(db, id, ReportSchema.parse({ delivered: t.count }), never);
    cartHour(db, never);
    const m0 = money(db);
    const t0 = trust(db, "naties");
    setClock(db, 2, 10, 30);
    cartHour(db, never);
    expect(jefCarts(db).list.some((q) => q.id === c.id)).toBe(true); // within the hour
    setClock(db, 2, 10 + Math.ceil(CART_RETURN_MIN / 60), 5);
    cartHour(db, never);
    expect(jefCarts(db).list.some((q) => q.id === c.id)).toBe(false);
    expect(money(db)).toBe(m0 - CART_LEFT_FEE_C);
    expect(trust(db, "naties")).toBe(t0 - 1);
    expect(topMemories(db, "sooi").some((m) => /fetch it/.test(m.text))).toBe(true);
  });

  it("wheeled off by a thief while Jef was away: he pays for it (100 c) and naties trust -2", () => {
    const { db, c } = cartJob();
    expect(busyAt(db, c.x, c.z)).toBe(true); // the quay by the crane is a busy place
    const m0 = money(db);
    db.prepare("UPDATE player SET money_c = 500 WHERE id = 1").run();
    const t0 = trust(db, "naties");
    expect(cartHour(db, always, Date.now())).toContain("stolen");
    expect(money(db)).toBe(500 - CART_LOST_C);
    expect(trust(db, "naties")).toBe(t0 - 2);
    expect(topMemories(db, "sooi").some((m) => /thief/.test(m.text))).toBe(true);
    void m0;
  });

  it("every place cart work may start from has room for the lent cart", () => {
    const starts = new Set(Object.values(ALL_EMPLOYERS).filter((e) => !e.night).flatMap((e) => e.area).filter((s) => !NO_CART_FROM.includes(s)));
    const none = [...starts].filter((s) => !lentSpot(s));
    expect(none).toEqual([]);
    for (const s of starts) expect(offRails(lentSpot(s)![0], lentSpot(s)![1], 0.9)).toBe(true);
  });

  it("the client may settle the lent cart once, a few metres off, never on the rails; it goes back there", () => {
    const { db, c } = cartJob();
    expect(() => placeLent(db, c.id, c.x + 30, c.z, 0)).toThrow(/too far/);
    const moved = placeLent(db, c.id, c.x + 0.5, c.z, -1.571);
    expect(moved).toMatchObject({ placed: true, home: [moved.x, moved.z] });
    expect(() => placeLent(db, c.id, c.x, c.z, 0)).toThrow(/stays/);
  });

  it("with his own cart standing by the goods, no cart is lent", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const from = SPOTS.crane_foot;
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('jef_carts', ?)").run(JSON.stringify({ n: 1, list: [{ id: "cart:jef1", kind: "used", since: 0, paid_c: 200, label: "your handcart", x: from.x + 6, z: from.z + 3, yaw: 0, held: false, load: [] }] }));
    const { id } = devJob(db, { type: "carry", cart: true });
    takeJob(db, id);
    expect(jefCarts(db).list.some((q) => q.kind === "lent")).toBe(false);
  });
});
