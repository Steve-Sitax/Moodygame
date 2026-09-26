import * as THREE from "three";

// The bills on the town's walls (M7 posters, Steve 2026-09-26: "more variation depending on where in city
// they are"): what is printed on them, after the bills of Antwerp in 1873, painted once into one atlas.
//   - the quays: sailings (the Red Star Line began in 1873, to Philadelphia), emigrant berths, the Harwich
//     steamer, sales of coffee, hides and wool, hands wanted at the naties, the harbour master's rules;
//   - the fine squares: the Theatre Royal and the French opera, concerts, the Zoo, the Salon of fine arts,
//     notary sales, the town's notices (names in French and Dutch, the rest in plain English);
//   - the poor lanes: balls and dance halls, the lottery, patent pills, rooms to let, tavern bills, the fair;
//   - by a church: the mission week, a procession, the banns, a collection for the poor;
//   - by the prison and the police: wanted, reward, escaped, the police's orders.
// Each bill in three states (fresh, faded and rain-streaked, torn and dirty), layered stacks of old bills
// pasted over each other, scraps and the pale marks where one was torn off. Heading type is big enough to
// read at a few metres in the game's low resolution; the small print is grey rows, as on a real bill seen
// from the street. The woodcut pictures are cut from one Codex sheet (public/textures/poster_cuts.png,
// assets/ATTRIBUTION.md); without it the bills are type only.

export type Shape = "tall" | "big" | "wide" | "small";
export type State = "fresh" | "faded" | "ragged";
export type Pool = "quay" | "fine" | "poor" | "church" | "police";

/** Metres of wall a bill of each shape covers (width, height). */
export const SHAPE_M: Record<Shape, [number, number]> = { tall: [0.56, 0.8], big: [0.76, 1.06], wide: [0.84, 0.58], small: [0.36, 0.5] };
/** Texels a metre. */
const PPM = 150;

type Line =
  | { t: string; f: "h1" | "h2" | "b" | "s"; c?: string }
  | { cut: number; h: number }
  | { fine: number }
  | { rule: true };

export interface Design {
  key: string;
  shape: Shape;
  paper: string;
  ink: string;
  /** A second ink for the heading (red on the theatre bills). */
  red?: string;
  pools: Partial<Record<Pool, number>>;
  border?: boolean;
  lines: Line[];
}

const WHITE = "#e9e4d3";
const YELLOW = "#e6cf78";
const PINK = "#e7b4ae";
const BLUE = "#b9c9d6";
const BUFF = "#dcc9a0";
const GREEN = "#bccaa6";
const BLACK = "#1b1712";
const RED = "#9c2418";
const NAVY = "#1d2a4a";

/** The cuts on the Codex sheet, 4 x 4, by row. */
export const CUT = { steamer: 0, ship: 1, crane: 2, fist: 3, masks: 4, lyre: 5, lion: 6, arms: 7, church: 8, banner: 9, bottle: 10, dancers: 11, wheel: 12, face: 13, irons: 14, house: 15 } as const;

