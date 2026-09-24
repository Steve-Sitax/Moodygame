import * as THREE from "three";
import { api, type ActionsPayload, type Convo, type EventScene, type PublicAction, type PushMsg } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import { STOPS as OMNIBUS_STOPS, type OmnibusStop } from "../world/omnibus";
import type { Crowd, Puppet } from "./crowd";
import type { Events } from "./events";
import type { Town } from "./town";
import { INSTRUMENTS, makeInstrument, playInstrument, type Instrument, type InstrumentKind } from "./instruments";
import { makeCoffin, makeWear, playWear, WARDROBE_ROLES, type Wear, type WardrobeRole } from "./wardrobe";

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
/** M4b: the lead roles that play an instrument. */
const PLAYS: Record<string, InstrumentKind> = { organ_grinder: "organ", fiddler: "fiddle", accordionist: "accordion" };
/** Leads who walk at another's side in a procession: the bride on the groom's arm; bearers two by two. */
const SIDE_BY_SIDE = 14;
/** A scuffle, in real seconds once the two stand face to face: words, then pushing and shoving. */
const SCUFFLE_WORDS_S = 5;
const SCUFFLE_SHOVE_S = 12;

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
  /** attend as a musician: standing in the middle, playing. */
  playing?: boolean;
  /** M4b: a scene's lines shown once (the shout, the agent's word, the loser's). */
  said?: Set<string>;
  /** M4b: a scene's walk issued (the thief's run, the agent's chase). */
  sceneGo?: number;
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
  /** The street musicians' instruments, by person (game/instruments.ts). */
  private instruments = new Map<string, { i: Instrument; p: Puppet }>();
  private clock = 0;
  /** M4b: the leads' wardrobe by person (game/wardrobe.ts), and the coffins by event. */
  private wear = new Map<string, { w: Wear; p: Puppet }>();
  private coffins = new Map<number, THREE.Group>();
  /** A scuffle's two first stood face to face (this.clock), by event. */
  /** A robbery's lift happened (this.clock), by event. */
  private lifted = new Map<number, number>();
  private faceToFace = new Map<number, { t: number; x: number; z: number }>();
  /** Set by main: show a line (a scene's shout) as a bubble. */
  showLines: (c: Convo) => void = () => {};

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
    this.playMusic(dt);
    this.dress();
    this.carryCoffins();
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
    if (r.p && this.crowd.puppetFollowing(r.p)) this.crowd.puppetFollow(r.p, null);
    if (r.p) r.p.human.root.rotation.set(0, 0, 0);
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
        // M6 families: someone comes to find Jef (a visit, the police's word, a man with a grudge)
        if ((a.kind as string) === "seek") return this.seek(r, dt);
        return;
    }
  }

  /**
   * M6 families: walk up to Jef and report "arrived" (the server then opens the talk, or has the
   * man say his piece); at Jef, stand facing him; a menace keeps on Jef's heels at a brisk walk,
   * so running (the server's RAN_M) is a real way out. Never a blow here: the server narrates.
   */
  private seek(r: Run, dt: number): void {
    const px = this.player.x;
    const pz = this.player.z;
    const p = this.ensure(r, { x: px, z: pz }, dt, CLAIM_M);
    if (!p) return;
    const d = this.jefD(p.x, p.z);
    const face = Math.atan2(px - p.x, pz - p.z);
    const phase = r.a.phase;
    if (phase === "going") {
      if (d > 2.2) {
        const L = d || 1;
        this.go(r, p, px + ((p.x - px) / L) * 1.5, pz + ((p.z - pz) / L) * 1.5, d > 14 ? 1.9 : 1.45, 0.5);
        if (this.stuck(r, d, dt, 20)) void this.report(r, "blocked", { why: "wall" });
        return;
      }
      this.crowd.puppetStand(p, "talk", face);
      return void this.report(r, "arrived");
    }
    // a menace keeps on Jef's heels; a visitor waiting to talk stays by him (also after a reload)
    if ((phase === "menace" && d > 1.9) || (phase === "at_jef" && d > 2.6)) {
      const L = d || 1;
      this.go(r, p, px + ((p.x - px) / L) * 1.3, pz + ((p.z - pz) / L) * 1.3, phase === "menace" ? 2.1 : 1.6, 0.35);
      return;
    }
    if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
      this.crowd.puppetStand(p, phase === "menace" || Math.random() < 0.5 ? "talk" : "idle", face);
      r.wait = 1.5;
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
    // M4b: a lead in a scene now playing (a scuffle, a robbery): the scene moves them
    const scene = attend && a.lead ? this.events.sceneOf(a.event_id) : null;
    if (scene && !scene.resolved && (a.npc === scene.a || a.npc === scene.b || a.npc === scene.agent)) {
      const p = this.ensure(r, { x: a.target_x ?? this.player.x, z: a.target_z ?? this.player.z }, dt, ATTEND_CLAIM_M);
      if (p) this.playScene(r, p, scene, dt);
      return;
    }
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
    // M4b: the bride on the groom's arm, the bearers two by two (crowd.puppetFollow keeps them at the side)
    const partner = attend && a.phase === "procession" ? this.partnerOf(a) : null;
    if (partner) {
      const pp = this.town.puppet(partner);
      if (pp && this.crowd.alive(pp) && Math.hypot(pp.x - p.x, pp.z - p.z) < SIDE_BY_SIDE) {
        this.crowd.puppetFollow(p, pp);
        r.playing = false;
        return;
      }
    }
    if (this.crowd.puppetFollowing(p)) this.crowd.puppetFollow(p, null);
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
      r.playing = false;
      const pace = !attend ? 1.5 : a.phase === "procession" ? 0.95 : d <= 6 ? 1.1 : r.how === "run" ? 2.5 : 1.45;
      this.go(r, p, gx, gz, pace, attend ? 0.9 : 0.6);
      if (this.stuck(r, d, dt, attend ? 20 : STUCK_S)) {
        if (!attend) void this.report(r, "blocked", { why: "wall" });
        else if (!this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "idle", null);
      }
      return;
    }
    if (!attend) return void this.report(r, "arrived");
    const c = this.events.centreOf(a.event_id);
    // a street musician: in the middle, facing out to the crowd, playing (Steve: "no musicians visible")
    if (a.role === "musicians" || (a.lead && PLAYS[a.lead])) {
      r.playing = true;
      if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
        const yaw = c ? Math.atan2(p.x - c.x, p.z - c.z) : null;
        this.crowd.puppetStand(p, "talk", yaw);
        r.wait = 6 + Math.random() * 4;
      }
      return;
    }
    // M4b: a lead stands in the middle and faces the people who came to look (Jef, when he is near)
    if (a.lead) {
      if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
        const jd = this.jefD(p.x, p.z);
        // two who will quarrel eye each other; the pickpocket and his mark do not play to Jef
        const rival = a.lead === "quarreller" || a.lead === "drunkard" ? this.list.find((o) => o.event_id === a.event_id && o.npc !== a.npc && (o.lead === "quarreller" || o.lead === "drunkard")) : null;
        const rp = rival ? this.town.position(rival.npc) : null;
        const quiet = a.lead === "pickpocket" || a.lead === "victim" || a.lead === "bearers" || a.lead === "agent";
        const yaw = rp ? Math.atan2(rp.x - p.x, rp.z - p.z) : quiet ? null : jd < 30 ? Math.atan2(this.player.x - p.x, this.player.z - p.z) : c ? Math.atan2(p.x - c.x, p.z - c.z) : null;
        const motion = a.lead === "speaker" || a.lead === "auctioneer" || a.lead === "hawker" || a.lead === "showman" ? (Math.random() < 0.7 ? "talk" : "idle") : a.lead === "widow" || a.lead === "priest" ? "fold" : a.lead === "agent" ? "behind" : Math.random() < 0.25 ? "talk" : "idle";
        this.crowd.puppetStand(p, motion, yaw);
        r.wait = 3 + Math.random() * 3;
      }
      return;
    }
    // there: face the middle of it, and talk now and then like a crowd
    if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
      const yaw = c ? Math.atan2(c.x - p.x, c.z - p.z) : null;
      const mood = this.events.moodOf(a.event_id);
      const talk = Math.random() < (mood === "solemn" ? 0.1 : 0.35);
      this.crowd.puppetStand(p, talk ? "talk" : mood === "solemn" ? "fold" : "idle", yaw);
      r.wait = talk ? 2.5 + Math.random() * 2 : 4 + Math.random() * 6;
    }
  }

  /** Musicians who stand and play get their instrument; anyone else loses theirs. */
  private playMusic(dt: number): void {
    this.clock += dt;
    const want = new Map<string, { r: Run; p: Puppet }>();
    for (const r of this.runs.values()) if (r.playing && r.p && (r.a.role === "musicians" || (r.a.lead && PLAYS[r.a.lead])) && r.a.kind === "attend") want.set(r.a.npc, { r, p: r.p });
    for (const [id, e] of this.instruments) {
      const w = want.get(id);
      if (w && w.p === e.p) continue;
      e.i.root.removeFromParent();
      this.instruments.delete(id);
    }
    for (const [id, w] of want) {
      if (this.instruments.has(id)) continue;
      const i = makeInstrument((w.r.a.lead && PLAYS[w.r.a.lead]) || INSTRUMENTS[w.r.a.order % INSTRUMENTS.length]);
      w.p.group.add(i.root);
      this.instruments.set(id, { i, p: w.p });
    }
    for (const e of this.instruments.values()) playInstrument(e.i, this.clock);
  }

  // ------------------------------------------------------------------ M4b: leads

  /** The one this lead walks beside in a procession: the bride beside the groom, bearer 1 beside 0, 3 beside 2. */
  private partnerOf(a: PublicAction): string | null {
    const want = a.lead === "bride" ? { lead: "groom", n: 0 } : a.lead === "bearers" && a.n % 2 === 1 ? { lead: "bearers", n: a.n - 1 } : null;
    if (!want) return null;
    return this.list.find((o) => o.event_id === a.event_id && o.lead === want.lead && (want.lead !== "bearers" || o.n === want.n))?.npc ?? null;
  }

  /** Leads wear their part (game/wardrobe.ts) while they are in the street; it comes off when the run ends. */
  private dress(): void {
    const want = new Map<string, { role: WardrobeRole; p: Puppet }>();
    for (const r of this.runs.values()) {
      const l = r.a.lead;
      if (r.a.kind !== "attend" || !l || !r.p || !this.crowd.alive(r.p)) continue;
      if (WARDROBE_ROLES.has(l)) want.set(r.a.npc, { role: l as WardrobeRole, p: r.p });
      // the one robbed carries her shopping
      if (l === "victim" && !r.p.bought) this.crowd.puppetCarry(r.p, this.town.info(r.a.npc)?.sex === "f" ? "basket" : "parcel");
    }
    for (const [id, e] of this.wear) {
      const w = want.get(id);
      if (w && w.p === e.p) continue;
      e.w.root.removeFromParent();
      e.p.human.root.rotation.set(0, 0, 0);
      this.wear.delete(id);
    }
    for (const [id, w] of want) {
      if (this.wear.has(id)) continue;
      const wear = makeWear(w.role, w.p.human.scale);
      w.p.group.add(wear.root);
      this.wear.set(id, { w: wear, p: w.p });
    }
    for (const [id, e] of this.wear) {
      playWear(e.w, this.clock);
      // the drunk sways on his feet
      if (e.w.role === "drunkard" && !this.crowd.puppetBusy(e.p)) e.p.human.root.rotation.z = Math.sin(this.clock * 1.3 + e.w.phase) * 0.07;
      // the purse shows in the pickpocket's hand once the scene says it is his
      if (e.w.parts.purse) e.w.parts.purse.visible = this.hasPurse(id);
    }
  }

  private hasPurse(id: string): boolean {
    const r = [...this.runs.values()].find((x) => x.a.npc === id);
    if (!r) return false;
    const sc = this.events.sceneOf(r.a.event_id);
    return !!sc && sc.kind === "robbery" && sc.a === id && (this.lifted.has(r.a.event_id ?? 0) || this.events.stageT(r.a.event_id) >= 0.9);
  }

  /** The coffin rides on the bearers' shoulders: between them, along the way they face. */
  private carryCoffins(): void {
    const byEvent = new Map<number, Puppet[]>();
    for (const r of this.runs.values()) {
      if (r.a.lead !== "bearers" || !r.p || r.a.event_id === null || !this.crowd.alive(r.p)) continue;
      const list = byEvent.get(r.a.event_id) ?? [];
      list[r.a.n] = r.p;
      byEvent.set(r.a.event_id, list);
    }
    for (const [id, g] of this.coffins) {
      if (byEvent.has(id)) continue;
      g.removeFromParent();
      this.coffins.delete(id);
    }
    for (const [id, list] of byEvent) {
      const ps = list.filter(Boolean);
      let g = this.coffins.get(id);
      if (!g) {
        g = makeCoffin();
        this.world.scene.add(g);
        this.coffins.set(id, g);
      }
      const cx = ps.reduce((a, p) => a + p.x, 0) / (ps.length || 1);
      const cz = ps.reduce((a, p) => a + p.z, 0) / (ps.length || 1);
      const together = ps.length >= 2 && ps.every((p) => Math.hypot(p.x - cx, p.z - cz) < 3);
      g.visible = together;
      if (!together) continue;
      // along the line from the back pair to the front pair (or the way the first bearer faces)
      const front = ps.slice(0, 2);
      const back = ps.slice(2);
      const fx = front.reduce((a, p) => a + p.x, 0) / front.length;
      const fz = front.reduce((a, p) => a + p.z, 0) / front.length;
      const bx = back.length ? back.reduce((a, p) => a + p.x, 0) / back.length : cx;
      const bz = back.length ? back.reduce((a, p) => a + p.z, 0) / back.length : cz;
      const yaw = Math.hypot(fx - bx, fz - bz) > 0.4 ? Math.atan2(fx - bx, fz - bz) : ps[0].yaw;
      const lift = 1.5 * (ps[0].human.scale || 1) * (ps[0].size || 1);
      g.position.set(cx, this.world.groundAt(cx, cz, 0.3, 0) + lift, cz);
      g.rotation.set(0, yaw, 0);
    }
  }

  // ------------------------------------------------------------------ M4b: the scenes (no combat)

  /** A line from the engine's scene, once, as a bubble over the speaker. */
  private sayOnce(r: Run, key: string, who: string | null, text: string | undefined): void {
    if (!who || !text) return;
    r.said ??= new Set();
    if (r.said.has(key)) return;
    r.said.add(key);
    const info = this.town.info(who);
    const id = -Math.abs((r.a.event_id ?? 0) * 100 + key.length * 7 + key.charCodeAt(0));
    this.showLines({ id, a: who, b: who, a_name: info?.name ?? "", b_name: info?.name ?? "", purpose: "scene", lines: [{ who, name: info?.first ?? "", text }], source: "engine", outcome: "", at: Date.now(), event_id: r.a.event_id });
  }

  /**
   * A scuffle or a robbery, played by the stage's clock (0..1, events.stageT). The engine
   * already decided how it ends; this side only shows it. Nobody is hurt: a scuffle is a lunge
   * and a stagger back, the police part them; a robbery is a lift, a shout and a run.
   */
  private playScene(r: Run, p: Puppet, sc: EventScene, dt: number): void {
    const a = r.a;
    const t = this.events.stageT(a.event_id);
    const me = a.npc;
    const spot = { x: a.target_x ?? p.x, z: a.target_z ?? p.z };
    const pos = (id: string | null) => (id ? this.town.position(id) : null);
    const lean = (x: number) => (p.human.root.rotation.x = x);
    if (sc.kind === "scuffle") {
      const other = me === sc.a ? sc.b : me === sc.b ? sc.a : null;
      const ag = pos(sc.agent);
      const c = this.events.centreOf(a.event_id) ?? spot;
      const agentThere = !!ag && Math.hypot(ag.x - c.x, ag.z - c.z) < 3;
      // the scene's own clock starts when both of them stand face to face (one may come from far):
      // words for a few seconds, then shoving, then parted (the agent there, or it has gone on long enough)
      const pa = pos(sc.a);
      const pb = pos(sc.b);
      const key = a.event_id ?? 0;
      if (pa && pb && Math.hypot(pa.x - pb.x, pa.z - pb.z) < 3 && !this.faceToFace.has(key)) this.faceToFace.set(key, { t: this.clock, x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 });
      const met = this.faceToFace.get(key);
      const since = met ? this.clock - met.t : -1;
      const parted = t >= 0.97 || since > SCUFFLE_WORDS_S + SCUFFLE_SHOVE_S || (agentThere && since > SCUFFLE_WORDS_S + 4);
      if (me === sc.agent) {
        // the agent comes at a run once the shoving starts, and stands between them
        const d = Math.hypot(p.x - spot.x, p.z - spot.z);
        if (d > 1.4) this.go(r, p, spot.x, spot.z, since >= 0 ? 2.4 : 1.5, 0.8);
        else {
          const w = pos(sc.wrong);
          if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
            this.crowd.puppetStand(p, "talk", w ? Math.atan2(w.x - p.x, w.z - p.z) : null);
            r.wait = 2.5;
          }
          if (parted) this.sayOnce(r, "part", me, sc.lines.agent);
        }
        return;
      }
      const o = pos(other);
      if (!o) return;
      // along the line from the middle (where they met) to the other one
      const dx = o.x - (met?.x ?? p.x);
      const dz = o.z - (met?.z ?? p.z);
      const L = Math.hypot(dx, dz) || 1;
      const ux = dx / L;
      const uz = dz / L;
      const face = Math.atan2(o.x - p.x, o.z - p.z);
      if (since < 0 && !parted) {
        // not face to face yet: go up to the other one
        if (Math.hypot(p.x - o.x, p.z - o.z) > 1.6) this.go(r, p, o.x, o.z, 1.5, 0.8);
        else if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
          this.crowd.puppetStand(p, "talk", face);
          r.wait = 1;
        }
        return;
      }
      if (parted) {
        // stepped apart, two paces back, arms folded; the one in the wrong says his piece
        lean(0);
        const bx = (met?.x ?? spot.x) - ux * 1.6;
        const bz = (met?.z ?? spot.z) - uz * 1.6;
        if (Math.hypot(p.x - bx, p.z - bz) > 0.5 && !this.crowd.puppetBusy(p) && (r.sceneGo ?? 0) < 2) {
          r.sceneGo = (r.sceneGo ?? 0) + 1;
          this.crowd.puppetGo(p, bx, bz, 1.0);
        } else if (!this.crowd.puppetBusy(p) && (r.wait -= dt) <= 0) {
          this.crowd.puppetStand(p, "fold", ag ? Math.atan2(ag.x - p.x, ag.z - p.z) : face);
          r.wait = 3;
        }
        if (me === sc.wrong && (agentThere || t >= 0.9)) this.sayOnce(r, "sorry", me, sc.lines.sorry);
        return;
      }
      if (since < SCUFFLE_WORDS_S) {
        // words first: face to face, hands going
        lean(0);
        if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0 || p.pmotion !== "talk") {
          this.crowd.puppetStand(p, "talk", face);
          r.wait = 2;
        }
        return;
      }
      // pushing and shoving: turn about, a lunge half a pace in and a stagger back, never a blow
      if (this.crowd.puppetBusy(p) || p.pmotion !== "idle") this.crowd.puppetStand(p, "idle", face);
      p.yaw = face;
      const cycle = Math.floor(this.clock / 1.5);
      const u = (this.clock % 1.5) / 1.5;
      const shover = (cycle % 3 === 2) === (sc.wrong === sc.a) ? sc.b : sc.a;
      const iShove = me === shover;
      let off = 0;
      let tilt = 0;
      if (iShove) {
        const k = u < 0.3 ? Math.sin((u / 0.3) * Math.PI) : 0;
        off = 0.35 * k;
        tilt = 0.3 * k;
      } else {
        const k = u > 0.15 && u < 0.6 ? Math.sin(((u - 0.15) / 0.45) * Math.PI) : 0;
        off = -0.45 * k;
        tilt = -0.22 * k;
      }
      // my side of the middle, 0.55 m from it, moved in or out along the line between us
      const mid = met ?? { x: (p.x + o.x) / 2, z: (p.z + o.z) / 2 };
      const base = { x: mid.x - ux * 0.55, z: mid.z - uz * 0.55 };
      const nx = base.x + ux * off;
      const nz = base.z + uz * off;
      if (this.world.isFree(nx, nz, 0.2)) {
        p.x = nx;
        p.z = nz;
      }
      lean(tilt);
      return;
    }

    // a robbery: the lift happens when he is up close behind her (or late in the stage, whatever)
    const victim = pos(sc.b);
    const vp = this.town.puppet(sc.b);
    const key = a.event_id ?? 0;
    const lifted = this.lifted.has(key) || t >= 0.9;
    if (me === sc.b) {
      const d = Math.hypot(p.x - spot.x, p.z - spot.z);
      if (d > 1.2 && !lifted) {
        this.go(r, p, spot.x, spot.z, 1.2, 0.8);
        return;
      }
      if (!lifted) {
        // looking at the stalls, her back to the square
        if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
          this.crowd.puppetStand(p, "idle", null);
          r.wait = 5;
        }
        return;
      }
      // the shout: she turns to where he ran
      const th = pos(sc.a);
      if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
        this.crowd.puppetStand(p, "talk", th ? Math.atan2(th.x - p.x, th.z - p.z) : null);
        r.wait = 1.5;
      }
      this.sayOnce(r, "shout", me, sc.lines.shout);
      return;
    }
    if (me === sc.a) {
      if (t < 0.3 && !lifted) {
        const d = Math.hypot(p.x - spot.x, p.z - spot.z);
        if (d > 1.4) return void this.go(r, p, spot.x, spot.z, 1.1, 0.8);
        if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
          this.crowd.puppetStand(p, "behind", victim ? Math.atan2(victim.x - p.x, victim.z - p.z) : null);
          r.wait = 3;
        }
        return;
      }
      if (!lifted && victim) {
        // up close behind her, where she cannot see him; the lift
        const vy = vp?.yaw ?? 0;
        const bx = victim.x - Math.sin(vy) * 0.55;
        const bz = victim.z - Math.cos(vy) * 0.55;
        const d = Math.hypot(p.x - bx, p.z - bz);
        if (d > 0.6) {
          this.go(r, p, bx, bz, d > 3 ? 1.2 : 0.8, 0.5);
          r.wait = 1.5;
        } else {
          if (this.crowd.puppetBusy(p) || p.pmotion !== "idle") this.crowd.puppetStand(p, "idle", Math.atan2(victim.x - p.x, victim.z - p.z));
          // a moment close behind her: the purse is his
          if ((r.wait -= dt) <= 0 && t >= 0.35) this.lifted.set(key, this.clock);
        }
        return;
      }
      // the run: away to the engine's point; caught, he stops there with his hands behind his back
      const f = sc.flee ?? spot;
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      const ag = pos(sc.agent);
      const away = victim ? Math.hypot(p.x - victim.x, p.z - victim.z) : 99;
      if (sc.caught && ag && Math.hypot(ag.x - p.x, ag.z - p.z) < 1.6 && (away > 8 || d <= 1.2)) {
        if (this.crowd.puppetBusy(p) || p.pmotion !== "behind") this.crowd.puppetStand(p, "behind", Math.atan2(ag.x - p.x, ag.z - p.z));
        return;
      }
      if (d > 1.2) {
        if (!this.crowd.puppetBusy(p) || (r.sceneGo ?? 0) === 0) {
          r.sceneGo = (r.sceneGo ?? 0) + 1;
          this.crowd.puppetGo(p, f.x, f.z, 2.9);
        }
      } else if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
        this.crowd.puppetStand(p, sc.caught ? "behind" : "idle", null);
        r.wait = 3;
      }
      return;
    }
    if (me === sc.agent) {
      const th = pos(sc.a);
      if (!lifted || !th) {
        const d = Math.hypot(p.x - spot.x, p.z - spot.z);
        if (d > 1.5) this.go(r, p, spot.x, spot.z, 1.3, 0.9);
        else if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
          this.crowd.puppetStand(p, "behind", null);
          r.wait = 4;
        }
        return;
      }
      const d = Math.hypot(p.x - th.x, p.z - th.z);
      if (sc.caught) {
        if (d > 1.3) this.go(r, p, th.x, th.z, 2.7, 0.4);
        else {
          if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
            this.crowd.puppetStand(p, "talk", Math.atan2(th.x - p.x, th.z - p.z));
            r.wait = 2;
          }
          this.sayOnce(r, "agent", me, sc.lines.agent);
        }
        return;
      }
      // not caught: he gives chase, then gives up
      if (this.clock - (this.lifted.get(key) ?? this.clock) < 9 && t < 0.97 && d > 1.3) this.go(r, p, th.x, th.z, 2.5, 0.5);
      else {
        if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0) {
          this.crowd.puppetStand(p, "idle", Math.atan2(th.x - p.x, th.z - p.z));
          r.wait = 3;
        }
        this.sayOnce(r, "agent", me, sc.lines.agent);
      }
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
      return { id: r.a.id, npc: r.a.npc, name: r.a.name, kind: r.a.kind, lead: r.a.lead, phase: r.a.phase, target: r.a.target_name ?? r.a.target, puppet: !!r.p, d: pos ? +this.jefD(pos.x, pos.z).toFixed(1) : null, at: pos ? [+pos.x.toFixed(1), +pos.z.toFixed(1)] : null, left: r.a.minutes_left, reported: r.reported, wears: this.wear.has(r.a.npc) || this.instruments.has(r.a.npc), side: r.p ? this.crowd.puppetFollowing(r.p) : false };
    });
  }
}
