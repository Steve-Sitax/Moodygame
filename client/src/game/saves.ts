// M7 save and pause (Steve 2026-09-25): "add a save game system so we load where we left off".
//
// On the Esc paper: Save (five slots of your own, a name each, writing over one asks first), Load
// (the same list with the two autosaves; loading asks first), and on the first screen Continue (the
// newest save). Autosaves: every game hour while you play (quietly: never while the town is talking,
// so play never stops for it), and when the tab is hidden or closed. The server writes the save
// (server/src/save/): it shuts the gate on the model calls first and waits for the ones on their way.
// A load swaps the server's game for the save and reloads this page; the page then puts Jef back
// from the save's browser part (restoreData.ts).

import { onSystemPush } from "../net/api";
import { isGuest } from "../net/mp/identity";
import { pause, real } from "./pause";
import { bootRestore, setRestore, type ClientState } from "./restoreData";
import { esc } from "./runs";
import { settings } from "./prefs";
import { DEMO } from "../demo/demo";

export interface SaveInfo {
  slot: string;
  kind: "slot" | "auto";
  label: string;
  saved_at: string;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
  place: string;
  money_c: number;
}

export interface SavesDeps {
  /** The browser's part of a save, now. */
  capture(): ClientState;
  /** Put a loaded save's browser part back (the town is in); resolves when done. */
  restore(c: ClientState): Promise<void>;
  /** Has the game been entered since the page loaded (before that there is nothing of ours to save)? */
  played(): boolean;
  /** The day and hour on the clock (an autosave each game hour). */
  hour(): { day: number; hour: number } | null;
  /** Jef is in play now (not paused, no sheet). */
  playing(): boolean;
  say(t: string): void;
}

const hm = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;
const when = (s: SaveInfo) => `${s.weekday} ${hm(s.hour, s.minute)}, day ${s.day}`;
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

async function json<T>(method: string, url: string, body?: unknown, timeoutMs = 60_000): Promise<T & { error?: string }> {
  const r = await real.fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: real.abortTimeout(timeoutMs),
  });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok && r.status !== 202) throw new Error(d.error ?? `HTTP ${r.status}`);
  return d;
}

export class Saves {
  private readonly panel: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly loadBtn: HTMLButtonElement;
  private readonly contBtn: HTMLButtonElement;
  private list: SaveInfo[] = [];
  private mode: "save" | "load" = "save";
  private armed: string | null = null;
  private armT = 0;
  private busy = false;
  /** Set before a reload of our own: no autosave on the way out. */
  private leaving = false;
  private lastAuto = "";
  private autoRetryAt = 0;

