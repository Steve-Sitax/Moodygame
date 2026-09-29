import * as THREE from "three";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import { DOSS_POS } from "../world/rijnkaai";
import { propThings } from "../world/propSpots";
import { wallBenchSpots } from "../world/rampart";
import { STOPS } from "../../../shared/omnibusLines";
import TP from "../../../shared/townplaces.json";
import { doorBenchId, fixedBenches, MORNING_HOUR, SLEEP_HOURS, type Bench, type RestKind } from "../../../shared/sleep";
import { api, type JobsPayload, type RestAsk, type RestEnd, type RestView } from "../net/api";
import type { Action } from "./runs";
import { esc } from "./runs";
import { dialogs } from "./dialogs";

// M7 sleep (Steve 2026-09-26, docs/milestones/M7-sleep.md): no more "lie down here and sleep rough". E at his
// own bed, at the doss house door or at a bench opens a small chooser: 1, 2, 4 or 8 hours, or until morning,
// at any hour. The server checks the place and clamps the hours (server/src/rest.ts); while he sleeps the
// screen fades, a line tells the time passing (the time passes on the ticks, fast), he cannot move, and any
// key (not Esc or P: the menu and the pause work as ever) wakes him: only the time slept counts. Then the
// screen fades back and a line says how it went.

/** What Day gives the sleep: its tick and call sequencing, the toast, where Jef wakes. */
export interface SleepHost {
  /** One step of the sleep: a tick with `asleep` (null: another call was on its way, or the server is away). */
  restTick(): Promise<(JobsPayload & { advanced: boolean; rest?: RestView; woke?: RestEnd }) | null>;
  /** A call whose reply always applies (lie down, wake). */
  restCall<T extends JobsPayload>(call: () => Promise<T>): Promise<T>;
  toast(t: string): void;
  /** A tick now, with where he stands (the server checks the sleep's place against it). */
  report(): Promise<void>;
  /** Where Jef is for the cold: a room's id when he is inside (no benches indoors). */
  inside(): boolean;
  hour(): { hour: number; minute: number };
}

/** A place Jef may lie down, as the chooser asks the server. */
export interface RestPlace {
  kind: RestKind;
  label: string;
  bench?: Bench;
}

/** How close to a bench for E (m, from its middle; the server allows 2). */
const BENCH_REACH = 1.4;
/** A step of the sleep this often (real ms); the server passes half a game hour a step while all sleep. */
const STEP_MS = 350;

const CSS = `
.sleep-choose { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(-0.6deg); width: min(420px, 86vw);
  font-family: "Scheldemist Hand", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive; z-index: 6; zoom: var(--ui); text-align: left; }
.sleep-choose h2 { margin: 0 0 2px; font-size: 24px; }
.sleep-choose .sub { margin: 0 0 8px; font-size: 13px; opacity: 0.75; }
.sleep-choose .warn { margin: 0 0 6px; font-size: 14px; font-family: "Scheldemist Print", Georgia, serif; }
.sleep-choose ol.choices { list-style: none; padding: 0; margin: 6px 0 2px; border-top: 1px dashed rgba(42, 36, 32, 0.35); }
.sleep-choose ol.choices li { font-size: 15px; padding: 3px 0; font-family: "Scheldemist Print", Georgia, serif; }
.sleep-choose ol.choices .n { font-weight: bold; margin-right: 6px; font-family: "Scheldemist Hand", cursive; }
.sleep-choose ol.choices i { opacity: 0.65; font-size: 13px; }
.sleep-choose .keys { text-align: right; margin: 8px 0 0; font-size: 14px; opacity: 0.9; }
.sleep-fade { position: fixed; inset: 0; background: #07080a; opacity: 0; transition: opacity 1.1s ease; pointer-events: none; z-index: 30; display: flex; align-items: center; justify-content: center; }
.sleep-fade.on { opacity: 1; }
.sleep-fade .line { color: #cfc6ad; font-family: "Scheldemist Hand", "Segoe Print", cursive; font-size: 20px; text-align: center; zoom: var(--ui); opacity: 0.9; }
.sleep-fade .line small { display: block; font-size: 13px; opacity: 0.6; margin-top: 10px; }
`;

