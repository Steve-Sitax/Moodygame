import type { FirstPerson } from "../player/firstPerson";
import * as THREE from "three";
import { LADDER_SPOT, PLATFORM_SPOT, SEATS, STOPS, type Omnibus, type Omnibuses, type OmnibusStop } from "../world/omnibus";
import { clockText } from "../../../shared/omnibusLines"; // M7 omnibus routes
import type { World } from "../world/rijnkaai";
import { api, type JobsPayload } from "../net/api";
import type { Action } from "./runs";
import { dialogs } from "./dialogs";
import { DEMO } from "../demo/demo";

// Riding the omnibuses (M3g). At a stop, while an omnibus waits, E at its back platform gets you
// on: the server takes the fare, or punches your ticket for a change (server/src/ride.ts: one
// free change onto the other line while the ticket runs). You ride on the platform, looking
// round as you like; the view turns with the omnibus. The conductor calls each stop, and says
// where you can change; E there gets you off. Between stops, E on the back platform jumps you
// off while it rolls (Steve: "I should be able to jump off anywhere"), as riders did from the
// open platform in 1873. The server also counts you as riding for the
// hourly needs (warmth goes slower on board). Carrying goods for a job, you cannot get on.

const REACH = 2.8; // from the foot of the step
/** 2026-09-30: how near the back step of a rolling omnibus he must be to jump on (m). */
const HOP_REACH = 2.0;
/** What the conductor says as he puts a fare dodger off (plain English, Steve 2026-09-23). */
const CURSES = [
  "\"No fare, no ride! Off with you, you thieving rat!\" The conductor plants a boot in your back.",
  "\"Think this is a charity coach? Get off my omnibus!\" He shoves you off the platform.",
  "\"Freeloader! Off, before I call a constable!\" A hard push and you are on the cobbles.",
];

export class Ride {
  private busy = false;
  /** The omnibus you are on. */
  private bus: Omnibus | null = null;
  fare = 5;
  /** A free change you could make now (the line you came off), from the server. */
  private change: string | null = null;

  constructor(
    private readonly player: FirstPerson,
    private readonly world: World,
    private readonly net: () => Omnibuses | null,
    private readonly say: (text: string) => void,
    private readonly refresh: (p: JobsPayload) => void,
  ) {
    // 2026-09-30 (Steve: "jump on the omnibus while it is moving and land on it"): Space by the back step of a
    // rolling omnibus jumps on (the other Space users go on: a boat below the quay, game/rowing.ts)
    const prev = player.onJump;
    player.onJump = () => {
      const b = this.rollingNear(player.x, player.z);
      if (b) {
        this.hop(b);
        return true;
      }
      return prev?.() ?? false;
    };
    this.fareEl = document.createElement("div");
    this.fareEl.className = "talk paper fare-card";
    this.fareEl.style.display = "none";
    document.body.appendChild(this.fareEl);
    window.addEventListener("keydown", (e) => this.fareKey(e));
    dialogs.register("conductor", () => this.fareOpen);
  }

  // ------------------------------------------------------------------ jumping on between stops, and the fare

  /** Jumped on and not paid yet: the conductor comes for it. */
  private unpaid = false;
  private fareOpen = false;
  private readonly fareEl: HTMLDivElement;
  private fareTimer = 0;

