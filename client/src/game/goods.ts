import * as THREE from "three";
import type { World } from "../world/rijnkaai";
import { rectAround, type Rect } from "../world/geom";
import type { FirstPerson } from "../player/firstPerson";
import { loadProps, type Props } from "../world/props3d";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GOODS, makeGoods, type Goods } from "./props";
import { pick, type Target } from "./facing";
import { FOOT, hash32, heightOf, placeAt, rotFor, type GoodsAsk, type GoodsItem, type GoodsPush, type Holder } from "../../../shared/goods";
import { createGoodsDrays, type GoodsDrays } from "../world/goodsDrays";
import { goodsRects, hideQuayCargo, quayModels, quayPieceCollider, quayPieceMesh, quayPieceSize, showQuayCargo, flushQuayCargo, quayCargo, whenQuayCargo, cargoStats } from "../world/quaygoods";

// Every liftable thing on the quay (M3): job goods and goods that belong to someone. Goods rest on the ground or on
// top of other goods (M8f: on two barrels too, a pyramid); you can lift the top one, set it down anywhere, and stack.
//
// M8f shared goods (docs/milestones/M8f.md): the list is the SERVER's (server/src/goods/). This PC draws what the
// server says (GET /api/goods, then every change pushed as {type: "goods"}) and asks it for every lift, put down and
// hand-over (POST /api/goods). It shows its own lift and put down at once and undoes them if the server says no,
// so played alone (the same path) nothing feels slower. What another player carries is drawn in his hands, what a
// townsperson carries on his shoulder.
//
// M8f goods pass 2: what lies on a cart is drawn on it, on every PC: on a dray of the town's rounds (its bed,
// world/goodsDrays.ts), on another player's handcart (the one he pushes: net/mp/gear.ts), on this player's own
// handcart (game/handcart.ts lays the items there itself). The quay's cargo has its own models: the props' crates
// and sacks ("p:"), the heaps' casks, crates and sacks ("q:", merged into the heaps' own chunk meshes while they lie).

/** Jef's handcart: where the things lie on the bed (its pivot frame: x across, z toward the grips, y up from the axle), two by two, two layers. */
export const HANDCART_SLOTS: Array<[number, number]> = [
  [-0.26, -0.42],
  [0.26, -0.42],
  [-0.26, 0.3],
  [0.26, 0.3],
];
export const HANDCART_BED_Y = 0.2;
/** Things on a handcart are drawn at this size (M6: the cart is small). */
export const ON_HANDCART = 0.6;
/** The number a player's gear carries for the cart he pushes (1..63): the others find its load by it (net/mp/gear.ts). */
export const cartSub = (ref: string): number => (hash32(ref) % 63) + 1;
/** A cart as the goods need it: where the load hangs and where each thing on it lies. */
export interface CartFrame {
  frame: THREE.Object3D;
  /** The i-th thing's place on it: x, y, z, turn (tops: the height each handcart slot has reached). */
  spot(i: number, it: Item, tops: number[]): [number, number, number, number];
  scale: number;
}

export interface Item {
  /** The server's id: own:<owner>:<n>, pile:<pile>:<n>, job:<job>:<n>, spawn:<n>. */
  id: string;
  obj: THREE.Object3D;
  kind: Goods;
  /** "cask", "p:<props model>", "q:<quay goods model>": the quay's own models (shared/goods.ts GoodsItem.look). */
  look?: string;
  /** Its height when stacked, the scale of a "p:" model, too big to lift by hand (shared/goods.ts). */
  h?: number;
  sc?: number;
  cartOnly?: boolean;
  /** Who it belongs to (an NPC id), if anyone. */
  owner: string | null;
  /** The job it is part of, while that job runs. */
  jobId: number | null;
  rect: Rect | null;
  /** Height of its base. */
  y: number;
  /** What it rests on (ids): nothing, one (a stack), two (a pyramid). */
  on: string[];
  /** Who has it (null: it lies). */
  by: Holder | null;
  /** Times put down; the server's version of it. */
  n: number;
  rev: number;
  broken?: boolean;
  heavy?: boolean;
  keep?: boolean;
  home?: [number, number, number];
  /** Where it was when lifted, to see if it was put back. */
  liftedFrom?: { x: number; z: number; t: number };
}

/** A remote player's figure as the goods need it (net/mp/remotes.ts RemoteFigure). */
export interface CarrierFigure {
  root: THREE.Object3D;
  shown: boolean;
  carrying: boolean;
}
/** A townsperson in the street as the goods need him (game/crowd.ts Puppet). */
export interface CarrierPuppet {
  group: THREE.Object3D;
  scale: number;
  /** Pushing a cart: his load is on it (the cart draws it). */
  cart: boolean;
  load(on: boolean): void;
}

