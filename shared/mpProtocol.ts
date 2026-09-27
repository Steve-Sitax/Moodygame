// M8a multiplayer (docs/multiplayer-plan.md 4.3): what goes over the movement socket (/mp).
// No imports: the server (node, .ts) and the client (vite) both read this file.
//
// Each client sends its own man 20 times a second as one binary frame (68 bytes); the server sends each
// client one binary batch of the others 20 times a second. Everything else (hello, the roster, pings,
// "pause all", a new version) is JSON text.

/** Bumped when the frames change: a client of another build is sent to download the new version first. */
export const MP_PROTOCOL = 2;
/** Own state sent this often (and the batches of the others). */
export const SEND_HZ = 20;
export const SEND_MS = 1000 / SEND_HZ;

/** What the man is doing (picks the animation and the speed limit). */
export const MODES = ["walk", "crouch", "swim", "climb", "ladder", "ride", "bike", "row", "fly", "sit"] as const;
export type MpMode = (typeof MODES)[number];

/** One-off and lasting flags. */
export const FLAG = {
  /** Left the ground this frame (a jump). */
  jumped: 1,
  /** Came down this frame. */
  landed: 2,
  /** On the ground (not in a jump or a fall). */
  grounded: 4,
  /** Shift held: hurrying. */
  hurry: 8,
  /** The menu is up or the window lost the mouse: he stands there, "away". */
  away: 16,
  /** A move that is not a path (a place, a ladder, a seat): no in-between. */
  snap: 32,
  /** A step was taken this frame (a footstep sound at his feet). */
  step: 64,
  /** A lit lantern in his hand. */
  lantern: 128,
} as const;

/**
 * A platform he stands on, as a number: the kind in the high byte, which one in the low byte (0: the
 * ground). Positions are then also sent in its own frame (lx, ly, lz, lyaw), and the receiver puts him on
 * its own copy of it (plan 4.4).
 */
export const BASE = { none: 0, omnibus: 1 } as const;
/**
 * M8b: what he rows, rides or pushes (0: nothing): the others draw it with him and hide their own copy of the
 * nearest one of that kind (net/mp/together.ts). Sent in the byte after `base` (it was always 0 before).
 */
export const GEAR = { none: 0, rowboat: 1, velo: 2, handcart: 3 } as const;
export const baseId = (kind: number, index: number): number => ((kind & 0xff) << 8) | (index & 0xff);
export const baseKind = (id: number): number => (id >> 8) & 0xff;
export const baseIndex = (id: number): number => id & 0xff;

export interface MpState {
  seq: number;
  /** When it was true, on the server's clock (ms): the sender's own time plus its measured offset. */
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  mode: number;
  flags: number;
  base: number;
  /** M8b: GEAR (optional on the way in: 0). */
  gear?: number;
  lx: number;
  ly: number;
  lz: number;
  lyaw: number;
}

export const STATE_BYTES = 68;
export const MSG_STATE = 1;
export const MSG_BATCH = 2;

const F32 = ["x", "y", "z", "vx", "vy", "vz", "yaw", "pitch", "lx", "ly", "lz", "lyaw"] as const;

/** Write the body of a state (everything but the leading type byte and id) at `o`: 64 bytes. */
function writeBody(v: DataView, o: number, s: MpState): number {
  v.setUint8(o, s.mode & 0xff);
  v.setUint16(o + 1, s.flags & 0xffff, true);
  v.setUint16(o + 3, s.base & 0xffff, true);
  v.setUint8(o + 5, (s.gear ?? 0) & 0xff);
  v.setUint32(o + 6, s.seq >>> 0, true);
  v.setFloat64(o + 10, s.t, true);
  let p = o + 18;
  for (const k of F32) {
    v.setFloat32(p, s[k], true);
    p += 4;
  }
  return p - o; // 66
}

function readBody(v: DataView, o: number): MpState {
  const s = {
    mode: v.getUint8(o),
    flags: v.getUint16(o + 1, true),
    base: v.getUint16(o + 3, true),
    gear: v.getUint8(o + 5),
    seq: v.getUint32(o + 6, true),
    t: v.getFloat64(o + 10, true),
  } as MpState;
  let p = o + 18;
  for (const k of F32) {
    s[k] = v.getFloat32(p, true);
    p += 4;
  }
  return s;
}

