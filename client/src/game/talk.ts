import { api, type Job, type JobsPayload, type TalkLine, type Ware } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
/** Anyone you can talk to: the people of the quay (people.ts) and every townsperson (town.ts). */
export interface Speaker {
  id: string;
  def: { name: string; title?: string };
}
import { esc } from "./runs";

// The talk window (M3). The NPC speaks; Jef picks one of three lines (1-3),
// or types his own (T). B shows what they sell and pays on the spot (M3b).
// E or Esc steps away. The engine never waits on the
// model: a "..." shows while the line is written (4-9 s, docs/03).

export class Talk {
  private npc: Speaker | null = null;
  /** Set by main: a townsperson stops and faces Jef while they talk (M3e). */
  onOpen: (id: string) => void = () => {};
  onClose: (id: string) => void = () => {};
  private busy = false;
  /** Bumped on every open, close and request: a reply for an older one is dropped (Jef switched people meanwhile). */
  private req = 0;
  private ended = false;
  private choices: string[] = [];
  /** note: M6, how a haggle or a story went down ("He looks doubtful"), shown small under the line. */
  private lines: Array<{ who: string; text: string; note?: string }> = [];
  /** M6 haggle: picking which ware to argue about (several on sale), then the ware being argued. */
  private picking = false;
  private haggleKind: string | null = null;
  /** M6 haggle: the list prices before a price was agreed, to put back after the purchase. */
  private listBefore = new Map<string, Ware[]>();
  private mood = "";
  private readonly el: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private typing = false;
  private shopping = false;
  private working = false;
  /** Set by Jobs: open work this person offers, and how to take it. */
  work: (npcId: string) => Job[] = () => [];
  onTakeWork: (job: Job) => void = () => {};
  private wares = new Map<string, Ware[]>();
  /** After a purchase: new money and pockets, and what the seller does. */
  onBought: (p: JobsPayload, line: string) => void = () => {};
  /** M6 gifts: every reply as it comes (game/hands.ts shows a thing handed over). */
  onReply: (id: string, r: TalkLine) => void = () => {};
  money = 0;

  constructor(private readonly player: FirstPerson) {
    this.el = document.createElement("div");
    this.el.className = "talk paper";
    this.el.style.display = "none";
    document.body.appendChild(this.el);
    this.input = document.createElement("input");
    this.input.className = "talk-input";
    this.input.maxLength = 300;
    this.input.placeholder = "Say it in your own words, then Enter";
    // capture phase: while talking, keys belong to this window
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    api
      .npcs()
      .then((list) => list.forEach((n) => this.wares.set(n.id, n.wares)))
      .catch(() => {});
  }

  private get stock(): Ware[] {
    return this.npc ? (this.wares.get(this.npc.id) ?? []) : [];
  }

  get isOpen(): boolean {
    return this.npc !== null;
  }

  /** Does this person sell anything? */
  sells(id: string): boolean {
    return (this.wares.get(id)?.length ?? 0) > 0;
  }

  /** What a townsperson sells (M3e: from the town, not from /api/npcs). */
  setWares(id: string, wares: Ware[]): void {
    this.wares.set(id, wares);
  }

  /** Talk, or (shopOnly) go straight to the wares without a conversation. */
  open(npc: Speaker, shopOnly = false): void {
    if (this.npc && this.npc.id !== npc.id) this.onClose(this.npc.id);
    this.npc = npc;
    this.onOpen(npc.id);
    this.lines = [];
    this.choices = [];
    this.ended = shopOnly;
    this.shopping = shopOnly;
    this.working = false;
    this.picking = false;
    this.haggleKind = null;
    this.mood = "";
    // a reply still on its way for the last person is dropped, and this window starts clean
    this.req++;
    this.busy = false;
    this.player.frozen = true;
    this.el.style.display = "block";
    this.render();
    if (shopOnly) {
      // the prices he asks Jef now (a haggled price still good), not only the list
      const id = npc.id;
      void fetch(`/api/npc/${encodeURIComponent(id)}/wares`, { signal: AbortSignal.timeout(6000) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { wares?: Ware[] } | null) => {
          if (!j || !Array.isArray(j.wares) || !j.wares.length || this.npc?.id !== id) return;
          this.newPrices(id, j.wares);
          this.render();
        })
        .catch(() => {});
    } else void this.send("open");
  }

  /** Dev: say this in Jef's own words to whoever the window is open with (the browser checks). */
  devSay(text: string): Promise<void> {
    return this.send("free", text);
  }

  /** Dev: the lines on the paper now. */
  devLines(): Array<{ who: string; text: string; note?: string }> {
    return [...this.lines];
  }

  close(): void {
    if (this.npc) this.onClose(this.npc.id);
    this.npc = null;
    this.req++;
    this.busy = false;
    this.typing = false;
    this.player.frozen = false;
    this.el.style.display = "none";
  }

