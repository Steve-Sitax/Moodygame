// The one crate's picture (shared/crateCatalog.ts, tools/blender/build_crate.py): every board of the crate, its iron,
// its rope, the straw of an open one, and on top the front and back of the crate once per goods of the catalog, with
// the stencil (what, where from, the merchant's mark, the case number, where to, a warning). Painted on a 2D canvas
// in headless Chrome (fonts, smooth strokes), the same every run (a fixed random seed). Our own work: nothing downloaded.
//
//   node tools/textures/crate_sheet.mjs [--chrome <exe>]
//
// Writes tools/blender/art/crate/crate_sheet.jpg (4096 x 2048) and crate_sheet.json (the regions the Blender builder
// maps the boards onto, in pixels). Then run tools/blender/build_crate.py.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CRATE_GOODS, CRATE_L, CRATE_D, CRATE_H } from "../../shared/crateCatalog.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outDir = path.join(root, "tools/blender/art/crate");
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------------ the crate's build (Blender builder reads these)

const PPM = 512; // pixels per metre at class 1
const W = 4096;
const H = 2048;
const G = {
  L: CRATE_L,
  D: CRATE_D,
  H: CRATE_H,
  /** board thickness, gap between boards, skid height, cleat width and thickness, lid cleat thickness */
  t: 0.018,
  gap: 0.005,
  skid: 0.035,
  cleat: 0.07,
  cleatT: 0.022,
  lidCleatT: 0.02,
};
// heights: skids 0..skid, the sides from skid to the lid's foot, the lid boards on top, the lid cleats over them
G.lidTop = G.H - G.lidCleatT;
G.sideTop = G.lidTop - G.t;
G.boards = 4;
G.hb = (G.sideTop - G.skid - (G.boards - 1) * G.gap) / G.boards;
// x: the body inside the end cleats
G.bx = G.L / 2 - G.cleatT;

// the front and back of every goods: cells of 432 x 462, two strips (front over back) of L x (sideTop - skid)
const STRIP_W = Math.round(G.L * PPM);
const STRIP_H = Math.round((G.sideTop - G.skid) * PPM);
const CELL_W = 432;
const CELL_H = 462;
const COLS = Math.floor(W / CELL_W);
const cells = CRATE_GOODS.map((_, k) => {
  const cx = (k % COLS) * CELL_W;
  const cy = Math.floor(k / COLS) * CELL_H;
  const ox = cx + Math.round((CELL_W - STRIP_W) / 2);
  return { front: [ox, cy + 6], back: [ox, cy + 12 + STRIP_H + 6] };
});
const labelBottom = Math.ceil(CRATE_GOODS.length / COLS) * CELL_H;
// plank strips: one per board that is not a side board (lid, ends, cleats, skids), each its own grain
const PLANK_W = 432;
const PLANK_H = 100;
const planksTop = labelBottom + 8;
const planks = [];
for (let k = 0; k < 36; k++) planks.push([(k % 9) * (PLANK_W + 2), planksTop + Math.floor(k / 9) * (PLANK_H + 2)]);
const restTop = planksTop + 4 * (PLANK_H + 2) + 8;
const regions = {
  endgrain: [0, restTop, 256, 256],
  iron: [270, restTop, 512, 128],
  rope: [270, restTop + 140, 512, 64],
  straw: [800, restTop, 512, 512],
  dark: [1330, restTop, 128, 128],
  inside: [1470, restTop, 512, 256],
};
const layout = { W, H, PPM, geometry: G, strip: [STRIP_W, STRIP_H], cells, planks, plank: [PLANK_W, PLANK_H], regions };

// ------------------------------------------------------------------ the painter (runs in the page)

