// M8d multiplayer: "shared work" on this side (docs/multiplayer-plan.md 9, "Twists and job figures").
// No three.js here (the server's tests run it in node).
//
// A figure a job makes in code (the thief of a watch, the stranger who buys, the employer's man, the one a parcel
// is for, the lads of a gang, a stowaway: game/figures.ts Figure) lives on the PC of the player whose job it is.
// - That PC sends all its made figures in one small binary batch: 10 a second while one moves, 2 a second while
//   all stand, and a few empty ones when the last is gone (FIG_* in shared/mpProtocol.ts: 22 bytes a figure).
// - The others draw them about 200 ms in the past, between two states; a figure missing from its holder's newest
//   batch goes once that batch is drawn; all of a holder's go when his batches stop (he left, or his tab hangs).
// A townsperson called for a job is no figure: he is streamed as a townsperson (street.ts, the "pins").

// (".js": the server's tests read this file too, as the shared plans do)
import { decodeFigs, encodeFigs, FIG_HZ, FIG_MAX, type FigKind, type FigMotion, type FigState } from "../../../../shared/mpProtocol.js";

/** Drawn this far in the past (two batches of margin at 10 a second). */
export const FIG_DELAY_MS = 200;
/** A holder whose batches stopped this long: his figures go. */
export const FIG_SILENT_MS = 2500;
/** Standing figures are sent this often (a second over this many). */
const STAND_HZ = 2;
/** After the last figure is gone: this many empty batches (a lost one is covered by the silence rule too). */
const EMPTY_SENDS = 3;
/** Drawn only this near (the fog hides them beyond; the holder's are near him anyway). */
export const FIG_DRAW_R = 120;
/** A jump of place larger than this between two states is not walked. */
const SNAP_M = 4;

/** What a made figure shows the others now. */
export interface NetLook {
  kind: FigKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  motion: FigMotion;
  carrying: boolean;
}

/** A made figure of this PC, as figures.ts gives it (`out`: an object to fill instead of a new one). */
export interface OwnFigure {
  netLook(out?: NetLook): NetLook;
}

/** A figure drawn here from another player's job (figures.ts Figure made with { remote: true }). */
export interface DrawnFigure {
  netPlace(x: number, y: number, z: number, yaw: number, speed: number, motion: FigMotion, carrying: boolean): void;
  update(dt: number): void;
  remove(): void;
}

export interface JobFigsDeps {
  /** This PC's own made figures now. */
  own(): Iterable<OwnFigure>;
  /** A figure to draw another player's (null: not now). */
  make(kind: FigKind, x: number, y: number, z: number): DrawnFigure | null;
  serverNow(): number;
  player(): { x: number; z: number };
  sendBinary(b: ArrayBuffer): boolean;
}

type Timed = FigState & { t: number };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Where a figure is drawn at `t` (server ms, less the delay): between the two states round it, the newest when
 * `t` is past it (a standing one is sent twice a second), the first before it. A jump (snap) is not walked.
 * `out`: filled with an in-between state instead of a new object (a state of `buf` itself is returned as it is).
 */
export function sampleFig(buf: readonly Timed[], t: number, out?: Timed): Timed | null {
  if (!buf.length) return null;
  let i = 0;
  while (i + 1 < buf.length && buf[i + 1].t <= t) i++;
  const a = buf[i];
  const b = buf[i + 1];
  if (!b || t <= a.t) return a;
  if (b.snap || Math.hypot(b.x - a.x, b.z - a.z) > SNAP_M) return a;
  const u = (t - a.t) / Math.max(1, b.t - a.t);
  const o = out ?? ({} as Timed);
  const near = u < 0.5 ? a : b;
  o.id = near.id;
  o.kind = near.kind;
  o.motion = near.motion;
  o.snap = near.snap;
  o.carrying = near.carrying;
  o.t = t;
  o.x = a.x + (b.x - a.x) * u;
  o.y = a.y + (b.y - a.y) * u;
  o.z = a.z + (b.z - a.z) * u;
  o.yaw = a.yaw + wrap(b.yaw - a.yaw) * u;
  o.speed = a.speed + (b.speed - a.speed) * u;
  return o;
}

