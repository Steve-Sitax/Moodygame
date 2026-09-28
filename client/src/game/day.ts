import { aboutMe, me } from "../player/profile"; // M7 character: the player's name and words
import { api, type DayTurn, type Ending, type JobsPayload, type Night, type RestEnd, type RestView, type WhereNow, type WhereReport } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import { DOSS_POS, type World } from "../world/rijnkaai";
import { Sleep } from "./sleep";
import { esc } from "./runs";
import { topLeft } from "./corner";
import { GAME_MIN_PER_REAL_S, TICK_EVERY_MS, TICK_MINUTES } from "../../../shared/clock";
import { TIRED_AT } from "../../../shared/night";
import { pause } from "./pause";
import { dialogs } from "./dialogs";
import { identity, isGuest } from "../net/mp/identity";

// The day and the week (M5). The server owns the clock; this side asks for a
// tick every 10 s while you play (shared/clock.ts: 5 game minutes; a game hour is 2 real minutes), shows the time, turns the light, and shows
// the night and the end of the week. docs/01: seven days. M7 night (Steve 2026-09-25): the clock runs
// on through the night, the date turns at midnight. M7 sleep (2026-09-26, game/sleep.ts): Jef sleeps in a
// bed or on a bench when he chooses and as long as he chooses; dead tired, he still drops where he stands
// and wakes seven or eight hours later where he lay (the night sheet). Very tired, he is slower and his sight swims.

