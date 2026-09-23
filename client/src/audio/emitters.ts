import CITY from "../../../shared/city.json";

// Where the city's sounds come from. World frame: x along the river (north),
// z inland, the Scheldt at z < 0. Most points come from shared/city.json
// (places, bridges, doors, decor.lamps, water). Cranes and moorings are not in
// the city file; they mirror the lists in world/rijnkaai.ts (keep in step).

export type EmitterKind =
  | "cathedral" // hour bells and the carillon
  | "bridge" // water slapping under the arch
  | "pontoon" // water rippling round a floating stage
  | "smithy" // hammer on anvil, by day
  | "cooper" // mallet on casks, by day
  | "crane" // ratchet, winch and chain, by day
  | "ship" // hull and rope creak, watch bells
  | "pump" // squeaking pump handle
  | "tavern" // muffled singing at night
  | "market" // stall calls by day
  | "lamp"; // gas hiss, only close by and when lit

export interface Emitter {
  kind: EmitterKind;
  x: number;
  z: number;
  /** Height in metres (default by kind). */
  y?: number;
  /** Loudness multiplier (default 1). */
  gain?: number;
  /** Human name for logs. */
  name?: string;
}

type Pt = [number, number];
interface CityData {
  places: Record<string, { x: number; z: number; kind: string }>;
  bridges: Record<string, [number, number, number, number]>;
  bridgeKinds: Record<string, string>;
  doors: Record<string, { x: number; z: number }>;
  decor?: { lamps?: Pt[] };
  water: Array<{ outer: Pt[]; holes: Pt[][] }>;
  area: Pt[];
  landmarks?: Record<string, { fp?: Pt[] }>;
}
const city = CITY as unknown as CityData;

// portal cranes (world/rijnkaai.ts, "cranes")
const CRANES: Pt[] = [
  [-24, 4], [-12, 4], [60, 4], [66, 62], [66, 92], [173, 66], [173, 100], [-280, 4], [-240, 4], [-300, 4],
];

// moored rows (world/rijnkaai.ts, mooreAlong): from, to, and the water they lie towards
const MOORINGS: Array<[number, number, number, number, number, number]> = [
  [-316, 0, -258, 0, 0, -40],
  [-240, 0, -216, 0, 0, -40],
  [-140, 0, -90, 0, 0, -40],
  [60, 0, 100, 0, 0, -40],
  [120, 0, 176, 0, 0, -40],
  [-82, 12, -82, 202, -76, 100],
  [-70, 12, -70, 202, -76, 100],
  [70, 50, 70, 106, 120, 78],
  [170, 50, 170, 106, 120, 78],
  [76, 110, 164, 110, 120, 78],
  [120, 46, 164, 46, 120, 78],
];
// ships at anchor or alone in a basin
const ANCHORED: Pt[] = [[-150, -62], [-40, -48], [110, -44], [-205, -64], [30, -70], [125, 80]];

const place = (name: string): { x: number; z: number } | null => city.places[name] ?? null;