  /** A rolling omnibus whose back step is within reach (not one at a stop: there E gets you on, and pays). */
  private rollingNear(x: number, z: number): Omnibus | null {
    const n = this.net();
    if (DEMO || !n || this.riding || this.busy || this.player.swimming || this.player.climbing || this.player.laden || n.netRemote) return null;
    let best: Omnibus | null = null;
    let bd = HOP_REACH;
    for (const bus of n.buses) {
      if (bus.atStop() || bus.pose().speed < 0.3) continue;
      const s = bus.stepDown();
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < bd) {
        bd = d;
        best = bus;
      }
    }
    return best;
  }

  /** Onto the back platform of a rolling omnibus; the conductor comes for the fare a moment later. */
  private hop(bus: Omnibus): void {
    if (this.player.laden) {
      this.say("Not with goods in your arms.");
      return;
    }
    bus.rider = true;
    this.bus = bus;
    this.unpaid = true;
    const p = bus.pose();
    this.player.rideStart(() => bus.pose(), p.yaw + Math.PI, {
      x: PLATFORM_SPOT[0],
      z: PLATFORM_SPOT[1],
      walk: (fx, fz, x, z) => bus.walk(fx, fz, x, z),
      floor: (x, z) => bus.floorAt(x, z),
    });
    this.say("You run, grab the brass rail and swing up onto the back platform.");
    window.clearTimeout(this.fareTimer);
    this.fareTimer = window.setTimeout(() => this.askFare(), 1800);
  }

  private askFare(): void {
    if (!this.unpaid || !this.riding || !this.bus) return;
    const cost = this.change && this.change !== this.bus.line.id ? "show your ticket (a free change)" : `pay the fare (${this.fare} c)`;
    this.fareEl.innerHTML = `<p>The conductor squeezes past and holds out his hand. "Fare, if you please."</p><ol><li><span class="n">1</span> ${cost}</li><li><span class="n">2</span> refuse</li></ol><p class="keys">1  pay &middot; 2 or Esc  refuse</p>`;
    this.fareEl.style.display = "block";
    this.fareOpen = true;
    window.clearTimeout(this.fareTimer);
    // (he does not wait for ever: no answer is an answer)
    this.fareTimer = window.setTimeout(() => this.answerFare(false, "He waits. You look away."), 15000);
  }

  private fareKey(e: KeyboardEvent): void {
    if (!this.fareOpen || e.repeat) return;
    if (e.code === "Digit1" || e.code === "Numpad1") this.answerFare(true);
    else if (e.code === "Digit2" || e.code === "Numpad2" || e.code === "Escape") this.answerFare(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private closeFare(): void {
    this.fareOpen = false;
    this.fareEl.style.display = "none";
    window.clearTimeout(this.fareTimer);
  }

  private answerFare(pay: boolean, before = ""): void {
    const bus = this.bus;
    this.closeFare();
    if (!bus || !this.unpaid) return;
    if (!pay) return this.kickOff(before);
    this.busy = true;
    api
      .ride("hop", "", bus.line.id)
      .then((r) => {
        this.take(r);
        this.unpaid = false;
        this.say(r.text);
      })
      .catch((e) => {
        const msg = String((e as Error).message ?? e);
        this.kickOff(msg.includes("money") ? "You turn out your pockets. Not enough." : "");
      })
      .finally(() => (this.busy = false));
  }

  /** The conductor curses and puts him off, where there is room to land (he waits for it). */
  private kickOff(before: string, tries = 0): void {
    const bus = this.bus;
    if (!bus || !this.riding) return;
    if (!this.jumpSpot(bus) && tries < 12) {
      window.setTimeout(() => this.kickOff(before, tries + 1), 800);
      return;
    }
    this.unpaid = false;
    if (this.seat !== null) this.standUp();
    this.getOff(bus.atStop(), `${before ? `${before} ` : ""}${CURSES[Math.floor(Math.random() * CURSES.length)]}`);
  }

  get riding(): boolean {
    return this.player.riding;
  }

  /** Keep the fare and the free change from a server payload. */
  private take(p: JobsPayload): void {
    this.refresh(p);
    if (p.ride) {
      this.fare = p.ride.fare_c;
      this.change = p.ride.change?.from_line ?? null;
    }
  }

  /** Hook the omnibuses' calls once they exist (world/omnibus.ts onArrive, onDepart). */
  private hooked: Omnibuses | null = null;
  private hook(n: Omnibuses): void {
    if (this.hooked === n) return;
    this.hooked = n;
    // a ride left open on the server (the page reloaded on board): you are on foot now, so step down
    api
      .jobs()
      .then((p) => {
        this.take(p);
        if (p.ride?.on && !this.riding) return api.ride("alight", "").then((r) => this.take(r));
      })
      .catch(() => {});
    n.onDepart = (bus, _stop, next) => {
      if (this.riding && bus === this.bus) this.say(`Next stop: ${next.name}.`);
    };
    n.onArrive = (bus, stop) => {
      if (!this.riding || bus !== this.bus) return;
      const other = n.linesAt(stop.id).filter((l) => l.id !== bus.line.id);
      const change = other.length ? ` Change here for ${other.map((l) => l.name).join(" and ")}.` : "";
      this.say(`The conductor calls out: ${stop.name}.${change}`);
      // a spent ticket (or the end of the week): the conductor puts you off here
      api
        .jobs()
        .then((p) => {
          this.take(p);
          if (p.ending) return void this.getOff(stop, "You step down. The week is over.");
          // (jumped on between stops and not asked for the fare yet: the conductor comes to him first)
          if (p.ride && !p.ride.on && this.riding && !this.unpaid) this.getOff(stop, "The conductor puts you off: your ticket has run out.");
        })
        .catch(() => {});
    };
  }

  /**
   * What E can do now for the omnibuses, in the shape of Jobs.extraActions (game/jobs.ts):
   * riding, `only` (nothing else while you ride); at the step of a waiting omnibus, an option by distance.
   */
  keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]> } {
    const n = this.net();
    if (!n) return {};
    this.hook(n);
    if (this.riding) return { only: this.busy ? [] : this.rideKeys() };
    if (this.busy || this.player.swimming || this.player.climbing) return {};
    let best: { bus: Omnibus; stop: OmnibusStop; d: number } | null = null;
    for (const bus of n.buses) {
      const stop = bus.atStop();
      if (!stop) continue;
      const s = bus.stepDown();
      const d = Math.hypot(x - s.x, z - s.z);
      if (d <= REACH && (!best || d < best.d)) best = { bus, stop, d };
    }
    if (!best) {
      // a rolling omnibus: E (or Space) by its back step jumps on; the conductor comes for the fare
      const r = this.rollingNear(x, z);
      if (r) {
        const s = r.stepDown();
        return { options: [[Math.hypot(x - s.x, z - s.z) - 0.5, { key: "KeyE", text: `jump onto the ${r.line.board} omnibus (E or Space)`, run: () => this.hop(r), at: { x: s.x, z: s.z } }]] };
      }
      return this.postKeys(x, z);
    }
    const { bus, stop, d } = best;
    const step = bus.stepDown();
    const cost = this.change && this.change !== bus.line.id ? "a free change" : `${this.fare} c`;
    // M7 timetable: laid up at its terminus for the night: the conductor says when the first one goes
    const due = bus.due();
    if (due?.night) return { options: [[d - 0.5, { key: "KeyE", text: `the ${bus.line.board} omnibus stands here for the night`, run: () => this.say(`The conductor yawns. "Not before ${clockText(due.at)}."`), at: { x: step.x, z: step.z } }]] };
    return { options: [[d - 0.5, { key: "KeyE", text: `get on the ${bus.line.board} omnibus (${cost})`, run: () => void this.getOn(bus, stop), at: { x: step.x, z: step.z } }]] };
  }

  /** M7 omnibus routes: at a stop's post, E reads the timetable (the engine's: the server tells it by the game clock). */
  private postKeys(x: number, z: number): { options?: Array<[number, Action]> } {
    let best: { id: string; d: number; x: number; z: number } | null = null;
    for (const st of STOPS) {
      const d = Math.hypot(x - st.post[0], z - st.post[1]);
      if (d <= 1.8 && (!best || d < best.d)) best = { id: st.id, d, x: st.post[0], z: st.post[1] };
    }
    if (!best) return {};
    const id = best.id;
    return {
      options: [
        [
          best.d,
          {
            key: "KeyE",
            text: "read the timetable",
            run: () =>
              void api
                .ride("timetable", id)
                .then((r) => this.say(r.text))
                .catch(() => this.say("The plate is too worn to read.")),
            at: { x: best.x, z: best.z },
          },
        ],
      ],
    };
  }

  private async getOn(bus: Omnibus, stop: OmnibusStop): Promise<void> {
    if (this.busy) return;
    if (this.player.laden) {
      this.say("The conductor shakes his head. No goods on the omnibus.");
      return;
    }
    this.busy = true;
    bus.hold(true);
    try {
      const r = await api.ride("board", stop.id, bus.line.id);
      this.take(r);
      bus.rider = true;
      this.bus = bus;
      // onto the back platform: from there you may walk in along the aisle, or climb to the roof
      const p = bus.pose();
      this.player.rideStart(() => bus.pose(), p.yaw + Math.PI, {
        x: PLATFORM_SPOT[0],
        z: PLATFORM_SPOT[1],
        walk: (fx, fz, x, z) => bus.walk(fx, fz, x, z),
        floor: (x, z) => bus.floorAt(x, z),
      });
      this.say(r.text);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      this.say(
        msg.includes("money")
          ? `The conductor shakes his head. The fare is ${this.fare} c.`
          : msg.includes("do not run") // M7 timetable
            ? `The conductor waves you off: ${msg.replace(/^.*?the omnibuses/, "the omnibuses")}.`
            : "The conductor waves you off.",
      );
    } finally {
      bus.hold(false);
      this.busy = false;
    }
  }

  private getOff(stop: OmnibusStop | null, text?: string): void {
    const bus = this.bus;
    if (!bus || !this.riding) return;
    // at a stop it waits for you; between stops you jump and it rolls on
    if (stop) bus.hold(true);
    // down the step behind the platform; if that is taken, beside the platform
    const d = bus.stepDown();
    const p = bus.platform();
    const side = [
      [d.x, d.z],
      [p.x + Math.cos(p.yaw) * 1.6, p.z - Math.sin(p.yaw) * 1.6],
      [p.x - Math.cos(p.yaw) * 1.6, p.z + Math.sin(p.yaw) * 1.6],
    ];
    const spot = side.find(([x, z]) => this.world.isFree(x, z, 0.35)) ?? side[0];
    if (!stop && !side.some(([x, z]) => this.world.isFree(x, z, 0.35))) return;
    bus.takeSeat(-1, null);
    this.seat = null;
    this.closeFare();
    this.unpaid = false;
    this.player.rideEnd(spot[0], spot[1]);
    bus.rider = false;
    this.bus = null;
    this.say(text ?? (stop ? `You step down at ${stop.name}.` : "You jump down from the platform and land on your feet."));
    this.busy = true;
    api
      .ride("alight", stop?.id ?? "")
      .then((r) => this.take(r))
      .catch(() => {})
      .finally(() => {
        this.busy = false;
        // a moment to step clear before it moves off
        if (stop) window.setTimeout(() => bus.hold(false), 1200);
      });
  }

  /** Somewhere free to land beside or behind the platform (not a wall, not the water). */
  private jumpSpot(bus: Omnibus): boolean {
    const d = bus.stepDown();
    const p = bus.platform();
    return [
      [d.x, d.z],
      [p.x + Math.cos(p.yaw) * 1.6, p.z - Math.sin(p.yaw) * 1.6],
      [p.x - Math.cos(p.yaw) * 1.6, p.z + Math.sin(p.yaw) * 1.6],
    ].some(([x, z]) => this.world.isFree(x, z, 0.35));
  }

  /** The seat you sit on (SEATS index), or null. */
  private seat: number | null = null;

  /** Riding: E stands you up, sits you where you look, gets you off at a stop; F takes you up to the roof. */
  private rideKeys(): Action[] {
    const bus = this.bus;
    if (!bus) return [];
    const stop = bus.atStop();
    if (this.seat !== null) {
      const roof = SEATS[this.seat].roof;
      return [{ key: "KeyE", text: roof ? "climb down from the roof" : "stand up", run: () => this.standUp(), self: true }];
    }
    const out: Action[] = [];
    const w = this.player.rideWalk;
    const onPlatform = !!w && Math.hypot(w.x - PLATFORM_SPOT[0], w.z - PLATFORM_SPOT[1]) < 0.9;
    if (stop) out.push({ key: "KeyE", text: `get off at ${stop.name}`, run: () => this.getOff(stop), self: true });
    else if (onPlatform && this.jumpSpot(bus)) out.push({ key: "KeyE", text: "jump off", run: () => this.getOff(null), self: true });
    else {
      const s = this.lookedAtSeat(bus);
      // lookedAtSeat already asks the look (the seat under the crosshair)
      if (s !== null) out.push({ key: "KeyE", text: "sit down here", run: () => this.sitDown(s), self: true });
    }
    if (w && Math.hypot(w.x - LADDER_SPOT[0], w.z - LADDER_SPOT[1]) < 0.85 && !this.player.laden) {
      const free = SEATS.map((q, i) => ({ q, i })).filter(({ q, i }) => q.roof && !bus.seatTaken(i));
      if (free.length) out.push({ key: "KeyF", text: "climb up to the roof seat", run: () => this.sitDown(free[0].i), self: true });
    }
    return out;
  }

  /** The free seat inside you are looking at, within reach. */
  private lookedAtSeat(bus: Omnibus): number | null {
    const cam = this.player.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const p = bus.pose();
    const co = Math.cos(p.yaw);
    const si = Math.sin(p.yaw);
    let best: number | null = null;
    let bc = 0.9;
    SEATS.forEach((s, i) => {
      if (s.roof || bus.seatTaken(i)) return;
      const v = new THREE.Vector3(p.x + s.x * co + s.z * si, p.y + s.y + 0.25, p.z - s.x * si + s.z * co).sub(cam.position);
      const d = v.length();
      if (d > 2.6) return;
      const c = v.normalize().dot(dir);
      if (c > bc) {
        bc = c;
        best = i;
      }
    });
    return best;
  }

  private sitDown(i: number): void {
    const bus = this.bus;
    if (!bus || !bus.takeSeat(i, "player")) return;
    const s = SEATS[i];
    this.seat = i;
    // sit back on the seat, facing across the aisle (inside) or out over the street (the roof)
    this.player.rideSeat = { x: s.x * (s.roof ? 1.15 : 1.02), y: s.y, z: s.z, eye: 0.78 };
    const p = bus.pose();
    const fx = Math.sin(s.face);
    const fz = Math.cos(s.face);
    const wx = fx * Math.cos(p.yaw) + fz * Math.sin(p.yaw);
    const wz = -fx * Math.sin(p.yaw) + fz * Math.cos(p.yaw);
    this.player.yaw = Math.atan2(-wx, -wz);
    this.player.pitch = -0.05;
    if (s.roof) {
      this.say("You climb the iron rungs to the roof and sit on the long bench, your back to the other side.");
      api.ride("seat", "", undefined, "roof").then((r) => this.take(r)).catch(() => {});
    }
  }

  private standUp(): void {
    const bus = this.bus;
    if (!bus || this.seat === null) return;
    const s = SEATS[this.seat];
    bus.takeSeat(-1, null);
    this.seat = null;
    this.player.rideSeat = null;
    const w = this.player.rideWalk;
    if (w) {
      if (s.roof) {
        [w.x, w.z] = LADDER_SPOT;
        api.ride("seat", "", undefined, "inside").then((r) => this.take(r)).catch(() => {});
      } else [w.x, w.z] = bus.walk(0, s.z, s.x * 0.3, s.z);
    }
  }

  /** Dev: state for checks. */
  info(): Record<string, unknown> {
    return { riding: this.riding, seat: this.seat, walk: this.player.rideWalk ? [+this.player.rideWalk.x.toFixed(2), +this.player.rideWalk.z.toFixed(2)] : null, bus: this.bus?.index ?? null, line: this.bus?.line.id ?? null, busy: this.busy, fare: this.fare, change: this.change, net: this.net()?.info() ?? null };
  }
}
