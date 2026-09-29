import { alongOf, helpHolds, inGrace, lampLit, lampLitHelped, pointAlong, roundState, roundWindow, seenPace, SEEN_STOP_S, type FogDay, type LampHelp, type LampRound, type LampWindow } from "../../../server/src/town/lampround";
import type { GasLamps } from "../world/gaslamps";
import type { Crowd, Puppet } from "./crowd";
import type { Town } from "./town";
import { makeWear, setPole, type Wear } from "./wardrobe";

// The lamplighters on their rounds (M6 town life). The server made the rounds and owns the
// times (server/src/town/lampround.ts): unseen, each lamplighter keeps the planned pace and
// his lamps light by the clock, one after the other along his path. Seen (within about 50 m of
// Jef), he walks at a real walking pace from lamp to lamp with his ladder and his pole, stops,
// raises the pole into the lantern, and only then does that lamp light (at dusk) or go out (at
// dawn); the lamps ahead of him wait for him. Out of sight again, he and his lamps catch up
// with the plan. M7 lamps (2026-09-25): seen, his pace is the one that ends his round before its
// window closes (lampround.ts seenPace): Jef's walk, or a brisk walk when he is behind. Held up
// (an opening bridge, a crowd), he goes on past his window until full dark (full day at dawn).
// M7 fog lamps (2026-09-25): on a day of thick fog the lamps burn by day too. With the day's fog
// (the engine's FogDay, lampround.ts windowsOf) the dawn round is not walked, a fog that comes by day
// is lit by a fog round, and one that lifts early enough is put out by one; each is walked like the others.
// The player's lamps (2026-09-28, town/lampjob.ts): a lamplighter who has handed the last lamps of his round to a
// player ends his round before them while the job holds; those lamps burn once the player has lit them.

const CLAIM_M = 50;
const DROP_M = 64;
/** A long leg is walked mark to mark along the round's own way, this far apart (m). */
const MARK_M = 20;

interface Run {
  round: LampRound;
  p: Puppet | null;
  wear: Wear | null;
  /** Seen: the lamp he is going to, and how many of this window's lamps he has done. */
  idx: number;
  done: number;
  phase: "walk" | "light";
  t: number;
  goT: number;
  kind: "dusk" | "dawn" | null;
  /** The window he walks (its kind and start: a fog round is a window of its own). */
  win: LampWindow | null;
  held: boolean;
  /** Seen: the pace he walks now (m/s). */
  pace: number;
  /** Tonight his round ends before a player's lamps, and he has walked his part. */
  partDone: boolean;
}

export class Lamplighters {
  private runs: Run[] = [];
  private clock = 0;
  /** Today's fog as the engine keeps it (null: none known yet, the plain dusk and dawn rounds). */
  fog: FogDay | null = null;
  /** The lamps a player lights for a lamplighter tonight (the server's, with the day it is for), or null. */
  help: LampHelp | null = null;

  constructor(
    private readonly town: Town,
    private readonly crowd: Crowd,
    private readonly lamps: GasLamps,
  ) {}

  setRounds(rounds: LampRound[]): void {
    for (const r of this.runs) this.drop(r, true);
    this.runs = rounds.map((round) => ({ round, p: null, wear: null, idx: 0, done: 0, phase: "walk", t: 0, goT: 0, kind: null, win: null, held: false, pace: 0, partDone: false }));
  }

  update(dt: number, player: { x: number; z: number }, hour: number): void {
    this.clock += dt;
    for (const r of this.runs) this.run(r, dt, player, hour);
  }

