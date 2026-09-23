import * as THREE from "three";
import type { DeliverTask, CarryTask, Job, Progress, Report, WatchTask } from "../net/api";
import { SPOTS, WATER_Y, type World } from "../world/rijnkaai";
import { rectAround, type Rect } from "../world/geom";
import type { FirstPerson } from "../player/firstPerson";
import { GOODS, makeGoods, type Goods } from "./props";
import { Figure } from "./figures";

// How each kind of job plays in 3D (M2b). A run reports engine facts when it
// ends; the server settles money and trust.

export interface Action {
  key: "KeyE" | "KeyF";
  text: string;
  run: () => void;
}

export type Sfx = "lift" | "thud_wood" | "thud_soft" | "thud_plank" | "splash" | "bell" | "coins";

export interface RunCtx {
  world: World;
  player: FirstPerson;
  sfx(name: Sfx, at?: THREE.Vector3): void;
  toast(text: string): void;
  progress(p: Progress): void;
  finish(r: Report): void;
}

export interface Run {
  update(dt: number): void;
  actions(): Action[];
  /** Where the job wants you now, for the pointer. */
  goal(): THREE.Vector3 | null;
  hud(): string;
  dispose(): void;
}

const REACH_ITEM = 1.7;
const REACH_DROP = 2.2;
const REACH_PERSON = 2.4;
const SELL_PRICE = { carry: 35, deliver: 60 } as const;

const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Grid slot i around a spot, two columns, stacking along the spot's dir. */
function slot(spot: string, i: number, gap = 0.95): [number, number] {
  const s = SPOTS[spot];
  const [dx, dz] = s.dir;
  const side = (i % 2 ? 1 : -1) * 0.5;
  const along = Math.floor(i / 2) * gap;
  return [s.x + dx * along - dz * side, s.z + dz * along + dx * side];
}

/** A point near (x, z), about d metres to the side of the line a->b, on free ground. */
function besideRoute(world: World, ax: number, az: number, bx: number, bz: number, d: number): [number, number] {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const nx = -(bz - az) / len;
  const nz = (bx - ax) / len;
  for (const k of [1, -1, 1.6, -1.6, 0.5, -0.5]) {
    const x = mx + nx * d * k;
    const z = mz + nz * d * k;
    if (world.isFree(x, z, 0.5)) return [x, z];
  }
  return [mx, mz];
}

// ------------------------------------------------------------------ carry and deliver

interface Item {
  obj: THREE.Object3D;
  rect: Rect | null;
  broken: boolean;
  heavy: boolean;
}

/** Carry N goods from A to B, or deliver one item to a person. */
export class HaulRun implements Run {
  private items: Item[] = [];
  private carried: Item | null = null;
  private sinking: Array<{ obj: THREE.Object3D; t: number }> = [];
  private stacked: THREE.Object3D[] = [];
  private delivered: number;
  private lost: number;
  private sold: number;
  private pocketed = false;
  private brokenSeen = false;
  private t = 0;
  private late = false;
  private ended = false;
  private stranger: Figure | null = null;
  private strangerDone = false;
  private foreman: Figure | null = null;
  private recipient: Figure | null = null;
  private readonly kind: "carry" | "deliver";
  private readonly count: number;
  private readonly goods: Goods;
  private readonly mark: THREE.Mesh;

