import * as THREE from "three";
import type { DeliverTask, CarryTask, Job, Progress, Report, WatchTask } from "../net/api";
import { DECK, RAMP, SPOTS, type World } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import { GOODS, makeGoods, type Goods } from "./props";
import { Figure } from "./figures";
import type { GoodsWorld, Item } from "./goods";
import type { People } from "./people";
import type { Pockets } from "./pockets";
import { api, type JobsPayload } from "../net/api";
import { chest, type Target } from "./facing";
import type { QuestBoxes } from "./questboxes";
import { gameMin } from "../../../shared/clock";

// How each kind of job plays in 3D (M2b, M3). Goods live in the shared
// GoodsWorld; a run tags its own goods with the job id and watches what
// happens to them. It reports engine facts when it ends; the server settles.

export interface Action {
  key: "KeyE" | "KeyF" | "KeyG";
  text: string;
  run: () => void;
  /** What it is about (world x, z; y when known): offered only when Jef looks at it (game/facing.ts). */
  at?: Target;
  /** About Jef himself or the spot ahead: no looking needed (the list is in game/facing.ts). */
  self?: true;
  /** A wider cone than the usual (degrees): the thief who just robbed you. */
  cone?: number;
}

export type Sfx = "lift" | "thud_wood" | "thud_soft" | "thud_plank" | "splash" | "bell" | "coins";

export interface RunCtx {
  world: World;
  player: FirstPerson;
  goods: GoodsWorld;
  people: People;
  pockets: Pockets;
  /** New server state after a call (money, pockets). */
  refresh(p: JobsPayload): void;
  sfx(name: Sfx, at?: THREE.Vector3): void;
  toast(text: string): void;
  progress(p: Progress): void;
  finish(r: Report): void;
  /** M7 night: the employers' quest boxes (a parcel waits in the box while its man is home asleep). */
  box?: QuestBoxes | null;
  /** The game's hour now (a stranger's greeting fits the time of day). */
  hour?: () => number;
}

export interface Run {
  update(dt: number): void;
  /** Job actions when your hands are empty (take a parcel, call the ship, shout at a thief). */
  actions(): Action[];
  /** Job actions for what you carry (hand it over, sell it, pocket some). */
  carryActions(item: Item): Action[];
  /** Label for setting the carried item down here, if the job cares ("set it down here"). */
  placeLabel(item: Item, x: number, z: number): string | null;
  /** A carried item was set down at (x, z). */
  onPlaced(item: Item): void;
  /** A carried item went into the Schelde. */
  onLost(item: Item, why?: string): void;
  /** Where the job wants you now, for the pointer. */
  goal(): THREE.Vector3 | null;
  hud(): string;
  dispose(): void;
  /** M7 save and pause: how far the run has come that the server does not keep (its clock, what happened). */
  snapshot?(): Record<string, unknown>;
  /** M7 save and pause: back to a snapshot, on a run just made for the same job (after a load). */
  restore?(s: Record<string, unknown>): void;
}

const REACH_DROP = 2.2;
const REACH_PERSON = 2.6;
const SELL_PRICE = { carry: 35, deliver: 60 } as const;

const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
/**
 * The time left to the bell in game minutes (M7 quest tests: "The bell in 1:47", real minutes and
 * seconds, read as an hour and 47 beside the game's clock; 107 real seconds are 54 game minutes).
 */
const bellIn = (realSecs: number) => {
  const m = Math.max(1, Math.ceil(gameMin(Math.max(0, realSecs))));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};
/** A sentence starts with a capital ("the mate of the Anna Maria takes it"). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A stranger's hello by the hour. */
const hello = (h: number) => (h >= 5 && h < 12 ? "Morning" : h >= 12 && h < 18 ? "Afternoon" : "Evening");
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Grid slot i around a spot, two columns, stacking along the spot's dir. */
export function slot(spot: string, i: number, gap = 0.95): [number, number] {
  const s = SPOTS[spot];
  const [dx, dz] = s.dir;
  const side = (i % 2 ? 1 : -1) * 0.5;
  const along = Math.floor(i / 2) * gap;
  return [s.x + dx * along - dz * side, s.z + dz * along + dx * side];
}

