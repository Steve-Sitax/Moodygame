import * as THREE from "three";

// Paving with a height map (Steve: "cobbles still look too flat"): a colour texture and a
// height texture made from the same layout, so each stone's colour and its bulge line up.
// The ground shader (retro/psx.ts option `relief`) uses the height for parallax (the
// stones stand up and hide the joints behind them at a slant) and for its own relief
// light (a lit top, a dark joint), which reads in fog and at night too.

export interface Paving {
  map: THREE.CanvasTexture;
  height: THREE.CanvasTexture;
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

function finish(map: HTMLCanvasElement, height: HTMLCanvasElement): Paving {
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
  return { map: m, height: h };
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
  const put = (x: number, y: number, rgb: [number, number, number], h: number) => {
    const xx = ((x % n) + n) % n;
    const yy = ((y % n) + n) % n;
    const i = (yy * n + xx) * 4;
    mImg.data[i] = rgb[0];
    mImg.data[i + 1] = rgb[1];
    mImg.data[i + 2] = rgb[2];
    const v = Math.round(h * 255);
    hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = v;
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
  return finish(mc, hc);
}

/**
 * Long granite edge stones laid along a seam where two pavings meet: u along the seam
 * (one tile = 2 m), v across (0..1 = the band). Stones of 40-80 cm, a lit top edge.
 */
export function edgeStoneTexture(): THREE.CanvasTexture {
  const n = 64;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const r = rand(1875);
  g.fillStyle = "rgb(34,31,27)";
  g.fillRect(0, 0, n, n);
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
    x += w;
  }
  for (let i = 0; i < 180; i++) {
    const a = (r() - 0.5) * 0.18;
    g.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
    g.fillRect(Math.floor(r() * n), 6 + Math.floor(r() * (n - 12)), 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

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
  // old street setts: no two at the same height, tilted by the carts, some sunk, a few gone
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
    { topMin: 0.3, tilt: 0.8, sunk: 0.1, missing: 0.025 },
  );
}

/**
 * The setts along the quay railway (world/tracks.ts): u along the line (2 m a tile), v across
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
    { topMin: 0.5, tilt: 0.5, sunk: 0.05, missing: 0.01 },
  );
  const n = 128;
  const mg = (p.map.image as HTMLCanvasElement).getContext("2d")!;
  const hg = (p.height.image as HTMLCanvasElement).getContext("2d")!;
  // edge stones along both sides of the band: long, flat, lighter
  for (const y of [0, n - 7]) {
    for (let x = 0; x < n; x += 22) {
      mg.fillStyle = `rgb(${88 + ((x * 7) % 20)},${86 + ((x * 7) % 20)},${80 + ((x * 7) % 20)})`;
      mg.fillRect(x + 1, y + 1, 21, 5);
      hg.fillStyle = "rgb(200,200,200)";
      hg.fillRect(x + 1, y + 1, 21, 5);
    }
  }
  // the grooves: where the wheel flanges run, dark and deep
  for (const v of [0.174, 0.826]) {
    const y = Math.round(v * n) + (v < 0.5 ? 1 : -3);
    mg.fillStyle = "#141210";
    mg.fillRect(0, y, n, 2);
    hg.fillStyle = "rgb(0,0,0)";
    hg.fillRect(0, y, n, 2);
  }
  p.map.needsUpdate = true;
  p.height.needsUpdate = true;
  p.map.wrapT = THREE.ClampToEdgeWrapping;
  p.height.wrapT = THREE.ClampToEdgeWrapping;
  return p;
}

/** Flagstones on the squares: 128 px per 4 m tile, slabs of about 60 x 45 cm, worn edges. */
export function flagPaving(): Paving {
  return stones(1874, 128, 15, 16, 24, 1, 2, (r) => {
    const v = 92 + r() * 26;
    return [v + 4, v + 1, v - 5];
  });
}
