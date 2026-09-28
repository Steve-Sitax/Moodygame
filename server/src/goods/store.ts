import type { DB } from "../db.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import SPOT_TABLE from "../../../shared/spots.json" with { type: "json" };
import CARGO_TABLE from "../../../shared/quaycargo.json" with { type: "json" };
import {
  CART_RUNS,
  GOODS_KINDS,
  hasAbove,
  isGoodsKind,
  levelOf,
  pileRot,
  placeAt,
  pyramidSpots,
  r3,
  rotFor,
  slotAt,
  townGoods,
  freeAt,
  haulPileItem,
  type CargoRow,
  type CartRun,
  type Door,
  type GoodsAsk,
  type GoodsItem,
  type GoodsKind,
  type GoodsPush,
  type Holder,
  type Spot,
} from "../../../shared/goods.ts";
import { CRANE_FED, HAUL_PILE_N, HAUL_ROUTES, haulPay, haulRouteOfItem, type HaulRoute } from "../../../shared/hauls.ts";
import { jobById, type JobRow } from "../hooks/jobBoard.ts";
import { positionOf, walkerOf } from "../player/current.ts";

// M8f "shared goods" (docs/milestones/M8f.md): the server keeps every liftable item of the town. A PC draws the list
// and asks (routes.ts); the server checks who asks, where he stands, whose the goods are, and tells every PC what
// changed. The townspeople's work with the goods (a hired hand, a man carrying a crate back, a dray taking a pile)
// goes through the same store with a townsperson or a cart as the actor. Kept in memory: a new week, a loaded save
// and a restart start from the town's own goods again (as the PCs did before), a job's goods are laid out again
// from the job when its PC asks.

const DOORS = (CITY as unknown as { doors: Record<string, Door> }).doors;
/** M8f goods pass 2: the cargo of the quays' heaps (tools/bake-quaycargo.mjs). */
export const QUAY_CARGO = (CARGO_TABLE as unknown as { items: CargoRow[] }).items;
export const SPOTS = Object.fromEntries(Object.entries(SPOT_TABLE).filter(([k]) => !k.startsWith("_"))) as unknown as Record<string, Spot & { label: string }>;

/** A lift or a put further than this from where his movement socket has him (m) is refused (only together: alone the tab's word is too old to check). */
export const REACH_M = 4;
/** A job's goods set down this near its goal are delivered: the employer's then, no longer the job's (client HaulRun.onPlaced). */
export const DELIVER_M = 2.2;
/** A townsperson holding goods with no errand any more: after this long they go back where they came from (ms). */
const NPC_ORPHAN_MS = 20_000;
/** At most this many in one request. */
const MAX_IDS = 6;
const MAX_RESTORE = 12;

export type Actor = { p: number } | { npc: string } | { cart: string } | { world: true };

export type Answer = { ok: true; items: GoodsItem[]; gone: string[] } | { ok: false; why: string; items: GoodsItem[] };

class Refuse extends Error {}
const no = (why: string): never => {
  throw new Refuse(why);
};

const clone = (it: GoodsItem): GoodsItem => ({ ...it, on: [...it.on], by: it.by ? { ...it.by } : null, ...(it.home ? { home: [...it.home] as [number, number, number] } : {}) });
const heldBy = (it: GoodsItem, h: Holder): boolean => !!it.by && JSON.stringify(it.by) === JSON.stringify(h);
const finite = (...v: unknown[]) => v.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 5000);

export class GoodsStore {
  private items = new Map<string, GoodsItem>();
  /** Pushes so far (a PC that misses one asks for the whole list). */
  v = 0;
  private send: (m: GoodsPush) => void = () => {};
  /** Jobs whose goods were made in this run of the server. */
  private made = new Set<number>();
  /** Per job, the next number of its goods (job:<job>:<n>, made in a fixed order). */
  private jobN = new Map<number, number>();
  /** Ship cargo swung down already (job:i). */
  private lowered = new Set<string>();
  private spawnN = 0;
  /** When a crane last set a load on each route's pile (real ms: one swing at a time). */
  private craneAt = new Map<string, number>();
  /** Where an item was when it was lifted (x, z, turn): back there if its carrier goes and nobody knows where he stood. */
  private from = new Map<string, [number, number, number]>();
  /** A townsperson's goods: the player whose PC reported the lift (it may still set them down after the errand ended). */
  private reporter = new Map<string, number>();
  /** A townsperson's goods with no errand: since when (ms). */
  private orphan = new Map<string, number>();
  /** Owned goods off their place: since when (the world's game minute), for the man who carries them back. */
  private offSince = new Map<string, number>();
  /**
   * Each cart's round today (shared/goods.ts CART_RUNS): "home", "out" (on the cart), "down" (set down at `to`), "back"
   * (on the cart), "skip" (done, or the pile was touched).
   */
  runs = new Map<string, { state: "home" | "out" | "down" | "back" | "skip"; day: number }>();
  /** The Hessenatie's dray with the casks (the first run). */
  get dray(): { state: "home" | "out" | "down" | "back" | "skip"; day: number } {
    return this.runOf("casks");
  }
  private runOf(id: string): { state: "home" | "out" | "down" | "back" | "skip"; day: number } {
    let r = this.runs.get(id);
    if (!r) this.runs.set(id, (r = { state: "home", day: 0 }));
    return r;
  }
  /** Where the town's own goods lie at the start (their foot and what they rest on too), for the carts' rounds. */
  private homes = new Map<string, { x: number; z: number; y: number; rot: number; on: string[] }>();
  /** Counts for the tests and the stats. */
  readonly stats = { asks: 0, refused: 0, pushes: 0 };

  constructor() {
    this.reset(false);
  }

  /** The push to every PC (index.ts wires the push channel in). */
  onPush(f: (m: GoodsPush) => void): void {
    this.send = f;
  }