export const DESIGNS: Design[] = [
  // ---------------------------------------------------------------- the quays
  { key: "redstar", shape: "tall", paper: WHITE, ink: BLACK, red: RED, pools: { quay: 3 }, border: true, lines: [{ t: "RED STAR", f: "h1", c: RED }, { t: "LINE", f: "h1", c: RED }, { cut: CUT.steamer, h: 26 }, { t: "ANTWERP TO", f: "h2" }, { t: "PHILADELPHIA", f: "h2" }, { fine: 3 }, { t: "EVERY 14 DAYS", f: "s" }] },
  { key: "harwich", shape: "wide", paper: BLUE, ink: NAVY, pools: { quay: 2, fine: 0.5 }, lines: [{ t: "STEAMER TO", f: "h2" }, { t: "HARWICH", f: "h1" }, { t: "AND LONDON", f: "h2" }, { fine: 2 }, { t: "TUE THU SAT", f: "s" }] },
  { key: "newyork", shape: "tall", paper: YELLOW, ink: BLACK, pools: { quay: 2 }, lines: [{ t: "FOR", f: "h2" }, { t: "NEW YORK", f: "h1" }, { cut: CUT.ship, h: 30 }, { t: "THE BARQUE", f: "b" }, { t: "GERTRUDE", f: "h2" }, { fine: 2 }] },
  { key: "sale_goods", shape: "tall", paper: WHITE, ink: BLACK, pools: { quay: 3, poor: 0.4 }, border: true, lines: [{ t: "PUBLIC", f: "h1" }, { t: "SALE", f: "h1" }, { rule: true }, { t: "COFFEE, HIDES", f: "h2" }, { t: "AND WOOL", f: "h2" }, { fine: 3 }, { t: "AT THE ENTREPOT", f: "s" }] },
  { key: "hands", shape: "small", paper: YELLOW, ink: BLACK, pools: { quay: 3, poor: 0.5 }, lines: [{ t: "HANDS", f: "h1" }, { t: "WANTED", f: "h1" }, { cut: CUT.crane, h: 18 }, { t: "AT THE NATIE", f: "s" }] },
  { key: "harbour", shape: "tall", paper: WHITE, ink: BLACK, pools: { quay: 2 }, border: true, lines: [{ cut: CUT.arms, h: 18 }, { t: "HARBOUR", f: "h1" }, { t: "RULES", f: "h1" }, { t: "NO FIRE, NO PIPES", f: "b" }, { t: "ON THE QUAYS", f: "b" }, { fine: 3 }, { t: "THE HARBOUR MASTER", f: "s" }] },
  { key: "emigrants", shape: "wide", paper: PINK, ink: BLACK, pools: { quay: 2, poor: 0.5 }, lines: [{ t: "EMIGRANTS", f: "h1" }, { t: "TO AMERICA", f: "h2" }, { cut: CUT.steamer, h: 20 }, { t: "BERTHS AND FOOD FOUND", f: "s" }] },
  { key: "laplata", shape: "tall", paper: BLUE, ink: NAVY, pools: { quay: 1.5 }, lines: [{ t: "FOR", f: "h2" }, { t: "BUENOS", f: "h1" }, { t: "AYRES", f: "h1" }, { cut: CUT.ship, h: 26 }, { t: "AND MONTEVIDEO", f: "b" }, { fine: 2 }] },
  // ---------------------------------------------------------------- the fine squares
  { key: "theatre", shape: "big", paper: WHITE, ink: BLACK, red: RED, pools: { fine: 3 }, border: true, lines: [{ t: "THEATRE", f: "h1", c: RED }, { t: "ROYAL", f: "h1", c: RED }, { cut: CUT.masks, h: 28 }, { t: "LA DAME", f: "h2" }, { t: "BLANCHE", f: "h2" }, { rule: true }, { t: "TONIGHT AT 7", f: "b" }, { fine: 2 }] },
  { key: "opera", shape: "tall", paper: YELLOW, ink: BLACK, red: RED, pools: { fine: 2 }, lines: [{ t: "FRENCH", f: "h2" }, { t: "OPERA", f: "h1", c: RED }, { rule: true }, { t: "FAUST", f: "h1" }, { fine: 2 }, { t: "SATURDAY", f: "h2" }] },
  { key: "concert", shape: "wide", paper: BLUE, ink: NAVY, pools: { fine: 2.5 }, border: true, lines: [{ t: "GRAND CONCERT", f: "h1" }, { cut: CUT.lyre, h: 20 }, { t: "SOCIETE ROYALE D'HARMONIE", f: "s" }, { t: "SUNDAY AT 2", f: "b" }] },
  { key: "zoo", shape: "tall", paper: WHITE, ink: BLACK, pools: { fine: 2, quay: 0.3 }, border: true, lines: [{ t: "THE ZOO", f: "h1" }, { cut: CUT.lion, h: 32 }, { t: "OPEN DAILY", f: "h2" }, { t: "MUSIC ON SUNDAYS", f: "b" }, { fine: 2 }] },
  { key: "salon", shape: "wide", paper: WHITE, ink: BLACK, pools: { fine: 2 }, lines: [{ t: "SALON 1873", f: "h1" }, { t: "EXHIBITION OF FINE ARTS", f: "b" }, { rule: true }, { fine: 2 }] },
  { key: "notary", shape: "tall", paper: WHITE, ink: BLACK, pools: { fine: 2, church: 0.5 }, border: true, lines: [{ t: "NOTARY", f: "h1" }, { t: "SALE", f: "h1" }, { cut: CUT.house, h: 22 }, { t: "A HOUSE", f: "h2" }, { t: "WITH GARDEN", f: "b" }, { fine: 3 }] },
  { key: "town", shape: "tall", paper: WHITE, ink: BLACK, pools: { fine: 2, police: 0.8 }, border: true, lines: [{ cut: CUT.arms, h: 22 }, { t: "STAD ANTWERPEN", f: "s" }, { t: "VILLE D'ANVERS", f: "s" }, { t: "NOTICE", f: "h1" }, { fine: 4 }, { t: "THE BURGOMASTER", f: "s" }] },
  { key: "militia", shape: "small", paper: GREEN, ink: BLACK, pools: { fine: 1, police: 0.8 }, lines: [{ cut: CUT.arms, h: 14 }, { t: "MILITIA", f: "h1" }, { t: "THE DRAW", f: "b" }, { fine: 2 }] },
  // (small ones for the piers between the fine fronts' windows)
  { key: "theatre_s", shape: "small", paper: WHITE, ink: BLACK, red: RED, pools: { fine: 2.5 }, border: true, lines: [{ t: "THEATRE", f: "h1", c: RED }, { t: "ROYAL", f: "h2", c: RED }, { cut: CUT.masks, h: 16 }, { t: "TONIGHT", f: "b" }] },
  { key: "notice_s", shape: "small", paper: WHITE, ink: BLACK, pools: { fine: 2, police: 0.5 }, border: true, lines: [{ cut: CUT.arms, h: 16 }, { t: "NOTICE", f: "h1" }, { fine: 3 }, { t: "VILLE D'ANVERS", f: "s" }] },
  { key: "concert_s", shape: "small", paper: BLUE, ink: NAVY, pools: { fine: 2 }, lines: [{ t: "CONCERT", f: "h1" }, { cut: CUT.lyre, h: 16 }, { t: "SUNDAY AT 2", f: "s" }] },
  { key: "zoo_s", shape: "small", paper: YELLOW, ink: BLACK, pools: { fine: 1.5 }, lines: [{ t: "THE ZOO", f: "h1" }, { cut: CUT.lion, h: 18 }, { t: "OPEN DAILY", f: "s" }] },
  // ---------------------------------------------------------------- the poor lanes
  { key: "ball", shape: "tall", paper: PINK, ink: BLACK, red: RED, pools: { poor: 3 }, lines: [{ t: "GRAND", f: "h2", c: RED }, { t: "BALL", f: "h1", c: RED }, { cut: CUT.dancers, h: 30 }, { t: "EVERY SUNDAY", f: "b" }, { t: "DE ZWAAN", f: "h2" }, { t: "ENTRY 20 C.", f: "s" }] },
  { key: "dancing", shape: "small", paper: YELLOW, ink: BLACK, pools: { poor: 2.5 }, lines: [{ t: "DANCING", f: "h1" }, { t: "TONIGHT", f: "h2" }, { fine: 1 }, { t: "IN DE KROON", f: "s" }] },
  { key: "lottery", shape: "tall", paper: BLUE, ink: NAVY, pools: { poor: 2.5, quay: 0.5 }, lines: [{ t: "LOTTERY", f: "h1" }, { cut: CUT.wheel, h: 30 }, { t: "GREAT PRIZE", f: "h2" }, { t: "10,000 FRANCS", f: "h2" }, { fine: 2 }] },
  { key: "pills", shape: "tall", paper: YELLOW, ink: BLACK, pools: { poor: 3, quay: 0.4 }, border: true, lines: [{ t: "DR PEETERS", f: "h2" }, { t: "PILLS", f: "h1" }, { cut: CUT.bottle, h: 28 }, { t: "FOR COUGHS, FEVER", f: "s" }, { t: "AND BAD BLOOD", f: "s" }, { fine: 2 }] },
  { key: "rooms", shape: "small", paper: WHITE, ink: BLACK, pools: { poor: 3 }, lines: [{ t: "ROOMS", f: "h1" }, { t: "TO LET", f: "h1" }, { t: "ASK WITHIN", f: "s" }] },
  { key: "beer", shape: "wide", paper: WHITE, ink: BLACK, pools: { poor: 2.5, quay: 1 }, lines: [{ t: "GOOD BEER", f: "h1" }, { t: "10 C. THE PINT", f: "h2" }, { t: "DE GULDEN HOORN", f: "b" }] },
  { key: "dog", shape: "small", paper: WHITE, ink: BLACK, pools: { poor: 1.5, fine: 0.3 }, lines: [{ t: "DOG", f: "h1" }, { t: "LOST", f: "h1" }, { t: "REWARD", f: "h2" }, { fine: 1 }] },
  { key: "clothes", shape: "small", paper: PINK, ink: BLACK, pools: { poor: 2 }, lines: [{ t: "OLD", f: "h2" }, { t: "CLOTHES", f: "h1" }, { t: "BOUGHT AND SOLD", f: "s" }] },
  { key: "fair", shape: "wide", paper: YELLOW, ink: BLACK, red: RED, pools: { poor: 2, quay: 0.6 }, lines: [{ t: "THE FAIR", f: "h1", c: RED }, { t: "ON THE VRIJDAGMARKT", f: "b" }, { t: "GIANTS AND WAXWORKS", f: "s" }, { fine: 1 }] },
  // ---------------------------------------------------------------- by the churches
  { key: "mission", shape: "tall", paper: WHITE, ink: BLACK, pools: { church: 3 }, border: true, lines: [{ cut: CUT.church, h: 30 }, { t: "MISSION", f: "h1" }, { t: "WEEK", f: "h1" }, { t: "SERMONS AT 7", f: "b" }, { fine: 2 }] },
  { key: "procession", shape: "tall", paper: BLUE, ink: NAVY, pools: { church: 3 }, lines: [{ cut: CUT.banner, h: 30 }, { t: "PROCESSION", f: "h1" }, { t: "SUNDAY AFTER", f: "b" }, { t: "HIGH MASS", f: "h2" }, { fine: 2 }] },
  { key: "banns", shape: "small", paper: WHITE, ink: BLACK, pools: { church: 2.5 }, lines: [{ t: "PARISH", f: "h2" }, { t: "NOTICE", f: "h1" }, { t: "BANNS OF MARRIAGE", f: "s" }, { fine: 2 }] },
  { key: "poor_box", shape: "wide", paper: BUFF, ink: BLACK, pools: { church: 2, poor: 0.5 }, lines: [{ t: "FOR THE POOR", f: "h1" }, { t: "OF THE PARISH", f: "h2" }, { t: "A COLLECTION ON SUNDAY", f: "s" }] },
  // ---------------------------------------------------------------- by the prison and the police
  { key: "wanted", shape: "tall", paper: WHITE, ink: BLACK, pools: { police: 3, poor: 1 }, border: true, lines: [{ t: "WANTED", f: "h1" }, { cut: CUT.face, h: 34 }, { t: "FOR THEFT", f: "h2" }, { t: "REWARD 100 FRANCS", f: "b" }, { fine: 2 }] },
  { key: "reward", shape: "small", paper: YELLOW, ink: BLACK, pools: { police: 2, poor: 1 }, lines: [{ t: "REWARD", f: "h1" }, { cut: CUT.fist, h: 16 }, { t: "A STOLEN WATCH", f: "s" }] },
  { key: "escaped", shape: "tall", paper: YELLOW, ink: BLACK, red: RED, pools: { police: 2.5 }, lines: [{ t: "ESCAPED", f: "h1", c: RED }, { cut: CUT.irons, h: 26 }, { t: "FROM THE PRISON", f: "b" }, { t: "TELL THE POLICE", f: "h2" }, { fine: 2 }] },
  { key: "police", shape: "wide", paper: WHITE, ink: BLACK, pools: { police: 2.5, poor: 0.6 }, border: true, lines: [{ t: "POLICE NOTICE", f: "h1" }, { t: "NO BEGGING IN THE STREETS", f: "b" }, { fine: 2 }] },
];

