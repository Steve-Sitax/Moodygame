import { psxUniforms } from "../retro/psx";

// Where the puddles are, worked out here the same way the ground shader does it
// (retro/psx.ts option puddles: pudHash, pudVal, the stretch and the threshold), so a
// step in a puddle can splash. The GPU's float maths differs a hair at the edges; fine.

const fract = (x: number) => x - Math.floor(x);

function pudHash(ix: number, iy: number): number {
  let px = fract(ix * 123.34);
  let py = fract(iy * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
}

function pudVal(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = pudHash(ix, iy);
  const b = pudHash(ix + 1, iy);
  const c = pudHash(ix, iy + 1);
  const d = pudHash(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/**
 * How wet the ground is under (x, z): 0 dry .. 1 in a puddle. `scale` is the paving's own
 * puddle factor (cobbles 1, earth 1.3, flagstones 0.75).
 */
export function puddleAt(x: number, z: number, scale = 1): number {
  let pn = pudVal(x / 17, z / 17) * 0.55 + pudVal(x / 7.3 + 31.7, z / 7.3 + 31.7) * 0.3 + pudVal(x / 2.9 - 12.1, z / 2.9 - 12.1) * 0.15;
  pn = Math.min(1, Math.max(0, (pn - 0.5) * 2.4 + 0.5));
  const lvl = Math.min(1, Math.max(0, psxUniforms.uPuddle.value * scale));
  const th = 0.97 - lvl * 0.22;
  if (pn <= th) return 0;
  return Math.min(1, (pn - th) / 0.018);
}
