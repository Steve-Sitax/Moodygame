import { activityAt, type Act, type Schedule, type Seg } from "../town/schedule.ts";
import type { Resident, Town } from "../town/population.ts";
import { serverWay } from "../town/ways.ts";
import { whereAt } from "../town/whereabouts.ts";

// The town map (docs/mapview.md): what the host's observer map knows of the town, live and planned.
//
// The multiplayer code feeds a MapModel (mp/index.ts): the players' states, the townspeople each PC walks
// (the "puppets"), the moving world from the world PC, and who walks whom. The model keeps the newest of
// each, a trail of positions per thing (one point a second, the last 15 minutes) and a list of notable
// changes (appeared, left, a new owner, a new activity). It never changes the game: it only listens.
//
// A resident nobody walks live is shown where his day plan puts him (plannedSpot): the schedule the engine
// gave him (town/schedule.ts activityAt) at the game's clock, at his home, workplace or the place of the
// hour. That is marked "by the day plan, not seen live".

/** One trail point a second at most. */
export const TRAIL_STEP_MS = 1000;
/** Trails reach back this far. */
export const TRAIL_KEEP_MS = 15 * 60_000;
/** Points a trail can hold (15 minutes at one a second). */
export const TRAIL_CAP = Math.ceil(TRAIL_KEEP_MS / TRAIL_STEP_MS);
/** A townsperson whose owner has not sent him this long is no longer "live" (mp/index.ts PUPPETS_STALE_MS). */
export const LIVE_STALE_MS = 3000;
/** Notable changes kept per thing. */
export const CHANGES_KEPT = 200;
/** Things with a history at most (the oldest untouched ones go first). */
const TRACKS_MAX = 3000;

// ------------------------------------------------------------------ what the multiplayer code hands in

/** A player as mp/index.ts knows him (the roster plus his newest movement state). */
export interface PlayerIn {
  id: number;
  name: string;
  host: boolean;
  x: number;
  y: number;
  z: number;
  /** Yaw of his view (radians). */
  yaw: number;
  /** MODES name (walk, swim, row, ...) or its number. */
  mode: string | number;
  away: boolean;
  online: boolean;
  /** Optional: his velocity, for the heading arrow and the speed shown. */
  vx?: number;
  vz?: number;
}

/** A townsperson in an owner's puppet batch (client net/mp/street.ts decodes the same fields). */
export interface PuppetIn {
  /** The resident id (r001...), not the batch number: map it with the owners' list. */
  id: string;
  x: number;
  z: number;
  yaw: number;
  /** Metres a second (the length of vx, vz). */
  speed: number;
  /** The motion's name (idle, walk, sit, scrub, ...) or its MOTIONS number. */
  motion: string | number;
  sit: boolean;
  lantern: boolean;
  sack: boolean;
  /** What he just bought (a bread, a fish), or null. */
  bought: string | null;
  /** What he rides or pushes: "velo", "cart", "dray" (or an object with a kind), or null. */
  vehicle: string | { kind: string; [k: string]: unknown } | null;
}

/** Who walks whom: the owners' rows as mp/street.ts Owners.list() gives them, or {id, owner}. Owner 0: nobody. */
export type OwnerIn = readonly [num: number, id: string, owner: number] | { id: string; owner: number };

export interface MapClock {
  day: number;
  hour: number;
  minute: number;
  weekday?: string;
  weather?: string;
}

// ------------------------------------------------------------------ the trail ring

/** A ring of (time, x, z): the newest `cap` points, oldest first when read. */
export class Ring {
  private readonly t: Float64Array;
  private readonly xz: Float32Array;
  private head = 0;
  private n = 0;
  readonly cap: number;

  constructor(cap: number) {
    this.cap = Math.max(1, Math.floor(cap));
    this.t = new Float64Array(this.cap);
    this.xz = new Float32Array(this.cap * 2);
  }