/** Every emitter the city file (and the world lists above) gives. */
export function cityEmitters(): Emitter[] {
  const out: Emitter[] = [];

  // the cathedral tower: the west front, bells some 65 m up
  const cat = place("Cathedral") ?? { x: -262, z: 208 };
  out.push({ kind: "cathedral", x: cat.x, z: cat.z, y: 65, name: "Cathedral of Our Lady" });

  // bridges: water under the arch; the ferry pontoon ripples instead
  for (const [id, [x0, z0, x1, z1]] of Object.entries(city.bridges)) {
    const kind = city.bridgeKinds[id] === "pontoon" ? "pontoon" : "bridge";
    out.push({ kind, x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: -1.2, name: id.replace(/_/g, " ") });
  }
  // the Rijnkaai pier stands in the water too
  out.push({ kind: "pontoon", x: -24, z: -12, y: -1.2, gain: 0.8, name: "Rijnkaai pier" });

  // squares: a pump on each; stalls on the fish market (strong) and the Grote Markt
  for (const [name, p] of Object.entries(city.places)) {
    if (p.kind !== "square") continue;
    out.push({ kind: "pump", x: p.x + 6, z: p.z + 5, y: 1, name: `pump, ${name}` });
  }
  const vis = place("Vismarkt");
  if (vis) out.push({ kind: "market", x: vis.x, z: vis.z + 4, y: 1.6, gain: 1, name: "Vismarkt stalls" });
  const gm = place("Grote Markt");
  if (gm) out.push({ kind: "market", x: gm.x, z: gm.z, y: 1.6, gain: 0.5, name: "Grote Markt stalls" });

  // a smithy near the docks (the Rijnkaai row) and a cooper by the brewers' canal
  out.push({ kind: "smithy", x: 50, z: 46.5, y: 1.2, name: "smithy, Rijnkaai" });
  out.push({ kind: "cooper", x: -92.5, z: 130, y: 1.2, name: "cooper, Canal des Brasseurs" });

  // taverns: street doors near the quays and the squares (singing at night)
  const doss = city.doors.doss;
  out.push({ kind: "tavern", x: -45, z: 46.5, y: 1.4, name: "tavern, Rijnkaai row" });
  if (doss) out.push({ kind: "tavern", x: doss.x - 16, z: doss.z + 0.5, y: 1.4, name: "tavern by the doss house" });
  if (vis) out.push({ kind: "tavern", x: vis.x, z: 49.5, y: 1.4, name: "tavern, Vismarkt" });
  if (gm) out.push({ kind: "tavern", x: -222.5, z: gm.z - 4, y: 1.4, name: "tavern, Grote Markt" });

  // cranes on the quays
  for (const [x, z] of CRANES) out.push({ kind: "crane", x, z, y: 6, name: `crane ${x},${z}` });

  // ships: one point every 22 m along each moored row, a few metres out
  for (const [x0, z0, x1, z1, wx, wz] of MOORINGS) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 22));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const d = Math.hypot(wx - x, wz - z) || 1;
      out.push({ kind: "ship", x: x + ((wx - x) / d) * 4, z: z + ((wz - z) / d) * 4, y: 1, name: "moored boat" });
    }
  }
  for (const [x, z] of ANCHORED) out.push({ kind: "ship", x, z, y: 2, name: "ship at anchor" });

  // gas lamps (the world adds its own quay lamps; the Soundscape drops doubles)
  for (const [x, z] of city.decor?.lamps ?? []) out.push({ kind: "lamp", x, z, y: 3, name: "gas lamp" });

  return out;
}

// ------------------------------------------------------------------ water

const AREA = city.area;
const minX = Math.min(...AREA.map((p) => p[0]));
const maxX = Math.max(...AREA.map((p) => p[0]));
const minZ = Math.min(...AREA.map((p) => p[1]));

/** Quay edges: water outline segments, without the ones on the map border. */
const EDGES: Array<[number, number, number, number]> = [];
for (const w of city.water) {
  for (const ring of [w.outer, ...w.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const onBorder =
        (ax === bx && (ax <= minX || ax >= maxX)) || (az === bz && az <= minZ);
      if (!onBorder) EDGES.push([ax, az, bx, bz]);
    }
  }
}

function inRing(ring: Pt[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Is (x, z) over open water (river, canals, basin)? */
export function overWater(x: number, z: number): boolean {
  return city.water.some((w) => inRing(w.outer, x, z) && !w.holes.some((h) => inRing(h, x, z)));
}

/** Nearest point on a quay edge, and how far it is. */
export function nearestQuay(x: number, z: number): { x: number; z: number; d: number } {
  let best = { x, z: 0, d: Infinity };
  for (const [ax, az, bx, bz] of EDGES) {
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

// ------------------------------------------------------------------ cart routes

/**
 * Streets a horse and cart can be heard on (never seen: the Soundscape keeps
 * them beyond the fog). Waypoints go over the bridges, not through the water.
 */
export function cartRoutes(): Pt[][] {
  const p = (n: string, dx = 0, dz = 0): Pt => {
    const q = place(n);
    return q ? [q.x + dx, q.z + dz] : [0, 0];
  };
  const mid = (id: string): Pt => {
    const b = city.bridges[id];
    return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
  };
  return [
    // along the quays, Werf to the lock and back
    [p("Werf", -20, 6), p("Steenplein"), mid("vliet_mouth"), p("Vismarkt"), mid("canal_mouth"), p("Rijnkaai"), mid("lock_bridge"), [150, 30]],
    // Steenplein up to the Grote Markt and the Handschoenmarkt
    [p("Steenplein"), [-204, 40], [-204, 128], p("Handschoenmarkt"), p("Grote Markt"), [-240, 60], [-204, 40]],
    // the warehouse streets behind the Rijnkaai
    [p("Rijnkaai"), [33, 70], [33, 108], [-4, 108], [-4, 70], [33, 70]],
  ];
}