/** No goods lying within half a metre of (x, z)? */
function freeSlot(goods: GoodsWorld, x: number, z: number): boolean {
  return !goods.items.some((it) => Math.hypot(it.obj.position.x - x, it.obj.position.z - z) < 0.55);
}

/** A point near the middle of a->b, about d metres to the side, on free ground. */
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

/** Goods being lowered from the ship on a rope. */
interface Lowering {
  obj: THREE.Object3D;
  rope: THREE.Mesh;
  from: THREE.Vector3;
  to: [number, number];
  t: number;
  broken: boolean;
  heavy: boolean;
}

export class HaulRun implements Run {
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
  /** Deliver: the parcel is still with the employer. Carry from the ship: the cargo is still aboard. */
  private waitingHandover: boolean;
  private lowering: Lowering[] = [];
  private toLower: Array<{ broken: boolean; heavy: boolean }> = [];
  private lowerTimer = 0;
  private readonly kind: "carry" | "deliver";
  private readonly count: number;
  private readonly goods: Goods;
  private readonly mark: THREE.Mesh;

  constructor(
    private readonly job: Job,
    private readonly task: CarryTask | DeliverTask,
    private readonly ctx: RunCtx,
  ) {
    const { world, goods } = ctx;
    this.kind = task.kind;
    this.goods = task.goods;
    this.count = task.kind === "carry" ? task.count : 1;
    const p = task.progress ?? { delivered: 0, lost: 0, sold: 0 };
    this.delivered = p.delivered;
    this.lost = p.lost;
    this.sold = p.sold;
    // M6 handcart: goods already on Jef's cart (a reload) are not laid out again
    const left = Math.max(0, this.count - this.delivered - this.lost - this.sold - goods.onCart(job.id));

    // which of the goods carry a twist
    const flags = Array.from({ length: left }, () => ({ broken: false, heavy: false }));
    if (task.twist === "broken_goods" && left) flags[Math.min(1, left - 1)].broken = true;
    if (task.twist === "heavy_load" && left) flags[0].heavy = true;

    const fromShip = task.kind === "carry" && task.from === "ship_gangway";
    const employer = ctx.people.get(job.employer_npc);
    this.waitingHandover =
      left > 0 && ((task.kind === "deliver" && !!employer && !(this.pocketed_ && ctx.pockets.hasJobParcel(job.id))) || fromShip);
    if (fromShip) this.toLower = flags;
    else if (!this.waitingHandover) {
      // M7 quest tests: the goods of an earlier job delivered here lie on the same slots (an emigrant's
      // lost chest came up inside Tuur's crates at the cart stand, and E lifted a crate): the next free slots
      let k = 0;
      flags.forEach((f) => {
        let [x, z] = slot(task.from, k);
        while (k < 40 && freeSlot(goods, x, z) === false) [x, z] = slot(task.from, ++k);
        k++;
        goods.spawn(this.goods, x, z, { jobId: job.id, owner: job.employer_npc, ...f });
      });
    }
    // goods already delivered before a reload lie at the drop spot
    for (let i = 0; i < this.delivered && this.kind === "carry"; i++) {
      const [x, z] = slot(task.to, i, 0.8);
      goods.spawn(this.goods, x, z, { owner: job.employer_npc });
    }

    const to = SPOTS[task.to];
    const from = SPOTS[task.from];
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 12), world.mats.chalk);
    this.mark.rotation.x = -Math.PI / 2;
    this.mark.position.set(to.x, 0.02, to.z);
    if (this.kind === "carry") world.scene.add(this.mark);
    else {
      // someone waiting for the delivery; on the ship they stand on deck at the top of the gangway
      this.recipient =
        task.to === "ship_gangway"
          ? new Figure("recipient", RAMP.x - 0.6, RAMP.zHigh - 1.0, world.scene, () => DECK.y)
          : new Figure("recipient", to.x, to.z, world.scene);
      this.recipient.face(from.x, from.z);
    }

    switch (task.twist) {
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

  private get noun(): string {
    return GOODS[this.goods].one;
  }

  private isMine(it: Item): boolean {
    return it.jobId === this.job.id;
  }

  /** A parcel travels in the pocket, not in the hands (M3b). */
  private get pocketed_(): boolean {
    return this.task.kind === "deliver" && this.task.goods === "parcel";
  }

  private get parcelInPocket(): boolean {
    return this.pocketed_ && this.ctx.pockets.hasJobParcel(this.job.id);
  }

  // ---- empty hands

  actions(): Action[] {
    if (this.ended) return [];
    const { x, z } = this.ctx.player;
    if (this.parcelInPocket) {
      const out: Action[] = [];
      if (this.recipient && this.recipient.distTo(x, z) < REACH_PERSON) {
        out.push({ key: "KeyE", text: `give the parcel to ${(this.task as DeliverTask).recipient}`, run: () => this.giveParcel(), at: chest(this.recipient.group) });
      }
      if (this.stranger && !this.strangerDone && this.stranger.distTo(x, z) < 3) {
        out.push({ key: "KeyF", text: `sell the parcel to the stranger (${SELL_PRICE.deliver} c)`, run: () => this.sellParcel(), at: chest(this.stranger.group) });
      }
      return out;
    }
    if (!this.waitingHandover) return [];
    if (this.kind === "deliver") {
      const e = this.ctx.people.get(this.job.employer_npc);
      // M7 night: he is at home asleep; the parcel waits in his box by the door
      const box = this.boxWaiting ? this.ctx.box!.near(x, z, this.job.employer_npc) : null;
      if (box) return [{ key: "KeyF", text: `take the ${this.noun} from ${box.name}'s box`, run: () => this.takeParcel(true), at: this.ctx.box!.target(box) }];
      if (e && e.present && e.distTo(x, z) < REACH_PERSON) {
        return [{ key: "KeyF", text: `take the ${this.noun} from ${e.def.name}`, run: () => this.takeParcel(), at: chest(e.group) }];
      }
    } else if (this.toLower.length && !this.lowering.length && dist2(x, z, SPOTS.ship_gangway.x, SPOTS.ship_gangway.z) < 5) {
      return [{ key: "KeyF", text: "call up to the ship for the cargo", run: () => this.callShip(), at: { x: SPOTS.ship_gangway.x, z: SPOTS.ship_gangway.z } }];
    }
    return [];
  }

  /** M7 night: the deliver's employer is away and has a box: the parcel waits in it. */
  private get boxWaiting(): boolean {
    const b = this.ctx.box;
    return this.kind === "deliver" && this.waitingHandover && !!b && b.has(this.job.employer_npc) && b.away(this.job.employer_npc);
  }

  private takeParcel(fromBox = false): void {
    const e = this.ctx.people.get(this.job.employer_npc)!;
    if (!fromBox) e.lookAt(this.ctx.player.x, this.ctx.player.z);
    if (this.pocketed_) {
      // the parcel goes into your pocket; the server keeps it (pockets are engine state)
      api
        .handover(this.job.id)
        .then((p) => this.ctx.refresh(p))
        .catch((err: Error) => this.ctx.toast(err.message));
    } else {
      this.ctx.goods.receive(this.goods, GOODS[this.goods].hold, { jobId: this.job.id, owner: this.job.employer_npc });
      this.ctx.player.speedFactor = GOODS[this.goods].speed;
    }
    this.waitingHandover = false;
    this.ctx.sfx("lift");
    const line: Record<string, string> = {
      tuur: `Tuur presses the ${this.noun} into your hands. "Don't open it. Don't lose it. Don't talk."`,
      peeters: `The widow counts it out to you. "Signed for. It is on your head now, young man."`,
      sooi: `Sooi shoves it at you. "For ${(this.task as DeliverTask).recipient}. Go."`,
    };
    this.ctx.toast(
      fromBox
        ? `You lift the lid of ${e.def.name}'s box. The ${this.noun} is there, a chalk mark on it for ${(this.task as DeliverTask).recipient}.`
        : (line[this.job.employer_npc] ?? `You take the ${this.noun}.`),
    );
  }

  private giveParcel(): void {
    this.recipient?.face(this.ctx.player.x, this.ctx.player.z);
    this.ctx.toast(`${cap((this.task as DeliverTask).recipient)} takes the parcel, weighs it in one hand, and turns away.`);
    this.delivered++;
    this.changed();
  }

  private sellParcel(): void {
    this.strangerDone = true;
    this.sold++;
    this.ctx.sfx("coins");
    this.ctx.toast("He counts coins into your hand, tucks the parcel under his coat, and is gone in the fog.");
    const s = this.stranger!;
    const { x, z } = this.ctx.player;
    s.walkTo(s.pos.x + (s.pos.x - x) * 8, s.pos.z + (s.pos.z - z) * 8, 1.4);
    this.changed();
  }

  private callShip(): void {
    const s = this.ctx.people.get("sailor");
    this.ctx.toast(`"Ahoy, the kaai!" A sailor leans over the rail and swings the cargo out on a rope.`);
    s?.lookAt(this.ctx.player.x, this.ctx.player.z);
    this.lowerTimer = 0.5;
  }

  // ---- carrying

  carryActions(item: Item): Action[] {
    if (this.ended || !this.isMine(item)) return [];
    const { x, z } = this.ctx.player;
    const out: Action[] = [];
    if (this.recipient && this.recipient.distTo(x, z) < REACH_PERSON) {
      out.push({ key: "KeyE", text: `hand it to ${(this.task as DeliverTask).recipient}`, run: () => this.handIn(item), at: chest(this.recipient.group) });
    }
    if (this.stranger && !this.strangerDone && this.stranger.distTo(x, z) < 3) {
      out.push({ key: "KeyF", text: `sell it to the stranger (${SELL_PRICE[this.kind]} c)`, run: () => this.sell(item), at: chest(this.stranger.group) });
    } else if (item.broken && !this.pocketed) {
      out.push({ key: "KeyF", text: "fill your pockets", run: () => this.pocket(), self: true });
    }
    return out;
  }

  placeLabel(item: Item, x: number, z: number): string | null {
    if (this.kind !== "carry" || !this.isMine(item)) return null;
    const to = SPOTS[this.task.to];
    return dist2(x, z, to.x, to.z) < REACH_DROP ? "set it down here" : null;
  }

  onPlaced(item: Item): void {
    if (this.kind !== "carry" || !this.isMine(item)) return;
    const to = SPOTS[this.task.to];
    if (dist2(item.obj.position.x, item.obj.position.z, to.x, to.z) >= REACH_DROP) return;
    // delivered: it now simply belongs to the employer, lying at their door
    item.jobId = null;
    this.delivered++;
    this.changed();
  }

  /** Lost: into the Schelde, or (M6 handcart) gone with a cart someone wheeled off (`why`: what to say, or "" for nothing). */
  onLost(item: Item, why?: string): void {
    if (!this.isMine(item)) return;
    this.lost++;
    const say = why ?? `The ${this.noun} goes over the edge. The Schelde takes it.`;
    if (say) this.ctx.toast(say);
    this.changed();
  }

  /** M6 handcart: how many of this job's goods are on Jef's cart now. */
  private get onCart(): number {
    return this.ctx.goods.onCart(this.job.id);
  }

  private handIn(item: Item): void {
    this.ctx.goods.release();
    item.obj.removeFromParent();
    this.recipient?.face(this.ctx.player.x, this.ctx.player.z);
    this.ctx.toast(`${cap((this.task as DeliverTask).recipient)} takes it without a word and turns away.`);
    this.delivered++;
    this.changed();
  }

  private sell(item: Item): void {
    this.ctx.goods.release();
    this.strangerDone = true;
    this.sold++;
    this.ctx.sfx("coins");
    this.ctx.toast("He counts coins into your hand and is gone in the fog.");
    const s = this.stranger!;
    s.group.add(item.obj);
    item.obj.position.set(0, 0.9, 0.35);
    const { x, z } = this.ctx.player;
    s.walkTo(s.pos.x + (s.pos.x - x) * 8, s.pos.z + (s.pos.z - z) * 8, 1.4);
    this.changed();
  }

  private pocket(): void {
    this.pocketed = true;
    this.ctx.sfx("coins");
    this.ctx.toast("You fill your coat. Nobody saw. Or did they?");
  }

  /** Called by the controller when one of this job's goods is lifted. */
  onLifted(item: Item): void {
    if (!this.isMine(item)) return;
    if (item.heavy) {
      this.ctx.player.speedFactor = 0.4;
      this.ctx.toast(`This ${this.noun} is far too heavy for one man. You stagger under it.`);
    }
    if (item.broken && !this.brokenSeen) {
      this.brokenSeen = true;
      this.ctx.toast(GOODS[this.goods].broken);
    }
  }

  private changed(): void {
    this.ctx.progress({ delivered: this.delivered, lost: this.lost, sold: this.sold });
    if (this.delivered + this.lost + this.sold >= this.count && !this.ended) {
      this.ended = true;
      this.ctx.finish({ delivered: this.delivered, lost: this.lost, sold: this.sold, pocketed: this.pocketed, late: this.late });
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

    // cargo swung down from the ship's rail, one at a time
    if (this.lowerTimer > 0) {
      this.lowerTimer -= dt;
      if (this.lowerTimer <= 0 && this.toLower.length) {
        const f = this.toLower.shift()!;
        const i = this.count - this.delivered - this.lost - this.sold - this.toLower.length - 1;
        const obj = makeGoods(this.goods, this.ctx.world.mats);
        const from = new THREE.Vector3(SPOTS.ship_gangway.x + 1.5, 3.4, -2.6);
        obj.position.copy(from);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), this.ctx.world.mats.rope);
        this.ctx.world.scene.add(obj, rope);
        this.lowering.push({ obj, rope, from, to: slot("ship_gangway", i), t: 0, ...f });
        if (this.toLower.length) this.lowerTimer = 2.2;
      }
    }
    for (const l of this.lowering) {
      l.t += dt;
      const k = Math.min(1, l.t / 2);
      const [tx, tz] = l.to;
      const px = THREE.MathUtils.lerp(l.from.x, tx, Math.min(1, k * 1.6));
      const pz = THREE.MathUtils.lerp(l.from.z, tz, Math.min(1, k * 1.6));
      const py = THREE.MathUtils.lerp(l.from.y, 0, k * k);
      l.obj.position.set(px, py, pz);
      const top = new THREE.Vector3(px, 5.5, THREE.MathUtils.lerp(-2.8, pz, 0.3));
      l.rope.position.copy(top).add(l.obj.position).multiplyScalar(0.5);
      l.rope.scale.y = top.distanceTo(l.obj.position);
      l.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(l.obj.position).normalize());
      if (k >= 1) {
        this.ctx.world.scene.remove(l.obj, l.rope);
        this.ctx.goods.spawn(this.goods, tx, tz, { jobId: this.job.id, owner: this.job.employer_npc, broken: l.broken, heavy: l.heavy });
        this.ctx.sfx(`thud_${GOODS[this.goods].thud}`, new THREE.Vector3(tx, 0, tz));
      }
    }
    this.lowering = this.lowering.filter((l) => l.t < 2);
    if (this.waitingHandover && this.kind === "carry" && !this.toLower.length && !this.lowering.length) this.waitingHandover = false;
  }

  goal(): THREE.Vector3 | null {
    if (this.ended) return null;
    const to = SPOTS[this.task.to];
    const carried = this.ctx.goods.carried;
    const lying = this.ctx.goods.items.some((it) => this.isMine(it));
    if ((carried && this.isMine(carried)) || this.parcelInPocket || (this.onCart > 0 && !lying))
      return this.recipient ? this.recipient.pos.clone() : new THREE.Vector3(to.x, 0, to.z);
    if (this.waitingHandover) {
      const box = this.boxWaiting ? this.ctx.box!.get(this.job.employer_npc) : null;
      if (box) return new THREE.Vector3(box.x, 0.6, box.z);
      if (this.kind === "deliver") return this.ctx.people.get(this.job.employer_npc)?.pos.clone() ?? null;
      return new THREE.Vector3(SPOTS.ship_gangway.x, 0, SPOTS.ship_gangway.z);
    }
    const { x, z } = this.ctx.player;
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const it of this.ctx.goods.items) {
      if (!this.isMine(it)) continue;
      const d = dist2(x, z, it.obj.position.x, it.obj.position.z);
      if (d < bestD) {
        bestD = d;
        best = new THREE.Vector3(it.obj.position.x, it.y, it.obj.position.z);
      }
    }
    return best;
  }

  hud(): string {
    const to = SPOTS[this.task.to];
    const from = SPOTS[this.task.from];
    const carried = this.ctx.goods.carried;
    const mine = (carried && this.isMine(carried)) || this.parcelInPocket || (this.onCart > 0 && !this.ctx.goods.items.some((it) => this.isMine(it)));
    const employer = this.ctx.people.get(this.job.employer_npc)?.def.name ?? this.job.employer_name;
    const step = mine
      ? this.kind === "deliver"
        ? `Bring it to ${esc((this.task as DeliverTask).recipient)} at ${esc(to.label)}`
        : `Bring it to ${esc(to.label)}`
      : this.waitingHandover
        ? this.kind === "deliver"
          ? this.boxWaiting
            ? `Get the ${esc(this.noun)} from ${esc(employer)}'s box`
            : `Get the ${esc(this.noun)} from ${esc(employer)}`
          : "Ask the ship for the cargo at the gangway"
        : (this.task as CarryTask).cart
          ? `Load the ${esc(this.noun)} on the handcart at ${esc(from.label)}`
          : `Fetch the ${esc(this.noun)} at ${esc(from.label)}`;
    const count =
      this.kind === "carry"
        ? `<br>${this.delivered} / ${this.count} delivered${this.onCart ? `, ${this.onCart} on the cart` : ""}${this.lost ? `, ${this.lost} lost` : ""}${this.sold ? `, ${this.sold} sold` : ""}`
        : "";
    const time = this.task.limit_s ? `<br>${this.late ? "Late" : `The bell in ${bellIn(this.task.limit_s - this.t)}`}` : "";
    return `<b>${esc(this.job.title)}</b><br>${step}${count}${time}`;
  }

  snapshot(): Record<string, unknown> {
    return { t: this.t, late: this.late, pocketed: this.pocketed, brokenSeen: this.brokenSeen, strangerDone: this.strangerDone, waitingHandover: this.waitingHandover, toLower: this.toLower.length };
  }

  restore(s: Record<string, unknown>): void {
    const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    this.t = Math.max(0, n(s.t, this.t));
    this.late = s.late === true;
    this.pocketed = s.pocketed === true;
    this.brokenSeen = s.brokenSeen === true;
    if (s.strangerDone === true && !this.strangerDone) {
      this.strangerDone = true;
      if (this.stranger && !this.stranger.gone) this.stranger.remove();
    }
    // the cargo already swung down from the ship (or the parcel taken) stays that way
    if (s.waitingHandover === false) this.waitingHandover = false;
    const lower = Math.max(0, Math.floor(n(s.toLower, this.toLower.length)));
    if (lower < this.toLower.length) this.toLower = this.toLower.slice(this.toLower.length - lower);
  }

  dispose(): void {
    const { world, goods } = this.ctx;
    goods.clearJob(this.job.id);
    world.scene.remove(this.mark);
    for (const l of this.lowering) world.scene.remove(l.obj, l.rope);
    for (const f of [this.stranger, this.foreman, this.recipient]) if (f && !f.gone) f.remove();
    world.setThickFog(false);
  }
}

