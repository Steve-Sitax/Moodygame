// The horse omnibus network (M3g, M7 omnibus routes): the lines, their rounds, the stops and the
// timetable. ONE place for them: the client drives the omnibuses along these rounds
// (client/src/world/omnibus.ts), the server takes the fares and tells the timetable
// (server/src/ride.ts), and the lanes that props and parked carts keep off are made from the same
// rounds (omnibus.ts omnibusKeepOut, server/src/town/possessions.ts LANES).
// No imports: the server (node, .ts) and the client (vite) both read this file.
//
// Research (reference only, docs/milestones/M7-omnibus-routes.md): Antwerp's first horse tram ran
// from 25 May 1873 from the Meir out to Berchem; horse omnibuses had run between the harbour and the
// town since the 1830s, and later an omnibus line ran from the Grote Markt. The game keeps omnibuses
// (no rails) and gives the lines the town's own names.
//
// Three lines, each a one-way round (corners rounded with a 5 m radius), each with its colour:
//   KAAIEN (green, 1 omnibus): along the quays, the Werf to the Petit Bassin and back.
//   GROTE MARKT (red, 3): the Vismarkt, the Vleeshuis, the Grote Markt, out by the gate road to the
//     Sint-Jorispoort, along the wall street, back past the Stadspark and the cathedral's south side,
//     the Handschoenmarkt (the cathedral), the Meir, the Brouwersvliet.
//   KEIZERSPOORT (blue, 2, M7): the Meir, Sint-Jacob, the Kipdorppoort, along the wall street (the
//     Ramparts) to the Keizerspoort, down the Keizerstraat (the long angled street) past Sint-Paulus,
//     over the high canal bridge to the Conscienceplein, and into the Meir again.
// Where two lines share a street they run the same way on the same lane (the Meir, x -145, z 158 to
// 208); where a line runs a street both ways it keeps its own lane each way (keep right).

export type P = [number, number];
export type RGB = [number, number, number];

export interface LineDef {
  id: string;
  /** What the destination board says (a name: Dutch is fine). */
  board: string;
  /** The side boards: the line's stops. */
  sideBoard: string;
  /** In plain English. */
  name: string;
  /** Paint (0..1). */
  colour: RGB;
  /** Corner points of the round, in the way it runs (rounded with a 5 m radius). */
  route: P[];
  buses: number;
  /** The stop the timetable runs from: the omnibuses leave it at the timetable's times, and stand there at night. */
  terminus: string;
}

/** The round along the quays. Checked on the walk map: all open ground. */
export const QUAY_ROUTE: P[] = [
  [-305, 29.5], [-305, 8.3], [-158, 8.3], [-152, 7.6], [-140, 7.6], [-134, 8.3], [-90, 8.3], [-84, 7.8], [-68, 7.8],
  [-62, 8.3], [66, 8.3], [76, 15], [76, 37], [-54, 37], [-58, 33], [-58, 12], [-62, 8.3], [-204, 8.3], [-204, 29.5],
  // (M3i: the Steen stands on the promontory again, restored as in 1890; the round turns inland over the Steenplein)
];

/**
 * The Grote Markt ring (a one-way loop; at least 2.0 m from the lane's middle to any wall all round,
 * every corner rounded). In the two-way stretches it keeps its own lane: the canal quay (south at
 * x -89.5, north at x -84.5), the wide street west of the Vleeshuis (x -149 and -145), the street into
 * the Handschoenmarkt (west at z 126.2, east at z 129.8), and (M7) the Handschoenmarkt's west end
 * (out at z 132, back at z 139; along the street south of the cathedral out at x -307.8, back at x -304.5). M7: from the Grote Markt it goes out by the gate road (z 150) to the
 * Sint-Jorispoort, along the wall street (x -355 to -361), through the lane at z 247 and back along
 * the cathedral's south side (x -304.5), past the Stadspark's corner.
 */
export const TOWN_ROUTE: P[] = [
  [-84.5, 20], [-96, 20], [-96, 38], [-89.5, 45], [-89.5, 114], [-149, 114], [-149, 126.2], [-238, 126.2], [-238, 70],
  [-280, 70], [-280, 132], [-307.8, 132], [-307.8, 150.5], [-356.5, 149.8], [-361, 214], [-358, 249], [-304.5, 245.5], [-304.5, 139],
  [-275, 139], [-265, 129.8], [-145, 129.8], [-145, 208.5], [-84.5, 208.5],
];

