// TEMPLATE (docs/building-with-interior.md): copy to shared/<name>Plan.ts and fill in. The prison's is the example
// (shared/prisonPlan.ts). Pure numbers, no three.js: the server, the tests and the client all read it.

import type { HallPlan, Mark, Rect } from "./hallPlan.js";
import type { ShellOpening } from "./shellOpening.js";

// ---- the frame: local x across the front, z into the building, the main door's middle at (0, 0) (as the shell's)
export const ORIGIN = { x: 0, z: 0 } as const; // TODO: from the Blender shell's placement
export const YAW = 0; // TODO
/** The ground floor over the street (the door's threshold). */
export const FLOOR_Y = 0.1;
/** The storeys over the ground floor. */
export const LV = { ground: 0, first: 3.6 } as const;

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

// ---- walking: floors and solids per storey, the stairs (rise 0.18 at most on a 45 degree stair), the doors
const marks: Record<string, Mark> = {
  door: { x: 0, z: -1.5, yaw: Math.PI }, // on the street before the door
  inside: { x: 0, z: 1.5, yaw: 0 },
};
export const PLAN: HallPlan = {
  id: "name" as unknown as HallPlan["id"],
  origin: { x: ORIGIN.x, z: ORIGIN.z },
  yaw: YAW,
  floorY: FLOOR_Y,
  levels: [
    { y: LV.ground, floors: [R(-1.0, 1.0, -1.5, 0.6) /* the step and the doorway */, R(-5, 5, 0.6, 8) /* TODO the rooms */], solids: [] },
    { y: LV.first, floors: [R(-5, 5, 0.6, 8)], solids: [] },
  ],
  stairs: [{ rect: R(3.8, 4.8, 2.0, 5.6), along: "z", foot: 5.6, head: 2.0, lo: 0, hi: 1, y0: LV.ground, y1: LV.first, rise: 0.18 }],
  doors: [
    // its plane at the shell's reveal back; hw half its width (1.2 m wide at least); h its springing over the floor
    { id: "name_door", x: 0, z: 0.3, dir: 1, hw: 0.7, h: 2.2, inner: 0.6, y: 0, leaves: 2, open: (80 * Math.PI) / 180, step: marks.door },
  ],
  // only the building: follow its outline, never a square that takes in a court
  area: [R(-1.2, 1.2, -1.5, 0.7), R(-5.2, 5.2, 0.5, 8.2)],
  steps: [{ rect: R(-1.0, 1.0, -1.5, 0.0), y: -FLOOR_Y }],
  nodes: [[0, -1.2], [0, 1.5], [0, 5]],
  marks,
  sets: {},
};

// ---- the parts of the building (world y): what stands behind each shell opening, and which parts see which
export interface Zone {
  id: string;
  label: string;
  box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  walk: boolean;
  sees: string[];
}
export const ZONES: Zone[] = [
  { id: "hall", label: "the hall", box: { x0: -5, x1: 5, y0: 0, y1: 3.6, z0: -0.2, z1: 8 }, walk: true, sees: ["upstairs"] },
  { id: "upstairs", label: "the room upstairs", box: { x0: -5, x1: 5, y0: 3.6, y1: 7.2, z0: -0.2, z1: 8 }, walk: true, sees: ["hall"] },
];
export function zoneAt(x: number, y: number, z: number): Zone | null {
  return ZONES.find((q) => x >= q.box.x0 && x <= q.box.x1 && y >= q.box.y0 && y <= q.box.y1 && z >= q.box.z0 && z <= q.box.z1) ?? null;
}
/** The zone just behind a shell opening (the check reports an opening with none). */
export function zoneOf(o: ShellOpening): Zone | null {
  const y = o.shape === "round" ? (o.cy ?? (o.yb + o.yt) / 2) : (o.yb + o.yt) / 2;
  return zoneAt(o.x - o.nx * (o.depth + 0.5), y, o.z - o.nz * (o.depth + 0.5));
}
export const sees = (from: string, to: string) => from === to || !!ZONES.find((q) => q.id === from)?.sees.includes(to);

/** The lights by the building's routine (0..1 per part; the client multiplies by the dusk). */
export function nameLights(hour: number): { hall: number; upstairs: number } {
  return { hall: hour >= 7 && hour < 22 ? 1 : 0, upstairs: hour >= 18 && hour < 23 ? 1 : 0 };
}
