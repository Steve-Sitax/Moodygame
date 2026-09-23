import CITY from "../../../shared/city.json";
import type { Rect } from "./geom";

// Het Steen's courtyard and its ramp (M3i, restored look of 1887-90; tools/city/design.py STEEN):
// the courtyard along the Steen's inland side stands `h` above the promontory; the curved ramp with
// balustrades comes down from the Steenpoort to the ground. The walk map (plan.py) has the
// balustrades as walls, so the only way up is the ramp; this gives the heights (rijnkaai.ts baseAt).

interface RampData {
  h: number;
  half: number;
  /** Centreline from the gate to the foot: x, z, height. */
  line: number[][];
  /** The courtyard (x0, z0, x1, z1), all at h. */
  terrace: number[];
}

const RAMP = (CITY as unknown as { decor?: { steen_ramp?: RampData } }).decor?.steen_ramp ?? null;

/** A box round the courtyard and the ramp: nothing outside it is asked. */
const BOX: Rect | null = (() => {
  if (!RAMP) return null;
  const xs = [...RAMP.line.map((p) => p[0]), RAMP.terrace[0], RAMP.terrace[2]];
  const zs = [...RAMP.line.map((p) => p[1]), RAMP.terrace[1], RAMP.terrace[3]];
  const m = RAMP.half + 0.6;
  return { minX: Math.min(...xs) - m, maxX: Math.max(...xs) + m, minZ: Math.min(...zs) - m, maxZ: Math.max(...zs) + m };
})();

/** Height of the Steen's courtyard or ramp at (x, z), or null if (x, z) is on neither. */
export function steenHeightAt(x: number, z: number): number | null {
  if (!RAMP || !BOX || x < BOX.minX || x > BOX.maxX || z < BOX.minZ || z > BOX.maxZ) return null;
  const t = RAMP.terrace;
  if (x >= t[0] && x <= t[2] && z >= t[1] && z <= t[3]) return RAMP.h;
  // the nearest point of the centreline; within the ramp's width (up to the balustrades) its height
  const L = RAMP.line;
  let best = Infinity;
  let y = 0;
  for (let i = 0; i < L.length - 1; i++) {
    const [ax, az, ay] = L[i];
    const [bx, bz, by] = L[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(ax + dx * k - x, az + dz * k - z);
    if (d < best) {
      best = d;
      y = ay + (by - ay) * k;
    }
  }
  return best <= RAMP.half + 0.35 ? y : null;
}

/** The courtyard and the ramp as boxes, for props and street things to keep off them. */
export function steenKeepOut(): Rect[] {
  if (!RAMP) return [];
  const out: Rect[] = [{ minX: RAMP.terrace[0], maxX: RAMP.terrace[2], minZ: RAMP.terrace[1], maxZ: RAMP.terrace[3] }];
  const r = RAMP.half + 0.8;
  for (let i = 0; i < RAMP.line.length; i += 3) {
    const [x, z] = RAMP.line[i];
    out.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
  }
  return out;
}
