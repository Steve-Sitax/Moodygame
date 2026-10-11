import * as THREE from "three";
import { drawLeaf, LEAF_COLOURS } from "./leafPaint";

// Paving with a height map (Steve: "cobbles still look too flat"): a colour texture and a
// height texture made from the same layout, so each stone's colour and its bulge line up.
// The ground shader (retro/psx.ts option `relief`) uses the height for parallax (the
// stones stand up and hide the joints behind them at a slant) and for its own relief
// light (a lit top, a dark joint), which reads in fog and at night too.

export interface Paving {
  map: THREE.CanvasTexture;
  height: THREE.CanvasTexture;
  /**
   * Which stone a pixel belongs to (Steve: "missing cobbles are a repeating pattern"): r = the
   * stone's number in the tile, g = 1 on a stone (0 in a joint), b = 1 where a stone runs on
   * from the tile before. The shader mixes the number with the tile's place in the world, so
   * every stone in the city sinks, goes missing or takes its tone by its own dice.
   */
  id?: THREE.CanvasTexture;
}

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasPair(n: number): [HTMLCanvasElement, CanvasRenderingContext2D, HTMLCanvasElement, CanvasRenderingContext2D] {
  const a = document.createElement("canvas");
  const b = document.createElement("canvas");
  a.width = a.height = b.width = b.height = n;
  return [a, a.getContext("2d")!, b, b.getContext("2d")!];
}

function finish(map: HTMLCanvasElement, height: HTMLCanvasElement, idc?: HTMLCanvasElement): Paving {
  const m = new THREE.CanvasTexture(map);
  m.colorSpace = THREE.SRGBColorSpace;
  // pixels up close (the PS1 look), smaller copies further off: no stripes toward the horizon
  m.magFilter = THREE.NearestFilter;
  m.minFilter = THREE.LinearMipmapLinearFilter;
  m.generateMipmaps = true;
  m.anisotropy = 4;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  const h = new THREE.CanvasTexture(height);
  h.magFilter = THREE.LinearFilter;
  h.minFilter = THREE.LinearMipmapLinearFilter;
  h.generateMipmaps = true;
  h.wrapS = h.wrapT = THREE.RepeatWrapping;
  if (!idc) return { map: m, height: h };
  const id = new THREE.CanvasTexture(idc);
  id.magFilter = id.minFilter = THREE.NearestFilter;
  id.generateMipmaps = false;
  id.wrapS = id.wrapT = THREE.RepeatWrapping;
  return { map: m, height: h, id };
}

/**
 * Stones in rows (setts or slabs), each a rounded dome in the height map.
 * `n` pixels per tile; rows of `rowH` px; stone widths between wMin and wMax px.
 */
/** How uneven a paving is: how far stones sink and tilt, how many are sunk deep or missing. */
interface Wear {
  topMin: number;
  tilt: number;
  sunk: number;
  missing: number;
}
const EVEN: Wear = { topMin: 0.75, tilt: 0.25, sunk: 0, missing: 0 };

function stones(
  seed: number,
  n: number,
  rowH: number,
  wMin: number,
  wMax: number,
  joint: number,
  round: number,
  colour: (r: () => number) => [number, number, number],
  wear: Wear = EVEN,
): Paving {
  const [mc, mg, hc, hg] = canvasPair(n);
  const r = rand(seed);
  // joints: dark dirt in the colour, the bottom in the height
  mg.fillStyle = "rgb(30,27,23)";
  mg.fillRect(0, 0, n, n);
  hg.fillStyle = "rgb(0,0,0)";
  hg.fillRect(0, 0, n, n);
  const hImg = hg.getImageData(0, 0, n, n);
  const mImg = mg.getImageData(0, 0, n, n);
  const idc = document.createElement("canvas");
  idc.width = idc.height = n;
  const ig = idc.getContext("2d")!;
  const iImg = ig.createImageData(n, n);
  for (let i = 3; i < iImg.data.length; i += 4) iImg.data[i] = 255;
  const ri = rand(seed + 991); // stone numbers: their own dice, so the layout stays as it was
  let sid = 0;
  const put = (x: number, y: number, rgb: [number, number, number], h: number) => {
    const xx = ((x % n) + n) % n;
    const yy = ((y % n) + n) % n;
    const i = (yy * n + xx) * 4;
    mImg.data[i] = rgb[0];
    mImg.data[i + 1] = rgb[1];
    mImg.data[i + 2] = rgb[2];
    const v = Math.round(h * 255);
    hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = v;
    iImg.data[i] = sid;
    iImg.data[i + 1] = 255;
    iImg.data[i + 2] = x >= n ? 255 : 0; // wrapped round from the tile before
  };
  const rows = Math.round(n / rowH);
  const rh = n / rows;
  for (let row = 0; row < rows; row++) {
    const y0 = Math.round(row * rh);
    const y1 = Math.round((row + 1) * rh);
    let x = Math.floor(r() * wMax); // each row starts at its own offset: bond
    const xEnd = x + n;
    while (x < xEnd) {
      const w = Math.round(wMin + r() * (wMax - wMin));
      const base = colour(r);
      sid = 1 + Math.floor(ri() * 254);
      // some stones stand higher, some are worn or sunk; a few have gone, leaving a muddy hole
      const roll = r();
      const missing = roll < wear.missing;
      const top = missing ? 0.05 : roll < wear.missing + wear.sunk ? 0.2 + r() * 0.25 : wear.topMin + r() * (1 - wear.topMin);
      const tiltX = (r() - 0.5) * wear.tilt * 2;
      const tiltY = (r() - 0.5) * wear.tilt * 2;
      const sw = w - joint;
      const sh = y1 - y0 - joint;
      for (let py = 0; py < sh; py++) {
        for (let px = 0; px < sw; px++) {
          // distance to the stone's edge, 0 at the edge .. 1 in the middle, rounded off
          const ex = Math.min(px + 0.5, sw - px - 0.5) / Math.max(1, round);
          const ey = Math.min(py + 0.5, sh - py - 0.5) / Math.max(1, round);
          const e = Math.min(1, Math.min(ex, ey));
          const dome = Math.sqrt(Math.max(0, 1 - (1 - e) * (1 - e)));
          const u = px / sw - 0.5;
          const v = py / sh - 0.5;
          const h = Math.max(0, Math.min(1, dome * top * (1 + tiltX * u + tiltY * v)));
          // colour: the stone's own tone, a little grain, darker toward the edge (dirt)
          const grain = (r() - 0.5) * 14;
          const edge = 0.72 + 0.28 * e;
          const tone = missing ? [52, 42, 32] : base;
          put(x + px, y0 + py, [tone[0] * edge + grain, tone[1] * edge + grain, tone[2] * edge + grain].map((c) => Math.max(0, Math.min(255, c))) as [number, number, number], h);
        }
      }
      x += w;
    }
  }
  mg.putImageData(mImg, 0, 0);
  hg.putImageData(hImg, 0, 0);
  ig.putImageData(iImg, 0, 0);
  return finish(mc, hc, idc);
}

