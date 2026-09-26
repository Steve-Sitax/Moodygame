// M8a multiplayer (docs/multiplayer-plan.md 4.3): what goes over the movement socket (/mp).
// No imports: the server (node, .ts) and the client (vite) both read this file.
//
// Each client sends its own man 20 times a second as one binary frame (68 bytes); the server sends each
// client one binary batch of the others 20 times a second. Everything else (hello, the roster, pings,
// "pause all", a new version) is JSON text.

/** Bumped when the frames change: a client of another build is sent to download the new version first. */
export const MP_PROTOCOL = 1;
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
  v.setUint8(o + 5, 0);
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

/** JSON messages (text frames). */
export type MpText =
  | { type: "hello"; token?: string; seat?: number; protocol: number; version?: string }
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