  push(t: number, x: number, z: number): void {
    this.t[this.head] = t;
    this.xz[this.head * 2] = x;
    this.xz[this.head * 2 + 1] = z;
    this.head = (this.head + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }

  get size(): number {
    return this.n;
  }

  /** The points since `since` (ms), oldest first, as [t, x, z]. */
  points(since = -Infinity): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    const start = (this.head - this.n + this.cap) % this.cap;
    for (let k = 0; k < this.n; k++) {
      const i = (start + k) % this.cap;
      if (this.t[i] >= since) out.push([this.t[i], this.xz[i * 2], this.xz[i * 2 + 1]]);
    }
    return out;
  }

  last(): [number, number, number] | null {
    if (!this.n) return null;
    const i = (this.head - 1 + this.cap) % this.cap;
    return [this.t[i], this.xz[i * 2], this.xz[i * 2 + 1]];
  }
}

export interface Change {
  /** Real time (ms). */
  at: number;
  /** The game's clock then ("day 3, 14:05"), if known. */
  game: string | null;
  text: string;
}

interface Track {
  ring: Ring;
  lastAt: number;
  changes: Change[];
  touched: number;
}

// ------------------------------------------------------------------ what the model keeps

export interface PlayerLive extends PlayerIn {
  at: number;
}

export interface PuppetLive extends PuppetIn {
  owner: number;
  at: number;
}

export interface WorldLive {
  /** When it was true (the server's clock, ms), as the world PC said. */
  t: number;
  /** When it came (ms). */
  at: number;
  d: Record<string, unknown>;
}

/** A thing's key in the history: "player:2", "resident:r014", "world:boats:3". */
export const keyOf = (kind: string, id: string | number) => `${kind}:${id}`;

