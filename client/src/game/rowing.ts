import * as THREE from "three";
import type { FirstPerson, RowHull } from "../player/firstPerson";
import { WATER_Y, type World } from "../world/rijnkaai";
import type { Exit } from "../world/quaysteps";
import { BOAT_NAMES, type BoatName } from "../world/boats";
import { DECK_UNDER } from "../world/bridges";
import { bedAt, levelAt, tideRate, water } from "../world/tide";
import type { Rect } from "../world/geom";
import { psx, psxUniforms } from "../retro/psx";
import type { JobsPayload } from "../net/api";
import type { Jobs } from "./jobs";
import type { Deeds } from "./deeds";
import type { Action } from "./runs";
import type { MapMark } from "./map";

// Rowing boats (M3j), on the client. Steve, 2026-09-23: "We should be able to take a boat and
// row to other places. Bridge goes up if we don't fit underneath. Only rowing boats, no big
// ones." "We should be able to get out of a boat anywhere." "If it is a collision place, i.e. a
// bridge, or in the path of a big boat, it breaks, sinks and disappears."
//
// The server decides everything that counts (server/src/rowing.ts, town/rowDeeds.ts): the hire,
// the late money, the fine for a boat left out, the price of a lost boat, the needs, and the
// theft of a boat (the M3h deed system). This side shows the boats and the oars, gives the keys,
// keeps the boat on open water (player/firstPerson.ts row*), asks the bridges and the lock to
// open when a boat does not fit, and plays what the server says.
//
// Keys: on a landing, E hire a boat (or take one that is not yours: theft); in the boat, W/S,
// A/D, Shift (firstPerson.ts); E gets you out: onto the steps, a ladder, a pontoon, or over the
// side into the water. A hired boat got out of at any hire landing goes back to the waterman.

type Kind = "rowboat" | "punt";

interface Landing {
  id: string;
  label: string;
  kind: Kind;
  top: [number, number];
  landing: [number, number];
  x: number;
  z: number;
  yaw: number;
  waterman: string;
}
interface LooseInfo {
  id: string;
  kind: Kind;
  owner: string;
  owner_name: string;
  landing: [number, number];
  where: string;
  x: number;
  z: number;
  yaw: number;
  ridden: boolean;
  mine: boolean;
  lost: boolean;
}
export interface RowWorld {
  landings: Landing[];
  boats: LooseInfo[];
  hire: { landing: string; kind: Kind; minutes: number; time_left_min: number; late_c: number; left: { x: number; z: number; at: number } | null } | null;
  on: string | null;
  debt_c: number;
  notice: { n: number; text: string } | null;
  storm: boolean;
  fees: { hire_c: number; hours: number; late_c: number; left_fine_c: number };
}

/** Hull sizes and the rower's seat, from boats.glb (measured: rowboat thwarts at z -0.43 and 1.0, rowlocks at z 0.25). */
const HULL: Record<Kind, RowHull & { pin: [number, number, number]; len: number }> = {
  rowboat: { half: 2.65, beam: 0.72, seatZ: -0.43, seatY: 0.38, speed: 1, pin: [0.77, 0.62, 0.25], len: 5.4 },
  punt: { half: 2.55, beam: 0.64, seatZ: -1.25, seatY: 0.38, speed: 0.9, pin: [0.68, 0.56, -0.6], len: 5.2 },
};
/** A seated rower's head over the waterline, and room to spare under a deck. */
const HEAD = 1.2;
const HEAD_ROOM = 0.25;
/** Oars: 2.7 m, 0.7 of it inboard; the blade 0.55 m long at the outer end. */
const OAR_IN = 0.7;
const OAR_OUT = 2.0;
const BLADE = 0.55;

async function net<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === "GET" ? 6000 : 15_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A boat on the water that is not being rowed: at a berth, left lying, or drifting. */
interface Lying {
  key: string;
  kind: Kind;
  obj: THREE.Object3D;
  rect: Rect;
  x: number;
  z: number;
  yaw: number;
  /** Drifts with the current (left out on the river). */
  drift: boolean;
  /** Has drifted from where the server has it (keep it where it drifted to). */
  drifted?: boolean;
}

/** Someone else's boat under way: river traffic, a tow in the lock, a canal boat. */
interface Vessel {
  obj: THREE.Object3D;
  name: BoatName;
  x: number;
  z: number;
  h: number;
  hl: number;
  hb: number;
  vx: number;
  vz: number;
}