/** A place on the atlas: u0, v0, u1, v1 (0..1, v up as three's). */
export type Cell = [number, number, number, number];

export interface Atlas {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  /** `${key}:${state}` for bills; `stack_${i}`, `scrap_${i}`, `glue_${i}` for the rest. */
  cells: Map<string, Cell>;
  /** A stack's size on the wall (m), and the pools it belongs to. */
  stacks: Array<{ key: string; w: number; h: number; pool: Pool }>;
  scraps: Array<{ key: string; w: number; h: number }>;
  glue: Array<{ key: string; w: number; h: number }>;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A smooth noise over a cell (0..1), `cells` blobs across. */
function noise2(r: () => number, cells: number): (x: number, y: number) => number {
  const n = cells + 2;
  const v: number[] = [];
  for (let i = 0; i < n * n; i++) v.push(r());
  return (x, y) => {
    const fx = x * cells, fy = y * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => v[(Math.min(n - 1, Math.max(0, j)) * n) + Math.min(n - 1, Math.max(0, i))];
    const a = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const b = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return a * (1 - sy) + b * sy;
  };
}

const FONT: Record<"h1" | "h2" | "b" | "s", (px: number) => string> = {
  // wood type for the big words, a bold serif under them, a plain serif for the rest
  h1: (px) => `900 ${px}px Impact, "Arial Black", "Arial Narrow", sans-serif`,
  h2: (px) => `bold ${px}px Georgia, "Times New Roman", serif`,
  b: (px) => `bold ${px}px Georgia, "Times New Roman", serif`,
  s: (px) => `${px}px Georgia, "Times New Roman", serif`,
};
/** Type sizes (px) by shape. */
const SIZES: Record<Shape, Record<"h1" | "h2" | "b" | "s", number>> = {
  tall: { h1: 20, h2: 13, b: 10, s: 8 },
  big: { h1: 25, h2: 16, b: 12, s: 9 },
  wide: { h1: 20, h2: 13, b: 10, s: 8 },
  small: { h1: 15, h2: 11, b: 9, s: 7 },
};

/** Paints one fresh bill at (x, y), w x h px. */
function paintBill(g: CanvasRenderingContext2D, d: Design, x: number, y: number, w: number, h: number, cuts: HTMLImageElement | null, r: () => number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = d.paper;
  g.fillRect(x, y, w, h);
  // the paper's grain
  for (let i = 0; i < (w * h) / 6; i++) {
    const k = r();
    g.fillStyle = k < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,240,0.08)";
    g.fillRect(x + Math.floor(r() * w), y + Math.floor(r() * h), 1, 1);
  }
  if (d.border) {
    g.strokeStyle = d.ink;
    g.lineWidth = 1;
    g.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    g.strokeRect(x + 4.5, y + 4.5, w - 9, h - 9);
  }
  const S = SIZES[d.shape];
  const pad = d.border ? 7 : 4;
  // the lines' heights, then spread them over the sheet
  const hOf = (l: Line) => ("t" in l ? S[l.f] + 2 : "cut" in l ? l.h * (d.shape === "big" ? 1.45 : d.shape === "small" ? 1.0 : 1.2) + 2 : "fine" in l ? l.fine * 3 + 2 : 5);
  const total = d.lines.reduce((s, l) => s + hOf(l), 0);
  const room = h - 2 * pad;
  const gap = Math.max(0, (room - total) / (d.lines.length + 1));
  let cy = y + pad + gap;
  for (const l of d.lines) {
    const lh = hOf(l);
    if ("t" in l) {
      const px = S[l.f];
      g.font = FONT[l.f](px);
      g.textBaseline = "top";
      g.fillStyle = l.c ?? d.ink;
      const tw = g.measureText(l.t).width;
      const maxW = w - 2 * pad - 2;
      const k = tw > maxW ? maxW / tw : 1;
      g.save();
      g.translate(x + w / 2 - (tw * k) / 2, cy);
      g.scale(k, 1);
      g.fillText(l.t, 0, 0);
      g.restore();
    } else if ("cut" in l) {
      if (cuts) {
        const ch = lh - 2;
        const cw = ch;
        const col = l.cut % 4;
        const row = Math.floor(l.cut / 4);
        const cs = cuts.width / 4;
        g.save();
        g.globalCompositeOperation = "multiply";
        g.imageSmoothingEnabled = true;
        g.drawImage(cuts, col * cs, row * cs, cs, cs, x + w / 2 - cw / 2, cy, cw, ch);
        g.restore();
      }
    } else if ("fine" in l) {
      // small print: rows of grey dashes, as a bill reads from the street
      for (let k = 0; k < l.fine; k++) {
        let fx = x + pad + 2;
        const fy = cy + 1 + k * 3;
        while (fx < x + w - pad - 3) {
          const L = 2 + Math.floor(r() * 6);
          g.fillStyle = "rgba(20,18,14,0.55)";
          g.fillRect(fx, fy, Math.min(L, x + w - pad - 3 - fx), 1);
          fx += L + 2;
        }
      }
    } else {
      g.fillStyle = d.ink;
      g.fillRect(x + pad + 4, cy + 2, w - 2 * pad - 8, 1);
    }
    cy += lh + gap;
  }
  g.restore();
}

