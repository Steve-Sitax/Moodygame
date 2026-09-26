import type { FirstPerson } from "../player/firstPerson";
import type { Action } from "./runs";
import { chest } from "./facing";
import { post, RUN, TownFigure, WALK, Walkup, walkupHooks } from "./walkup";

// M7 walk-up: a follower (server town/walkup.ts mayShadow and shadowStep have the rules). A thief who saw
// Jef take a valuable load, or a customs man who saw a load no honest man carries at that hour, may follow
// him. The ENGINE says, every two seconds, what he does: keep his distance (12 to 25 m), linger where he is
// while Jef stands, close in when it is dark or the street is quiet, or break off (no load any more, an
// agent of the police in sight, lost him). A thief closing in can be turned on (E); if he reaches Jef the
// engine says whether he gets the load (never with an agent in sight, never a parcel in an inside pocket).
// A customs man closing in stops the load: the job's customs trouble starts with him in it.

type Move = { kind: "keep"; gap: number } | { kind: "linger" } | { kind: "close_in" } | { kind: "break_off"; why: string };

export interface FollowerCtx {
  player: FirstPerson;
  /** Jef still has the load (in his hands, in his pocket, on his cart). */
  carrying: () => boolean;
  /** The load is in his hands (a thief can snatch it). */
  inHands: () => boolean;
  /** The thief got it: the run loses the item. */
  snatched: () => void;
  toast: (t: string) => void;
  /** A customs man closed in: the trouble of the job was made (the ideas layer shows it when he is there). */
  trouble?: () => void;
}

export class Follower {
  private fig: TownFigure | null = null;
  private asked = false;
  private stepT = 1;
  private busy = false;
  private linger = false;
  private gap = 18;
  private role: "thief" | "customs" = "thief";
  state: "none" | "following" | "closing" | "leaving" | "handed" = "none";
  private shouted = false;
  private snatchAsked = false;
  private lastX = 0;
  private lastZ = 0;
  private moved = 0;
  /** Dev: the engine's moves as they came. */
  readonly log: string[] = [];

  constructor(
    private readonly jobId: number,
    private readonly c: FollowerCtx,
  ) {}

  get who(): TownFigure | null {
    return this.fig;
  }

  /** Jef took the load: does someone start following him? (once; the engine rolls) */
  start(): void {
    if (this.asked) return;
    this.asked = true;
    const { x, z } = this.c.player;
    void post<{ ok?: boolean; npc?: string; name?: string; action?: number }>("/api/walkup/shadow", { job_id: this.jobId, x: +x.toFixed(1), z: +z.toFixed(1) })
      .then((a) => {
        if (!a?.ok || !a.npc || !Walkup.inst || this.state !== "none") return;
        this.fig = Walkup.inst.figure(a.npc, a.name ?? a.npc, a.action ?? null);
        this.state = "following";
        this.log.push(`follows: ${a.name}`);
      })
      .catch(() => {});
  }

  update(dt: number): void {
    const f = this.fig;
    if (!f || f.gone || this.state === "handed" || this.state === "none") return;
    const { x, z } = this.c.player;
    this.moved = this.moved * 0.9 + Math.hypot(x - this.lastX, z - this.lastZ) / Math.max(dt, 1e-3) * 0.1;
    this.lastX = x;
    this.lastZ = z;
    f.update(dt);
    if (this.state === "leaving") {
      if (!f.moving) f.remove();
      return;
    }
    this.stepT -= dt;
    if (this.stepT <= 0 && !this.busy) {
      this.stepT = 2;
      this.busy = true;
      void post<{ move?: Move; facts?: { role?: string }; trouble?: number | null }>(`/api/walkup/shadow/${f.action}/step`, { moving: this.moved > 0.4, carrying: this.c.carrying() })
        .then((r) => {
          this.busy = false;
          if (r.facts?.role === "customs") this.role = "customs";
          if (r.move) this.apply(r.move, r.trouble ?? null);
        })
        .catch(() => (this.busy = false));
    }
    const d = f.distTo(x, z);
    if (this.state === "following") {
      if (!f.present) {
        f.walkTo(x, z, WALK);
        return;
      }
      if (this.linger || Math.abs(d - this.gap) < 4) {
        // at a corner, out of the way: he looks about, not at Jef
        if (f.moving) f.stop();
        f.face(f.pos.x + (f.pos.z - z), f.pos.z - (f.pos.x - x));
        return;
      }
      const L = d || 1;
      f.walkTo(x + ((f.pos.x - x) / L) * this.gap, z + ((f.pos.z - z) / L) * this.gap, d > this.gap + 10 ? 1.7 : WALK);
      return;
    }
    if (this.state === "closing") {
      f.walkTo(x, z, 1.6);
      if (d < 1.5 && !this.snatchAsked && this.role === "thief") {
        this.snatchAsked = true;
        void post<{ taken?: boolean; why?: string }>(`/api/walkup/shadow/${f.action}/snatch`, { x: +x.toFixed(1), z: +z.toFixed(1), hands: this.c.inHands(), shouted: this.shouted })
          .then((r) => {
            if (r.taken) {
              this.c.snatched();
              this.log.push("snatched");
            } else {
              this.c.toast("A man brushes close past you, eyes on your coat, and thinks better of it.");
              this.log.push(`tried: ${r.why}`);
            }
            this.leave(RUN);
          })
          .catch(() => this.leave(WALK));
      }
    }
  }

  private apply(m: Move, trouble: number | null): void {
    this.log.push(m.kind);
    if (this.state === "leaving" || this.state === "handed") return;
    switch (m.kind) {
      case "keep":
        this.gap = m.gap;
        this.linger = false;
        this.state = "following";
        return;
      case "linger":
        this.linger = true;
        return;
      case "close_in":
        if (this.role === "customs") {
          // the trouble takes him over: he walks up and stops the load (game/ideas.ts)
          this.state = "handed";
          this.log.push(`trouble ${trouble ?? "?"}`);
          walkupHooks.trouble();
          this.c.trouble?.();
          return;
        }
        this.state = "closing";
        return;
      case "break_off":
        this.leave(WALK);
        return;
    }
  }

  private leave(speed: number): void {
    const f = this.fig;
    if (!f) return;
    this.state = "leaving";
    const { x, z } = this.c.player;
    const L = f.distTo(x, z) || 1;
    f.walkTo(f.pos.x + ((f.pos.x - x) / L) * 25, f.pos.z + ((f.pos.z - z) / L) * 25, speed);
  }

  actions(): Action[] {
    const f = this.fig;
    if (!f?.present || this.state !== "closing" || this.shouted) return [];
    const { x, z } = this.c.player;
    if (f.distTo(x, z) > 8) return [];
    return [
      {
        key: "KeyE",
        text: "turn on him",
        at: chest(f.group),
        cone: 50,
        run: () => {
          this.shouted = true;
          this.c.toast("\"What do you want?\" He stops, shrugs, and goes off the other way.");
          this.leave(RUN);
        },
      },
    ];
  }

  dispose(): void {
    if (this.fig && !this.fig.gone && this.state !== "handed") this.fig.remove();
  }
}
