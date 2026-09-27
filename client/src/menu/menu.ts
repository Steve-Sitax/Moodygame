// The menus (Steve 2026-09-26: "Changeable controls, graphic settings possible for worse hardware
// systems? Other menu stuff you can think of? Make sure the menus look nice ... Fonts included in
// game, not system"). The title and pause paper (#start in index.html, kept by main.ts) becomes a
// printed handbill with a list: Go on, Continue, New game, Save, Load, Settings, AI setup, Controls,
// Help, Credits, Quit to title. Each opens a sheet over it (a `.settings` panel: main.ts's Esc closes
// every one, and the game stays paused under them). Mouse and keyboard: the arrows move between the
// items, Enter or Space picks, Esc goes back; the Settings tabs go with Left and Right.
//
// Nothing of main.ts's pause and pointer-lock handling is changed: a click that is not on a menu item
// still bubbles to #start and goes into the game; the items stop their clicks.

import "./menu.css";
import { settings, DEFAULTS, HEIGHTS, STREET_LEVELS, type Prefs } from "../game/prefs";
import { ACTIONS, FIXED, codeName, keyLabel, keys, onMenuKey, type ActionId } from "./keys";
import { benchmarkRunning, frameStats, onBenchmark, runBenchmark } from "./apply";
import { real } from "../game/pause";
import { isGuest } from "../net/mp/identity";
import { drawAi, aiMenuNote } from "./ai";

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Screen = "settings" | "ai" | "help" | "credits" | "new" | "quit";
type Tab = "graphics" | "sound" | "controls" | "game" | "access";
const TABS: Array<[Tab, string]> = [
  ["graphics", "Graphics"],
  ["sound", "Sound"],
  ["controls", "Controls"],
  ["game", "Game"],
  ["access", "Accessibility"],
];

let paper: HTMLElement;
let startEl: HTMLElement;
let nav: HTMLElement;
let panel: HTMLDivElement;
let screen: Screen | null = null;
let tab: Tab = "graphics";
/** The key being rebound (Controls), or null. */
let capturing: ActionId | null = null;
let started = false;

// ------------------------------------------------------------------ the title and pause paper

const RULE = `<svg class="rule-svg" viewBox="0 0 400 14" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 5.2H176M0 8.8H176M224 5.2H400M224 8.8H400" stroke="currentColor" stroke-width="1"/>
  <path d="M200 1.5l7 5.5-7 5.5-7-5.5z" fill="currentColor"/><circle cx="184" cy="7" r="2" fill="currentColor"/><circle cx="216" cy="7" r="2" fill="currentColor"/>
</svg>`;

function item(go: string, label: string, sub = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "menu-item";
  b.dataset.go = go;
  b.innerHTML = `<span class="mi-label">${esc(label)}</span>${sub ? `<span class="mi-sub">${esc(sub)}</span>` : ""}`;
  return b;
}

/** The first screen or in the game: the items that belong, their words. */
function refreshNav(): void {
  const stamp = paper.querySelector<HTMLElement>(".paused-stamp");
  started = !!stamp && stamp.style.display !== "none";
  const play = nav.querySelector<HTMLButtonElement>('[data-go="play"]');
  if (play) play.querySelector(".mi-label")!.textContent = started ? "Go on" : "Walk into town";
  const quit = nav.querySelector<HTMLButtonElement>('[data-go="quit"]');
  if (quit) quit.hidden = !started;
  paper.classList.toggle("in-game", started);
  // the Saves' own buttons (game/saves.ts) keep their show and hide; "Continue: Tue 9:20 ..." gets two lines
  for (const b of nav.querySelectorAll<HTMLButtonElement>(".save-row button")) {
    b.classList.add("menu-item");
    const t = b.textContent ?? "";
    const m = /^Continue: (.*)$/.exec(t);
    if (m && !b.querySelector(".mi-label")) b.innerHTML = `<span class="mi-label">Continue</span><span class="mi-sub">${esc(m[1])}</span>`;
  }
  writeKeysLine();
  void aiMenuNote(paper.querySelector(".ai-note") as HTMLElement);
}

/** The keys line at the foot of the paper, from the keys bound now. */
function writeKeysLine(): void {
  const el = paper.querySelector<HTMLElement>(".keys");
  if (!el) return;
  const k = (id: ActionId) => esc(codeName(keys.get(id)));
  el.classList.add("bound-keys"); // written from the bindings: the hint translator (menu/keys.ts) leaves it
  el.innerHTML = `<kbd>${k("forward")}${k("left")}${k("back")}${k("right")}</kbd> walk &middot; <kbd>${k("hurry")}</kbd> hurry &middot; <kbd>${k("use")}</kbd> use &middot; <kbd>${k("map")}</kbd> map &middot; <kbd>${k("pockets")}</kbd> pockets &middot; <kbd>${k("pause")}</kbd> pause &middot; <kbd>Esc</kbd> menu`;
  const hint = paper.querySelector<HTMLElement>(".hint");
  if (hint) hint.classList.add("bound-keys");
  if (hint) {
    const t = hint.textContent ?? "";
    const n = t.replace(/press [^\s,]+,/, `press ${codeName(keys.get("forward"))},`);
    if (n !== t) hint.textContent = n;
  }
}

