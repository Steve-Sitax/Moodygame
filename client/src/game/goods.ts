import * as THREE from "three";
import type { World } from "../world/rijnkaai";
import { rectAround, type Rect } from "../world/geom";
import type { FirstPerson } from "../player/firstPerson";
import { GOODS, makeGoods, type Goods } from "./props";
import { pick, type Target } from "./facing";

// Every liftable thing on the quay (M3): job goods and goods that belong to
// someone. Goods rest on the ground or on top of other goods; you can lift
// the top one, set it down anywhere, and stack up to three.

export interface Item {
  obj: THREE.Object3D;
  kind: Goods;
  /** Who it belongs to (an NPC id), if anyone. */
  owner: string | null;
  /** The job it is part of, while that job runs. */
  jobId: number | null;
  rect: Rect | null;
  /** Height of its base. */
  y: number;
  /** What it rests on. */
  below: Item | null;
  broken?: boolean;
  heavy?: boolean;
  /** Where it was when lifted, to see if it was put back. */
  liftedFrom?: { x: number; z: number; t: number };
}

const MAX_STACK = 3;
const FOOT = 0.33;

export class GoodsWorld {
  items: Item[] = [];
  carried: Item | null = null;
  /** M6 handcart: how many of a job's goods lie on Jef's carts now (game/handcart.ts sets it). */
  onCart: (jobId: number) => number = () => 0;

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
  ) {}

  private top(it: Item): number {
    return it.y + GOODS[it.kind].h;
  }

  private stackHeight(it: Item): number {
    let n = 1;
    for (let b = it.below; b; b = b.below) n++;
    return n;
  }

  /** The item sitting right on top of this one, if any. */
  above(it: Item): Item | undefined {
    return this.items.find((o) => o.below === it);
  }

  /** Top-most item whose footprint covers (x, z). */
  topAt(x: number, z: number, reach = 0.55): Item | null {
    let best: Item | null = null;
    for (const it of this.items) {
      if (Math.hypot(it.obj.position.x - x, it.obj.position.z - z) > reach) continue;
      if (this.above(it)) continue;
      if (!best || it.y > best.y) best = it;
    }
    return best;
  }

  spawn(kind: Goods, x: number, z: number, opts: Partial<Pick<Item, "owner" | "jobId" | "broken" | "heavy">> & { rot?: number } = {}): Item {
    const it: Item = {
      obj: makeGoods(kind, this.world.mats),
      kind,
      owner: opts.owner ?? null,
      jobId: opts.jobId ?? null,
      rect: null,
      y: 0,
      below: null,
      broken: opts.broken,
      heavy: opts.heavy,
    };
    this.rest(it, x, z, opts.rot ?? Math.random() * 0.4);
    return it;
  }

  /** Put an item down at (x, z): on the stack there, or on the ground. */
  private rest(it: Item, x: number, z: number, rot: number): void {
    const under = this.topAt(x, z);
    if (under && this.stackHeight(under) < MAX_STACK) {
      it.below = under;
      it.y = this.top(under);
      x = under.obj.position.x;
      z = under.obj.position.z;
    } else {
      it.below = null;
      it.y = 0;
    }
    it.obj.position.set(x, it.y, z);
    it.obj.rotation.set(0, rot, 0);
    this.world.scene.add(it.obj);
    it.rect = rectAround(x, z, FOOT, FOOT, this.top(it));
    this.world.addCollider(it.rect);
    this.items.push(it);
  }

  /** Can an item be set down at (x, z)? On free ground, or on a stack that has room. */
  canPlace(x: number, z: number): "ground" | "stack" | null {
    if (this.world.baseAt(x, z) > 0.05) return null; // not on the gangway or the deck
    const under = this.topAt(x, z);
    if (under) return this.stackHeight(under) < MAX_STACK ? "stack" : null;
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

  lift(it: Item, hold: [number, number, number]): void {
    this.items = this.items.filter((i) => i !== it);
    if (it.rect) this.world.removeCollider(it.rect);
    it.rect = null;
    it.liftedFrom = { x: it.obj.position.x, z: it.obj.position.z, t: performance.now() };
    it.below = null;
    this.world.scene.remove(it.obj);
    it.obj.position.set(...hold);
    it.obj.rotation.set(0.05, 0.08, 0);
    this.player.camera.add(it.obj);
    this.carried = it;
    this.player.laden = true;
  }

  /** Take the carried item out of your hands (it is not placed anywhere yet). */
  release(): Item | null {
    const it = this.carried;
    if (!it) return null;
    this.player.camera.remove(it.obj);
    this.carried = null;
    this.player.laden = false;
    this.player.speedFactor = 1;
    return it;
  }

  /** Set the carried item down at (x, z). */
  putDown(x: number, z: number): Item | null {
    const it = this.release();
    if (!it) return null;
    this.rest(it, x, z, Math.random() * 0.4);
    return it;
  }

  /** Take an item out of the world for good (delivered to a person, sunk, sold). */
  remove(it: Item): void {
    this.items = this.items.filter((i) => i !== it);
    if (it.rect) this.world.removeCollider(it.rect);
    for (const o of this.items) if (o.below === it) o.below = null; // cannot happen for a top item
    this.world.scene.remove(it.obj);
  }

  /** Give a new item straight into your hands (a handover). */
  receive(kind: Goods, hold: [number, number, number], opts: Partial<Pick<Item, "owner" | "jobId">> = {}): Item {
    const it: Item = { obj: makeGoods(kind, this.world.mats), kind, owner: opts.owner ?? null, jobId: opts.jobId ?? null, rect: null, y: 0, below: null };
    it.obj.position.set(...hold);
    this.player.camera.add(it.obj);
    this.carried = it;
    this.player.laden = true;
    return it;
  }

  /** Drop all items of a job that are still lying about (job over). */
  clearJob(jobId: number): void {
    for (const it of [...this.items]) if (it.jobId === jobId && !this.above(it)) this.remove(it);
    for (const it of [...this.items]) if (it.jobId === jobId) this.remove(it);
    if (this.carried?.jobId === jobId) {
      this.release();
    }
  }
}

/** Point about d metres in front of the player, on the ground. */
export function ahead(player: FirstPerson, d: number): [number, number] {
  return [player.x - Math.sin(player.yaw) * d, player.z - Math.cos(player.yaw) * d];
}

export const worldPos = (it: Item) => new THREE.Vector3(it.obj.position.x, it.y, it.obj.position.z);
