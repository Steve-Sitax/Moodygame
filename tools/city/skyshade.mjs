// The sky over the streets (Steve 2026-09-29: "Lighting during day is flat, is it realistic to have more shadow
// play?"). In a narrow street of four-storey houses the stones at its foot see a strip of sky, not the whole dome:
// they take far less of the sky's light than a square or a quay does. This tool works out, for every metre of the
// town, how much of the sky a point on the ground sees past the houses round it, and writes it as a picture the
// shaders read (retro/psx.ts psxSkyShade): only the sky's light is scaled by it, never the sun or the lamps.
//
//   node tools/city/skyshade.mjs        -> client/public/textures/skyshade.png (+ .json: its box)
//
// Red: the sky seen from the ground (cosine-weighted, 0 none .. 1 the open dome), 1 inside a building (its rooms keep
// their own light). Green: the height of the houses round it / 25 m (the shader lets the light come back up the walls).
// Blue: the houses themselves, their height / 30 m (the shader looks toward the sun over them: psxSunShadow).
// The houses: shared/city_build.json (footprint, eaves height; the roof adds 1.5 m); the landmarks: shared/city.json
// footprints at a height each.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CITY = JSON.parse(readFileSync(path.join(root, "shared/city.json"), "utf8"));
const BUILD = JSON.parse(readFileSync(path.join(root, "shared/city_build.json"), "utf8"));

// the town box (client/src/world/townBox.ts), 20 m more each side for the quays and the wall's foot
const R = CITY.decor?.rampart?.inner ?? { west: -340, east: 200, north: 300 };
const X0 = Math.floor(R.west) - 20;
const Z0 = -80;
const X1 = Math.ceil(R.east) + 20;
const Z1 = Math.ceil(R.north) + 20;
const RES = 1; // m per pixel
const W = Math.round((X1 - X0) / RES);
const H = Math.round((Z1 - Z0) / RES);

/** Eaves heights of the landmarks (m over the street): the naves and halls, not their towers. */
const LANDMARK_H = { cathedral: 22, stadhuis: 16, vleeshuis: 15, steen: 12, hanzehuis: 16, carolus: 18, stpaul: 16, stjacob: 18 };

const height = new Float32Array(W * H);
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
function fill(poly, h) {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - X0) / RES));
  const i1 = Math.min(W - 1, Math.ceil((Math.max(...xs) - X0) / RES));
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - Z0) / RES));
  const j1 = Math.min(H - 1, Math.ceil((Math.max(...zs) - Z0) / RES));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const x = X0 + (i + 0.5) * RES;
      const z = Z0 + (j + 0.5) * RES;
      if (inPoly(x, z, poly)) height[j * W + i] = Math.max(height[j * W + i], h);
    }
}
for (const h of BUILD.houses) fill(h.fp, h.h + 1.5);
for (const [name, l] of Object.entries(CITY.landmarks)) fill(l.fp, LANDMARK_H[name] ?? 15);

// the sky from each open cell: 32 ways round, out to 60 m; the highest house seen that way hides the sky below its
// angle, and a cosine-weighted dome keeps cos^2 of it above
const DIRS = 32;
const REACH = 60;
const cosA = Array.from({ length: DIRS }, (_, k) => Math.cos((k * 2 * Math.PI) / DIRS));
const sinA = Array.from({ length: DIRS }, (_, k) => Math.sin((k * 2 * Math.PI) / DIRS));
const sky = new Float32Array(W * H).fill(1);
const walls = new Float32Array(W * H);
for (let j = 0; j < H; j++)
  for (let i = 0; i < W; i++) {
    if (height[j * W + i] > 0) continue;
    let sum = 0;
    let hsum = 0;
    let hn = 0;
    for (let k = 0; k < DIRS; k++) {
      let best = 0; // tan of the highest angle
      let hb = 0;
      for (let d = 0.75; d <= REACH; d += d < 12 ? 0.5 : 1.5) {
        const ii = Math.floor(i + (cosA[k] * d) / RES);
        const jj = Math.floor(j + (sinA[k] * d) / RES);
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) break;
        const hh = height[jj * W + ii];
        if (hh > 0) {
          const t = hh / d;
          if (t > best) {
            best = t;
            hb = hh;
          }
          // a wall this near hides all behind it that is lower than its angle: go on only while taller could show
          if (hh / d > 1e-3 && d < 3) break;
        }
      }
      // cos^2 of the angle whose tangent is best: 1 / (1 + best^2)
      sum += 1 / (1 + best * best);
      if (hb > 0 && best > 0.15) {
        hsum += hb;
        hn++;
      }
    }
    sky[j * W + i] = sum / DIRS;
    walls[j * W + i] = hn ? hsum / hn : 0;
  }
// a building's cells next to the street take the street's value (its walls sample 0.7 m out, but a wall that stands
// a little inside its footprint's edge must not read 1); deeper in, the rooms keep 1
{
  const s2 = sky.slice();
  const w2 = walls.slice();
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      if (height[k] === 0) continue;
      let v = 0;
      let wv = 0;
      let n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = (j + dj) * W + i + di;
        if (height[q] !== 0) continue;
        v += s2[q];
        wv += w2[q];
        n++;
      }
      if (n) {
        sky[k] = v / n;
        walls[k] = wv / n;
      }
    }
}
// a light blur (3 x 3) so the steps of the grid do not show on the stones
const blur = (a) => {
  const o = a.slice();
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      if (height[j * W + i] > 0 && a[j * W + i] === 1) continue;
      let s = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const q = (j + dj) * W + i + di;
          if (a === sky && height[q] > 0 && a[q] === 1) continue;
          s += a[q];
          n++;
        }
      o[j * W + i] = s / n;
    }
  return o;
};
const skyB = blur(sky);
const wallsB = blur(walls);

// the picture: RGBA, 8 bits; row 0 is z0 (the texture's v runs with z)
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let j = 0; j < H; j++) {
  raw[j * (W * 4 + 1)] = 0;
  for (let i = 0; i < W; i++) {
    const o = j * (W * 4 + 1) + 1 + i * 4;
    raw[o] = Math.round(Math.max(0, Math.min(1, skyB[j * W + i])) * 255);
    raw[o + 1] = Math.round(Math.max(0, Math.min(1, wallsB[j * W + i] / 25)) * 255);
    raw[o + 2] = Math.round(Math.max(0, Math.min(1, (height[j * W + i] - 1.5) / 30)) * 255); // (the eaves: a roof by its own eaves is not shaded by its own house)
    raw[o + 3] = 255;
  }
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
const out = path.join(root, "client/public/textures/skyshade.png");
writeFileSync(out, png);
writeFileSync(out.replace(/\.png$/, ".json"), JSON.stringify({ about: "tools/city/skyshade.mjs: the sky seen from the ground (red), the houses' height round it / 25 m (green), the houses' own height / 30 m (blue); row 0 at z0", x0: X0, z0: Z0, w: W * RES, h: H * RES }) + "\n");
let open = 0;
let n = 0;
for (let k = 0; k < W * H; k++)
  if (height[k] === 0) {
    open += sky[k];
    n++;
  }
console.log(`skyshade: ${W} x ${H} px (${RES} m), ${BUILD.houses.length} houses; mean sky seen from the streets ${(open / n).toFixed(2)}; ${(png.length / 1024).toFixed(0)} KB -> ${path.relative(root, out)}`);