/**
 * Long granite edge stones laid along a seam where two pavings meet: u along the seam
 * (one tile = 2 m), v across (0..1 = the band). Stones of 40-80 cm, a lit top edge.
 * `height` (2026-09-27, Steve: the kerbs "should seem higher in bumpmapping"): the same stones as a height map, each a
 * slab with a flat worn top and its long edges and ends rounded down into the dark joints, for the bump (bumpMap).
 */
/** The kerbs' bump (three.js bumpScale, per 270-line pixel): the stone kinds' 1.4 read flat beside the cobbles' relief. */
export const EDGE_BUMP = 6;
let edgeStones: { map: THREE.CanvasTexture; height: THREE.CanvasTexture } | null = null;
export function edgeStoneTextures(): { map: THREE.CanvasTexture; height: THREE.CanvasTexture } {
  if (edgeStones) return edgeStones;
  const n = 64;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const hc = document.createElement("canvas");
  hc.width = hc.height = n;
  const hg = hc.getContext("2d")!;
  const hImg = hg.createImageData(n, n);
  const r = rand(1875);
  // the dirt beside the kerb, darkest against the stone: its shadow on the lower ground (it reads as standing up)
  for (let yy = 0; yy < 6; yy++) {
    const k = 34 - 3 * yy;
    g.fillStyle = `rgb(${k},${k - 3},${k - 7})`;
    g.fillRect(0, yy, n, 1);
    g.fillRect(0, n - 1 - yy, n, 1);
  }
  // the slab's rise from its edge: steep for 4 px, then a flat top (the long sides at v 6 and n - 6)
  const rise = (d: number) => {
    const e = Math.max(0, Math.min(1, d / 4));
    return Math.sqrt(1 - (1 - e) * (1 - e));
  };
  let x = 0;
  while (x < n) {
    const w = 13 + Math.floor(r() * 14);
    const v = 96 + r() * 26;
    g.fillStyle = `rgb(${v + 3},${v},${v - 6})`;
    g.fillRect(x + 1, 6, w - 1, n - 12);
    // worn, rounded top: lighter middle, darker long edges
    g.fillStyle = "rgba(255,250,240,0.12)";
    g.fillRect(x + 1, 14, w - 1, n - 28);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(x + 1, n - 9, w - 1, 3);
    // the arrises: a worn light edge on one long side, the other rounded into shade, the ends a little dark
    g.fillStyle = "rgba(255,248,235,0.22)";
    g.fillRect(x + 1, 6, w - 1, 2);
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(x + 1, n - 8, w - 1, 2);
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(x + 1, 6, 1, n - 12);
    g.fillRect(x + w - 1, 6, 1, n - 12);
    const top = 0.85 + 0.15 * r();
    for (let yy = 6; yy < n - 6; yy++) {
      for (let xx = x + 1; xx < Math.min(n, x + w); xx++) {
        const d = Math.min(yy - 6 + 0.5, n - 6 - yy - 0.5, xx - x - 0.5, x + w - xx - 0.5);
        const i = (yy * n + xx) * 4;
        hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = Math.round(255 * (0.12 + 0.88 * top * rise(d)));
      }
    }
    x += w;
  }
  for (let i = 0; i < n * n; i++) {
    hImg.data[i * 4 + 3] = 255;
    if (hImg.data[i * 4] === 0) hImg.data[i * 4] = hImg.data[i * 4 + 1] = hImg.data[i * 4 + 2] = 18; // the joints and the dirt beside
  }
  for (let i = 0; i < 180; i++) {
    const a = (r() - 0.5) * 0.18;
    g.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
    g.fillRect(Math.floor(r() * n), 6 + Math.floor(r() * (n - 12)), 1, 1);
  }
  hg.putImageData(hImg, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  const h = new THREE.CanvasTexture(hc);
  h.magFilter = THREE.LinearFilter;
  h.minFilter = THREE.LinearMipmapLinearFilter;
  h.wrapS = THREE.RepeatWrapping;
  h.wrapT = THREE.ClampToEdgeWrapping;
  edgeStones = { map: t, height: h };
  return edgeStones;
}
export const edgeStoneTexture = (): THREE.CanvasTexture => edgeStoneTextures().map;

/**
 * Packed earth and gravel: the gate roads, the yards, the greens' walks (the ground zones' "earth"), 512 px per 4 m tile
 * (8 mm a pixel). Survey finding 23 (2026-10-11: "mud and gravel are huge blurry blotches"; the old map was lumps of a
 * metre and 30 cm, dark hollows and humps that the relief light blew up into blotches): trodden earth, even in tone over
 * the tile, made of fine crumbs; gravel and small stones pressed into it, a few bigger ones; hoof prints (a horseshoe's
 * U, sunk, the earth pushed up round it) and boot prints, faint, every way; small damp hollows where water stood; a few
 * wisps of straw. The wheel ruts are the cart roads' own (world/ruts.ts), never in the tile: they would repeat across it.
 */
export function earthPaving(): Paving {
  const n = 512;
  const [mc, mg, hc, hg] = canvasPair(n);
  const r = rand(1876);
  const hImg = hg.createImageData(n, n);
  const mImg = mg.createImageData(n, n);
  // tiling value noise at a few sizes
  const octave = (cells: number, seed: number) => {
    const rr = rand(seed);
    const g = Array.from({ length: cells * cells }, rr);
    return (x: number, y: number) => {
      const fx = (x / n) * cells;
      const fy = (y / n) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const u = fx - x0;
      const v = fy - y0;
      const su = u * u * (3 - 2 * u);
      const sv = v * v * (3 - 2 * v);
      const at = (i: number, j: number) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * su;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * su;
      return a + (b - a) * sv;
    };
  };
  const broad = octave(5, 11); // 80 cm: the ground's own slight rise and fall
  const lumps = octave(28, 12); // 14 cm: trodden lumps
  const crumb = octave(110, 13); // 4 cm: crumbs
  const tone = octave(7, 14);
  const damp = octave(18, 15);
  const hField = new Float32Array(n * n);
  const shade = new Float32Array(n * n).fill(1); // the colour's own darkening (prints, damp)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) hField[y * n + x] = 0.42 + broad(x, y) * 0.12 + lumps(x, y) * 0.14 + crumb(x, y) * 0.12;
  const wrap = (v: number) => ((v % n) + n) % n;
  // hoof prints: a horseshoe's U (12 cm, open at the heel), sunk 1 to 2 cm, the earth pushed up round its outside
  for (let i = 0; i < 46; i++) {
    const cx = r() * n;
    const cy = r() * n;
    const a = r() * Math.PI * 2;
    const R = 6.5 + r() * 1.5;
    const depth = 0.1 + r() * 0.08;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let y = -12; y <= 12; y++)
      for (let x = -12; x <= 12; x++) {
        const u = x * ca + y * sa;
        const v = -x * sa + y * ca;
        const d = Math.hypot(u, v * 1.1);
        const k = wrap(Math.round(cy + y)) * n + wrap(Math.round(cx + x));
        // the frog's open heel: no shoe there
        const ring = Math.abs(d - R) < 1.6 && !(v > R * 0.35 && Math.abs(u) < R * 0.55);
        if (ring) {
          hField[k] -= depth;
          shade[k] *= 0.82;
        } else if (d < R - 1.6) {
          hField[k] -= depth * 0.45; // the hoof's sole, shallower
          shade[k] *= 0.93;
        } else if (d < R + 4) hField[k] += depth * 0.25 * (1 - (d - R - 1.6) / 2.4);
      }
  }
  // boot prints, fainter: a sole and a heel (27 x 9 cm)
  for (let i = 0; i < 22; i++) {
    const cx = r() * n;
    const cy = r() * n;
    const a = r() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let y = -20; y <= 20; y++)
      for (let x = -20; x <= 20; x++) {
        const u = x * ca + y * sa;
        const v = -x * sa + y * ca;
        const sole = (u - 5) ** 2 / 100 + v * v / 30 < 1;
        const heel = (u + 12) ** 2 / 16 + v * v / 22 < 1;
        if (!sole && !heel) continue;
        const k = wrap(Math.round(cy + y)) * n + wrap(Math.round(cx + x));
        hField[k] -= 0.05;
        shade[k] *= 0.94;
      }
  }
  // gravel and stones pressed in: many small (1 to 3 cm), some bigger (4 to 6 cm), half sunk; grey, ochre, a few dark
  const peb = new Float32Array(n * n);
  const pebTone = new Float32Array(n * n * 3);
  const stone = (cx: number, cy: number, rad: number, rgb: [number, number, number]) => {
    const sq = 0.7 + r() * 0.6;
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++)
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        const d = Math.hypot(x - cx, (y - cy) * sq) / rad;
        if (d >= 1) continue;
        const k = wrap(y) * n + wrap(x);
        const dome = Math.sqrt(1 - d * d);
        if (dome > peb[k]) {
          peb[k] = dome;
          // lit from the north-west, a little: each stone reads round
          const lit = 0.85 + 0.3 * ((cx - x) * 0.6 + (cy - y) * 0.8) / rad;
          pebTone[k * 3] = rgb[0] * lit;
          pebTone[k * 3 + 1] = rgb[1] * lit;
          pebTone[k * 3 + 2] = rgb[2] * lit;
        }
      }
  };
  const pebCol = (): [number, number, number] => {
    const v = 95 + r() * 55;
    const k = r();
    if (k < 0.55) return [v, v * 0.97, v * 0.9];
    if (k < 0.8) return [v * 1.08, v * 0.92, v * 0.7];
    if (k < 0.92) return [v * 0.6, v * 0.58, v * 0.56];
    return [v * 1.1, v * 1.08, v * 1.02];
  };
  for (let i = 0; i < 2600; i++) {
    // more of them in drifts (where carts and feet left them), fewer in the trodden middle of a patch
    const x = r() * n;
    const y = r() * n;
    if (broad(x, y) < 0.35 && r() < 0.5) continue;
    stone(x, y, 0.8 + r() * r() * 3, pebCol());
  }
  for (let i = 0; i < 70; i++) stone(r() * n, r() * n, 3.5 + r() * 3.5, pebCol());
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const ground = hField[k];
      // damp: small hollows where water stood, darker and smoother
      const wet = Math.max(0, Math.min(1, (0.36 - ground) * 6)) * (0.5 + 0.5 * damp(x, y));
      const h = Math.max(0, Math.min(1, ground * 0.85 + peb[k] * 0.32 * (0.6 + 0.4 * peb[k])));
      const i4 = k * 4;
      hImg.data[i4] = hImg.data[i4 + 1] = hImg.data[i4 + 2] = Math.round(h * 255);
      hImg.data[i4 + 3] = 255;
      // colour: brown earth, even over the tile (a slow tone of a few per cent), the crumbs' tops lighter
      const t = tone(x, y) - 0.5;
      const c = crumb(x, y) - 0.5;
      let cr = 80 + t * 12 + c * 16 + (lumps(x, y) - 0.5) * 8;
      let cg = 68 + t * 10 + c * 13 + (lumps(x, y) - 0.5) * 7;
      let cb = 54 + t * 6 + c * 9 + (lumps(x, y) - 0.5) * 5;
      const s = shade[k] * (1 - wet * 0.3);
      cr *= s;
      cg *= s;
      cb *= s * (1 + wet * 0.04);
      if (peb[k] > 0) {
        const m = Math.min(1, peb[k] * 2.5);
        cr = cr * (1 - m) + pebTone[k * 3] * m;
        cg = cg * (1 - m) + pebTone[k * 3 + 1] * m;
        cb = cb * (1 - m) + pebTone[k * 3 + 2] * m;
      }
      const grain = (r() - 0.5) * 8;
      mImg.data[i4] = Math.max(0, Math.min(255, cr + grain));
      mImg.data[i4 + 1] = Math.max(0, Math.min(255, cg + grain));
      mImg.data[i4 + 2] = Math.max(0, Math.min(255, cb + grain));
      mImg.data[i4 + 3] = 255;
    }
  mg.putImageData(mImg, 0, 0);
  hg.putImageData(hImg, 0, 0);
  // straw: thin pale wisps lying about (kept off the tile's edge: they do not wrap)
  for (let i = 0; i < 60; i++) {
    const x = 16 + r() * (n - 32);
    const y = 16 + r() * (n - 32);
    const a = r() * Math.PI;
    const l = 5 + r() * 9;
    mg.strokeStyle = `rgba(${140 + r() * 30},${118 + r() * 24},${66 + r() * 18},0.7)`;
    mg.lineWidth = 0.8;
    mg.beginPath();
    mg.moveTo(x, y);
    mg.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 3, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 3, x + Math.cos(a) * l, y + Math.sin(a) * l);
    mg.stroke();
  }
  return finish(mc, hc);
}

