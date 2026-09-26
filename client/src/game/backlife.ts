import { toMeOr } from "../player/profile"; // M7 character: lines said to the player follow the profile
import * as THREE from "three";
import { psx } from "../retro/psx";
import type { World } from "../world/rijnkaai";
import type { Crowd, Puppet } from "./crowd";
import type { Goal, Sim, Town } from "./town";
import type { Now } from "../../../server/src/town/schedule";
import type { Convo, TownPlace, TownResident } from "../net/api";
import { activityAt } from "../../../server/src/town/schedule";
import { backKind, type BackPlaceKind } from "../../../server/src/town/backkind";
import { exchange, line, type TalkKind } from "../../../server/src/town/backtalk";
import { h01 } from "../../../server/src/town/doorlife";
import { makeWear, holdInHands, dropWear, type Wear } from "./wardrobe";

// The back of town (M7 back of town, Steve 2026-09-26: "There are no people in the back of town:
// make sure appropriate people, groups and gangs are there, bringing everything to life"). The
// server gives the back its people and their days (server town/backtown.ts); this file plays what
// they do at the places of their day, by the place's kind:
//
// - pump: washerwomen kneel at their tubs round the court pump, scrubbing on the board; now and
//   then one goes to the pump and works the handle, or stands up to talk;
// - corner: the lads of a corner gang lounge in a half ring by a house corner, one sat on a crate;
//   they watch whoever passes, turn to look at Jef and say something (menacing, never a blow by day:
//   the robbing is the night gangs', night/gangs.ts); stand by them and they tell you to move along;
// - cards: old men on crates round an upturned crate with the cards and the coins on it, others
//   stood by watching;
// - gossip: neighbours in a knot before a door, talking;
// - step: an old man on a chair by his own door, his pipe in his hand;
// - lovers: a lad and a girl close together by the pond in the park;
// - park, walk: strollers along the park's paths and the walk on the ramparts, a household together;
// - the night watch on its round, a lantern, the hour called at each corner; a drunk who sways,
//   sits down where he is, and mutters.
//
// Groups talk in bubbles (the M4 bubbles), the ENGINE's lines (server town/backtalk.ts), only when
// Jef is near. Props (crates, tubs, the chair, the cards) exist only while the person is drawn.

const TALK_M = 24;
const UP = new THREE.Vector3(0, 1, 0);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const isNight = (h: number) => h >= 19 || h < 6.5;

interface Kit {
  place: string;
  kind: BackPlaceKind;
  phase: "go" | "at" | "pump" | "back";
  t: number;
  tries: number;
  /** Where they stand (sit, kneel) and which way they face. */
  x: number;
  z: number;
  yaw: number;
  props: THREE.Object3D[];
  hand: THREE.Object3D | null;
  wear: Wear | null;
  /** A stroll: the index of the route point walked to, and the way along. */
  ri: number;
  dir: 1 | -1;
  /** The watch: the step of the round last called at. */
  called: number;
  /** A drunk: sitting down now. */
  sits: boolean;
  motion: string;
  sway: number;
  /** The head's turn toward Jef now (radians, off the body's way). */
  head: number;
}

interface Group {
  place: string;
  kind: TalkKind;
  queue: Array<{ who: Sim; text: string }>;
  lineT: number;
  nextT: number;
  menaceT: number;
  lingerT: number;
}

export class BackLife {
  /** Set by main: game day and hour. */
  clock: () => { day: number; hour: number } = () => ({ day: 1, hour: 12 });
  weather: () => string = () => "clear";
  /** Set by main: show a line over a head (game/bubbles.ts). */
  say: (c: Convo) => void = () => {};
  private kits = new Map<string, Kit>();
  private groups = new Map<string, Group>();
  /** Who uses each place of the back (every resident whose day has it): their slot there is their place in this list. */
  private roster = new Map<string, string[]>();
  private player = { x: 0, z: 0 };
  private nextConvo = 800_000_000;
  private mats: Record<string, THREE.Material> | null = null;
  private rostered = false;
  private readonly pq = new THREE.Quaternion();
  private readonly off = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  /** The spots taken at each place (by whom): no two people on one spot. */
  private spots = new Map<string, Map<string, [number, number]>>();
  private spotOf = new Map<string, string>();
  private byRes = new Map<string, TownResident>();

  constructor(
    private readonly world: World,
    private readonly town: Town,
    private readonly crowd: Crowd,
  ) {}

  /** Given to town.ts (town.back). */
  hook(): NonNullable<Town["back"]> {
    return {
      goal: (s, now) => this.goalOf(s, now),
      behave: (s, dt) => this.behave(s, dt),
      spawned: (s) => this.spawned(s),
      lost: (s) => this.lost(s),
    };
  }

  // ------------------------------------------------------------------ where they go

  private placeOf(id: string): TownPlace | null {
    return this.town.data?.places[id] ?? null;
  }

  private buildRoster(): void {
    if (this.rostered || !this.town.data) return;
    this.rostered = true;
    for (const r of this.town.data.residents) {
      this.byRes.set(r.id, r);
      const ids = new Set<string>();
      for (const seg of [...r.sched.day, ...r.sched.sunday]) if (seg[3] && backKind(seg[3])) ids.add(seg[3]);
      if (backKind(r.work.place)) ids.add(r.work.place);
      for (const id of ids) {
        const l = this.roster.get(id) ?? [];
        l.push(r.id);
        this.roster.set(id, l);
      }
    }
  }

  /**
   * This person's slot at a place: their turn among the people whose day has them there now (in the order of
   * their ids), so that the first four at the cards sit and the rest stand, whoever is out today.
   */
  private slotOf(place: string, id: string): { k: number; n: number } {
    this.buildRoster();
    const { day, hour } = this.clock();
    const l = (this.roster.get(place) ?? [id]).filter((o) => {
      if (o === id) return true;
      const r = this.byRes.get(o);
      if (!r) return false;
      const now = activityAt(r.sched, day, hour);
      return (now.act === "work" ? r.work.place : now.place) === place;
    });
    const k = Math.max(0, l.indexOf(id));
    return { k, n: Math.max(1, l.length) };
  }

  /** The nearest free ground to (x, z) within 1.2 m (a slot against a wall or a pump slides out). */
  private free(x: number, z: number, r = 0.3): [number, number] | null {
    for (let d = 0; d <= 1.2; d += 0.2)
      for (let i = 0; i < (d ? 8 : 1); i++) {
        const a = (i / 8) * Math.PI * 2;
        const qx = x + Math.sin(a) * d;
        const qz = z + Math.cos(a) * d;
        if (this.world.isFree(qx, qz, r) && this.crowd.canStand(qx, qz)) return [qx, qz];
      }
    return null;
  }