/**
 * Ages a painted cell in place: `faded` (the sun: paler, yellowed, streaked by the rain, the edges frayed)
 * or `ragged` (all that, dirtier, big pieces torn away).
 */
function age(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, state: State, r: () => number): void {
  if (state === "fresh") {
    // a clean cut edge, the odd nick
    const im = g.getImageData(x, y, w, h);
    const p = im.data;
    const n = noise2(r, 9);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const e = Math.min(i, j, w - 1 - i, h - 1 - j);
        if (e < 1 && n(i / w, j / h) < 0.3) p[(j * w + i) * 4 + 3] = 0;
      }
    g.putImageData(im, x, y);
    return;
  }
  const rag = state === "ragged";
  const im = g.getImageData(x, y, w, h);
  const p = im.data;
  const big = noise2(r, 4);
  const fine = noise2(r, 14);
  const edge = noise2(r, 10);
  const fade = rag ? 0.45 : 0.32;
  const pale = [226, 214, 182];
  // streaks: columns the rain ran down
  const streak = new Float32Array(w);
  for (let i = 0; i < w; i++) streak[i] = r() < (rag ? 0.25 : 0.15) ? 0.5 + r() * 0.5 : 0;
  const start = new Float32Array(w);
  for (let i = 0; i < w; i++) start[i] = r() * 0.6;
  // a big tear: from a corner, or the lower part gone
  const tearKind = rag ? Math.floor(r() * 4) : r() < 0.35 ? 0 : -1;
  const tcx = r() < 0.5 ? 0 : w;
  const tr = (rag ? 0.45 + r() * 0.35 : 0.25 + r() * 0.15) * Math.min(w, h);
  const tearY = h * (0.55 + r() * 0.25);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      if (p[o + 3] === 0) continue;
      const u = i / w, v = j / h;
      const f = fade * (0.7 + 0.6 * big(u, v));
      for (let c = 0; c < 3; c++) p[o + c] = p[o + c] * (1 - f) + pale[c] * f;
      // yellowed, darker to the foot (the splash from the street), a streak under the rain
      let k = 1 - (rag ? 0.32 : 0.18) * Math.pow(v, 2.2) - 0.08 * fine(u, v);
      if (streak[i] && v > start[i]) k -= 0.14 * streak[i] * Math.min(1, (v - start[i]) * 3);
      if (rag && big(u * 2.3, v * 2.3) > 0.72) k -= 0.12; // grime blots
      p[o] = Math.max(0, p[o] * k);
      p[o + 1] = Math.max(0, p[o + 1] * k * 0.98);
      p[o + 2] = Math.max(0, p[o + 2] * k * 0.9);
      // frayed edges
      const e = Math.min(i, j, w - 1 - i, h - 1 - j);
      const fray = rag ? 3.2 : 2.0;
      let gone = e + edge(u, v) * fray * 1.6 < fray;
      // the big tear
      if (tearKind === 0 || tearKind === 1) gone ||= Math.hypot(i - tcx, j - (tearKind === 0 ? h : 0)) + edge(u * 2, v * 2) * 10 < tr;
      else if (tearKind === 2) gone ||= j + edge(u * 3, v) * 9 > tearY && (i < w * 0.7 || r() < 0.5);
      else if (tearKind === 3) gone ||= Math.abs(i - w * (0.3 + 0.4 * big(0.1, v))) < 3 + edge(u, v * 3) * 5 && j > h * 0.3;
      // holes where it was pulled at
      if (rag && fine(u * 1.7, v * 1.7) > 0.86) gone = true;
      if (gone) p[o + 3] = 0;
    }
  }
  g.putImageData(im, x, y);
}

