import * as THREE from "three";

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
 * Packed earth of the working quays (Steve: "the dirt texture is very blocky; make it more
 * uneven and bumpy"): 256 px per 4 m tile. Trodden earth in brown and grey, lumpy in the
 * height map, with pebbles pressed into it, bits of straw, and darker damp hollows.
 */
export function earthPaving(): Paving {
  const n = 256;
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
  const big = octave(4, 11);
  const mid = octave(12, 12);
  const small = octave(40, 13);
  const tone = octave(6, 14);
  const hField = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const h = big(x, y) * 0.45 + mid(x, y) * 0.35 + small(x, y) * 0.2;
      hField[y * n + x] = h;
    }
  // pebbles pressed into the earth: small domes, lighter and greyer
  const pebbles: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 420; i++) pebbles.push([r() * n, r() * n, 1.5 + r() * r() * 5, 0.75 + r() * 0.25]);
  const peb = new Float32Array(n * n);
  const pebTone = new Float32Array(n * n);
  for (const [cx, cy, rad, v] of pebbles) {
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d >= 1) continue;
        const xx = ((x % n) + n) % n;
        const yy = ((y % n) + n) % n;
        const dome = Math.sqrt(1 - d * d);
        if (dome > peb[yy * n + xx]) {
          peb[yy * n + xx] = dome;
          pebTone[yy * n + xx] = v;
        }
      }
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const ground = hField[k];
      const hollow = Math.max(0, 0.42 - ground) / 0.42; // damp hollows
      const h = Math.min(1, ground * 0.75 + peb[k] * 0.45);
      const i4 = k * 4;
      hImg.data[i4] = hImg.data[i4 + 1] = hImg.data[i4 + 2] = Math.round(h * 255);
      hImg.data[i4 + 3] = 255;
      // colour: brown to grey earth, darker in hollows, lighter on the humps
      const t = tone(x, y);
      let cr = 84 + t * 26 + (ground - 0.5) * 40;
      let cg = 72 + t * 20 + (ground - 0.5) * 34;
      let cb = 58 + t * 12 + (ground - 0.5) * 26;
      cr *= 1 - hollow * 0.35;
      cg *= 1 - hollow * 0.33;
      cb *= 1 - hollow * 0.3;
      if (peb[k] > 0) {
        const v = 110 * pebTone[k] * (0.75 + 0.35 * peb[k]);
        const m = Math.min(1, peb[k] * 3);
        cr = cr * (1 - m) + v * m;
        cg = cg * (1 - m) + v * 0.97 * m;
        cb = cb * (1 - m) + v * 0.92 * m;
      }
      const grain = (r() - 0.5) * 14;
      mImg.data[i4] = Math.max(0, Math.min(255, cr + grain));
      mImg.data[i4 + 1] = Math.max(0, Math.min(255, cg + grain));
      mImg.data[i4 + 2] = Math.max(0, Math.min(255, cb + grain));
      mImg.data[i4 + 3] = 255;
    }
  mg.putImageData(mImg, 0, 0);
  hg.putImageData(hImg, 0, 0);
  // straw: thin pale strokes lying about
  for (let i = 0; i < 90; i++) {
    const x = r() * n;
    const y = r() * n;
    const a = r() * Math.PI;
    const l = 3 + r() * 7;
    mg.strokeStyle = `rgba(${150 + r() * 40},${130 + r() * 30},${70 + r() * 20},0.8)`;
    mg.lineWidth = 1;
    mg.beginPath();
    mg.moveTo(x, y);
    mg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
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

/** Flagstones on the squares: 128 px per 4 m tile, slabs of about 60 x 45 cm, worn edges. */
export function flagPaving(): Paving {
  return stones(1874, 128, 15, 16, 24, 1, 2, (r) => {
    const v = 92 + r() * 26;
    return [v + 4, v + 1, v - 5];
  });
}

/**
 * Grass (the town wall, 2026-09-25): the berm outside the wall, the far bank, the gardens in the back
 * alleys. Autumn grass, 256 px per 4 m tile: tufts in olive and yellow-green, bare trodden patches,
 * a few fallen leaves; the height map gives the tufts a little relief.
 */
export function grassPaving(): Paving {
  const n = 256;
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
  const big = octave(4, 21);
  const mid = octave(16, 22);
  const blade = octave(64, 23);
  const hImg = hg.createImageData(n, n);
  const mImg = mg.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const k = (y * n + x) * 4;
      const b = big(x, y);
      const m = mid(x, y);
      const t = blade(x, y);
      const bare = Math.max(0, 0.3 - b) / 0.3; // trodden patches
      const h = Math.min(1, t * 0.6 + m * 0.4) * (1 - bare * 0.6);
      hImg.data[k] = hImg.data[k + 1] = hImg.data[k + 2] = Math.round(h * 255);
      hImg.data[k + 3] = 255;
      const lit = 0.75 + h * 0.4;
      let cr = (62 + m * 30 + b * 12) * lit;
      let cg = (76 + m * 26 + t * 18) * lit;
      let cb = (38 + m * 10) * lit;
      cr = cr * (1 - bare) + (86 + t * 14) * bare;
      cg = cg * (1 - bare) + (74 + t * 12) * bare;
      cb = cb * (1 - bare) + (56 + t * 8) * bare;
      const grain = (r() - 0.5) * 12;
      mImg.data[k] = Math.max(0, Math.min(255, cr + grain));
      mImg.data[k + 1] = Math.max(0, Math.min(255, cg + grain));
      mImg.data[k + 2] = Math.max(0, Math.min(255, cb + grain));
      mImg.data[k + 3] = 255;
    }
  mg.putImageData(mImg, 0, 0);
  hg.putImageData(hImg, 0, 0);
  // fallen leaves and a few dry stalks
  for (let i = 0; i < 70; i++) {
    const x = r() * n;
    const y = r() * n;
    mg.fillStyle = r() < 0.5 ? `rgb(${140 + r() * 40},${90 + r() * 30},${30 + r() * 20})` : `rgb(${150 + r() * 30},${140 + r() * 30},${80 + r() * 20})`;
    mg.fillRect(Math.floor(x), Math.floor(y), 2, r() < 0.5 ? 1 : 2);
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
