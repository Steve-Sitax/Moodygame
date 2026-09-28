import * as THREE from "three";
import type { Job, JobsPayload, LampsTask } from "../net/api";
import type { World } from "../world/rijnkaai";
import { psx } from "../retro/psx";
import { hhmm } from "../../../server/src/town/lampround";
import { esc, RUN_MAKERS, type Action, type Run, type RunCtx } from "./runs";

// The lamplighter's help on the client (2026-09-28; server town/lampjob.ts): the last lamps of a lamplighter's
// round for one evening. His spare pole leans against the first lamp (E takes it: Jef carries it upright in his
// right hand); at a lamp's foot, from the round's dusk, E raises the pole into the lantern, the gas catches and
// the pole comes down again. The server checks each lamp (the hour, the place, the pole) and counts them; the
// lamp burns for everyone once it has said yes (the help rides on the payload: game/lamplighter.ts). All lit:
// the job is reported and paid by the server's count. At the deadline the job ends with what is lit.

/** How near the lamp's foot (or its post) E is offered. */
const REACH = 2.2;
const REACH_POST = 2.6;
/** The pole: its length (the lantern's bottom at about 3.3 m, the hand at 1.1 m), and where the hand holds it. */
const POLE_LEN = 2.5;
/** The pole up into the lantern, held while the gas catches, and down again (real seconds). */
const UP_S = 0.9;
const HOLD_S = 0.7;
const DOWN_S = 0.7;

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let mats: { wood: THREE.Material; brass: THREE.Material; flame: THREE.Material } | null = null;

/** The lamplighter's pole along +Y from its foot: a thin ash staff, a brass hook and wick at the top, the small flame. */
function makePole(): { root: THREE.Group; flame: THREE.Mesh } {
  // (the same materials as the lamplighters' own poles in wardrobe.ts: no new shader kind)
  mats ??= {
    wood: psx(new THREE.MeshLambertMaterial({ color: 0x5a3a20 })),
    brass: psx(new THREE.MeshLambertMaterial({ color: 0xb8923a })),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc860 }),
  };
  const root = new THREE.Group();
  root.name = "lamp_pole";
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.021, POLE_LEN, 6), mats.wood);
  staff.position.y = POLE_LEN / 2;
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.09, 6), mats.brass);
  ferrule.position.y = POLE_LEN - 0.05;
  // the hook that turns the lantern's tap, to one side of the wick
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.012), mats.brass);
  hook.position.set(0.035, POLE_LEN + 0.02, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.012), mats.brass);
  arm.position.set(0.018, POLE_LEN - 0.03, 0);
  const flame = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), mats.flame);
  flame.position.y = POLE_LEN + 0.03;
  root.add(staff, ferrule, hook, arm, flame);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.raycast = () => {};
  });
  return { root, flame };
}

const Y = new THREE.Vector3(0, 1, 0);

/** Put the pole's foot at `base`, its length toward `to`. */
function aimPole(root: THREE.Object3D, base: THREE.Vector3, to: THREE.Vector3): void {
  const d = to.clone().sub(base);
  if (d.lengthSq() < 1e-6) d.copy(Y);
  root.position.copy(base);
  root.quaternion.setFromUnitVectors(Y, d.normalize());
}

export class LampJob {
  /** Set by main: the game's hour with its fraction, and the glass of a lamp (its height). */
  hour: () => number = () => 12;

  constructor(private readonly world: World) {
    RUN_MAKERS.lamps = (job, ctx) => new LampsRun(job, job.task as LampsTask, ctx, this);
  }

  /** The height of a lamp's glass (world y), 3.65 m over the street where the town does not say. */
  glassY(id: string): number {
    return this.world.gasLamps.glassY(id) ?? 3.65;
  }

  get scene(): THREE.Scene {
    return this.world.scene;
  }
}

class LampsRun implements Run {
  private busy = false;
  private finished = false;
  /** The pole going up to lamp k: its time, and whether the server has been asked. */
  private lift: { k: number; t: number; asked: boolean } | null = null;
  private readonly pole = makePole();
  /** The spare pole leaning on the first lamp's post, until he takes it. */
  private readonly leaning = makePole();
  private readonly who: string;
  private told = false;
  private readonly v = { base: new THREE.Vector3(), tip: new THREE.Vector3(), glass: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3() };

