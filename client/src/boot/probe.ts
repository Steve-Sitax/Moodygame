import type * as THREE from "three";

// Boot numbers (the loading screen, 2026-09-26): how long the start takes and where the first
// minute hitches. Cheap enough to run always: one rAF callback that reads three counters.
//   __scheldemistBoot.report()   the marks (ms from the page's start), the frames over 50 ms after the
//                                game was entered and what came with each (new shaders, textures,
//                                geometries, files that finished, notes), and a summary.
// Measuring a production build: add ?probe to the address for enter() and walk().

type Hitch = { t: number; dt: number; since: number; programs: number; textures: number; geometries: number; files: string[]; notes: string[] };

const marks: Record<string, number> = {};
const notes: Array<{ t: number; what: string }> = [];
const files: Array<{ t: number; name: string }> = [];
const frames: Array<{ t: number; dt: number; programs: number; textures: number; geometries: number }> = [];
let renderer: THREE.WebGLRenderer | null = null;
let enteredAt = -1;
let walking = false;

const now = () => +performance.now().toFixed(1);

/** A moment of the start, kept once (the first time). */
export function bootMark(name: string): void {
  if (name in marks) return;
  marks[name] = Math.round(performance.now());
  try {
    performance.mark(`scheldemist:${name}`);
  } catch {
    /* old browsers */
  }
}

/** Something that happened now, for the hitch list. */
export function bootNote(what: string): void {
  notes.push({ t: now(), what });
}

try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      const r = e as PerformanceResourceTiming;
      if (files.length > 5000) return;
      files.push({ t: +r.responseEnd.toFixed(1), name: r.name.replace(location.origin, "") });
    }
  }).observe({ type: "resource", buffered: true });
} catch {
  /* no resource timing */
}

let last = performance.now();
/** Frames kept: the first minutes only (then the probe stops: nothing runs for it in a long game). */
const MAX_FRAMES = 40000;
function tick(): void {
  if (frames.length >= MAX_FRAMES) return;
  requestAnimationFrame(tick);
  const t = performance.now();
  const info = renderer?.info;
  frames.push({
    t: +t.toFixed(1),
    dt: +(t - last).toFixed(1),
    programs: info?.programs?.length ?? 0,
    textures: info?.memory.textures ?? 0,
    geometries: info?.memory.geometries ?? 0,
  });
  last = t;
}
requestAnimationFrame(tick);
bootMark("js");

export type ProbeHooks = {
  renderer: THREE.WebGLRenderer;
  /** Into the game without a click (as the dev kit's free(true)). */
  enter: () => void;
  /** Walk on (W held) and turn slowly; null stops. */
  drive: (on: boolean, turn: number) => void;
};
let hooks: ProbeHooks | null = null;

function hitches(from: number, to: number, over = 50): Hitch[] {
  const out: Hitch[] = [];
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i];
    if (f.t < from || f.t > to || f.dt <= over) continue;
    const p = frames[i - 1];
    const a = f.t - f.dt - 20;
    out.push({
      t: Math.round(f.t),
      dt: f.dt,
      since: Math.round(f.t - from),
      programs: f.programs - p.programs,
      textures: f.textures - p.textures,
      geometries: f.geometries - p.geometries,
      files: files.filter((x) => x.t >= a && x.t <= f.t).map((x) => x.name.replace(/\?.*$/, "")).slice(0, 8),
      notes: notes.filter((x) => x.t >= a && x.t <= f.t).map((x) => x.what),
    });
  }
  return out;
}

export const bootProbe = {
  marks,
  attach(h: ProbeHooks): void {
    hooks = h;
    renderer = h.renderer;
  },
  /** Enter the game now (the probe's own timing starts here). */
  enter(): number {
    hooks?.enter();
    enteredAt = performance.now();
    bootMark("entered");
    return Math.round(enteredAt);
  },
  /** Walk for `seconds` real seconds, turning a little: resolves when done. */
  walk(seconds = 60, turn = 0.35): Promise<void> {
    if (!hooks || walking) return Promise.resolve();
    walking = true;
    hooks.drive(true, turn);
    return new Promise((r) =>
      setTimeout(() => {
        hooks?.drive(false, 0);
        walking = false;
        r();
      }, seconds * 1000),
    );
  },
  report(windowS = 60, over = 50) {
    const from = enteredAt >= 0 ? enteredAt : 0;
    const to = from + windowS * 1000;
    const list = hitches(from, to, over);
    // the first frame after entering, and from when on the frames ran smooth (30 in a row under 50 ms)
    let first = -1;
    let smooth = -1;
    let run = 0;
    for (const f of frames) {
      if (f.t <= from) continue;
      if (first < 0) first = f.t;
      run = f.dt <= 50 ? run + 1 : 0;
      if (run === 30) {
        smooth = f.t - 30 * 16.7;
        break;
      }
    }
    const inWindow = frames.filter((f) => f.t > from && f.t <= to);
    // playable: from here on a whole second with no frame over 100 ms
    let playable = -1;
    for (let i = 0; i < inWindow.length && playable < 0; i++) {
      const s = inWindow[i].t - inWindow[i].dt;
      let ok = true;
      let j = i;
      for (; j < inWindow.length && inWindow[j].t <= s + 1000; j++) if (inWindow[j].dt > 100) ok = false;
      if (ok && j < inWindow.length) playable = Math.max(s, from);
    }
    return {
      marks: { ...marks },
      firstFrameAfterEnter: Math.round(first),
      playableAt: Math.round(playable),
      smoothFrom: Math.round(smooth),
      frames: inWindow.length,
      hitches: list.length,
      worst: list.reduce((m, h) => Math.max(m, h.dt), 0),
      over100: list.filter((h) => h.dt > 100).length,
      programsAtEnter: frames.find((f) => f.t > from)?.programs ?? 0,
      programsAtEnd: inWindow.at(-1)?.programs ?? 0,
      list,
    };
  },
  /** Every frame over `over` ms since the page began (the loading itself). */
  loadingHitches(over = 50) {
    return hitches(0, enteredAt >= 0 ? enteredAt : performance.now(), over);
  },
  notes,
  /** Every frame kept: its time, its length and the renderer's counts then. */
  frameList: () => frames,
};

if (import.meta.env.DEV || /[?&]probe\b/.test(location.search)) {
  (window as unknown as Record<string, unknown>).__scheldemistBoot = bootProbe;
}
