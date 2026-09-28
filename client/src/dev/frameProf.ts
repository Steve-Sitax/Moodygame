// The frame profiler (2026-09-28, the slow frames): the time of each part of the frame, for
// __scheldemist.frameProf() (main.ts). Off, it costs one boolean test per part.

const now = (): number => performance.now();

interface Part {
  sum: number;
  max: number;
  n: number;
  list: number[];
}

export const prof = {
  on: false,
  parts: new Map<string, Part>(),
  add(name: string, ms: number): void {
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = { sum: 0, max: 0, n: 0, list: [] }));
    p.sum += ms;
    p.n++;
    if (ms > p.max) p.max = ms;
    p.list.push(ms);
  },
  reset(): void {
    this.parts.clear();
  },
};

/** Time one part when the profiler runs; else just run it. */
export function pt<T>(name: string, fn: () => T): T {
  if (!prof.on) return fn();
  const t0 = now();
  try {
    return fn();
  } finally {
    prof.add(name, now() - t0);
  }
}

const q = (a: number[], f: number): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * f))];
};

/** The parts, most costly first: mean, p95 and max ms per frame over `frames` frames. */
export function profTable(frames: number, top = 40): Array<{ part: string; mean: number; p95: number; max: number }> {
  const r = [...prof.parts.entries()].map(([part, p]) => ({
    part,
    mean: +(p.sum / Math.max(1, frames)).toFixed(3),
    p95: +q(p.list, 0.95).toFixed(2),
    max: +p.max.toFixed(2),
  }));
  r.sort((a, b) => b.mean - a.mean);
  return r.slice(0, top);
}

export function quantiles(a: number[]): { p50: number; p95: number; p99: number; max: number; mean: number } {
  const mean = a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  return { p50: +q(a, 0.5).toFixed(2), p95: +q(a, 0.95).toFixed(2), p99: +q(a, 0.99).toFixed(2), max: +q(a, 1).toFixed(2), mean: +mean.toFixed(2) };
}

/**
 * Dev: the draw calls of a few frames by where they come from (the scene's top group and the one under it),
 * by pass (the main view, each mirror, the rooms, the lantern's shadow), with triangles and materials.
 */
export async function drawAudit(
  renderer: import("three").WebGLRenderer,
  frame: () => void,
  opts: { frames?: number; depth?: number; top?: number } = {},
): Promise<{ perFrame: number; byPass: Record<string, number>; groups: Array<{ group: string; calls: number; ktris: number; mats: number; objs: number; static: number }> }> {
  const frames = opts.frames ?? 10;
  const depth = opts.depth ?? 2;
  const r = renderer as unknown as { renderBufferDirect: (...a: unknown[]) => void };
  const orig = r.renderBufferDirect;
  const groups = new Map<string, { calls: number; tris: number; mats: Set<string>; objs: Set<number>; stat: Set<number> }>();
  const byPass: Record<string, number> = {};
  let total = 0;
  const name = (o: { name: string; type: string }) => o.name || o.type;
  r.renderBufferDirect = function (this: unknown, ...a: unknown[]) {
    const [camera, , geometry, material, object] = a as [
      { name?: string; isPerspectiveCamera?: boolean; isCamera?: boolean; type: string },
      unknown,
      { index: { count: number } | null; attributes: { position?: { count: number } }; drawRange: { count: number } },
      { uuid: string },
      import("three").Object3D & { count?: number; isInstancedMesh?: boolean },
    ];
    total++;
    const chain: string[] = [];
    for (let x: import("three").Object3D | null = object; x; x = x.parent) chain.unshift(name(x));
    const key = chain.slice(0, depth + 1).join(" / ");
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { calls: 0, tris: 0, mats: new Set(), objs: new Set(), stat: new Set() }));
    g.calls++;
    const n = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0);
    g.tris += (Math.min(n, geometry.drawRange.count) / 3) * (object.isInstancedMesh ? (object.count ?? 1) : 1);
    g.mats.add(material.uuid);
    g.objs.add(object.id);
    if (!object.matrixAutoUpdate) g.stat.add(object.id);
    const pass = (camera as { userData?: { pass?: string } }).userData?.pass ?? (camera.type === "CubeCamera" ? "shadow" : camera.name || camera.type);
    byPass[pass] = (byPass[pass] ?? 0) + 1;
    return orig.apply(this, a);
  };
  try {
    for (let i = 0; i < frames; i++) {
      await Promise.resolve();
      frame();
    }
  } finally {
    r.renderBufferDirect = orig;
  }
  for (const k in byPass) byPass[k] = Math.round(byPass[k] / frames);
  const out = [...groups.entries()]
    .map(([group, g]) => ({ group, calls: Math.round(g.calls / frames), ktris: Math.round(g.tris / frames / 1000), mats: g.mats.size, objs: g.objs.size, static: g.stat.size }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, opts.top ?? 60);
  return { perFrame: Math.round(total / frames), byPass, groups: out };
}

/**
 * Dev: the same moment drawn with `a` then with `b` (nothing moves in between), the scene's picture (the retro target)
 * compared: how many pixels differ and by how much. A speed change that keeps the picture must give 0.
 */
export function pixelDiff(
  renderer: import("three").WebGLRenderer,
  target: import("three").WebGLRenderTarget,
  draw: () => void,
  a: () => void,
  b: () => void,
  frames = 3,
): { w: number; h: number; differ: number; maxDelta: number; firstAt: number[] | null } {
  const w = target.width;
  const h = target.height;
  const read = () => {
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
    return px;
  };
  a();
  for (let i = 0; i < frames; i++) draw();
  const pa = read();
  b();
  for (let i = 0; i < frames; i++) draw();
  const pb = read();
  let differ = 0;
  let maxDelta = 0;
  let firstAt: number[] | null = null;
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
    if (d) {
      differ++;
      if (d > maxDelta) maxDelta = d;
      if (!firstAt) firstAt = [(i / 4) % w, Math.floor(i / 4 / w)];
    }
  }
  return { w, h, differ, maxDelta, firstAt };
}