  /** The place of the day this person is at now, if it is one of the back's (and what kind). */
  private placeNow(s: Sim, now: Now): { id: string; kind: BackPlaceKind } | null {
    const id = now.act === "work" ? s.r.work.place : now.place;
    const kind = backKind(id);
    if (!kind) return null;
    if (now.act === "home" || now.act === "tavern" || now.act === "play") return null;
    return { id, kind };
  }

  private goalOf(s: Sim, now: Now): Goal | null {
    // a new hour's goal: the spot of the last one is free again
    const was = this.spotOf.get(s.r.id);
    if (was) this.spots.get(was)?.delete(s.r.id);
    this.spotOf.delete(s.r.id);
    const at = this.placeNow(s, now);
    if (!at) return null;
    const pl = this.placeOf(at.id);
    if (!pl) return null;
    const { k, n } = this.slotOf(at.id, s.r.id);
    const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
    // a free spot near the slot that nobody else of the place has taken (two slid out of a wall onto one spot)
    const put = (x: number, z: number, yaw: number, mode: Goal["mode"] = "stand"): Goal => {
      const mine = this.spots.get(at.id) ?? new Map<string, [number, number]>();
      this.spots.set(at.id, mine);
      mine.delete(s.r.id);
      const clash = (q: [number, number]) => [...mine.values()].some((o) => dist(o[0], o[1], q[0], q[1]) < 0.7);
      let q = this.free(x, z) ?? ([x, z] as [number, number]);
      if (clash(q)) {
        // round the place's middle, a little further on each try
        const a0 = Math.atan2(x - pl.x, z - pl.z);
        const r0 = Math.max(0.7, dist(x, z, pl.x, pl.z));
        for (let t = 1; t < 16 && clash(q); t++) {
          const a = a0 + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 0.55;
          const r = r0 + Math.floor(t / 6) * 0.4;
          const c = this.free(pl.x + Math.sin(a) * r, pl.z + Math.cos(a) * r, 0.25);
          if (c && !clash(c)) q = c;
        }
        yaw = Math.atan2(pl.x - q[0], pl.z - q[1]);
      }
      mine.set(s.r.id, q);
      this.spotOf.set(s.r.id, at.id);
      return { mode, x: q[0], z: q[1], yaw, place: at.id };
    };
    switch (at.kind) {
      case "church":
        // mass in one of the back's churches (the parish priest says it): in at the door
        return { mode: "church", x: pl.x, z: pl.z, place: at.id };
      case "pump": {
        // round the pump, 1.55 m out, each woman her own side; the tub between her and the pump
        const m = Math.max(3, Math.min(6, n));
        const a = (k % m) * ((Math.PI * 2) / m) + h01(at.id) * Math.PI * 2;
        const R = m <= 4 ? 1.55 : 2.0;
        const x = pl.x + Math.sin(a) * R;
        const z = pl.z + Math.cos(a) * R;
        return put(x, z, face(x, z, pl.x, pl.z));
      }
      case "corner": {
        // the first leans back on the house wall (the place is 1.3 m out from it); the others stand round
        // a spot before him in a loose ring, facing in: a knot of lads talking, each his own way of standing
        const [wx, wz] = pl.out ?? [0, 1];
        const wa = Math.atan2(wx, wz);
        if (k === 0) {
          // his back against the wall itself (not slid off it: the free-ground search would push him out)
          let d = 0;
          while (d < 3 && this.world.city.flags(pl.x + wx * (d + 0.05), pl.z + wz * (d + 0.05)) === 0) d += 0.05;
          const x = pl.x + wx * Math.max(0, d - 0.3);
          const z = pl.z + wz * Math.max(0, d - 0.3);
          this.spots.get(at.id)?.set(s.r.id, [x, z]) ?? this.spots.set(at.id, new Map([[s.r.id, [x, z] as [number, number]]]));
          this.spotOf.set(s.r.id, at.id);
          return { mode: "stand", x, z, yaw: wa + Math.PI, place: at.id };
        }
        const cx = pl.x - wx * 0.15;
        const cz = pl.z - wz * 0.15;
        const m = Math.max(2, Math.min(5, n - 1));
        const a = wa + Math.PI + ((k - 1) - (m - 1) / 2) * 1.0 + (h01(s.r.id) - 0.5) * 0.3;
        const r = 0.95 + (h01(s.r.id + "r") - 0.5) * 0.3;
        const x = cx + Math.sin(a) * r;
        const z = cz + Math.cos(a) * r;
        return put(x, z, face(x, z, cx + wx * 0.3, cz + wz * 0.3));
      }
      case "cards": {
        // four crates round the upturned one; the rest stand a step back and watch
        const base = h01(at.id) * Math.PI * 2;
        const seat = k < 4;
        const a = base + (seat ? k : k - 4 + 0.5) * (Math.PI / 2);
        const r = seat ? 0.8 : 1.6;
        const x = pl.x + Math.sin(a) * r;
        const z = pl.z + Math.cos(a) * r;
        return put(x, z, face(x, z, pl.x, pl.z));
      }
      case "gossip":
      case "knot": {
        const m = Math.max(2, Math.min(5, n));
        const a = (k % m) * ((Math.PI * 2) / m) + h01(at.id) * Math.PI * 2;
        // (a knot of four or five stands wider: shoulder to shoulder, not in each other)
        const R = m >= 4 ? 0.85 : 0.62;
        const x = pl.x + Math.sin(a) * R;
        const z = pl.z + Math.cos(a) * R;
        return put(x, z, face(x, z, pl.x, pl.z));
      }
      case "step": {
        // a chair against the house wall beside the door, facing the street
        const door = pl.door ?? [pl.x, pl.z];
        const [ox, oz] = pl.out ?? [0, 1];
        for (const side of [1, -1]) {
          const x = door[0] - ox * 0.35 - oz * side * 1.3;
          const z = door[1] - oz * 0.35 + ox * side * 1.3;
          if (this.world.isFree(x, z, 0.28) && this.world.isFree(x + ox * 0.5, z + oz * 0.5, 0.2)) return { mode: "stand", x, z, yaw: Math.atan2(ox, oz), place: at.id };
        }
        return put(door[0] + ox * 0.4, door[1] + oz * 0.4, Math.atan2(ox, oz));
      }
      case "lovers": {
        // side by side at the water's edge, turned to each other
        const [ox, oz] = pl.out ?? [0, 1];
        const L = Math.hypot(ox, oz) || 1;
        const tx = -oz / L;
        const tz = ox / L;
        const sgn = k % 2 === 0 ? 1 : -1;
        const x = pl.x + tx * 0.33 * sgn;
        const z = pl.z + tz * 0.33 * sgn;
        return put(x, z, Math.atan2(-tx * sgn, -tz * sgn) + 0.5 * sgn);
      }
      case "park":
      case "walk":
      case "lanes": {
        const route = pl.route;
        if (!route?.length) return { mode: "stroll", x: pl.x, z: pl.z, r: pl.r, place: at.id };
        // start where the route is nearest their door
        let bi = 0;
        for (let i = 1; i < route.length; i++) if (dist(route[i][0], route[i][1], s.r.home.sx, s.r.home.sz) < dist(route[bi][0], route[bi][1], s.r.home.sx, s.r.home.sz)) bi = i;
        return { mode: "stroll", x: route[bi][0], z: route[bi][1], r: 3, place: at.id };
      }
      default:
        // watch, drunk, round: the town walks their route (patrol, roam); this file adds to it
        return null;
    }
  }