/** Street cobbles (Belgian setts, "kasseien"): 128 px per 2 m tile, rows of about 17 cm. */
export function cobblePaving(): Paving {
  // old street setts, tilted by the carts. Which stones stand high, sink or have gone is rolled
  // per stone in the shader (retro/psx.ts), never baked into the tile: no pattern repeats
  return stones(
    1873,
    128,
    11,
    8,
    13,
    1,
    3,
    (r) => {
      const v = 66 + r() * 40;
      const warm = r() * 10;
      return [v + warm, v + warm * 0.6, v - 4];
    },
    { topMin: 0.85, tilt: 0.8, sunk: 0, missing: 0 },
  );
}

/**
 * The setts along the quay railway (world/tracks.ts): u along the line (2.5 m a tile since quays pass 2), v across
 * the band (0..1 = 2.2 m); the same uneven stones as the streets, a dark groove inside each
 * rail (v 0.174 and 0.826) and long edge stones along both sides.
 */
export function settsPaving(): Paving {
  const p = stones(
    1877,
    128,
    10,
    9,
    14,
    1,
    2,
    (r) => {
      const v = 62 + r() * 36;
      return [v + 2, v, v - 5];
    },
    { topMin: 0.85, tilt: 0.5, sunk: 0, missing: 0 },
  );
  const n = 128;
  const mg = (p.map.image as HTMLCanvasElement).getContext("2d")!;
  const hg = (p.height.image as HTMLCanvasElement).getContext("2d")!;
  const ig = (p.id!.image as HTMLCanvasElement).getContext("2d")!;
  ig.fillStyle = "rgb(0,0,0)"; // edge stones and grooves are no setts: the shader leaves them be
  // edge stones along both sides of the band: long, flat, lighter
  for (const y of [0, n - 7]) {
    for (let x = 0; x < n; x += 22) {
      mg.fillStyle = `rgb(${88 + ((x * 7) % 20)},${86 + ((x * 7) % 20)},${80 + ((x * 7) % 20)})`;
      mg.fillRect(x + 1, y + 1, 21, 5);
      hg.fillStyle = "rgb(200,200,200)";
      hg.fillRect(x + 1, y + 1, 21, 5);
      ig.fillRect(x, y, 22, 7);
    }
  }
  // the grooves: where the wheel flanges run, dark and deep
  for (const v of [0.174, 0.826]) {
    const y = Math.round(v * n) + (v < 0.5 ? 1 : -3);
    mg.fillStyle = "#141210";
    mg.fillRect(0, y, n, 2);
    hg.fillStyle = "rgb(0,0,0)";
    hg.fillRect(0, y, n, 2);
    ig.fillRect(0, y, n, 2);
  }
  p.map.needsUpdate = true;
  p.height.needsUpdate = true;
  p.id!.needsUpdate = true;
  railSettsPictures(p);
  p.map.wrapT = THREE.ClampToEdgeWrapping;
  p.height.wrapT = THREE.ClampToEdgeWrapping;
  p.id!.wrapT = THREE.ClampToEdgeWrapping;
  return p;
}