  private run(r: Run, dt: number, player: { x: number; z: number }, hour: number): void {
    const round = r.round;
    const fog = this.fog;
    let w = roundWindow(round, hour, fog);
    // followed and held up past his window: he finishes his round, until full dark (full day at dawn)
    if (!w.kind && r.p && r.win && r.idx < round.lamps.length && inGrace(round, r.win, hour)) w = { kind: r.win.kind, u: 1, w: r.win };
    const plan = roundState(round, hour, fog);
    if (w.kind !== r.kind || w.w?.start !== r.win?.start) {
      // a new window (or its end): the walker starts from the plan
      if (r.p) this.drop(r, false);
      r.kind = w.kind;
      r.win = w.w;
      r.done = plan.done;
      r.partDone = false;
    }
    // a player's lamps tonight: his round ends before them while the job holds (town/lampjob.ts)
    const help = this.help && this.help.round === round.id ? this.help : null;
    const holds = helpHolds(round, help, help?.day ?? -1, hour, fog);
    const cut = holds ? help!.from : round.lamps.length;
    // the lamps: the plan's, unless he is walking them in front of Jef (the ones he has not reached
    // yet are as they were when his window began); a player's lamps burn once he has lit them
    round.lamps.forEach((l, k) => {
      if (help && k >= help.from && (holds || help.lit.includes(l.id))) {
        this.lamps.set(l.id, lampLitHelped(round, k, hour, fog, help, help.day));
        return;
      }
      let on = lampLit(round, k, hour, fog);
      if (r.p && w.kind && w.w) on = k < r.done ? w.kind === "dusk" : lampLit(round, k, w.w.start - 1e-6, fog);
      this.lamps.set(l.id, on);
    });
    // his part is walked: he goes about his day (the player has the rest)
    // (seen, he walks to the end of his part first)
    if (holds && w.kind === "dusk" && (r.partDone || (!r.p && plan.done >= cut))) {
      r.partDone = true;
      if (r.p) this.drop(r, true);
      else if (r.held) {
        this.town.release(round.lamplighter);
        r.held = false;
      }
      return;
    }
    if (!w.kind) {
      if (r.held) {
        this.town.release(round.lamplighter);
        r.held = false;
      }
      return;
    }
    const d = Math.hypot(plan.x - player.x, plan.z - player.z);
    if (!r.p) {
      // unseen: he is where the plan says (so he steps out there when Jef comes near)
      this.town.moveHidden(round.lamplighter, plan.x, plan.z, 100);
      r.held = true;
      if (d > CLAIM_M) return;
      const p = this.claimOnWay(round, plan, player) ?? this.town.claimNear(round.lamplighter, player);
      if (!p) return;
      r.p = p;
      // (issue #24: taken up in the middle of a stop, the lamps the plan has done stay done: that lamp burning
      // already (or out, at dawn), he goes on to the next; before, it went dark again until he came back to it)
      r.done = plan.done;
      r.idx = plan.atLamp >= plan.done ? plan.atLamp : plan.done;
      r.phase = "walk";
      r.goT = 0;
      this.crowd.puppetLantern(p, false);
      r.wear = makeWear("lamplighter", p.human.scale);
      p.group.add(r.wear.root);
    }
    const p = r.p!;
    if (!this.crowd.alive(p) || Math.hypot(p.x - player.x, p.z - player.z) > DROP_M) {
      this.drop(r, false);
      return;
    }
    // a lamp a player lit for him tonight: he passes it by (after the player's deadline he lights the rest)
    while (help && r.idx < cut && r.idx >= help.from && help.lit.includes(round.lamps[r.idx].id)) {
      r.idx++;
      if (r.done < r.idx) r.done = r.idx;
      r.phase = "walk";
      r.goT = 0;
    }
    if (r.idx >= cut) {
      if (holds) {
        r.partDone = true;
        return;
      }
      // his round is done: he stands a moment, then the plan takes him home
      if (!this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "idle", null);
      return;
    }
    const lamp = round.lamps[r.idx];
    if (r.wear) setPole(r.wear, r.phase === "light" ? Math.sin(Math.min(1, r.t / (SEEN_STOP_S * 0.8)) * Math.PI) : 0, w.kind === "dusk");
    if (r.phase === "walk") {
      const dl = Math.hypot(p.x - lamp.sx, p.z - lamp.sz);
      if (dl < 0.9 || (dl < 2.2 && !this.crowd.puppetBusy(p) && r.goT > 0.5)) {
        r.phase = "light";
        r.t = 0;
        this.crowd.puppetStand(p, "idle", Math.atan2(lamp.x - p.x, lamp.z - p.z));
        return;
      }
      r.goT -= dt;
      if (r.goT <= 0 || !this.crowd.puppetBusy(p)) {
        // the way through the streets runs a little longer than the straight line
        r.pace = seenPace(round, r.idx, dl * 1.15, hour, w.w ?? w.kind);
        const [gx, gz] = this.nextMark(round, r.idx, p);
        this.crowd.puppetGo(p, gx, gz, r.pace);
        r.goT = 3;
      }
      return;
    }
    // at the lamp: the pole up into the lantern, the gas catches (or is turned off), on to the next
    r.t += dt;
    if (r.t >= SEEN_STOP_S * 0.5 && r.done <= r.idx) r.done = r.idx + 1;
    if (r.t >= SEEN_STOP_S) {
      r.idx++;
      r.phase = "walk";
      r.goT = 0;
    }
  }

