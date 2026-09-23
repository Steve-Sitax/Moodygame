import { api, type ActionsPayload, type PublicAction, type PushMsg } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import { STOPS as OMNIBUS_STOPS, type OmnibusStop } from "../world/omnibus";
import type { Crowd, Puppet } from "./crowd";
import type { Events } from "./events";
import type { Town } from "./town";

// Townspeople who act (M4), on the client. The server keeps every action as a
// row (director/actions.ts) and decides what it means; this side walks the
// person: follow Jef (a step behind, lost when he is 40 m off for 5 s, stopped
// at the water's edge), go to a place, wait, look for someone, go and talk to
// someone (the server then writes the conversation; bubbles.ts shows it),
// fetch the police, or attend an event (a ring round the place, a column
// behind a leader in a procession). It reports arrived, lost, blocked and done,
// and tells the server every 2 s where Jef is and who is in the street.
//
// The trap (M4 notes): the talk window unholds the person when it closes, and
// town.update despawns anyone held beyond 68 m; so every run claims its person
// again every frame (town.claimNear), and moves them unseen when far off.

const POLL_S = 2;
const SYNC_S = 2;
/** Within this of Jef a person is walked on the crowd's grid (it reaches about 55 m; beyond 68 m the town despawns them). */
const CLAIM_M = 58;
const ATTEND_CLAIM_M = 58;
const LOST_S = 5;
/** Coming to an event by omnibus: live this far off, and a stop this near the event. */
const TRAM_FROM_M = 90;
const TRAM_STOP_M = 70;
/** Give up waiting for an omnibus after this long (real seconds) and walk. */
const TRAM_WAIT_S = 70;

const hash01 = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const STUCK_S = 12;

interface Run {
  a: PublicAction;
  p: Puppet | null;
  goT: number;
  lostT: number;
  stuckT: number;
  bestD: number;
  reported: boolean;
  wait: number;
  /** talk_to and fetch_police: the other one, held while they speak. */
  other: string | null;
  /** attend: how they come (Steve: running, walking, biking or by tram). */
  how?: "walk" | "run" | "tram";
  tramStop?: OmnibusStop;
  tramT?: number;
}