const vehicleName = (v: PuppetIn["vehicle"]): string | null => (v == null ? null : typeof v === "string" ? v : typeof v.kind === "string" ? v.kind : null);
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export class MapModel {
  /** The clock of the model (tests set their own). */
  now: () => number;
  /** The game's clock as text, for the changes list (mountMapView sets it). */
  gameTime: () => string | null = () => null;

  private readonly playerMap = new Map<number, PlayerLive>();
  private readonly puppetMap = new Map<string, PuppetLive>();
  private readonly ownerMap = new Map<string, number>();
  private worldNow: WorldLive | null = null;
  private readonly tracks = new Map<string, Track>();
  /** The last planned activity per resident (for "now: work at ..." in his changes). */
  private readonly planKey = new Map<string, string>();

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  // -------------------------------------------------------------- feeding

  /** The players now (the whole list each time: one missing from it has left). */
  players(list: readonly PlayerIn[]): void {
    const now = this.now();
    const seen = new Set<number>();
    for (const p of list) {
      if (!p || !Number.isInteger(p.id) || !fin(p.x) || !fin(p.z)) continue;
      seen.add(p.id);
      const old = this.playerMap.get(p.id);
      const k = keyOf("player", p.id);
      if (!old) this.note(k, `${p.name} came into the town${p.host ? " (the host)" : ""}`, now);
      else {
        if (old.online !== p.online) this.note(k, p.online ? `${p.name} is back` : `${p.name} lost the connection`, now);
        if (old.away !== p.away) this.note(k, p.away ? "stepped away (menu open)" : "back at the keys", now);
        if (String(old.mode) !== String(p.mode)) this.note(k, `now: ${p.mode}`, now);
      }
      this.playerMap.set(p.id, { ...p, at: now });
      this.sample(k, p.x, p.z, now);
    }
    for (const [id, p] of this.playerMap) {
      if (seen.has(id)) continue;
      this.playerMap.delete(id);
      this.note(keyOf("player", id), `${p.name} left the town`, now);
    }
  }

  /** The townspeople one PC walks, from its newest batch. */
  puppets(ownerId: number, entries: readonly PuppetIn[]): void {
    const now = this.now();
    for (const e of entries) {
      if (!e || typeof e.id !== "string" || !fin(e.x) || !fin(e.z)) continue;
      const k = keyOf("resident", e.id);
      const old = this.puppetMap.get(e.id);
      if (!old || now - old.at > LIVE_STALE_MS) this.note(k, `seen live, walked by ${this.ownerName(ownerId)}`, now);
      else {
        if (old.owner !== ownerId) this.note(k, `now walked by ${this.ownerName(ownerId)}`, now);
        if (String(old.motion) !== String(e.motion) && e.motion !== "walk" && e.motion !== "idle") this.note(k, `${e.motion}`, now);
        if (old.sit !== e.sit) this.note(k, e.sit ? "sat down" : "stood up", now);
        if (old.lantern !== e.lantern) this.note(k, e.lantern ? "lit a lantern" : "put the lantern out", now);
        if (vehicleName(old.vehicle) !== vehicleName(e.vehicle)) this.note(k, vehicleName(e.vehicle) ? `with a ${vehicleName(e.vehicle)}` : `left the ${vehicleName(old.vehicle)}`, now);
        if (e.bought && old.bought !== e.bought) this.note(k, `bought ${e.bought}`, now);
      }
      this.puppetMap.set(e.id, { ...e, owner: ownerId, at: now });
      this.sample(k, e.x, e.z, now);
    }
  }

  /** The moving world as the world PC sent it ("world" message: t, d). Kept as it came; its movers are sampled. */
  world(t: number, d: Record<string, unknown>): void {
    if (!d || typeof d !== "object") return;
    const now = this.now();
    // (the map's points come with every fifth state only: the last ones are kept until new ones come)
    const kept = this.worldNow?.d ?? {};
    this.worldNow = { t: fin(t) ? t : now, at: now, d: { ...kept, ...d } };
    for (const [key, list] of Object.entries(d)) {
      if (!Array.isArray(list)) continue;
      list.forEach((o, i) => {
        const p = moverPos(o);
        if (p) this.sample(keyOf("world", `${key}:${moverId(o, i)}`), p.x, p.z, now);
      });
    }
  }

  /** Who walks whom: changes, or the whole list with `full` (everyone not in it: nobody). */
  owners(rows: readonly OwnerIn[], full = false): void {
    const now = this.now();
    const next = new Map<string, number>(full ? [] : this.ownerMap);
    for (const r of rows) {
      const id = Array.isArray(r) ? r[1] : (r as { id: string }).id;
      const owner = Array.isArray(r) ? r[2] : (r as { owner: number }).owner;
      if (typeof id !== "string" || !Number.isInteger(owner)) continue;
      if (owner > 0) next.set(id, owner);
      else next.delete(id);
    }
    for (const [id, o] of next) if (this.ownerMap.get(id) !== o) this.note(keyOf("resident", id), `walked by ${this.ownerName(o)}`, now);
    for (const [id] of this.ownerMap) if (!next.has(id)) this.note(keyOf("resident", id), "walked by nobody now", now);
    this.ownerMap.clear();
    for (const [id, o] of next) this.ownerMap.set(id, o);
  }

  /**
   * Once a second (mountMapView): townspeople whose owner went quiet stop being live; the day plan's changes
   * of activity go into each resident's list.
   */
  sweep(town: Town | null, clock: MapClock | null): void {
    const now = this.now();
    for (const [id, p] of this.puppetMap) {
      if (now - p.at <= LIVE_STALE_MS) continue;
      this.puppetMap.delete(id);
      this.note(keyOf("resident", id), `not seen live any more (last walked by ${this.ownerName(p.owner)})`, now);
    }
    if (town && clock) for (const r of town.residents) this.planNote(r, town, clock, now);
  }

  // -------------------------------------------------------------- reading

  playerList(): PlayerLive[] {
    return [...this.playerMap.values()];
  }

  /** The townspeople seen live (their owner sent them within LIVE_STALE_MS). */
  liveList(): PuppetLive[] {
    const now = this.now();
    return [...this.puppetMap.values()].filter((p) => now - p.at <= LIVE_STALE_MS);
  }

  live(id: string): PuppetLive | null {
    const p = this.puppetMap.get(id);
    return p && this.now() - p.at <= LIVE_STALE_MS ? p : null;
  }

  player(id: number): PlayerLive | null {
    return this.playerMap.get(id) ?? null;
  }

  ownerOf(id: string): number {
    return this.ownerMap.get(id) ?? 0;
  }

  /** How many townspeople each player walks. */
  walkCounts(): Map<number, number> {
    const m = new Map<number, number>();
    for (const o of this.ownerMap.values()) m.set(o, (m.get(o) ?? 0) + 1);
    return m;
  }

  worldState(): WorldLive | null {
    return this.worldNow;
  }

  /** "Piet's PC", "the host's PC", "nobody". */
  ownerName(pid: number): string {
    if (!pid) return "nobody";
    const p = this.playerMap.get(pid);
    if (!p) return `player ${pid}'s PC`;
    return p.host ? `${p.name}'s PC (the host)` : `${p.name}'s PC`;
  }

  /** The trail of a thing, oldest first: [ms, x, z]. */
  trail(kind: string, id: string | number, since?: number): Array<[number, number, number]> {
    const t = this.tracks.get(keyOf(kind, id));
    return t ? t.ring.points(since ?? this.now() - TRAIL_KEEP_MS) : [];
  }

  /** The notable changes of a thing, newest first. */
  changes(kind: string, id: string | number): Change[] {
    const t = this.tracks.get(keyOf(kind, id));
    return t ? [...t.changes].reverse() : [];
  }

  /** Add a line to a thing's changes (the model's own, and for mp/index.ts if it wants to add one). */
  note(key: string, text: string, now = this.now()): void {
    const t = this.track(key, now);
    t.changes.push({ at: now, game: this.safeGameTime(), text });
    if (t.changes.length > CHANGES_KEPT) t.changes.splice(0, t.changes.length - CHANGES_KEPT);
  }

  // -------------------------------------------------------------- inside

  private safeGameTime(): string | null {
    try {
      return this.gameTime();
    } catch {
      return null;
    }
  }

  private track(key: string, now: number): Track {
    let t = this.tracks.get(key);
    if (!t) {
      if (this.tracks.size >= TRACKS_MAX) {
        // the one untouched longest goes (a mover of the world that no longer comes, most likely)
        let oldK: string | null = null;
        let oldT = Infinity;
        for (const [k, v] of this.tracks) if (v.touched < oldT) ((oldT = v.touched), (oldK = k));
        if (oldK) this.tracks.delete(oldK);
      }
      t = { ring: new Ring(TRAIL_CAP), lastAt: -Infinity, changes: [], touched: now };
      this.tracks.set(key, t);
    }
    t.touched = now;
    return t;
  }

  private sample(key: string, x: number, z: number, now: number): void {
    const t = this.track(key, now);
    if (now - t.lastAt < TRAIL_STEP_MS) return;
    t.lastAt = now;
    t.ring.push(now, x, z);
  }

  private planNote(r: Resident, town: Town, clock: MapClock, now: number): void {
    const a = activityAt(r.sched, clock.day, clock.hour + clock.minute / 60);
    const key = `${a.act}|${a.place}`;
    const old = this.planKey.get(r.id);
    this.planKey.set(r.id, key);
    if (old === undefined || old === key) return;
    this.note(keyOf("resident", r.id), `day plan: ${actText(a.act)} ${placeLabel(r, town, a.act, a.place)}`, now);
  }
}