interface Track {
  sender: number;
  id: number;
  kind: FigKind;
  buf: Timed[];
  fig: DrawnFigure | null;
  /** Missing from the holder's batch of this time: goes once that is drawn. */
  endAt: number | null;
  /** The number of the holder's last batch that had him. */
  seen: number;
}

/** A track's key: the holder and his number for the figure (no string per figure per batch). */
const trackKey = (sender: number, id: number) => sender * 0x10000 + (id & 0xffff);

const blankState = (): FigState => ({ id: 0, kind: "thief", motion: "idle", snap: false, carrying: false, x: 0, y: 0, z: 0, yaw: 0, speed: 0 });

export class JobFigs {
  // ---- sending
  private readonly ids = new WeakMap<object, number>();
  private next = 1;
  /** The ids of the last batch sent, in order. */
  private readonly sentIds: number[] = [];
  private acc = 0;
  private emptyLeft = 0;
  // (kept from frame to frame: nothing is made while no batch is due)
  private readonly figs: Array<OwnFigure | null> = [];
  private readonly figIds: number[] = [];
  private readonly figFresh: boolean[] = [];
  private readonly states: FigState[] = [];
  private readonly list: FigState[] = [];
  private readonly look: NetLook = { kind: "thief", x: 0, y: 0, z: 0, yaw: 0, speed: 0, motion: "idle", carrying: false };
  // ---- drawing
  private readonly tracks = new Map<number, Track>();
  private readonly heard = new Map<number, number>();
  private batchNo = 0;
  private readonly sample = { ...blankState(), t: 0 } as Timed;
  readonly meter = { batchesOut: 0, bytesOut: 0, batchesIn: 0, drawn: 0, made: 0, removed: 0 };

  private readonly d: JobFigsDeps;

  constructor(d: JobFigsDeps) {
    this.d = d;
  }

  /** Each frame: send this PC's figures when due; draw the others'. */
  frame(dt: number): void {
    this.send(dt);
    this.draw(dt);
  }

  private send(dt: number): void {
    this.acc += dt;
    // first which figures there are (their ids: a new one is a change), without asking where they are
    let n = 0;
    let changed = false;
    for (const f of this.d.own()) {
      if (n >= FIG_MAX) break;
      let id = this.ids.get(f);
      let fresh = false;
      if (id === undefined) {
        id = this.next;
        this.next = this.next >= 0xfffe ? 1 : this.next + 1;
        this.ids.set(f, id);
        fresh = true;
      }
      this.figs[n] = f;
      this.figIds[n] = id;
      this.figFresh[n] = fresh;
      if (this.sentIds[n] !== id) changed = true;
      n++;
    }
    if (n !== this.sentIds.length) changed = true;
    // (a figure no longer here is not held on to)
    for (let i = n; i < this.figs.length && this.figs[i]; i++) this.figs[i] = null;
    if (!changed) {
      if (!n && this.emptyLeft <= 0) return;
      // (sooner than the walking rate nothing is due, moving or not)
      if (this.acc < 1 / FIG_HZ) return;
    }
    let moving = false;
    const list = this.list;
    list.length = n;
    for (let i = 0; i < n; i++) {
      const l = this.figs[i]!.netLook(this.look);
      if (l.speed > 0) moving = true;
      const s = (this.states[i] ??= blankState());
      s.id = this.figIds[i];
      s.kind = l.kind;
      s.motion = l.motion;
      s.snap = this.figFresh[i];
      s.carrying = l.carrying;
      s.x = l.x;
      s.y = l.y;
      s.z = l.z;
      s.yaw = l.yaw;
      s.speed = l.speed;
      list[i] = s;
    }
    const due = this.acc >= 1 / (moving ? FIG_HZ : STAND_HZ);
    if (!changed && !due) return;
    const b = encodeFigs(this.d.serverNow(), list);
    if (!this.d.sendBinary(b)) return;
    this.acc = 0;
    this.sentIds.length = n;
    for (let i = 0; i < n; i++) this.sentIds[i] = this.figIds[i];
    this.meter.batchesOut++;
    this.meter.bytesOut += b.byteLength;
    if (n) this.emptyLeft = EMPTY_SENDS;
    else if (!changed) this.emptyLeft--;
    else this.emptyLeft = EMPTY_SENDS - 1;
  }