/** Buttons other parts put on the paper (Saves' row, the dev menu's Dev): into the list, in their place. */
function adopt(): void {
  const row = paper.querySelector(":scope > .save-row");
  if (row) nav.querySelector(".slot-saves")!.replaceWith(row);
  for (const b of paper.querySelectorAll<HTMLButtonElement>(":scope > .settings-btn")) {
    b.classList.remove("settings-btn");
    b.classList.add("menu-item", "menu-dev");
    b.style.marginLeft = "";
    nav.querySelector(".slot-dev")!.before(b);
  }
  refreshNav();
}

function buildPaper(): void {
  paper.classList.add("title-sheet");
  const h1 = paper.querySelector("h1");
  const sub = paper.querySelector(".sub");
  const head = document.createElement("header");
  head.className = "masthead";
  head.innerHTML = `<p class="kicker">Antwerpen &middot; MDCCCLXXIII</p>`;
  if (h1) head.append(h1);
  if (sub) head.append(sub);
  const rule = document.createElement("div");
  rule.className = "rule";
  rule.innerHTML = RULE;
  head.append(rule);
  // a wood engraving of the quay (made for the game: assets/ATTRIBUTION.md); on a short window it stands faded behind the title
  const cut = document.createElement("img");
  cut.className = "vignette";
  cut.alt = "";
  cut.src = `${import.meta.env.BASE_URL}ui/quay_woodcut.jpg`;
  rule.before(cut);
  paper.prepend(head);
  // the stamp (main.ts) goes on top of the masthead, slanted, as a rubber stamp would
  const stamp = paper.querySelector(".paused-stamp");
  if (stamp) head.prepend(stamp);

  nav = document.createElement("nav");
  nav.className = "menu-list";
  nav.setAttribute("aria-label", "Menu");
  const saves = document.createElement("div");
  saves.className = "slot-saves";
  const dev = document.createElement("span");
  dev.className = "slot-dev";
  nav.append(item("play", "Walk into town"), saves, item("new", "New game"), item("settings", "Settings"), item("ai", "AI setup"), item("controls", "Controls"), item("help", "Help"), item("credits", "Credits"), dev, item("quit", "Quit to title"));
  // M8e: a guest's menu has no host things (a new week, the AI setup: the host's PC keeps them)
  if (isGuest()) for (const go of ["new", "ai"]) nav.querySelector(`[data-go="${go}"]`)?.remove();
  head.after(nav);
  const note = document.createElement("p");
  note.className = "ai-note";
  nav.after(note);
  const foot = document.createElement("footer");
  foot.className = "sheet-foot";
  const hint = paper.querySelector(".hint");
  const keysEl = paper.querySelector(".keys");
  if (hint) foot.append(hint);
  if (keysEl) foot.append(keysEl);
  note.after(foot);

  nav.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".menu-item");
    if (!b) return;
    const go = b.dataset.go;
    // "Go on": the click goes on to #start, which starts the game (main.ts)
    if (go === "play" || !go) return;
    e.stopPropagation();
    if (go === "controls") {
      tab = "controls";
      open("settings");
    } else open(go as Screen);
  });
  // clicks on the list's gaps must not start the game either
  nav.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(".menu-item")) return;
    e.stopPropagation();
  });

  // other parts add their buttons after this: take them in as they come
  new MutationObserver(() => {
    if (paper.querySelector(":scope > .save-row, :scope > .settings-btn")) adopt();
  }).observe(paper, { childList: true });
  // shown, hidden, the stamp: the list's words follow
  new MutationObserver(() => {
    if (!startEl.classList.contains("hidden")) {
      refreshNav();
      focusFirst(nav);
    }
  }).observe(startEl, { attributes: true, attributeFilter: ["class"] });
  if (stamp) new MutationObserver(refreshNav).observe(stamp, { attributes: true, attributeFilter: ["style"] });
  keys.onChange(writeKeysLine);
  refreshNav();
}

// ------------------------------------------------------------------ the sheets

function open(s: Screen): void {
  screen = s;
  capturing = null;
  panel.style.display = "flex";
  panel.dataset.screen = s;
  draw();
  focusFirst(panel);
}

function close(): void {
  panel.style.display = "none";
  screen = null;
  capturing = null;
  if (!startEl.classList.contains("hidden")) focusFirst(nav);
}

function sheet(title: string, body: string, foot = `<button class="btn" data-act="back">Back <kbd>Esc</kbd></button>`, kicker = ""): string {
  return `<div class="sheet-head">${kicker ? `<p class="kicker">${kicker}</p>` : ""}<h2>${esc(title)}</h2><div class="rule">${RULE}</div></div>
    <div class="sheet-body">${body}</div>
    <div class="sheet-foot-row">${foot}</div>`;
}

