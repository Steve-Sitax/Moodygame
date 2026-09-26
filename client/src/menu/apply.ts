// Menus (2026-09-26): the settings put to work. main.ts hands over the parts once they are made
// (`wireSettings`, one marked hook there); from then on every change in the menu reaches the game at
// once. What each setting changes is written next to it in game/settings.ts; here is how.

import type * as THREE from "three";
import { settings, STREET_LEVELS, type Prefs } from "../game/prefs";
import { look } from "../player/firstPerson";
import { setMirrorQuality } from "../world/mirror";
import { pause, real } from "../game/pause";
import { tuning } from "./tuning";
import type { MixKind } from "../audio/soundscape";

export interface SettingsDeps {
  retro: { renderHeight: number; resize(aspect: number, windowHeight?: number): void; height: number };
  camera: THREE.PerspectiveCamera;
  /** InWorld: how many small rooms are drawn through their openings. */
  inWorld: { budget: number };
  /** LanternLights: the one lantern light that throws shadows. */
  lanternLights: { shadows: boolean };
  /** The small life of the town (world/alive): parts on and off by name. */
  alive: { setOn(on: boolean, name?: string): string[]; parts: Array<{ name: string }> };
  /** The soundscape, once the game has been entered (null before). */
  sound(): { setMix?(l: Partial<Record<MixKind, number>>): void; speaker: GainNode } | null;
  /** The town: its people in the street. */
  town: { maxPuppets: number };
  /** main.ts's resize (the render target, the wobble grid, the mirrors). */
  resize(): void;
}

// ------------------------------------------------------------------ frames: the cap and the frame time

/** The game's frames, measured: work time (ms of script a frame) and frames a second, while playing. */
export const frameStats = { fps: 0, work: 0, interval: 0, samples: 0 };
let cap = 0;
{
  // Every requestAnimationFrame goes through here: a callback waits for the next screen refresh
  // that keeps the cap, and its time is measured (the game's frame is main.ts's one callback).
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  let nextId = 1;
  const live = new Map<number, number>();
  let lastFrame = 0;
  let frameTs = -1;
  let workNow = 0;
  let lastTs = 0;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    const tick = (ts: number) => {
      const step = cap > 0 ? 1000 / cap : 0;
      if (step && ts - lastFrame < step - 1.5 && ts !== frameTs) {
        live.set(id, raf(tick));
        return;
      }
      live.delete(id);
      if (ts !== frameTs) {
        // a new screen frame: book the last one
        if (frameTs > 0 && !pause.paused && document.visibilityState === "visible") {
          const iv = ts - lastTs;
          if (iv > 0 && iv < 500) {
            const k = frameStats.samples < 30 ? 0.3 : 0.05;
            frameStats.interval += (iv - frameStats.interval) * k;
            frameStats.work += (workNow - frameStats.work) * k;
            frameStats.fps = 1000 / Math.max(1, frameStats.interval);
            frameStats.samples++;
            if (document.pointerLockElement) bench?.(iv, workNow);
          }
        }
        lastTs = frameTs > 0 ? frameTs : ts;
        frameTs = ts;
        // the cap keeps its average on a faster screen (144 Hz capped at 60 gives 60, not 48)
        lastFrame = step ? Math.max(lastFrame + step, ts - step) : ts;
        workNow = 0;
      }
      const t0 = real.now();
      try {
        cb(ts);
      } finally {
        workNow += real.now() - t0;
      }
    };
    live.set(id, raf(tick));
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    const r = live.get(id);
    if (r !== undefined) caf(r);
    live.delete(id);
  };
}

// ------------------------------------------------------------------ the first run's benchmark

/**
 * First run (Steve: "graphic settings possible for worse hardware systems"): the first 5 seconds of
 * play (the mouse in the game, past the first frames of new shaders), the frames are timed and a preset chosen: 42 frames a second or better stays
 * High, 24 or better Medium, slower Low. The player is told, and can change it in Settings.
 */
let bench: ((interval: number, work: number) => void) | null = null;
const benchListeners: Array<(preset: "low" | "medium" | "high", fps: number) => void> = [];
export function onBenchmark(f: (preset: "low" | "medium" | "high", fps: number) => void): void {
  benchListeners.push(f);
}
/** Run the benchmark on the next seconds of play (the first run, or "Test this computer again"). */
export function runBenchmark(): void {
  const ivs: number[] = [];
  let skip = 45; // the first frames after a start are the shaders' and the textures' (not the computer's pace)
  bench = (iv) => {
    if (skip-- > 0) return;
    ivs.push(iv);
    if (ivs.length < 240 && ivs.reduce((a, b) => a + b, 0) < 5000) return;
    bench = null;
    ivs.sort((a, b) => a - b);
    const median = ivs[Math.floor(ivs.length / 2)];
    const fps = 1000 / median;
    const preset = fps >= 42 ? "high" : fps >= 24 ? "medium" : "low";
    settings.preset(preset);
    settings.set({ benchDone: true }, { keepPreset: true });
    for (const f of benchListeners) f(preset, Math.round(fps));
  };
}
export function benchmarkRunning(): boolean {
  return bench !== null;
}