  /** A batch of another player's figures (the server wrote his id in). */
  onBatch(v: DataView, recvNow: number): void {
    const b = decodeFigs(v);
    if (!b || !b.sender) return;
    this.meter.batchesIn++;
    this.heard.set(b.sender, recvNow);
    const no = ++this.batchNo;
    for (const s of b.list) {
      const k = trackKey(b.sender, s.id);
      let tr = this.tracks.get(k);
      if (!tr || tr.kind !== s.kind) {
        if (tr) this.end(k, tr);
        tr = { sender: b.sender, id: s.id, kind: s.kind, buf: [], fig: null, endAt: null, seen: no };
        this.tracks.set(k, tr);
      }
      tr.seen = no;
      const last = tr.buf[tr.buf.length - 1];
      if (last && b.t <= last.t) continue;
      // (the decoded state is this batch's own: it is kept as it is, with its time)
      const st = s as Timed;
      st.t = b.t;
      tr.buf.push(st);
      if (tr.buf.length > 30) tr.buf.splice(0, tr.buf.length - 30);
      tr.endAt = null;
    }
    for (const tr of this.tracks.values()) if (tr.sender === b.sender && tr.seen !== no && tr.endAt === null) tr.endAt = b.t;
  }

  private draw(dt: number): void {
    const now = this.d.serverNow();
    const t = now - FIG_DELAY_MS;
    const me = this.d.player();
    let drawn = 0;
    for (const tr of this.tracks.values()) {
      const heard = this.heard.get(tr.sender) ?? 0;
      if (now - heard > FIG_SILENT_MS || (tr.endAt !== null && t >= tr.endAt)) {
        this.end(trackKey(tr.sender, tr.id), tr);
        continue;
      }
      const s = sampleFig(tr.buf, t, this.sample);
      if (!s) continue;
      // (only the states still needed: the one before the drawn time and after)
      while (tr.buf.length > 2 && tr.buf[1].t <= t) tr.buf.shift();
      const far = Math.hypot(s.x - me.x, s.z - me.z) > FIG_DRAW_R + (tr.fig ? 10 : 0);
      if (far) {
        if (tr.fig) {
          tr.fig.remove();
          tr.fig = null;
          this.meter.removed++;
        }
        continue;
      }
      if (!tr.fig) {
        tr.fig = this.d.make(tr.kind, s.x, s.y, s.z);
        if (!tr.fig) continue;
        this.meter.made++;
      }
      tr.fig.netPlace(s.x, s.y, s.z, s.yaw, s.speed, s.motion, s.carrying);
      tr.fig.update(dt);
      drawn++;
    }
    this.meter.drawn = drawn;
  }

  private end(k: number, tr: Track): void {
    if (tr.fig) {
      tr.fig.remove();
      this.meter.removed++;
    }
    this.tracks.delete(k);
  }

  /** A player went: his figures go at once. */
  dropSender(id: number): void {
    for (const [k, tr] of this.tracks) if (tr.sender === id) this.end(k, tr);
    this.heard.delete(id);
  }

  /** Everything drawn goes (the socket came back: the holders send again). */
  reset(): void {
    for (const [k, tr] of this.tracks) this.end(k, tr);
    this.heard.clear();
    this.sentIds.length = 0;
  }

  /** For the kit and the harness. */
  report() {
    return { ...this.meter, tracks: [...this.tracks.values()].map((tr) => ({ from: tr.sender, id: tr.id, kind: tr.kind, shown: !!tr.fig })) };
  }
}
