// The town's small boats (M7 boats; Steve, 2026-09-26: "More different small boats and we can take any
// of them to use. Only when owner within sight he will be angry. If boat has owner it should say so when
// taking the boat. Like take xxx's boat.").
//
// Nine kinds of small craft of the Antwerp waterfront of 1873, every one of them rowable (their models in
// tools/blender/build_boats.py, boats.glb; the numbers below are the glTF extra "row" of each model, and
// the boat check in the game compares them). Where each lies: tied up with two lines to iron rings in the
// quay's coping stones, beside the foot of a flight of steps, at an iron ladder in the wall, or before the
// boat repair yard on the canal. Who owns it is decided by the server (server/src/rowing.ts), from the
// town's residents by the rule of each mooring: the engine owns that, the client only shows it.
//
// No imports: the client (vite) and the server's tests (node) read this file.

export type SmallKind = "rowboat" | "punt" | "workboat" | "dinghy" | "shipsboat" | "gig" | "bumboat" | "eelboat" | "oldboat";
export const SMALL_KINDS: readonly SmallKind[] = ["rowboat", "punt", "workboat", "dinghy", "shipsboat", "gig", "bumboat", "eelboat", "oldboat"];
export function isSmallKind(s: unknown): s is SmallKind {
  return typeof s === "string" && (SMALL_KINDS as readonly string[]).includes(s);
}

type V3 = [number, number, number];

/** A small boat's hull for rowing, in its own frame (x across, y up from the waterline, z toward the bow). */
export interface SmallHull {
  /** Half the length on the water, and half the beam at the rail (m). */
  half: number;
  beam: number;
  /** The rower's thwart: z along the boat, y over the waterline. */
  seatZ: number;
  seatY: number;
  /** How fast she rows (1 = the waterman's boat). */
  speed: number;
  /** The port rowlock (starboard is its mirror). */
  pin: V3;
  /** Length of the hull. */
  len: number;
  /** Where the bow and stern lines are made fast (the painter's ring at the stem, the stern's). */
  bow: V3;
  stern: V3;
  /** Half the beam over the wales: how far her side stands off a wall she lies against. */
  side: number;
  /** How deep she sits (m below the waterline): she takes the mud when the water is shallower. */
  draft: number;
  /** What the player reads ("take Mie Janssens's punt"). Plain English (docs/08 #8). */
  noun: string;
  /** A lost one (broken and sunk), what the owner wants for it, in centimes (the engine clamps it). */
  lost_c: number;
}

export const HULLS: Record<SmallKind, SmallHull> = {
  rowboat: { half: 2.65, beam: 0.72, seatZ: -0.43, seatY: 0.38, speed: 1, pin: [0.77, 0.62, 0.25], len: 5.4, bow: [0, 0.686, 3.024], stern: [0, 0.606, -2.862], side: 0.8, draft: 0.25, noun: "rowing boat", lost_c: 100 },
  punt: { half: 2.55, beam: 0.64, seatZ: -1.25, seatY: 0.38, speed: 0.9, pin: [0.68, 0.56, -0.6], len: 5.2, bow: [0, 0.53, 3.15], stern: [0, 0.53, -3.05], side: 0.7, draft: 0.2, noun: "punt", lost_c: 70 },
  workboat: { half: 2.94, beam: 0.86, seatZ: -0.84, seatY: 0.368, speed: 0.85, pin: [0.945, 0.58, -0.16], len: 6, bow: [0, 0.67, 3.75], stern: [0, 0.57, -3.4], side: 0.96, draft: 0.25, noun: "work boat", lost_c: 110 },
  dinghy: { half: 2.107, beam: 0.753, seatZ: -0.172, seatY: 0.386, speed: 0.95, pin: [0.798, 0.607, 0.508], len: 4.3, bow: [0, 0.668, 2.408], stern: [0, 0.59, -2.279], side: 0.84, draft: 0.25, noun: "dinghy", lost_c: 90 },
  shipsboat: { half: 3.087, beam: 0.883, seatZ: 0, seatY: 0.442, speed: 1, pin: [0.939, 0.662, 0.68], len: 6.3, bow: [0, 0.741, 3.528], stern: [0, 0.655, -3.339], side: 0.98, draft: 0.3, noun: "ship's boat", lost_c: 120 },
  gig: { half: 3.626, beam: 0.642, seatZ: 0.148, seatY: 0.344, speed: 1.15, pin: [0.686, 0.564, 0.828], len: 7.4, bow: [0, 0.612, 4.144], stern: [0, 0.54, -3.922], side: 0.72, draft: 0.25, noun: "gig", lost_c: 120 },
  bumboat: { half: 2.45, beam: 0.907, seatZ: 0.6, seatY: 0.415, speed: 0.8, pin: [0.808, 0.668, 1.28], len: 5, bow: [0, 0.704, 2.8], stern: [0, 0.622, -2.65], side: 1, draft: 0.3, noun: "bumboat", lost_c: 110 },
  eelboat: { half: 3.038, beam: 0.93, seatZ: -1.24, seatY: 0.379, speed: 0.8, pin: [1.018, 0.584, -0.56], len: 6.2, bow: [0, 0.77, 4], stern: [0, 0.59, -3.55], side: 1.06, draft: 0.25, noun: "eel boat", lost_c: 110 },
  oldboat: { half: 2.4, beam: 0.698, seatZ: -0.294, seatY: 0.386, speed: 0.7, pin: [0.757, 0.606, 0.386], len: 4.9, bow: [0, 0.668, 2.744], stern: [0, 0.59, -2.597], side: 0.78, draft: 0.3, noun: "old boat", lost_c: 60 },
};

