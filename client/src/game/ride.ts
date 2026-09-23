import type { FirstPerson } from "../player/firstPerson";
import type { Omnibus, Omnibuses, OmnibusStop } from "../world/omnibus";
import type { World } from "../world/rijnkaai";
import { api, type JobsPayload } from "../net/api";
import type { Action } from "./runs";

// Riding the omnibuses (M3g). At a stop, while an omnibus waits, E at its back platform gets you
// on: the server takes the fare, or punches your ticket for a change (server/src/ride.ts: one
// free change onto the other line while the ticket runs). You ride on the platform, looking
// round as you like; the view turns with the omnibus. The conductor calls each stop, and says
// where you can change; E there gets you off. The server also counts you as riding for the
// hourly needs (warmth goes slower on board). Carrying goods for a job, you cannot get on.

const REACH = 2.8; // from the foot of the step

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
  ) {}

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
          if (p.ride && !p.ride.on && this.riding) this.getOff(stop, "The conductor puts you off: your ticket has run out.");
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
    if (this.riding) {
      const stop = this.bus?.atStop();
      return { only: stop && !this.busy ? [{ key: "KeyE", text: `get off at ${stop.name}`, run: () => this.getOff(stop) }] : [] };
    }
    if (this.busy || this.player.swimming || this.player.climbing) return {};
    let best: { bus: Omnibus; stop: OmnibusStop; d: number } | null = null;
    for (const bus of n.buses) {
      const stop = bus.atStop();
      if (!stop) continue;
      const s = bus.stepDown();
      const d = Math.hypot(x - s.x, z - s.z);
      if (d <= REACH && (!best || d < best.d)) best = { bus, stop, d };
    }
    if (!best) return {};
    const { bus, stop, d } = best;
    const cost = this.change && this.change !== bus.line.id ? "a free change" : `${this.fare} c`;
    return { options: [[d - 0.5, { key: "KeyE", text: `get on the ${bus.line.board} omnibus (${cost})`, run: () => void this.getOn(bus, stop) }]] };
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
      // look out over the left side of the platform, a little back
      const p = bus.platform();
      this.player.rideStart(() => bus.platform(), p.yaw - Math.PI / 2 + 0.4);
      this.say(r.text);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      this.say(msg.includes("money") ? `The conductor shakes his head. The fare is ${this.fare} c.` : "The conductor waves you off.");
    } finally {
      bus.hold(false);
      this.busy = false;
    }
  }

  private getOff(stop: OmnibusStop, text?: string): void {
    const bus = this.bus;
    if (!bus || !this.riding) return;
    bus.hold(true);
    // down the step behind the platform; if that is taken, beside the platform
    const d = bus.stepDown();
    const p = bus.platform();
    const side = [
      [d.x, d.z],
      [p.x + Math.cos(p.yaw) * 1.6, p.z - Math.sin(p.yaw) * 1.6],
      [p.x - Math.cos(p.yaw) * 1.6, p.z + Math.sin(p.yaw) * 1.6],
    ];
    const spot = side.find(([x, z]) => this.world.isFree(x, z, 0.35)) ?? side[0];
    this.player.rideEnd(spot[0], spot[1]);
    bus.rider = false;
    this.bus = null;
    this.say(text ?? `You step down at ${stop.name}.`);
    this.busy = true;
    api
      .ride("alight", stop.id)
      .then((r) => this.take(r))
      .catch(() => {})
      .finally(() => {
        this.busy = false;
        // a moment to step clear before it moves off
        window.setTimeout(() => bus.hold(false), 1200);
      });
  }

  /** Dev: state for checks. */
  info(): Record<string, unknown> {
    return { riding: this.riding, bus: this.bus?.index ?? null, line: this.bus?.line.id ?? null, busy: this.busy, fare: this.fare, change: this.change, net: this.net()?.info() ?? null };
  }
}