  /** A new week, a loaded save: the town's own goods, as at the start. */
  reset(push = true): void {
    this.items.clear();
    this.homes.clear();
    for (const it of townGoods(DOORS, QUAY_CARGO)) {
      this.items.set(it.id, it);
      this.homes.set(it.id, { x: it.x, z: it.z, y: it.y, rot: it.rot, on: [...it.on] });
    }
    this.made.clear();
    this.jobN.clear();
    this.lowered.clear();
    this.from.clear();
    this.reporter.clear();
    this.orphan.clear();
    this.offSince.clear();
    this.runs.clear();
    this.craneAt.clear();
    if (push) this.commit([...this.items.values()], [], "reset", undefined, { full: true, keepRev: true });
  }

  list(): GoodsItem[] {
    return [...this.items.values()].map(clone);
  }

  get(id: string): GoodsItem | null {
    const it = this.items.get(id);
    return it ? clone(it) : null;
  }

  /** What a player holds (one thing at most). */
  carriedBy(p: number): GoodsItem | null {
    for (const it of this.items.values()) if (it.by && "p" in it.by && it.by.p === p) return clone(it);
    return null;
  }

  private all(): GoodsItem[] {
    return [...this.items.values()];
  }

  private commit(changed: GoodsItem[], gone: string[], why: string, who?: Actor, extra: { full?: boolean; at?: [number, number]; keepRev?: boolean } = {}): void {
    if (!changed.length && !gone.length && !extra.full) return;
    for (const it of changed) {
      if (!extra.keepRev) it.rev++;
      this.items.set(it.id, it);
    }
    for (const id of gone) {
      this.items.delete(id);
      this.from.delete(id);
      this.reporter.delete(id);
      this.orphan.delete(id);
      this.offSince.delete(id);
    }
    this.v++;
    this.stats.pushes++;
    const m: GoodsPush = { type: "goods", v: this.v, items: changed.map(clone), gone, why, ...(who ? { who: "world" in who ? { world: true } : who } : {}), ...(extra.full ? { full: true } : {}), ...(extra.at ? { at: extra.at } : {}) };
    try {
      this.send(m);
    } catch (e) {
      console.warn("[goods] push", e);
    }
  }

  private nextJobId(job: number): string {
    const n = this.jobN.get(job) ?? 0;
    this.jobN.set(job, n + 1);
    return `job:${job}:${n}`;
  }

  /** Make one item where it comes to rest at (x, z) (on a stack there, or the ground). */
  private make(spec: { id: string; kind: GoodsKind; look?: "cask"; owner: string | null; job: number | null; x: number; z: number; rot?: number; broken?: boolean; heavy?: boolean; keep?: boolean; by?: Holder | null }): GoodsItem {
    const p = spec.by ? { x: spec.x, z: spec.z, y: 0, on: [] as string[] } : (placeAt(this.all(), spec.kind, spec.x, spec.z) ?? { x: r3(spec.x), z: r3(spec.z), y: 0, on: [] });
    const it: GoodsItem = {
      id: spec.id,
      kind: spec.kind,
      ...(spec.look ? { look: spec.look } : {}),
      owner: spec.owner,
      job: spec.job,
      x: p.x,
      z: p.z,
      y: p.y,
      rot: spec.rot ?? rotFor(spec.id, 0),
      on: p.on,
      by: spec.by ?? null,
      n: 0,
      rev: 0,
      ...(spec.broken ? { broken: true } : {}),
      ...(spec.heavy ? { heavy: true } : {}),
      ...(spec.keep ? { keep: true } : {}),
    };
    this.items.set(it.id, it);
    return it;
  }

  /** Set a held or lying item down at (x, z) by the stacking rule; null when the stack there is full. */
  private rest(it: GoodsItem, x: number, z: number, db: DB | null): GoodsItem | null {
    const p = placeAt(this.all(), it.kind, x, z, it.id);
    if (!p) return null;
    it.x = p.x;
    it.z = p.z;
    it.y = p.y;
    it.on = p.on;
    it.by = null;
    it.n++;
    it.rot = rotFor(it.id, it.n);
    this.from.delete(it.id);
    this.reporter.delete(it.id);
    this.orphan.delete(it.id);
    if (db) this.delivered(db, it);
    return it;
  }

  /** A carry job's goods set down by its goal are delivered: the employer's now (as the client's HaulRun.onPlaced). */
  private delivered(db: DB, it: GoodsItem): void {
    if (it.job === null) return;
    const j = jobById(db, it.job);
    const t = j?.task as { kind?: string; to?: string } | null | undefined;
    if (!j || t?.kind !== "carry" || !t.to) return;
    const to = SPOTS[t.to];
    if (to && Math.hypot(it.x - to.x, it.z - to.z) < DELIVER_M) it.job = null;
  }

  /** Near enough to where his movement socket has him (played together; alone nothing to check against). */
  private reach(p: number, x: number, z: number): void {
    const at = positionOf(p);
    if (at && Math.hypot(at.x - x, at.z - z) > REACH_M) no("You cannot reach it from there.");
  }

  // ------------------------------------------------------------------ a player's request

  /** One request of player `p`. Refused: the reason, and the items it was about as they are (his PC puts them back). */
  ask(db: DB, p: number, a: GoodsAsk): Answer {
    this.stats.asks++;
    const touched: string[] = [];
    try {
      if (!a || typeof a !== "object") no("bad request");
      const r = this.run(db, p, a, touched);
      return { ok: true, ...r };
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      this.stats.refused++;
      return { ok: false, why: e.message, items: touched.map((id) => this.items.get(id)).filter((x): x is GoodsItem => !!x).map(clone) };
    }
  }