  constructor(
    private readonly job: Job,
    private task: LampsTask,
    private readonly ctx: RunCtx,
    private readonly lj: LampJob,
  ) {
    this.who = job.employer_name.split(" ")[0];
    lj.scene.add(this.pole.root, this.leaning.root);
    // the spare pole against the first lamp's post, its foot on the lamp's foot side
    const l = task.lamps[0];
    const dx = l.sx - l.x;
    const dz = l.sz - l.z;
    const d = Math.hypot(dx, dz) || 1;
    const gy = lj.glassY(l.id) - 3.65;
    // (its foot 0.7 m out, its top resting on the post, 6 cm from the post's middle: the post is about 5 cm thick there)
    const out = 0.7 - 0.06;
    aimPole(this.leaning.root, new THREE.Vector3(l.x + (dx / d) * 0.7, gy, l.z + (dz / d) * 0.7), new THREE.Vector3(l.x + (dx / d) * 0.06, gy + Math.sqrt(POLE_LEN * POLE_LEN - out * out), l.z + (dz / d) * 0.06));
    this.leaning.flame.visible = false;
    this.sync();
    if (!task.picked) ctx.toast(`${this.who}'s spare pole leans on the first of his last ${task.lamps.length} lamps. Light them from ${hhmm(task.open)}, all by ${hhmm(task.until)}.`);
    if (this.left() === 0) this.finish();
  }

  private left(): number {
    return this.task.lamps.filter((l) => !l.done).length;
  }

  /** The next lamp to light: the first not lit, in the round's order. */
  private next(): number {
    return this.task.lamps.findIndex((l) => !l.done);
  }

  private sync(): void {
    this.leaning.root.visible = !this.task.picked;
    this.pole.root.visible = !!this.task.picked && !this.finished;
  }

  update(dt: number): void {
    if (this.finished) return;
    const h = this.lj.hour();
    // the deadline: the lamplighter lights the rest himself; the server pays for the lamps lit
    if (h >= this.task.until && !this.busy && !this.lift) {
      this.ctx.toast(`It is past ${hhmm(this.task.until)}. ${this.who} lights the rest himself.`);
      this.finish();
      return;
    }
    if (!this.told && this.task.picked && h >= this.task.open && this.left()) {
      this.told = true;
      this.ctx.toast(`The light is going. Time to light the lamps: all ${this.left() === 1 ? "one" : this.left()} by ${hhmm(this.task.until)}.`);
    }
    this.pose(dt, h);
  }

  /** The pole in his hand: upright at his right side, or going up into a lantern. */
  private pose(dt: number, h: number): void {
    if (!this.pole.root.visible) return;
    const cam = this.ctx.player.camera;
    const { base, tip, glass, fwd, right } = this.v;
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    right.crossVectors(fwd, Y).normalize();
    cam.getWorldPosition(base);
    base.addScaledVector(right, 0.36).addScaledVector(fwd, 0.42);
    base.y -= 0.58;
    // carried: nearly upright in the right hand, the top a little forward and out
    tip.copy(base).addScaledVector(fwd, 0.18).addScaledVector(right, 0.06).add(Y);
    this.pole.flame.visible = h >= this.task.open - 0.25;
    const lift = this.lift;
    if (lift) {
      lift.t += dt;
      const l = this.task.lamps[lift.k];
      glass.set(l.x, this.lj.glassY(l.id) - 0.35, l.z);
      const up = lift.t < UP_S ? THREE.MathUtils.smoothstep(lift.t, 0, UP_S) : lift.t < UP_S + HOLD_S ? 1 : 1 - THREE.MathUtils.smoothstep(lift.t, UP_S + HOLD_S, UP_S + HOLD_S + DOWN_S);
      // the tip from beside him up into the lantern's foot (the pole keeps its length: the hand is where it holds)
      const dir = glass.clone().sub(base);
      const reach = dir.length();
      dir.normalize();
      const carry = tip.clone().sub(base).normalize();
      carry.lerp(dir, up).normalize();
      tip.copy(base).addScaledVector(carry, Math.min(POLE_LEN, reach));
      // the gas catches with the pole in the lantern: the server says yes (or why not)
      if (!lift.asked && lift.t >= UP_S) {
        lift.asked = true;
        void this.light(lift.k);
      }
      if (lift.t >= UP_S + HOLD_S + DOWN_S) this.lift = null;
    }
    aimPole(this.pole.root, base, tip);
  }