  constructor(
    private readonly job: Job,
    private readonly task: CarryTask | DeliverTask,
    private readonly ctx: RunCtx,
  ) {
    const { world } = ctx;
    this.kind = task.kind;
    this.goods = task.goods;
    this.count = task.kind === "carry" ? task.count : 1;
    const p = task.progress ?? { delivered: 0, lost: 0, sold: 0 };
    this.delivered = p.delivered;
    this.lost = p.lost;
    this.sold = p.sold;

    const left = this.count - this.delivered - this.lost - this.sold;
    for (let i = 0; i < left; i++) {
      const [x, z] = slot(task.from, i);
      this.items.push(this.place({ obj: makeGoods(this.goods, world.mats), rect: null, broken: false, heavy: false }, x, z, i * 0.37));
    }
    for (let i = 0; i < this.delivered; i++) this.stack(makeGoods(this.goods, world.mats));

    const to = SPOTS[task.to];
    const from = SPOTS[task.from];
    // chalk ring where carried goods go; for a delivery the person stands there instead
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 12), world.mats.chalk);
    this.mark.rotation.x = -Math.PI / 2;
    this.mark.position.set(to.x, 0.02, to.z);
    if (this.kind === "carry") world.scene.add(this.mark);
    else {
      this.recipient = new Figure("recipient", to.x, to.z, world.scene);
      this.recipient.face(from.x, from.z);
    }

    switch (task.twist) {
      case "broken_goods":
        if (this.items.length) this.items[Math.min(1, this.items.length - 1)].broken = true;
        break;
      case "heavy_load":
        if (this.items.length) this.items[0].heavy = true;
        break;
      case "stranger_offer": {
        const [sx, sz] = besideRoute(world, from.x, from.z, to.x, to.z, 3.5);
        this.stranger = new Figure("stranger", sx, sz, world.scene);
        break;
      }
      case "foreman_watches": {
        const [fx, fz] = besideRoute(world, to.x, to.z, to.x + to.dir[0], to.z + to.dir[1], 2.6);
        this.foreman = new Figure("foreman", fx, fz, world.scene);
        this.foreman.face(to.x, to.z);
        ctx.toast(`A man from ${job.employer_name}'s side stands by ${to.label}, arms folded, watching.`);
        break;
      }
      case "thick_fog":
        world.setThickFog(true);
        break;
    }
  }

  private place(item: Item, x: number, z: number, rot = 0): Item {
    item.obj.position.set(x, 0, z);
    item.obj.rotation.set(0, rot % 0.4, 0);
    this.ctx.world.scene.add(item.obj);
    item.rect = rectAround(x, z, 0.33, 0.33);
    this.ctx.world.addCollider(item.rect);
    return item;
  }

  private stack(obj: THREE.Object3D): void {
    const to = SPOTS[this.task.to];
    const n = this.stacked.length;
    const [dx, dz] = to.dir;
    const off = ((n % 3) - 1) * 0.78;
    obj.position.set(to.x + dx * off, Math.floor(n / 3) * GOODS[this.goods].h, to.z + dz * off);
    obj.rotation.set(0, (n * 0.23) % 0.2, 0);
    this.ctx.world.scene.add(obj);
    this.stacked.push(obj);
  }

  private get noun(): string {
    return GOODS[this.goods].one;
  }

  // ---- actions

  actions(): Action[] {
    if (this.ended) return [];
    const { player, world } = this.ctx;
    const { x, z } = player;
    const out: Action[] = [];
    if (this.carried) {
      const item = this.carried;
      const to = SPOTS[this.task.to];
      if (this.recipient && this.recipient.distTo(x, z) < REACH_PERSON) {
        out.push({ key: "KeyE", text: `hand it to ${(this.task as DeliverTask).recipient}`, run: () => this.handIn() });
      } else if (this.kind === "carry" && dist2(x, z, to.x, to.z) < REACH_DROP) {
        out.push({ key: "KeyE", text: "set it down here", run: () => this.handIn() });
      } else {
        const [px, pz] = this.ahead(0.95);
        if (world.isWater(px, pz)) out.push({ key: "KeyE", text: "let it fall into the Schelde", run: () => this.drown(px, pz) });
        else if (world.isFree(px, pz, 0.36)) out.push({ key: "KeyE", text: "set it down", run: () => this.putDown(px, pz) });
      }
      if (this.stranger && !this.strangerDone && this.stranger.distTo(x, z) < 3) {
        out.push({ key: "KeyF", text: `sell it to the stranger (${SELL_PRICE[this.kind]} c)`, run: () => this.sell() });
      } else if (item.broken && !this.pocketed) {
        out.push({ key: "KeyF", text: "fill your pockets", run: () => this.pocket() });
      }
      return out;
    }
    let best: Item | null = null;
    let bestD = REACH_ITEM;
    for (const it of this.items) {
      const d = dist2(x, z, it.obj.position.x, it.obj.position.z);
      if (d < bestD) {
        best = it;
        bestD = d;
      }
    }
    if (best) {
      const it = best;
      out.push({ key: "KeyE", text: `lift the ${this.noun}`, run: () => this.lift(it) });
    }
    return out;
  }

  private ahead(d: number): [number, number] {
    const { player } = this.ctx;
    return [player.x - Math.sin(player.yaw) * d, player.z - Math.cos(player.yaw) * d];
  }

  private lift(it: Item): void {
    const { world, player } = this.ctx;
    this.items = this.items.filter((i) => i !== it);
    if (it.rect) world.removeCollider(it.rect);
    it.rect = null;
    world.scene.remove(it.obj);
    const [hx, hy, hz] = GOODS[this.goods].hold;
    it.obj.position.set(hx, hy, hz);
    it.obj.rotation.set(0.05, 0.08, 0);
    player.camera.add(it.obj);
    this.carried = it;
    player.speedFactor = it.heavy ? 0.4 : GOODS[this.goods].speed;
    this.ctx.sfx("lift");
    if (it.heavy) this.ctx.toast(`This ${this.noun} is far too heavy for one man. You stagger under it.`);
    if (it.broken && !this.brokenSeen) {
      this.brokenSeen = true;
      this.ctx.toast(GOODS[this.goods].broken);
    }
  }

  private release(): Item {
    const it = this.carried!;
    this.ctx.player.camera.remove(it.obj);
    this.carried = null;
    this.ctx.player.speedFactor = 1;
    return it;
  }

  private putDown(x: number, z: number): void {
    const it = this.release();
    this.items.push(this.place(it, x, z, Math.random()));
    this.ctx.sfx(`thud_${GOODS[this.goods].thud}`, new THREE.Vector3(x, 0, z));
  }

  private handIn(): void {
    const it = this.release();
    const at = SPOTS[this.task.to];
    if (this.kind === "carry") {
      this.stack(it.obj);
      this.ctx.sfx(`thud_${GOODS[this.goods].thud}`, new THREE.Vector3(at.x, 0, at.z));
    } else {
      this.recipient?.face(this.ctx.player.x, this.ctx.player.z);
      this.ctx.toast(`${(this.task as DeliverTask).recipient} takes it without a word and turns away.`);
    }
    this.delivered++;
    this.changed();
  }

  private drown(x: number, z: number): void {
    const it = this.release();
    it.obj.position.set(x, 0.2, z);
    this.ctx.world.scene.add(it.obj);
    this.sinking.push({ obj: it.obj, t: 0 });
    this.lost++;
    this.ctx.toast(`The ${this.noun} goes over the edge. The Schelde takes it.`);
    this.changed();
  }

  private sell(): void {
    const it = this.release();
    this.strangerDone = true;
    this.sold++;
    this.ctx.sfx("coins");
    this.ctx.toast("He counts coins into your hand and is gone in the fog.");
    const s = this.stranger!;
    s.group.add(it.obj);
    it.obj.position.set(0, 0.9, 0.35);
    const { x, z } = this.ctx.player;
    s.walkTo(s.pos.x + (s.pos.x - x) * 8, s.pos.z + (s.pos.z - z) * 8, 1.4);
    this.changed();
  }

  private pocket(): void {
    this.pocketed = true;
    this.ctx.sfx("coins");
    this.ctx.toast("You fill your coat. Nobody saw. Or did they?");
  }

  private changed(): void {
    this.ctx.progress({ delivered: this.delivered, lost: this.lost, sold: this.sold });
    if (this.delivered + this.lost + this.sold >= this.count && !this.ended) {
      this.ended = true;
      this.ctx.finish({
        delivered: this.delivered,
        lost: this.lost,
        sold: this.sold,
        pocketed: this.pocketed,
        late: this.late,
      });
    }
  }

  // ---- frame

  update(dt: number): void {
    this.t += dt;
    const limit = this.task.limit_s;
    if (limit && !this.late && this.t > limit) {
      this.late = true;
      this.ctx.sfx("bell");
      this.ctx.toast("A bell rings over the water. You are late.");
    }
    const { x, z } = this.ctx.player;
    if (this.stranger) {
      if (!this.strangerDone) this.stranger.face(x, z);
      this.stranger.update(dt);
      if (this.strangerDone && !this.stranger.moving && !this.stranger.gone) this.stranger.remove();
    }
    this.foreman?.update(dt);
    this.recipient?.update(dt);
    for (const s of this.sinking) {
      const before = s.obj.position.y;
      s.t += dt;
      s.obj.position.y = s.t < 0.5 ? 0.2 - s.t * s.t * 18 : WATER_Y - (s.t - 0.5) * 0.35;
      if (before > WATER_Y && s.obj.position.y <= WATER_Y) this.ctx.sfx("splash", s.obj.position.clone());
      s.obj.rotation.z += dt * 0.6;
      if (s.t > 4) this.ctx.world.scene.remove(s.obj);
    }
    this.sinking = this.sinking.filter((s) => s.t <= 4);
  }

  goal(): THREE.Vector3 | null {
    if (this.ended) return null;
    const to = SPOTS[this.task.to];
    if (this.carried) return this.recipient ? this.recipient.pos.clone() : new THREE.Vector3(to.x, 0, to.z);
    const { x, z } = this.ctx.player;
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const it of this.items) {
      const d = dist2(x, z, it.obj.position.x, it.obj.position.z);
      if (d < bestD) {
        bestD = d;
        best = it.obj.position.clone();
      }
    }
    return best;
  }

  hud(): string {
    const to = SPOTS[this.task.to];
    const from = SPOTS[this.task.from];
    const step = this.carried
      ? this.kind === "deliver"
        ? `Bring it to ${esc((this.task as DeliverTask).recipient)} at ${to.label}`
        : `Bring it to ${to.label}`
      : this.items.length
        ? `Fetch the ${this.noun} at ${from.label}`
        : "…";
    const count = this.kind === "carry" ? `<br>${this.delivered} / ${this.count} delivered${this.lost ? `, ${this.lost} lost` : ""}${this.sold ? `, ${this.sold} sold` : ""}` : "";
    const time = this.task.limit_s ? `<br>${this.late ? "Late" : `The bell in ${clock(this.task.limit_s - this.t)}`}` : "";
    return `<b>${esc(this.job.title)}</b><br>${step}${count}${time}`;
  }

  dispose(): void {
    const { world, player } = this.ctx;
    if (this.carried) player.camera.remove(this.carried.obj);
    player.speedFactor = 1;
    for (const it of this.items) {
      world.scene.remove(it.obj);
      if (it.rect) world.removeCollider(it.rect);
    }
    world.scene.remove(this.mark);
    for (const f of [this.stranger, this.foreman, this.recipient]) if (f && !f.gone) f.remove();
    world.setThickFog(false);
    // delivered goods stay a while, then the natie takes them in
    const left = this.stacked;
    setTimeout(() => left.forEach((o) => world.scene.remove(o)), 60_000);
  }
}

