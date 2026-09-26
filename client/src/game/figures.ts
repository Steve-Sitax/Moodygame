import * as THREE from "three";
import { psx } from "../retro/psx";
import { Human, makeHuman, whenHumans, type HumanKind } from "./humans";

// People in the fog for job twists: a stranger, a thief, a foreman, the
// person you deliver to. Rigged models from people.glb (humans.ts); a grey-box
// silhouette (coat, head, hat) stands in until they load, or if they fail.

export type FigureKind = "stranger" | "thief" | "foreman" | "recipient";

const MODEL: Record<FigureKind, HumanKind> = {
  stranger: "stranger",
  thief: "thief",
  foreman: "foreman",
  recipient: "recipient",
};

const COAT: Record<FigureKind, number> = {
  stranger: 0x2a2c30,
  thief: 0x161616,
  foreman: 0x4a3a2a,
  recipient: 0x2e3440,
};

const mats = new Map<number, THREE.Material>();
const mat = (c: number) => {
  let m = mats.get(c);
  if (!m) mats.set(c, (m = psx(new THREE.MeshLambertMaterial({ color: c }))));
  return m;
};

function greyBox(kind: FigureKind): THREE.Group {
  const g = new THREE.Group();
  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 1.3, 6), mat(COAT[kind]));
  coat.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), mat(0x6a5a4c));
  head.position.y = 1.5;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 8), mat(0x121212));
  brim.position.y = 1.6;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, kind === "foreman" ? 0.08 : 0.14, 8), mat(0x121212));
  crown.position.y = 1.67;
  g.add(coat, head, brim, crown);
  return g;
}

/**
 * Fixes 2026-09-24 (Steve: the watch job's thief "walked in the air above the water"): the figures
 * walked straight lines to any point, and the thief's bolt went to a point never checked. main.ts sets
 * this: `path` is the crowd's walk grid round Jef (A*, water and walls shut), `water` the open water.
 * A figure on the ground now follows the grid, and never takes a step onto water whatever it is told.
 */
export const figureNav: {
  path: ((ax: number, az: number, bx: number, bz: number) => Array<{ x: number; z: number }> | null) | null;
  water: ((x: number, z: number) => boolean) | null;
} = { path: null, water: null };

/** M7 walk-up: every made figure alive now (dev/popcheck.ts watches where they first show). */
export const LIVE_FIGURES = new Set<Figure>();

export class Figure {
  readonly group = new THREE.Group();
  /** M7 walk-up: how it came into the street ("walked in", "placed unseen", "crate", "dev", ...), for the popcheck. */
  origin = "made";
  /** M7 walk-up (JobFigure): a made figure is nobody of the town. */
  readonly who: string | null = null;
  motion: "idle" | "fold" | "talk" = "idle";
  readonly pos: THREE.Vector3;
  private target: THREE.Vector3 | null = null;
  /** The waypoints still to walk after `target` (the grid's corners). */
  private ahead: THREE.Vector3[] = [];
  private speed = 1;
  private phase = Math.random() * 10;
  private facing = 0;
  /** The body: a model, or the grey box. Anything else in `group` is being carried. */
  private body: THREE.Object3D;
  private human: Human | null = null;
  gone = false;

  constructor(
    readonly kind: FigureKind,
    x: number,
    z: number,
    private readonly scene: THREE.Scene,
    /** Height they stand at (the mate stands on the ship's deck: M6 tides, give a function, it moves). */
    private readonly baseY: number | (() => number) = 0,
  ) {
    this.pos = new THREE.Vector3(x, typeof baseY === "function" ? baseY() : baseY, z);
    this.human = makeHuman(MODEL[kind]);
    this.body = this.human ? this.human.root : greyBox(kind);
    this.group.add(this.body);
    if (!this.human) {
      whenHumans(() => {
        if (this.gone || this.human) return;
        const h = makeHuman(MODEL[kind]);
        if (!h) return;
        this.group.remove(this.body);
        this.human = h;
        this.body = h.root;
        this.group.add(h.root);
      });
    }
    this.group.position.copy(this.pos);
    scene.add(this.group);
    LIVE_FIGURES.add(this);
  }