/**
 * M7: the Keizerspoort round. The Meir (x -145, shared with the Grote Markt line up to z 208.5, the
 * same way), the wall street at z 344 to 349 (the gate houses and the wall's stairs 2 m or more off
 * the body), the Keizerstraat from the Keizerspoort down to the canal, the high bridge (it waits
 * while the bridge is open), the lane to the Conscienceplein and back into the Meir.
 */
export const KEIZER_ROUTE: P[] = [
  [-148, 159], [-145, 175], [-145, 344.5], [-102, 344.5], [-98, 347], [-60, 349], [19, 344], [63, 342.5], [60, 290], [40, 245.5],
  [-19.5, 197], [-60, 168], [-68.5, 152], [-84, 154], [-89.5, 146.5], [-98, 147], [-118, 155], [-129, 156.5], [-136, 159],
];

export const LINES: LineDef[] = [
  {
    id: "kaaien",
    board: "KAAIEN",
    sideBoard: "WERF  ·  STEENPLEIN  ·  VISMARKT  ·  RIJNKAAI  ·  PETIT BASSIN",
    name: "the quay line",
    colour: [0.4, 0.52, 0.42],
    route: QUAY_ROUTE,
    buses: 1,
    terminus: "werf",
  },
  {
    id: "markt",
    board: "GROTE MARKT",
    sideBoard: "VISMARKT  ·  GROTE MARKT  ·  ST-JORISPOORT  ·  STADSPARK  ·  MEIR",
    name: "the Grote Markt line",
    colour: [0.62, 0.26, 0.2],
    route: TOWN_ROUTE,
    buses: 3,
    terminus: "vismarkt",
  },
  {
    id: "keizer",
    board: "KEIZERSPOORT",
    sideBoard: "MEIR  ·  KIPDORPPOORT  ·  KEIZERSPOORT  ·  ST-PAULUS  ·  CONSCIENCEPLEIN",
    name: "the Keizerspoort line",
    colour: [0.26, 0.34, 0.56],
    route: KEIZER_ROUTE,
    buses: 2,
    terminus: "keizerspoort",
  },
];

export interface OmnibusStop {
  /** The stop (the server's name for it, server/src/ride.ts). Lines that meet share it. */
  id: string;
  name: string;
  /** The line this bay is for. */
  line: string;
  x: number;
  z: number;
  /** Where the post stands (bays of two lines at one spot share the post). */
  post: P;
  /** M7: a bench by the post, [x, z, yaw] (it faces the lane), where there is room. */
  bench?: [number, number, number];
}

