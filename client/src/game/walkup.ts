import * as THREE from "three";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import type { Crowd, Puppet } from "./crowd";
import { Figure, type FigureKind } from "./figures";
import type { Motion } from "./humans";
import type { Town } from "./town";

// M7 walk-up, the client side (server town/walkup.ts decides who comes and whether they run).
// Steve, 2026-09-26: "when doing fetching jobs, a person always pops out of nowhere ... Those people should
// always be around and walk up, or run if they think it is urgent."
//
// A job asks the server for someone (a role, a reason, where they are needed). The ENGINE answers with a
// real townsperson (the nearest customs officer on his beat, an agent on his round, a thief loitering at
// the market) or "wait". The person is walked up from where they are: unseen while far off (at a quick
// unseen pace, as the town moves everyone it does not draw), into the street out of Jef's sight (their
// own spot when he cannot see it, else round a corner or in the fog on their side of him, never within
// 28 m in view), and then on foot on the walk grid, at a run when it is urgent. Only when nobody can come
// within the job's cap does a figure made in code step in, and it too starts out of sight and walks in.

export const WALK = 1.35;
export const SNEAK = 0.85;
export const RUN = 3.1;
/** Unseen they cover ground at this pace (the town's own unseen walk is 6 m/s). */
const HIDDEN_WALK = 3.5;
const HIDDEN_RUN = 6;
/** Within this of Jef a called person steps into the street (the crowd's walk grid reaches about 55 m). */
const CLAIM_M = 50;
/** Out of sight means at least this far when it is in front of him (the fog, a corner, behind him). */
export const OUT_OF_SIGHT_M = 28;

export interface CallAnswer {
  ok: boolean;
  npc?: string;
  name?: string;
  action?: number;
  urgent?: boolean;
  wait?: boolean;
  none?: boolean;
  why?: string;
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  return (await r.json().catch(() => ({}))) as T;
}

/** A person a job or a quest uses: a townsperson walked up (TownFigure), or a figure made in code (Figure). */
export interface JobFigure {
  readonly pos: THREE.Vector3;
  readonly group: THREE.Object3D;
  /** A body in the street now (Jef can meet them); false while they are still on their unseen way. */
  readonly present: boolean;
  readonly moving: boolean;
  gone: boolean;
  /** The resident's id, or null for a figure made in code. */
  readonly who: string | null;
  walkTo(x: number, z: number, speed: number): void;
  stop(): void;
  face(x: number, z: number): void;
  distTo(x: number, z: number): number;
  /** Carry a thing (a crate from the pile, a parcel bought). */
  hold(obj: THREE.Object3D): void;
  update(dt: number): void;
  /** Done with them: a townsperson goes back to their day (from where they stand); a made one is gone. */
  remove(): void;
  /** Standing still: arms folded, idle, talking. */
  motion: Motion;
}

interface Ctx {
  world: World;
  player: FirstPerson;
  town: Town;
  crowd: Crowd;
}

/** Set by main: a follower made the job's trouble (the ideas layer loads it now). */
export const walkupHooks = { trouble: () => {} };

/** Who the walk-up layer holds now (the popcheck: a person held for a job is a job figure). */
export const heldForJobs = new Set<string>();

/** A townsperson walked up for a job (the server's "come" row keeps them for us). */
export class TownFigure implements JobFigure {
  readonly pos = new THREE.Vector3();
  gone = false;
  motion: Motion = "idle";
  private p: Puppet | null = null;
  /** Where the job wants them, and the nearest point to it they can walk to (a pier's head is off the walk grid). */
  private target: { x: number; z: number } | null = null;
  private goal: { x: number; z: number } | null = null;
  private arrived = false;
  private speed = WALK;
  private yawWant: number | null = null;
  private goT = 0;
  private standT = 0;
  /** How long the walk to the target has taken: a way that cannot be walked ends where they are. */
  private walkT = 0;
  private held: THREE.Object3D[] = [];
  private readonly none = new THREE.Group();
  /** The server was told (done): once. */
  private told = false;

  constructor(
    private readonly c: Ctx,
    readonly who: string,
    readonly name: string,
    readonly action: number | null,
  ) {
    heldForJobs.add(who);
    const at = c.town.position(who);
    if (at) this.pos.set(at.x, 0, at.z);
  }

  get present(): boolean {
    return !!this.p && !this.gone;
  }
  get group(): THREE.Object3D {
    return this.p?.group ?? this.none;
  }
  get moving(): boolean {
    return this.target !== null && !this.arrived;
  }
  get puppet(): Puppet | null {
    return this.p;
  }

