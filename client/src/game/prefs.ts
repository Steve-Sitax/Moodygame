// The settings' store (Steve, 2026-09-23: "change resolution so we can try higher res"; 2026-09-26:
// "Changeable controls, graphic settings possible for worse hardware systems? Other menu stuff you can
// think of?"). Kept in the browser (localStorage), applied at once. The menu that shows it is
// menu/menu.ts, mounted by game/settings.ts. Default (Steve, 2026-09-27): 720 lines, no wobble.
//
// Other parts read a setting with `settings.get("lightBudget")` and hear changes with
// `settings.onChange(fn)`; nothing outside the menu writes them.

export interface GameSettings {
  /** Render height in pixels: 720 by default, 270 is the PS1 look; 0 = the full window. */
  height: number;
  /** 5-bit colour with ordered dither (the PS1 colour). */
  psxColour: boolean;
  /** Vertex wobble (the PS1 snap to the pixel grid). */
  wobble: boolean;
  /** M6 population: how many townspeople walk in the street round Jef at once. */
  street: StreetLevel;
}

/**
 * M6 population (Steve, 2026-09-24: "More people in game ... Make it adjustable how many people
 * we have in a game"). "People in the street": the most townspeople drawn and walking round Jef
 * at once (game/town.ts); event people come on top. Frame times: docs/milestones/M6-population.md.
 */
export type StreetLevel = "few" | "normal" | "many" | "crowded";
export const STREET_LEVELS: Record<StreetLevel, { label: string; cap: number }> = {
  few: { label: "Few", cap: 20 },
  normal: { label: "Normal", cap: 50 }, // 34 before M6; measured: about 1 ms more a frame at the busiest spots
  many: { label: "Many", cap: 75 },
  crowded: { label: "Crowded", cap: 100 },
};

export type Preset = "low" | "medium" | "high" | "custom";
export type Level3 = "low" | "medium" | "high";

/** Everything the menu keeps. The first four are GameSettings (main.ts applies those). */
export interface Prefs extends GameSettings {
  // ---- graphics
  preset: Preset;
  /** Render scale of the chosen height, 0.5 .. 1. */
  scale: number;
  /** View distance: the fog's far end times this (0.6 .. 1.2); the culler draws nothing past it. */
  view: number;
  /** Small rooms (taverns, shops, homes) drawn through their windows and doors at once (InWorld.budget). */
  rooms: number;
  /** Planar mirrors (the river, the puddles). */
  reflections: "off" | "coarse" | "full";
  /** The lantern that throws shadows. */
  shadows: boolean;
  /** Light spilt from windows and lamps: how many lights are worked out per pixel (world/spill.ts). */
  lightBudget: Level3;
  /** Leaves, birds, moths, mist, drips (world/alive). */
  particles: "off" | "some" | "all";
  /** Frames a second at most (0: as many as the screen shows). */
  frameCap: number;
  /** The frame time in the corner. */
  showFps: boolean;
  /** The first run's short benchmark has chosen a preset. */
  benchDone: boolean;
  // ---- sound (0 .. 1)
  master: number;
  music: number;
  ambience: number;
  voices: number;
  effects: number;
  // ---- controls (the keys themselves: menu/keys.ts)
  /** Mouse speed, times the game's own (0.25 .. 3). */
  sens: number;
  invertY: boolean;
  /** Field of view, degrees (vertical). */
  fov: number;
  headBob: boolean;
  // ---- game
  /** Speech bubbles over heads, times their size. */
  bubbles: number;
  /** An autosave every this many game hours (0: only when the tab closes). */
  autosave: number;
  /** The round map in the top right corner while you play (Steve, 2026-09-27: off by default). */
  miniMap: "off" | "small" | "large";
  language: "en";
  // ---- accessibility
  /** All text on screen, times its size. */
  textSize: number;
  contrast: boolean;
  reduceMotion: boolean;
  colourSafe: boolean;
}

export const HEIGHTS: Array<[number, string]> = [
  [270, "270 lines (the old PS1 look)"],
  [360, "360 lines"],
  [540, "540 lines"],
  [720, "720 lines"],
  [1080, "1080 lines"],
  [0, "Full window"],
];

/** What each preset sets. "high" is the game as it was before presets. */
export const PRESETS: Record<Exclude<Preset, "custom">, Partial<Prefs>> = {
  low: { height: 270, scale: 0.75, view: 0.7, rooms: 1, street: "few", reflections: "off", shadows: false, lightBudget: "low", particles: "off", frameCap: 30 },
  medium: { height: 540, scale: 1, view: 0.85, rooms: 2, street: "normal", reflections: "coarse", shadows: true, lightBudget: "medium", particles: "some", frameCap: 60 },
  high: { height: 720, scale: 1, view: 1, rooms: 4, street: "normal", reflections: "full", shadows: true, lightBudget: "high", particles: "all", frameCap: 0 },
};
export const PRESET_KEYS = Object.keys(PRESETS.high) as Array<keyof Prefs>;

