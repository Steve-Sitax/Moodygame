import type { DB } from "../db.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import SPOT_TABLE from "../../../shared/spots.json" with { type: "json" };
import {
  DRAY_RUN,
  GOODS_KINDS,
  hasAbove,
  isGoodsKind,
  levelOf,
  PILES,
  pileSpot,
  pileRot,
  placeAt,
  pyramidSpots,
  r3,
  rotFor,
  slotAt,
  townGoods,
  freeAt,
  type Door,
  type GoodsAsk,
  type GoodsItem,
  type GoodsKind,
  type GoodsPush,
  type Holder,
  type Spot,
} from "../../../shared/goods.ts";
import { jobById, type JobRow } from "../hooks/jobBoard.ts";
import { positionOf, walkerOf } from "../player/current.ts";

// M8f "shared goods" (docs/milestones/M8f.md): the server keeps every liftable item of the town. A PC draws the list
// and asks (routes.ts); the server checks who asks, where he stands, whose the goods are, and tells every PC what
// changed. The townspeople's work with the goods (a hired hand, a man carrying a crate back, a dray taking a pile)
// goes through the same store with a townsperson or a cart as the actor. Kept in memory: a new week, a loaded save
// and a restart start from the town's own goods again (as the PCs did before), a job's goods are laid out again
// from the job when its PC asks.

const DOORS = (CITY as unknown as { doors: Record<string, Door> }).doors;
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
  /** Where an item was when it was lifted (x, z, turn): back there if its carrier goes and nobody knows where he stood. */
  private from = new Map<string, [number, number, number]>();
  /** A townsperson's goods: the player whose PC reported the lift (it may still set them down after the errand ended). */
  private reporter = new Map<string, number>();
  /** A townsperson's goods with no errand: since when (ms). */
  private orphan = new Map<string, number>();
  /** Owned goods off their place: since when (the world's game minute), for the man who carries them back. */
  private offSince = new Map<string, number>();
  /** The dray's run today: "home", "out" (on the cart), "down" (the pyramid), "back" (on the cart), "skip". */
  dray: { state: "home" | "out" | "down" | "back" | "skip"; day: number } = { state: "home", day: 0 };
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
    for (const it of townGoods(DOORS)) this.items.set(it.id, it);
    this.made.clear();
    this.jobN.clear();
    this.lowered.clear();
    this.from.clear();
    this.reporter.clear();
    this.orphan.clear();
    this.offSince.clear();
    this.dray = { state: "home", day: 0 };
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
        if (this.carriedBy(p)) no("Your hands are full.");
        if (hasAbove(this.all(), it.id)) no("Something is on top of it.");
        if (it.job !== null && holderOf(db, it.job) !== p) no("That is another man's work.");
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
      default:
        return no("bad request");
    }
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

  /** A cart sets these down, in order (the lower row first): each where it comes to rest at its point. */
  cartUnload(cart: string, list: Array<{ id: string; x: number; z: number; rot?: number }>, db: DB | null = null): GoodsItem[] {
    const put: GoodsItem[] = [];
    for (const u of list) {
      const it = this.items.get(u.id);
      if (!it || !heldBy(it, { cart })) continue;
      if (!this.rest(it, u.x, u.z, db) && !this.restNear(it, u.x, u.z, db)) continue;
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

  /** The dray's day (DRAY_RUN), on the world's clock: `minute` of the day, `day` the date (7, 14: Sundays). */
  drayTick(day: number, minute: number, db: DB | null = null): string | null {
    const R = DRAY_RUN;
    const pile = PILES.find((p) => p.id === R.pile)!;
    const ids = Array.from({ length: pile.n }, (_, i) => `pile:${pile.id}:${i}`);
    if (this.dray.day !== day) {
      // a new day: whatever is still on the dray comes home first
      if (this.dray.state === "out" || this.dray.state === "back") this.drayHome(ids, db);
      this.dray = { state: "home", day };
    }
    const sunday = day % 7 === 0;
    const s = this.dray.state;
    if (sunday || s === "skip") return null;
    if (s === "home" && minute >= R.out && minute < R.down) {
      const whole = ids.every((id, i) => {
        const it = this.items.get(id);
        const [hx, hz] = pileSpot(pile, i);
        return !!it && !it.by && Math.hypot(it.x - hx, it.z - hz) < 0.05 && it.y === 0 && !hasAbove(this.all(), id);
      });
      if (!whole) {
        this.dray.state = "skip";
        return "skip";
      }
      this.cartTake(R.cart, ids);
      this.dray.state = "out";
      return "out";
    }
    if (s === "out" && minute >= R.down) {
      const spots = pyramidSpots(R.to[0], R.to[1], ids.length);
      this.cartUnload(R.cart, ids.map((id, i) => ({ id, x: spots[i].x, z: spots[i].z, rot: pileRot(i) })), db);
      this.dray.state = "down";
      return "down";
    }
    if (s === "down" && minute >= R.back) {
      // only what still lies in the pyramid goes back (a barrel taken off it stays where it was put)
      const spots = pyramidSpots(R.to[0], R.to[1], ids.length);
      const there = ids.filter((id) => {
        const it = this.items.get(id);
        return !!it && !it.by && spots.some((q) => Math.hypot(q.x - it.x, q.z - it.z) < 0.4);
      });
      this.cartTake(R.cart, there);
      this.dray.state = "back";
      return "back";
    }
    if (s === "back" && minute >= R.home) {
      this.drayHome(ids, db);
      this.dray.state = "skip";
      return "home";
    }
    return null;
  }

  /** Dev and tests: one stage of the dray's run now, whatever the clock says (the same rules as drayTick). */
  drayStage(stage: "out" | "down" | "back" | "home", day: number, db: DB | null = null): string | null {
    const R = DRAY_RUN;
    const before = { out: "home", down: "out", back: "down", home: "back" } as const;
    const at = { out: R.out, down: R.down, back: R.back, home: R.home } as const;
    this.dray = { state: before[stage], day };
    const weekday = day % 7 === 0 ? day + 1 : day;
    this.dray.day = weekday;
    return this.drayTick(weekday, at[stage], db);
  }

  private drayHome(ids: string[], db: DB | null): void {
    const pile = PILES.find((p) => p.id === DRAY_RUN.pile)!;
    this.cartUnload(
      DRAY_RUN.cart,
      ids.map((id, i) => {
        const [x, z] = pileSpot(pile, i);
        return { id, x, z, rot: pileRot(i) };
      }),
      db,
    );
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