// ------------------------------------------------------------------ watch

/** Stand guard at a post until the bell. Things come out of the fog. */
export class WatchRun implements Run {
  private pile: THREE.Object3D[] = [];
  private pileRects: Rect[] = [];
  private t = 0;
  private away = 0;
  private ended = false;
  private thief: Figure | null = null;
  private thiefState: "none" | "coming" | "chased" | "stole" = "none";
  private briber: Figure | null = null;
  private briberState: "none" | "coming" | "waiting" | "paid" | "sent" = "none";
  private briberWait = 0;
  private bribeTaken = false;
  private foreman: Figure | null = null;
  private foremanState: "none" | "coming" | "looking" | "leaving" = "none";
  private foremanLook = 0;
  private seenAway = false;
  private warnedAway = false;
  private readonly post: { x: number; z: number; label: string; dir: [number, number] };

  constructor(
    private readonly job: Job,
    private readonly task: WatchTask,
    private readonly ctx: RunCtx,
  ) {
    this.post = SPOTS[task.post];
    for (let i = 0; i < 3; i++) {
      const [x, z] = slot(task.post, i, 0.9);
      const obj = makeGoods(task.goods, ctx.world.mats);
      obj.position.set(x, 0, z);
      obj.rotation.y = i * 0.4;
      ctx.world.scene.add(obj);
      this.pile.push(obj);
      const r = rectAround(x, z, 0.33, 0.33);
      ctx.world.addCollider(r);
      this.pileRects.push(r);
    }
    if (task.twist === "thick_fog") ctx.world.setThickFog(true);
    ctx.toast(`Stand by the ${task.goods} at ${this.post.label} until the bell.`);
  }