/** Who owns the boat at a mooring (the server picks the resident). */
export type OwnerRule =
  /** A resident of one of these trades (in this order), one who works at `place` first. */
  | { kind: "person"; trades: string[]; place?: string; sex?: "m" | "f" }
  /** A named person of the quay (an npc id), and how the prompt names the boat ("the water police's"). */
  | { kind: "npc"; id: string; label: string }
  /** A service: a resident of these trades keeps it, the prompt names the service ("the ferry's"). */
  | { kind: "service"; trades: string[]; place?: string; sex?: "m" | "f"; label: string }
  /** Nobody: an old boat left lying. Taking it is no theft. */
  | { kind: "none" };

export interface Mooring {
  id: string;
  kind: SmallKind;
  /** Middle of the hull on the water, and its heading (yaw about +y; 0 = bow toward +z). */
  x: number;
  z: number;
  yaw: number;
  /** How Jef gets in: from the landing or the steps of a flight, or down an iron ladder in the wall. */
  board: { kind: "steps"; top: [number, number]; at: [number, number] } | { kind: "ladder"; top: [number, number]; n: [number, number]; t: [number, number] };
  /** The two iron rings in the coping stones her bow and stern lines are made fast to (quay top, y 0). */
  rings: [[number, number], [number, number]];
  /** "by the Vismarkt steps": for talk and memory. */
  where: string;
  owner: OwnerRule;
}

type P2 = [number, number];
interface Spec {
  id: string;
  kind: SmallKind;
  /** A point on the quay line (the wall's top edge), the way along the wall (her bow points this way), the water side. */
  wall: P2;
  t: P2;
  n: P2;
  /** Where her middle lies along the wall from `wall` (m). */
  s: number;
  board: { steps: P2 } | { ladder: number };
  where: string;
  owner: OwnerRule;
}

/** A flight of steps (world/rijnkaai.ts FLIGHTS): 13 treads of 0.32 m and a 2.4 m landing, 1.62 m wide. */
const FLIGHT_END = 4.16 + 2.4;

/** A boat lies this far off the wall line (her side, and fenders). */
const OFF_WALL = 0.3;

