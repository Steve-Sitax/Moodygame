import BUILD from "../../../shared/city_build.json";
import YARDS from "../../../shared/city_yard_windows.json";

// The windows cut into the backs of the houses on the yards and courts (yard windows, Steve 2026-09-26):
// tools/blender/build_city.py yard_run cuts them, the sash YARD_R (0.12 m) back in the wall, and lists them in
// shared/city_yard_windows.json: by house index, [wall, s_mid, width, y0, y1] (the glass), with a sixth 1 when
// the window is boarded up; wall the index in the house's ring (a rect house 0 front, 1 right, 2 back, 3 left;
// else the footprint's edge from fp[wall]), s from that wall's first corner.
//   - yardPanes: the lit panes for world/ambient.ts (which draws them and gives them to world/spill.ts like every
//     lit window): a back room's lamp, its own hours, not the front rooms'. Not the boarded ones.
//   - yardWindowColumn: is a point on a back wall's line under or over one of its windows (clutter.ts: a
//     downpipe does not run down over a window).

interface YardHouse {
  rect?: boolean;
  fp: number[][];
  o: number[];
  u: number[];
  n: number[];
  s: number[];
  t: number[];
  seed: number;
  store?: unknown;
  gone?: boolean;
}

export type YardLit = [number, number, number, number];

export interface YardPane {
  hi: number;
  /** The glass's middle on the wall's face, its outward normal and the wall's direction. */
  x: number;
  z: number;
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  /** The lit part of the glass: its width, foot and head. */
  w: number;
  y0: number;
  y1: number;
  /** In the ground storey (a kitchen's lamp), else upstairs. */
  down: boolean;
  lit: YardLit;
  tone: number;
  /** The panes of one room on one wall light together (spill.ts). */
  group: string;
}

/** How far in front of the wall's face the lit pane lies (< 0: in the reveal, just before the sash YARD_R back). */
export const YARD_PANE_OFF = -0.095;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ring and the outward normals of a house as build_city.py builds it (rect_house c / outs, poly_house fp). */
function ring(h: YardHouse): { c: number[][]; outs: number[][] } {
  if (h.rect) {
    const [ox, oz] = h.o;
    const [ux, uz] = h.u;
    const [nx, nz] = h.n;
    const [s0, s1] = h.s;
    const [t0, t1] = h.t;
    const P = (s: number, t: number) => [ox + ux * s + nx * t, oz + uz * s + nz * t];
    return { c: [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)], outs: [[-nx, -nz], [ux, uz], [nx, nz], [-ux, -uz]] };
  }
  const c = h.fp;
  const n = c.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += c[i][0] * c[(i + 1) % n][1] - c[(i + 1) % n][0] * c[i][1];
  const outs = c.map((a, i) => {
    const b = c[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const o = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
    return area < 0 ? [-o[0], -o[1]] : o;
  });
  return { c, outs };
}

/** Every yard window on its wall: where its glass's middle is, the wall's frame, the list's row. */
function* windows(houses: YardHouse[], yards: Record<string, number[][]>) {
  for (const [key, wins] of Object.entries(yards)) {
    const hi = Number(key);
    const h = houses[hi];
    if (!h || h.gone || !wins.length) continue;
    const { c, outs } = ring(h);
    for (const row of wins) {
      const [wi, sm] = row;
      const a = c[wi];
      const b = c[(wi + 1) % c.length];
      if (!a || !b) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ux = (b[0] - a[0]) / L;
      const uz = (b[1] - a[1]) / L;
      yield { hi, h, row, x: a[0] + ux * sm, z: a[1] + uz * sm, ox: outs[wi][0], oz: outs[wi][1], ux, uz };
    }
  }
}

/**
 * The lit panes of the yard windows. `litFor` is ambient.ts's (a room's evening and morning hours); `skip`:
 * houses whose rooms light themselves (in the world). GROUND_H: the ground storey's height (3.8 m), STOREY_H 3 m.
 */
export function yardPanes(
  houses: YardHouse[],
  yards: Record<string, number[][]> | null | undefined,
  litFor: (r: () => number, kind: "ground" | "upper" | "attic", store: boolean) => YardLit,
  skip: (hi: number) => boolean = () => false,
  GROUND_H = 3.8,
  STOREY_H = 3.0,
): YardPane[] {
  const out: YardPane[] = [];
  if (!yards) return out;
  // (the back rooms' own dice, per house: not the front rooms' draws)
  const dice = new Map<number, { r: () => number; tone: number; lits: Map<number, YardLit> }>();
  for (const p of windows(houses, yards)) {
    const [wi, , w, y0, y1, boarded] = p.row;
    if (boarded || skip(p.hi)) continue;
    let d = dice.get(p.hi);
    if (!d) {
      const r = rng(p.h.seed * 7 + 1874);
      dice.set(p.hi, (d = { r, tone: r(), lits: new Map() }));
    }
    const down = y0 < GROUND_H - 0.5;
    const k = down ? -1 : Math.max(0, Math.floor((y0 - GROUND_H) / STOREY_H));
    let lit = d.lits.get(k);
    if (!lit) d.lits.set(k, (lit = litFor(d.r, down ? "ground" : "upper", !!p.h.store)));
    if (lit[0] >= 99 && lit[2] >= 99) continue;
    out.push({ hi: p.hi, x: p.x, z: p.z, ox: p.ox, oz: p.oz, ux: p.ux, uz: p.uz, w: w * 0.82, y0: y0 + 0.06, y1: y1 - 0.06, down, lit, tone: d.tone, group: `${p.hi}:y${wi}:${k}` });
  }
  return out;
}

let columns: Map<string, Array<[number, number, number, number, number, number, number]>> | null = null;

/**
 * Is (x, z), on or just off a back wall on a yard, under or over one of its windows: within the window's
 * width (with its painted shutters and sill) and `pad` more? (clutter.ts: no downpipe down over a window.)
 */
export function yardWindowColumn(x: number, z: number, pad = 0.25): boolean {
  if (!columns) {
    columns = new Map();
    for (const p of windows(BUILD.houses as unknown as YardHouse[], YARDS.houses as Record<string, number[][]>)) {
      // (half the glass, its painted shutters, its sill's ends)
      const hw = p.row[2] * (0.5 + 6 / 28) + 0.1;
      const k = `${Math.floor(p.x / 4)},${Math.floor(p.z / 4)}`;
      let l = columns.get(k);
      if (!l) columns.set(k, (l = []));
      l.push([p.x, p.z, p.ux, p.uz, p.ox, p.oz, hw]);
    }
  }
  const gx = Math.floor(x / 4);
  const gz = Math.floor(z / 4);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      for (const [wx, wz, ux, uz, ox, oz, hw] of columns.get(`${gx + dx},${gz + dz}`) ?? []) {
        const along = (x - wx) * ux + (z - wz) * uz;
        const out = (x - wx) * ox + (z - wz) * oz;
        if (Math.abs(along) < hw + pad && out > -0.3 && out < 0.8) return true;
      }
  return false;
}
