// Changeable controls (Steve 2026-09-26: "Changeable controls"). The game's parts listen for fixed key
// codes (KeyE, KeyW ...), a hundred places in twenty files. Rather than teach each one a binding, this
// module sits in front of them all: a capture listener on the window, registered before any other
// (main.ts imports this first), turns the key pressed into the code of the action it is bound to.
// Bound "use" to R: R reaches the game as KeyE, and E (now free) as nothing; bindings are always a
// permutation (binding a key that another action holds swaps the two), so no two actions share a key.
// Keys typed into a text box are left alone. Esc, Enter, the digits (choices), F-keys and the arrows
// (a second set of walking keys) are fixed.
//
// It also: shows the bound key's name (`keyLabel`, the key's letter on the player's own keyboard
// layout where the browser tells it), puts that name into the key hints on screen, and hands the
// menu the keyboard while it is up (the arrows move between the items there, not Jef).

export type ActionId =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "hurry"
  | "crouch"
  | "jump"
  | "use"
  | "second"
  | "third"
  | "fourth"
  | "talk"
  | "buy"
  | "haggle"
  | "lantern"
  | "map"
  | "pockets"
  | "pause"
  | "newWeek";

export interface ActionDef {
  id: ActionId;
  /** The code the game listens for (the default key). */
  code: string;
  label: string;
  /** What else the key does in some places (the help line under it). */
  also?: string;
  group: "Walking" | "Hands" | "Talks" | "Screens";
}

export const ACTIONS: ActionDef[] = [
  { id: "forward", code: "KeyW", label: "Walk forward", also: "row forward; in a talk: take the work", group: "Walking" },
  { id: "back", code: "KeyS", label: "Walk back", also: "row back, brake", group: "Walking" },
  { id: "left", code: "KeyA", label: "Step left", also: "turn the boat", group: "Walking" },
  { id: "right", code: "KeyD", label: "Step right", also: "turn the boat", group: "Walking" },
  { id: "hurry", code: "ShiftLeft", label: "Hurry", also: "a hard stroke when rowing or swimming (right Shift too)", group: "Walking" },
  { id: "crouch", code: "KeyC", label: "Crouch", also: "left Ctrl too", group: "Walking" },
  { id: "jump", code: "Space", label: "Jump", group: "Walking" },
  { id: "use", code: "KeyE", label: "Use, take, talk to", also: "the first thing the hint offers", group: "Hands" },
  { id: "second", code: "KeyF", label: "Second choice", also: "fill, lift, fight", group: "Hands" },
  { id: "third", code: "KeyG", label: "Third choice", also: "give, sing along", group: "Hands" },
  { id: "fourth", code: "KeyR", label: "Fourth choice", also: "run from trouble, hurry home", group: "Hands" },
  { id: "lantern", code: "KeyL", label: "Lantern on or off", group: "Hands" },
  { id: "talk", code: "KeyT", label: "Say something", also: "type a line in a talk", group: "Talks" },
  { id: "buy", code: "KeyB", label: "Buy", also: "in a talk with a seller", group: "Talks" },
  { id: "haggle", code: "KeyH", label: "Haggle or leave", also: "in a talk; shout for help", group: "Talks" },
  { id: "map", code: "KeyM", label: "Map", group: "Screens" },
  { id: "pockets", code: "KeyI", label: "Pockets", group: "Screens" },
  { id: "pause", code: "KeyP", label: "Pause", also: "pay, when a gang asks", group: "Screens" },
  { id: "newWeek", code: "KeyN", label: "New week", also: "on the sheet at the end of the week", group: "Screens" },
];

const DEFAULTS: Record<ActionId, string> = Object.fromEntries(ACTIONS.map((a) => [a.id, a.code])) as Record<ActionId, string>;
/** Keys no action may take: they have their own fixed jobs. */
export const FIXED = /^(Escape|Enter|NumpadEnter|Tab|Digit\d|Numpad\d|F\d+|Arrow\w+|Backspace|MetaLeft|MetaRight|ContextMenu|PrintScreen|CapsLock|NumLock|ScrollLock)$/;

const KEY = "scheldemist.keys";
let binding: Record<ActionId, string> = { ...DEFAULTS };
/** Pressed code -> the code the game hears ("" = nothing). Empty when every key is its default. */
let remap = new Map<string, string>();
const listeners: Array<() => void> = [];

function rebuild(): void {
  remap = new Map();
  let same = true;
  for (const a of ACTIONS) if (binding[a.id] !== a.code) same = false;
  if (same) return;
  // a default key no action holds any more: it does nothing
  const bound = new Set(Object.values(binding));
  for (const a of ACTIONS) if (!bound.has(a.code)) remap.set(a.code, "");
  for (const a of ACTIONS) remap.set(binding[a.id], a.code);
}

function load(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<ActionId, string>>;
    const next = { ...DEFAULTS };
    const used = new Set<string>();
    for (const a of ACTIONS) {
      const c = raw[a.id];
      if (typeof c === "string" && c && !FIXED.test(c) && !used.has(c)) next[a.id] = c;
    }
    // a broken store (two actions on one key): the defaults
    const vals = Object.values(next);
    binding = new Set(vals).size === vals.length ? next : { ...DEFAULTS };
  } catch {
    binding = { ...DEFAULTS };
  }
  rebuild();
}