function draw(): void {
  if (!screen) return;
  if (screen === "settings") return drawSettings();
  if (screen === "ai") {
    panel.innerHTML = sheet("AI setup", `<div class="ai-box"><p class="fine">Asking the town...</p></div>`, undefined, "Who writes the town's words");
    void drawAi(panel.querySelector(".ai-box") as HTMLElement);
    return;
  }
  if (screen === "help") return void (panel.innerHTML = sheet("Help", helpHtml(), undefined, "A newcomer's guide"));
  if (screen === "credits") return void (panel.innerHTML = sheet("Credits", creditsHtml(), undefined, "Printed and made by"));
  if (screen === "new") {
    panel.innerHTML = sheet(
      "A new game",
      `<p class="lead">Start a new week in Antwerp: a new town, Jef back at the doss house with his fifty centimes.</p>
       <p>Your saves are kept: you can load any of them later. The server also keeps a copy of this week in <code>data/backups</code>.</p>
       <p class="msg" aria-live="polite"></p>`,
      `<button class="btn" data-act="back">Back <kbd>Esc</kbd></button><button class="btn primary" data-act="newgame">Start a new week</button>`,
    );
    return;
  }
  if (screen === "quit") {
    panel.innerHTML = sheet(
      "Quit to title",
      `<p class="lead">Back to the first page. The game is saved as it stands (the autosave), so Continue brings you back here.</p>`,
      `<button class="btn" data-act="back">Back <kbd>Esc</kbd></button><button class="btn primary" data-act="quit">Quit to title</button>`,
    );
  }
}

// ------------------------------------------------------------------ Settings

const pct = (v: number) => `${Math.round(v * 100)}%`;

function seg<T extends string | number>(key: keyof Prefs, opts: Array<[T, string]>, now: T): string {
  return `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<button role="radio" aria-checked="${v === now}" class="${v === now ? "on" : ""}" data-set="${String(key)}" data-val="${esc(v)}" data-num="${typeof v === "number"}">${esc(l)}</button>`).join("")}</div>`;
}
function toggle(key: keyof Prefs, now: boolean): string {
  return `<label class="tog"><input type="checkbox" data-set="${String(key)}"${now ? " checked" : ""}><span class="box" aria-hidden="true"></span><span class="tog-word">${now ? "On" : "Off"}</span></label>`;
}
function range(key: keyof Prefs, lo: number, hi: number, step: number, now: number, show: (v: number) => string): string {
  return `<div class="rng"><input type="range" min="${lo}" max="${hi}" step="${step}" value="${now}" data-set="${String(key)}" aria-label="${esc(String(key))}"><output>${esc(show(now))}</output></div>`;
}
function select<T extends string | number>(key: keyof Prefs, opts: Array<[T, string]>, now: T): string {
  return `<select data-set="${String(key)}" data-num="${typeof now === "number"}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === now ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}
function row(label: string, ctl: string, note = "", cls = ""): string {
  return `<div class="set-row ${cls}"><div class="lbl">${esc(label)}${note ? `<small>${esc(note)}</small>` : ""}</div><div class="ctl">${ctl}</div></div>`;
}

const SHOWS: Partial<Record<keyof Prefs, (v: number) => string>> = {
  scale: pct,
  view: pct,
  rooms: (v) => (v ? String(v) : "none"),
  master: pct,
  music: pct,
  ambience: pct,
  voices: pct,
  effects: pct,
  sens: pct,
  fov: (v) => `${v}°`,
  bubbles: pct,
  textSize: pct,
};

function frameLine(): string {
  if (!frameStats.samples) return "Not measured yet: go into the game for a moment.";
  return `In play just now: <b>${Math.round(frameStats.fps)}</b> frames a second, ${frameStats.interval.toFixed(1)} ms a frame (the game's own work ${frameStats.work.toFixed(1)} ms).`;
}

