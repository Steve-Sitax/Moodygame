import * as THREE from "three";

// Texture atlases for the city houses (tools/blender/build_city.py).
// Facade atlas: 8 x 8 cells of 64 px. Rows 0-3, one per style (brick, plaster,
// grey plaster, dark brick); columns 0-3: ground storey with a window, upper
// storey, blind party wall, plain ground storey (a doorway is cut into it).
// One cell = one bay (3 m) by one storey. Columns 4-7 hold the door parts
// (front door leaves, transom, fanlight, loading door, carriage gates), one
// part per cell. Row r sits r cells up from the bottom (uv v goes up).
// Roof atlas: 2 x 2 cells: pantiles, slate, flat lead, dark lead.

const C = 64;

function canvas(n: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = C * n;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** Small seeded random, so the atlas looks the same every run. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function noise(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amt: number, r: () => number): void {
  for (let i = 0; i < (w * h) / 6; i++) {
    const v = (r() - 0.5) * amt;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(x + Math.floor(r() * w), y + Math.floor(r() * h), 1 + Math.floor(r() * 2), 1);
  }
}

type Style = { base: string; brick: boolean; mortar?: string; trim: string };
const STYLES: Style[] = [
  { base: "#7c4130", brick: true, mortar: "#9a7a66", trim: "#c8bca4" }, // brick
  { base: "#c4b79a", brick: false, trim: "#e2dac6" }, // plaster, cream
  { base: "#8f8e86", brick: false, trim: "#bdbab0" }, // plaster, grey
  { base: "#51302a", brick: true, mortar: "#6e5448", trim: "#a89e8a" }, // dark brick
];

function wallFill(g: CanvasRenderingContext2D, x: number, y: number, s: Style, r: () => number): void {
  g.fillStyle = s.base;
  g.fillRect(x, y, C, C);
  if (s.brick) {
    // one cell is 3 m: a course of brick with its mortar is about 2 px (9 cm),
    // a brick about 5 px (23 cm); drawn soft so it reads as a wall, not a grid
    g.fillStyle = s.mortar!;
    g.globalAlpha = 0.55;
    for (let row = 0; row < C; row += 2) {
      g.fillRect(x, y + row, C, 1);
      const off = (row / 2) % 2 ? 0 : 2;
      for (let col = off; col < C; col += 5) g.fillRect(x + col, y + row, 1, 2);
    }
    g.globalAlpha = 1;
    noise(g, x, y, C, C, 0.22, r);
  } else {
    noise(g, x, y, C, C, 0.12, r);
    // damp stain low on the wall and a few cracks
    const grd = g.createLinearGradient(0, y + C - 18, 0, y + C);
    grd.addColorStop(0, "rgba(40,36,30,0)");
    grd.addColorStop(1, "rgba(40,36,30,0.25)");
    g.fillStyle = grd;
    g.fillRect(x, y + C - 18, C, 18);
  }
}

/** A window: frame, dark panes, glazing bars, stone lintel and sill. top/bottom in cell px from the cell top. */
function windowAt(g: CanvasRenderingContext2D, x: number, y: number, w: number, top: number, bottom: number, s: Style, r: () => number): void {
  const wx = x + (C - w) / 2;
  g.fillStyle = s.trim;
  g.fillRect(wx - 3, y + top - 4, w + 6, 4); // lintel
  g.fillRect(wx - 2, y + bottom, w + 4, 3); // sill
  g.fillStyle = "#e8e2d2";
  g.fillRect(wx, y + top, w, bottom - top);
  const lit = r() < 0.0;
  g.fillStyle = lit ? "#6a4a22" : "#161b20";
  g.fillRect(wx + 2, y + top + 2, w - 4, bottom - top - 4);
  // a faint sky reflection in the upper panes
  g.fillStyle = "rgba(120,130,140,0.25)";
  g.fillRect(wx + 2, y + top + 2, w - 4, Math.floor((bottom - top) / 3));
  g.fillStyle = "#d8d2c2";
  g.fillRect(wx + w / 2 - 1, y + top + 2, 2, bottom - top - 4);
  for (let k = 1; k < 3; k++) g.fillRect(wx + 2, y + top + ((bottom - top) * k) / 3, w - 4, 1);
}

function shutters(g: CanvasRenderingContext2D, x: number, y: number, w: number, top: number, bottom: number, color: string): void {
  const wx = x + (C - w) / 2;
  g.fillStyle = color;
  g.fillRect(wx - 9, y + top, 7, bottom - top);
  g.fillRect(wx + w + 2, y + top, 7, bottom - top);
  g.fillStyle = "rgba(0,0,0,0.25)";
  for (let yy = top + 3; yy < bottom; yy += 4) {
    g.fillRect(wx - 9, y + yy, 7, 1);
    g.fillRect(wx + w + 2, y + yy, 7, 1);
  }
}

/** A window, a door or a shutter on a house front: along the wall (metres from its start) and up. */
export interface Opening {
  what: "window" | "door" | "upper window";
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}

/**
 * Where facadeAtlas() paints the windows and the door on a street wall of length L and height H
 * (tools/blender/build_city.py wall(): 3 m bays, the ground storey gh high with the door in the
 * middle bay, then storeys of sh). Keep in step with the drawing below: lintels, sills, frames
 * and shutters count as part of the opening. For signs (world/streetlife.ts, dev/signcheck.ts).
 */
export function facadeOpenings(L: number, H: number, door: boolean, style: number, gh = 3.8, sh = 3.0): Opening[] {
  const out: Opening[] = [];
  const bays = Math.max(1, Math.round(L / 3));
  const bw = L / bays;
  const px = (p: number) => p / C;
  const doorBay = door ? Math.floor(bays / 2) : -1;
  const ghH = Math.min(gh, H);
  for (let k = 0; k < bays; k++) {
    const b = k * bw;
    if (k === doorBay) {
      // the doorway in the middle of the bay with its stone surround (build_city.py door_spec: up to
      // 1.5 m wide between jambs of 0.2 m, its top under 3.45 m; a carriage gate is wider and taller,
      // the sign check finds it in the geometry)
      const half = Math.min(bw / 2, Math.max(1.0, px(14) * bw));
      out.push({ what: "door", s0: b + bw / 2 - half, s1: b + bw / 2 + half, y0: 0, y1: Math.min(ghH, 3.45) });
    } else {
      // the shop window: lintel 4 px over its top (14) and 3 px wider, the sill 3 px under its foot (52)
      out.push({ what: "window", s0: b + px(9) * bw, s1: b + px(55) * bw, y0: gh * (1 - px(55)), y1: Math.min(ghH, gh * (1 - px(10))) });
    }
  }
  // upper storeys: the window 22 px wide with its lintel (18..46), shutters beside it on the plastered styles
  const shut = style === 1 || style === 2;
  for (let y = gh; y < H - 0.05; y += sh) {
    const y0 = y + sh * px(64 - 55);
    const y1 = Math.min(H, y + sh * (1 - px(8)));
    if (y1 <= y0) break;
    for (let k = 0; k < bays; k++) {
      const b = k * bw;
      out.push({ what: "upper window", s0: b + px(shut ? 12 : 18) * bw, s1: b + px(shut ? 52 : 46) * bw, y0, y1 });
    }
  }
  return out;
}

/** A pixel of paint colour, lighter or darker. */
function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** A raised (fielded) panel: a dark groove, the bevel lit on top and left and in shadow bottom and
 * right, the field a little lighter than the paint. */
function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string): void {
  g.fillStyle = shadeHex(paint, 0.45);
  g.fillRect(x, y, w, h);
  g.fillStyle = shadeHex(paint, 1.45);
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = shadeHex(paint, 0.62);
  g.fillRect(x + 3, y + 3, w - 4, h - 4);
  g.fillStyle = shadeHex(paint, 1.12);
  g.fillRect(x + 3, y + 3, w - 6, h - 6);
}