  private run(db: DB, p: number, a: GoodsAsk, touched: string[]): { items: GoodsItem[]; gone: string[] } {
    const item = (id: unknown): GoodsItem => {
      if (typeof id !== "string" || id.length > 60) no("bad item");
      touched.push(id as string);
      const it = this.items.get(id as string);
      if (!it) no("It is not there any more.");
      return it!;
    };
    const done = (items: GoodsItem[], gone: string[] = []) => ({ items: items.map(clone), gone });
    switch (a.op) {
      case "lift": {
        const it = item(a.id);
        if (it.by) return heldBy(it, { p }) ? done([it]) : no("Someone was quicker.");
        if (it.cartOnly) no("Too big to carry: that is a cart's work.");
        if (this.carriedBy(p)) no("Your hands are full.");
        if (hasAbove(this.all(), it.id)) no("Something is on top of it.");
        if (it.job !== null && holderOf(db, it.job) !== p) no("That is another man's work.");
        // (D1 docks: the dockers' piles are the natie's work: for a man in the foreman's book only)
        if (haulRouteOfItem(it.id) && !goodsHooks.hasBook(db, p)) no("That is the natie's load. Ask the foreman at the Hessenatie for his book first.");
        this.reach(p, it.x, it.z);
        this.from.set(it.id, [it.x, it.z, it.rot]);
        it.by = { p };
        it.on = [];
        this.commit([it], [], "lift", { p });
        return done([it]);
      }
      case "put": {
        const it = item(a.id);
        if (!heldBy(it, { p })) no("You are not carrying that.");
        if (!finite(a.x, a.z)) no("bad place");
        this.reach(p, a.x, a.z);
        if (!this.rest(it, a.x, a.z, db)) no("No room there: the stack is full.");
        this.commit([it], [], "put", { p });
        return done([it]);
      }
      case "drop": {
        const it = item(a.id);
        if (!heldBy(it, { p })) no("You are not carrying that.");
        const at = Array.isArray(a.at) && finite(a.at[0], a.at[1]) ? ([r3(a.at[0]), r3(a.at[1])] as [number, number]) : undefined;
        const why = ["sunk", "handed", "sold", "snatched", "taken"].includes(a.why) ? a.why : "taken";
        this.commit([], [it.id], why, { p }, at && why === "sunk" ? { at } : {});
        return done([], [it.id]);
      }
      case "take": {
        const it = item(a.id);
        if (it.by) no("Someone was quicker.");
        if (it.job === null || holderOf(db, it.job) !== p) no("That is another man's work.");
        if (hasAbove(this.all(), it.id)) no("Something is on top of it.");
        this.commit([], [it.id], "taken", { p });
        return done([], [it.id]);
      }
      case "job": {
        const j = this.jobOf(db, a.job, p);
        return done(this.layout(db, j, a.lay === true));
      }
      case "lower": {
        const j = this.jobOf(db, a.job, p);
        const t = j.task as { kind?: string; from?: string; count?: number; goods?: string; twist?: string } | null;
        if (t?.kind !== "carry" || t.from !== "ship_gangway" || !isGoodsKind(t.goods)) no("nothing to swing down for that job");
        const i = Math.floor(Number(a.i));
        if (!(i >= 0 && i < 20)) no("bad place");
        const key = `${j.id}:${i}`;
        if (this.lowered.has(key)) return done(this.jobItems(j.id));
        if (this.jobItems(j.id).length + progressOf(j) >= (t!.count ?? 1)) no("more goods than the job has");
        this.lowered.add(key);
        const [x, z] = slotAt(SPOTS, "ship_gangway", i);
        const it = this.make({ id: this.nextJobId(j.id), kind: t!.goods as GoodsKind, owner: j.employer_npc, job: j.id, x, z, broken: a.broken === true && t!.twist === "broken_goods", heavy: a.heavy === true && t!.twist === "heavy_load" });
        this.commit([it], [], "spawn", { p });
        return done([it]);
      }
      case "handover": {
        const j = this.jobOf(db, a.job, p);
        const t = j.task as { kind?: string; goods?: string } | null;
        if (t?.kind !== "deliver" || !isGoodsKind(t.goods) || t.goods === "parcel") no("nothing to hand over for that job");
        const have = this.jobItems(j.id);
        if (have.length) return done(have);
        if (this.carriedBy(p)) no("Your hands are full.");
        const it = this.make({ id: this.nextJobId(j.id), kind: t!.goods as GoodsKind, owner: j.employer_npc, job: j.id, x: 0, z: 0, by: { p } });
        this.made.add(j.id);
        this.commit([it], [], "spawn", { p });
        return done([it]);
      }
      case "end": {
        const j = jobById(db, Number(a.job));
        if (j && j.status === "taken" && (j.taken_by ?? 1) !== p) no("That is another man's work.");
        return done(...(this.endJob(Number(a.job)) as [GoodsItem[], string[]]));
      }
      case "restore":
        return done(...(this.restore(db, p, a) as [GoodsItem[], string[]]));
      case "npc_lift": {
        const npc = cleanNpc(a.npc);
        const ids = Array.isArray(a.ids) ? [...new Set(a.ids)].slice(0, MAX_IDS) : [];
        if (!ids.length) no("nothing to lift");
        if (!this.mayReport(db, p, npc)) no("That townsperson is walked by another PC.");
        const out: GoodsItem[] = [];
        for (const id of ids) {
          const it = item(id);
          if (it.by) {
            if (heldBy(it, { npc })) {
              out.push(it);
              continue;
            }
            no("Someone was quicker.");
          }
          if (hasAbove(this.all(), it.id)) no("Something is on top of it.");
          if (it.cartOnly) no("Too big to carry: that is a cart's work.");
          if (!npcMay(db, npc, it)) no("That is not his to lift.");
          this.from.set(it.id, [it.x, it.z, it.rot]);
          it.by = { npc };
          it.on = [];
          this.reporter.set(it.id, p);
          out.push(it);
        }
        this.commit(out, [], "lift", { npc });
        return done(out);
      }
      case "npc_put": {
        const npc = cleanNpc(a.npc);
        const it = item(a.id);
        if (!heldBy(it, { npc })) no("He is not carrying that.");
        if (!this.mayReport(db, p, npc) && this.reporter.get(it.id) !== p) no("That townsperson is walked by another PC.");
        if (!finite(a.x, a.z)) no("bad place");
        // a man carrying owned goods back puts them where they belong (the server's place, not the PC's)
        const back = goodsBackFor(db, npc);
        const home = back === it.id ? it.home : undefined;
        const [x, z] = home ? [home[0], home[1]] : [a.x, a.z];
        if (!this.rest(it, x, z, db)) {
          // full there: beside it on the ground
          if (!this.restNear(it, x, z, db)) no("No room there: the stack is full.");
        }
        if (home && Math.hypot(it.x - home[0], it.z - home[1]) < 0.05) it.rot = home[2];
        this.commit([it], [], "put", { npc });
        return done([it]);
      }
      case "npc_drop": {
        const npc = cleanNpc(a.npc);
        const it = item(a.id);
        if (!heldBy(it, { npc })) no("He is not carrying that.");
        if (!this.mayReport(db, p, npc) && this.reporter.get(it.id) !== p) no("That townsperson is walked by another PC.");
        this.commit([], [it.id], "taken", { npc });
        return done([], [it.id]);
      }
      case "haul_in": {
        // (D1 docks) the docker's load of his route's pile, set down at the route's other end
        const npc = cleanNpc(a.npc);
        const it = item(a.id);
        if (!heldBy(it, { npc })) no("He is not carrying that.");
        if (!this.mayReport(db, p, npc) && this.reporter.get(it.id) !== p) no("That townsperson is walked by another PC.");
        const route = HAUL_ROUTES.find((r) => r.id === goodsHooks.haulRoute(db, npc));
        if (!route || !it.id.startsWith(`haul:${route.id}a:`)) no("That is not his route's load.");
        const made = route!.into === "pile" ? this.haulSlot(route!, "b") : null;
        goodsHooks.hauledIn(db, route!.id);
        this.commit(made ? [made] : [], [it.id], made ? "haul" : "taken", { npc });
        return done(made ? [made] : [], [it.id]);
      }
      case "haul_deliver": {
        // (D1 docks) a load of a route's pile, set in at its end by a man in the foreman's book: paid by the piece
        const it = item(a.id);
        if (!heldBy(it, { p })) no("You are not carrying that.");
        const route = haulRouteOfItem(it.id);
        if (!route) no("That is not the natie's load.");
        if (!goodsHooks.hasBook(db, p)) no("You are not in the foreman's book.");
        this.reach(p, route!.b[0], route!.b[1]);
        const made = route!.into === "pile" ? this.haulSlot(route!, "b") : null;
        goodsHooks.payPiece(db, p, haulPay(route!), route!.id);
        goodsHooks.hauledIn(db, route!.id);
        this.commit(made ? [made] : [], [it.id], "delivered", { p });
        return done(made ? [made] : [], [it.id]);
      }
      case "crane_put": {
        // (D1 docks) a load from the ship on a route's own pile: only a pile a crane can reach, one at a time
        const route = HAUL_ROUTES.find((r) => r.id === a.route);
        if (!route || !CRANE_FED.has(route.id)) no("No crane reaches that pile.");
        const now = Date.now();
        if (now - (this.craneAt.get(route!.id) ?? 0) < CRANE_EVERY_MS) no("The crane is still swinging.");
        // (a sling of up to three sacks, or one crate)
        const n = Math.max(1, Math.min(route!.pile.kind === "sacks" ? 3 : 1, Math.floor(Number(a.n) || 1)));
        const made: GoodsItem[] = [];
        for (let k = 0; k < n; k++) {
          const it = this.haulSlot(route!, "a");
          if (!it) break;
          made.push(it);
        }
        if (!made.length) no("The pile is whole.");
        this.craneAt.set(route!.id, now);
        this.commit(made, [], "spawn", { world: true });
        return done(made);
      }
      default:
        return no("bad request");
    }
  }

