// Fallen leaves painted on a canvas (survey finding 23, 2026-10-11: the leaves round the trees and outside the wall were
// 2 x 1 pixel flecks, read up close as big orange squares). A real leaf: the plane's five pointed lobes round the stalk,
// or the lime's heart; its own autumn colour, darker toward the curled rim, the veins a little lighter. Shared by the
// tree pits (world/vegetation.ts) and the leaves outside the wall (world/rampartNature.ts).

/** Autumn colours of plane and lime leaves (sRGB 0..255). */
export const LEAF_COLOURS: Array<[number, number, number]> = [[138, 74, 24], [168, 106, 32], [110, 58, 20], [184, 138, 48], [122, 48, 16], [150, 120, 40], [94, 58, 26]];

const LOBES: Array<[number, number]> = [[0, 1], [0.85, 0.8], [-0.85, 0.8], [1.7, 0.5], [-1.7, 0.5]];

/**
 * One leaf at (x, y), `len` pixels long, turned `turn` radians, colour `rgb` times `k` (under 1: an old one, rotting).
 * `plane`: the plane's palmate leaf, else the lime's heart.
 */
export function drawLeaf(g: CanvasRenderingContext2D, x: number, y: number, len: number, turn: number, rgb: [number, number, number], k: number, plane: boolean): void {
  const [cr, cg, cb] = rgb;
  g.save();
  g.translate(x, y);
  g.rotate(turn);
  g.beginPath();
  if (plane) {
    for (let s = 0; s <= 48; s++) {
      const t = -Math.PI + (s / 48) * Math.PI * 2;
      let lobe = 0;
      for (const [ti, li] of LOBES) lobe = Math.max(lobe, li * Math.exp(-(((t - ti) / 0.46) ** 2)));
      const rr = Math.abs(t) > 2.45 ? 0.12 : 0.5 * (0.48 + 0.52 * lobe);
      const px = Math.sin(t) * rr * len;
      const py = -Math.cos(t) * rr * len;
      if (s === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  } else {
    const L = len * 0.55;
    g.moveTo(0, -L);
    g.bezierCurveTo(L * 0.7, -L * 0.4, L * 0.75, L * 0.6, 0.05 * L, L * 0.55);
    g.bezierCurveTo(-L * 0.75, L * 0.6, -L * 0.7, -L * 0.4, 0, -L);
  }
  g.closePath();
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, len * 0.55);
  grad.addColorStop(0, `rgb(${cr * k},${cg * k},${cb * k})`);
  grad.addColorStop(1, `rgb(${cr * k * 0.62},${cg * k * 0.55},${cb * k * 0.5})`);
  g.fillStyle = grad;
  g.fill();
  // the midrib and the stalk, the plane's two side veins
  g.strokeStyle = `rgba(${Math.min(255, cr * k * 1.15)},${Math.min(255, cg * k * 1.12)},${cb * k},0.8)`;
  g.lineWidth = Math.max(0.6, len / 24);
  g.beginPath();
  g.moveTo(0, len * 0.3);
  g.lineTo(0, -len * 0.42);
  if (plane)
    for (const sd of [-1, 1]) {
      g.moveTo(0, 0);
      g.lineTo(sd * len * 0.36, -len * 0.25);
    }
  g.stroke();
  g.restore();
}

/**
 * `n` leaves strewn round (cx, cy) out to `radius` pixels (thick in the middle, thinning out), `len` their length range
 * in pixels; the first third laid lie under the others, darker.
 */
export function strewLeaves(g: CanvasRenderingContext2D, r: () => number, cx: number, cy: number, radius: number, n: number, len: [number, number], spread = 0.5): void {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), spread) * radius;
    const plane = r() < 0.6;
    const l = (len[0] + (len[1] - len[0]) * r()) * (plane ? 1 : 0.8);
    const k = (i < n * 0.35 ? 0.6 : 1) * (0.85 + r() * 0.3);
    drawLeaf(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, l, r() * Math.PI * 2, LEAF_COLOURS[Math.floor(r() * LEAF_COLOURS.length)], k, plane);
  }
}
