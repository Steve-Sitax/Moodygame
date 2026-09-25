// Which boats may use the lock of the Petit Bassin (Steve 2026-09-24: "Do not send bigger boats or
// combinations through a lock, so they never need to wait until high tide").
//
// The rule: a vessel, or a tow (the tug and everything on its line, with the line between them), is
// sent through the lock only if it fits the chamber with room to spare. It then goes through at any
// tide: the keeper shuts the gates behind it and levels the chamber (world/lock.ts). Anything longer
// or wider never gets a lock trip; it stays in the river or at the quays.
//
// The chamber (world/lock.ts, tools/city/design.py "lock"): walls at x 104 and 116, mitre gates at
// z 7 (river) and z 42 (dock), each leaf hung 0.3 m off the wall, 15 degrees off square when shut,
// pointing to the dock. The river pair opens into the chamber: its leaves swing through the first
// few metres, so a hull must lie clear of that swing before the pair can shut behind it (or open in
// front of it). The dock pair opens toward the dock, so the chamber runs up to its hinges.
//
// No imports: the client (vite) and the server's tests (node) read this file.

export const LOCK_CHAMBER = { minX: 104, maxX: 116, gateRiver: 7, gateDock: 42 } as const;
/** The leaves hang this far off the walls (their heel posts). */
const HINGE_INSET = 0.3;
/** A shut leaf stands this far off square (radians). */
const MITRE = (15 * Math.PI) / 180;
/** A leaf's thickness (lying open along the wall it takes this much of the width). */
export const LEAF_THICK = 0.4;
/** Free water kept at each end of the hull (or tow) in the chamber, metres. */
export const LOCK_MARGIN = 1.0;
/** Free water kept on each side between the hull and the open leaves, metres. */
export const LOCK_SIDE_ROOM = 0.6;
/** The hawser between a tug and its tow, and between tows, as the lock's tows run it (world/lock.ts). */
export const TOW_LINE = 9;

const HALF_W = (LOCK_CHAMBER.maxX - LOCK_CHAMBER.minX) / 2 - HINGE_INSET;
/** A leaf's length, heel post to the mitre. */
export const LEAF_LEN = HALF_W / Math.cos(MITRE);

/** The widest hull the chamber takes (between the open leaves, with room on both sides). */
export const MAX_BEAM = LOCK_CHAMBER.maxX - LOCK_CHAMBER.minX - 2 * (HINGE_INSET + LEAF_THICK) - 2 * LOCK_SIDE_ROOM;

/**
 * Where a hull of this beam (on the middle line) is clear of the river pair's swing: the z beyond
 * which no part of it is within a leaf's reach of either heel post.
 */
export function sweepEnd(beam: number): number {
  const dx = Math.max(0, HALF_W - beam / 2);
  const reach = LEAF_LEN + LEAF_THICK / 2;
  return LOCK_CHAMBER.gateRiver + (dx < reach ? Math.sqrt(reach * reach - dx * dx) : 0);
}

/** The stretch of the chamber (z, river end to dock end) a hull of this beam may lie in, margins kept. */
export function chamberSpan(beam: number): { from: number; to: number; length: number } {
  const from = sweepEnd(beam) + LOCK_MARGIN;
  const to = LOCK_CHAMBER.gateDock - LOCK_MARGIN;
  return { from, to, length: Math.max(0, to - from) };
}

export interface LockPart {
  name: string;
  length: number;
  beam: number;
}

/** Centre of each part behind the leading one, along the route (0 for the lead). */
export function trainOffsets(parts: readonly LockPart[], line = TOW_LINE): number[] {
  const out: number[] = [];
  let off = 0;
  parts.forEach((p, i) => {
    if (i > 0) off += parts[i - 1].length / 2 + line + p.length / 2;
    out.push(off);
  });
  return out;
}

/** Bow of the first to stern of the last, line(s) included. */
export function trainLength(parts: readonly LockPart[], line = TOW_LINE): number {
  if (!parts.length) return 0;
  const offs = trainOffsets(parts, line);
  return parts[0].length / 2 + offs[offs.length - 1] + parts[parts.length - 1].length / 2;
}

export interface LockFit {
  /** "tug + lighter" */
  name: string;
  /** Overall length (hulls and lines), metres. */
  length: number;
  /** The widest hull. */
  beam: number;
  /** The chamber's length for that beam, margins kept. */
  room: number;
  /** Room left over (negative: too long). */
  spare: number;
  fits: boolean;
  /** Why not, in words; empty when it fits. */
  why: string;
}

/** Does this vessel or tow fit the chamber? */
export function lockFit(parts: readonly LockPart[], line = TOW_LINE): LockFit {
  const length = trainLength(parts, line);
  const beam = parts.reduce((m, p) => Math.max(m, p.beam), 0);
  const room = chamberSpan(beam).length;
  const name = parts.map((p) => p.name).join(" + ");
  const why: string[] = [];
  if (beam > MAX_BEAM) why.push(`${beam.toFixed(1)} m wide, the chamber takes ${MAX_BEAM.toFixed(1)} m`);
  if (length > room) why.push(`${length.toFixed(1)} m long, the chamber takes ${room.toFixed(1)} m`);
  return { name, length, beam, room, spare: room - length, fits: why.length === 0, why: why.join("; ") };
}