  constructor(
    paper: HTMLElement,
    private readonly d: SavesDeps,
  ) {
    const btn = (label: string) => {
      const b = document.createElement("button");
      b.className = "settings-btn";
      b.textContent = label;
      b.style.marginRight = "8px";
      return b;
    };
    const row = document.createElement("div");
    row.className = "save-row";
    this.contBtn = btn("Continue");
    this.contBtn.style.display = "none";
    this.saveBtn = btn("Save");
    this.saveBtn.style.display = "none";
    this.loadBtn = btn("Load");
    row.append(this.contBtn, this.saveBtn, this.loadBtn);
    if (DEMO) row.style.display = "none"; // the web demo saves nothing (demo/demo.ts)
    // M8e: a guest keeps his own part (Save); loading a save is the host's
    if (isGuest()) {
      this.contBtn.style.display = "none";
      this.loadBtn.style.display = "none";
    }
    // above Settings, Restart and Dev: the first thing on the paper after the keys
    const first = paper.querySelector(".settings-btn");
    if (first) paper.insertBefore(row, first);
    else paper.appendChild(row);
    this.contBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const newest = this.list[0];
      if (newest) void this.load(newest.slot);
    });
    this.saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.open("save");
    });
    this.loadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.open("load");
    });

    this.panel = document.createElement("div");
    this.panel.className = "settings paper saves pause-ui";
    this.panel.style.display = "none";
    this.panel.addEventListener("click", (e) => e.stopPropagation());
    this.panel.addEventListener("mousedown", (e) => e.stopPropagation());
    document.body.appendChild(this.panel);

    // "Saving..." and "Loading...": the game stands still under it
    this.card = document.createElement("div");
    this.card.className = "save-card pause-ui";
    this.card.style.display = "none";
    document.body.appendChild(this.card);

    // the small word in the corner after an autosave
    this.note = document.createElement("div");
    this.note.className = "autosave-note pause-ui";
    document.body.appendChild(this.note);

    onSystemPush((m) => {
      if (m.type === "gate" && this.card.style.display !== "none" && m.mode === "saving") this.showCard("Saving...", this.waitLine(Number(m.in_flight) || 0));
      // another tab (or player) loaded a save: this page starts again from it too
      if (m.type === "loaded" && !this.leaving) void this.followLoad();
    });

    // autosave when the tab is hidden or closed (a closed tab cannot wait for the answer: a beacon)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.autosave(false);
    });
    window.addEventListener("pagehide", () => this.beacon());
    // an autosave each game hour while Jef plays
    real.setInterval(() => this.hourly(), 2000);
    void this.refresh();
    void this.restoreAtBoot();
  }

  /** The first screen (Continue) or the pause paper (Save). After a load the page is that game: no Continue. */
  private started = false;
  showMenu(started: boolean): void {
    this.started = started || !!bootRestore();
    this.buttons();
    void this.refresh();
  }

  private buttons(): void {
    this.saveBtn.style.display = this.started ? "" : "none";
    const cont = !this.started && this.list.length > 0;
    this.contBtn.style.display = cont ? "" : "none";
    if (cont) this.contBtn.textContent = `Continue: ${when(this.list[0])}, ${this.list[0].place}`;
  }

  get panelOpen(): boolean {
    return this.panel.style.display !== "none";
  }

  closePanel(): void {
    this.panel.style.display = "none";
  }

  private async refresh(): Promise<void> {
    try {
      const r = await json<{ saves: SaveInfo[] }>("GET", "/api/saves", undefined, 8000);
      this.list = r.saves ?? [];
    } catch {
      /* the server is away */
    }
    this.buttons();
  }

  // ------------------------------------------------------------------ the panel

  private async open(mode: "save" | "load"): Promise<void> {
    this.mode = mode;
    this.armed = null;
    await this.refresh();
    this.draw();
    this.panel.style.display = "block";
  }

  private draw(msg = ""): void {
    const bySlot = new Map(this.list.map((s) => [s.slot, s]));
    const line = (s: SaveInfo | undefined) =>
      s ? `<span class="when">${esc(when(s))}</span> <span class="what">${esc(s.place)} &middot; ${Number(s.money_c)} c &middot; saved ${esc(ago(s.saved_at))}</span>` : `<span class="what">empty</span>`;
    let rows = "";
    if (this.mode === "save") {
      for (let i = 1; i <= 5; i++) {
        const slot = `slot${i}`;
        const s = bySlot.get(slot);
        const armed = this.armed === slot;
        rows += `<li data-slot="${slot}"><input class="name" maxlength="30" value="${esc(s?.label ?? `Slot ${i}`)}" aria-label="name of slot ${i}">
          ${line(s)} <button name="go">${armed ? "Write over it? Click again" : s ? "Save over" : "Save here"}</button></li>`;
      }
    } else {
      for (const s of this.list) {
        const armed = this.armed === s.slot;
        rows += `<li data-slot="${esc(s.slot)}"><b>${esc(s.label)}</b> ${line(s)} <button name="go">${armed ? "Lose what is not saved? Click again" : "Load"}</button></li>`;
      }
      if (!this.list.length) rows = `<li><span class="what">No saved games yet.</span></li>`;
    }
    this.panel.innerHTML = `<h2>${this.mode === "save" ? "Save the game" : "Load a game"}</h2>
      <ol class="slots">${rows}</ol>
      ${msg ? `<p class="msg">${esc(msg)}</p>` : ""}
      <p class="note-small">${this.mode === "save" ? "The game also saves itself every game hour, and when you leave it (the two autosaves take turns)." : "Loading puts you back where that save was: the time, the place, what you carry."}</p>
      <button name="back">Back</button>`;
    for (const li of this.panel.querySelectorAll<HTMLLIElement>("li[data-slot]")) {
      const slot = li.dataset.slot!;
      li.querySelector<HTMLButtonElement>("button[name=go]")!.onclick = (e) => {
        e.stopPropagation();
        const name = li.querySelector<HTMLInputElement>("input.name")?.value ?? "";
        this.go(slot, name);
      };
      li.querySelector<HTMLInputElement>("input.name")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.go(slot, (e.target as HTMLInputElement).value);
      });
    }
    this.panel.querySelector<HTMLButtonElement>("button[name=back]")!.onclick = (e) => {
      e.stopPropagation();
      this.closePanel();
    };
  }

  /** A slot's button: once to arm where something would be lost, twice to do it. */
  private go(slot: string, name: string): void {
    if (this.busy) return;
    const taken = this.list.some((s) => s.slot === slot);
    const ask = this.mode === "load" || taken;
    if (ask && this.armed !== slot) {
      this.armed = slot;
      window.clearTimeout(this.armT);
      this.armT = real.setTimeout(() => {
        this.armed = null;
        if (this.panelOpen) this.draw();
      }, 5000);
      this.draw();
      const inp = this.panel.querySelector<HTMLInputElement>(`li[data-slot="${slot}"] input.name`);
      if (inp) inp.value = name;
      return;
    }
    this.armed = null;
    if (this.mode === "save") void this.save(slot, name);
    else void this.load(slot);
  }

  // ------------------------------------------------------------------ saving and loading

  private waitLine(n: number): string {
    return n > 0 ? `Waiting for ${n === 1 ? "someone in the town" : `${n} people in the town`} to finish speaking.` : "Writing it down.";
  }

  private showCard(title: string, sub = ""): void {
    this.card.innerHTML = `<div class="paper"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div>`;
    this.card.style.display = "flex";
  }

  /** Save into a slot: the game stands still meanwhile (the server waits for the model calls on their way). */
  async save(slot: string, label = ""): Promise<string> {
    if (this.busy) return "busy";
    this.busy = true;
    pause.set("saving", true);
    this.showCard("Saving...", "Writing it down.");
    try {
      const r = await json<{ ok: boolean; info?: SaveInfo; saves?: SaveInfo[]; ms?: number }>("POST", "/api/save", { slot, label, client: this.d.capture() });
      if (!r.ok || !r.info) throw new Error(r.error ?? "not saved");
      this.list = r.saves ?? this.list;
      this.showCard("Saved", `${r.info.label}: ${when(r.info)}, ${r.info.place}.`);
      await new Promise((res) => real.setTimeout(res, 900));
      if (this.panelOpen) this.draw(`Saved in ${r.info.label}.`);
      return `saved ${r.info.slot} in ${r.ms} ms`;
    } catch (e) {
      if (this.panelOpen) this.draw(`Not saved: ${(e as Error).message}`);
      return `not saved: ${(e as Error).message}`;
    } finally {
      this.card.style.display = "none";
      pause.set("saving", false);
      this.busy = false;
    }
  }

  /** Load a save: the server swaps its game for it, then this page starts again from it. */
  async load(slot: string): Promise<string> {
    if (this.busy) return "busy";
    this.busy = true;
    pause.set("loading", true);
    this.showCard("Loading...", "Back to where you were.");
    try {
      this.leaving = true;
      const r = await json<{ ok: boolean; client?: ClientState | null }>("POST", "/api/load", { slot });
      if (!r.ok) throw new Error(r.error ?? "not loaded");
      setRestore(r.client ?? null);
      location.reload();
      return "loading";
    } catch (e) {
      this.leaving = false;
      this.card.style.display = "none";
      pause.set("loading", false);
      this.busy = false;
      if (this.panelOpen) this.draw(`Not loaded: ${(e as Error).message}`);
      else this.d.say(`Not loaded: ${(e as Error).message}`);
      return `not loaded: ${(e as Error).message}`;
    }
  }

  /** Another tab loaded a save on this server: fetch its browser part and start again from it. */
  private async followLoad(): Promise<void> {
    this.leaving = true;
    pause.set("loading", true);
    this.showCard("Loading...", "A saved game was loaded.");
    try {
      const r = await json<{ client: ClientState | null }>("GET", "/api/client-state", undefined, 8000);
      setRestore(r.client);
    } catch {
      /* the town comes back without Jef's place */
    }
    location.reload();
  }

  // ------------------------------------------------------------------ autosaves

  /** An autosave. `quiet`: while playing: only in a moment when no model call is on its way (the server says when). */
  async autosave(quiet: boolean): Promise<string> {
    if (this.leaving || this.busy || !this.d.played()) return "not now";
    try {
      const r = await json<{ ok: boolean; deferred?: boolean; info?: SaveInfo }>("POST", "/api/save", { slot: "auto", quiet, client: this.d.capture() }, 40_000);
      if (r.deferred) {
        this.autoRetryAt = real.now() + 30_000;
        return "put off: the town is busy talking";
      }
      if (!r.ok || !r.info) return "not saved";
      this.autoRetryAt = 0;
      if (quiet) this.flash("Game saved");
      return `autosaved ${r.info.slot}`;
    } catch (e) {
      return `not saved: ${(e as Error).message}`;
    }
  }

  private flash(t: string): void {
    this.note.textContent = t;
    this.note.classList.add("on");
    real.setTimeout(() => this.note.classList.remove("on"), 2200);
  }

  private hourly(): void {
    if (!this.d.playing() || pause.paused) return;
    const h = this.d.hour();
    if (!h) return;
    // menus: an autosave every 1, 2 or 4 game hours, or none but the one when the tab closes (Settings, Game)
    const every = settings.get("autosave");
    if (!every) return;
    const key = `${h.day}:${Math.floor(h.hour / every)}`;
    if (!this.lastAuto) {
      this.lastAuto = key; // the hour we came in at: the next one saves
      return;
    }
    if (key !== this.lastAuto || (this.autoRetryAt && real.now() > this.autoRetryAt)) {
      this.lastAuto = key;
      this.autoRetryAt = 0;
      void this.autosave(true);
    }
  }

  private beacon(): void {
    if (this.leaving || !this.d.played()) return;
    try {
      navigator.sendBeacon("/api/save", new Blob([JSON.stringify({ slot: "auto", client: this.d.capture() })], { type: "application/json" }));
    } catch {
      /* the tab closes without */
    }
  }

  // ------------------------------------------------------------------ after a load

  private async restoreAtBoot(): Promise<void> {
    const c = bootRestore();
    if (!c) return;
    try {
      await this.d.restore(c);
      this.d.say(`Loaded: ${c.clock ? `${hm(c.clock.hour, c.clock.minute)}, ` : ""}${c.place ?? "Antwerp"}.`);
    } catch (e) {
      console.warn("[saves] could not put everything back", e);
    }
  }

  /** Dev: the saves on the server. */
  async info(): Promise<SaveInfo[]> {
    await this.refresh();
    return this.list;
  }
}