const SPECS: Spec[] = [
  // --- beside the flights of steps, past the foot of each landing (the steps are the way down)
  { id: "boat:vismarkt_eel", kind: "eelboat", wall: [-110, 0], t: [-1, 0], n: [0, -1], s: FLIGHT_END + 1.3 + 3.1, board: { steps: [-110, 0] }, where: "by the Vismarkt steps", owner: { kind: "person", trades: ["fish_merchant", "fishwife", "mussel_seller"], place: "vismarkt" } },
  { id: "boat:rijnkaai_bum", kind: "bumboat", wall: [-4, 0], t: [-1, 0], n: [0, -1], s: FLIGHT_END + 1.3 + 2.5, board: { steps: [-4, 0] }, where: "by the Rijnkaai steps", owner: { kind: "person", trades: ["market_woman", "fishwife", "shopwife", "mussel_seller"], place: "rijnkaai", sex: "f" } },
  { id: "boat:cartstand_sloep", kind: "shipsboat", wall: [50, 0], t: [1, 0], n: [0, -1], s: FLIGHT_END + 0.5 + 3.15, board: { steps: [50, 0] }, where: "by the steps at the cart stand", owner: { kind: "person", trades: ["sailor"], place: "rijnkaai" } },
  { id: "boat:north_vlet", kind: "workboat", wall: [186, 0], t: [1, 0], n: [0, -1], s: FLIGHT_END + 0.5 + 3.0, board: { steps: [186, 0] }, where: "by the steps north of the lock", owner: { kind: "person", trades: ["docker", "natie", "porter"], place: "bassin" } },
  { id: "boat:canal_jol", kind: "dinghy", wall: [-70, 38], t: [0, 1], n: [-1, 0], s: FLIGHT_END + 0.5 + 2.15, board: { steps: [-70, 38] }, where: "by the canal steps", owner: { kind: "person", trades: ["clerk", "merchant", "chandler", "publican"] } },
  { id: "boat:bassin_punt", kind: "punt", wall: [90, 46], t: [1, 0], n: [0, 1], s: FLIGHT_END + 0.5 + 2.6, board: { steps: [90, 46] }, where: "by the Petit Bassin steps, near the lock", owner: { kind: "person", trades: ["docker", "porter"], place: "bassin" } },
  { id: "boat:bassin_north_sloep", kind: "shipsboat", wall: [116, 110], t: [1, 0], n: [0, -1], s: FLIGHT_END + 0.5 + 3.15, board: { steps: [116, 110] }, where: "by the north steps of the Petit Bassin", owner: { kind: "person", trades: ["sailor"], place: "bassin" } },
  // --- at iron ladders in the wall (the ladder comes down at her thwart)
  { id: "boat:vismarkt_west_vlet", kind: "workboat", wall: [-140, 0], t: [1, 0], n: [0, -1], s: 4, board: { ladder: 4 }, where: "under the Vismarkt quay", owner: { kind: "person", trades: ["porter", "docker", "carter"], place: "vismarkt" } },
  { id: "boat:vismarkt_west_sloep", kind: "shipsboat", wall: [-140, 0], t: [1, 0], n: [0, -1], s: 11.5, board: { ladder: 11.5 }, where: "under the Vismarkt quay", owner: { kind: "person", trades: ["sailor"], place: "werf" } },
  { id: "boat:vismarkt_east_row", kind: "rowboat", wall: [-90, 0], t: [-1, 0], n: [0, -1], s: 4, board: { ladder: 4 }, where: "under the Vismarkt quay, east of the steps", owner: { kind: "person", trades: ["boatman", "fishwife", "fish_merchant"], place: "vismarkt" } },
  { id: "boat:vismarkt_east_jol", kind: "dinghy", wall: [-90, 0], t: [-1, 0], n: [0, -1], s: 11, board: { ladder: 11 }, where: "under the Vismarkt quay, east of the steps", owner: { kind: "person", trades: ["chandler", "clerk", "merchant", "publican"] } },
  { id: "boat:werf_gig", kind: "gig", wall: [-150, -24], t: [0, 1], n: [1, 0], s: 12, board: { ladder: 12 }, where: "under the Werf wall by Het Steen", owner: { kind: "npc", id: "waterschout", label: "the water police's" } },
  { id: "boat:werf_ferry", kind: "rowboat", wall: [-214, -24], t: [0, 1], n: [-1, 0], s: 13, board: { ladder: 13 }, where: "under the west wall of the Werf", owner: { kind: "service", trades: ["porter", "boatman", "docker"], place: "werf", label: "the ferry's" } },
  { id: "boat:pier_jol", kind: "dinghy", wall: [10, 0], t: [1, 0], n: [0, -1], s: 6, board: { ladder: 6 }, where: "by the pier", owner: { kind: "person", trades: ["merchant", "chandler", "clerk", "publican"] } },
  { id: "boat:rijnkaai_old", kind: "oldboat", wall: [-60, 0], t: [-1, 0], n: [0, -1], s: 4, board: { ladder: 4 }, where: "under the Rijnkaai wall", owner: { kind: "none" } },
  { id: "boat:canal_west_vlet", kind: "workboat", wall: [-82, 90], t: [0, 1], n: [1, 0], s: 10, board: { ladder: 10 }, where: "at the west canal quay", owner: { kind: "person", trades: ["carter", "docker", "porter"], place: "canal" } },
  { id: "boat:canal_wash_punt", kind: "punt", wall: [-70, 122], t: [0, 1], n: [-1, 0], s: 6, board: { ladder: 6 }, where: "at the canal quay, below the washing place", owner: { kind: "person", trades: ["laundress"], place: "canal", sex: "f" } },
  { id: "boat:yard_old", kind: "oldboat", wall: [-70, 160], t: [0, 1], n: [-1, 0], s: 5, board: { ladder: 5 }, where: "before the boat repair yard", owner: { kind: "none" } },
  { id: "boat:yard_rowboat", kind: "rowboat", wall: [-70, 160], t: [0, 1], n: [-1, 0], s: 13, board: { ladder: 13 }, where: "before the boat repair yard", owner: { kind: "person", trades: ["boatman", "sailor", "docker"], place: "canal" } },
  { id: "boat:bassin_bum", kind: "bumboat", wall: [70, 50], t: [0, 1], n: [1, 0], s: 12, board: { ladder: 12 }, where: "under the west quay of the Petit Bassin", owner: { kind: "person", trades: ["shopwife", "market_woman", "fishwife"], sex: "f" } },
  { id: "boat:bassin_south_jol", kind: "dinghy", wall: [132, 46], t: [1, 0], n: [0, 1], s: 6, board: { ladder: 6 }, where: "under the south quay of the Petit Bassin", owner: { kind: "person", trades: ["merchant", "clerk", "chandler", "sailor"] } },
];