function paint(layout, goods) {
  const { W, H, PPM, geometry: G, strip, cells, planks, plank, regions } = layout;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  let s = 1873;
  const R = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rgb = (r, gg, b, a = 1) => `rgba(${r | 0},${gg | 0},${b | 0},${a})`;
  g.fillStyle = "#2a2118";
  g.fillRect(0, 0, W, H);

  // a value noise for mottling (tileable enough for our sizes)
  const noise = (() => {
    const N = 256;
    const v = new Float32Array(N * N);
    for (let i = 0; i < v.length; i++) v[i] = R();
    const sm = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = sm(x - xi), fy = sm(y - yi);
      const a = v[((yi & 255) * N + (xi & 255))], b = v[((yi & 255) * N + ((xi + 1) & 255))];
      const cc = v[(((yi + 1) & 255) * N + (xi & 255))], d = v[(((yi + 1) & 255) * N + ((xi + 1) & 255))];
      return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
    };
  })();

  /**
   * One pine board: grain along x, w x h pixels at (x, y), its own tone; knots; worn pale along its edges, a dark
   * line at the seam; weathered grey in blotches; `dirt` darkens it (low boards, splashed from the setts).
   */
  function board(x, y, w, h, o = {}) {
    const tone = o.tone ?? 0.86 + R() * 0.24;
    const base = o.base ?? [146, 114, 76];
    const grey = o.grey ?? 0.25 + R() * 0.25;
    // the wood, a slight gradient across
    const gr = g.createLinearGradient(x, y, x, y + h);
    const c0 = base.map((v) => v * tone);
    gr.addColorStop(0, rgb(c0[0] * 1.04, c0[1] * 1.03, c0[2] * 1.02));
    gr.addColorStop(1, rgb(c0[0] * 0.93, c0[1] * 0.92, c0[2] * 0.9));
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    // late and early wood: long wavy lines along the board, bunched toward the heart
    const heart = y + h * (0.2 + R() * 0.6);
    const lines = Math.max(10, Math.round(h * 0.55));
    for (let i = 0; i < lines; i++) {
      const off = (i / lines - 0.5) * h * 1.6;
      const yy = heart + off * (0.6 + 0.4 * Math.abs(off) / h);
      const amp = 0.6 + R() * 2.2;
      const per = 60 + R() * 220;
      const ph = R() * 6.28;
      g.strokeStyle = rgb(62, 40, 22, 0.12 + R() * 0.3);
      g.lineWidth = 0.5 + R() * 1.4;
      g.beginPath();
      for (let px = -4; px <= w + 4; px += 6) {
        const py = yy + Math.sin(px / per + ph) * amp + Math.sin(px / (per * 0.37) + ph * 2) * amp * 0.4;
        if (px === -4) g.moveTo(x + px, py);
        else g.lineTo(x + px, py);
      }
      g.stroke();
    }
    // knots: a dark eye, the grain bent round it
    const knots = o.knots ?? (R() < 0.55 ? 1 : 0) + (R() < 0.2 ? 1 : 0);
    for (let k = 0; k < knots; k++) {
      const kx = x + w * (0.12 + R() * 0.76);
      const ky = y + h * (0.25 + R() * 0.5);
      const kr = Math.min(h * 0.22, 3 + R() * 7);
      for (let r = 3; r >= 1; r--) {
        g.strokeStyle = rgb(80, 52, 30, 0.18);
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(kx, ky, kr * (1 + r * 0.9), kr * 0.55 * (1 + r * 0.5), 0, 0, 6.29);
        g.stroke();
      }
      const kg = g.createRadialGradient(kx, ky, 0, kx, ky, kr);
      kg.addColorStop(0, rgb(48, 30, 16, 0.95));
      kg.addColorStop(0.7, rgb(78, 50, 28, 0.8));
      kg.addColorStop(1, rgb(100, 70, 40, 0));
      g.fillStyle = kg;
      g.beginPath();
      g.ellipse(kx, ky, kr, kr * 0.62, 0, 0, 6.29);
      g.fill();
      // a crack from the knot
      if (R() < 0.4) {
        g.strokeStyle = rgb(30, 20, 12, 0.7);
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(kx + kr, ky);
        g.lineTo(kx + kr + 10 + R() * 30, ky + (R() - 0.5) * 3);
        g.stroke();
      }
    }
    // weathering: silver-grey where the rain has had it, in soft blotches; fine fibres
    const img = g.getImageData(x, y, w, h);
    const d = img.data;
    const nx = R() * 200, ny = R() * 200;
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const n = noise(nx + px / 38, ny + py / 14) * 0.65 + noise(nx * 2 + px / 9, ny + py / 4) * 0.35;
        const gw = Math.max(0, Math.min(1, (n - 0.45) * 2.2)) * grey;
        const fib = (noise(nx + px / 1.5, ny * 3 + py / 0.7) - 0.5) * 18;
        let r = d[i], gg = d[i + 1], b = d[i + 2];
        const lum = (r + gg + b) / 3;
        r = r * (1 - gw) + (lum * 1.02 + 8) * gw + fib;
        gg = gg * (1 - gw) + (lum * 1.0 + 8) * gw + fib;
        b = b * (1 - gw) + (lum * 0.97 + 10) * gw + fib;
        // dirt toward the foot of the crate
        const dd = (o.dirt ?? 0) * (0.6 + 0.4 * n);
        d[i] = r * (1 - dd * 0.45);
        d[i + 1] = gg * (1 - dd * 0.47);
        d[i + 2] = b * (1 - dd * 0.5);
      }
    g.putImageData(img, x, y);
    // worn edges: pale along the long edges, dark under them (the seam)
    g.fillStyle = rgb(196, 172, 134, 0.18);
    g.fillRect(x, y, w, 2);
    g.fillStyle = rgb(30, 20, 12, 0.35);
    g.fillRect(x, y + h - 2, w, 2);
    g.fillStyle = rgb(30, 20, 12, 0.18);
    g.fillRect(x, y + h - 4, w, 2);
    // dents and scuffs
    for (let k = 0; k < 6 + R() * 10; k++) {
      g.fillStyle = R() < 0.5 ? rgb(40, 28, 16, 0.25) : rgb(200, 176, 140, 0.18);
      g.fillRect(x + R() * w, y + R() * h, 2 + R() * 8, 1 + R() * 1.5);
    }
    g.restore();
  }

  /** A nail head: a dark round head, a rust run below it. */
  function nail(x, y, r = 2.6) {
    const rust = g.createLinearGradient(x, y, x, y + 14);
    rust.addColorStop(0, rgb(110, 52, 24, 0.45));
    rust.addColorStop(1, rgb(110, 52, 24, 0));
    g.fillStyle = rust;
    g.fillRect(x - r * 0.7, y, r * 1.4, 14);
    const hg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    hg.addColorStop(0, rgb(120, 110, 100));
    hg.addColorStop(0.5, rgb(46, 40, 36));
    hg.addColorStop(1, rgb(20, 18, 16));
    g.fillStyle = hg;
    g.beginPath();
    g.arc(x, y, r, 0, 6.29);
    g.fill();
  }

  /** Stencilled text: a cut stencil sprayed on, soft-edged, with the bridges of the letters and wear through it. */
  function stencil(text, cx, cy, size, ink, o = {}) {
    const font = o.font ?? `900 ${size}px 'Arial Black', Impact, sans-serif`;
    const t = document.createElement("canvas");
    const pad = size;
    g.font = font;
    const tw = Math.ceil(g.measureText(text).width) + pad * 2;
    const th = Math.ceil(size * 1.6) + pad;
    t.width = tw;
    t.height = th;
    const q = t.getContext("2d");
    q.font = font;
    q.textBaseline = "middle";
    q.fillStyle = ink;
    const sx = o.maxW && tw - pad * 2 > o.maxW ? o.maxW / (tw - pad * 2) : 1;
    // letter by letter: each letter's bridges (the stencil's ties) cut out
    let x = pad;
    const spacing = o.spacing ?? size * 0.06;
    const widths = [...text].map((ch) => q.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
    q.save();
    q.translate(tw / 2, 0);
    q.scale(sx, 1);
    q.translate(-tw / 2, 0);
    x = tw / 2 - total / 2;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      q.fillText(ch, x, th / 2);
      const wch = widths[i];
      // the ties: thin gaps where a stencil holds its counters (O, D, Q, 0, B, P, R, A, 4, 6, 8, 9)
      if ("ODQ0CG".includes(ch)) {
        q.clearRect(x + wch / 2 - size * 0.035, th / 2 - size * 0.62, size * 0.07, size * 0.42);
        q.clearRect(x + wch / 2 - size * 0.035, th / 2 + size * 0.2, size * 0.07, size * 0.42);
      } else if ("BPR869A&".includes(ch)) {
        q.clearRect(x + wch * 0.42, th / 2 - size * 0.62, size * 0.07, size * 0.4);
      }
      x += wch + spacing;
    }
    q.restore();
    // sprayed: the ink a little thin in places, worn through where hands and ropes went
    const im = q.getImageData(0, 0, tw, th);
    const d = im.data;
    const nx = R() * 100, ny = R() * 100;
    for (let py = 0; py < th; py++)
      for (let px = 0; px < tw; px++) {
        const i = (py * tw + px) * 4 + 3;
        if (!d[i]) continue;
        const n = noise(nx + px / 6, ny + py / 6) * 0.6 + noise(nx + px / 1.4, ny + py / 1.4) * 0.4;
        const keep = Math.max(0, Math.min(1, (n - (o.wear ?? 0.3)) * 3.2));
        d[i] = d[i] * (0.55 + 0.45 * keep) * (o.alpha ?? 0.9);
      }
    q.putImageData(im, 0, 0);
    g.save();
    g.filter = "blur(0.6px)";
    g.drawImage(t, cx - tw / 2, cy - th / 2);
    g.filter = "none";
    // a faint overspray round the letters
    g.globalAlpha = 0.12;
    g.filter = "blur(2.5px)";
    g.drawImage(t, cx - tw / 2, cy - th / 2);
    g.restore();
  }

  /** The merchant's mark: a stencilled diamond with his letters in it. */
  function mark(text, cx, cy, r, ink) {
    g.save();
    g.strokeStyle = ink;
    g.globalAlpha = 0.85;
    g.lineWidth = r * 0.14;
    g.filter = "blur(0.6px)";
    g.beginPath();
    g.moveTo(cx, cy - r);
    g.lineTo(cx + r * 1.15, cy);
    g.lineTo(cx, cy + r);
    g.lineTo(cx - r * 1.15, cy);
    g.closePath();
    g.stroke();
    // the ties at the corners
    g.clearRect;
    g.restore();
    stencil(text, cx, cy + r * 0.04, r * (text.length > 2 ? 0.62 : 0.8), ink, { maxW: r * 1.5, font: `bold ${Math.round(r * (text.length > 2 ? 0.62 : 0.8))}px Georgia, 'Times New Roman', serif` });
  }

  // ---------------------------------------------------------------- the fronts and backs, per goods
  const bpx = Math.round(G.hb * PPM);
  const gpx = G.gap * PPM;
  const sideFaces = (ox, oy, k, back) => {
    // boards from the top of the strip (the lid's foot) down to the skids; the top board the most handled, the low one dirty
    const tones = [];
    for (let i = 0; i < G.boards; i++) {
      const top = oy + Math.round(i * (G.hb + G.gap) * PPM);
      board(ox, top, strip[0], bpx + 1, { dirt: i === G.boards - 1 ? 0.55 : i === G.boards - 2 ? 0.2 : 0.05, knots: undefined });
      tones.push(top);
    }
    // the gaps: dark (the inside), never sampled but kept dark for the far mips
    for (let i = 1; i < G.boards; i++) {
      const y = oy + Math.round(i * (G.hb + G.gap) * PPM - gpx);
      g.fillStyle = "#1a130c";
      g.fillRect(ox, y, strip[0], Math.max(1, Math.round(gpx)));
    }
    // the end cleats' side faces at both ends of the strip (x beyond the body)
    const cw = Math.round(G.cleatT * PPM);
    for (const x0 of [ox, ox + strip[0] - cw]) board(x0, oy, cw, strip[1], { knots: 0, base: [128, 98, 64], dirt: 0.15 });
    // nails: two at each end of each board, into the end boards behind
    for (let i = 0; i < G.boards; i++) {
      const top = oy + Math.round(i * (G.hb + G.gap) * PPM);
      for (const x of [ox + cw + 6, ox + strip[0] - cw - 6]) {
        nail(x + (R() - 0.5) * 2, top + bpx * 0.28);
        nail(x + (R() - 0.5) * 2, top + bpx * 0.72);
      }
    }
    // the stencil
    const gd = goods[k];
    const cx = ox + strip[0] / 2;
    const cy = oy + strip[1] / 2;
    if (!back) {
      stencil(gd.what, cx + strip[0] * 0.1, cy - strip[1] * 0.12, gd.what.length > 8 ? 52 : 64, gd.ink, { maxW: strip[0] * 0.58 });
      stencil(gd.from, cx + strip[0] * 0.1, cy + strip[1] * 0.2, 30, gd.ink, { maxW: strip[0] * 0.5, font: `bold 30px Georgia, 'Times New Roman', serif`, spacing: 3 });
      mark(gd.mark, ox + strip[0] * 0.14, cy - strip[1] * 0.05, 30, gd.ink);
      stencil(gd.no, ox + strip[0] * 0.14, cy + strip[1] * 0.3, 20, gd.ink, { font: `bold 20px Georgia, serif` });
    } else {
      mark(gd.mark, cx, cy - strip[1] * 0.12, 46, gd.ink);
      stencil(gd.to, cx, cy + strip[1] * 0.22, 26, gd.ink, { maxW: strip[0] * 0.6, font: `bold 26px Georgia, 'Times New Roman', serif`, spacing: 2 });
      stencil(gd.no, ox + strip[0] * 0.84, cy - strip[1] * 0.12, 22, gd.ink, { font: `bold 22px Georgia, serif` });
      if (gd.care) stencil(gd.care, cx, oy + strip[1] * 0.1, 18, "#5c1d14", { maxW: strip[0] * 0.5, spacing: 2 });
    }
    // shipping grime over it all: a chalked tally now and then, a wet line at the foot
    if (R() < 0.5) {
      g.save();
      g.strokeStyle = "rgba(225,220,205,0.35)";
      g.lineWidth = 2;
      const tx = ox + strip[0] * (back ? 0.12 : 0.8), ty = oy + strip[1] * 0.66;
      for (let j = 0; j < 4; j++) {
        g.beginPath();
        g.moveTo(tx + j * 7, ty);
        g.lineTo(tx + j * 7 + 2, ty + 18);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(tx - 4, ty + 14);
      g.lineTo(tx + 28, ty + 4);
      g.stroke();
      g.restore();
    }
  };
  goods.forEach((_, k) => {
    sideFaces(cells[k].front[0], cells[k].front[1], k, false);
    sideFaces(cells[k].back[0], cells[k].back[1], k, true);
  });

  // ---------------------------------------------------------------- the planks (lid, ends, cleats, skids)
  planks.forEach(([x, y], k) => {
    const dark = k >= 30; // the skids and the underside: darker, dirtier
    board(x, y, plank[0], plank[1], { base: dark ? [110, 84, 56] : k % 3 === 0 ? [150, 118, 80] : [140, 110, 74], dirt: dark ? 0.6 : 0.08 + R() * 0.1, grey: 0.2 + R() * 0.35 });
    // nail heads along both ends (where a lid board meets its cleat, an end board its cleats)
    for (const nx of [x + 14, x + plank[0] - 14]) {
      nail(nx, y + plank[1] * 0.3);
      nail(nx, y + plank[1] * 0.7);
    }
  });

  // ---------------------------------------------------------------- end grain, iron, rope, straw, the dark inside
  {
    const [x, y, w, h] = regions.endgrain;
    g.fillStyle = rgb(118, 88, 56);
    g.fillRect(x, y, w, h);
    for (let r = 2; r < w * 1.4; r += 3 + R() * 4) {
      g.strokeStyle = rgb(70, 48, 28, 0.25 + R() * 0.25);
      g.lineWidth = 1 + R();
      g.beginPath();
      g.arc(x - w * 0.3, y + h * 1.2, r, 0, 6.29);
      g.stroke();
    }
    for (let k = 0; k < 900; k++) {
      g.fillStyle = rgb(40, 28, 16, R() * 0.3);
      g.fillRect(x + R() * w, y + R() * h, 1, 1 + R() * 2);
    }
  }
  {
    // black iron with rust, rivets every 40 px
    const [x, y, w, h] = regions.iron;
    g.fillStyle = rgb(38, 34, 31);
    g.fillRect(x, y, w, h);
    const img = g.getImageData(x, y, w, h);
    const d = img.data;
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const n = noise(px / 12 + 40, py / 12) * 0.6 + noise(px / 3 + 90, py / 3) * 0.4;
        const rust = Math.max(0, (n - 0.5) * 2.4);
        d[i] = d[i] * (1 - rust) + 112 * rust + (n - 0.5) * 20;
        d[i + 1] = d[i + 1] * (1 - rust) + 54 * rust + (n - 0.5) * 18;
        d[i + 2] = d[i + 2] * (1 - rust) + 26 * rust + (n - 0.5) * 16;
      }
    g.putImageData(img, x, y);
    for (let px = 20; px < w; px += 40)
      for (const py of [h * 0.3, h * 0.7]) {
        const hg = g.createRadialGradient(x + px - 1, y + py - 1, 0, x + px, y + py, 5);
        hg.addColorStop(0, rgb(130, 120, 110));
        hg.addColorStop(1, rgb(24, 22, 20));
        g.fillStyle = hg;
        g.beginPath();
        g.arc(x + px, y + py, 5, 0, 6.29);
        g.fill();
      }
  }
  {
    // hemp rope: a three-strand lay along u
    const [x, y, w, h] = regions.rope;
    g.fillStyle = rgb(150, 124, 84);
    g.fillRect(x, y, w, h);
    for (let px = -h; px < w + h; px += 10) {
      const lg = g.createLinearGradient(x + px, y, x + px + h * 0.6, y + h);
      lg.addColorStop(0, rgb(90, 70, 44, 0.75));
      lg.addColorStop(0.5, rgb(184, 156, 110, 0.3));
      lg.addColorStop(1, rgb(80, 62, 40, 0.75));
      g.strokeStyle = lg;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x + px, y);
      g.lineTo(x + px + h * 0.6, y + h);
      g.stroke();
    }
    for (let k = 0; k < 400; k++) {
      g.fillStyle = rgb(210, 190, 150, R() * 0.4);
      g.fillRect(x + R() * w, y + R() * h, 2 + R() * 4, 1);
    }
  }
  {
    // packing straw: pale stalks every way over dark
    const [x, y, w, h] = regions.straw;
    g.fillStyle = rgb(70, 56, 30);
    g.fillRect(x, y, w, h);
    for (let k = 0; k < 2600; k++) {
      const a = R() * 6.28;
      const L = 12 + R() * 40;
      const px = x + R() * w, py = y + R() * h;
      const v = 0.55 + R() * 0.45;
      g.strokeStyle = rgb(196 * v, 168 * v, 98 * v, 0.85);
      g.lineWidth = 1 + R() * 1.6;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
      g.stroke();
    }
  }
  {
    const [x, y, w, h] = regions.dark;
    g.fillStyle = rgb(26, 20, 14);
    g.fillRect(x, y, w, h);
  }
  {
    // the inside of a board: rough sawn, darker, no weathering
    const [x, y, w, h] = regions.inside;
    board(x, y, w, h, { base: [104, 80, 52], grey: 0.05, knots: 2, dirt: 0.25 });
  }
  return c.toDataURL("image/jpeg", 0.9);
}