/**
 * Flagstones on the squares, the pavements and the kerbs: old bluestone flags, 256 px per tile (1.6 cm a pixel on the
 * 4 m squares, 1 cm on the 2.6 m pavements), in courses of 40-56 cm, stones of 47-81 cm.
 * Look pass 2026-10-11 (Steve: "everywhere these stones are, it looks ugly"; Codex review: "manufactured bevelled
 * pavers: continuous black channels, repeated edge shading, very straight boundaries, uniformly finished faces"):
 * - thin joints (one pixel and an uneven edge) filled with sand and dirt, standing a little below the stones, not
 *   black trenches;
 * - flat faces with a narrow worn arris, each stone a little tilted; chipped edges and corners, a few cracks;
 * - each stone its own grey (most cool, some warm), soft mottling and faint chisel lines in one direction,
 *   little per-pixel grain (the colour map is drawn with nearest pixels up close: grain sparkles).
 * The stone map (id) follows stones(): r its number, g 1 on a stone, b 1 where it runs on from the tile before.
 */
export function flagPaving(): Paving {
  const n = 256;
  const [mc, mg, hc, hg] = canvasPair(n);
  const hImg = hg.createImageData(n, n);
  const mImg = mg.createImageData(n, n);
  const idc = document.createElement("canvas");
  idc.width = idc.height = n;
  const ig = idc.getContext("2d")!;
  const iImg = ig.createImageData(n, n);
  const r = rand(1874);
  const ri = rand(1874 + 991);
  // a smooth value noise in the tile (wraps), for the joints' fill, the stones' mottling and their uneven edges
  const noise = (cells: number, seed: number) => {
    const rr = rand(seed);
    const g = Array.from({ length: cells * cells }, rr);
    return (x: number, y: number) => {
      const fx = (((x / n) * cells) % cells + cells) % cells;
      const fy = (((y / n) * cells) % cells + cells) % cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const u = fx - x0;
      const v = fy - y0;
      const su = u * u * (3 - 2 * u);
      const sv = v * v * (3 - 2 * v);
      const at = (i: number, j: number) => g[(j % cells) * cells + (i % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * su;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * su;
      return a + (b - a) * sv;
    };
  };
  const mottle = noise(24, 31);
  const fine = noise(64, 32);
  const ragged = noise(48, 33);
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
  // the joints first, everywhere: sand and dirt, a little lighter where the sand shows, low in the height map
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const s = mottle(x * 3, y * 3);
      const k = 50 + s * 22 + (r() - 0.5) * 8;
      mImg.data[i] = clamp(k + 6);
      mImg.data[i + 1] = clamp(k + 1);
      mImg.data[i + 2] = clamp(k - 7);
      mImg.data[i + 3] = 255;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = Math.round((0.14 + 0.06 * s) * 255);
      hImg.data[i + 3] = 255;
      iImg.data[i + 3] = 255;
    }
  // the courses: their heights add up to the tile
  const courses: number[] = [];
  let sum = 0;
  while (sum < n - 26) {
    const h = 26 + Math.floor(r() * 11);
    courses.push(h);
    sum += h;
  }
  courses[courses.length - 1] += n - sum;
  let y0 = 0;
  for (const ch of courses) {
    let x = Math.floor(r() * 52); // each course starts at its own offset: bond
    const xEnd = x + n;
    // 6 to 8 stones of 30-52 px that close the course exactly at the wrap: the last one never runs over the first
    // (Codex review, 2026-10-11)
    let stonesLeft = 6 + Math.floor(r() * 3);
    while (x < xEnd) {
      const remaining = xEnd - x;
      const lo = Math.max(30, remaining - 52 * (stonesLeft - 1));
      const hi = Math.min(52, remaining - 30 * (stonesLeft - 1));
      const w = stonesLeft <= 1 ? remaining : lo + Math.floor(r() * (hi - lo + 1));
      stonesLeft--;
      const sid = 1 + Math.floor(ri() * 254);
      // the stone's own grey: most cool bluestone, some warmer; its height and its tilt
      const v = 90 + r() * 24;
      const warm = r() < 0.3;
      const base: [number, number, number] = warm ? [v + 5, v + 1, v - 6] : [v - 1, v, v + 2];
      const top = 0.82 + r() * 0.18;
      const tiltX = (r() - 0.5) * 0.12;
      const tiltY = (r() - 0.5) * 0.12;
      // chisel lines along one way or the other, faint
      const along = r() < 0.5;
      const lineK = 2 + r() * 2;
      // chips out of the edges and corners: a hollow, darker, lower
      const chips: [number, number, number][] = [];
      const nChips = Math.floor(r() * 4);
      for (let c = 0; c < nChips; c++) {
        const side = Math.floor(r() * 4);
        const t = r();
        const cx = side === 0 ? t * w : side === 1 ? t * w : side === 2 ? 0 : w - 1;
        const cy = side === 0 ? 0 : side === 1 ? ch - 1 : t * ch;
        chips.push([cx, cy, 1.2 + r() * 2]);
      }
      // a crack across a few of them
      const crack = r() < 0.14 ? { a: r() * w, b: r() * w, wob: r() * 6.28 } : null;
      const sw = w - 1; // one pixel of joint on the right and at the bottom
      const sh = ch - 1;
      for (let py = 0; py < sh; py++)
        for (let px = 0; px < sw; px++) {
          const gx = x + px;
          const gy = y0 + py;
          // the edge is uneven: up to 0.9 px eaten away, by a noise along it
          const eat = ragged(gx, gy) * 0.9;
          const d = Math.min(px + 0.5, sw - px - 0.5, py + 0.5, sh - py - 0.5) - eat;
          if (d < 0) continue;
          let chip = 0;
          for (const [cx, cy, cr] of chips) {
            const q = Math.hypot(px - cx, py - cy);
            if (q < cr) chip = Math.max(chip, 1 - q / cr);
          }
          if (chip > 0.65) continue; // gone to the joint
          // flat face, a narrow worn arris (1.5 px), the chips lower
          const arris = Math.min(1, d / 1.5);
          const u = px / sw - 0.5;
          const vv = py / sh - 0.5;
          let h = top * (1 + tiltX * u + tiltY * vv) * (0.62 + 0.38 * Math.sqrt(arris)) * (1 - 0.4 * chip);
          let k = 1 + (mottle(gx, gy) - 0.5) * 0.14 + (fine(gx, gy) - 0.5) * 0.07;
          const line = along ? gy : gx;
          k += (line % lineK < 1 ? -0.012 : 0.005) * (0.5 + fine(gx * 2, gy * 2));
          k *= 0.9 + 0.1 * arris; // the dirt in the worn edge
          k *= 1 - 0.18 * chip;
          if (crack) {
            const cxAt = crack.a + (crack.b - crack.a) * (py / sh) + Math.sin(py * 0.4 + crack.wob) * 1.2;
            const off = Math.abs(px - cxAt);
            if (off < 0.8) {
              k *= 0.62;
              h *= 0.8;
            }
          }
          const grain = (r() - 0.5) * 6;
          const i = ((((gy % n) + n) % n) * n + (((gx % n) + n) % n)) * 4;
          mImg.data[i] = clamp(base[0] * k + grain);
          mImg.data[i + 1] = clamp(base[1] * k + grain);
          mImg.data[i + 2] = clamp(base[2] * k + grain);
          hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = Math.round(Math.max(0, Math.min(1, h)) * 255);
          iImg.data[i] = sid;
          iImg.data[i + 1] = 255;
          iImg.data[i + 2] = gx >= n ? 255 : 0; // wrapped round from the tile before
        }
      x += w;
    }
    y0 += ch;
  }
  mg.putImageData(mImg, 0, 0);
  hg.putImageData(hImg, 0, 0);
  ig.putImageData(iImg, 0, 0);
  return finish(mc, hc, idc);
}

/**
 * Grass (the town wall, 2026-09-25): the berm outside the wall, the far bank, the gardens in the back alleys. Autumn
 * grass, 512 px per 4 m tile (8 mm a pixel). Survey finding 23 (2026-10-11): the old map was smooth noise, read as big
 * blurry blotches of light and dark green; now blades: thousands of thin strokes in olive, yellow-green and straw,
 * leaning every way and thicker in tufts, the dark earth between them, a few clover leaves, bare trodden patches and a
 * few fallen leaves. The height map is the blades' own (tips high, the earth low), so the relief light picks out blades,
 * not blobs.
 */
export function grassPaving(): Paving {
  const n = 512;
  const [mc, mg, hc, hg] = canvasPair(n);
  const r = rand(1877);
  const octave = (cells: number, seed: number) => {
    const rr = rand(seed);
    const g = Array.from({ length: cells * cells }, rr);
    return (x: number, y: number) => {
      const fx = (x / n) * cells;
      const fy = (y / n) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const u = fx - x0;
      const v = fy - y0;
      const su = u * u * (3 - 2 * u);
      const sv = v * v * (3 - 2 * v);
      const at = (i: number, j: number) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * su;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * su;
      return a + (b - a) * sv;
    };
  };
  const tuft = octave(14, 22); // 30 cm: thicker and thinner grass
  const dry = octave(6, 23); // 70 cm: greener and more straw
  const bare = octave(4, 21); // a metre: trodden patches
  // the earth under it all
  const mImg = mg.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const x = i % n;
    const y = (i / n) | 0;
    const k = 0.85 + 0.3 * tuft(x * 3, y * 3) + (r() - 0.5) * 0.12;
    mImg.data[i * 4] = 52 * k;
    mImg.data[i * 4 + 1] = 46 * k;
    mImg.data[i * 4 + 2] = 32 * k;
    mImg.data[i * 4 + 3] = 255;
  }
  mg.putImageData(mImg, 0, 0);
  hg.fillStyle = "rgb(30,30,30)";
  hg.fillRect(0, 0, n, n);
  // blades: drawn again at the wrapped place near an edge, so the tile has no seam
  const blade = (x: number, y: number, a: number, l: number, col: string, h: number) => {
    const xs = [0, ...(x < 16 ? [n] : x > n - 16 ? [-n] : [])];
    const ys = [0, ...(y < 16 ? [n] : y > n - 16 ? [-n] : [])];
    const v = Math.round(h * 255);
    mg.strokeStyle = col;
    hg.strokeStyle = `rgb(${v},${v},${v})`;
    for (const ox of xs)
      for (const oy of ys) {
        const bx = x + ox;
        const by = y + oy;
        const ex = bx + Math.cos(a) * l;
        const ey = by + Math.sin(a) * l;
        const mx = bx + Math.cos(a + 0.25) * l * 0.5;
        const my = by + Math.sin(a + 0.25) * l * 0.5;
        for (const g of [mg, hg]) {
          g.beginPath();
          g.moveTo(bx, by);
          g.quadraticCurveTo(mx, my, ex, ey);
          g.stroke();
        }
      }
  };
  mg.lineCap = hg.lineCap = "round";
  for (let i = 0; i < 26000; i++) {
    const x = r() * n;
    const y = r() * n;
    const b = bare(x, y);
    const t = tuft(x, y);
    if (b < 0.3 && r() < 0.75) continue; // a trodden patch: few blades
    if (t < 0.35 && r() < 0.5) continue;
    const d = dry(x, y);
    const k = 0.75 + r() * 0.5;
    const straw = r() < 0.15 + d * 0.35;
    const col = straw ? `rgb(${Math.round(128 * k)},${Math.round(116 * k)},${Math.round(70 * k)})` : `rgb(${Math.round((62 + d * 30) * k)},${Math.round((84 + r() * 22) * k)},${Math.round(36 * k)})`;
    mg.lineWidth = hg.lineWidth = 0.9 + r() * 0.8;
    blade(x, y, r() * Math.PI * 2, 4 + r() * 9, col, 0.5 + 0.5 * r());
  }
  // a few clover leaves in the grass: three round leaflets
  for (let i = 0; i < 90; i++) {
    const x = 20 + r() * (n - 40);
    const y = 20 + r() * (n - 40);
    const k = 0.8 + r() * 0.3;
    mg.fillStyle = `rgb(${Math.round(56 * k)},${Math.round(92 * k)},${Math.round(40 * k)})`;
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + r();
      mg.beginPath();
      mg.arc(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 2, 0, Math.PI * 2);
      mg.fill();
    }
  }
  // fallen leaves and a few dry stalks
  for (let i = 0; i < 40; i++) {
    const c = LEAF_COLOURS[Math.floor(r() * LEAF_COLOURS.length)];
    drawLeaf(mg, 24 + r() * (n - 48), 24 + r() * (n - 48), 10 + r() * 8, r() * Math.PI * 2, c, 0.8 + r() * 0.3, r() < 0.6);
  }
  return finish(mc, hc);
}