function store(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(binding));
  } catch {
    /* private mode: for this page only */
  }
  rebuild();
  for (const f of listeners) f();
}

export const keys = {
  get(id: ActionId): string {
    return binding[id];
  },
  all(): Record<ActionId, string> {
    return { ...binding };
  },
  isDefault(): boolean {
    return remap.size === 0;
  },
  /** Bind an action to a key; the action that held that key gets this one's old key. */
  set(id: ActionId, code: string): { swapped: ActionId | null } {
    if (FIXED.test(code)) return { swapped: null };
    const old = binding[id];
    const other = (Object.keys(binding) as ActionId[]).find((k) => k !== id && binding[k] === code) ?? null;
    binding[id] = code;
    if (other) binding[other] = old;
    store();
    return { swapped: other };
  },
  reset(): void {
    binding = { ...DEFAULTS };
    store();
  },
  onChange(f: () => void): void {
    listeners.push(f);
  },
};

// ------------------------------------------------------------------ names of keys

/** The player's keyboard layout (Chrome tells it): the letter printed on each key. */
let layout: Map<string, string> | null = null;
{
  const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  kb?.getLayoutMap?.()
    .then((m) => {
      layout = new Map(m);
      for (const f of listeners) f();
    })
    .catch(() => {});
}

const NAMES: Record<string, string> = {
  Space: "Space",
  ShiftLeft: "Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Alt",
  AltRight: "Alt Gr",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  IntlBackslash: "<",
  Insert: "Ins",
  Delete: "Del",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/** The name on the key with this code (a physical key). */
export function codeName(code: string): string {
  if (!code) return "-";
  const l = layout?.get(code);
  if (l && l.trim() && l.length === 1 && !NAMES[code]?.includes(" ")) return l.toUpperCase();
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** The key to show for a code the game listens for ("KeyE" -> the key "use" is bound to now). */
export function keyLabel(gameCode: string): string {
  const a = ACTIONS.find((q) => q.code === gameCode);
  return codeName(a ? binding[a.id] : gameCode);
}

// ------------------------------------------------------------------ the remap, first of all key listeners

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) && (el as HTMLInputElement).type !== "range" && (el as HTMLInputElement).type !== "checkbox";
};

/** The menu's claim on the keyboard (menu/menu.ts): a key it takes goes no further. */
let menuKeys: ((e: KeyboardEvent) => boolean) | null = null;
export function onMenuKey(f: (e: KeyboardEvent) => boolean): void {
  menuKeys = f;
}

function onKey(e: KeyboardEvent): void {
  if (e.type === "keydown" && menuKeys?.(e)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    return;
  }
  if (!remap.size || editable(e.target)) return;
  const to = remap.get(e.code);
  if (to === undefined) return;
  // the game reads e.code (and e.key only for digits and + -, which are never remapped)
  Object.defineProperty(e, "code", { value: to, configurable: true });
  if (/^Key[A-Z]$/.test(to)) Object.defineProperty(e, "key", { value: to.slice(3).toLowerCase(), configurable: true });
}
window.addEventListener("keydown", onKey, true);
window.addEventListener("keyup", onKey, true);

// ------------------------------------------------------------------ the key hints on screen

// The hints written in the game's text ("E close", "B buy, H haggle") name the default keys. With other
// bindings (or another layout), each lone capital letter of a default key in a hint line is written as
// the key bound now. The action prompt (game/jobs.ts) asks keyLabel itself and is not touched here.
const HINTS = ".keys, .hint, .resume-hint, .pockets .key, .talk .keys, .board .keys, .pause-card .keys";
const written = new WeakMap<Text, string>();
function letterMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of ACTIONS) {
    if (!/^Key[A-Z]$/.test(a.code)) continue;
    const now = keyLabel(a.code);
    if (now !== a.code.slice(3)) m.set(a.code.slice(3), now);
  }
  return m;
}
let letters = new Map<string, string>();
function fixText(t: Text): void {
  if (!letters.size || written.get(t) === t.data) return;
  const el = t.parentElement;
  if (!el || !el.closest(HINTS) || el.closest(".prompt, .menu-sheet, .bound-keys")) return;
  const orig = t.data;
  const out = orig.replace(/(^|[\s/(·,:])([A-Z])(?=$|[\s/),·:.])/g, (all, pre: string, ch: string) => (letters.has(ch) ? pre + letters.get(ch) : all));
  written.set(t, out);
  if (out !== orig) t.data = out;
}
function fixTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) fixText(n as Text);
}
let watching: MutationObserver | null = null;
function watchHints(): void {
  letters = letterMap();
  if (!letters.size) {
    watching?.disconnect();
    watching = null;
    return;
  }
  if (!document.body) return void window.addEventListener("DOMContentLoaded", watchHints, { once: true });
  fixTree(document.body);
  if (watching) return;
  watching = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") fixText(m.target as Text);
      else for (const n of m.addedNodes) fixTree(n);
    }
  });
  watching.observe(document.body, { subtree: true, childList: true, characterData: true });
}
keys.onChange(watchHints);

load();
watchHints();