export class Rowing {
  data: RowWorld | null = null;
  /** The boat being rowed: its model, what it is ("hire" or a loose boat's id), its kind. */
  private boat: { obj: THREE.Object3D; what: string; kind: Kind; oars: THREE.Group } | null = null;
  /** Boats lying on the water, by key: "berth:<landing>", a loose boat's id, "mine" (the hired boat left out). */
  private lying = new Map<string, Lying>();
  private pool: Record<Kind, THREE.Object3D[]> = { rowboat: [], punt: [] };
  private busy = false;
  private pollT = 0;
  private notice = -1;
  private hard = 0;
  private strokeT = 0;
  private warned = false;
  private requested = new Set<string>();
  private lockAsked = false;
  private prev = new Map<THREE.Object3D, [number, number, number]>();
  private sinking: Array<{ obj: THREE.Object3D; t: number; y0: number; roll: number }> = [];
  private splinters: THREE.InstancedMesh | null = null;
  private chips: Array<{ p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; t: number }> = [];
  private bumpAt = -9;
  private clock = 0;
  private mats: { shaft: THREE.Material; blade: THREE.Material; iron: THREE.Material } | null = null;
  /** The groups that hold boats under way (river traffic, the lock's tows, the canal boats), found once. */
  private groups: THREE.Object3D[] = [];
  /** How far each oar is shipped (laid in), port and starboard, 0..1. */
  private shipped = [0, 0];
  /** Dev: pretend the rower needs this much more head room (to see a bridge open for a boat). */
  devTall = 0;
  /** Sounds (main.ts): a job sound at a place, and an oar stroke. */
  sfx: (name: "thud_wood" | "thud_plank" | "thud_soft" | "splash", at?: THREE.Vector3) => void = () => {};
  stroke: () => void = () => {};
  /** Why the last break or bump happened (dev). */
  last: string = "";

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly deeds: Deeds,
  ) {
    player.rowFree = (x, z, r) => this.free(x, z, r);
    player.rowCurrent = (x, z) => this.current(x, z);
    player.onRowStroke = (hard) => {
      this.stroke();
      if (hard) this.hard++;
    };
    player.onRowBump = (speed) => {
      if (this.clock - this.bumpAt < 1) return;
      this.bumpAt = this.clock;
      this.sfx(speed > 1 ? "thud_wood" : "thud_soft", new THREE.Vector3(player.x, levelAt(player.x, player.z) + 0.4, player.z));
      this.jobs.say(speed > 1 ? "The boat knocks hard against it. No harm done, only your teeth." : "The boat bumps and comes off.");
    };
    jobs.extraActions.push((x, z) => this.keys(x, z));
    const marks = jobs.map.marks;
    jobs.map.marks = () => [...marks(), ...this.mapMarks()];
    void this.load();
  }

  get rowing(): boolean {
    return this.boat !== null && this.player.rowing;
  }

  // ------------------------------------------------------------------ the water

  /** Open water for the hull: the walk map's water, not the walls, piles, hulls, lying boats; the lock while its gates stand open; not under a bridge you do not fit under unless it is up. */
  private free(x: number, z: number, r: number): boolean {
    const lock = this.world.lock();
    const lw = this.world.lockWater;
    // M6 tides: each pair of gates on its own (the keeper levels the chamber between them)
    const open = (i: 0 | 1) => (lock?.gateOpen ? lock.gateOpen(i) : lock?.gatesOpen() ?? 0) > 0.95;
    // the lock, never across a shut pair; the open end of the ferry pontoon
    // (its keep-out for swimmers runs 2 m past the deck: a boat may come up to the end of the deck)
    const pass = (c: Rect) =>
      (c === lw && (Math.abs(z - 7) > 1.8 || open(0)) && (Math.abs(z - 42) > 1.8 || open(1))) || (c.minZ === -60 && c.maxZ === -2.5 && z < -58.2 && Math.abs(x + 249) < 3);
    if (!this.world.boatFree(x, z, r * 0.9, pass)) return false;
    // M6 tides: the canal and the vliet run nearly dry at low water: the boat takes the ground
    if (levelAt(x, z) - bedAt(x, z) < 0.35) return false;
    // a bridge you do not fit under: wait outside it until it stands open
    const br = this.world.bridges();
    if (br && !this.fits()) {
      for (const b of br.list) {
        const R = b.rect;
        if (x > R.minX - r && x < R.maxX + r && z > R.minZ - r && z < R.maxZ + r && b.open() < 0.97) return false;
      }
    }
    return true;
  }

  /** Do we fit under a shut deck (quay level, its underside DECK_UNDER below) with the swell as it is? */
  fits(): boolean {
    const swell = 0.22 * psxUniforms.uSea.value;
    // M6 tides: at high water you no longer fit under a bridge you pass under at low water
    return -DECK_UNDER > levelAt(this.player.x, this.player.z) + HEAD + HEAD_ROOM + swell + this.devTall;
  }

  /**
   * The tide on the Schelde (not in the canals, the vliet or the dock): along the river, ebb
   * toward +x (downstream, north) and flood back, with the rise and fall of the water (M6 tides,
   * world/tide.ts): strongest at half tide, slack at high and low water; slack near the walls;
   * stronger in a gale. At most about 0.2 m/s.
   */
  private current(x: number, z: number): [number, number] {
    if (z > -1 || (x > 100 && x < 120 && z > -6)) return [0, 0];
    const tide = THREE.MathUtils.clamp(-tideRate(this.jobs.day.dayNum, this.jobs.day.hourF) / 1.2, -1, 1);
    const sea = psxUniforms.uSea.value;
    const wall = Math.min(1, Math.max(0.3, -z / 12));
    return [0.16 * tide * wall * (sea > 2.5 ? 1.6 : 1), 0];
  }

  // ------------------------------------------------------------------ loading and syncing

  /** Bumped by every call that changes the boats: a poll sent before it is stale when it comes back. */
  private epoch = 0;

  async load(): Promise<void> {
    const e = this.epoch;
    try {
      const w = await net<RowWorld>("GET", "/api/row/world");
      if (e !== this.epoch || this.busy) return;
      this.apply(w);
    } catch (e) {
      console.warn("[rowing] the boats did not load", e);
    }
  }

  private apply(w: RowWorld): void {
    if (!w || !Array.isArray(w.landings) || !Array.isArray(w.boats)) return; // the server is restarting
    const first = this.data === null;
    this.data = w;
    if (w.notice && w.notice.n !== this.notice) {
      if (!first && this.notice >= 0) this.jobs.say(w.notice.text);
      this.notice = w.notice.n;
    } else if (first) this.notice = w.notice?.n ?? 0;
    // a reload while the server has us in a boat: we are not in it here, so out we got where it lies
    if (w.on && !this.boat && !this.busy) {
      // a hired boat goes back to its berth (we do not know where it was); a taken one stays where the server has it
      const at = w.on === "hire" ? w.hire?.left ?? w.landings.find((l) => l.id === w.hire?.landing) ?? null : w.boats.find((b) => b.id === w.on) ?? null;
      const spot = at ?? { x: this.player.x, z: this.player.z };
      void this.post("/api/row/leave", { x: spot.x, z: spot.z, yaw: 0 }).catch(() => {});
    }
    // the server took us out of the boat (the night, the police): step out where we are
    if (!w.on && this.boat && this.player.rowing && !this.busy) this.forceOut();
    this.syncLying();
  }

  private objFor(kind: Kind): THREE.Object3D | null {
    const b = this.world.boats();
    if (!b) return null;
    const o = this.pool[kind].pop() ?? b.place(kind, 0, 0, 0, this.world.scene);
    o.visible = true;
    return o;
  }
  private drop(l: Lying): void {
    this.world.removeWaterSolid(l.rect);
    l.obj.visible = false;
    this.pool[l.kind].push(l.obj);
    this.lying.delete(l.key);
  }
  private rectOf(x: number, z: number, yaw: number, kind: Kind): Rect {
    const hl = HULL[kind].len * 0.47;
    const hb = HULL[kind].beam + 0.05;
    const s = Math.abs(Math.sin(yaw));
    const c = Math.abs(Math.cos(yaw));
    return { minX: x - s * hl - c * hb, maxX: x + s * hl + c * hb, minZ: z - c * hl - s * hb, maxZ: z + c * hl + s * hb };
  }
  private lay(key: string, kind: Kind, x: number, z: number, yaw: number, drift = false, obj?: THREE.Object3D): Lying | null {
    let l = this.lying.get(key);
    if (l && l.kind !== kind) {
      this.drop(l);
      l = undefined;
    }
    if (!l) {
      const o = obj ?? this.objFor(kind);
      if (!o) return null;
      l = { key, kind, obj: o, rect: this.rectOf(x, z, yaw, kind), x, z, yaw, drift };
      this.world.addWaterSolid(l.rect);
      this.lying.set(key, l);
    }
    l.drift = drift;
    if (Math.hypot(l.x - x, l.z - z) > 0.05 || Math.abs(l.yaw - yaw) > 0.01 || obj) {
      l.x = x;
      l.z = z;
      l.yaw = yaw;
      Object.assign(l.rect, this.rectOf(x, z, yaw, kind));
    }
    l.obj.position.set(l.x, levelAt(l.x, l.z), l.z);
    l.obj.rotation.set(0, l.yaw, 0);
    return l;
  }

  /** The boats lying about, as the server has them (the one being rowed is ours). */
  private syncLying(): void {
    const w = this.data;
    if (!w || !this.world.boats()) return;
    const want = new Set<string>();
    const px = this.player.x;
    const pz = this.player.z;
    for (const L of w.landings) {
      const key = `berth:${L.id}`;
      const had = this.lying.get(key);
      // a new boat at a berth only when nobody is near to see it come (at the start of the game: all there)
      if (!had && this.synced && Math.hypot(px - L.x, pz - L.z) < 40 && !this.fresh.has(key)) continue;
      this.fresh.delete(key);
      want.add(key);
      // a boat of another kind brought back here: it lies there till nobody sees the waterman swap it
      if (had && had.kind !== L.kind && Math.hypot(px - L.x, pz - L.z) < 40) continue;
      this.lay(key, L.kind, L.x, L.z, L.yaw);
    }
    for (const b of w.boats) {
      if (b.lost || (this.boat && this.boat.what === b.id)) continue;
      want.add(b.id);
      const had = this.lying.get(b.id);
      // one we left drifting: keep where it drifted to, unless the server moved it (home again)
      if (had?.drifted && b.mine) continue;
      this.lay(b.id, b.kind, b.x, b.z, b.yaw, b.mine && b.z < -1);
    }
    if (w.hire?.left && !(this.boat?.what === "hire")) {
      want.add("mine");
      const had = this.lying.get("mine");
      if (!had) this.lay("mine", w.hire.kind, w.hire.left.x, w.hire.left.z, 0, w.hire.left.z < -1);
    }
    this.synced = true;
    for (const l of [...this.lying.values()]) {
      if (want.has(l.key)) continue;
      // the boy took it home: gone once you are not looking at it
      if (l.key === "mine" && Math.hypot(px - l.x, pz - l.z) < 25) continue;
      this.drop(l);
    }
  }
  /** Berths whose boat may come back while you stand there (you just brought one). */
  private fresh = new Set<string>();
  private synced = false;
  private syncT = 0;

  // ------------------------------------------------------------------ keys

  private keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]> } {
    const w = this.data;
    if (!w) return {};
    if (this.boat) {
      if (!this.player.rowing) return { only: [] };
      if (this.busy) return { only: [] };
      return { only: [this.outAction()] };
    }
    if (this.busy || this.player.riding || this.player.climbing || this.player.bikeRiding) return {};
    const options: Array<[number, Action]> = [];
    // in the water: back into a boat of yours
    if (this.player.swimming) {
      if (this.world.exitNear(x, z, 1.2)) return {};
      for (const l of this.lying.values()) {
        const mine = l.key === "mine" || w.boats.some((b) => b.id === l.key && b.mine);
        if (!mine) continue;
        const d = this.distToHull(l, x, z);
        if (d < 1.4) options.push([d, { key: "KeyE", text: "climb into the boat", run: () => void this.board(l) }]);
      }
      return { options };
    }
    // on a landing, a pontoon, the foot of a ladder: by the water (M6 tides: at low water the
    // boat lies below the landing and you climb down into it; at high water the landing is under
    // water and you stand on the steps above it)
    if (this.player.y > levelAt(x, z) + 3.2) return {};
    for (const L of w.landings) {
      const l = this.lying.get(`berth:${L.id}`);
      const d = Math.hypot(L.landing[0] - x, L.landing[1] - z);
      const flooded = levelAt(L.x, L.z) > WATER_Y + 0.4 + 0.3;
      if (!l || d > (flooded ? 4.8 : 2.4)) continue;
      const what = L.kind === "punt" ? "a punt" : "a rowing boat";
      const debt = w.debt_c ? `, and the ${w.debt_c} c you owe` : "";
      options.push([d, { key: "KeyE", text: w.hire ? `hire ${what} (you have one out already)` : `hire ${what} from ${L.waterman} (${w.fees.hire_c} c${debt})`, run: () => void this.hire(L) }]);
    }
    for (const l of this.lying.values()) {
      if (l.key.startsWith("berth:")) continue;
      const d = this.distToHull(l, x, z);
      if (d > 2.0) continue;
      if (l.key === "mine") options.push([d, { key: "KeyE", text: "get back into your boat", run: () => void this.board(l) }]);
      else {
        const b = w.boats.find((q) => q.id === l.key);
        if (!b) continue;
        options.push([d, { key: "KeyE", text: b.mine ? "get into the boat" : `take the ${b.kind === "punt" ? "punt" : "rowing boat"}`, run: () => void this.board(l) }]);
      }
    }
    return { options };
  }

  private distToHull(l: Lying, x: number, z: number): number {
    const fx = Math.sin(l.yaw);
    const fz = Math.cos(l.yaw);
    const dx = x - l.x;
    const dz = z - l.z;
    const along = Math.max(-HULL[l.kind].half, Math.min(HULL[l.kind].half, dx * fx + dz * fz));
    return Math.max(0, Math.hypot(dx - fx * along, dz - fz * along) - HULL[l.kind].beam);
  }

  /** How the rower gets out here: steps, a ladder, a low deck, else over the side. */
  private exitHere(): { exit: Exit | null; text: string } {
    const p = this.player;
    const [sx, sz] = p.rowSeat();
    const e = this.world.exitNear(sx, sz, 2.3) ?? this.world.exitNear(p.x, p.z, 2.0);
    const w = this.data;
    const atLanding = w?.hire && this.boat?.what === "hire" ? w.landings.find((L) => Math.hypot(L.x - p.x, L.z - p.z) < 9) : undefined;
    if (e) {
      if (atLanding) return { exit: e, text: `give the boat back to ${atLanding.waterman} and step out` };
      return { exit: e, text: e.kind === "ladder" ? "climb out up the ladder" : "step out onto the steps" };
    }
    // at a hire landing, but his other boat lies alongside: he takes your line and hands you out onto the steps
    if (atLanding) {
      const le = this.world.exitNear(atLanding.landing[0], atLanding.landing[1], 3);
      if (le) return { exit: le, text: `throw ${atLanding.waterman} your line and give the boat back` };
    }
    // a low deck within reach from the side of the boat: the ferry pontoon, the pier's foot
    const h = p.rowHeading;
    const bow = HULL[this.boat?.kind ?? "rowboat"].half - HULL[this.boat?.kind ?? "rowboat"].seatZ;
    // beside the seat, and over the bow (you can climb forward over the thwarts)
    const probes: Array<[number, number, number]> = [];
    for (const off of [0, 0.8, -0.8, 1.6]) for (const side of [1, -1]) for (const out of [1.3, 1.8]) probes.push([off, side, out]);
    for (const off of [bow + 0.5, bow + 1.1, bow + 1.7]) probes.push([off, 1, 0]);
    for (const [off, side, out] of probes) {
      {
          const ax = sx + Math.sin(h) * off + Math.cos(h) * out * side;
          const az = sz + Math.cos(h) * off - Math.sin(h) * out * side;
          if (this.world.isWater(ax, az)) continue;
          const y = this.world.baseAt(ax, az);
          const lv = levelAt(ax, az);
          if (y < lv + 0.1 || y > lv + 2.0) continue; // the ferry pontoon lies 1.8 m over the water; the brig's deck (2.4) is too high
          if (!this.world.isFree(ax, az, 0.3, y)) continue;
          const g = out ? 0.9 : -0.6;
          const gx = sx + Math.sin(h) * (out ? off : off + g) + Math.cos(h) * 0.9 * side * (out ? 1 : 0);
          const gz = sz + Math.cos(h) * (out ? off : off + g) - Math.sin(h) * 0.9 * side * (out ? 1 : 0);
          return { exit: { kind: "landing", gx, gz, nx: 0, nz: 0, tx: ax, tz: az, ty: y }, text: "step out onto the pontoon" };
      }
    }
    return { exit: null, text: "go over the side into the water" };
  }

  private outAction(): Action {
    const { exit, text } = this.exitHere();
    return { key: "KeyE", text, run: () => void this.getOut(exit) };
  }

  // ------------------------------------------------------------------ in and out

  /** Dev: what happened lately (calls, forced outs). */
  trace: string[] = [];
  private note(s: string): void {
    this.trace.push(`${this.clock.toFixed(1)} ${s}`);
    if (this.trace.length > 40) this.trace.shift();
  }

  private post<T>(url: string, body: unknown): Promise<T> {
    this.note(`POST ${url} ${JSON.stringify(body).slice(0, 80)}`);
    this.epoch++;
    return net<T>("POST", url, body).finally(() => this.epoch++);
  }

  private async hire(L: Landing): Promise<void> {
    if (this.busy) return;
    if (this.jobs.goods.carried || this.player.laden) {
      this.jobs.say(`${L.waterman} shakes his head. "Put that down first. No cargo in my boats."`);
      return;
    }
    this.busy = true;
    try {
      const r = await this.post<JobsPayload & { text: string; row: RowWorld }>("/api/row/hire", { landing: L.id, x: +this.player.x.toFixed(2), z: +this.player.z.toFixed(2) });
      this.jobs.refresh(r);
      const l = this.lying.get(`berth:${L.id}`);
      this.sitIn(l ?? null, "hire", L.kind, L.x, L.z, L.yaw);
      this.data = r.row;
      this.jobs.say(`${r.text} W to pull, S to back water, A and D to turn, Shift to pull hard, E to get out.`);
      this.stormWarning();
    } catch (e) {
      this.jobs.say(`${cap((e as Error).message)}.`);
    } finally {
      this.busy = false;
    }
  }

  /** Into a lying boat: your own (left out, or taken before), or someone else's (theft). */
  private async board(l: Lying): Promise<void> {
    if (this.busy) return;
    if (this.jobs.goods.carried || this.player.laden) {
      this.jobs.say("Not with that in your arms.");
      return;
    }
    this.busy = true;
    const { x, z } = this.player;
    try {
      if (l.key === "mine") {
        const r = await this.post<{ text: string; row: RowWorld }>("/api/row/board", { x: +l.x.toFixed(2), z: +l.z.toFixed(2) });
        this.data = r.row;
        this.sitIn(l, "hire", l.kind, l.x, l.z, l.yaw);
        this.jobs.say(r.text);
      } else {
        const r = await this.post<JobsPayload & { again: boolean; text: string; reaction: { line: string } | null }>("/api/deed", {
          ref: l.key,
          x: +x.toFixed(2),
          z: +z.toFixed(2),
          witnesses: this.deeds.witnesses(x, z),
          crouch: this.player.crouching,
          lantern: this.deeds.lantern.lit,
        });
        this.jobs.refresh(r);
        this.sitIn(l, l.key, l.kind, l.x, l.z, l.yaw);
        this.jobs.say(r.again ? "You get back into the boat." : r.reaction?.line ?? r.text);
        if (r.reaction) this.sfx("thud_soft");
        this.stormWarning();
      }
    } catch (e) {
      this.jobs.say(`${cap((e as Error).message)}.`);
    } finally {
      this.busy = false;
      void this.load();
    }
  }

  private sitIn(l: Lying | null, what: string, kind: Kind, x: number, z: number, yaw: number): void {
    let obj: THREE.Object3D | null;
    if (l) {
      this.world.removeWaterSolid(l.rect);
      this.lying.delete(l.key);
      obj = l.obj;
      x = l.x;
      z = l.z;
      yaw = l.yaw;
    } else obj = this.objFor(kind);
    if (!obj) return;
    this.boat = { obj, what, kind, oars: this.oarsFor(obj, kind) };
    this.player.rowStart(x, z, yaw, HULL[kind]);
    this.warned = false;
    this.last = "";
  }

  private async getOut(exit: Exit | null): Promise<void> {
    const b = this.boat;
    if (!b || this.busy) return;
    if (!exit && !this.world.nearestSwim(...this.player.rowSeat(), 0.32)) {
      this.jobs.say("Not here: there is no room in the water to go over the side. Row out into open water first.");
      return;
    }
    this.busy = true;
    const p = this.player;
    const at = { x: p.x, z: p.z, yaw: p.rowHeading };
    if (exit) p.rowStepOut(exit);
    else p.rowOverboard();
    this.releaseAll();
    this.boat = null;
    b.oars.visible = false;
    // the boat stays where it is (at a hire landing the waterman ties it up)
    const L = b.what === "hire" && exit ? this.data?.landings.find((q) => Math.hypot(q.x - at.x, q.z - at.z) < 9) : undefined;
    const key = b.what === "hire" ? (L ? `berth:${L.id}` : "mine") : b.what;
    if (L) {
      const old = this.lying.get(key);
      if (old) this.drop(old);
      this.lay(key, b.kind, L.x, L.z, L.yaw, false, b.obj);
      this.fresh.add(key);
    } else this.lay(key, b.kind, at.x, at.z, at.yaw, at.z < -1, b.obj);
    try {
      const r = await this.post<JobsPayload & { text: string; returned: boolean; row: RowWorld }>("/api/row/leave", { x: +at.x.toFixed(2), z: +at.z.toFixed(2), yaw: +at.yaw.toFixed(3), ashore: !!exit });
      this.jobs.refresh(r);
      this.data = r.row;
      if (r.text) this.jobs.say(r.text);
      else if (b.what === "hire" && !L) this.jobs.say(exit ? "You leave the boat tied here. The waterman will not like it." : "You go over the side. The water is ice cold. The boat drifts on without you.");
      else if (!exit) this.jobs.say("You go over the side into the cold water.");
    } catch (e) {
      console.warn("[rowing] leave", e);
    } finally {
      this.busy = false;
    }
  }

  /** The server says we are out of the boat (the night; the police sent it home). */
  private forceOut(): void {
    this.note("forceOut");
    const e = this.world.exitNear(...this.player.rowSeat(), 3);
    const b = this.boat!;
    if (e) this.player.rowStepOut(e);
    else {
      // the nearest flight of steps
      const f = this.world.quayInfo().flights.map((q) => ({ q, d: Math.hypot(q.top[0] - this.player.x, q.top[1] - this.player.z) })).sort((a, b2) => a.d - b2.d)[0];
      if (f) this.player.place(f.q.top[0], f.q.top[1], this.player.yaw);
      else this.player.rowOverboard();
    }
    this.releaseAll();
    b.oars.visible = false;
    b.obj.visible = false;
    this.pool[b.kind].push(b.obj);
    this.boat = null;
  }

  private stormWarning(): void {
    if (this.warned || psxUniforms.uSea.value <= 2.5) return;
    this.warned = true;
    this.jobs.say("The river is running high and the wind is up. Keep close under the quay, and keep out of the fairway.");
  }

  // ------------------------------------------------------------------ breaking

  /** The boat is smashed: a ship ran it down, or a bridge came down on it. Into the water; the server prices it. */
  private async wreck(cause: "ship" | "bridge"): Promise<void> {
    const b = this.boat;
    if (!b || this.busy) return;
    this.busy = true;
    this.last = cause;
    const at = new THREE.Vector3(this.player.x, this.player.rowY + 0.3, this.player.z);
    this.sfx("thud_wood", at);
    this.sfx("thud_plank", at);
    window.setTimeout(() => this.sfx("thud_wood", at), 120);
    this.splinter(at);
    this.releaseAll();
    this.boat = null;
    b.oars.visible = false;
    // the water comes in over the gunwale: no more lid over the hull, it settles and goes down
    b.obj.traverse((o) => {
      if (o.name.endsWith("_cap")) o.visible = false;
    });
    this.sinking.push({ obj: b.obj, t: 0, y0: this.player.rowY, roll: (Math.random() < 0.5 ? -1 : 1) * 0.6 });
    this.player.rowOverboard();
    this.jobs.say(cause === "ship" ? "The bow comes out of the fog right over you. Wood cracks, the boat breaks under you, and you are in the water." : "The boat jams under the bridge. Wood cracks and splits, and you are in the water.");
    try {
      const r = await this.post<JobsPayload & { text: string; row: RowWorld }>("/api/row/lost", { cause });
      this.jobs.refresh(r);
      this.data = r.row;
      window.setTimeout(() => this.jobs.say(r.text), 3500);
    } catch (e) {
      console.warn("[rowing] lost", e);
    } finally {
      this.busy = false;
    }
  }

  private splinter(at: THREE.Vector3): void {
    if (!this.splinters) {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.05, 0.13), this.world.mats.planks, 28);
      m.frustumCulled = false;
      this.world.scene.add(m);
      this.splinters = m;
    }
    this.chips = [];
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 2.2;
      this.chips.push({
        p: at.clone(),
        v: new THREE.Vector3(Math.cos(a) * s, 1.2 + Math.random() * 2.5, Math.sin(a) * s),
        r: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        t: 0,
      });
    }
    this.splinters.visible = true;
  }

  // ------------------------------------------------------------------ other boats under way

  private vessels(): Vessel[] {
    const b = this.world.boats();
    if (!b) return [];
    const out: Vessel[] = [];
    const fresh = (o: THREE.Object3D) => {
      const q = this.prev.get(o);
      return q && this.clock - q[2] < 0.25 ? q : null;
    };
    const names = new Set<string>(BOAT_NAMES);
    if (this.groups.length < 3) this.groups = ["river_traffic", "lock", "opening_bridges"].map((n) => this.world.scene.getObjectByName(n)).filter((g): g is THREE.Object3D => !!g);
    for (const g of this.groups) {
      if (!g || !g.visible) continue;
      for (const o of g.children) {
        if (!o.visible || !names.has(o.name) || o.name === "portal_crane" || o.name === "hand_crane") continue;
        const d = b.dims(o.name as BoatName);
        const sc = o.scale.z || 1;
        const pv = fresh(o);
        const x = o.position.x;
        const z = o.position.z;
        out.push({ obj: o, name: o.name as BoatName, x, z, h: o.rotation.y, hl: d.length * 0.45 * sc, hb: (d.beam / 2) * sc, vx: pv ? x - pv[0] : 0, vz: pv ? z - pv[1] : 0 });
      }
    }
    return out;
  }

  /** Other boats: a big one under way that runs into you breaks the boat; else a bump, and it pushes you aside. */
  private meetVessels(dt: number): void {
    const p = this.player;
    const hull = HULL[this.boat!.kind];
    const fx = Math.sin(p.rowHeading);
    const fz = Math.cos(p.rowHeading);
    const pts: Array<[number, number]> = [-1, 0, 1].map((k) => [p.x + fx * (hull.half - 0.5) * k, p.z + fz * (hull.half - 0.5) * k]);
    for (const v of this.vessels()) {
      this.prev.set(v.obj, [v.x, v.z, this.clock]);
      if (Math.hypot(v.x - p.x, v.z - p.z) > v.hl + 8) continue;
      const sx = Math.sin(v.h);
      const sz = Math.cos(v.h);
      for (const [px, pz] of pts) {
        const dx = px - v.x;
        const dz = pz - v.z;
        const along = dx * sx + dz * sz;
        const across = dx * sz - dz * sx;
        const r = hull.beam;
        if (Math.abs(along) > v.hl + r * 0.5 || Math.abs(across) > v.hb + r) continue;
        const speed = Math.hypot(v.vx, v.vz) / Math.max(dt, 1e-4);
        const big = v.hb > 0.9; // wider than a rowing boat or a punt
        const coming = v.vx * (p.x - v.x) + v.vz * (p.z - v.z) > 0;
        if (big && speed > 0.3 && coming) {
          void this.wreck("ship");
          return;
        }
        // a bump: off its side, carried a little its way
        const push = v.hb + r - Math.abs(across) + 0.05;
        const sgn = across >= 0 ? 1 : -1;
        p.x += sz * push * sgn + v.vx;
        p.z += -sx * push * sgn + v.vz;
        p.rowSpeed *= -0.3;
        p.onRowBump?.(Math.max(0.5, speed + Math.abs(p.rowSpeed)));
        this.last = `bump ${v.name}`;
        return;
      }
    }
  }

  // ------------------------------------------------------------------ bridges and the lock

  private releaseAll(): void {
    const br = this.world.bridges();
    for (const k of this.requested) br?.request(k, "rower", false);
    this.requested.clear();
    if (this.lockAsked) this.world.lock()?.request?.(false);
    this.lockAsked = false;
  }

  /** Ask the bridges we do not fit under to open as we come near, and the lock when we come to it. Break if a deck is on us. */
  private bridgesAndLock(): void {
    const p = this.player;
    const br = this.world.bridges();
    const hull = HULL[this.boat!.kind];
    const fx = Math.sin(p.rowHeading);
    const fz = Math.cos(p.rowHeading);
    if (br) {
      // a deck lower than the boat and the rower's head, over any part of the boat: it breaks
      const [sx, sz] = p.rowSeat();
      for (const [x, z, top] of [
        [sx, sz, HEAD + this.devTall],
        [p.x + fx * hull.half * 0.8, p.z + fz * hull.half * 0.8, 0.7],
        [p.x - fx * hull.half * 0.8, p.z - fz * hull.half * 0.8, 0.7],
      ]) {
        const u = br.undersideAt(x, z);
        if (u !== null && u < p.rowY + top) {
          void this.wreck("bridge");
          return;
        }
      }
      if (!this.fits()) {
        for (const b of br.list) {
          const R = b.rect;
          const dx = Math.max(R.minX - p.x, 0, p.x - R.maxX);
          const dz = Math.max(R.minZ - p.z, 0, p.z - R.maxZ);
          const near = Math.hypot(dx, dz) < 22;
          if (near && !this.requested.has(b.key)) {
            br.request(b.key, "rower", true);
            this.requested.add(b.key);
            this.jobs.say(b.key === "lock_bridge" ? "You hail the lock-keeper." : "You hail the bridge-keeper: too low to pass under. He starts to wind it up.");
          } else if (!near && this.requested.has(b.key) && Math.hypot(dx, dz) > 28) {
            br.request(b.key, "rower", false);
            this.requested.delete(b.key);
          }
        }
      }
    }
    // the lock: the gates must open for a boat to pass (both pairs, as for a tow)
    const lock = this.world.lock();
    if (lock?.request) {
      const inZone = p.x > 96 && p.x < 124 && p.z > -26 && p.z < 70;
      if (inZone && !this.lockAsked) {
        lock.request(true, () => ({ x: this.player.x, z: this.player.z }));
        this.lockAsked = true;
        // M6 tides: the dock stays near high water; at other times the keeper levels the chamber
        if (Math.abs(water.river - water.dock) > 0.3)
          this.jobs.say(
            `You hail the lock-keeper. The bridge goes up. The river stands ${Math.abs(water.river - water.dock).toFixed(1)} m ${water.river < water.dock ? "below" : "above"} the dock: he shuts the far gates and lets the water ${p.z < 7 === water.river < water.dock ? "out" : "in"} till the lock is at your level. Wait for the near gates.`,
          );
        else if (lock.gatesOpen() < 0.95) this.jobs.say("You hail the lock-keeper. The bridge goes up, then the gates open. Wait for them.");
      } else if (!inZone && this.lockAsked) {
        lock.request(false);
        this.lockAsked = false;
      }
    }
  }

  // ------------------------------------------------------------------ the oars

  private oarsFor(boatObj: THREE.Object3D, kind: Kind): THREE.Group {
    if (!this.mats) {
      this.mats = {
        shaft: psx(new THREE.MeshLambertMaterial({ color: 0x8a7050 })),
        blade: this.world.mats.darkWood,
        iron: this.world.mats.iron,
      };
    }
    let g = boatObj.getObjectByName("row_oars") as THREE.Group | undefined;
    if (!g) {
      g = new THREE.Group();
      g.name = "row_oars";
      const [px, py, pz] = HULL[kind].pin;
      for (const side of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.name = side > 0 ? "port" : "starboard";
        pivot.position.set(px * side, py, pz);
        const sweep = new THREE.Group();
        const dip = new THREE.Group();
        const feather = new THREE.Group();
        pivot.add(sweep);
        sweep.add(dip);
        dip.add(feather);
        // the loom and the shaft along local +x, from the handle inboard to the blade
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, OAR_IN + OAR_OUT - BLADE, 5), this.mats.shaft);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.x = (OAR_OUT - BLADE - OAR_IN) / 2;
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 5), this.mats.blade);
        handle.rotation.z = Math.PI / 2;
        handle.position.x = -OAR_IN + 0.07;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(BLADE, 0.15, 0.022), this.mats.blade);
        blade.position.x = OAR_OUT - BLADE / 2;
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 5), this.mats.iron);
        collar.rotation.z = Math.PI / 2;
        feather.add(shaft, handle, blade, collar);
        for (const m of [shaft, handle, blade, collar]) m.frustumCulled = false;
        g.add(pivot);
        // the punt has no rowlocks of its own: two iron pins on the gunwale
        if (kind === "punt") {
          const pin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), this.mats.iron);
          pin.position.set(px * side, py - 0.04, pz);
          g.add(pin);
        }
      }
      // under the boat's float (the heave and roll): the oars ride with the hull
      boatObj.add(g);
    }
    g.visible = true;
    return g;
  }

  /** Pose the oars for the stroke: sweep (fore and aft), dip (blade in or out), feather (flat on the recovery). */
  private poseOars(): void {
    const b = this.boat!;
    const p = this.player;
    const pin = HULL[b.kind].pin;
    const bladeMid = OAR_OUT - BLADE / 2;
    const dipIn = Math.asin(Math.min(0.95, (pin[1] + 0.06) / bladeMid));
    const dipOut = Math.asin(Math.min(0.95, Math.max(0, pin[1] - 0.22) / bladeMid));
    const ph = p.rowPhase;
    const DRIVE = 0.45;
    for (const pivot of b.oars.children) {
      if (!(pivot instanceof THREE.Group) || !pivot.children.length) continue;
      const port = pivot.name === "port";
      const a = port ? p.rowPort : p.rowStarboard;
      const w = Math.min(1, Math.abs(a) * 1.5);
      const dir = a >= 0 ? 1 : -1;
      // the blade from forward (catch) to aft (finish) in the drive; back through the air in the recovery
      const CATCH = 0.55;
      const FINISH = -0.45;
      let th: number;
      let dp: number;
      let fe: number;
      if (ph < DRIVE) {
        const u = THREE.MathUtils.smoothstep(ph / DRIVE, 0, 1);
        th = dir > 0 ? CATCH + (FINISH - CATCH) * u : FINISH + (CATCH - FINISH) * u;
        dp = dipIn;
        fe = 0;
      } else {
        const u = (ph - DRIVE) / (1 - DRIVE);
        const k = THREE.MathUtils.smoothstep(u, 0, 1);
        th = dir > 0 ? FINISH + (CATCH - FINISH) * k : CATCH + (FINISH - CATCH) * k;
        dp = dipOut - Math.sin(Math.PI * Math.min(1, u * 1.2)) * 0.05;
        fe = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (Math.PI / 2) * 0.95;
        if (u < 0.08) dp = dipIn + (dipOut - dipIn) * (u / 0.08);
        if (u > 0.92) dp = dipOut + (dipIn - dipOut) * ((u - 0.92) / 0.08);
      }
      // resting: square out, blades just clear of the water
      th *= w;
      dp = dipOut + 0.04 + (dp - dipOut - 0.04) * w;
      fe *= w;
      // no room for the blade (a wall, the steps, a hull alongside): the oar is shipped, laid in along the gunwale
      const side = port ? 1 : -1;
      const bx = pin[0] * side + side * bladeMid * Math.cos(th);
      const bz = pin[2] + bladeMid * Math.sin(th) * (port ? 1 : 1);
      const hx = p.x + Math.cos(p.rowHeading) * bx + Math.sin(p.rowHeading) * bz;
      const hz = p.z - Math.sin(p.rowHeading) * bx + Math.cos(p.rowHeading) * bz;
      const key = port ? 0 : 1;
      const want = this.world.boatFree(hx, hz, 0.15) ? 0 : 1;
      this.shipped[key] += (want - this.shipped[key]) * 0.15;
      const k = this.shipped[key];
      if (k > 0.01) {
        th = th + (-1.35 - th) * k;
        dp = dp + (-0.08 - dp) * k;
        fe = fe + (Math.PI / 2 - fe) * k;
      }
      const sweep = pivot.children[0] as THREE.Group;
      const dip = sweep.children[0] as THREE.Group;
      const feather = dip.children[0] as THREE.Group;
      sweep.rotation.y = port ? -th : Math.PI + th;
      dip.rotation.z = -dp;
      feather.rotation.x = port ? fe : -fe;
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    this.clock += dt;
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = this.boat || this.data?.hire ? 3 : 10;
      void this.load();
    }
    const b = this.boat;
    const p = this.player;
    if (b) {
      if (!p.rowing) {
        this.note("out by something else");
        // taken out of the boat by something else (the dev menu's "go to", the cell)
        if (!this.busy) {
          const keep = { x: b.obj.position.x, z: b.obj.position.z, yaw: b.obj.rotation.y };
          this.releaseAll();
          b.oars.visible = false;
          this.lay(b.what === "hire" ? "mine" : b.what, b.kind, keep.x, keep.z, keep.yaw, keep.z < -1, b.obj);
          this.boat = null;
          void this.post("/api/row/leave", { x: keep.x, z: keep.z, yaw: keep.yaw }).then(() => this.load()).catch(() => {});
        }
      } else {
        // the hull where the rower's physics put it; no float bob of its own (the rower's view moves with it)
        b.obj.position.set(p.x, p.rowY, p.z);
        b.obj.rotation.set(-p.rowPitch, p.rowHeading, p.rowRoll, "YXZ");
        const inner = b.obj.children[0];
        if (inner && inner.name !== "row_oars") {
          inner.position.y = 0;
          inner.rotation.set(0, 0, 0);
        }
        this.poseOars();
        this.meetVessels(dt);
        if (this.boat) this.bridgesAndLock();
        if (psxUniforms.uSea.value > 2.5) this.stormWarning();
        // hard strokes to the server now and then (it clamps them by the clock)
        this.strokeT += dt;
        if (this.strokeT > 5 && this.hard > 0) {
          const n = this.hard;
          this.hard = 0;
          this.strokeT = 0;
          void net("POST", "/api/row/stroke", { hard: n }).catch(() => {});
        }
      }
    }
    // boats left out drift with the tide on the river, and stop at walls and hulls
    for (const l of this.lying.values()) {
      if (!l.drift) continue;
      const [cx, cz] = this.current(l.x, l.z);
      if (!cx && !cz) continue;
      const nx = l.x + cx * dt * 0.8;
      const nz = l.z + cz * dt * 0.8;
      const fx = Math.sin(l.yaw);
      const fz = Math.cos(l.yaw);
      const hl = HULL[l.kind].half - 0.5;
      this.world.removeWaterSolid(l.rect);
      const ok = [-1, 0, 1].every((k) => this.world.boatFree(nx + fx * hl * k, nz + fz * hl * k, HULL[l.kind].beam * 0.9) && !(this.boat && Math.hypot(nx - p.x, nz - p.z) < HULL[l.kind].half * 2));
      this.world.addWaterSolid(l.rect);
      if (ok) {
        l.x = nx;
        l.z = nz;
        l.drifted = true;
        Object.assign(l.rect, this.rectOf(nx, nz, l.yaw, l.kind));
        l.obj.position.set(nx, levelAt(nx, nz), nz);
      } else l.drift = false;
    }
    // wrecks going down
    for (const s of [...this.sinking]) {
      s.t += dt;
      const k = Math.max(0, s.t - 0.6);
      s.obj.position.y = s.y0 - k * k * 0.12 - k * 0.15;
      s.obj.rotation.z = s.roll * Math.min(1, s.t / 3);
      s.obj.rotation.x = -0.25 * Math.min(1, s.t / 4);
      if (s.obj.position.y < s.y0 - 2.2) {
        s.obj.visible = false;
        s.obj.traverse((o) => {
          if (o.name.endsWith("_cap")) o.visible = true;
        });
        this.sinking.splice(this.sinking.indexOf(s), 1);
        // a new hull from the pool next time: this one is at the bottom
      }
    }
    // splinters: thrown up, then afloat, then gone
    if (this.splinters && this.chips.length) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      let alive = 0;
      this.chips.forEach((c, i) => {
        c.t += dt;
        const lvl = this.world.waterLevel(c.p.x, c.p.z);
        if (c.p.y > lvl + 0.02 || c.v.y > 0) {
          c.v.y -= 9.8 * dt;
          c.p.addScaledVector(c.v, dt);
          c.r.x += dt * 6;
          c.r.y += dt * 4;
        } else {
          c.p.y = lvl + 0.01;
          c.v.set(c.v.x * 0.97, 0, c.v.z * 0.97);
          c.p.addScaledVector(c.v, dt);
          c.r.x *= 0.95;
          c.r.z *= 0.95;
        }
        const s = c.t > 14 ? Math.max(0, 1 - (c.t - 14) / 2) : 1;
        if (s > 0) alive++;
        m.compose(c.p, q.setFromEuler(c.r), one.set(s, s, s));
        this.splinters!.setMatrixAt(i, m);
      });
      this.splinters.instanceMatrix.needsUpdate = true;
      if (!alive) {
        this.chips = [];
        this.splinters.visible = false;
      }
    }
    // a new boat at a berth once nobody is looking
    this.syncT -= dt;
    if (this.data && this.syncT <= 0) {
      this.syncT = 2;
      this.syncLying();
    }
  }

  // ------------------------------------------------------------------ the map and the path check

  private mapMarks(): MapMark[] {
    return (this.data?.landings ?? []).map((L) => ({ x: L.top[0], z: L.top[1], label: `boats for hire (${L.label.replace(/^the /, "")})`, kind: "shop" as const }));
  }

  /** For the path check (CLAUDE.md): the top of every flight with a boat at its foot. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    for (const L of this.data?.landings ?? []) out.push({ label: `boat hire at ${L.label}`, x: L.top[0], z: L.top[1], reach: 2.2 });
    for (const f of this.world.quayInfo().flights) {
      const b = this.data?.boats.find((q) => Math.hypot(q.landing[0] - f.end[0], q.landing[1] - f.end[1]) < 6);
      if (b) out.push({ label: `the ${b.kind} ${b.where}`, x: f.top[0], z: f.top[1], reach: 2.2 });
    }
    return out;
  }

  // ------------------------------------------------------------------ dev

  /** Dev: state for checks. */
  info() {
    const p = this.player;
    return {
      rowing: this.rowing,
      boat: this.boat ? { what: this.boat.what, kind: this.boat.kind } : null,
      x: +p.x.toFixed(2),
      z: +p.z.toFixed(2),
      heading: +p.rowHeading.toFixed(3),
      speed: +p.rowSpeed.toFixed(2),
      turn: +p.rowTurn.toFixed(2),
      phase: +p.rowPhase.toFixed(2),
      y: +p.rowY.toFixed(2),
      fits: this.fits(),
      requested: [...this.requested],
      lock: this.lockAsked ? +(this.world.lock()?.gatesOpen() ?? 0).toFixed(2) : null,
      lying: [...this.lying.values()].map((l) => ({ key: l.key, x: +l.x.toFixed(1), z: +l.z.toFixed(1), drift: l.drift })),
      last: this.last,
      server: this.data ? { hire: this.data.hire, on: this.data.on, debt_c: this.data.debt_c, storm: this.data.storm } : null,
      sinking: this.sinking.length,
    };
  }

  /** Dev: walk onto a landing's floor (for checks without walking there). */
  devToLanding(id: string): boolean {
    const L = this.data?.landings.find((q) => q.id === id) ?? null;
    const b = L ? null : this.data?.boats.find((q) => q.id === id);
    const at = L?.landing ?? b?.landing;
    if (!at) return false;
    this.player.place(at[0], at[1], this.player.yaw);
    this.player.y = WATER_Y + 0.4;
    return true;
  }

  /** Dev: move the boat being rowed (for checks: no walls are looked at). */
  devMove(x: number, z: number, heading: number): boolean {
    const p = this.player;
    if (!this.rowing) return false;
    p.x = x;
    p.z = z;
    p.rowHeading = heading;
    p.yaw = heading + Math.PI;
    p.rowSpeed = 0;
    return true;
  }

  /** Dev: run the E action that is offered now. */
  devE(): string | null {
    const a = this.keys(this.player.x, this.player.z);
    const act = a.only?.[0] ?? a.options?.sort((x, y) => x[0] - y[0])[0]?.[1] ?? null;
    if (!act) return null;
    act.run();
    return act.text;
  }
}
