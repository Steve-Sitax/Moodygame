import * as THREE from "three";
import { DataUtils } from "three";
import type { RetroPass } from "../retro/retroPass";
import { psxUniforms } from "../retro/psx";

// The fog check (dev, `await __scheldemist.fogcheck()`; night fog, 2026-09-26, Steve: "at night I see shadow
// outlines, that is weird. Objects are dark and should not be visible"). Far houses and trees showed as lighter
// flat shapes against a darker sky: fogged all the way, they were lighter than the sky just above them.
//
// It draws the view three times into the retro target (linear colour) and reads the pixels:
//   A: as the game draws it;
//   B: the sky dome hidden, a magenta background (the sky's pixels), the fog colour lifted by DELTA: each
//      pixel's change is DELTA x its fog factor, so B - A gives how fogged every pixel is (alpha-tested leaf
//      cards, billboards and water included, as drawn);
//   C: the lamps' in-scatter off (uScatter 0): A - C is the glow the air adds to each pixel.
// Then along every column, where the sky meets a thing below it (a roof, a tree top), it compares the thing
// (2 px under the edge) with the sky (2 px over it). A spot is listed when the thing is fogged past `minFog`
// and lighter than the sky by more than `tol` (relative, on luminance) plus a floor of one 8-bit sRGB step.
// A far thing with light of its own (a lamp's halo sprite, a lit window, a lantern) is counted under `lights`, not
// as a problem. `problems` lists the worst spots; it must be empty at night (at any hour, in fact).
// `pick: [x0, y0, x1, y1]` (retro pixels) names what draws a spot: each part of the scene hidden in turn.
// `lightSources`: every lit lamp, lantern, glow and lit room within the far glow's reach and how it reads from here
// (world/spill.ts lights(), world/farGlow.ts); its `problems` (lit, far, showing nothing) must be empty too.

export interface FogCheckOpts {
  /** Camera at `from` looking at `to` (world metres); without them, the game's camera as it is. */
  from?: [number, number, number];
  to?: [number, number, number];
  /** How fogged (0..1) a thing must be to count as far. */
  minFog?: number;
  /** How much lighter (relative luminance) a far thing may be than the sky above it. */
  tol?: number;
  /** How many spots to list. */
  list?: number;
  /** Also post the picture (PNG) to this URL as { name, url } (a dev receiver), under `name`. */
  post?: string;
  name?: string;
  /** Retro pixels [x0, y0, x1, y1]: which parts of the scene draw there (each hidden in turn). */
  pick?: [number, number, number, number];
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  retro: RetroPass;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** world.update(t, dt, camera): the sky dome and the water follow the camera. */
  update?: (cam: THREE.Camera) => void;
  /** The town's lights in sight and how each reads from far (world/spill.ts lights()). */
  lights?: (cam: THREE.Camera) => { reach: number; lit: number; by: Record<string, number>; rows: string[]; problems: string[] };
}

const DELTA = 0.25;
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgb = (v: number) => Math.round(255 * THREE.MathUtils.clamp(v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055, 0, 1));
const hex = (c: number[]) => "#" + c.slice(0, 3).map((v) => srgb(v).toString(16).padStart(2, "0")).join("");

function read(ctx: Ctx): Float32Array {
  const t = ctx.retro.target;
  const n = t.width * t.height * 4;
  const out = new Float32Array(n);
  if (t.texture.type === THREE.HalfFloatType) {
    const h = new Uint16Array(n);
    ctx.renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, h);
    for (let i = 0; i < n; i++) out[i] = DataUtils.fromHalfFloat(h[i]);
  } else {
    const b = new Uint8Array(n);
    ctx.renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, b);
    for (let i = 0; i < n; i++) out[i] = b[i] / 255;
  }
  return out;
}