  /** M7 walk-up (JobFigure): a made figure is in the street while it lives. */
  get present(): boolean {
    return !this.gone;
  }

  /** Carry a thing (a crate from the pile, a parcel bought). */
  hold(obj: THREE.Object3D): void {
    this.group.add(obj);
    obj.position.set(0, 0.9, 0.35);
  }

  walkTo(x: number, z: number, speed: number): void {
    this.speed = speed;
    this.ahead = [];
    // on a deck (a moving height) the figure keeps its straight line: the grid is the quay's
    const onGround = typeof this.baseY === "number";
    const water = figureNav.water;
    // a goal on the water is pulled back towards the figure until it is on land
    if (onGround && water?.(x, z)) {
      const fx = this.pos.x;
      const fz = this.pos.z;
      let k = 1;
      while (k > 0 && water(fx + (x - fx) * k, fz + (z - fz) * k)) k -= 0.05;
      x = fx + (x - fx) * Math.max(0, k);
      z = fz + (z - fz) * Math.max(0, k);
    }
    const way = onGround ? figureNav.path?.(this.pos.x, this.pos.z, x, z) : null;
    if (way && way.length) {
      const pts = way.map((p) => new THREE.Vector3(p.x, 0, p.z));
      // the grid ends at the nearest open cell: finish on the asked point when that is land
      const last = pts[pts.length - 1];
      if (Math.hypot(last.x - x, last.z - z) > 0.3 && !water?.(x, z)) pts.push(new THREE.Vector3(x, 0, z));
      this.target = pts.shift()!;
      this.ahead = pts;
    } else this.target = new THREE.Vector3(x, 0, z);
  }

  stop(): void {
    this.target = null;
    this.ahead = [];
  }

  get moving(): boolean {
    return this.target !== null;
  }

  face(x: number, z: number): void {
    this.facing = Math.atan2(x - this.pos.x, z - this.pos.z);
  }

  distTo(x: number, z: number): number {
    return Math.hypot(this.pos.x - x, this.pos.z - z);
  }

  update(dt: number): void {
    if (this.target) {
      const d = this.target.clone().sub(this.pos);
      const len = d.length();
      if (len < 0.05) this.target = this.ahead.shift() ?? null;
      else {
        const step = Math.min(len, this.speed * dt);
        const dir = d.normalize();
        const nx = this.pos.x + dir.x * step;
        const nz = this.pos.z + dir.z * step;
        // never a step onto open water (from land): the walk ends here instead
        if (typeof this.baseY === "number" && figureNav.water?.(nx, nz) && !figureNav.water(this.pos.x, this.pos.z)) this.stop();
        else {
          this.pos.x = nx;
          this.pos.z = nz;
          this.facing = Math.atan2(dir.x, dir.z);
          this.phase += dt * this.speed * 4.5;
        }
      }
    }
    let y = typeof this.baseY === "function" ? this.baseY() : this.baseY;
    if (this.human) {
      const h = this.human;
      const carrying = this.group.children.length > 1;
      if (this.target) {
        h.play(carrying ? "carry" : "walk", 0.2);
        h.setPace(this.speed);
      } else h.play(this.kind === "foreman" || this.motion === "fold" ? "fold" : this.motion === "talk" ? "talk" : "idle", 0.35);
      h.update(dt);
      y += h.bob();
    } else y += Math.abs(Math.sin(this.phase)) * 0.03;
    this.group.position.set(this.pos.x, y, this.pos.z);
    this.group.rotation.y = this.facing;
  }

  remove(): void {
    this.gone = true;
    LIVE_FIGURES.delete(this);
    this.scene.remove(this.group);
    this.human?.dispose();
  }
}