// ------------------------------------------------------------------ Chrome

const port = 9330 + Math.floor(Math.random() * 30);
const profile = mkdtempSync(path.join(tmpdir(), "crate-sheet-"));
const exe = opt("chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const chrome = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const guard = setTimeout(() => {
  console.error("crate_sheet: timed out");
  chrome.kill();
  process.exit(2);
}, 180_000);
try {
  let t = null;
  for (let i = 0; i < 40 && !t; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      t = list.find((x) => x.type === "page") ?? null;
    } catch {
      /* not up yet */
    }
    if (!t) await sleep(500);
  }
  if (!t) throw new Error("Chrome did not start");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const r = await new Promise((res) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) res(m);
    };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(${paint.toString()})(${JSON.stringify(layout)}, ${JSON.stringify(CRATE_GOODS)})`, returnByValue: true, awaitPromise: true } }));
  });
  ws.close();
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  const url = r.result.result.value;
  writeFileSync(path.join(outDir, "crate_sheet.jpg"), Buffer.from(url.split(",")[1], "base64"));
  writeFileSync(path.join(outDir, "crate_sheet.json"), JSON.stringify(layout, null, 1));
  console.log(`crate_sheet: ${CRATE_GOODS.length} goods, ${W}x${H} -> ${path.join(outDir, "crate_sheet.jpg")}`);
} finally {
  clearTimeout(guard);
  chrome.kill();
  await sleep(600);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* a locked profile file */
  }
}
process.exit(0);