const BODY = 66;

/** Client to server: own state. */
export function encodeState(s: MpState): ArrayBuffer {
  const b = new ArrayBuffer(STATE_BYTES);
  const v = new DataView(b);
  v.setUint8(0, MSG_STATE);
  v.setUint8(1, 0);
  writeBody(v, 2, s);
  return b;
}

/** Null when it is not a well-formed state frame (or holds a number that is not finite). */
export function decodeState(buf: ArrayBuffer | ArrayBufferView): MpState | null {
  const v = buf instanceof ArrayBuffer ? new DataView(buf) : new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.byteLength !== STATE_BYTES || v.getUint8(0) !== MSG_STATE) return null;
  const s = readBody(v, 2);
  if (s.mode >= MODES.length) return null;
  for (const k of F32) if (!Number.isFinite(s[k])) return null;
  if (!Number.isFinite(s.t)) return null;
  return s;
}

/** Server to client: the others' states, and the server's time when it was sent. */
export function encodeBatch(serverNow: number, list: Array<{ id: number; s: MpState }>): ArrayBuffer {
  const n = Math.min(255, list.length);
  const b = new ArrayBuffer(10 + n * (2 + BODY));
  const v = new DataView(b);
  v.setUint8(0, MSG_BATCH);
  v.setUint8(1, n);
  v.setFloat64(2, serverNow, true);
  let o = 10;
  for (let i = 0; i < n; i++) {
    v.setUint16(o, list[i].id, true);
    writeBody(v, o + 2, list[i].s);
    o += 2 + BODY;
  }
  return b;
}

export function decodeBatch(buf: ArrayBuffer | ArrayBufferView): { serverNow: number; list: Array<{ id: number; s: MpState }> } | null {
  const v = buf instanceof ArrayBuffer ? new DataView(buf) : new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.byteLength < 10 || v.getUint8(0) !== MSG_BATCH) return null;
  const n = v.getUint8(1);
  if (v.byteLength !== 10 + n * (2 + BODY)) return null;
  const list: Array<{ id: number; s: MpState }> = [];
  let o = 10;
  for (let i = 0; i < n; i++) {
    list.push({ id: v.getUint16(o, true), s: readBody(v, o + 2) });
    o += 2 + BODY;
  }
  return { serverNow: v.getFloat64(2, true), list };
}

// ------------------------------------------------------------------ speed limits (the server's plausibility check)

/**
 * The fastest a man may go in each mode (m/s, flat), from the walk code (client/src/player/firstPerson.ts):
 * hurry 3.4, swim fast 1.6, ladder 0.9, the velocipede about 5.8, a boat about 3, the omnibus about 7.
 * The server allows a quarter more and a little slack for a frame that came late.
 */
export const MAX_SPEED: Record<MpMode, number> = {
  walk: 3.4,
  crouch: 1.0,
  swim: 1.6,
  climb: 1.2,
  ladder: 1.0,
  ride: 8.0,
  bike: 6.0,
  row: 3.2,
  fly: 3.4,
  sit: 8.0,
};

// ------------------------------------------------------------------ M8b: the townspeople (plan 5.2, choice C)
//
// Each townsperson near a player is walked by one PC, the owner (the host near the host: only he can talk and
// work until M8c; else the first player near). The owner sends each one's state 10 times a second as one
// binary batch; the others draw them from it (net/mp/street.ts). The server knows the owner of each person and
// passes the batches on; it reads nothing in an entry but the person's number (the first two bytes).
//
// The numbers are the server's: a resident's id (a string) gets a small number the first time anyone claims
// him, sent with the owners (MpText "owners").

export const MSG_PUPPETS = 3;
/** Townspeople sent this often by their owner. */
export const PUPPET_HZ = 10;
/** One person in a puppet batch (net/mp/street.ts writes and reads the fields after the number). */
export const PUPPET_BYTES = 24;
/** At most this many in one batch (the socket takes 4 KB frames). */
export const PUPPET_MAX = 150;