function tabGraphics(p: Prefs): string {
  const presets = seg("preset", [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["custom", "Custom"]] as Array<[Prefs["preset"], string]>, p.preset);
  return `<div class="frame-box"><p class="frame-line" aria-live="polite">${frameLine()}</p>
      <button class="btn small" data-act="bench">${benchmarkRunning() ? "Measuring..." : "Test this computer"}</button></div>
    ${row("Quality", presets, "Low for an older or small computer; High is the game as made. A change below makes it Custom.")}
    <h3>Picture</h3>
    ${row("Lines drawn", select("height", HEIGHTS, p.height), "720 lines by default; 270 lines is the old PS1 look. More lines cost more of the graphics card.")}
    ${row("Render scale", range("scale", 0.5, 1, 0.05, p.scale, pct), "Fewer pixels than the lines above: faster, coarser.")}
    ${row("PS1 colours", toggle("psxColour", p.psxColour), "Few colours and a fine dither.")}
    ${row("PS1 wobble", toggle("wobble", p.wobble), "Corners jump to the pixel grid.")}
    <h3>The world</h3>
    ${row("View distance", range("view", 0.6, 1.2, 0.05, p.view, pct), "Where the fog closes in. Nearer: less to draw.")}
    ${row("Rooms seen through windows", range("rooms", 0, 8, 1, p.rooms, SHOWS.rooms!), "Taverns, shops and homes drawn inside while you look in from the street.")}
    ${row("People in the street", seg("street", (Object.keys(STREET_LEVELS) as Array<keyof typeof STREET_LEVELS>).map((k) => [k, `${STREET_LEVELS[k].label}`]) as Array<[Prefs["street"], string]>, p.street), `How many townspeople walk round you at once (${Object.values(STREET_LEVELS).map((l) => l.cap).join(", ")}).`)}
    ${row("Reflections", seg("reflections", [["off", "Off"], ["coarse", "Coarse"], ["full", "Full"]] as Array<[Prefs["reflections"], string]>, p.reflections), "The river and the puddles as mirrors: the town drawn a second time.")}
    ${row("Lantern shadows", toggle("shadows", p.shadows), "The nearest carried lantern throws shadows.")}
    ${row("Light from windows and lamps", seg("lightBudget", [["low", "Low"], ["medium", "Medium"], ["high", "High"]] as Array<[Prefs["lightBudget"], string]>, p.lightBudget), "How many lights are worked out for every pixel; the rest light the ground only.")}
    ${row("Leaves, birds and mist", seg("particles", [["off", "Off"], ["some", "Some"], ["all", "All"]] as Array<[Prefs["particles"], string]>, p.particles), "The town's small life in the air and on the roofs.")}
    <h3>Frames</h3>
    ${row("Frame cap", select("frameCap", [[0, "None: as fast as the screen"], [30, "30 a second"], [45, "45 a second"], [60, "60 a second"], [90, "90 a second"], [120, "120 a second"], [144, "144 a second"]], p.frameCap), "A cap keeps a laptop cooler and quieter.")}
    ${row("Show the frame time", toggle("showFps", p.showFps), "A small counter in the top right corner while you play.")}`;
}

function tabSound(p: Prefs): string {
  const r = (k: keyof Prefs, l: string, note: string) => row(l, range(k, 0, 1, 0.05, p[k] as number, pct), note);
  return `${r("master", "All sound", "Everything together.")}
    ${r("music", "Music", "The organ, ballads, the fiddle and a tavern's song.")}
    ${r("ambience", "The town", "Wind, water, rain, bells, gulls, carts and the far-off ships.")}
    ${r("voices", "Voices", "Townspeople talking, street cries, a crowd.")}
    ${r("effects", "Your own sounds", "Footsteps, splashes, goods set down, coins.")}`;
}

function tabControls(p: Prefs): string {
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  const keysHtml = groups
    .map(
      (g) => `<h3>${esc(g)}</h3><div class="key-grid">` +
        ACTIONS.filter((a) => a.group === g)
          .map((a) => {
            const now = keys.get(a.id);
            const wait = capturing === a.id;
            return row(
              a.label,
              `<button class="keycap${wait ? " waiting" : ""}${now !== a.code ? " changed" : ""}" data-bind="${a.id}" aria-label="${esc(a.label)}: ${esc(codeName(now))}. Press to change">${wait ? "Press a key..." : esc(codeName(now))}</button>`,
              a.also ?? "",
              "key-row",
            );
          })
          .join("") +
        `</div>`,
    )
    .join("");
  return `<h3>Mouse and view</h3>
    ${row("Mouse speed", range("sens", 0.25, 3, 0.05, p.sens, pct))}
    ${row("Turn the mouse's up and down round", toggle("invertY", p.invertY))}
    ${row("Field of view", range("fov", 55, 100, 1, p.fov, SHOWS.fov!), "How wide you see. 75° as made.")}
    ${row("Head bob", toggle("headBob", p.headBob), "The view rocks a little as Jef walks.")}
    <p class="fine">Click a key, then press the new one. A key another action has goes to that action in exchange. Esc, Enter, Tab, the digits (the choices in a talk), the F keys and the arrows (a second set of walking keys) stay as they are.</p>
    <p class="msg" aria-live="polite"></p>
    ${keysHtml}
    <div class="row-btns"><button class="btn small" data-act="keys-reset">All keys as they were</button></div>`;
}

function tabGame(p: Prefs): string {
  return `${row("Speech bubbles", range("bubbles", 0.7, 1.8, 0.05, p.bubbles, pct), "The size of the words over the heads of people talking.")}
    ${row("Autosave", seg("autosave", [[1, "Each hour"], [2, "2 hours"], [4, "4 hours"], [0, "On leaving"]], p.autosave), "In game hours. The game also saves when you close the tab or quit to the title.")}
    ${row("Language", select("language", [["en", "English"]], p.language), "More languages later. Names stay Dutch.")}
    ${row("The clock", `<span class="fixed">A game hour is two real minutes</span>`, "The town's clock runs on the server and is the same for everyone.")}
    <h3>The town</h3>
    <div class="pop-server"><p class="fine">Asking the town...</p></div>`;
}

