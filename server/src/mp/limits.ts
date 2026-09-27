// M8e part B (docs/milestones/M8e.md): rate limits per seat, for play outside the house (a VPN). The numbers are
// all here. Each is about twice what the real client sends in normal play, with a burst that covers a stall on
// the line (a VPN or Wi-Fi hiccup holds frames back, then they come at once), so normal play is never cut:
//
// - The movement socket (/mp), per seat (player id): what is over the limit is dropped (not passed on) and
//   counted (/api/mp/stats). A seat far over (FLOOD_X times its normal rate for FLOOD_S seconds in a row) is
//   a broken or hostile client: it is told why and its socket is closed (code 4006).
// - HTTP /api/* for guests, per token (a guest's player id): over the limit the answer is 429 with a plain
//   English error. The host (this computer) and the server's own calls are never limited.

/** One kind of message on the movement socket: its normal rate, the limit, the burst. */
export interface Rate {
  /** What the real client sends a second in normal play (the flood rule counts from it). */
  normal: number;
  /** Sustained limit a second (the bucket refills at this). */
  rate: number;
  /** Bucket size: what may come at once after a stall. */
  burst: number;
}

export const SOCKET_LIMITS = {
  // own state: session.ts sends every SEND_MS (50 ms, 20 a second), always, also with the menu up. A stall of
  // up to 6 s (120 frames held back) comes through whole.
  state: { normal: 20, rate: 40, burst: 120 },
  // townspeople batches: street.ts sends at PUPPET_HZ (10) at most, one batch per 150 people (PUPPET_MAX); one
  // PC walks at most about 190 residents, so 2 batches a tick is the most there is.
  puppets: { normal: 10, rate: 30, burst: 60 },
  // the moving world (JSON, about 3 KB): world.ts sends at WORLD_HZ (10), from the world PC only.
  world: { normal: 10, rate: 20, burst: 40 },
  // job figures: jobfigs.ts sends at FIG_HZ (10) while one walks. Their own cap (FIG_RATE 15 a second, M8d) in
  // mp/index.ts drops the rest; here only the flood rule counts them.
  figs: { normal: 10, rate: 1000, burst: 1000 },
  // the other text messages: a ping a second (session.ts), claims and releases when people come and go (at most
  // one of each a frame, only when the town spawns or loses one), a mover's ask (a bus hold, a bridge, the lock).
  text: { normal: 10, rate: 60, burst: 120 },
} as const satisfies Record<string, Rate>;

export type SocketKind = keyof typeof SOCKET_LIMITS;
export const SOCKET_KINDS = Object.keys(SOCKET_LIMITS) as SocketKind[];

/** A seat that sends FLOOD_X times the normal rate of a kind for FLOOD_S seconds in a row is disconnected. */
export const FLOOD_X = 10;
export const FLOOD_S = 5;
/** The close code and the reason the client shows. */
export const FLOOD_CODE = 4006;
export const FLOOD_WHY = "The host's game closed the line: this PC sent far more than the game ever sends. Reload the page to come back.";

// HTTP /api/* for a guest. The game's own calls: a heartbeat tick every 10 s, a few polls every 10-15 s (the
// ballads, the ideas), and a burst at the start (the town, the people, the shops, the posters ... a few dozen)
// and when a menu or a talk opens. The costly part (a model call) has its own budget (ai/budget.ts); this only
// stops a runaway or hostile client.
export const HTTP_LIMIT = { rate: 20, burst: 60 } as const;
export const HTTP_WHY = "Too many requests from this PC at once. Wait a moment and try again.";

/** A token bucket: `take()` is true while there is room. Pure (the time is passed in), for the tests. */
export class Bucket {
  private tokens: number;
  private at: number;
  readonly rate: number;
  readonly burst: number;
  constructor(rate: number, burst: number, now: number) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = now;
  }
  take(now: number): boolean {
    const dt = Math.max(0, now - this.at) / 1000;
    this.at = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** What a seat's limiter says about one message. */
export type Say = "ok" | "drop" | "flood";

/**
 * The movement socket's limits for one seat: a bucket per kind, and the flood rule (arrivals counted per whole
 * second; FLOOD_S seconds in a row over FLOOD_X times normal is a flood). Kept with the seat, so a reconnect
 * does not clear a flood.
 */
export class SeatLimiter {
  private readonly buckets = new Map<SocketKind, Bucket>();
  private readonly win = new Map<SocketKind, { t0: number; n: number; strikes: number }>();
  readonly dropped: Record<SocketKind, number> = { state: 0, puppets: 0, world: 0, figs: 0, text: 0 };

  message(kind: SocketKind, now: number): Say {
    const lim = SOCKET_LIMITS[kind];
    // the flood rule: arrivals in this second, and how many seconds in a row were far over
    let w = this.win.get(kind);
    if (!w) this.win.set(kind, (w = { t0: now, n: 0, strikes: 0 }));
    if (now - w.t0 >= 1000) {
      const over = w.n > FLOOD_X * lim.normal;
      // (a quiet second in between ends the run)
      w.strikes = over && now - w.t0 < 2000 ? w.strikes + 1 : 0;
      w.t0 = now;
      w.n = 0;
    }
    w.n++;
    if (w.strikes >= FLOOD_S - 1 && w.n > FLOOD_X * lim.normal) return "flood";
    let b = this.buckets.get(kind);
    if (!b) this.buckets.set(kind, (b = new Bucket(lim.rate, lim.burst, now)));
    if (b.take(now)) return "ok";
    this.dropped[kind]++;
    return "drop";
  }

  get droppedTotal(): number {
    let n = 0;
    for (const k of SOCKET_KINDS) n += this.dropped[k];
    return n;
  }
}

/** The HTTP limit per guest (by player id: one token each). */
export class HttpLimiter {
  private readonly buckets = new Map<number, Bucket>();
  readonly refused = new Map<number, number>();
  total = 0;

  take(id: number, now: number): boolean {
    let b = this.buckets.get(id);
    if (!b) this.buckets.set(id, (b = new Bucket(HTTP_LIMIT.rate, HTTP_LIMIT.burst, now)));
    if (b.take(now)) return true;
    this.refused.set(id, (this.refused.get(id) ?? 0) + 1);
    this.total++;
    return false;
  }

  /** A removed guest: his bucket goes too. */
  forget(id: number): void {
    this.buckets.delete(id);
  }
}