/**
 * Quays pass 2 (Steve, 2026-09-25, with reference pictures: "make the kaaien with better graphics"): the working
 * quays along the river and the dock in big granite setts, grey with a blue or a warm cast, 256 px per 2.5 m tile
 * (rows of about 16 cm, stones 18 to 27 cm). Mud and dung fill the joints (a little higher than a bare joint, so
 * the stones do not stand up like teeth), wet silt spreads over some stones' edges, straw and a few dark tar
 * stains lie about. Which stones sink or have gone is rolled per stone in the shader, as on the streets.
 */
export function quayPaving(): Paving {
  const n = 256;
  const p = stones(
    1878,
    n,
    16,
    18,
    28,
    2,
    2,
    (r) => {
      const v = 92 + r() * 44;
      const k = r();
      // granite: most grey-brown, some warmer or bluer, a few dark
      if (k < 0.5) return [v + 5, v + 1, v - 5];
      if (k < 0.78) return [v + 12, v + 5, v - 9];
      if (k < 0.9) return [v - 3, v, v + 4];
      return [v * 0.72, v * 0.7, v * 0.68];
    },
    { topMin: 0.88, tilt: 0.45, sunk: 0, missing: 0 },
  );
  const mg = (p.map.image as HTMLCanvasElement).getContext("2d")!;
  const hg = (p.height.image as HTMLCanvasElement).getContext("2d")!;
  const mImg = mg.getImageData(0, 0, n, n);
  const hImg = hg.getImageData(0, 0, n, n);
  const r = rand(1879);
  // tiling value noise for the mud
  const octave = (cells: number, seed: number) => {
    const rr = rand(seed);
    const g = Array.from({ length: cells * cells }, rr);
    return (x: number, y: number) => {
      const fx = (x / n) * cells;
      const fy = (y / n) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const u = fx - x0;
      const v = fy - y0;
      const su = u * u * (3 - 2 * u);
      const sv = v * v * (3 - 2 * v);
      const at = (i: number, j: number) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * su;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * su;
      return a + (b - a) * sv;
    };
  };
  const big = octave(5, 31);
  const small = octave(32, 32);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const h = hImg.data[i] / 255;
      const m = big(x, y) * 0.7 + small(x, y) * 0.3;
      // silt over the stones where the noise is high; always in the joints
      const silt = Math.max(0, Math.min(1, (m - 0.56) * 4)) * (1 - h * 0.6);
      const joint = h < 0.06 ? 1 : 0;
      const mud = Math.max(joint * (0.75 + 0.25 * small(x, y)), silt);
      if (mud <= 0) continue;
      const g = (r() - 0.5) * 10;
      const mr = 58 + m * 22 + g;
      const mgc = 49 + m * 17 + g;
      const mb = 38 + m * 11 + g;
      mImg.data[i] = mImg.data[i] * (1 - mud) + mr * mud;
      mImg.data[i + 1] = mImg.data[i + 1] * (1 - mud) + mgc * mud;
      mImg.data[i + 2] = mImg.data[i + 2] * (1 - mud) + mb * mud;
      // the joints filled a little with mud: they stay low, but not black holes
      if (joint) hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = Math.round(255 * 0.1 * (0.6 + 0.4 * small(x, y)));
    }
  mg.putImageData(mImg, 0, 0);
  hg.putImageData(hImg, 0, 0);
  // straw and hay blown about, a few dark stains of tar and oil
  for (let i = 0; i < 70; i++) {
    const x = 12 + r() * (n - 24);
    const y = 12 + r() * (n - 24);
    const a = r() * Math.PI;
    const l = 4 + r() * 8;
    mg.strokeStyle = `rgba(${160 + r() * 40},${136 + r() * 30},${72 + r() * 24},0.85)`;
    mg.lineWidth = 1;
    mg.beginPath();
    mg.moveTo(x, y);
    mg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    mg.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const x = 20 + r() * (n - 40);
    const y = 20 + r() * (n - 40);
    const gr = mg.createRadialGradient(x, y, 0, x, y, 6 + r() * 12);
    gr.addColorStop(0, "rgba(14,12,10,0.55)");
    gr.addColorStop(1, "rgba(14,12,10,0)");
    mg.fillStyle = gr;
    mg.fillRect(x - 18, y - 18, 36, 36);
  }
  p.map.needsUpdate = true;
  p.height.needsUpdate = true;
  return p;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(url));
    img.src = url;
  });
}