function tabAccess(p: Prefs): string {
  return `${row("Text size", range("textSize", 0.8, 1.6, 0.05, p.textSize, pct), "All the papers, notes and hints on screen.")}
    ${row("High-contrast paper", toggle("contrast", p.contrast), "White paper and black ink, no sepia, stronger lines.")}
    ${row("Reduce motion", toggle("reduceMotion", p.reduceMotion), "No head bob, no sway, no fading and sliding of the papers.")}
    ${row("Colour-safe markers", toggle("colourSafe", p.colourSafe), "Warnings in blue and orange with a mark, not red on brown.")}`;
}

const TAB_KEYS: Record<Tab, Array<keyof Prefs>> = {
  graphics: ["preset", "height", "scale", "psxColour", "wobble", "view", "rooms", "street", "reflections", "shadows", "lightBudget", "particles", "frameCap", "showFps"],
  sound: ["master", "music", "ambience", "voices", "effects"],
  controls: ["sens", "invertY", "fov", "headBob"],
  game: ["bubbles", "autosave", "language"],
  access: ["textSize", "contrast", "reduceMotion", "colourSafe"],
};

function drawSettings(keepScroll = false): void {
  const p = settings.all();
  const body = { graphics: tabGraphics, sound: tabSound, controls: tabControls, game: tabGame, access: tabAccess }[tab](p);
  const scroll = keepScroll ? panel.querySelector(".sheet-body")?.scrollTop ?? 0 : 0;
  const tabs = `<div class="tabs" role="tablist">${TABS.map(([t, l]) => `<button role="tab" class="tab${t === tab ? " on" : ""}" aria-selected="${t === tab}" data-tab="${t}">${l}</button>`).join("")}</div>`;
  panel.innerHTML = sheet(
    "Settings",
    `<div class="tab-body" role="tabpanel">${body}</div>`,
    `<button class="btn" data-act="reset-tab">Reset this page</button><span class="saved-note">Saved as you change it</span><button class="btn primary" data-act="back">Done <kbd>Esc</kbd></button>`,
    "",
  );
  panel.querySelector(".sheet-head")!.append(document.createRange().createContextualFragment(tabs));
  if (keepScroll) panel.querySelector(".sheet-body")!.scrollTop = scroll;
  if (tab === "game") void drawServer(panel.querySelector(".pop-server") as HTMLElement);
}

/** Put the value of a control into the settings (and redraw what depends on it). */
function setFrom(el: HTMLElement): void {
  const key = el.dataset.set as keyof Prefs;
  if (!key) return;
  let v: unknown;
  if (el instanceof HTMLInputElement && el.type === "checkbox") v = el.checked;
  else if (el instanceof HTMLInputElement && el.type === "range") v = Number(el.value);
  else if (el instanceof HTMLSelectElement) v = el.dataset.num === "true" ? Number(el.value) : el.value;
  else v = el.dataset.num === "true" ? Number(el.dataset.val) : el.dataset.val;
  if (key === "preset") {
    if (v === "custom") return;
    settings.preset(v as "low" | "medium" | "high");
  } else settings.set({ [key]: v } as Partial<Prefs>);
  drawSettings(true);
  // keep the focus on the same control after the redraw
  const same = panel.querySelector<HTMLElement>(`[data-set="${key}"]${el.dataset.val !== undefined ? `[data-val="${CSS.escape(el.dataset.val)}"]` : ""}`);
  same?.focus();
}

