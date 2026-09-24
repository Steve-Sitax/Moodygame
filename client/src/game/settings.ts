// Settings (Steve, 2026-09-23: "add a settings button in the esc menu; change
// resolution so we can try higher res"). Kept in the browser (localStorage), put
// on the pause screen (#start). The PS1 look stays the default.

import { esc } from "./runs";

export interface GameSettings {
  /** Render height in pixels: 270 is the PS1 look; 0 = the full window. */
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

const KEY = "scheldemist.settings";
const DEFAULTS: GameSettings = { height: 270, psxColour: true, wobble: true, street: "normal" };
const HEIGHTS: Array<[number, string]> = [
  [270, "270 lines (PS1, the look)"],
  [360, "360 lines"],
  [540, "540 lines"],
  [720, "720 lines"],
  [1080, "1080 lines"],
  [0, "Full window"],
];

export function loadSettings(): GameSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<GameSettings>;
    return {
      height: HEIGHTS.some(([h]) => h === raw.height) ? (raw.height as number) : DEFAULTS.height,
      psxColour: typeof raw.psxColour === "boolean" ? raw.psxColour : DEFAULTS.psxColour,
      wobble: typeof raw.wobble === "boolean" ? raw.wobble : DEFAULTS.wobble,
      street: typeof raw.street === "string" && Object.hasOwn(STREET_LEVELS, raw.street) ? raw.street : DEFAULTS.street,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode: the settings last until the page closes
  }
}

interface PopulationView {
  eventSize: number;
  eventSizes: number[];
  townSize: string;
  townSizes: Array<{ id: string; label: string; about: number }>;
  current: { size: string; residents: number };
}

