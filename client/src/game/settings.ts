// Settings (Steve, 2026-09-23: "add a settings button in the esc menu; change
// resolution so we can try higher res"). Kept in the browser (localStorage), put
// on the pause screen (#start). The PS1 look stays the default.

export interface GameSettings {
  /** Render height in pixels: 270 is the PS1 look; 0 = the full window. */
  height: number;
  /** 5-bit colour with ordered dither (the PS1 colour). */
  psxColour: boolean;
  /** Vertex wobble (the PS1 snap to the pixel grid). */
  wobble: boolean;
}

const KEY = "scheldemist.settings";
const DEFAULTS: GameSettings = { height: 270, psxColour: true, wobble: true };
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

  const panel = document.createElement("div");
  panel.className = "settings paper";
  panel.style.display = "none";
  document.body.appendChild(panel);

  const draw = () => {
    panel.innerHTML = `<h2>Settings</h2>
      <label>Picture
        <select name="height">${HEIGHTS.map(([h, t]) => `<option value="${h}"${h === s.height ? " selected" : ""}>${t}</option>`).join("")}</select>
      </label>
      <label><input type="checkbox" name="psxColour"${s.psxColour ? " checked" : ""}> PS1 colours (few colours, dither)</label>
      <label><input type="checkbox" name="wobble"${s.wobble ? " checked" : ""}> PS1 wobble (corners jump to the pixel grid)</label>
      <p class="note-small">A higher picture costs more of the graphics card. 270 lines is how the game is meant to look.</p>
      <button name="back">Back</button>`;
    (panel.querySelector("select") as HTMLSelectElement).onchange = (e) => {
      s.height = Number((e.target as HTMLSelectElement).value);
      save(s);
      apply(s);
    };
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
  // the panel closes when the game starts again
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) panel.style.display = "none";
  });
  return s;
}
