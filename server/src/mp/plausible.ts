import { FLAG, MAX_SPEED, MODES, type MpState } from "../../../shared/mpProtocol.ts";

// M8a multiplayer (docs/multiplayer-plan.md 4.2, Steve 2026-09-26): each player's own PC moves him; the
// server only checks that a move is possible. It never sends a correction: nothing on the network pulls
// a man back or turns his camera. A move that is not possible is refused: it is not passed on to the
// others (they keep seeing him at his last good place) and it is counted and logged.
//
// - Speed: not faster than his mode allows (MAX_SPEED, a quarter more, 0.35 m of slack for a late frame),
//   judged on the sender's own timestamps, which may not run ahead of the server's clock.
// - Up: at most a jump and a step per frame (falls may be fast).
// - A jump of place (the "snap" flag: a ladder, a seat, a load): the host's always; a guest's at most one
//   in 30 s.
// - A refused jump that then goes on normally from its new place for 2 s is taken as his new place (a
//   load, a respawn the flag did not mark). A speed hack never is: its frames are too fast for each other.

export interface Verdict {
  ok: boolean;
  why?: "old" | "time" | "speed" | "climb" | "snap";
  /** Accepted as a new place after a refused jump (the relay marks it a snap: no in-between). */
  anchored?: boolean;
  dist: number;
  speed: number;
}

const SLACK_M = 0.35;
const OVER = 1.25;
const SNAP_EVERY_MS = 30_000;
const ANCHOR_MS = 2_000;
/** A sender's clock may run at most this far ahead of the server's. */
const AHEAD_MS = 1_500;

export class Plausible {
  good: MpState | null = null;
  private pending: MpState | null = null;
  private pendingSince = 0;
  private lastSnapAt = -Infinity;
  /** Numbers for the host's stats and the tests. */
  stats = { frames: 0, accepted: 0, refused: 0, speed: 0, climb: 0, time: 0, snaps: 0, anchored: 0, corrections: 0 };

  readonly trusted: boolean;
  constructor(trusted: boolean) {
    this.trusted = trusted;
  }

  private limit(a: MpState, b: MpState): number {
    const ma = MODES[a.mode] ?? "walk";
    const mb = MODES[b.mode] ?? "walk";
    return Math.max(MAX_SPEED[ma], MAX_SPEED[mb]);
  }

  /** Is `b` a possible next step after `a`? */
  private step(a: MpState, b: MpState): { ok: boolean; why?: "speed" | "climb"; dist: number; speed: number } {
    const dt = Math.max(0.02, (b.t - a.t) / 1000);
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const speed = dist / dt;
    const allow = this.limit(a, b) * OVER * dt + SLACK_M;
    if (dist > allow) return { ok: false, why: "speed", dist, speed };
    // up: a jump (0.66 m) and a step or a stair (0.5 m) per frame, a ladder's pace; down: any fall
    if (b.y - a.y > 1.2 + 2.5 * dt) return { ok: false, why: "climb", dist, speed };
    return { ok: true, dist, speed };
  }

  /** Judge one frame that came in at `serverNow`. */
  check(s: MpState, serverNow: number): Verdict {
    this.stats.frames++;
    const refuse = (why: Verdict["why"], dist = 0, speed = 0): Verdict => {
      this.stats.refused++;
      if (why === "speed") this.stats.speed++;
      if (why === "climb") this.stats.climb++;
      if (why === "time") this.stats.time++;
      return { ok: false, why, dist, speed };
    };
    if (s.t > serverNow + AHEAD_MS) return refuse("time");
    const a = this.good;
    if (!a) {
      this.good = s;
      this.stats.accepted++;
      return { ok: true, dist: 0, speed: 0 };
    }
    if (s.t <= a.t) return refuse("old"); // late or repeated: the newer one was already passed on
    if (s.flags & FLAG.snap) {
      if (this.trusted || serverNow - this.lastSnapAt >= SNAP_EVERY_MS) {
        this.lastSnapAt = serverNow;
        this.good = s;
        this.pending = null;
        this.stats.snaps++;
        this.stats.accepted++;
        return { ok: true, dist: Math.hypot(s.x - a.x, s.z - a.z), speed: 0 };
      }
    }
    const st = this.step(a, s);
    if (st.ok) {
      this.good = s;
      this.pending = null;
      this.stats.accepted++;
      return { ok: true, dist: st.dist, speed: st.speed };
    }
    // refused: does it go on normally from there? Then after 2 s it is his new place.
    if (this.pending && this.step(this.pending, s).ok) {
      this.pending = s;
      if (serverNow - this.pendingSince >= ANCHOR_MS) {
        this.good = s;
        this.pending = null;
        this.stats.anchored++;
        this.stats.accepted++;
        return { ok: true, anchored: true, dist: st.dist, speed: st.speed };
      }
    } else {
      this.pending = s;
      this.pendingSince = serverNow;
    }
    return refuse(st.why, st.dist, st.speed);
  }
}