/**
 * A texture whose image was swapped for one of another size (the painted stand-in for its picture): three.js keeps
 * the GPU storage of the first upload (texStorage2D), so a bigger picture does not fit (GL_INVALID_VALUE) and the
 * painted stand-in stays on screen for good if a frame was drawn before the picture came (Steve's picture of a lane
 * in grey squares, 2026-09-26). Disposing frees that storage; the next draw makes it again at the new size.
 */
export function swapped(...texs: Array<THREE.Texture | undefined>): void {
  for (const t of texs) {
    if (!t) continue;
    t.dispose();
    t.needsUpdate = true;
  }
}

/**
 * A painted paving swapped for its pictures (client/public/textures) all at once (bump maps checked, 2026-09-26):
 * the colour, the height and the stone map go in together, or none of them does, so a painted height never lies
 * under a picture's stones (or the other way round) while one is still loading or if one fails. `id: null` blanks
 * the painted stone map when the pictures are in (a picture without a stone map: no per-stone dice).
 */
export function withPictures(p: Paving, urls: { map: string; height: string; id?: string | null }): Paving {
  const list = [urls.map, urls.height, ...(typeof urls.id === "string" ? [urls.id] : [])];
  Promise.all(list.map(loadImage))
    .then(([col, hgt, ids]) => {
      // (a CanvasTexture is typed to hold a canvas; a picture serves it the same)
      (p.map as THREE.Texture).image = col;
      (p.height as THREE.Texture).image = hgt;
      if (p.id && ids) (p.id as THREE.Texture).image = ids;
      else if (p.id && urls.id === null) {
        const blank = document.createElement("canvas");
        blank.width = blank.height = 4;
        const g = blank.getContext("2d")!;
        g.fillStyle = "rgb(0,0,0)";
        g.fillRect(0, 0, 4, 4);
        p.id.image = blank;
      }
      swapped(p.map, p.height, p.id);
    })
    .catch((e) => console.warn("paving pictures did not load: the painted paving stays", e));
  return p;
}

