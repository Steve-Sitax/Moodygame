import { api, type Ending, type JobsPayload, type Night } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import { DOSS_POS, type World } from "../world/rijnkaai";
import { esc } from "./runs";

// The day and the week (M5). The server owns the clock; this side asks for a
// tick every 5 s while you play, shows the time, turns the light, and shows
// the night and the end of the week. docs/01: 6:00 to midnight, seven days.

const TICK_MS = 5000;

export class Day {
  private payload: JobsPayload | null = null;
  private readonly clockEl: HTMLDivElement;
  private readonly sheet: HTMLDivElement;
  /** What the sheet shows: nothing, a night, or the end of the week. */
  private shown: "none" | "night" | "end" = "none";
  private night: Night | null = null;
  private busy = false;
  /** Set by Jobs: new money, needs and jobs from any day call. */
  apply: (p: JobsPayload) => void = () => {};
  toast: (t: string) => void = () => {};
  /** Set by Jobs: close the board, talk and pockets when a sheet comes up. */
  onSheet: () => void = () => {};

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
  ) {
    this.clockEl = document.createElement("div");
    this.clockEl.className = "clock";
    document.body.appendChild(this.clockEl);
    this.sheet = document.createElement("div");
    this.sheet.className = "night paper";
    this.sheet.style.display = "none";
    document.body.appendChild(this.sheet);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    window.setInterval(() => {
      if (this.playing) void this.tick();
    }, TICK_MS);
  }

  /** Time runs while you are in the game: pointer locked (or dev input), no night sheet up. */
  get playing(): boolean {
    return (this.player.locked || this.player.freeInput) && !this.player.fly && this.shown === "none" && !this.payload?.ending && !this.hold;
  }
  /** M3h: another sheet is up (the night in the cell): the clock waits. */
  hold = false;

  get sheetOpen(): boolean {
    return this.shown !== "none";
  }

  get hour(): number {
    return this.payload?.clock.hour ?? 6;
  }

  /** Day of the week, 1 = Monday (M3e: the town's schedules). */
  get dayNum(): number {
    return this.payload?.clock.day ?? 1;
  }

  /** The hour with its fraction, run on smoothly between the server's ticks (15 game minutes per 5 s). */
  get hourF(): number {
    const c = this.payload?.clock;
    if (!c) return 6;
    const ahead = this.playing ? Math.min(0.25, ((performance.now() - this.shownAt) / 1000) * (15 / 5 / 60)) : 0;
    return c.hour + c.minute / 60 + ahead;
  }
  private shownAt = performance.now();

  get rentPaid(): boolean {
    return this.payload?.rent.paid ?? false;
  }

  /** May Jef go to bed now? After 18:00, or earlier when he is dead tired. */
  get bedOpen(): boolean {
    const p = this.payload;
    return !!p && (p.clock.hour >= p.rent.bedtime || p.player.sleep <= 2);
  }

  /** New state from the server (push or reply). */
  show(p: JobsPayload): void {
    this.warnNeeds(p);
    if (!this.payload || this.payload.clock.minute !== p.clock.minute || this.payload.clock.hour !== p.clock.hour) this.shownAt = performance.now();
    this.payload = p;
    const c = p.clock;
    if (!c) return;
    const time = `${c.hour}:${String(c.minute).padStart(2, "0")}`;
    const rent = p.rent.paid ? "" : `<span class="rent">rent ${p.rent.price_c} c due by Sunday</span>`;
    const html = `<b>${esc(c.weekday)}</b> ${time}${rent}`;
    if (this.clockEl.innerHTML !== html) this.clockEl.innerHTML = html;
    this.world.setTimeOfDay(c.hour + c.minute / 60);
    this.world.setWeather(c.weather);
    if (p.ending && this.shown !== "night") this.showEnd(p.ending);
  }

  /** Say it when a need runs low, once each time it crosses the line. */
  private warnNeeds(p: JobsPayload): void {
    const before = this.payload?.player;
    const now = p.player;
    if (!before || !now || p.ending) return;
    const lines: Array<[number, number, string, string]> = [
      [before.food, now.food, "Your belly aches. Eat something soon: Fientje sells herring, the widow sells biscuit.", "You are starving. Your strength is going. Eat."],
      [before.warmth, now.warmth, "You are cold to the bone. A bed or a nip of jenever warms you.", "You are freezing. Get under a roof or you will fall ill."],
      [before.sleep, now.sleep, "Your eyes close by themselves. The doss house takes you early when you are this tired.", "You are dead on your feet. Sleep, or your health goes."],
      [before.health, now.health, "You feel ill. Eat, get warm and sleep.", "You can hardly stand."],
    ];
    for (const [was, is, low, zero] of lines) {
      if (is <= 0 && was > 0) return this.toast(zero);
      if (is <= 2 && was > 2) return this.toast(low);
    }
  }

  // ------------------------------------------------------------- server calls

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await api.tick();
      this.apply(r);
      if (r.night) this.showNight(r.night);
    } catch {
      // server away: time simply does not pass
    } finally {
      this.busy = false;
    }
  }

  /** M6 homes: set by the homes; after a night at home Jef wakes in his own room. */
  onWakeHome: (home: string) => void = () => {};

  async sleep(call: () => Promise<JobsPayload & { night: Night }> = api.sleep): Promise<void> {
    try {
      const r = await call();
      this.apply(r);
      this.showNight(r.night);
    } catch (e) {
      this.toast((e as Error).message);
    }
  }

  async rent(): Promise<void> {
    try {
      const r = await api.rent();
      this.apply(r);
      this.toast(r.text);
    } catch (e) {
      this.toast((e as Error).message);
    }
  }

  // ------------------------------------------------------------- the sheets

  private open(kind: "night" | "end"): void {
    if (this.shown === "none") this.onSheet();
    this.shown = kind;
    this.player.frozen = true;
    this.sheet.style.display = "block";
    this.sheet.classList.toggle("end", kind === "end");
  }

  private showNight(n: Night): void {
    this.night = n;
    this.open("night");
    const where = n.where === "home" ? `Your own room: ${n.place ?? "home"}` : n.where === "bed" ? "The doss house, Sint-Andries" : "The quay, under a tarpaulin";
    this.sheet.innerHTML = `<h2>Night</h2><p class="sub">${esc(where)}</p>
      ${n.summary.map((l) => `<p>${esc(l)}</p>`).join("")}
      <p class="keys">${n.ended ? "E  go on" : "E  wake at dawn"}</p>`;
  }

  private showEnd(e: Ending): void {
    this.open("end");
    const body = e.epilogue
      ? `<h2>${esc(e.epilogue.title)}</h2>${e.epilogue.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}`
      : `<h2>${e.kind === "health" ? "The end of Jef" : "Sunday night"}</h2><p class="wait">Somebody is writing down what became of him &hellip;</p>`;
    this.sheet.innerHTML = `${body}<p class="keys">${e.epilogue ? "N  start a new week" : ""}</p>`;
  }

  private wake(): void {
    const n = this.night;
    this.night = null;
    if (n?.ended) {
      // the week is over: the epilogue sheet, or wait for it
      this.showEnd(this.payload?.ending ?? n.ended);
      return;
    }
    this.shown = "none";
    this.sheet.style.display = "none";
    this.player.frozen = false;
    // from the doss house you step out of the alley gate at dawn, facing the river
    if (n?.where === "bed") this.player.place(DOSS_POS.x, DOSS_POS.z - 0.4, 0);
    if (n?.where === "home" && n.home) this.onWakeHome(n.home);
    const sky = { fog: "The fog is thick on the Schelde.", mist: "A thin mist lies on the river.", clear: "The air is clear and cold. You can see the far bank.", rain: "Rain is coming in off the Schelde.", storm: "A gale off the sea. The river runs high and grey. Keep off the quay edge." };
    const c = this.payload?.clock;
    this.toast(`${c?.weekday ?? "A new day"}. ${sky[c?.weather ?? "fog"]} New work is on the board.`);
  }

  private async newWeek(): Promise<void> {
    try {
      await api.newGame();
      location.reload();
    } catch (e) {
      this.toast((e as Error).message);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (this.shown === "none") return;
    e.stopPropagation(); // while a sheet is up, keys belong to it
    if (e.repeat) return;
    if (this.shown === "night" && (e.code === "KeyE" || e.code === "Enter")) this.wake();
    else if (this.shown === "end" && e.code === "KeyN" && this.payload?.ending?.epilogue) void this.newWeek();
  }
}
