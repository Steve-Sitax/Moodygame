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
function stones(seed: number, n: number, rowH: number, wMin: number, wMax: number, joint: number, round: number, colour: (r: () => number) => [number, number, number]): Paving {
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
      const top = 0.75 + r() * 0.25; // some stones stand higher, some are worn down
      const tiltX = (r() - 0.5) * 0.25;
      const tiltY = (r() - 0.5) * 0.25;
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
          put(x + px, y0 + py, [base[0] * edge + grain, base[1] * edge + grain, base[2] * edge + grain].map((c) => Math.max(0, Math.min(255, c))) as [number, number, number], h);
        }
      }
      x += w;
    }
  }
  mg.putImageData(mImg, 0, 0);
  hg.putImageData(hImg, 0, 0);
  return finish(mc, hc);
}

/** Street cobbles (Belgian setts, "kasseien"): 128 px per 2 m tile, rows of about 17 cm. */
export function cobblePaving(): Paving {
  return stones(1873, 128, 11, 8, 13, 1, 3, (r) => {
    const v = 70 + r() * 34;
    const warm = r() * 8;
    return [v + warm, v + warm * 0.6, v - 4];
  });
}

/** Flagstones on the squares: 128 px per 4 m tile, slabs of about 60 x 45 cm, worn edges. */
export function flagPaving(): Paving {
  return stones(1874, 128, 15, 16, 24, 1, 2, (r) => {
    const v = 92 + r() * 26;
    return [v + 4, v + 1, v - 5];
  });
}