/** Loads the Codex sheet of woodcuts, cleaned to black on white; null if it is not there. */
function loadCuts(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
    setTimeout(() => res(null), 8000);
  });
}

/** Paints the atlas: every bill in its three states, the stacks, scraps and glue marks. */
export async function buildPosterAtlas(seed = 1873): Promise<Atlas> {
  const cuts = await loadCuts("/textures/poster_cuts.png");
  const W = 2048;
  const H = 1024;
  // two passes: the first on a scrap canvas only asks for the cells' sizes; they are packed tallest first
  // into shelves, 4 px apart (the mips must not bleed); the second paints them there
  const sizes: Array<[number, number]> = [];
  const dry = document.createElement("canvas");
  dry.width = dry.height = 1;
  const first = paintAll(dry, (w, h) => (sizes.push([w, h]), [0, 0]), true);
  void first;
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b][1] - sizes[a][1] || sizes[b][0] - sizes[a][0]);
  const spots: Array<[number, number]> = new Array(sizes.length);
  let sx = 2, sy = 2, rowH = 0;
  for (const i of order) {
    const [w, h] = sizes[i];
    if (sx + w + 3 > W) {
      sx = 2;
      sy += rowH + 4;
      rowH = 0;
    }
    if (sy + h + 3 > H) {
      spots[i] = [-1, -1];
      continue;
    }
    spots[i] = [sx, sy];
    sx += w + 4;
    rowH = Math.max(rowH, h);
  }
  const lost = spots.filter((q) => q[0] < 0).length;
  if (lost) console.warn(`[posters] ${lost} of ${spots.length} atlas cells did not fit`);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  let k = 0;
  const out = paintAll(canvas, () => spots[k++], false);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, canvas, ...out };

  function paintAll(canvas: HTMLCanvasElement, place: (w: number, h: number) => [number, number], dryRun: boolean): Omit<Atlas, "texture" | "canvas"> {
  const W = dryRun ? 2048 : canvas.width;
  const H = dryRun ? 1024 : canvas.height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const cells = new Map<string, Cell>();
  const cellOf = (x: number, y: number, w: number, h: number): Cell => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
  const px = (m: number) => Math.round(m * PPM);
  const states: State[] = ["fresh", "faded", "ragged"];
  const at = new Map<string, [number, number, number, number]>();
  for (const d of DESIGNS) {
    const [mw, mh] = SHAPE_M[d.shape];
    const w = px(mw), h = px(mh);
    for (const s of states) {
      const [x, y] = place(w, h);
      if (x < 0) continue; // (no room left in the atlas)
      if (!dryRun) {
        paintBill(g, d, x, y, w, h, cuts, rng(seed + d.key.length * 131 + DESIGNS.indexOf(d) * 7));
        age(g, x, y, w, h, s, rng(seed * 3 + DESIGNS.indexOf(d) * 13 + states.indexOf(s) * 17));
      }
      cells.set(`${d.key}:${s}`, cellOf(x, y, w, h));
      at.set(`${d.key}:${s}`, [x, y, w, h]);
    }
  }
  // stacks: old bills pasted over each other, the newest on top and most whole
  const stacks: Atlas["stacks"] = [];
  const pools: Pool[] = ["poor", "poor", "poor", "poor", "poor", "poor", "poor", "poor", "poor", "poor", "quay", "quay", "quay", "quay", "police", "police", "church"];
  pools.forEach((pool, i) => {
    const rs = rng(seed * 7 + i * 101);
    // (narrow ones too: most blank wall in the lanes is a pier between two windows)
    const mw = i % 3 === 0 ? 0.55 + rs() * 0.15 : 0.75 + rs() * 0.45;
    const mh = 0.75 + rs() * 0.4;
    const w = px(mw), h = px(mh);
    const [x, y] = place(w, h);
    if (x < 0 || dryRun) return;
    const pick = DESIGNS.filter((d) => ((d.pools[pool] ?? 0) > 0 || (pool !== "poor" && (d.pools.poor ?? 0) > 1)) && at.has(`${d.key}:ragged`) && at.has(`${d.key}:faded`) && at.has(`${d.key}:fresh`));
    const n = 3 + Math.floor(rs() * 3);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    for (let k = 0; k < n; k++) {
      const d = pick[Math.floor(rs() * pick.length)];
      const st: State = k === n - 1 ? (rs() < 0.5 ? "faded" : "fresh") : "ragged";
      const [cx, cy, cw, ch] = at.get(`${d.key}:${st}`)!;
      const ox = x + Math.floor(rs() * Math.max(1, w - cw * 0.7)) - cw * 0.15;
      const oy = y + Math.floor(rs() * Math.max(1, h - ch * 0.75)) - ch * 0.1;
      g.drawImage(canvas, cx, cy, cw, ch, ox, oy, cw, ch);
    }
    g.restore();
    age(g, x, y, w, h, "faded", rng(seed * 5 + i * 37));
    const key = `stack_${i}`;
    cells.set(key, cellOf(x, y, w, h));
    stacks.push({ key, w: w / PPM, h: h / PPM, pool });
  });
  // scraps: what is left of a bill torn off
  const scraps: Atlas["scraps"] = [];
  for (let i = 0; i < 8; i++) {
    const rs = rng(seed * 11 + i * 53);
    const w = px(0.14 + rs() * 0.22), h = px(0.12 + rs() * 0.28);
    const [x, y] = place(w, h);
    if (x < 0) continue;
    const d = DESIGNS[Math.floor(rs() * DESIGNS.length)];
    const src = at.get(`${d.key}:ragged`);
    if (!src && !dryRun) continue;
    const [cx, cy, cw, ch] = src ?? [0, 0, w, h];
    if (!dryRun) g.drawImage(canvas, cx + Math.floor(rs() * Math.max(1, cw - w)), cy + Math.floor(rs() * Math.max(1, ch - h)), w, h, x, y, w, h);
    if (!dryRun) age(g, x, y, w, h, "ragged", rng(seed * 13 + i));
    const key = `scrap_${i}`;
    cells.set(key, cellOf(x, y, w, h));
    scraps.push({ key, w: w / PPM, h: h / PPM });
  }
  // glue marks: the pale ghost of a bill torn away, bits of paper still stuck at its edges
  const glue: Atlas["glue"] = [];
  for (let i = 0; i < 4; i++) {
    const rs = rng(seed * 17 + i * 29);
    const w = px(0.45 + rs() * 0.35), h = px(0.55 + rs() * 0.4);
    const [x, y] = place(w, h);
    if (x < 0) continue;
    if (dryRun) {
      glue.push({ key: `glue_${i}`, w: w / PPM, h: h / PPM });
      continue;
    }
    const im = g.getImageData(x, y, w, h);
    const p = im.data;
    const n = noise2(rs, 6);
    const e = noise2(rs, 12);
    for (let j = 0; j < h; j++)
      for (let q = 0; q < w; q++) {
        const o = (j * w + q) * 4;
        const u = q / w, v = j / h;
        const edge = Math.min(q, j, w - 1 - q, h - 1 - j);
        const inside = edge + e(u, v) * 6 > 3;
        const keep = inside && (n(u, v) > 0.55 || edge < 4 + e(u * 2, v * 2) * 5);
        if (!keep) continue;
        const paper = edge < 4 + e(u * 3, v * 3) * 5 && n(u * 2, v * 2) > 0.5;
        const k = 0.75 + 0.25 * n(u * 3, v * 3);
        const c = paper ? [214, 204, 176] : [150, 136, 108];
        p[o] = c[0] * k;
        p[o + 1] = c[1] * k;
        p[o + 2] = c[2] * k;
        p[o + 3] = 255;
      }
    g.putImageData(im, x, y);
    const key = `glue_${i}`;
    cells.set(key, cellOf(x, y, w, h));
    glue.push({ key, w: w / PPM, h: h / PPM });
  }
  return { cells, stacks, scraps, glue };
  }
}
