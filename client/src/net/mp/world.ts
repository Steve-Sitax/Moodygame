// M8b multiplayer: the moving world, run by one PC for all (docs/multiplayer-plan.md 4.6, 5.2; docs/milestones/M8b.md).
//
// The omnibuses, the river traffic, the bridges, the lock, the goods train and its cranes, the rail gate and the
// drays wait for the people and the carts in their way, which are not the same on two PCs: left to themselves,
// each PC's copies drift apart. So one PC, the world PC (the server picks it: the host's while his tab draws),
// runs them as ever and sends their state 10 times a second; every other PC stops running them and shows them
// from that state, about 200 ms in the past, between two states. When the world PC changes, the new one simply
// goes on from the state it last showed: every mover keeps what it was sent in its own fields.
//
// Each mover offers the same three things (NetMover): its state as a small JSON object, a switch "run by
// another PC", and a way to take a state (which moves its models, its colliders, its decks and its water, and
// plays the sounds a change brings: a bell, a clack).

import { WORLD_HZ, type MpText } from "../../../../shared/mpProtocol";

/** A moving part of the world that one PC runs for all. */
export interface NetMover<S = unknown> {
  /** Its state now, small and JSON-able (numbers, strings, booleans, arrays and objects of them). */
  netState(): S;
  /**
   * Run by another PC: skip the own simulation (no decisions, no waits, no randomness), keep drawing; the state
   * comes through netApply. Off again: go on from the last state taken.
   */
  netRemote: boolean;
  /**
   * The world PC's state (already between two states: see lerpState). Put it in the own fields, move the models,
   * the colliders, the decks and the water with it, and play the sounds its changes bring.
   */
  netApply(s: S, dt: number): void;
  /**
   * Optional: between two of its states at u (0..1). Without it, lerpState: numbers are eased, angles (keys ending
   * in "yaw" or named "a") go the short way, keys starting with "_" and every string or boolean come from the
   * nearer state, and lists of objects with an `id` are matched by id (else by place in the list).
   */
  netLerp?(a: S, b: S, u: number): S;
  /**
   * Set by world.ts on a PC where another runs the world: a player here who asks this mover for something (hold
   * the omnibus while he boards, open a bridge or the lock for his boat) asks the world PC through it.
   */
  netAsk?: ((what: string, args: unknown[]) => void) | null;
}

/** What a player may ask the world PC's movers for (the world PC does it as if he were there). */
/** (sync pass 2: "bus_board", a townsperson another PC's trip puts on an omnibus: [omnibus, id, kind, stop].) */
export const ASKS = ["bus_hold", "bridge", "lock", "bus_board"] as const;

/** Drawn this far in the past to start (ms); then from how late the states come. */
export const WORLD_DELAY_START = 220;
export const WORLD_DELAY_MIN = 200;
export const WORLD_DELAY_MAX = 400;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const isAngle = (k: string) => k === "a" || /yaw$/i.test(k);

/** Between two states of a mover at u (0..1): see NetMover.netLerp. */
export function lerpState<T>(a: T, b: T, u: number, key = ""): T {
  if (typeof a === "number" && typeof b === "number") {
    if (key.startsWith("_")) return (u < 0.5 ? a : b) as T;
    if (isAngle(key)) return (a + wrap(b - a) * u) as T;
    return (a + (b - a) * u) as T;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const byId = b.length && typeof b[0] === "object" && b[0] !== null && "id" in (b[0] as object);
    if (byId) {
      const old = new Map((a as Array<{ id: unknown }>).map((x) => [x.id, x]));
      return (b as Array<{ id: unknown }>).map((x) => {
        const o = old.get(x.id);
        return o ? lerpState(o, x, u, key) : x;
      }) as T;
    }
    if (a.length !== b.length) return (u < 0.5 ? a : b) as T;
    return (b as unknown[]).map((x, i) => lerpState(a[i], x, u, key)) as T;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(b as object)) {
      const av = (a as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k];
      out[k] = av === undefined ? bv : lerpState(av, bv, u, k);
    }
    return out as T;
  }
  return (u < 0.5 ? a : b) as T;
}

export interface WorldNetDeps {
  /** This player's id (0 before the welcome). */
  me(): number;
  /** The server's clock now (ms). */
  serverNow(): number;
  sendText(m: MpText): boolean;
  /** Every mover by its key; null for one not loaded yet (asked again every frame). */
  movers(): Record<string, NetMover | null>;
  /**
   * The movers as points on the town map (lists of { id, x, z, ... } by kind), sent twice a second with the world
   * for the host's map (the other PCs do not read them).
   */
  mapPoints?(): Record<string, unknown[]>;
  /** Where another player is drawn here (for the lock waiting for his boat), or null. */
  playerAt?(id: number): { x: number; z: number } | null;
}

export class WorldNet {
  /** Who runs the world now (the server's word; 0: nobody yet). */
  pc = 0;
  private buf: Array<{ t: number; d: Record<string, unknown> }> = [];
  private delay = WORLD_DELAY_START;
  private late: number[] = [];
  private acc = 0;
  private sends = 0;
  private remoteNow = false;
  /** The harness's and the kit's numbers. */
  readonly meter = { sent: 0, bytesSent: 0, received: 0, starved: 0, takeovers: 0, asked: 0 };

  constructor(private readonly d: WorldNetDeps) {}

  /** Played together and another PC runs the world? */
  get remote(): boolean {
    return this.pc !== 0 && this.pc !== this.d.me();
  }