  private near(): boolean {
    return dist2(this.ctx.player.x, this.ctx.player.z, this.post.x, this.post.z) < 7;
  }

  /** A walkable point about d metres from the post, out in the fog. */
  private outInFog(d: number): [number, number] {
    const { world } = this.ctx;
    for (let a = Math.random() * Math.PI * 2, i = 0; i < 16; i++, a += 0.7) {
      const x = this.post.x + Math.cos(a) * d;
      const z = this.post.z + Math.sin(a) * d;
      if (world.isFree(x, z, 0.5)) return [x, z];
    }
    return [this.post.x + d, this.post.z];
  }

  actions(): Action[] {
    if (this.ended) return [];
    const { x, z } = this.ctx.player;
    const out: Action[] = [];
    if (this.thief && this.thiefState === "coming" && this.thief.distTo(x, z) < 10) {
      out.push({ key: "KeyE", text: "shout at him", run: () => this.chase() });
    }
    if (this.briber && this.briberState === "waiting" && this.briber.distTo(x, z) < 3) {
      out.push({ key: "KeyF", text: "take his coin and look away (50 c)", run: () => this.takeBribe() });
      out.push({ key: "KeyE", text: "send him off", run: () => this.sendOff() });
    }
    return out;
  }

  private chase(): void {
    if (!this.thief || this.thiefState !== "coming") return;
    this.thiefState = "chased";
    const { x, z } = this.ctx.player;
    const t = this.thief;
    t.walkTo(t.pos.x + (t.pos.x - x) * 6, t.pos.z + (t.pos.z - z) * 6, 3.2);
    this.ctx.toast("He bolts into the fog. You hear him run, then nothing.");
  }