/** Front door leaf, 64 x 64 px over about 1.1 x 2.2 m (so a pixel row is twice as tall as a column):
 * stiles and rails, two tall raised panels over two short ones, a brass knob on the middle rail. */
function doorLeaf(g: CanvasRenderingContext2D, x: number, y: number, paint: string, r: () => number): void {
  g.fillStyle = paint;
  g.fillRect(x, y, C, C);
  noise(g, x, y, C, C, 0.1, r);
  for (const [px, py, pw, ph] of [
    [8, 5, 20, 27],
    [36, 5, 20, 27],
    [8, 39, 20, 18],
    [36, 39, 20, 18],
  ])
    panel(g, x + px, y + py, pw, ph, paint);
  // the edges of the leaf in shadow, the kick rail worn and dirty
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fillRect(x, y, 1, C);
  g.fillRect(x + C - 1, y, 1, C);
  g.fillRect(x, y, C, 1);
  g.fillStyle = "rgba(20,16,12,0.35)";
  g.fillRect(x, y + C - 5, C, 5);
  // brass: a knob in the middle of the lock rail and a keyhole plate on the stile
  g.fillStyle = "#6e5420";
  g.fillRect(x + 29, y + 34, 6, 3);
  g.fillStyle = "#c9a042";
  g.fillRect(x + 30, y + 34, 4, 2);
  g.fillStyle = "#f0d68a";
  g.fillRect(x + 30, y + 34, 1, 1);
  g.fillStyle = "#b08c3a";
  g.fillRect(x + 58, y + 33, 2, 5);
  g.fillStyle = "#1a1612";
  g.fillRect(x + 58, y + 35, 1, 2);
}

/** Carriage gate, 64 x 64 px over about 2.5 x 3.3 m: two leaves of raised panels, a wicket door in the
 * left leaf, black strap hinges with bolts on the outer edges. The arch cuts off the top corners. */
function gateLeaves(g: CanvasRenderingContext2D, x: number, y: number, paint: string, r: () => number): void {
  g.fillStyle = paint;
  g.fillRect(x, y, C, C);
  noise(g, x, y, C, C, 0.1, r);
  for (const lx of [0, 32]) {
    for (const [py, ph] of [
      [6, 14],
      [23, 17],
      [43, 16],
    ]) {
      panel(g, x + lx + 4, y + py, 11, ph, paint);
      panel(g, x + lx + 17, y + py, 11, ph, paint);
    }
  }
  // the meeting stiles and the edge shadow
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(x + 31, y, 2, C);
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fillRect(x, y, 1, C);
  g.fillRect(x + C - 1, y, 1, C);
  // the wicket door in the left leaf: its own frame, a knob, two small hinges
  g.fillStyle = "rgba(0,0,0,0.65)";
  g.fillRect(x + 5, y + 26, 22, 1);
  g.fillRect(x + 5, y + 26, 1, C - 27);
  g.fillRect(x + 26, y + 26, 1, C - 27);
  g.fillStyle = "#c9a042";
  g.fillRect(x + 23, y + 45, 2, 2);
  g.fillStyle = "#1b1b1d";
  g.fillRect(x + 6, y + 30, 6, 2);
  g.fillRect(x + 6, y + 56, 6, 2);
  // strap hinges: iron bands from the outer edges, tapering, with bolt heads
  const strap = (sx: number, sy: number, dir: number) => {
    g.fillStyle = "#1b1b1d";
    g.fillRect(dir > 0 ? sx : sx - 17, sy, 17, 3);
    g.fillRect(dir > 0 ? sx + 17 : sx - 19, sy + 1, 2, 1);
    g.fillStyle = "#4a4a4c";
    for (const k of [3, 9, 14]) g.fillRect(sx + dir * k, sy + 1, 1, 1);
  };
  strap(x + 1, y + 10, 1);
  strap(x + 1, y + 20, 1);
  strap(x + C - 1, y + 10, -1);
  strap(x + C - 1, y + 52, -1);
  g.fillStyle = "rgba(20,16,12,0.4)";
  g.fillRect(x, y + C - 4, C, 4);
}