  /** The route's pile at `tag` with a load more: its first free place whose supports lie there (null: whole). */
  private haulSlot(route: HaulRoute, tag: "a" | "b"): GoodsItem | null {
    for (let i = 0; i < HAUL_PILE_N; i++) {
      const id = `haul:${route.id}${tag}:${i}`;
      if (this.items.has(id)) continue;
      const it = haulPileItem(route, tag, i, this.all());
      if (!it || it.on.some((o) => !this.items.get(o) || this.items.get(o)!.by)) continue;
      it.rev = 0;
      this.items.set(it.id, it);
      return it;
    }
    return null;
  }

  /**
   * T3 trade: the route's dockers, unseen, take the top load of its pile in at the other end (the fish boxes to the
   * stalls while no player watches). True when one went in.
   */
  haulUnseen(db: DB, routeId: string): boolean {
    const route = HAUL_ROUTES.find((r) => r.id === routeId);
    if (!route) return false;
    const pre = `haul:${route.id}a:`;
    const all = this.all();
    const top = all.filter((it) => it.id.startsWith(pre) && !it.by && !hasAbove(all, it.id)).sort((a, b) => b.y - a.y)[0];
    if (!top) return false;
    const made = route.into === "pile" ? this.haulSlot(route, "b") : null;
    goodsHooks.hauledIn(db, route.id);
    this.commit(made ? [made] : [], [top.id], "haul", { world: true });
    return true;
  }

  /** D1 docks: one load more on a route's own pile (the boats' men brought it; nobody saw them come). */
  haulSupply(routeId: string): GoodsItem | null {
    const route = HAUL_ROUTES.find((r) => r.id === routeId);
    const it = route ? this.haulSlot(route, "a") : null;
    if (it) this.commit([it], [], "spawn", { world: true });
    return it;
  }

  /**
   * Dawn (D1 docks): the night's lighters brought the quay's goods and the drop piles went into the stores: every
   * route's own pile whole again, every drop pile as at the start. Loads in someone's hands stay where they are.
   */
  haulDawn(): number {
    const changed: GoodsItem[] = [];
    const gone: string[] = [];
    for (const route of HAUL_ROUTES) {
      for (let i = 0; i < HAUL_PILE_N; i++) {
        const id = `haul:${route.id}b:${i}`;
        const it = this.items.get(id);
        if (it && !it.by && route.drop) {
          const home = this.homes.get(id);
          if (home && (Math.abs(it.x - home.x) > 0.01 || Math.abs(it.z - home.z) > 0.01)) gone.push(id);
        }
      }
      for (const id of gone) this.items.delete(id);
      for (const tag of ["a", "b"] as const) {
        let it: GoodsItem | null;
        while ((it = this.haulSlot(route, tag))) changed.push(it);
      }
    }
    if (changed.length || gone.length) this.commit(changed, gone, "dawn", { world: true });
    return changed.length;
  }