// the town's own settings (the server's): the biggest event, the town size for a new game
interface PopulationView {
  eventSize: number;
  eventSizes: number[];
  townSize: string;
  townSizes: Array<{ id: string; label: string; about: number }>;
  current: { size: string; residents: number };
}
async function drawServer(box: HTMLElement): Promise<void> {
  const show = (v: PopulationView) => {
    const cur = v.townSizes.find((t) => t.id === v.current.size)?.label ?? "Normal";
    box.innerHTML =
      row("Biggest event", `<select name="eventSize">${v.eventSizes.map((n) => `<option value="${n}"${n === v.eventSize ? " selected" : ""}>up to ${n} people</option>`).join("")}</select>`, "The most people a wedding, a funeral or a street show may gather.") +
      row("Town size for a new game", `<select name="townSize">${v.townSizes.map((t) => `<option value="${esc(t.id)}"${t.id === v.townSize ? " selected" : ""}>${esc(t.label)} (about ${Number(t.about)} people)</option>`).join("")}</select>`, `This week's town stays as it is: ${Number(v.current.residents)} people (${cur}). The new size starts with a new game.`);
    const post = async (body: Record<string, unknown>) => {
      try {
        const r = await real.fetch("/api/settings/population", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (r.ok) show((await r.json()) as PopulationView);
      } catch {
        /* the server is away: the choice waits */
      }
    };
    (box.querySelector("select[name=eventSize]") as HTMLSelectElement).onchange = (e) => void post({ eventSize: Number((e.target as HTMLSelectElement).value) });
    (box.querySelector("select[name=townSize]") as HTMLSelectElement).onchange = (e) => void post({ townSize: (e.target as HTMLSelectElement).value });
  };
  try {
    const r = await real.fetch("/api/settings/population", { signal: real.abortTimeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    show((await r.json()) as PopulationView);
  } catch {
    box.innerHTML = `<p class="fine">The town's settings cannot be reached just now.</p>`;
  }
}

// ------------------------------------------------------------------ Help and Credits

function helpHtml(): string {
  const k = (id: ActionId) => `<kbd>${esc(codeName(keys.get(id)))}</kbd>`;
  return `<div class="cols">
    <section><h3>Where to start</h3>
      <p>You are Jef, new in Antwerp with fifty centimes and a bed at the doss house. Walk to the Rijnkaai: the job board stands on the quay. Work, eat, keep warm, and pay your rent by Sunday.</p>
      <p>The paper map (${k("map")}) shows the town and where you are. Ask people: anyone in the street will talk.</p></section>
    <section><h3>The keys</h3>
      <p>${k("forward")}${k("left")}${k("back")}${k("right")} walk, ${k("hurry")} hurry, ${k("crouch")} crouch, ${k("jump")} jump, the mouse to look.</p>
      <p>${k("use")} does the first thing the hint on screen offers; ${k("second")}, ${k("third")} and ${k("fourth")} the others. ${k("pockets")} pockets, ${k("lantern")} lantern, ${k("pause")} pause, <kbd>Esc</kbd> this menu.</p>
      <p>In a talk: the digits pick an answer, ${k("talk")} lets you say your own words, ${k("buy")} buys, ${k("haggle")} haggles or says goodbye.</p></section>
    <section><h3>Jobs</h3>
      <p>The board on the quay has the day's work; a new board goes up at midnight. The naties hire day men at their gates at dawn. Carry, watch, deliver: take a job (${k("use")}), do it, and bring the proof back for your pay. Some jobs change on the way: a thief, a bribe, thick fog.</p></section>
    <section><h3>Needs</h3>
      <p>Food, warmth, sleep and health, in the corner. Food falls through the day: bread, herring or a meal fill it. Warmth goes in the cold and the rain: a coat, a fire, a warm bed. Sleep in a bed (the doss house, or a room you rent) at any hour, for as long as you choose; a bench will do, but you rest less and the cold gets into your coat. A need at 2 or less is marked, and costs you.</p></section>
    <section><h3>Money and rent</h3>
      <p>Money is in centimes: 100 make a franc, and a good day on the docks pays two or three. The rent of your bed is due every Sunday: no rent, no bed, and a night on the quay costs health. The pawnshop lends on what you carry.</p></section>
    <section><h3>The night and saving</h3>
      <p>The clock runs on through the night: the day's employers go home, a lamp burns at their quest box, and other men offer other work. The game saves itself every game hour and when you leave; ${k("pause")} or <kbd>Esc</kbd> stops the town.</p></section>
  </div>`;
}

// HOOK (licence 2026-09-26): the game is AGPL-3.0-or-later and its server serves it over a network, so
// AGPL section 13 asks us to offer every player the source. Keep this link in the credits (see LICENSE).
const SOURCE_URL = "https://github.com/Steve-Sitax/Moodygame";

function creditsHtml(): string {
  return `<div class="cols">
    <section><h3>Scheldemist</h3>
      <p>Antwerp, the Rijnkaai, October 1873. Designed by Steve (Sitax); built by Steve with Claude, Anthropic's model, which also speaks for the townspeople. Some pictures and small texts are made with OpenAI's Codex from our own prompts.</p></section>
    <section><h3>Type</h3>
      <p class="type-sample hand">Kalam, by the Indian Type Foundry</p>
      <p class="type-sample print">Old Standard TT, by Alexey Kryukov</p>
      <p class="type-sample slab">Alfa Slab One, by JM Solé</p>
      <p class="type-sample black">UnifrakturMaguntia, by J. "Mach" Wust</p>
      <p class="type-sample mono">Courier Prime, by Alan Dague-Greene</p>
      <p class="small">All under the SIL Open Font License 1.1, through the Fontsource packages.</p></section>
    <section><h3>Sound</h3>
      <p>Recordings from Kenney's Impact Sounds, BigSoundBank (Joseph Sardin) and the Freesound community (craigsmith, Robo9418, v23, Sojan, ldezem, xkeril and others), all CC0. Voices, wind, water and the organ are made in code.</p></section>
    <section><h3>The map</h3>
      <p>The town is traced from the 1873 plan of Antwerp by Vuillaume (FelixArchief, via Wikimedia Commons, CC0), with landmark outlines from OpenStreetMap (© OpenStreetMap contributors, ODbL).</p></section>
    <section><h3>Code</h3>
      <p>three.js (MIT), Google Draco (Apache-2.0), Vite and TypeScript; on the server Hono, ws, better-sqlite3 and Zod (MIT), and the Claude Agent SDK.</p>
      <p>Scheldemist is free software under the GNU AGPL, version 3 or later. Source: <a href="${SOURCE_URL}" target="_blank" rel="noopener" style="color: inherit">github.com/Steve-Sitax/Moodygame</a></p></section>
    <section><h3>The rest</h3>
      <p>Models are our own, built in Blender by our scripts; textures painted in code or made for the game. The full list of every asset and its licence: <code>assets/ATTRIBUTION.md</code>.</p></section>
  </div>`;
}

// ------------------------------------------------------------------ actions in the sheets

async function startNewWeek(msg: HTMLElement | null): Promise<void> {
  if (msg) msg.textContent = "Starting a new week...";
  try {
    const r = await real.fetch("/api/new-game", { method: "POST" });
    if (!r.ok) throw new Error(String(r.status));
    location.reload();
  } catch (err) {
    if (msg) msg.textContent = `Could not start a new week (${String(err)}).`;
  }
}

/**
 * New game: a character first (menu/character.ts, another helper's creator, when it is there), then the
 * new week. HOOK (menus 2026-09-26): the creator is found by name; without it the week starts at once.
 */
function newGame(msg: HTMLElement | null): void {
  const mods = import.meta.glob<{ openCharacterCreator?: (onDone: (...a: never[]) => void, opts?: { onCancel?: () => void }) => void }>("./character.ts");
  const load = Object.values(mods)[0];
  if (!load) return void startNewWeek(msg);
  void load()
    .then((m) => {
      if (!m.openCharacterCreator) return startNewWeek(msg);
      panel.style.display = "none";
      // HOOK: the new week starts once the character is made; cancelled, back to this sheet
      m.openCharacterCreator(() => void startNewWeek(msg), { onCancel: () => open("new") });
    })
    .catch(() => startNewWeek(msg));
}

function onPanelClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const tabBtn = t.closest<HTMLElement>("[data-tab]");
  if (tabBtn) {
    tab = tabBtn.dataset.tab as Tab;
    capturing = null;
    drawSettings();
    panel.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
    return;
  }
  const bind = t.closest<HTMLElement>("[data-bind]");
  if (bind) {
    capturing = capturing === bind.dataset.bind ? null : (bind.dataset.bind as ActionId);
    drawSettings(true);
    panel.querySelector<HTMLElement>(`[data-bind="${bind.dataset.bind}"]`)?.focus();
    return;
  }
  const setBtn = t.closest<HTMLElement>("button[data-set]");
  if (setBtn) return setFrom(setBtn);
  const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
  if (!act) return;
  if (act === "back") close();
  else if (act === "reset-tab") {
    if (tab === "controls") keys.reset();
    settings.reset(TAB_KEYS[tab]);
    if (tab === "graphics") settings.set({ preset: DEFAULTS.preset }, { keepPreset: true });
    drawSettings(true);
  } else if (act === "keys-reset") {
    keys.reset();
    drawSettings(true);
  } else if (act === "bench") {
    runBenchmark();
    drawSettings(true);
  } else if (act === "newgame") newGame(panel.querySelector(".msg"));
  else if (act === "quit") {
    // the page closes its game (the autosave on the way out: game/saves.ts) and opens on the first page
    location.reload();
  }
}

// ------------------------------------------------------------------ the keyboard

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, select, input, [tabindex='0']")].filter((el) => !(el as HTMLButtonElement).disabled && !el.hidden && el.offsetParent !== null && !el.closest("[hidden]"));
}
function focusFirst(root: HTMLElement): void {
  real.setTimeout(() => {
    const list = focusables(root);
    const first = root === panel ? list.find((el) => el.matches(".tab.on, .sheet-body *")) ?? list[0] : list[0];
    first?.focus({ preventScroll: true });
  }, 30);
}

function menuKey(e: KeyboardEvent): boolean {
  const panelOn = panel.style.display !== "none";
  const menuOn = !startEl.classList.contains("hidden");
  if (!panelOn && !menuOn) return false;
  // another part's panel (Save, Load, Dev) is up: its own keys
  const others = [...document.querySelectorAll<HTMLElement>(".settings")].some((p) => p !== panel && p.style.display !== "none");
  if (!panelOn && others) return false;
  if (capturing) {
    if (e.code === "Escape") {
      capturing = null;
      drawSettings(true);
      return true;
    }
    if (FIXED.test(e.code)) {
      const msg = panel.querySelector(".msg");
      if (msg) msg.textContent = `${codeName(e.code)} keeps its own job: pick another key.`;
      return true;
    }
    const id = capturing;
    capturing = null;
    const { swapped } = keys.set(id, e.code);
    drawSettings(true);
    const msg = panel.querySelector(".msg");
    if (msg) msg.textContent = swapped ? `${ACTIONS.find((a) => a.id === id)!.label} is now ${codeName(e.code)}; ${ACTIONS.find((a) => a.id === swapped)!.label} took ${keyLabel(ACTIONS.find((a) => a.id === swapped)!.code)} in exchange.` : `${ACTIONS.find((a) => a.id === id)!.label} is now ${codeName(e.code)}.`;
    panel.querySelector<HTMLElement>(`[data-bind="${id}"]`)?.focus();
    return true;
  }
  const root = panelOn ? panel : nav;
  const el = document.activeElement as HTMLElement | null;
  const inside = !!el && root.contains(el);
  const typing = !!el && (el.tagName === "INPUT" && !["range", "checkbox"].includes((el as HTMLInputElement).type)) || el?.tagName === "TEXTAREA";
  if (typing) return false; // a text box has its own keys (Esc still closes: main.ts)
  if (e.code === "ArrowDown" || e.code === "ArrowUp") {
    if (el?.tagName === "SELECT" && e.altKey) return false;
    const list = focusables(root);
    if (!list.length) return true;
    // from the tabs, down goes into the page (not along the tabs: Left and Right do that)
    if (inside && el!.matches(".tab") && e.code === "ArrowDown") {
      const first = list.find((q) => q.closest(".sheet-body"));
      if (first) {
        first.focus();
        first.scrollIntoView({ block: "nearest" });
        return true;
      }
    }
    const i = inside ? list.indexOf(el!) : -1;
    const next = list[(i + (e.code === "ArrowDown" ? 1 : -1) + list.length) % list.length];
    next.focus();
    next.scrollIntoView({ block: "nearest" });
    return true;
  }
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    if (!inside) return true;
    const dir = e.code === "ArrowRight" ? 1 : -1;
    // a slider: its own step; a row of choices or the tabs: the next one
    if (el instanceof HTMLInputElement && el.type === "range") return false;
    if (el!.matches(".tab")) {
      const i = TABS.findIndex(([t]) => t === tab);
      tab = TABS[(i + dir + TABS.length) % TABS.length][0];
      capturing = null;
      drawSettings();
      panel.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
      return true;
    }
    const group = el!.closest(".seg");
    if (group) {
      const bs = [...group.querySelectorAll<HTMLElement>("button")];
      const i = bs.indexOf(el!);
      const b = bs[Math.max(0, Math.min(bs.length - 1, i + dir))];
      if (b !== el) setFrom(b);
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dir));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return true;
  }
  if ((e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") && inside) {
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      el.checked = !el.checked;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === "range")) return e.code !== "Space";
    el!.click();
    return true;
  }
  if (e.code === "Tab") return false;
  // in a sheet, nothing else goes to the game or the menu under it (Esc: main.ts closes the sheet)
  return panelOn && e.code !== "Escape";
}

