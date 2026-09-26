import * as THREE from "three";
import type { World } from "../world/rijnkaai";
import { psx } from "../retro/psx";
import type { Crowd, Puppet } from "./crowd";
import { loadVelocipede, type Velocipedes } from "./velocipedes";
import type { Rowing } from "./rowing";
import type { HumanKind } from "./humans";
import { STOPS as OMNIBUS_STOPS, type Omnibus, type OmnibusStop } from "../world/omnibus";
import { absMinute, departures } from "../../../shared/omnibusLines"; // M7 omnibus routes
import { realS } from "../../../shared/clock";
import { PushCart } from "../world/traffic";
import { loadProps, type Props } from "../world/props3d";
import type { Rect } from "../world/geom";
import type { TownResident } from "../net/api";
import {
  chooseMode,
  planLoading,
  scheduleLoad,
  vehicleAt,
  waterPath,
  WALK_MAX_M,
  SPEED,
  type Load,
  type Mode,
  type Pt,
  type Stop,
} from "../../../server/src/town/transport";
import { activityAt } from "../../../server/src/town/schedule";

// How the town's people get about (M6 transport, Steve 2026-09-24): on foot for a short way;
// on their own velocipede for a long way; by omnibus (no fare) when a stop is near both ends;
// with the household's handcart (the family comes out to load it) or dray for a load; in the
// family's rowing boat along the water. The ENGINE decides (server/src/town/transport.ts,
// chooseMode: the same file on both sides); this side plays it.
//
// Far off and unseen, a trip is only timed: the traveller moves at the town's unseen pace
// times the mode's speed (town.ts coarse). Near Jef (a puppet of the crowd), it is seen: the
// rider pedals the owner's own machine (it is not at his door meanwhile), the cart is loaded
// by the family and pushed with the goods on it, the passengers get on and off the omnibus and
// sit inside, the family rows out in their boat. The server keeps what belongs to whom and where
// an owner's velocipede stands (town/possessions.ts); a machine Jef took is not there to ride:
// the owner walks, and the server has him remember it.

/** What town.ts shares with this file: its residents (sims) and what it does with them. */
export interface JourneySim {
  r: TownResident;
  x: number;
  z: number;
  inside: boolean;
  door: Pt;
  key: string;
  p: Puppet | null;
  held: boolean;
  outAt: number;
  trip?: Trip | null;
  /** Held by a journey (a helper at the cart, one of the crew): town.ts leaves them be. */
  inTrip?: boolean;
  /** On the omnibus or in a boat: not in the street (town.ts does not put them there). */
  aboard?: boolean;
}
export interface JourneyTown {
  sims(): JourneySim[];
  sim(id: string): JourneySim | undefined;
  anchor(s: JourneySim): Pt;
  clock(): { day: number; hour: number };
  /** Out of the street (in at a door, or on a bus, in a boat). */
  drop(s: JourneySim): void;
  /** Back to their day (the goal's own walk). */
  resume(s: JourneySim): void;
  pace(s: JourneySim): number;
  /** The unseen pace (m/s) people cross town at. */
  hiddenSpeed: number;
}

interface VehicleView {
  id: string;
  kind: "velocipede" | "handcart" | "dray" | "boat";
  owner: string;
  household: number;
  home: [number, number, number];
  parks: Record<string, [number, number, number]>;
  route?: string;
  boat?: { kind: "rowboat" | "punt"; landing: Pt; flight: Pt };
  label: string;
  gone: boolean;
  at: string;
}
interface Errand {
  id: string;
  kind: "boat" | "dray";
  vehicle: string;
  who: string[];
  hour: number;
  back: number;
  to: Pt;
  toLabel: string;
  load: Load;
}
interface TransportData {
  day: number;
  vehicles: VehicleView[];
  errands: Errand[];
  jef: { list: Array<{ id: string; kind: string }>; notice: { n: number; text: string } | null; shop: { step: Pt; show: Array<[number, number, number]>; label: string } | null };
}

type Phase = "fetch" | "load" | "go" | "unload" | "tostop" | "wait" | "bus" | "toberth" | "row" | "ashore" | "walkon";

interface Helper {
  id: string;
  /** 0 out of the door to the cart with a thing, 1 back to the door, 2 in. */
  step: number;
  goT: number;
}

export interface Trip {
  mode: Mode;
  phase: Phase;
  why: string;
  t: number;
  goT: number;
  from: Pt;
  to: Pt;
  key: string;
  veh?: VehicleView;
  /** Where the vehicle stands at the start, and where it is put at the end. */
  fetchAt?: [number, number, number];
  park?: [number, number, number];
  load?: Load;
  loaded: number;
  /** Things still to take off at the end (carried to the stall or in at the door). */
  unload: number;
  door?: Pt;
  helpers: Helper[];
  bus?: { board: OmnibusStop; alight: OmnibusStop; waitT: number };
  boat?: { id: string; path: Pt[] | null; crew: string[]; to: Pt; toTop: Pt; home: boolean; kind: "rowboat" | "punt" };
  errand?: string;
  /** For the dev list. */
  started: number;
  /** Seconds on the way to the boat in Jef's sight (fixes 2026-09-24). */
  seenT?: number;
}

const d2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const STOPS_PLAIN: Stop[] = OMNIBUS_STOPS.map((s) => ({ id: s.id, line: s.line, x: s.x, z: s.z }));
/** Seconds of the street for a thing carried from the door to the cart and back. */
const CARRY_S = 9;
/**
 * Fixes 2026-09-24: on the way to his boat in Jef's sight, after this long (real seconds) he goes
 * on unseen as soon as he is out of sight, and after BERTH_GIVE_UP_S he gives up and walks.
 */
const BERTH_SEEN_S = 30;
const BERTH_GIVE_UP_S = 45;
/** Unseen, he is at his boat within about this many seconds of play. */
const BERTH_UNSEEN_S = 6;

/** The flights of quay steps a family boat lands at (server town/possessions.ts FLIGHTS). */
const FLIGHTS: Array<{ id: string; top: Pt; t: Pt; n: Pt; water: string }> = [
  { id: "vismarkt", top: [-110, 0], t: [-1, 0], n: [0, -1], water: "river" },
  { id: "rijnkaai", top: [-4, 0], t: [-1, 0], n: [0, -1], water: "river" },
  { id: "cartstand", top: [50, 0], t: [1, 0], n: [0, -1], water: "river" },
  { id: "north", top: [186, 0], t: [1, 0], n: [0, -1], water: "river" },
  { id: "canal", top: [-70, 38], t: [0, 1], n: [-1, 0], water: "canal" },
  { id: "bassin", top: [90, 46], t: [1, 0], n: [0, 1], water: "bassin" },
  { id: "bassin_north", top: [116, 110], t: [1, 0], n: [0, -1], water: "bassin" },
];
/** A berth beside a flight's landing (rowing.ts berthOf on the server). */
function berthOf(top: Pt, t: Pt, n: Pt): { x: number; z: number; yaw: number } {
  const s = 4.16 + 1.2 + 0.05;
  const u = 1.62 + 0.78 + 0.6;
  return { x: top[0] + t[0] * s + n[0] * u, z: top[1] + t[1] * s + n[1] * u, yaw: Math.atan2(t[0], t[1]) };
}

export class Journeys {
  data: TransportData | null = null;
  private byOwner = new Map<string, VehicleView[]>();
  private byHousehold = new Map<number, VehicleView[]>();
  /** Where each cart stands now (a place key of its owner's day), as this side has moved it. */
  private cartAt = new Map<string, string>();
  private parked = new Map<string, { cart: PushCart | null; rect: Rect | null; shafts?: Rect | null; items: number; x: number; z: number; yaw: number }>();
  private props: Props | null = null;
  private pollT = 0;
  private seenT = 0;
  private notice = -1;
  private jefIds = "";
  /** Trips started today, by mode (dev and the report). */
  readonly counts: Record<string, number> = {};
  readonly log: string[] = [];
  say: (t: string) => void = () => {};
  /** The client's velocipedes changed (Jef bought or hired one, one was taken from him): reload them. */
  onJefVelos: () => void = () => {};
  player = { x: 0, z: 0 };