// ------------------------------------------------------------------ watch

/** Stand guard at a post until the bell. Things come out of the fog. */
export class WatchRun implements Run {
  private pile: Item[] = [];
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
      this.pile.push(ctx.goods.spawn(task.goods, x, z, { jobId: job.id, owner: job.employer_npc, rot: i * 0.4 }));
    }
    if (task.twist === "thick_fog") ctx.world.setThickFog(true);
    ctx.toast(`Stand by the ${task.goods} at ${this.post.label} until the bell.`);
  }

  private near(): boolean {
    return dist2(this.ctx.player.x, this.ctx.player.z, this.post.x, this.post.z) < 7;
  }

  /** A free spot on land about d m from the post; nearer in when none is free that far (never on the water). */
  private outInFog(d: number, awayFrom?: { x: number; z: number }): [number, number] {
    const { world } = this.ctx;
    for (let dd = d; dd >= 4; dd *= 0.7) {
      let best: [number, number] | null = null;
      let bestD = -1;
      for (let a = Math.random() * Math.PI * 2, i = 0; i < 16; i++, a += 0.7) {
        const x = this.post.x + Math.cos(a) * dd;
        const z = this.post.z + Math.sin(a) * dd;
        if (!world.isFree(x, z, 0.5) || world.isWater(x, z)) continue;
        if (!awayFrom) return [x, z];
        // fixes 2026-09-24: the bolt goes to the free spot furthest from Jef, not to a point over the river
        const far = Math.hypot(x - awayFrom.x, z - awayFrom.z);
        if (far > bestD) (best = [x, z]), (bestD = far);
      }
      if (best) return best;
    }
    return [this.post.x, this.post.z];
  }

  actions(): Action[] {
    if (this.ended) return [];
    const { x, z } = this.ctx.player;
    const out: Action[] = [];
    if (this.thief && this.thiefState === "coming" && this.thief.distTo(x, z) < 10) {
      out.push({ key: "KeyE", text: "shout at him", run: () => this.chase(), at: chest(this.thief.group), cone: 50 });
    }
    if (this.briber && this.briberState === "waiting" && this.briber.distTo(x, z) < 3) {
      out.push({ key: "KeyF", text: "take his coin and look away (50 c)", run: () => this.takeBribe(), at: chest(this.briber.group) });
      out.push({ key: "KeyE", text: "send him off", run: () => this.sendOff(), at: chest(this.briber.group) });
    }
    return out;
  }

  carryActions(): Action[] {
    return this.actions();
  }
  placeLabel(): string | null {
    return null;
  }
  onPlaced(): void {}
  onLost(): void {}

  private chase(): void {
    if (!this.thief || this.thiefState !== "coming") return;
    this.thiefState = "chased";
    const { x, z } = this.ctx.player;
    const [ox, oz] = this.outInFog(30, { x, z });
    this.thief.walkTo(ox, oz, 3.2);
    this.ctx.toast("He bolts into the fog. You hear him run, then nothing.");
  }

  /** Someone walks off with the top item of the pile. */
  private takePileItem(by: Figure): void {
    const goods = this.ctx.goods;
    const it = [...this.pile].reverse().find((p) => goods.items.includes(p) && !goods.above(p));
    if (!it) return;
    this.pile = this.pile.filter((p) => p !== it);
    goods.remove(it);
    by.group.add(it.obj);
    it.obj.position.set(0, 0.9, 0.35);
  }

  private takeBribe(): void {
    this.bribeTaken = true;
    this.briberState = "paid";
    this.ctx.sfx("coins");
    this.ctx.toast("Coins, warm from his hand. You turn to look at the water.");
    this.briber!.walkTo(this.post.x, this.post.z, 1.1);
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
        if (b.distTo(x, z) < 2) {
          b.stop();
          b.face(x, z);
          this.briberState = "waiting";
          this.ctx.toast(`"${hello(this.ctx.hour?.() ?? 20)}, lad. Cold work. What if you looked at the river a while?"`);
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
      this.ctx.finish({ left_post_s: Math.round(this.away), thief, bribe_taken: this.bribeTaken, seen_away: this.seenAway });
    }
  }

  goal(): THREE.Vector3 | null {
    if (this.ended) return null;
    if (!this.near()) return new THREE.Vector3(this.post.x, 0, this.post.z);
    if (this.thief && this.thiefState === "coming") return this.thief.pos.clone();
    return null;
  }

  hud(): string {
    const status = this.near() ? `The bell in ${bellIn(this.task.duration_s - this.t)}` : "Back to your post!";
    return `<b>${esc(this.job.title)}</b><br>Stand watch at ${esc(this.post.label)}<br>${status}`;
  }

  snapshot(): Record<string, unknown> {
    const done = <T extends string>(st: T, over: readonly T[]) => (over.includes(st) ? st : "none");
    return {
      t: this.t,
      away: this.away,
      pile: this.pile.length,
      thiefState: done(this.thiefState, ["chased", "stole"] as const),
      briberState: done(this.briberState, ["paid", "sent"] as const),
      bribeTaken: this.bribeTaken,
      foremanState: done(this.foremanState, ["looking", "leaving"] as const),
      seenAway: this.seenAway,
    };
  }

  restore(s: Record<string, unknown>): void {
    const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    this.t = Math.max(0, n(s.t, this.t));
    this.away = Math.max(0, n(s.away, this.away));
    this.bribeTaken = s.bribeTaken === true;
    this.seenAway = s.seenAway === true;
    // what already happened happened: no second thief, briber or foreman (their figures are gone)
    if (s.thiefState === "chased" || s.thiefState === "stole") this.thiefState = s.thiefState;
    if (s.briberState === "paid" || s.briberState === "sent") this.briberState = "sent";
    if (s.foremanState === "looking" || s.foremanState === "leaving") this.foremanState = "leaving";
    // goods taken from the pile stay taken
    const left = Math.max(0, Math.floor(n(s.pile, this.pile.length)));
    while (this.pile.length > left) {
      const it = this.pile.pop()!;
      this.ctx.goods.remove(it);
    }
  }

  dispose(): void {
    // the goods stay; they are the employer's, no longer part of a job
    for (const it of this.pile) it.jobId = null;
    for (const f of [this.thief, this.briber, this.foreman]) if (f && !f.gone) f.remove();
    this.ctx.world.setThickFog(false);
  }
}

/** M6: other kinds of job register how they play (game/press.ts: the letters round). */
export const RUN_MAKERS: Record<string, (job: Job, ctx: RunCtx) => Run> = {};

export function makeRun(job: Job, ctx: RunCtx): Run | null {
  const t = job.task;
  if (!t) return null;
  const maker = RUN_MAKERS[t.kind];
  if (maker) return maker(job, ctx);
  if (t.kind === "letters") return null;
  if (t.kind === "watch") return new WatchRun(job, t, ctx);
  return new HaulRun(job, t, ctx);
}