// ------------------------------------------------------------------ the moving world's things

/** Where a mover of the world is: {x, z}, or {pos | p: [x, z] | [x, y, z]}. Null when it has none. */
export function moverPos(o: unknown): { x: number; z: number } | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (fin(r.x) && fin(r.z)) return { x: r.x, z: r.z };
  for (const k of ["pos", "p"]) {
    const v = r[k];
    if (Array.isArray(v) && v.length === 2 && fin(v[0]) && fin(v[1])) return { x: v[0], z: v[1] };
    if (Array.isArray(v) && v.length === 3 && fin(v[0]) && fin(v[2])) return { x: v[0], z: v[2] };
  }
  return null;
}

/** A mover's own id if it has one (id, name), else its place in the list. */
export function moverId(o: unknown, i: number): string {
  const r = (o ?? {}) as Record<string, unknown>;
  const v = r.id ?? r.name;
  return typeof v === "string" || typeof v === "number" ? String(v).slice(0, 40) : String(i);
}

// ------------------------------------------------------------------ the day plan

const ACT_TEXT: Record<Act, string> = {
  home: "at home",
  work: "at work",
  tavern: "at the tavern",
  play: "playing",
  market: "errands at the market",
  church: "at mass",
  stroll: "a walk",
  loiter: "hanging about",
};
export const actText = (a: Act | string) => ACT_TEXT[a as Act] ?? a;