  constructor(
    private readonly world: World,
    private readonly crowd: Crowd,
    private readonly velos: Velocipedes,
    private readonly rowing: Rowing,
    private readonly town: JourneyTown,
  ) {
    loadProps()
      .then((p) => (this.props = p))
      .catch(() => {});
  }

  // ------------------------------------------------------------------ the server's list

  async load(): Promise<void> {
    try {
      const r = await fetch("/api/transport", { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const d = (await r.json()) as TransportData;
      if (!d || !Array.isArray(d.vehicles)) return; // a hiccup on the line: keep what we have
      this.apply(d);
    } catch {
      // next time
    }
  }

  private apply(d: TransportData): void {
    const first = !this.data;
    this.data = d;
    this.applyShift();
    this.byOwner.clear();
    this.byHousehold.clear();
    for (const v of d.vehicles) {
      if (!this.byOwner.has(v.owner)) this.byOwner.set(v.owner, []);
      this.byOwner.get(v.owner)!.push(v);
      if (!this.byHousehold.has(v.household)) this.byHousehold.set(v.household, []);
      this.byHousehold.get(v.household)!.push(v);
      // a cart nobody here has moved: where the server has it
      // a cart standing still is where the server's rule has it (the same rule the trips follow)
      if (v.kind === "handcart" && !this.inUse.has(v.id)) this.cartAt.set(v.id, v.at);
    }
    // the drays of the quay traffic are the owners' (their model at the horse's head)
    const tr = this.world.traffic();
    if (tr && first) {
      tr.setOwners(
        d.vehicles
          .filter((v) => v.kind === "dray" && v.route)
          .map((v) => {
            const s = this.town.sim(v.owner);
            return {
              route: v.route!,
              kind: (s?.r.kind ?? "carter") as HumanKind,
              name: s?.r.name ?? "",
              working: () => this.works(v.owner),
            };
          }),
      );
    }
    // Jef's own machine: news of it, and the client's list when it changed
    const ids = d.jef.list.map((v) => v.id).join(",");
    if (ids !== this.jefIds) {
      if (!first) this.onJefVelos();
      this.jefIds = ids;
    }
    if (d.jef.notice && d.jef.notice.n !== this.notice) {
      if (this.notice >= 0) this.say(d.jef.notice.text);
      this.notice = d.jef.notice.n;
    } else if (this.notice < 0) this.notice = d.jef.notice?.n ?? 0;
  }

  /** Is this owner at his work now (his dray goes its round)? */
  private works(id: string): boolean {
    const s = this.town.sim(id);
    const { day, hour } = this.town.clock();
    if (!s) return hour >= 7 && hour < 18.5;
    const now = activityAt(s.r.sched, day, hour);
    return now.act === "work" || (hour >= 7 && hour < 18.5 && now.act !== "home" && now.act !== "church");
  }

  // ------------------------------------------------------------------ what they have

  private veloOf(s: JourneySim): VehicleView | null {
    return this.byOwner.get(s.r.id)?.find((v) => v.kind === "velocipede") ?? null;
  }
  private cartOf(s: JourneySim): VehicleView | null {
    return this.byHousehold.get(s.r.household)?.find((v) => v.kind === "handcart" && v.owner === s.r.id) ?? null;
  }
  private inUse = new Set<string>();

  /** Where a velocipede should stand by its owner's day (the server's rule), if it is his to ride. */
  private veloHere(v: VehicleView, key: string): [number, number, number] | null {
    if (v.gone || this.inUse.has(v.id)) return null;
    const info = this.velos.standing(v.id);
    if (!info) return null;
    const spot = v.parks[key];
    if (!spot) return null;
    // it stands where his day left it (or near: a server list a moment old)
    return Math.hypot(info.x - spot[0], info.z - spot[1]) < 4 ? [info.x, info.z, info.yaw] : null;
  }

  // ------------------------------------------------------------------ a new trip

  /**
   * The schedule moved this resident on (town.ts reschedule): how do they go? A trip for the
   * vehicle modes; walking is town.ts's own walk (null).
   */
  begin(s: JourneySim, prevKey: string, prevPt: Pt | null): Trip | null {
    if (s.held || s.inTrip || !this.data) return null;
    if (s.trip) this.end(s, false);
    const to = this.town.anchor(s);
    const from: Pt = prevPt ?? [s.x, s.z];
    const newKey = s.key;
    const r = s.r;
    const wealth = this.wealthOf(r);
    const load = scheduleLoad(r.trade, wealth, prevKey, newKey);
    const velo = this.veloOf(s);
    const cart = this.cartOf(s);
    const veloAt = velo ? this.veloHere(velo, prevKey) : null;
    // a velocipede Jef has: the owner wanted it and it is not there; he walks and is cross
    if (velo?.gone && (velo.parks[newKey] || velo.parks.home) && d2(from, to) > WALK_MAX_M) void this.missed(velo.id, s);
    const cartKey = cart ? this.cartAt.get(cart.id) ?? "home" : null;
    const cartHere = !!cart && !cart.gone && !this.jefHas.has(cart.id) && !this.inUse.has(cart.id) && cartKey === prevKey && !!cart.parks[newKey];
    const plan = chooseMode({
      from,
      to,
      load,
      has: { velocipede: !!veloAt && !!velo!.parks[newKey], handcart: cartHere },
      stops: STOPS_PLAIN,
      busWait: (st) => this.busWait(st),
      age: r.age,
    });
    if (plan.mode === "walk") return null;
    const t: Trip = { mode: plan.mode, phase: "fetch", why: plan.why, t: 0, goT: 0, from, to, key: newKey, loaded: 0, unload: 0, helpers: [], started: performance.now() };
    if (plan.mode === "velocipede" && velo && veloAt) {
      t.veh = velo;
      t.fetchAt = veloAt;
      t.park = velo.parks[newKey];
      this.inUse.add(velo.id);
      this.velos.use(velo.id, true);
    } else if (plan.mode === "handcart" && cart) {
      t.veh = cart;
      t.fetchAt = cart.parks[prevKey] ?? cart.home;
      t.park = cart.parks[newKey];
      this.placeParked(cart.id, t.fetchAt);
      t.load = load ?? undefined;
      t.door = prevKey === "home" ? [r.home.sx, r.home.sz] : this.town.anchor(s);
      // what is on it now (left there), and what they bring out to it
      t.loaded = this.parked.get(cart.id)?.items ?? 0;
      t.unload = load?.items ?? 0;
      this.inUse.add(cart.id);
      if (load && load.items > t.loaded && prevKey === "home") {
        t.phase = "load";
        t.helpers = this.helpersFor(s, load.items - t.loaded);
      }
    } else if (plan.mode === "omnibus" && plan.bus) {
      const board = OMNIBUS_STOPS.find((q) => q.id === plan.bus!.board.id && q.line === plan.bus!.board.line)!;
      const alight = OMNIBUS_STOPS.find((q) => q.id === plan.bus!.alight.id && q.line === plan.bus!.alight.line)!;
      t.bus = { board, alight, waitT: 0 };
      t.phase = "tostop";
    } else return null;
    this.counts[plan.mode] = (this.counts[plan.mode] ?? 0) + 1;
    this.note(`${r.name}: ${plan.mode} (${plan.why}), ${Math.round(plan.dist)} m`);
    s.trip = t;
    return t;
  }

  /** Seconds until the next omnibus of this stop's line stands at it (from where the omnibuses are now). */
  private busWait(st: Stop): number {
    const info = this.world.omnibus()?.info() as { buses: Array<{ line: string; s: number; length: number; stop: string | null }>; lines: Array<{ id: string; length: number; stops: Array<[string, number]> }> } | undefined;
    const line = info?.lines.find((l) => l.id === st.line);
    const at = line?.stops.find(([id]) => id === st.id)?.[1];
    if (!info || !line || at === undefined) return 9999;
    let best = 9999;
    for (const b of info.buses) {
      if (b.line !== st.line) continue;
      const ahead = (((at - b.s) % line.length) + line.length) % line.length;
      // about 2.6 m/s with the stops on the way
      best = Math.min(best, b.stop === st.id ? 0 : ahead / 2.6);
    }
    // M7 omnibus routes: and never before the timetable's next omnibus there (none at night)
    const { day, hour } = this.town.clock();
    const now = absMinute(day, 0) + hour * 60;
    const due = departures(st.line, st.id, now, 1)[0];
    if (due !== undefined) best = Math.max(best, realS(due - now) - 20);
    return best;
  }

  private wealthOf(r: TownResident): number {
    // the client has no stats: a seller's goods by her trade (engine: 2 + wealth/2, 2 to 4 things)
    return r.trade === "fishwife" ? 1 : r.trade === "market_woman" ? 3 : 3;
  }

  /** The household at home, old enough to carry, who come out to help load (planLoading). */
  private helpersFor(s: JourneySim, items: number): Helper[] {
    const { day, hour } = this.town.clock();
    const fam = this.town
      .sims()
      .filter((o) => o !== s && o.r.household === s.r.household && !o.held && !o.inTrip && !o.trip)
      // at home now (also one about to leave for the day: they help first, then go)
      .map((o) => ({ id: o.r.id, age: o.r.age, home: o.inside && (activityAt(o.r.sched, day, hour).act === "home" || Math.abs(o.door[0] - s.r.home.sx) + Math.abs(o.door[1] - s.r.home.sz) < 0.5) }));
    const plan = planLoading(items, s.r.id, fam);
    return plan.carriers.slice(1).map((id) => ({ id, step: 0, goT: 0 }));
  }

  /** The owner went for his machine and Jef has it: the server has him remember (once). */
  private async missed(velo: string, s: JourneySim): Promise<void> {
    if (this.missedOnce.has(velo)) return;
    this.missedOnce.add(velo);
    this.note(`${s.r.name}: the velocipede is gone; walks`);
    try {
      await fetch("/api/transport/missed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ velo }), signal: AbortSignal.timeout(6000) });
    } catch {
      // the server will hear of it next time
    }
    // cross, if Jef is by to hear it
    if (s.p && s.p.shown && Math.hypot(s.p.x - this.player.x, s.p.z - this.player.z) < 25) this.say(`${s.r.first}: "My velocipede's gone! Some thief has had it away. On foot again, then."`);
  }
  private missedOnce = new Set<string>();

  // ------------------------------------------------------------------ errands with a load

  /** An errand of the day this resident is on now (the owner, or one of the crew). */
  errandFor(id: string, day: number, hour: number): Errand | null {
    const d = this.data;
    if (!d || d.day !== day) return null;
    return d.errands.find((e) => e.who.includes(id) && hour >= e.hour && hour < e.back) ?? null;
  }

  /** Where an errand takes them: the top of the flight they row to, or the shop's door. */
  errandPoint(e: Errand): Pt {
    return e.to;
  }

  /**
   * The owner of an errand's vehicle sets out (town.ts: his errand began). The boat: the crew
   * walk to the berth, row to the other flight, go up the steps. The dray: from its yard to the
   * shop door, the sacks carried in, and back to the yard.
   */
  beginErrand(s: JourneySim, e: Errand, back: boolean): Trip | null {
    const v = this.data?.vehicles.find((q) => q.id === e.vehicle);
    if (!v || s.r.id !== e.who[0]) return null;
    if (back && this.gaveUp.has(e.id)) return null; // the boat never left: home on foot
    if (s.trip) this.end(s, false);
    const t: Trip = { mode: e.kind === "boat" ? "boat" : "dray", phase: "toberth", why: back ? "home with the boat" : `an errand to ${e.toLabel}`, t: 0, goT: 0, from: [s.x, s.z], to: this.town.anchor(s), key: s.key, veh: v, loaded: 0, unload: 0, helpers: [], errand: e.id, started: performance.now() };
    if (e.kind === "boat" && v.boat) {
      const home = FLIGHTS.find((f) => d2(f.top, v.boat!.flight) < 1)!;
      const there = FLIGHTS.find((f) => d2(f.top, e.to) < 1) ?? home;
      const [fromF, toF] = back ? [there, home] : [home, there];
      const b0 = berthOf(fromF.top, fromF.t, fromF.n);
      const b1 = berthOf(toF.top, toF.t, toF.n);
      const path = waterPath((x, z) => this.rowing.townFree(x, z), [b0.x, b0.z], [b1.x, b1.z], 2, 40);
      const crew = e.who.filter((id) => this.town.sim(id) && !this.town.sim(id)!.held);
      t.boat = { id: v.id, path: path ? [...path.slice(0, -1), [b1.x, b1.z]] : null, crew, to: [b1.x, b1.z], toTop: toF.top, home: back, kind: v.boat.kind };
      t.fetchAt = [fromF.top[0] + fromF.t[0] * 0.8, fromF.top[1] + fromF.t[1] * 0.8, 0];
      t.load = e.load;
      if (!path) {
        this.note(`${s.r.name}: no open water to ${toF.id} now; walks`);
        return null;
      }
      // the crew come along: held by this trip, following the owner
      for (const id of crew.slice(1)) {
        const o = this.town.sim(id);
        if (o && !o.held && !o.trip) o.inTrip = true;
      }
    } else if (e.kind === "dray" && v.route) {
      const yard = this.world.traffic()?.yards().find((y) => y.route === v.route);
      if (!yard) return null;
      t.fetchAt = [yard.x, yard.z, yard.yaw];
      t.park = [yard.x, yard.z, yard.yaw];
      t.to = back ? [yard.x, yard.z] : e.to;
      t.load = e.load;
      t.unload = back ? 0 : e.load.items;
    } else return null;
    this.counts[t.mode] = (this.counts[t.mode] ?? 0) + 1;
    this.note(`${s.r.name}: ${t.mode} errand (${t.why})`);
    s.trip = t;
    return t;
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, player: { x: number; z: number }): void {
    this.player = { x: player.x, z: player.z };
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = 10;
      void this.load();
    }
    // Jef owns a machine: tell the server now and then where he is (a machine he stands by is watched)
    this.seenT -= dt;
    if (this.seenT <= 0 && this.data?.jef.list.length) {
      this.seenT = 5;
      void fetch("/api/transport/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: +player.x.toFixed(1), z: +player.z.toFixed(1) }) }).catch(() => {});
    }
    this.drawParked();
    this.drawShop();
  }

  // ---- the velocipede maker's door: a board over it, and two machines on show in his hours

  private shopDrawn: { sign: THREE.Mesh; bikes: THREE.Object3D[] } | null = null;
  private shopLoading = false;
  private drawShop(): void {
    const shop = this.data?.jef.shop as (TransportData["jef"]["shop"] & { wall: Pt; out: Pt }) | null | undefined;
    if (!shop) return;
    if (!this.shopDrawn && !this.shopLoading) {
      this.shopLoading = true;
      void loadVelocipede().then((proto) => {
        const c = document.createElement("canvas");
        c.width = 256;
        c.height = 48;
        const g = c.getContext("2d")!;
        g.fillStyle = "#2c3a2e";
        g.fillRect(0, 0, 256, 48);
        g.strokeStyle = "#c9b27a";
        g.lineWidth = 3;
        g.strokeRect(3, 3, 250, 42);
        g.fillStyle = "#e0cf98";
        g.font = "bold 26px 'Scheldemist Print', Georgia, serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("VELOCIPEDES", 128, 25);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.32), psx(new THREE.MeshLambertMaterial({ map: tex })));
        sign.position.set(shop.wall[0] + shop.out[0] * 0.12, 2.75, shop.wall[1] + shop.out[1] * 0.12);
        sign.rotation.y = Math.atan2(shop.out[0], shop.out[1]);
        this.world.scene.add(sign);
        const bikes: THREE.Object3D[] = [];
        for (const sp of shop.show) {
          if (!proto) break;
          const m = proto.clone(true);
          m.position.set(sp[0], 0, sp[1]);
          m.rotation.order = "YXZ";
          m.rotation.set(0, sp[2], 0.06);
          this.world.scene.add(m);
          bikes.push(m);
        }
        this.shopDrawn = { sign, bikes };
      });
      return;
    }
    if (!this.shopDrawn) return;
    // on show while he works; a spot where Jef's own machine stands is left free
    const { day, hour } = this.town.clock();
    const maker = this.town.sim("velo_maker");
    const open = !!maker && activityAt(maker.r.sched, day, hour).act === "work";
    const mine = this.velos.list().filter((v) => v.mine);
    shop.show.forEach((sp, i) => {
      const b = this.shopDrawn!.bikes[i];
      if (!b) return;
      b.visible = open && !mine.some((v) => Math.hypot(v.x - sp[0], v.z - sp[1]) < 1.4) && Math.hypot(sp[0] - this.player.x, sp[1] - this.player.z) < 70;
    });
  }

  /** Carts standing still (at home, by the stall): drawn near Jef, solid to walk into. */
  private drawParked(): void {
    const d = this.data;
    if (!d || !this.props) return;
    for (const v of d.vehicles) {
      if (v.kind !== "handcart") continue;
      // M6 handcart: Jef has it (game/handcart.ts draws it where he has it): not here
      if (v.gone || this.jefHas.has(v.id)) {
        const pk = this.parked.get(v.id);
        if (pk?.cart) {
          pk.cart.dispose();
          pk.cart = null;
          if (pk.rect) this.world.removeCollider(pk.rect);
          if (pk.shafts) this.world.removeCollider(pk.shafts);
          pk.rect = pk.shafts = null;
        }
        continue;
      }
      const key = this.cartAt.get(v.id) ?? v.at;
      const spot = v.parks[key] ?? v.home;
      let pk = this.parked.get(v.id);
      if (!pk) this.parked.set(v.id, (pk = { cart: null, rect: null, items: 0, x: spot[0], z: spot[1], yaw: spot[2] }));
      if (!this.pushed.has(v.id) && !this.inUse.has(v.id)) [pk.x, pk.z, pk.yaw] = spot;
      // moved since it was drawn (pushed somewhere else): drawn again there
      const where = `${pk.x},${pk.z},${pk.yaw}`;
      if (pk.cart && (pk as { drawnAt?: string }).drawnAt !== where) this.liftParked(v.id), this.pushed.delete(v.id);
      (pk as { drawnAt?: string }).drawnAt = where;
      const near = !this.pushed.has(v.id) && Math.hypot(pk.x - this.player.x, pk.z - this.player.z) < 60;
      if (near && !pk.cart) {
        pk.cart = new PushCart(this.world.scene, this.props, { load: false });
        // parked: its axle on the spot, the shafts out behind it (away from the way it points), on its legs
        const gx = pk.x - Math.sin(pk.yaw) * 2.15;
        const gz = pk.z - Math.cos(pk.yaw) * 2.15;
        pk.cart.place(gx, gz, pk.yaw);
        pk.cart.push(0.5, gx, gz, 0.9, pk.yaw, 0);
        pk.cart.setItems(pk.items, "goods");
        pk.rect = { ...pk.cart.rects[0] };
        this.world.addCollider(pk.rect);
        // the shafts are solid too (M6 handcart)
        pk.shafts = { ...pk.cart.rects[1] };
        this.world.addCollider(pk.shafts);
      } else if (!near && pk.cart) {
        pk.cart.dispose();
        pk.cart = null;
        if (pk.rect) this.world.removeCollider(pk.rect);
        if (pk.shafts) this.world.removeCollider(pk.shafts);
        pk.rect = pk.shafts = null;
      }
    }
  }

  /** M6 handcart: carts Jef has taken (until the server's list says so, and after). */
  private jefHas = new Set<string>();

  /** M6 handcart: Jef took this household's cart (on), or it went back to them (off). */
  jefTook(id: string, on: boolean): void {
    if (on) this.jefHas.add(id);
    else this.jefHas.delete(id);
  }

  /** M6 handcart: the households' carts standing still near Jef now (not in use): to be taken. */
  standingCarts(): Array<{ id: string; x: number; z: number; yaw: number; label: string; owner: string }> {
    const out: Array<{ id: string; x: number; z: number; yaw: number; label: string; owner: string }> = [];
    for (const v of this.data?.vehicles ?? []) {
      if (v.kind !== "handcart" || v.gone || this.jefHas.has(v.id) || this.inUse.has(v.id) || this.pushed.has(v.id)) continue;
      const pk = this.parked.get(v.id);
      if (!pk?.cart) continue;
      out.push({ id: v.id, x: pk.x, z: pk.z, yaw: pk.yaw, label: v.label, owner: v.owner });
    }
    return out;
  }

  /** A parked cart: show the things on it now (loading one by one). */
  private setParkedItems(id: string, n: number, what?: Load["what"]): void {
    const pk = this.parked.get(id);
    if (!pk) return;
    pk.items = n;
    pk.cart?.setItems(n, what ?? "goods");
  }

  /** A cart about to be used stands here (where the trip finds it). */
  private placeParked(id: string, spot: [number, number, number]): void {
    let pk = this.parked.get(id);
    if (!pk) this.parked.set(id, (pk = { cart: null, rect: null, items: 0, x: spot[0], z: spot[1], yaw: spot[2] }));
    [pk.x, pk.z, pk.yaw] = spot;
  }

  /** Carts being pushed now (their parked copy is not drawn). */
  private pushed = new Set<string>();

  /** The cart is taken (in use): its parked copy goes. */
  private liftParked(id: string): void {
    this.pushed.add(id);
    const pk = this.parked.get(id);
    if (!pk) return;
    pk.cart?.dispose();
    pk.cart = null;
    if (pk.rect) this.world.removeCollider(pk.rect);
    if (pk.shafts) this.world.removeCollider(pk.shafts);
    pk.rect = pk.shafts = null;
  }

  // ------------------------------------------------------------------ the traveller, unseen

  /** town.ts coarse(): the traveller is out of sight. True: this file moved them. */
  coarse(s: JourneySim, dt: number): boolean {
    const t = s.trip;
    if (!t) return false;
    t.t += dt;
    const k = this.town.hiddenSpeed / SPEED.walk;
    const move = (to: Pt, mode: Mode): boolean => {
      const d = Math.hypot(to[0] - s.x, to[1] - s.z);
      if (d < 0.6) return true;
      const step = Math.min(d, SPEED[mode] * k * dt);
      s.x += ((to[0] - s.x) / d) * step;
      s.z += ((to[1] - s.z) / d) * step;
      return false;
    };
    switch (t.phase) {
      case "fetch":
        if (!t.fetchAt || move([t.fetchAt[0], t.fetchAt[1]], "walk")) this.take(s, t, null);
        return true;
      case "load": {
        // unseen, the family carry it out in the time it takes (planLoading)
        const rounds = Math.ceil(Math.max(1, (t.load?.items ?? 1) - t.loaded) / (1 + t.helpers.length));
        if (t.t > (rounds * CARRY_S) / k) {
          t.loaded = t.load?.items ?? 0;
          this.setParkedItems(t.veh!.id, t.loaded, t.load?.what);
          this.releaseHelpers(t, true);
          this.take(s, t, null);
        }
        return true;
      }
      case "go":
        if (move(t.park ? [t.park[0], t.park[1]] : t.to, t.mode)) this.arrive(s, t, null);
        return true;
      case "unload":
        if (t.t > (t.unload * CARRY_S * 0.7) / k) {
          t.unload = 0;
          this.setParkedItems(t.veh!.id, 0);
          t.phase = "walkon";
          t.t = 0;
        }
        return true;
      case "tostop":
        if (move(this.stopSpot(t.bus!.board), "walk")) {
          t.phase = "wait";
          t.t = 0;
        }
        return true;
      case "wait":
        return this.waitBus(s, t, null, dt);
      case "bus":
        return this.onBus(s, t);
      case "toberth":
        if (t.mode === "dray") {
          if (move([t.fetchAt![0], t.fetchAt![1]], "walk")) this.startDray(s, t, null);
          return true;
        }
        {
          // unseen to his boat in a few seconds of play (fixes 2026-09-24: the errand is two and a
          // half game hours, five real minutes since M7, and a family's steps may be 360 m off)
          const d = Math.hypot(t.fetchAt![0] - s.x, t.fetchAt![1] - s.z);
          if (d > 0.6) {
            const step = Math.min(d, Math.max(SPEED.walk * k, d / BERTH_UNSEEN_S) * dt);
            s.x += ((t.fetchAt![0] - s.x) / d) * step;
            s.z += ((t.fetchAt![1] - s.z) / d) * step;
          } else this.startRow(s, t);
        }
        return true;
      case "row":
        return this.row(s, t, dt, false);
      case "ashore":
      case "walkon":
        if (move(t.to, "walk")) this.end(s, true);
        return true;
    }
    return true;
  }

  // ------------------------------------------------------------------ the traveller, seen

  /** town.ts behave(): the traveller is a puppet near Jef. True: this file walks them. */
  behave(s: JourneySim, dt: number): boolean {
    const t = s.trip;
    const p = s.p;
    if (!t || !p) return false;
    t.t += dt;
    t.goT -= dt;
    const busy = this.crowd.puppetBusy(p);
    const go = (x: number, z: number, pace: number) => {
      if (t.goT > 0 && busy) return;
      t.goT = 1.2;
      this.crowd.puppetGo(p, x, z, pace);
    };
    const near = (x: number, z: number, r: number) => Math.hypot(p.x - x, p.z - z) < r;
    switch (t.phase) {
      case "fetch": {
        const [fx, fz] = t.fetchAt!;
        if (near(fx - (t.mode === "handcart" ? Math.sin(t.fetchAt![2]) * 2.6 : 0), fz - (t.mode === "handcart" ? Math.cos(t.fetchAt![2]) * 2.6 : 0), 1.5)) this.take(s, t, p);
        else go(fx + Math.sin(t.fetchAt![2]) * (t.mode === "handcart" ? -2.6 : 0), fz + Math.cos(t.fetchAt![2]) * (t.mode === "handcart" ? -2.6 : 0), this.town.pace(s));
        return true;
      }
      case "load":
        this.loading(s, t, p, dt);
        return true;
      case "go": {
        const [gx, gz] = t.park ? [t.park[0], t.park[1]] : t.to;
        if (near(gx, gz, t.mode === "velocipede" ? 1.6 : t.mode === "dray" ? 3.5 : 3.0)) {
          this.arrive(s, t, p);
          return true;
        }
        const pace = t.mode === "velocipede" ? 4.0 : t.mode === "handcart" ? 0.95 : t.mode === "dray" ? 1.15 : this.town.pace(s);
        go(gx, gz, pace);
        // cannot get through with it (the grid round Jef ends, a way too narrow): on, unseen
        if (t.t > 90) this.arrive(s, t, p);
        return true;
      }
      case "unload":
        this.unloading(s, t, p, dt);
        return true;
      case "tostop": {
        const [sx, sz] = this.stopSpot(t.bus!.board);
        if (near(sx, sz, 1.6)) {
          t.phase = "wait";
          t.t = 0;
          this.crowd.puppetStand(p, "idle", Math.atan2(t.bus!.board.x - p.x, t.bus!.board.z - p.z));
        } else go(sx, sz, this.town.pace(s));
        return true;
      }
      case "wait":
        return this.waitBus(s, t, p, dt);
      case "bus":
        return this.onBus(s, t);
      case "toberth": {
        const [bx, bz] = t.fetchAt!;
        // the yard is on the dray's lane (it may stand there): near enough is at it; held up a minute: go on
        if (near(bx, bz, t.mode === "dray" ? 4.5 : 1.8) || (t.mode === "dray" && t.t > 60)) {
          if (t.mode === "dray") this.startDray(s, t, p);
          else if (this.crewReady(s, t)) this.startRow(s, t);
          else this.crowd.puppetStand(p, "idle", null);
        } else if (t.mode === "boat" && (!this.crowd.onGrid(bx, bz) || (t.seenT = (t.seenT ?? 0) + dt) > BERTH_SEEN_S) && !p.shown) {
          // fixes 2026-09-24 (Karel Van Loock stood at the Steenplein for minutes, his boat 360 m
          // off at the north steps, beyond the walk grid round Jef): out of sight, on unseen
          this.town.drop(s);
          return true;
        } else if (t.mode === "boat" && (t.seenT ?? 0) > BERTH_GIVE_UP_S) {
          // in sight all the while and not there: no boat today, he walks to where he was going
          this.note(`${s.r.name} gives up on the boat and walks`);
          if (t.errand) this.gaveUp.add(t.errand);
          this.end(s, false);
          this.town.resume(s);
          return false;
        } else go(bx, bz, this.town.pace(s));
        this.crewFollow(s, t, dt);
        return true;
      }
      case "row":
        return this.row(s, t, dt, true);
      case "ashore":
      case "walkon":
        if (near(t.to[0], t.to[1], 1.6)) this.end(s, true);
        else go(t.to[0], t.to[1], this.town.pace(s));
        return true;
    }
    return true;
  }

  /** Where to wait for the omnibus: beside the post, off the lane. */
  private stopSpot(st: OmnibusStop): Pt {
    const dx = st.post[0] - st.x;
    const dz = st.post[1] - st.z;
    const L = Math.hypot(dx, dz) || 1;
    return [st.post[0] + (dx / L) * 0.8, st.post[1] + (dz / L) * 0.8];
  }

  // ------------------------------------------------------------------ the vehicle

  /** At the vehicle: up on the saddle, hands on the cart, off to the yard for the dray. */
  private take(_s: JourneySim, t: Trip, p: Puppet | null): void {
    t.phase = "go";
    t.t = 0;
    t.goT = 0;
    // at the shafts, facing the way the cart points
    if (p && t.mode === "handcart" && t.fetchAt) p.yaw = t.fetchAt[2];
    if (t.mode === "velocipede" && p) this.crowd.puppetVehicle(p, { kind: "velo" });
    if (t.mode === "handcart") {
      this.liftParked(t.veh!.id);
      if (p) this.crowd.puppetVehicle(p, { kind: "cart", items: t.loaded, what: t.load?.what });
    }
  }

  /** At the end of the way: the machine leans at its spot, the cart is set down, the dray unloaded. */
  private arrive(s: JourneySim, t: Trip, p: Puppet | null): void {
    t.t = 0;
    if (t.mode === "velocipede" && t.veh) {
      if (p) this.crowd.puppetVehicle(p, null);
      const at = t.park ?? [s.x, s.z, 0];
      this.inUse.delete(t.veh.id);
      this.velos.use(t.veh.id, false, { x: at[0], z: at[1], yaw: at[2] });
      t.phase = "walkon";
      return;
    }
    if (t.mode === "handcart" && t.veh) {
      if (p) this.crowd.puppetVehicle(p, null);
      this.inUse.delete(t.veh.id);
      this.pushed.delete(t.veh.id);
      this.cartAt.set(t.veh.id, t.key);
      // it stands where the trip ends (a dev trip's own spot, else the day's spot for it)
      const pk = this.parked.get(t.veh.id);
      if (pk && t.park) [pk.x, pk.z, pk.yaw] = t.park;
      this.setParkedItems(t.veh.id, t.loaded, t.load?.what);
      t.door = t.to;
      t.phase = t.unload > 0 ? "unload" : "walkon";
      return;
    }
    if (t.mode === "dray") {
      if (t.unload > 0) {
        t.phase = "unload";
        if (p) this.crowd.puppetStand(p, "idle", null);
      } else {
        // back in the yard: the dray is the round's again
        if (p) this.crowd.puppetVehicle(p, null);
        if (t.veh?.route) this.world.traffic()?.away(t.veh.route, false);
        t.phase = "walkon";
        t.to = this.town.anchor(s);
      }
    }
  }

  // ------------------------------------------------------------------ loading and unloading

  /**
   * Loading at home: the one who goes and the family who came out carry the things one each
   * from the door to the cart, each put on it where it shows, until all are on; then the family
   * go back in and the cart is pushed off. Seen here; unseen it is timed (coarse).
   */
  private loading(s: JourneySim, t: Trip, p: Puppet, dt: number): void {
    const cart = t.fetchAt!;
    const door = t.door!;
    const items = t.load?.items ?? 0;
    // where things go on: beside the bed on whichever side one can stand, else at the shafts' end
    if (!(t as Trip & { bed?: Pt }).bed) {
      const dx = Math.sin(cart[2]);
      const dz = Math.cos(cart[2]);
      const cands: Pt[] = [
        [cart[0] - dx * 0.6 + dz * 1.0, cart[1] - dz * 0.6 - dx * 1.0],
        [cart[0] - dx * 0.6 - dz * 1.0, cart[1] - dz * 0.6 + dx * 1.0],
        [cart[0] - dx * 2.7, cart[1] - dz * 2.7],
      ];
      (t as Trip & { bed?: Pt }).bed = cands.find((q) => this.crowd.canStand(q[0], q[1])) ?? cands[2];
    }
    const bed = (t as Trip & { bed?: Pt }).bed!;
    const carrier = (who: Puppet, st: { step: number; goT: number; wait?: number }, put: () => void) => {
      st.goT -= dt;
      // a moment at each end: stooping to put it on the cart, fetching the next thing from inside
      if ((st.wait = (st.wait ?? 0) - dt) > 0) return;
      if (st.step === 0) {
        this.crowd.puppetLoad(who, true);
        if (Math.hypot(who.x - bed[0], who.z - bed[1]) < 1.5) {
          put();
          this.crowd.puppetLoad(who, false);
          this.crowd.puppetStand(who, "idle", Math.atan2(cart[0] - who.x, cart[1] - who.z));
          st.step = 1;
          st.goT = 0;
          st.wait = 1.3;
        } else if (st.goT <= 0 || !this.crowd.puppetBusy(who)) {
          st.goT = 1.5;
          this.crowd.puppetGo(who, bed[0], bed[1], 0.9);
        }
      } else if (st.step === 1) {
        if (Math.hypot(who.x - door[0], who.z - door[1]) < 0.9) {
          st.step = t.loaded + this.carrying(t) < items ? 0 : 2;
          st.wait = st.step === 0 ? 1.6 : 0;
          if (st.step === 0) this.crowd.puppetStand(who, "idle", Math.atan2(door[0] - who.x, door[1] - who.z));
        } else if (st.goT <= 0 || !this.crowd.puppetBusy(who)) {
          st.goT = 1.5;
          this.crowd.puppetGo(who, door[0], door[1], 1.1);
        }
      }
    };
    // the owner carries too
    const own = (t as Trip & { ownStep?: { step: number; goT: number } }).ownStep ?? { step: 1, goT: 0 };
    (t as Trip & { ownStep?: { step: number; goT: number } }).ownStep = own;
    if (own.step !== 2) {
      carrier(p, own, () => {
        t.loaded = Math.min(items, t.loaded + 1);
        this.setParkedItems(t.veh!.id, t.loaded, t.load?.what);
      });
    }
    // the family: out of the door (as people of the street, near Jef), one thing each a round
    for (const h of t.helpers) {
      const o = this.town.sim(h.id);
      if (!o || h.step === 2) continue;
      if (!o.inTrip) {
        o.inTrip = true;
        o.held = true;
        if (o.inside) {
          o.inside = false;
          o.x = door[0];
          o.z = door[1];
          o.outAt = performance.now();
        }
      }
      if (!o.p) {
        // the town puts them in the street at the door when it can; not out in a few seconds: they stay in
        h.goT -= dt;
        if (h.goT < -4) {
          h.step = 2;
          o.inTrip = false;
          o.held = false;
          o.inside = true;
        }
        continue;
      }
      carrier(o.p, h, () => {
        t.loaded = Math.min(items, t.loaded + 1);
        this.setParkedItems(t.veh!.id, t.loaded, t.load?.what);
      });
    }
    const allIn = t.loaded >= items;
    if (allIn || t.t > 40) {
      // done: the family go back in, the owner takes the cart
      t.loaded = Math.max(t.loaded, allIn ? items : t.loaded);
      this.releaseHelpers(t, false);
      if (Math.hypot(p.x - cart[0], p.z - cart[1]) < 3.2 || t.t > 40) {
        this.crowd.puppetLoad(p, false);
        this.take(s, t, p);
      } else if (!this.crowd.puppetBusy(p)) this.crowd.puppetGo(p, cart[0] - Math.sin(cart[2]) * 2.2, cart[1] - Math.cos(cart[2]) * 2.2, 1.0);
    }
  }
  /** How many are on their way to the cart with a thing now. */
  private carrying(t: Trip): number {
    let n = 0;
    for (const h of t.helpers) if (h.step === 0) n++;
    return n;
  }

  /** The family go in again (walk to the door and vanish, or simply are in when unseen). */
  private releaseHelpers(t: Trip, unseen: boolean): void {
    for (const h of t.helpers) {
      const o = this.town.sim(h.id);
      if (!o || h.step === 2) continue;
      h.step = 2;
      o.inTrip = false;
      o.held = false;
      if (o.p) this.crowd.puppetLoad(o.p, false);
      if (unseen && !o.p) o.inside = true;
      this.town.resume(o);
    }
  }

  /** At the stall or the door: the one who brought them carries the things off the cart. */
  private unloading(_s: JourneySim, t: Trip, p: Puppet, dt: number): void {
    const own = (t as Trip & { offStep?: { step: number; goT: number; tt: number } }).offStep ?? { step: 0, goT: 0, tt: 0 };
    (t as Trip & { offStep?: { step: number; goT: number; tt: number } }).offStep = own;
    own.goT -= dt;
    own.tt += dt;
    // the dray's bed (where he stopped, 4 m behind him), or the cart's spot
    const tt = t as Trip & { from4?: Pt };
    if (t.mode === "dray" && !tt.from4) tt.from4 = [p.x - Math.sin(p.yaw) * 4, p.z - Math.cos(p.yaw) * 4];
    const src: Pt = t.mode === "dray" ? tt.from4! : t.park ? [t.park[0], t.park[1]] : [p.x, p.z];
    const dst: Pt = t.mode === "dray" ? t.to : (t.door ?? t.to);
    if (own.step === 0) {
      // to the cart for the next thing
      if (Math.hypot(p.x - src[0], p.z - src[1]) < 2.4 || own.tt > 12) {
        own.tt = 0;
        this.crowd.puppetLoad(p, true);
        t.unload--;
        if (t.veh && t.mode === "handcart") this.setParkedItems(t.veh.id, Math.max(0, t.unload));
        own.step = 1;
        own.goT = 0;
      } else if (own.goT <= 0 || !this.crowd.puppetBusy(p)) {
        own.goT = 1.5;
        this.crowd.puppetGo(p, src[0], src[1], 1.0);
      }
    } else if (Math.hypot(p.x - dst[0], p.z - dst[1]) < 2.4 || own.tt > 12) {
      own.tt = 0;
      this.crowd.puppetLoad(p, false);
      own.step = 0;
      if (t.unload <= 0) {
        if (t.mode === "dray") {
          // unloaded: back to the yard with the empty dray
          const pv = this.crowd.puppetVehicleOf(p);
          if (pv?.kind === "dray") this.crowd.puppetVehicle(p, { kind: "dray", loaded: false });
          t.phase = "go";
          t.park = t.fetchAt;
          t.to = [t.fetchAt![0], t.fetchAt![1]];
          t.t = 0;
        } else {
          t.phase = "walkon";
          t.t = 0;
        }
      }
    } else if (own.goT <= 0 || !this.crowd.puppetBusy(p)) {
      own.goT = 1.5;
      this.crowd.puppetGo(p, dst[0], dst[1], 1.0);
    }
  }

  // ------------------------------------------------------------------ the omnibus

  /** At the stop: the next omnibus of the line that stands here takes them (no fare). */
  private waitBus(s: JourneySim, t: Trip, p: Puppet | null, dt: number): boolean {
    const b = t.bus!;
    b.waitT += dt;
    const buses = this.world.omnibus()?.buses ?? [];
    const bus = buses.find((q) => {
      const at = q.atStop();
      return !!at && at.id === b.board.id && at.line === b.board.line;
    });
    if (bus) {
      const om = this.world.omnibus()!;
      if (om.boardResident(bus, { id: s.r.id, kind: (p?.kind ?? s.r.kind) as HumanKind }, b.alight.id)) {
        this.note(`${s.r.name} gets on the ${bus.line.name} at ${b.board.name}`);
        (t as Trip & { busRef?: Omnibus }).busRef = bus;
        t.phase = "bus";
        if (p) this.town.drop(s);
        s.aboard = true;
        return true;
      }
    }
    // no room, or none came in a long while: they walk after all
    if (b.waitT > 300) {
      t.phase = "walkon";
      t.t = 0;
    }
    if (p && !this.crowd.puppetBusy(p) && Math.random() < 0.6 * dt) this.crowd.puppetStand(p, "idle", Math.atan2(b.board.x - p.x, b.board.z - p.z));
    return true;
  }

  /** Riding: they go where the omnibus goes, until they step off at their stop (omnibus.ts calls offBus). */
  private onBus(s: JourneySim, t: Trip): boolean {
    const bus = (t as Trip & { busRef?: Omnibus }).busRef;
    const om = this.world.omnibus();
    if (bus) {
      const q = bus.pose();
      s.x = q.x;
      s.z = q.z;
    }
    // lost track of them (a new game, a reload of the buses): walk from here
    if (!om?.residents().some((r) => r.id === s.r.id)) {
      s.aboard = false;
      t.phase = "walkon";
    }
    return true;
  }

  /** Off the omnibus for an action (actions.ts byTram), not a trip of the day: where they stand. */
  private offs = new Map<string, { x: number; z: number; yaw: number }>();
  takeOff(id: string): { x: number; z: number; yaw: number } | null {
    const at = this.offs.get(id) ?? null;
    this.offs.delete(id);
    return at;
  }

  /** omnibus.ts: a townsperson stepped off at their stop. */
  offBus(id: string, at: { x: number; z: number; yaw: number }): void {
    const s = this.town.sim(id);
    if (s && !s.trip) {
      this.offs.set(id, at);
      return;
    }
    if (!s?.trip || s.trip.phase !== "bus") return;
    s.aboard = false;
    s.x = at.x;
    s.z = at.z;
    s.outAt = performance.now();
    s.trip.phase = "walkon";
    s.trip.t = 0;
    this.note(`${s.r.name} gets off at ${s.trip.bus?.alight.name}`);
  }

  // ------------------------------------------------------------------ the dray

  private startDray(_s: JourneySim, t: Trip, p: Puppet | null): void {
    if (t.veh?.route) this.world.traffic()?.away(t.veh.route, true);
    t.phase = "go";
    t.t = 0;
    t.park = undefined;
    if (p) {
      p.yaw = t.fetchAt![2];
      this.crowd.puppetVehicle(p, { kind: "dray", loaded: t.unload > 0 });
    }
  }

  // ------------------------------------------------------------------ the boat

  private crewReady(_s: JourneySim, t: Trip): boolean {
    const [bx, bz] = t.fetchAt!;
    for (const id of t.boat!.crew.slice(1)) {
      const o = this.town.sim(id);
      if (!o || !o.inTrip) continue;
      const q = o.p ?? o;
      if (Math.hypot(q.x - bx, q.z - bz) > 4 && t.t < 40) return false;
    }
    return true;
  }

  /** The crew walk after the owner to the steps (or come unseen). */
  private crewFollow(_s: JourneySim, t: Trip, dt: number): void {
    const [bx, bz] = t.fetchAt!;
    for (const id of t.boat?.crew.slice(1) ?? []) {
      const o = this.town.sim(id);
      if (!o || !o.inTrip) continue;
      if (o.inside) {
        o.inside = false;
        o.x = o.door[0];
        o.z = o.door[1];
        o.outAt = performance.now();
      }
      o.held = true;
      if (o.p) {
        if (!this.crowd.puppetBusy(o.p) && Math.hypot(o.p.x - bx, o.p.z - bz) > 2.5) this.crowd.puppetGo(o.p, bx + 1, bz + 0.5, 1.3);
      } else {
        const d = Math.hypot(bx - o.x, bz - o.z);
        if (d > 0.6) {
          const k = Math.min(1, (this.town.hiddenSpeed * dt) / d);
          o.x += (bx - o.x) * k;
          o.z += (bz - o.z) * k;
        }
      }
    }
  }

  private startRow(s: JourneySim, t: Trip): void {
    const b = t.boat!;
    const crew = b.crew.map((id) => this.town.sim(id)).filter((o): o is JourneySim => !!o);
    const kinds = crew.map((o) => ({ id: o.r.id, kind: (o.p?.kind ?? o.r.kind) as HumanKind }));
    for (const o of crew) {
      o.inTrip = true;
      o.held = true;
      o.aboard = true;
      if (o.p) this.town.drop(o);
    }
    s.held = false;
    const from = b.home ? this.rowing.townBoatFrom(b.id) : null;
    const start = from ?? { x: b.path![0][0], z: b.path![0][1], yaw: Math.atan2(b.path![1]?.[0] - b.path![0][0] || 0, b.path![1]?.[1] - b.path![0][1] || 1) };
    this.rowing.townBoatOut(b.id, b.kind, start, b.path!, kinds, b.home ? 0 : (t.load?.items ?? 0));
    t.phase = "row";
    t.t = 0;
    this.note(`${s.r.name} rows out with ${crew.length - 1} of the family${b.home ? "" : " and a load"}`);
  }

  private row(s: JourneySim, t: Trip, dt: number, seen: boolean): boolean {
    const b = t.boat!;
    const near = Math.hypot(s.x - this.player.x, s.z - this.player.z) < 80 || seen;
    const at = this.rowing.townBoatStep(b.id, dt, near, near ? 1.35 : this.town.hiddenSpeed);
    const crew = b.crew.map((id) => this.town.sim(id)).filter((o): o is JourneySim => !!o);
    if (!at) {
      this.landed(s, t, crew);
      return true;
    }
    for (const o of crew) {
      o.x = at.x;
      o.z = at.z;
    }
    if (at.done || t.t > 400) this.landed(s, t, crew);
    return true;
  }

  /** Alongside the other flight: the boat is tied up; up the steps they go. */
  private landed(s: JourneySim, t: Trip, crew: JourneySim[]): void {
    const b = t.boat!;
    const at = b.to;
    this.rowing.townBoatEnd(b.id, b.home ? null : { x: at[0], z: at[1], yaw: 0 }, b.home);
    const top = b.toTop;
    crew.forEach((o, i) => {
      o.x = top[0] + (i - 1) * 0.8;
      o.z = top[1] + 1.5;
      o.outAt = performance.now();
      o.inTrip = false;
      o.held = false;
      o.aboard = false;
      if (o !== s) this.town.resume(o);
    });
    t.phase = "walkon";
    t.t = 0;
    t.to = this.town.anchor(s);
    this.note(`${s.r.name}'s boat is tied up at ${b.home ? "home" : "the other steps"}`);
  }

  // ------------------------------------------------------------------ the end

  /** The trip is over (arrived, or given up): back to the day. */
  end(s: JourneySim, arrived: boolean): void {
    const t = s.trip;
    if (!t) return;
    s.trip = null;
    if (t.veh) this.pushed.delete(t.veh.id);
    if (t.veh && this.inUse.has(t.veh.id)) {
      // given up on the way: the machine or the cart is back where the day says (the server's spot)
      this.inUse.delete(t.veh.id);
      if (t.veh.kind === "velocipede") this.velos.use(t.veh.id, false);
    }
    if (s.p && this.crowd.puppetVehicleOf(s.p)) this.crowd.puppetVehicle(s.p, null);
    if (s.p) this.crowd.puppetLoad(s.p, false);
    this.releaseHelpers(t, true);
    if (t.mode === "dray" && t.veh?.route && t.phase !== "unload") this.world.traffic()?.away(t.veh.route, false);
    if (t.boat) for (const id of t.boat.crew) {
      const o = this.town.sim(id);
      if (o && o !== s && o.inTrip) {
        o.inTrip = false;
        o.held = false;
        o.aboard = false;
      }
    }
    s.inTrip = false;
    s.aboard = false;
    if (arrived) this.town.resume(s);
  }

  /** A spawn mid-trip (town.ts direct()): put the vehicle back under them. */
  direct(s: JourneySim): void {
    const t = s.trip;
    const p = s.p;
    if (!t || !p) return;
    t.goT = 0;
    if (t.phase === "go") {
      if (t.mode === "velocipede") this.crowd.puppetVehicle(p, { kind: "velo" });
      else if (t.mode === "handcart") this.crowd.puppetVehicle(p, { kind: "cart", items: t.loaded, what: t.load?.what });
      else if (t.mode === "dray") this.crowd.puppetVehicle(p, { kind: "dray", loaded: t.unload > 0 });
    }
  }

  // ------------------------------------------------------------------ M4 actions (game/actions.ts)

  /**
   * An action takes someone far across town unseen: at what pace (m/s)? A velocipede at home
   * goes with its owner (not standing at his door meanwhile); else walking.
   */
  hiddenPace(id: string, from: Pt, to: Pt): number {
    const s = this.town.sim(id);
    if (!s || d2(from, to) <= WALK_MAX_M) return this.town.hiddenSpeed;
    const v = this.veloOf(s);
    if (v && !v.gone && (this.inUse.has(`action:${v.id}`) || this.veloHere(v, "home"))) {
      if (!this.inUse.has(`action:${v.id}`)) {
        this.inUse.add(`action:${v.id}`);
        this.inUse.add(v.id);
        this.velos.use(v.id, true);
        this.note(`${s.r.name} rides to an errand of the day`);
      }
      return (this.town.hiddenSpeed * SPEED.velocipede) / SPEED.walk;
    }
    return this.town.hiddenSpeed;
  }

  /** The action is over: a machine taken for it is home again. */
  actionDone(id: string): void {
    const s = this.town.sim(id);
    const v = s ? this.veloOf(s) : null;
    if (v && this.inUse.delete(`action:${v.id}`)) {
      this.inUse.delete(v.id);
      this.velos.use(v.id, false);
    }
  }

  /**
   * M4: someone comes to an event by omnibus (actions.ts byTram): the next omnibus of the line
   * that stands at the stop nearest them takes them; they sit inside, and step off at the event's
   * stop. Returns the stop they wait at, or null (no stop near: they walk).
   */
  busFor(id: string, alight: OmnibusStop): OmnibusStop | null {
    const s = this.town.sim(id);
    if (!s) return null;
    const board = OMNIBUS_STOPS.filter((q) => q.line === alight.line && q.id !== alight.id).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
    if (!board || Math.hypot(board.x - s.x, board.z - s.z) > 220) return null;
    return board;
  }

  /** M4: put someone on the omnibus now (unseen, at their stop). */
  boardFor(id: string, bus: Omnibus, alight: OmnibusStop): boolean {
    const s = this.town.sim(id);
    const om = this.world.omnibus();
    if (!s || !om) return false;
    return om.boardResident(bus, { id, kind: s.r.kind as HumanKind }, alight.id);
  }

  // ------------------------------------------------------------------ checks

  /** Every spot a velocipede, a cart or a boat stands at, and the maker's door (the path check). */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    for (const v of this.data?.vehicles ?? []) {
      if (v.kind === "boat" || v.kind === "dray") continue;
      for (const [key, sp] of Object.entries(v.parks)) out.push({ label: `${v.label} (${key})`, x: sp[0], z: sp[1], reach: v.kind === "handcart" ? 2.6 : 1.6 });
    }
    for (const e of this.data?.errands ?? []) out.push({ label: `errand to ${e.toLabel}`, x: e.to[0], z: e.to[1], reach: 2.4 });
    const shop = this.data?.jef.shop;
    if (shop) out.push({ label: shop.label, x: shop.step[0], z: shop.step[1], reach: 1.8 });
    return out;
  }

  private note(t: string): void {
    this.log.push(t);
    if (this.log.length > 80) this.log.shift();
  }

  /** Dev: the trips under way. */
  info() {
    return this.town
      .sims()
      .filter((s) => s.trip)
      .map((s) => ({ id: s.r.id, name: s.r.name, mode: s.trip!.mode, phase: s.trip!.phase, why: s.trip!.why, x: +s.x.toFixed(0), z: +s.z.toFixed(0), seen: !!s.p, loaded: s.trip!.loaded, helpers: s.trip!.helpers.map((h) => `${h.id}:${h.step}`).join(" ") }));
  }

  /** Dev: vehicles by kind, and how many trips of each mode began. */
  summary() {
    const by: Record<string, number> = {};
    for (const v of this.data?.vehicles ?? []) by[v.kind] = (by[v.kind] ?? 0) + 1;
    return { vehicles: by, trips: { ...this.counts }, errands: this.data?.errands.length ?? 0, riders: this.world.omnibus()?.residents() ?? [], boats: this.rowing.townBoatsInfo() };
  }

  /** Dev: move an errand of today to start now (this side only, until the next day). */
  private devShift = new Map<string, number>();
  /** Boat errands given up on the way out (no rowing home for those): fixes 2026-09-24. */
  private gaveUp = new Set<string>();
  devErrandNow(vehicle: string): string | null {
    const e = this.data?.errands.find((q) => q.vehicle === vehicle);
    if (!e) return null;
    const { hour } = this.town.clock();
    this.devShift.set(e.id, hour - 0.02 - e.hour);
    this.applyShift();
    return e.id;
  }
  private applyShift(): void {
    for (const e of this.data?.errands ?? []) {
      const k = this.devShift.get(e.id);
      if (k === undefined || (e as Errand & { shifted?: boolean }).shifted) continue;
      e.hour += k;
      e.back += k;
      (e as Errand & { shifted?: boolean }).shifted = true;
    }
  }

  /**
   * Dev: send a resident from where they are to (x, z) now, the way the engine chooses (as if
   * their day took them there), e.g. to see a velocipede ridden. `prevKey`: where their vehicles
   * stand ("home" by default).
   */
  devGo(id: string, x: number, z: number, prevKey = "home", load?: Load, fromHome = false): string {
    const s = this.town.sim(id);
    if (!s || !this.data) return "no such resident";
    if (s.trip) this.end(s, false);
    if (fromHome) {
      // out of their own door, as if the day began there
      if (s.p) this.town.drop(s);
      s.inside = true;
      s.door = [s.r.home.sx, s.r.home.sz];
      s.x = s.door[0];
      s.z = s.door[1];
    }
    const velo = this.veloOf(s);
    const cart = this.cartOf(s);
    const has = { velocipede: !!velo && !!this.veloHere(velo, prevKey), handcart: !!cart && !cart.gone && !this.jefHas.has(cart.id) && !this.inUse.has(cart.id) };
    const plan = chooseMode({ from: [s.x, s.z], to: [x, z], load: load ?? null, has, stops: STOPS_PLAIN, age: s.r.age });
    const t: Trip = { mode: plan.mode, phase: "fetch", why: `dev: ${plan.why}`, t: 0, goT: 0, from: [s.x, s.z], to: [x, z], key: s.key, loaded: 0, unload: 0, helpers: [], started: performance.now() };
    if (plan.mode === "velocipede" && velo) {
      t.veh = velo;
      t.fetchAt = this.veloHere(velo, prevKey)!;
      t.park = [x, z, 0];
      this.inUse.add(velo.id);
      this.velos.use(velo.id, true);
    } else if (plan.mode === "handcart" && cart) {
      t.veh = cart;
      // dev: the cart is brought to where the trip starts (at home by default)
      this.cartAt.set(cart.id, prevKey);
      t.fetchAt = cart.parks[prevKey] ?? cart.home;
      t.park = [x, z, 0];
      this.placeParked(cart.id, t.fetchAt);
      t.load = load;
      t.door = [s.r.home.sx, s.r.home.sz];
      t.unload = 0;
      this.inUse.add(cart.id);
      if (load) {
        t.phase = "load";
        t.helpers = this.helpersFor(s, load.items);
      }
    } else if (plan.mode === "omnibus" && plan.bus) {
      t.bus = { board: OMNIBUS_STOPS.find((q) => q.id === plan.bus!.board.id && q.line === plan.bus!.board.line)!, alight: OMNIBUS_STOPS.find((q) => q.id === plan.bus!.alight.id && q.line === plan.bus!.alight.line)!, waitT: 0 };
      t.phase = "tostop";
    } else return `${plan.mode}: ${plan.why}`;
    if (s.inside) {
      s.inside = false;
      s.x = s.door[0];
      s.z = s.door[1];
      s.outAt = performance.now();
    }
    s.trip = t;
    this.counts[plan.mode] = (this.counts[plan.mode] ?? 0) + 1;
    return `${plan.mode}: ${plan.why}`;
  }

  /** Dev: the vehicles of a resident's household. */
  vehiclesOf(id: string) {
    const s = this.town.sim(id);
    return s ? (this.byHousehold.get(s.r.household) ?? []) : [];
  }

  /** Dev: which vehicle keys are at hand now for this resident by the day (the pure rule). */
  devWhere(id: string) {
    const s = this.town.sim(id);
    if (!s) return null;
    const { day, hour } = this.town.clock();
    return (this.byOwner.get(id) ?? []).map((v) => ({ id: v.id, kind: v.kind, server: v.at, rule: vehicleAt(s.r as never, day, hour, () => false, v.parks).at, cart: this.cartAt.get(v.id) }));
  }
}