/** The server's part of Population: the event size and the town size for a new game (server town/popsettings.ts). */
async function drawServer(box: HTMLElement): Promise<void> {
  const show = (v: PopulationView) => {
    const cur = v.townSizes.find((t) => t.id === v.current.size)?.label ?? "Normal";
    box.innerHTML = `<label>Biggest event
        <select name="eventSize">${v.eventSizes.map((n) => `<option value="${n}"${n === v.eventSize ? " selected" : ""}>up to ${n} people</option>`).join("")}</select>
      </label>
      <p class="note-small">The most people a wedding, a funeral or a street show may gather.</p>
      <label>Town size for a new game
        <select name="townSize">${v.townSizes.map((t) => `<option value="${esc(t.id)}"${t.id === v.townSize ? " selected" : ""}>${esc(t.label)} (about ${Number(t.about)} people)</option>`).join("")}</select>
      </label>
      <p class="note-small">This week's town stays as it is: ${Number(v.current.residents)} people (${esc(cur)}). The new size starts when you press Restart for a new week.</p>`;
    const post = async (body: Record<string, unknown>) => {
      try {
        const r = await fetch("/api/settings/population", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (r.ok) show((await r.json()) as PopulationView);
      } catch {
        // the server is away: the choice waits for the next time
      }
    };
    (box.querySelector("select[name=eventSize]") as HTMLSelectElement).onchange = (e) => void post({ eventSize: Number((e.target as HTMLSelectElement).value) });
    (box.querySelector("select[name=townSize]") as HTMLSelectElement).onchange = (e) => void post({ townSize: (e.target as HTMLSelectElement).value });
  };
  try {
    const r = await fetch("/api/settings/population");
    if (!r.ok) throw new Error(String(r.status));
    show((await r.json()) as PopulationView);
  } catch {
    box.innerHTML = `<p class="note-small">The town's settings cannot be reached just now.</p>`;
  }
}

/**
 * A "Settings" button on the pause paper, and the panel it opens. `apply` runs at
 * once and after every change.
 */
export function mountSettings(pausePaper: HTMLElement, apply: (s: GameSettings) => void): GameSettings {
  const s = loadSettings();
  apply(s);

  const btn = document.createElement("button");
  btn.className = "settings-btn";
  btn.textContent = "Settings";
  pausePaper.appendChild(btn);

  // restart: a new week (asks first; the server keeps a copy of the old week in data/backups)
  const restart = document.createElement("button");
  restart.className = "settings-btn";
  restart.style.marginLeft = "8px";
  restart.textContent = "Restart";
  pausePaper.appendChild(restart);
  let armed = false;
  let disarm = 0;
  restart.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (restart.disabled) return;
    if (!armed) {
      armed = true;
      restart.textContent = "Start a new week? Click again";
      disarm = window.setTimeout(() => {
        armed = false;
        restart.textContent = "Restart";
      }, 4000);
      return;
    }
    // the second click: one new game only (a third click must not ask the server again)
    armed = false;
    clearTimeout(disarm);
    restart.disabled = true;
    restart.textContent = "Starting a new week...";
    try {
      const r = await fetch("/api/new-game", { method: "POST" });
      if (!r.ok) throw new Error(String(r.status));
      location.reload();
    } catch (err) {
      restart.textContent = `Could not restart (${String(err)})`;
      restart.disabled = false;
    }
  });

  const panel = document.createElement("div");
  panel.className = "settings paper";
  panel.style.display = "none";
  panel.style.maxHeight = "92vh";
  panel.style.overflowY = "auto";
  document.body.appendChild(panel);

  const opts = <T extends string | number>(list: Array<[T, string]>, now: T) =>
    list.map(([v, t]) => `<option value="${v}"${v === now ? " selected" : ""}>${t}</option>`).join("");
  const draw = () => {
    panel.innerHTML = `<h2>Settings</h2>
      <label>Picture
        <select name="height">${opts(HEIGHTS, s.height)}</select>
      </label>
      <label><input type="checkbox" name="psxColour"${s.psxColour ? " checked" : ""}> PS1 colours (few colours, dither)</label>
      <label><input type="checkbox" name="wobble"${s.wobble ? " checked" : ""}> PS1 wobble (corners jump to the pixel grid)</label>
      <p class="note-small">A higher picture costs more of the graphics card. 270 lines is how the game is meant to look.</p>
      <h2>Population</h2>
      <label>People in the street
        <select name="street">${opts((Object.keys(STREET_LEVELS) as StreetLevel[]).map((k) => [k, `${STREET_LEVELS[k].label} (up to ${STREET_LEVELS[k].cap})`]), s.street)}</select>
      </label>
      <p class="note-small">How many townspeople walk around you at once. More people cost more of the computer.</p>
      <div class="pop-server"><p class="note-small">Asking the town...</p></div>
      <button name="back">Back</button>`;
    (panel.querySelector("select[name=height]") as HTMLSelectElement).onchange = (e) => {
      s.height = Number((e.target as HTMLSelectElement).value);
      save(s);
      apply(s);
    };
    (panel.querySelector("select[name=street]") as HTMLSelectElement).onchange = (e) => {
      s.street = (e.target as HTMLSelectElement).value as StreetLevel;
      save(s);
      apply(s);
    };
    void drawServer(panel.querySelector(".pop-server") as HTMLElement);
    for (const name of ["psxColour", "wobble"] as const) {
      (panel.querySelector(`input[name=${name}]`) as HTMLInputElement).onchange = (e) => {
        s[name] = (e.target as HTMLInputElement).checked;
        save(s);
        apply(s);
      };
    }
    (panel.querySelector("button[name=back]") as HTMLButtonElement).onclick = (e) => {
      e.stopPropagation();
      panel.style.display = "none";
    };
  };
  // clicks inside the panel must not start the game (the pause screen starts it on click)
  panel.addEventListener("click", (e) => e.stopPropagation());
  panel.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    draw();
    panel.style.display = "block";
  });
  // Esc in the panel: back to the pause screen
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && panel.style.display !== "none") panel.style.display = "none";
  });
  // the panel closes when the game starts again
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) panel.style.display = "none";
  });
  return s;
}
