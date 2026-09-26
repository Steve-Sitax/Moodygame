// Where a bill may be pasted (M7 posters, Steve 2026-09-26: "posters are also over windows and even a
// poster over a passage where we can walk through ... more variation depending on where in city they are").
// Read by the server (the spots for the AI's bills: server/src/ideas/posters.ts) and the client (the
// town's own bills: client/src/world/posters.ts; the check: client/src/dev/postercheck.ts). Pure numbers
// from shared/city_build.json and shared/city.json, no three.js.
//
//   - the house walls as tools/blender/build_streetlife.py city_slots() lists them: kind 0 a street front
//     (a door in its middle bay, a shop window in every other bay of the ground storey), kind 1 a blind wall
//     open to the air (no windows: build_city.py paints it with the plain wall cell), party walls left out;
//   - where the ground storey of a front has its openings (a copy of client/src/world/cityTextures.ts
//     facadeOpenings: build_city.py's 3 m bays), and the covered passages (poorts) through the houses;
//   - the part of town a wall is in: the quays, the fine squares, the poor lanes, by a church, by the prison
//     or the police: what is pasted there and how much.
// The client's check tests every spot against the houses as built (the geometry), so the numbers here only
// need to be right enough to pick; nothing goes up that the check has not passed.

export interface BuildHouse {
  rect: boolean;
  fp: number[][];
  o: number[];
  u: number[];
  n: number[];
  s: number[];
  t: number[];
  h: number;
  st: number;
  style: string;
  seed: number;
  street: number[];
  store?: string;
  alley?: boolean;
  gone?: boolean;
  poort?: { s: [number, number]; h: number };
  roof?: string;
  /** The back alleys (tools/city/alleys.py): a back wall on a yard, built with windows and no door. */
  yard?: number[];
}

export interface BuildData {
  houses: BuildHouse[];
  landmarks: Record<string, { fp: number[][] }>;
  ground_h?: number;
  storey_h?: number;
}

/** A house wall open to the street or the air. s runs from a (0) to b (L); (ox, oz) points out of the house. */
export interface PosterWall {
  id: number;
  house: number;
  ax: number;
  az: number;
  tx: number;
  tz: number;
  ox: number;
  oz: number;
  L: number;
  H: number;
  kind: 0 | 1;
  /** 0 brick, 1 plaster, 2 grey plaster, 3 dark brick (build_streetlife.py STY). */
  style: number;
  /** Where the front door's middle is along the wall (m), or -1. */
  door: number;
  store: boolean;
  alley: boolean;
  /** A covered passage's mouth on this wall (m along it), or null. */
  poort: [number, number] | null;
  /**
   * Its windows as build_city.py lays them out: "front" the 3 m bays (a street front, and a back wall on a
   * yard, whose painted windows street life once took for a blind wall), "cottage" an alley cottage's own
   * columns, "none" a blind wall.
   */
  windows: "front" | "cottage" | "none";
  /** A tavern or home whose inside stands in the world (its own doors and signs): no bills. */
  inWorld: boolean;
}

export interface Opening {
  what: "window" | "door" | "upper window" | "passage";
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}

export const GROUND_H = 3.8;
export const STOREY_H = 3.0;

/** The AI's bills (server ideas/posters.ts, client game/ideas.ts): the sheet's size and the height of its middle. */
export const AI_BILL = { w: 0.56, h: 0.78, y: 1.62 } as const;

const STY: Record<string, number> = { brick: 0, plaster: 1, plaster_grey: 2, brick_dark: 3 };