  walkTo(x: number, z: number, speed: number): void {
    const same = this.target && Math.hypot(this.target.x - x, this.target.z - z) < 0.6 && this.speed === speed;
    if (same) return;
    this.target = { x, z };
    this.speed = speed;
    this.goal = null;
    this.arrived = false;
    this.goT = 0;
    this.walkT = 0;
  }
  stop(): void {
    this.target = null;
    this.goal = null;
    this.arrived = false;
    if (this.p) this.c.crowd.puppetStand(this.p, this.motion, this.yawWant);
  }
  face(x: number, z: number): void {
    this.yawWant = Math.atan2(x - this.pos.x, z - this.pos.z);
  }
  distTo(x: number, z: number): number {
    return Math.hypot(this.pos.x - x, this.pos.z - z);
  }
  hold(obj: THREE.Object3D): void {
    this.held.push(obj);
    if (this.p) {
      this.p.group.add(obj);
      obj.position.set(0, 0.9 / this.p.size, 0.35);
    }
  }

  update(dt: number): void {
    if (this.gone) return;
    const { town, crowd, player } = this.c;
    let p = town.puppet(this.who);
    if (p && !crowd.alive(p)) p = null;
    if (p && p !== this.p) {
      // in the street (theirs already, or just stepped out of sight): ours now
      p = town.claim(this.who) ?? p;
      for (const o of this.held) {
        p.group.add(o);
        o.position.set(0, 0.9 / p.size, 0.35);
      }
      this.goT = 0;
    }
    this.p = p;
    if (!p) {
      const at = town.position(this.who);
      const goal = this.target ?? { x: player.x, z: player.z };
      const d = at ? Math.hypot(at.x - player.x, at.z - player.z) : Infinity;
      if (at && d <= CLAIM_M) {
        // near: out into the street, where Jef cannot see them step out (their own spot, or round a corner on
        // their side; else the nearest point out of his sight on their side that has a way to him)
        let q = town.claimNear(this.who, { x: player.x, z: player.z }, OUT_OF_SIGHT_M);
        if (!q) {
          const from = Walkup.inst?.outOfSight({ x: at.x, z: at.z }) ?? null;
          if (from) q = town.claim(this.who, from);
        }
        if (q) {
          this.p = q;
          for (const o of this.held) q.group.add(o);
          this.goT = 0;
        }
      }
      // unseen they never come nearer than the edge of his sight: they step out there and walk the rest
      if (!this.p && d > OUT_OF_SIGHT_M + 2) town.moveHidden(this.who, goal.x, goal.z, dt, this.speed >= 2 ? HIDDEN_RUN : HIDDEN_WALK);
      const now = town.position(this.who);
      if (now && !this.p) this.pos.set(now.x, 0, now.z);
      if (!this.p) return;
    }
    const q = this.p!;
    this.pos.set(q.x, 0, q.z);
    if (this.target && !this.arrived) {
      this.goal ??= this.reachable(q, this.target);
      const d = Math.hypot(q.x - this.goal.x, q.z - this.goal.z);
      this.walkT += dt;
      if (d > 0.45 && this.walkT < 40) {
        this.goT -= dt;
        if (this.goT <= 0) {
          this.goT = 0.5;
          // (the way is worked out anew now and then: they may have come onto the grid round Jef since)
          if (this.walkT > 3 && q.state === "pause") this.goal = this.reachable(q, this.target);
          crowd.puppetGo(q, this.goal.x, this.goal.z, this.speed);
        }
      } else {
        this.arrived = true;
        crowd.puppetStand(q, this.motion, this.yawWant);
        this.standT = 0.4;
      }
    } else if (this.yawWant !== null) {
      this.standT -= dt;
      if (this.standT <= 0 && Math.abs(Math.atan2(Math.sin(q.yaw - this.yawWant), Math.cos(q.yaw - this.yawWant))) > 0.3) {
        crowd.puppetStand(q, this.motion, this.yawWant);
        this.standT = 0.5;
      }
    }
  }

  /** The target if there is a way to it on the walk grid, else the nearest point on the line back toward them that has one. */
  private reachable(q: Puppet, t: { x: number; z: number }): { x: number; z: number } {
    const crowd = this.c.crowd;
    if (!crowd.onGrid(q.x, q.z) || crowd.pathOn(q.x, q.z, t.x, t.z)) return t;
    const L = Math.hypot(q.x - t.x, q.z - t.z) || 1;
    for (let k = 1.5; k < Math.min(L, 30); k += 1.5) {
      const x = t.x + ((q.x - t.x) / L) * k;
      const z = t.z + ((q.z - t.z) / L) * k;
      const o = crowd.openNear(x, z);
      if (o && crowd.pathOn(q.x, q.z, o.x, o.z)) return o;
    }
    return t;
  }