  setPc(id: number): void {
    const was = this.remote;
    this.pc = id;
    if (was && !this.remote) this.meter.takeovers++;
    if (!this.remote) this.buf = [];
  }

  /** A state from the world PC. */
  onWorld(m: Extract<MpText, { type: "world" }>, recvNow: number): void {
    if (!this.remote) return;
    this.meter.received++;
    const last = this.buf[this.buf.length - 1];
    if (last && m.t <= last.t) return;
    this.buf.push({ t: m.t, d: m.d });
    if (this.buf.length > 30) this.buf.shift();
    this.late.push(recvNow - m.t);
    if (this.late.length > 50) this.late.shift();
  }

  /** Each frame, before the world moves: every mover run here or shown from the world PC. */
  frame(dt: number): void {
    const movers = this.d.movers();
    const remote = this.remote;
    if (remote !== this.remoteNow) this.remoteNow = remote;
    for (const m of Object.values(movers)) {
      if (!m) continue;
      if (m.netRemote !== remote) m.netRemote = remote;
      if (!m.netAsk) m.netAsk = (what, args) => this.d.sendText({ type: "ask", what, args });
    }
    if (remote) this.show(movers, dt);
    else if (this.pc !== 0 && this.pc === this.d.me()) this.send(movers, dt);
  }

  private show(movers: Record<string, NetMover | null>, dt: number): void {
    if (this.late.length >= 10) {
      const sorted = [...this.late].sort((a, b) => a - b);
      const want = Math.max(WORLD_DELAY_MIN, Math.min(WORLD_DELAY_MAX, sorted[Math.floor(sorted.length * 0.95)] + 110));
      const step = dt * 1000 * 0.05;
      this.delay += Math.max(-step, Math.min(step, want - this.delay));
    }
    const b = this.buf;
    if (!b.length) return;
    const t = this.d.serverNow() - this.delay;
    while (b.length > 2 && b[1].t <= t) b.shift();
    const a = b[0];
    const c = b[1];
    let u = 0;
    let from = a;
    let to = a;
    if (c && t > a.t) {
      to = c;
      u = Math.min(1, (t - a.t) / Math.max(1, c.t - a.t));
      if (t > c.t) this.meter.starved++;
    }
    for (const [key, m] of Object.entries(movers)) {
      if (!m) continue;
      const sa = from.d[key];
      const sb = to.d[key];
      if (sb === undefined) continue;
      const s = sa === undefined || from === to ? sb : m.netLerp ? m.netLerp(sa, sb, u) : lerpState(sa, sb, u);
      m.netApply(s, dt);
    }
  }

  private send(movers: Record<string, NetMover | null>, dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / WORLD_HZ) return;
    this.acc = 0;
    const d: Record<string, unknown> = {};
    for (const [key, m] of Object.entries(movers)) if (m) d[key] = m.netState();
    if (++this.sends % 5 === 0 && this.d.mapPoints) Object.assign(d, this.d.mapPoints());
    const msg: MpText = { type: "world", t: this.d.serverNow(), d };
    if (this.d.sendText(msg)) {
      this.meter.sent++;
      this.meter.bytesSent += JSON.stringify(msg).length;
    }
  }

  /**
   * The world PC: another player asks one of its movers for something (only the few things of ASKS; the
   * arguments are checked by the mover's own code as if the player were here).
   */
  onAsked(m: Extract<MpText, { type: "asked" }>): void {
    if (this.remote || !(ASKS as readonly string[]).includes(m.what) || !Array.isArray(m.args)) return;
    const mv = this.d.movers() as Record<string, { hold?: unknown } & Record<string, unknown> & NetMover | null>;
    const a = m.args;
    try {
      if (m.what === "bus_hold" && typeof a[0] === "number" && typeof a[1] === "boolean") {
        const bus = (mv.omnibus as unknown as { buses: Array<{ index: number; hold(on: boolean): void }> } | null)?.buses.find((b) => b.index === a[0]);
        bus?.hold(a[1]);
      } else if (m.what === "bus_board" && typeof a[0] === "number" && typeof a[1] === "string" && typeof a[2] === "string" && typeof a[3] === "string") {
        // (the omnibus checks the rest: its round's stop, a seat, the look)
        (mv.omnibus as unknown as { netBoard(bus: number, id: string, kind: string, alight: string): void } | null)?.netBoard(a[0], a[1].slice(0, 40), a[2].slice(0, 20), a[3].slice(0, 40));
      } else if (m.what === "bridge" && typeof a[0] === "string" && typeof a[1] === "boolean") {
        // (each player's boat is its own asker: "rower:<id>")
        (mv.bridges as unknown as { request(k: string, who: string, on: boolean): void } | null)?.request(a[0].slice(0, 40), `rower:${m.from}`, a[1]);
      } else if (m.what === "lock" && typeof a[0] === "boolean") {
        // (the lock waits for his boat where he is drawn here)
        const from = m.from;
        const where = this.d.playerAt?.(from) ? () => this.d.playerAt!(from) ?? { x: 0, z: 0 } : undefined;
        (mv.lock as unknown as { request(on: boolean, where?: () => { x: number; z: number }): void } | null)?.request(a[0], where);
      }
      this.meter.asked++;
    } catch {
      /* a mover not loaded yet: the player asks again */
    }
  }

  report() {
    return { pc: this.pc, remote: this.remote, delay: Math.round(this.delay), buffered: this.buf.length, ...this.meter };
  }
}