const TICK_MS = TICK_EVERY_MS;

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
  /** M7 sleep: the chooser at a bed or a bench, the fade while he sleeps (game/sleep.ts). */
  readonly rest: Sleep;

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
  ) {
    this.clockEl = document.createElement("div");
    this.clockEl.className = "clock";
    topLeft().prepend(this.clockEl);
    this.sheet = document.createElement("div");
    this.sheet.className = "night paper";
    this.sheet.style.display = "none";
    document.body.appendChild(this.sheet);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    dialogs.register("day sheet", () => this.sheetOpen); // focus fix: the pause knows it is up (game/dialogs.ts)
    this.rest = new Sleep(
      {
        restTick: () => this.restTick(),
        restCall: (call) => this.restCall(call),
        toast: (t) => this.toast(t),
        report: () => this.tick(),
        inside: () => this.where().at !== null,
        hour: () => {
          const at = Math.floor(this.hourF * 60 + 1e-6); // the clock as shown in the corner
          return { hour: Math.floor(at / 60) % 24, minute: at % 60 };
        },
      },
      player,
      world,
    );
    window.setInterval(() => {
      if (this.playing) void this.tick();
    }, TICK_MS);
    // M7 clock: the shown time runs on a minute every two real seconds between the server's ticks
    window.setInterval(() => this.renderClock(), 1000);
    // M7 night: dead tired, the legs drag and the sight swims
    window.setInterval(() => this.tiredness(), 200);
    // M7 warmth: through a door (or the lantern up or down), the server hears of it now, not at the next tick
    window.setInterval(() => {
      if (!this.playing) return;
      const w = this.where();
      const key = `${w.at ?? ""}|${w.lantern}`;
      if (key !== this.whereSent) void this.tick();
    }, 1000);
  }

  /**
   * M7 warmth: set by main: where Jef is (a room's id, or null outside) and whether his lantern is lit in his
   * hand. Sent with each tick; the server believes only what it can check (server/src/warmth.ts).
   */
  where: () => WhereReport = () => ({ at: null, lantern: false });
  private whereSent = "";
  /** What the server last believed (the kit and the warm-room line). */
  whereNow: WhereNow | null = null;

  /** M7 warmth: a line once as Jef comes into a heated room. */
  private warmRoom(w: WhereNow | undefined): void {
    if (!w) return;
    const before = this.whereNow;
    this.whereNow = w;
    if (w.shelter !== "heated" || (before?.shelter === "heated" && before.place === w.place)) return;
    const fire = w.place?.startsWith("tavern:") || w.place === "poesje";
    // a moment after the door: the room's own line (its smell, who is in) is read first; only if he is still there
    window.setTimeout(() => {
      if (this.whereNow?.shelter === "heated" && this.whereNow.place === w.place)
        this.toast(fire ? "The warmth of the fire gets into your coat." : "The warmth of the stove gets into your coat.");
    }, 4000);
  }

  private tiredT = 0;
  /** Sleep need 2 or less: slower, the view blurred, the lids heavy now and then (client show only). */
  private tiredness(): void {
    const s = this.payload?.player.sleep ?? 10;
    const on = s <= TIRED_AT && !this.payload?.ending && this.shown === "none";
    this.player.fatigue = on ? (s <= 1 ? 0.6 : 0.75) : 1;
    const canvas = document.getElementById("game") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (!on) {
      if (canvas.style.filter) canvas.style.filter = "";
      return;
    }
    this.tiredT += 0.2;
    // a slow swim of the sight, and every few seconds the lids come down
    const blur = (s <= 1 ? 1.4 : 0.8) + Math.sin(this.tiredT * 0.9) * 0.4;
    const lid = Math.max(0, Math.sin(this.tiredT * (s <= 1 ? 0.55 : 0.35)));
    const dim = 1 - Math.pow(lid, 8) * (s <= 1 ? 0.6 : 0.4);
    canvas.style.filter = `blur(${Math.max(0, blur).toFixed(2)}px) brightness(${dim.toFixed(2)})`;
  }

  /** Time runs while you are in the game: pointer locked (or dev input), no night sheet up, not asleep (the sleep runs its own clock). */
  get playing(): boolean {
    return (this.player.locked || this.player.freeInput) && !this.player.fly && this.shown === "none" && !this.payload?.ending && !this.hold && !this.rest.asleep;
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

  /** The hour with its fraction, run on smoothly between the server's ticks (shared/clock.ts: half a game minute a real second). */
  get hourF(): number {
    const c = this.payload?.clock;
    if (!c) return 6;
    // M7 save and pause: paused, the clock stands where it was on screen (performance.now stands still: game/pause.ts).
    // Back in play after a time out of it (the first screen, a loaded save, a sheet): the run on starts again from here,
    // not from when the server's time came in (a loaded 13:40 showed 13:45 at once).
    const on = this.playing || pause.paused || pause.together; // M8a: together the town's clock runs on behind the menu
    if (on && !this.wasOn) this.shownAt = Math.max(this.shownAt, performance.now());
    this.wasOn = on;
    const ahead = on ? Math.min(TICK_MINUTES / 60, ((performance.now() - this.shownAt) / 1000) * (GAME_MIN_PER_REAL_S / 60)) : 0;
    // M7 night: never 24 or past it (the server turns the date at midnight)
    return Math.min(24 - 1e-6, c.hour + c.minute / 60 + ahead);
  }
  private shownAt = performance.now();
  private wasOn = false;

  /** M7 fog lamps: today's fog as the lamplighters see it (null before the server has said). */
  get lampsFog(): JobsPayload["lamps_fog"] | null {
    return this.payload?.lamps_fog ?? null;
  }

  /** The lamps a player lights for a lamplighter tonight (server town/lampjob.ts), with the day it is for. */
  get lampsHelp(): JobsPayload["lamps_help"] | null {
    return this.payload?.lamps_help ?? null;
  }

  get rentPaid(): boolean {
    return this.payload?.rent.paid ?? false;
  }

  /** New state from the server (push or reply). */
  show(p: JobsPayload): void {
    this.warnNeeds(p);
    if (!this.payload || this.payload.clock.minute !== p.clock.minute || this.payload.clock.hour !== p.clock.hour) this.shownAt = performance.now();
    this.payload = p;
    const c = p.clock;
    if (!c) return;
    this.renderClock();
    this.world.setTimeOfDay(c.hour + c.minute / 60);
    this.world.setWeather(c.weather);
    if (p.ending && this.shown !== "night") this.showEnd(p.ending);
  }

  /** The clock in the corner: the server's time, run on between its ticks (never past the next tick). */
  private renderClock(): void {
    const p = this.payload;
    const c = p?.clock;
    if (!p || !c) return;
    const at = Math.floor(this.hourF * 60 + 1e-6);
    const hour = Math.floor(at / 60) % 24;
    const minute = at % 60;
    const time = `${hour}:${String(minute).padStart(2, "0")}`;
    const rent = p.rent.paid ? "" : `<span class="rent">rent ${p.rent.price_c} c due by Sunday</span>`;
    const html = `<b>${esc(c.weekday)}</b> ${time}${rent}`;
    if (this.clockEl.innerHTML !== html) this.clockEl.innerHTML = html;
  }

  /** Say it when a need runs low, once each time it crosses the line. */
  private warnNeeds(p: JobsPayload): void {
    const before = this.payload?.player;
    const now = p.player;
    if (!before || !now || p.ending) return;
    const lines: Array<[number, number, string, string]> = [
      [before.food, now.food, "Your belly aches. Eat something soon: Fientje sells herring, the widow sells biscuit.", "You are starving. Your strength is going. Eat."],
      [before.warmth, now.warmth, "You are cold to the bone. A warm room, a bed or a nip of jenever warms you; a lantern or a roof slows the cold.", "You are freezing. Get into a warm room, a tavern or a shop with a stove, or you will fall ill."],
      [before.sleep, now.sleep, "Your eyes close by themselves and your legs drag. Get to a bed or a bench soon, or you will drop where you stand.", "You drop where you stand."],
      [before.health, now.health, "You feel ill. Eat, get warm and sleep.", "You can hardly stand."],
    ];
    for (const [was, is, low, zero] of lines) {
      if (is <= 0 && was > 0) return this.toast(zero);
      if (is <= 2 && was > 2) return this.toast(low);
    }
  }

  // ------------------------------------------------------------- server calls

  /**
   * Replies come back in any order: a slow /api/tick sent before a sleep must not put the clock
   * back to the evening. Each call takes a number when it is sent; a tick older than the last
   * reply applied is dropped. A sleep is always applied, and no tick goes out while it is on its way.
   */
  private sleeping = false;
  private sent = 0;
  private applied = 0;
  private fresh(seq: number): boolean {
    if (seq < this.applied) return false;
    this.applied = seq;
    return true;
  }

  async tick(): Promise<void> {
    if (this.busy || this.sleeping) return;
    this.busy = true;
    const seq = ++this.sent;
    try {
      const where = this.where();
      this.whereSent = `${where.at ?? ""}|${where.lantern}`;
      const r = await api.tick(where, { pos: this.pos() });
      if (!this.fresh(seq)) return;
      this.apply(r);
      this.warmRoom(r.where);
      // M8c played together: asleep on the server's word (he dropped where he stood): the sleep screen comes to him
      const rest = (r as { rest?: RestView }).rest;
      if (rest) this.rest.joinFromServer(rest);
      if (r.night) this.showNight(r.night);
      else if (r.turned && !r.turned.ended) this.midnight(r.turned);
    } catch {
      // server away: time simply does not pass
    } finally {
      this.busy = false;
    }
  }

  /** Where Jef stands (with each tick: the server's check of a bench or the doss house step, server/src/rest.ts). */
  private pos(): { x: number; z: number; y: number } {
    const r = (n: number) => Math.round(n * 100) / 100;
    return { x: r(this.player.x), z: r(this.player.z), y: r(this.player.y) };
  }

  /** M7 sleep: one step of the sleep (game/sleep.ts): a tick that says he is asleep. */
  private async restTick(): Promise<(JobsPayload & { advanced: boolean; rest?: RestView; woke?: RestEnd }) | null> {
    if (this.busy || this.sleeping) return null;
    this.busy = true;
    const seq = ++this.sent;
    try {
      const r = await api.tick(this.where(), { asleep: true, pos: this.pos() });
      if (!this.fresh(seq)) return null;
      this.apply(r);
      // the date turned in his sleep: the night's other work (a note about the rent) is in the wake lines
      if (r.turned && !r.turned.ended) this.onMidnight(r.turned);
      return r;
    } catch {
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** M7 sleep: lie down, wake: the reply always applies, and no tick goes out while it is on its way. */
  private async restCall<T extends JobsPayload>(call: () => Promise<T>): Promise<T> {
    const seq = ++this.sent;
    this.sleeping = true;
    try {
      const r = await call();
      this.applied = Math.max(this.applied, seq);
      this.apply(r);
      return r;
    } finally {
      this.sleeping = false;
    }
  }

  /** M6 homes: set by the homes; after a night at home Jef wakes in his own room. */
  onWakeHome: (home: string) => void = () => {};

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

  /** M7 night: midnight while Jef is up: the date turns, a word from the night's other work (no sheet). */
  onMidnight: (t: DayTurn) => void = () => {};
  private midnight(t: DayTurn): void {
    const c = this.payload?.clock;
    this.toast([`Midnight. ${c?.weekday ?? "A new day"} begins. New work goes up on the board.`, ...t.lines].join(" "));
    this.onMidnight(t);
  }

  private showNight(n: Night): void {
    this.night = n;
    this.open("night");
    const where = n.where === "home" ? `Your own room: ${n.place ?? "home"}` : n.where === "bed" ? "The doss house, Sint-Andries" : n.collapsed ? "Where you dropped, on the stones" : "Rough, under a tarpaulin";
    const title = n.collapsed ? "Dropped asleep" : "Asleep";
    this.sheet.innerHTML = `<h2>${title}</h2><p class="sub">${esc(where)}</p>
      ${n.summary.map((l) => `<p>${esc(l)}</p>`).join("")}
      <p class="keys">${n.ended ? "E  go on" : "E  get up"}</p>`;
  }

  private showEnd(e: Ending): void {
    this.open("end");
    const body = e.epilogue
      ? `<h2>${esc(e.epilogue.title)}</h2>${e.epilogue.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}`
      : `<h2>${e.kind === "health" ? aboutMe("The end of Jef") : "Sunday night"}</h2><p class="wait">Somebody is writing down what became of ${me().sex === "woman" ? "her" : "him"} &hellip;</p>`;
    this.sheet.innerHTML = `${body}<p class="keys">${e.epilogue ? this.endKeys(e) : ""}</p>`;
  }

  /**
   * M8d played together: after his own end (his body gave out) a player starts a new man, who comes by the ferry
   * while the world goes on; the world's week end is the host's to follow with a new week. Played alone: as ever.
   */
  private endKeys(e: Ending): string {
    if (!identity.together) return "N  start a new week";
    if (e.kind === "health") return "N  a new man on the ferry";
    return isGuest() ? "The host starts the next week." : "N  start a new week";
  }

  private async newMan(): Promise<void> {
    try {
      const r = await fetch("/api/player/new-man", { method: "POST", signal: AbortSignal.timeout(15000) });
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      // the ferry brings him in (game/ferryArrival.ts): the character sheet first, then the deck
      location.reload();
    } catch (err) {
      this.toast((err as Error).message);
    }
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
    // from the doss house you step out of the alley gate, facing the river; rough, he gets up where he lay
    if (n?.where === "bed") this.player.place(DOSS_POS.x, DOSS_POS.z - 0.4, 0);
    if (n?.where === "home" && n.home) this.onWakeHome(n.home);
    const sky = { fog: "The fog is thick on the Schelde.", mist: "A thin mist lies on the river.", clear: "The air is clear and cold. You can see the far bank.", rain: "Rain is coming in off the Schelde.", storm: "A gale off the sea. The river runs high and grey. Keep off the quay edge." };
    const c = this.payload?.clock;
    const at = c ? ` ${c.hour}:${String(c.minute).padStart(2, "0")}` : "";
    const dark = c ? c.hour < 6 || c.hour >= 20 : false;
    this.toast(`${c?.weekday ?? "A new day"}${at}. ${dark ? "Still dark." : sky[c?.weather ?? "fog"]}${n?.turned ? " New work is on the board." : ""}`);
  }

  private async newWeek(): Promise<void> {
    // M7 character: "Your character" first (menu/character.ts); the new week once the server has it
    if (document.querySelector(".char-sheet")) return;
    const start = async () => {
      try {
        await api.newGame();
        location.reload();
      } catch (e) {
        this.toast((e as Error).message);
      }
    };
    try {
      const { openCharacterCreator } = await import("../menu/character");
      openCharacterCreator(() => void start());
    } catch {
      await start();
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (this.shown === "none") return;
    e.stopPropagation(); // while a sheet is up, keys belong to it
    if (e.repeat) return;
    if (this.shown === "night" && (e.code === "KeyE" || e.code === "Enter")) this.wake();
    else if (this.shown === "end" && e.code === "KeyN" && this.payload?.ending?.epilogue) {
      const end = this.payload.ending;
      if (identity.together && end.kind === "health") void this.newMan();
      else if (!identity.together || !isGuest()) void this.newWeek();
    }
  }
}