/** The stop bays, one per line and stop. Posts and benches: 2.8 m or more from any house door, off the lanes. */
export const STOPS: OmnibusStop[] = [
  { id: "werf", name: "the Werf", line: "kaaien", x: -270, z: 8.3, post: [-270, 10.4], bench: [-271.9, 10.85, Math.PI] },
  { id: "steenplein", name: "the Steenplein", line: "kaaien", x: -180, z: 8.3, post: [-180, 10.4], bench: [-181.9, 10.85, Math.PI] },
  { id: "vismarkt", name: "the Vismarkt", line: "kaaien", x: -112, z: 8.3, post: [-112, 10.4], bench: [-110.1, 10.85, Math.PI] },
  { id: "rijnkaai", name: "the Rijnkaai", line: "kaaien", x: 30, z: 8.3, post: [30, 10.4], bench: [28.1, 10.85, Math.PI] },
  { id: "bassin", name: "the Petit Bassin", line: "kaaien", x: 76, z: 31, post: [78.3, 31], bench: [78.5, 29.1, -Math.PI / 2] },
  { id: "rijnkaai_back", name: "the Rijnkaai", line: "kaaien", x: 0, z: 37, post: [0, 39.3], bench: [1.9, 39.75, Math.PI] },
  { id: "vismarkt", name: "the Vismarkt", line: "markt", x: -96, z: 31, post: [-98.3, 31], bench: [-98.75, 29.1, Math.PI / 2] },
  { id: "vleeshuis", name: "the Vleeshuis", line: "markt", x: -118, z: 114, post: [-118, 111.6], bench: [-119.9, 111.15, 0] }, // (west of the post: east of it the bench stood before the Vleeshuis's north door, the prop check)
  // the post beside the town hall door's line, not on it (fixes 2026-09-25: Jef walking in bumped into it)
  { id: "grote_markt", name: "the Grote Markt", line: "markt", x: -257, z: 70, post: [-252, 67.6], bench: [-249.69, 67.41, -1.123] },
  // M7: out by the gate road to the Sint-Jorispoort, back past the Stadspark
  { id: "sint_jorispoort", name: "the Sint-Jorispoort", line: "markt", x: -335.9, z: 150, post: [-335.9, 152.3], bench: [-334, 152.75, Math.PI] },
  { id: "stadspark", name: "the Stadspark", line: "markt", x: -304.5, z: 228, post: [-307.4, 228], bench: [-307.85, 229.9, Math.PI / 2] },
  { id: "cathedral", name: "the Cathedral", line: "markt", x: -248, z: 129.8, post: [-248, 132.3], bench: [-249.9, 132.75, Math.PI] },
  { id: "meir", name: "the road to the Meir", line: "markt", x: -145, z: 198, post: [-141.6, 198], bench: [-141.15, 196.1, -Math.PI / 2] },
  { id: "brouwersvliet", name: "the Brouwersvliet", line: "markt", x: -84.5, z: 180, post: [-87, 176], bench: [-87.24, 177.52, 0.559] },
  // M7: the Keizerspoort line (the Meir bay is the Grote Markt line's: one post, both plates)
  { id: "meir", name: "the road to the Meir", line: "keizer", x: -145, z: 198, post: [-141.6, 198] },
  { id: "sint_jacob", name: "Sint-Jacob", line: "keizer", x: -145, z: 293.1, post: [-147.3, 293.1], bench: [-147.5, 291.2, Math.PI / 2] },
  { id: "kipdorppoort", name: "the Kipdorppoort", line: "keizer", x: -145, z: 326.1, post: [-147.3, 326.1], bench: [-147.75, 324.2, Math.PI / 2] },
  { id: "ramparts", name: "the Ramparts", line: "keizer", x: -90.1, z: 347.4, post: [-90.2, 349.7], bench: [-92.12, 350.05, 3.098] },
  { id: "keizerspoort", name: "the Keizerspoort", line: "keizer", x: 62, z: 330, post: [64.3, 329.9], bench: [64.84, 331.78, -1.527] },
  { id: "sint_paulus", name: "Sint-Paulus", line: "keizer", x: 47.8, z: 262.8, post: [49.9, 261.9] },
  { id: "keizerstraat", name: "the Keizerstraat", line: "keizer", x: -43.4, z: 180.3, post: [-42.1, 178.4] },
  { id: "conscienceplein", name: "the Conscienceplein", line: "keizer", x: -123.5, z: 155.75, post: [-123.2, 158.6], bench: [-121.26, 158.82, -3.012] },
];

/** The lines that call at a stop. */
export function linesAt(stop: string): LineDef[] {
  return LINES.filter((l) => STOPS.some((s) => s.id === stop && s.line === l.id));
}

// ------------------------------------------------------------------ the round as a path

export interface LoopPath {
  /** Points every STEP metres along the round (corners rounded). */
  x: Float32Array;
  z: Float32Array;
  length: number;
}
export const LOOP_STEP = 0.25;

/** The round through its corners, each rounded with `radius` (less on short sides), as points every LOOP_STEP metres. */
export function loopPath(corners: P[], radius = 5): LoopPath {
  const pts: P[] = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const p = corners[i];
    const a = corners[(i + n - 1) % n];
    const b = corners[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(radius, la / 2.2, lb / 2.2);
    const s: P = [p[0] + ((a[0] - p[0]) / la) * r, p[1] + ((a[1] - p[1]) / la) * r];
    const e: P = [p[0] + ((b[0] - p[0]) / lb) * r, p[1] + ((b[1] - p[1]) / lb) * r];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push([(1 - t) * (1 - t) * s[0] + 2 * (1 - t) * t * p[0] + t * t * e[0], (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * p[1] + t * t * e[1]]);
    }
  }
  pts.push(pts[0]);
  const xs: number[] = [];
  const zs: number[] = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    let d = carry;
    while (d < L) {
      xs.push(ax + ((bx - ax) * d) / L);
      zs.push(az + ((bz - az) * d) / L);
      d += LOOP_STEP;
    }
    carry = d - L;
  }
  return { x: Float32Array.from(xs), z: Float32Array.from(zs), length: xs.length * LOOP_STEP };
}

/** Every arc position where the path passes within r of (x, z) (once per pass). */
export function passes(p: LoopPath, x: number, z: number, r: number): number[] {
  const out: number[] = [];
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < p.x.length; i++) {
    const d = Math.hypot(p.x[i] - x, p.z[i] - z);
    if (d < r) {
      if (d < bd) {
        bd = d;
        best = i;
      }
    } else if (best >= 0) {
      out.push(best * LOOP_STEP);
      best = -1;
      bd = Infinity;
    }
  }
  if (best >= 0) out.push(best * LOOP_STEP);
  return out;
}