/** Glazed transom over a door: a painted frame, three panes, sky in the glass. */
function transom(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = "#e0d8c4";
  g.fillRect(x, y, C, C);
  g.fillStyle = "#161b20";
  g.fillRect(x + 4, y + 8, C - 8, C - 18);
  g.fillStyle = "rgba(120,130,140,0.3)";
  g.fillRect(x + 4, y + 8, C - 8, 14);
  g.fillStyle = "#e0d8c4";
  g.fillRect(x + 22, y + 8, 3, C - 18);
  g.fillRect(x + 39, y + 8, 3, C - 18);
  // the transom bar under the glass, and shadow at the edges
  g.fillStyle = "#3a332c";
  g.fillRect(x, y + C - 10, C, 10);
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fillRect(x, y, C, 2);
  g.fillRect(x, y, 1, C);
  g.fillRect(x + C - 1, y, 1, C);
}

/** Round fanlight: a half disc (u across, v from the springing line up to the crown) of glass
 * with a sunburst of glazing bars round a small hub, in a painted frame. */
function fanlight(g: CanvasRenderingContext2D, x: number, y: number): void {
  for (let py = 0; py < C; py++) {
    for (let px = 0; px < C; px++) {
      const X = ((px + 0.5) / C - 0.5) * 2;
      const Y = 1 - (py + 0.5) / C;
      const rho = Math.hypot(X, Y);
      const phi = Math.atan2(Y, X);
      let col = "#161b20";
      if (Y > 0.35 && rho < 0.84) col = "#1d242b";
      if (rho > 0.86 || Y < 0.08) col = "#3a332c";
      else if (rho < 0.22) col = "#e0d8c4";
      else if (rho > 0.24) {
        for (let k = 1; k < 6; k++) if (Math.abs(phi - (k * Math.PI) / 6) * rho < 0.035) col = "#e0d8c4";
        if (Math.abs(rho - 0.6) < 0.03) col = "#e0d8c4";
      }
      g.fillStyle = col;
      g.fillRect(x + px, y + py, 1, 1);
    }
  }
}