// ------------------------------------------------------------------ the frame time in the corner

let fpsEl: HTMLDivElement | null = null;
real.setInterval(() => {
  if (!settings.get("showFps")) {
    if (fpsEl) fpsEl.style.display = "none";
    return;
  }
  if (!fpsEl) {
    fpsEl = document.createElement("div");
    fpsEl.className = "fps-note";
    document.body.appendChild(fpsEl);
  }
  fpsEl.style.display = "";
  fpsEl.textContent = frameStats.samples ? `${Math.round(frameStats.fps)} fps · ${frameStats.interval.toFixed(1)} ms · script ${frameStats.work.toFixed(1)} ms` : "-- fps";
}, 500);

// ------------------------------------------------------------------ the page: text size, contrast, motion

function applyPage(p: Prefs): void {
  const root = document.documentElement;
  root.style.setProperty("--text", String(p.textSize));
  root.style.setProperty("--bubble", String(p.bubbles));
  root.classList.toggle("hi-contrast", p.contrast);
  root.classList.toggle("calm", p.reduceMotion);
  root.classList.toggle("colour-safe", p.colourSafe);
  cap = p.frameCap;
  tuning.viewFar = p.view;
  look.sens = p.sens;
  look.invertY = p.invertY;
  look.bob = p.headBob && !p.reduceMotion ? 1 : 0;
  setMirrorQuality(p.reflections);
}
applyPage(settings.all());
settings.onChange((p) => applyPage(p));

// ------------------------------------------------------------------ the game's parts

/** The alive parts that go first on "some" (the many small ones), and all on "off" but the few that are lights. */
const SOME_OFF = ["leaves", "moths", "mist", "drips", "breath", "bilge"];
const ALWAYS = ["buoys", "shipLights", "storm"];

let lastBudget = "";
async function spillBudget(level: Prefs["lightBudget"]): Promise<void> {
  if (level === lastBudget) return;
  lastBudget = level;
  // the light spill (world/spill.ts) is its own part: set through its own knob when it is there
  const mods = import.meta.glob<{ setSpillBudget?: (perPixel: number, bars?: boolean) => void; spillBudget?: () => { max: number } }>("../world/spill.ts");
  const load = Object.values(mods)[0];
  if (!load) return;
  const m = await load();
  const max = m.spillBudget?.().max ?? 32;
  m.setSpillBudget?.(level === "low" ? 8 : level === "medium" ? 16 : max, level !== "low");
}

export function wireSettings(d: SettingsDeps): void {
  // render scale: the chosen lines times the scale (the full window too)
  const resize0 = d.retro.resize.bind(d.retro);
  d.retro.resize = (aspect: number, windowHeight?: number) => {
    const s = settings.get("scale");
    const keep = d.retro.renderHeight;
    const wh = windowHeight ?? 270;
    if (s >= 0.999) return resize0(aspect, windowHeight);
    if (keep > 0) d.retro.renderHeight = Math.max(90, Math.round(Math.min(keep, wh) * s));
    try {
      resize0(aspect, keep > 0 ? wh : Math.max(90, Math.round(wh * s)));
    } finally {
      d.retro.renderHeight = keep;
    }
  };
  let speakerBase: number | null = null;
  const apply = (p: Prefs, changed: Array<keyof Prefs> | null) => {
    const has = (...k: Array<keyof Prefs>) => !changed || k.some((q) => changed.includes(q));
    if (has("rooms")) d.inWorld.budget = p.rooms;
    if (has("shadows")) d.lanternLights.shadows = p.shadows;
    if (has("street")) d.town.maxPuppets = STREET_LEVELS[p.street].cap;
    if (has("fov")) {
      d.camera.fov = p.fov;
      d.camera.updateProjectionMatrix();
    }
    if (has("particles")) {
      const names = d.alive.parts.map((q) => q.name);
      for (const n of names) d.alive.setOn(p.particles === "all" || ALWAYS.includes(n) || (p.particles === "some" && !SOME_OFF.includes(n)), n);
    }
    if (has("lightBudget")) void spillBudget(p.lightBudget).catch(() => {});
    if (has("scale", "reflections")) d.resize();
    const snd = d.sound();
    if (snd && has("master", "music", "ambience", "voices", "effects")) {
      // the master rides on the speaker's own level: a test copy's speaker stays at 0 (never unmuted here)
      speakerBase ??= snd.speaker.gain.value;
      snd.speaker.gain.value = speakerBase * p.master;
      snd.setMix?.({ music: p.music, ambience: p.ambience, voices: p.voices, effects: p.effects });
    }
  };
  apply(settings.all(), null);
  settings.onChange((p, changed) => apply(p, changed));
  // the soundscape is made on the first click: its levels then
  let wired = false;
  real.setInterval(() => {
    if (wired || !d.sound()) return;
    wired = true;
    apply(settings.all(), ["master"]);
  }, 500);
  if (!settings.get("benchDone")) runBenchmark();
}
