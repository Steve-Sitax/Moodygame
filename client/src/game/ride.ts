import type { FirstPerson } from "../player/firstPerson";
import type { Omnibus, OmnibusStop } from "../world/omnibus";
import type { World } from "../world/rijnkaai";
import { api, type JobsPayload } from "../net/api";
import type { Action } from "./runs";

// Riding the omnibus (M3g). At a stop, while it waits, E at the back platform gets you on: the
// server takes the fare (server/src/ride.ts) and you ride on the platform, looking round as you
// like; the view turns with the omnibus. The conductor calls each stop; E there gets you off.
// The server also counts you as riding for the hourly needs (warmth goes slower on board).
// Carrying goods for a job, you cannot get on.

const REACH = 2.8; // from the foot of the step

export class Ride {
  private busy = false;
  /** The stop we got on at. */
  private from: OmnibusStop | null = null;
  fare = 5;

  constructor(
    private readonly player: FirstPerson,
    private readonly world: World,
    private readonly bus: () => Omnibus | null,
    private readonly say: (text: string) => void,
    private readonly refresh: (p: JobsPayload) => void,
  ) {}

  get riding(): boolean {
    return this.player.riding;
  }

  /** Hook the omnibus's calls once it exists (world/omnibus.ts onArrive, onDepart). */
  private hooked: Omnibus | null = null;
  private hook(b: Omnibus): void {
    if (this.hooked === b) return;
    this.hooked = b;
    b.onDepart = (_stop, next) => {
      if (this.riding) this.say(`Next stop: ${next.name}.`);
    };
    b.onArrive = (stop) => {
      if (!this.riding) return;
      this.say(`The conductor calls out: ${stop.name}.`);
      // a spent ticket (or the end of the week): the conductor puts you off here
      api
        .jobs()
        .then((p) => {
          this.refresh(p);
          if (p.ending) return void this.getOff(stop, "You step down. The week is over.");
          if (p.ride && !p.ride.on && this.riding) this.getOff(stop, "The conductor puts you off: your fare has run out.");
        })
        .catch(() => {});
    };
  }

  /**
   * What E can do now for the omnibus, in the shape of Jobs.extraActions (game/jobs.ts):
   * riding, `only` (nothing else while you ride); at the step of a waiting omnibus, an option by distance.
   */
  keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]> } {
    const b = this.bus();
    if (!b) return {};
    this.hook(b);
    const stop = b.atStop();
    if (this.riding) return { only: stop && !this.busy ? [{ key: "KeyE", text: `get off at ${stop.name}`, run: () => this.getOff(stop) }] : [] };
    if (!stop || this.busy || this.player.swimming || this.player.climbing) return {};
    const d = b.stepDown();
    const dist = Math.hypot(x - d.x, z - d.z);
    if (dist > REACH) return {};
    return { options: [[dist - 0.5, { key: "KeyE", text: `get on the omnibus (${this.fare} c)`, run: () => void this.getOn(stop) }]] };
  }

  private async getOn(stop: OmnibusStop): Promise<void> {
    const b = this.bus();
    if (!b || this.busy) return;
    if (this.player.laden) {
      this.say("The conductor shakes his head. No goods on the omnibus.");
      return;
    }
    this.busy = true;
    b.hold(true);
    try {
      const r = await api.ride("board", stop.id);
      this.refresh(r);
      if (r.ride) this.fare = r.ride.fare_c;
      b.rider = true;
      this.from = stop;
      // look out over the left side of the platform (the river on the way out), a little back
      const p = b.platform();
      this.player.rideStart(() => b.platform(), p.yaw - Math.PI / 2 + 0.4);
      this.say(r.text);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      this.say(msg.includes("money") ? `The conductor shakes his head. The fare is ${this.fare} c.` : "The conductor waves you off.");
    } finally {
      b.hold(false);
      this.busy = false;
    }
  }

  private getOff(stop: OmnibusStop, text?: string): void {
    const b = this.bus();
    if (!b || !this.riding) return;
    b.hold(true);
    // down the step behind the platform; if that is taken, beside the platform
    const d = b.stepDown();
    const p = b.platform();
    const side = [
      [d.x, d.z],
      [p.x + Math.cos(p.yaw) * 1.6, p.z - Math.sin(p.yaw) * 1.6],
      [p.x - Math.cos(p.yaw) * 1.6, p.z + Math.sin(p.yaw) * 1.6],
    ];
    const spot = side.find(([x, z]) => this.world.isFree(x, z, 0.35)) ?? side[0];
    this.player.rideEnd(spot[0], spot[1]);
    b.rider = false;
    this.say(text ?? `You step down at ${stop.name}.`);
    this.from = null;
    this.busy = true;
    api
      .ride("alight", stop.id)
      .then((r) => this.refresh(r))
      .catch(() => {})
      .finally(() => {
        this.busy = false;
        // a moment to step clear before it moves off
        window.setTimeout(() => b.hold(false), 1200);
      });
  }

  /** Dev: state for checks. */
  info(): Record<string, unknown> {
    return { riding: this.riding, from: this.from?.id ?? null, busy: this.busy, fare: this.fare, bus: this.bus()?.info() ?? null };
  }
}
