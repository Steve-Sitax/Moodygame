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
/**
 * Fixes 2026-09-24 (a game hour is 20 s of play, so a crowd that walked the whole way came when
 * the event was half over; the ballad listeners and the dawn hiring's men): coming to an event,
 * unseen, they cross town in about this many seconds of play (a few game minutes); an omnibus
 * is waited for this long at most; and near the event, out of Jef's sight, they step into the
 * street at the first place that is out of view (or, far from Jef, right at their own place).
 */
const ATTEND_HIDDEN_S = 6;
const TRAM_EVENT_WAIT_S = 15;
const CLAIM_RETRY_S = 0.4;
/** On the way to an event and no nearer for this long (real seconds; was 20, a quarter of a game hour): another way. */
const ATTEND_STUCK_S = 10;
/** In the street out of Jef's sight and further than this from the place: they go on unseen. */
const HIDE_AWAY_M = 22;
/** Unseen at their place and Jef further off than this: they are simply there when he comes. */
const ATTEND_POP_M = 30;
/** The roles that may come by omnibus (onlookers; never the men for hire, the chain or the leads). */
const TRAM_ROLES = new Set(["crowd", "guests", "mourners", "children"]);

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
const SCUFFLE_SHOVE_S = 14;
/** The agent parts them only after this much shoving (real seconds). */
const SCUFFLE_SHOVE_MIN_S = 8;
/** A scuffle's two start at once when they have not met at their meeting point after this long (real seconds). */
const SCUFFLE_MEET_S = 8;

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
  /** M6 transport: the stop they get on at (the nearest of the line), and whether they are aboard. */
  tramBoard?: OmnibusStop;
  tramOn?: boolean;
  /** Stuck on the way to an event: how often a new way was tried, and whether they gave up (stand). */
  replans?: number;
  gaveUp?: boolean;
  /** attend as a musician: standing in the middle, playing. */
  playing?: boolean;
  /** M4b: a scene's lines shown once (the shout, the agent's word, the loser's). */
  said?: Set<string>;
  /** M4b: a scene's walk issued (the thief's run, the agent's chase). */
  sceneGo?: number;
  /** Attend: the next try to step into the street near the event, and where (fixes 2026-09-24). */
  claimT?: number;
  out?: { x: number; z: number };
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
  /** A scuffle's meeting point by event: a free spot by their middle, the line between them, when it was set. */
  private meetAt = new Map<number, { x: number; z: number; ux: number; uz: number; since: number }>();
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
      // sent on to a new place (the hiring's men to the tavern): report arriving there too
      if (had && a.kind === "attend" && had.a.phase !== "going" && a.phase === "going") had.reported = false;
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
    // M6 transport: a velocipede taken for the action is home again
    this.town.journeys?.actionDone(r.a.npc);
    if (r.tramOn) this.town.setAboard(r.a.npc, false);
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
    if (r.a.kind === "attend" && toward) return this.ensureAttend(r, toward, pos, d, dt, range);
    // a guest on the way to a gathering Jef can see: they step out of sight close to it, not across town
    if (d > range) {
      r.p = null;
      // M6 transport: unseen, at the pace of the way they go (their own velocipede, if it is at home)
      if (toward) this.town.moveHidden(r.a.npc, toward.x, toward.z, dt, this.town.hiddenPace(r.a.npc, toward.x, toward.z));
      return null;
    }
    const p = this.town.claimNear(r.a.npc, { x: this.player.x, z: this.player.z });
    r.p = p;
    return p;
  }

  /**
   * Coming to an event (fixes 2026-09-24). Unseen they cross town in ATTEND_HIDDEN_S; near it
   * they step into the street out of Jef's sight, a ring further out each try (never stuck
   * unseen for good, as the Hessenatie's men and the ballad's listeners were); unseen at their
   * own place with Jef still far off, they are simply standing there when he comes.
   */
  private ensureAttend(r: Run, toward: { x: number; z: number }, pos: { x: number; z: number; shown: boolean } | null, d: number, dt: number, range: number): Puppet | null {
    const id = r.a.npc;
    const toGoal = pos ? Math.hypot(pos.x - toward.x, pos.z - toward.z) : Infinity;
    const jefToGoal = this.jefD(toward.x, toward.z);
    const pace = Math.max(this.town.hiddenPace(id, toward.x, toward.z), (Number.isFinite(toGoal) ? toGoal : 0) / ATTEND_HIDDEN_S);
    // far from Jef, going somewhere he cannot see: on unseen, quickly
    if (d > range && jefToGoal >= range) {
      r.p = null;
      this.town.moveHidden(id, toward.x, toward.z, dt, pace);
      return null;
    }
    // in the street already: walked there, on the walk grid round Jef (one standing far off it
    // cannot find a way: the ballad singer stood at the Steenplein all morning; moveHidden
    // takes such a one out of the street and on unseen)
    const have = this.town.puppet(id);
    if (have && this.crowd.alive(have)) {
      // out of sight and far from the place: on unseen, and out again near it
      const left = Math.hypot(have.x - toward.x, have.z - toward.z);
      if (!have.shown && left > HIDE_AWAY_M && this.jefD(have.x, have.z) > 12 && this.town.hideAway(id)) {
        r.p = null;
        r.claimT = CLAIM_RETRY_S;
        return null;
      }
      if (d > range && !this.crowd.onGrid(have.x, have.z)) this.town.moveHidden(id, toward.x, toward.z, dt, pace);
      else {
        r.p = this.town.claim(id);
        return r.p;
      }
    }
    r.p = null;
    if (!pos) {
      // indoors: out of the door first
      this.town.moveHidden(id, toward.x, toward.z, dt, pace);
      return null;
    }
    r.claimT = (r.claimT ?? 0) - dt;
    // Jef is not by the place: to it unseen, and simply there (they step out at their own place
    // while he is still 30 m or more from them)
    if (jefToGoal > ATTEND_POP_M) {
      if (toGoal > 0.5) this.town.moveHidden(id, toward.x, toward.z, dt, pace);
      if (toGoal < 3 && r.claimT <= 0) {
        r.claimT = CLAIM_RETRY_S;
        const p = d > ATTEND_POP_M ? this.town.claim(id, this.crowd.openNear(pos.x, pos.z) ?? pos) : this.town.claimNear(id, toward, 12) ?? this.town.claimNear(id, toward, 30);
        if (p) return (r.p = p);
      }
      return null;
    }
    // Jef is by the place: they step out of his sight on their own way to it, 6 to 40 m of walk
    // before it (not behind a block of houses, as the ring did: the Hessenatie's men came out
    // behind the warehouses and walked round the block too late for the call)
    if (toGoal > 45) {
      this.town.moveHidden(id, toward.x, toward.z, dt, pace);
      return null;
    }
    if (r.claimT <= 0) {
      r.claimT = CLAIM_RETRY_S;
      const out = r.out && this.crowd.isHidden(r.out.x, r.out.z) ? r.out : this.stepOut(pos, toward);
      r.out = out ?? undefined;
      if (out && Math.hypot(pos.x - out.x, pos.z - out.z) < 1.2) {
        const p = this.town.claim(id, out);
        if (p) {
          r.out = undefined;
          return (r.p = p);
        }
      }
      if (!out) {
        // no way on the walk grid out of his sight: out of sight near the place (a ring further out each time), else near him
        const p = this.town.claimNear(id, toward, 12) ?? this.town.claimNear(id, toward, 30) ?? (d <= range ? this.town.claimNear(id, { x: this.player.x, z: this.player.z }) : null);
        if (p) return (r.p = p);
      }
    }
    if (r.out) this.town.moveHidden(id, r.out.x, r.out.z, dt, Math.max(pace, 6));
    else if (toGoal > 13.5) {
      const L = toGoal || 1;
      this.town.moveHidden(id, toward.x + ((pos.x - toward.x) / L) * 13, toward.z + ((pos.z - toward.z) / L) * 13, dt, pace);
    }
    return null;
  }

  /** A point on the walk from `from` to the place, 6 to 40 m of walk before it, out of Jef's sight and free to stand on. */
  private stepOut(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number } | null {
    const path = this.crowd.pathOn(from.x, from.z, to.x, to.z);
    const start = this.crowd.openNear(from.x, from.z);
    if (!path?.length || !start) return null;
    const pts = [start, ...path];
    let acc = 0;
    for (let i = pts.length - 1; i > 0; i--) {
      const b = pts[i];
      const a = pts[i - 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 0; t < L; t += 1) {
        const dd = acc + t;
        if (dd > 40) return null;
        const x = b.x + ((a.x - b.x) * t) / (L || 1);
        const z = b.z + ((a.z - b.z) * t) / (L || 1);
        if (dd >= 6 && this.crowd.isHidden(x, z) && this.crowd.canStand(x, z) && this.world.isFree(x, z, 0.3)) return { x, z };
      }
      acc += L;
    }
    return null;
  }

  private go(r: Run, p: Puppet, x: number, z: number, pace: number, every = 0.45): void {
    r.goT -= 1 / 60;
    if (r.goT > 0) return;
    r.goT = every;
    this.crowd.puppetGo(p, x, z, pace);
  }

  /** A puppet standing where nobody can stand (the walk map's colliders): a step to the nearest free spot (2 m at most). */
  private unwedge(p: Puppet): boolean {
    if (this.world.isFree(p.x, p.z, 0.3)) return false;
    for (let rr = 0.5; rr <= 2; rr += 0.5)
      for (let k = 0; k < 8; k++) {
        const x = p.x + Math.cos((k / 8) * Math.PI * 2) * rr;
        const z = p.z + Math.sin((k / 8) * Math.PI * 2) * rr;
        if (this.world.isFree(x, z, 0.3) && this.crowd.canStand(x, z)) {
          p.x = x;
          p.z = z;
          return true;
        }
      }
    return false;
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
    // a menace keeps on Jef's heels; a visitor waiting to talk stays by him (also after a reload).
    // Far off: the same walk as going (a path re-asked too often never gets anywhere); close: brisk.
    if ((phase === "menace" && d > 1.9) || (phase === "at_jef" && d > 2.6)) {
      const L = d || 1;
      const far = d > 8;
      this.go(r, p, px + ((p.x - px) / L) * 1.3, pz + ((p.z - pz) / L) * 1.3, phase === "menace" ? 2.1 : far ? 1.9 : 1.45, far ? 0.5 : 0.35);
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
    // the fire's bucket chain: they run, never wait for an omnibus
    if ((a.role as string) === "chain") return (r.how = "run");
    const h = hash01(`${a.npc}:${a.event_id}`);
    const pos = this.town.position(a.npc);
    // (fixes 2026-09-24: someone indoors counted as far, and the dawn hiring's men waited for an
    // omnibus at dawn; only onlookers take it, and only from far)
    const far = !!pos && Math.hypot(pos.x - tx, pos.z - tz) > TRAM_FROM_M && TRAM_ROLES.has(a.role as string) && !a.lead;
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

  /**
   * By omnibus (M6 transport: a real ride, no fare for residents): unseen to the stop of the line
   * nearest them, on the next omnibus that stands there, riding inside it, and off the back
   * platform at the event's stop (omnibus.ts, journeys.ts offBus).
   */
  private byTram(r: Run, dt: number): Puppet | null {
    r.tramT = (r.tramT ?? 0) + dt;
    const id = r.a.npc;
    const stop = r.tramStop!;
    const j = this.town.journeys;
    const om = this.world.omnibus();
    if (!j || !om) {
      r.how = "walk";
      return null;
    }
    if (!r.tramBoard) {
      r.tramBoard = j.busFor(id, stop) ?? undefined;
      if (!r.tramBoard) {
        r.how = "walk";
        return null;
      }
    }
    if (!r.tramOn) {
      const b = r.tramBoard;
      this.town.moveHidden(id, b.post[0], b.post[1], dt);
      const pos = this.town.position(id);
      if (pos && Math.hypot(pos.x - b.post[0], pos.z - b.post[1]) < 3) {
        const bus = om.buses.find((q) => {
          const at = q.atStop();
          return !!at && at.id === b.id && at.line === b.line;
        });
        if (bus && j.boardFor(id, bus, stop)) {
          r.tramOn = true;
          this.town.setAboard(id, true);
        }
      }
      if (r.tramT > Math.min(TRAM_WAIT_S * 2.5, TRAM_EVENT_WAIT_S)) r.how = "walk"; // no omnibus came: they walk after all
      return null;
    }
    // riding: where the omnibus goes, until they step off at the stop
    const off = j.takeOff(id);
    if (off) {
      this.town.setAboard(id, false);
      r.tramOn = false;
      const p = this.town.claim(id, { x: off.x, z: off.z });
      if (p) {
        r.how = "walk";
        return p;
      }
      return null;
    }
    const ride = om.residents().find((q) => q.id === id);
    if (ride) {
      const q = om.buses[ride.bus].pose();
      this.town.placeHidden(id, q.x, q.z);
    } else if (r.tramT > 5) {
      // not on any omnibus (a reload of the buses): on foot from here
      this.town.setAboard(id, false);
      r.tramOn = false;
      r.how = "walk";
    }
    return null;
  }
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
      const pace = !attend ? 1.5 : a.phase === "procession" ? 0.95 : d <= 6 ? 1.1 : r.how === "run" ? 2.5 : d > 15 ? 1.75 : 1.45;
      // gave up on the way after several tries: they stand where they are (once), and look on from
      // there, until the event moves on (a procession starts: a new way)
      if (r.gaveUp && (r as Run & { gavePhase?: string }).gavePhase !== a.phase) {
        r.gaveUp = false;
        r.replans = 0;
      }
      if (attend && r.gaveUp) return;
      this.go(r, p, gx, gz, pace, attend ? 0.9 : 0.6);
      if (this.stuck(r, d, dt, attend ? ATTEND_STUCK_S : STUCK_S)) {
        if (!attend) void this.report(r, "blocked", { why: "wall" });
        else if (this.unwedge(p)) {
          // stood in something (a doorstep, a cart put down beside them): a step out, and on again
          r.stuckT = 0;
          r.bestD = Infinity;
          r.goT = 0;
        } else {
          // a new way: to an open point beside the goal, a little further round each time; after four, stand
          r.replans = (r.replans ?? 0) + 1;
          r.stuckT = 0;
          r.bestD = Infinity;
          if (r.replans <= 4) {
            const ang = Math.random() * Math.PI * 2;
            const rr = 1.5 + r.replans * 1.5;
            const q = this.crowd.openNear(gx + Math.cos(ang) * rr, gz + Math.sin(ang) * rr) ?? { x: gx, z: gz };
            this.crowd.puppetGo(p, q.x, q.z, pace);
            r.goT = 4; // let the new way run a while before aiming at the goal again
          } else {
            r.gaveUp = true;
            (r as Run & { gavePhase?: string }).gavePhase = a.phase;
            this.crowd.puppetStand(p, "idle", null);
          }
        }
      }
      return;
    }
    if (!attend) return void this.report(r, "arrived");
    // at their place: "there" on the server (it no longer says "going" all through the event)
    if (a.phase === "going" && !r.reported) void this.report(r, "arrived");
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

  /**
   * Where a scuffle's two meet: a free spot near the middle of the two (toward the event's centre
   * if the middle is taken, a stall say), with room for both, and the line from a to b.
   */
  private meetingPoint(pa: { x: number; z: number }, pb: { x: number; z: number }, c: { x: number; z: number }): { x: number; z: number; ux: number; uz: number } {
    let ux = pb.x - pa.x;
    let uz = pb.z - pa.z;
    const L = Math.hypot(ux, uz);
    if (L < 0.2) {
      ux = 1;
      uz = 0;
    } else {
      ux /= L;
      uz /= L;
    }
    const mid = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
    const ok = (x: number, z: number) => this.world.isFree(x - ux * 0.6, z - uz * 0.6, 0.25) && this.world.isFree(x + ux * 0.6, z + uz * 0.6, 0.25) && this.crowd.canStand(x, z);
    for (const t of [0, 0.3, 0.6, 1]) {
      const x = mid.x + (c.x - mid.x) * t;
      const z = mid.z + (c.z - mid.z) * t;
      for (let rr = 0; rr <= 2; rr += 0.5)
        for (let k = 0; k < (rr ? 8 : 1); k++) {
          const qx = x + Math.cos((k / 8) * Math.PI * 2) * rr;
          const qz = z + Math.sin((k / 8) * Math.PI * 2) * rr;
          if (ok(qx, qz)) return { x: qx, z: qz, ux, uz };
        }
    }
    return { ...mid, ux, uz };
  }

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
      // (fixes 2026-09-24: they stood 3.3 m apart all through, the old test wanted 3, and walking at
      // each other's feet got nowhere round a stall) they walk to a meeting point, a free spot by
      // the middle, each to his own side of it; face to face when both are there, or near enough
      // each other, or after SCUFFLE_MEET_S (then the shoving steps them in)
      if (pa && pb && !this.meetAt.has(key)) this.meetAt.set(key, { ...this.meetingPoint(pa, pb, c), since: this.clock });
      const mp = this.meetAt.get(key);
      if (pa && pb && mp && !this.faceToFace.has(key)) {
        const gap = Math.hypot(pa.x - pb.x, pa.z - pb.z);
        const there = (q: { x: number; z: number }, sign: number) => Math.hypot(q.x - (mp.x - sign * mp.ux * 0.6), q.z - (mp.z - sign * mp.uz * 0.6)) < 0.9;
        if (gap < 1.9 || (there(pa, 1) && there(pb, -1)) || (this.clock - mp.since > SCUFFLE_MEET_S && gap < 8)) this.faceToFace.set(key, { t: this.clock, x: mp.x, z: mp.z });
      }
      const met = this.faceToFace.get(key);
      const since = met ? this.clock - met.t : -1;
      // (the agent parts them after some shoving, not at once: fixes 2026-09-24)
      const parted = t >= 0.97 || since > SCUFFLE_WORDS_S + SCUFFLE_SHOVE_S || (agentThere && since > SCUFFLE_WORDS_S + SCUFFLE_SHOVE_MIN_S);
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
        // not face to face yet: up to my side of the meeting point, hands already going
        const sign = me === sc.a ? 1 : -1;
        const gx = mp ? mp.x - sign * mp.ux * 0.6 : o.x;
        const gz = mp ? mp.z - sign * mp.uz * 0.6 : o.z;
        if (Math.hypot(p.x - gx, p.z - gz) > 0.5) this.go(r, p, gx, gz, 1.5, 0.8);
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
        // words first: face to face, hands going (up to my side of the middle first, if not there)
        lean(0);
        const sg = me === sc.a ? 1 : -1;
        const mx = (met?.x ?? p.x) - sg * (mp?.ux ?? ux) * 0.6;
        const mz = (met?.z ?? p.z) - sg * (mp?.uz ?? uz) * 0.6;
        if (Math.hypot(p.x - mx, p.z - mz) > 0.6) {
          this.go(r, p, mx, mz, 1.6, 0.6);
          return;
        }
        if (this.crowd.puppetBusy(p) || (r.wait -= dt) <= 0 || p.pmotion !== "talk") {
          this.crowd.puppetStand(p, "talk", face);
          r.wait = 2;
        }
        return;
      }
      // pushing and shoving: a lunge in with both hands and a stagger back, turn about, never a
      // blow (fixes 2026-09-24: bigger, so a picture shows it; the shover's arms go)
      p.yaw = face;
      const cycle = Math.floor(this.clock / 1.5);
      const u = (this.clock % 1.5) / 1.5;
      const shover = (cycle % 3 === 2) === (sc.wrong === sc.a) ? sc.b : sc.a;
      const iShove = me === shover;
      const want = iShove && u < 0.5 ? "talk" : "idle";
      if (this.crowd.puppetBusy(p) || p.pmotion !== want) this.crowd.puppetStand(p, want, face);
      let off = 0;
      let tilt = 0;
      if (iShove) {
        const k = u < 0.35 ? Math.sin((u / 0.35) * Math.PI) : 0;
        off = 0.5 * k;
        tilt = 0.38 * k;
      } else {
        const k = u > 0.15 && u < 0.65 ? Math.sin(((u - 0.15) / 0.5) * Math.PI) : 0;
        off = -0.65 * k;
        tilt = -0.3 * k;
      }
      // my side of the middle, 0.55 m from it, moved in or out along the line between us (stepped
      // in from where they stood, a little each frame, when the meeting point was not reached)
      const mid = met ?? { x: (p.x + o.x) / 2, z: (p.z + o.z) / 2 };
      const mu = mp ? { x: mp.ux, z: mp.uz } : { x: ux, z: uz };
      const sign = me === sc.a ? 1 : -1;
      const base = { x: mid.x - sign * mu.x * 0.55, z: mid.z - sign * mu.z * 0.55 };
      const nx = base.x + sign * mu.x * off;
      const nz = base.z + sign * mu.z * off;
      const far = Math.hypot(nx - p.x, nz - p.z);
      const step = far > 0.8 ? Math.min(far, 2.2 * dt) / far : 1;
      const sx = p.x + (nx - p.x) * step;
      const sz = p.z + (nz - p.z) * step;
      if (this.world.isFree(sx, sz, 0.2)) {
        p.x = sx;
        p.z = sz;
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