  private async send(kind: "open" | "choice" | "free", text?: string): Promise<void> {
    const npc = this.npc;
    if (!npc || this.busy) return;
    this.busy = true;
    const my = ++this.req;
    if (text) this.lines.push({ who: "You", text });
    this.choices = [];
    this.render();
    let r: TalkLine;
    try {
      r = await api.talk(npc.id, kind, text);
    } catch {
      r = { npc_line: `${npc.def.name} does not answer.`, choices: [], end: true };
    }
    if (my !== this.req) return; // walked away or turned to someone else meanwhile
    this.busy = false;
    if (this.npc !== npc) return;
    if (!r.npc_line) {
      // gated without a line: too fast, too long or empty
      if (text) this.lines.pop();
      this.flash(r.gated === "too fast" ? "Catch your breath first." : r.gated === "too long" ? "Too many words at once." : "");
      this.choices = this.lastChoices;
      this.render();
      return;
    }
    this.lines.push({ who: npc.def.name, text: r.npc_line, note: r.note });
    if (r.wares) this.newPrices(npc.id, r.wares);
    this.onReply(npc.id, r);
    this.mood = r.mood ?? "";
    this.choices = r.end ? [] : (r.choices ?? []);
    this.lastChoices = this.choices;
    this.ended = !!r.end;
    this.render();
  }

  /** M6: the seller's prices after a haggle; the list prices are kept to put back after buying. */
  private newPrices(id: string, wares: Ware[]): void {
    if (!this.listBefore.has(id)) this.listBefore.set(id, this.wares.get(id) ?? wares);
    this.wares.set(id, wares);
  }

  /** M6: argue the price of a ware in his own words (the server's gate, the model's reading, the engine's price). */
  private async haggle(kind: string, text: string): Promise<void> {
    const npc = this.npc;
    if (!npc || this.busy) return;
    this.busy = true;
    const my = ++this.req;
    const ware = this.stock.find((w) => w.kind === kind);
    this.lines.push({ who: "You", text });
    this.render();
    let r: TalkLine;
    try {
      r = await api.haggle(npc.id, kind, text);
    } catch (e) {
      r = { npc_line: `${npc.def.name} shrugs. (${(e as Error).message})` };
    }
    if (my !== this.req) return;
    this.busy = false;
    if (this.npc !== npc) return;
    if (!r.npc_line) {
      this.lines.pop();
      this.flash(r.gated === "too fast" ? "Catch your breath first." : r.gated === "too long" ? "Too many words at once." : "");
      this.render();
      return;
    }
    this.lines.push({ who: npc.def.name, text: r.npc_line, note: r.note });
    if (r.wares) this.newPrices(npc.id, r.wares);
    this.mood = r.mood ?? this.mood;
    const now = r.wares?.find((w) => w.kind === kind);
    if (ware && now && now.price_c < ware.price_c) this.flash(`${ware.name}: ${now.price_c} c for you.`);
    this.render();
  }

  private async buy(w: Ware): Promise<void> {
    const npc = this.npc;
    if (!npc) return;
    try {
      const r = await api.buy(npc.id, w.kind);
      this.money = r.player.money_c;
      this.onBought(r, r.line);
      this.flash(`Paid ${r.price_c ?? w.price_c} c.`);
      // the server's prices after this purchase: a haggled price still good for more stays shown (QA 2026-09-24)
      const after = (r as { wares?: Ware[] }).wares;
      const list = this.listBefore.get(npc.id);
      if (Array.isArray(after) && after.length) this.wares.set(npc.id, after);
      else if (list && (r.price_c ?? w.price_c) < (list.find((x) => x.kind === w.kind)?.price_c ?? 0)) {
        this.wares.set(npc.id, (this.wares.get(npc.id) ?? list).map((x) => (x.kind === w.kind ? (list.find((l) => l.kind === x.kind) ?? x) : x)));
      }
    } catch (e) {
      this.flash((e as Error).message);
    }
    this.render();
  }

  /** M6 haggle: open the input for his argument about this ware. */
  private startHaggle(w: Ware): void {
    this.haggleKind = w.kind;
    this.input.placeholder = `Argue the price of ${w.name} (${w.price_c} c), then Enter`;
    this.typing = true;
    this.render();
  }

  private lastChoices: string[] = [];
  private note = "";
  private flash(t: string): void {
    this.note = t;
    setTimeout(() => {
      this.note = "";
      this.render();
    }, 2500);
  }