  /**
   * Issue #14: he steps out on his round's own way, behind where the plan has him, out of Jef's sight: on the town
   * wall the street below is no way to his lamp (the walk grid round Jef does not reach the stair). Null: none hidden.
   */
  private claimOnWay(round: LampRound, plan: { x: number; z: number }, player: { x: number; z: number }): Puppet | null {
    if (round.path.length < 2) return null;
    const at = alongOf(round.path, plan.x, plan.z);
    // (behind him first; at his first lamp there is no behind: a little ahead, and he walks back to it)
    for (const back of [26, 32, 40, 48, 20, 14, -26, -32, -40]) {
      if (at - back < 0 || at - back > round.len) continue;
      const [x, z] = pointAlong(round.path, at - back);
      if (Math.hypot(x - player.x, z - player.z) < 12) continue;
      if (this.crowd.isHidden(x, z) && this.crowd.canStand(x, z)) return this.town.claim(round.lamplighter, { x, z });
    }
    return null;
  }

  /**
   * Where he walks next on the way to lamp `idx`: his round's own way (the walk map's: a wall's stair, round a block),
   * a mark every MARK_M along it, so a long leg is walked on the way the engine laid and the walk grid round Jef only
   * finds the few metres to the next mark. Off his way (stepped out elsewhere), first back onto it.
   */
  private nextMark(round: LampRound, idx: number, p: { x: number; z: number }): [number, number] {
    const lamp = round.lamps[idx];
    const end = round.at[idx] ?? 0;
    const start = idx > 0 ? round.at[idx - 1] : 0;
    if (end - start <= MARK_M || round.path.length < 2) return [lamp.sx, lamp.sz];
    // the nearest point of this leg (the round may pass a place twice: only this leg)
    let best = Infinity;
    let along = start;
    for (let a = start; a <= end; a += 1) {
      const [x, z] = pointAlong(round.path, a);
      const dd = Math.hypot(x - p.x, z - p.z);
      if (dd < best) {
        best = dd;
        along = a;
      }
    }
    if (best > 4) return pointAlong(round.path, along);
    const mark = Math.ceil((along - start + 6) / MARK_M) * MARK_M + start;
    return mark >= end - 4 ? [lamp.sx, lamp.sz] : pointAlong(round.path, mark);
  }

  private drop(r: Run, release: boolean): void {
    if (r.wear) {
      r.wear.root.removeFromParent();
      r.wear = null;
    }
    r.p = null;
    if (release && r.held) {
      this.town.release(r.round.lamplighter);
      r.held = false;
    }
  }

  /** Dev: where each lamplighter is and what he does. */
  info() {
    return this.runs.map((r) => ({
      round: r.round.id,
      who: this.town.info(r.round.lamplighter)?.name ?? r.round.lamplighter,
      lamps: r.round.lamps.length,
      window: r.kind,
      fog: !!r.win?.fog,
      seen: !!r.p,
      partDone: r.partDone,
      helped: this.help?.round === r.round.id ? { from: this.help.from, lit: this.help.lit.length } : null,
      at: r.p ? [+r.p.x.toFixed(1), +r.p.z.toFixed(1)] : null,
      idx: r.idx,
      done: r.done,
      phase: r.phase,
      pace: r.p ? +r.pace.toFixed(2) : null,
    }));
  }

  /** Dev and shots: the planned position of a round's walker now. */
  planned(i: number, hour: number) {
    const r = this.runs[i];
    return r ? roundState(r.round, hour, this.fog) : null;
  }
}