export class Actions {
  private runs = new Map<number, Run>();
  private list: PublicAction[] = [];
  private pollT = 0;
  private syncT = 0;
  private dirty = true;
  private busy = false;
  /** People held a moment longer after their talk ended (the bubbles still show). */
  private afterglow = new Map<string, number>();
  /** Set by main: the payload also carries the events and the conversations. */
  onPayload: (p: ActionsPayload) => void = () => {};
  say: (t: string) => void = () => {};
  /** Dev: what was reported. */
  readonly reports: string[] = [];

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly town: Town,
    private readonly crowd: Crowd,
    private readonly events: Events,
  ) {}

  /** A push from the server: the list changed, or an action ended with a line. */
  handlePush(m: PushMsg): void {
    if (m.type === "actions" || m.type === "events") {
      this.dirty = true;
      const ended = m.ended as { npc: string; name: string; kind: string; status: string; line: string } | undefined;
      if (ended?.line) {
        const at = this.town.position(ended.npc);
        const near = at && Math.hypot(at.x - this.player.x, at.z - this.player.z) < 40;
        if (near || ended.kind === "follow" || ended.kind === "wait") this.say(`${ended.name.split(" ")[0]}: "${ended.line}"`);
      }
    }
  }

  get active(): PublicAction[] {
    return this.list;
  }

  /** Is this person following Jef right now (the police visit may ask)? */
  following(id: string): boolean {
    return this.list.some((a) => a.npc === id && a.kind === "follow");
  }

  update(dt: number): void {
    this.pollT -= dt;
    if (this.pollT <= 0 && !this.busy) {
      this.pollT = this.dirty ? 0.3 : this.runs.size ? POLL_S : 6;
      void this.poll();
    }
    this.syncT -= dt;
    if (this.syncT <= 0 && (this.runs.size || this.dirty)) {
      this.syncT = SYNC_S;
      void this.sync();
    }
    for (const r of this.runs.values()) this.run(r, dt);
    this.releaseBuses();
    for (const [id, t] of this.afterglow) {
      if (t < performance.now()) {
        this.afterglow.delete(id);
        if (!this.list.some((a) => a.npc === id)) this.town.release(id);
      } else {
        const p = this.town.claim(id);
        if (p && this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "talk", null);
      }
    }
  }

  private async poll(): Promise<void> {
    this.busy = true;
    this.dirty = false;
    try {
      const p = await api.actions();
      this.apply(p);
      this.onPayload(p);
    } catch {
      // the server is away: nothing moves
    } finally {
      this.busy = false;
    }
  }

  private async sync(): Promise<void> {
    const px = this.player.x;
    const pz = this.player.z;
    const people = this.town.inStreet(px, pz, 60).map((s) => ({ id: s.id, x: +s.x.toFixed(1), z: +s.z.toFixed(1) }));
    try {
      await api.actionsSync({ x: +px.toFixed(1), z: +pz.toFixed(1), people });
    } catch {
      // next time
    }
  }

  private apply(p: ActionsPayload): void {
    this.list = p.actions;
    const seen = new Set<number>();
    for (const a of p.actions) {
      seen.add(a.id);
      const had = this.runs.get(a.id);
      if (had) had.a = a;
      else this.runs.set(a.id, { a, p: null, goT: 0, lostT: 0, stuckT: 0, bestD: Infinity, reported: false, wait: 0, other: null });
    }
    for (const [id, r] of this.runs) {
      if (seen.has(id)) continue;
      this.runs.delete(id);
      this.end(r);
    }
  }

  /** The action is over on the server: let the person go (after a moment for a talk). */
  private end(r: Run): void {
    const stillHeld = (id: string) => [...this.runs.values()].some((o) => o.a.npc === id || o.other === id);
    if (r.a.kind === "talk_to" || r.a.kind === "fetch_police") {
      const until = performance.now() + 9000;
      this.afterglow.set(r.a.npc, until);
      if (r.other) this.afterglow.set(r.other, until);
      return;
    }
    if (!stillHeld(r.a.npc)) this.town.release(r.a.npc);
    if (r.other && !stillHeld(r.other)) this.town.release(r.other);
  }

  private async report(r: Run, phase: "arrived" | "lost" | "blocked" | "done", extra: { found?: boolean; why?: string } = {}): Promise<void> {
    if (r.reported) return;
    r.reported = true;
    const at = r.p ? { x: +r.p.x.toFixed(1), z: +r.p.z.toFixed(1) } : {};
    this.reports.push(`${r.a.id}:${r.a.kind}:${phase}${extra.why ? ":" + extra.why : ""}${extra.found ? ":found" : ""}`);
    try {
      await api.actionReport(r.a.id, { phase, ...at, ...extra });
    } catch {
      r.reported = false;
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ per frame, per action

  private jefD(x: number, z: number): number {
    return Math.hypot(x - this.player.x, z - this.player.z);
  }

  /** The person in the street, claimed; or null while they are far off (moved unseen toward `toward`). */
  private ensure(r: Run, toward: { x: number; z: number } | null, dt: number, range: number): Puppet | null {
    const pos = this.town.position(r.a.npc);
    const d = pos ? this.jefD(pos.x, pos.z) : Infinity;
    // a guest on the way to a gathering Jef can see: they step out of sight close to it, not across town
    const guest = r.a.kind === "attend" && toward && this.jefD(toward.x, toward.z) < range;
    if (d > range && !guest) {
      r.p = null;
      if (toward) this.town.moveHidden(r.a.npc, toward.x, toward.z, dt);
      return null;
    }
    const p = guest && d > range ? this.town.claimNear(r.a.npc, toward!, 12) : this.town.claimNear(r.a.npc, { x: this.player.x, z: this.player.z });
    r.p = p;
    return p;
  }

  private go(r: Run, p: Puppet, x: number, z: number, pace: number, every = 0.45): void {
    r.goT -= 1 / 60;
    if (r.goT > 0) return;
    r.goT = every;
    this.crowd.puppetGo(p, x, z, pace);
  }

  private stuck(r: Run, d: number, dt: number, limit = STUCK_S): boolean {
    if (d < r.bestD - 0.3) {
      r.bestD = d;
      r.stuckT = 0;
      return false;
    }
    r.stuckT += dt;
    return r.stuckT > limit;
  }

  private run(r: Run, dt: number): void {
    const a = r.a;
    switch (a.kind) {
      case "follow":
        return this.follow(r, dt);
      case "go_to":
      case "attend":
        return this.goTo(r, dt);
      case "wait":
        return this.waitHere(r, dt);
      case "look_for":
        return this.lookFor(r, dt);
      case "talk_to":
      case "fetch_police":
        return this.talkTo(r, dt);
      default:
        return;
    }
  }

  private follow(r: Run, dt: number): void {
    const p = this.ensure(r, null, dt, CLAIM_M);
    if (!p) {
      r.lostT += dt;
      if (r.lostT > LOST_S) void this.report(r, "lost");
      return;
    }
    const px = this.player.x;
    const pz = this.player.z;
    const d = this.jefD(p.x, p.z);
    if (d > (r.a.max_m || 40)) r.lostT += dt;
    else r.lostT = 0;
    if (r.lostT > LOST_S) return void this.report(r, "lost");
    // the water's edge: a swimming Jef, or Jef on the water
    if (this.player.swimming || this.world.isWater(px, pz)) {
      this.crowd.puppetStand(p, "idle", Math.atan2(px - p.x, pz - p.z));
      return void this.report(r, "blocked", { why: "water" });
    }
    if (d > 2.6) {
      const L = d || 1;
      const tx = px + ((p.x - px) / L) * 1.8;
      const tz = pz + ((p.z - pz) / L) * 1.8;
      this.go(r, p, tx, tz, d > 10 ? 2.3 : d > 4.5 ? 1.75 : 1.35);
      if (d > 7 && this.stuck(r, d, dt)) void this.report(r, "blocked", { why: "wall" });
      return;
    }
    r.bestD = Infinity;
    r.stuckT = 0;
    if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
      this.crowd.puppetStand(p, "idle", Math.atan2(px - p.x, pz - p.z));
      r.wait = 2;
    }
  }

  /** How someone comes to an event, decided once: onlookers often run; the far-off take the omnibus. */
  private how(r: Run, tx: number, tz: number): "walk" | "run" | "tram" {
    if (r.how) return r.how;
    const a = r.a;
    const h = hash01(`${a.npc}:${a.event_id}`);
    const pos = this.town.position(a.npc);
    const far = !pos || Math.hypot(pos.x - tx, pos.z - tz) > TRAM_FROM_M;
    let stop: OmnibusStop | null = null;
    let best = TRAM_STOP_M;
    for (const s of OMNIBUS_STOPS) {
      const d = Math.hypot(s.x - tx, s.z - tz);
      if (d < best) [best, stop] = [d, s];
    }
    const seen = pos?.shown ?? false;
    if (far && stop && !seen && h < (a.role === "crowd" ? 0.4 : 0.3)) {
      r.tramStop = stop;
      r.tramT = 0;
      return (r.how = "tram");
    }
    return (r.how = a.role === "crowd" && h > 0.6 ? "run" : "walk");
  }

  /** Waiting on the omnibus: they step off the back platform when one stands at their stop. */
  private byTram(r: Run, dt: number): Puppet | null {
    r.tramT = (r.tramT ?? 0) + dt;
    const stop = r.tramStop!;
    const bus = this.world.omnibus()?.buses.find((b) => {
      const at = b.atStop();
      return !!at && at.id === stop.id && at.line === stop.line;
    });
    if (bus && performance.now() >= (this.tramNext.get(bus) ?? 0)) {
      // one at a time down the step, the omnibus waiting for them
      bus.hold(true);
      this.tramNext.set(bus, performance.now() + 700);
      this.tramHeld.set(bus, performance.now() + 1500);
      const step = bus.stepDown();
      const p = this.town.claim(r.a.npc, { x: step.x, z: step.z });
      if (p) {
        r.how = "walk";
        return p;
      }
    }
    if (r.tramT > TRAM_WAIT_S) r.how = "walk"; // no omnibus came: they walk after all
    return null;
  }
  private tramNext = new Map<object, number>();
  private tramHeld = new Map<import("../world/omnibus").Omnibus, number>();

  private releaseBuses(): void {
    for (const [bus, until] of this.tramHeld) {
      if (performance.now() < until) continue;
      bus.hold(false);
      this.tramHeld.delete(bus);
    }
  }

  private goTo(r: Run, dt: number): void {
    const a = r.a;
    const attend = a.kind === "attend";
    const tx = a.target_x ?? this.player.x;
    const tz = a.target_z ?? this.player.z;
    const how = attend && a.phase !== "procession" ? this.how(r, tx, tz) : "walk";
    if (how === "tram" && !r.p) {
      const p = this.byTram(r, dt);
      if (!p) return;
      r.p = p;
    }
    const p = this.ensure(r, { x: tx, z: tz }, dt, attend ? ATTEND_CLAIM_M : CLAIM_M);
    if (!p) {
      // unseen and there: a go_to is done all the same
      const pos = this.town.position(a.npc);
      if (!attend && pos && Math.hypot(pos.x - tx, pos.z - tz) < 2) void this.report(r, "arrived");
      return;
    }
    // a procession: everyone but the leader keeps behind the one ahead
    let gx = tx;
    let gz = tz;
    if (attend && a.phase === "procession" && a.order > 0) {
      const ahead = this.events.participant(a.event_id, a.order - 1);
      const ap = ahead ? this.town.position(ahead) : null;
      if (ap && Math.hypot(ap.x - tx, ap.z - tz) > 2.5) {
        const L = Math.hypot(ap.x - p.x, ap.z - p.z) || 1;
        gx = ap.x + ((p.x - ap.x) / L) * 1.4;
        gz = ap.z + ((p.z - ap.z) / L) * 1.4;
      }
    }
    const d = Math.hypot(p.x - gx, p.z - gz);
    if (d > 1.6) {
      const pace = !attend ? 1.5 : a.phase === "procession" ? 0.95 : d <= 6 ? 1.1 : r.how === "run" ? 2.5 : 1.45;
      this.go(r, p, gx, gz, pace, attend ? 0.9 : 0.6);
      if (this.stuck(r, d, dt, attend ? 20 : STUCK_S)) {
        if (!attend) void this.report(r, "blocked", { why: "wall" });
        else if (!this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "idle", null);
      }
      return;
    }
    if (!attend) return void this.report(r, "arrived");
    // there: face the middle of it, and talk now and then like a crowd
    const c = this.events.centreOf(a.event_id);
    if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
      const yaw = c ? Math.atan2(c.x - p.x, c.z - p.z) : null;
      const mood = this.events.moodOf(a.event_id);
      const talk = Math.random() < (mood === "solemn" ? 0.1 : 0.35);
      this.crowd.puppetStand(p, talk ? "talk" : mood === "solemn" ? "fold" : "idle", yaw);
      r.wait = talk ? 2.5 + Math.random() * 2 : 4 + Math.random() * 6;
    }
  }

  private waitHere(r: Run, dt: number): void {
    const p = this.ensure(r, null, dt, CLAIM_M);
    if (!p) return;
    if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
      this.crowd.puppetStand(p, Math.random() < 0.3 ? "behind" : "idle", Math.atan2(this.player.x - p.x, this.player.z - p.z));
      r.wait = 3 + Math.random() * 4;
    }
  }

  private lookFor(r: Run, dt: number): void {
    const a = r.a;
    const cx = a.target_x ?? this.player.x;
    const cz = a.target_z ?? this.player.z;
    const p = this.ensure(r, { x: cx, z: cz }, dt, CLAIM_M);
    if (!p) return;
    // the one they look for: in the street, close, in view
    const t = this.town.position(a.target);
    if (t && t.shown && Math.hypot(t.x - p.x, t.z - p.z) < 12) {
      this.crowd.puppetStand(p, "talk", Math.atan2(t.x - p.x, t.z - p.z));
      return void this.report(r, "done", { found: true });
    }
    if (this.crowd.puppetBusy(p)) return;
    if ((r.wait -= dt) > 0) return;
    const R = a.max_m || 40;
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 6 + Math.random() * (R - 6);
      const q = this.crowd.openNear(cx + Math.cos(ang) * d, cz + Math.sin(ang) * d);
      if (q) {
        this.crowd.puppetGo(p, q.x, q.z, 1.2);
        break;
      }
    }
    r.wait = 3 + Math.random() * 4;
  }

  private talkTo(r: Run, dt: number): void {
    const a = r.a;
    const live = this.town.position(a.target);
    const tx = live?.x ?? a.target_x ?? this.player.x;
    const tz = live?.z ?? a.target_z ?? this.player.z;
    const p = this.ensure(r, { x: tx, z: tz }, dt, CLAIM_M);
    if (!p) {
      const pos = this.town.position(a.npc);
      if (pos && Math.hypot(pos.x - tx, pos.z - tz) < 2.5) void this.report(r, "arrived");
      return;
    }
    if (a.phase === "talking" || r.reported) {
      // face to face while the server writes their lines; hold the other one too
      const yaw = Math.atan2(tx - p.x, tz - p.z);
      if (this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "talk", yaw);
      if (live && !r.other) r.other = a.target;
      if (r.other) {
        const o = this.town.claim(r.other);
        if (o && (this.crowd.puppetBusy(o) || Math.abs(o.yaw - Math.atan2(p.x - o.x, p.z - o.z)) > 0.5)) this.crowd.puppetStand(o, "talk", Math.atan2(p.x - o.x, p.z - o.z));
      }
      return;
    }
    const d = Math.hypot(p.x - tx, p.z - tz);
    if (d > 2.3) {
      const L = d || 1;
      this.go(r, p, tx + ((p.x - tx) / L) * 1.5, tz + ((p.z - tz) / L) * 1.5, d > 12 ? 1.9 : 1.4, 0.6);
      if (this.stuck(r, d, dt)) void this.report(r, "blocked", { why: "wall" });
      return;
    }
    this.crowd.puppetStand(p, "talk", Math.atan2(tx - p.x, tz - p.z));
    r.other = live ? a.target : null;
    void this.report(r, "arrived");
  }

  /** Dev: the runs and where everyone is. */
  info() {
    return [...this.runs.values()].map((r) => {
      const pos = this.town.position(r.a.npc);
      return { id: r.a.id, npc: r.a.npc, name: r.a.name, kind: r.a.kind, phase: r.a.phase, target: r.a.target_name ?? r.a.target, puppet: !!r.p, d: pos ? +this.jefD(pos.x, pos.z).toFixed(1) : null, left: r.a.minutes_left, reported: r.reported };
    });
  }
}