export async function fogCheck(ctx: Ctx, opts: FogCheckOpts = {}) {
  const { minFog = 0.85, tol = 0.04, list = 12 } = opts;
  const cam = ctx.camera;
  const keep = { p: cam.position.clone(), q: cam.quaternion.clone() };
  if (opts.from && opts.to) {
    cam.position.set(...opts.from);
    cam.lookAt(...opts.to);
    cam.updateMatrixWorld();
    ctx.update?.(cam);
  }
  const scene = ctx.scene;
  const fog = scene.fog as THREE.Fog;
  const sky = scene.getObjectByName("cloud_sky");
  const time = psxUniforms.uTime.value;
  const W = ctx.retro.target.width;
  const H = ctx.retro.target.height;

  // A: as drawn
  ctx.retro.render(scene, cam, time);
  let png: string | null = null;
  if (opts.post) png = ctx.canvas.toDataURL("image/png");
  const A = read(ctx);
  // the lights in sight from here, and how each reads (its glass, a halo, the far glow, or nothing)
  const lightsSeen = ctx.lights?.(cam) ?? null;

  // B: the fog factor and the sky's pixels
  const keepFog = fog.color.clone();
  const keepBg = scene.background;
  const keepSky = sky?.visible ?? false;
  fog.color.setRGB(keepFog.r + DELTA, keepFog.g + DELTA, keepFog.b + DELTA);
  scene.background = new THREE.Color(1, 0, 1);
  if (sky) sky.visible = false;
  let B: Float32Array;
  try {
    ctx.retro.render(scene, cam, time);
    B = read(ctx);
  } finally {
    fog.color.copy(keepFog);
    scene.background = keepBg;
    if (sky) sky.visible = keepSky;
  }

  // C: no lamp glow in the air
  const keepScatter = psxUniforms.uScatter.value;
  psxUniforms.uScatter.value = 0;
  let C: Float32Array;
  try {
    ctx.retro.render(scene, cam, time);
    C = read(ctx);
  } finally {
    psxUniforms.uScatter.value = keepScatter;
  }
  // the screen as it was
  ctx.retro.render(scene, cam, time);
  cam.position.copy(keep.p);
  cam.quaternion.copy(keep.q);
  cam.updateMatrixWorld();
  if (opts.from) ctx.update?.(cam);

  // what draws a spot: `pick` [x0, y0, x1, y1] (retro pixels): each part of the scene hidden in turn, what changes it
  let picked: string[] | null = null;
  if (opts.pick) {
    const [x0, y0, x1, y1] = opts.pick;
    const regionL = (P: Float32Array) => {
      let s = 0;
      let n = 0;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = ((H - 1 - y) * W + x) * 4;
          s += lum(P[i], P[i + 1], P[i + 2]);
          n++;
        }
      return s / Math.max(1, n);
    };
    const moved = !!opts.from;
    if (moved) {
      cam.position.set(...opts.from!);
      cam.lookAt(...opts.to!);
      cam.updateMatrixWorld();
    }
    ctx.retro.render(scene, cam, time);
    const base = regionL(read(ctx));
    const parts: THREE.Object3D[] = [];
    for (const c of scene.children) {
      if (!c.visible) continue;
      if (c.children.length > 1 && c.children.length < 80) parts.push(...c.children.filter((k) => k.visible));
      else parts.push(c);
    }
    const found: [number, string][] = [];
    for (const p of parts) {
      p.visible = false;
      try {
        ctx.retro.render(scene, cam, time);
        const l = regionL(read(ctx));
        if (Math.abs(l - base) > base * 0.03) {
          const m = (p as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          const m0 = Array.isArray(m) ? m[0] : m;
          found.push([l - base, `${p.parent?.name ? p.parent.name + "/" : ""}${p.name || p.type} (${m0 ? `${m0.type} ${m0.name}${m0.userData?.psx ? " psx" : ""}` : "group"}) ${(l - base).toFixed(4)}`]);
        }
      } finally {
        p.visible = true;
      }
    }
    picked = found.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).map((f) => `base ${base.toFixed(4)}: ${f[1]}`);
    ctx.retro.render(scene, cam, time);
    if (moved) {
      cam.position.copy(keep.p);
      cam.quaternion.copy(keep.q);
      cam.updateMatrixWorld();
    }
  }

  // pixel helpers; readPixels rows run bottom up: row 0 of the picture is H - 1
  const at =(x: number, y: number) => ((H - 1 - y) * W + x) * 4;
  const isSky = (x: number, y: number) => {
    const i = at(x, y);
    return B[i] > 0.9 && B[i + 1] < 0.1 && B[i + 2] > 0.9;
  };
  const fogOf = (x: number, y: number) => {
    const i = at(x, y);
    return THREE.MathUtils.clamp((B[i + 1] - A[i + 1]) / DELTA, 0, 1);
  };
  const L = (P: Float32Array, x: number, y: number) => {
    const i = at(x, y);
    return lum(P[i], P[i + 1], P[i + 2]);
  };
  const rgb = (P: Float32Array, x: number, y: number) => {
    const i = at(x, y);
    return [P[i], P[i + 1], P[i + 2]];
  };

  // sky: its lowest pixels per column (the horizon over things), 8 px higher, and the top row
  const acc = () => ({ n: 0, c: [0, 0, 0] });
  const add = (a: ReturnType<typeof acc>, c: number[]) => {
    a.n++;
    for (let k = 0; k < 3; k++) a.c[k] += c[k];
  };
  const mean = (a: ReturnType<typeof acc>) => (a.n ? a.c.map((v) => v / a.n) : null);
  const skyLow = acc();
  const skyUp = acc();
  const skyTop = acc();
  const farThing = acc();
  const glowFar = acc();
  const glowSky = acc();
  let skyPx = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (isSky(x, y)) {
        skyPx++;
        const i = at(x, y);
        add(glowSky, [A[i] - C[i], A[i + 1] - C[i + 1], A[i + 2] - C[i + 2]]);
        if (y === 0) add(skyTop, rgb(A, x, y));
      } else if (fogOf(x, y) > 0.97) {
        const i = at(x, y);
        add(farThing, rgb(A, x, y));
        add(glowFar, [A[i] - C[i], A[i + 1] - C[i + 1], A[i + 2] - C[i + 2]]);
      }
    }

  // the edges: sky over a thing
  const floor = 1 / 255;
  let edges = 0;
  let farEdges = 0;
  const spots: { x: number; y: number; thing: string; sky: string; fog: number; lighter: number }[] = [];
  // a far thing with light of its own on it (a lamp's halo, a lit window, a lantern: added light, not the fog) is
  // no ghost: without the air's glow (C) it is still lighter than the fog's colour would make it
  const lights: { x: number; y: number }[] = [];
  const fogL = lum(keepFog.r, keepFog.g, keepFog.b);
  let worst = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 2; y < H - 3; y++) {
      if (!isSky(x, y) || !isSky(x, y - 1) || isSky(x, y + 1) || isSky(x, y + 2)) continue;
      edges++;
      if (y + 8 < H) add(skyLow, rgb(A, x, y));
      if (y - 8 >= 0 && isSky(x, y - 8)) add(skyUp, rgb(A, x, y - 8));
      const f = (fogOf(x, y + 1) + fogOf(x, y + 2)) / 2;
      if (f < minFog) continue;
      farEdges++;
      const thing = (L(A, x, y + 1) + L(A, x, y + 2)) / 2;
      const skyL = (L(A, x, y) + L(A, x, y - 1)) / 2;
      const tS = srgb(thing) / 255;
      const sS = srgb(skyL) / 255;
      const lighter = (tS - sS) / Math.max(sS, 1e-4);
      worst = Math.max(worst, lighter);
      if (tS - sS > floor && lighter > tol) {
        const own = (L(C, x, y + 1) + L(C, x, y + 2)) / 2 - fogL * f;
        if (srgb(fogL * f + Math.max(0, own)) - srgb(fogL * f) > 2) {
          lights.push({ x, y });
          continue;
        }
        spots.push({ x, y, thing: hex(rgb(A, x, y + 1)), sky: hex(rgb(A, x, y)), fog: +f.toFixed(2), lighter: +lighter.toFixed(3) });
      }
    }
  }
  spots.sort((a, b) => b.lighter - a.lighter);
  // a spot is one edge pixel: group them by 16 px column bands so the list names places, not pixels
  const bands = new Map<number, (typeof spots)[number]>();
  for (const s of spots) if (!bands.has(s.x >> 4)) bands.set(s.x >> 4, s);

  let posted: string | null = null;
  if (opts.post && png) {
    try {
      const r = await fetch(opts.post, { method: "POST", body: JSON.stringify({ name: opts.name ?? "fogcheck", url: png }) });
      posted = r.ok ? await r.text() : `failed ${r.status}`;
    } catch (e) {
      posted = `failed ${String(e)}`;
    }
  }
  const f = (a: ReturnType<typeof acc>) => {
    const m = mean(a);
    return m ? `${hex(m)} (L ${lum(m[0], m[1], m[2]).toFixed(4)})` : "-";
  };
  const g = (a: ReturnType<typeof acc>) => {
    const m = mean(a);
    return m ? +lum(m[0], m[1], m[2]).toFixed(4) : 0;
  };
  return {
    size: `${W}x${H}`,
    fog: { colour: `${hex([keepFog.r, keepFog.g, keepFog.b])} (L ${lum(keepFog.r, keepFog.g, keepFog.b).toFixed(4)})`, near: +fog.near.toFixed(1), far: +fog.far.toFixed(1) },
    sky: { horizon: f(skyLow), above8px: f(skyUp), top: f(skyTop), share: +(skyPx / (W * H)).toFixed(2) },
    farThings: f(farThing),
    glow: { farThings: g(glowFar), sky: g(glowSky) },
    edges,
    farEdges,
    lighterSpots: spots.length,
    worst: +worst.toFixed(3),
    problems: [...bands.values()].slice(0, list).map((s) => `x ${s.x} y ${s.y}: far thing ${s.thing} over sky ${s.sky}, ${Math.round(s.lighter * 100)}% lighter (fog ${s.fog})`),
    lights: lights.length,
    /** the town's lights in sight: how many read which way; `problems` lit ones that show nothing from here */
    lightSources: lightsSeen,
    picked,
    posted,
  };
}
