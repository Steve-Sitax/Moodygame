// Dev menu (Steve, 2026-09-23: "in F9 mode I want an extra button in the esc menu to
// trigger stuff: time of day, weather, events"). Dev builds only: a "Dev" button on the
// pause paper opens it. Time and weather go through the server (it owns the clock and
// the weather); events call the world directly. Changes Steve's own save: it is his tool.

import { DEMO } from "../demo/demo";

export interface DevMenuDeps {
  /** Jump the player to (x, z). */
  place(x: number, z: number): void;
  places: Array<{ name: string; x: number; z: number }>;
  /** An event button; a returned text (the server's answer) shows in the panel. */
  events: Array<{ label: string; run: () => void | Promise<string | void> }>;
  /** M6 tides: the tide in words, and hold the river at high or low water (null: follow the clock). */
  tide?: { read(): string; hold(v: "high" | "low" | null): void };
  population?: { read(): { multiplier: number; base: number; extra: number; target: number }; set(multiplier: number): void };
}

async function devSet(body: Record<string, unknown>): Promise<string> {
  try {
    const r = await fetch("/api/dev/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.ok ? "done" : `failed ${r.status}`;
  } catch (e) {
    return String(e);
  }
}

export function mountDevMenu(pausePaper: HTMLElement, deps: DevMenuDeps): void {
  const btn = document.createElement("button");
  btn.className = "settings-btn";
  btn.textContent = "Dev";
  btn.style.marginLeft = "8px";
  pausePaper.appendChild(btn);

  const panel = document.createElement("div");
  panel.className = "settings devmenu paper";
  panel.style.display = "none";
  document.body.appendChild(panel);

  const hours = [0, 3, 6, 8, 10, 12, 14, 16, 18, 19, 20, 22];
  const weathers = ["fog", "mist", "clear", "rain", "storm"];
  panel.innerHTML = `<h2>Dev</h2>
    <p class="row"><b>Time</b> ${hours.map((h) => `<button data-hour="${h}">${h}:00</button>`).join("")}</p>
    <p class="row"><b>Weather</b> ${weathers.map((w) => `<button data-weather="${w}">${w}</button>`).join("")}</p>
    ${deps.population ? `<fieldset><legend>NPC stress test</legend>
      <label><input type="checkbox" data-pop-enabled> Extra street NPCs</label>
      <label>Population <input type="range" min="1" max="100" step="1" value="1" data-pop-multiplier aria-label="NPC population multiplier" disabled> <output data-pop-value>1×</output></label>
      <button data-pop-reset>Reset to normal</button>
      <p class="note-small" data-pop-status></p>
      <p class="note-small">Adds walking NPCs while you play. This tab only; reloading returns to normal.</p></fieldset>` : ""}
    ${deps.tide ? `<p class="row"><b>Tide</b> <button data-tide="now">now</button><button data-tide="high">high water</button><button data-tide="low">low water</button><button data-tide="clock">follow the clock</button></p>` : ""}
    <p class="row"><b>Events</b> ${deps.events.map((e, i) => `<button data-event="${i}">${e.label}</button>`).join("")}</p>
    ${DEMO ? "" : `<p class="row"><b>Jef</b> <button data-needs="1">needs full</button><button data-money="100">+100 c</button></p>`}
    <p class="row"><b>Go to</b> ${deps.places.map((p, i) => `<button data-place="${i}">${p.name}</button>`).join("")}</p>
    <p class="note-small" data-out>${DEMO ? "Pick a time and a weather, then F9 to fly over the town." : "Time and weather change the save. F9 flies."}</p>
    <button name="back">Back</button>`;
  const out = panel.querySelector("[data-out]") as HTMLElement;
  const say = (t: string) => (out.textContent = t);
  if (deps.population) {
    const pop = deps.population;
    const enabled = panel.querySelector<HTMLInputElement>("[data-pop-enabled]")!;
    const slider = panel.querySelector<HTMLInputElement>("[data-pop-multiplier]")!;
    const value = panel.querySelector<HTMLOutputElement>("[data-pop-value]")!;
    const status = panel.querySelector<HTMLElement>("[data-pop-status]")!;
    const show = () => {
      const s = pop.read();
      value.textContent = `${enabled.checked ? slider.value : 1}×`;
      slider.disabled = !enabled.checked;
      status.textContent = `Normal street limit: ${s.base}. Extra NPCs: ${s.extra.toLocaleString()} / ${s.target.toLocaleString()}.`;
    };
    enabled.addEventListener("change", () => { pop.set(enabled.checked ? Number(slider.value) : 1); show(); });
    slider.addEventListener("input", () => { pop.set(enabled.checked ? Number(slider.value) : 1); show(); });
    panel.querySelector("[data-pop-reset]")!.addEventListener("click", () => { enabled.checked = false; slider.value = "1"; pop.set(1); show(); });
    show();
    btn.addEventListener("click", show);
    window.setInterval(() => { if (panel.style.display !== "none") show(); }, 500);
  }
  panel.addEventListener("click", async (e) => {
    e.stopPropagation();
    const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!b) return;
    const d = b.dataset;
    if (b.name === "back") panel.style.display = "none";
    else if (d.hour) say(`time ${d.hour}:00: ${await devSet({ hour: Number(d.hour), minute: 0 })}`);
    else if (d.tide && deps.tide) {
      // local only: holds the river (spring high or low water) without touching the save
      if (d.tide !== "now") deps.tide.hold(d.tide === "clock" ? null : (d.tide as "high" | "low"));
      say(deps.tide.read());
    } else if (d.weather) say(`weather ${d.weather}: ${await devSet({ weather: d.weather })}`);
    else if (d.event) {
      const ev = deps.events[Number(d.event)];
      say(`${ev.label}: ...`);
      const r = await ev.run();
      say(`${ev.label}: ${r ?? "started"}`);
    } else if (d.needs) say(`needs: ${await devSet({ food: 10, warmth: 10, sleep: 10, health: 10 })}`);
    else if (d.money) {
      const r = await fetch("/api/jobs").then((x) => x.json()).catch(() => null);
      const now = (r as { player?: { money_c?: number } } | null)?.player?.money_c ?? 0;
      say(`money: ${await devSet({ money_c: now + Number(d.money) })}`);
    } else if (d.place) {
      const p = deps.places[Number(d.place)];
      deps.place(p.x, p.z);
      say(`at ${p.name}`);
    }
  });
  panel.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.style.display = "block";
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && panel.style.display !== "none") panel.style.display = "none";
    // the web demo: F8 opens it from anywhere, also while walking (the mouse is let go so it can click)
    if (DEMO && e.code === "F8") {
      e.preventDefault();
      if (panel.style.display === "none") {
        if (document.pointerLockElement) document.exitPointerLock();
        panel.style.display = "block";
      } else panel.style.display = "none";
    }
  });
  if (DEMO) window.addEventListener("scheldemist:devmenu", () => (panel.style.display = "block"));
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) panel.style.display = "none";
  });
}
