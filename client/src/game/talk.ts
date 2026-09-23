import { api, type JobsPayload, type TalkLine, type Ware } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { Npc } from "./people";
import { esc } from "./runs";

// The talk window (M3). The NPC speaks; Jef picks one of three lines (1-3),
// or types his own (T). B shows what they sell and pays on the spot (M3b).
// E or Esc steps away. The engine never waits on the
// model: a "..." shows while the line is written (4-9 s, docs/03).

export class Talk {
  private npc: Npc | null = null;
  private busy = false;
  private ended = false;
  private choices: string[] = [];
  private lines: Array<{ who: string; text: string }> = [];
  private mood = "";
  private readonly el: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private typing = false;
  private shopping = false;
  private wares = new Map<string, Ware[]>();
  /** After a purchase: new money and pockets, and what the seller does. */
  onBought: (p: JobsPayload, line: string) => void = () => {};
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

  /** Talk, or (shopOnly) go straight to the wares without a conversation. */
  open(npc: Npc, shopOnly = false): void {
    this.npc = npc;
    this.lines = [];
    this.choices = [];
    this.ended = shopOnly;
    this.shopping = shopOnly;
    this.mood = "";
    this.player.frozen = true;
    this.el.style.display = "block";
    if (shopOnly) this.render();
    else void this.send("open");
  }

  close(): void {
    this.npc = null;
    this.typing = false;
    this.player.frozen = false;
    this.el.style.display = "none";
  }

  private async send(kind: "open" | "choice" | "free", text?: string): Promise<void> {
    const npc = this.npc;
    if (!npc || this.busy) return;
    this.busy = true;
    if (text) this.lines.push({ who: "You", text });
    this.choices = [];
    this.render();
    let r: TalkLine;
    try {
      r = await api.talk(npc.id, kind, text);
    } catch {
      r = { npc_line: `${npc.def.name} does not answer.`, choices: [], end: true };
    }
    this.busy = false;
    if (this.npc !== npc) return; // walked away meanwhile
    if (!r.npc_line) {
      // gated without a line: too fast, too long or empty
      if (text) this.lines.pop();
      this.flash(r.gated === "too fast" ? "Catch your breath first." : r.gated === "too long" ? "Too many words at once." : "");
      this.choices = this.lastChoices;
      this.render();
      return;
    }
    this.lines.push({ who: npc.def.name, text: r.npc_line });
    this.mood = r.mood ?? "";
    this.choices = r.end ? [] : (r.choices ?? []);
    this.lastChoices = this.choices;
    this.ended = !!r.end;
    this.render();
  }

  private async buy(w: Ware): Promise<void> {
    const npc = this.npc;
    if (!npc) return;
    try {
      const r = await api.buy(npc.id, w.kind);
      this.money = r.player.money_c;
      this.onBought(r, r.line);
      this.flash(`Paid ${w.price_c} c.`);
    } catch (e) {
      this.flash((e as Error).message);
    }
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
      .map((l) => `<p class="${l.who === "You" ? "you" : "them"}"><b>${esc(l.who)}:</b> ${esc(l.text)}</p>`)
      .join("");
    const wait = this.busy ? `<p class="them wait">${esc(npc.def.name)} …</p>` : "";
    const opts = this.choices.map((c, i) => `<li><span class="n">${i + 1}</span> ${esc(c)}</li>`).join("");
    const shop = this.stock.length ? " &middot; B  buy" : "";
    const keys = this.shopping
      ? `1-${this.stock.length}  pay &middot; B  back to talk &middot; you have ${this.money} c`
      : this.ended
        ? `E  step away${shop}`
        : this.busy
          ? ""
          : `1-3  answer &middot; T  say it your way${shop} &middot; E  step away`;
    const list = this.shopping
      ? `<ol class="wares">${this.stock
          .map((w, i) => `<li><span class="n">${i + 1}</span> ${esc(w.name)}<span class="price">${w.price_c} c</span></li>`)
          .join("")}</ol>`
      : opts
        ? `<ol class="choices">${opts}</ol>`
        : "";
    this.el.innerHTML = `<div class="who">${esc(npc.def.name)}${this.mood ? ` <i>${esc(this.mood)}</i>` : ""}</div>
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
        if (t) void this.send("free", t);
        else this.render();
        e.preventDefault();
      } else if (e.code === "Escape") {
        this.typing = false;
        this.render();
      }
      e.stopPropagation(); // letters go to the input, not to the game
      return;
    }
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === "KeyE" || e.code === "Escape") return this.close();
    if (e.code === "KeyB" && this.stock.length) {
      this.shopping = !this.shopping;
      return this.render();
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