const REACH_TOP = 0.55;
/** The attributes a merged copy keeps (as the props' own batch, world/props3d.ts). */
const KEEP = ["position", "normal", "uv", "color", "cell"];

async function net(a: GoodsAsk): Promise<{ ok: boolean; why?: string; items: GoodsItem[]; gone?: string[]; status: number }> {
  const res = await fetch("/api/goods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a), signal: AbortSignal.timeout(8000) });
  const b = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; items?: GoodsItem[]; gone?: string[] };
  return { ok: res.ok && b.ok === true, why: b.error, items: Array.isArray(b.items) ? b.items : [], gone: Array.isArray(b.gone) ? b.gone : [], status: res.status };
}

export class GoodsWorld {
  /** The goods lying (on the ground or a stack). */
  items: Item[] = [];
  carried: Item | null = null;
  /** Every item this PC knows of, by id (lying, in hands, on a cart). */
  readonly all = new Map<string, Item>();
  /** This PC's player (the server's word; 1 alone). */
  me = 1;
  /** M6 handcart: how many of a job's goods lie on Jef's carts now (game/handcart.ts sets it). */
  onCart: (jobId: number) => number = () => 0;
  /** M8f: another player's figure (net/mp/together.ts), to draw what he carries. */
  figureOf: (player: number) => CarrierFigure | null = () => null;
  /** M8f: a townsperson's puppet in the street (game/town.ts), to draw what he carries. */
  npcHands: (npc: string) => CarrierPuppet | null = () => null;
  /** M8f: what was in this player's hands was taken by the server (another was quicker, the job ended). */
  onLost: (it: Item, why: string) => void = () => {};
  /** M8f: something another did (put down, sunk): for the sounds and the splash. */
  onOther: (it: Item, why: string, at?: [number, number]) => void = () => {};
  /** M8f goods pass 2: another player's handcart on this PC (net/mp/gear.ts, the one he pushes), or null: not drawn here. */
  remoteCart: (cart: string) => CartFrame | null = () => null;
  /** M8f goods pass 2: the town's drays that move a whole pile (world/goodsDrays.ts; a mover of the world PC). */
  drays: GoodsDrays | null = null;
  /** The clock (game/day.ts): the date and the hour with its fraction, for the drays' rounds. */
  clock: () => { day: number; hour: number } = () => ({ day: 1, hour: 6 });
  /** The quay's models, once loaded (for the heaps' cargo). */
  private quay: Awaited<ReturnType<typeof quayModels>> | null = null;
  /** The heaps stand (world/quaygoods.ts): their cargo may have its own colliders now. */
  private heapsUp = false;
  /** Resolves when the server's list is in (the loading screen counts the fetch). */
  ready: Promise<void>;
  /** The server's list is in: the pile placeholders (world/rijnkaai.ts) have been let go. */
  loaded = false;
  private v = 0;
  /** The server's reason while its refusal is applied (for onLost). */
  private why = "";
  private loading: Promise<void> | null = null;
  private props: Props | null = null;
  private casks: THREE.Mesh[] = [];
  /** Time the last rebuild of the lying casks, crates and sacks of props.glb took (ms), for the checks. */
  caskMs = 0;
  private casksDirty = true;
  /** Ids of the lying items something rests on (kept up to date: `above` is asked every frame). */
  private under = new Set<string>();
  private underDirty = true;
  /** Held by others, drawn on them each frame. */
  private shownOn = new Map<string, THREE.Object3D>();
  private carriers = new Map<THREE.Object3D, CarrierFigure>();
  private loadedNpcs = new Map<string, CarrierPuppet>();
  /** Numbers for the checks: requests, refusals, pushes, list loads. */
  readonly stats = { asks: 0, refused: 0, pushes: 0, loads: 0, gaps: 0 };
  lastRefusal = "";

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
  ) {
    loadProps()
      .then((p) => {
        this.props = p;
        this.casksDirty = true;
        this.drays = createGoodsDrays(world.scene, p, { add: (r) => world.addCollider(r) });
        // colliders of the casks, crates and sacks from their model, now it is here
        for (const it of this.items) if (it.look === "cask" || it.look?.startsWith("p:")) this.collide(it);
      })
      .catch(() => {});
    quayModels()
      .then((m) => {
        this.quay = m;
        for (const it of this.items) if (it.look?.startsWith("q:")) this.collide(it);
      })
      .catch(() => {});
    // (the heaps' cargo from the server's list is drawn in the heaps' chunks: once they stand, and checked against them)
    whenQuayCargo(() => {
      this.heapsUp = true;
      for (const it of [...this.items]) if (it.look?.startsWith("q:")) this.lay(it, it.obj.position.x, it.y, it.obj.position.z, it.obj.rotation.y, it.on);
    });
    this.ready = this.load();
  }

  // ------------------------------------------------------------------ the server's list

  /** The whole list from the server (at the start, after a gap in the pushes, after the push line came back). */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      for (let tries = 0; tries < 6; tries++) {
        try {
          const res = await fetch("/api/goods", { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const b = (await res.json()) as { v: number; you: number; items: GoodsItem[] };
          this.me = typeof b.you === "number" ? b.you : 1;
          this.full(b.items, b.v);
          this.stats.loads++;
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000 * (tries + 1)));
        }
      }
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  /** A push from the server (net/api.ts connectPush). */
  onServer(m: GoodsPush): void {
    this.stats.pushes++;
    if (m.full) {
      this.full(m.items, m.v);
      return;
    }
    if (this.v && m.v !== this.v + 1) {
      // one was missed (the line dropped, a paused tab): the whole list again
      this.stats.gaps++;
      void this.load();
      return;
    }
    this.v = m.v;
    for (const s of m.items) this.apply(s);
    for (const id of m.gone) this.forget(id, m.why, m.at, m.who);
    if (m.why === "put" && m.who && !("p" in m.who && m.who.p === this.me)) for (const s of m.items) this.onOther(this.all.get(s.id)!, "put");
  }

  private full(list: GoodsItem[], v: number): void {
    this.v = v;
    const seen = new Set(list.map((s) => s.id));
    for (const id of [...this.all.keys()]) if (!seen.has(id)) this.forget(id, "reset");
    // the lower first: a stack is built from the ground
    for (const s of [...list].sort((a, b) => a.y - b.y)) this.apply(s, true);
    if (!this.loaded) {
      this.loaded = true;
      // the quay's piles and stacks are drawn from the list now: their placeholders let go
      for (const r of this.world.pileHolds ?? []) {
        r.minX = r.maxX = r.minZ = r.maxZ = 1e7;
        r.top = 0;
      }
    }
  }

  /** The server's word on one item (older than what this PC has: ignored, unless `force`). */
  private apply(s: GoodsItem, force = false): Item {
    let it = this.all.get(s.id);
    if (it && !force && s.rev < it.rev) return it;
    if (!it) {
      it = {
        id: s.id,
        obj: s.look ? new THREE.Group() : makeGoods(s.kind as Goods, this.world.mats, s.id),
        kind: s.kind as Goods,
        look: s.look,
        h: s.h,
        sc: s.sc,
        cartOnly: s.cartOnly || undefined,
        owner: s.owner,
        jobId: s.job,
        rect: null,
        y: 0,
        on: [],
        by: null,
        n: 0,
        rev: 0,
      };
      it.obj.name = `goods ${s.id}`;
      this.all.set(s.id, it);
    }
    const wasMine = this.carried === it;
    it.owner = s.owner;
    it.jobId = s.job;
    it.broken = s.broken || undefined;
    it.heavy = s.heavy || undefined;
    it.keep = s.keep || undefined;
    it.home = s.home;
    it.n = s.n;
    it.rev = s.rev;
    const mine = !!s.by && "p" in s.by && s.by.p === this.me;
    if (!s.by) {
      const o = it.obj;
      const same = !it.by && this.items.includes(it) && Math.abs(o.position.x - s.x) < 1e-3 && Math.abs(o.position.z - s.z) < 1e-3 && Math.abs(it.y - s.y) < 1e-3 && Math.abs(o.rotation.y - s.rot) < 1e-3;
      if (!same) this.lay(it, s.x, s.y, s.z, s.rot, s.on);
      else it.on = [...s.on];
    } else if (mine) {
      if (!wasMine) {
        // (his own, from the server: a reload while he carried it)
        this.toHands(it);
        this.player.speedFactor = it.heavy ? 0.4 : GOODS[it.kind].speed;
      }
    } else this.toHeld(it, s.by);
    this.underDirty = true;
    if (wasMine && !mine) {
      this.carried = null;
      this.player.laden = false;
      this.player.speedFactor = 1;
      this.onLost(it, this.why || (s.by ? "Someone was quicker." : ""));
    }
    return it;
  }

  /** Gone from the town (delivered, sold, sunk, the job over). */
  private forget(id: string, why: string, at?: [number, number], who?: GoodsPush["who"]): void {
    const it = this.all.get(id);
    if (!it) return;
    const wasMine = this.carried === it;
    this.detach(it);
    this.all.delete(id);
    // (another man let it go into the Schelde: it goes down here too, its model and all)
    if (at && !(who && "p" in who && who.p === this.me)) this.onOther(this.body(it) && it, why, at);
    if (wasMine) {
      this.carried = null;
      this.player.laden = false;
      this.player.speedFactor = 1;
      this.onLost(it, "");
    }
  }

  private async ask(a: GoodsAsk): Promise<{ ok: boolean; why?: string; items: GoodsItem[]; gone?: string[] }> {
    this.stats.asks++;
    try {
      const r = await net(a);
      if (!r.ok) {
        this.stats.refused++;
        this.lastRefusal = r.why ?? `HTTP ${r.status}`;
        // the server's word on what it was about: the thing goes back where it is
        this.why = r.why ?? "";
        try {
          for (const s of r.items) this.apply(s, true);
        } finally {
          this.why = "";
        }
      } else {
        for (const s of r.items) this.apply(s);
        for (const id of r.gone ?? []) this.forget(id, "gone");
      }
      return r;
    } catch (e) {
      // the server did not answer: the push line's resync puts things right when it is back
      return { ok: false, why: String((e as Error).message), items: [] };
    }
  }

  // ------------------------------------------------------------------ where things are drawn

  private detach(it: Item): void {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    if (it.rect) this.world.removeCollider(it.rect);
    it.rect = null;
    if (it.look === "cask" || it.look?.startsWith("p:")) this.casksDirty = true;
    else if (it.look?.startsWith("q:")) hideQuayCargo(it.id);
    it.obj.removeFromParent();
    this.shownOn.delete(it.id);
    this.underDirty = true;
  }

  private lay(it: Item, x: number, y: number, z: number, rot: number, on: string[]): void {
    this.detach(it);
    it.by = null;
    it.y = y;
    it.on = [...on];
    it.obj.position.set(x, y, z);
    it.obj.rotation.set(0, rot, 0);
    it.obj.scale.setScalar(1);
    if (it.look === "cask" || it.look?.startsWith("p:")) {
      for (const c of [...it.obj.children]) c.removeFromParent(); // (lying, the merged meshes draw it)
      this.casksDirty = true;
    } else if (it.look?.startsWith("q:")) {
      for (const c of [...it.obj.children]) c.removeFromParent(); // (lying, the heaps' chunk meshes draw it)
      showQuayCargo(it.id, it.look.slice(2), x, y, z, rot);
    } else this.world.scene.add(it.obj);
    this.items.push(it);
    this.underDirty = true;
    this.collide(it);
  }

  private collide(it: Item): void {
    if (it.by) return;
    if (it.rect) this.world.removeCollider(it.rect);
    const { x, z } = it.obj.position;
    const top = it.y + heightOf(it);
    const rot = it.obj.rotation.y;
    if (it.look === "cask") it.rect = this.props ? (this.props.colliders("barrel", x, z, rot, it.y)[0] ?? null) : null;
    else if (it.look?.startsWith("p:")) it.rect = this.props ? (this.props.colliders(it.look.slice(2), x, z, rot, it.y, it.sc ?? 1)[0] ?? null) : null;
    else if (it.look?.startsWith("q:")) {
      // (not before the heaps stand: they are placed against what is down, and hold their cargo's ground themselves)
      if (!this.heapsUp) return;
      it.rect = this.quay ? quayPieceCollider(this.quay, it.look.slice(2), x, z, rot, it.y) : null;
    } else it.rect = rectAround(x, z, FOOT, FOOT, top);
    // (a model not in yet: a box of its height until it is, so nothing walks into it)
    if (!it.rect && it.look) it.rect = rectAround(x, z, FOOT, FOOT, top);
    if (it.rect) {
      goodsRects.add(it.rect);
      this.world.addCollider(it.rect);
    }
  }

  /** The model of an item that is carried or on a cart (a quay's cask, crate or sack gets its own model now). */
  private body(it: Item): THREE.Object3D {
    if (it.look && !it.obj.children.length) {
      let m: THREE.Object3D | null = null;
      if (it.look === "cask") m = this.props ? this.props.place("barrel", 0, 0, 0) : null;
      else if (it.look.startsWith("p:") && this.props) {
        m = this.props.place(it.look.slice(2), 0, 0, 0);
        m.scale.setScalar(it.sc ?? 1);
      } else if (it.look.startsWith("q:")) m = quayPieceMesh(it.look.slice(2));
      // (the model not in yet: the plain goods of its kind, made again when it is)
      it.obj.add(m ?? Object.assign(makeGoods(it.kind, this.world.mats, it.id), { name: "stand-in" }));
    } else if (it.look && it.obj.children[0]?.name === "stand-in" && (this.props || this.quay)) {
      it.obj.children[0].removeFromParent();
      return this.body(it);
    }
    return it.obj;
  }

  /** The largest footprint of its model (m): a big crate is held a little smaller before the eyes. */
  private sizeOf(it: Item): number {
    if (it.look?.startsWith("q:") && this.quay) {
      const s = quayPieceSize(this.quay, it.look.slice(2));
      if (s) return Math.max(s.w, s.d);
    }
    if (it.look?.startsWith("p:") && this.props) {
      const f = this.props.footprint(it.look.slice(2));
      return Math.max(f.maxX - f.minX, f.maxZ - f.minZ) * (it.sc ?? 1);
    }
    return 0.7;
  }

  private toHands(it: Item): void {
    this.detach(it);
    it.by = { p: this.me };
    it.on = [];
    const o = this.body(it);
    o.position.set(...GOODS[it.kind].hold);
    o.rotation.set(0.05, 0.08, 0);
    // (a long crate or sack of the quay held before the eyes: no bigger than the arms can hold, 0.95 m)
    o.scale.setScalar(Math.min(1, 0.95 / Math.max(0.3, this.sizeOf(it))));
    this.player.camera.add(o);
    this.carried = it;
    this.player.laden = true;
  }

  private toHeld(it: Item, by: Holder): void {
    this.detach(it);
    it.by = by;
    it.on = [];
  }

  /** A cart's frame on this PC: a dray's bed (its load in the places of its round), another player's handcart. */
  private cartFrame(cart: string): CartFrame | null {
    const bed = this.drays?.bedOf(cart);
    const run = bed ? this.drays!.runOf(cart) : null;
    if (bed && run?.bed) {
      const places = run.bed;
      return {
        frame: bed,
        scale: 1,
        spot: (_i, it) => {
          const k = run.items.indexOf(it.id);
          const b = places[k >= 0 ? k : 0];
          return [b[0], b[1], b[2], b[3]];
        },
      };
    }
    // (a handcart of the town's rounds: two by two, two layers, as Jef's)
    if (bed && run) return handcartFrame(bed, run.items);
    return this.remoteCart(cart);
  }

  /** Each frame: what others carry, in their hands; what lies on carts; the lying casks' merged meshes; the drays. */
  update(dt = 0): void {
    if (this.drays) {
      const c = this.clock();
      const far = ((this.world.scene.fog as THREE.Fog | null)?.far ?? 60) + 10;
      this.drays.update(dt, c.day, c.hour, this.player.camera, far);
    }
    // other players' and townspeople's loads
    const figs = new Map<THREE.Object3D, CarrierFigure>();
    const npcs = new Map<string, CarrierPuppet>();
    // (M8f goods pass 2: what lies on a cart, on its bed; this player's own handcart lays its load itself)
    const onCarts = new Map<string, Item[]>();
    for (const it of this.all.values()) {
      const by = it.by;
      if (!by || !("cart" in by) || by.cart.startsWith(`hc:${this.me}:`)) continue;
      let l = onCarts.get(by.cart);
      if (!l) onCarts.set(by.cart, (l = []));
      l.push(it);
    }
    for (const [cart, list] of onCarts) {
      const f = this.cartFrame(cart);
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const tops = HANDCART_SLOTS.map(() => HANDCART_BED_Y);
      list.forEach((it, i) => {
        if (!f) {
          it.obj.removeFromParent();
          this.shownOn.delete(it.id);
          return;
        }
        const o = this.body(it);
        const [x, y, z, rot] = f.spot(i, it, tops);
        if (o.parent !== f.frame || o.position.x !== x || o.position.y !== y || o.position.z !== z) {
          o.position.set(x, y, z);
          o.rotation.set(0, rot, 0);
          o.scale.setScalar(f.scale);
          f.frame.add(o);
          this.shownOn.set(it.id, f.frame);
        }
      });
    }
    for (const it of this.all.values()) {
      const by = it.by;
      if (!by || ("p" in by && by.p === this.me) || "cart" in by) continue;
      let parent: THREE.Object3D | null = null;
      if ("p" in by) {
        const f = this.figureOf(by.p);
        if (f && f.shown && !figs.has(f.root)) {
          figs.set(f.root, f);
          f.carrying = true;
          parent = f.root;
        }
      } else if ("npc" in by) {
        const h = this.npcHands(by.npc);
        if (h && !h.cart && !npcs.has(by.npc)) {
          npcs.set(by.npc, h);
          parent = h.group;
        }
      }
      const o = parent ? this.body(it) : it.obj;
      if (!parent) {
        if (o.parent) o.removeFromParent();
        this.shownOn.delete(it.id);
        continue;
      }
      if (this.shownOn.get(it.id) !== parent || o.parent !== parent) {
        const barrel = it.kind === "barrels";
        if ("p" in by) {
          // another player: held before his chest in both arms (his figure faces +z; the carry clip's arms), a barrel
          // hugged lower (as he sees his own in first person)
          o.position.set(0, barrel ? 0.72 : 0.93, 0.36);
          o.rotation.set(0.05, 0, 0);
          o.scale.setScalar(0.8);
        } else {
          // a townsperson: on the shoulder, as the dockers carry (game/steps.ts did it for the hands); a barrel lies
          // on one shoulder beside his head, front to back, not stood on him
          const k = npcs.get((by as { npc: string }).npc)?.scale ?? 1;
          if (barrel) {
            o.position.set(0.22 * k, 1.56 * k, -0.38 * k);
            o.rotation.set(Math.PI / 2, 0, 0);
          } else {
            o.position.set(0, 1.12 * k, 0.28 * k);
            o.rotation.set(0.1, 0, 0);
          }
          o.scale.setScalar(0.85);
        }
        parent.add(o);
        this.shownOn.set(it.id, parent);
      }
    }
    for (const [root, f] of this.carriers) if (!figs.has(root)) f.carrying = false;
    this.carriers = figs;
    for (const [id, h] of this.loadedNpcs) if (!npcs.has(id)) h.load(false);
    for (const [id, h] of npcs) if (this.loadedNpcs.get(id) !== h) h.load(true);
    this.loadedNpcs = npcs;
    if (this.casksDirty && this.props) this.drawCasks();
    flushQuayCargo();
  }

  /**
   * The lying casks, crates and sacks of props.glb (the piles, the Rijnkaai's crate stacks and sacks): all of them
   * merged into one mesh per material (the props' own batch did the same for the static ones: the same draw calls,
   * the same materials, so no new shader), made again when one moves (a few times a minute; about a millisecond).
   * An InstancedMesh would be a new shader of each material (docs/rendering.md rule 3); a merge is not.
   */
  private drawCasks(): void {
    this.casksDirty = false;
    const t0 = performance.now();
    for (const m of this.casks) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.casks = [];
    const list = this.items.filter((it) => it.look === "cask" || it.look?.startsWith("p:"));
    if (!list.length) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const it of list) {
      const name = it.look === "cask" ? "barrel" : it.look!.slice(2);
      q.setFromAxisAngle(up, it.obj.rotation.y);
      sc.setScalar(it.look === "cask" ? 1 : (it.sc ?? 1));
      m.compose(it.obj.position, q, sc);
      for (const { geometry, material } of this.props!.parts(name)) {
        const g = geometry.clone();
        for (const a of Object.keys(g.attributes)) if (!KEEP.includes(a)) g.deleteAttribute(a);
        g.applyMatrix4(m);
        let l = byMat.get(material);
        if (!l) byMat.set(material, (l = []));
        l.push(g);
      }
    }
    for (const [material, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) if (g !== merged) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = "goods_casks";
      this.world.scene.add(mesh);
      this.casks.push(mesh);
    }
    this.caskMs = +(performance.now() - t0).toFixed(2);
  }

  /**
   * Dev (M8f goods pass 2): the heaps' cargo in the server's list against this PC's own heaps (world/quaygoods.ts):
   * how many, and any whose place differs (more than 2 cm or 0.01 rad) or that one side lacks. Empty `off`: the
   * list (shared/quaycargo.json) is baked from these heaps; else run tools/bake-quaycargo.mjs again.
   */
  cargoCheck(): { server: number; heaps: number; off: Array<[string, string]>; rebuilds: number; ms: number } {
    const mine = new Map(quayCargo().map((c) => [c[0], c]));
    const off: Array<[string, string]> = [];
    let server = 0;
    for (const it of this.all.values()) {
      if (!it.id.startsWith("qg:")) continue;
      server++;
      const c = mine.get(it.id);
      if (!c) {
        off.push([it.id, "no such heap here"]);
        continue;
      }
      const h = it.home ?? [it.obj.position.x, it.obj.position.z, it.obj.rotation.y];
      if (Math.hypot(h[0] - c[3], h[1] - c[5]) > 0.02 || Math.abs(h[2] - c[6]) > 0.01 || `q:${c[1]}` !== it.look) off.push([it.id, `list ${h.join(",")} ${it.look}, heap ${c[3]},${c[5]},${c[6]} q:${c[1]}`]);
    }
    for (const id of mine.keys()) if (!this.all.has(id)) off.push([id, "not in the server's list"]);
    return { server, heaps: mine.size, off: off.slice(0, 20), rebuilds: cargoStats.rebuilds, ms: cargoStats.ms };
  }

  // ------------------------------------------------------------------ stacks

  private lyingState(skip?: string): GoodsItem[] {
    return this.items
      .filter((it) => it.id !== skip)
      .map((it) => ({ id: it.id, kind: it.kind, look: it.look, owner: it.owner, job: it.jobId, x: it.obj.position.x, z: it.obj.position.z, y: it.y, rot: it.obj.rotation.y, on: it.on, by: null, n: it.n, rev: it.rev }));
  }

  /** Is anything resting on this one? (asked every frame for what can be lifted: a set, kept up to date) */
  above(it: Item): boolean {
    if (this.underDirty) {
      this.under.clear();
      for (const o of this.items) for (const id of o.on) this.under.add(id);
      this.underDirty = false;
    }
    return this.under.has(it.id);
  }

  /** Top-most item whose footprint covers (x, z). */
  topAt(x: number, z: number, reach = REACH_TOP): Item | null {
    let best: Item | null = null;
    for (const it of this.items) {
      if (Math.hypot(it.obj.position.x - x, it.obj.position.z - z) > reach) continue;
      if (this.above(it)) continue;
      if (!best || it.y > best.y) best = it;
    }
    return best;
  }

  /** Can an item be set down at (x, z)? On free ground, or on a stack that has room. */
  canPlace(x: number, z: number): "ground" | "stack" | null {
    if (this.world.baseAt(x, z) > 0.05) return null; // not on the gangway or the deck
    const kind = this.carried?.kind ?? "crates";
    const p = placeAt(this.lyingState(this.carried?.id), kind, x, z, this.carried?.id);
    if (!p) return null;
    if (p.on.length) return "stack";
    // ignore the player's own feet height: goods go on the quay
    return this.world.isFree(x, z, FOOT + 0.03, -1) ? "ground" : null;
  }

  /** The item you could lift (nothing on top of it, within reach) that Jef looks at, nearest the crosshair. */
  nearest(reach: number, filter: (it: Item) => boolean = () => true): Item | null {
    const { x, z } = this.player;
    return pick(this.items, (it) => {
      if (this.above(it) || !filter(it)) return null;
      // reach is shorter for things high up or low down
      const d = Math.hypot(it.obj.position.x - x, it.obj.position.z - z) + Math.abs(it.y + 0.4 - (this.player.y + 0.9)) * 0.4;
      return d < reach ? { d, at: this.middle(it) } : null;
    })?.it ?? null;
  }

  /** The middle of a piece of goods, for looking at it (game/facing.ts). */
  middle(it: Item): Target {
    return { x: it.obj.position.x, y: it.y + 0.3, z: it.obj.position.z };
  }

  byId(id: string): Item | null {
    return this.all.get(id) ?? null;
  }

  // ------------------------------------------------------------------ this player's hands

  /** Lift it: in his hands at once; the server's no puts it back (`onLost` says why). */
  lift(it: Item, hold: [number, number, number]): void {
    if (it.cartOnly) return;
    it.liftedFrom = { x: it.obj.position.x, z: it.obj.position.z, t: performance.now() };
    this.toHands(it);
    it.obj.position.set(...hold);
    void this.ask({ op: "lift", id: it.id });
  }

  /** Take the carried item out of his hands, here only (the caller tells the server what became of it). */
  release(): Item | null {
    const it = this.carried;
    if (!it) return null;
    it.obj.removeFromParent();
    this.carried = null;
    this.player.laden = false;
    this.player.speedFactor = 1;
    return it;
  }

  /** The carried item leaves the town (into the Schelde, a hand, sold, snatched, a gang): gone for every PC. */
  dropCarried(why: "sunk" | "handed" | "sold" | "snatched" | "taken", at?: [number, number]): Item | null {
    const it = this.release();
    if (!it) return null;
    this.detach(it);
    this.all.delete(it.id);
    void this.ask({ op: "drop", id: it.id, why, ...(at ? { at } : {}) });
    return it;
  }

  /** Set the carried item down at (x, z): where the stacking rule puts it, at once; the server agrees or moves it. */
  putDown(x: number, z: number): Item | null {
    const it = this.carried;
    if (!it) return null;
    const p = placeAt(this.lyingState(it.id), it.kind, x, z, it.id);
    if (!p) return null;
    this.release();
    this.lay(it, p.x, p.y, p.z, rotFor(it.id, it.n + 1), p.on);
    void this.ask({ op: "put", id: it.id, x: +x.toFixed(3), z: +z.toFixed(3) });
    return it;
  }

  /** Onto Jef's cart (game/handcart.ts: the server's cart route moved it): out of his hands, drawn on the cart by it. */
  toCart(it: Item, cart: string): void {
    if (this.carried === it) this.release();
    this.toHeld(it, { cart });
  }

  /** The model of an item on this player's own handcart (game/handcart.ts lays it on its bed). */
  cartBody(id: string): THREE.Object3D | null {
    const it = this.all.get(id);
    return it && it.by && "cart" in it.by ? this.body(it) : null;
  }

  /** A lying item of his job taken off (a thief at the watch, a briber's man): gone for every PC. */
  take(it: Item): void {
    this.detach(it);
    this.all.delete(it.id);
    void this.ask({ op: "take", id: it.id });
  }

  // ------------------------------------------------------------------ a job's goods (the server lays them out)

  /** His job's goods: laid out by the server once (lay: at the place they are fetched from); here when it answers. */
  async jobGoods(job: number, lay: boolean): Promise<Item[]> {
    const r = await this.ask({ op: "job", job, lay });
    return r.items.map((s) => this.all.get(s.id)).filter((x): x is Item => !!x);
  }

  /** A carry from the ship: the i-th swung down lands here. */
  async lower(job: number, i: number, flags: { broken: boolean; heavy: boolean }): Promise<Item | null> {
    const r = await this.ask({ op: "lower", job, i, ...flags });
    const s = r.items.find((q) => q.job === job && !q.by);
    return s ? (this.all.get(s.id) ?? null) : null;
  }

  /** A deliver: the employer's goods into his hands. */
  async handover(job: number): Promise<Item | null> {
    const r = await this.ask({ op: "handover", job });
    return this.carried && this.carried.jobId === job ? this.carried : r.ok ? (this.all.get(r.items[0]?.id ?? "") ?? null) : null;
  }

  /** New server state for an item this PC got another way (a cart's answer). */
  fromServer(s: GoodsItem): Item {
    return this.apply(s);
  }

  /** After a save is loaded: the job's goods as they lay, what he held. */
  restore(job: number | null, lying: Array<{ kind: string; x: number; z: number; rot: number; broken?: boolean; heavy?: boolean }>, carried: { kind: string; job: number | null; owner: string | null; broken?: boolean; heavy?: boolean } | null): Promise<unknown> {
    return this.ask({ op: "restore", job, lying, carried });
  }

  /** Drop all items of a job that are still lying about (job over): here at once, and the server too. */
  clearJob(jobId: number): void {
    for (const it of [...this.all.values()]) {
      if (it.jobId !== jobId || (it.by && "cart" in it.by)) continue;
      if (it.keep && !it.by) {
        it.jobId = null; // (a watch's pile stays, the employer's)
        continue;
      }
      if (this.carried === it) this.release();
      this.detach(it);
      this.all.delete(it.id);
    }
    void this.ask({ op: "end", job: jobId });
  }

  // ------------------------------------------------------------------ townspeople (the PC that walks them reports)

  /** A townsperson takes these up (his errand): on his shoulder on every PC. */
  npcLift(npc: string, list: Item[]): void {
    for (const it of list) this.toHeld(it, { npc });
    void this.ask({ op: "npc_lift", npc, ids: list.map((it) => it.id) });
  }

  /** He sets one down at (x, z) (the server may put it where it belongs instead). */
  npcPut(npc: string, it: Item, x: number, z: number): void {
    const p = placeAt(this.lyingState(it.id), it.kind, x, z, it.id);
    if (p) this.lay(it, p.x, p.y, p.z, rotFor(it.id, it.n + 1), p.on);
    void this.ask({ op: "npc_put", npc, id: it.id, x: +x.toFixed(3), z: +z.toFixed(3) });
  }

  /** He walked off with it (the engine's roll): gone. */
  npcDrop(npc: string, it: Item): void {
    this.detach(it);
    this.all.delete(it.id);
    void this.ask({ op: "npc_drop", npc, id: it.id });
  }

  /** Dev: the goods as the checks read them. */
  info(filter?: (it: Item) => boolean) {
    return [...this.all.values()]
      .filter((it) => !filter || filter(it))
      .map((it) => ({
        id: it.id,
        kind: it.kind,
        by: it.by,
        x: +it.obj.getWorldPosition(new THREE.Vector3()).x.toFixed(3),
        z: +it.obj.getWorldPosition(new THREE.Vector3()).z.toFixed(3),
        y: +it.y.toFixed(3),
        rot: +it.obj.rotation.y.toFixed(3),
        on: it.on,
        job: it.jobId,
        rev: it.rev,
      }));
  }
}

/** Point about d metres in front of the player, on the ground. */
export function ahead(player: FirstPerson, d: number): [number, number] {
  return [player.x - Math.sin(player.yaw) * d, player.z - Math.cos(player.yaw) * d];
}

export const worldPos = (it: Item) => new THREE.Vector3(it.obj.position.x, it.y, it.obj.position.z);

/**
 * A handcart's load (Jef's, another player's, the town's): on its pivot, two by two, two layers (HANDCART_SLOTS), at
 * the handcart's size; `order` puts the things in a fixed order (the town's run), else they come as listed (by id).
 */
export function handcartFrame(pivot: THREE.Object3D, order?: string[]): CartFrame {
  return {
    frame: pivot,
    scale: ON_HANDCART,
    spot: (i, it, tops) => {
      const n = order ? Math.max(0, order.indexOf(it.id)) : i;
      const k = n % HANDCART_SLOTS.length;
      const [x, z] = HANDCART_SLOTS[k];
      const y = tops[k];
      tops[k] += heightOf(it) * ON_HANDCART;
      return [x, y, z, ((n * 0.37) % 0.3) - 0.15];
    },
  };
}