  private render(): void {
    const npc = this.npc;
    if (!npc) return;
    const shown = this.lines.slice(-4);
    const body = shown
      .map(
        (l) =>
          `<p class="${l.who === "You" ? "you" : "them"}"><b>${esc(l.who)}:</b> ${esc(l.text)}</p>` +
          (l.note ? `<p class="them" style="opacity:0.7;font-style:italic;font-size:0.88em;margin-top:-0.2em">${esc(l.note)}</p>` : ""),
      )
      .join("");
    const wait = this.busy ? `<p class="them wait">${esc(npc.def.name)} …</p>` : "";
    const opts = this.choices.map((c, i) => `<li><span class="n">${i + 1}</span> ${esc(c)}</li>`).join("");
    const jobs = this.work(npc.id);
    const shop = (this.stock.length ? " &middot; B  buy" : "") + (jobs.length ? " &middot; W  take work" : "");
    const keys = this.picking
      ? `1-${this.stock.length}  which one to argue about &middot; Esc  back`
      : this.typing && this.haggleKind
        ? `Argue the price in your own words, then Enter &middot; Esc  back`
        : this.shopping
      ? `1-${this.stock.length}  pay &middot; H  argue a price &middot; B  back to talk &middot; you have ${this.money} c`
      : this.working
        ? `1-${jobs.length}  take it &middot; W  back to talk`
        : this.ended
          ? `E  step away${shop}`
          : this.busy
            ? ""
            : `1-3  answer &middot; T  say it your way${shop} &middot; E  step away`;
    const list = this.shopping
      ? `<ol class="wares">${this.stock
          .map((w, i) => `<li><span class="n">${i + 1}</span> ${esc(w.name)}<span class="price">${w.price_c} c</span></li>`)
          .join("")}</ol>`
      : this.working
        ? `<ol class="wares">${jobs
            .map((j, i) => `<li><span class="n">${i + 1}</span> ${esc(j.title)}<span class="price">${j.pay_c} c</span></li>`)
            .join("")}</ol>`
        : opts
          ? `<ol class="choices">${opts}</ol>`
          : "";
    this.el.innerHTML = `<div class="who">${esc(npc.def.name)}${npc.def.title ? `<span class="title">, ${esc(npc.def.title)}</span>` : ""}${this.mood ? ` <i>${esc(this.mood)}</i>` : ""}</div>
      ${body}${wait}
      ${list}
      <p class="keys">${this.note ? esc(this.note) : keys}</p>`;
    if (this.typing) {
      this.el.appendChild(this.input);
      this.input.focus();
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.npc) return;
    if (this.typing) {
      if (e.code === "Enter") {
        const t = this.input.value.trim();
        this.input.value = "";
        this.typing = false;
        const kind = this.haggleKind;
        this.haggleKind = null;
        this.input.placeholder = "Say it in your own words, then Enter";
        if (t && kind) void this.haggle(kind, t);
        else if (t) void this.send("free", t);
        else this.render();
        e.preventDefault();
      } else if (e.code === "Escape") {
        this.typing = false;
        this.haggleKind = null;
        this.input.placeholder = "Say it in your own words, then Enter";
        this.render();
      }
      e.stopPropagation(); // letters go to the input, not to the game
      return;
    }
    e.stopPropagation();
    if (e.repeat) return;
    // M6 haggle: which ware to argue about
    if (this.picking) {
      if (e.code === "Escape" || e.code === "KeyH") {
        this.picking = false;
        return this.render();
      }
      const k = Number(e.key);
      if (k >= 1 && k <= this.stock.length) {
        e.preventDefault(); // the digit must not land in the input that opens now
        this.picking = false;
        this.startHaggle(this.stock[k - 1]);
      }
      return;
    }
    if (e.code === "KeyE" || e.code === "Escape") return this.close();
    if (e.code === "KeyH" && this.shopping && this.stock.length && !this.busy) {
      e.preventDefault();
      if (this.stock.length === 1) this.startHaggle(this.stock[0]);
      else {
        this.picking = true;
        this.render();
      }
      return;
    }
    if (e.code === "KeyB" && this.stock.length) {
      this.shopping = !this.shopping;
      this.working = false;
      return this.render();
    }
    const jobs = this.work(this.npc.id);
    if (e.code === "KeyW" && (jobs.length || this.working)) {
      this.working = !this.working;
      this.shopping = false;
      return this.render();
    }
    if (this.working) {
      const k = Number(e.key);
      if (k >= 1 && k <= jobs.length) this.onTakeWork(jobs[k - 1]);
      return;
    }
    if (this.shopping) {
      const k = Number(e.key);
      if (k >= 1 && k <= this.stock.length) void this.buy(this.stock[k - 1]);
      return;
    }
    if (this.busy || this.ended) return;
    const n = Number(e.key);
    if (n >= 1 && n <= this.choices.length) return void this.send("choice", this.choices[n - 1]);
    if (e.code === "KeyT") {
      e.preventDefault();
      this.typing = true;
      this.render();
    }
  }
}