  /** Back to their day, from where they stand (in Jef's sight they walk on; unseen, the town takes them). */
  remove(outcome = "done"): void {
    if (this.gone) return;
    this.gone = true;
    for (const o of this.held) o.removeFromParent();
    this.held = [];
    heldForJobs.delete(this.who);
    this.c.town.release(this.who);
    if (this.action !== null && !this.told) {
      this.told = true;
      void post(`/api/walkup/${this.action}/done`, { outcome }).catch(() => {});
    }
  }
}

/** The one walk-up layer (main.ts makes it). */
export class Walkup {
  static inst: Walkup | null = null;
  private readonly c: Ctx;
  /** Dev: what was asked and answered. */
  readonly log: string[] = [];

  constructor(world: World, player: FirstPerson, town: Town, crowd: Crowd) {
    this.c = { world, player, town, crowd };
    Walkup.inst = this;
  }

  get ctx(): Ctx {
    return this.c;
  }

  /** Someone for a job, from the living town (the engine picks), or wait / none. */
  async call(req: { role: string; why: string; ref: string; at: { x: number; z: number } }): Promise<{ fig: TownFigure | null; answer: CallAnswer }> {
    let a: CallAnswer;
    try {
      a = await post<CallAnswer>("/api/walkup/call", { ...req, x: +req.at.x.toFixed(1), z: +req.at.z.toFixed(1) });
    } catch {
      a = { ok: false, wait: true, why: "no answer" };
    }
    this.log.push(`${req.ref} ${req.role}: ${a.ok ? `${a.name}${a.urgent ? " (runs)" : ""}` : (a.why ?? "wait")}`);
    return { fig: a.ok && a.npc ? this.figure(a.npc, a.name ?? a.npc, a.action ?? null) : null, answer: a };
  }

  /** The trouble on a job is due: its person (or none: the stowaway is in the crate). */
  async trouble(id: number, at: { x: number; z: number }): Promise<{ fig: TownFigure | null; answer: CallAnswer }> {
    let a: CallAnswer;
    try {
      a = await post<CallAnswer>(`/api/walkup/trouble/${id}`, { x: +at.x.toFixed(1), z: +at.z.toFixed(1) });
    } catch {
      a = { ok: false, wait: true, why: "no answer" };
    }
    this.log.push(`trouble ${id}: ${a.ok ? `${a.name}${a.urgent ? " (runs)" : ""}` : a.none ? "none" : (a.why ?? "wait")}`);
    return { fig: a.ok && a.npc ? this.figure(a.npc, a.name ?? a.npc, a.action ?? null) : null, answer: a };
  }

  private figs = new Map<string, TownFigure>();
  /** The handle for a townsperson (one per person: a follower handed on to the trouble keeps his). */
  figure(id: string, name: string, action: number | null): TownFigure {
    const had = this.figs.get(id);
    if (had && !had.gone) return had;
    const f = new TownFigure(this.c, id, name, action);
    this.figs.set(id, f);
    return f;
  }