const r2 = (v: number) => Math.round(v * 100) / 100;

function build(sp: Spec): Mooring {
  const h = HULLS[sp.kind];
  const [wx, wz] = sp.wall;
  const [tx, tz] = sp.t;
  const [nx, nz] = sp.n;
  const at = (s: number, off: number): P2 => [r2(wx + tx * s + nx * off), r2(wz + tz * s + nz * off)];
  // a ladder comes down at her thwart: her middle lies seatZ back from it
  const mid = "ladder" in sp.board ? sp.board.ladder - h.seatZ : sp.s;
  const [x, z] = at(mid, h.side + OFF_WALL);
  const bowS = mid + h.bow[2];
  const sternS = mid + h.stern[2];
  // a boat past the foot of a flight: `wall` is the top of that flight, "at" the far end of its landing
  const board: Mooring["board"] =
    "ladder" in sp.board
      ? { kind: "ladder", top: at(sp.board.ladder, 0), n: [nx, nz], t: [tx, tz] }
      : { kind: "steps", top: sp.board.steps, at: at(FLIGHT_END - 0.5, 0.8) };
  return {
    id: sp.id,
    kind: sp.kind,
    x,
    z,
    yaw: +Math.atan2(tx, tz).toFixed(4),
    board,
    rings: [at(bowS + 0.6, -0.55), at(sternS - 0.6, -0.55)], // in the coping stones, half a metre in from the edge
    where: sp.where,
    owner: sp.owner,
  };
}

/** A mooring's hull on the ground plan: the rectangle the moored rows of barges keep clear of (with room round it). */
export function mooringRect(m: Mooring, pad = 1.2): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const h = HULLS[m.kind];
  const hl = h.len / 2 + pad;
  const hb = h.side + pad;
  const s = Math.abs(Math.sin(m.yaw));
  const c = Math.abs(Math.cos(m.yaw));
  return { minX: m.x - s * hl - c * hb, maxX: m.x + s * hl + c * hb, minZ: m.z - c * hl - s * hb, maxZ: m.z + c * hl + s * hb };
}

/**
 * The Canal des Brasseurs and the Vliet are lined with small boats (they were the moored rows of M3f):
 * one after another along the walls where the rows lay (the bridges and the steps kept clear), each at an
 * iron ladder of her own, so every one can be got into. Kinds and owners follow a fixed round, so the
 * same boats lie in the same places in every game (their owners come from the town: rowing.ts).
 */
