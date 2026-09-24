import * as THREE from "three";
import type { World } from "../world/rijnkaai";
import { SPOTS } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import { PushCart } from "../world/traffic";
import { loadProps, type Props } from "../world/props3d";
import { makePiece } from "../world/furniture";
import type { JobsPayload } from "../net/api";
import { GOODS, makeGoods, type Goods } from "./props";
import type { Item } from "./goods";
import type { Jobs } from "./jobs";
import type { Deeds } from "./deeds";
import type { Journeys } from "./journeys";
import type { Homes } from "./homes";
import { HaulRun, slot, type Action, type Sfx } from "./runs";
import { canLoad, LOAD, loadOf, pushSpeed, unloadAllAllowed, UNLOAD_NEAR_M, type CartThing } from "../../../shared/handcart";
import { cartPoints, footprint, stepCart, GRIP_AHEAD, REACH, type CartPose, type CartWorld } from "./cartPhysics";

// Jef's handcart (M6 handcart, Steve 2026-09-24): "I should be able to push a handcart and put
// multiple items on it, so I can deliver all crates at once, or other items."
//
// A cart of his own (bought or hired at the wheelwright's), or a household's (taken: a deed of
// M3h, game/deeds.ts). He takes the shafts (E) and pushes it: slower, and slower still loaded
// (shared/handcart.ts pushSpeed); the cart turns with him, a little behind, and every step is
// checked for the whole cart (game/cartPhysics.ts): walls, the water's edge, steps and ladders,
// things and people. Nothing off the flat walk map: no steps, no ladders, no omnibus (while he
// holds the shafts only E (let go) and F (unload here) are his keys). Let go (E), and it stands on
// its legs where he left it, solid, saved with its load. Goods in his hands go on it (E) up to the
// engine's limit by size and weight; G takes the top one off into his hands; at a carry job's goal
// F tips all the job's goods off at once where the job allows it (the pay is the board's: per
// thing). The server keeps every cart and every load (server/src/town/handcart.ts).

interface CartItem {
  kind: string;
  job: number | null;
  owner: string | null;
  broken?: boolean;
  heavy?: boolean;
  piece?: number;
}
interface JefCart {
  id: string;
  kind: "new" | "used" | "hire" | "taken";
  label: string;
  owner?: string;
  x: number;
  z: number;
  yaw: number;
  held: boolean;
  load: CartItem[];
  minutes_left: number | null;
}
interface CartShop {
  id: string;
  label: string;
  step: [number, number];
  wall: [number, number];
  out: [number, number];
  at: [number, number, number];
  show: Array<[number, number, number]>;
}
interface CartView {
  list: JefCart[];
  notice: { n: number; text: string } | null;
  dropped: Array<{ id: number; x: number; z: number; items: CartItem[] }>;
  shop: CartShop | null;
}

interface Drawn {
  info: JefCart;
  cart: PushCart | null;
  items: THREE.Object3D[];
  loadKey: string;
  solid: boolean;
}