  /** The job, in player p's hand. */
  private jobOf(db: DB, id: unknown, p: number): JobRow {
    const j = jobById(db, Number(id));
    if (!j || j.status !== "taken") no("That work is over.");
    if ((j!.taken_by ?? 1) !== p) no("That is another man's work.");
    return j!;
  }

  private jobItems(job: number): GoodsItem[] {
    return this.all().filter((it) => it.job === job);
  }

  /**
   * A job's goods, laid out once (in this run of the server): a watch's three at the post; a carry's (and a deliver's
   * when no one hands them over) at the place they are fetched from, on the free slots, the twist's broken and heavy
   * ones as the client had them; a carry's goods delivered before a reload at the drop place.
   */
  private layout(db: DB, j: JobRow, lay: boolean): GoodsItem[] {
    if (this.made.has(j.id)) return this.jobItems(j.id);
    const t = j.task as { kind?: string; from?: string; to?: string; post?: string; count?: number; goods?: string; twist?: string; progress?: { delivered: number; lost: number; sold: number } } | null;
    if (!t || !isGoodsKind(t.goods)) return [];
    const kind = t.goods as GoodsKind;
    const made: GoodsItem[] = [];
    if (t.kind === "watch" && t.post && SPOTS[t.post]) {
      for (let i = 0; i < 3; i++) {
        const [x, z] = slotAt(SPOTS, t.post, i, 0.9);
        made.push(this.make({ id: this.nextJobId(j.id), kind, owner: j.employer_npc, job: j.id, x, z, rot: r3(i * 0.4), keep: true }));
      }
    } else if ((t.kind === "carry" || t.kind === "deliver") && t.from) {
      const count = t.kind === "carry" ? (t.count ?? 1) : 1;
      const p = t.progress ?? { delivered: 0, lost: 0, sold: 0 };
      const left = Math.max(0, count - p.delivered - p.lost - p.sold - onCartsFor(db, j) - this.jobItems(j.id).length);
      const fromShip = t.kind === "carry" && t.from === "ship_gangway";
      if (lay && !fromShip && SPOTS[t.from]) {
        const flags = Array.from({ length: left }, () => ({ broken: false, heavy: false }));
        if (t.twist === "broken_goods" && left) flags[Math.min(1, left - 1)].broken = true;
        if (t.twist === "heavy_load" && left) flags[0].heavy = true;
        let k = 0;
        for (const f of flags) {
          let [x, z] = slotAt(SPOTS, t.from, k);
          while (k < 40 && !freeAt(this.all(), x, z)) [x, z] = slotAt(SPOTS, t.from, ++k);
          k++;
          made.push(this.make({ id: this.nextJobId(j.id), kind, owner: j.employer_npc, job: j.id, x, z, ...f }));
        }
      }
      // (a carry's goods delivered before the server's restart lie at the drop place, the employer's)
      if (t.kind === "carry" && t.to && SPOTS[t.to])
        for (let i = 0; i < p.delivered; i++) {
          const [x, z] = slotAt(SPOTS, t.to, i, 0.8);
          made.push(this.make({ id: `job:${j.id}:d${i}`, kind, owner: j.employer_npc, job: null, x, z }));
        }
    }
    this.made.add(j.id);
    this.commit(made, [], "spawn", { world: true });
    return this.jobItems(j.id);
  }

  /** A job is over: its goods go with it (in hands, on the ground); a watch's pile stays, the employer's. */
  endJob(job: number): [GoodsItem[], string[]] {
    const changed: GoodsItem[] = [];
    const gone: string[] = [];
    for (const it of this.jobItems(job)) {
      if (it.by && "cart" in it.by) continue; // (the cart's own rules: town/handcart.ts cleanJobs)
      if (it.keep && !it.by) {
        it.job = null;
        delete it.keep;
        changed.push(it);
      } else gone.push(it.id);
    }
    // (what rested on a gone item comes down to the ground under it: nothing may float)
    for (const o of this.all()) {
      if (o.by || !o.on.some((id) => gone.includes(id))) continue;
      o.on = o.on.filter((id) => !gone.includes(id));
      if (!o.on.length) o.y = 0;
      if (!changed.includes(o)) changed.push(o);
    }
    this.commit(changed, gone, "end", { world: true });
    return [changed, gone];
  }

  private restore(db: DB, p: number, a: Extract<GoodsAsk, { op: "restore" }>): [GoodsItem[], string[]] {
    const changed: GoodsItem[] = [];
    const gone: string[] = [];
    if (a.job !== null && a.job !== undefined) {
      const j = this.jobOf(db, a.job, p);
      for (const it of this.jobItems(j.id)) if (!it.by && !hasAbove(this.all(), it.id)) gone.push(it.id);
      // (below first: a stack is built again from the ground)
      for (const id of gone) this.items.delete(id);
      const lying = (Array.isArray(a.lying) ? a.lying : []).slice(0, MAX_RESTORE).filter((l) => isGoodsKind(l.kind) && finite(l.x, l.z));
      const watch = (j.task as { kind?: string } | null)?.kind === "watch";
      for (const l of lying) changed.push(this.make({ id: this.nextJobId(j.id), kind: l.kind as GoodsKind, owner: j.employer_npc, job: j.id, x: l.x, z: l.z, rot: finite(l.rot) ? r3(l.rot) : undefined, broken: l.broken === true, heavy: l.heavy === true, keep: watch }));
      this.made.add(j.id);
    }
    const c = a.carried;
    if (c && isGoodsKind(c.kind) && !this.carriedBy(p)) {
      if (c.job === null || c.job === undefined) {
        // someone's own goods: lifted from where they lie, never made twice
        const mine = this.all().find((it) => !it.by && it.kind === c.kind && it.job === null && it.owner === (c.owner ?? null) && !hasAbove(this.all(), it.id));
        if (mine) {
          this.from.set(mine.id, [mine.x, mine.z, mine.rot]);
          mine.by = { p };
          mine.on = [];
          changed.push(mine);
        }
      } else if (holderOf(db, c.job) === p) {
        const j = jobById(db, c.job)!;
        changed.push(this.make({ id: this.nextJobId(j.id), kind: c.kind as GoodsKind, owner: j.employer_npc, job: j.id, x: 0, z: 0, broken: c.broken === true, heavy: c.heavy === true, by: { p } }));
      }
    }
    this.commit(changed, gone, "restore", { p });
    return [changed, gone];
  }

