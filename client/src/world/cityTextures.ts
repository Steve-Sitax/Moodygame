import * as THREE from "three";

// Texture atlases for the city houses (tools/blender/build_city.py).
// Facade atlas: 4 x 4 cells of 64 px. One row per style (brick, plaster,
// grey plaster, dark brick); columns: ground storey with a window, upper
// storey, blind party wall, ground storey with the door. One cell = one bay
// (3 m) by one storey. Row r sits r cells up from the bottom (uv v goes up).
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

export function facadeAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(4);
  const r = rand(1873);
  STYLES.forEach((s, row) => {
    const y = (3 - row) * C; // row 0 at the bottom of the image
    // col 0: ground storey with a low shop window on a stone plinth
    wallFill(g, 0, y, s, r);
    g.fillStyle = s.trim;
    g.fillRect(0, y + C - 8, C, 8);
    windowAt(g, 0, y, 40, 14, C - 12, s, r);
    // col 1: upper storey, tall window, shutters on some styles
    wallFill(g, C, y, s, r);
    windowAt(g, C, y, 22, 12, C - 12, s, r);
    if (row === 1) shutters(g, C, y, 22, 12, C - 12, "#3d5a45");
    if (row === 2) shutters(g, C, y, 22, 12, C - 12, "#5a3a2a");
    // string course between storeys
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(C, y + C - 2, C, 2);
    // col 2: blind party wall
    wallFill(g, C * 2, y, s, r);
    // col 3: ground storey with the door: panelled wood under a fanlight, stone step
    wallFill(g, C * 3, y, s, r);
    g.fillStyle = s.trim;
    g.fillRect(C * 3, y + C - 8, C, 8);
    g.fillRect(C * 3 + 18, y + 6, 28, C - 12);
    g.fillStyle = ["#3a2a1e", "#2e3a30", "#4a2c22", "#2a2622"][row];
    g.fillRect(C * 3 + 21, y + 16, 22, C - 22);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(C * 3 + 23, y + 20, 8, 14);
    g.fillRect(C * 3 + 33, y + 20, 8, 14);
    g.fillRect(C * 3 + 23, y + 38, 8, 16);
    g.fillRect(C * 3 + 33, y + 38, 8, 16);
    g.fillStyle = "#161b20";
    g.fillRect(C * 3 + 21, y + 8, 22, 7); // fanlight
    g.fillStyle = "#8a8478";
    g.fillRect(C * 3 + 16, y + C - 4, 32, 4); // step
  });
  return tex(c);
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