export const DEFAULTS: Prefs = {
  height: 720,
  psxColour: true,
  wobble: false,
  street: "normal",
  preset: "high",
  scale: 1,
  view: 1,
  rooms: 4,
  reflections: "full",
  shadows: true,
  lightBudget: "high",
  particles: "all",
  frameCap: 0,
  showFps: false,
  benchDone: false,
  master: 1,
  music: 1,
  ambience: 1,
  voices: 1,
  effects: 1,
  sens: 1,
  invertY: false,
  fov: 75,
  headBob: true,
  bubbles: 1,
  autosave: 1,
  miniMap: "off",
  language: "en",
  textSize: 1,
  contrast: false,
  reduceMotion: false,
  colourSafe: false,
};

const KEY = "scheldemist.settings";
/** Set once the old defaults (270 lines, wobble on) were moved to the new ones (Steve, 2026-09-27). */
const LOOK_KEY = "scheldemist.settings.look720";
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const one = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

function read(): Prefs {
  let raw: Partial<Prefs> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
  } catch {
    /* a broken store: the defaults */
  }
  const d = DEFAULTS;
  try {
    // once: a store from before 2026-09-27 still holds the old defaults; move it to the new ones
    if (!localStorage.getItem(LOOK_KEY)) {
      if (raw.height === 270 && raw.preset !== "low") raw.height = 720;
      raw.wobble = false;
      localStorage.setItem(LOOK_KEY, "1");
      if (localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(raw));
    }
  } catch {
    /* private mode: the defaults */
  }
  return {
    height: HEIGHTS.some(([h]) => h === raw.height) ? (raw.height as number) : d.height,
    psxColour: bool(raw.psxColour, d.psxColour),
    wobble: bool(raw.wobble, d.wobble),
    street: typeof raw.street === "string" && Object.hasOwn(STREET_LEVELS, raw.street) ? raw.street : d.street,
    preset: one(raw.preset, ["low", "medium", "high", "custom"] as const, d.preset),
    scale: num(raw.scale, 0.5, 1, d.scale),
    view: num(raw.view, 0.6, 1.2, d.view),
    rooms: Math.round(num(raw.rooms, 0, 8, d.rooms)),
    reflections: one(raw.reflections, ["off", "coarse", "full"] as const, d.reflections),
    shadows: bool(raw.shadows, d.shadows),
    lightBudget: one(raw.lightBudget, ["low", "medium", "high"] as const, d.lightBudget),
    particles: one(raw.particles, ["off", "some", "all"] as const, d.particles),
    frameCap: [0, 30, 45, 60, 90, 120, 144].includes(raw.frameCap as number) ? (raw.frameCap as number) : d.frameCap,
    showFps: bool(raw.showFps, d.showFps),
    benchDone: bool(raw.benchDone, d.benchDone),
    master: num(raw.master, 0, 1, d.master),
    music: num(raw.music, 0, 1, d.music),
    ambience: num(raw.ambience, 0, 1, d.ambience),
    voices: num(raw.voices, 0, 1, d.voices),
    effects: num(raw.effects, 0, 1, d.effects),
    sens: num(raw.sens, 0.25, 3, d.sens),
    invertY: bool(raw.invertY, d.invertY),
    fov: Math.round(num(raw.fov, 55, 100, d.fov)),
    headBob: bool(raw.headBob, d.headBob),
    bubbles: num(raw.bubbles, 0.7, 1.8, d.bubbles),
    autosave: [0, 1, 2, 4].includes(raw.autosave as number) ? (raw.autosave as number) : d.autosave,
    miniMap: one(raw.miniMap, ["off", "small", "large"] as const, d.miniMap),
    language: "en",
    textSize: num(raw.textSize, 0.8, 1.6, d.textSize),
    contrast: bool(raw.contrast, d.contrast),
    reduceMotion: bool(raw.reduceMotion, d.reduceMotion),
    colourSafe: bool(raw.colourSafe, d.colourSafe),
  };
}

let prefs: Prefs = read();
const listeners: Array<(p: Prefs, changed: Array<keyof Prefs>) => void> = [];

function write(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // private mode: the settings last until the page closes
  }
}

/** The settings' store. */
export const settings = {
  get<K extends keyof Prefs>(k: K): Prefs[K] {
    return prefs[k];
  },
  all(): Prefs {
    return { ...prefs };
  },
  /** Change some; saved and applied at once. A graphics key set by hand makes the preset "custom". */
  set(part: Partial<Prefs>, opts: { keepPreset?: boolean } = {}): void {
    const changed = (Object.keys(part) as Array<keyof Prefs>).filter((k) => part[k] !== prefs[k]);
    if (!changed.length) return;
    prefs = { ...prefs, ...part };
    if (!opts.keepPreset && !("preset" in part) && changed.some((k) => PRESET_KEYS.includes(k))) {
      prefs.preset = "custom";
      changed.push("preset");
    }
    write();
    for (const f of listeners) f(prefs, changed);
  },
  preset(p: Exclude<Preset, "custom">): void {
    settings.set({ ...PRESETS[p], preset: p });
  },
  /** Back to the defaults (one tab's keys, or all). The first-run benchmark is not run again. */
  reset(keys?: Array<keyof Prefs>): void {
    const part: Partial<Prefs> = {};
    for (const k of keys ?? (Object.keys(DEFAULTS) as Array<keyof Prefs>)) if (k !== "benchDone") (part as Record<string, unknown>)[k] = DEFAULTS[k];
    settings.set(part, { keepPreset: true });
  },
  onChange(f: (p: Prefs, changed: Array<keyof Prefs>) => void): void {
    listeners.push(f);
  },
};