/** A batch of townspeople: type, count, the time it was true (server clock, ms), then the entries. */
export function puppetBatchOk(v: DataView): boolean {
  if (v.byteLength < 10 || v.getUint8(0) !== MSG_PUPPETS) return false;
  const n = v.getUint8(1);
  return n <= PUPPET_MAX && v.byteLength === 10 + n * PUPPET_BYTES && Number.isFinite(v.getFloat64(2, true));
}
/** The person numbers in a batch. */
export function puppetNums(v: DataView): number[] {
  const n = v.getUint8(1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(v.getUint16(10 + i * PUPPET_BYTES, true));
  return out;
}
/** The batch with only the entries at these indexes (the ones the sender owns), the same time. */
export function puppetKeep(v: DataView, keep: number[]): ArrayBuffer {
  const out = new ArrayBuffer(10 + keep.length * PUPPET_BYTES);
  const o = new Uint8Array(out);
  const src = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  o.set(src.subarray(0, 10), 0);
  o[1] = keep.length;
  keep.forEach((i, k) => o.set(src.subarray(10 + i * PUPPET_BYTES, 10 + (i + 1) * PUPPET_BYTES), 10 + k * PUPPET_BYTES));
  return out;
}

/**
 * The motions a townsperson may play, in the order of their number in a batch (client game/humans.ts takes its
 * list from here; the town map on the server names them with it).
 */
export const PUPPET_MOTIONS = ["idle", "walk", "talk", "fold", "carry", "sit", "behind", "lean", "write", "ride", "row", "push", "scrub", "lace", "cross", "point", "beg", "call", "crouch", "hop", "rope", "grind", "pull", "wash", "wall", "pockets", "smoke"] as const;
const PUPPET_BOUGHT = [null, "parcel", "fish", "sack", "basket"] as const;
const PUPPET_CART = [undefined, "goods", "fish", "furniture", "chests", "sacks"] as const;

/** What a townsperson rides, pushes or leads (client game/crowd.ts PuppetVehicle has the same shape). */
export type PuppetGear = { kind: "velo" } | { kind: "cart"; items: number; what?: "goods" | "fish" | "furniture" | "chests" | "sacks" } | { kind: "dray"; loaded: boolean };

/** One townsperson in a batch, as the owner had him at `t` (server ms). */
export interface PuppetState {
  t: number;
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  motion: (typeof PUPPET_MOTIONS)[number];
  sit: boolean;
  lantern: boolean;
  sack: boolean;
  /** A jump of place (a door, a take-over far off): no in-between. */
  snap: boolean;
  size: number;
  bought: (typeof PUPPET_BOUGHT)[number];
  veh: PuppetGear | null;
}

const Q_YAW = 65536 / (Math.PI * 2);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * An entry (24 bytes): number u16, x f32, z f32, yaw u16 (a full turn in 65536), vx and vz i16 (cm/s), the
 * motion u8, flags u8 (sit 1, lantern 2, sack 4, snap 8), size u8 (0.8 + n/500), bought u8, the vehicle's kind
 * u8 (velo 1, cart 2, dray 3), its load u8 (the cart's items, the dray loaded), the cart's goods u8, one spare.
 */
export function encodePuppets(t: number, list: Array<{ num: number; s: PuppetState }>): ArrayBuffer {
  const n = Math.min(PUPPET_MAX, list.length);
  const b = new ArrayBuffer(10 + n * PUPPET_BYTES);
  const v = new DataView(b);
  v.setUint8(0, MSG_PUPPETS);
  v.setUint8(1, n);
  v.setFloat64(2, t, true);
  for (let i = 0; i < n; i++) {
    const { num, s } = list[i];
    const o = 10 + i * PUPPET_BYTES;
    v.setUint16(o, num, true);
    v.setFloat32(o + 2, s.x, true);
    v.setFloat32(o + 6, s.z, true);
    v.setUint16(o + 10, Math.round((((s.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * Q_YAW) & 0xffff, true);
    v.setInt16(o + 12, Math.max(-32767, Math.min(32767, Math.round(s.vx * 100))), true);
    v.setInt16(o + 14, Math.max(-32767, Math.min(32767, Math.round(s.vz * 100))), true);
    v.setUint8(o + 16, Math.max(0, PUPPET_MOTIONS.indexOf(s.motion)));
    v.setUint8(o + 17, (s.sit ? 1 : 0) | (s.lantern ? 2 : 0) | (s.sack ? 4 : 0) | (s.snap ? 8 : 0));
    v.setUint8(o + 18, Math.max(0, Math.min(255, Math.round((s.size - 0.8) * 500))));
    v.setUint8(o + 19, Math.max(0, PUPPET_BOUGHT.indexOf(s.bought)));
    const veh = s.veh;
    v.setUint8(o + 20, veh ? (veh.kind === "velo" ? 1 : veh.kind === "cart" ? 2 : 3) : 0);
    v.setUint8(o + 21, veh?.kind === "cart" ? Math.min(255, veh.items) : veh?.kind === "dray" ? (veh.loaded ? 1 : 0) : 0);
    v.setUint8(o + 22, veh?.kind === "cart" ? Math.max(0, PUPPET_CART.indexOf(veh.what)) : 0);
    v.setUint8(o + 23, 0);
  }
  return b;
}

export function decodePuppets(v: DataView): { t: number; list: Array<{ num: number; s: PuppetState }> } | null {
  if (!puppetBatchOk(v)) return null;
  const n = v.getUint8(1);
  const t = v.getFloat64(2, true);
  const list: Array<{ num: number; s: PuppetState }> = [];
  for (let i = 0; i < n; i++) {
    const o = 10 + i * PUPPET_BYTES;
    const x = v.getFloat32(o + 2, true);
    const z = v.getFloat32(o + 6, true);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const f = v.getUint8(o + 17);
    const vk = v.getUint8(o + 20);
    const vd = v.getUint8(o + 21);
    const veh: PuppetGear | null =
      vk === 1 ? { kind: "velo" } : vk === 2 ? { kind: "cart", items: vd, what: PUPPET_CART[v.getUint8(o + 22)] ?? undefined } : vk === 3 ? { kind: "dray", loaded: vd === 1 } : null;
    list.push({
      num: v.getUint16(o, true),
      s: {
        t,
        x,
        z,
        yaw: wrapAngle(v.getUint16(o + 10, true) / Q_YAW),
        vx: v.getInt16(o + 12, true) / 100,
        vz: v.getInt16(o + 14, true) / 100,
        motion: PUPPET_MOTIONS[v.getUint8(o + 16)] ?? "idle",
        sit: (f & 1) !== 0,
        lantern: (f & 2) !== 0,
        sack: (f & 4) !== 0,
        snap: (f & 8) !== 0,
        size: 0.8 + v.getUint8(o + 18) / 500,
        bought: PUPPET_BOUGHT[v.getUint8(o + 19)] ?? null,
        veh,
      },
    });
  }
  return { t, list };
}

// ------------------------------------------------------------------ M8b: the moving world (plan 4.6, 5.2)
//
// The omnibuses, the river traffic, the bridges, the lock, the goods train, the cranes, the rail gate and the
// drays are run by one PC, the world PC (the host's, while his tab draws; else the lowest player id whose tab
// draws), and sent 10 times a second as JSON ("world"); the others show them from it (net/mp/world.ts) and
// take over from the last state if the world PC changes.

export const WORLD_HZ = 10;

/** JSON messages (text frames). */
export type MpText =
  | { type: "hello"; token?: string; seat?: number; protocol: number; version?: string }
  // M8b: townspeople: ask to walk these (steal: the host takes them from a guest near him), let them go; the
  // server's answer to all: who walks whom (full: the whole list, else changes; owner 0: nobody)
  | { type: "claim"; ids: string[]; steal?: boolean }
  | { type: "release"; ids: string[] }
  | { type: "owners"; full?: boolean; list: Array<[num: number, id: string, owner: number]> }
  // M8b: the moving world: its state from the world PC (t: server ms when it was true), and who the world PC is
  | { type: "world"; t: number; d: Record<string, unknown> }
  | { type: "worldpc"; id: number }
  | { type: "ping"; c: number }
  | { type: "pong"; c: number; s: number }
  | { type: "welcome"; id: number; host: boolean; name: string; pose: { x: number; y: number; z: number; yaw: number } | null; serverNow: number; protocol: number }
  | { type: "roster"; players: RosterEntry[] }
  | { type: "went"; id: number; name: string }
  | { type: "pause_all"; on: boolean }
  | { type: "version"; version: string; files: number; bytes: number }
  | { type: "old"; protocol: number }
  | { type: "refused"; why: string }
  | { type: "kicked" };

export interface RosterEntry {
  id: number;
  name: string;
  /** The look (shared/character.ts appearanceCode). */
  code: string;
  host: boolean;
  admin: boolean;
  away: boolean;
  online: boolean;
}