/** The label of the place of an activity ("the Hessenatie", "home", "De Vliet"). */
export function placeLabel(r: Resident, town: Town, act: string, place: string): string {
  if (act === "home" || place === "home") return "(home)";
  if (act === "work" || place === "work") {
    const w = r.work;
    if (w.place === "home") return "(at home)";
    const shop = w.shop ? town.shops.find((s) => s.id === w.shop) : undefined;
    if (shop) return shop.label;
    return town.places[w.place]?.label ?? w.place.replace(/_/g, " ");
  }
  return town.places[place]?.label ?? town.places[place.replace(/^[a-z]+:/, "")]?.label ?? place.replace(/^[a-z]+:/, "").replace(/_/g, " ");
}

export interface PlannedSpot {
  x: number;
  z: number;
  act: Act;
  /** The place id of the activity ("home", "work", "tavern:vliet", "grote_markt"). */
  place: string;
  label: string;
  /** Indoors by the plan (at home, or working inside): not in the street. */
  indoor: boolean;
  /** Hours left in this part of the day. */
  left: number;
  /** The next part of the day, if there is one today. */
  next: { act: Act; place: string; label: string; from: number } | null;
  /** On the way to this part's place (the trade plan's sum), and the metres still to walk. */
  moving: boolean;
  walkLeft: number;
}

/** The segments of a day (1 = Monday ... 7 = Sunday) of a schedule. */
export function segsOf(s: Schedule, day: number): Seg[] {
  return day % 7 === 0 ? s.sunday : s.day;
}

/** Where the day plan puts a resident at this clock (his live place is the model's). */
export function plannedSpot(r: Resident, town: Town, clock: MapClock): PlannedSpot {
  const hour = clock.hour + clock.minute / 60;
  const a = activityAt(r.sched, clock.day, hour);
  // the trade plan (docs/trade-plan.md part A): the same sum every PC walks the unseen by, on the way between
  // the part before and this one (town/whereabouts.ts), so the dot is where a player finds him
  const w = whereAt(r, town, clock.day, hour, serverWay);
  const { x, z } = w;
  const indoor = w.indoor;
  // the next part of today
  let next: PlannedSpot["next"] = null;
  const h = ((hour % 24) + 24) % 24;
  const segs = segsOf(r.sched, clock.day);
  const upcoming = segs
    .filter((s) => s[0] > h)
    .map((s) => ({ s, from: s[0] }))
    .sort((p, q) => p.from - q.from)[0];
  if (upcoming) {
    const [, , act, where] = upcoming.s;
    const place = where ?? (act === "work" ? "work" : "home");
    next = { act, place, label: placeLabel(r, town, act, place), from: upcoming.from };
  }
  return { x, z, act: a.act, place: a.place, label: placeLabel(r, town, a.act, a.place), indoor, left: a.left, next, moving: w.moving, walkLeft: Math.max(0, Math.round(w.total - w.walked)) };
}