  /**
   * A point out of Jef's sight from which someone can walk to `goal`: behind him or to the side at
   * 28 m or more, or in the fog, on the walk grid, with a way to the goal. Nearest the goal first.
   */
  outOfSight(goal: { x: number; z: number }): { x: number; z: number } | null {
    const { player, crowd } = this.c;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 + (i % 2) * 0.07;
      const r = OUT_OF_SIGHT_M + (i % 4) * 5;
      const q = crowd.openNear(player.x + Math.cos(a) * r, player.z + Math.sin(a) * r);
      if (!q || !crowd.isHidden(q.x, q.z) || this.c.world.isWater(q.x, q.z)) continue;
      if (Math.hypot(q.x - player.x, q.z - player.z) < OUT_OF_SIGHT_M - 1) continue;
      const d = Math.hypot(q.x - goal.x, q.z - goal.z);
      if (d >= bestD) continue;
      if (!crowd.pathOn(q.x, q.z, goal.x, goal.z)) continue;
      best = q;
      bestD = d;
    }
    return best;
  }

  /**
   * A figure made in code (nobody of the town fits): it starts out of Jef's sight and walks to `goal`
   * at `speed`. Null when there is no such point this moment (ask again next frame).
   */
  walkIn(kind: FigureKind, goal: { x: number; z: number }, speed = WALK): Figure | null {
    const from = this.outOfSight(goal);
    if (!from) return null;
    const f = new Figure(kind, from.x, from.z, this.c.world.scene);
    f.origin = "walked in";
    f.walkTo(goal.x, goal.z, speed);
    this.log.push(`walk-in ${kind} from ${from.x.toFixed(0)},${from.z.toFixed(0)}`);
    return f;
  }

  /** A made figure that waits at a place: there when Jef cannot see the place, else it walks in. */
  placeOrWalkIn(kind: FigureKind, x: number, z: number): Figure | null {
    const { crowd, player } = this.c;
    if (crowd.isHidden(x, z) && Math.hypot(x - player.x, z - player.z) >= 10) {
      const f = new Figure(kind, x, z, this.c.world.scene);
      f.origin = "placed unseen";
      return f;
    }
    return this.walkIn(kind, { x, z });
  }

  /** Is this point out of Jef's sight now? */
  hidden(x: number, z: number): boolean {
    return this.c.crowd.isHidden(x, z);
  }

  // ---- dev: someone of a role comes up to Jef now (the police to a crime run), as a job would call them

  private dev: Array<{ s: Summons; at: number; name: string }> = [];
  private devN = 0;
  /** Dev (`__scheldemist.walkup.come("police", "crime")`): the engine picks, they walk (or run) up and wait by Jef a while. */
  devCome(role: string, why: string): string {
    const ref = `quest:dev:${Date.now() % 100000}-${++this.devN}`;
    const s = new Summons(() => ({ role, why, ref, at: { x: this.c.player.x, z: this.c.player.z } }), { capS: 60, fallback: null });
    this.dev.push({ s, at: 0, name: "" });
    return ref;
  }
  /** Dev comers, one step (the crowd's frame calls it: 60 a second, in the kit's runs too). */
  tick(): void {
    const dt = 1 / 60;
    const { x, z } = this.c.player;
    for (const d of this.dev) {
      d.s.update(dt);
      const f = d.s.fig;
      if (!f || f.gone) continue;
      if (f.present && f.distTo(x, z) <= 2.4) {
        if (f.moving) f.stop();
        f.face(x, z);
        d.at += dt;
        if (d.at > 20) d.s.cancel();
      } else {
        const L = f.distTo(x, z) || 1;
        f.walkTo(x + ((f.pos.x - x) / L) * 1.8, z + ((f.pos.z - z) / L) * 1.8, d.s.urgent ? RUN : WALK);
      }
    }
    this.dev = this.dev.filter((d) => d.s.state !== "none");
  }
  /** Dev: who the dev comers are, where. */
  devInfo(): Array<{ state: string; who: string | null; d: number | null; present: boolean }> {
    const { x, z } = this.c.player;
    return this.dev.map((d) => ({ state: d.s.state, who: d.s.fig?.who ?? null, d: d.s.fig ? +d.s.fig.distTo(x, z).toFixed(1) : null, present: !!d.s.fig?.present }));
  }
}

/**
 * Someone a run waits for: asks the server every few seconds until the engine sends a person, and
 * after `capS` without anyone either gives up (`fallback` null) or has a made figure walk in.
 */
export class Summons {
  fig: JobFigure | null = null;
  state: "asking" | "coming" | "none" = "asking";
  urgent = false;
  private askT = 0;
  private waited = 0;
  private busy = false;

  constructor(
    private readonly req: () => { role: string; why: string; ref: string; at: { x: number; z: number } },
    private readonly opts: { capS: number; fallback: FigureKind | null; onCome?: (f: JobFigure) => void },
  ) {}

  update(dt: number): void {
    const w = Walkup.inst;
    if (this.state === "asking" && w) {
      this.waited += dt;
      this.askT -= dt;
      if (this.askT <= 0 && !this.busy) {
        this.askT = 3;
        this.busy = true;
        void w.call(this.req()).then(({ fig, answer }) => {
          this.busy = false;
          if (this.state !== "asking") {
            fig?.remove();
            return;
          }
          if (fig) {
            this.fig = fig;
            this.urgent = !!answer.urgent;
            this.state = "coming";
            this.opts.onCome?.(fig);
          }
        });
      }
      if (this.state === "asking" && this.waited > this.opts.capS) {
        if (!this.opts.fallback) this.state = "none";
        else {
          const f = w.walkIn(this.opts.fallback, this.req().at);
          if (f) {
            this.fig = f;
            this.state = "coming";
            this.opts.onCome?.(f);
          }
        }
      }
    }
    if (this.fig && !this.fig.gone) this.fig.update(dt);
  }

  /** Done: the person goes back to their day (or the made one is gone); nobody comes any more. */
  cancel(): void {
    this.state = "none";
    if (this.fig && !this.fig.gone) this.fig.remove();
  }
}