function pointIn(poly: number[][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** The house walls a bill could go on, as build_streetlife.py city_slots() finds them. `inWorld`: house indices with an inside in the world. */
export function houseWalls(data: BuildData, inWorld: number[] = []): PosterWall[] {
  const iw = new Set(inWorld);
  const houses = data.houses;
  const polys = [...houses.map((h) => h.fp), ...Object.values(data.landmarks ?? {}).map((l) => l.fp)];
  const boxes = polys.map((p) => {
    const xs = p.map((q) => q[0]);
    const zs = p.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  });
  const grid = new Map<string, number[]>();
  boxes.forEach((bb, i) => {
    for (let gx = Math.floor(bb[0] / 10); gx <= Math.floor(bb[2] / 10); gx++)
      for (let gz = Math.floor(bb[1] / 10); gz <= Math.floor(bb[3] / 10); gz++) {
        const k = `${gx},${gz}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(i);
      }
  });
  const covered = (x: number, z: number, own: number): boolean => {
    for (const i of grid.get(`${Math.floor(x / 10)},${Math.floor(z / 10)}`) ?? []) {
      if (i === own || (i < houses.length && houses[i].gone)) continue;
      const b = boxes[i];
      if (b[0] <= x && x <= b[2] && b[1] <= z && z <= b[3] && pointIn(polys[i], x, z)) return true;
    }
    return false;
  };
  const out: PosterWall[] = [];
  houses.forEach((h, hi) => {
    if (h.gone) return;
    let c: number[][];
    let outs: number[][];
    let doorI: number;
    if (h.rect) {
      const [ox, oz] = h.o;
      const [ux, uz] = h.u;
      const [nx, nz] = h.n;
      const [s0, s1] = h.s;
      const [t0, t1] = h.t;
      const P = (s: number, t: number) => [ox + ux * s + nx * t, oz + uz * s + nz * t];
      c = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
      outs = [[-nx, -nz], [ux, uz], [nx, nz], [-ux, -uz]];
      doorI = h.street[0] ? 0 : -1;
    } else {
      c = h.fp;
      const n = c.length;
      let area = 0;
      for (let i = 0; i < n; i++) area += c[i][0] * c[(i + 1) % n][1] - c[(i + 1) % n][0] * c[i][1];
      outs = [];
      for (let i = 0; i < n; i++) {
        const a = c[i];
        const b = c[(i + 1) % n];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const L = Math.hypot(dx, dz) || 1;
        let o = [dz / L, -dx / L];
        if (area < 0) o = [-o[0], -o[1]];
        outs.push(o);
      }
      const lens = c.map((a, i) => Math.hypot(c[(i + 1) % n][0] - a[0], c[(i + 1) % n][1] - a[1]) * (h.street[i] ?? 0));
      doorI = lens.indexOf(Math.max(...lens));
      if (lens[doorI] <= 2) doorI = -1;
    }
    const n = c.length;
    for (let i = 0; i < n; i++) {
      const a = c[i];
      const b = c[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1.2) continue;
      const o = outs[i];
      let kind: 0 | 1;
      const yard = !!(h.yard && h.yard[i]); // (a ring house too: build_city.py builds its yard walls with windows)
      if (h.street[i]) kind = 0;
      else {
        let hits = 0;
        for (const f of [0.2, 0.5, 0.8]) hits += covered(a[0] + (b[0] - a[0]) * f + o[0] * 0.4, a[1] + (b[1] - a[1]) * f + o[1] * 0.4, hi) ? 1 : 0;
        if (hits || L < 2.5) continue;
        kind = 1;
      }
      let door = -1;
      if (i === doorI) {
        const bays = Math.max(1, roundHalfEven(L / 3));
        door = ((Math.floor(bays / 2) + 0.5) / bays) * L;
      }
      // a poort's mouths: on the front (wall 0) and the back (wall 2) of a rect house
      let poort: [number, number] | null = null;
      if (h.poort && h.rect && (i === 0 || i === 2)) {
        const [p0, p1] = h.poort.s;
        const s0 = h.s[0];
        poort = i === 0 ? [p0 - s0, p1 - s0] : [L - (p1 - s0), L - (p0 - s0)];
      }
      const cottage = !!h.alley && h.roof === "side" && !iw.has(hi) && h.rect;
      const windows: PosterWall["windows"] = cottage && (h.street[i] || yard) ? "cottage" : h.street[i] || yard ? "front" : "none";
      out.push({
        id: out.length,
        house: hi,
        ax: a[0],
        az: a[1],
        tx: (b[0] - a[0]) / L,
        tz: (b[1] - a[1]) / L,
        ox: o[0],
        oz: o[1],
        L,
        H: h.h,
        kind,
        style: STY[h.style] ?? 0,
        door,
        store: !!h.store,
        alley: !!h.alley,
        poort,
        windows,
        inWorld: iw.has(hi),
      });
    }
  });
  return out;
}

/**
 * The openings of a wall's lower storeys: for a street front the doorway and the shop windows (a copy of
 * cityTextures.ts facadeOpenings, build_city.py's 3 m bays) and the upper windows; on any wall the mouth
 * of a covered passage. A bill keeps `pad` metres off each.
 */
export function wallOpenings(w: PosterWall, gh = GROUND_H, sh = STOREY_H): Opening[] {
  const out: Opening[] = [];
  const C = 64;
  if (w.windows === "front") {
    const L = w.L;
    const bays = Math.max(1, roundHalfEven(L / 3));
    const bw = L / bays;
    const px = (p: number) => p / C;
    const doorBay = w.door >= 0 ? Math.floor(bays / 2) : -1;
    const ghH = Math.min(gh, w.H);
    for (let k = 0; k < bays; k++) {
      const b = k * bw;
      if (k === doorBay) {
        // (a house front of 6.5 m or more may have a carriage gate there instead: 2.5 m wide between jambs of 0.3)
        const half = Math.min(bw / 2, Math.max(L >= 6.5 && !w.store ? 1.6 : 1.0, px(14) * bw));
        out.push({ what: "door", s0: b + bw / 2 - half, s1: b + bw / 2 + half, y0: 0, y1: Math.min(ghH, 3.45) });
      } else {
        out.push({ what: "window", s0: b + px(9) * bw, s1: b + px(55) * bw, y0: gh * (1 - px(55)), y1: Math.min(ghH, gh * (1 - px(10))) });
      }
    }
    // a storehouse front: a loading gate every 9 m (build_city.py gate_spec: 2.7 m and jambs of 0.3), a door
    // in the middle if it is free
    if (w.store && w.door >= 0) {
      for (let k = 4.5; k < L - 3; k += 9) out.push({ what: "door", s0: k - 1.75, s1: k + 1.75, y0: 0, y1: 3.6 });
      out.push({ what: "door", s0: w.door - 1.1, s1: w.door + 1.1, y0: 0, y1: 3.45 });
    }
    const shut = w.style === 1 || w.style === 2;
    for (let y = gh; y < w.H - 0.05; y += sh) {
      const y0 = y + sh * px(64 - 55);
      const y1 = Math.min(w.H, y + sh * (1 - px(8)));
      if (y1 <= y0) break;
      for (let k = 0; k < bays; k++) {
        const b = k * bw;
        out.push({ what: "upper window", s0: b + px(shut ? 12 : 18) * bw, s1: b + px(shut ? 52 : 46) * bw, y0, y1 });
      }
    }
  } else if (w.windows === "cottage") {
    // build_city.py cottage_wall: window columns in the spans the door leaves free, at least 0.45 m of wall
    // between; the ground row 1.0 .. 2.3 m, the upper rows higher (a bill never reaches them)
    const WIN_H = 1.3;
    const shut = w.style === 1 || w.style === 2;
    const pxs = (s: boolean): [number, number] => (s ? [12, 52] : shut ? [19, 45] : [18, 46]);
    const wwid = (s: boolean) => { const [a, b] = pxs(s); return (WIN_H * (b - a)) / 47; };
    const L = w.L;
    let spans: Array<[number, number]> = [[0.22, L - 0.22]];
    if (w.door >= 0) {
      const dl = w.door - 0.45 - 0.12 - 0.15;
      const dr = w.door + 0.45 + 0.12 + 0.15;
      spans = [[0.22, dl], [dr, L - 0.22]];
      out.push({ what: "door", s0: w.door - 0.45 - 0.12, s1: w.door + 0.45 + 0.12, y0: 0, y1: 2.5 });
    }
    for (const [sa, sb] of spans) {
      for (const sh of shut ? [true, false] : [false]) {
        const ww = wwid(sh);
        let n = sb - sa >= ww ? Math.floor((sb - sa + 0.45) / (ww + 0.45)) : 0;
        if (n) {
          n = Math.min(n, Math.max(1, roundHalfEven((sb - sa) / 2.0)));
          for (let k = 0; k < n; k++) {
            const cs = sa + ((sb - sa) * (k + 0.5)) / n;
            // (the window and its sill slab, a little wider than the glass)
            out.push({ what: "window", s0: cs - ww / 2 - 0.05, s1: cs + ww / 2 + 0.05, y0: 0.9, y1: 1.0 + WIN_H });
            out.push({ what: "upper window", s0: cs - ww / 2 - 0.05, s1: cs + ww / 2 + 0.05, y0: 1.0 + WIN_H + 0.3, y1: w.H });
          }
          break;
        }
      }
    }
    // (over the door, from the first floor up, a window too)
    if (w.door >= 0) out.push({ what: "upper window", s0: w.door - 0.6, s1: w.door + 0.6, y0: 2.6, y1: w.H });
  }
  if (w.poort) out.push({ what: "passage", s0: w.poort[0], s1: w.poort[1], y0: 0, y1: 4.2 });
  return out;
}

/** Python's round(): halves to the even number (build_city.py's arithmetic). */
function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(v);
}

/** The stretches [s0, s1] along a wall where a bill of half width hu from y0 to y1 misses every opening by pad. */
export function blankRuns(w: PosterWall, hu: number, y0: number, y1: number, pad = 0.12, end = 0.35): Array<[number, number]> {
  const ops = wallOpenings(w).filter((o) => o.y0 < y1 + pad && y0 - pad < o.y1);
  const cuts = ops.map((o) => [o.s0 - pad - hu, o.s1 + pad + hu]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  let s = end + hu;
  for (const [c0, c1] of cuts) {
    if (c0 > s) out.push([s, c0]);
    s = Math.max(s, c1);
  }
  if (w.L - end - hu > s) out.push([s, w.L - end - hu]);
  return out;
}

// ------------------------------------------------------------------ the parts of town

export type District = "quay" | "fine" | "poor" | "church" | "police" | "middle";

/** The fine squares and streets round the town hall, the cathedral, the Meir side and the park (build_city.py FINE_PLACES). */
export const FINE_PLACES: Array<[number, number, number]> = [[-254, 94, 48], [-262, 132, 32], [-262, 175, 50], [-116, 160, 30], [-300, 318, 45]];
/** The churches: the middle of each, and how far its parish notices go. */
export const CHURCHES: Array<[number, number, number, string]> = [
  [-262, 208, 55, "the cathedral"],
  [-116, 186, 34, "Sint-Carolus"],
  [103, 266, 34, "Sint-Paulus"],
  [-95, 305, 38, "Sint-Jacob"],
];
/** The prison (shared/prisonPlan.ts) and the police post by the town hall (server town/police.ts). */
export const POLICE_PLACES: Array<[number, number, number]> = [[-340, 200, 42], [-272, 100, 14]];

export interface DistrictInput {
  /** The house's wall and its house. */
  wall: PosterWall;
  /** The street's width before the wall (m, to the house opposite; 30 open). */
  width: number;
  /** Open water within 30 m out of the wall. */
  water: boolean;
  /** How far the nearest quay edge is (m). */
  quay: number;
}

/** What part of town a wall is in (for what is pasted on it and how much). */
export function districtOf(x: number, z: number, d: DistrictInput): District {
  if (POLICE_PLACES.some(([px, pz, r]) => Math.hypot(px - x, pz - z) < r)) return "police";
  const fine = FINE_PLACES.some(([px, pz, r]) => Math.hypot(px - x, pz - z) < r);
  if (d.water || d.wall.store || d.quay < 32) return "quay";
  if (CHURCHES.some(([px, pz, r]) => Math.hypot(px - x, pz - z) < r) && !(fine && d.width >= 12)) return "church";
  if (fine) return d.width >= 8 ? "fine" : "middle"; // (a lane off a fine square is no slum)
  if (d.wall.alley || d.width < 6) return "poor";
  return "middle";
}