// ------------------------------------------------------------------ mount

export function mountMenu(pausePaper: HTMLElement): void {
  paper = pausePaper;
  startEl = (paper.closest("#start") as HTMLElement) ?? document.body;
  panel = document.createElement("div");
  panel.className = "settings paper menu-sheet pause-ui";
  panel.style.display = "none";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  document.body.appendChild(panel);
  // clicks inside must not start the game (the pause screen starts it on a click)
  panel.addEventListener("click", (e) => {
    e.stopPropagation();
    onPanelClick(e);
  });
  panel.addEventListener("mousedown", (e) => e.stopPropagation());
  panel.addEventListener("change", (e) => {
    const el = e.target as HTMLElement;
    if (el.dataset.set) setFrom(el);
  });
  panel.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type !== "range" || !el.dataset.set) return;
    const key = el.dataset.set as keyof Prefs;
    const out = el.parentElement?.querySelector("output");
    if (out) out.textContent = (SHOWS[key] ?? String)(Number(el.value));
    // sound and the text size follow the slider as it moves; the rest when it is let go (change)
    if (["master", "music", "ambience", "voices", "effects", "textSize", "bubbles", "sens"].includes(key)) settings.set({ [key]: Number(el.value) } as Partial<Prefs>);
  });
  // the sheet's own open state: Esc (main.ts) hides it with style.display
  new MutationObserver(() => {
    if (panel.style.display === "none" && screen) {
      screen = null;
      capturing = null;
      if (!startEl.classList.contains("hidden")) focusFirst(nav);
    }
  }).observe(panel, { attributes: true, attributeFilter: ["style"] });
  // into the game: every sheet closes
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) panel.style.display = "none";
  });
  // the frame line in Graphics, live
  real.setInterval(() => {
    const fl = panel.querySelector(".frame-line");
    if (fl && screen === "settings") fl.innerHTML = frameLine();
  }, 500);
  onMenuKey(menuKey);
  buildPaper();
  onBenchmark((preset, fps) => {
    const words = { low: "Low", medium: "Medium", high: "High" }[preset];
    toastNote(`Graphics set to ${words} for this computer (${fps} frames a second). Change it in Esc, Settings.`);
  });
}

function toastNote(text: string): void {
  const n = document.createElement("div");
  n.className = "menu-toast";
  n.textContent = text;
  document.body.appendChild(n);
  real.setTimeout(() => n.classList.add("on"), 30);
  real.setTimeout(() => {
    n.classList.remove("on");
    real.setTimeout(() => n.remove(), 1200);
  }, 9000);
}
