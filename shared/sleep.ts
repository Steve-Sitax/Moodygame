// M7 sleep (Steve 2026-09-26: "'go lie down' text at night has got to go. We can sleep any time we want
// in a bed of a rented house and must be able to choose how long. We can also sleep on benches, just
// worse sleep gain, and also warmth goes to 1."). ONE place for what the server and the client both need:
// the chooser's lengths and the town's public benches with their ids. The engine's numbers (sleep per
// hour, the caps, the cold) are the server's (server/src/rest.ts). No imports but types and data that
// node and vite both read. See docs/milestones/M7-sleep.md.

/** The chooser's lengths in whole hours; "morning" is until the next 6:00. */
export const SLEEP_HOURS = [1, 2, 4, 8] as const;
/** "Until morning": the hour he wakes. */
export const MORNING_HOUR = 6;

/** Where Jef may lie down: his own rented bed, the doss house bed (paid by the week), a bench. */
export type RestKind = "home" | "doss" | "bench" | "cell";
// ("cell": M8d played together, the night in the police cell sits out at the world's pace like a sleep; never chosen)

/** A bench in town, as both sides name it. `fine`: a fine square or the park, where the police move sleepers on at night. */
export interface Bench {
  id: string;
  label: string;
  x: number;
  z: number;
  /** The seat's ground (the wall walk's benches stand 6.5 m up). */
  y: number;
  fine: boolean;
}

/** The two benches on the Steen's promontory, [x, z, yaw] (world/steenlife.ts draws them). */
export const STEEN_BENCHES: Array<[number, number, number]> = [
  [-203, -27.5, Math.atan2(-230 - -203, -60 - -27.5)],
  [-209.5, -8.5, -Math.PI / 2],
];

/** A bench by a house door (world/clutter.ts puts them down as it dresses the streets): its id from where it stands. */
export function doorBenchId(x: number, z: number): string {
  return `door:${x.toFixed(1)},${z.toFixed(1)}`;
}
/** The place a door bench's id names, or null. */
export function doorBenchAt(id: string): { x: number; z: number } | null {
  const m = /^door:(-?\d{1,4}(?:\.\d)?),(-?\d{1,4}(?:\.\d)?)$/.exec(id);
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

type P2 = [number, number];
interface Sources {
  /** shared/townplaces.json */
  townplaces: { rond: { label: string; benches: Array<[number, number, number]> }; greens: Array<{ id: string; label: string; benches: Array<[number, number, number]> }> };
  /** shared/omnibusLines.ts STOPS */
  stops: Array<{ id: string; name: string; line: string; bench?: [number, number, number] }>;
  /** client/public/models/park.json `benches`: four corners each (the Stadspark). */
  park?: P2[][];
  /** The wall walk's benches (wall.glb's dressing: world/rampart.ts). */
  wall?: Array<{ x: number; z: number; y: number }>;
}

/** Squares where a sleeper on a bench is moved on by the police at night. */
const FINE_GREENS = new Set(["lijnwaadmarkt"]);

/**
 * The town's public benches with fixed places, each with its id: the Sint-Jansplein, the greens, the
 * omnibus stops (a bench shared by two lines' bays counts once), the Steen, the Stadspark and the wall
 * walk. The benches by house doors are not here: they are named by where they stand (doorBenchId).
 */
export function fixedBenches(s: Sources): Bench[] {
  const out: Bench[] = [];
  s.townplaces.rond.benches.forEach(([x, z], i) => out.push({ id: `rond:${i}`, label: `a bench on ${s.townplaces.rond.label}`, x, z, y: 0, fine: true }));
  for (const g of s.townplaces.greens)
    g.benches.forEach(([x, z], i) => out.push({ id: `green:${g.id}:${i}`, label: `a bench on ${g.label}`, x, z, y: 0, fine: FINE_GREENS.has(g.id) }));
  for (const st of s.stops) {
    if (!st.bench) continue;
    const [x, z] = st.bench;
    if (out.some((b) => b.id.startsWith("stop:") && Math.hypot(b.x - x, b.z - z) < 0.3)) continue;
    out.push({ id: `stop:${st.id}:${st.line}`, label: `the bench at the ${st.name.replace(/^the /, "")} stop`, x, z, y: 0, fine: false });
  }
  STEEN_BENCHES.forEach(([x, z], i) => out.push({ id: `steen:${i}`, label: "a bench on the Steen's promontory", x, z, y: 0, fine: false }));
  (s.park ?? []).forEach((r, i) => {
    const x = r.reduce((a, p) => a + p[0], 0) / r.length;
    const z = r.reduce((a, p) => a + p[1], 0) / r.length;
    out.push({ id: `park:${i}`, label: "a bench in the Stadspark", x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000, y: 0, fine: true });
  });
  (s.wall ?? []).forEach((b, i) => out.push({ id: `wall:${i}`, label: "a bench on the wall walk", x: b.x, z: b.z, y: b.y, fine: false }));
  return out;
}