  // ------------------------------------------------------------------ what they do there

  private kit(s: Sim): Kit | null {
    const place = s.goal.place ?? (s.goal.mode === "patrol" || s.goal.mode === "roam" ? s.r.work.place : "");
    const kind = backKind(place);
    let k = this.kits.get(s.r.id);
    if (k && k.place !== place) {
      this.clearKit(s, k);
      k = undefined;
    }
    // (the children's play and the estaminet's door are the town's own: game/town.ts play, tavern)
    if (!kind || kind === "play" || kind === "kroeg") return null;
    if (!k) {
      k = { place, kind, phase: "go", t: 0, tries: 0, x: s.goal.x, z: s.goal.z, yaw: s.goal.yaw ?? 0, props: [], hand: null, wear: null, ri: -1, dir: h01(`dir:${s.r.id}`) < 0.5 ? 1 : -1, called: -1, sits: false, motion: "", sway: Math.random() * 10, head: 0 };
      this.kits.set(s.r.id, k);
    }
    return k;
  }

  private clearKit(s: Sim, k: Kit): void {
    this.spots.get(k.place)?.delete(s.r.id);
    for (const o of k.props) o.removeFromParent();
    k.props = [];
    k.hand?.removeFromParent();
    k.hand = null;
    if (k.wear) dropWear(k.wear);
    k.wear = null;
    if (s.p) s.p.group.rotation.z = 0;
    this.kits.delete(s.r.id);
  }

  private spawned(s: Sim): void {
    const p = s.p;
    if (!p) return;
    if (s.r.trade === "drunkard") p.pace = rnd(0.62, 0.8);
    if (s.r.trade === "watchman") p.pace = rnd(0.85, 0.95);
  }

  private lost(s: Sim): void {
    const k = this.kits.get(s.r.id);
    if (k) this.clearKit(s, k);
  }

  private stand(p: Puppet, k: Kit, motion: string, yaw: number | null): void {
    if (k.motion === motion && p.human.motion === motion && yaw === null) return;
    k.motion = motion;
    if (motion === "sit") this.crowd.puppetSit(p, yaw);
    else this.crowd.puppetStand(p, motion as never, yaw);
  }

  private behave(s: Sim, dt: number): boolean {
    const p = s.p;
    if (!p || s.held) return false;
    // the doctor's black bag, the drunk's bottle, the watch's lantern: whatever the place
    this.dress(s);
    const k = this.kit(s);
    if (!k) return false;
    k.t += dt;
    switch (k.kind) {
      case "watch":
        return this.watch(s, k);
      case "drunk":
        return this.drunk(s, k, dt);
      case "round":
        return false;
      case "park":
      case "walk":
      case "lanes":
        return this.stroll(s, k);
      case "church":
        return false;
      default:
        break;
    }
    // a group's place: walk to the slot, then settle there
    const g = s.goal;
    if (k.phase === "go") {
      if (this.crowd.puppetBusy(p)) return true;
      if (dist(p.x, p.z, g.x, g.z) > 0.5) {
        if (k.tries++ < 4) this.crowd.puppetGo(p, g.x, g.z);
        else {
          // cannot get there from here: out of sight, simply there
          if (this.crowd.isHidden(p.x, p.z) || k.tries > 12) {
            p.x = g.x;
            p.z = g.z;
          }
        }
        return true;
      }
      p.x = g.x;
      p.z = g.z;
      k.phase = "at";
      k.t = 0;
      this.settle(s, k);
      return true;
    }
    switch (k.kind) {
      case "pump":
        return this.pump(s, k);
      case "corner":
        return this.corner(s, k);
      case "cards":
        return this.cards(s, k);
      case "gossip":
      case "knot":
      case "lovers":
        return this.talkers(s, k);
      case "step":
        return this.step(s, k);
    }
    return true;
  }

  /** Arrived at the slot: the props of the place, and the first pose. */
  private settle(s: Sim, k: Kit): void {
    const p = s.p!;
    const g = s.goal;
    const pl = this.placeOf(k.place);
    const yaw = g.yaw ?? 0;
    const { k: slot } = this.slotOf(k.place, s.r.id);
    switch (k.kind) {
      case "pump": {
        // stood at her tub on its stool (most washed standing), the board in it; a basket of linen at her
        // side; the first to come hangs a line of washing near by
        const tx = p.x + Math.sin(yaw) * 0.45;
        const tz = p.z + Math.cos(yaw) * 0.45;
        k.props.push(this.prop("tub", tx, tz, yaw));
        const bx = p.x + Math.sin(yaw + Math.PI / 2) * 0.6 - Math.sin(yaw) * 0.05;
        const bz = p.z + Math.cos(yaw + Math.PI / 2) * 0.6 - Math.cos(yaw) * 0.05;
        if (this.world.isFree(bx, bz, 0.2)) k.props.push(this.prop("basket", bx, bz, yaw));
        if (pl && !this.tableAt(k.place)) {
          const line = this.lineSpot(pl.x, pl.z);
          if (line) k.props.push(this.prop("line", line.x, line.z, line.yaw, k.place));
        }
        this.stand(p, k, "wash", yaw);
        k.t = -rnd(0, 8);
        return;
      }
      case "corner":
        this.stand(p, k, (["wall", "smoke", "pockets", "fold", "behind", "pockets"] as const)[slot % 6], yaw);
        if (slot % 6 === 1) this.setHand(p, k, "pipe");
        return;
      case "cards":
        if (slot < 4 && p.human.canSit) {
          k.props.push(this.prop("stool", p.x - Math.sin(yaw) * 0.1, p.z - Math.cos(yaw) * 0.1, yaw));
          // the table: set down once, by the first to sit
          if (pl && !this.tableAt(k.place)) k.props.push(this.prop("table", pl.x, pl.z, h01(k.place) * 6.28, k.place));
          this.stand(p, k, "sit", yaw);
        } else this.stand(p, k, "fold", yaw);
        return;
      case "step":
        if (p.human.canSit) {
          k.props.push(this.prop("chair", p.x - Math.sin(yaw) * 0.08, p.z - Math.cos(yaw) * 0.08, yaw));
          this.stand(p, k, "sit", yaw);
          this.setHand(p, k, "pipe");
        } else this.stand(p, k, "fold", yaw);
        return;
      default:
        this.stand(p, k, slot % 2 ? "fold" : "idle", yaw);
    }
  }