// ------------------------------------------------------------------ the timetable (the engine's numbers)

/** The first and the last departure from each line's terminus (minutes of the day): 6:00 to 22:00. */
export const SERVICE_FIRST = 6 * 60;
export const SERVICE_LAST = 22 * 60;
/** Planned pace for the timetable: metres a real second on the move, and real seconds at each stop. */
export const PLAN_SPEED = 2.5;
export const PLAN_STOP_S = 9;
/** Real seconds per game minute (shared/clock.ts REAL_S_PER_GAME_MIN; repeated here to keep this file free of imports). */
const REAL_S_PER_MIN = 2;

export interface LineTiming {
  line: string;
  /** Planned game minutes once round. */
  roundMin: number;
  /** Game minutes between departures from the terminus (the round shared by the line's omnibuses, in whole 5 minutes). */
  headwayMin: number;
  terminus: string;
  /** Planned game minutes from the terminus to each stop (its first call on the round). */
  offsetMin: Record<string, number>;
  /** Round length in metres. */
  length: number;
}

const timings = new Map<string, LineTiming>();

/** The line's planned timing (made once from its round). */
export function lineTiming(lineId: string): LineTiming {
  const got = timings.get(lineId);
  if (got) return got;
  const line = LINES.find((l) => l.id === lineId);
  if (!line) throw new Error(`no line ${lineId}`);
  const path = loopPath(line.route, 5);
  const calls: Array<{ s: number; id: string }> = [];
  for (const st of STOPS) if (st.line === lineId) for (const s of passes(path, st.x, st.z, 1.5)) calls.push({ s, id: st.id });
  calls.sort((a, b) => a.s - b.s);
  const t0 = calls.find((c) => c.id === line.terminus)?.s ?? 0;
  const wrap = (s: number) => ((s % path.length) + path.length) % path.length;
  const ordered = calls.map((c) => ({ ...c, d: wrap(c.s - t0) })).sort((a, b) => a.d - b.d);
  const offsetMin: Record<string, number> = {};
  ordered.forEach((c, i) => {
    if (c.id in offsetMin) return;
    offsetMin[c.id] = Math.round((c.d / PLAN_SPEED + i * PLAN_STOP_S) / REAL_S_PER_MIN);
  });
  const roundMin = Math.round((path.length / PLAN_SPEED + ordered.length * PLAN_STOP_S) / REAL_S_PER_MIN);
  const headwayMin = Math.max(10, Math.ceil(roundMin / line.buses / 5) * 5);
  const t: LineTiming = { line: lineId, roundMin, headwayMin, terminus: line.terminus, offsetMin, length: Math.round(path.length) };
  timings.set(lineId, t);
  return t;
}

/** Game minutes since day 1, 0:00. */
export function absMinute(day: number, hour: number, minute = 0): number {
  return (day - 1) * 1440 + hour * 60 + minute;
}

/** The departures from the terminus: the first one at or after `abs` (absolute game minutes). */
export function nextSlot(lineId: string, abs: number): number {
  const { headwayMin } = lineTiming(lineId);
  const day = Math.floor(abs / 1440);
  const m = abs - day * 1440;
  if (m <= SERVICE_FIRST) return day * 1440 + SERVICE_FIRST;
  const k = Math.ceil((m - SERVICE_FIRST) / headwayMin);
  const t = SERVICE_FIRST + k * headwayMin;
  return t <= SERVICE_LAST ? day * 1440 + t : (day + 1) * 1440 + SERVICE_FIRST;
}

/** The next `n` times (absolute game minutes) an omnibus of the line is due at the stop, from `abs` on. */
export function departures(lineId: string, stopId: string, abs: number, n = 3): number[] {
  const t = lineTiming(lineId);
  const off = t.offsetMin[stopId];
  if (off === undefined) return [];
  const out: number[] = [];
  let slot = nextSlot(lineId, abs - off);
  while (out.length < n) {
    out.push(slot + off);
    slot = nextSlot(lineId, slot + 1);
  }
  return out;
}

/** Does the line run at this stop now: from its first omnibus due there to an hour after its last. */
export function inService(lineId: string, stopId: string, abs: number): boolean {
  const off = lineTiming(lineId).offsetMin[stopId] ?? 0;
  const m = (((abs - off) % 1440) + 1440) % 1440;
  return m >= SERVICE_FIRST - 5 && m <= SERVICE_LAST + 60;
}

/** "13:05" for absolute game minutes. */
export function clockText(abs: number): string {
  const m = ((Math.round(abs) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