  /** Set down at (x, z), or on the nearest free ground round it (a ring out to 1.6 m). */
  private restNear(it: GoodsItem, x: number, z: number, db: DB | null): GoodsItem | null {
    for (const r of [0, 0.7, 1.1, 1.6])
      for (let k = 0; k < (r ? 8 : 1); k++) {
        const a = (k / 8) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (r && !freeAt(this.all().filter((o) => o.id !== it.id), px, pz)) continue;
        if (this.rest(it, px, pz, db)) return it;
      }
    return null;
  }

  /**
   * May player p's PC report for townsperson npc? Alone: yes. Together: the PC that walks him (M8b owners); when
   * nobody walks him (out of everyone's street), the player whose errand he is on.
   */
  private mayReport(db: DB, p: number, npc: string): boolean {
    const w = walkerOf(npc);
    if (w === null || w === p) return true;
    if (w !== 0) return false;
    return errandOwner(db, npc) === p;
  }

  // ------------------------------------------------------------------ the town's own work (townspeople, carts, the world)

  /** New goods come into the town (by cart, by boat, a delivery). Ids given are kept; the rest get spawn:<n>. */
  spawnGoods(who: Actor, specs: Array<{ id?: string; kind: GoodsKind; look?: "cask"; owner?: string | null; job?: number | null; x: number; z: number; rot?: number; broken?: boolean; heavy?: boolean }>): GoodsItem[] {
    const made: GoodsItem[] = [];
    for (const s of specs) {
      if (!isGoodsKind(s.kind) || !finite(s.x, s.z)) continue;
      const id = s.id && !this.items.has(s.id) ? s.id : `spawn:${++this.spawnN}`;
      made.push(this.make({ id, kind: s.kind, look: s.look, owner: s.owner ?? null, job: s.job ?? null, x: s.x, z: s.z, rot: s.rot, broken: s.broken, heavy: s.heavy }));
    }
    this.commit(made, [], "spawn", who);
    return made.map(clone);
  }

  /** A townsperson (or the world) moves one from where it lies (or from his hands) to (x, z). */
  moveGoods(who: Actor, id: string, x: number, z: number, db: DB | null = null): GoodsItem | null {
    const it = this.items.get(id);
    if (!it || !finite(x, z)) return null;
    if (it.by && !("npc" in it.by)) return null;
    if (!it.by && hasAbove(this.all(), id)) return null;
    it.by = null;
    if (!this.rest(it, x, z, db) && !this.restNear(it, x, z, db)) return null;
    this.commit([it], [], "put", who);
    return clone(it);
  }

  /** Goods leave the town (sold, loaded on a ship). */
  removeGoods(who: Actor, ids: string[], why = "taken"): string[] {
    const gone = ids.filter((id) => this.items.has(id));
    this.commit([], gone, why, who);
    return gone;
  }

  /** A cart takes these (top down: each must have nothing on it when its turn comes). */
  cartTake(cart: string, ids: string[]): GoodsItem[] {
    const list = ids.map((id) => this.items.get(id)).filter((x): x is GoodsItem => !!x && !x.by);
    list.sort((a, b) => levelOf(this.all(), b) - levelOf(this.all(), a));
    const took: GoodsItem[] = [];
    for (const it of list) {
      if (this.all().some((o) => !o.by && o.on.includes(it.id))) continue;
      this.from.set(it.id, [it.x, it.z, it.rot]);
      it.by = { cart };
      it.on = [];
      took.push(it);
    }
    this.commit(took, [], "cart", { cart });
    return took.map(clone);
  }

  /**
   * A cart sets these down, in order (the lower row first): each where it comes to rest at its point; with `y` and
   * `on` given (a pile set down in its own shape), exactly there when what it rests on lies there.
   */
  cartUnload(cart: string, list: Array<{ id: string; x: number; z: number; rot?: number; y?: number; on?: string[] }>, db: DB | null = null): GoodsItem[] {
    const put: GoodsItem[] = [];
    for (const u of list) {
      const it = this.items.get(u.id);
      if (!it || !heldBy(it, { cart })) continue;
      const exact =
        u.y !== undefined &&
        (u.on ?? []).every((id) => {
          const b = this.items.get(id);
          return !!b && !b.by;
        }) &&
        (u.on?.length || u.y < 0.05) &&
        !this.all().some((o) => o !== it && !o.by && !(u.on ?? []).includes(o.id) && Math.hypot(o.x - u.x, o.z - u.z) < 0.3 && Math.abs(o.y - u.y!) < 0.2);
      if (exact) {
        it.x = r3(u.x);
        it.z = r3(u.z);
        it.y = r3(u.y!);
        it.on = [...(u.on ?? [])];
        it.by = null;
        it.n++;
        it.rot = rotFor(it.id, it.n);
        this.from.delete(it.id);
      } else if (!this.rest(it, u.x, u.z, db) && !this.restNear(it, u.x, u.z, db)) continue;
      if (u.rot !== undefined) it.rot = r3(u.rot);
      put.push(it);
    }
    this.commit(put, [], "put", { cart });
    return put.map(clone);
  }

  /** Jef's handcart (town/handcart.ts): the item in player p's hands onto his cart. */
  toCart(p: number, id: string, cart: string): GoodsItem | null {
    const it = this.items.get(id);
    if (!it || !heldBy(it, { p })) return null;
    it.by = { cart };
    this.commit([it], [], "cart", { p });
    return clone(it);
  }

