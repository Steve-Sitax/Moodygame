import { psxUniforms } from "../retro/psx";

// Where the puddles are, worked out here the same way the ground shader does it
// (retro/psx.ts option puddles: pudHash, pudVal, the stretch, the threshold and the cut), so a
// step in a puddle splashes. The hash is worked in 32-bit floats as the graphics card does it:
// in doubles its fract of a large product came out a different number, and the splash sounded
// in dry places while the puddle beside it stayed silent (the puddles, 2026-09-27).

const f32 = Math.fround;
const fract = (x: number) => f32(x - Math.floor(x));
const K1 = f32(123.34);
const K2 = f32(456.21);
const K3 = f32(45.32);

function pudHash(ix: number, iy: number): number {
  let px = fract(f32(ix * K1));
  let py = fract(f32(iy * K2));
  const d = f32(f32(px * f32(px + K3)) + f32(py * f32(py + K3)));
  px = f32(px + d);
  py = f32(py + d);
  return fract(f32(px * py));
}

function pudVal(x: number, y: number): number {
  x = f32(x);
  y = f32(y);
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

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The paving's own puddle factor at (x, z) (world/city.ts sets it from the ground's kinds), or undefined. */
let scaleAt: ((x: number, z: number) => number | undefined) | null = null;
export function setPuddleScale(fn: (x: number, z: number) => number | undefined): void {
  scaleAt = fn;
}

/**
 * How much water lies under (x, z): 0 dry .. 1 in a puddle, the same puddles the ground shows (retro/psx.ts option
 * puddles: the noise, the level, and the finer noise that cuts them into puddles a few metres across, which the
 * splash did not know; only the stones that stand out at a shallow edge are the shader's own). `scale` is the
 * paving's puddle factor where the ground's kinds do not say (cobbles 1, quay 1.15, earth 1.3, flagstones 0.75).
 */
export function puddleAt(x: number, z: number, scale = 1): number {
  const s = scaleAt?.(x, z) ?? scale;
  let pn = pudVal(x / 17, z / 17) * 0.55 + pudVal(x / 7.3 + 31.7, z / 7.3 + 31.7) * 0.3 + pudVal(x / 2.9 - 12.1, z / 2.9 - 12.1) * 0.15;
  pn = Math.min(1, Math.max(0, (pn - 0.5) * 2.4 + 0.5));
  const lvl = Math.min(1, Math.max(0, psxUniforms.uPuddle.value * s));
  const th = 0.97 - lvl * 0.22;
  if (pn <= th) return 0;
  return smooth(th, th + 0.018, pn) * smooth(0.46, 0.56, pudVal(x / 2.1 + 57.1, z / 2.1 + 57.1)) * smooth(0.3, 0.42, pudVal(x / 4.7 - 23.9, z / 4.7 - 23.9));
}