  actions(): Action[] {
    // (the pole on its way down: the next lamp may be asked for already)
    if (this.busy || this.finished || (this.lift && this.lift.t < UP_S + HOLD_S)) return [];
    const { x, z } = this.ctx.player;
    const t = this.task;
    if (!t.picked) {
      if (dist(x, z, t.pole.x, t.pole.z) < REACH + 0.6) return [{ key: "KeyE", text: `take ${this.who}'s spare pole`, run: () => void this.takePole(), at: { x: t.lamps[0].x, z: t.lamps[0].z, y: 1.2 } }];
      return [];
    }
    // the nearest lamp of his not lit, within reach of its foot or its post
    let best = -1;
    let bestD = Infinity;
    t.lamps.forEach((l, k) => {
      if (l.done) return;
      const d = Math.min(dist(x, z, l.sx, l.sz), dist(x, z, l.x, l.z) - (REACH_POST - REACH));
      if (d < REACH && d < bestD) {
        best = k;
        bestD = d;
      }
    });
    if (best < 0) return [];
    const l = t.lamps[best];
    const h = this.lj.hour();
    const early = h < t.open;
    return [
      {
        key: "KeyE",
        text: early ? `light the lamp (not before ${hhmm(t.open)})` : "light the lamp",
        run: () => {
          if (this.lj.hour() < this.task.open) {
            this.ctx.toast(`Too early: the lamps are lit from ${hhmm(this.task.open)}, when the light goes.`);
            return;
          }
          this.lift = { k: best, t: 0, asked: false };
        },
        at: { x: l.x, z: l.z, y: 2.4 },
      },
    ];
  }

  private async takePole(): Promise<void> {
    this.busy = true;
    try {
      const r = await call<JobsPayload & { text: string }>("POST", "/api/lamps/pole", { job: this.job.id, x: this.ctx.player.x, z: this.ctx.player.z });
      this.apply(r);
      this.ctx.sfx("lift");
      this.ctx.toast(r.text);
    } catch (e) {
      this.ctx.toast(cap((e as Error).message) + ".");
    } finally {
      this.busy = false;
    }
  }

  private async light(k: number): Promise<void> {
    this.busy = true;
    try {
      const r = await call<JobsPayload & { text: string; left: number }>("POST", "/api/lamps/light", { job: this.job.id, lamp: this.task.lamps[k].id, x: this.ctx.player.x, z: this.ctx.player.z });
      this.apply(r);
      this.ctx.toast(r.text);
      if (this.left() === 0) this.finish();
    } catch (e) {
      this.ctx.toast(cap((e as Error).message) + ".");
    } finally {
      this.busy = false;
    }
  }

  /** The server's word: the payload (the lamps lit for everyone), and this job's lamps. */
  private apply(r: JobsPayload): void {
    // (this job's lamps first: the task card is drawn again with the payload)
    const j = r.jobs.find((x) => x.id === this.job.id);
    if (j?.task?.kind === "lamps") this.task = j.task;
    this.sync();
    this.ctx.refresh(r);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.sync();
    this.ctx.finish({ delivered: this.task.lamps.filter((l) => l.done).length });
  }

  carryActions(): Action[] {
    return [];
  }
  placeLabel(): string | null {
    return null;
  }
  onPlaced(): void {}
  onLost(): void {}

  goal(): THREE.Vector3 | null {
    if (this.finished) return null;
    if (!this.task.picked) return new THREE.Vector3(this.task.pole.x, 0, this.task.pole.z);
    const k = this.next();
    if (k < 0) return null;
    const l = this.task.lamps[k];
    return new THREE.Vector3(l.sx, 0, l.sz);
  }

  hud(): string {
    const t = this.task;
    const n = t.lamps.length;
    const lit = n - this.left();
    const title = `<b>${esc(this.job.title)}</b>`;
    if (!t.picked) return `${title}<br>Take the spare pole at the first lamp<br>Light from ${hhmm(t.open)}, all ${n} by ${hhmm(t.until)}`;
    if (this.lj.hour() < t.open) return `${title}<br>Wait for dusk: light from ${hhmm(t.open)}<br>${n} lamps, all by ${hhmm(t.until)}`;
    if (!this.left()) return `${title}<br>All lit.`;
    return `${title}<br>Next: the lamp ahead (${lit + 1} of ${n})<br>${lit} lit, all by ${hhmm(t.until)}`;
  }

  dispose(): void {
    this.pole.root.removeFromParent();
    this.leaning.root.removeFromParent();
  }

  /** Dev: where the run stands. */
  info() {
    return { picked: !!this.task.picked, lit: this.task.lamps.filter((l) => l.done).map((l) => l.id), left: this.left(), lifting: this.lift?.k ?? null, finished: this.finished };
  }
}