/** Loading door of a storehouse: two leaves of vertical tarred planks, a Z brace, strap hinges. */
function loadingDoor(g: CanvasRenderingContext2D, x: number, y: number, r: () => number): void {
  g.fillStyle = "#3b3526";
  g.fillRect(x, y, C, C);
  for (let px = 0; px < C; px += 5) {
    g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.2})`;
    g.fillRect(x + px, y, 1, C);
    g.fillStyle = `rgba(255,255,255,${r() * 0.06})`;
    g.fillRect(x + px + 1, y, 3, C);
  }
  noise(g, x, y, C, C, 0.14, r);
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(x + 31, y, 2, C);
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (const lx of [2, 34]) {
    for (let k = 0; k < 28; k++) g.fillRect(x + lx + k, y + 50 - Math.round(k * 1.4), 2, 2);
    g.fillRect(x + lx, y + 10, 28, 3);
    g.fillRect(x + lx, y + 50, 28, 3);
  }
  g.fillStyle = "#18181a";
  for (const sy of [11, 51]) {
    g.fillRect(x, y + sy, 18, 2);
    g.fillRect(x + C - 18, y + sy, 18, 2);
  }
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fillRect(x, y, C, 1);
  g.fillRect(x, y, 1, C);
  g.fillRect(x + C - 1, y, 1, C);
}

// ------------------------------------------------------------------ M7 quays pass 2: the windows set in
// build_city.py now cuts the windows into the fronts; the sash at the back of the opening takes a whole
// cell (columns 4-7, rows 0-2). Glass, bars and frame match where ambient.ts puts its lit pane: the upper
// sash's glass 6 px in from each side, 3 px from the top, 4 from the bottom, a mullion and two transoms;
// the shop window's glass 3 px in from each side.

/** Glass: dark, the sky caught in its upper part, a streak of light across. */
function glass(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number): void {
  const grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, "#56626c");
  grd.addColorStop(0.38, "#27303a");
  grd.addColorStop(1, "#11151a");
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(200,215,225,0.10)";
  for (let k = 0; k < h; k++) g.fillRect(x + Math.floor(((k * 0.55 + r() * 2) % w)), y + k, 3, 1);
}

/** Lighter and darker edges on a painted bar or frame, so it reads as wood with depth. */
function bevel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x + w - 1, y, 1, h);
}

/** An upper-storey sash, 64 x 64 px over the opening (about 1.03 x 1.88 m): a painted frame, six panes
 * (a mullion, two transoms), glass; lace up top, or curtains drawn to the sides. */
function sash(g: CanvasRenderingContext2D, x: number, y: number, frame: string, curtain: "lace" | "drawn" | "none", curtainCol: string, r: () => number): void {
  g.fillStyle = frame;
  g.fillRect(x, y, C, C);
  const gx = x + 6, gy = y + 3, gw = C - 12, gh = C - 7;
  glass(g, gx, gy, gw, gh, r);
  if (curtain === "lace") {
    // lace across the upper panes, with a scalloped edge and a pattern of holes
    for (let py = 0; py < 20; py++)
      for (let px = 0; px < gw; px++) {
        const edge = 16 + Math.round(2 * Math.sin((px / gw) * Math.PI * 6));
        if (py > edge) continue;
        const hole = (px + py * 3) % 5 === 0 || (px * 7 + py) % 11 === 0;
        g.fillStyle = hole ? "rgba(40,44,50,0.4)" : "rgba(226,222,208,0.62)";
        g.fillRect(gx + px, gy + py, 1, 1);
      }
  } else if (curtain === "drawn") {
    for (const [cx, dir] of [[gx, 1], [gx + gw, -1]] as const) {
      for (let px = 0; px < 9; px++) {
        const fold = px % 3 === 1 ? 0.75 : 1;
        g.fillStyle = curtainCol;
        g.globalAlpha = 0.82 * fold;
        g.fillRect(dir > 0 ? cx + px : cx - px - 1, gy, 1, gh - 2 - Math.round(px * 0.6));
      }
      g.globalAlpha = 1;
    }
  }
  // the glazing bars (frame colour): a mullion, two transoms
  g.fillStyle = frame;
  g.fillRect(x + 31, gy, 2, gh);
  for (const k of [1, 2]) g.fillRect(gx, Math.round(gy + (gh * k) / 3) - 1, gw, 2);
  bevel(g, x + 31, gy, 2, gh);
  // the frame's own edges: lit on top and left, in shadow under the head
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fillRect(gx, gy, gw, 1);
  g.fillRect(gx, gy, 1, gh);
  g.fillStyle = "rgba(255,255,255,0.15)";
  g.fillRect(x, y + C - 3, C, 1);
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fillRect(x, y, C, 1);
  g.fillRect(x, y, 1, C);
  g.fillRect(x + C - 1, y, 1, C);
  noise(g, x, y, C, C, 0.06, r);
}

/** A shop window, 64 x 64 px over about 1.9 x 2.26 m: a slim frame, a transom light up top, a mullion;
 * wares on a shelf behind the glass in the brown one. */
function shopWindow(g: CanvasRenderingContext2D, x: number, y: number, frame: string, wares: boolean, r: () => number): void {
  g.fillStyle = frame;
  g.fillRect(x, y, C, C);
  const gx = x + 3, gy = y + 3, gw = C - 6, gh = C - 7;
  glass(g, gx, gy, gw, gh, r);
  if (wares) {
    // a shelf low in the window with jars and bottles on it, a hanging row up top
    g.fillStyle = "#3a2c1e";
    g.fillRect(gx, gy + gh - 12, gw, 2);
    for (let px = 2; px < gw - 3; px += 4 + Math.floor(r() * 3)) {
      const hh = 4 + Math.floor(r() * 6);
      g.fillStyle = ["#7a5a2a", "#4a6a4a", "#8a7a5a", "#6a3a2a", "#a89060"][Math.floor(r() * 5)];
      g.fillRect(gx + px, gy + gh - 12 - hh, 3, hh);
      g.fillStyle = "rgba(255,255,255,0.25)";
      g.fillRect(gx + px, gy + gh - 12 - hh, 1, hh);
    }
    for (let px = 4; px < gw - 4; px += 6) {
      g.fillStyle = r() < 0.5 ? "#6a5030" : "#8a6a3a";
      g.fillRect(gx + px, gy + 17, 2, 4 + Math.floor(r() * 3));
    }
  }
  // the transom bar, the mullion and the small panes of the top light
  g.fillStyle = frame;
  g.fillRect(gx, gy + 13, gw, 3);
  g.fillRect(x + 31, gy, 2, gh);
  for (const k of [1, 3]) g.fillRect(gx + Math.round((gw * k) / 4), gy, 2, 13);
  bevel(g, gx, gy + 13, gw, 3);
  bevel(g, x + 31, gy + 16, 2, gh - 16);
  // a stall board of the frame colour at the foot, and the frame's shadows
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fillRect(gx, gy, gw, 1);
  g.fillRect(gx, gy, 1, gh);
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fillRect(x, y, C, 1);
  g.fillRect(x, y, 1, C);
  g.fillRect(x + C - 1, y, 1, C);
  noise(g, x, y, C, C, 0.06, r);
}

/** A small dormer window: four panes in a white frame. */
function dormerWindow(g: CanvasRenderingContext2D, x: number, y: number, r: () => number): void {
  g.fillStyle = "#e2dccb";
  g.fillRect(x, y, C, C);
  glass(g, x + 7, y + 6, C - 14, C - 12, r);
  g.fillStyle = "#e2dccb";
  g.fillRect(x + 31, y + 6, 3, C - 12);
  g.fillRect(x + 7, y + 30, C - 14, 3);
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fillRect(x + 7, y + 6, C - 14, 1);
  g.fillRect(x, y, C, 1);
  noise(g, x, y, C, C, 0.06, r);
}

/** A shutter leaf, 64 x 64 px over about 0.39 x 1.8 m, in grey (the vertex colour paints it): a frame of
 * stiles and rails with louvres, or two raised panels; its hinges. */
function shutterLeaf(g: CanvasRenderingContext2D, x: number, y: number, louvred: boolean, r: () => number): void {
  g.fillStyle = "#d6d4cc";
  g.fillRect(x, y, C, C);
  if (louvred) {
    for (let py = 5; py < C - 5; py += 3) {
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(x + 9, y + py, C - 18, 1);
      g.fillStyle = "rgba(0,0,0,0.38)";
      g.fillRect(x + 9, y + py + 1, C - 18, 2);
    }
    g.fillStyle = "#d6d4cc";
    g.fillRect(x + 9, y + 30, C - 18, 4); // the middle rail
    bevel(g, x + 9, y + 30, C - 18, 4);
  } else {
    for (const [py, ph] of [[5, 23], [35, 24]]) {
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(x + 10, y + py, C - 20, ph);
      g.fillStyle = "#e0ded6";
      g.fillRect(x + 12, y + py + 1, C - 24, ph - 3);
      bevel(g, x + 12, y + py + 1, C - 24, ph - 3);
    }
  }
  bevel(g, x, y, C, C);
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.fillRect(x + 8, y + 4, 1, C - 8);
  g.fillRect(x + C - 9, y + 4, 1, C - 8);
  // iron hinges at the outer stile
  g.fillStyle = "#26262a";
  for (const hy of [8, C - 11]) g.fillRect(x, y + hy, 14, 3);
  noise(g, x, y, C, C, 0.08, r);
}

/** The texels of a cell still as wallFill left them (nothing painted over them since): alpha 0.5. */
function maskFill(g: CanvasRenderingContext2D, x: number, y: number, snap: ImageData): void {
  const now = g.getImageData(x, y, C, C);
  const a = now.data, b = snap.data;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) a[i + 3] = 128;
  }
  g.putImageData(now, x, y);
}

/** Paint for front doors (dark green, oxblood, brown, deep blue) and for gates (brown, green, grey-blue). */
const DOOR_PAINT = ["#2c4632", "#5a2220", "#4a3222", "#22364f"];
const GATE_PAINT = ["#4a3524", "#2f4331", "#3a4450"];

export function facadeAtlas(): THREE.CanvasTexture {
  // 8 x 8 cells: the house styles in cols 0-3, rows 0-3; the door parts in cols 4-7 (build_city.py)
  const [c, g] = canvas(8);
  const r = rand(1873);
  const at = (col: number, row: number): [number, number] => [col * C, (7 - row) * C]; // row 0 at the bottom
  DOOR_PAINT.forEach((p, i) => doorLeaf(g, ...at(4 + i, 4), p, r));
  transom(g, ...at(4, 5));
  fanlight(g, ...at(5, 5));
  loadingDoor(g, ...at(6, 5), r);
  GATE_PAINT.forEach((p, i) => gateLeaves(g, ...at(4 + i, 6), p, r));
  // M7 quays pass 2: the sashes of the windows set in the walls, the shop windows, a dormer window,
  // the shutter leaves (build_city.py SASH, SHOPWIN, DORMWIN, SHUTTER); their own dice, so the walls' stay
  const r2 = rand(1877);
  sash(g, ...at(4, 0), "#e6e0d0", "lace", "", r2);
  sash(g, ...at(5, 0), "#d8ceb4", "drawn", "#6e2a24", r2);
  sash(g, ...at(6, 0), "#2e4a38", "lace", "", r2);
  sash(g, ...at(7, 0), "#4e3826", "drawn", "#3e4a38", r2);
  shopWindow(g, ...at(4, 1), "#d6ccb0", false, r2);
  shopWindow(g, ...at(5, 1), "#2a4232", false, r2);
  shopWindow(g, ...at(6, 1), "#4a3322", true, r2);
  dormerWindow(g, ...at(7, 1), r2);
  shutterLeaf(g, ...at(4, 2), true, r2);
  shutterLeaf(g, ...at(5, 2), false, r2);
  // grime pass 2: a sash with one pane gone (black) and a crack across another (build_city.py SASH_CRACKED)
  {
    const [x, y] = at(6, 2);
    sash(g, x, y, "#bdb4a0", "none", "", r2);
    g.fillStyle = "#050505";
    g.fillRect(x + 33, y + 22, 25, 18);
    g.fillStyle = "rgba(230,235,240,0.7)";
    for (let k = 0; k < 18; k++) g.fillRect(x + 8 + k, y + 44 + Math.round(Math.sin(k * 0.9) * 2 + k * 0.4), 1, 1);
    for (let k = 0; k < 10; k++) g.fillRect(x + 16 + Math.round(k * 0.3), y + 45 + k, 1, 1);
    g.fillStyle = "rgba(40,30,20,0.35)";
    g.fillRect(x, y, C, C);
  }
  // (yard windows, 2026-09-26) a patched sash on the poorer backs (build_city.py SASH_PATCHED): a pane boarded
  // with two planks, one pasted over with paper, a drab curtain, the frame grimy; its own dice (r2 goes on as before)
  {
    const [x, y] = at(7, 2);
    const r3 = rand(1878);
    sash(g, x, y, "#9a8e74", "drawn", "#5a4c3c", r3);
    for (const [py, ph, sh] of [[42, 9, "#5c4630"], [51, 9, "#4e3b28"]] as const) {
      g.fillStyle = sh;
      g.fillRect(x + 6, y + py, 25, ph);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(x + 6, y + py + ph - 1, 25, 1);
      g.fillStyle = "#2a2622";
      g.fillRect(x + 8, y + py + 4, 1, 1);
      g.fillRect(x + 28, y + py + 4, 1, 1);
    }
    g.fillStyle = "#b3a88a";
    g.fillRect(x + 33, y + 23, 25, 17);
    g.fillStyle = "rgba(90,70,40,0.35)";
    for (let k = 0; k < 25; k++) g.fillRect(x + 33 + k, y + 30 + Math.round(k * 0.12), 1, 3);
    g.fillStyle = "rgba(60,50,30,0.25)";
    g.fillRect(x + 33, y + 36, 25, 4);
    g.fillStyle = "rgba(40,30,20,0.3)";
    g.fillRect(x, y, C, C);
  }
  // row 7, one cell per style (build_city.py FARPIER_ROW): the upper-storey wall round a window cut into it,
  // its lintel and sill painted where the upper cell paints them, no shutters: what a front shows far off,
  // where the game does not draw its 3D sills, heads and shutters
  // M7 the grime pass: the plain wall's texels get alpha 0.5 (maskFill): world/houseGrime.ts draws them from
  // the wall pictures; the painted lintels, sills, plinths and windows stay as they are
  const fills: Array<[number, number, ImageData]> = [];
  const fill = (x: number, y: number, s: Style, rr: () => number) => {
    wallFill(g, x, y, s, rr);
    fills.push([x, y, g.getImageData(x, y, C, C)]);
  };
  STYLES.forEach((s, col) => {
    const [x, y] = at(col, 7);
    fill(x, y, s, r2);
    const wx = x + (C - 22) / 2;
    g.fillStyle = s.trim;
    g.fillRect(wx - 3, y + 12 - 4, 22 + 6, 4); // lintel (windowAt)
    g.fillRect(wx - 2, y + C - 12, 22 + 4, 3); // sill
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(x, y + C - 2, C, 2); // the string course line of the upper cell
  });
  STYLES.forEach((s, row) => {
    const y = (7 - row) * C; // row 0 at the bottom of the image
    // col 0: ground storey with a low shop window on a stone plinth
    fill(0, y, s, r);
    g.fillStyle = s.trim;
    g.fillRect(0, y + C - 8, C, 8);
    windowAt(g, 0, y, 40, 14, C - 12, s, r);
    // col 1: upper storey, tall window, shutters on some styles
    fill(C, y, s, r);
    windowAt(g, C, y, 22, 12, C - 12, s, r);
    if (row === 1) shutters(g, C, y, 22, 12, C - 12, "#3d5a45");
    if (row === 2) shutters(g, C, y, 22, 12, C - 12, "#5a3a2a");
    // string course between storeys
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(C, y + C - 2, C, 2);
    // col 2: blind party wall
    fill(C * 2, y, s, r);
    // col 3: plain ground storey on its plinth; build_city.py cuts the doorway into it
    fill(C * 3, y, s, r);
    g.fillStyle = s.trim;
    g.fillRect(C * 3, y + C - 8, C, 8);
  });
  for (const [x, y, snap] of fills) maskFill(g, x, y, snap);
  return tex(c);
}

/**
 * Grime pass 2: the decals' cells (build_city.py RUST, SOOT, DAMP, CORNER, BLOB), 4 x 4 cells of 64 px, grey
 * shapes in the alpha (the vertex colour tints them): a rust run from an iron fitting down; a plume of soot rising
 * from its foot; a damp stain; grime darkest at a corner (u = 0) fading out; a round soot blob. v = 0 at the bottom.
 */
export function grimeDecals(): THREE.CanvasTexture {
  const n = 4;
  const [c, g] = canvas(n);
  const r = rand(1899);
  const img = g.createImageData(C * n, C * n);
  const cell = (col: number, row: number, fn: (u: number, v: number) => number) => {
    const x0 = col * C, y0 = (n - 1 - row) * C;
    for (let y = 0; y < C; y++)
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C, v = 1 - (y + 0.5) / C;
        const a = Math.max(0, Math.min(1, fn(u, v)));
        const i = ((y0 + y) * C * n + x0 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
  };
  // a few random columns for streaky edges
  const streaks = Array.from({ length: C }, () => r());
  const sm = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  cell(0, 0, (u, v) => {
    // rust: strong at the top under the iron, narrowing and fading as it runs down, in streaks
    const w = 0.12 + 0.3 * v;
    const x = Math.abs(u - 0.5);
    return (1 - sm(w * 0.6, w, x)) * sm(0.0, 0.7, v) * (0.6 + 0.4 * streaks[Math.floor(u * C)]);
  });
  cell(1, 0, (u, v) => {
    // soot: dark at the foot, rising and spreading, fading up
    const w = 0.18 + 0.3 * v;
    const x = Math.abs(u - 0.5);
    return (1 - sm(w * 0.5, w, x)) * (1 - sm(0.2, 1.0, v)) * (0.7 + 0.3 * streaks[Math.floor(u * C)]) * 0.85;
  });
  cell(2, 0, (u, v) => {
    // damp: a stain with a ragged edge, darkest low
    const x = Math.abs(u - 0.5) * 2;
    const edge = 0.75 + 0.2 * Math.sin(u * 23 + v * 7) * Math.sin(u * 9 - v * 13);
    return (1 - sm(edge * 0.7, edge, x)) * (1 - sm(0.3, 1.0, v)) * 0.8 * (0.7 + 0.3 * streaks[Math.floor(u * C)]);
  });
  cell(3, 0, (u, v) => Math.pow(1 - sm(0.0, 1.0, u), 0.7) * (0.75 + 0.25 * streaks[Math.floor(u * C)]) * (0.85 + 0.15 * (1 - v)));
  cell(0, 1, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    return (1 - sm(0.2, 1.0, d)) * 0.9;
  });
  // the churches freed (build_city.py ghost_marks): the ghost of a house pulled down on its neighbour's party wall
  // a periodic value noise (tiles: the ghost's cell repeats over its outline)
  const tileNoise = (cells: number, seed: number) => {
    const rr = rand(seed);
    const v = Array.from({ length: cells * cells }, () => rr());
    return (u: number, w: number) => {
      const fx = u * cells, fy = w * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const at = (i: number, j: number) => v[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const gA = tileNoise(4, 31), gB = tileNoise(11, 32), gC = tileNoise(29, 33);
  cell(1, 1, (u, v) => {
    // the old rooms' limewash left on the brick: ONE clean, even film over the lost house's outline, the brick's
    // courses showing through (M7 prison and squares, the lead's review 2026-09-26: the patchy plaster with
    // hard-edged holes read as big dark camouflage blotches over the whole wall); only a breath of variation
    return 0.2 + 0.02 * (gA(u, v) - 0.5) + 0.015 * (streaks[Math.floor(u * C)] - 0.5);
  });
  // a dark line along its length (a floor's joists, the roof's flashing): hard below, soft above, a little ragged
  cell(2, 1, (u, v) => (sm(0.1, 0.25, v) * (1 - sm(0.55, 0.95, v))) * (0.7 + 0.3 * gB(u, 0.5)) * 0.85);
  cell(3, 1, (u, v) => {
    // a scrap of wallpaper: ragged torn edges, a faded stripe and a small figure
    const e = 0.32 + 0.12 * (gB(u, v) - 0.5) + 0.08 * (gC(u, v) - 0.5);
    const inside = Math.abs(u - 0.5) < e && Math.abs(v - 0.5) < e + 0.08 ? 1 : 0;
    const stripe = Math.sin(u * 40) > 0.6 ? 0.85 : 1;
    const figure = (Math.floor(u * 8) + Math.floor(v * 8)) % 3 === 0 && Math.hypot(((u * 8) % 1) - 0.5, ((v * 8) % 1) - 0.5) < 0.2 ? 0.8 : 1;
    return inside * 0.75 * stripe * figure;
  });
  g.putImageData(img, 0, 0);
  const t = tex(c);
  t.magFilter = THREE.LinearFilter;
  return t;
}

export function roofAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(2);
  const r = rand(7);
  // (0,0) bottom left: red-orange pantiles
  const y0 = C;
  g.fillStyle = "#8a4632";
  g.fillRect(0, y0, C, C);
  for (let row = 0; row < C; row += 6) {
    g.fillStyle = "rgba(30,14,10,0.55)";
    g.fillRect(0, y0 + row, C, 1);
    for (let col = (row / 6) % 2 ? 0 : 4; col < C; col += 8) {
      g.fillStyle = "rgba(255,200,160,0.12)";
      g.fillRect(col, y0 + row + 1, 3, 5);
      g.fillStyle = "rgba(0,0,0,0.2)";
      g.fillRect(col + 6, y0 + row + 1, 1, 5);
    }
  }
  noise(g, 0, y0, C, C, 0.25, r);
  // (1,0) bottom right: slate
  g.fillStyle = "#3e4448";
  g.fillRect(C, y0, C, C);
  for (let row = 0; row < C; row += 5) {
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillRect(C, y0 + row, C, 1);
    for (let col = (row / 5) % 2 ? 0 : 5; col < C; col += 10) g.fillRect(C + col, y0 + row, 1, 5);
  }
  noise(g, C, y0, C, C, 0.2, r);
  // (0,1) top left: flat lead roof with seams
  g.fillStyle = "#56595a";
  g.fillRect(0, 0, C, C);
  g.fillStyle = "rgba(0,0,0,0.35)";
  for (let col = 0; col < C; col += 16) g.fillRect(col, 0, 1, C);
  noise(g, 0, 0, C, C, 0.15, r);
  // (1,1) top right: dark lead
  g.fillStyle = "#3a3c3d";
  g.fillRect(C, 0, C, C);
  noise(g, C, 0, C, C, 0.15, r);
  return tex(c);
}

export function stoneTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1);
  const r = rand(3);
  g.fillStyle = "#a49c8a";
  g.fillRect(0, 0, C, C);
  g.fillStyle = "rgba(0,0,0,0.2)";
  for (let row = 0; row < C; row += 16) {
    g.fillRect(0, row, C, 1);
    for (let col = (row / 16) % 2 ? 0 : 16; col < C; col += 32) g.fillRect(col, row, 1, 16);
  }
  noise(g, 0, 0, C, C, 0.2, r);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Slate for the big roofs of the landmarks. */
export function slateTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1);
  const r = rand(11);
  g.fillStyle = "#3a4046";
  g.fillRect(0, 0, C, C);
  for (let row = 0; row < C; row += 5) {
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillRect(0, row, C, 1);
    for (let col = (row / 5) % 2 ? 0 : 5; col < C; col += 10) g.fillRect(col, row, 1, 5);
  }
  noise(g, 0, 0, C, C, 0.22, r);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The Vleeshuis: three courses of red brick, one of white stone ("bacon layers"). */
export function brickBandTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1);
  const r = rand(5);
  // bands: about 60 cm of brick, then 20 cm of white stone
  for (let row = 0; row < C; row += 2) {
    const stone = Math.floor(row / 2) % 8 >= 6;
    g.fillStyle = stone ? "#c9c1ad" : "#8a3e2a";
    g.fillRect(0, row, C, 2);
    g.fillStyle = stone ? "rgba(120,110,95,0.5)" : "rgba(110,84,72,0.55)";
    g.fillRect(0, row, C, 1);
    if (!stone) for (let col = (row / 2) % 2 ? 0 : 2; col < C; col += 5) g.fillRect(col, row, 1, 2);
  }
  noise(g, 0, 0, C, C, 0.16, r);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Church glass: dark panes in lead, a little light caught in them. */
export function glassTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1);
  g.fillStyle = "#12161c";
  g.fillRect(0, 0, C, C);
  g.fillStyle = "rgba(90,110,130,0.35)";
  for (let y = 2; y < C; y += 8) for (let x = (y / 8) % 2 ? 2 : 6; x < C; x += 8) g.fillRect(x, y, 3, 5);
  g.fillStyle = "#3a3a36";
  for (let x = 0; x < C; x += 16) g.fillRect(x, 0, 2, C);
  for (let y = 0; y < C; y += 16) g.fillRect(0, y, C, 2);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The working quays: packed earth, scattered setts, straw and wheel ruts. One tile = 4 m. */
export function earthTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1);
  const r = rand(21);
  g.fillStyle = "#4a4136";
  g.fillRect(0, 0, C, C);
  noise(g, 0, 0, C, C, 0.35, r);
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * C);
    const y = Math.floor(r() * C);
    const v = 70 + Math.floor(r() * 40);
    g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
    g.fillRect(x, y, 3 + Math.floor(r() * 3), 2 + Math.floor(r() * 2));
  }
  g.fillStyle = "rgba(160,140,70,0.35)";
  for (let i = 0; i < 40; i++) g.fillRect(Math.floor(r() * C), Math.floor(r() * C), 2, 1);
  // soft darker and lighter patches (no straight lines: they repeat every tile and show as bands)
  for (let i = 0; i < 10; i++) {
    const x = r() * C;
    const y = r() * C;
    const rad = 4 + r() * 8;
    g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.08)" : "rgba(255,240,210,0.05)";
    for (const [ox, oy] of [[0, 0], [C, 0], [-C, 0], [0, C], [0, -C]]) {
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The squares: big worn flagstones. One tile = 4 m. */
export function flagsTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1);
  const r = rand(23);
  g.fillStyle = "#57524c";
  g.fillRect(0, 0, C, C);
  for (let y = 0; y < C; y += 16) {
    let x = (y / 16) % 2 ? -8 : 0;
    while (x < C) {
      const w = 12 + Math.floor(r() * 10);
      const v = 84 + Math.floor(r() * 30);
      const warm = Math.floor(r() * 8);
      g.fillStyle = `rgb(${v + warm},${v},${v - 6})`;
      g.fillRect(x + 1, y + 1, w - 1, 15);
      // painted relief: lit top and left edge, shaded bottom and right edge
      g.fillStyle = "rgba(255,248,235,0.16)";
      g.fillRect(x + 1, y + 1, w - 1, 1);
      g.fillRect(x + 1, y + 1, 1, 15);
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.fillRect(x + 1, y + 15, w - 1, 1);
      g.fillRect(x + w - 1, y + 1, 1, 15);
      // worn, dished middle and a chipped corner now and then
      g.fillStyle = "rgba(0,0,0,0.07)";
      g.fillRect(x + 3, y + 4, w - 5, 9);
      if (r() < 0.3) {
        g.fillStyle = "#57524c";
        g.fillRect(x + w - 3, y + 12, 3, 4);
      }
      x += w;
    }
  }
  noise(g, 0, 0, C, C, 0.2, r);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Autumn leaves: clumps of rust, yellow and brown with a little green left. */
export function leafTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1);
  const r = rand(29);
  g.fillStyle = "#3a2410";
  g.fillRect(0, 0, C, C);
  const cols = ["#8a4a18", "#a86a20", "#6e3a14", "#b88a30", "#5a5a24", "#7a3010"];
  for (let i = 0; i < 700; i++) {
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.fillRect(Math.floor(r() * C), Math.floor(r() * C), 2, 2);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * The stone setts along a railway track (world/tracks.ts). u runs along the track
 * (one tile = 2 m), v across the band (0..1 = 2.2 m): courses of small granite setts
 * laid across, long edge stones on both sides, a dark groove inside each rail.
 */
export function settsTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1);
  const r = rand(31);
  g.fillStyle = "#2c2a27";
  g.fillRect(0, 0, C, C);
  // courses across the track (canvas x = along, y = across)
  for (let x = 0; x < C; x += 4) {
    let y = 4 + Math.floor(r() * 3);
    while (y < C - 4) {
      const h = 4 + Math.floor(r() * 3);
      const v = 70 + Math.floor(r() * 26);
      g.fillStyle = `rgb(${v},${v - 1},${v - 5})`;
      g.fillRect(x, y, 3, Math.min(h - 1, C - 4 - y));
      g.fillStyle = "rgba(255,248,235,0.14)";
      g.fillRect(x, y, 1, Math.min(h - 1, C - 4 - y));
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(x + 2, y, 1, Math.min(h - 1, C - 4 - y));
      y += h;
    }
  }
  // edge stones: long, laid along the track
  for (const y of [0, C - 4]) {
    for (let x = 0; x < C; x += 16) {
      const v = 82 + Math.floor(r() * 16);
      g.fillStyle = `rgb(${v},${v - 2},${v - 7})`;
      g.fillRect(x, y, 15, 3);
    }
  }
  // the grooves on the inside of the rails (the rails sit at v = 0.174 and 0.826)
  g.fillStyle = "#141210";
  for (const v of [0.174, 0.826]) g.fillRect(0, Math.round(v * C) + (v < 0.5 ? 1 : -3), C, 2);
  noise(g, 0, 0, C, C, 0.2, r);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