/**
 * Quays pass 2: the rail band in the same setts as the quays (the Codex pictures, client/public/textures), with
 * the edge stones and the flange grooves drawn over them again. 512 px for the band's 2 x 2.2 m. The painted band
 * stays if a picture does not load.
 */
function railSettsPictures(p: Paving): void {
  Promise.all([loadImage("/textures/quay_setts.jpg"), loadImage("/textures/quay_setts_h.png"), loadImage("/textures/quay_setts_id.png")])
    .then(([col, hgt, ids]) => {
      const n = 512;
      // the band is 2.5 m a tile along (tracks.ts band) and 2.2 m across; the picture 2.5 m square: all of it
      // along (it tiles), 2.2 m of it across
      const sw = col.width;
      const sh = (2.2 / 2.5) * col.height;
      const make = (img: HTMLImageElement, smooth: boolean) => {
        const c = document.createElement("canvas");
        c.width = c.height = n;
        const g = c.getContext("2d")!;
        g.imageSmoothingEnabled = smooth;
        g.drawImage(img, 0, 0, (sw / col.width) * img.width, (sh / col.height) * img.height, 0, 0, n, n);
        return [c, g] as const;
      };
      const [mc, mg] = make(col, true);
      const [hc, hg] = make(hgt, true);
      const [ic, ig] = make(ids, false);
      // stones cut by the band's crop are no whole stones: the ones touching the right edge lose their dice
      ig.fillStyle = "rgb(0,0,0)";
      const k = n / 128;
      const r = rand(1882);
      for (const y of [0, n - 7 * k]) {
        for (let x = 0; x < n; x += 22 * k) {
          const v = 88 + Math.floor(r() * 20);
          mg.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
          mg.fillRect(x + k, y + k, 21 * k, 5 * k);
          mg.fillStyle = "rgba(0,0,0,0.25)";
          mg.fillRect(x + k, y + 5 * k, 21 * k, k);
          hg.fillStyle = "rgb(200,200,200)";
          hg.fillRect(x + k, y + k, 21 * k, 5 * k);
          hg.fillStyle = "rgb(0,0,0)";
          hg.fillRect(x, y, k, 7 * k);
          ig.fillRect(x, y, 22 * k, 7 * k);
        }
      }
      for (const v of [0.174, 0.826]) {
        const y = Math.round(v * n) + (v < 0.5 ? k : -3 * k);
        mg.fillStyle = "#141210";
        mg.fillRect(0, y, n, 2 * k);
        hg.fillStyle = "rgb(0,0,0)";
        hg.fillRect(0, y, n, 2 * k);
        ig.fillRect(0, y, n, 2 * k);
      }
      p.map.image = mc;
      p.height.image = hc;
      p.id!.image = ic;
      swapped(p.map, p.height, p.id);
    })
    .catch((e) => console.warn("rail setts pictures did not load", e));
}