  /** Where a washing line can stand by a pump: 2.5-3.5 m off, room for its 2.4 m along. */
  private lineSpot(x: number, z: number): { x: number; z: number; yaw: number } | null {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const d of [3, 3.5, 2.6]) {
        const cx = x + Math.sin(a) * d;
        const cz = z + Math.cos(a) * d;
        const ux = Math.cos(a);
        const uz = -Math.sin(a);
        if ([-1.2, 0, 1.2].every((t) => this.world.isFree(cx + ux * t, cz + uz * t, 0.35) && this.crowd.canStand(cx + ux * t, cz + uz * t))) return { x: cx, z: cz, yaw: a + Math.PI / 2 };
      }
    }
    return null;
  }

  private tableAt(place: string): boolean {
    for (const k of this.kits.values()) if (k.place === place && k.props.some((o) => o.userData.table === place)) return true;
    return false;
  }

  // ---- washing at the pump

  private pump(s: Sim, k: Kit): boolean {
    const p = s.p!;
    const g = s.goal;
    const pl = this.placeOf(k.place);
    if (!pl) return true;
    if (k.phase === "pump") {
      if (this.crowd.puppetBusy(p)) return true;
      if (k.motion !== "pull") {
        this.stand(p, k, "pull", Math.atan2(pl.x - p.x, pl.z - p.z));
        k.t = 0;
      }
      if (k.t > 4.5) {
        k.phase = "back";
        this.crowd.puppetGo(p, g.x, g.z);
      }
      return true;
    }
    if (k.phase === "back") {
      if (this.crowd.puppetBusy(p)) return true;
      p.x = g.x;
      p.z = g.z;
      k.phase = "at";
      k.t = 0;
      this.stand(p, k, "wash", g.yaw ?? null);
      return true;
    }
    // at her tub: washing, now and then up to rest her back and talk, or to the pump for water
    if (k.t < 0) return true;
    if (k.motion === "wash" && k.t > 14 + h01(s.r.id) * 10) {
      k.t = 0;
      const u = Math.random();
      if (u < 0.3 && !this.someoneAt(k.place, "pull")) {
        const side = this.free(pl.x + Math.sin((g.yaw ?? 0) + Math.PI) * 0.75, pl.z + Math.cos((g.yaw ?? 0) + Math.PI) * 0.75);
        if (side) {
          k.phase = "pump";
          this.crowd.puppetGo(p, side[0], side[1]);
          return true;
        }
      }
      this.stand(p, k, u < 0.65 ? "talk" : "idle", g.yaw ?? null);
      return true;
    }
    if (k.motion !== "wash" && k.t > 4 + h01(s.r.id + "r") * 3) {
      k.t = 0;
      p.x = g.x;
      p.z = g.z;
      this.stand(p, k, "wash", g.yaw ?? null);
    }
    return true;
  }

  private someoneAt(place: string, motion: string): boolean {
    for (const k of this.kits.values()) if (k.place === place && (k.phase === "pump" || k.motion === motion)) return true;
    return false;
  }

  // ---- the lads at the corner

  private corner(s: Sim, k: Kit): boolean {
    const p = s.p!;
    const g = s.goal;
    const jd = dist(p.x, p.z, this.player.x, this.player.z);
    const { k: slot } = this.slotOf(k.place, s.r.id);
    const sitting = k.motion === "sit";
    // (eyes on the stranger: their heads follow Jef as he passes, update(); up close, the nearest turns to him)
    // right up close, the nearest of them squares up to him (the others only watch)
    if (jd < 3 && slot !== 0 && k.t > 0.8 && this.nearestOf(k.place) === s.r.id) {
      k.t = 0;
      this.crowd.puppetStand(p, k.motion === "smoke" ? "smoke" : "pockets", Math.atan2(this.player.x - p.x, this.player.z - p.z));
      k.motion = p.human.motion ?? "";
      return true;
    }
    if (jd >= 4 && k.t > 7 + h01(s.r.id + ":" + Math.floor(performance.now() / 20000)) * 8) {
      k.t = 0;
      // each keeps his own way of standing; now and then one talks, then goes back to it
      const own = (["wall", "smoke", "pockets", "fold", "behind", "pockets"] as const)[slot % 6];
      if (!sitting) this.stand(p, k, slot !== 0 && Math.random() < 0.3 ? "talk" : own, g.yaw ?? null);
    }
    return true;
  }

  // ---- cards on a doorstep

  private cards(s: Sim, k: Kit): boolean {
    const p = s.p!;
    if (k.motion !== "sit" && k.t > 5 + h01(s.r.id) * 5) {
      k.t = 0;
      this.stand(p, k, Math.random() < 0.35 ? "talk" : "fold", s.goal.yaw ?? null);
    }
    return true;
  }

  // ---- neighbours at a door, the lovers by the pond

  private talkers(s: Sim, k: Kit): boolean {
    const p = s.p!;
    if (k.t > 3 + h01(s.r.id + ":" + Math.floor(performance.now() / 9000)) * 6) {
      k.t = 0;
      const talkers = this.speaking.has(s.r.id);
      this.stand(p, k, talkers ? "talk" : Math.random() < 0.5 ? "fold" : "idle", s.goal.yaw ?? null);
    }
    return true;
  }

  // ---- the old man by his door

  private step(s: Sim, k: Kit): boolean {
    const p = s.p!;
    const jd = dist(p.x, p.z, this.player.x, this.player.z);
    const gr = this.group(k.place, "step");
    if (jd < 4.5 && gr.menaceT <= 0 && k.motion === "sit") {
      gr.menaceT = 90;
      const text = toMeOr(line("step", `${s.r.id}:${Math.floor(performance.now() / 30000)}`, this.vars([s], s)));
      if (text) this.lineOver(s, text);
    }
    return true;
  }

  // ---- strolling in the park and on the ramparts

  private stroll(s: Sim, k: Kit): boolean {
    const p = s.p!;
    const pl = this.placeOf(k.place);
    const route = pl?.route;
    if (!route?.length) return false;
    // a household walks together: the younger at the elder's side (in the park and on the wall; errands alone)
    const lanes = k.kind === "lanes";
    const pace = lanes ? undefined : 0.85;
    const lead = lanes ? null : this.strollLead(s);
    if (lead?.p) {
      if (dist(lead.p.x, lead.p.z, p.x, p.z) < 12) {
        this.crowd.puppetFollow(p, lead.p);
        return true;
      }
      if (this.crowd.puppetFollowing(p)) this.crowd.puppetFollow(p, null);
      if (!this.crowd.puppetBusy(p)) this.crowd.puppetGo(p, lead.p.x, lead.p.z, 1.6);
      return true;
    }
    if (this.crowd.puppetFollowing(p)) this.crowd.puppetFollow(p, null);
    if (this.crowd.puppetBusy(p)) return true;
    if (k.ri < 0) {
      let bi = 0;
      for (let i = 1; i < route.length; i++) if (dist(route[i][0], route[i][1], p.x, p.z) < dist(route[bi][0], route[bi][1], p.x, p.z)) bi = i;
      k.ri = bi;
      k.phase = "go";
      this.crowd.puppetGo(p, route[bi][0], route[bi][1], pace);
      return true;
    }
    if (k.phase === "go") {
      // at a point: now and then a stop to look out (over the water, the moat, the fields)
      k.phase = "at";
      k.t = 0;
      if (Math.random() < (lanes ? 0.2 : 0.3)) {
        const n = route[(k.ri + 1) % route.length];
        const along = Math.atan2(n[0] - p.x, n[1] - p.z);
        const look = along + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
        this.crowd.puppetStand(p, Math.random() < 0.5 ? "behind" : "idle", look);
        k.sits = true;
      } else k.sits = false;
      return true;
    }
    if (k.sits && k.t < 5 + h01(s.r.id + k.ri) * 6) return true;
    k.ri = (k.ri + k.dir + route.length) % route.length;
    k.phase = "go";
    this.crowd.puppetGo(p, route[k.ri][0], route[k.ri][1], pace);
    return true;
  }

  /** The one of this person's household at the same stroll whose side they keep (the eldest walks first). */
  private strollLead(s: Sim): Sim | null {
    const r = s.r;
    for (const [id, k] of this.kits) {
      if (id === r.id || k.place !== this.kits.get(r.id)?.place) continue;
      const o = this.town.simOf(id);
      // (the look pass: two lovers keep each other's side on the wall too, `mate`)
      if (!o?.p || (o.r.household !== r.household && o.r.id !== r.mate)) continue;
      if (o.r.age > r.age || (o.r.age === r.age && o.r.id < r.id)) {
        // only one follows each lead (the crowd walks one at a side)
        const taken = [...this.kits.keys()].some((q) => q !== r.id && this.town.simOf(q)?.p && this.crowd.puppetFollowing(this.town.simOf(q)!.p!) && this.town.simOf(q)!.p!.lead === o.p);
        if (!taken || (s.p && s.p.lead === o.p)) return o;
      }
    }
    return null;
  }

  // ---- the night watch

  private watch(s: Sim, k: Kit): boolean {
    const p = s.p!;
    if (this.crowd.puppetBusy(p)) return false;
    const route = s.goal.route;
    if (!route?.length) return false;
    const i = s.step % route.length;
    if (dist(p.x, p.z, route[i][0], route[i][1]) > 2.5) return false;
    if (k.called !== s.step) {
      k.called = s.step;
      k.t = 0;
      this.crowd.puppetStand(p, "call", null);
      if (dist(p.x, p.z, this.player.x, this.player.z) < 38) {
        const text = line("watch", `${s.r.id}:${s.step}`, this.vars([s], s));
        if (text) this.lineOver(s, text);
      }
      return true;
    }
    if (k.t < 3.2) return true;
    return false;
  }

  // ---- a drunk

  private drunk(s: Sim, k: Kit, dt: number): boolean {
    const p = s.p!;
    // he sways as he goes, and stands swaying
    k.sway += dt;
    p.group.rotation.z = k.sits ? 0 : Math.sin(k.sway * 1.3) * 0.05 + Math.sin(k.sway * 0.55) * 0.035;
    const route = s.goal.route;
    if (k.phase === "back") {
      // on his way to the wall he will sit against
      if (this.crowd.puppetBusy(p)) return true;
      const yaw = k.yaw;
      k.props.push(this.prop("crate", p.x - Math.sin(yaw) * 0.1, p.z - Math.cos(yaw) * 0.1, yaw));
      this.stand(p, k, "sit", yaw);
      k.sits = true;
      k.phase = "at";
      k.t = 0;
      return true;
    }
    if (this.crowd.puppetBusy(p)) return false;
    if (!route?.length) return false;
    if (k.phase === "go") {
      // once at each stop of his way (the town's roam would hold him again at the same point)
      if (k.called === s.step) return false;
      k.called = s.step;
      k.phase = "at";
      k.t = 0;
      k.sits = false;
      // now and then down he sits, his back to the nearest wall (a crate, a step), else he stands and sways
      const wall = p.human.canSit && Math.random() < 0.45 ? this.wallBehind(p.x, p.z) : null;
      if (wall) {
        k.yaw = wall.yaw;
        this.crowd.puppetGo(p, wall.x, wall.z, 0.6);
        k.phase = "back";
      } else this.stand(p, k, "idle", null);
      if (dist(p.x, p.z, this.player.x, this.player.z) < 14) {
        const text = toMeOr(line("drunk", `${s.r.id}:${Math.floor(performance.now() / 7000)}`, this.vars([s], s)));
        if (text) this.lineOver(s, text);
      }
      return true;
    }
    if (k.t < (k.sits ? 22 : 7)) return true;
    // up again, and on to the next point of his way
    for (const o of k.props) o.removeFromParent();
    k.props = [];
    k.sits = false;
    k.phase = "go";
    k.motion = "";
    s.step++;
    s.arrived = false;
    const q = route[s.step % route.length];
    this.crowd.puppetGo(p, q[0], q[1]);
    return true;
  }

  /** A spot with a wall at the back within 1.6 m of (x, z): where to sit and the way to face (away from it). */
  private wallBehind(x: number, z: number): { x: number; z: number; yaw: number } | null {
    let best: { d: number; a: number } | null = null;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (let d = 0.3; d <= 1.6; d += 0.1)
        if (this.world.city.flags(x + Math.sin(a) * d, z + Math.cos(a) * d) !== 0) {
          if (!best || d < best.d) best = { d, a };
          break;
        }
    }
    if (!best) return null;
    const sx = x + Math.sin(best.a) * Math.max(0, best.d - 0.55);
    const sz = z + Math.cos(best.a) * Math.max(0, best.d - 0.55);
    if (!this.world.isFree(sx, sz, 0.25)) return null;
    return { x: sx, z: sz, yaw: best.a + Math.PI };
  }

  // ---- what they carry

  private dress(s: Sim): void {
    const p = s.p!;
    const hour = this.clock().hour;
    if (s.r.trade === "watchman") this.crowd.puppetLantern(p, isNight(hour));
    if (s.r.trade === "drunkard" && !this.kits.get(s.r.id)?.wear) {
      const k = this.kit(s);
      if (k && !k.wear) {
        k.wear = makeWear("drunkard", p.human.scale);
        p.group.add(k.wear.root);
        holdInHands(k.wear, p.human.root);
      }
    }
    if (s.r.trade === "doctor") {
      const k = this.kit(s);
      if (k && !k.hand) this.setHand(p, k, "bag");
    }
  }

  private setHand(p: Puppet, k: Kit, name: "pipe" | "bag" | null): void {
    if ((k.hand?.userData.name ?? null) === name) return;
    k.hand?.removeFromParent();
    k.hand = null;
    if (!name) return;
    // (the doctor's cane is in his right hand: the bag goes in his left)
    const hand = p.human.root.getObjectByName(name === "bag" ? "handL" : "handR");
    if (!hand) return;
    const o = this.handProp(name);
    o.userData.name = name;
    p.group.updateMatrixWorld(true);
    const ws = new THREE.Vector3();
    hand.getWorldScale(ws);
    o.scale.setScalar(1 / (ws.x || 1));
    hand.add(o);
    k.hand = o;
  }

  // ------------------------------------------------------------------ props (made in code, shared geometry)

  private kitMats(): Record<string, THREE.Material> {
    this.mats ??= {
      wood: psx(new THREE.MeshLambertMaterial({ color: 0x5c4630 })),
      dark: psx(new THREE.MeshLambertMaterial({ color: 0x3a2c1e })),
      iron: psx(new THREE.MeshLambertMaterial({ color: 0x2b2a28 })),
      water: psx(new THREE.MeshLambertMaterial({ color: 0x6b7a78 })),
      linen: psx(new THREE.MeshLambertMaterial({ color: 0xb8b2a2, side: THREE.DoubleSide })),
      linen2: psx(new THREE.MeshLambertMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide })),
      wicker: psx(new THREE.MeshLambertMaterial({ color: 0x8a6a3a })),
      wicker2: psx(new THREE.MeshLambertMaterial({ color: 0x6e5230 })),
      stave: psx(new THREE.MeshLambertMaterial({ color: 0x4e3a26 })),
      zinc: psx(new THREE.MeshLambertMaterial({ color: 0x8a8e8e })),
      linen3: psx(new THREE.MeshLambertMaterial({ color: 0xa8a294, side: THREE.DoubleSide })),
      card: psx(new THREE.MeshLambertMaterial({ color: 0xe8e2d0 })),
      red: psx(new THREE.MeshLambertMaterial({ color: 0x8a2a24 })),
      coin: psx(new THREE.MeshLambertMaterial({ color: 0x9a8a5a })),
      clay: psx(new THREE.MeshLambertMaterial({ color: 0xc8c0ae })),
      leather: psx(new THREE.MeshLambertMaterial({ color: 0x1a1614 })),
    };
    return this.mats;
  }

  private prop(name: "tub" | "basket" | "crate" | "table" | "chair" | "stool" | "line", x: number, z: number, yaw: number, table?: string): THREE.Object3D {
    const m = this.kitMats();
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, mat: THREE.Material, px: number, py: number, pz: number, ry = 0) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      o.position.set(px, py, pz);
      o.rotation.y = ry;
      g.add(o);
      return o;
    };
    /** A three-legged stool, its seat at `up`. */
    const stoolAt = (px: number, pz: number, up: number, r: number) => {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 10), m.wood);
      seat.position.set(px, up - 0.02, pz);
      g.add(seat);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, up, 5), m.dark);
        leg.position.set(px + Math.sin(a) * r * 0.7, up / 2, pz + Math.cos(a) * r * 0.7);
        leg.rotation.set(Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12);
        g.add(leg);
      }
    };
    /** A heap of wrung cloth: lumps of two or three greys and whites. */
    const heap = (px: number, py: number, pz: number, r: number, mats: THREE.Material[]) => {
      for (let i = 0; i < 6; i++) {
        const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.45 + 0.1 * (i % 3)), 0), mats[i % mats.length]);
        const a = i * 2.1;
        lump.position.set(px + Math.sin(a) * r * 0.45, py + (i < 3 ? 0 : r * 0.35), pz + Math.cos(a) * r * 0.45);
        lump.scale.y = 0.45;
        lump.rotation.y = a;
        g.add(lump);
      }
    };
    switch (name) {
      case "tub": {
        // M7 fix (lead's review): a wooden wash tub of staves and two iron hoops on a low stool, grey water, the
        // linen in it and the washboard leant in it on the far side (she stands at it: the rim 0.75 m up)
        const up = 0.45;
        stoolAt(0, 0, up, 0.24);
        const N = 14;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          const st = box(0.14, 0.32, 0.028, i % 2 ? m.wood : m.stave, Math.sin(a) * 0.3, up + 0.16, Math.cos(a) * 0.3, a);
          st.rotation.order = "YXZ";
          st.rotation.x = -0.06;
        }
        const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.28, 12), m.dark);
        bottom.rotation.x = -Math.PI / 2;
        bottom.position.y = up + 0.02;
        g.add(bottom);
        for (const hy of [0.07, 0.26]) {
          const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.305 + hy * 0.03, 0.012, 4, 16), m.iron);
          hoop.rotation.x = Math.PI / 2;
          hoop.position.y = up + hy;
          g.add(hoop);
        }
        const water = new THREE.Mesh(new THREE.CircleGeometry(0.29, 14), m.water);
        water.rotation.x = -Math.PI / 2;
        water.position.y = up + 0.24;
        g.add(water);
        heap(0.05, up + 0.25, -0.06, 0.12, [m.linen, m.linen2]);
        // the washboard: a frame and its ribs, standing in the tub against the far rim, leant toward her
        const board = new THREE.Group();
        board.position.set(0, up + 0.3, 0.2);
        board.rotation.x = 0.3;
        board.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.52, 0.025), m.wood));
        for (let r = 0; r < 7; r++) {
          const rib = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.018, 0.02), m.zinc);
          rib.position.set(0, -0.12 + r * 0.035, -0.018);
          board.add(rib);
        }
        g.add(board);
        break;
      }
      case "basket": {
        // a low wicker basket (upright withies, a woven rim), a heap of wrung grey-white linen in it
        const N = 16;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          box(0.07, 0.2, 0.02, i % 2 ? m.wicker : m.wicker2, Math.sin(a) * 0.2, 0.1, Math.cos(a) * 0.2, a);
        }
        for (const hy of [0.04, 0.12, 0.2]) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.014, 4, 16), m.wicker2);
          band.rotation.x = Math.PI / 2;
          band.position.y = hy;
          g.add(band);
        }
        const floor = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), m.wicker);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0.01;
        g.add(floor);
        heap(0, 0.2, 0, 0.17, [m.linen, m.linen2, m.linen3]);
        break;
      }
      case "stool": {
        // a three-legged stool: the seat at 0.45 m (the sit clip's seat)
        stoolAt(0, 0, 0.45, 0.19);
        break;
      }
      case "line": {
        // a washing line on two posts, 2.4 m apart, with sheets and shirts pegged on it
        for (const sx of [-1.2, 1.2]) box(0.06, 1.8, 0.06, m.wood, sx, 0.9, 0);
        box(2.4, 0.01, 0.01, m.clay, 0, 1.72, 0);
        const cloths: Array<[number, number, number, THREE.Material]> = [[-0.75, 0.55, 0.7, m.linen], [-0.05, 0.45, 0.5, m.linen3], [0.6, 0.6, 0.75, m.linen2]];
        for (const [cx, w, h, mat] of cloths) {
          const c = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
          c.position.set(cx, 1.72 - h / 2, 0);
          c.rotation.y = (Math.random() - 0.5) * 0.2;
          g.add(c);
        }
        g.userData.table = table;
        break;
      }
      case "crate": {
        // an upturned crate as a seat: 0.45 m (the sit clip's seat)
        box(0.46, 0.43, 0.38, m.wood, 0, 0.215, 0);
        box(0.48, 0.03, 0.4, m.dark, 0, 0.435, 0);
        break;
      }
      case "table": {
        // a bigger crate on end for the cards, the pack and the tricks on it, a few coins
        box(0.56, 0.5, 0.5, m.wood, 0, 0.25, 0);
        box(0.58, 0.03, 0.52, m.dark, 0, 0.5, 0);
        const card = (px: number, pz: number, ry: number, face = m.card) => box(0.06, 0.004, 0.09, face, px, 0.519, pz, ry);
        card(0, 0, 0.1);
        card(0.012, 0.004, 0.12);
        card(-0.14, 0.1, 0.5, m.red);
        card(0.13, -0.08, -0.4);
        card(0.1, 0.13, 1.2, m.red);
        for (const [cx, cz] of [[-0.18, -0.15], [-0.16, -0.17], [0.2, 0.16]]) {
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 8), m.coin);
          c.position.set(cx, 0.52, cz);
          g.add(c);
        }
        g.userData.table = table;
        break;
      }
      case "chair": {
        // a rush chair: seat at 0.45 m, four legs, a ladder back
        box(0.42, 0.04, 0.4, m.wicker, 0, 0.45, 0);
        for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) box(0.035, 0.45, 0.035, m.wood, lx, 0.225, lz);
        for (const lx of [-0.18, 0.18]) box(0.035, 0.5, 0.035, m.wood, lx, 0.7, -0.17);
        for (const ly of [0.62, 0.78, 0.92]) box(0.36, 0.05, 0.025, m.wood, 0, ly, -0.17);
        break;
      }
    }
    g.position.set(x, this.world.baseAt(x, z), z);
    g.rotation.y = yaw;
    this.world.scene.add(g);
    return g;
  }

  private handProp(name: "pipe" | "bag"): THREE.Object3D {
    const m = this.kitMats();
    const g = new THREE.Group();
    if (name === "pipe") {
      // a clay pipe: the stem forward out of the fist, the bowl up at its end
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.16, 5), m.clay);
      stem.rotation.x = Math.PI / 2;
      stem.position.set(0, -0.03, 0.06);
      g.add(stem);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.035, 6), m.clay);
      bowl.position.set(0, -0.015, 0.14);
      g.add(bowl);
    } else {
      // the doctor's black bag, hanging from his hand by its handle
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.13), m.leather);
      b.position.set(0, -0.16, 0);
      g.add(b);
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 4, 8, Math.PI), m.leather);
      h.position.set(0, -0.07, 0);
      g.add(h);
    }
    return g;
  }

  // ------------------------------------------------------------------ talk

  private speaking = new Set<string>();

  private group(place: string, kind: TalkKind): Group {
    let g = this.groups.get(place);
    if (!g) this.groups.set(place, (g = { place, kind, queue: [], lineT: 0, nextT: rnd(3, 12), menaceT: 0, lingerT: 0 }));
    return g;
  }

  private vars(members: Sim[], who: Sim): { names: string[]; neighbour: string; hour: number; weather: string } {
    const names = [who, ...members.filter((m) => m !== who)].map((m) => m.r.first);
    const rs = this.town.data?.residents ?? [];
    const near = rs.filter((r) => !members.some((m) => m.r.id === r.id) && dist(r.home.sx, r.home.sz, who.r.home.sx, who.r.home.sz) < 70 && r.age >= 16);
    const n = near.length ? near[Math.floor(Math.random() * near.length)] : null;
    return { names, neighbour: n ? n.first : "the Janssens lad", hour: this.clock().hour, weather: this.weather() };
  }

  /** One line over one head, now. */
  private lineOver(s: Sim, text: string): void {
    this.say({ id: this.nextConvo++, a: s.r.id, b: s.r.id, a_name: s.r.name, b_name: s.r.name, purpose: "chat", lines: [{ who: s.r.id, name: s.r.first, text }], source: "engine", outcome: "none", at: Date.now(), event_id: null });
  }

  /** Of a place's people there now, the one nearest Jef. */
  private nearestOf(place: string): string | null {
    let best: string | null = null;
    let bd = Infinity;
    for (const s of this.present(place)) {
      const d = dist(s.p!.x, s.p!.z, this.player.x, this.player.z);
      if (d < bd) {
        bd = d;
        best = s.r.id;
      }
    }
    return best;
  }

  /** Who of a place's people is there now, settled in their slot. */
  private present(place: string): Sim[] {
    const out: Sim[] = [];
    for (const [id, k] of this.kits) {
      if (k.place !== place || k.phase === "go") continue;
      const s = this.town.simOf(id);
      if (s?.p) out.push(s);
    }
    return out.sort((a, b) => (a.r.id < b.r.id ? -1 : 1));
  }

  private static readonly TALK: Partial<Record<BackPlaceKind, TalkKind>> = { pump: "pump", corner: "corner", cards: "cards", gossip: "gossip", knot: "men", lovers: "lovers", park: "stroll", walk: "stroll" };

  // ------------------------------------------------------------------ per frame

  update(dt: number, player: { x: number; z: number }): void {
    this.player = { x: player.x, z: player.z };
    for (const g of this.groups.values()) g.menaceT -= dt;
    // the groups near Jef: talk now and then (one line at a time, the speaker's arms moving)
    const places = new Set<string>();
    for (const k of this.kits.values()) if (k.phase !== "go") places.add(k.place);
    for (const place of places) {
      const kind = backKind(place);
      const tk = kind ? BackLife.TALK[kind] : undefined;
      if (!tk) continue;
      const pl = this.placeOf(place);
      if (!pl) continue;
      const g = this.group(place, tk);
      const d = dist(pl.x, pl.z, player.x, player.z);
      if (tk === "corner") this.menace(g, d, dt);
      if (g.queue.length || g.lineT > 0) {
        g.lineT -= dt;
        if (g.lineT <= 0) {
          const next = g.queue.shift();
          for (const id of [...this.speaking]) if (this.kits.get(id)?.place === place) this.speaking.delete(id);
          if (next?.who.p) {
            this.lineOver(next.who, next.text);
            this.speaking.add(next.who.r.id);
            const k = this.kits.get(next.who.r.id);
            if (k && !["sit", "scrub", "wash", "wall"].includes(k.motion)) {
              this.crowd.puppetStand(next.who.p, "talk", null);
              k.motion = "talk";
              k.t = 0;
            }
            g.lineT = Math.min(4, 2.5 + next.text.length / 90) + 0.4;
          }
        }
        continue;
      }
      if (d > TALK_M) continue;
      g.nextT -= dt;
      if (g.nextT > 0) continue;
      g.nextT = rnd(14, 30);
      const who = this.present(place);
      if (!who.length || (who.length < 2 && tk !== "stroll")) continue;
      const lead = who[Math.floor(Math.random() * who.length)];
      const ex = exchange(tk, `${place}:${Math.floor(performance.now() / 1000)}`, this.vars(who, lead));
      const cast = [lead, ...who.filter((w) => w !== lead)];
      g.queue = ex.filter((e) => cast[e.slot]).map((e) => ({ who: cast[e.slot], text: e.text }));
      g.lineT = 0;
    }
    this.watchJef(dt);
  }

  /**
   * Heads that follow Jef as he passes (the lads at their corner, the knot of men, an old man by his door):
   * the head bone turned toward him, up to 70 degrees either way of the body, eased. Set after the crowd's
   * animation of this frame (only on a frame it was sampled, so the turn never adds up).
   */
  private watchJef(dt: number): void {
    for (const [id, k] of this.kits) {
      if (k.kind !== "corner" && k.kind !== "knot" && k.kind !== "step") continue;
      const s = this.town.simOf(id);
      const p = s?.p;
      if (!p || !p.group.visible) continue;
      const d = dist(p.x, p.z, this.player.x, this.player.z);
      const want = d < (k.kind === "corner" ? 12 : 6) ? Math.atan2(Math.sin(Math.atan2(this.player.x - p.x, this.player.z - p.z) - p.yaw), Math.cos(Math.atan2(this.player.x - p.x, this.player.z - p.z) - p.yaw)) : 0;
      const clamp = Math.max(-1.2, Math.min(1.2, want));
      k.head += (clamp - k.head) * Math.min(1, dt * 3);
      if (Math.abs(k.head) < 0.01 || p.animAcc !== 0) continue;
      const head = p.human.root.getObjectByName("head");
      if (!head?.parent) continue;
      head.parent.updateWorldMatrix(true, false);
      head.parent.getWorldQuaternion(this.pq);
      this.off.setFromAxisAngle(UP, k.head);
      // world turn about the up axis, in the head's own parent frame
      this.q2.copy(this.pq).invert().multiply(this.off).multiply(this.pq);
      head.quaternion.premultiply(this.q2);
    }
  }

  /** The lads and a stranger: a word when he comes near; stand by them and they tell him to move along. */
  private menace(g: Group, d: number, dt: number): void {
    const who = this.present(g.place);
    if (!who.length) return;
    if (d < 3.6) g.lingerT += dt;
    else g.lingerT = Math.max(0, g.lingerT - dt * 2);
    if (g.lingerT > 5 && g.menaceT < 20) {
      g.lingerT = 0;
      g.menaceT = 25;
      const s = who[Math.floor(Math.random() * who.length)];
      const t = line("move_along", `${g.place}:${Math.floor(performance.now() / 1000)}`, this.vars(who, s));
      if (t) g.queue.push({ who: s, text: t });
      return;
    }
    if (d < 9 && g.menaceT <= 0 && !g.queue.length) {
      g.menaceT = 45;
      const night = isNight(this.clock().hour);
      const s = who[Math.floor(Math.random() * who.length)];
      const t = toMeOr(line(night ? "menace_night" : "menace", `${g.place}:${Math.floor(performance.now() / 1000)}`, this.vars(who, s)));
      if (t) g.queue.push({ who: s, text: t });
    }
  }

  // ------------------------------------------------------------------ dev

  info() {
    const byKind: Record<string, number> = {};
    for (const k of this.kits.values()) byKind[k.kind] = (byKind[k.kind] ?? 0) + 1;
    return { kits: this.kits.size, byKind, groups: this.groups.size, places: this.roster.size };
  }

  /** Dev: the people of a place now (who, their phase, pose, where). */
  at(place: string) {
    return [...this.kits.entries()].filter(([, k]) => k.place === place).map(([id, k]) => {
      const s = this.town.simOf(id);
      return { id, name: s?.r.name, phase: k.phase, motion: s?.p?.human.motion, x: s?.p ? +s.p.x.toFixed(2) : null, z: s?.p ? +s.p.z.toFixed(2) : null, props: k.props.length };
    });
  }
}