const ROWS: Array<{ wall: P2; t: P2; n: P2; len: number; where: string }> = [
  { wall: [-82, 12], t: [0, 1], n: [1, 0], len: 52, where: "along the west wall of the canal" },
  { wall: [-82, 76], t: [0, 1], n: [1, 0], len: 72, where: "along the west wall of the canal" },
  { wall: [-82, 160], t: [0, 1], n: [1, 0], len: 42, where: "at the head of the canal, west side" },
  { wall: [-70, 12], t: [0, 1], n: [-1, 0], len: 23, where: "along the east wall of the canal" },
  { wall: [-70, 47], t: [0, 1], n: [-1, 0], len: 17, where: "along the east wall of the canal" },
  { wall: [-70, 76], t: [0, 1], n: [-1, 0], len: 72, where: "along the east wall of the canal" },
  { wall: [-70, 160], t: [0, 1], n: [-1, 0], len: 42, where: "at the head of the canal, east side" },
  { wall: [-150, 11], t: [0, 1], n: [1, 0], len: 27, where: "in the Vliet, under the west wall" },
  { wall: [-142, 49], t: [0, 1], n: [-1, 0], len: 21, where: "in the Vliet, under the east wall" },
];
/** The round of kinds along a row, and who keeps each kind in the canal quarter. */
const ROUND: SmallKind[] = ["punt", "rowboat", "workboat", "dinghy", "punt", "eelboat", "rowboat", "oldboat", "punt", "bumboat"];
const ROW_OWNER: Record<SmallKind, OwnerRule> = {
  rowboat: { kind: "person", trades: ["boatman", "carter", "docker", "sailor"], place: "canal" },
  punt: { kind: "person", trades: ["laundress", "carter", "market_woman"], place: "canal" },
  workboat: { kind: "person", trades: ["carter", "docker", "porter"], place: "canal" },
  dinghy: { kind: "person", trades: ["clerk", "merchant", "chandler", "publican"] },
  shipsboat: { kind: "person", trades: ["sailor"] },
  gig: { kind: "npc", id: "waterschout", label: "the water police's" },
  bumboat: { kind: "person", trades: ["market_woman", "shopwife", "fishwife"], sex: "f" },
  eelboat: { kind: "person", trades: ["fish_merchant", "fishwife", "mussel_seller"], place: "vismarkt" },
  oldboat: { kind: "none" },
};
/** Free water between two boats in a row, and at the ends of a row (m). */
const ROW_GAP = 2.2;

function rowSpecs(taken: Mooring[]): Spec[] {
  const out: Spec[] = [];
  const clear = (m: Mooring) => taken.every((q) => {
    const a = mooringRect(m, 0.6);
    const b = mooringRect(q, 0.6);
    return a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ;
  });
  let k = 0;
  ROWS.forEach((row, ri) => {
    let s = ROW_GAP;
    let i = 0;
    for (let tries = 0; tries < 40; tries++) {
      const kind = ROUND[(k + tries) % ROUND.length];
      const h = HULLS[kind];
      if (s + h.len + ROW_GAP > row.len) break;
      // the ladder at her thwart; her stern toward the start of the row
      const mid = s + h.len / 2;
      const sp: Spec = { id: `boat:row${ri}_${i}`, kind, wall: row.wall, t: row.t, n: row.n, s: mid, board: { ladder: +(mid + h.seatZ).toFixed(2) }, where: row.where, owner: ROW_OWNER[kind] };
      const m = build(sp);
      if (clear(m)) {
        out.push(sp);
        taken.push(m);
        i++;
        k = (k + tries + 1) % ROUND.length;
        tries = -1;
        s += h.len + ROW_GAP;
      } else s += 1;
    }
  });
  return out;
}

const PLACED = SPECS.map(build);

/** Every small boat's mooring. The three older moorings of M3j (rowing.ts LOOSE) are not in here. */
export const MOORINGS: readonly Mooring[] = [...PLACED, ...rowSpecs([...PLACED]).map(build)];

/** A point of the boat (its own frame: x across, z toward the bow) on the ground plan. */
export function boatPoint(x: number, z: number, yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

/** "Mie Janssens" -> "Mie Janssens's" (the prompt: "take Mie Janssens's punt"). */
export function possessive(name: string): string {
  return `${name}'s`;
}