  /** Off a cart into player p's hands (or null: it is not on that cart). */
  fromCart(id: string, cart: string, p: number): GoodsItem | null {
    const it = this.items.get(id);
    if (!it || !heldBy(it, { cart }) || this.carriedBy(p)) return null;
    it.by = { p };
    this.commit([it], [], "lift", { p });
    return clone(it);
  }

  /** What is on a cart now. */
  onCart(cart: string): GoodsItem[] {
    return this.all().filter((it) => heldBy(it, { cart })).map(clone);
  }

  /** New goods straight into a player's hands (a cart's load from before this store, a handover). */
  giveTo(p: number, spec: { kind: GoodsKind; owner: string | null; job: number | null; broken?: boolean; heavy?: boolean }): GoodsItem | null {
    if (this.carriedBy(p) || !isGoodsKind(spec.kind)) return null;
    const id = spec.job !== null ? this.nextJobId(spec.job) : `spawn:${++this.spawnN}`;
    const it = this.make({ ...spec, id, x: 0, z: 0, by: { p } });
    this.commit([it], [], "spawn", { p });
    return clone(it);
  }

  /**
   * A player left the game for good (his seat's grace is over): what he held is set down where he stood when last
   * seen (the others saw him carry it there; his job's crate is where he left it when he comes back), or where it
   * came from when nobody knows where he stood.
   */
  playerLeft(p: number, at: { x: number; z: number } | null, db: DB | null = null): GoodsItem[] {
    const out: GoodsItem[] = [];
    for (const it of this.all()) {
      if (!heldBy(it, { p })) continue;
      const back = this.from.get(it.id);
      const to = at ?? (back ? { x: back[0], z: back[1] } : null);
      it.by = null;
      if (!to || (!this.rest(it, to.x, to.z, db) && !this.restNear(it, to.x, to.z, db))) {
        it.by = { p }; // (nowhere: it stays his till he is back)
        continue;
      }
      // (another man's job's goods stay that job's; the job is still his when he comes back)
      out.push(it);
    }
    this.commit(out, [], "put", { p });
    return out.map(clone);
  }

  /**
   * Now and then (each tick): goods of a job that is over go; a townsperson's goods with no errand any more go back
   * where they came from after a while; goods on a handcart that no longer has them (wheeled off, load and all) go.
   */
  sweep(db: DB, now = Date.now(), cartHas: (cart: string, id: string) => boolean | null = () => null): void {
    const jobs = new Set<number>();
    for (const it of this.items.values()) if (it.job !== null) jobs.add(it.job);
    for (const id of jobs) {
      const j = jobById(db, id);
      if (!j || j.status !== "taken" || (j.task as { held?: unknown } | null)?.held) this.endJob(id);
    }
    const back: GoodsItem[] = [];
    const gone: string[] = [];
    for (const it of this.all()) {
      if (it.by && "npc" in it.by) {
        if (errandOwner(db, it.by.npc) !== null) {
          this.orphan.delete(it.id);
          continue;
        }
        const since = this.orphan.get(it.id) ?? now;
        this.orphan.set(it.id, since);
        if (now - since < NPC_ORPHAN_MS) continue;
        const f = this.from.get(it.id) ?? it.home ?? [it.x, it.z, it.rot];
        const was = it.by;
        it.by = null;
        if (this.rest(it, f[0], f[1], db) || this.restNear(it, f[0], f[1], db)) back.push(it);
        else it.by = was;
      } else if (it.by && "cart" in it.by) {
        if (cartHas(it.by.cart, it.id) === false) gone.push(it.id);
      }
    }
    this.commit(back, gone, "sweep", { world: true });
  }

  /** The dray's day (DRAY_RUN, the casks), on the world's clock: `minute` of the day, `day` the date (7, 14: Sundays). */
  drayTick(day: number, minute: number, db: DB | null = null): string | null {
    return this.runTick("casks", day, minute, db);
  }