  private takePileItem(by: Figure): void {
    const obj = this.pile.pop();
    const r = this.pileRects.pop();
    if (!obj) return;
    if (r) this.ctx.world.removeCollider(r);
    this.ctx.world.scene.remove(obj);
    by.group.add(obj);
    obj.position.set(0, 0.9, 0.35);
  }

  private takeBribe(): void {
    this.bribeTaken = true;
    this.briberState = "paid";
    this.ctx.sfx("coins");
    this.ctx.toast("Coins, warm from his hand. You turn to look at the water.");
    const b = this.briber!;
    b.walkTo(this.post.x, this.post.z, 1.1);
  }

  private sendOff(): void {
    this.briberState = "sent";
    this.ctx.toast("He shrugs, and the fog takes him.");
    const [x, z] = this.outInFog(30);
    this.briber!.walkTo(x, z, 1.3);
  }

  update(dt: number): void {
    if (this.ended) return;
    this.t += dt;
    const { x, z } = this.ctx.player;
    const d = this.task.duration_s;
    if (!this.near()) {
      this.away += dt;
      if (!this.warnedAway && this.away > 5) {
        this.warnedAway = true;
        this.ctx.toast("You are away from your post.");
      }
    } else this.warnedAway = false;

    // twists
    if (this.task.twist === "thief" && this.thiefState === "none" && this.t > d * 0.3) {
      const [sx, sz] = this.outInFog(17);
      this.thief = new Figure("thief", sx, sz, this.ctx.world.scene);
      this.thief.walkTo(this.post.x, this.post.z, 0.8);
      this.thiefState = "coming";
    }
    if (this.thief) {
      if (this.thiefState === "coming") {
        if (this.thief.distTo(x, z) < 3.2) this.chase();
        else if (this.thief.distTo(this.post.x, this.post.z) < 1.3) {
          this.thiefState = "stole";
          this.takePileItem(this.thief);
          const [ox, oz] = this.outInFog(30);
          this.thief.walkTo(ox, oz, 2.2);
          this.ctx.toast("Something moves by the goods, and then it is gone. One is missing.");
        }
      }
      this.thief.update(dt);
      if (this.thiefState !== "coming" && !this.thief.moving && !this.thief.gone) this.thief.remove();
    }

    if (this.task.twist === "bribe" && this.briberState === "none" && this.t > d * 0.3) {
      const [sx, sz] = this.outInFog(12);
      this.briber = new Figure("stranger", sx, sz, this.ctx.world.scene);
      this.briberState = "coming";
    }
    if (this.briber) {
      const b = this.briber;
      if (this.briberState === "coming") {
        const dd = b.distTo(x, z);
        if (dd < 2) {
          b.stop();
          b.face(x, z);
          this.briberState = "waiting";
          this.ctx.toast(`"Evening, jongen. Cold work. What if you looked at the river a while?"`);
        } else b.walkTo(x, z, 1.1);
      } else if (this.briberState === "waiting") {
        b.face(x, z);
        this.briberWait += dt;
        if (this.briberWait > 25) this.sendOff();
      } else if (this.briberState === "paid" && !b.moving) {
        this.takePileItem(b);
        const [ox, oz] = this.outInFog(30);
        b.walkTo(ox, oz, 1.3);
        this.briberState = "sent";
      }
      b.update(dt);
      if (this.briberState === "sent" && !b.moving && !b.gone) b.remove();
    }

    if (this.task.twist === "foreman_watches" && this.foremanState === "none" && this.t > d * 0.5) {
      const [sx, sz] = this.outInFog(11);
      this.foreman = new Figure("foreman", sx, sz, this.ctx.world.scene);
      const [px, pz] = this.outInFog(3);
      this.foreman.walkTo(px, pz, 1.0);
      this.foremanState = "coming";
    }
    if (this.foreman) {
      const f = this.foreman;
      if (this.foremanState === "coming" && !f.moving) {
        this.foremanState = "looking";
        f.face(this.post.x, this.post.z);
        if (!this.near()) this.seenAway = true;
        else this.ctx.toast(`${this.job.employer_name}'s man looks you over, nods once, and says nothing.`);
      } else if (this.foremanState === "looking") {
        this.foremanLook += dt;
        if (this.foremanLook > 12) {
          const [ox, oz] = this.outInFog(25);
          f.walkTo(ox, oz, 1.0);
          this.foremanState = "leaving";
        }
      }
      f.update(dt);
      if (this.foremanState === "leaving" && !f.moving && !f.gone) f.remove();
    }

    if (this.t >= d) {
      this.ended = true;
      this.ctx.sfx("bell");
      this.ctx.toast("The bell. Your watch is over.");
      const thief = this.thiefState === "chased" ? "chased" : this.thiefState === "stole" || this.bribeTaken ? "stole" : "none";
      this.ctx.finish({
        left_post_s: Math.round(this.away),
        thief,
        bribe_taken: this.bribeTaken,
        seen_away: this.seenAway,
      });
    }
  }

  goal(): THREE.Vector3 | null {
    if (this.ended) return null;
    if (!this.near()) return new THREE.Vector3(this.post.x, 0, this.post.z);
    if (this.thief && this.thiefState === "coming") return this.thief.pos.clone();
    return null;
  }

  hud(): string {
    const status = this.near() ? `The bell in ${clock(this.task.duration_s - this.t)}` : "Back to your post!";
    return `<b>${esc(this.job.title)}</b><br>Stand watch at ${this.post.label}<br>${status}`;
  }

  dispose(): void {
    const { world } = this.ctx;
    for (const o of this.pile) world.scene.remove(o);
    for (const r of this.pileRects) world.removeCollider(r);
    for (const f of [this.thief, this.briber, this.foreman]) if (f && !f.gone) f.remove();
    world.setThickFog(false);
  }
}

export function makeRun(job: Job, ctx: RunCtx): Run | null {
  const t = job.task;
  if (!t) return null;
  if (t.kind === "watch") return new WatchRun(job, t, ctx);
  return new HaulRun(job, t, ctx);
}