async function net<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === "GET" ? 6000 : 20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const REACH_CART = 2.4;
const FURNITURE_KINDS = new Set(["chair", "table", "stove", "rug", "plant", "birdcage"]);
/** Where the things lie on the bed (the cart's pivot frame: x across, z toward the grips, y up from the axle): two by two, two layers. */
const SLOTS: Array<[number, number]> = [
  [-0.26, -0.42],
  [0.26, -0.42],
  [-0.26, 0.3],
  [0.26, 0.3],
];
const BED_Y = 0.2;
const ON_CART = 0.6;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export class Handcarts {
  private drawn = new Map<string, Drawn>();
  private props: Props | null = null;
  private shop: CartShop | null = null;
  private shown: { carts: PushCart[]; board: THREE.Mesh | null } = { carts: [], board: null };
  private notice = -1;
  private pollT = 0;
  private seenT = 0;
  private sendT = 0;
  private busy = false;
  private first = true;
  /** The cart in Jef's hands, and the way it points. */
  private held: string | null = null;
  private dir = 0;
  private lastSent = { x: 0, z: 0 };
  private moving = 0;
  /** A household's cart the server has just put in his hands (not to be let go by the next list). */
  private taking: string | null = null;
  say: (t: string) => void = () => {};
  sfx: (name: Sfx, at?: THREE.Vector3) => void = () => {};
  /** Is Jef somewhere a cart cannot go (inside a room, on the omnibus): set by main. */
  away: () => boolean = () => false;
  /** People in the street (the crowd), for the cart's way. */
  people: () => Iterable<{ x: number; z: number }> = () => [];

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly deeds: Deeds,
    private readonly journeys: Journeys,
    private readonly homes: Homes,
  ) {
    loadProps()
      .then((p) => {
        this.props = p;
        for (const d of this.drawn.values()) this.dress(d);
        if (this.shop) this.buildShop(this.shop);
      })
      .catch(() => {});
    jobs.goods.onCart = (id) => this.onCart(id);
    jobs.carryExtra.push((item, x, z) => this.carryKeys(item, x, z));
    deeds.onCart = (ref, again) => void this.tookHousehold(ref, again);
    const back = deeds.onBack;
    deeds.onBack = () => {
      back?.();
      void this.load();
    };
    const bought = jobs.talk.onBought;
    jobs.talk.onBought = (p, line) => {
      bought(p, line);
      void this.load();
    };
    void this.load();
  }

  // ------------------------------------------------------------------ the server's list

  /** Bumped by every change this side makes: a list asked for before it is stale when it comes. */
  private seq = 0;

  async load(): Promise<void> {
    const seq = this.seq;
    try {
      const v = await net<CartView>("GET", "/api/cart");
      if (!v || !Array.isArray(v.list) || seq !== this.seq) return;
      this.apply(v);
    } catch {
      // next time
    }
  }

  private apply(v: CartView): void {
    this.seq++;
    if (v.shop && !this.shop) {
      this.shop = v.shop;
      if (this.props) this.buildShop(v.shop);
    }
    const seen = new Set<string>();
    const vanished: CartItem[] = [];
    for (const info of v.list) {
      seen.add(info.id);
      let d = this.drawn.get(info.id);
      if (!d) {
        d = { info, cart: null, items: [], loadKey: "", solid: false };
        this.drawn.set(info.id, d);
        this.dress(d);
      }
      if (info.kind === "taken") this.journeys.jefTook(info.id, true);
      if (this.held === info.id) {
        d.info = { ...info, x: d.info.x, z: d.info.z, yaw: d.info.yaw, held: true };
      } else {
        // the server has him holding it, but nobody here is (a reload): he let go where it stood
        if (info.held && this.taking !== info.id) void net("POST", `/api/cart/${info.id.split(":")[1]}/at`, { x: info.x, z: info.z, yaw: info.yaw, held: false }).catch(() => {});
        d.info = { ...info, held: false };
        this.park(d);
      }
      this.showLoad(d);
    }
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      vanished.push(...d.info.load);
      if (this.held === id) this.release();
      this.undress(d);
      this.drawn.delete(id);
      this.journeys.jefTook(id, false);
    }
    // job goods that went with a cart (wheeled off by a thief): lost to the job, not left anywhere
    const dropped = v.dropped.flatMap((q) => q.items);
    const run = this.jobs.running;
    if (run && run.run instanceof HaulRun && !this.first) {
      const gone = vanished.filter((it) => it.job === run.job.id).length - dropped.filter((it) => it.job === run.job.id).length;
      for (let i = 0; i < gone; i++) run.run.onLost({ jobId: run.job.id, kind: run.job.task?.goods } as unknown as Item, "");
    }
    // loads left on the ground (a hired cart fetched, a taken cart gone back): set down as goods
    if (v.dropped.length) this.putDropped(v.dropped);
    if (v.notice && v.notice.n !== this.notice) {
      if (this.notice >= 0 || !this.first) this.say(v.notice.text);
      this.notice = v.notice.n;
    } else if (this.notice < 0) this.notice = v.notice?.n ?? 0;
    if (this.first) this.reconcile();
    this.first = false;
  }

  /** A job taken before a reload may have laid out goods that are on the cart: take the extra ones away. */
  private reconcile(): void {
    const r = this.jobs.running;
    const t = r?.job.task;
    if (!r || !t || t.kind !== "carry") return;
    const on = this.onCart(r.job.id);
    if (!on) return;
    const p = t.progress ?? { delivered: 0, lost: 0, sold: 0 };
    const goods = this.jobs.goods;
    const lying = goods.items.filter((it) => it.jobId === r.job.id);
    const carried = goods.carried?.jobId === r.job.id ? 1 : 0;
    let extra = lying.length + carried + on + p.delivered + p.lost + p.sold - t.count;
    const from = SPOTS[t.from];
    lying.sort((a, b) => Math.hypot(a.obj.position.x - from.x, a.obj.position.z - from.z) - Math.hypot(b.obj.position.x - from.x, b.obj.position.z - from.z));
    for (const it of lying.reverse()) {
      if (extra <= 0) break;
      if (goods.above(it)) continue;
      goods.remove(it);
      extra--;
    }
  }

  private putDropped(list: CartView["dropped"]): void {
    const goods = this.jobs.goods;
    const ids: number[] = [];
    for (const d of list) {
      d.items.forEach((it, i) => {
        if (!GOODS[it.kind as Goods]) return;
        const a = (i / Math.max(1, d.items.length)) * Math.PI * 2;
        let x = d.x + Math.cos(a) * 1.2;
        let z = d.z + Math.sin(a) * 1.2;
        for (let k = 0; k < 8 && !goods.canPlace(x, z); k++) {
          x = d.x + Math.cos(a + k * 0.8) * (1.2 + k * 0.3);
          z = d.z + Math.sin(a + k * 0.8) * (1.2 + k * 0.3);
        }
        goods.spawn(it.kind as Goods, x, z, { jobId: it.job, owner: it.owner, broken: it.broken, heavy: it.heavy });
      });
      ids.push(d.id);
    }
    void net("POST", "/api/cart/dropped", { ids }).catch(() => {});
  }

  /** How many of a job's goods are on Jef's carts. */
  onCart(jobId: number): number {
    let n = 0;
    for (const d of this.drawn.values()) for (const it of d.info.load) if (it.job === jobId) n++;
    return n;
  }

  // ------------------------------------------------------------------ drawing

  private dress(d: Drawn): void {
    if (!this.props || d.cart) return;
    d.cart = new PushCart(this.world.scene, this.props, { load: false });
    if (d.info.held && this.held === d.info.id) return;
    this.park(d);
  }

  private undress(d: Drawn): void {
    this.solid(d, false);
    for (const o of d.items) o.removeFromParent();
    d.items = [];
    d.loadKey = "";
    d.cart?.dispose();
    d.cart = null;
  }

  /** Standing on its legs at its place: axle at (x, z), pointing yaw; solid for walkers. */
  private park(d: Drawn): void {
    const c = d.cart;
    if (!c) return;
    const gx = d.info.x - Math.sin(d.info.yaw) * (GRIP_AHEAD + REACH - 0.45);
    const gz = d.info.z - Math.cos(d.info.yaw) * (GRIP_AHEAD + REACH - 0.45);
    c.place(gx, gz, d.info.yaw);
    c.push(1, gx, gz, 0.9, d.info.yaw, 0);
    this.solid(d, true);
  }

  private solid(d: Drawn, on: boolean): void {
    if (!d.cart || d.solid === on) return;
    for (const r of d.cart.rects) (on ? this.world.addCollider : this.world.removeCollider)(r);
    d.solid = on;
  }

  /** The things on the bed, stacked two by two in two layers. */
  private showLoad(d: Drawn): void {
    const key = d.info.load.map((i) => i.kind).join(",");
    if (!d.cart || key === d.loadKey) return;
    for (const o of d.items) o.removeFromParent();
    d.items = [];
    d.loadKey = key;
    const tops = SLOTS.map(() => BED_Y);
    d.info.load.forEach((it, i) => {
      let obj: THREE.Object3D;
      let h: number;
      if (FURNITURE_KINDS.has(it.kind)) {
        obj = makePiece(it.kind, 2.6).group;
        obj.scale.setScalar(0.5);
        h = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y;
      } else if (GOODS[it.kind as Goods]) {
        obj = makeGoods(it.kind as Goods, this.world.mats);
        obj.scale.setScalar(ON_CART);
        h = GOODS[it.kind as Goods].h * ON_CART;
      } else return;
      const k = i % SLOTS.length;
      const [x, z] = SLOTS[k];
      obj.position.set(x, tops[k], z);
      obj.rotation.y = ((i * 0.37) % 0.3) - 0.15;
      tops[k] += h;
      d.cart!.pivot.add(obj);
      d.items.push(obj);
    });
  }

  /** The wheelwright's door: a board over it, and a cart for sale and one for hire on the street in his hours. */
  private buildShop(s: CartShop): void {
    if (this.shown.board || !this.props) return;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 40;
    const g = c.getContext("2d")!;
    g.fillStyle = "#2a2014";
    g.fillRect(0, 0, 256, 40);
    g.strokeStyle = "#c8b078";
    g.strokeRect(3, 3, 250, 34);
    g.fillStyle = "#e8d8a8";
    g.font = "bold 22px Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("WHEELWRIGHT", 128, 21);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.4), new THREE.MeshLambertMaterial({ map: tex }));
    m.position.set(s.wall[0] + s.out[0] * 0.28, 3.5, s.wall[1] + s.out[1] * 0.28);
    m.rotation.y = Math.atan2(s.out[0], s.out[1]);
    this.world.scene.add(m);
    this.shown.board = m;
    for (const sp of s.show) {
      const cart = new PushCart(this.world.scene, this.props, { load: false });
      const gx = sp[0] - Math.sin(sp[2]) * (GRIP_AHEAD + REACH - 0.45);
      const gz = sp[1] - Math.cos(sp[2]) * (GRIP_AHEAD + REACH - 0.45);
      cart.place(gx, gz, sp[2]);
      cart.push(1, gx, gz, 0.9, sp[2], 0);
      cart.visible = false;
      this.shown.carts.push(cart);
    }
  }

  private updateShop(): void {
    const s = this.shop;
    if (!s) return;
    const h = this.jobs.day.hourF;
    const open = h >= 7.5 && h < 18.5 && !(h >= 12 && h < 13) && this.jobs.day.dayNum % 7 !== 0;
    s.show.forEach((sp, i) => {
      const c = this.shown.carts[i];
      if (!c) return;
      const mine = [...this.drawn.values()].some((d) => Math.hypot(d.info.x - sp[0], d.info.z - sp[1]) < 2);
      c.visible = open && !mine && Math.hypot(sp[0] - this.player.x, sp[1] - this.player.z) < 70;
    });
  }

  // ------------------------------------------------------------------ keys

  /** The keys of the cart (Jobs.extraActions, first in the list). */
  keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]>; extra?: Action[] } {
    if (this.away() || this.player.riding || this.player.swimming || this.player.climbing || this.player.bikeRiding || this.player.rowing) return {};
    const held = this.held ? this.drawn.get(this.held) : null;
    if (held) {
      const only: Action[] = [{ key: "KeyE", text: "let go of the handcart", run: () => void this.letGo() }];
      const all = this.unloadAllAction(held);
      if (all) only.push(all);
      return { only };
    }
    const near = this.nearest(x, z);
    // the dealer's piece in his arms: onto the cart, or the homes' own keys
    const arms = this.homes.carrying;
    if (arms) {
      if (!near) return {};
      const why = canLoad(near.info.load, { kind: arms.kind });
      const h = this.homes.keys(x, z).only ?? [];
      const put: Action = why
        ? { key: "KeyE", text: `${why}`, run: () => this.say(`${cap(why)}.`) }
        : { key: "KeyE", text: `put ${LOAD[arms.kind]?.name ? `the ${LOAD[arms.kind].name}` : "it"} on the cart`, run: () => void this.loadPiece(near, arms.id, arms.kind) };
      return { only: [put, ...h.filter((a) => a.key !== "KeyE")] };
    }
    const options: Array<[number, Action]> = [];
    const extra: Action[] = [];
    if (near) {
      options.push([near.d, { key: "KeyE", text: near.info.kind === "hire" ? "take the hired handcart" : near.info.kind === "taken" ? "take the handcart" : "take your handcart", run: () => void this.takeHold(near) }]);
      const top = near.info.load[near.info.load.length - 1];
      if (top) extra.push({ key: "KeyG", text: `lift the ${LOAD[top.kind]?.name ?? top.kind} off the cart`, run: () => void this.unloadOne(near) });
      const all = this.unloadAllAction(near);
      if (all) extra.push(all);
    }
    // a household's cart standing by their door or their stall: taking it is theft (M3h)
    let best: { id: string; label: string; d: number } | null = null;
    for (const c of this.journeys.standingCarts()) {
      const d = this.distTo(c.x, c.z, c.yaw, x, z);
      if (d < REACH_CART && (!best || d < best.d)) best = { id: c.id, label: c.label, d };
    }
    if (best) {
      const b = best;
      options.push([b.d + 0.05, { key: "KeyE", text: `take ${b.label}`, run: () => void this.deeds.takeCart(b.id) }]);
    }
    return { options, extra };
  }

  /** Goods in Jef's hands: onto the cart, if one of his stands by. */
  private carryKeys(item: Item, x: number, z: number): Action[] {
    if (this.held || this.away()) return [];
    const near = this.nearest(x, z);
    if (!near || !LOAD[item.kind]) return [];
    const why = canLoad(near.info.load, { kind: item.kind, heavy: item.heavy });
    if (why) return [{ key: "KeyE", text: why, run: () => this.say(`${cap(why)}.`) }];
    return [{ key: "KeyE", text: `put the ${GOODS[item.kind].one} on the cart`, run: () => void this.loadGoods(near, item) }];
  }

  /** F at a carry job's goal: all the job's goods off at once, where the job allows it. */
  private unloadAllAction(d: Drawn): Action | null {
    const r = this.jobs.running;
    const t = r?.job.task;
    if (!r || !t || (t.kind !== "carry" && t.kind !== "deliver") || !unloadAllAllowed(t)) return null;
    const n = d.info.load.filter((it) => it.job === r.job.id).length;
    if (!n) return null;
    const to = SPOTS[t.to];
    if (!to || Math.hypot(this.player.x - to.x, this.player.z - to.z) > UNLOAD_NEAR_M) return null;
    const noun = n === 1 ? GOODS[t.goods].one : t.goods;
    return { key: "KeyF", text: `unload the ${n === 1 ? "" : `${n} `}${noun} here`, run: () => void this.unloadAll(d) };
  }

  /** The nearest of Jef's carts standing (not held), within reach of any part of it. */
  private nearest(x: number, z: number): (Drawn & { d: number }) | null {
    let best: (Drawn & { d: number }) | null = null;
    for (const d of this.drawn.values()) {
      if (this.held === d.info.id || !d.cart) continue;
      const dist = this.distTo(d.info.x, d.info.z, d.info.yaw, x, z);
      if (dist < REACH_CART && (!best || dist < best.d)) best = Object.assign(d, { d: dist });
    }
    return best;
  }

  /** From (x, z) to the nearest part of a cart standing at axle (ax, az) pointing yaw: the bed or the grips. */
  private distTo(ax: number, az: number, yaw: number, x: number, z: number): number {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // along the cart's line from the front of the bed back to the grips
    const t = Math.max(-(GRIP_AHEAD + REACH - 0.45), Math.min(0.95, (x - ax) * fx + (z - az) * fz));
    return Math.hypot(x - (ax + fx * t), z - (az + fz * t));
  }

  // ------------------------------------------------------------------ taking hold, pushing, letting go

  private async takeHold(d: Drawn): Promise<void> {
    if (this.busy) return;
    if (this.jobs.goods.carried) return this.say("Your hands are full. Set that down first.");
    this.busy = true;
    try {
      if (d.info.kind === "taken") {
        // a household's cart he has taken before: the theft route knows it is his (no new deed)
        await this.deeds.takeCart(d.info.id);
      } else {
        await net("POST", `/api/cart/${d.info.id.split(":")[1]}/hold`, { x: +this.player.x.toFixed(2), z: +this.player.z.toFixed(2) });
        this.grab(d);
      }
    } catch (e) {
      this.say(`${cap((e as Error).message)}.`);
    } finally {
      this.busy = false;
    }
  }

  /** The server said a household's cart is his to push now. */
  private async tookHousehold(ref: string, again: boolean): Promise<void> {
    this.journeys.jefTook(ref, true);
    this.taking = ref;
    try {
      await this.load();
    } finally {
      this.taking = null;
    }
    const d = this.drawn.get(ref);
    if (!d) return;
    // (again: a cart of theirs he had taken before and left somewhere; the same hold. The theft's
    // own words (who saw it) stay on the screen: no word of the shafts after them)
    this.grab(d, !again);
  }

  /** Both hands on the grips: Jef steps behind the cart, and pushes it from now on. */
  private grab(d: Drawn, quiet = false): void {
    this.seq++;
    const p = this.player;
    let dir = d.info.yaw;
    let pose: CartPose = { px: d.info.x - Math.sin(dir) * (GRIP_AHEAD + REACH), pz: d.info.z - Math.cos(dir) * (GRIP_AHEAD + REACH), dir };
    // no room behind it: turn it toward where he stands
    if (!this.world.isFree(pose.px, pose.pz, 0.32)) {
      dir = Math.atan2(d.info.x - p.x, d.info.z - p.z);
      pose = { px: p.x, pz: p.z, dir };
    }
    this.solid(d, false);
    this.held = d.info.id;
    this.dir = pose.dir;
    d.info = { ...d.info, held: true };
    p.place(pose.px, pose.pz, pose.dir - Math.PI, p.pitch);
    p.laden = true;
    p.cartStep = (x, z, nx, nz, dt) => this.step(x, z, nx, nz, dt);
    this.lastSent = { x: d.info.x, z: d.info.z };
    if (!quiet) this.say("You take the shafts. W pushes, the mouse turns the cart with you. E lets go.");
  }

  /** Jef lets go (or has to: a reload, a night in the cell): the cart stands where it is. */
  private release(): { x: number; z: number; yaw: number } | null {
    this.seq++;
    const d = this.held ? this.drawn.get(this.held) : null;
    this.held = null;
    this.player.cartStep = null;
    this.player.laden = !!this.jobs.goods.carried || !!this.homes.carrying;
    this.player.speedFactor = 1;
    if (!d) return null;
    const { ax, az } = cartPoints({ px: this.player.x, pz: this.player.z, dir: this.dir });
    d.info = { ...d.info, x: +ax.toFixed(2), z: +az.toFixed(2), yaw: +this.dir.toFixed(3), held: false };
    this.park(d);
    return { x: d.info.x, z: d.info.z, yaw: d.info.yaw };
  }

  private async letGo(force = false): Promise<void> {
    // never left standing on the rails or a crane runway: the train and the cranes run there
    if (!force && this.held && footprint({ px: this.player.x, pz: this.player.z, dir: this.dir }).some(([x, z, r]) => this.world.onRails(x, z, r * 0.5))) {
      this.say("Not on the rails: the goods train comes along here. Push it clear first.");
      return;
    }
    // fixes 2026-09-24 (Steve: "cart lodged in lock boom"): never where a lock gate's balance beam swings
    if (!force && this.held && footprint({ px: this.player.x, pz: this.player.z, dir: this.dir }).some(([x, z, r]) => this.world.lockSweep(x, z, r * 0.5))) {
      this.say("Not here: the lock gate's beam swings round over this spot. Push it clear first.");
      return;
    }
    const id = this.held;
    const at = this.release();
    if (!id || !at) return;
    try {
      const v = await net<JobsPayload & { carts: CartView }>("POST", `/api/cart/${id.split(":")[1]}/at`, { ...at, held: false });
      this.jobs.refresh(v);
      this.apply(v.carts);
    } catch (e) {
      console.warn("[handcart] let go", e);
    }
  }

  /** player.cartStep: the step the walk rules allow, if the whole cart fits there too. */
  private step(x: number, z: number, nx: number, nz: number, dt: number): [number, number] {
    const face = this.player.yaw + Math.PI;
    const w: CartWorld = {
      free: (px, pz, r) => this.world.isFree(px, pz, r) && !this.world.moverAt(px, pz, r),
      base: (px, pz) => this.world.baseAt(px, pz),
      people: () => this.people(),
      water: (px, pz) => this.world.isWater(px, pz),
    };
    const r = stepCart({ px: x, pz: z, dir: this.dir }, nx, nz, face, dt, w, this.world.baseAt(x, z));
    this.dir = r.dir;
    return [r.px, r.pz];
  }

  // ------------------------------------------------------------------ loading and unloading

  private async loadGoods(d: Drawn, item: Item): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const v = await net<JobsPayload & { carts: CartView }>("POST", `/api/cart/${d.info.id.split(":")[1]}/load`, {
        x: +this.player.x.toFixed(2),
        z: +this.player.z.toFixed(2),
        item: { kind: item.kind, job: item.jobId, owner: item.owner, broken: !!item.broken, heavy: !!item.heavy },
      });
      if (this.jobs.goods.carried === item) this.jobs.goods.release();
      this.sfx(`thud_${GOODS[item.kind].thud}`, new THREE.Vector3(d.info.x, 0.6, d.info.z));
      this.jobs.refresh(v);
      this.apply(v.carts);
      const kg = loadOf(this.drawn.get(d.info.id)?.info.load ?? []).kg;
      this.say(`On the cart: ${this.describe(this.drawn.get(d.info.id)?.info.load ?? [])} (${kg} kg).`);
    } catch (e) {
      this.say(`${cap((e as Error).message)}.`);
    } finally {
      this.busy = false;
    }
  }

  private async loadPiece(d: Drawn, piece: number, kind: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const v = await net<JobsPayload & { carts: CartView }>("POST", `/api/cart/${d.info.id.split(":")[1]}/load`, { x: +this.player.x.toFixed(2), z: +this.player.z.toFixed(2), item: { kind, piece } });
      this.jobs.refresh(v);
      this.apply(v.carts);
      await this.homes.load();
      this.sfx("thud_wood", new THREE.Vector3(d.info.x, 0.6, d.info.z));
    } catch (e) {
      this.say(`${cap((e as Error).message)}.`);
    } finally {
      this.busy = false;
    }
  }

  private async unloadOne(d: Drawn): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const v = await net<JobsPayload & { carts: CartView; item: CartItem }>("POST", `/api/cart/${d.info.id.split(":")[1]}/unload`, { x: +this.player.x.toFixed(2), z: +this.player.z.toFixed(2) });
      this.jobs.refresh(v);
      this.apply(v.carts);
      const it = v.item;
      if (it.piece !== undefined) await this.homes.load();
      else if (GOODS[it.kind as Goods]) {
        const kind = it.kind as Goods;
        const got = this.jobs.goods.receive(kind, GOODS[kind].hold, { jobId: it.job, owner: it.owner });
        got.broken = it.broken;
        got.heavy = it.heavy;
        this.player.speedFactor = it.heavy ? 0.4 : GOODS[kind].speed;
        const r = this.jobs.running;
        if (r?.run instanceof HaulRun) r.run.onLifted(got);
      }
      this.sfx("lift");
    } catch (e) {
      this.say(`${cap((e as Error).message)}.`);
    } finally {
      this.busy = false;
    }
  }

  /** All the job's goods off the cart at its goal, set down there one after another. */
  private async unloadAll(d: Drawn): Promise<void> {
    const r = this.jobs.running;
    const t = r?.job.task;
    if (this.busy || !r || !t || t.kind === "watch" || t.kind === "letters") return;
    this.busy = true;
    try {
      // (he keeps hold of the shafts: the goods come off the back of the cart)
      const v = await net<JobsPayload & { carts: CartView; items: CartItem[] }>("POST", `/api/cart/${d.info.id.split(":")[1]}/unload`, {
        x: +this.player.x.toFixed(2),
        z: +this.player.z.toFixed(2),
        job: r.job.id,
      });
      this.jobs.refresh(v);
      this.apply(v.carts);
      const p = t.progress?.delivered ?? 0;
      const goods = this.jobs.goods;
      const placed: Item[] = [];
      v.items.forEach((it, i) => {
        const [x, z] = slot(t.to, (p + i) % 6, 0.8);
        placed.push(goods.spawn(it.kind as Goods, x, z, { jobId: it.job, owner: it.owner, broken: it.broken, heavy: it.heavy }));
      });
      this.sfx(`thud_${GOODS[t.goods].thud}`, new THREE.Vector3(SPOTS[t.to].x, 0.3, SPOTS[t.to].z));
      this.say(`You tip the ${t.goods} off the cart, one after another, and stack them at ${SPOTS[t.to].label}.`);
      for (const it of placed) r.run.onPlaced(it);
    } catch (e) {
      this.say(`${cap((e as Error).message)}.`);
    } finally {
      this.busy = false;
    }
  }

  private describe(load: CartItem[]): string {
    const n = new Map<string, number>();
    for (const it of load) n.set(it.kind, (n.get(it.kind) ?? 0) + 1);
    return [...n].map(([k, c]) => `${c} ${LOAD[k]?.name ?? k}${c > 1 ? "s" : ""}`).join(", ") || "nothing";
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    const p = this.player;
    const d = this.held ? this.drawn.get(this.held) : null;
    if (d) {
      // taken off his hands (a night in the cell, a jump across the map): he lets go
      if (p.riding || p.swimming || p.climbing || p.bikeRiding || this.away() || p.cartStep === null) {
        void this.letGo(true);
      } else {
        const kg = loadOf(d.info.load as CartThing[]).kg;
        p.speedFactor = pushSpeed(kg);
        p.laden = true;
        const pts = cartPoints({ px: p.x, pz: p.z, dir: this.dir });
        const before = { x: d.info.x, z: d.info.z };
        if (Math.hypot(pts.ax - before.x, pts.az - before.z) > 3) {
          // Jef was moved somewhere else at a stroke (the cell, the dev menu): the cart stays where it was
          this.held = null;
          p.cartStep = null;
          p.laden = false;
          p.speedFactor = 1;
          d.info = { ...d.info, held: false };
          this.park(d);
          void net("POST", `/api/cart/${d.info.id.split(":")[1]}/at`, { x: d.info.x, z: d.info.z, yaw: d.info.yaw, held: false }).catch(() => {});
          return;
        }
        d.info.x = pts.ax;
        d.info.z = pts.az;
        d.info.yaw = this.dir;
        this.moving = Math.hypot(pts.ax - before.x, pts.az - before.z) / Math.max(dt, 1e-3);
        if (d.cart) {
          d.cart.steer(this.dir);
          d.cart.push(dt, pts.gx, pts.gz, 0.88, this.dir, 1);
        }
        // the server hears where it is now and then
        this.sendT -= dt;
        if (this.sendT <= 0 && Math.hypot(pts.ax - this.lastSent.x, pts.az - this.lastSent.z) > 1) {
          this.sendT = 3;
          this.lastSent = { x: pts.ax, z: pts.az };
          void net("POST", `/api/cart/${d.info.id.split(":")[1]}/at`, { x: +pts.ax.toFixed(2), z: +pts.az.toFixed(2), yaw: +this.dir.toFixed(3), held: true }).catch(() => {});
        }
      }
    } else this.moving = 0;
    // far carts are not drawn (two draw calls and their load each)
    for (const q of this.drawn.values()) if (q.cart && q !== d) q.cart.visible = Math.hypot(q.info.x - p.x, q.info.z - p.z) < 70;
    this.updateShop();
    // Jef stands by his carts: the server knows (a cart he stands by is not wheeled off)
    this.seenT -= dt;
    if (this.seenT <= 0 && this.drawn.size) {
      this.seenT = 5;
      void net("POST", "/api/cart/seen", { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }).catch(() => {});
    }
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = 12;
      void this.load();
    }
  }

  /** The pushed cart for the vehicles' eyes (world/traffic.ts, omnibus, train: they stop for it). */
  /** Fixes 2026-09-24: every cart's middle (parked, and the pushed one's wheels), for the lock gates. */
  allPoints(): Array<{ x: number; z: number }> {
    const out = this.points();
    for (const d of this.drawn.values()) if (!d.info.held) out.push({ x: d.info.x, z: d.info.z });
    return out;
  }

  points(): Array<{ x: number; z: number }> {
    if (!this.held) return [];
    return footprint({ px: this.player.x, pz: this.player.z, dir: this.dir })
      .filter((_, i) => i === 1 || i === 4 || i === 7)
      .map(([x, z]) => ({ x, z }));
  }

  /** The pushed cart's iron tyres on the stones (the soundscape's vehicles). */
  sounds(): Array<{ kind: "handcart"; x: number; z: number; state: string }> {
    const d = this.held ? this.drawn.get(this.held) : null;
    if (!d || this.moving < 0.3) return [];
    return [{ kind: "handcart", x: d.info.x, z: d.info.z, state: "go" }];
  }

  /** For the path check (CLAUDE.md): the wheelwright's door and his carts on the street. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const s = this.shop;
    if (!s) return [];
    return [{ label: s.label, x: s.at[0], z: s.at[1], reach: 2.0 }, ...s.show.map((p, i) => ({ label: `${s.label}: cart ${i + 1}`, x: p[0], z: p[1], reach: 2.6 }))];
  }

  /** Dev: state for checks. */
  info() {
    return {
      held: this.held,
      dir: +this.dir.toFixed(3),
      speed: +this.player.speedFactor.toFixed(2),
      carts: [...this.drawn.values()].map((d) => ({ id: d.info.id, kind: d.info.kind, x: +d.info.x.toFixed(2), z: +d.info.z.toFixed(2), yaw: +d.info.yaw.toFixed(2), load: d.info.load.map((i) => `${i.kind}${i.job ? `#${i.job}` : ""}`), ...loadOf(d.info.load) })),
      shop: this.shop,
    };
  }
}
