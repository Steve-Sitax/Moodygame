// M8b multiplayer: "one street for all" on the server (docs/multiplayer-plan.md 4.6, 5.2; docs/milestones/M8b.md).
//
// The server walks nobody. It keeps two things:
// - Owners: which player's PC walks which townsperson. A PC asks for the people it is about to draw (claim)
//   and lets them go when they leave its range (release). The first to ask gets them; near the host the host
//   may take them from a guest (steal: until M8c only the host can talk and work, so the people round him are
//   his). A player who leaves, or whose PC stops sending them, loses them all; the next PC near takes them over
//   from where they were last seen. Each resident gets a small number the first time he is claimed: the
//   binary batches carry that number instead of the id.
// - The world PC: the one PC that runs the omnibuses, boats, bridges, the lock, the train, the cranes and the
//   drays and sends their state. The host's while his tab draws; else the lowest player id whose tab draws.
//   A change needs a reason (the world PC's state stopped coming, or the host is back and has drawn for a
//   while): no flapping between two PCs.

export type OwnerRow = [num: number, id: string, owner: number];

export class Owners {
  private readonly nums = new Map<string, number>();
  private readonly ids = new Map<number, string>();
  private readonly owner = new Map<number, number>();
  private next = 1;

  /** The number of a resident id (made the first time). Null past 65535 (never in a town of a few hundred). */
  numOf(id: string): number | null {
    let n = this.nums.get(id);
    if (n === undefined) {
      if (this.next > 0xffff) return null;
      n = this.next++;
      this.nums.set(id, n);
      this.ids.set(n, id);
    }
    return n;
  }

  /** The resident id of a number (null: never numbered). */
  idOf(num: number): string | null {
    return this.ids.get(num) ?? null;
  }

  ownerOf(num: number): number {
    return this.owner.get(num) ?? 0;
  }

  owns(pid: number, num: number): boolean {
    return this.owner.get(num) === pid;
  }

  /** How many this player walks. */
  count(pid: number): number {
    let n = 0;
    for (const o of this.owner.values()) if (o === pid) n++;
    return n;
  }

  /**
   * A player asks for these. `changes` go to everyone; `denied` (who has them now) only to him, so his PC
   * shows them from the owner's batches instead of walking them itself.
   */
  claim(pid: number, ids: string[], steal: boolean, isHost: (pid: number) => boolean): { changes: OwnerRow[]; denied: OwnerRow[] } {
    const changes: OwnerRow[] = [];
    const denied: OwnerRow[] = [];
    for (const id of ids.slice(0, 200)) {
      if (typeof id !== "string" || !id || id.length > 64) continue;
      const num = this.numOf(id);
      if (num === null) continue;
      const cur = this.owner.get(num) ?? 0;
      if (cur === pid) continue;
      if (cur === 0 || (steal && isHost(pid) && !isHost(cur))) {
        this.owner.set(num, pid);
        changes.push([num, id, pid]);
      } else denied.push([num, id, cur]);
    }
    return { changes, denied };
  }

  /**
   * He lets these go (only his own). `gone`: they left the street (in at a door): the row says owner -1, so no
   * other PC takes them on (the ones in `ids` are still in the street: owner 0, the next PC near walks them on).
   */
  release(pid: number, ids: string[], gone: string[] = []): OwnerRow[] {
    const changes: OwnerRow[] = [];
    const one = (id: unknown, to: number) => {
      const num = typeof id === "string" ? this.nums.get(id) : undefined;
      if (num === undefined || this.owner.get(num) !== pid) return;
      this.owner.delete(num);
      changes.push([num, id as string, to]);
    };
    for (const id of ids.slice(0, 200)) one(id, 0);
    for (const id of (Array.isArray(gone) ? gone : []).slice(0, 200)) one(id, -1);
    return changes;
  }

  /** He left, or his PC stopped sending them: nobody walks them now (the next PC near takes them). */
  dropAll(pid: number): OwnerRow[] {
    const changes: OwnerRow[] = [];
    for (const [num, o] of this.owner) {
      if (o !== pid) continue;
      this.owner.delete(num);
      changes.push([num, this.ids.get(num)!, 0]);
    }
    return changes;
  }

  /** Everyone walked now (for a PC that joins). */
  list(): OwnerRow[] {
    return [...this.owner].map(([num, o]) => [num, this.ids.get(num)!, o]);
  }

  clear(): void {
    this.owner.clear();
  }
}

/** Who is fit to run the world, from what the server hears of each player. */
export interface WorldSeat {
  id: number;
  host: boolean;
  online: boolean;
  /** Server ms of his last movement state: 20 a second from a tab that draws, once a second from a hidden one. */
  stateAt: number;
  /**
   * His states a second over the last two seconds (optional: without it, a single gap decides). A slow PC that
   * draws at 10 frames a second still sends 5 or more; a hidden tab sends 1.
   */
  rate?: number;
}

/** A tab draws if its last state is this recent (and, when known, its rate is at least DRAWS_RATE). */
export const DRAWS_MS = 1500;
export const DRAWS_RATE = 4;
/** The world PC's own state stopped this long: another takes over (a slow tab still sends within this). */
export const WORLD_STALE_MS = 3000;
/** The host back and drawing this long: he takes the world back. */
export const HOST_BACK_MS = 3000;
/** After a change, the world stays with its new PC at least this long (unless it goes or falls silent). */
export const WORLD_HOLD_MS = 10_000;
/** A new world PC that draws but has sent no world yet (its town still loading) keeps it this long. */
export const STARTING_MS = 20_000;

export class WorldPc {
  id = 0;
  /** Server ms of the world PC's last "world" message. */
  lastWorldAt = 0;
  /** Since when the host has been drawing without a break (0: not now). */
  private hostSince = 0;

  /** Choose again; returns the new id when it changed, else null. */
  choose(seats: WorldSeat[], now: number): number | null {
    const draws = (s: WorldSeat) => s.online && now - s.stateAt < DRAWS_MS && (s.rate === undefined || s.rate >= DRAWS_RATE);
    const host = seats.find((s) => s.host);
    if (host && draws(host)) this.hostSince ||= now;
    else this.hostSince = 0;
    const cur = seats.find((s) => s.id === this.id);
    // (a hidden tab still sends its own state once a second, but no world: the world counts; a tab that draws
    // but has sent no world yet, still loading its town, keeps it a while)
    const curOk = !!cur && cur.online && (now - this.lastWorldAt < WORLD_STALE_MS || (draws(cur) && this.worldSeen === 0 && now - this.since < STARTING_MS));
    let want = this.id;
    if (!curOk) {
      const pick = host && draws(host) ? host : seats.filter(draws).sort((a, b) => a.id - b.id)[0];
      // nobody fit (every tab hidden): the current one keeps it while he is online (no flapping to nobody and back)
      want = pick?.id ?? (cur?.online ? this.id : 0);
    } else if (host && cur && !cur.host && this.hostSince && now - this.hostSince >= HOST_BACK_MS && now - this.since >= WORLD_HOLD_MS) want = host.id;
    if (want === this.id) return null;
    this.id = want;
    this.lastWorldAt = now; // a fresh start: the new one has a moment to send
    this.since = now;
    this.worldSeen = 0;
    return want;
  }

  /** The world PC sent its world. */
  heard(now: number): void {
    this.lastWorldAt = now;
    this.worldSeen++;
  }

  private since = 0;
  private worldSeen = 0;
}