  /** Every cart's round (CART_RUNS) on the world's clock (the tick): what each did now (null: nothing). */
  cartRunsTick(day: number, minute: number, db: DB | null = null): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const R of CART_RUNS) out[R.id] = this.runTick(R.id, day, minute, db);
    return out;
  }

  /** Where a run's items go down at its `to`: the casks as a pyramid; anything else in the pile's own shape, moved. */
  private runSpots(R: CartRun): Array<{ id: string; x: number; z: number; rot: number; y?: number; on?: string[] }> {
    if (R.id === "casks") {
      const spots = pyramidSpots(R.to[0], R.to[1], R.items.length);
      return R.items.map((id, i) => ({ id, x: spots[i].x, z: spots[i].z, rot: pileRot(i) }));
    }
    const h0 = this.homes.get(R.items[0])!;
    const dx = R.to[0] - h0.x;
    const dz = R.to[1] - h0.z;
    return R.items.map((id) => {
      const h = this.homes.get(id)!;
      return { id, x: r3(h.x + dx), z: r3(h.z + dz), y: h.y, rot: h.rot, on: [...h.on] };
    });
  }

  /** A run's items where they belong, in the pile's own shape (lower first, as the list is). */
  private runHomes(R: CartRun): Array<{ id: string; x: number; z: number; rot: number; y?: number; on?: string[] }> {
    return R.items.map((id) => {
      const h = this.homes.get(id)!;
      return { id, x: h.x, z: h.z, rot: h.rot, y: h.y, on: [...h.on] };
    });
  }

  /** One cart's round (shared/goods.ts CartRun): the stage its clock has come to, once. */
  runTick(runId: string, day: number, minute: number, db: DB | null = null): string | null {
    const R = CART_RUNS.find((r) => r.id === runId);
    if (!R || R.items.some((id) => !this.homes.has(id))) return null;
    const st = this.runOf(R.id);
    if (st.day !== day) {
      // a new day: whatever is still on the cart comes home first
      if (this.onCart(R.cart).length) this.cartUnload(R.cart, this.runHomes(R), db);
      st.state = "home";
      st.day = day;
    }
    const sunday = day % 7 === 0;
    const s = st.state;
    if (sunday || s === "skip") return null;
    const pile = new Set(R.items);
    if (s === "home" && minute >= R.out && minute < R.down) {
      // only a whole pile lying untouched where it belongs, nothing of anyone else's on it
      const whole = R.items.every((id) => {
        const it = this.items.get(id);
        const h = this.homes.get(id)!;
        return !!it && !it.by && Math.hypot(it.x - h.x, it.z - h.z) < 0.05 && Math.abs(it.y - h.y) < 0.01;
      });
      const burdened = this.all().some((o) => !o.by && !pile.has(o.id) && o.on.some((id) => pile.has(id)));
      if (!whole || burdened) {
        st.state = "skip";
        return "skip";
      }
      this.cartTake(R.cart, R.items);
      st.state = "out";
      return "out";
    }
    if (s === "out" && minute >= R.down) {
      this.cartUnload(R.cart, this.runSpots(R), db);
      st.state = "down";
      return "down";
    }
    if (s === "down" && minute >= R.back) {
      // only what still lies where it was set down goes back (a thing taken off stays where it was put)
      const spots = this.runSpots(R);
      const there = R.items.filter((id) => {
        const it = this.items.get(id);
        const q = spots.find((x) => x.id === id)!;
        return !!it && !it.by && (R.id === "casks" ? spots.some((p) => Math.hypot(p.x - it.x, p.z - it.z) < 0.4) : Math.hypot(q.x - it.x, q.z - it.z) < 0.4);
      });
      this.cartTake(R.cart, there);
      st.state = "back";
      return "back";
    }
    if (s === "back" && minute >= R.home) {
      this.cartUnload(R.cart, this.runHomes(R), db);
      st.state = "skip";
      return "home";
    }
    return null;
  }

  /** Dev and tests: one stage of a run now, whatever the clock says (the same rules as its tick). */
  drayStage(stage: "out" | "down" | "back" | "home", day: number, db: DB | null = null, runId = "casks"): string | null {
    const R = CART_RUNS.find((r) => r.id === runId);
    if (!R) return null;
    const before = { out: "home", down: "out", back: "down", home: "back" } as const;
    const at = { out: R.out, down: R.down, back: R.back, home: R.home } as const;
    const weekday = day % 7 === 0 ? day + 1 : day;
    const st = this.runOf(R.id);
    st.state = before[stage];
    st.day = weekday;
    return this.runTick(R.id, weekday, at[stage], db);
  }

  /** Owned goods lying off their place (more than 2.5 m) since this game minute; null: at home. */
  offHome(gameMinute: number): Array<{ it: GoodsItem; since: number }> {
    const out: Array<{ it: GoodsItem; since: number }> = [];
    for (const it of this.all()) {
      if (!it.id.startsWith("own:") || it.by || !it.home) {
        this.offSince.delete(it.id);
        continue;
      }
      const off = Math.hypot(it.x - it.home[0], it.z - it.home[1]) > 2.5;
      if (!off) {
        this.offSince.delete(it.id);
        continue;
      }
      const since = this.offSince.get(it.id) ?? gameMinute;
      this.offSince.set(it.id, since);
      out.push({ it: clone(it), since });
    }
    return out;
  }
}

// ------------------------------------------------------------------ helpers the rules use (set by the parts that know)

/** Who has this job in hand (null: nobody, it is over). */
export function holderOf(db: DB, job: number): number | null {
  const j = jobById(db, job);
  return j && j.status === "taken" ? (j.taken_by ?? 1) : null;
}

function progressOf(j: JobRow): number {
  const p = (j.task as { progress?: { delivered: number; lost: number; sold: number } } | null)?.progress;
  return p ? p.delivered + p.lost + p.sold : 0;
}

/** A crane swings at most one load a route this often (real ms; a swing takes ~25 s, world/railway.ts). */
const CRANE_EVERY_MS = 6000;

const cleanNpc = (v: unknown): string => {
  if (typeof v !== "string" || !/^[a-z0-9_:-]{1,40}$/i.test(v)) no("bad townsperson");
  return v as string;
};

/**
 * Hooks the other parts fill in (index.ts, the hire and the carry-back): how many of a job's goods are on the
 * holder's handcarts; the player whose errand townsperson npc is on (null: none); may that townsperson lift this
 * (his errand's goods); the owned item he is carrying back.
 */
export const goodsHooks = {
  onCarts: (_db: DB, _j: JobRow): number => 0,
  errandOwner: (_db: DB, _npc: string): number | null => null,
  npcMay: (_db: DB, _npc: string, _it: GoodsItem): boolean => false,
  goodsBack: (_db: DB, _npc: string): string | null => null,
  /** The docker route of townsperson npc (shared/hauls.ts id), or null (goods/haulFlow.ts fills it in). */
  haulRoute: (_db: DB, _npc: string): string | null => null,
  /** Is player p in the foreman's book this week (goods/haulFlow.ts)? */
  hasBook: (_db: DB, _p: number): boolean => false,
  /** A load of a route's pile was set in at its end, by a docker or a player (T3: fish boxes onto the Vismarkt's stalls). */
  hauledIn: (_db: DB, _route: string): void => {},
  /** Pay player p for a piece set in (goods/haulFlow.ts). */
  payPiece: (_db: DB, _p: number, _c: number, _route: string): void => {},
  /** Is this item still on that handcart (null: not a handcart of the players, or not known)? */
  cartHas: (_db: DB, _cart: string, _id: string): boolean | null => null,
};
const onCartsFor = (db: DB, j: JobRow) => goodsHooks.onCarts(db, j);
const errandOwner = (db: DB, npc: string) => goodsHooks.errandOwner(db, npc);
const npcMay = (db: DB, npc: string, it: GoodsItem) => goodsHooks.npcMay(db, npc, it);
const goodsBackFor = (db: DB, npc: string) => goodsHooks.goodsBack(db, npc);

/** The one store of the running server. */
export const goods = new GoodsStore();

export { GOODS_KINDS };