const hhmm = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;
function span(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m}` : ""}` : `${m} min`;
}

export class Sleep {
  private readonly chooser: HTMLDivElement;
  private readonly fade: HTMLDivElement;
  private choosing: RestPlace | null = null;
  /** Asleep (or lying down, or getting up): the player is still, the clock is the sleep's. */
  private state: "up" | "lying" | "asleep" | "waking" = "up";
  private place: RestPlace | null = null;
  private park: Array<Array<[number, number]>> | null = null;
  private list: Bench[] = [];
  private listKey = "";
  private readonly takenAt = new Map<string, { t: number; taken: boolean }>();

  constructor(
    private readonly host: SleepHost,
    private readonly player: FirstPerson,
    private readonly world: World,
  ) {
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    this.chooser = document.createElement("div");
    this.chooser.className = "sleep-choose paper";
    this.chooser.style.display = "none";
    document.body.appendChild(this.chooser);
    this.fade = document.createElement("div");
    this.fade.className = "sleep-fade";
    this.fade.innerHTML = `<div class="line"></div>`;
    document.body.appendChild(this.fade);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    // the chooser is worked with the ink cursor; asleep, the mouse does nothing (a key wakes him)
    dialogs.register("sleep chooser", () => this.choosing !== null);
    dialogs.register("asleep", () => this.state !== "up", { cursor: false, esc: false });
    void fetch("/models/park.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { benches?: Array<Array<[number, number]>> } | null) => (this.park = d?.benches ?? []))
      .catch(() => (this.park = []));
  }

  /** The chooser is up, or he is asleep: no other keys, no clock of the waking day. */
  get busy(): boolean {
    return this.choosing !== null || this.state !== "up";
  }
  get asleep(): boolean {
    return this.state !== "up";
  }

  // ------------------------------------------------------------------ the benches

  /** Every bench in town: the fixed ones (shared with the server) and those by house doors (world/clutter.ts). */
  benches(): Bench[] {
    const doors = propThings.filter((t) => t.src === "clutter" && t.name === "bench");
    const key = `${doors.length}|${wallBenchSpots.length}|${this.park?.length ?? -1}`;
    if (key === this.listKey) return this.list;
    this.listKey = key;
    this.list = [
      ...fixedBenches({ townplaces: TP as never, stops: STOPS, park: this.park ?? [], wall: wallBenchSpots }),
      ...doors.map((t) => ({ id: doorBenchId(t.x, t.z), label: "a bench by a house door", x: Number(t.x.toFixed(1)), z: Number(t.z.toFixed(1)), y: t.y, fine: false })),
    ];
    return this.list;
  }

  /** Someone sitting or lying on it (a townsperson, a sailor on the Steen's bench): looked at twice a second at most. */
  private taken(b: Bench): boolean {
    const now = performance.now();
    const k = this.takenAt.get(b.id);
    if (k && now - k.t < 500) return k.taken;
    let taken = false;
    const v = new THREE.Vector3();
    this.world.scene.traverseVisible((o) => {
      if (taken || !o.userData.human) return;
      o.getWorldPosition(v);
      if (Math.hypot(v.x - b.x, v.z - b.z) < 0.9 && Math.abs(v.y - b.y) < 1.6) taken = true;
    });
    this.takenAt.set(b.id, { t: now, taken });
    return taken;
  }

  /** E at a bench in reach (jobs.extraActions): "sleep on the bench", or it is taken. */
  keys(x: number, z: number): { options: Array<[number, Action]> } {
    if (this.busy || this.host.inside()) return { options: [] };
    const y = this.player.y;
    let best: Bench | null = null;
    let bd = BENCH_REACH;
    for (const b of this.benches()) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d >= bd) continue;
      if (Math.abs(y - b.y) > (b.y > 1 ? 1.2 : 2.5)) continue;
      best = b;
      bd = d;
    }
    if (!best) return { options: [] };
    const b = best;
    const at = { x: b.x, y: b.y + 0.45, z: b.z };
    if (this.taken(b)) return { options: [[bd + 0.2, { key: "KeyE", text: "the bench is taken", run: () => this.host.toast("Someone is on that bench already."), at }]] };
    return { options: [[bd + 0.2, { key: "KeyE", text: "sleep on the bench", run: () => this.choose({ kind: "bench", label: b.label, bench: b }), at }]] };
  }

  // ------------------------------------------------------------------ the chooser

  /** Open the chooser for a place (the bed at home, the doss house, a bench). */
  choose(place: RestPlace): void {
    if (this.busy) return;
    this.choosing = place;
    this.player.frozen = true;
    const c = this.host.hour();
    const toMorning = ((MORNING_HOUR * 60 - (c.hour * 60 + c.minute) + 1440 - 1) % 1440) + 1;
    const title = place.kind === "bench" ? "Sleep on the bench" : place.kind === "doss" ? "A bed in the doss house" : "Go to bed";
    const warn =
      place.kind === "bench"
        ? `<p class="warn">A hard bench in the open: less rest, the cold goes into your coat at once, and a sleeper in the street is easy pickings.</p>`
        : "";
    const lines = SLEEP_HOURS.map((h, i) => `<li><span class="n">${i + 1}</span> Sleep for ${h} hour${h > 1 ? "s" : ""}</li>`);
    lines.push(`<li><span class="n">${SLEEP_HOURS.length + 1}</span> Sleep until morning <i>(${MORNING_HOUR}:00, ${span(toMorning)})</i></li>`);
    this.chooser.innerHTML = `<h2>${title}</h2><p class="sub">${esc(place.label)} &middot; it is ${hhmm(c.hour, c.minute)}</p>${warn}
      <ol class="choices">${lines.join("")}</ol><p class="keys">E or Esc  never mind</p>`;
    this.chooser.style.display = "block";
  }

  private closeChooser(): void {
    this.choosing = null;
    this.chooser.style.display = "none";
    if (this.state === "up") this.player.frozen = false;
  }

  // ------------------------------------------------------------------ asleep

  private async lieDown(place: RestPlace, hours: number | "morning"): Promise<void> {
    this.closeChooser();
    this.state = "lying";
    this.place = place;
    this.player.frozen = true;
    // (the cell is never chosen: it is the police's, game/deeds.ts)
    const ask: RestAsk = { place: place.kind === "cell" ? "bench" : place.kind, hours, pos: { x: this.player.x, z: this.player.z, y: this.player.y } };
    if (place.bench) ask.bench = place.bench.id;
    try {
      // where he stands now (after a ride, a jump of the dev menu): the server holds the sleep's place against it
      await this.host.report();
      const r = await this.host.restCall(() => api.sleep(ask));
      this.state = "asleep";
      this.show(r.rest);
      this.fade.classList.add("on");
      void this.loop();
    } catch (e) {
      this.state = "up";
      this.place = null;
      this.player.frozen = false;
      this.host.toast((e as Error).message);
    }
  }

  /**
   * M8c played together: the server has him asleep without his asking (dead on his feet, he dropped where he
   * stood): the sleep comes to him with his heartbeat, and goes on at the world's pace like any other.
   */
  joinFromServer(v: RestView): void {
    if (this.state !== "up") return;
    this.closeChooser();
    this.state = "asleep";
    this.place = { kind: v.place, label: v.label };
    this.player.frozen = true;
    // M8d: the cell at the police post: he is taken there under the fade (the others see him at the post)
    if (v.at) this.player.place(v.at.x, v.at.z, v.at.yaw);
    this.show(v);
    this.fade.classList.add("on");
    void this.loop();
  }

  private show(v: RestView | undefined): void {
    if (!v) return;
    const where = v.place === "cell" ? "In the cell at the police post" : v.place === "bench" ? "On the bench" : v.place === "doss" ? "In the doss house" : "In your own bed";
    // M8d: the cell's door opens at dawn, not at a key; the town goes on outside
    const small = v.place === "cell" ? "the door is unlocked at dawn; the town goes on outside" : "any key: wake up";
    const el = this.fade.querySelector(".line")!;
    el.innerHTML = `${where} &middot; ${hhmm(v.now.hour, v.now.minute)} &middot; ${span(v.slept_min)} of ${span(v.planned_min)}<small>${small}</small>`;
  }

  private async loop(): Promise<void> {
    while (this.state === "asleep") {
      // the page's timers wait through a pause (game/pause.ts): the sleep waits with them
      await new Promise((ok) => window.setTimeout(ok, STEP_MS));
      if (this.state !== "asleep") return;
      const r = await this.host.restTick();
      if (this.state !== "asleep") return;
      if (r?.woke) return this.getUp(r.woke);
      if (r?.rest) this.show(r.rest);
      // the server has him up (a loaded save, a restart: its clock moved as a waking tick): up here too.
      // A tick held by the pause or a save says nothing (advanced false): the sleep waits.
      else if (r?.advanced) return this.getUp(null);
    }
  }

  /** A key: he wakes now. */
  private async wake(): Promise<void> {
    if (this.state !== "asleep") return;
    this.state = "waking";
    try {
      const r = await this.host.restCall(() => api.wake());
      this.getUp(r.woke);
    } catch {
      this.getUp(null);
    }
  }

  private getUp(woke: RestEnd | null): void {
    this.state = "waking";
    const place = this.place;
    this.place = null;
    // from the doss house he steps out at the alley gate, facing the river (as the M5 night); his bed or a bench: where he lay
    if (place?.kind === "doss") this.player.place(DOSS_POS.x, DOSS_POS.z - 0.4, 0);
    this.fade.classList.remove("on");
    window.setTimeout(() => {
      this.state = "up";
      this.player.frozen = false;
    }, 900);
    // (M8d: out of the cell: the police's sheet of the night says it, game/deeds.ts)
    if (woke && !woke.ended && place?.kind !== "cell") this.host.toast(woke.lines.join(" "));
  }

  private onKey(e: KeyboardEvent): void {
    if (this.choosing) {
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === "KeyE" || e.code === "Escape") return this.closeChooser();
      const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      const i = n ? Number(n[1]) - 1 : -1;
      if (i >= 0 && i < SLEEP_HOURS.length) void this.lieDown(this.choosing, SLEEP_HOURS[i]);
      else if (i === SLEEP_HOURS.length) void this.lieDown(this.choosing, "morning");
      return;
    }
    if (this.state === "up") return;
    // Esc and P: the menu and the pause, as ever (the sleep waits); any other key wakes him
    if (e.code === "Escape" || e.code === "KeyP") return;
    e.stopPropagation();
    if (e.repeat || /^(Shift|Control|Alt|Meta)/.test(e.code)) return;
    // M8d: no key opens the cell
    if (this.place?.kind === "cell") return;
    void this.wake();
  }

  /** Dev: the state and the nearest benches (the kit's t.sleepInfo()). */
  info(): { state: string; choosing: string | null; near: Array<{ id: string; label: string; d: number; taken: boolean }> } {
    const { x, z } = this.player;
    const near = this.benches()
      .map((b) => ({ b, d: Math.hypot(b.x - x, b.z - z) }))
      .sort((a, c) => a.d - c.d)
      .slice(0, 5)
      .map(({ b, d }) => ({ id: b.id, label: b.label, d: Math.round(d * 10) / 10, taken: this.taken(b) }));
    return { state: this.state, choosing: this.choosing?.label ?? null, near };
  }
}
